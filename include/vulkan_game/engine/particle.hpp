#pragma once

#include "vulkan_game/engine/sprite_batch.hpp"

#include <array>
#include <glm/glm.hpp>
#include <vector>

namespace vulkan_game {

struct Particle {
    glm::vec3 position{0.0f};
    glm::vec2 velocity{0.0f};
    glm::vec2 acceleration{0.0f};
    glm::vec4 color_start{1.0f};
    glm::vec4 color_end{0.0f};
    float initial_size   = 0.1f;
    float size_end_scale = 0.3f;
    float lifetime       = 0.0f;
    float age            = 0.0f;
    uint32_t tile_id     = 0;
    bool alive           = false;
};

enum class ParticleTile : uint32_t {
    Circle    = 0,
    SoftGlow  = 1,
    Spark     = 2,
    SmokePuff = 3,
};

struct EmitterConfig {
    float spawn_rate              = 10.0f;
    float particle_lifetime_min   = 0.5f;
    float particle_lifetime_max   = 1.5f;

    glm::vec2 velocity_min{-0.2f, 0.0f};
    glm::vec2 velocity_max{ 0.2f, 1.0f};
    glm::vec2 acceleration{0.0f, 0.0f};

    float size_min       = 0.05f;
    float size_max       = 0.15f;
    float size_end_scale = 0.3f;

    glm::vec4 color_start{1.0f, 0.7f, 0.3f, 0.9f};
    glm::vec4 color_end  {1.0f, 0.2f, 0.0f, 0.0f};

    ParticleTile tile = ParticleTile::Circle;
    float z           = -0.05f;

    glm::vec2 spawn_offset_min{-0.1f, -0.1f};
    glm::vec2 spawn_offset_max{ 0.1f,  0.1f};
};

struct Emitter {
    EmitterConfig config;
    glm::vec2 position{0.0f};
    bool active                = true;
    float spawn_accumulator    = 0.0f;
};

class ParticleSystem {
public:
    static constexpr uint32_t kMaxParticles = 300;
    static constexpr uint32_t kAtlasColumns = 4;

    size_t add_emitter(const EmitterConfig& config, glm::vec2 position);
    void set_emitter_position(size_t index, glm::vec2 position);
    void set_emitter_active(size_t index, bool active);
    void update(float dt);
    void generate_draw_infos(std::vector<SpriteDrawInfo>& out) const;

private:
    void spawn_particle(const Emitter& emitter);
    glm::vec2 tile_uv_min(uint32_t tile_id) const;
    glm::vec2 tile_uv_max(uint32_t tile_id) const;
    float rand01();
    float rand_range(float lo, float hi);

    std::vector<Emitter> emitters_;
    std::array<Particle, kMaxParticles> pool_{};
    uint32_t next_spawn_index_ = 0;
    uint32_t rng_state_        = 0x12345678u;
};

}  // namespace vulkan_game
