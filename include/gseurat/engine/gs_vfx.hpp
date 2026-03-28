#pragma once

#include <string>
#include <vector>
#include <glm/vec3.hpp>
#include <gseurat/engine/gs_particle.hpp>
#include <gseurat/engine/gs_animator.hpp>
#include <gseurat/engine/scene_loader.hpp>

namespace gseurat {

// ── VFX layer data (parsed from .vfx.json) ──

struct VfxLayerData {
    std::string name;
    std::string type;  // "emitter" | "animation" | "light"
    float start = 0.0f;
    float duration = 1.0f;
    GsEmitterConfig emitter_config;      // populated if type=="emitter"
    std::string emitter_preset;          // optional preset name
    GsAnimationData animation_config;    // populated if type=="animation"
};

struct VfxPreset {
    std::string name;
    float duration = 3.0f;
    std::vector<VfxLayerData> layers;
};

// ── VFX instance data (from scene.json vfx_instances) ──

struct VfxInstanceData {
    std::string vfx_file;
    glm::vec3 position{0.0f};
    float radius = 5.0f;
    std::string trigger = "auto";
    bool loop = true;
};

// ── Load a .vfx.json file ──

VfxPreset load_vfx_preset(const std::string& path);
VfxPreset parse_vfx_preset(const nlohmann::json& j);

// ── Runtime VFX instance ──

class VfxInstance {
public:
    void init(const VfxPreset& preset, const glm::vec3& position, bool loop);

    /// Update timeline, activate/deactivate emitter layers.
    /// Appends active particles to out_buffer.
    void update(float dt, std::vector<Gaussian>& out_buffer);

    bool is_finished() const { return finished_; }

private:
    VfxPreset preset_;
    glm::vec3 position_{0.0f};
    bool loop_ = true;
    float elapsed_ = 0.0f;
    bool finished_ = false;

    struct EmitterState {
        GaussianParticleEmitter emitter;
        size_t layer_index;
        bool activated = false;
    };
    std::vector<EmitterState> emitter_states_;
};

}  // namespace gseurat
