# DevOverlay: ImGui Developer Mode in Engine

**Date:** 2026-04-14
**Status:** Draft

## Problem

ImGui dev panels (performance, render settings, feature toggles, lighting, gizmos, camera) are locked to the Staging app. Developers debugging the demo must switch to Staging or rely on the limited UIContext HUD. Third-party developers building on GSeurat have no built-in dev tools.

## Goal

Make ImGui-based developer panels an engine feature, available in any app via F1 toggle. Ship-ready builds exclude ImGui entirely via compile flag.

---

## Compile Flag

```cmake
option(GSEURAT_DEV_MODE "Enable ImGui developer overlay" ON)
```

When ON:
- `gseurat_core` links `imgui_lib`
- `target_compile_definitions(gseurat_core PUBLIC GSEURAT_DEV_MODE)`
- All apps linking `gseurat_core` get ImGui and the DevOverlay

When OFF:
- `gseurat_core` does not link `imgui_lib`
- `DevOverlay` compiles as no-op inline stubs
- Zero overhead, no ImGui binary footprint

---

## DevOverlay Class

New file: `include/gseurat/engine/dev_overlay.hpp`

```cpp
#pragma once

#include <functional>
#include <string>
#include <vector>

#ifdef GSEURAT_DEV_MODE
#include <imgui.h>
#include <vulkan/vulkan.h>
#endif

struct GLFWwindow;

namespace gseurat {

class AppBase;
class Renderer;

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

    // Draw menu bar + all visible panels
    void draw(AppBase& app);

    // Panel registration — apps add custom panels
    void register_panel(const std::string& name, PanelDrawFn fn, bool visible = true);

private:
    bool visible_ = false;

#ifdef GSEURAT_DEV_MODE
    struct PanelEntry {
        std::string name;
        PanelDrawFn draw_fn;
        bool visible = true;
    };
    std::vector<PanelEntry> panels_;

    VkDescriptorPool imgui_pool_ = VK_NULL_HANDLE;
    VkRenderPass imgui_render_pass_ = VK_NULL_HANDLE;
    std::vector<VkFramebuffer> imgui_framebuffers_;

    void create_render_pass(Renderer& renderer);
    void create_framebuffers(Renderer& renderer);
    void draw_menu_bar(AppBase& app);
#endif
};

}  // namespace gseurat
```

When `GSEURAT_DEV_MODE` is off, all methods are empty inlines (defined in the header or a trivial .cpp). The `#ifdef` boundary is entirely within this class — no other engine code needs `#ifdef GSEURAT_DEV_MODE`.

---

## Implementation: `src/engine/dev_overlay.cpp`

### init()

Moves ImGui lifecycle code from `StagingApp::init_imgui()`:
1. Create descriptor pool (100 combined image samplers)
2. Create render pass (load existing content, store, PRESENT_SRC layout)
3. Create framebuffers per swapchain image
4. `ImGui::CreateContext()`, style setup
5. `ImGui_ImplGlfw_InitForVulkan()`, `ImGui_ImplVulkan_Init()`
6. Set overlay callback on renderer (same pattern as staging)
7. Register built-in engine panels (see below)

### shutdown()

1. `vkDeviceWaitIdle()`
2. `ImGui_ImplVulkan_Shutdown()`, `ImGui_ImplGlfw_Shutdown()`, `ImGui::DestroyContext()`
3. Destroy framebuffers, render pass, descriptor pool
4. Clear overlay callback on renderer

### begin_frame() / end_frame()

```cpp
void DevOverlay::begin_frame() {
#ifdef GSEURAT_DEV_MODE
    ImGui_ImplVulkan_NewFrame();
    ImGui_ImplGlfw_NewFrame();
    ImGui::NewFrame();
#endif
}

void DevOverlay::end_frame() {
#ifdef GSEURAT_DEV_MODE
    ImGui::Render();
#endif
}
```

### wants_mouse() / wants_keyboard()

```cpp
bool DevOverlay::wants_mouse() const {
#ifdef GSEURAT_DEV_MODE
    return visible_ && ImGui::GetIO().WantCaptureMouse;
#else
    return false;
#endif
}
```

