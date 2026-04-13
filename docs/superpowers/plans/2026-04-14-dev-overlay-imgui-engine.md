# DevOverlay: ImGui Engine Promotion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move ImGui developer panels from Staging to engine layer behind `GSEURAT_DEV_MODE` compile flag, with panel registration API for app-specific extensions.

**Architecture:** A `DevOverlay` class in the engine owns ImGui lifecycle and panel dispatch. When `GSEURAT_DEV_MODE=ON`, `gseurat_core` links `imgui_lib` and DevOverlay provides full ImGui functionality. When OFF, all methods are no-op inline stubs. Built-in panels are extracted from `staging_state.cpp` into `dev_panels.cpp`. Apps register custom panels via `register_panel()`.

**Tech Stack:** C++23, Dear ImGui v1.91.8, Vulkan, GLFW, CMake

---

### Task 1: CMake — add GSEURAT_DEV_MODE option and conditional ImGui linking

**Files:**
- Modify: `CMakeLists.txt`

- [ ] **Step 1: Add the option and conditional linking**

In `CMakeLists.txt`, after the existing `target_link_libraries(gseurat_core ...)` block (after line 235), add:

```cmake
# --- Developer overlay (ImGui) -----------------------------------------------

option(GSEURAT_DEV_MODE "Enable ImGui developer overlay" ON)

if(GSEURAT_DEV_MODE)
    target_link_libraries(gseurat_core PUBLIC imgui_lib)
    target_compile_definitions(gseurat_core PUBLIC GSEURAT_DEV_MODE)
endif()
```

- [ ] **Step 2: Remove imgui_lib from staging link**

Change line 265:
```cmake
target_link_libraries(gseurat_staging PRIVATE gseurat_core imgui_lib)
```
to:
```cmake
target_link_libraries(gseurat_staging PRIVATE gseurat_core)
```

Staging now gets ImGui through `gseurat_core` when `GSEURAT_DEV_MODE=ON`.

- [ ] **Step 3: Build and verify**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds (no behavior change yet — staging still has its own ImGui init)

- [ ] **Step 4: Commit**

```bash
git add CMakeLists.txt
git commit -m "build: add GSEURAT_DEV_MODE option, link imgui through gseurat_core"
```

---

### Task 2: DevOverlay class — header with no-op stubs when DEV_MODE is off

**Files:**
- Create: `include/gseurat/engine/dev_overlay.hpp`

- [ ] **Step 1: Create the header**

Create `include/gseurat/engine/dev_overlay.hpp`:

```cpp
#pragma once

#include <string>

#ifdef GSEURAT_DEV_MODE
#include <imgui.h>
#include <vulkan/vulkan.h>
#include <functional>
#include <vector>
#endif

struct GLFWwindow;

namespace gseurat {

class AppBase;
class Renderer;

#ifdef GSEURAT_DEV_MODE

using PanelDrawFn = std::function<void(AppBase&)>;

class DevOverlay {
public:
    void init(GLFWwindow* window, Renderer& renderer);
    void shutdown(Renderer& renderer);

    void begin_frame();
    void end_frame();

    void toggle() { visible_ = !visible_; }
    bool visible() const { return visible_; }
    bool wants_mouse() const;
    bool wants_keyboard() const;

    void draw(AppBase& app);

    void register_panel(const std::string& name, PanelDrawFn fn, bool visible = true);

private:
    struct PanelEntry {
        std::string name;
        PanelDrawFn draw_fn;
        bool visible = true;
    };

    bool visible_ = false;
    std::vector<PanelEntry> panels_;

    VkDescriptorPool imgui_pool_ = VK_NULL_HANDLE;
    VkRenderPass imgui_render_pass_ = VK_NULL_HANDLE;
    std::vector<VkFramebuffer> imgui_framebuffers_;

    void create_render_pass(Renderer& renderer);
    void create_framebuffers(Renderer& renderer);
    void draw_menu_bar();
};

#else  // !GSEURAT_DEV_MODE — no-op stubs

using PanelDrawFn = int;  // placeholder type, never used

class DevOverlay {
public:
    void init(GLFWwindow*, Renderer&) {}
    void shutdown(Renderer&) {}
    void begin_frame() {}
    void end_frame() {}
    void toggle() {}
    bool visible() const { return false; }
    bool wants_mouse() const { return false; }
    bool wants_keyboard() const { return false; }
    void draw(AppBase&) {}
    void register_panel(const std::string&, PanelDrawFn, bool = true) {}
};

#endif

}  // namespace gseurat
```

