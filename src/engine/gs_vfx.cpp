#include <gseurat/engine/gs_vfx.hpp>
#include <gseurat/engine/gaussian_cloud.hpp>
#include <nlohmann/json.hpp>
#include <fstream>
#include <iostream>
#include <algorithm>
#include <filesystem>

namespace gseurat {

// ── Parse .vfx.json ──

VfxPreset parse_vfx_preset(const nlohmann::json& j) {
    VfxPreset preset;
    preset.name = j.value("name", "Unnamed VFX");
    preset.duration = j.value("duration", 0.0f);
    preset.category = j.value("category", "");

    // v2 uses "elements", v1 used "layers" — accept both
    const auto& raw = j.contains("elements") ? j["elements"] : j.value("layers", nlohmann::json::array());

    for (const auto& ej : raw) {
        VfxElementData el;
        el.name = ej.value("name", "Unnamed");
        el.type = ej.value("type", "emitter");
        if (ej.contains("position")) {
            el.position = {ej["position"][0].get<float>(),
                           ej["position"][1].get<float>(),
                           ej["position"][2].get<float>()};
        }
        el.start = ej.value("start", 0.0f);
        el.duration = ej.value("duration", 0.0f);
        el.loop = ej.value("loop", false);

        if (el.type == "object") {
            el.ply_file = ej.value("ply_file", "");
            el.scale = ej.value("scale", 1.0f);
        } else if (el.type == "emitter" && ej.contains("emitter")) {
            el.emitter_config = SceneLoader::parse_gs_emitter_config(ej["emitter"]);
            if (ej["emitter"].contains("preset")) {
                el.emitter_preset = ej["emitter"]["preset"].get<std::string>();
            }
        } else if (el.type == "animation" && ej.contains("animation")) {
            auto& anim = el.animation_config;
            const auto& aj = ej["animation"];
            anim.effect = aj.value("effect", "detach");
            anim.lifetime = el.duration > 0.0f ? el.duration : 9999.0f;
            anim.loop = el.loop;
            if (aj.contains("params")) {
                anim.params = SceneLoader::parse_gs_anim_params(aj["params"]);
            }
            // Parse region if present on element
            if (ej.contains("region")) {
                const auto& rj = ej["region"];
                std::string shape = rj.value("shape", "sphere");
                el.region.shape = (shape == "box")
                    ? GsAnimRegion::Shape::Box : GsAnimRegion::Shape::Sphere;
                el.region.radius = rj.value("radius", 5.0f);
                if (rj.contains("half_extents")) {
                    el.region.half_extents = {rj["half_extents"][0].get<float>(),
                                              rj["half_extents"][1].get<float>(),
                                              rj["half_extents"][2].get<float>()};
                }
            }
        }

        preset.elements.push_back(std::move(el));
    }

    // Derive duration if not explicitly set
    if (preset.duration <= 0.0f) {
        for (const auto& el : preset.elements) {
            float end = el.start + el.duration;
            if (end > preset.duration) preset.duration = end;
        }
        if (preset.duration <= 0.0f) preset.duration = 3.0f;  // fallback
    }

    return preset;
}

VfxPreset load_vfx_preset(const std::string& path) {
    std::ifstream ifs(path);
    if (!ifs.is_open()) {
        std::cerr << "[VFX] Failed to open: " << path << "\n";
        return {};
    }
    auto j = nlohmann::json::parse(ifs);
    return parse_vfx_preset(j);
}

// ── VfxInstance ──

void VfxInstance::init(const VfxPreset& preset, const glm::vec3& position, bool loop) {
    preset_ = preset;
    position_ = position;
    loop_ = loop;
    elapsed_ = 0.0f;
    finished_ = false;

    // Pre-create states for all elements
    emitter_states_.clear();
    anim_states_.clear();
    object_gaussians_.clear();

    for (size_t i = 0; i < preset_.elements.size(); ++i) {
        const auto& el = preset_.elements[i];
        if (el.type == "emitter") {
            EmitterState es;
            es.element_index = i;
            es.activated = false;
            es.emitter.configure(el.emitter_config);
            es.emitter.set_position(position_ + el.position);
            emitter_states_.push_back(std::move(es));
        } else if (el.type == "animation") {
            AnimState as;
            as.element_index = i;
            as.activated = false;
            anim_states_.push_back(std::move(as));
        } else if (el.type == "object" && !el.ply_file.empty()) {
            // Load PLY file — try exact path, then assets/vfx/filename
            std::string ply_path = el.ply_file;
            if (!std::filesystem::exists(ply_path)) {
                auto filename = std::filesystem::path(el.ply_file).filename().string();
                ply_path = "assets/vfx/" + filename;
            }
            if (std::filesystem::exists(ply_path)) {
                auto cloud = GaussianCloud::load_ply(ply_path);
                const auto& gs = cloud.gaussians();
                glm::vec3 offset = position_ + el.position;
                for (const auto& src : gs) {
                    Gaussian g = src;
                    g.position = g.position * el.scale + offset;
                    object_gaussians_.push_back(g);
                }
                std::fprintf(stderr, "VFX: Object '%s' loaded %zu Gaussians from %s\n",
                    el.name.c_str(), gs.size(), el.ply_file.c_str());
            } else {
                std::fprintf(stderr, "VFX: Object PLY not found: %s\n", el.ply_file.c_str());
            }
        }
    }
}

void VfxInstance::update(float dt, std::vector<Gaussian>& out_buffer, GaussianAnimator& animator) {
    if (finished_) return;

    // Object Gaussians are added to the scene buffer by the Renderer
    // (not appended per-frame) so they don't consume particle headroom.

    elapsed_ += dt;

    // Check for loop/finish
    if (preset_.duration > 0.0f && elapsed_ > preset_.duration) {
        if (loop_) {
            elapsed_ = std::fmod(elapsed_, preset_.duration);
            for (auto& es : emitter_states_) {
                es.activated = false;
                es.emitter.clear();
            }
        } else {
            finished_ = true;
            return;
        }
    }

    // Update each emitter element based on timeline
    for (auto& es : emitter_states_) {
        const auto& el = preset_.elements[es.element_index];
        float el_start = el.start;
        float el_end = el.duration > 0.0f ? el.start + el.duration : preset_.duration;

        // Looping elements: check within their cycle
        bool in_window;
        if (el.loop && el.duration > 0.0f) {
            float cycle_elapsed = std::fmod(elapsed_ - el_start, el.duration);
            in_window = elapsed_ >= el_start && cycle_elapsed >= 0.0f;
        } else {
            in_window = elapsed_ >= el_start && elapsed_ < el_end;
        }

        if (in_window && !es.activated) {
            es.emitter.set_active(true);
            es.activated = true;
        } else if (!in_window && es.activated) {
            es.emitter.set_active(false);
            es.activated = false;
        }

        if (es.activated) {
            es.emitter.update(dt);
            es.emitter.gather(out_buffer);
        }
    }

    // Activate/deactivate animation elements
    for (auto& as : anim_states_) {
        const auto& el = preset_.elements[as.element_index];
        float el_start = el.start;
        bool in_window;
        if (el.loop) {
            in_window = elapsed_ >= el_start;
        } else {
            float el_end = el.duration > 0.0f ? el.start + el.duration : preset_.duration;
            in_window = elapsed_ >= el_start && elapsed_ < el_end;
        }

        if (in_window && !as.activated) {
            // Tag region on the shared animator
            auto region = el.region;
            region.center += position_ + el.position;  // offset by instance + element position
            auto effect_name = el.animation_config.effect;
            auto effect = GsAnimEffect::Detach;
            if (effect_name == "float") effect = GsAnimEffect::Float;
            else if (effect_name == "orbit") effect = GsAnimEffect::Orbit;
            else if (effect_name == "dissolve") effect = GsAnimEffect::Dissolve;
            else if (effect_name == "reform") effect = GsAnimEffect::Reform;
            else if (effect_name == "pulse") effect = GsAnimEffect::Pulse;
            else if (effect_name == "vortex") effect = GsAnimEffect::Vortex;
            else if (effect_name == "wave") effect = GsAnimEffect::Wave;
            else if (effect_name == "scatter") effect = GsAnimEffect::Scatter;

            float lifetime = el.loop ? 9999.0f : (el.duration > 0.0f ? el.duration : 9999.0f);
            as.group_id = animator.tag_region(out_buffer, region, effect, lifetime, el.animation_config.params);
            as.activated = true;
        } else if (!in_window && as.activated) {
            as.activated = false;
            // Group expires naturally via lifetime
        }
    }
}

}  // namespace gseurat
