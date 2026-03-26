#pragma once

#include "gseurat/engine/gaussian_cloud.hpp"

#include <array>
#include <glm/glm.hpp>
#include <glm/gtc/quaternion.hpp>
#include <optional>
#include <string>
#include <vector>

namespace gseurat {

struct GsParticle {
    glm::vec3 position{0.0f};
    glm::vec3 velocity{0.0f};
    glm::vec3 acceleration{0.0f};
    glm::vec3 color_start{1.0f};
    glm::vec3 color_end{1.0f};
    glm::vec3 scale_start{0.5f};
    glm::vec3 scale_end{0.0f};
    glm::quat rotation{1.0f, 0.0f, 0.0f, 0.0f};
    float opacity_start = 1.0f;
    float opacity_end = 0.0f;
    float emission = 0.0f;
    float lifetime = 1.0f;
    float age = 0.0f;
    bool alive = false;
};

struct GsEmitterConfig {
    float spawn_rate = 10.0f;
    float lifetime_min = 0.5f;
    float lifetime_max = 1.5f;

    glm::vec3 position{0.0f};
    glm::vec3 velocity_min{-1.0f, 1.0f, -1.0f};
    glm::vec3 velocity_max{ 1.0f, 3.0f,  1.0f};
    glm::vec3 acceleration{0.0f, -9.8f, 0.0f};  // gravity

    glm::vec3 color_start{1.0f, 0.8f, 0.3f};
    glm::vec3 color_end{1.0f, 0.2f, 0.0f};
    glm::vec3 scale_min{0.3f};
    glm::vec3 scale_max{0.6f};
    float scale_end_factor = 0.0f;  // 0 = shrink to nothing
    float opacity_start = 1.0f;
    float opacity_end = 0.0f;
    float emission = 0.0f;
    glm::vec3 spawn_offset_min{0.0f};
    glm::vec3 spawn_offset_max{0.0f};
    float burst_duration = 0.0f;  // >0 = auto-deactivate after this many seconds, 0 = continuous
};

class GaussianParticleEmitter {
public:
    static constexpr uint32_t kMaxGsParticles = 2048;

    void configure(const GsEmitterConfig& config);
    void set_position(const glm::vec3& pos);
    void set_active(bool active);
    bool active() const { return active_; }
    const GsEmitterConfig& config() const { return config_; }
    void update(float dt);

    // Append alive particles as Gaussians to output. Returns count appended.
    uint32_t gather(std::vector<Gaussian>& out) const;
    void clear();

    uint32_t alive_count() const;

private:
    float random_float(float min_val, float max_val);
    glm::vec3 random_vec3(const glm::vec3& min_val, const glm::vec3& max_val);
    void spawn_particle();

    GsEmitterConfig config_;
    std::array<GsParticle, kMaxGsParticles> pool_{};
    uint32_t next_index_ = 0;
    bool active_ = false;
    float spawn_accum_ = 0.0f;
    float burst_elapsed_ = 0.0f;
    uint32_t rng_ = 0x12345678u;
};

// --- Preset emitter configurations ---

GsEmitterConfig gs_preset_dust_puff();
GsEmitterConfig gs_preset_spark_shower();
GsEmitterConfig gs_preset_magic_spiral();
GsEmitterConfig gs_preset_fire();
GsEmitterConfig gs_preset_smoke();
GsEmitterConfig gs_preset_rain();
GsEmitterConfig gs_preset_snow();
GsEmitterConfig gs_preset_leaves();
GsEmitterConfig gs_preset_fireflies();
GsEmitterConfig gs_preset_steam();
GsEmitterConfig gs_preset_waterfall_mist();

// Resolve a preset name to its config. Returns std::nullopt if name is unknown.
std::optional<GsEmitterConfig> gs_resolve_preset(const std::string& name);

}  // namespace gseurat
