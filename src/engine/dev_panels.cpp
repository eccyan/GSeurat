#ifdef GSEURAT_DEV_MODE

#include "gseurat/engine/dev_panels.hpp"
#include "gseurat/engine/app_base.hpp"
#include "gseurat/engine/light_events.hpp"
#include "gseurat/engine/renderer.hpp"
#include "gseurat/engine/gs_renderer.hpp"
#include "gseurat/engine/systems/lighting_system.hpp"

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

    // Phase 4d-2: read from LightingSystem's static set (the renderer-side
    // point_lights_ now also includes VFX-merged entries, which we don't
    // want to expose here). Falls back to the renderer's list if the
    // system isn't yet bound (e.g. early init in test harnesses).
    auto lights = app.lighting_system()
        ? app.lighting_system()->static_lights()
        : gs.point_lights();
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
        // Phase 4d-2: emit the new static set; LightingSystem's run()
        // will pick it up on the next tick and the per-frame merge
        // will re-upload to the GPU.
        app.world().events<PointLightsLoadedEvent>().send(
            PointLightsLoadedEvent{lights});
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
