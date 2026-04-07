// Test: CameraZoneSystem — zone resolution, 5 camera modes, and transitions.
// Build: add_gseurat_test(test_camera_zone_system src/engine/camera_zone_system.cpp
//                                                  src/engine/gs_spline.cpp)

#include "gseurat/engine/camera_zone_system.hpp"

#include <cmath>
#include <cstdio>

static int passed = 0;
static int failed = 0;

static void check(bool cond, const char* msg) {
    if (cond) {
        std::printf("  PASS: %s\n", msg);
        passed++;
    } else {
        std::printf("  FAIL: %s\n", msg);
        failed++;
    }
}

static bool approx(float a, float b, float eps = 0.05f) {
    return std::fabs(a - b) < eps;
}

static bool vec_approx(const glm::vec3& a, const glm::vec3& b, float eps = 0.5f) {
    return approx(a.x, b.x, eps) && approx(a.y, b.y, eps) && approx(a.z, b.z, eps);
}

static float vec_dist(const glm::vec3& a, const glm::vec3& b) {
    glm::vec3 d = a - b;
    return std::sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
}

// Run many frames to let spring converge.
static void converge(gseurat::CameraZoneSystem& sys, glm::vec3 player_pos, int frames = 120) {
    float dt = 1.0f / 60.0f;
    gseurat::CameraZoneSystem::InputState no_input;
    for (int i = 0; i < frames; ++i) {
        sys.update(dt, player_pos, {0, 0, 0}, no_input);
    }
}

// ── Test 1: World Fallback ──────────────────────────────────────────────────

void test_world_fallback() {
    std::printf("World Fallback:\n");

    gseurat::CameraZoneSystem sys;
    gseurat::CameraParams defaults;
    defaults.mode = gseurat::CameraMode::fixed_point;
    defaults.fov = 60.0f;
    defaults.fixed_position = {0, 10, 0};

    sys.load_from_data({}, {}, {}, defaults);
    converge(sys, {0, 0, 0});

    check(sys.active_zone_entity() == -1, "no volumes -> fallback zone (-1)");
    check(approx(sys.current_state().fov, 60.0f), "fallback fov = 60");
}

// ── Test 2: Single Volume ───────────────────────────────────────────────────

void test_single_volume() {
    std::printf("Single Volume:\n");

    gseurat::CameraZoneSystem sys;
    gseurat::CameraParams defaults;
    defaults.mode = gseurat::CameraMode::fixed_point;
    defaults.fov = 45.0f;
    defaults.fixed_position = {0, 10, 0};

    gseurat::CameraVolume vol;
    vol.shape = gseurat::AABB{{0, 0, 0}, {5, 5, 5}};
    vol.params.mode = gseurat::CameraMode::fixed_point;
    vol.params.fov = 90.0f;
    vol.params.fixed_position = {0, 20, 0};
    vol.params.priority = 0;

    std::vector<std::pair<int, gseurat::CameraVolume>> volumes = {{42, vol}};

    sys.load_from_data(volumes, {}, {}, defaults);

    // Player inside volume.
    converge(sys, {1, 1, 1});
    check(sys.active_zone_entity() == 42, "player inside -> zone 42 active");
    check(approx(sys.current_state().fov, 90.0f), "zone fov = 90");

    // Player outside volume.
    converge(sys, {100, 100, 100});
    check(sys.active_zone_entity() == -1, "player outside -> fallback (-1)");
}

// ── Test 3: Nested Volumes — Smaller Wins ───────────────────────────────────

