#include "gseurat/engine/systems/particle_system.hpp"

#include <algorithm>

namespace gseurat::systems {

void ParticleSystem::add_emitter(const GsEmitterConfig& config) {
    auto& emitter = emitters_.emplace_back();
    emitter.configure(config);
    emitter.set_active(true);
}

uint32_t ParticleSystem::update_per_frame(float dt, FrameIndex frame_idx,
                                           const glm::vec3& cull_origin,
                                           float cull_dist_sq) {
    if (render_state_ == nullptr || emitters_.empty()) {
        // Still tick simulations so off-screen state doesn't freeze
        // — but only if there's no render_state we have nowhere to
        // write anyway. Mirrors pre-refactor "gated on flags.particles"
        // semantics: callers gate by skipping update_per_frame entirely.
        return 0;
    }

    scratch_.clear();
    for (auto& emitter : emitters_) {
        emitter.update(dt);
        if (cull_dist_sq > 0.0f) {
            glm::vec3 d = emitter.position() - cull_origin;
            if (glm::dot(d, d) > cull_dist_sq) continue;
        }
        emitter.gather(scratch_);
    }
    std::erase_if(emitters_,
        [](const GaussianParticleEmitter& e) {
            return !e.active() && e.alive_count() == 0;
        });

    auto writer = render_state_->particles_writer(frame_idx);
    const uint32_t cap = writer.capacity();
    const uint32_t count = static_cast<uint32_t>(scratch_.size());
    const uint32_t live = (count > cap) ? cap : count;
    for (uint32_t i = 0; i < live; ++i) {
        GpuGaussian packed{};
        encode_gaussian(scratch_[i], packed);
        writer.write_at(i, &packed, sizeof(GpuGaussian));
    }
    return live;
}

}  // namespace gseurat::systems
