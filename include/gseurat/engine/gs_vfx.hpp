#pragma once

#include <string>
#include <vector>
#include <glm/vec3.hpp>
#include <gseurat/engine/gs_particle.hpp>
#include <gseurat/engine/gs_animator.hpp>
#include <gseurat/engine/scene_loader.hpp>

namespace gseurat {

// ── VFX element data (parsed from .vfx.json) ──

struct VfxElementData {
    std::string name;
    std::string type;  // "object" | "emitter" | "animation" | "light"
    glm::vec3 position{0.0f};            // relative to prefab origin
    float start = 0.0f;
    float duration = 0.0f;              // 0 = no duration (derived or infinite)
    bool loop = false;
    // type=object
    std::string ply_file;
    float scale = 1.0f;
    // type=emitter
    GsEmitterConfig emitter_config;
    std::string emitter_preset;
    // type=animation
    GsAnimationData animation_config;
    GsAnimRegion region;                 // animation area-of-effect
    // type=light
    glm::vec3 light_color{1.0f};
    float light_intensity = 5.0f;
    float light_radius = 10.0f;
};

struct VfxPreset {
    std::string name;
    float duration = 0.0f;              // 0 = derived from elements
    std::string category;
    std::vector<VfxElementData> elements;
};

// ── VFX instance data (from scene.json vfx_instances) ──

struct VfxInstanceData {
    std::string vfx_file;
    glm::vec3 position{0.0f};
    float rotation_y = 0.0f;  // Y-axis rotation in degrees
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
    void init(const VfxPreset& preset, const glm::vec3& position, bool loop,
              float rotation_y = 0.0f);

    /// Append static object Gaussians to the buffer (call before animator runs).
    void append_objects(std::vector<Gaussian>& out_buffer);

    /// Update timeline, activate/deactivate emitter layers.
    /// Appends active particles to out_buffer.
    /// Tags animation regions on the provided animator.
    void update(float dt, std::vector<Gaussian>& out_buffer, GaussianAnimator& animator);

    bool is_finished() const { return finished_; }
    const glm::vec3& position() const { return position_; }
    const VfxPreset& preset() const { return preset_; }
    const std::vector<Gaussian>& object_gaussians() const { return object_gaussians_; }

    /// Active lights from VFX light elements (collected by Renderer)
    const std::vector<PointLight>& active_lights() const { return active_lights_; }

    /// Reset animation states so they re-tag on next update
    void reset_animations();

    /// Tag animation regions on the static buffer (call after append_objects, before animator update)
    void tag_animations(std::vector<Gaussian>& static_buffer, GaussianAnimator& animator);

private:
    VfxPreset preset_;
    glm::vec3 position_{0.0f};
    float rotation_y_ = 0.0f;
    bool loop_ = true;
    float elapsed_ = 0.0f;
    bool finished_ = false;

    struct EmitterState {
        GaussianParticleEmitter emitter;
        size_t element_index;
        bool activated = false;
    };
    std::vector<EmitterState> emitter_states_;

    struct AnimState {
        size_t element_index;
        uint32_t group_id = 0;
        bool activated = false;
    };
    std::vector<AnimState> anim_states_;

    struct LightState {
        size_t element_index;
        bool activated = false;
    };
    std::vector<LightState> light_states_;
    std::vector<PointLight> active_lights_;

    // Object PLY Gaussians (static geometry, included in scene buffer at init/gather)
    std::vector<Gaussian> object_gaussians_;
};

}  // namespace gseurat
