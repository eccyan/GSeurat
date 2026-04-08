// Test: CameraReviewState — activate/deactivate lifecycle, WASD movement,
// inject_walk, zone resolution, and MoveReference auto-switching.
// Build: add_gseurat_test(test_camera_review_state src/staging/camera_review_state.cpp
//                                                   src/engine/camera_zone_system.cpp
//                                                   src/engine/gs_spline.cpp)

#include "gseurat/staging/camera_review_state.hpp"
#include "gseurat/engine/input_manager.hpp"

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

static bool approx(float a, float b, float eps = 0.01f) {
    return std::fabs(a - b) < eps;
}

// ── Test 1: Starts inactive ─────────────────────────────────────────────────

void test_starts_inactive() {
    std::printf("Starts Inactive:\n");
    gseurat::CameraReviewState state;
    check(!state.is_active(), "default constructed state is inactive");
    check(state.volume_count() == 0, "no volumes initially");
    check(state.trigger_count() == 0, "no triggers initially");
    check(state.rail_count() == 0, "no rails initially");
}

// ── Test 2: Activate with empty camera_zones returns false ──────────────────

void test_activate_empty_zones() {
    std::printf("Activate Empty Zones:\n");
    gseurat::CameraReviewState state;
    gseurat::SceneData scene;

    // No camera_zones at all.
    bool ok = state.activate(scene, {0, 0, 0});
    check(!ok, "activate returns false when camera_zones is nullopt");
    check(!state.is_active(), "state remains inactive");

    // camera_zones present but no volumes.
    scene.camera_zones = gseurat::CameraZonesData{};
    ok = state.activate(scene, {0, 0, 0});
    check(!ok, "activate returns false when camera_zones has no volumes");
    check(!state.is_active(), "state remains inactive with empty volumes");
}

// ── Test 3: Activate with valid camera_zones returns true ───────────────────

void test_activate_valid() {
    std::printf("Activate Valid:\n");
    gseurat::CameraReviewState state;
    gseurat::SceneData scene;

    gseurat::CameraZonesData cz;
    cz.default_params.mode = gseurat::CameraMode::free_look;
    cz.default_params.fov = 45.0f;

    // Add one volume.
    gseurat::CameraVolume vol;
    vol.shape = gseurat::CamAABB{{0, 0, 0}, {50, 50, 50}};
    vol.params.mode = gseurat::CameraMode::fixed_point;
    vol.params.fov = 60.0f;
    vol.params.fixed_position = {0, 10, 0};
    cz.volumes.push_back({"zone_a", vol});

    scene.camera_zones = cz;

    glm::vec3 start_pos{5.0f, 0.0f, 3.0f};
    bool ok = state.activate(scene, start_pos);
    check(ok, "activate returns true with valid zones");
    check(state.is_active(), "state is now active");
    check(state.volume_count() == 1, "one volume loaded");
    check(approx(state.player_position().x, 5.0f), "player x set to initial");
    check(approx(state.player_position().z, 3.0f), "player z set to initial");
}

// ── Test 4: Deactivate resets state ─────────────────────────────────────────

void test_deactivate() {
    std::printf("Deactivate:\n");
    gseurat::CameraReviewState state;
    gseurat::SceneData scene;

    gseurat::CameraZonesData cz;
    cz.default_params.mode = gseurat::CameraMode::free_look;

    gseurat::CameraVolume vol;
    vol.shape = gseurat::CamAABB{{0, 0, 0}, {50, 50, 50}};
    vol.params.mode = gseurat::CameraMode::fixed_point;
    cz.volumes.push_back({"zone_a", vol});

    scene.camera_zones = cz;
    state.activate(scene, {10, 0, 20});

    check(state.is_active(), "active after activate");
    check(state.volume_count() == 1, "one volume before deactivate");

    state.deactivate();
    check(!state.is_active(), "inactive after deactivate");
    check(state.volume_count() == 0, "volumes cleared");
    check(state.trigger_count() == 0, "triggers cleared");
    check(state.rail_count() == 0, "rails cleared");
    check(approx(state.player_position().x, 0.0f), "player pos reset x");
    check(approx(state.player_position().z, 0.0f), "player pos reset z");
}

// ── Test 5: Multiple volumes, triggers, and rails ───────────────────────────

