#pragma once

#include <string>
#include <unordered_map>
#include <vector>
#include <glm/vec3.hpp>
#include <gseurat/engine/gs_particle.hpp>
#include <gseurat/engine/gs_animator.hpp>
#include <gseurat/engine/scene_loader.hpp>

namespace gseurat {

class VfxObjectCache;

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

// ── Decimated "object" PLY cache ──
//
// Issue #407: VfxInstance::init synchronously parses a PLY file for every
// "object" element on the main render thread, which can stall gameplay when
// a runtime trigger spawns a preset whose PLY hasn't been touched yet.
//
// VfxObjectCache holds already-decimated splats keyed by the (resolved)
// PLY path. At scene init the demo + scene loader walk every VFX preset
// that will be referenced and prefetch each "object" PLY into the cache.
// `VfxInstance::init` then applies the per-instance scale/rotation/offset
// transform on top of cached splats, skipping disk I/O entirely.
//
// On cache miss, `init` falls back to the legacy synchronous load with a
// `[VFX] WARN: PLY '%s' not preloaded — main-thread stall` log line so
// missing prefetches are visible in regression smokes.
class VfxObjectCache {
public:
    struct Entry {
        std::vector<Gaussian> decimated;   // post-decimation, no per-instance transform applied
        std::size_t source_count = 0;      // raw splat count before decimation (for logging)
        std::size_t stride = 1;
    };

    // Idempotent: re-calling preload() for an already-cached path is a no-op.
    // Returns the resolved canonical path used as the cache key (so callers
    // can log which file was actually parsed, including the fallback under
    // assets/vfx/filename).
    std::string preload(const std::string& ply_file);

    // Returns nullptr on miss. Resolves the input path the same way as
    // preload() so a preset element's raw `ply_file` string matches the
    // prefetched entry.
    const Entry* find(const std::string& ply_file) const;

    void clear() noexcept { entries_.clear(); }
    std::size_t size() const noexcept { return entries_.size(); }

private:
    std::unordered_map<std::string, Entry> entries_;
};

// ── Runtime VFX instance ──

class VfxInstance {
public:
    void init(const VfxPreset& preset, const glm::vec3& position, bool loop,
              float rotation_y = 0.0f,
              const VfxObjectCache* cache = nullptr);

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
