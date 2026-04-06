# Hybrid Background Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate transparent holes and dark void behind culled Gaussians by compositing the GS output over a procedural ground plane + sky gradient background, computed in the existing post-process compute shader at zero geometry cost.

**Architecture:** Extend the GS post-process pipeline with two new colors (ground, sky) and a horizon line. The CPU computes the horizon Y from the camera each frame and passes it via the existing UBO. The shader generates a vertical gradient (sky above horizon, ground below) and composites the premultiplied-alpha GS output over it. No new render passes, buffers, or draw calls.

**Tech Stack:** GLSL compute (gs_post_process.comp), C++ (GsRenderer, SceneLoader), JSON schema, ctest

---

### Task 1: Extend Scene JSON Schema with Ground/Sky Colors

**Files:**
- Modify: `schemas/scene.schema.json:340-370` (gaussian_splat definition)
- Modify: `include/gseurat/engine/scene_loader.hpp:64-74` (GaussianSplatData struct)
- Modify: `src/engine/scene_loader.cpp:76-100` (parse gaussian_splat)
- Modify: `src/engine/scene_loader.cpp:789-816` (serialize gaussian_splat)
- Test: `tests/test_scene_loading.cpp`

- [ ] **Step 1: Write the failing test**

Add a new test to `tests/test_scene_loading.cpp` that parses a scene JSON containing `ground_color` and `sky_color`, then checks the parsed values.

```cpp
// At the end of the file, before main():

static void test_background_colors() {
    std::printf("\n== test_background_colors ==\n");

    const char* json_str = R"({
        "version": 2,
        "gaussian_splat": {
            "ply_file": "test.ply",
            "ground_color": [0.4, 0.3, 0.2],
            "sky_color": [0.5, 0.6, 0.8]
        }
    })";

    auto j = nlohmann::json::parse(json_str);
    auto scene = gseurat::SceneLoader::from_json(j);

    check(scene.gaussian_splat.has_value(), "gaussian_splat parsed");
    const auto& gs = *scene.gaussian_splat;
    check(approx(gs.ground_color.r, 0.4f), "ground_color.r");
    check(approx(gs.ground_color.g, 0.3f), "ground_color.g");
    check(approx(gs.ground_color.b, 0.2f), "ground_color.b");
    check(approx(gs.sky_color.r, 0.5f), "sky_color.r");
    check(approx(gs.sky_color.g, 0.6f), "sky_color.g");
    check(approx(gs.sky_color.b, 0.8f), "sky_color.b");

    // Round-trip serialization
    auto out_j = gseurat::SceneLoader::to_json(scene);
    check(out_j["gaussian_splat"].contains("ground_color"), "ground_color serialized");
    check(out_j["gaussian_splat"].contains("sky_color"), "sky_color serialized");

    // Defaults: when omitted, colors should be zero (disabled)
    const char* minimal_json = R"({
        "version": 2,
        "gaussian_splat": { "ply_file": "test.ply" }
    })";
    auto minimal = gseurat::SceneLoader::from_json(nlohmann::json::parse(minimal_json));
    const auto& gs2 = *minimal.gaussian_splat;
    check(approx(gs2.ground_color.r, 0.0f) && approx(gs2.ground_color.g, 0.0f),
          "default ground_color is black (disabled)");
    check(approx(gs2.sky_color.r, 0.0f) && approx(gs2.sky_color.g, 0.0f),
          "default sky_color is black (disabled)");
}
```

And add `test_background_colors();` to the `main()` function.

- [ ] **Step 2: Run test to verify it fails**

Run: `cmake --build --preset macos-debug --target test_scene_loading && ctest --preset macos-debug -R test_scene_loading -V`
Expected: Compilation error — `GaussianSplatData` has no member `ground_color`/`sky_color`

- [ ] **Step 3: Add ground_color and sky_color to GaussianSplatData**

In `include/gseurat/engine/scene_loader.hpp`, add to `GaussianSplatData`:

```cpp
struct GaussianSplatData {
    std::string ply_file;
    glm::vec3 camera_position{0.0f, 5.0f, 10.0f};
    glm::vec3 camera_target{0.0f, 0.0f, 0.0f};
    float camera_fov = 45.0f;
    uint32_t render_width = 320;
    uint32_t render_height = 240;
    float scale_multiplier = 1.0f;
    std::optional<GsParallaxConfig> parallax;
    std::string background_image;
    glm::vec3 ground_color{0.0f};  // Hybrid BG: solid ground beneath Gaussians (0 = disabled)
    glm::vec3 sky_color{0.0f};     // Hybrid BG: sky gradient above horizon (0 = disabled)
};
```