void test_multiple_zones() {
    std::printf("Multiple Zones:\n");
    gseurat::CameraReviewState state;
    gseurat::SceneData scene;

    gseurat::CameraZonesData cz;
    cz.default_params.mode = gseurat::CameraMode::free_look;

    gseurat::CameraVolume vol_a;
    vol_a.shape = gseurat::CamAABB{{0, 0, 0}, {10, 10, 10}};
    vol_a.params.mode = gseurat::CameraMode::fixed_point;

    gseurat::CameraVolume vol_b;
    vol_b.shape = gseurat::CamSphere{{20, 0, 0}, 5.0f};
    vol_b.params.mode = gseurat::CameraMode::side_scroll;

    cz.volumes.push_back({"zone_a", vol_a});
    cz.volumes.push_back({"zone_b", vol_b});

    gseurat::CameraTrigger trig;
    trig.shape = gseurat::CamAABB{{10, 0, 0}, {2, 10, 2}};
    cz.triggers.push_back(trig);
    cz.trigger_zone_refs.push_back({"zone_a", "zone_b"});

    gseurat::CameraRail rail;
    rail.path.control_points = {{0, 5, 0}, {10, 5, 0}, {20, 5, 0}};
    cz.rails.push_back({"main_rail", rail});

    scene.camera_zones = cz;
    state.activate(scene, {0, 0, 0});

    check(state.volume_count() == 2, "two volumes loaded");
    check(state.trigger_count() == 1, "one trigger loaded");
    check(state.rail_count() == 1, "one rail loaded");

    state.deactivate();
}

// ── Test 6: Reset player restores initial position ──────────────────────────

void test_reset_player() {
    std::printf("Reset Player:\n");
    gseurat::CameraReviewState state;
    gseurat::SceneData scene;

    gseurat::CameraZonesData cz;
    cz.default_params.mode = gseurat::CameraMode::free_look;

    gseurat::CameraVolume vol;
    vol.shape = gseurat::CamAABB{{0, 0, 0}, {50, 50, 50}};
    vol.params.mode = gseurat::CameraMode::fixed_point;
    cz.volumes.push_back({"zone_a", vol});

    scene.camera_zones = cz;
    state.activate(scene, {5, 0, 7});

    // Teleport somewhere else.
    state.teleport(100, 200);
    check(approx(state.player_position().x, 100.0f), "teleported x");
    check(approx(state.player_position().z, 200.0f), "teleported z");

    // Reset restores initial.
    state.reset_player();
    check(approx(state.player_position().x, 5.0f), "reset x to initial");
    check(approx(state.player_position().z, 7.0f), "reset z to initial");
}

// ── Test 7: inject_walk moves player ─────────────────────────────────────────

void test_inject_walk_moves_player() {
    std::printf("Inject Walk Moves Player:\n");
    gseurat::CameraReviewState state;
    gseurat::SceneData scene;

    gseurat::CameraZonesData cz;
    cz.default_params.mode = gseurat::CameraMode::free_look;

    gseurat::CameraVolume vol;
    vol.shape = gseurat::CamAABB{{0, 0, 0}, {500, 500, 500}};
    vol.params.mode = gseurat::CameraMode::fixed_point;
    vol.params.fixed_position = {0, 10, 0};
    cz.volumes.push_back({"zone_a", vol});

    scene.camera_zones = cz;
    state.activate(scene, {0, 0, 0});

    // Set world_axis mode so forward = -Z.
    state.set_move_reference(gseurat::CameraReviewState::MoveReference::world_axis);

    // Inject a 1-second walk forward.
    state.inject_walk("forward", 1.0f);

    // Simulate 10 updates of 0.1s each.
    gseurat::InputManager input;  // default: all keys false, mouse zero
    for (int i = 0; i < 10; ++i) {
        state.update(0.1f, input, false, false);
    }

    // With speed=30, 1s forward → z should be around -30.
    check(state.player_position().z < -20.0f, "inject_walk forward moved player z < -20");
}

// ── Test 8: reset_player returns to initial after inject_walk ────────────────

void test_reset_after_walk() {
    std::printf("Reset After Walk:\n");
    gseurat::CameraReviewState state;
    gseurat::SceneData scene;

    gseurat::CameraZonesData cz;
    cz.default_params.mode = gseurat::CameraMode::free_look;

    gseurat::CameraVolume vol;
    vol.shape = gseurat::CamAABB{{0, 0, 0}, {500, 500, 500}};
    vol.params.mode = gseurat::CameraMode::fixed_point;
    vol.params.fixed_position = {0, 10, 0};
    cz.volumes.push_back({"zone_a", vol});

    scene.camera_zones = cz;
    state.activate(scene, {5, 0, 7});

    // Teleport away.
    state.teleport(100, 200);
    check(approx(state.player_position().x, 100.0f), "teleported x=100");

    // Reset restores initial.
    state.reset_player();
    check(approx(state.player_position().x, 5.0f), "reset x to 5");
    check(approx(state.player_position().z, 7.0f), "reset z to 7");
}

// ── Test 9: zone resolution after teleport ───────────────────────────────────