void test_nested_volumes() {
    std::printf("Nested Volumes:\n");

    gseurat::CameraZoneSystem sys;
    gseurat::CameraParams defaults;
    defaults.mode = gseurat::CameraMode::fixed_point;
    defaults.fov = 45.0f;
    defaults.fixed_position = {0, 5, 0};

    gseurat::CameraVolume large_vol;
    large_vol.shape = gseurat::AABB{{0, 0, 0}, {10, 10, 10}};
    large_vol.params.mode = gseurat::CameraMode::fixed_point;
    large_vol.params.fov = 60.0f;
    large_vol.params.fixed_position = {0, 10, 0};
    large_vol.params.priority = 0;

    gseurat::CameraVolume small_vol;
    small_vol.shape = gseurat::AABB{{0, 0, 0}, {2, 2, 2}};
    small_vol.params.mode = gseurat::CameraMode::fixed_point;
    small_vol.params.fov = 120.0f;
    small_vol.params.fixed_position = {0, 30, 0};
    small_vol.params.priority = 0;

    std::vector<std::pair<int, gseurat::CameraVolume>> volumes = {
        {10, large_vol}, {20, small_vol}
    };

    sys.load_from_data(volumes, {}, {}, defaults);
    converge(sys, {0, 0, 0});

    check(sys.active_zone_entity() == 20, "nested: smaller volume (entity 20) wins");
    check(approx(sys.current_state().fov, 120.0f), "nested: uses small volume fov = 120");
}

// ── Test 4: fixed_point Mode ────────────────────────────────────────────────

void test_fixed_point() {
    std::printf("fixed_point mode:\n");

    gseurat::CameraZoneSystem sys;
    gseurat::CameraParams defaults;
    defaults.mode = gseurat::CameraMode::fixed_point;
    defaults.fov = 45.0f;
    defaults.fixed_position = {5, 15, -3};

    sys.load_from_data({}, {}, {}, defaults);

    glm::vec3 player{2, 0, 1};
    converge(sys, player);

    auto state = sys.current_state();
    check(vec_approx(state.position, {5, 15, -3}, 0.01f), "fixed_point: position = authored");
    // Target should track player (spring-damped, converged).
    check(vec_approx(state.target, player, 1.0f), "fixed_point: target tracks player");
}

// ── Test 5: free_look Orbit Distance ────────────────────────────────────────

void test_free_look_orbit() {
    std::printf("free_look orbit:\n");

    gseurat::CameraZoneSystem sys;
    gseurat::CameraParams defaults;
    defaults.mode = gseurat::CameraMode::free_look;
    defaults.fov = 45.0f;
    defaults.orbit_distance = 8.0f;
    defaults.allow_user_orbit = false;  // No mouse input, just test distance.
    defaults.pitch_min = -89.0f;
    defaults.pitch_max = 89.0f;

    sys.load_from_data({}, {}, {}, defaults);

    glm::vec3 player{0, 0, 0};
    converge(sys, player, 240);

    auto state = sys.current_state();
    float dist = vec_dist(state.position, state.target);
    check(approx(dist, 8.0f, 1.5f), "free_look: camera ~orbit_distance from target");
}

// ── Test 6: rail_follow ─────────────────────────────────────────────────────

void test_rail_follow() {
    std::printf("rail_follow:\n");

    gseurat::CameraZoneSystem sys;

    gseurat::CameraRail rail;
    rail.path.control_points = {
        {-10, 5, 0}, {0, 5, 0}, {10, 5, 0}
    };
    rail.has_target_path = false;

    gseurat::CameraParams defaults;
    defaults.mode = gseurat::CameraMode::rail_follow;
    defaults.fov = 45.0f;
    defaults.rail_index = 0;
    defaults.offset = {0, 5, -10};

    sys.load_from_data({}, {}, {rail}, defaults);

    glm::vec3 player{3, 0, 0};
    converge(sys, player, 240);

    auto state = sys.current_state();
    // Camera should be on the rail (Y ~= 5).
    check(approx(state.position.y, 5.0f, 1.0f), "rail_follow: camera Y near rail Y=5");
    // Camera X should be near player X.
    check(approx(state.position.x, 3.0f, 2.0f), "rail_follow: camera X tracks player X");
}

// ── Test 7: side_scroll ─────────────────────────────────────────────────────