- [ ] **Step 4: Parse ground_color and sky_color in SceneLoader::from_json**

In `src/engine/scene_loader.cpp`, inside the `if (j.contains("gaussian_splat"))` block (around line 88, after `background_image`):

```cpp
        if (gs.contains("ground_color")) {
            gsd.ground_color = parse_vec3(gs["ground_color"]);
        }
        if (gs.contains("sky_color")) {
            gsd.sky_color = parse_vec3(gs["sky_color"]);
        }
```

- [ ] **Step 5: Serialize ground_color and sky_color in SceneLoader::to_json**

In `src/engine/scene_loader.cpp`, inside the `if (data.gaussian_splat)` serialization block (around line 804, after `background_image`):

```cpp
        if (gs.ground_color != glm::vec3(0.0f)) {
            gs_j["ground_color"] = vec3_json(gs.ground_color);
        }
        if (gs.sky_color != glm::vec3(0.0f)) {
            gs_j["sky_color"] = vec3_json(gs.sky_color);
        }
```

- [ ] **Step 6: Update JSON schema**

In `schemas/scene.schema.json`, inside the `gaussian_splat` properties (after `background_image`), add:

```json
        "ground_color": {
          "type": "array",
          "items": { "type": "number" },
          "minItems": 3,
          "maxItems": 3,
          "description": "RGB ground plane color beneath Gaussians (0,0,0 = disabled)"
        },
        "sky_color": {
          "type": "array",
          "items": { "type": "number" },
          "minItems": 3,
          "maxItems": 3,
          "description": "RGB sky gradient color above horizon (0,0,0 = disabled)"
        },
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cmake --build --preset macos-debug --target test_scene_loading && ctest --preset macos-debug -R test_scene_loading -V`
Expected: All tests PASS including `test_background_colors`

- [ ] **Step 8: Commit**

```bash
git add schemas/scene.schema.json include/gseurat/engine/scene_loader.hpp src/engine/scene_loader.cpp tests/test_scene_loading.cpp
git commit -m "feat: add ground_color and sky_color to gaussian_splat scene config"
```

---

### Task 2: Extend GS Post-Process UBO with Background Parameters

**Files:**
- Modify: `include/gseurat/engine/gs_renderer.hpp:14-44` (GsPostProcessParams, GsPostProcessUbo)
- Modify: `src/engine/gs_renderer.cpp:1386-1410` (UBO packing)
- Test: `tests/test_gs_post_process.cpp`

- [ ] **Step 1: Write the failing test**

Add a test to `tests/test_gs_post_process.cpp` that validates the new UBO fields. Add near the end (before `main()`):

```cpp
static void test_background_ubo_packing() {
    std::printf("\n== test_background_ubo_packing ==\n");

    // UBO should be 7 × vec4 = 112 bytes (was 5 × vec4 = 80)
    check(sizeof(gseurat::GsPostProcessUbo) == 112,
          "GsPostProcessUbo is 112 bytes (7 x vec4)");

    // Check that background fields pack correctly
    gseurat::GsPostProcessUbo ubo{};
    ubo.ground_sky = glm::vec4(0.4f, 0.3f, 0.2f, 0.5f);  // ground rgb + horizon_y
    ubo.sky_enable = glm::vec4(0.5f, 0.6f, 0.8f, 1.0f);   // sky rgb + enable flag

    // Verify field offsets via pointer arithmetic
    const auto* base = reinterpret_cast<const char*>(&ubo);
    const auto* ground_ptr = reinterpret_cast<const char*>(&ubo.ground_sky);
    const auto* sky_ptr = reinterpret_cast<const char*>(&ubo.sky_enable);

    check(ground_ptr - base == 80, "ground_sky at offset 80 (after 5 existing vec4s)");
    check(sky_ptr - base == 96, "sky_enable at offset 96");

    check(approx(ubo.ground_sky.x, 0.4f), "ground_sky.x = ground_r");
    check(approx(ubo.ground_sky.w, 0.5f), "ground_sky.w = horizon_y");
    check(approx(ubo.sky_enable.z, 0.8f), "sky_enable.z = sky_b");
    check(approx(ubo.sky_enable.w, 1.0f), "sky_enable.w = enable flag");
}
```

