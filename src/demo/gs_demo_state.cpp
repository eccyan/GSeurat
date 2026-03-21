#include "vulkan_game/demo/gs_demo_state.hpp"
#include "vulkan_game/engine/app_base.hpp"

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

#include <glm/gtc/matrix_transform.hpp>
#include <algorithm>
#include <cmath>
#include <string>

namespace vulkan_game {

void GsDemoState::on_enter(AppBase& app) {
    app.feature_flags() = FeatureFlags::gs_viewer();
    app.init_scene(app.current_scene_path());

    // Disable app-level parallax — demo manages its own camera
    app.set_gs_parallax_active(false);
    app.renderer().set_gs_skip_chunk_cull(false);
    app.renderer().gs_renderer().set_skip_sort(false);

    // Sync local scale from scene-loaded value
    scale_multiplier_ = app.renderer().gs_renderer().scale_multiplier();

    // Set initial camera based on loaded cloud AABB
    if (app.renderer().has_gs_cloud()) {
        auto& grid = app.renderer().gs_chunk_grid();
        if (!grid.empty()) {
            auto aabb = grid.cloud_bounds();
            float extent_x = aabb.max.x - aabb.min.x;
            float extent_y = aabb.max.y - aabb.min.y;
            float center_x = (aabb.min.x + aabb.max.x) * 0.5f;
            float center_y = (aabb.min.y + aabb.max.y) * 0.5f;

            // Center target on the map face (XY plane)
            target_ = glm::vec3(center_x, center_y, 0.0f);

            float max_extent = std::max(extent_x, extent_y);
            distance_ = max_extent * 0.7f;
            elevation_ = 0.0f;   // horizontal — looking straight at the XY map
            azimuth_ = 0.0f;

            // Configure parallax camera for shadow box mode
            glm::vec3 eye = target_ + glm::vec3(
                distance_ * std::cos(elevation_) * std::sin(azimuth_),
                distance_ * std::sin(elevation_),
                distance_ * std::cos(elevation_) * std::cos(azimuth_)
            );
            // Use renderer output dimensions (app.cpp auto-scales for large clouds)
            uint32_t gs_w = app.renderer().gs_renderer().output_width();
            uint32_t gs_h = app.renderer().gs_renderer().output_height();
            GsParallaxConfig parallax_config;
            parallax_cam_.configure(eye, target_, 60.0f, gs_w, gs_h, parallax_config);
        }
    } else {
        reset_camera();
    }
}

void GsDemoState::on_exit(AppBase& /*app*/) {
}

void GsDemoState::reset_camera() {
    azimuth_ = 0.0f;
    elevation_ = 0.7f;
    distance_ = 250.0f;
    target_ = glm::vec3(0.0f, 0.0f, 0.0f);
}

void GsDemoState::update_camera(AppBase& app, float dt) {
    auto& input = app.input();

    // Mouse drag → orbit
    glm::vec2 mouse = input.mouse_pos();
    if (input.is_mouse_down(0)) {
        if (!dragging_) {
            dragging_ = true;
            last_mouse_ = mouse;
        }
        glm::vec2 delta = mouse - last_mouse_;
        azimuth_ -= delta.x * kOrbitSensitivity;
        elevation_ += delta.y * kOrbitSensitivity;
        elevation_ = std::clamp(elevation_, kMinElevation, kMaxElevation);
        last_mouse_ = mouse;
    } else {
        dragging_ = false;
    }

    // Scroll → zoom
    float scroll = input.scroll_y_delta();
    if (scroll != 0.0f) {
        distance_ -= scroll * kZoomSensitivity;
        distance_ = std::clamp(distance_, kMinDistance, kMaxDistance);
    }

    // WASD → pan target (XY plane)
    float pan = kPanSpeed * dt;
    if (input.is_key_down(GLFW_KEY_W)) target_.y += pan;
    if (input.is_key_down(GLFW_KEY_S)) target_.y -= pan;
    if (input.is_key_down(GLFW_KEY_A)) target_.x -= pan;
    if (input.is_key_down(GLFW_KEY_D)) target_.x += pan;

    // R → reset
    if (input.was_key_pressed(GLFW_KEY_R)) {
        reset_camera();
    }

    // Compute camera position from spherical coordinates
    float cos_elev = std::cos(elevation_);
    float sin_elev = std::sin(elevation_);
    float cos_azi = std::cos(azimuth_);
    float sin_azi = std::sin(azimuth_);

    glm::vec3 offset(
        distance_ * cos_elev * sin_azi,
        distance_ * sin_elev,
        distance_ * cos_elev * cos_azi
    );
    glm::vec3 eye = target_ + offset;

    glm::mat4 view = glm::lookAt(eye, target_, glm::vec3(0.0f, 1.0f, 0.0f));
    glm::mat4 proj = glm::perspective(
        glm::radians(60.0f),
        1280.0f / 720.0f,
        0.1f, 1000.0f
    );
    // Vulkan Y-flip
    proj[1][1] *= -1.0f;

    app.renderer().set_gs_camera(view, proj);
}

void GsDemoState::update_shadow_box_camera(AppBase& app, float dt) {
    auto& input = app.input();

    // Map mouse position relative to window center → player_offset [-1,1]
    glm::vec2 mouse = input.mouse_pos();
    glm::vec2 window_center{1280.0f * 0.5f, 720.0f * 0.5f};
    glm::vec2 window_half{1280.0f * 0.5f, 720.0f * 0.5f};
    glm::vec2 player_offset = (mouse - window_center) / window_half;
    player_offset = glm::clamp(player_offset, glm::vec2(-1.0f), glm::vec2(1.0f));

    // Always update parallax camera for smooth tracking (exponential smoothing)
    parallax_cam_.update(player_offset, dt);

    // Hybrid re-render: full GS compute every N frames, blit offset in between
    bool is_compute_frame = (gs_frame_counter_ % gs_render_interval_) == 0;
    gs_frame_counter_++;

    if (is_compute_frame) {
        // Full 3D parallax via GS compute pipeline
        app.renderer().gs_renderer().set_skip_sort(false);
        app.renderer().set_gs_camera(parallax_cam_.view(), parallax_cam_.proj());
        app.renderer().set_gs_blit_offset(0.0f, 0.0f);
        last_compute_offset_ = player_offset;
    } else {
        // Cached frame: skip compute, use delta from last compute for blit offset
        app.renderer().gs_renderer().set_skip_sort(true);
        glm::vec2 delta = player_offset - last_compute_offset_;
        constexpr float kParallaxPixels = 30.0f;  // max pixel shift per unit offset
        app.renderer().set_gs_blit_offset(
            delta.x * kParallaxPixels,
            -delta.y * kParallaxPixels);  // Y inverted (screen coords)
    }
}

void GsDemoState::update(AppBase& app, float dt) {
    // Escape → quit
    if (app.input().was_key_pressed(GLFW_KEY_ESCAPE)) {
        glfwSetWindowShouldClose(app.window(), GLFW_TRUE);
        return;
    }

    // Up/Down → adjust scale multiplier
    if (app.input().was_key_pressed(GLFW_KEY_UP)) {
        scale_multiplier_ = std::min(scale_multiplier_ + 0.1f, 10.0f);
        app.renderer().gs_renderer().set_scale_multiplier(scale_multiplier_);
    }
    if (app.input().was_key_pressed(GLFW_KEY_DOWN)) {
        scale_multiplier_ = std::max(scale_multiplier_ - 0.1f, 0.1f);
        app.renderer().gs_renderer().set_scale_multiplier(scale_multiplier_);
    }

    // P → toggle shadow box mode (hybrid: re-render every N frames)
    if (app.input().was_key_pressed(GLFW_KEY_P)) {
        shadow_box_mode_ = !shadow_box_mode_;
        app.renderer().set_gs_skip_chunk_cull(shadow_box_mode_);
        if (shadow_box_mode_) {
            gs_frame_counter_ = 0;  // first frame does full compute
            app.renderer().gs_renderer().set_skip_sort(false);
        } else {
            app.renderer().gs_renderer().set_skip_sort(false);
        }
        std::fprintf(stderr, "Shadow box mode: %s (interval=%u)\n",
                     shadow_box_mode_ ? "ON" : "OFF", gs_render_interval_);
    }

    // FPS counter — use wall clock instead of clamped dt for accurate measurement
    {
        auto now = std::chrono::steady_clock::now();
        if (fps_frame_count_ == 0) fps_clock_ = now;
        fps_frame_count_++;
        float elapsed = std::chrono::duration<float>(now - fps_clock_).count();
        if (elapsed >= 0.5f) {
            fps_ = static_cast<float>(fps_frame_count_) / elapsed;
            fps_frame_count_ = 0;
            fps_clock_ = now;

            // Auto-adjust hybrid interval in shadow box mode
            if (shadow_box_mode_) {
                if (fps_ < kTargetFps * 0.85f && gs_render_interval_ < kMaxInterval) {
                    gs_render_interval_++;
                } else if (fps_ > kTargetFps * 1.3f && gs_render_interval_ > kMinInterval) {
                    gs_render_interval_--;
                }
            }
        }
    }

    // Accumulate effect time
    effect_time_ += dt;
    app.renderer().gs_renderer().set_effect_time(effect_time_);

    // T → cycle toon shading (0 → 3 → 4 → 5 → 0)
    if (app.input().was_key_pressed(GLFW_KEY_T)) {
        auto& gs = app.renderer().gs_renderer();
        int bands = gs.toon_bands();
        if (bands == 0) bands = 3;
        else if (bands == 3) bands = 4;
        else if (bands == 4) bands = 5;
        else bands = 0;
        gs.set_toon_bands(bands);
        std::fprintf(stderr, "Toon bands: %d\n", bands);
    }

    // L → cycle lighting (0=off → 1=directional → 2=point → 0)
    if (app.input().was_key_pressed(GLFW_KEY_L)) {
        auto& gs = app.renderer().gs_renderer();
        int mode = (gs.light_mode() + 1) % 3;
        gs.set_light_mode(mode);
        std::fprintf(stderr, "Light mode: %d\n", mode);
    }

    // X → touch deformation at camera target
    if (app.input().was_key_pressed(GLFW_KEY_X)) {
        glm::vec3 touch_pos = target_;
        float touch_radius = 20.0f;
        // Scale touch to cloud size and center z in the cloud volume
        if (app.renderer().has_gs_cloud()) {
            auto aabb = app.renderer().gs_chunk_grid().cloud_bounds();
            float max_extent = std::max({aabb.max.x - aabb.min.x,
                                         aabb.max.y - aabb.min.y,
                                         aabb.max.z - aabb.min.z});
            touch_radius = max_extent * 0.15f;  // 15% of cloud extent
            touch_pos.z = (aabb.min.z + aabb.max.z) * 0.5f;  // center of cloud volume
        }
        app.renderer().gs_renderer().set_touch_point(touch_pos, touch_radius);
        touch_timer_ = 0.001f;  // start timer
        std::fprintf(stderr, "Touch at (%.1f, %.1f, %.1f) r=%.1f\n",
                     touch_pos.x, touch_pos.y, touch_pos.z, touch_radius);
    }

    // Update touch decay
    if (touch_timer_ > 0.0f) {
        touch_timer_ += dt;
        app.renderer().gs_renderer().set_touch_time(touch_timer_);
        if (touch_timer_ > kTouchDecay) {
            touch_timer_ = 0.0f;
            app.renderer().gs_renderer().clear_touch();
        }
    }

    // F → toggle fire effect
    if (app.input().was_key_pressed(GLFW_KEY_F)) {
        fire_active_ = !fire_active_;
        auto& gs = app.renderer().gs_renderer();
        if (fire_active_ && app.renderer().has_gs_cloud()) {
            auto aabb = app.renderer().gs_chunk_grid().cloud_bounds();
            float y_range = aabb.max.y - aabb.min.y;
            gs.set_fire_region(aabb.max.y - y_range * 0.2f, aabb.max.y);
        } else {
            gs.clear_fire();
            fire_active_ = false;
        }
        std::fprintf(stderr, "Fire: %s\n", fire_active_ ? "ON" : "OFF");
    }

    // G → toggle water effect
    if (app.input().was_key_pressed(GLFW_KEY_G)) {
        water_active_ = !water_active_;
        auto& gs = app.renderer().gs_renderer();
        if (water_active_ && app.renderer().has_gs_cloud()) {
            auto aabb = app.renderer().gs_chunk_grid().cloud_bounds();
            float y_range = aabb.max.y - aabb.min.y;
            gs.set_water_threshold(aabb.min.y + y_range * 0.3f);
        } else {
            gs.clear_water();
            water_active_ = false;
        }
        std::fprintf(stderr, "Water: %s\n", water_active_ ? "ON" : "OFF");
    }

    // E → explode (one-shot 3s animation)
    if (app.input().was_key_pressed(GLFW_KEY_E)) {
        explode_timer_ = 0.001f;  // start
        std::fprintf(stderr, "Explode: START\n");
    }

    // V → toggle voxelize
    if (app.input().was_key_pressed(GLFW_KEY_V)) {
        voxel_active_ = !voxel_active_;
        std::fprintf(stderr, "Voxelize: %s\n", voxel_active_ ? "ON" : "OFF");
    }

    // H → toggle pulse
    if (app.input().was_key_pressed(GLFW_KEY_H)) {
        pulse_active_ = !pulse_active_;
        std::fprintf(stderr, "Pulse: %s\n", pulse_active_ ? "ON" : "OFF");
    }

    // Y → X-Ray depth peel (+20, wrap at 300→0)
    if (app.input().was_key_pressed(GLFW_KEY_Y)) {
        xray_depth_ += 20.0f;
        if (xray_depth_ > 300.0f) xray_depth_ = 0.0f;
        app.renderer().gs_renderer().set_xray_depth(xray_depth_);
        std::fprintf(stderr, "X-Ray depth: %.0f\n", xray_depth_);
    }

    // C → toggle swirl
    if (app.input().was_key_pressed(GLFW_KEY_C)) {
        swirl_active_ = !swirl_active_;
        std::fprintf(stderr, "Swirl: %s\n", swirl_active_ ? "ON" : "OFF");
    }

    // B → burn (one-shot 5s: fire→char→scatter)
    if (app.input().was_key_pressed(GLFW_KEY_B) && burn_timer_ <= 0.0f) {
        burn_timer_ = 0.001f;
        burn_fire_was_active_ = fire_active_;
        // Set fire region to full cloud Y range for the burn shader
        auto& gs = app.renderer().gs_renderer();
        if (app.renderer().has_gs_cloud()) {
            auto aabb = app.renderer().gs_chunk_grid().cloud_bounds();
            gs.set_fire_region(aabb.min.y, aabb.max.y);
        }
        std::fprintf(stderr, "Burn: START\n");
    }

    // Animate explode (0→1 over 3s, auto-reset)
    if (explode_timer_ > 0.0f) {
        explode_timer_ += dt;
        float t = std::min(explode_timer_ / 3.0f, 1.0f);
        app.renderer().gs_renderer().set_explode_t(t);
        if (explode_timer_ >= 3.0f) {
            explode_timer_ = 0.0f;
            app.renderer().gs_renderer().set_explode_t(0.0f);
        }
    }

    // Smooth lerp voxel blend
    {
        float target = voxel_active_ ? 1.0f : 0.0f;
        float speed = 3.0f;  // transition speed
        if (voxel_blend_ < target) voxel_blend_ = std::min(voxel_blend_ + speed * dt, target);
        else if (voxel_blend_ > target) voxel_blend_ = std::max(voxel_blend_ - speed * dt, target);
        app.renderer().gs_renderer().set_voxel_t(voxel_blend_);
    }

    // Pulse: pass effect_time when active
    app.renderer().gs_renderer().set_pulse_t(pulse_active_ ? effect_time_ : 0.0f);

    // Smooth lerp swirl blend
    {
        float target = swirl_active_ ? 1.0f : 0.0f;
        float speed = 2.0f;
        if (swirl_blend_ < target) swirl_blend_ = std::min(swirl_blend_ + speed * dt, target);
        else if (swirl_blend_ > target) swirl_blend_ = std::max(swirl_blend_ - speed * dt, target);
        app.renderer().gs_renderer().set_swirl_t(swirl_blend_);
    }

    // Animate burn (0→1 over 5s, auto-reset)
    if (burn_timer_ > 0.0f) {
        burn_timer_ += dt;
        float t = std::min(burn_timer_ / 5.0f, 1.0f);
        app.renderer().gs_renderer().set_burn_t(t);
        if (burn_timer_ >= 5.0f) {
            burn_timer_ = 0.0f;
            app.renderer().gs_renderer().set_burn_t(0.0f);
            // Restore previous fire state
            if (!burn_fire_was_active_) {
                app.renderer().gs_renderer().clear_fire();
            }
            std::fprintf(stderr, "Burn: END\n");
        }
    }

    if (shadow_box_mode_) {
        update_shadow_box_camera(app, dt);
    } else {
        update_camera(app, dt);
    }
}

void GsDemoState::build_draw_lists(AppBase& app) {
    auto& ui = app.ui_ctx();

    // Semi-transparent HUD panel (top-left in Y-UP coords)
    constexpr float panel_x = 10.0f;
    constexpr float panel_w = 280.0f;
    constexpr float panel_h = 240.0f;
    constexpr float panel_top = 720.0f - 10.0f;  // 10px from screen top
    constexpr float panel_cy = panel_top - panel_h * 0.5f;

    ui.panel(panel_x + panel_w * 0.5f, panel_cy, panel_w, panel_h,
             {0.0f, 0.0f, 0.0f, 0.6f});

    float y = panel_top - 20.0f;
    constexpr float lx = panel_x + 12.0f;
    constexpr float scale = 0.45f;
    glm::vec4 white{1.0f, 1.0f, 1.0f, 1.0f};
    glm::vec4 dim{0.6f, 0.6f, 0.6f, 1.0f};
    glm::vec4 title_color{0.4f, 0.8f, 1.0f, 1.0f};

    auto fmt = [](float v) {
        char buf[16];
        std::snprintf(buf, sizeof(buf), "%.1f", v);
        return std::string(buf);
    };

    if (shadow_box_mode_) {
        ui.label("SHADOW BOX", lx, y, 0.6f, {1.0f, 0.6f, 0.2f, 1.0f});
    } else {
        ui.label("GS DEMO", lx, y, 0.6f, title_color);
    }

    // FPS in top-right of panel
    glm::vec4 fps_color = fps_ >= 30.0f ? glm::vec4{0.2f, 1.0f, 0.3f, 1.0f}
                                         : glm::vec4{1.0f, 0.3f, 0.2f, 1.0f};
    ui.label(fmt(fps_) + " FPS", panel_x + panel_w - 80.0f, y, scale, fps_color);
    y -= 22.0f;

    uint32_t total = app.renderer().gs_renderer().gaussian_count();
    uint32_t visible = app.renderer().gs_renderer().visible_count();
    ui.label("Gaussians: " + std::to_string(visible) + " / " + std::to_string(total),
             lx, y, scale, white);
    y -= 18.0f;

    ui.label("Scale: " + fmt(scale_multiplier_), lx, y, scale, white);
    y -= 18.0f;

    ui.label("Az:" + fmt(glm::degrees(azimuth_)) +
             "  El:" + fmt(glm::degrees(elevation_)) +
             "  Dist:" + fmt(distance_), lx, y, scale, white);
    y -= 18.0f;

    ui.label("Target: " + fmt(target_.x) + ", " +
             fmt(target_.y) + ", " + fmt(target_.z), lx, y, scale, white);
    y -= 22.0f;

    // Active effects line
    {
        std::string fx;
        auto& gs = app.renderer().gs_renderer();
        if (gs.toon_bands() > 0) fx += "Toon=" + std::to_string(gs.toon_bands()) + " ";
        if (gs.light_mode() == 1) fx += "DirLight ";
        else if (gs.light_mode() == 2) fx += "PtLight ";
        if (touch_timer_ > 0.0f) fx += "Touch ";
        if (fire_active_) fx += "Fire ";
        if (water_active_) fx += "Water ";
        if (explode_timer_ > 0.0f) fx += "Explode ";
        if (voxel_blend_ > 0.01f) fx += "Voxel ";
        if (pulse_active_) fx += "Pulse ";
        if (xray_depth_ > 0.0f) fx += "XRay=" + std::to_string(static_cast<int>(xray_depth_)) + " ";
        if (swirl_blend_ > 0.01f) fx += "Swirl ";
        if (burn_timer_ > 0.0f) fx += "Burn ";
        if (!fx.empty()) {
            ui.label("FX: " + fx, lx, y, scale, {1.0f, 0.9f, 0.3f, 1.0f});
            y -= 18.0f;
        }
    }

    if (shadow_box_mode_) {
        ui.label("Hybrid N=" + std::to_string(gs_render_interval_) +
                 "  Mouse:Parallax  P:Exit  R:Reset", lx, y, 0.35f, dim);
    } else {
        ui.label("Drag:Orbit  Scroll:Zoom  WASD:Pan  P:ShadowBox  R:Reset", lx, y, 0.35f, dim);
    }
    y -= 14.0f;
    ui.label("T:Toon  L:Light  F:Fire  G:Water  X:Touch", lx, y, 0.35f, dim);
    y -= 14.0f;
    ui.label("E:Explode  V:Voxel  H:Pulse  Y:XRay  C:Swirl  B:Burn", lx, y, 0.35f, dim);
}

}  // namespace vulkan_game
