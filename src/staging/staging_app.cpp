#include "gseurat/staging/staging_app.hpp"
#include "gseurat/staging/staging_state.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/gs_parallax_camera.hpp"
#include "gseurat/engine/scene_loader.hpp"
#include "gseurat/engine/gs_vfx.hpp"

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include <stb_image_write.h>

#include <imgui.h>
#include <imgui_impl_glfw.h>
#include <imgui_impl_vulkan.h>

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

#include <glm/gtc/matrix_transform.hpp>

#include <cstdio>
#include <filesystem>
#include <string_view>

namespace gseurat {

void StagingApp::parse_args(int argc, char* argv[]) {
    for (int i = 1; i < argc; ++i) {
        std::string_view arg(argv[i]);
        if (arg == "--scene" && i + 1 < argc) {
            scene_path_ = argv[++i];
        }
    }
}

void StagingApp::init_game_content() {
    init_window();

    // Font atlas (ASCII only)
    std::vector<uint32_t> codepoints;
    for (uint32_t cp = 32; cp <= 126; cp++) codepoints.push_back(cp);
    font_atlas_.init("assets/fonts/NotoSans-Regular.ttf", 32.0f, codepoints);
    text_renderer_.init(font_atlas_);

    renderer_.init(window_, resources_);
    renderer_.init_font(font_atlas_, resources_);
    renderer_.init_particles(resources_);
    renderer_.init_shadows(resources_);

    ui_ctx_.init(font_atlas_, text_renderer_);

    // Start with all post-process/effects off — user enables what they want to review.
    // GS pipeline flags (rendering, chunk culling, LOD, adaptive budget) stay on.
    feature_flags_ = FeatureFlags::gs_viewer();
    feature_flags_.particles = true;
    feature_flags_.animation = true;
    feature_flags_.fog = true;

    init_imgui();
}

void StagingApp::main_loop() {
    set_current_scene_path(scene_path_);
    state_stack_.push(std::make_unique<StagingState>(), *this);

    last_update_time_ = std::chrono::steady_clock::now();

    // Initialize async loading subsystems
    async_loader_.init();
    staging_uploader_.init(
        renderer_.context().device(), renderer_.context().allocator(),
        renderer_.command_pool().pool(), renderer_.context().graphics_queue(),
        [this](const std::string& cache_key, Texture tex) {
            auto sp = std::make_shared<Texture>(std::move(tex));
            resources_.texture_cache().insert(cache_key, std::move(sp));
        });

    // Start control server for bridge integration
#ifndef _WIN32
    control_server_.start();
#endif

    while (!glfwWindowShouldClose(window_)) {
        glfwPollEvents();

        // Poll control server for bridge commands
        poll_control_server();

        resources_.process_async_results(async_loader_, staging_uploader_);
        staging_uploader_.flush();

        overlay_sprites_.clear();
        ui_sprites_.clear();

        input_.update();

        auto now = std::chrono::steady_clock::now();
        float dt = std::chrono::duration<float>(now - last_update_time_).count();
        last_update_time_ = now;
        if (dt > 0.1f) dt = 0.1f;

        // ImGui new frame
        ImGui_ImplVulkan_NewFrame();
        ImGui_ImplGlfw_NewFrame();
        ImGui::NewFrame();

        state_stack_.update(*this, dt);
        play_time_ += dt;
        tick_++;

        // Feed UI context
        {
            ui::UIInput ui_input;
            ui_input.mouse_pos = input_.mouse_pos();
            ui_input.mouse_down = input_.is_mouse_down(0);
            ui_input.mouse_pressed = input_.was_mouse_pressed(0);
            ui_input.key_up = false;
            ui_input.key_down_nav = false;
            ui_input.key_enter = false;
            ui_input.key_escape = false;
            ui_input.scroll_delta = 0.0f;
            ui_ctx_.set_screen_height(720.0f);
            ui_ctx_.begin_frame(ui_input);
        }

        state_stack_.build_draw_lists(*this);

        std::vector<SpriteDrawInfo> particle_sprites;
        particles_.generate_draw_infos(particle_sprites);

        std::vector<ui::UIDrawBatch> ui_batches;

        // Screen effects
        if (feature_flags_.screen_effects) {
            auto fc = screen_effects_.flash_color() * screen_effects_.flash_alpha();
            renderer_.set_ca_intensity(screen_effects_.ca_intensity());
            renderer_.set_flash_color(fc.r, fc.g, fc.b);
        } else {
            renderer_.set_ca_intensity(0.0f);
            renderer_.set_flash_color(0.0f, 0.0f, 0.0f);
        }

        // Finalize ImGui (before draw_scene so overlay callback can render it)
        ImGui::Render();

        renderer_.draw_scene(scene_, entity_sprites_, outline_sprites_, reflection_sprites_,
                             shadow_sprites_, particle_sprites, overlay_sprites_, ui_batches,
                             feature_flags_);
    }
}

void StagingApp::cleanup() {
    vkDeviceWaitIdle(renderer_.context().device());
    shutdown_imgui();

    while (!state_stack_.empty()) {
        state_stack_.pop(*this);
    }
#ifndef _WIN32
    control_server_.stop();
#endif
    async_loader_.shutdown();
    staging_uploader_.shutdown();
    audio_.shutdown();
    // ResourceManager must shut down before Renderer, because Renderer::shutdown()
    // destroys the VMA allocator — any textures still in cache would leak.
    resources_.shutdown();
    renderer_.shutdown();
    glfwDestroyWindow(window_);
    glfwTerminate();
}

void StagingApp::init_imgui() {
    auto device = renderer_.context().device();

    // Create descriptor pool for ImGui
    VkDescriptorPoolSize pool_sizes[] = {
        { VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, 100 },
    };
    VkDescriptorPoolCreateInfo pool_info{};
    pool_info.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    pool_info.flags = VK_DESCRIPTOR_POOL_CREATE_FREE_DESCRIPTOR_SET_BIT;
    pool_info.maxSets = 100;
    pool_info.poolSizeCount = 1;
    pool_info.pPoolSizes = pool_sizes;
    vkCreateDescriptorPool(device, &pool_info, nullptr, &imgui_pool_);

    // Create render pass that renders on top of swapchain images
    create_imgui_render_pass();

    // Create framebuffers for ImGui render pass
    auto& swapchain = renderer_.swapchain();
    imgui_framebuffers_.resize(swapchain.image_count());
    for (uint32_t i = 0; i < swapchain.image_count(); i++) {
        VkFramebufferCreateInfo fb_info{};
        fb_info.sType = VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO;
        fb_info.renderPass = imgui_render_pass_;
        fb_info.attachmentCount = 1;
        fb_info.pAttachments = &swapchain.image_views()[i];
        fb_info.width = swapchain.extent().width;
        fb_info.height = swapchain.extent().height;
        fb_info.layers = 1;
        vkCreateFramebuffer(device, &fb_info, nullptr, &imgui_framebuffers_[i]);
    }

    // Initialize ImGui
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;

    // Style
    ImGui::StyleColorsDark();
    auto& style = ImGui::GetStyle();
    style.WindowRounding = 4.0f;
    style.FrameRounding = 2.0f;
    style.Alpha = 0.95f;

    // Init platform/renderer backends
    ImGui_ImplGlfw_InitForVulkan(window_, true);

    ImGui_ImplVulkan_InitInfo init_info{};
    init_info.Instance = renderer_.context().instance();
    init_info.PhysicalDevice = renderer_.context().physical_device();
    init_info.Device = device;
    init_info.QueueFamily = renderer_.context().graphics_queue_family();
    init_info.Queue = renderer_.context().graphics_queue();
    init_info.DescriptorPool = imgui_pool_;
    init_info.MinImageCount = 2;
    init_info.ImageCount = swapchain.image_count();
    init_info.RenderPass = imgui_render_pass_;
    ImGui_ImplVulkan_Init(&init_info);

    // Set overlay callback on the renderer
    renderer_.set_overlay_callback([this](VkCommandBuffer cmd, uint32_t image_index) {
        VkRenderPassBeginInfo rp_info{};
        rp_info.sType = VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO;
        rp_info.renderPass = imgui_render_pass_;
        rp_info.framebuffer = imgui_framebuffers_[image_index];
        rp_info.renderArea.extent = renderer_.swapchain().extent();
        vkCmdBeginRenderPass(cmd, &rp_info, VK_SUBPASS_CONTENTS_INLINE);
        ImGui_ImplVulkan_RenderDrawData(ImGui::GetDrawData(), cmd);
        vkCmdEndRenderPass(cmd);
    });

    std::fprintf(stderr, "[Staging] ImGui initialized\n");
}

void StagingApp::create_imgui_render_pass() {
    auto device = renderer_.context().device();
    auto format = renderer_.swapchain().image_format();

    VkAttachmentDescription attachment{};
    attachment.format = format;
    attachment.samples = VK_SAMPLE_COUNT_1_BIT;
    attachment.loadOp = VK_ATTACHMENT_LOAD_OP_LOAD;  // preserve existing content
    attachment.storeOp = VK_ATTACHMENT_STORE_OP_STORE;
    attachment.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    attachment.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    attachment.initialLayout = VK_IMAGE_LAYOUT_PRESENT_SRC_KHR;
    attachment.finalLayout = VK_IMAGE_LAYOUT_PRESENT_SRC_KHR;

    VkAttachmentReference color_ref{};
    color_ref.attachment = 0;
    color_ref.layout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;

    VkSubpassDescription subpass{};
    subpass.pipelineBindPoint = VK_PIPELINE_BIND_POINT_GRAPHICS;
    subpass.colorAttachmentCount = 1;
    subpass.pColorAttachments = &color_ref;

    VkSubpassDependency dependency{};
    dependency.srcSubpass = VK_SUBPASS_EXTERNAL;
    dependency.dstSubpass = 0;
    dependency.srcStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    dependency.dstStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    dependency.srcAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
    dependency.dstAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;

    VkRenderPassCreateInfo rp_info{};
    rp_info.sType = VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO;
    rp_info.attachmentCount = 1;
    rp_info.pAttachments = &attachment;
    rp_info.subpassCount = 1;
    rp_info.pSubpasses = &subpass;
    rp_info.dependencyCount = 1;
    rp_info.pDependencies = &dependency;

    vkCreateRenderPass(device, &rp_info, nullptr, &imgui_render_pass_);
}

void StagingApp::shutdown_imgui() {
    auto device = renderer_.context().device();

    ImGui_ImplVulkan_Shutdown();
    ImGui_ImplGlfw_Shutdown();
    ImGui::DestroyContext();

    for (auto fb : imgui_framebuffers_) {
        vkDestroyFramebuffer(device, fb, nullptr);
    }
    imgui_framebuffers_.clear();

    if (imgui_render_pass_) {
        vkDestroyRenderPass(device, imgui_render_pass_, nullptr);
        imgui_render_pass_ = VK_NULL_HANDLE;
    }
    if (imgui_pool_) {
        vkDestroyDescriptorPool(device, imgui_pool_, nullptr);
        imgui_pool_ = VK_NULL_HANDLE;
    }
}

// ── Scene loading (reuse from DemoApp pattern) ──

void StagingApp::init_scene(const std::string& scene_path) {
    current_scene_path_ = scene_path;
    auto scene_data = SceneLoader::load(scene_path);
    load_gs_scene(scene_data);
    std::fprintf(stderr, "[Staging] Loaded scene: %s\n", scene_path.c_str());
}

void StagingApp::clear_scene() {
    vkDeviceWaitIdle(renderer_.context().device());
    renderer_.clear_gs_particle_emitters();
    renderer_.clear_gs_animations();
    renderer_.clear_vfx_instances();
    scene_.clear_lights();
    gs_aabb_offset_ = glm::vec2(0.0f);
    // Don't re-init GS here — init_scene() will do it if needed.
    // For empty viewport on standalone launch, on_enter() handles it.
}

}  // namespace gseurat
