#include "vulkan_game/engine/particle.hpp"

namespace vulkan_game {

size_t ParticleSystem::add_emitter(const EmitterConfig& config, glm::vec2 position) {
    emitters_.push_back(Emitter{config, position, true, 0.0f});
    return emitters_.size() - 1;
}

void ParticleSystem::set_emitter_position(size_t index, glm::vec2 position) {
    if (index < emitters_.size()) {
        emitters_[index].position = position;
    }
}

void ParticleSystem::set_emitter_active(size_t index, bool active) {
    if (index < emitters_.size()) {
        emitters_[index].active = active;
    }
}

float ParticleSystem::rand01() {
    rng_state_ ^= rng_state_ << 13;
    rng_state_ ^= rng_state_ >> 17;
    rng_state_ ^= rng_state_ << 5;
    return static_cast<float>(rng_state_ & 0x00FFFFFFu) / static_cast<float>(0x00FFFFFFu);
}

float ParticleSystem::rand_range(float lo, float hi) {
    return lo + rand01() * (hi - lo);
}

void ParticleSystem::spawn_particle(const Emitter& emitter) {
    auto& p         = pool_[next_spawn_index_];
    next_spawn_index_ = (next_spawn_index_ + 1) % kMaxParticles;

    const auto& cfg = emitter.config;

    p.alive          = true;
    p.age            = 0.0f;
    p.lifetime       = rand_range(cfg.particle_lifetime_min, cfg.particle_lifetime_max);
    p.tile_id        = static_cast<uint32_t>(cfg.tile);
    p.acceleration   = cfg.acceleration;
    p.color_start    = cfg.color_start;
    p.color_end      = cfg.color_end;
    p.size_end_scale = cfg.size_end_scale;

    p.position.x = emitter.position.x + rand_range(cfg.spawn_offset_min.x, cfg.spawn_offset_max.x);
    p.position.y = emitter.position.y + rand_range(cfg.spawn_offset_min.y, cfg.spawn_offset_max.y);
    p.position.z = cfg.z;

    p.velocity.x = rand_range(cfg.velocity_min.x, cfg.velocity_max.x);
    p.velocity.y = rand_range(cfg.velocity_min.y, cfg.velocity_max.y);

    float s        = rand_range(cfg.size_min, cfg.size_max);
    p.initial_size = s;
}

void ParticleSystem::update(float dt) {
    for (auto& emitter : emitters_) {
        if (!emitter.active) continue;

        emitter.spawn_accumulator += emitter.config.spawn_rate * dt;
        while (emitter.spawn_accumulator >= 1.0f) {
            emitter.spawn_accumulator -= 1.0f;
            spawn_particle(emitter);
        }
    }

    for (auto& p : pool_) {
        if (!p.alive) continue;

        p.age += dt;
        if (p.age >= p.lifetime) {
            p.alive = false;
            continue;
        }

        p.velocity.x += p.acceleration.x * dt;
        p.velocity.y += p.acceleration.y * dt;
        p.position.x += p.velocity.x * dt;
        p.position.y += p.velocity.y * dt;
    }
}

void ParticleSystem::generate_draw_infos(std::vector<SpriteDrawInfo>& out) const {
    for (const auto& p : pool_) {
        if (!p.alive) continue;

        float t = p.age / p.lifetime;

        SpriteDrawInfo info{};
        info.position = p.position;

        float s = p.initial_size * (1.0f - t * (1.0f - p.size_end_scale));
        info.size = {s, s};

        info.color = p.color_start * (1.0f - t) + p.color_end * t;

        info.uv_min = tile_uv_min(p.tile_id);
        info.uv_max = tile_uv_max(p.tile_id);

        out.push_back(info);
    }
}

glm::vec2 ParticleSystem::tile_uv_min(uint32_t tile_id) const {
    float col = static_cast<float>(tile_id % kAtlasColumns);
    return {col / static_cast<float>(kAtlasColumns), 0.0f};
}

glm::vec2 ParticleSystem::tile_uv_max(uint32_t tile_id) const {
    float col = static_cast<float>(tile_id % kAtlasColumns) + 1.0f;
    return {col / static_cast<float>(kAtlasColumns), 1.0f};
}

void ParticleSystem::set_emitter_config(size_t index, const EmitterConfig& config) {
    if (index < emitters_.size()) {
        emitters_[index].config = config;
    }
}

void ParticleSystem::remove_emitter(size_t index) {
    if (index < emitters_.size()) {
        emitters_[index].active = false;
        emitters_[index].config.spawn_rate = 0.0f;
    }
}

void ParticleSystem::clear() {
    emitters_.clear();
    for (auto& p : pool_) p.alive = false;
    next_spawn_index_ = 0;
}

}  // namespace vulkan_game
