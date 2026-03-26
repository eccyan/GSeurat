#include "gseurat/demo/gs_demo_state.hpp"
#include "gseurat/engine/app_base.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/gs_chunk_grid.hpp"
#include "gseurat/engine/gs_animator.hpp"
#include "gseurat/engine/gs_particle.hpp"
#include "gseurat/engine/pathfinder.hpp"

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

#include <glm/gtc/matrix_transform.hpp>
#include <nlohmann/json.hpp>

#include <algorithm>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <string>

namespace gseurat {

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

    // M → toggle streaming mode
    if (app.input().was_key_pressed(GLFW_KEY_M)) {
        if (!streaming_mode_ && app.renderer().has_gs_cloud()) {
            enter_streaming_mode(app);
        } else if (streaming_mode_) {
            streaming_mode_ = false;
            // Re-enable normal chunk culling
            app.renderer().set_gs_skip_chunk_cull(false);
            std::fprintf(stderr, "Streaming mode: OFF\n");
        }
    }

    // Update streaming each frame if active
    if (streaming_mode_) {
        update_streaming(app);
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

    // K → toggle character demo
    if (app.input().was_key_pressed(GLFW_KEY_K)) {
        character_demo_ = !character_demo_;
        if (character_demo_) {
            spawn_test_character(app);
        } else {
            despawn_test_character(app);
        }
    }

    // N → generate scene layers (heightmap, nav zones, light probes)
    if (app.input().was_key_pressed(GLFW_KEY_N)) {
        scene_layers_active_ = !scene_layers_active_;
        if (scene_layers_active_) {
            generate_scene_layers(app);
        } else {
            scene_grid_ = {};
            std::fprintf(stderr, "Scene layers: OFF\n");
        }
    }

    // Q → scatter existing Gaussians around camera target (GS-native animation)
    if (app.input().was_key_pressed(GLFW_KEY_Q)) {
        GsAnimRegion region;
        region.shape = GsAnimRegion::Shape::Sphere;
        region.center = target_;
        region.radius = 10.0f;
        auto id = app.renderer().gs_animator().tag_region(
            app.renderer().gs_active_buffer(),
            region, GsAnimEffect::Detach, 3.0f);
        std::fprintf(stderr, "GS Animator: Detach group %u at (%.1f, %.1f, %.1f)\n",
                     id, target_.x, target_.y, target_.z);
    }

    // J → spawn Gaussian particle burst at camera target
    if (app.input().was_key_pressed(GLFW_KEY_J)) {
        auto preset = gs_preset_spark_shower();
        preset.position = target_;
        app.renderer().add_gs_particle_emitter(preset);
        std::fprintf(stderr, "GS Particles: spark shower at (%.1f, %.1f, %.1f)\n",
                     target_.x, target_.y, target_.z);
    }

    if (character_demo_) {
        update_character_pose(app, dt);
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
    constexpr float panel_h = 290.0f;
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

    // Streaming mode metrics
    if (streaming_mode_) {
        glm::vec4 stream_color{0.3f, 1.0f, 0.6f, 1.0f};
        ui.label("STREAMING", lx + 120.0f, panel_top - 20.0f, 0.5f, stream_color);

        uint32_t loaded = chunk_streamer_.loaded_chunk_count();
        uint32_t loading = chunk_streamer_.loading_chunk_count();
        uint32_t total_chunks = static_cast<uint32_t>(chunk_streamer_.manifest().chunks.size());
        float mem_mb = static_cast<float>(chunk_streamer_.loaded_memory_bytes()) / (1024.0f * 1024.0f);

        char buf[128];
        std::snprintf(buf, sizeof(buf), "Chunks: %u loaded, %u loading / %u total",
                      loaded, loading, total_chunks);
        ui.label(buf, lx, y, scale, stream_color);
        y -= 18.0f;

        std::snprintf(buf, sizeof(buf), "Stream mem: %.1f MB  R=%.0f/%.0f",
                      mem_mb, chunk_streamer_.load_radius(), chunk_streamer_.unload_radius());
        ui.label(buf, lx, y, scale, stream_color);
        y -= 18.0f;
    }

    if (shadow_box_mode_) {
        ui.label("Hybrid N=" + std::to_string(gs_render_interval_) +
                 "  Mouse:Parallax  P:Exit  R:Reset", lx, y, 0.35f, dim);
    } else {
        ui.label("Drag:Orbit  Scroll:Zoom  WASD:Pan  P:ShadowBox  R:Reset", lx, y, 0.35f, dim);
    }
    y -= 14.0f;
    ui.label("T:Toon  L:Light  F:Fire  G:Water  X:Touch  M:Stream", lx, y, 0.35f, dim);
    y -= 14.0f;
    ui.label("E:Explode  V:Voxel  H:Pulse  Y:XRay  C:Swirl  B:Burn", lx, y, 0.35f, dim);
    y -= 14.0f;
    ui.label("K:Character  N:SceneLayers", lx, y, 0.35f, dim);

    // Scene layers info
    if (scene_layers_active_ && scene_grid_.width > 0) {
        y -= 18.0f;
        glm::vec4 layer_color{0.5f, 1.0f, 0.8f, 1.0f};
        char buf[128];
        uint32_t walkable = 0;
        float min_elev = 1e9f, max_elev = -1e9f;
        for (uint32_t i = 0; i < scene_grid_.width * scene_grid_.height; ++i) {
            if (!scene_grid_.solid[i]) {
                walkable++;
                if (i < scene_grid_.elevation.size()) {
                    min_elev = std::min(min_elev, scene_grid_.elevation[i]);
                    max_elev = std::max(max_elev, scene_grid_.elevation[i]);
                }
            }
        }
        std::snprintf(buf, sizeof(buf), "Grid: %ux%u  Walkable: %u/%u",
                      scene_grid_.width, scene_grid_.height,
                      walkable, scene_grid_.width * scene_grid_.height);
        ui.label(buf, lx, y, scale, layer_color);
        y -= 16.0f;
        if (min_elev < 1e8f) {
            std::snprintf(buf, sizeof(buf), "Elevation: %.1f - %.1f", min_elev, max_elev);
            ui.label(buf, lx, y, scale, layer_color);
            y -= 16.0f;
        }
        // Show light probe sample at grid center
        uint32_t cx = scene_grid_.width / 2, cy = scene_grid_.height / 2;
        auto probe = scene_grid_.get_light_probe(cx, cy);
        std::snprintf(buf, sizeof(buf), "Probe@center: (%.2f, %.2f, %.2f)", probe.x, probe.y, probe.z);
        ui.label(buf, lx, y, scale, layer_color);
        y -= 16.0f;

        // Show marker info
        std::snprintf(buf, sizeof(buf), "Markers: %zu  Path: %zu  Emitters: %zu",
                      demo_markers_.size(), demo_path_.size(),
                      app.renderer().gs_particle_emitters().size());
        ui.label(buf, lx, y, scale, layer_color);

        // Render markers and path as projected UI panels
        auto& gs = app.renderer().gs_renderer();
        if (gs.has_cloud()) {
            // Get current camera matrices for world→screen projection
            float cam_x = distance_ * std::cos(elevation_) * std::sin(azimuth_);
            float cam_y = distance_ * std::sin(elevation_);
            float cam_z = distance_ * std::cos(elevation_) * std::cos(azimuth_);
            glm::vec3 cam_pos = target_ + glm::vec3(cam_x, cam_y, cam_z);
            auto view = glm::lookAt(cam_pos, target_, glm::vec3(0, 1, 0));

            // Must match the camera FOV and window aspect used in update_camera()
            auto proj = glm::perspective(glm::radians(60.0f), 1280.0f / 720.0f, 0.1f, 1000.0f);
            proj[1][1] *= -1.0f;
            auto vp = proj * view;

            // Screen dimensions (assume 1280x720 UI space)
            constexpr float screen_w = 1280.0f;
            constexpr float screen_h = 720.0f;

            auto project = [&](glm::vec3 world) -> std::pair<float, float> {
                auto clip = vp * glm::vec4(world, 1.0f);
                if (clip.w <= 0.0f) return {-999.0f, -999.0f};
                float nx = clip.x / clip.w;
                float ny = clip.y / clip.w;
                // NDC → screen (Y-up in UI space)
                float sx = (nx * 0.5f + 0.5f) * screen_w;
                float sy = (1.0f - (ny * 0.5f + 0.5f)) * screen_h;
                return {sx, sy};
            };

            // Draw path dots (yellow)
            for (const auto& wp : demo_path_) {
                // Get elevation at this waypoint
                int gx = static_cast<int>((wp.x - grid_origin_.x) / scene_grid_.cell_size);
                int gz = static_cast<int>((wp.y - grid_origin_.y) / scene_grid_.cell_size);
                float wy = scene_grid_.get_elevation(
                    static_cast<uint32_t>(std::max(0, gx)),
                    static_cast<uint32_t>(std::max(0, gz)));
                auto [sx, sy] = project({wp.x, wy + 1.0f, wp.y});
                if (sx > 0 && sx < screen_w && sy > 0 && sy < screen_h) {
                    ui.panel(sx, sy, 4.0f, 4.0f, {1.0f, 0.9f, 0.2f, 0.7f});
                }
            }

            // Draw markers (colored by light probe, larger)
            for (size_t i = 0; i < demo_markers_.size(); ++i) {
                auto& m = demo_markers_[i];
                auto& c = demo_marker_colors_[i];
                auto [sx, sy] = project({m.x, m.y + 2.0f, m.z});
                if (sx > 0 && sx < screen_w && sy > 0 && sy < screen_h) {
                    // Marker background
                    ui.panel(sx, sy, 12.0f, 12.0f, {c.x, c.y, c.z, 0.8f});
                    // White border
                    ui.panel(sx, sy, 14.0f, 14.0f, {1.0f, 1.0f, 1.0f, 0.3f});
                    // Label
                    char mlabel[8];
                    std::snprintf(mlabel, sizeof(mlabel), "M%zu", i);
                    ui.label(mlabel, sx - 6.0f, sy + 10.0f, 0.3f, white);
                }
            }

            // Draw light markers (L0, L1, ...) using PLY-transformed positions
            auto& gs_lights = app.renderer().gs_renderer().point_lights();
            for (size_t i = 0; i < gs_lights.size(); ++i) {
                const auto& pl = gs_lights[i];
                glm::vec3 light_world(pl.position_and_radius.x,
                                      pl.position_and_radius.z,  // height → Y
                                      pl.position_and_radius.y); // Z
                auto [sx, sy] = project(light_world);
                if (sx > 0 && sx < screen_w && sy > 0 && sy < screen_h) {
                    ui.panel(sx, sy, 10.0f, 10.0f,
                             {pl.color.r, pl.color.g, pl.color.b, 0.9f});
                    ui.panel(sx, sy, 4.0f, 4.0f, {1.0f, 1.0f, 1.0f, 1.0f});
                    char llabel[16];
                    std::snprintf(llabel, sizeof(llabel), "L%zu", i);
                    ui.label(llabel, sx - 4.0f, sy + 10.0f, 0.3f,
                             {1.0f, 1.0f, 1.0f, 1.0f});
                }
            }

            // Draw particle emitter markers (P0, P1, ...) — magenta diamond
            auto& emitters = app.renderer().gs_particle_emitters();
            for (size_t i = 0; i < emitters.size(); ++i) {
                auto [sx, sy] = project(emitters[i].config().position);
                if (sx > 0 && sx < screen_w && sy > 0 && sy < screen_h) {
                    // Outer glow
                    ui.panel(sx, sy, 14.0f, 14.0f, {1.0f, 0.3f, 0.8f, 0.3f});
                    // Inner marker
                    ui.panel(sx, sy, 8.0f, 8.0f, {1.0f, 0.3f, 0.8f, 0.9f});
                    // Center dot
                    ui.panel(sx, sy, 3.0f, 3.0f, {1.0f, 1.0f, 1.0f, 1.0f});
                    char plabel[16];
                    std::snprintf(plabel, sizeof(plabel), "P%zu", i);
                    ui.label(plabel, sx - 4.0f, sy + 10.0f, 0.3f,
                             {1.0f, 0.5f, 0.9f, 1.0f});
                }
            }
        }
    }
}

void GsDemoState::enter_streaming_mode(AppBase& app) {
    auto& grid = app.renderer().gs_chunk_grid();
    if (grid.empty()) return;

    // Create chunk directory next to the executable
    chunk_dir_ = "stream_chunks";
    std::filesystem::create_directories(chunk_dir_);

    // Get all chunks from the grid and write per-chunk PLY files
    auto all_visible = grid.visible_chunks(
        glm::perspective(glm::radians(179.0f), 1.0f, 0.1f, 100000.0f) *
        glm::lookAt(grid.cloud_bounds().center() + glm::vec3(0, 0, 10000),
                    grid.cloud_bounds().center(), glm::vec3(0, 1, 0)));

    // Build manifest by gathering each chunk individually
    ChunkManifest manifest;
    auto bounds = grid.cloud_bounds();
    float chunk_size = (bounds.max.x - bounds.min.x) > 0 ? 32.0f : 32.0f;  // Use default

    // Gather all gaussians from the grid, organized by chunk
    // We need to write each chunk as a separate PLY
    // Use visible_chunks to get all chunk indices, then gather each individually
    nlohmann::json manifest_json;
    manifest_json["chunk_size"] = chunk_size;
    manifest_json["grid_origin"] = {bounds.min.x, bounds.min.y, bounds.min.z};
    manifest_json["grid_cols"] = 0;
    manifest_json["grid_rows"] = 0;
    manifest_json["chunks"] = nlohmann::json::array();

    uint32_t total_written = 0;
    for (uint32_t ci = 0; ci < all_visible.size(); ++ci) {
        std::vector<Gaussian> chunk_gaussians;
        std::vector<uint32_t> single = {all_visible[ci]};
        grid.gather(single, chunk_gaussians);

        if (chunk_gaussians.empty()) continue;

        // Compute chunk bounds
        AABB chunk_bounds;
        for (auto& g : chunk_gaussians) {
            chunk_bounds.expand(g.position);
        }

        std::string ply_name = "chunk_" + std::to_string(ci) + ".ply";
        std::string ply_path = chunk_dir_ + "/" + ply_name;

        GaussianCloud::write_ply(ply_path, chunk_gaussians);

        manifest_json["chunks"].push_back({
            {"grid_x", static_cast<int>(ci % 8)},
            {"grid_z", static_cast<int>(ci / 8)},
            {"ply_file", ply_path},
            {"gaussian_count", chunk_gaussians.size()},
            {"bounds_min", {chunk_bounds.min.x, chunk_bounds.min.y, chunk_bounds.min.z}},
            {"bounds_max", {chunk_bounds.max.x, chunk_bounds.max.y, chunk_bounds.max.z}}
        });
        total_written += static_cast<uint32_t>(chunk_gaussians.size());
    }

    std::fprintf(stderr, "Streaming: wrote %u chunks (%u gaussians) to %s/\n",
                 static_cast<uint32_t>(manifest_json["chunks"].size()),
                 total_written, chunk_dir_.c_str());

    // Parse manifest and init streamer
    auto parsed_manifest = ChunkManifest::from_json(manifest_json);
    chunk_streamer_.init(parsed_manifest);

    // Use smaller radii for the demo to make streaming behavior visible
    float cloud_extent = std::max(bounds.max.x - bounds.min.x,
                                   bounds.max.z - bounds.min.z);
    chunk_streamer_.set_load_radius(cloud_extent * 0.4f);
    chunk_streamer_.set_unload_radius(cloud_extent * 0.6f);

    // Disable the renderer's internal chunk culling — we'll update manually
    app.renderer().set_gs_skip_chunk_cull(true);

    streaming_mode_ = true;
    std::fprintf(stderr, "Streaming mode: ON (load_r=%.0f, unload_r=%.0f)\n",
                 chunk_streamer_.load_radius(), chunk_streamer_.unload_radius());
}

void GsDemoState::update_streaming(AppBase& app) {
    // Compute camera position from orbit parameters
    float cos_elev = std::cos(elevation_);
    float sin_elev = std::sin(elevation_);
    glm::vec3 eye = target_ + glm::vec3(
        distance_ * cos_elev * std::sin(azimuth_),
        distance_ * sin_elev,
        distance_ * cos_elev * std::cos(azimuth_));

    auto& loader = app.async_loader();

    // Update streamer — submits load requests for nearby chunks
    chunk_streamer_.update(eye, loader);

    // Process completed loads
    auto results = loader.poll_results();
    if (!results.empty()) {
        chunk_streamer_.process_load_results(results);
    }

    // If active set changed, re-upload to GPU
    if (chunk_streamer_.active_set_dirty()) {
        glm::mat4 view = glm::lookAt(eye, target_, glm::vec3(0, 1, 0));
        glm::mat4 proj = glm::perspective(glm::radians(60.0f), 1280.0f / 720.0f, 0.1f, 1000.0f);
        proj[1][1] *= -1.0f;
        glm::mat4 vp = proj * view;

        std::vector<Gaussian> active;
        uint32_t budget = app.renderer().gs_renderer().gaussian_count();
        if (budget == 0) budget = 100000;
        chunk_streamer_.assemble_active(vp, eye, budget, active);

        if (!active.empty()) {
            app.renderer().gs_renderer().update_active_gaussians(
                active.data(), static_cast<uint32_t>(active.size()));
        }
    }
}

// ---------------------------------------------------------------------------
// Character demo — procedural voxel humanoid with walking animation
// ---------------------------------------------------------------------------

void GsDemoState::spawn_test_character(AppBase& app) {
    // Save original map Gaussians (only once)
    if (map_gaussians_.empty() && app.renderer().has_gs_cloud()) {
        const auto& all = app.renderer().gs_chunk_grid().all_gaussians();
        map_gaussians_.assign(all.begin(), all.end());
    }

    // Find center of the map
    glm::vec3 center{0.0f};
    if (!map_gaussians_.empty()) {
        AABB aabb;
        for (const auto& g : map_gaussians_) aabb.expand(g.position);
        center = aabb.center();
    }
    character_origin_ = center;

    // Start with a copy of the original map (no accumulated characters)
    std::vector<Gaussian> merged = map_gaussians_;
    uint32_t map_count = static_cast<uint32_t>(merged.size());

    // Generate humanoid at center: body parts 1-6
    auto add_box = [&](float cx, float cy, float cz, int w, int h, int d,
                       glm::vec3 color, uint32_t bone) {
        for (int x = 0; x < w; ++x) {
            for (int y = 0; y < h; ++y) {
                for (int z = 0; z < d; ++z) {
                    Gaussian g{};
                    g.position = center + glm::vec3(cx + x - w/2.0f, cy + y, cz + z - d/2.0f);
                    g.scale = glm::vec3(0.5f);
                    g.rotation = glm::quat(1, 0, 0, 0);
                    g.color = color;
                    g.opacity = 1.0f;
                    g.importance = 1.0f;
                    g.bone_index = bone;
                    merged.push_back(g);
                }
            }
        }
    };

    add_box(0, 4, 0, 4, 6, 2, {0.2f, 0.5f, 0.8f}, 1);  // Torso
    add_box(0, 10, 0, 3, 3, 2, {0.9f, 0.75f, 0.6f}, 2); // Head
    add_box(-3.5f, 5, 0, 2, 5, 2, {0.2f, 0.5f, 0.8f}, 3); // Left arm
    add_box(3.5f, 5, 0, 2, 5, 2, {0.2f, 0.5f, 0.8f}, 4);  // Right arm
    add_box(-1.0f, 0, 0, 2, 4, 2, {0.3f, 0.3f, 0.5f}, 5); // Left leg
    add_box(1.0f, 0, 0, 2, 4, 2, {0.3f, 0.3f, 0.5f}, 6);  // Right leg

    uint32_t char_count = static_cast<uint32_t>(merged.size()) - map_count;
    auto cloud = GaussianCloud::from_gaussians(std::move(merged));

    uint32_t gs_w = app.renderer().gs_renderer().output_width();
    uint32_t gs_h = app.renderer().gs_renderer().output_height();
    if (gs_w == 0) { gs_w = 320; gs_h = 240; }
    app.renderer().init_gs(cloud, gs_w, gs_h);
    std::fprintf(stderr, "Character: %u map + %u character Gaussians at (%.1f, %.1f, %.1f)\n",
                 map_count, char_count, center.x, center.y, center.z);

    character_anim_time_ = 0.0f;
    std::fprintf(stderr, "Character demo: ON\n");
}

void GsDemoState::despawn_test_character(AppBase& app) {
    app.renderer().gs_renderer().clear_bone_transforms();
    character_anim_time_ = 0.0f;

    // Restore original map without character
    if (!map_gaussians_.empty()) {
        auto cloud = GaussianCloud::from_gaussians(
            std::vector<Gaussian>(map_gaussians_));
        uint32_t gs_w = app.renderer().gs_renderer().output_width();
        uint32_t gs_h = app.renderer().gs_renderer().output_height();
        if (gs_w == 0) { gs_w = 320; gs_h = 240; }
        app.renderer().init_gs(cloud, gs_w, gs_h);
    }

    std::fprintf(stderr, "Character demo: OFF\n");
}

void GsDemoState::update_character_pose(AppBase& app, float dt) {
    character_anim_time_ += dt;
    const glm::vec3& o = character_origin_;

    // Walk cycle: arms and legs swing sinusoidally around joints
    float swing = std::sin(character_anim_time_ * 4.0f) * 0.5f;

    glm::mat4 bones[7];
    bones[0] = glm::mat4(1.0f);  // unused / map Gaussians

    // Torso bob
    bones[1] = glm::translate(glm::mat4(1.0f), {0, std::abs(swing) * 0.3f, 0});
    // Head follows torso
    bones[2] = bones[1];

    // Pivot rotation: translate to joint, rotate, translate back
    auto pivot_rotate = [&](glm::vec3 pivot_local, float angle) {
        glm::vec3 world_pivot = o + pivot_local;
        auto t = glm::translate(glm::mat4(1.0f), world_pivot);
        auto r = glm::rotate(glm::mat4(1.0f), angle, {1, 0, 0});
        return t * r * glm::translate(glm::mat4(1.0f), -world_pivot);
    };

    bones[3] = pivot_rotate({-3.5f, 9.0f, 0.0f}, swing);   // Left arm
    bones[4] = pivot_rotate({3.5f, 9.0f, 0.0f}, -swing);    // Right arm
    bones[5] = pivot_rotate({-1.0f, 4.0f, 0.0f}, -swing);   // Left leg
    bones[6] = pivot_rotate({1.0f, 4.0f, 0.0f}, swing);     // Right leg

    app.renderer().gs_renderer().upload_bone_transforms(bones, 7);
}

void GsDemoState::generate_scene_layers(AppBase& app) {
    if (!app.renderer().has_gs_cloud()) {
        std::fprintf(stderr, "Scene layers: No cloud loaded\n");
        return;
    }

    // Get all Gaussians from the chunk grid
    const auto& all = app.renderer().gs_chunk_grid().all_gaussians();
    auto cloud = GaussianCloud::from_gaussians(std::vector<Gaussian>(all.begin(), all.end()));

    // Auto-generate collision grid with elevation and light probes
    auto aabb = app.renderer().gs_chunk_grid().cloud_bounds();
    float extent_x = aabb.max.x - aabb.min.x;
    float extent_z = aabb.max.z - aabb.min.z;
    float cell = std::max(1.0f, std::max(extent_x, extent_z) / 64.0f);  // ~64 cells on longest axis
    uint32_t gw = std::max(1u, static_cast<uint32_t>(extent_x / cell));
    uint32_t gh = std::max(1u, static_cast<uint32_t>(extent_z / cell));

    scene_grid_ = generate_collision_from_gaussians(cloud, gw, gh, cell, cell * 2.0f);
    grid_origin_ = {aabb.min.x, aabb.min.z};

    // Count stats
    uint32_t walkable = 0;
    std::vector<std::pair<uint32_t, uint32_t>> walkable_cells;
    for (uint32_t gz = 0; gz < gh; ++gz) {
        for (uint32_t gx = 0; gx < gw; ++gx) {
            if (!scene_grid_.is_solid(gx, gz)) {
                walkable++;
                walkable_cells.push_back({gx, gz});
            }
        }
    }

    // Place demo markers at random walkable positions
    demo_markers_.clear();
    demo_marker_colors_.clear();
    if (walkable_cells.size() >= 5) {
        // Pick 5 evenly spaced walkable cells
        for (int i = 0; i < 5; ++i) {
            size_t idx = (i * walkable_cells.size()) / 5;
            auto [gx, gz] = walkable_cells[idx];
            float wx = aabb.min.x + (static_cast<float>(gx) + 0.5f) * cell;
            float wz = aabb.min.z + (static_cast<float>(gz) + 0.5f) * cell;
            float wy = scene_grid_.get_elevation(gx, gz);
            demo_markers_.push_back({wx, wy, wz});

            // Tint marker by light probe at this position
            auto probe = scene_grid_.get_light_probe(gx, gz);
            demo_marker_colors_.push_back({probe.x, probe.y, probe.z, 1.0f});
        }

        // Find A* path between first and last marker
        if (demo_markers_.size() >= 2) {
            auto& first = demo_markers_.front();
            auto& last = demo_markers_.back();
            demo_path_ = Pathfinder::find_path_grid(
                scene_grid_, grid_origin_,
                {first.x, first.z}, {last.x, last.z});
            std::fprintf(stderr, "  Path: %zu waypoints from (%.0f,%.0f) to (%.0f,%.0f)\n",
                         demo_path_.size(), first.x, first.z, last.x, last.z);
        }
    }

    std::fprintf(stderr, "Scene layers: ON\n");
    std::fprintf(stderr, "  Grid: %ux%u (cell_size=%.1f)\n", gw, gh, cell);
    std::fprintf(stderr, "  Walkable: %u/%u cells\n", walkable, gw * gh);
    std::fprintf(stderr, "  Markers: %zu placed at elevation\n", demo_markers_.size());
    std::fprintf(stderr, "  Elevation + light probes auto-generated from %u Gaussians\n", cloud.count());
    auto& lights = app.scene().lights();
    std::fprintf(stderr, "  Lights: %zu static\n", lights.size());
    for (size_t i = 0; i < lights.size(); i++) {
        const auto& pl = lights[i];
        std::fprintf(stderr, "    [%zu] pos=(%.1f, %.1f) height=%.1f radius=%.1f color=(%.2f,%.2f,%.2f) intensity=%.1f\n",
                     i, pl.position_and_radius.x, pl.position_and_radius.y,
                     pl.position_and_radius.z, pl.position_and_radius.w,
                     pl.color.r, pl.color.g, pl.color.b, pl.color.a);
    }
}

}  // namespace gseurat
