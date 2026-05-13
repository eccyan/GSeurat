#pragma once

// Phase 4d-2: Lighting system.
//
// Owns the static point-light set that used to live as
// `Renderer::gs_static_lights_`. Subscribes to `PointLightsLoadedEvent`
// (emitted by scene loader, command dispatcher, and dev panels) and
// performs the per-frame merge with VFX-emitted lights that previously
// sat inline in `Renderer::record_gs_prepass`.
//
// Flow per frame:
//   1. main_loop calls `run(world, dt)` — drains events; an empty
//      payload resets `light_mode` to 0 (preserves command_dispatcher
//      behavior on update_scene_data with no lights).
//   2. `update_per_frame()` (called from `record_gs_prepass`) merges
//      `static_lights_` with VFX-active lights up to 8 entries and
//      pushes the result via `GsRenderer::set_point_lights` if
//      non-empty. Empty result leaves the prior GPU state intact —
//      matches the historical per-frame merge that gated on
//      `!all_lights.empty()`.
//
// Held by AppBase as a unique_ptr alongside VfxSystem / PbdSystem.
// Constructed in init_game_object_system; render_state late-binds in
// init_render_state.

#include "gseurat/engine/ecs/events.hpp"
#include "gseurat/engine/ecs/world.hpp"
#include "gseurat/engine/light_events.hpp"
#include "gseurat/engine/render_state.hpp"
#include "gseurat/engine/types.hpp"

#include <cstddef>
#include <vector>

namespace gseurat {

class Renderer;
namespace systems {

class VfxSystem;

class LightingSystem {
public:
    LightingSystem() noexcept = default;
    LightingSystem(Renderer* renderer, VfxSystem* vfx_system,
                   RenderState* render_state) noexcept
        : renderer_(renderer), vfx_system_(vfx_system),
          render_state_(render_state) {}

    void set_renderer(Renderer* r) noexcept { renderer_ = r; }
    void set_vfx_system(VfxSystem* vs) noexcept { vfx_system_ = vs; }
    void set_render_state(RenderState* rs) noexcept { render_state_ = rs; }

    // Drain PointLightsLoadedEvents — each event REPLACES static_lights_.
    // Empty payload also resets renderer's light_mode to 0 (preserves
    // pre-refactor command_dispatcher::update_scene_data behavior).
    void run(ecs::World& world, float dt);

    // Per-frame merge: static_lights_ ∪ vfx_system_->collect_active_lights
    // (cap 8). If non-empty, push to renderer.gs_renderer().set_point_lights
    // and set light_mode=2 if it was lower. Called from Renderer's
    // record_gs_prepass once per frame.
    void update_per_frame();

    // Direct setter for tests / future bypasses. Production paths emit
    // events; this skips the bus.
    void set_static_lights(std::vector<PointLight> lights) noexcept {
        static_lights_ = std::move(lights);
    }
    const std::vector<PointLight>& static_lights() const noexcept {
        return static_lights_;
    }

    // Test seam — drains and returns events without forwarding.
    std::vector<PointLightsLoadedEvent> drain_events(ecs::World& world) {
        auto& queue = world.events<PointLightsLoadedEvent>();
        std::vector<PointLightsLoadedEvent> out;
        queue.read(load_cursor_).for_each(
            [&](const PointLightsLoadedEvent& evt) { out.push_back(evt); });
        return out;
    }

    ecs::EventCursor& cursor() noexcept { return load_cursor_; }
    const ecs::EventCursor& cursor() const noexcept { return load_cursor_; }

private:
    Renderer* renderer_ = nullptr;
    VfxSystem* vfx_system_ = nullptr;
    RenderState* render_state_ = nullptr;
    ecs::EventCursor load_cursor_{};
    std::vector<PointLight> static_lights_;
};

}  // namespace systems
}  // namespace gseurat
