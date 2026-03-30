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
    wren_vm_.shutdown();
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

    renderer_.clear_gs_particle_emitters();
    renderer_.clear_gs_animations();
    renderer_.clear_vfx_instances();

    scene_.clear_lights();
    scene_.set_ambient_color(scene_data.ambient_color);
    for (const auto& pl : scene_data.static_lights) {
        scene_.add_light(pl);
    }

    if (scene_data.gaussian_splat) {
        const auto& gs = *scene_data.gaussian_splat;
        GaussianCloud cloud;
        try {
            cloud = GaussianCloud::load_ply(gs.ply_file);
        } catch (const std::runtime_error& e) {
            std::fprintf(stderr, "[Staging] Warning: %s\n", e.what());
        }
        if (!cloud.empty()) {
            renderer_.gs_renderer().set_scale_multiplier(gs.scale_multiplier);

            // Merge static placed objects
            if (!scene_data.placed_objects.empty()) {
                auto merged = cloud.gaussians();
                for (const auto& obj : scene_data.placed_objects) {
                    if (!obj.is_static) continue;
                    try {
                        auto placed_cloud = GaussianCloud::load_ply(obj.ply_file);
                        if (placed_cloud.empty()) continue;
                        auto transform = glm::translate(glm::mat4(1.0f), obj.position);
                        transform = glm::rotate(transform, glm::radians(obj.rotation.x), {1,0,0});
                        transform = glm::rotate(transform, glm::radians(obj.rotation.y), {0,1,0});
                        transform = glm::rotate(transform, glm::radians(obj.rotation.z), {0,0,1});
                        transform = glm::scale(transform, glm::vec3(obj.scale));
                        auto rot_q = glm::quat(glm::radians(obj.rotation));
                        auto placed_gs = placed_cloud.gaussians();
                        for (auto& g : placed_gs) {
                            g.position = glm::vec3(transform * glm::vec4(g.position, 1.0f));
                            g.scale *= obj.scale;
                            g.rotation = rot_q * g.rotation;
                        }
                        merged.insert(merged.end(), placed_gs.begin(), placed_gs.end());
                    } catch (const std::runtime_error&) {}
                }
                cloud = GaussianCloud::from_gaussians(std::move(merged));
            }

            uint32_t gs_w = gs.render_width;
            uint32_t gs_h = gs.render_height;
            if (cloud.count() > 100000 && gs_w >= 320) { gs_w = 160; gs_h = 120; }
            else if (cloud.count() > 50000 && gs_w >= 320) { gs_w = 240; gs_h = 180; }

            renderer_.init_gs(cloud, gs_w, gs_h);

            float aspect = static_cast<float>(gs_w) / static_cast<float>(gs_h);
            auto gs_view = glm::lookAt(gs.camera_position, gs.camera_target, glm::vec3(0, 1, 0));
            auto gs_proj = glm::perspective(glm::radians(gs.camera_fov), aspect, 0.1f, 1000.0f);
            gs_proj[1][1] *= -1.0f;
            renderer_.set_gs_camera(gs_view, gs_proj);

            // Transform lights
            // Only load scene-defined lights — no default test light.
            // Users place lights via the Staging UI.
            auto aabb = cloud.bounds();
            std::vector<PointLight> gs_lights;
            for (const auto& pl : scene_data.static_lights) {
                PointLight t = pl;
                t.position_and_radius.x = pl.position_and_radius.x + aabb.min.x;
                t.position_and_radius.z = pl.position_and_radius.z + aabb.min.y;
                gs_lights.push_back(t);
            }
            if (!gs_lights.empty()) {
                renderer_.gs_renderer().set_light_mode(2);
                renderer_.gs_renderer().set_point_lights(gs_lights);
            }

            // Emitters
            for (const auto& em : scene_data.gs_particle_emitters) {
                auto config = em.config;
                config.position.x += aabb.min.x;
                config.position.y += aabb.min.y;
                renderer_.add_gs_particle_emitter(config);
            }

            // Animations
            for (const auto& anim : scene_data.gs_animations) {
                auto region = anim.region;
                region.center.x += aabb.min.x;
                region.center.y += aabb.min.y;
                std::optional<Renderer::ReformConfig> reform;
                if (anim.reform) reform = Renderer::ReformConfig{anim.reform->lifetime};
                renderer_.add_gs_animation(anim.effect, region, anim.lifetime, anim.loop, anim.params, reform);
            }

            // VFX instances
            for (const auto& vi : scene_data.vfx_instances) {
                if (vi.trigger != "auto") continue;
                auto preset = load_vfx_preset(vi.vfx_file);
                if (preset.elements.empty()) continue;
                VfxInstance inst;
                auto pos = vi.position;
                pos.x += aabb.min.x;
                pos.y += aabb.min.y;
                inst.init(preset, pos, vi.loop);
                renderer_.add_vfx_instance(std::move(inst));
            }

            // Background
            if (!gs.background_image.empty()) {
                auto bg_tex = resources_.load_texture(gs.background_image);
                renderer_.set_gs_background(bg_tex);
            }

            // Parallax camera
            if (feature_flags_.gs_parallax && gs.parallax) {
                gs_parallax_camera_.configure(
                    gs.camera_position, gs.camera_target,
                    gs.camera_fov, gs_w, gs_h, *gs.parallax);
                set_gs_parallax_active(true);
            } else {
                set_gs_parallax_active(false);
                renderer_.set_gs_skip_chunk_cull(false);
                renderer_.gs_renderer().clear_shadow_box_params();
            }

            std::fprintf(stderr, "[Staging] Loaded scene: %s (%u Gaussians)\n",
                         scene_path.c_str(), cloud.count());
        }
    }
}

void StagingApp::clear_scene() {
    renderer_.clear_gs_particle_emitters();
    renderer_.clear_gs_animations();
    renderer_.clear_vfx_instances();
    scene_.clear_lights();
}

}  // namespace gseurat