### draw()

When `visible_`:
1. Draw menu bar with View menu listing all registered panels
2. Iterate `panels_` vector, draw each visible panel

### register_panel()

```cpp
void DevOverlay::register_panel(const std::string& name, PanelDrawFn fn, bool visible) {
#ifdef GSEURAT_DEV_MODE
    panels_.push_back({name, std::move(fn), visible});
#endif
}
```

---

## Built-in Engine Panels

Registered in `DevOverlay::init()`. Each is a free function in `src/engine/dev_panels.cpp` with signature `void(AppBase&)`:

| Panel | Source | Description |
|-------|--------|-------------|
| Performance | `draw_performance_panel` | FPS, frame time graph (from DebugMetrics), Gaussian counts |
| Render Settings | `draw_render_settings_panel` | Output resolution, scale multiplier |
| GS Parameters | `draw_gs_params_panel` | Sort interval, render interval, near/far planes |
| Feature Toggles | `draw_feature_toggles_panel` | All FeatureFlags as checkboxes |
| Lighting | `draw_lighting_panel` | Light mode, intensity, toon bands, point light editor |
| Post-Process | `draw_post_process_panel` | Exposure, bloom, fog, DoF, vignette, chromatic aberration |
| Camera | `draw_camera_panel` | Orbit params (read-only from demo, editable in staging) |

The gizmo toggles from staging's View menu also move here — they control `show_gizmo_*` booleans that the gizmo drawing code (already in demo via `draw_gizmos()` and staging via `draw_gizmos()`) reads.

Note: Gizmo visibility state needs to be accessible from both the overlay and the app's gizmo rendering. Options: store on DevOverlay and expose via accessor, or store on AppBase. Since gizmos are engine-level (`debug_draw.hpp`), storing gizmo visibility on DevOverlay is cleanest.

---

## New File: `src/engine/dev_panels.cpp`

Contains the 7 panel draw functions. These are extracted from `staging_state.cpp`'s `draw_*` methods — same ImGui code, but taking `AppBase&` instead of accessing staging state members.

The `draw_performance_panel` uses `app.debug_metrics()` (from our earlier promotion). All panels access engine state through `AppBase`'s public accessors.

---

## AppBase Integration

### Header changes (`app_base.hpp`)

```cpp
#include "gseurat/engine/dev_overlay.hpp"

// In public:
DevOverlay& dev_overlay() { return dev_overlay_; }

// In protected:
DevOverlay dev_overlay_;
```

### main_loop() changes (`app_base.cpp`)

Before loop:
```cpp
dev_overlay_.init(window_, renderer_);
```

In loop, before `state_stack_.update()`:
```cpp
if (input_.was_key_pressed(GLFW_KEY_F1)) {
    dev_overlay_.toggle();
}
dev_overlay_.begin_frame();
```

After `state_stack_.build_draw_lists()`:
```cpp
if (dev_overlay_.visible()) {
    dev_overlay_.draw(*this);
}
dev_overlay_.end_frame();
```

In cleanup:
```cpp
dev_overlay_.shutdown(renderer_);
```

### Input gating

Add to `AppBase`:
```cpp
bool dev_overlay_wants_mouse() const { return dev_overlay_.wants_mouse(); }
bool dev_overlay_wants_keyboard() const { return dev_overlay_.wants_keyboard(); }
```

Demo's `update()` and staging's `update()` check these before processing mouse/keyboard input. This replaces staging's direct `ImGui::GetIO().WantCaptureMouse` checks.

---

## Staging Simplification

### Remove from StagingApp
- `init_imgui()` method and all ImGui lifecycle code
- `imgui_pool_`, `imgui_render_pass_`, `imgui_framebuffers_` members
- `create_imgui_render_pass()` method
- Overlay callback setup
- `ImGui_ImplVulkan_NewFrame()` / `ImGui_ImplGlfw_NewFrame()` / `ImGui::NewFrame()` / `ImGui::Render()` calls in main_loop
- `main_loop()` override — StagingApp should use AppBase's `main_loop()` which now handles ImGui frame begin/end. If StagingApp's main_loop has staging-specific logic beyond ImGui, move that to `StagingState::update()` or a virtual hook.

