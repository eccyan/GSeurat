#pragma once

// Phase 4c-pbd: PBD splat system.
// Phase 4d-1:  + PbdElementsLoadedEvent consumer.
//
// Mirrors VfxSystem's per-frame compose pattern, but lighter — PBD has
// no per-instance lifecycle, no animator, no distance culling. Callers
// (currently only IslandDemoState's PBD chain demo) buffer their CPU
// splats via push_splats() during state update, and the renderer drains
// them once per frame in update_per_frame(): each Gaussian is encoded
// into RenderState's pbd_writer, and GsRenderer::dispatch_compose_pbd
// copies the resulting slots into dynamic_gaussian_ssbo at offset
// `persistent + vfx_count`.
//
// 4d-1: additionally consumes `PbdElementsLoadedEvent`s from the world's
// event bus (drained once per frame from main_loop), forwarding the
// physics-state + params upload to `GsRenderer::upload_pbd_elements`.
// This decouples scene-load and chunk-load producers from the renderer.
//
// Held by AppBase as a unique_ptr alongside VfxSystem. Constructed in
// init_game_object_system before RenderState exists; late-binds via
// set_render_state() from init_render_state().

#include "gseurat/engine/ecs/events.hpp"
#include "gseurat/engine/ecs/world.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/pbd_events.hpp"
#include "gseurat/engine/render_state.hpp"

#include <cstddef>
#include <cstdint>
#include <vector>

namespace gseurat {

class Renderer;

namespace systems {

class PbdSystem {
public:
    // `renderer` / `render_state` may be null at construction time. The
    // event consumer becomes a no-op without a renderer; the per-frame
    // splat write becomes a no-op without a render_state.
    PbdSystem() noexcept = default;
    PbdSystem(Renderer* renderer, RenderState* render_state) noexcept
        : renderer_(renderer), render_state_(render_state) {}

    void set_renderer(Renderer* r) noexcept { renderer_ = r; }
    void set_render_state(RenderState* rs) noexcept { render_state_ = rs; }

    // Phase 4d-1: drain PbdElementsLoadedEvents from the world's event
    // bus and forward each batch to GsRenderer::upload_pbd_elements.
    // Called once per frame from main_loop.
    void run(ecs::World& world, float dt);

    // Buffer CPU splats for this frame. The renderer drains pending_
    // once per frame via update_per_frame(); callers may push multiple
    // batches per frame and they all coalesce into the same write.
    void push_splats(const Gaussian* data, std::size_t count);

    // Discard any buffered splats without writing them. Used by tests
    // and scene-swap cleanup. update_per_frame() always clears pending_
    // as part of its normal flow, so explicit clear is rarely needed.
    void clear_splats() noexcept { pending_.clear(); }

    // Encode pending_ into pbd_writer(frame_idx) starting at slot 0.
    // Returns the number of slots written (clamped to writer capacity).
    // Always clears pending_, even if render_state_ is null.
    uint32_t update_per_frame(FrameIndex frame_idx);

    // Test seam — size of the per-frame buffer before update_per_frame
    // drains it. Used by unit tests; production callers shouldn't need it.
    std::size_t pending_count() const noexcept { return pending_.size(); }

    // Test seam — drain events without forwarding to the renderer, so
    // tests can assert on event content without a live Vulkan context.
    std::vector<PbdElementsLoadedEvent> drain_events(ecs::World& world) {
        auto& queue = world.events<PbdElementsLoadedEvent>();
        std::vector<PbdElementsLoadedEvent> out;
        queue.read(load_cursor_).for_each(
            [&](const PbdElementsLoadedEvent& evt) { out.push_back(evt); });
        return out;
    }

    ecs::EventCursor& cursor() noexcept { return load_cursor_; }
    const ecs::EventCursor& cursor() const noexcept { return load_cursor_; }

private:
    Renderer* renderer_ = nullptr;
    RenderState* render_state_ = nullptr;
    ecs::EventCursor load_cursor_{};
    std::vector<Gaussian> pending_;
};

}  // namespace systems
}  // namespace gseurat
