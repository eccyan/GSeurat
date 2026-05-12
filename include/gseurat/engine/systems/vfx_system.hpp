#pragma once

// Phase 4a + 4c-vfx-2: VFX system.
//
// 4a: drained `VfxSpawnEvent`s from the world's event bus and pushed
//     constructed `VfxInstance`s into the renderer.
// 4c-vfx-2: full ownership migration of `vfx_instances_` and
//           `GaussianAnimator` out of `Renderer` and into this system.
//           Per-frame, the system packs every active VFX instance's
//           splats (objects + emitter particles) into RenderState's
//           persistent-mapped `vfx_buffer` via `vfx_writer`. The
//           renderer dispatches a GPU compose pass that copies those
//           slots into `dynamic_gaussian_ssbo`, then runs the existing
//           preprocess/sort/raster pipelines on top.
//
// Held by AppBase as a unique_ptr; `run()` fires once per frame from
// the main loop (not the SystemScheduler, per 4a fix). The per-frame
// splat write happens from `update_per_frame()` which is called from
// `Renderer::draw_scene` right before `dispatch_compose_vfx()`.

#include "gseurat/engine/ecs/events.hpp"
#include "gseurat/engine/ecs/world.hpp"
#include "gseurat/engine/gs_animator.hpp"
#include "gseurat/engine/gs_vfx.hpp"
#include "gseurat/engine/render_state.hpp"
#include "gseurat/engine/scene_loader.hpp"
#include "gseurat/engine/vfx_events.hpp"

#include <glm/glm.hpp>

#include <vector>

namespace gseurat {

class Renderer;

namespace systems {

class VfxSystem {
public:
    // `render_state` may be null in tests; per-frame splat writing
    // becomes a no-op in that case while spawn handling still works.
    VfxSystem(Renderer* renderer, RenderState* render_state) noexcept
        : renderer_(renderer), render_state_(render_state) {}

    // VfxSystem is constructed before RenderState in some AppBase init
    // orderings; this setter lets the binding land once both exist.
    // Safe to call repeatedly; pass null to detach.
    void set_render_state(RenderState* rs) noexcept { render_state_ = rs; }

    // Called once per frame from main_loop. Drains pending spawn
    // events and constructs VfxInstances into our owned `instances_`.
    void run(ecs::World& world, float dt);

    // Phase 4c-vfx-2: writes all active VFX splats (objects + emitter
    // particles) into RenderState's vfx_buffer at slots [0..N) and
    // returns N. Returns 0 if no render_state or no active instances.
    // `cull_origin` is camera world position; instances beyond
    // `cull_dist_sq` are not packed (but kept alive). `cull_dist_sq <= 0`
    // disables culling. `frame_idx` selects the per-frame vfx_buffer.
    uint32_t update_per_frame(float dt, FrameIndex frame_idx,
                              const glm::vec3& cull_origin,
                              float cull_dist_sq,
                              bool update_animation,
                              bool update_particles);

    // Ownership-migration API (replaces the matching methods on Renderer).
    void add_instance(VfxInstance&& inst) {
        vfx_instances_.push_back(std::move(inst));
    }
    void clear_instances();
    std::vector<VfxInstance>& instances_mutable() noexcept { return vfx_instances_; }
    const std::vector<VfxInstance>& instances() const noexcept { return vfx_instances_; }

    // VFX-emitted lights — `out` is appended (caller may seed with statics).
    // Caps at `cap` total lights including pre-existing entries.
    void collect_active_lights(std::vector<PointLight>& out, std::size_t cap) const;

    // Test seam (4a): drains and returns spawn events.
    std::vector<VfxSpawnEvent> drain_events(ecs::World& world) {
        auto& queue = world.events<VfxSpawnEvent>();
        std::vector<VfxSpawnEvent> out;
        queue.read(spawn_cursor_).for_each(
            [&](const VfxSpawnEvent& evt) { out.push_back(evt); });
        return out;
    }

    ecs::EventCursor& cursor() noexcept { return spawn_cursor_; }
    const ecs::EventCursor& cursor() const noexcept { return spawn_cursor_; }

private:
    Renderer* renderer_;
    RenderState* render_state_;
    ecs::EventCursor spawn_cursor_{};
    std::vector<VfxInstance> vfx_instances_;
    GaussianAnimator gs_animator_;
    // Scratch CPU buffer reused frame-to-frame to avoid per-frame allocs.
    std::vector<Gaussian> scratch_;
};

}  // namespace systems
}  // namespace gseurat
