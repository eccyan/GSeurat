#pragma once

// Phase 4a: VFX spawn system.
//
// Drains pending VfxSpawnEvents from the world's event bus and pushes
// constructed VfxInstances into the renderer. Persistent across
// frames so its cursor doesn't re-process already-spawned events.
//
// Held by AppBase as a unique_ptr; registered with SystemScheduler so
// run() fires once per frame after the command dispatcher has had a
// chance to send events. Same-frame visibility: producer (dispatcher)
// → events → consumer (this system) → renderer all complete inside
// one tick of the main loop.

#include "gseurat/engine/ecs/events.hpp"
#include "gseurat/engine/ecs/world.hpp"
#include "gseurat/engine/vfx_events.hpp"

#include <vector>

namespace gseurat {

class Renderer;

namespace systems {

class VfxSystem {
public:
    // renderer may be null in tests; run() becomes a no-op in that case
    // after drain_events has been called for cursor advancement.
    explicit VfxSystem(Renderer* renderer) noexcept : renderer_(renderer) {}

    // Called once per frame by SystemScheduler::run_all. Defined in
    // vfx_system.cpp where the full Renderer header is available.
    void run(ecs::World& world, float dt);

    // Test seam: drains pending events and returns them in chronological
    // order, advancing the cursor in place. Header-only so test targets
    // don't have to link against renderer.cpp (which transitively pulls
    // in GLFW/Vulkan).
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
    ecs::EventCursor spawn_cursor_{};
};

}  // namespace systems
}  // namespace gseurat
