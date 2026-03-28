#include <gseurat/engine/gs_vfx.hpp>
#include <nlohmann/json.hpp>
#include <fstream>
#include <iostream>

namespace gseurat {

// ── Parse .vfx.json ──

VfxPreset parse_vfx_preset(const nlohmann::json& j) {
    VfxPreset preset;
    preset.name = j.value("name", "Unnamed VFX");
    preset.duration = j.value("duration", 3.0f);

    if (j.contains("layers")) {
        for (const auto& lj : j["layers"]) {
            VfxLayerData layer;
            layer.name = lj.value("name", "Unnamed");
            layer.type = lj.value("type", "emitter");
            layer.start = lj.value("start", 0.0f);
            layer.duration = lj.value("duration", 1.0f);

            if (layer.type == "emitter" && lj.contains("emitter")) {
                layer.emitter_config = SceneLoader::parse_gs_emitter_config(lj["emitter"]);
                if (lj["emitter"].contains("preset")) {
                    layer.emitter_preset = lj["emitter"]["preset"].get<std::string>();
                }
            } else if (layer.type == "animation" && lj.contains("animation")) {
                // Parse animation config — the .vfx.json animation format is
                // { "effect": "pulse", "params": { ... } } without a region
                // (region is determined by the instance radius at placement).
                auto& anim = layer.animation_config;
                const auto& aj = lj["animation"];
                anim.effect = aj.value("effect", "detach");
                anim.lifetime = layer.duration;  // layer duration = animation lifetime
                if (aj.contains("params")) {
                    anim.params = SceneLoader::parse_gs_anim_params(aj["params"]);
                }
            }

            preset.layers.push_back(std::move(layer));
        }
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

    // Pre-create emitter states for all emitter layers
    emitter_states_.clear();
    for (size_t i = 0; i < preset_.layers.size(); ++i) {
        if (preset_.layers[i].type != "emitter") continue;
        EmitterState es;
        es.layer_index = i;
        es.activated = false;
        // Configure emitter from layer config
        es.emitter.configure(preset_.layers[i].emitter_config);
        es.emitter.set_position(position_);
        emitter_states_.push_back(std::move(es));
    }
}

void VfxInstance::update(float dt, std::vector<Gaussian>& out_buffer) {
    if (finished_) return;

    elapsed_ += dt;

    // Check for loop/finish
    if (elapsed_ > preset_.duration) {
        if (loop_) {
            elapsed_ = std::fmod(elapsed_, preset_.duration);
            // Restart all emitters
            for (auto& es : emitter_states_) {
                es.activated = false;
                es.emitter.clear();
            }
        } else {
            finished_ = true;
            return;
        }
    }

    // Update each emitter layer based on timeline
    for (auto& es : emitter_states_) {
        const auto& layer = preset_.layers[es.layer_index];
        bool in_window = elapsed_ >= layer.start && elapsed_ < layer.start + layer.duration;

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
}

}  // namespace gseurat
