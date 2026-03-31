#include "gseurat/engine/island_systems.hpp"
#include "gseurat/engine/island_components.hpp"
#include "gseurat/engine/ecs/default_components.hpp"
#include "gseurat/engine/ecs/world.hpp"
#include <cassert>
#include <cmath>
#include <cstdio>

using namespace gseurat;

int main() {
    // 1. ProximityTrigger: entity in range -> triggered
    {
        ecs::World world;
        auto player = world.create();
        world.add<PlayerController>(player, {});
        world.add<ecs::Transform>(player, {{5.0f, 0.0f, 5.0f}, {1.0f, 1.0f}});

        auto trigger = world.create();
        world.add<ProximityTrigger>(trigger, {10.0f, false, false, false});
        world.add<ecs::Transform>(trigger, {{8.0f, 0.0f, 5.0f}, {1.0f, 1.0f}});

        proximity_trigger_system(world, 0.016f);
        assert(world.get<ProximityTrigger>(trigger).triggered == true);
        std::printf("PASS: entity in range triggers\n");
    }

    // 2. ProximityTrigger: entity out of range -> not triggered
    {
        ecs::World world;
        auto player = world.create();
        world.add<PlayerController>(player, {});
        world.add<ecs::Transform>(player, {{0.0f, 0.0f, 0.0f}, {1.0f, 1.0f}});

        auto trigger = world.create();
        world.add<ProximityTrigger>(trigger, {5.0f, false, false, false});
        world.add<ecs::Transform>(trigger, {{20.0f, 0.0f, 20.0f}, {1.0f, 1.0f}});

        proximity_trigger_system(world, 0.016f);
        assert(world.get<ProximityTrigger>(trigger).triggered == false);
        std::printf("PASS: entity out of range not triggered\n");
    }

    // 3. One-shot: stays triggered after player moves away
    {
        ecs::World world;
        auto player = world.create();
        world.add<PlayerController>(player, {});
        world.add<ecs::Transform>(player, {{5.0f, 0.0f, 5.0f}, {1.0f, 1.0f}});

        auto trigger = world.create();
        world.add<ProximityTrigger>(trigger, {10.0f, true, false, false});
        world.add<ecs::Transform>(trigger, {{6.0f, 0.0f, 5.0f}, {1.0f, 1.0f}});

        // First frame: in range -> triggered + was_triggered
        proximity_trigger_system(world, 0.016f);
        assert(world.get<ProximityTrigger>(trigger).triggered == true);
        assert(world.get<ProximityTrigger>(trigger).was_triggered == true);

        // Move player far away
        world.get<ecs::Transform>(player).position = {100.0f, 0.0f, 100.0f};

        // Second frame: out of range but one_shot -> still triggered
        proximity_trigger_system(world, 0.016f);
        assert(world.get<ProximityTrigger>(trigger).triggered == true);
        std::printf("PASS: one-shot stays triggered\n");
    }

    // 4. No player -> no crash
    {
        ecs::World world;
        auto trigger = world.create();
        world.add<ProximityTrigger>(trigger, {5.0f, false, false, false});
        world.add<ecs::Transform>(trigger, {{0.0f, 0.0f, 0.0f}, {1.0f, 1.0f}});

        proximity_trigger_system(world, 0.016f);
        assert(world.get<ProximityTrigger>(trigger).triggered == false);
        std::printf("PASS: no player does not crash\n");
    }

    // 5. EmissiveToggle ramps toward target when triggered
    {
        ecs::World world;
        auto player = world.create();
        world.add<PlayerController>(player, {});
        world.add<ecs::Transform>(player, {{0.0f, 0.0f, 0.0f}, {1.0f, 1.0f}});

        auto crystal = world.create();
        world.add<ProximityTrigger>(crystal, {10.0f, false, true, false});
        world.add<EmissiveToggle>(crystal, {2.0f, 0.3f, 0.5f, 1.0f, 3.0f, 0.0f});
        world.add<ecs::Transform>(crystal, {{1.0f, 0.0f, 0.0f}, {1.0f, 1.0f}});

        emissive_toggle_system(world, 1.0f);
        float em = world.get<EmissiveToggle>(crystal).current_emission;
        assert(em > 0.0f);
        std::printf("PASS: emissive ramps up when triggered (emission=%.2f)\n", em);
    }

    // 6. EmissiveToggle ramps down when not triggered
    {
        ecs::World world;
        auto player = world.create();
        world.add<PlayerController>(player, {});
        world.add<ecs::Transform>(player, {{0.0f, 0.0f, 0.0f}, {1.0f, 1.0f}});

        auto crystal = world.create();
        world.add<ProximityTrigger>(crystal, {5.0f, false, false, false});
        world.add<EmissiveToggle>(crystal, {2.0f, 1.0f, 1.0f, 1.0f, 3.0f, 2.0f});
        world.add<ecs::Transform>(crystal, {{100.0f, 0.0f, 0.0f}, {1.0f, 1.0f}});

        emissive_toggle_system(world, 1.0f);
        float em = world.get<EmissiveToggle>(crystal).current_emission;
        assert(em < 2.0f);
        std::printf("PASS: emissive ramps down when not triggered (emission=%.2f)\n", em);
    }

    // 7. LinkedTrigger activates target's ProximityTrigger
    {
        ecs::World world;

        // Target entity (no player proximity needed - activated by link)
        auto target = world.create();
        world.add<ProximityTrigger>(target, {5.0f, false, false, false});
        world.add<EmissiveToggle>(target, {3.0f, 1.0f, 1.0f, 1.0f, 5.0f, 0.0f});
        world.add<ecs::Transform>(target, {{50.0f, 0.0f, 50.0f}, {1.0f, 1.0f}});

        // Source entity with LinkedTrigger + ProximityTrigger (already triggered)
        auto source = world.create();
        world.add<ProximityTrigger>(source, {10.0f, false, true, false});
        world.add<LinkedTrigger>(source, {target.id, false});
        world.add<ecs::Transform>(source, {{0.0f, 0.0f, 0.0f}, {1.0f, 1.0f}});

        linked_trigger_system(world, 0.016f);

        assert(world.get<ProximityTrigger>(target).triggered == true);
        assert(world.get<ProximityTrigger>(target).was_triggered == true);
        assert(world.get<LinkedTrigger>(source).fired == true);
        // EmissiveToggle should be set directly
        assert(world.get<EmissiveToggle>(target).current_emission == 3.0f);
        std::printf("PASS: linked trigger activates target\n");
    }

    // 8. LinkedTrigger does not fire when source is not triggered
    {
        ecs::World world;

        auto target = world.create();
        world.add<ProximityTrigger>(target, {5.0f, false, false, false});
        world.add<ecs::Transform>(target, {{50.0f, 0.0f, 50.0f}, {1.0f, 1.0f}});

        auto source = world.create();
        world.add<ProximityTrigger>(source, {10.0f, false, false, false}); // not triggered
        world.add<LinkedTrigger>(source, {target.id, false});
        world.add<ecs::Transform>(source, {{0.0f, 0.0f, 0.0f}, {1.0f, 1.0f}});

        linked_trigger_system(world, 0.016f);

        assert(world.get<ProximityTrigger>(target).triggered == false);
        assert(world.get<LinkedTrigger>(source).fired == false);
        std::printf("PASS: linked trigger does not fire when source not triggered\n");
    }

    // 9. LinkedTrigger fires only once
    {
        ecs::World world;

        auto target = world.create();
        world.add<ProximityTrigger>(target, {5.0f, false, false, false});
        world.add<ecs::Transform>(target, {{50.0f, 0.0f, 50.0f}, {1.0f, 1.0f}});

        auto source = world.create();
        world.add<ProximityTrigger>(source, {10.0f, false, true, false});
        world.add<LinkedTrigger>(source, {target.id, false});
        world.add<ecs::Transform>(source, {{0.0f, 0.0f, 0.0f}, {1.0f, 1.0f}});

        linked_trigger_system(world, 0.016f);
        assert(world.get<LinkedTrigger>(source).fired == true);

        // Reset target trigger manually
        world.get<ProximityTrigger>(target).triggered = false;
        world.get<ProximityTrigger>(target).was_triggered = false;

        // Run again - should NOT fire again
        linked_trigger_system(world, 0.016f);
        assert(world.get<ProximityTrigger>(target).triggered == false);
        std::printf("PASS: linked trigger fires only once\n");
    }

    std::printf("\nAll island system tests passed.\n");
    return 0;
}
