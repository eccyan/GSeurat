#pragma once

// Phase 4c-pbd: PBD splat system.
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
// Held by AppBase as a unique_ptr alongside VfxSystem. Constructed in
// init_game_object_system before RenderState exists; late-binds via
// set_render_state() from init_render_state().

#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/render_state.hpp"

#include <cstddef>
#include <cstdint>
#include <vector>

namespace gseurat {
namespace systems {

class PbdSystem {
public:
    // `render_state` may be null at construction time. Per-frame splat
    // writes become a no-op until set_render_state() binds it.
    PbdSystem() noexcept = default;
    explicit PbdSystem(RenderState* render_state) noexcept
        : render_state_(render_state) {}

    void set_render_state(RenderState* rs) noexcept { render_state_ = rs; }

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

private:
    RenderState* render_state_ = nullptr;
    std::vector<Gaussian> pending_;
};

}  // namespace systems
}  // namespace gseurat
