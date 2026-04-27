// KCC Integration Test Suite — headless physics simulation for CI.
// Automates the four Exploratory Testing Charters:
//   Charter 1+4: Slope tracking & zero jitter
//   Charter 2:   Orbital drop / zero tunneling
//   Charter 3:   Seamless heightfield-to-primitive transition
//   Charter 5:   Depenetration recovery (from the Trap A fix)
//
// All tests bypass Vulkan/GLFW. Run: ctest -R test_kcc_integration -V

#include "gseurat/engine/collision/collision_system.hpp"
#include "gseurat/engine/ecs/components/heightfield_component.hpp"
#include "gseurat/engine/ecs/components/kinematic_body.hpp"
#include "gseurat/engine/ecs/components/collider_component.hpp"

#include <cassert>
#include <cmath>
#include <cstdio>
#include <vector>

using namespace gseurat;

// ═══════════════════════════════════════════════════════════════════════════════
//  Test harness
// ═══════════════════════════════════════════════════════════════════════════════

static int g_passed = 0;
static int g_failed = 0;

static void check(bool cond, const char* msg) {
    if (cond) { std::printf("    PASS: %s\n", msg); g_passed++; }
    else      { std::printf("    FAIL: %s\n", msg); g_failed++; }
}

static bool approx(float a, float b, float eps = 0.05f) {
    return std::abs(a - b) < eps;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Shared helpers
// ═══════════════════════════════════════════════════════════════════════════════

static constexpr float kCapRadius     = 0.3f;
static constexpr float kCapHalfHeight = 0.5f;
static constexpr float kCapBottomOff  = kCapHalfHeight + kCapRadius;  // 0.8
static constexpr float kDt            = 1.0f / 60.0f;

/// Create a player entity with KinematicBody + capsule ColliderComponent.
static ecs::Entity make_player(ecs::World& world, const glm::vec3& pos) {
    auto e = world.create();

    ecs::Transform t;
    t.position = coord::WorldPos(pos);
    world.add<ecs::Transform>(e, t);

    KinematicBody kb;
    kb.desired_jump_height = 2.0f;
    kb.time_to_apex = 0.4f;
    kb.recompute_derived();
    world.add<KinematicBody>(e, kb);

    ColliderComponent cc;
    cc.shape = CapsuleData{kCapRadius, kCapHalfHeight};
    cc.is_dynamic = true;
    cc.collision_mask = 0xFFFFFFFF;
    world.add<ColliderComponent>(e, cc);

    return e;
}

/// Create a static box collider entity (floor, wall, ramp, etc.).
static ecs::Entity make_box(ecs::World& world, const glm::vec3& pos,
                             const glm::vec3& half_extents,
                             const glm::vec3& offset = glm::vec3(0.0f)) {
    auto e = world.create();

    ecs::Transform t;
    t.position = coord::WorldPos(pos);
    world.add<ecs::Transform>(e, t);

    ColliderComponent cc;
    cc.shape = BoxData{half_extents};
    cc.offset = offset;
    cc.collision_mask = 0xFFFFFFFF;
    world.add<ColliderComponent>(e, cc);

    return e;
}

/// Create a heightfield entity with programmatic sample data.
/// The `sample_fn` callback receives normalized (u,v) in [0,1] and returns
/// a uint16 height sample.
static ecs::Entity make_heightfield(
    ecs::World& world,
    const glm::vec3& origin, float width, float length,
    float min_height, float max_height,
    uint32_t resolution,
    uint16_t (*sample_fn)(float u, float v))
{
    auto e = world.create();

    ecs::Transform t;
    t.position = coord::WorldPos(origin);
    world.add<ecs::Transform>(e, t);

    HeightfieldComponent hf;
    hf.image_path = "procedural";
    hf.width = width;
    hf.length = length;
    hf.min_height = min_height;
    hf.max_height = max_height;
    hf.collision_mask = 0xFFFFFFFF;

    hf.data.img_width = resolution;
    hf.data.img_height = resolution;
    hf.data.samples.resize(static_cast<size_t>(resolution) * resolution);

    for (uint32_t iz = 0; iz < resolution; ++iz) {
        for (uint32_t ix = 0; ix < resolution; ++ix) {
            float u = static_cast<float>(ix) / static_cast<float>(resolution - 1);
            float v = static_cast<float>(iz) / static_cast<float>(resolution - 1);
            hf.data.samples[iz * resolution + ix] = sample_fn(u, v);
        }
    }

    hf.world_aabb.min = origin + glm::vec3(0.0f, min_height, 0.0f);
    hf.world_aabb.max = origin + glm::vec3(width, max_height, length);

    world.add<HeightfieldComponent>(e, hf);
    return e;
}

/// Tick the KCC for N frames, injecting horizontal velocity each frame.
/// Returns per-frame Y positions.
static std::vector<float> tick_frames(
    CollisionSystem& cs, ecs::World& world, ecs::Entity player,
    int num_frames, float vx, float vz, float dt = kDt)
{
    std::vector<float> ys;
    ys.reserve(static_cast<size_t>(num_frames));

    for (int i = 0; i < num_frames; ++i) {
        auto* kb = world.try_get<KinematicBody>(player);
        kb->velocity.x = vx;
        kb->velocity.z = vz;

        cs.update(world, dt);

        float y = world.get<ecs::Transform>(player).position.vec().y;
        ys.push_back(y);
    }
    return ys;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Charter 1+4: Slope Tracking & Zero Jitter
// ═══════════════════════════════════════════════════════════════════════════════

static void test_slope_tracking() {
    std::printf("\n── Charter 1+4: Slope Tracking & Zero Jitter ──\n\n");

    // Heightfield: 20×20 world units, height ramps from 0.0 at X=0 to 5.0 at X=20.
    // Slope angle ≈ atan(5/20) ≈ 14° — well within the 45° walkable threshold.
    ecs::World world;

    auto terrain = make_heightfield(
        world,
        glm::vec3(0.0f),  // origin
        20.0f, 20.0f,     // width, length
        0.0f, 5.0f,       // min_height, max_height
        16,                // 16×16 grid
        [](float u, float /*v*/) -> uint16_t {
            // Linear ramp along X: sample = u * 65535
            return static_cast<uint16_t>(u * 65535.0f);
        });

    // Spawn player at X=2 on the slope. Terrain height at X=2 = (2/20)*5 = 0.5
    float terrain_y_at_start = 0.5f;
    float spawn_y = terrain_y_at_start + kCapBottomOff + 0.02f;  // tiny gap
    auto player = make_player(world, glm::vec3(2.0f, spawn_y, 10.0f));

    CollisionSystem cs;
    cs.rebuild_cache(world);

    // Move +X at 5 m/s for 20 frames
    constexpr int kFrames = 20;
    bool all_grounded = true;
    bool monotonic_y = true;
    float prev_y = -1e9f;

    for (int i = 0; i < kFrames; ++i) {
        auto* kb = world.try_get<KinematicBody>(player);
        kb->velocity.x = 5.0f;
        kb->velocity.z = 0.0f;

        cs.update(world, kDt);

        auto& t = world.get<ecs::Transform>(player);
        float y = t.position.vec().y;

        if (!kb->grounded) all_grounded = false;

        // Allow tiny epsilon for ground snap jitter
        if (y < prev_y - 0.02f) {
            std::printf("    Jitter at frame %d: Y dropped from %.4f to %.4f (Δ=%.4f)\n",
                        i, prev_y, y, y - prev_y);
            monotonic_y = false;
        }
        prev_y = y;
    }

    float final_x = world.get<ecs::Transform>(player).position.vec().x;
    float final_y = world.get<ecs::Transform>(player).position.vec().y;

    check(all_grounded, "grounded == true for all 20 frames on slope");
    check(monotonic_y, "Y position monotonically non-decreasing (no jitter)");
    check(final_x > 2.0f + 1.0f, "player moved significantly in +X");
    check(final_y > spawn_y, "player Y increased (climbed the slope)");

    std::printf("    Final position: (%.3f, %.3f) — climbed from Y=%.3f\n",
                final_x, final_y, spawn_y);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Charter 2: Orbital Drop / Zero Tunneling
// ═══════════════════════════════════════════════════════════════════════════════

static void test_no_tunneling() {
    std::printf("\n── Charter 2: Orbital Drop / Zero Tunneling ──\n\n");

    // Flat terrain at Y=5.0
    ecs::World world;

    make_heightfield(
        world,
        glm::vec3(0.0f), 20.0f, 20.0f,
        5.0f, 5.0f,  // flat at Y=5
        8,
        [](float, float) -> uint16_t { return 32768; });

    // Spawn 40 units above terrain — enough for a dramatic fall, but reachable
    // within a few frames. The sweep covers velocity*dt per frame, and gravity
    // accelerates the fall, so the player reaches terrain quickly.
    float start_y = 45.0f;
    auto player = make_player(world, glm::vec3(10.0f, start_y, 10.0f));

    CollisionSystem cs;
    cs.rebuild_cache(world);

    float terrain_y = 5.0f;
    float expected_surface = terrain_y + kCapBottomOff;  // 5.8

    // Let gravity pull the player down — run up to 300 frames (5 seconds).
    // The KCC applies world_gravity (20 m/s²) each frame, so the player
    // accelerates and the vertical sweep catches the terrain.
    constexpr int kMaxFrames = 300;
    float lowest_y = start_y;
    bool tunneled = false;
    auto* kb = world.try_get<KinematicBody>(player);

    for (int i = 0; i < kMaxFrames; ++i) {
        kb->velocity.x = 0.0f;
        kb->velocity.z = 0.0f;
        cs.update(world, kDt);

        float y = world.get<ecs::Transform>(player).position.vec().y;
        if (y < lowest_y) lowest_y = y;
        if (y < terrain_y) { tunneled = true; break; }
        if (kb->grounded) break;
    }

    auto& t = world.get<ecs::Transform>(player);
    float final_y = t.position.vec().y;

    std::printf("    Drop from Y=%.0f under gravity, terrain at Y=%.0f\n", start_y, terrain_y);
    std::printf("    Final Y = %.4f  lowest Y = %.4f  grounded = %s\n",
                final_y, lowest_y, kb->grounded ? "true" : "false");

    check(!tunneled, "player did NOT tunnel through terrain");
    check(kb->grounded, "player is grounded after falling");
    check(approx(final_y, expected_surface, 0.15f),
          "player settled at terrain surface (Y ≈ terrain + capsule offset)");
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Charter 3: Seamless Heightfield-to-Primitive Transition
// ═══════════════════════════════════════════════════════════════════════════════

static void test_heightfield_to_primitive_transition() {
    std::printf("\n── Charter 3: Heightfield-to-Primitive Transition ──\n\n");

    // Test: the ground probe seamlessly transitions from heightfield to box
    // when both surfaces are at the same elevation — like walking from terrain
    // onto a stone bridge. The box is embedded in the terrain (bottom below
    // heightfield surface) so its side face doesn't block horizontal movement.
    //
    // Layout (side view):
    //   Y=0  ─────────────────[box top]─────────
    //        ════heightfield (flat at Y=0)═══════
    //                   [box body below Y=0]
    //
    //   X:   0          10         15         20
    //        heightfield region    box region (X=10..20)
    //
    // Box center at Y=-0.5, half_extents.y=0.5 → top at Y=0, bottom at Y=-1.
    // The box top is flush with the heightfield. The horizontal sweep never
    // hits a vertical face because the box doesn't protrude above the terrain.
    ecs::World world;

    // Flat heightfield at Y=0
    make_heightfield(
        world,
        glm::vec3(0.0f), 20.0f, 20.0f,
        0.0f, 0.0f,
        8,
        [](float, float) -> uint16_t { return 32768; });

    // Box: embedded in terrain, top flush at Y=0. Spans X=[10,20], Z=[5,15].
    make_box(world, glm::vec3(15.0f, -0.5f, 10.0f), glm::vec3(5.0f, 0.5f, 5.0f));

    float spawn_y = 0.0f + kCapBottomOff + 0.02f;
    auto player = make_player(world, glm::vec3(5.0f, spawn_y, 10.0f));

    CollisionSystem cs;
    cs.rebuild_cache(world);

    // Walk +X at 5 m/s for 120 frames (2 seconds). Player crosses from
    // heightfield-only zone (X<10) into heightfield+box zone (X>10).
    constexpr int kFrames = 120;
    bool all_grounded = true;
    float max_y_drop = 0.0f;
    float prev_y = spawn_y;
    bool was_in_hf_only = false;
    bool was_in_box_zone = false;
    float y_at_transition = -1.0f;

    for (int i = 0; i < kFrames; ++i) {
        auto* kb = world.try_get<KinematicBody>(player);
        kb->velocity.x = 5.0f;
        kb->velocity.z = 0.0f;

        cs.update(world, kDt);

        auto& t = world.get<ecs::Transform>(player);
        float x = t.position.vec().x;
        float y = t.position.vec().y;

        if (!kb->grounded) all_grounded = false;

        float drop = prev_y - y;
        if (drop > max_y_drop) max_y_drop = drop;
        prev_y = y;

        if (x < 10.0f) was_in_hf_only = true;
        if (x > 10.0f && !was_in_box_zone) {
            was_in_box_zone = true;
            y_at_transition = y;
        }
    }

    auto& t = world.get<ecs::Transform>(player);
    float final_x = t.position.vec().x;
    float final_y = t.position.vec().y;

    std::printf("    Final pos: (%.2f, %.2f)\n", final_x, final_y);
    std::printf("    Traversed both zones: hf=%s, box=%s\n",
                was_in_hf_only ? "yes" : "no", was_in_box_zone ? "yes" : "no");
    std::printf("    Y at transition: %.4f, max Y drop: %.4f\n",
                y_at_transition, max_y_drop);

    check(was_in_hf_only && was_in_box_zone,
          "player traversed both heightfield-only and box zones");
    check(all_grounded,
          "grounded == true during entire transition");
    check(max_y_drop < 0.1f,
          "no Y drop at transition boundary (seamless handoff)");
    check(approx(final_y, spawn_y, 0.15f),
          "final Y ≈ spawn Y (same elevation throughout)");
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Charter 5: Depenetration Recovery (Trap A regression test)
// ═══════════════════════════════════════════════════════════════════════════════

static void test_depenetration_recovery() {
    std::printf("\n── Charter 5: Depenetration Recovery ──\n\n");

    // Flat terrain at Y=5.0
    ecs::World world;

    make_heightfield(
        world,
        glm::vec3(0.0f), 20.0f, 20.0f,
        5.0f, 5.0f,
        8,
        [](float, float) -> uint16_t { return 32768; });

    // Spawn player center at terrain Y — entire bottom hemisphere embedded
    auto player = make_player(world, glm::vec3(10.0f, 5.0f, 10.0f));

    CollisionSystem cs;
    cs.rebuild_cache(world);

    // Run 10 frames with +X velocity
    auto ys = tick_frames(cs, world, player, 10, 5.0f, 0.0f);

    float final_x = world.get<ecs::Transform>(player).position.vec().x;
    auto* kb = world.try_get<KinematicBody>(player);

    std::printf("    Embedded 0.8u below terrain. 10 frames @ 5 m/s +X.\n");
    std::printf("    Y trajectory: ");
    for (float y : ys) std::printf("%.2f ", y);
    std::printf("\n    Final X: %.3f\n", final_x);

    check(final_x > 10.5f,
          "player moved in X (not stuck from overlap)");
    check(ys.back() > 5.0f + kCapBottomOff - 0.1f,
          "player depenetrated to above terrain surface");
    check(kb->grounded,
          "player is grounded after recovery");

    // Verify the Y converges — last few frames should be stable
    float y_variance = 0.0f;
    for (size_t i = 7; i < ys.size(); ++i) {
        y_variance += std::abs(ys[i] - ys[i - 1]);
    }
    check(y_variance < 0.05f,
          "Y position is stable in final frames (no oscillation)");
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Charter 6: Flat terrain walk — baseline sanity check
// ═══════════════════════════════════════════════════════════════════════════════

static void test_flat_terrain_walk() {
    std::printf("\n── Charter 6: Flat Terrain Walk (Baseline) ──\n\n");

    ecs::World world;

    make_heightfield(
        world,
        glm::vec3(0.0f), 40.0f, 40.0f,
        0.0f, 0.0f,
        8,
        [](float, float) -> uint16_t { return 32768; });

    float spawn_y = 0.0f + kCapBottomOff + 0.02f;
    auto player = make_player(world, glm::vec3(5.0f, spawn_y, 20.0f));

    CollisionSystem cs;
    cs.rebuild_cache(world);

    auto ys = tick_frames(cs, world, player, 30, 5.0f, 0.0f);

    auto& t = world.get<ecs::Transform>(player);
    float final_x = t.position.vec().x;
    auto* kb = world.try_get<KinematicBody>(player);

    float expected_x = 5.0f + 5.0f * 30 * kDt;  // 5 + 2.5 = 7.5

    check(approx(final_x, expected_x, 0.5f),
          "X displacement matches expected (v*t)");
    check(kb->grounded,
          "grounded after 30 frames");

    // Y should be nearly constant on flat terrain
    float y_range = *std::max_element(ys.begin(), ys.end()) -
                    *std::min_element(ys.begin(), ys.end());
    check(y_range < 0.1f,
          "Y stable on flat terrain (range < 0.1)");
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Main
// ═══════════════════════════════════════════════════════════════════════════════

int main() {
    std::printf("╔══════════════════════════════════════════════════════════════╗\n");
    std::printf("║        KCC INTEGRATION TEST SUITE — HEADLESS CI            ║\n");
    std::printf("║  Capsule: r=%.1f  hh=%.1f  bottom_offset=%.1f              ║\n",
                kCapRadius, kCapHalfHeight, kCapBottomOff);
    std::printf("║  KCC: gravity=20  skin=0.01  probe=0.1  slope_cos=0.707   ║\n");
    std::printf("╚══════════════════════════════════════════════════════════════╝\n");

    test_slope_tracking();
    test_no_tunneling();
    test_heightfield_to_primitive_transition();
    test_depenetration_recovery();
    test_flat_terrain_walk();

    std::printf("\n══════════════════════════════════════════════════════════════\n");
    std::printf("  KCC Integration: %d passed, %d failed\n", g_passed, g_failed);
    std::printf("══════════════════════════════════════════════════════════════\n");

    return g_failed > 0 ? 1 : 0;
}