void test_side_scroll() {
    std::printf("side_scroll:\n");

    gseurat::CameraZoneSystem sys;
    gseurat::CameraParams defaults;
    defaults.mode = gseurat::CameraMode::side_scroll;
    defaults.fov = 45.0f;
    defaults.offset = {0, 3, -8};

    sys.load_from_data({}, {}, {}, defaults);

    glm::vec3 player{7, 0, 0};
    converge(sys, player, 240);

    auto state = sys.current_state();
    // X follows player.
    check(approx(state.position.x, 7.0f, 1.0f), "side_scroll: camera X follows player X=7");
    // Z = player.z + offset.z.
    check(approx(state.position.z, -8.0f, 1.0f), "side_scroll: camera Z = player.z + offset.z");
}

// ── Test 8: Smoothstep Transition ───────────────────────────────────────────

void test_transition() {
    std::printf("Smoothstep transition:\n");

    gseurat::CameraZoneSystem sys;
    gseurat::CameraParams defaults;
    defaults.mode = gseurat::CameraMode::fixed_point;
    defaults.fov = 45.0f;
    defaults.fixed_position = {0, 10, 0};

    // Zone A at origin, Zone B at (20,0,0).
    gseurat::CameraVolume zone_a;
    zone_a.shape = gseurat::AABB{{0, 0, 0}, {5, 5, 5}};
    zone_a.params.mode = gseurat::CameraMode::fixed_point;
    zone_a.params.fov = 45.0f;
    zone_a.params.fixed_position = {0, 10, 0};
    zone_a.params.blend_time = 1.0f;
    zone_a.params.priority = 0;

    gseurat::CameraVolume zone_b;
    zone_b.shape = gseurat::AABB{{20, 0, 0}, {5, 5, 5}};
    zone_b.params.mode = gseurat::CameraMode::fixed_point;
    zone_b.params.fov = 90.0f;
    zone_b.params.fixed_position = {20, 20, 0};
    zone_b.params.blend_time = 1.0f;
    zone_b.params.priority = 0;

    std::vector<std::pair<int, gseurat::CameraVolume>> volumes = {
        {1, zone_a}, {2, zone_b}
    };

    sys.load_from_data(volumes, {}, {}, defaults);

    // Converge in zone A.
    converge(sys, {0, 0, 0});
    check(sys.active_zone_entity() == 1, "transition: starts in zone A");
    float fov_a = sys.current_state().fov;

    // Move to zone B — should trigger transition.
    float dt = 1.0f / 60.0f;
    gseurat::CameraZoneSystem::InputState no_input;
    sys.update(dt, {20, 0, 0}, {0, 0, 0}, no_input);

    check(sys.active_zone_entity() == 2, "transition: now in zone B");
    check(sys.is_transitioning(), "transition: is_transitioning = true");

    // Mid-blend: position should be between zone A and zone B positions.
    // Run half the blend time (~30 frames at 60fps for 1s blend).
    for (int i = 0; i < 30; ++i) {
        sys.update(dt, {20, 0, 0}, {0, 0, 0}, no_input);
    }

    auto mid_state = sys.current_state();
    // FOV should be between 45 and 90.
    check(mid_state.fov > fov_a + 1.0f && mid_state.fov < 90.0f - 1.0f,
          "transition: mid-blend fov between zone A and B");

    // Run the rest of the blend + extra to complete.
    for (int i = 0; i < 60; ++i) {
        sys.update(dt, {20, 0, 0}, {0, 0, 0}, no_input);
    }

    check(!sys.is_transitioning(), "transition: blend complete, is_transitioning = false");
    check(approx(sys.current_state().fov, 90.0f, 1.0f), "transition: final fov near zone B's 90");
}

// ── Main ────────────────────────────────────────────────────────────────────

int main() {
    std::printf("=== Camera Zone System Tests ===\n\n");

    test_world_fallback();
    test_single_volume();
    test_nested_volumes();
    test_fixed_point();
    test_free_look_orbit();
    test_rail_follow();
    test_side_scroll();
    test_transition();

    std::printf("\n=== Results: %d passed, %d failed ===\n", passed, failed);
    return failed > 0 ? 1 : 0;
}
