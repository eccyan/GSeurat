// Headless KCC telemetry test — diagnose why the player gets stuck and can't move.
// Bypasses Vulkan/GLFW entirely. Creates a flat heightfield + capsule player, applies
// forward velocity, ticks CollisionSystem::update() for 10 frames, and prints per-frame
// telemetry to pinpoint the exact KCC trap.
//
// Run: ctest -R test_kcc_stuck_headless -V

#include "gseurat/engine/collision/collision_system.hpp"
#include "gseurat/engine/ecs/components/heightfield_component.hpp"
#include "gseurat/engine/ecs/components/kinematic_body.hpp"
#include "gseurat/engine/ecs/components/collider_component.hpp"

#include <cstdio>
#include <cmath>

using namespace gseurat;

// ── Helpers ──────────────────────────────────────────────────────────────────

static void print_vec3(const char* label, const glm::vec3& v) {
    std::printf("    %-28s = (%+10.6f, %+10.6f, %+10.6f)\n", label, v.x, v.y, v.z);
}

static void print_float(const char* label, float v) {
    std::printf("    %-28s = %+10.6f\n", label, v);
}

static void print_bool(const char* label, bool v) {
    std::printf("    %-28s = %s\n", label, v ? "true" : "false");
}

// ── Create a flat heightfield at a given elevation ──────────────────────────

static ecs::Entity create_flat_terrain(ecs::World& world, float terrain_y, float extent) {
    auto entity = world.create();

    ecs::Transform t;
    t.position = coord::WorldPos(glm::vec3(0.0f));
    world.add<ecs::Transform>(entity, t);

    HeightfieldComponent hf;
    hf.image_path = "test_flat";
    hf.width = extent;
    hf.length = extent;
    hf.min_height = terrain_y;
    hf.max_height = terrain_y;  // Flat: min == max, sample value irrelevant
    hf.collision_mask = 0xFFFFFFFF;

    // 8x8 grid, all samples at midpoint (doesn't matter when min==max)
    hf.data.img_width = 8;
    hf.data.img_height = 8;
    hf.data.samples.assign(64, 32768);  // midpoint of uint16

    hf.world_aabb.min = glm::vec3(0.0f, terrain_y, 0.0f);
    hf.world_aabb.max = glm::vec3(extent, terrain_y, extent);

    world.add<HeightfieldComponent>(entity, hf);
    return entity;
}

// ── Create a player entity with KinematicBody + CapsuleCollider ─────────────

static ecs::Entity create_player(ecs::World& world, const glm::vec3& spawn_pos,
                                  float cap_radius, float cap_half_height) {
    auto entity = world.create();

    ecs::Transform t;
    t.position = coord::WorldPos(spawn_pos);
    world.add<ecs::Transform>(entity, t);

    KinematicBody kb;
    kb.desired_jump_height = 2.0f;
    kb.time_to_apex = 0.4f;
    kb.recompute_derived();
    world.add<KinematicBody>(entity, kb);

    ColliderComponent cc;
    cc.shape = CapsuleData{cap_radius, cap_half_height};
    cc.is_dynamic = true;
    cc.collision_mask = 0xFFFFFFFF;
    world.add<ColliderComponent>(entity, cc);

    return entity;
}

// ── Direct sweep telemetry (bypasses run_kcc to inspect raw hit data) ───────

