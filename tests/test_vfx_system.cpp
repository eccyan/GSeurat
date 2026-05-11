// Phase 4a: VfxSystem unit tests.
//
// Exercises the event-bus consumption path (drain_events + cursor) using
// a null-renderer-mode VfxSystem. Production-side preset loading and
// renderer.add_vfx_instance are covered by the demo smoke test, not
// here — those would pull in Vulkan/filesystem and aren't unit-testable.

#include "gseurat/engine/ecs/world.hpp"
#include "gseurat/engine/systems/vfx_system.hpp"
#include "gseurat/engine/vfx_events.hpp"

#include <cassert>
#include <cstdio>

using namespace gseurat;
using namespace gseurat::systems;
using namespace gseurat::ecs;

int main() {
    // 1. Empty world: drain returns nothing, cursor stays at default
    {
        World world;
        VfxSystem sys{nullptr};
        auto out = sys.drain_events(world);
        assert(out.empty());
        std::printf("PASS: empty world drains nothing\n");
    }

    // 2. Producer sends N events; consumer drains all in order
    {
        World world;
        VfxSystem sys{nullptr};

        world.events<VfxSpawnEvent>().send({"a.vfx", {1.f, 0.f, 0.f}, 0.f, false});
        world.events<VfxSpawnEvent>().send({"b.vfx", {2.f, 0.f, 0.f}, 0.5f, true});
        world.events<VfxSpawnEvent>().send({"c.vfx", {3.f, 0.f, 0.f}, 1.f, false});

        auto out = sys.drain_events(world);
        assert(out.size() == 3);
        assert(out[0].vfx_file == "a.vfx" && out[0].position.x == 1.f);
        assert(out[1].vfx_file == "b.vfx" && out[1].loop == true);
        assert(out[2].vfx_file == "c.vfx" && out[2].rotation_y == 1.f);
        std::printf("PASS: 3 events drain in chronological order\n");
    }

    // 3. Re-drain in same frame returns nothing (cursor advanced)
    {
        World world;
        VfxSystem sys{nullptr};

        world.events<VfxSpawnEvent>().send({"x.vfx", {}, 0.f, false});
        auto first = sys.drain_events(world);
        assert(first.size() == 1);

        auto second = sys.drain_events(world);
        assert(second.empty());
        std::printf("PASS: cursor advances within frame, no re-read\n");
    }

    // 4. Events sent across a rotate stay visible to a system whose cursor
    //    survives — emulating the SystemScheduler::run_all rotate at end
    //    of frame (which is also what AppBase wires up by default).
    {
        World world;
        VfxSystem sys{nullptr};

        // Frame N: producer sends; consumer drains.
        world.events<VfxSpawnEvent>().send({"frame_n.vfx", {}, 0.f, false});
        auto n = sys.drain_events(world);
        assert(n.size() == 1 && n[0].vfx_file == "frame_n.vfx");

        // End of frame N: rotate.
        world.rotate_events();

        // Frame N+1: new event sent. Consumer's cursor survived rotate
        // (it's persistent state on the VfxSystem instance).
        world.events<VfxSpawnEvent>().send({"frame_n1.vfx", {}, 0.f, false});
        auto n1 = sys.drain_events(world);
        assert(n1.size() == 1);
        assert(n1[0].vfx_file == "frame_n1.vfx");
        std::printf("PASS: cursor survives rotate, no duplicate spawns\n");
    }

    // 5. Multiple drain calls within one frame don't re-read events
    //    (mirror of test 3 with a denser send pattern).
    {
        World world;
        VfxSystem sys{nullptr};

        world.events<VfxSpawnEvent>().send({"a.vfx", {}, 0.f, false});
        world.events<VfxSpawnEvent>().send({"b.vfx", {}, 0.f, false});
        auto first = sys.drain_events(world);
        assert(first.size() == 2);

        world.events<VfxSpawnEvent>().send({"c.vfx", {}, 0.f, false});
        auto second = sys.drain_events(world);
        assert(second.size() == 1);
        assert(second[0].vfx_file == "c.vfx");
        std::printf("PASS: drain only returns events sent since last drain\n");
    }

    // 6. Two independent VfxSystem instances each get their own view of
    //    the event stream (separate cursors). Validates that events
    //    aren't consumed destructively from the queue.
    {
        World world;
        VfxSystem a{nullptr};
        VfxSystem b{nullptr};

        world.events<VfxSpawnEvent>().send({"shared.vfx", {}, 0.f, false});

        auto from_a = a.drain_events(world);
        auto from_b = b.drain_events(world);
        assert(from_a.size() == 1);
        assert(from_b.size() == 1);  // b's cursor was independent
        assert(from_a[0].vfx_file == "shared.vfx");
        assert(from_b[0].vfx_file == "shared.vfx");
        std::printf("PASS: independent cursors get independent views\n");
    }

    std::printf("\nALL VFX SYSTEM TESTS PASSED\n");
    return 0;
}
