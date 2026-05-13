#pragma once

// Phase 4e: Gaussian particle system.
//
// Owns the per-scene set of Gaussian particle emitters that used to
// live as `Renderer::gs_particle_emitters_`. Per-frame, ticks each
// emitter, distance-culls, gathers emitted Gaussians, encodes them
// into RenderState's `particles_buffer` via `particles_writer`, and
// returns the slot count for `GsRenderer::dispatch_compose_particles`
// to copy into `dynamic_gaussian_ssbo` after the VFX + PBD prefixes.
//
// Same back-pointer / late-bind pattern as VFX / PBD / Lighting:
// constructed in `AppBase::init_game_object_system` with a possibly-
// null `RenderState*`; `init_render_state` late-binds the writer.

#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/gs_particle.hpp"
#include "gseurat/engine/render_state.hpp"

#include <glm/glm.hpp>

#include <cstddef>
#include <cstdint>
#include <vector>

namespace gseurat::systems {

class ParticleSystem {
public:
    ParticleSystem() noexcept = default;
    explicit ParticleSystem(RenderState* render_state) noexcept
        : render_state_(render_state) {}

    void set_render_state(RenderState* rs) noexcept { render_state_ = rs; }

    // Producer API (replaces Renderer::add_gs_particle_emitter /
    // clear_gs_particle_emitters). The system constructs the emitter
    // in-place to preserve the existing emplace_back pattern.
    void add_emitter(const GsEmitterConfig& config);
    void clear_emitters() noexcept { emitters_.clear(); }

    // Read access (replaces Renderer::gs_particle_emitters() for the
    // 7+ caller sites in demo / staging / dispatcher). Mutating
    // returned vector is permitted but rare — most callers iterate.
    std::vector<GaussianParticleEmitter>& emitters() noexcept { return emitters_; }
    const std::vector<GaussianParticleEmitter>& emitters() const noexcept {
        return emitters_;
    }

    // Per-frame tick. Updates each emitter, gathers Gaussians via
    // emitter.gather, encodes them into RenderState::particles_buffer,
    // erases dead emitters. Returns the slot count actually written
    // (clamped to writer capacity). Returns 0 if render_state_ is null
    // or no emitters are active.
    //
    // `cull_dist_sq <= 0` disables distance culling. `cull_origin` is
    // the camera world position. Distance-culled emitters still tick
    // (so their simulation doesn't freeze when off-screen) but their
    // gathered Gaussians are dropped for this frame.
    uint32_t update_per_frame(float dt, FrameIndex frame_idx,
                              const glm::vec3& cull_origin,
                              float cull_dist_sq);

private:
    RenderState* render_state_ = nullptr;
    std::vector<GaussianParticleEmitter> emitters_;
    // Scratch CPU buffer reused frame-to-frame for emitter.gather.
    std::vector<Gaussian> scratch_;
};

}  // namespace gseurat::systems