And add `test_background_ubo_packing();` to `main()`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cmake --build --preset macos-debug --target test_gs_post_process && ctest --preset macos-debug -R test_gs_post_process -V`
Expected: Compilation error — `GsPostProcessUbo` has no member `ground_sky`/`sky_enable`

- [ ] **Step 3: Add background fields to GsPostProcessParams**

In `include/gseurat/engine/gs_renderer.hpp`, add to `GsPostProcessParams` (after `far_plane`):

```cpp
    // Hybrid background (ground plane + sky gradient)
    glm::vec3 ground_color{0.0f};  // RGB ground color (0 = disabled)
    glm::vec3 sky_color{0.0f};     // RGB sky color (0 = disabled)
    float horizon_y = 0.5f;        // Normalized screen Y of horizon (0=top, 1=bottom)
    bool background_enabled = false;
```

- [ ] **Step 4: Extend GsPostProcessUbo**

In `include/gseurat/engine/gs_renderer.hpp`, update the UBO struct comment and add two new vec4:

```cpp
// GPU UBO layout for gs_post_process.comp (std140, 7 × vec4 = 112 bytes)
struct GsPostProcessUbo {
    glm::vec4 fog_params;         // density, r, g, b
    glm::vec4 exposure_vignette;  // exposure, radius, softness, bloom_intensity
    glm::vec4 bloom_fade;         // bloom_threshold, fade_amount, flash_r, flash_g
    glm::vec4 effects;            // flash_b, ca_intensity, dof_focus_dist, dof_focus_range
    glm::vec4 dimensions;         // dof_max_blur, width, height, far_plane
    glm::vec4 ground_sky;         // ground_r, ground_g, ground_b, horizon_y
    glm::vec4 sky_enable;         // sky_r, sky_g, sky_b, enable (> 0.5 = on)
};
```

- [ ] **Step 5: Pack new fields in gs_renderer.cpp**

In `src/engine/gs_renderer.cpp`, inside the post-process UBO packing block (around line 1410, after `pp_ubo.dimensions`):

```cpp
        pp_ubo.ground_sky = glm::vec4(gs_pp_params_.ground_color,
                                       gs_pp_params_.horizon_y);
        pp_ubo.sky_enable = glm::vec4(gs_pp_params_.sky_color,
                                       gs_pp_params_.background_enabled ? 1.0f : 0.0f);
```

- [ ] **Step 6: Update pp_ubo_buffer_ size**

In `src/engine/gs_renderer.cpp`, find the `pp_ubo_buffer_` creation (line ~197). The `Buffer::create_uniform` call uses `sizeof(GsPostProcessUbo)` which will automatically pick up the new size. Verify this is the case — no manual size change needed.

- [ ] **Step 7: Run test to verify it passes**

Run: `cmake --build --preset macos-debug --target test_gs_post_process && ctest --preset macos-debug -R test_gs_post_process -V`
Expected: All tests PASS including `test_background_ubo_packing`

- [ ] **Step 8: Commit**

```bash
git add include/gseurat/engine/gs_renderer.hpp src/engine/gs_renderer.cpp tests/test_gs_post_process.cpp
git commit -m "feat: extend GS post-process UBO with ground/sky background params"
```

---

### Task 3: Implement Background Compositing in gs_post_process.comp

**Files:**
- Modify: `shaders/gs_post_process.comp` (the compute shader)

- [ ] **Step 1: Update UBO declaration in the shader**

In `shaders/gs_post_process.comp`, extend the `PostProcessUBO` (lines 15-21) to include the new fields:

```glsl
layout(set = 0, binding = 3) uniform PostProcessUBO {
    vec4 fog_params;         // density, r, g, b
    vec4 exposure_vignette;  // exposure, radius, softness, bloom_intensity
    vec4 bloom_fade;         // bloom_threshold, fade_amount, flash_r, flash_g
    vec4 effects;            // flash_b, ca_intensity, dof_focus_dist, dof_focus_range
    vec4 dimensions;         // dof_max_blur, width, height, far_plane
    vec4 ground_sky;         // ground_r, ground_g, ground_b, horizon_y
    vec4 sky_enable;         // sky_r, sky_g, sky_b, enable (> 0.5 = on)
};
```

- [ ] **Step 2: Replace the transparent-pixel early-out with background compositing**

Currently lines 41-45 pass through transparent pixels unchanged. Replace them with background generation:

```glsl
    // ── 0. Hybrid background (ground plane + sky gradient) ──
    bool bg_enabled = sky_enable.w > 0.5;
    if (alpha < 0.001 && !bg_enabled) {
        // No background configured — pass through transparent
        imageStore(output_image, ivec2(pixel), raw);
        return;
    }
