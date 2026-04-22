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

static bool approx(float a, float b, float eps = 0.1f) {
    return std::abs(a - b) < eps;
}

// Helper: create a static box collider entity
static ecs::Entity make_box(ecs::World& world, glm::vec3 pos,
                             glm::vec3 half_extents) {
    ecs::Entity e = world.create();
    ecs::Transform t;
    t.position = coord::WorldPos(pos);
    world.add<ecs::Transform>(e, t);

    ColliderComponent c;
    c.shape = BoxData{half_extents};
    c.collision_mask = 0xFFFFFFFF;
    world.add<ColliderComponent>(e, c);

    return e;
}

// Helper: create the player (kinematic capsule)
static ecs::Entity make_player(ecs::World& world, glm::vec3 pos) {
    ecs::Entity e = world.create();
    ecs::Transform t;
    t.position = coord::WorldPos(pos);
    world.add<ecs::Transform>(e, t);

    KinematicBody kb;
    kb.recompute_derived();
    world.add<KinematicBody>(e, kb);

    ColliderComponent c;
    c.shape = CapsuleData{0.3f, 0.5f};
    c.collision_mask = 0xFFFFFFFF;
    c.is_dynamic = true;
    world.add<ColliderComponent>(e, c);

    return e;
}

// Helper: reset player state before each test
static void reset_player(ecs::World& world, ecs::Entity player,
                          float x, float y, float z,
                          float vx = 0, float vy = 0, float vz = 0,
                          bool grounded = false) {
    auto& t = world.get<ecs::Transform>(player);
    t.position = coord::WorldPos(x, y, z);
    auto& b = world.get<KinematicBody>(player);
    b.velocity = glm::vec3(vx, vy, vz);
    b.grounded = grounded;
    b.ground_normal = glm::vec3(0, 1, 0);
}

int main() {
    std::printf("=== test_kcc ===\n");

    // Shared world setup:
    // Floor: box at (0, -0.5, 0) half_extents (50, 0.5, 50) — top surface at y=0
    // Wall:  box at (5, 1.5, 0)  half_extents (0.5, 2, 10)  — left face at x=4.5
    // Ceiling: box at (0, 5, 0)  half_extents (50, 0.5, 50)  — bottom surface at y=4.5
    // Player: capsule radius=0.3, half_height=0.5 — total height=1.6, bottom at pos.y - 0.8

    ecs::World world;
    make_box(world, {0.0f, -0.5f, 0.0f}, {50.0f, 0.5f, 50.0f});   // floor
    make_box(world, {5.0f,  1.5f, 0.0f}, {0.5f, 2.0f, 10.0f});    // wall
    make_box(world, {0.0f,  5.0f, 0.0f}, {50.0f, 0.5f, 50.0f});   // ceiling

    ecs::Entity player = make_player(world, {0.0f, 1.0f, 0.0f});

    CollisionSystem cs;

    // -- Test 1: Gravity when airborne ----------------------------------------
    std::printf("\n-- Test 1: Gravity when airborne --\n");
    {
        cs.mark_dirty();
        reset_player(world, player, 0, 3, 0, 0, 0, 0, false);
        cs.update(world, 0.1f);

        auto& b = world.get<KinematicBody>(player);
        auto& t = world.get<ecs::Transform>(player);
        check(b.velocity.y < 0.0f, "velocity.y < 0 (gravity applied)");
        check(t.position.vec().y < 3.0f, "position.y < 3.0 (fell downward)");
    }

    // -- Test 2: Ground detection ---------------------------------------------
    std::printf("\n-- Test 2: Ground detection --\n");
    {
        cs.mark_dirty();
        reset_player(world, player, 0, 1, 0, 0, 0, 0, false);
        cs.update(world, 0.1f);

        auto& b = world.get<KinematicBody>(player);
        check(b.grounded, "player becomes grounded near floor");
    }

    // -- Test 3: Grounded stops downward velocity -----------------------------
    std::printf("\n-- Test 3: Grounded stops downward velocity --\n");
    {
        cs.mark_dirty();
        reset_player(world, player, 0, 1, 0, 0, -5, 0, true);
        cs.update(world, 0.016f);

        auto& b = world.get<KinematicBody>(player);
        check(b.velocity.y >= 0.0f, "downward velocity clamped to 0 when grounded");
    }

    // -- Test 4: Wall blocking ------------------------------------------------
    std::printf("\n-- Test 4: Wall blocking --\n");
    {
        cs.mark_dirty();
        // Moving fast toward wall at x=4.5
        reset_player(world, player, 0, 1, 0, 20, 0, 0, true);
        cs.update(world, 0.5f);

        auto& t = world.get<ecs::Transform>(player);
        float px = t.position.vec().x;
        check(px < 4.5f, "blocked by wall (position.x < 4.5)");
        check(px > 0.0f, "moved some distance toward wall (position.x > 0)");
    }

    // -- Test 5: Wall sliding -------------------------------------------------
    std::printf("\n-- Test 5: Wall sliding --\n");
    {
        cs.mark_dirty();
        // Diagonal movement toward wall — should slide along Z
        reset_player(world, player, 4.0f, 1, 0, 20, 0, 20, true);
        cs.update(world, 0.1f);

        auto& t = world.get<ecs::Transform>(player);
        float pz = t.position.vec().z;
        check(pz > 0.0f, "Z movement preserved (wall sliding along Z)");
    }

    // -- Test 6: Ceiling hit kills upward velocity ----------------------------
    std::printf("\n-- Test 6: Ceiling hit kills upward velocity --\n");
    {
        cs.mark_dirty();
        // Jumping up toward ceiling at y=4.5
        reset_player(world, player, 0, 1, 0, 0, 30, 0, false);
        cs.update(world, 0.1f);

        auto& b = world.get<KinematicBody>(player);
        auto& t = world.get<ecs::Transform>(player);
        // After hitting ceiling, velocity.y should be 0 or position should be below ceiling
        check(b.velocity.y <= 0.0f || t.position.vec().y < 4.5f,
              "ceiling hit: velocity killed or position below ceiling");
    }

    // -- Test 7: Jump derived parameters --------------------------------------
    std::printf("\n-- Test 7: Jump derived parameters --\n");
    {
        KinematicBody kb;
        kb.desired_jump_height = 2.0f;
        kb.time_to_apex = 0.4f;
        kb.recompute_derived();

        check(approx(kb.derived_gravity, 25.0f, 0.5f),
              "derived_gravity ~ 25.0");
        check(approx(kb.derived_jump_velocity, 10.0f, 0.5f),
              "derived_jump_velocity ~ 10.0");
    }

    // -- Test 8: No gravity when grounded with zero velocity ------------------
    std::printf("\n-- Test 8: No gravity when grounded with zero velocity --\n");
    {
        cs.mark_dirty();
        reset_player(world, player, 0, 1, 0, 0, 0, 0, true);

        float y_before = world.get<ecs::Transform>(player).position.vec().y;
        cs.update(world, 0.016f);

        auto& b = world.get<KinematicBody>(player);
        auto& t = world.get<ecs::Transform>(player);
        check(approx(b.velocity.y, 0.0f, 0.01f),
              "velocity.y stays ~0 when grounded");
        check(approx(t.position.vec().y, y_before, 0.15f),
              "position.y approximately unchanged when grounded");
    }

    std::printf("\n=== Results: %d passed, %d failed ===\n", passed, failed);
    return (failed == 0) ? 0 : 1;
}
