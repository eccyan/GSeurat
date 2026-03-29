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
            ImGui::Separator();
            ImGui::MenuItem("Gizmo: Lights", nullptr, &show_gizmo_lights_);
            ImGui::MenuItem("Gizmo: Emitters", nullptr, &show_gizmo_emitters_);
            ImGui::MenuItem("Gizmo: VFX", nullptr, &show_gizmo_vfx_);
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
    draw_gizmos(app);
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
    ImGui::Separator();
    ImGui::TextDisabled("Drag: Orbit  Shift+Drag: Pan  Scroll: Zoom  R: Reset");

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

    ImGui::Separator();

    int budget = static_cast<int>(app.renderer().gs_gaussian_budget());
    if (ImGui::SliderInt("LOD Budget", &budget, 0, 500000, "%d", ImGuiSliderFlags_Logarithmic)) {
        app.renderer().set_gs_gaussian_budget(static_cast<uint32_t>(budget));
    }
    ImGui::SameLine();
    ImGui::TextDisabled("(0 = unlimited)");

    if (budget > 0 && app.renderer().has_gs_cloud()) {
        ImGui::Text("Active: %u / %u", gs.gaussian_count(), gs.max_gaussian_count());
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

void StagingState::draw_lighting(AppBase& app) {
    if (!app.renderer().has_gs_cloud()) return;

    ImGui::SetNextWindowPos(ImVec2(270, 30), ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowSize(ImVec2(300, 400), ImGuiCond_FirstUseEver);
    if (!ImGui::Begin("Lighting")) {
        ImGui::End();
        return;
    }

    auto& gs = app.renderer().gs_renderer();

    // Light mode
    int light_mode = gs.light_mode();
    const char* light_modes[] = {"Off", "Directional", "Point Lights"};
    if (ImGui::Combo("Light Mode", &light_mode, light_modes, 3)) {
        gs.set_light_mode(light_mode);
    }

    float intensity = gs.light_intensity();
    if (ImGui::SliderFloat("Global Intensity", &intensity, 0.0f, 5.0f)) {
        gs.set_light_intensity(intensity);
    }

    ImGui::Separator();

    // Ambient
    auto ambient = app.scene().ambient_color();
    float amb[4] = {ambient.r, ambient.g, ambient.b, ambient.a};
    if (ImGui::ColorEdit4("Ambient", amb)) {
        app.scene().set_ambient_color({amb[0], amb[1], amb[2], amb[3]});
    }

    ImGui::Separator();

    // Point lights list
    auto lights = gs.point_lights();  // copy for editing
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

void StagingState::draw_camera_panel(AppBase& app) {
    ImGui::SetNextWindowPos(ImVec2(270, 240), ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowSize(ImVec2(280, 250), ImGuiCond_FirstUseEver);
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

    // ── Bookmarks ──
    ImGui::Separator();
    ImGui::Text("Bookmarks");

    if (ImGui::Button("Save Current")) {
        CameraBookmark bm;
        bm.name = "Bookmark " + std::to_string(bookmarks_.size() + 1);
        bm.azimuth = azimuth_;
        bm.elevation = elevation_;
        bm.distance = distance_;
        bm.target = target_;
        bookmarks_.push_back(bm);
    }

    int to_remove = -1;
    for (size_t i = 0; i < bookmarks_.size(); i++) {
        ImGui::PushID(static_cast<int>(i));
        if (ImGui::Button("Go")) {
            azimuth_ = bookmarks_[i].azimuth;
            elevation_ = bookmarks_[i].elevation;
            distance_ = bookmarks_[i].distance;
            target_ = bookmarks_[i].target;
        }
        ImGui::SameLine();
        if (ImGui::Button("X")) {
            to_remove = static_cast<int>(i);
        }
        ImGui::SameLine();
        // Editable name
        char buf[64];
        std::snprintf(buf, sizeof(buf), "%s", bookmarks_[i].name.c_str());
        ImGui::SetNextItemWidth(150);
        if (ImGui::InputText("##name", buf, sizeof(buf))) {
            bookmarks_[i].name = buf;
        }
        ImGui::PopID();
    }
    if (to_remove >= 0) {
        bookmarks_.erase(bookmarks_.begin() + to_remove);
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

// ── Gizmos ──

bool StagingState::project_to_screen(const glm::vec3& world_pos, const glm::mat4& vp,
                                      float screen_w, float screen_h,
                                      float& out_x, float& out_y) const {
    glm::vec4 clip = vp * glm::vec4(world_pos, 1.0f);
    if (clip.w <= 0.001f) return false;  // behind camera
    glm::vec3 ndc = glm::vec3(clip) / clip.w;
    out_x = (ndc.x * 0.5f + 0.5f) * screen_w;
    out_y = (1.0f - (ndc.y * 0.5f + 0.5f)) * screen_h;  // flip Y
    return ndc.z >= 0.0f && ndc.z <= 1.0f;
}

void StagingState::draw_gizmos(AppBase& app) {
    if (!app.renderer().has_gs_cloud()) return;

    auto& gs = app.renderer().gs_renderer();
    float aspect = static_cast<float>(gs.output_width()) /
                   static_cast<float>(gs.output_height());

    // Build VP matrix matching the camera
    float cos_el = std::cos(elevation_);
    glm::vec3 eye{
        target_.x + distance_ * cos_el * std::sin(azimuth_),
        target_.y + distance_ * std::sin(elevation_),
        target_.z + distance_ * cos_el * std::cos(azimuth_)
    };
    auto view = glm::lookAt(eye, target_, glm::vec3(0, 1, 0));
    auto proj = glm::perspective(glm::radians(45.0f), aspect, 0.1f, 1000.0f);
    proj[1][1] *= -1.0f;  // Vulkan Y-flip
    // But for screen projection we need standard NDC (Y up), so undo the flip
    proj[1][1] *= -1.0f;
    glm::mat4 vp = proj * view;

    auto& io = ImGui::GetIO();
    float sw = io.DisplaySize.x;
    float sh = io.DisplaySize.y;

    ImDrawList* draw_list = ImGui::GetForegroundDrawList();

    // ── Light gizmos ──
    if (show_gizmo_lights_) {
        const auto& lights = gs.point_lights();
        for (size_t i = 0; i < lights.size(); i++) {
            // Light position: (x, y=scene_z, z=height)
            glm::vec3 pos(lights[i].position_and_radius.x,
                          lights[i].position_and_radius.z,  // height stored in z
                          lights[i].position_and_radius.y);
            float sx, sy;
            if (!project_to_screen(pos, vp, sw, sh, sx, sy)) continue;

            ImU32 col = ImGui::ColorConvertFloat4ToU32(
                ImVec4(lights[i].color.r, lights[i].color.g, lights[i].color.b, 0.8f));

            // Outer circle (radius indicator — approximate screen-space size)
            float radius_world = lights[i].position_and_radius.w;
            glm::vec3 edge_pos = pos + glm::vec3(radius_world, 0.0f, 0.0f);
            float ex, ey;
            float screen_radius = 20.0f;  // fallback
            if (project_to_screen(edge_pos, vp, sw, sh, ex, ey)) {
                screen_radius = std::abs(ex - sx);
                screen_radius = std::clamp(screen_radius, 5.0f, 200.0f);
            }

            draw_list->AddCircle(ImVec2(sx, sy), screen_radius, col, 32, 1.5f);
            draw_list->AddCircleFilled(ImVec2(sx, sy), 4.0f, col);

            // Label
            char label[32];
            std::snprintf(label, sizeof(label), "L%zu", i);
            draw_list->AddText(ImVec2(sx + 6, sy - 12), col, label);
        }
    }

    // ── Emitter gizmos ──
    if (show_gizmo_emitters_) {
        ImU32 emitter_col = IM_COL32(255, 100, 50, 200);  // orange
        auto& emitters = app.renderer().gs_particle_emitters();
        for (size_t i = 0; i < emitters.size(); i++) {
            auto pos = emitters[i].config().position;
            float sx, sy;
            if (!project_to_screen(pos, vp, sw, sh, sx, sy)) continue;

            draw_list->AddCircleFilled(ImVec2(sx, sy), 5.0f, emitter_col);
            draw_list->AddCircle(ImVec2(sx, sy), 10.0f, emitter_col, 16, 1.0f);

            char label[32];
            std::snprintf(label, sizeof(label), "E%zu", i);
            draw_list->AddText(ImVec2(sx + 8, sy - 10), emitter_col, label);
        }
    }

    // ── VFX instance gizmos ──
    if (show_gizmo_vfx_) {
        ImU32 vfx_col = IM_COL32(100, 200, 255, 200);  // cyan
        const auto& vfx = app.renderer().vfx_instances();
        for (size_t i = 0; i < vfx.size(); i++) {
            auto pos = vfx[i].position();
            float sx, sy;
            if (!project_to_screen(pos, vp, sw, sh, sx, sy)) continue;

            // Diamond shape
            float d = 7.0f;
            draw_list->AddQuadFilled(
                ImVec2(sx, sy - d), ImVec2(sx + d, sy),
                ImVec2(sx, sy + d), ImVec2(sx - d, sy), vfx_col);

            const char* name = vfx[i].preset().name.c_str();
            draw_list->AddText(ImVec2(sx + 10, sy - 8), vfx_col, name);
        }
    }
}

}  // namespace gseurat