```

- [ ] **Step 3: Add background compositing at the end of the shader**

After the scene fade (line 214, before the final `imageStore`), add background compositing:

```glsl
    // ── 9. Hybrid background compositing ──
    // Composite processed GS output (premultiplied alpha) over procedural background.
    // Ground color below horizon, sky gradient above, smooth blend at horizon line.
    if (bg_enabled) {
        vec2 uv = (vec2(pixel) + 0.5) / vec2(float(width), float(height));
        float horizon = ground_sky.w;  // normalized Y (0=top, 1=bottom)

        // Vertical gradient: sky above horizon, ground below
        // Smooth 10% band transition centered on horizon
        float band = 0.05;
        float t = smoothstep(horizon - band, horizon + band, uv.y);
        vec3 bg = mix(sky_enable.rgb, ground_sky.rgb, t);

        // Premultiplied alpha composite: GS over background
        color = color + bg * (1.0 - alpha);
        alpha = 1.0;  // output is fully opaque
    }
```

- [ ] **Step 4: Update the final imageStore**

The final `imageStore` at line 216 already writes `vec4(color, alpha)` — no change needed since we updated `color` and `alpha` in place.

- [ ] **Step 5: Build shaders**

Run: `cmake --build --preset macos-debug`
Expected: Clean build with no shader compilation errors

- [ ] **Step 6: Commit**

```bash
git add shaders/gs_post_process.comp
git commit -m "feat: hybrid background compositing in GS post-process shader"
```

---

### Task 4: Wire Background Colors from Scene Data to GS Renderer

**Files:**
- Modify: `src/engine/app_base.cpp` (scene init, camera update)
- Modify: `src/demo/island_demo_state.cpp` (if scene init is here instead)

- [ ] **Step 1: Find where GsPostProcessParams are set from scene data**

Search for where `gs_pp_params_` or `GsPostProcessParams` are populated after scene load. This is likely in `app_base.cpp` around the `init_gs_renderer` or scene init section.

Run: `grep -n "gs_pp_params_\|GsPostProcessParams" src/engine/app_base.cpp src/demo/island_demo_state.cpp`

- [ ] **Step 2: Forward ground_color and sky_color from scene data to GsPostProcessParams**

At the point where the GS renderer is initialized from scene data (after loading the gaussian_splat config), add:

```cpp
    if (scene_data.gaussian_splat) {
        const auto& gs = *scene_data.gaussian_splat;
        // ... existing setup ...

        // Hybrid background
        bool has_bg = gs.ground_color != glm::vec3(0.0f) || gs.sky_color != glm::vec3(0.0f);
        gs_pp_params_.ground_color = gs.ground_color;
        gs_pp_params_.sky_color = gs.sky_color;
        gs_pp_params_.background_enabled = has_bg;
    }
```

- [ ] **Step 3: Compute horizon_y from camera each frame**

In the per-frame update where the GS camera view/proj matrices are computed (app_base.cpp around line 463-475), compute the horizon screen Y:

```cpp
    // Compute horizon Y for hybrid background
    if (gs_pp_params_.background_enabled) {
        // Project a point on the ground plane (Y=0) far ahead of the camera
        // to find where the horizon sits on screen
        glm::vec3 horizon_world = glm::vec3(
            gs_camera_pos.x,
            0.0f,  // ground Y
            gs_camera_pos.z - 100.0f  // far ahead in view direction
        );
        glm::vec4 clip = gs_proj * gs_view * glm::vec4(horizon_world, 1.0f);
        if (std::abs(clip.w) > 0.001f) {
            float ndc_y = clip.y / clip.w;
            // Vulkan NDC: Y=-1 at top, Y=+1 at bottom (after Y-flip in proj)
            // Convert to UV: 0=top, 1=bottom
            gs_pp_params_.horizon_y = (ndc_y + 1.0f) * 0.5f;
            gs_pp_params_.horizon_y = glm::clamp(gs_pp_params_.horizon_y, 0.0f, 1.0f);
        }
    }