- [ ] **Step 2: Build and verify**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds (header-only, not included anywhere yet)

- [ ] **Step 3: Commit**

```bash
git add include/gseurat/engine/dev_overlay.hpp
git commit -m "feat(engine): add DevOverlay header with GSEURAT_DEV_MODE guards"
```

---

### Task 3: DevOverlay implementation — ImGui lifecycle

**Files:**
- Create: `src/engine/dev_overlay.cpp`
- Modify: `CMakeLists.txt`

- [ ] **Step 1: Create dev_overlay.cpp**

Create `src/engine/dev_overlay.cpp`:

```cpp
#ifdef GSEURAT_DEV_MODE

#include "gseurat/engine/dev_overlay.hpp"
#include "gseurat/engine/app_base.hpp"
#include "gseurat/engine/renderer.hpp"

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
```

- [ ] **Step 2: Add to CMakeLists.txt (conditionally)**

After the `GSEURAT_DEV_MODE` block added in Task 1, add:

```cmake
if(GSEURAT_DEV_MODE)
    target_sources(gseurat_core PRIVATE
        src/engine/dev_overlay.cpp
    )
endif()
```

- [ ] **Step 3: Build and verify**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/engine/dev_overlay.cpp CMakeLists.txt
git commit -m "feat(engine): implement DevOverlay ImGui lifecycle"
```

---

### Task 4: Built-in engine panels

**Files:**
- Create: `src/engine/dev_panels.cpp`
- Create: `include/gseurat/engine/dev_panels.hpp`
- Modify: `src/engine/dev_overlay.cpp`
- Modify: `CMakeLists.txt`

- [ ] **Step 1: Create dev_panels.hpp**

Create `include/gseurat/engine/dev_panels.hpp`:

```cpp
#pragma once

#ifdef GSEURAT_DEV_MODE

namespace gseurat {

class AppBase;

// Built-in engine panels (registered by DevOverlay::init)
void draw_performance_panel(AppBase& app);
void draw_render_settings_panel(AppBase& app);
void draw_gs_params_panel(AppBase& app);
void draw_feature_toggles_panel(AppBase& app);
void draw_lighting_panel(AppBase& app);
void draw_camera_info_panel(AppBase& app);

}  // namespace gseurat

#endif  // GSEURAT_DEV_MODE
```

- [ ] **Step 2: Create dev_panels.cpp**

Create `src/engine/dev_panels.cpp`. This extracts panel code from `staging_state.cpp` draw methods, replacing `this->` staging state access with `app.` engine accessors:

```cpp
#ifdef GSEURAT_DEV_MODE

#include "gseurat/engine/dev_panels.hpp"
#include "gseurat/engine/app_base.hpp"
#include "gseurat/engine/renderer.hpp"
#include "gseurat/engine/gs_renderer.hpp"

#include <imgui.h>
#include <filesystem>

