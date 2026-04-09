# Camera Review Teleport Facing Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve camera facing direction when teleporting to a camera volume in Staging's camera review mode.

**Architecture:** Add `set_orbit_from_camera()` to `CameraZoneSystem` that extracts azimuth/elevation from camera direction. Call it from `CameraReviewState::teleport()` before moving the player.

**Tech Stack:** C++23, GLM, CMake

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `include/gseurat/engine/camera_zone_system.hpp` | Add `set_orbit_from_camera` declaration |
| Modify | `src/engine/camera_zone_system.cpp` | Implement `set_orbit_from_camera` |
| Modify | `src/staging/camera_review_state.cpp` | Call `set_orbit_from_camera` in `teleport()` |
| Modify | `tests/test_camera_zone_system.cpp` | Add test for `set_orbit_from_camera` |

---

### Task 1: Add set_orbit_from_camera to CameraZoneSystem

**Files:**
- Modify: `include/gseurat/engine/camera_zone_system.hpp:56` (public section)
- Modify: `src/engine/camera_zone_system.cpp` (after `spring_damp` helper)
- Test: `tests/test_camera_zone_system.cpp`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_camera_zone_system.cpp` before `main()`:

```cpp
// ── Test 12: set_orbit_from_camera preserves facing direction ────────────

void test_set_orbit_from_camera() {
    std::printf("set_orbit_from_camera:\n");

    gseurat::CameraZoneSystem sys;
    gseurat::CameraParams defaults;
    defaults.mode = gseurat::CameraMode::free_look;
    defaults.fov = 45.0f;
    defaults.orbit_distance = 10.0f;
    defaults.allow_user_orbit = false;
    defaults.pitch_min = -89.0f;
    defaults.pitch_max = 89.0f;
    defaults.blend_time = 0.0f;

    // Large sphere so position clamping doesn't interfere.
    gseurat::CameraVolume vol;
    vol.shape = gseurat::CamSphere{{0.0f, 0.0f, 0.0f}, 200.0f};
    vol.params = defaults;
    vol.params.priority = 0;

    std::vector<std::pair<int, gseurat::CameraVolume>> volumes = {{1, vol}};
    sys.load_from_data(volumes, {}, {}, defaults);

    // Converge at origin with default azimuth (0 = camera at +Z).
    converge(sys, {0.0f, 0.0f, 0.0f}, 240);

    auto before = sys.current_state();
    // Default: camera at +Z relative to target.
    check(before.position.z > before.target.z,
          "set_orbit: default camera is at +Z of target");

    // Simulate a camera that was facing from +X (camera at +X, looking at origin).
    // This corresponds to azimuth = pi/2.
    glm::vec3 fake_cam_pos = {10.0f, 3.0f, 0.0f};
    glm::vec3 fake_cam_target = {0.0f, 0.0f, 0.0f};
    sys.set_orbit_from_camera(fake_cam_pos, fake_cam_target);

    // Run frames to let spring converge with new orbit angles.
    converge(sys, {0.0f, 0.0f, 0.0f}, 240);

    auto after = sys.current_state();
    // Camera should now be at +X relative to target (not +Z).
    check(std::fabs(after.position.x - after.target.x) > 3.0f,
          "set_orbit: camera has significant X offset after set_orbit_from_camera");
    check(std::fabs(after.position.z - after.target.z) < 3.0f,
          "set_orbit: camera Z offset is small (no longer at +Z default)");

    // Test with camera looking from -Z (azimuth = pi, camera at -Z).
    glm::vec3 neg_z_cam = {0.0f, 2.0f, -10.0f};
    sys.set_orbit_from_camera(neg_z_cam, fake_cam_target);
    converge(sys, {0.0f, 0.0f, 0.0f}, 240);

    auto after2 = sys.current_state();
    check(after2.position.z < after2.target.z,
          "set_orbit: camera at -Z after set from -Z direction");
}
```

Add `test_set_orbit_from_camera();` to `main()` before the results printf.

- [ ] **Step 2: Run test to verify it fails**

Run: `cmake --build --preset macos-debug --target test_camera_zone_system 2>&1 | tail -5`

Expected: Compile error — `set_orbit_from_camera` not declared.

- [ ] **Step 3: Add declaration to header**

In `include/gseurat/engine/camera_zone_system.hpp`, add after line 55 (`bool is_transitioning() const`):

```cpp
    /// Set orbit azimuth/elevation from an existing camera position+target.
    /// Use before teleport to preserve the camera's current facing direction.
    void set_orbit_from_camera(glm::vec3 cam_pos, glm::vec3 cam_target);
```

- [ ] **Step 4: Implement set_orbit_from_camera**

In `src/engine/camera_zone_system.cpp`, add after the `nearest_t_on_spline` function (before `load_from_data`):

```cpp
void CameraZoneSystem::set_orbit_from_camera(glm::vec3 cam_pos, glm::vec3 cam_target) {
    // Inverse of the spherical-to-cartesian in evaluate_vcam (free_look):
    //   x = dist * cos(el) * sin(az)
    //   y = dist * sin(el)
    //   z = dist * cos(el) * cos(az)
    glm::vec3 offset = cam_pos - cam_target;
    float dist = std::sqrt(offset.x * offset.x + offset.y * offset.y + offset.z * offset.z);
    if (dist < 1e-6f) return;  // degenerate — keep current angles

    glm::vec3 dir = offset / dist;
    orbit_azimuth_ = std::atan2(dir.x, dir.z);
    orbit_elevation_ = std::asin(std::clamp(dir.y, -1.0f, 1.0f));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cmake --build --preset macos-debug --target test_camera_zone_system && cd build/macos-debug && ./test_camera_zone_system`

Expected: All 14 assertions in test 12 pass, plus all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add include/gseurat/engine/camera_zone_system.hpp src/engine/camera_zone_system.cpp tests/test_camera_zone_system.cpp
git commit -m "feat(camera): add set_orbit_from_camera to CameraZoneSystem"
```

---

### Task 2: Call set_orbit_from_camera from teleport()

**Files:**
- Modify: `src/staging/camera_review_state.cpp:181-192`

- [ ] **Step 1: Update both teleport overloads**

In `src/staging/camera_review_state.cpp`, replace the two teleport functions:

```cpp
void CameraReviewState::teleport(float x, float z) {
    // Preserve camera facing direction before moving the player.
    CameraState cam = zone_system_.current_state();
    zone_system_.set_orbit_from_camera(cam.position, cam.target);

    player_pos_.x = x;
    player_pos_.z = z;
    player_vel_ = glm::vec3{0.0f};
}

void CameraReviewState::teleport(float x, float y, float z) {
    // Preserve camera facing direction before moving the player.
    CameraState cam = zone_system_.current_state();
    zone_system_.set_orbit_from_camera(cam.position, cam.target);

    player_pos_.x = x;
    player_pos_.y = y;
    player_pos_.z = z;
    player_vel_ = glm::vec3{0.0f};
}
```

- [ ] **Step 2: Build to verify compilation**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`

Expected: Build succeeds.

- [ ] **Step 3: Run all camera zone tests**

Run: `cd build/macos-debug && ./test_camera_zone_system`

Expected: All tests pass (no regression).

- [ ] **Step 4: Commit**

```bash
git add src/staging/camera_review_state.cpp
git commit -m "fix(camera): preserve facing direction on teleport in camera review mode"
```