```

Note: The exact point projected depends on camera setup. Since `gs_proj[1][1]` is flipped for Vulkan, NDC Y=+1 maps to screen bottom. If the horizon appears inverted, swap the NDC→UV conversion to `(1.0f - ndc_y) * 0.5f`.

- [ ] **Step 4: Build and verify**

Run: `cmake --build --preset macos-debug`
Expected: Clean build

- [ ] **Step 5: Commit**

```bash
git add src/engine/app_base.cpp
git commit -m "feat: wire ground/sky colors from scene data to GS post-process"
```

---

### Task 5: Add Background Colors to Island Demo Scene

**Files:**
- Modify: `assets/scenes/seurat_island.json`

- [ ] **Step 1: Add ground and sky colors to the island scene**

In `assets/scenes/seurat_island.json`, inside the `gaussian_splat` block (after `scale_multiplier`):

```json
    "ground_color": [0.35, 0.28, 0.18],
    "sky_color": [0.45, 0.55, 0.75]
```

These are earthy brown for the ground (dirt/sand) and soft blue for the sky. Tune these to match the island's palette.

- [ ] **Step 2: Build to verify JSON is valid**

Run: `cmake --build --preset macos-debug`
Expected: Clean build (scene JSON is copied by POST_BUILD)

- [ ] **Step 3: Commit**

```bash
git add assets/scenes/seurat_island.json
git commit -m "feat: add hybrid background colors to island demo scene"
```

---

### Task 6: Support Control Server Commands for Runtime Tuning

**Files:**
- Modify: `src/engine/app_base.cpp` (control server dispatch — `set_render_params` or equivalent)

- [ ] **Step 1: Find the control server render param handler**

Run: `grep -n "ground_color\|sky_color\|render_params\|set_render" src/engine/app_base.cpp`

Locate the `dispatch_command` method that handles `set_render_params` JSON commands.

- [ ] **Step 2: Add ground_color, sky_color, and horizon_y to the getter/setter**

In the render params handler, add parsing for the new fields alongside existing post-process params:

```cpp
    // In the set_render_params handler:
    if (params.contains("ground_color")) {
        auto c = params["ground_color"];
        gs_pp_params_.ground_color = {c[0].get<float>(), c[1].get<float>(), c[2].get<float>()};
        gs_pp_params_.background_enabled = true;
    }
    if (params.contains("sky_color")) {
        auto c = params["sky_color"];
        gs_pp_params_.sky_color = {c[0].get<float>(), c[1].get<float>(), c[2].get<float>()};
        gs_pp_params_.background_enabled = true;
    }
```

In the get_render_params response, include the current values:

```cpp
    result["ground_color"] = {gs_pp_params_.ground_color.r,
                              gs_pp_params_.ground_color.g,
                              gs_pp_params_.ground_color.b};
    result["sky_color"] = {gs_pp_params_.sky_color.r,
                           gs_pp_params_.sky_color.g,
                           gs_pp_params_.sky_color.b};
    result["background_enabled"] = gs_pp_params_.background_enabled;
```

- [ ] **Step 3: Build and verify**

Run: `cmake --build --preset macos-debug`
Expected: Clean build

- [ ] **Step 4: Commit**

```bash
git add src/engine/app_base.cpp
git commit -m "feat: expose ground/sky colors via control server render params"
```

---

### Task 7: Run Full Test Suite and Final Verification

**Files:** None (verification only)

- [ ] **Step 1: Run all C++ tests**

Run: `cmake --build --preset macos-debug && ctest --preset macos-debug -V`
Expected: All tests PASS

- [ ] **Step 2: Verify shader compilation**

Run: `ls build/macos-debug/shaders/gs_post_process.comp.spv`
Expected: File exists (compiled by build)

- [ ] **Step 3: Verify the feature is disabled by default**

Confirm that scenes without `ground_color`/`sky_color` behave identically to before: `GsPostProcessParams::background_enabled` defaults to `false`, and the shader skips the background blend when `sky_enable.w < 0.5`.

- [ ] **Step 4: Final commit (if any fixups needed)**

```bash
git add -u
git commit -m "fix: address test/build issues from hybrid background implementation"
```
