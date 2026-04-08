// Test: CameraReviewState — activate/deactivate lifecycle.
// Build: add_gseurat_test(test_camera_review_state src/staging/camera_review_state.cpp
//                                                   src/engine/camera_zone_system.cpp
//                                                   src/engine/gs_spline.cpp)

#include "gseurat/staging/camera_review_state.hpp"

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

int main() {
    test_starts_inactive();
    test_activate_empty_zones();
    test_activate_valid();
    test_deactivate();
    test_multiple_zones();
    test_reset_player();

    std::printf("\n%d passed, %d failed\n", passed, failed);
    return failed > 0 ? 1 : 0;
}
