#include "vulkan_game/demo/gs_demo_state.hpp"
#include "vulkan_game/app.hpp"

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

#include <glm/gtc/matrix_transform.hpp>
#include <algorithm>
#include <cmath>
#include <string>

namespace vulkan_game {

void GsDemoState::on_enter(App& app) {
    app.init_scene(app.current_scene_path());

    // Set initial camera based on loaded cloud AABB
    if (app.renderer().has_gs_cloud()) {
        auto& grid = app.renderer().gs_chunk_grid();
        if (!grid.empty()) {
            auto aabb = grid.cloud_bounds();
            target_ = glm::vec3(
                (aabb.min.x + aabb.max.x) * 0.5f,
                0.0f,
                (aabb.min.z + aabb.max.z) * 0.5f
            );
            // Distance sized to fill screen: use the larger XZ extent
            float extent_x = aabb.max.x - aabb.min.x;
            float extent_z = aabb.max.z - aabb.min.z;
            distance_ = std::max(extent_x, extent_z) * 0.55f;
            elevation_ = 0.9f;  // ~52 degrees — close to top-down
            azimuth_ = 0.0f;
        }
    } else {
        reset_camera();
    }
}

void GsDemoState::on_exit(App& /*app*/) {
}

void GsDemoState::reset_camera() {
    azimuth_ = 0.0f;
    elevation_ = 0.7f;
    distance_ = 250.0f;
    target_ = glm::vec3(0.0f, 0.0f, 0.0f);
}

void GsDemoState::update_camera(App& app, float dt) {
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

    // WASD → pan target
    float pan = kPanSpeed * dt;
    if (input.is_key_down(GLFW_KEY_W)) target_.z -= pan;
    if (input.is_key_down(GLFW_KEY_S)) target_.z += pan;
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

void GsDemoState::update(App& app, float dt) {
    // Escape → quit
    if (app.input().was_key_pressed(GLFW_KEY_ESCAPE)) {
        glfwSetWindowShouldClose(app.window(), GLFW_TRUE);
        return;
    }

    // FPS counter
    fps_timer_ += dt;
    fps_frame_count_++;
    if (fps_timer_ >= 0.5f) {
        fps_ = static_cast<float>(fps_frame_count_) / fps_timer_;
        fps_frame_count_ = 0;
        fps_timer_ = 0.0f;
    }

    update_camera(app, dt);
    app.update_game(dt);
}

void GsDemoState::build_draw_lists(App& app) {
    auto& ui = app.ui_ctx();

    // Semi-transparent HUD panel (top-left in Y-UP coords)
    constexpr float panel_x = 10.0f;
    constexpr float panel_w = 280.0f;
    constexpr float panel_h = 148.0f;
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

    ui.label("GS DEMO", lx, y, 0.6f, title_color);

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

    ui.label("Az:" + fmt(glm::degrees(azimuth_)) +
             "  El:" + fmt(glm::degrees(elevation_)) +
             "  Dist:" + fmt(distance_), lx, y, scale, white);
    y -= 18.0f;

    ui.label("Target: " + fmt(target_.x) + ", " +
             fmt(target_.y) + ", " + fmt(target_.z), lx, y, scale, white);
    y -= 22.0f;

    ui.label("Drag:Orbit  Scroll:Zoom  WASD:Pan  R:Reset", lx, y, 0.35f, dim);
}

}  // namespace vulkan_game