static void probe_raw_sweeps(CollisionSystem& cs,
                              const glm::vec3& pos, float radius, float half_height) {
    CapsuleData cap{radius, half_height};
    glm::quat rot(1, 0, 0, 0);

    // Horizontal sweep: +X at 5 m/s * 1/60
    float h_dist = 5.0f / 60.0f;
    auto h_hit = cs.sweep(pos, rot, cap, glm::vec3(1.0f, 0.0f, 0.0f), h_dist, 0xFFFFFFFF);
    std::printf("    [RAW H-SWEEP] dir=(+1,0,0) dist=%.6f\n", h_dist);
    if (h_hit) {
        std::printf("      HIT: t=%.8f  normal=(%+.4f,%+.4f,%+.4f)  point=(%+.4f,%+.4f,%+.4f)  trigger=%s\n",
                    h_hit->hit.t, h_hit->hit.normal.x, h_hit->hit.normal.y, h_hit->hit.normal.z,
                    h_hit->hit.point.x, h_hit->hit.point.y, h_hit->hit.point.z,
                    h_hit->is_trigger ? "yes" : "no");
        float safe_t = std::max(h_hit->hit.t * h_dist - cs.skin_width, 0.0f);
        std::printf("      safe_t = max(%.8f * %.6f - %.4f, 0) = %.8f\n",
                    h_hit->hit.t, h_dist, cs.skin_width, safe_t);
    } else {
        std::printf("      NO HIT (clear to move)\n");
    }

    // Ground probe: -Y
    auto g_hit = cs.sweep(pos, rot, cap, glm::vec3(0.0f, -1.0f, 0.0f),
                          cs.ground_probe_distance, 0xFFFFFFFF);
    std::printf("    [RAW G-PROBE] dir=(0,-1,0) dist=%.6f\n", cs.ground_probe_distance);
    if (g_hit) {
        float ndot = glm::dot(g_hit->hit.normal, glm::vec3(0, 1, 0));
        std::printf("      HIT: t=%.8f  normal=(%+.4f,%+.4f,%+.4f)  ndot=%.6f  walkable=%s\n",
                    g_hit->hit.t, g_hit->hit.normal.x, g_hit->hit.normal.y, g_hit->hit.normal.z,
                    ndot, ndot > cs.ground_angle_cos ? "yes" : "NO");
        float snap = std::max(g_hit->hit.t * cs.ground_probe_distance - cs.skin_width, 0.0f);
        std::printf("      snap_dist = max(%.8f * %.6f - %.4f, 0) = %.8f\n",
                    g_hit->hit.t, cs.ground_probe_distance, cs.skin_width, snap);
    } else {
        std::printf("      NO HIT (airborne)\n");
    }

    // Vertical sweep: -Y full gravity drop (1 frame of gravity)
    float v_dist = 20.0f / 60.0f;  // world_gravity * dt
    auto v_hit = cs.sweep(pos, rot, cap, glm::vec3(0.0f, -1.0f, 0.0f), v_dist, 0xFFFFFFFF);
    std::printf("    [RAW V-SWEEP] dir=(0,-1,0) dist=%.6f\n", v_dist);
    if (v_hit) {
        std::printf("      HIT: t=%.8f  normal=(%+.4f,%+.4f,%+.4f)\n",
                    v_hit->hit.t, v_hit->hit.normal.x, v_hit->hit.normal.y, v_hit->hit.normal.z);
    } else {
        std::printf("      NO HIT\n");
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TEST SCENARIOS
// ═══════════════════════════════════════════════════════════════════════════════

// Scenario A: Player spawned AT terrain surface (capsule bottom touches ground)
// Expected stuck pattern: capsule hemisphere overlaps terrain → h-sweep returns t=0

static void scenario_at_surface() {
    std::printf("\n════════════════════════════════════════════════════════════════\n");
    std::printf("  SCENARIO A: Player center at terrain_Y + half_height + radius\n");
    std::printf("  (capsule bottom exactly touching surface — ideal placement)\n");
    std::printf("════════════════════════════════════════════════════════════════\n\n");

    ecs::World world;
    float terrain_y = 5.0f;
    float cap_r = 0.3f;
    float cap_hh = 0.5f;
    float spawn_y = terrain_y + cap_hh + cap_r;  // 5.8 — bottom of capsule at Y=5.0

    create_flat_terrain(world, terrain_y, 20.0f);
    auto player = create_player(world, glm::vec3(10.0f, spawn_y, 10.0f), cap_r, cap_hh);

    CollisionSystem cs;
    cs.rebuild_cache(world);

    std::printf("  Config: terrain_y=%.1f  cap(r=%.1f, hh=%.1f)  spawn=(10, %.3f, 10)\n",
                terrain_y, cap_r, cap_hh, spawn_y);
    std::printf("  Capsule bottom = spawn_y - hh - r = %.3f\n", spawn_y - cap_hh - cap_r);
    std::printf("  Expected: bottom at terrain surface exactly.\n\n");

    // Pre-tick raw sweep diagnostics
    glm::vec3 pos(10.0f, spawn_y, 10.0f);
    std::printf("  --- Pre-tick raw sweep probes ---\n");
    probe_raw_sweeps(cs, pos, cap_r, cap_hh);

    // Inject forward velocity and tick
    std::printf("\n  --- KCC tick loop (10 frames @ 60Hz, input_vel = +5 m/s X) ---\n\n");

    float dt = 1.0f / 60.0f;
    for (int frame = 0; frame < 10; ++frame) {
        // Inject velocity each frame (simulating PlayerController feeding KinematicBody)
        auto* kb = world.try_get<KinematicBody>(player);
        kb->velocity.x = 5.0f;
        kb->velocity.z = 0.0f;

        glm::vec3 pos_before = world.get<ecs::Transform>(player).position.vec();

        cs.update(world, dt);

        auto& t = world.get<ecs::Transform>(player);
        glm::vec3 pos_after = t.position.vec();
        glm::vec3 delta = pos_after - pos_before;

        std::printf("  Frame %02d:\n", frame);
        print_vec3("pos_before", pos_before);
        print_vec3("pos_after", pos_after);
        print_vec3("delta", delta);
        print_vec3("velocity", kb->velocity);
        print_bool("grounded", kb->grounded);
        print_vec3("ground_normal", kb->ground_normal);
        print_float("|delta_xz|", std::sqrt(delta.x * delta.x + delta.z * delta.z));
        std::printf("\n");
    }
}

// Scenario B: Player spawned slightly ABOVE surface (0.05 unit gap)

static void scenario_above_surface() {
    std::printf("\n════════════════════════════════════════════════════════════════\n");
    std::printf("  SCENARIO B: Player 0.05 above ideal placement\n");
    std::printf("════════════════════════════════════════════════════════════════\n\n");

    ecs::World world;
    float terrain_y = 5.0f;
    float cap_r = 0.3f;
    float cap_hh = 0.5f;
    float spawn_y = terrain_y + cap_hh + cap_r + 0.05f;

    create_flat_terrain(world, terrain_y, 20.0f);
    auto player = create_player(world, glm::vec3(10.0f, spawn_y, 10.0f), cap_r, cap_hh);

    CollisionSystem cs;
    cs.rebuild_cache(world);

    std::printf("  Config: spawn_y=%.3f  capsule_bottom=%.3f  terrain=%.1f  gap=%.3f\n",
                spawn_y, spawn_y - cap_hh - cap_r, terrain_y, spawn_y - cap_hh - cap_r - terrain_y);

    std::printf("\n  --- Pre-tick raw sweep probes ---\n");
    probe_raw_sweeps(cs, glm::vec3(10.0f, spawn_y, 10.0f), cap_r, cap_hh);

    std::printf("\n  --- KCC tick loop ---\n\n");

    float dt = 1.0f / 60.0f;
    for (int frame = 0; frame < 10; ++frame) {
        auto* kb = world.try_get<KinematicBody>(player);
        kb->velocity.x = 5.0f;
        kb->velocity.z = 0.0f;

        glm::vec3 pos_before = world.get<ecs::Transform>(player).position.vec();
        cs.update(world, dt);
        glm::vec3 pos_after = world.get<ecs::Transform>(player).position.vec();
        glm::vec3 delta = pos_after - pos_before;

        std::printf("  Frame %02d: pos=(%+.4f,%+.4f,%+.4f) Δ=(%+.6f,%+.6f,%+.6f) "
                    "grounded=%d vel=(%+.4f,%+.4f,%+.4f)\n",
                    frame, pos_after.x, pos_after.y, pos_after.z,
                    delta.x, delta.y, delta.z,
                    kb->grounded ? 1 : 0,
                    kb->velocity.x, kb->velocity.y, kb->velocity.z);
    }
}

// Scenario C: Player spawned BELOW surface (overlap — the most likely real-world bug)

static void scenario_below_surface() {
    std::printf("\n════════════════════════════════════════════════════════════════\n");
    std::printf("  SCENARIO C: Player center AT terrain_Y (bottom hemisphere fully embedded)\n");
    std::printf("════════════════════════════════════════════════════════════════\n\n");

    ecs::World world;
    float terrain_y = 5.0f;
    float cap_r = 0.3f;
    float cap_hh = 0.5f;
    float spawn_y = terrain_y;  // Center at terrain — bottom hemisphere is 0.8 below surface

    create_flat_terrain(world, terrain_y, 20.0f);
    auto player = create_player(world, glm::vec3(10.0f, spawn_y, 10.0f), cap_r, cap_hh);

    CollisionSystem cs;
    cs.rebuild_cache(world);

    std::printf("  Config: spawn_y=%.3f  capsule_bottom=%.3f  terrain=%.1f  overlap=%.3f\n",
                spawn_y, spawn_y - cap_hh - cap_r, terrain_y, terrain_y - (spawn_y - cap_hh - cap_r));

    std::printf("\n  --- Pre-tick raw sweep probes ---\n");
    probe_raw_sweeps(cs, glm::vec3(10.0f, spawn_y, 10.0f), cap_r, cap_hh);

    std::printf("\n  --- KCC tick loop ---\n\n");

    float dt = 1.0f / 60.0f;
    for (int frame = 0; frame < 10; ++frame) {
        auto* kb = world.try_get<KinematicBody>(player);
        kb->velocity.x = 5.0f;
        kb->velocity.z = 0.0f;

        glm::vec3 pos_before = world.get<ecs::Transform>(player).position.vec();
        cs.update(world, dt);
        glm::vec3 pos_after = world.get<ecs::Transform>(player).position.vec();
        glm::vec3 delta = pos_after - pos_before;

        std::printf("  Frame %02d: pos=(%+.4f,%+.4f,%+.4f) Δ=(%+.6f,%+.6f,%+.6f) "
                    "grounded=%d vel=(%+.4f,%+.4f,%+.4f)\n",
                    frame, pos_after.x, pos_after.y, pos_after.z,
                    delta.x, delta.y, delta.z,
                    kb->grounded ? 1 : 0,
                    kb->velocity.x, kb->velocity.y, kb->velocity.z);
    }
}

// Scenario D: Real-world seurat_island spawn coordinates
// Player JSON position [187, 1.9663, 197] in grid coords.
// Need to check what the terrain height actually is at that world position.

static void scenario_real_spawn() {
    std::printf("\n════════════════════════════════════════════════════════════════\n");
    std::printf("  SCENARIO D: Realistic terrain — height varies, player at authored Y\n");
    std::printf("════════════════════════════════════════════════════════════════\n\n");

    ecs::World world;
    float cap_r = 0.3f;
    float cap_hh = 0.5f;

    // Create terrain with some height variation (simulating real heightfield)
    auto terrain = world.create();
    ecs::Transform tt;
    tt.position = coord::WorldPos(glm::vec3(0.0f));
    world.add<ecs::Transform>(terrain, tt);

    HeightfieldComponent hf;
    hf.image_path = "test_varied";
    hf.width = 20.0f;
    hf.length = 20.0f;
    hf.min_height = 0.0f;
    hf.max_height = 10.0f;
    hf.collision_mask = 0xFFFFFFFF;

    // 8x8 grid — terrain at Y≈2.0 everywhere (sample = 2.0/10.0 * 65535 = 13107)
    hf.data.img_width = 8;
    hf.data.img_height = 8;
    uint16_t terrain_sample = static_cast<uint16_t>((2.0f / 10.0f) * 65535.0f);
    hf.data.samples.assign(64, terrain_sample);

    hf.world_aabb.min = glm::vec3(0.0f, 0.0f, 0.0f);
    hf.world_aabb.max = glm::vec3(20.0f, 10.0f, 20.0f);
    world.add<HeightfieldComponent>(terrain, hf);

    // Player spawned at the authored Y from JSON (1.9663 in grid coords ≈ world Y)
    // Terrain is at Y=2.0, player center at Y=1.9663 — BELOW the surface
    float spawn_y = 1.9663f;
    auto player = create_player(world, glm::vec3(10.0f, spawn_y, 10.0f), cap_r, cap_hh);

    CollisionSystem cs;
    cs.rebuild_cache(world);

    // What height does sample_height return?
    const auto& hf_cache = cs.heightfield_cache();
    if (!hf_cache.empty()) {
        auto h = sample_height(hf_cache[0], 10.0f, 10.0f);
        std::printf("  sample_height(10,10) = %s\n",
                    h ? std::to_string(*h).c_str() : "nullopt");
    }

    std::printf("  spawn_y=%.4f  capsule_bottom=%.4f  terrain≈2.0\n",
                spawn_y, spawn_y - cap_hh - cap_r);
    std::printf("  Capsule bottom (%.4f) is %.4f BELOW terrain (2.0)\n",
                spawn_y - cap_hh - cap_r, 2.0f - (spawn_y - cap_hh - cap_r));

    std::printf("\n  --- Pre-tick raw sweep probes ---\n");
    probe_raw_sweeps(cs, glm::vec3(10.0f, spawn_y, 10.0f), cap_r, cap_hh);

    std::printf("\n  --- KCC tick loop ---\n\n");

    float dt = 1.0f / 60.0f;
    for (int frame = 0; frame < 10; ++frame) {
        auto* kb = world.try_get<KinematicBody>(player);
        kb->velocity.x = 5.0f;
        kb->velocity.z = 0.0f;

        glm::vec3 pos_before = world.get<ecs::Transform>(player).position.vec();
        cs.update(world, dt);
        glm::vec3 pos_after = world.get<ecs::Transform>(player).position.vec();
        glm::vec3 delta = pos_after - pos_before;

        std::printf("  Frame %02d: pos=(%+.4f,%+.4f,%+.4f) Δ=(%+.6f,%+.6f,%+.6f) "
                    "grounded=%d vel=(%+.4f,%+.4f,%+.4f)\n",
                    frame, pos_after.x, pos_after.y, pos_after.z,
                    delta.x, delta.y, delta.z,
                    kb->grounded ? 1 : 0,
                    kb->velocity.x, kb->velocity.y, kb->velocity.z);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════════════════════════

int main() {
    std::printf("╔══════════════════════════════════════════════════════════════╗\n");
    std::printf("║          KCC STUCK DIAGNOSTIC — HEADLESS TELEMETRY         ║\n");
    std::printf("╠══════════════════════════════════════════════════════════════╣\n");
    std::printf("║  Capsule: r=0.3  hh=0.5  total_height=1.6                 ║\n");
    std::printf("║  KCC: skin=0.01  probe=0.1  slope_cos=0.707  gravity=20   ║\n");
    std::printf("║  Input: 5 m/s +X  dt=1/60                                 ║\n");
    std::printf("╚══════════════════════════════════════════════════════════════╝\n");

    scenario_at_surface();
    scenario_above_surface();
    scenario_below_surface();
    scenario_real_spawn();

    std::printf("\n══════════════════════════════════════════════════════════════\n");
    std::printf("  DIAGNOSTIC COMPLETE — analyze output above for stuck trap\n");
    std::printf("══════════════════════════════════════════════════════════════\n");

    return 0;
}
