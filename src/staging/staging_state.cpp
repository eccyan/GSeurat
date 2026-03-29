#include "gseurat/staging/staging_state.hpp"
#include "gseurat/engine/app_base.hpp"
#include "gseurat/engine/post_process.hpp"

#include <imgui.h>

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

#include <glm/gtc/matrix_transform.hpp>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <filesystem>

namespace gseurat {

static constexpr float kOrbitSensitivity = 0.01f;
static constexpr float kZoomSensitivity  = 3.0f;
static constexpr float kPanSensitivity   = 0.05f;

void StagingState::on_enter(AppBase& app) {
    // Load scene files list
    scene_files_.clear();
    for (const auto& entry : std::filesystem::directory_iterator("assets/scenes")) {
        if (entry.path().extension() == ".json") {
            scene_files_.push_back(entry.path().string());
        }
    }
    std::sort(scene_files_.begin(), scene_files_.end());
    scenes_loaded_ = true;

    // Initialize scene
    app.init_scene(app.current_scene_path());
    std::fprintf(stderr, "[Staging] Ready\n");
}

void StagingState::on_exit(AppBase& /*app*/) {
}

void StagingState::update(AppBase& app, float dt) {
    // FPS tracking
    frame_count_++;
    fps_timer_ += dt;
    if (fps_timer_ >= 0.5f) {
        fps_ = static_cast<float>(frame_count_) / fps_timer_;
        frame_count_ = 0;
        fps_timer_ = 0.0f;
    }
    frame_times_[frame_time_idx_] = dt * 1000.0f;
    frame_time_idx_ = (frame_time_idx_ + 1) % frame_times_.size();

    // Camera orbit — only when ImGui doesn't want the mouse
    auto& io = ImGui::GetIO();
    if (!io.WantCaptureMouse) {
        auto* window = app.window();
        double mx, my;
        glfwGetCursorPos(window, &mx, &my);

        if (glfwGetMouseButton(window, GLFW_MOUSE_BUTTON_LEFT) == GLFW_PRESS) {
            if (!dragging_) {
                dragging_ = true;
                last_mouse_x_ = mx;
                last_mouse_y_ = my;
            }
            double dx = mx - last_mouse_x_;
            double dy = my - last_mouse_y_;
            last_mouse_x_ = mx;
            last_mouse_y_ = my;

            if (glfwGetKey(window, GLFW_KEY_LEFT_SHIFT) == GLFW_PRESS) {
                // Pan
                float pan_scale = distance_ * kPanSensitivity * 0.01f;
                float cos_az = std::cos(azimuth_);
                float sin_az = std::sin(azimuth_);
                target_.x -= static_cast<float>(dx) * pan_scale * cos_az;
                target_.z -= static_cast<float>(dx) * pan_scale * sin_az;
                target_.y += static_cast<float>(dy) * pan_scale;
            } else {
                // Orbit
                azimuth_ -= static_cast<float>(dx) * kOrbitSensitivity;
                elevation_ += static_cast<float>(dy) * kOrbitSensitivity;
                elevation_ = std::clamp(elevation_, -1.5f, 1.5f);
            }
        } else {
            dragging_ = false;
        }

        // Scroll zoom
        float scroll = app.input().scroll_y_delta();
        if (scroll != 0.0f) {
            distance_ -= scroll * kZoomSensitivity;
            distance_ = std::max(1.0f, distance_);
        }

        // Reset camera
        if (glfwGetKey(window, GLFW_KEY_R) == GLFW_PRESS && !io.WantCaptureKeyboard) {
            azimuth_ = 0.0f;
            elevation_ = 0.3f;
            distance_ = 100.0f;
            target_ = glm::vec3(0.0f);
            camera_initialized_ = false;
        }
    }

    // Initialize camera from scene if not done
    if (!camera_initialized_ && app.renderer().has_gs_cloud()) {
        auto& gs_renderer = app.renderer().gs_renderer();
        // Start centered at the scene
        distance_ = 100.0f;
        camera_initialized_ = true;
    }

    // Apply camera
    if (app.renderer().has_gs_cloud()) {
        float cos_el = std::cos(elevation_);
        glm::vec3 eye{
            target_.x + distance_ * cos_el * std::sin(azimuth_),
            target_.y + distance_ * std::sin(elevation_),
            target_.z + distance_ * cos_el * std::cos(azimuth_)
        };
        auto& gs_renderer = app.renderer().gs_renderer();
        float aspect = static_cast<float>(gs_renderer.output_width()) /
                       static_cast<float>(gs_renderer.output_height());
        auto view = glm::lookAt(eye, target_, glm::vec3(0, 1, 0));
        auto proj = glm::perspective(glm::radians(45.0f), aspect, 0.1f, 1000.0f);
        proj[1][1] *= -1.0f;  // Vulkan Y-flip
        app.renderer().set_gs_camera(view, proj);
    }

    // Draw ImGui
    draw_imgui(app);

    // Update screen effects
    app.screen_effects().update(dt);
}

void StagingState::build_draw_lists(AppBase& /*app*/) {
    // No sprite draw lists — ImGui handles everything
}

// ── ImGui Panels ──

void StagingState::draw_imgui(AppBase& app) {
    // Main menu bar
    if (ImGui::BeginMainMenuBar()) {
        if (ImGui::BeginMenu("Scene")) {
            if (ImGui::MenuItem("Reload")) {
                app.clear_scene();
                app.init_scene(app.current_scene_path());
            }
            ImGui::Separator();
            for (const auto& path : scene_files_) {
                auto name = std::filesystem::path(path).filename().string();
                if (ImGui::MenuItem(name.c_str())) {
                    app.clear_scene();
                    app.init_scene(path);
                }
            }
            ImGui::EndMenu();
        }
        if (ImGui::BeginMenu("View")) {
            ImGui::MenuItem("Viewport Info", nullptr, &show_viewport_info_);
            ImGui::MenuItem("Render Settings", nullptr, &show_render_settings_);
            ImGui::MenuItem("GS Parameters", nullptr, &show_gs_params_);
            ImGui::MenuItem("Feature Toggles", nullptr, &show_feature_toggles_);
            ImGui::MenuItem("Lighting", nullptr, &show_lighting_);
            ImGui::MenuItem("Camera", nullptr, &show_camera_);
            ImGui::MenuItem("Performance", nullptr, &show_performance_);
            ImGui::EndMenu();
        }
        ImGui::EndMainMenuBar();
    }

    draw_viewport_info(app);
    draw_render_settings(app);
    draw_gs_params(app);
    draw_feature_toggles(app);
    draw_lighting(app);
    draw_camera_panel(app);
    draw_performance(app);
}

void StagingState::draw_viewport_info(AppBase& app) {
    ImGui::SetNextWindowPos(ImVec2(10, 30), ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowSize(ImVec2(250, 120), ImGuiCond_FirstUseEver);
    if (!ImGui::Begin("Viewport Info", nullptr, ImGuiWindowFlags_NoCollapse)) {
        ImGui::End();
        return;
    }

    ImGui::Text("FPS: %.1f", fps_);
    if (app.renderer().has_gs_cloud()) {
        auto& gs = app.renderer().gs_renderer();
        ImGui::Text("Gaussians: %u / %u", gs.visible_count(), gs.gaussian_count());
    }
    ImGui::Text("Scene: %s", std::filesystem::path(app.current_scene_path()).filename().string().c_str());
    ImGui::Separator();
    ImGui::Text("Az: %.1f  El: %.1f  Dist: %.1f", azimuth_ * 57.2958f, elevation_ * 57.2958f, distance_);
    ImGui::Text("Target: %.1f, %.1f, %.1f", target_.x, target_.y, target_.z);

    ImGui::End();
}

void StagingState::draw_render_settings(AppBase& app) {
    ImGui::SetNextWindowPos(ImVec2(1020, 30), ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowSize(ImVec2(250, 400), ImGuiCond_FirstUseEver);
    if (!ImGui::Begin("Render Settings")) {
        ImGui::End();
        return;
    }

    auto& pp = app.renderer().post_process_params();

    if (ImGui::CollapsingHeader("Bloom", ImGuiTreeNodeFlags_DefaultOpen)) {
        ImGui::SliderFloat("Threshold##bloom", &pp.bloom_threshold, 0.0f, 5.0f);
        ImGui::SliderFloat("Soft Knee##bloom", &pp.bloom_soft_knee, 0.0f, 1.0f);
        ImGui::SliderFloat("Intensity##bloom", &pp.bloom_intensity, 0.0f, 2.0f);
    }
    if (ImGui::CollapsingHeader("Exposure")) {
        ImGui::SliderFloat("Exposure##pp", &pp.exposure, 0.1f, 5.0f);
    }
    if (ImGui::CollapsingHeader("Depth of Field")) {
        ImGui::SliderFloat("Focus Distance##dof", &pp.dof_focus_distance, 0.1f, 200.0f);
        ImGui::SliderFloat("Focus Range##dof", &pp.dof_focus_range, 0.1f, 50.0f);
        ImGui::SliderFloat("Max Blur##dof", &pp.dof_max_blur, 0.0f, 2.0f);
    }
    if (ImGui::CollapsingHeader("Vignette")) {
        ImGui::SliderFloat("Radius##vig", &pp.vignette_radius, 0.0f, 1.5f);
        ImGui::SliderFloat("Softness##vig", &pp.vignette_softness, 0.0f, 1.0f);
    }
    if (ImGui::CollapsingHeader("Fog")) {
        ImGui::SliderFloat("Density##fog", &pp.fog_density, 0.0f, 1.0f);
        float fog_color[3] = {pp.fog_color_r, pp.fog_color_g, pp.fog_color_b};
        if (ImGui::ColorEdit3("Color##fog", fog_color)) {
            pp.fog_color_r = fog_color[0];
            pp.fog_color_g = fog_color[1];
            pp.fog_color_b = fog_color[2];
        }
    }
    if (ImGui::CollapsingHeader("God Rays")) {
        float gr = app.renderer().god_rays_intensity();
        if (ImGui::SliderFloat("Intensity##godrays", &gr, 0.0f, 3.0f)) {
            app.renderer().set_god_rays_intensity(gr);
        }
    }

    ImGui::End();
}

void StagingState::draw_gs_params(AppBase& app) {
    if (!app.renderer().has_gs_cloud()) return;

    ImGui::SetNextWindowPos(ImVec2(1020, 440), ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowSize(ImVec2(250, 250), ImGuiCond_FirstUseEver);
    if (!ImGui::Begin("GS Parameters")) {
        ImGui::End();
        return;
    }

    auto& gs = app.renderer().gs_renderer();

    float scale = gs.scale_multiplier();
    if (ImGui::SliderFloat("Scale", &scale, 0.1f, 10.0f)) {
        gs.set_scale_multiplier(scale);
    }

    int toon = gs.toon_bands();
    if (ImGui::SliderInt("Toon Bands", &toon, 0, 5)) {
        gs.set_toon_bands(toon);
    }

    int light_mode = gs.light_mode();
    const char* light_modes[] = {"Off", "Directional", "Point Lights"};
    if (ImGui::Combo("Light Mode", &light_mode, light_modes, 3)) {
        gs.set_light_mode(light_mode);
    }

    float intensity = gs.light_intensity();
    if (ImGui::SliderFloat("Light Intensity", &intensity, 0.0f, 5.0f)) {
        gs.set_light_intensity(intensity);
    }

    ImGui::End();
}

void StagingState::draw_feature_toggles(AppBase& app) {
    ImGui::SetNextWindowPos(ImVec2(10, 400), ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowSize(ImVec2(250, 350), ImGuiCond_FirstUseEver);
    if (!ImGui::Begin("Feature Toggles")) {
        ImGui::End();
        return;
    }

    auto& f = app.feature_flags();

    if (ImGui::CollapsingHeader("Rendering", ImGuiTreeNodeFlags_DefaultOpen)) {
        ImGui::Checkbox("Bloom", &f.bloom);
        ImGui::Checkbox("Depth of Field", &f.depth_of_field);
        ImGui::Checkbox("Vignette", &f.vignette);
        ImGui::Checkbox("Tone Mapping", &f.tone_mapping);
        ImGui::Checkbox("Fog", &f.fog);
        ImGui::Checkbox("Point Lights", &f.point_lights);
    }
    if (ImGui::CollapsingHeader("GS")) {
        ImGui::Checkbox("GS Rendering", &f.gs_rendering);
        ImGui::Checkbox("Chunk Culling", &f.gs_chunk_culling);
        ImGui::Checkbox("LOD", &f.gs_lod);
        ImGui::Checkbox("Adaptive Budget", &f.gs_adaptive_budget);
        ImGui::Checkbox("Parallax", &f.gs_parallax);
    }
    if (ImGui::CollapsingHeader("Effects")) {
        ImGui::Checkbox("Particles", &f.particles);
        ImGui::Checkbox("Weather", &f.weather);
        ImGui::Checkbox("Animated Tiles", &f.animated_tiles);
        ImGui::Checkbox("Screen Effects", &f.screen_effects);
        ImGui::Checkbox("Camera Shake", &f.camera_shake);
    }
    if (ImGui::CollapsingHeader("Audio")) {
        ImGui::Checkbox("Music", &f.music);
        ImGui::Checkbox("SFX", &f.sfx);
    }

    ImGui::End();
}

void StagingState::draw_lighting(AppBase& app) {
    ImGui::SetNextWindowPos(ImVec2(270, 30), ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowSize(ImVec2(280, 200), ImGuiCond_FirstUseEver);
    if (!ImGui::Begin("Lighting")) {
        ImGui::End();
        return;
    }

    auto ambient = app.scene().ambient_color();
    float amb[4] = {ambient.r, ambient.g, ambient.b, ambient.a};
    if (ImGui::ColorEdit4("Ambient", amb)) {
        app.scene().set_ambient_color({amb[0], amb[1], amb[2], amb[3]});
    }

    ImGui::Text("Lights: %zu / 8", app.scene().lights().size());

    ImGui::End();
}

void StagingState::draw_camera_panel(AppBase& app) {
    ImGui::SetNextWindowPos(ImVec2(270, 240), ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowSize(ImVec2(280, 150), ImGuiCond_FirstUseEver);
    if (!ImGui::Begin("Camera")) {
        ImGui::End();
        return;
    }

    ImGui::DragFloat("Azimuth", &azimuth_, 0.01f);
    ImGui::DragFloat("Elevation", &elevation_, 0.01f, -1.5f, 1.5f);
    ImGui::DragFloat("Distance", &distance_, 1.0f, 1.0f, 1000.0f);
    ImGui::DragFloat3("Target", &target_.x, 0.5f);

    if (ImGui::Button("Reset")) {
        azimuth_ = 0.0f;
        elevation_ = 0.3f;
        distance_ = 100.0f;
        target_ = glm::vec3(0.0f);
    }

    ImGui::End();
}

void StagingState::draw_performance(AppBase& app) {
    ImGui::SetNextWindowPos(ImVec2(10, 160), ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowSize(ImVec2(250, 200), ImGuiCond_FirstUseEver);
    if (!ImGui::Begin("Performance")) {
        ImGui::End();
        return;
    }

    ImGui::Text("FPS: %.1f (%.2f ms)", fps_, fps_ > 0.0f ? 1000.0f / fps_ : 0.0f);

    // Reorder ring buffer for ImGui::PlotLines
    float ordered[300];
    for (int i = 0; i < 300; i++) {
        ordered[i] = frame_times_[(frame_time_idx_ + i) % 300];
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

}  // namespace gseurat
