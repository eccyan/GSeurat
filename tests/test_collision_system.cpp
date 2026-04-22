#include "gseurat/engine/collision/collision_system.hpp"
#include <cstdio>
#include <cmath>

using namespace gseurat;

static int passed = 0;
static int failed = 0;

static void check(bool cond, const char* msg) {
    if (cond) { std::printf("  PASS: %s\n", msg); passed++; }
    else      { std::printf("  FAIL: %s\n", msg); failed++; }
}

static bool approx(float a, float b, float eps = 0.05f) {
    return std::abs(a - b) < eps;
}

// Helper: create an entity with Transform + ColliderComponent
static ecs::Entity make_collider(ecs::World& world,
                                  glm::vec3 pos,
                                  ColliderShape shape,
                                  bool is_dynamic = false,
                                  bool is_trigger = false,
                                  uint32_t mask = 0xFFFFFFFF) {
    ecs::Entity e = world.create();
    ecs::Transform t;
    t.position = coord::WorldPos(pos);
    world.add<ecs::Transform>(e, t);

    ColliderComponent c;
    c.shape = shape;
    c.is_dynamic = is_dynamic;
    c.is_trigger = is_trigger;
    c.collision_mask = mask;
    world.add<ColliderComponent>(e, c);

    return e;
}

int main() {
    std::printf("=== test_collision_system ===\n");

    // Setup: create a shared world with test entities
    // Floor: box at (0,0,0) half_extents (10,0.5,10) - static
    // Wall: box at (5,1,0) half_extents (0.5,2,5) - static
    // Dynamic sphere: sphere at (0,3,0) radius 0.5 - dynamic
    // Trigger zone: box at (0,1,0) half_extents (2,2,2) - static, is_trigger

    // -- Test 1: Cache sizes -------------------------------------------------
    std::printf("\n-- Test 1: Cache sizes --\n");
    {
        ecs::World world;
        make_collider(world, {0, 0, 0}, BoxData{{10.0f, 0.5f, 10.0f}});
        make_collider(world, {5, 1, 0}, BoxData{{0.5f, 2.0f, 5.0f}});
        make_collider(world, {0, 3, 0}, SphereData{0.5f}, /*dynamic=*/true);
        make_collider(world, {0, 1, 0}, BoxData{{2.0f, 2.0f, 2.0f}},
                      /*dynamic=*/false, /*trigger=*/true);

        CollisionSystem cs;
        cs.rebuild_cache(world);

        check(cs.static_cache().size() == 3,
              "static_cache has 3 entries (floor + wall + trigger)");
        check(cs.dynamic_cache().size() == 1,
              "dynamic_cache has 1 entry (sphere)");
        check(!cs.is_dirty(), "dirty flag cleared after rebuild");
    }

    // -- Test 2: Sweep downward hits floor -----------------------------------
    std::printf("\n-- Test 2: Sweep downward hits floor --\n");
    {
        ecs::World world;
        make_collider(world, {0, 0, 0}, BoxData{{10.0f, 0.5f, 10.0f}});
        make_collider(world, {5, 1, 0}, BoxData{{0.5f, 2.0f, 5.0f}});
        make_collider(world, {0, 3, 0}, SphereData{0.5f}, true);
        make_collider(world, {0, 1, 0}, BoxData{{2.0f, 2.0f, 2.0f}},
                      false, true);

        CollisionSystem cs;
        cs.rebuild_cache(world);

        CapsuleData capsule{0.3f, 0.5f};
        auto result = cs.sweep(
            glm::vec3(0, 3, 0), glm::quat(1, 0, 0, 0), capsule,
            glm::vec3(0, -1, 0), 5.0f, 0xFFFFFFFF);

        check(result.has_value(), "sweep down: hit detected");
        if (result) {
            check(approx(result->hit.normal.y, 1.0f, 0.1f),
                  "sweep down: normal ~ (0,1,0)");
            check(result->hit.t < 1.0f, "sweep down: t < 1 (before full distance)");
        }
    }

    // -- Test 3: Sweep into wall ---------------------------------------------
    std::printf("\n-- Test 3: Sweep into wall --\n");
    {
        ecs::World world;
        make_collider(world, {0, 0, 0}, BoxData{{10.0f, 0.5f, 10.0f}});
        make_collider(world, {5, 1, 0}, BoxData{{0.5f, 2.0f, 5.0f}});
        make_collider(world, {0, 3, 0}, SphereData{0.5f}, true);
        make_collider(world, {0, 1, 0}, BoxData{{2.0f, 2.0f, 2.0f}},
                      false, true);

        CollisionSystem cs;
        cs.rebuild_cache(world);

        CapsuleData capsule{0.3f, 0.5f};
        // Capsule at y=1.5 is above the floor (top face at y=0.5).
        // Wall left face at x=4.5. Capsule should hit wall ~4.2 units away.
        auto result = cs.sweep(
            glm::vec3(0, 1.5f, 0), glm::quat(1, 0, 0, 0), capsule,
            glm::vec3(1, 0, 0), 10.0f, 0xFFFFFFFF);

        check(result.has_value(), "sweep into wall: hit detected");
        if (result) {
            check(result->hit.normal.x < -0.5f,
                  "sweep into wall: normal has significant -X component");
            check(result->hit.t < 1.0f,
                  "sweep into wall: t < 1 (hits before full distance)");
        }
    }

    // -- Test 4: Sweep miss (trigger doesn't count as solid) -----------------
    std::printf("\n-- Test 4: Sweep miss (trigger not solid) --\n");
    {
        ecs::World world;
        // Only the trigger zone in the path
        make_collider(world, {0, 1, 0}, BoxData{{2.0f, 2.0f, 2.0f}},
                      false, true);

        CollisionSystem cs;
        cs.rebuild_cache(world);

        CapsuleData capsule{0.3f, 0.5f};
        auto result = cs.sweep(
            glm::vec3(0, 1, -5), glm::quat(1, 0, 0, 0), capsule,
            glm::vec3(0, 0, 1), 3.0f, 0xFFFFFFFF);

        check(!result.has_value(),
              "sweep through trigger zone: no solid hit");
    }

    // -- Test 5: Dynamic sync ------------------------------------------------
    std::printf("\n-- Test 5: Dynamic sync --\n");
    {
        ecs::World world;
        auto sphere_e = make_collider(
            world, {0, 3, 0}, SphereData{0.5f}, true);

        CollisionSystem cs;
        cs.rebuild_cache(world);

        check(approx(cs.dynamic_cache()[0].world_position.y, 3.0f),
              "dynamic sphere initially at y=3");

        // Move the sphere
        auto& t = world.get<ecs::Transform>(sphere_e);
        t.position = coord::WorldPos(0.0f, 5.0f, 0.0f);
        cs.sync_dynamics(world);

        check(approx(cs.dynamic_cache()[0].world_position.y, 5.0f),
              "dynamic sphere at y=5 after sync");
    }

    // -- Test 6: Overlap with trigger ----------------------------------------
    std::printf("\n-- Test 6: Overlap with trigger --\n");
    {
        ecs::World world;
        auto trigger_e = make_collider(
            world, {0, 1, 0}, BoxData{{2.0f, 2.0f, 2.0f}}, false, true);

        CollisionSystem cs;
        cs.rebuild_cache(world);

        AABB query;
        query.min = glm::vec3(-0.5f, 0.5f, -0.5f);
        query.max = glm::vec3(0.5f, 1.5f, 0.5f);
        auto results = cs.overlap_aabb(query, 0xFFFFFFFF);

        check(!results.empty(), "overlap: found at least one result");
        bool found_trigger = false;
        for (const auto& r : results) {
            if (r.entity.id == trigger_e.id && r.is_trigger) {
                found_trigger = true;
            }
        }
        check(found_trigger, "overlap: trigger entity found with is_trigger=true");
    }

    // -- Test 7: Collision mask filter ---------------------------------------
    std::printf("\n-- Test 7: Collision mask filter --\n");
    {
        ecs::World world;
        make_collider(world, {0, 0, 0}, BoxData{{10.0f, 0.5f, 10.0f}});
        make_collider(world, {5, 1, 0}, BoxData{{0.5f, 2.0f, 5.0f}});

        CollisionSystem cs;
        cs.rebuild_cache(world);

        CapsuleData capsule{0.3f, 0.5f};
        auto result = cs.sweep(
            glm::vec3(0, 3, 0), glm::quat(1, 0, 0, 0), capsule,
            glm::vec3(0, -1, 0), 5.0f, 0x0);

        check(!result.has_value(), "sweep with mask=0: no hits");
    }

    // -- Test 8: Mark dirty triggers rebuild ---------------------------------
    std::printf("\n-- Test 8: Mark dirty triggers rebuild --\n");
    {
        ecs::World world;
        make_collider(world, {0, 0, 0}, BoxData{{1.0f, 1.0f, 1.0f}});

        CollisionSystem cs;
        cs.rebuild_cache(world);
        check(!cs.is_dirty(), "not dirty after rebuild");

        cs.mark_dirty();
        check(cs.is_dirty(), "dirty after mark_dirty()");

        // update() should rebuild when dirty
        cs.update(world, 0.016f);
        check(!cs.is_dirty(), "not dirty after update() with dirty flag");
    }

    std::printf("\n=== Results: %d passed, %d failed ===\n", passed, failed);
    return (failed == 0) ? 0 : 1;
}