namespace gseurat {

void draw_performance_panel(AppBase& app) {
    ImGui::SetNextWindowPos(ImVec2(10, 160), ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowSize(ImVec2(250, 200), ImGuiCond_FirstUseEver);
    if (!ImGui::Begin("Performance")) {
        ImGui::End();
        return;
    }

    float fps_val = app.debug_metrics().fps;
    ImGui::Text("FPS: %.1f (%.2f ms)", fps_val, fps_val > 0.0f ? 1000.0f / fps_val : 0.0f);

    const auto& dm = app.debug_metrics();
    float ordered[300];
    for (int i = 0; i < 300; i++) {
        ordered[i] = dm.frame_times[(dm.frame_time_idx + i) % 300];
    }
    ImGui::PlotLines("Frame Time", ordered, 300, 0, nullptr, 0.0f, 50.0f, ImVec2(0, 80));

    if (app.renderer().has_gs_cloud()) {
        auto& gs = app.renderer().gs_renderer();
        ImGui::Text("Gaussian Count: %u", gs.gaussian_count());
        ImGui::Text("Visible: %u", gs.visible_count());
        ImGui::Text("Max Capacity: %u", gs.max_gaussian_count());
    }

    ImGui::End();
}

void draw_render_settings_panel(AppBase& app) {
    ImGui::SetNextWindowPos(ImVec2(1020, 30), ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowSize(ImVec2(250, 400), ImGuiCond_FirstUseEver);
    if (!ImGui::Begin("Render Settings")) {
        ImGui::End();
        return;
    }

    auto& pp = app.renderer().post_process_params();

    if (ImGui::CollapsingHeader("Bloom", ImGuiTreeNodeFlags_DefaultOpen)) {
        ImGui::SliderFloat("Threshold##bloom", &pp.bloom_threshold, 0.0f, 5.0f, "%.3f", ImGuiSliderFlags_NoInput);
        ImGui::SliderFloat("Soft Knee##bloom", &pp.bloom_soft_knee, 0.0f, 1.0f, "%.3f", ImGuiSliderFlags_NoInput);
        ImGui::SliderFloat("Intensity##bloom", &pp.bloom_intensity, 0.0f, 2.0f, "%.3f", ImGuiSliderFlags_NoInput);
    }
    if (ImGui::CollapsingHeader("Exposure")) {
        ImGui::SliderFloat("Exposure##pp", &pp.exposure, 0.1f, 5.0f, "%.3f", ImGuiSliderFlags_NoInput);
    }
    if (ImGui::CollapsingHeader("Depth of Field")) {
        ImGui::SliderFloat("Focus Distance##dof", &pp.dof_focus_distance, 0.1f, 200.0f, "%.3f", ImGuiSliderFlags_NoInput);
        ImGui::SliderFloat("Focus Range##dof", &pp.dof_focus_range, 0.1f, 50.0f, "%.3f", ImGuiSliderFlags_NoInput);
        ImGui::SliderFloat("Max Blur##dof", &pp.dof_max_blur, 0.0f, 2.0f, "%.3f", ImGuiSliderFlags_NoInput);
    }
    if (ImGui::CollapsingHeader("Vignette")) {
        ImGui::SliderFloat("Radius##vig", &pp.vignette_radius, 0.0f, 1.5f, "%.3f", ImGuiSliderFlags_NoInput);
        ImGui::SliderFloat("Softness##vig", &pp.vignette_softness, 0.0f, 1.0f, "%.3f", ImGuiSliderFlags_NoInput);
    }
    if (ImGui::CollapsingHeader("God Rays")) {
        float gr = app.renderer().god_rays_intensity();
        if (ImGui::SliderFloat("Intensity##godrays", &gr, 0.0f, 3.0f, "%.3f", ImGuiSliderFlags_NoInput)) {
            app.renderer().set_god_rays_intensity(gr);
        }
    }

    ImGui::End();
}

void draw_gs_params_panel(AppBase& app) {
    if (!app.renderer().has_gs_cloud()) return;

    ImGui::SetNextWindowPos(ImVec2(1020, 440), ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowSize(ImVec2(250, 250), ImGuiCond_FirstUseEver);
    if (!ImGui::Begin("GS Parameters")) {
        ImGui::End();
        return;
    }

    auto& gs = app.renderer().gs_renderer();

    float scale = gs.scale_multiplier();
    if (ImGui::SliderFloat("Scale", &scale, 0.1f, 10.0f, "%.3f", ImGuiSliderFlags_NoInput)) {
        gs.set_scale_multiplier(scale);
    }

    int toon = gs.toon_bands();
    if (ImGui::SliderInt("Toon Bands", &toon, 0, 5, "%d", ImGuiSliderFlags_NoInput)) {
        gs.set_toon_bands(toon);
    }

    float pixel_intensity = gs.pixel_art_intensity();
    if (ImGui::SliderFloat("Pixel Art", &pixel_intensity, 0.0f, 1.0f, "%.2f", ImGuiSliderFlags_NoInput)) {
        gs.set_pixel_art_intensity(pixel_intensity);
    }

    ImGui::Separator();

    int budget = static_cast<int>(app.renderer().gs_gaussian_budget());
    if (ImGui::SliderInt("LOD Budget", &budget, 0, 500000, "%d", ImGuiSliderFlags_Logarithmic | ImGuiSliderFlags_NoInput)) {
        app.renderer().set_gs_gaussian_budget(static_cast<uint32_t>(budget));
    }
    ImGui::SameLine();
    ImGui::TextDisabled("(0 = unlimited)");

    if (budget > 0 && app.renderer().has_gs_cloud()) {
        ImGui::Text("Active: %u / %u", gs.gaussian_count(), gs.max_gaussian_count());
    }

    ImGui::End();
}

void draw_feature_toggles_panel(AppBase& app) {
    ImGui::SetNextWindowPos(ImVec2(10, 400), ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowSize(ImVec2(250, 350), ImGuiCond_FirstUseEver);
    if (!ImGui::Begin("Feature Toggles")) {
        ImGui::End();
        return;
    }

    auto& f = app.feature_flags();

    if (ImGui::CollapsingHeader("Post-Process", ImGuiTreeNodeFlags_DefaultOpen)) {
        ImGui::Checkbox("Bloom", &f.bloom);
        ImGui::Checkbox("Depth of Field", &f.depth_of_field);
        ImGui::Checkbox("Vignette", &f.vignette);
        ImGui::Checkbox("Tone Mapping", &f.tone_mapping);
        ImGui::Checkbox("Screen Effects", &f.screen_effects);
    }
    if (ImGui::CollapsingHeader("GS Pipeline")) {
        ImGui::Checkbox("GS Rendering", &f.gs_rendering);
        ImGui::Checkbox("Chunk Culling", &f.gs_chunk_culling);
        ImGui::Checkbox("LOD", &f.gs_lod);
        ImGui::Checkbox("Adaptive Budget", &f.gs_adaptive_budget);
    }
    if (ImGui::CollapsingHeader("Scene")) {
        ImGui::Checkbox("Particles", &f.particles);
        ImGui::Checkbox("Animation", &f.animation);
    }

    ImGui::End();
}

void draw_lighting_panel(AppBase& app) {
    if (!app.renderer().has_gs_cloud()) return;

    ImGui::SetNextWindowPos(ImVec2(270, 30), ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowSize(ImVec2(300, 400), ImGuiCond_FirstUseEver);
    if (!ImGui::Begin("Lighting")) {
        ImGui::End();
        return;
    }

    auto& gs = app.renderer().gs_renderer();

    int light_mode = gs.light_mode();
    const char* light_modes[] = {"Off", "Directional", "Point Lights"};
    if (ImGui::Combo("Light Mode", &light_mode, light_modes, 3)) {
        gs.set_light_mode(light_mode);
    }

    float intensity = gs.light_intensity();
    if (ImGui::SliderFloat("Global Intensity", &intensity, 0.0f, 5.0f, "%.3f", ImGuiSliderFlags_NoInput)) {
        gs.set_light_intensity(intensity);
    }

    ImGui::Separator();

    auto ambient = app.scene().ambient_color();
    float amb[4] = {ambient.r, ambient.g, ambient.b, ambient.a};
    if (ImGui::ColorEdit4("Ambient", amb)) {
        app.scene().set_ambient_color({amb[0], amb[1], amb[2], amb[3]});
    }

    ImGui::Separator();

    auto lights = gs.point_lights();
    bool lights_changed = false;
    ImGui::Text("Point Lights: %zu / 8", lights.size());

    for (size_t i = 0; i < lights.size(); i++) {
        ImGui::PushID(static_cast<int>(i));
        if (ImGui::CollapsingHeader(("Light " + std::to_string(i)).c_str())) {
            float pos[3] = {lights[i].position_and_radius.x,
                            lights[i].position_and_radius.y,
                            lights[i].position_and_radius.z};
            if (ImGui::DragFloat3("Position", pos, 0.5f)) {
                lights[i].position_and_radius.x = pos[0];
                lights[i].position_and_radius.y = pos[1];
                lights[i].position_and_radius.z = pos[2];
                lights_changed = true;
            }
            if (ImGui::DragFloat("Radius", &lights[i].position_and_radius.w, 0.5f, 0.1f, 500.0f)) {
                lights_changed = true;
            }
            float col[3] = {lights[i].color.r, lights[i].color.g, lights[i].color.b};
            if (ImGui::ColorEdit3("Color", col)) {
                lights[i].color.r = col[0];
                lights[i].color.g = col[1];
                lights[i].color.b = col[2];
                lights_changed = true;
            }
            if (ImGui::DragFloat("Intensity##light", &lights[i].color.a, 0.1f, 0.0f, 20.0f)) {
                lights_changed = true;
            }
            if (ImGui::Button("Remove")) {
                lights.erase(lights.begin() + static_cast<ptrdiff_t>(i));
                lights_changed = true;
                ImGui::PopID();
                break;
            }
        }
        ImGui::PopID();
    }

    if (lights.size() < 8 && ImGui::Button("+ Add Light")) {
        PointLight new_light;
        new_light.position_and_radius = glm::vec4(0.0f, 0.0f, 0.0f, 50.0f);
        new_light.color = glm::vec4(1.0f, 1.0f, 1.0f, 5.0f);
        lights.push_back(new_light);
        lights_changed = true;
        if (light_mode == 0) {
            gs.set_light_mode(2);
        }
    }

    if (lights_changed) {
        gs.set_point_lights(lights);
    }

    ImGui::End();
}

void draw_camera_info_panel(AppBase& app) {
    ImGui::SetNextWindowPos(ImVec2(10, 30), ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowSize(ImVec2(250, 120), ImGuiCond_FirstUseEver);
    if (!ImGui::Begin("Camera Info")) {
        ImGui::End();
        return;
    }

    ImGui::Text("FPS: %.1f", app.debug_metrics().fps);
    if (app.renderer().has_gs_cloud()) {
        auto& gs = app.renderer().gs_renderer();
        ImGui::Text("Gaussians: %u / %u", gs.visible_count(), gs.gaussian_count());
    }
    ImGui::Text("Scene: %s",
        std::filesystem::path(app.scene_objects().current_scene_path).filename().string().c_str());

    ImGui::End();
}

}  // namespace gseurat

#endif  // GSEURAT_DEV_MODE
```

- [ ] **Step 3: Register built-in panels in DevOverlay::init()**

In `src/engine/dev_overlay.cpp`, add include and registration at the end of `init()`:

After the existing includes, add:
```cpp
#include "gseurat/engine/dev_panels.hpp"
```

At the end of `DevOverlay::init()`, before the fprintf, add:
```cpp
    // Register built-in engine panels
    register_panel("Performance", draw_performance_panel);
    register_panel("Render Settings", draw_render_settings_panel);
    register_panel("GS Parameters", draw_gs_params_panel);
    register_panel("Feature Toggles", draw_feature_toggles_panel);
    register_panel("Lighting", draw_lighting_panel);
    register_panel("Camera Info", draw_camera_info_panel);
```

- [ ] **Step 4: Add dev_panels.cpp to CMakeLists.txt**

In the `GSEURAT_DEV_MODE` target_sources block, add:
```cmake
if(GSEURAT_DEV_MODE)
    target_sources(gseurat_core PRIVATE
        src/engine/dev_overlay.cpp
        src/engine/dev_panels.cpp
    )
endif()
```

- [ ] **Step 5: Build and verify**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add include/gseurat/engine/dev_panels.hpp src/engine/dev_panels.cpp \
        src/engine/dev_overlay.cpp CMakeLists.txt
git commit -m "feat(engine): add built-in dev panels (performance, render, lighting, etc.)"
```

---

### Task 5: AppBase integration — main_loop, F1 toggle, input gating

**Files:**
- Modify: `include/gseurat/engine/app_base.hpp`
- Modify: `src/engine/app_base.cpp`

- [ ] **Step 1: Add DevOverlay member and accessors to AppBase**

In `include/gseurat/engine/app_base.hpp`, add include:
```cpp
#include "gseurat/engine/dev_overlay.hpp"
```

Add public accessors (after `debug_metrics()` accessor):
```cpp
    DevOverlay& dev_overlay() { return dev_overlay_; }
    const DevOverlay& dev_overlay() const { return dev_overlay_; }
```

Add protected member (after `debug_metrics_`):
```cpp
    DevOverlay dev_overlay_;
```

- [ ] **Step 2: Wire DevOverlay into main_loop()**

In `src/engine/app_base.cpp`, in `main_loop()`:

**Before the while loop** (after `control_server_.start()`), add:
```cpp
    dev_overlay_.init(window_, renderer_);
```

**Inside the loop, after `input_.update()` and before `state_stack_.update()`**, add:
```cpp
        // F1 → toggle developer overlay
        if (input_.was_key_pressed(GLFW_KEY_F1)) {
            dev_overlay_.toggle();
        }
        dev_overlay_.begin_frame();
```

**After `state_stack_.build_draw_lists(*this)` and before the render block**, add:
```cpp
        if (dev_overlay_.visible()) {
            dev_overlay_.draw(*this);
        }
        dev_overlay_.end_frame();
```

**In `cleanup()`, before existing cleanup code**, add:
```cpp
    dev_overlay_.shutdown(renderer_);
```

- [ ] **Step 3: Add GLFW include for F1 key**

In `src/engine/app_base.cpp`, ensure GLFW is included (it already is via `#define GLFW_INCLUDE_VULKAN` + `#include <GLFW/glfw3.h>`). Verify `GLFW_KEY_F1` is available — it is, defined in glfw3.h.

- [ ] **Step 4: Build and verify**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds. At this point F1 works in the demo — but staging still has its own ImGui init which will conflict. We'll fix that in the next task.

- [ ] **Step 5: Commit**

```bash
git add include/gseurat/engine/app_base.hpp src/engine/app_base.cpp
git commit -m "feat(engine): integrate DevOverlay into AppBase main_loop with F1 toggle"
```

---

### Task 6: Staging simplification — remove ImGui lifecycle, use DevOverlay

**Files:**
- Modify: `include/gseurat/staging/staging_app.hpp`
- Modify: `src/staging/staging_app.cpp`
- Modify: `include/gseurat/staging/staging_state.hpp`
- Modify: `src/staging/staging_state.cpp`

- [ ] **Step 1: Remove ImGui lifecycle from StagingApp header**

In `include/gseurat/staging/staging_app.hpp`:

Remove the `<vulkan/vulkan.h>` include (no longer needed here).

Remove the private section:
```cpp
    void init_imgui();
    void shutdown_imgui();
    void create_imgui_render_pass();
    // ImGui Vulkan resources
    VkDescriptorPool imgui_pool_ = VK_NULL_HANDLE;
    VkRenderPass imgui_render_pass_ = VK_NULL_HANDLE;
    std::vector<VkFramebuffer> imgui_framebuffers_;
```

Remove the `main_loop()` and `cleanup()` overrides — StagingApp will use AppBase's versions. Keep `init_game_content()`, `init_scene()`, `clear_scene()`.

The remaining header should look like:
```cpp
#pragma once

#include "gseurat/engine/app_base.hpp"
#include <string>

namespace gseurat {

class StagingApp : public AppBase {
public:
    void parse_args(int argc, char* argv[]);

protected:
    void init_game_content() override;
    void init_scene(const std::string& scene_path) override;
    void clear_scene() override;

private:
    std::string scene_path_;
};

}  // namespace gseurat
```

- [ ] **Step 2: Remove main_loop() and cleanup() from staging_app.cpp**

In `src/staging/staging_app.cpp`:

Remove `StagingApp::main_loop()` entirely (lines 62-148).
Remove `StagingApp::cleanup()` entirely (lines 150-167).
Remove `StagingApp::init_imgui()` entirely (lines 169-243).
Remove `StagingApp::shutdown_imgui()` entirely.
Remove `StagingApp::create_imgui_render_pass()` entirely (lines 245-286).
Remove ImGui includes (`imgui.h`, `imgui_impl_glfw.h`, `imgui_impl_vulkan.h`).

The `run()` method needs adjustment — it currently pushes state then calls `main_loop()`. Since `main_loop()` is no longer overridden, we need to push the state before main_loop runs. Use `set_start_state()`:

```cpp
void StagingApp::run() {
    command_dispatcher_.register_default_commands();
    init_game_object_system();
    init_game_content();

    scene_objects_.current_scene_path = scene_path_;
    set_start_state(std::make_unique<StagingState>());

    main_loop();
    cleanup();
}
```

Wait — check if StagingApp has a `run()` override. Let me check... Looking at the header, it doesn't override `run()`. But the current `main_loop()` pushes the state. We need to push state before the base `main_loop()` runs.

The simplest: override `run()` in StagingApp:
```cpp
void StagingApp::run() {
    command_dispatcher_.register_default_commands();
    init_game_object_system();
    init_game_content();

    scene_objects_.current_scene_path = scene_path_;
    set_start_state(std::make_unique<StagingState>());

    main_loop();
    cleanup();
}
```

Add `void run() override;` to the header.

- [ ] **Step 3: Remove promoted panels from StagingState**

In `src/staging/staging_state.cpp`:

Remove these methods entirely:
- `draw_viewport_info()`
- `draw_render_settings()`
- `draw_gs_params()`
- `draw_feature_toggles()`
- `draw_lighting()`
- `draw_performance()`

These are now in `dev_panels.cpp`.

Replace `draw_imgui()` with registration of staging-specific panels. In `StagingState::on_enter()`, add:

```cpp
    // Register staging-specific panels
    app.dev_overlay().register_panel("Scene", [this](AppBase& a) { draw_scene_panel(a); });
    app.dev_overlay().register_panel("Character", [this](AppBase& a) { draw_character_panel(a); });
    app.dev_overlay().register_panel("Camera", [this](AppBase& a) { draw_camera_panel(a); });

    // Auto-show dev overlay in staging
    if (!app.dev_overlay().visible()) {
        app.dev_overlay().toggle();
    }
```

Remove `draw_imgui()` entirely — the DevOverlay handles panel dispatch now.

In `StagingState::update()`, remove the `draw_imgui(app)` call and the `hide_ui_` / Tab key toggle (DevOverlay uses F1 instead).

Keep: `draw_gizmos()`, `draw_character_panel()`, `draw_camera_panel()` (now `draw_scene_panel()` which combines scene load/reload).

- [ ] **Step 4: Update StagingState header**

In `include/gseurat/staging/staging_state.hpp`:

Remove panel visibility booleans:
```cpp
    bool show_viewport_info_ = true;
    bool show_render_settings_ = true;
    bool show_gs_params_ = true;
    bool show_feature_toggles_ = true;
    bool show_lighting_ = true;
    bool show_camera_ = true;
    bool show_performance_ = true;
```

Remove gizmo visibility booleans:
```cpp
    bool show_gizmo_lights_ = true;
    bool show_gizmo_emitters_ = true;
    bool show_gizmo_vfx_ = true;
    bool show_gizmo_game_objects_ = true;
    bool show_gizmo_camera_zones_ = true;
    bool show_gizmo_portals_ = true;
    bool show_gizmo_world_ = true;
```

Remove `hide_ui_` boolean.

Remove method declarations for promoted panels:
```cpp
    void draw_imgui(AppBase& app);
    void draw_viewport_info(AppBase& app);
    void draw_render_settings(AppBase& app);
    void draw_gs_params(AppBase& app);
    void draw_feature_toggles(AppBase& app);
    void draw_lighting(AppBase& app);
    void draw_performance(AppBase& app);
```

Add `draw_scene_panel` declaration:
```cpp
    void draw_scene_panel(AppBase& app);
```

- [ ] **Step 5: Refactor draw_gizmos to work without staging visibility booleans**

The staging `draw_gizmos()` method references `show_gizmo_lights_` etc. These need to move somewhere accessible. For now, simplify: always draw all gizmo types when the gizmo panel is visible. Or keep local booleans in `draw_gizmos()` as static variables controlled by ImGui checkboxes within the gizmo section of the draw_gizmos function itself.

The simplest approach: make `draw_gizmos()` self-contained with its own static visibility toggles:

```cpp
void StagingState::draw_gizmos(AppBase& app) {
    if (!app.renderer().has_gs_cloud()) return;

    static bool show_lights = true;
    static bool show_emitters = true;
    static bool show_vfx = true;
    static bool show_game_objects = true;
    // ... (keep existing gizmo rendering code, replace member bools with statics)
}
```

- [ ] **Step 6: Update StagingState::update() — remove ImGui direct calls**

In `StagingState::update()`, remove:
- `if (!hide_ui_) draw_imgui(app);` call
- Tab key toggle for `hide_ui_`
- Direct `ImGui::GetIO().WantCaptureMouse` / `WantCaptureKeyboard` checks — replace with `app.dev_overlay_wants_mouse()` / `app.dev_overlay_wants_keyboard()` (but wait, these don't exist yet on AppBase — they're `dev_overlay().wants_mouse()`)

Replace ImGui input checks:
```cpp
// Old:
if (!ImGui::GetIO().WantCaptureMouse) { ... mouse handling ... }
// New:
if (!app.dev_overlay().wants_mouse()) { ... mouse handling ... }
```

- [ ] **Step 7: Build and verify**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 8: Commit**

```bash
git add include/gseurat/staging/staging_app.hpp src/staging/staging_app.cpp \
        include/gseurat/staging/staging_state.hpp src/staging/staging_state.cpp
git commit -m "refactor(staging): remove ImGui lifecycle, use engine DevOverlay"
```

---

### Task 7: Demo input gating

**Files:**
- Modify: `src/demo/island_demo_state.cpp`

- [ ] **Step 1: Gate mouse and keyboard input when dev overlay is active**

In `src/demo/island_demo_state.cpp`, in `update()`:

Find the mouse drag handling block (around line 604-628) and wrap it:
```cpp
    if (!app.dev_overlay().wants_mouse()) {
        // existing mouse drag + scroll code
    }
```

Find the keyboard handling (WASD movement in `update_player`, key toggles) and gate them:
The key toggles (P, N, G, J, Tab, Space, Escape) should check `!app.dev_overlay().wants_keyboard()`:
```cpp
    if (!app.dev_overlay().wants_keyboard()) {
        // Tab, P, N, G, J, Space key handling
    }
```

Note: `update_player()` handles WASD via `app.input().is_key_down()`. Gate the call:
```cpp
    if (!app.dev_overlay().wants_keyboard()) {
        update_player(app, dt);
    }
```

- [ ] **Step 2: Build and verify**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/demo/island_demo_state.cpp
git commit -m "feat(demo): gate input when dev overlay is active"
```

---

### Task 8: Build verification — both DEV_MODE ON and OFF

**Files:**
- No changes — verification only

- [ ] **Step 1: Build with GSEURAT_DEV_MODE=ON (default)**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds

Run: `cmake --build --preset macos-release 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 2: Build with GSEURAT_DEV_MODE=OFF**

Run: `cmake -B build/macos-no-dev -DCMAKE_BUILD_TYPE=Debug -DGSEURAT_DEV_MODE=OFF -G Ninja && cmake --build build/macos-no-dev 2>&1 | tail -5`
Expected: Build succeeds, no ImGui symbols

- [ ] **Step 3: Verify no demo/ includes in engine**

Run: `grep -r 'demo/' src/engine/ include/gseurat/engine/ --include='*.hpp' --include='*.cpp' | grep -v '//'`
Expected: No matches

- [ ] **Step 4: Verify no staging ImGui lifecycle remains**

Run: `grep -r 'ImGui_Impl\|imgui_pool_\|imgui_render_pass_\|imgui_framebuffers_' src/staging/ include/gseurat/staging/ --include='*.hpp' --include='*.cpp'`
Expected: No matches

- [ ] **Step 5: Commit any cleanup**

```bash
git add -A && git commit -m "chore: cleanup after DevOverlay promotion"
```
(Only if there are changes.)