### Remove from StagingState
- `draw_viewport_info()`, `draw_render_settings()`, `draw_gs_params()`, `draw_feature_toggles()`, `draw_lighting()`, `draw_camera_panel()`, `draw_performance()` — all moved to `dev_panels.cpp`
- `draw_imgui()` method — replaced by DevOverlay
- Panel visibility booleans (`show_viewport_info_`, `show_render_settings_`, etc.) — managed by DevOverlay
- Gizmo visibility booleans (`show_gizmo_lights_`, etc.) — managed by DevOverlay
- FPS tracking members — already removed (uses DebugMetrics)

### Keep in StagingState
- `draw_gizmos()` — staging's ImGui-based gizmo rendering (uses `ImGui::GetForegroundDrawList()`). This stays because it renders differently than the demo's UIContext-based gizmos. Staging registers it as a custom panel.
- `draw_character_panel()` — staging-specific character preview. Registered as custom panel.
- Scene management (load, reload, scene file list) — registered as custom panel or kept in staging's own ImGui code.
- Camera review mode
- Bridge auto-sync

### StagingState registers custom panels in on_enter()
```cpp
app.dev_overlay().register_panel("Scene", [this](AppBase& app) { draw_scene_panel(app); });
app.dev_overlay().register_panel("Character", [this](AppBase& app) { draw_character_panel(app); });
```

---

## CMakeLists.txt Changes

### Add option
```cmake
option(GSEURAT_DEV_MODE "Enable ImGui developer overlay" ON)
```

### Conditional ImGui linking for gseurat_core
```cmake
if(GSEURAT_DEV_MODE)
    target_link_libraries(gseurat_core PUBLIC imgui_lib)
    target_compile_definitions(gseurat_core PUBLIC GSEURAT_DEV_MODE)
endif()
```

### New source files
Add to `gseurat_core` sources (conditionally):
```cmake
if(GSEURAT_DEV_MODE)
    target_sources(gseurat_core PRIVATE
        src/engine/dev_overlay.cpp
        src/engine/dev_panels.cpp
    )
endif()
```

### Staging changes
Remove `imgui_lib` from `gseurat_staging` link — it gets ImGui through `gseurat_core` when dev mode is on.

---

## File Summary

### New Files
| File | Purpose |
|------|---------|
| `include/gseurat/engine/dev_overlay.hpp` | DevOverlay class with panel registration |
| `src/engine/dev_overlay.cpp` | ImGui lifecycle, menu bar, panel dispatch |
| `src/engine/dev_panels.cpp` | 7 built-in engine panel draw functions |

### Modified Files
| File | Changes |
|------|---------|
| `CMakeLists.txt` | Add `GSEURAT_DEV_MODE` option, conditional ImGui linking |
| `include/gseurat/engine/app_base.hpp` | Add `DevOverlay` member + accessor |
| `src/engine/app_base.cpp` | Init/shutdown/frame calls in main_loop, F1 toggle |
| `src/staging/staging_app.cpp` | Remove ImGui lifecycle code |
| `include/gseurat/staging/staging_app.hpp` | Remove ImGui Vulkan resource members |
| `src/staging/staging_state.cpp` | Remove 7 panel methods, register custom panels |
| `include/gseurat/staging/staging_state.hpp` | Remove panel/gizmo visibility booleans |
| `src/demo/island_demo_state.cpp` | Add input gating for dev overlay |

---

## Testing

1. **Build with `GSEURAT_DEV_MODE=ON`** — debug and release succeed
2. **Build with `GSEURAT_DEV_MODE=OFF`** — debug and release succeed, no ImGui symbols
3. **Demo F1** — toggles dev overlay with all 7 panels
4. **Staging F1** — same 7 panels + Scene + Character custom panels
5. **Input gating** — mouse clicks on ImGui panels don't move player/camera
6. **Panel registration** — custom panels appear in View menu
7. **Gizmo toggles** — ImGui View menu toggles affect gizmo rendering
8. **No regressions** — player movement, NPC patrol, triggers, camera all unchanged