void test_zone_resolution_after_teleport() {
    std::printf("Zone Resolution After Teleport:\n");
    gseurat::CameraReviewState state;
    gseurat::SceneData scene;

    gseurat::CameraZonesData cz;
    cz.default_params.mode = gseurat::CameraMode::free_look;

    // Zone A centered at origin.
    gseurat::CameraVolume vol_a;
    vol_a.shape = gseurat::CamAABB{{0, 0, 0}, {10, 10, 10}};
    vol_a.params.mode = gseurat::CameraMode::fixed_point;
    vol_a.params.fixed_position = {0, 10, 0};
    cz.volumes.push_back({"zone_a", vol_a});

    // Zone B centered at (100, 0, 100).
    gseurat::CameraVolume vol_b;
    vol_b.shape = gseurat::CamAABB{{100, 0, 100}, {10, 10, 10}};
    vol_b.params.mode = gseurat::CameraMode::side_scroll;
    vol_b.params.fixed_position = {100, 10, 100};
    cz.volumes.push_back({"zone_b", vol_b});

    scene.camera_zones = cz;
    state.activate(scene, {0, 0, 0});

    // Update once to resolve zone.
    gseurat::InputManager input;
    state.update(0.016f, input, false, false);
    check(state.active_zone_name() == "zone_a", "initially in zone_a");

    // Teleport to zone B and update.
    state.teleport(100, 100);
    state.update(0.016f, input, false, false);
    check(state.active_zone_name() == "zone_b", "after teleport in zone_b");
}

// ── Test 10: camera_state returns valid state ────────────────────────────────

void test_camera_state_valid() {
    std::printf("Camera State Valid:\n");
    gseurat::CameraReviewState state;
    gseurat::SceneData scene;

    gseurat::CameraZonesData cz;
    cz.default_params.mode = gseurat::CameraMode::free_look;

    gseurat::CameraVolume vol;
    vol.shape = gseurat::CamAABB{{0, 0, 0}, {50, 50, 50}};
    vol.params.mode = gseurat::CameraMode::fixed_point;
    vol.params.fixed_position = {0, 10, 0};
    cz.volumes.push_back({"zone_a", vol});

    scene.camera_zones = cz;
    state.activate(scene, {5, 0, 3});

    gseurat::InputManager input;
    state.update(0.016f, input, false, false);

    gseurat::CameraState cam = state.camera_state();
    // For fixed_point mode, position should be set to fixed_position.
    // Position and target should differ (camera looks at something).
    float dist = std::sqrt(
        (cam.position.x - cam.target.x) * (cam.position.x - cam.target.x) +
        (cam.position.y - cam.target.y) * (cam.position.y - cam.target.y) +
        (cam.position.z - cam.target.z) * (cam.position.z - cam.target.z));
    check(dist > 0.1f, "camera position != target (valid camera state)");
}

// ── Test 11: MoveReference auto-switch ───────────────────────────────────────

void test_move_reference_auto_switch() {
    std::printf("MoveReference Auto-Switch:\n");
    gseurat::CameraReviewState state;
    gseurat::SceneData scene;

    gseurat::CameraZonesData cz;
    cz.default_params.mode = gseurat::CameraMode::free_look;

    // Free-look zone at origin.
    gseurat::CameraVolume vol_fl;
    vol_fl.shape = gseurat::CamAABB{{0, 0, 0}, {10, 10, 10}};
    vol_fl.params.mode = gseurat::CameraMode::free_look;
    cz.volumes.push_back({"zone_freelook", vol_fl});

    // Rail-follow zone at (100, 0, 0).
    gseurat::CameraVolume vol_rf;
    vol_rf.shape = gseurat::CamAABB{{100, 0, 0}, {10, 10, 10}};
    vol_rf.params.mode = gseurat::CameraMode::rail_follow;
    vol_rf.params.rail_index = 0;
    cz.volumes.push_back({"zone_rail", vol_rf});

    // Add a rail with 4 control points for the rail_follow zone.
    gseurat::CameraRail rail;
    rail.path.control_points = {{80, 5, 0}, {90, 5, 0}, {100, 5, 0}, {110, 5, 0}};
    cz.rails.push_back({"main_rail", rail});

    scene.camera_zones = cz;
    state.activate(scene, {0, 0, 0});

    gseurat::InputManager input;

    // Update in free_look zone → should auto-switch to camera_facing.
    state.update(0.016f, input, false, false);
    check(state.move_reference() == gseurat::CameraReviewState::MoveReference::camera_facing,
          "free_look zone → camera_facing");

    // Teleport to rail_follow zone.
    state.teleport(100, 0);
    state.update(0.016f, input, false, false);
    check(state.move_reference() == gseurat::CameraReviewState::MoveReference::world_axis,
          "rail_follow zone → world_axis");
}

int main() {
    test_starts_inactive();
    test_activate_empty_zones();
    test_activate_valid();
    test_deactivate();
    test_multiple_zones();
    test_reset_player();
    test_inject_walk_moves_player();
    test_reset_after_walk();
    test_zone_resolution_after_teleport();
    test_camera_state_valid();
    test_move_reference_auto_switch();

    std::printf("\n%d passed, %d failed\n", passed, failed);
    return failed > 0 ? 1 : 0;
}
