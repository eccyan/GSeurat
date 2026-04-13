#ifdef GSEURAT_DEV_MODE

#include "gseurat/engine/dev_overlay.hpp"
#include "gseurat/engine/app_base.hpp"
#include "gseurat/engine/renderer.hpp"
#include "gseurat/engine/dev_panels.hpp"

#include <imgui_impl_glfw.h>
#include <imgui_impl_vulkan.h>

#include <cstdio>

namespace gseurat {

void DevOverlay::init(GLFWwindow* window, Renderer& renderer) {
    auto device = renderer.context().device();

    // Descriptor pool for ImGui
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

    create_render_pass(renderer);
    create_framebuffers(renderer);

    // ImGui context + style
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;

    ImGui::StyleColorsDark();
    auto& style = ImGui::GetStyle();
    style.WindowRounding = 4.0f;
    style.FrameRounding = 2.0f;
    style.Alpha = 0.95f;

    // Platform/renderer backends
    ImGui_ImplGlfw_InitForVulkan(window, true);

    auto& swapchain = renderer.swapchain();
    ImGui_ImplVulkan_InitInfo init_info{};
    init_info.Instance = renderer.context().instance();
    init_info.PhysicalDevice = renderer.context().physical_device();
    init_info.Device = device;
    init_info.QueueFamily = renderer.context().graphics_queue_family();
    init_info.Queue = renderer.context().graphics_queue();
    init_info.DescriptorPool = imgui_pool_;
    init_info.MinImageCount = 2;
    init_info.ImageCount = swapchain.image_count();
    init_info.RenderPass = imgui_render_pass_;
    ImGui_ImplVulkan_Init(&init_info);

    // Set overlay callback on renderer
    renderer.set_overlay_callback([this, &renderer](VkCommandBuffer cmd, uint32_t image_index) {
        VkRenderPassBeginInfo rp_info{};
        rp_info.sType = VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO;
        rp_info.renderPass = imgui_render_pass_;
        rp_info.framebuffer = imgui_framebuffers_[image_index];
        rp_info.renderArea.extent = renderer.swapchain().extent();
        vkCmdBeginRenderPass(cmd, &rp_info, VK_SUBPASS_CONTENTS_INLINE);
        ImGui_ImplVulkan_RenderDrawData(ImGui::GetDrawData(), cmd);
        vkCmdEndRenderPass(cmd);
    });

    // Register built-in engine panels
    register_panel("Performance", draw_performance_panel);
    register_panel("Render Settings", draw_render_settings_panel);
    register_panel("GS Parameters", draw_gs_params_panel);
    register_panel("Feature Toggles", draw_feature_toggles_panel);
    register_panel("Lighting", draw_lighting_panel);
    register_panel("Camera Info", draw_camera_info_panel);

    std::fprintf(stderr, "[DevOverlay] Initialized (F1 to toggle)\n");
}

void DevOverlay::shutdown(Renderer& renderer) {
    auto device = renderer.context().device();
    vkDeviceWaitIdle(device);

    renderer.set_overlay_callback(nullptr);

    ImGui_ImplVulkan_Shutdown();
    ImGui_ImplGlfw_Shutdown();
    ImGui::DestroyContext();

    for (auto fb : imgui_framebuffers_) {
        vkDestroyFramebuffer(device, fb, nullptr);
    }
    imgui_framebuffers_.clear();

    if (imgui_render_pass_ != VK_NULL_HANDLE) {
        vkDestroyRenderPass(device, imgui_render_pass_, nullptr);
        imgui_render_pass_ = VK_NULL_HANDLE;
    }
    if (imgui_pool_ != VK_NULL_HANDLE) {
        vkDestroyDescriptorPool(device, imgui_pool_, nullptr);
        imgui_pool_ = VK_NULL_HANDLE;
    }
}

void DevOverlay::begin_frame() {
    ImGui_ImplVulkan_NewFrame();
    ImGui_ImplGlfw_NewFrame();
    ImGui::NewFrame();
}

void DevOverlay::end_frame() {
    ImGui::Render();
}

bool DevOverlay::wants_mouse() const {
    return visible_ && ImGui::GetIO().WantCaptureMouse;
}

bool DevOverlay::wants_keyboard() const {
    return visible_ && ImGui::GetIO().WantCaptureKeyboard;
}

void DevOverlay::draw(AppBase& app) {
    if (!visible_) return;
    draw_menu_bar();
    for (auto& panel : panels_) {
        if (panel.visible) {
            panel.draw_fn(app);
        }
    }
}

void DevOverlay::register_panel(const std::string& name, PanelDrawFn fn, bool visible) {
    panels_.push_back({name, std::move(fn), visible});
}

void DevOverlay::draw_menu_bar() {
    if (ImGui::BeginMainMenuBar()) {
        if (ImGui::BeginMenu("View")) {
            for (auto& panel : panels_) {
                ImGui::MenuItem(panel.name.c_str(), nullptr, &panel.visible);
            }
            ImGui::Separator();
            ImGui::MenuItem("Gizmo: Lights", nullptr, &show_gizmo_lights);
            ImGui::MenuItem("Gizmo: Emitters", nullptr, &show_gizmo_emitters);
            ImGui::MenuItem("Gizmo: VFX", nullptr, &show_gizmo_vfx);
            ImGui::MenuItem("Gizmo: Game Objects", nullptr, &show_gizmo_game_objects);
            ImGui::MenuItem("Gizmo: Triggers", nullptr, &show_gizmo_triggers);
            ImGui::Separator();
            if (ImGui::MenuItem("Show All")) {
                for (auto& p : panels_) p.visible = true;
            }
            if (ImGui::MenuItem("Hide All")) {
                for (auto& p : panels_) p.visible = false;
            }
            ImGui::EndMenu();
        }
        ImGui::EndMainMenuBar();
    }
}

void DevOverlay::create_render_pass(Renderer& renderer) {
    auto device = renderer.context().device();
    auto format = renderer.swapchain().image_format();

    VkAttachmentDescription attachment{};
    attachment.format = format;
    attachment.samples = VK_SAMPLE_COUNT_1_BIT;
    attachment.loadOp = VK_ATTACHMENT_LOAD_OP_LOAD;
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

void DevOverlay::create_framebuffers(Renderer& renderer) {
    auto device = renderer.context().device();
    auto& swapchain = renderer.swapchain();

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
}

}  // namespace gseurat

#endif  // GSEURAT_DEV_MODE
