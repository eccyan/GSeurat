# Cinematic Rail Camera Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement time-driven, event-driven, and gameplay-driven cinematic camera rail mode in `CameraZoneSystem`.

**Architecture:** Extends the existing 4-stage camera pipeline. New enums and fields are added to `CameraParams`, cinematic state variables to `CameraZoneSystem`, and a public API for manual control. A bridge command enables editor scrubbing. The `parse_easing` lambda is promoted to a shared free function.

**Tech Stack:** C++23, glm, nlohmann/json, custom test framework (check/approx pattern)

---

### Task 1: Promote `parse_easing` to a Shared Free Function

**Files:**
- Modify: `include/gseurat/engine/gs_animator.hpp:44` (after `apply_easing` declaration)
- Modify: `src/engine/scene_loader.cpp:821-853` (replace lambda with call to shared function)

This task extracts the `parse_easing` lambda from `SceneLoader::parse_gs_anim_params` into a free function declared in `gs_animator.hpp` and defined in `gs_animator.cpp`, so both animation and camera params parsing can reuse it.

- [ ] **Step 1: Write the failing test**

Create `tests/test_parse_easing.cpp`:

```cpp
// Test: parse_easing — string to GsEasing enum conversion.
// Build: add_gseurat_test(test_parse_easing src/engine/gs_animator.cpp)

#include "gseurat/engine/gs_animator.hpp"

#include <cstdio>

static int passed = 0;
static int failed = 0;

static void check(bool cond, const char* msg) {
    if (cond) { std::printf("  PASS: %s\n", msg); passed++; }
    else      { std::printf("  FAIL: %s\n", msg); failed++; }
}

void test_known_easings() {
    std::printf("Known easings:\n");
    using namespace gseurat;
    check(parse_easing("linear") == GsEasing::Linear, "linear");
    check(parse_easing("in_quad") == GsEasing::InQuad, "in_quad");
    check(parse_easing("ease_in") == GsEasing::InQuad, "ease_in alias");
    check(parse_easing("out_quad") == GsEasing::OutQuad, "out_quad");
    check(parse_easing("ease_out") == GsEasing::OutQuad, "ease_out alias");
    check(parse_easing("in_out_quad") == GsEasing::InOutQuad, "in_out_quad");
    check(parse_easing("ease_in_out") == GsEasing::InOutQuad, "ease_in_out alias");
    check(parse_easing("in_elastic") == GsEasing::InElastic, "in_elastic");
    check(parse_easing("out_bounce") == GsEasing::OutBounce, "out_bounce");
}

void test_unknown_fallback() {
    std::printf("Unknown fallback:\n");
    using namespace gseurat;
    check(parse_easing("nonexistent") == GsEasing::Linear, "unknown -> Linear");
    check(parse_easing("") == GsEasing::Linear, "empty -> Linear");
}

int main() {
    std::printf("=== parse_easing Tests ===\n\n");
    test_known_easings();
    test_unknown_fallback();
    std::printf("\n=== Results: %d passed, %d failed ===\n", passed, failed);
    return failed > 0 ? 1 : 0;
}
```

- [ ] **Step 2: Register test in CMakeLists.txt**

Add after line 428 (`add_gseurat_test(test_camera_zone_system ...)`):

```cmake
add_gseurat_test(test_parse_easing src/engine/gs_animator.cpp)
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cmake --build --preset macos-debug --target test_parse_easing 2>&1 | tail -20`
Expected: Compilation error — `parse_easing` is not declared in `gseurat` namespace.

- [ ] **Step 4: Declare `parse_easing` in gs_animator.hpp**

After the `apply_easing` declaration (line 46), add:

```cpp
/// Convert a snake_case string to GsEasing enum. Unknown strings return Linear.
GsEasing parse_easing(const std::string& s);
```

- [ ] **Step 5: Implement `parse_easing` in gs_animator.cpp**

After the `apply_easing` function (after line 83), add:

```cpp
GsEasing parse_easing(const std::string& s) {
    if (s == "linear")          return GsEasing::Linear;
    if (s == "in_quad"      || s == "ease_in")     return GsEasing::InQuad;
    if (s == "out_quad"     || s == "ease_out")    return GsEasing::OutQuad;
    if (s == "in_out_quad"  || s == "ease_in_out") return GsEasing::InOutQuad;
    if (s == "in_cubic")     return GsEasing::InCubic;
    if (s == "out_cubic")    return GsEasing::OutCubic;
    if (s == "in_out_cubic") return GsEasing::InOutCubic;
    if (s == "in_quart")     return GsEasing::InQuart;
    if (s == "out_quart")    return GsEasing::OutQuart;
    if (s == "in_out_quart") return GsEasing::InOutQuart;
    if (s == "in_quint")     return GsEasing::InQuint;
    if (s == "out_quint")    return GsEasing::OutQuint;
    if (s == "in_out_quint") return GsEasing::InOutQuint;
    if (s == "in_sine")      return GsEasing::InSine;
    if (s == "out_sine")     return GsEasing::OutSine;
    if (s == "in_out_sine")  return GsEasing::InOutSine;
    if (s == "in_expo")      return GsEasing::InExpo;
    if (s == "out_expo")     return GsEasing::OutExpo;
    if (s == "in_out_expo")  return GsEasing::InOutExpo;
    if (s == "in_circ")      return GsEasing::InCirc;
    if (s == "out_circ")     return GsEasing::OutCirc;
    if (s == "in_out_circ")  return GsEasing::InOutCirc;
    if (s == "in_back")      return GsEasing::InBack;
    if (s == "out_back")     return GsEasing::OutBack;
    if (s == "in_out_back")  return GsEasing::InOutBack;
    if (s == "in_elastic")      return GsEasing::InElastic;
    if (s == "out_elastic")     return GsEasing::OutElastic;
    if (s == "in_out_elastic")  return GsEasing::InOutElastic;
    if (s == "in_bounce")       return GsEasing::InBounce;
    if (s == "out_bounce")      return GsEasing::OutBounce;
    if (s == "in_out_bounce")   return GsEasing::InOutBounce;
    return GsEasing::Linear;
}
```

- [ ] **Step 6: Update scene_loader.cpp to use shared function**

Replace the `auto parse_easing = [](const std::string& s) -> GsEasing { ... };` lambda (lines 821-853 of `scene_loader.cpp`) with:

```cpp
// parse_easing is now a free function in gs_animator.hpp — no local lambda needed.
```

Add `#include "gseurat/engine/gs_animator.hpp"` to the includes at the top of `scene_loader.cpp`.

- [ ] **Step 7: Build and run test**

Run: `cmake --build --preset macos-debug --target test_parse_easing && ./build/macos-debug/test_parse_easing`
Expected: All 11 tests pass.

- [ ] **Step 8: Run existing tests to verify no regression**

Run: `cmake --build --preset macos-debug --target test_camera_zone_system && ./build/macos-debug/test_camera_zone_system`
Expected: All 26 tests pass (unchanged).

- [ ] **Step 9: Commit**

```bash
git add include/gseurat/engine/gs_animator.hpp src/engine/gs_animator.cpp \
        src/engine/scene_loader.cpp tests/test_parse_easing.cpp CMakeLists.txt
git commit -m "refactor: promote parse_easing to shared free function in gs_animator"
```

---

### Task 2: Add New Enums and CameraParams Fields

**Files:**
- Modify: `include/gseurat/engine/camera_volume.hpp:96-129` (add enums + fields)
- Modify: `schemas/scene.schema.json:540-556` (add new properties)
- Modify: `src/engine/scene_loader.cpp:12-37` (parse new fields)

This task adds `CinematicPlayback`, `TargetMode` enums and 5 new `CameraParams` fields. Also updates the JSON schema and parser.

- [ ] **Step 1: Write the failing test**

Add to the **end** of `tests/test_camera_zone_system.cpp` (before `main()`):

```cpp
// ── Test 13: CinematicParams Defaults ──────────────────────────────────────

void test_cinematic_params_defaults() {
    std::printf("CinematicParams defaults:\n");

    gseurat::CameraParams p;
    check(p.cinematic_duration == 5.0f, "default cinematic_duration = 5.0");
    check(p.cinematic_easing == gseurat::GsEasing::InOutQuad, "default cinematic_easing = InOutQuad");
    check(p.cinematic_playback == gseurat::CinematicPlayback::once, "default cinematic_playback = once");
    check(p.play_on_enter == true, "default play_on_enter = true");
    check(p.target_mode == gseurat::TargetMode::player, "default target_mode = player");
}
```

And add `test_cinematic_params_defaults();` to `main()`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cmake --build --preset macos-debug --target test_camera_zone_system 2>&1 | tail -20`
Expected: Compilation error — `CinematicPlayback`, `TargetMode`, `cinematic_duration` etc. not declared.

- [ ] **Step 3: Add enums and fields to camera_volume.hpp**

After the `CameraMode` enum (line 104), add:

```cpp
enum class CinematicPlayback : uint8_t {
    once,       // Play once, stop at t=1
    loop,       // Wrap t from 1 back to 0
    ping_pong,  // Reverse direction at endpoints
    manual,     // Timer does NOT auto-advance; driven by API
};

enum class TargetMode : uint8_t {
    player,       // Look at player position (spring-damped)
    target_path,  // Look at target_path.evaluate(t') — same eased t
    fixed_point,  // Look at CameraParams::fixed_position
};
```

Add these fields to `CameraParams` struct (after `target_y_offset`, line 128):

```cpp
// Cinematic rail parameters (only used when mode == cinematic_rail)
float cinematic_duration{5.0f};
GsEasing cinematic_easing{GsEasing::InOutQuad};
CinematicPlayback cinematic_playback{CinematicPlayback::once};
bool play_on_enter{true};
TargetMode target_mode{TargetMode::player};
```

Add `#include "gseurat/engine/gs_animator.hpp"` to the includes of `camera_volume.hpp` (for `GsEasing`).

- [ ] **Step 4: Update scene.schema.json**

Add to the `camera_params` properties object (after `"rail_id"` at line 555):

```json
"cinematic_duration": { "type": "number", "minimum": 0, "default": 5.0 },
"cinematic_easing": { "type": "string", "default": "in_out_quad" },
"cinematic_playback": { "type": "string", "enum": ["once", "loop", "ping_pong", "manual"], "default": "once" },
"play_on_enter": { "type": "boolean", "default": true },
"target_mode": { "type": "string", "enum": ["player", "target_path", "fixed_point"], "default": "player" }
```

- [ ] **Step 5: Update parse_camera_params in scene_loader.cpp**

Add parsing for the new fields after `p.target_y_offset = j.value(...)` (line 35):

```cpp
if (j.contains("cinematic_easing")) {
    p.cinematic_easing = parse_easing(j["cinematic_easing"].get<std::string>());
}
p.cinematic_duration = j.value("cinematic_duration", 5.0f);
if (j.contains("cinematic_playback")) {
    std::string pb = j["cinematic_playback"].get<std::string>();
    if (pb == "loop")      p.cinematic_playback = CinematicPlayback::loop;
    else if (pb == "ping_pong") p.cinematic_playback = CinematicPlayback::ping_pong;
    else if (pb == "manual")    p.cinematic_playback = CinematicPlayback::manual;
    else                        p.cinematic_playback = CinematicPlayback::once;
}
p.play_on_enter = j.value("play_on_enter", true);
if (j.contains("target_mode")) {
    std::string tm = j["target_mode"].get<std::string>();
    if (tm == "target_path")   p.target_mode = TargetMode::target_path;
    else if (tm == "fixed_point") p.target_mode = TargetMode::fixed_point;
    else                          p.target_mode = TargetMode::player;
}
```

- [ ] **Step 6: Build and run test**

Run: `cmake --build --preset macos-debug --target test_camera_zone_system && ./build/macos-debug/test_camera_zone_system`
Expected: All 28 tests pass (26 existing + 2 new checks from test 13).

- [ ] **Step 7: Commit**

```bash
git add include/gseurat/engine/camera_volume.hpp schemas/scene.schema.json \
        src/engine/scene_loader.cpp tests/test_camera_zone_system.cpp
git commit -m "feat(camera): add CinematicPlayback, TargetMode enums and CameraParams fields"
```

---

### Task 3: Implement Cinematic Rail State and evaluate_vcam Logic

**Files:**
- Modify: `include/gseurat/engine/camera_zone_system.hpp:89-109` (add state vars + public API)
- Modify: `src/engine/camera_zone_system.cpp:236-250` (replace stub), `src/engine/camera_zone_system.cpp:339-403` (zone-change reset + auto-start)

This is the core implementation. It adds cinematic state variables, the full `evaluate_vcam` cinematic_rail branch, zone-change reset logic, auto-start, public manual-control API, and the completion callback.

- [ ] **Step 1: Write the failing tests**

Add to the **end** of `tests/test_camera_zone_system.cpp` (before `main()`):

```cpp
// ── Test 14: cinematic_rail — once playback ────────────────────────────────

void test_cinematic_rail_once() {
    std::printf("cinematic_rail once:\n");

    gseurat::CameraZoneSystem sys;

    gseurat::CameraRail rail;
    rail.path.control_points = {
        {0, 10, 0}, {5, 10, 0}, {10, 10, 0}
    };
    rail.has_target_path = false;

    gseurat::CameraParams defaults;
    defaults.mode = gseurat::CameraMode::cinematic_rail;
    defaults.rail_index = 0;
    defaults.cinematic_duration = 2.0f;
    defaults.cinematic_easing = gseurat::GsEasing::Linear;
    defaults.cinematic_playback = gseurat::CinematicPlayback::once;
    defaults.play_on_enter = true;
    defaults.target_mode = gseurat::TargetMode::player;
    defaults.min_ground_clearance = 0.0f;
    defaults.pitch_min = -89.0f;
    defaults.pitch_max = 89.0f;

    sys.load_from_data({}, {}, {rail}, defaults);

    // First update triggers auto-start.
    float dt = 1.0f / 60.0f;
    gseurat::CameraZoneSystem::InputState no_input;
    sys.update(dt, {5, 0, 0}, {0, 0, 0}, no_input);

    auto start = sys.current_state();
    // At t~0, camera should be near rail start {0, 10, 0}.
    check(approx(start.position.x, 0.0f, 1.5f), "cinematic once: start X near 0");

    // Run 1 second (60 frames) — should be at t=0.5 -> mid-rail ~{5, 10, 0}.
    for (int i = 0; i < 59; ++i) sys.update(dt, {5, 0, 0}, {0, 0, 0}, no_input);

    auto mid = sys.current_state();
    check(approx(mid.position.x, 5.0f, 2.0f), "cinematic once: mid X near 5");

    // Run another 1.5 seconds — should reach t=1.0 -> end ~{10, 10, 0}.
    for (int i = 0; i < 90; ++i) sys.update(dt, {5, 0, 0}, {0, 0, 0}, no_input);

    auto end = sys.current_state();
    check(approx(end.position.x, 10.0f, 1.5f), "cinematic once: end X near 10");

    // Run more frames — should stay at end (finished).
    for (int i = 0; i < 30; ++i) sys.update(dt, {5, 0, 0}, {0, 0, 0}, no_input);

    auto stuck = sys.current_state();
    check(approx(stuck.position.x, 10.0f, 1.5f), "cinematic once: stays at end after finish");
}

// ── Test 15: cinematic_rail — loop playback ────────────────────────────────

void test_cinematic_rail_loop() {
    std::printf("cinematic_rail loop:\n");

    gseurat::CameraZoneSystem sys;

    gseurat::CameraRail rail;
    rail.path.control_points = {
        {0, 10, 0}, {5, 10, 0}, {10, 10, 0}
    };
    rail.has_target_path = false;

    gseurat::CameraParams defaults;
    defaults.mode = gseurat::CameraMode::cinematic_rail;
    defaults.rail_index = 0;
    defaults.cinematic_duration = 1.0f;  // 1 second per loop
    defaults.cinematic_easing = gseurat::GsEasing::Linear;
    defaults.cinematic_playback = gseurat::CinematicPlayback::loop;
    defaults.play_on_enter = true;
    defaults.target_mode = gseurat::TargetMode::player;
    defaults.min_ground_clearance = 0.0f;
    defaults.pitch_min = -89.0f;
    defaults.pitch_max = 89.0f;

    sys.load_from_data({}, {}, {rail}, defaults);

    float dt = 1.0f / 60.0f;
    gseurat::CameraZoneSystem::InputState no_input;

    // Run 1.5 seconds (90 frames) — should wrap past t=1.0 and be back near start.
    for (int i = 0; i < 90; ++i) sys.update(dt, {5, 0, 0}, {0, 0, 0}, no_input);

    auto state = sys.current_state();
    // At t=1.5 with loop, effective t=0.5 -> mid-rail ~{5, 10, 0}.
    check(approx(state.position.x, 5.0f, 2.0f), "cinematic loop: wraps around, mid X near 5");
}

// ── Test 16: cinematic_rail — ping_pong playback ───────────────────────────

void test_cinematic_rail_ping_pong() {
    std::printf("cinematic_rail ping_pong:\n");

    gseurat::CameraZoneSystem sys;

    gseurat::CameraRail rail;
    rail.path.control_points = {
        {0, 10, 0}, {5, 10, 0}, {10, 10, 0}
    };
    rail.has_target_path = false;

    gseurat::CameraParams defaults;
    defaults.mode = gseurat::CameraMode::cinematic_rail;
    defaults.rail_index = 0;
    defaults.cinematic_duration = 1.0f;
    defaults.cinematic_easing = gseurat::GsEasing::Linear;
    defaults.cinematic_playback = gseurat::CinematicPlayback::ping_pong;
    defaults.play_on_enter = true;
    defaults.target_mode = gseurat::TargetMode::player;
    defaults.min_ground_clearance = 0.0f;
    defaults.pitch_min = -89.0f;
    defaults.pitch_max = 89.0f;

    sys.load_from_data({}, {}, {rail}, defaults);

    float dt = 1.0f / 60.0f;
    gseurat::CameraZoneSystem::InputState no_input;

    // Run exactly 1 second (60 frames) — should reach end, then start reversing.
    for (int i = 0; i < 60; ++i) sys.update(dt, {5, 0, 0}, {0, 0, 0}, no_input);

    // Run another 0.5 seconds — reversing, should be at ~mid-rail.
    for (int i = 0; i < 30; ++i) sys.update(dt, {5, 0, 0}, {0, 0, 0}, no_input);

    auto state = sys.current_state();
    check(approx(state.position.x, 5.0f, 3.0f), "cinematic ping_pong: reversed to mid X ~5");
}

// ── Test 17: cinematic_rail — manual playback ──────────────────────────────

void test_cinematic_rail_manual() {
    std::printf("cinematic_rail manual:\n");

    gseurat::CameraZoneSystem sys;

    gseurat::CameraRail rail;
    rail.path.control_points = {
        {0, 10, 0}, {5, 10, 0}, {10, 10, 0}
    };
    rail.has_target_path = false;

    gseurat::CameraParams defaults;
    defaults.mode = gseurat::CameraMode::cinematic_rail;
    defaults.rail_index = 0;
    defaults.cinematic_duration = 2.0f;
    defaults.cinematic_easing = gseurat::GsEasing::Linear;
    defaults.cinematic_playback = gseurat::CinematicPlayback::manual;
    defaults.play_on_enter = true;
    defaults.target_mode = gseurat::TargetMode::player;
    defaults.min_ground_clearance = 0.0f;
    defaults.pitch_min = -89.0f;
    defaults.pitch_max = 89.0f;

    sys.load_from_data({}, {}, {rail}, defaults);

    float dt = 1.0f / 60.0f;
    gseurat::CameraZoneSystem::InputState no_input;

    // Initial update.
    sys.update(dt, {5, 0, 0}, {0, 0, 0}, no_input);

    // Run 120 frames — in manual mode, timer should NOT advance.
    for (int i = 0; i < 120; ++i) sys.update(dt, {5, 0, 0}, {0, 0, 0}, no_input);

    auto still = sys.current_state();
    check(approx(still.position.x, 0.0f, 1.5f), "cinematic manual: stays at start after 120 frames");

    // Now set t=0.5 manually.
    sys.set_cinematic_t(0.5f);
    sys.update(dt, {5, 0, 0}, {0, 0, 0}, no_input);

    auto mid = sys.current_state();
    check(approx(mid.position.x, 5.0f, 2.0f), "cinematic manual: set_cinematic_t(0.5) -> mid X ~5");

    // Advance by delta.
    sys.advance_cinematic_t(0.25f);
    sys.update(dt, {5, 0, 0}, {0, 0, 0}, no_input);

    auto adv = sys.current_state();
    check(adv.position.x > mid.position.x, "cinematic manual: advance_cinematic_t moved forward");
}

// ── Test 18: cinematic_rail — target_path mode ──────────────────────────────

void test_cinematic_rail_target_path() {
    std::printf("cinematic_rail target_path:\n");

    gseurat::CameraZoneSystem sys;

    gseurat::CameraRail rail;
    rail.path.control_points = {
        {0, 10, 0}, {5, 10, 0}, {10, 10, 0}
    };
    rail.target_path.control_points = {
        {0, 0, 5}, {5, 0, 5}, {10, 0, 5}
    };
    rail.has_target_path = true;

    gseurat::CameraParams defaults;
    defaults.mode = gseurat::CameraMode::cinematic_rail;
    defaults.rail_index = 0;
    defaults.cinematic_duration = 2.0f;
    defaults.cinematic_easing = gseurat::GsEasing::Linear;
    defaults.cinematic_playback = gseurat::CinematicPlayback::once;
    defaults.play_on_enter = true;
    defaults.target_mode = gseurat::TargetMode::target_path;
    defaults.min_ground_clearance = 0.0f;
    defaults.pitch_min = -89.0f;
    defaults.pitch_max = 89.0f;

    sys.load_from_data({}, {}, {rail}, defaults);

    float dt = 1.0f / 60.0f;
    gseurat::CameraZoneSystem::InputState no_input;

    // Run 1 second (mid-point).
    for (int i = 0; i < 60; ++i) sys.update(dt, {5, 0, 0}, {0, 0, 0}, no_input);

    auto mid = sys.current_state();
    // Target should be on the target_path, not tracking player.
    // At t=0.5, target_path evaluates to ~{5, 0, 5}.
    check(approx(mid.target.z, 5.0f, 2.0f), "cinematic target_path: target Z near 5 (on target path)");
}

// ── Test 19: cinematic_rail — zone change resets state ─────────────────────

void test_cinematic_rail_zone_change_reset() {
    std::printf("cinematic_rail zone change reset:\n");

    gseurat::CameraZoneSystem sys;

    gseurat::CameraRail rail;
    rail.path.control_points = {
        {0, 10, 0}, {5, 10, 0}, {10, 10, 0}
    };
    rail.has_target_path = false;

    // Zone A: cinematic rail at origin
    gseurat::CameraVolume zone_a;
    zone_a.shape = gseurat::CamAABB{{0, 0, 0}, {5, 5, 5}};
    zone_a.params.mode = gseurat::CameraMode::cinematic_rail;
    zone_a.params.rail_index = 0;
    zone_a.params.cinematic_duration = 2.0f;
    zone_a.params.cinematic_easing = gseurat::GsEasing::Linear;
    zone_a.params.cinematic_playback = gseurat::CinematicPlayback::once;
    zone_a.params.play_on_enter = true;
    zone_a.params.target_mode = gseurat::TargetMode::player;
    zone_a.params.min_ground_clearance = 0.0f;
    zone_a.params.pitch_min = -89.0f;
    zone_a.params.pitch_max = 89.0f;

    // Zone B: fixed_point far away
    gseurat::CameraVolume zone_b;
    zone_b.shape = gseurat::CamAABB{{50, 0, 0}, {5, 5, 5}};
    zone_b.params.mode = gseurat::CameraMode::fixed_point;
    zone_b.params.fov = 60.0f;
    zone_b.params.fixed_position = {50, 15, 0};
    zone_b.params.blend_time = 0.01f;

    gseurat::CameraParams defaults;
    defaults.mode = gseurat::CameraMode::fixed_point;
    defaults.fixed_position = {0, 10, 0};
    defaults.pitch_min = -89.0f;
    defaults.pitch_max = 89.0f;

    std::vector<std::pair<int, gseurat::CameraVolume>> volumes = {
        {1, zone_a}, {2, zone_b}
    };

    sys.load_from_data(volumes, {}, {rail}, defaults);

    float dt = 1.0f / 60.0f;
    gseurat::CameraZoneSystem::InputState no_input;

    // Play in zone A for 1 second (advance cinematic to t=0.5).
    for (int i = 0; i < 60; ++i) sys.update(dt, {0, 0, 0}, {0, 0, 0}, no_input);

    check(sys.active_zone_entity() == 1, "zone reset: active in zone A");

    // Move to zone B.
    converge(sys, {50, 0, 0}, 30);
    check(sys.active_zone_entity() == 2, "zone reset: active in zone B");

    // Return to zone A — cinematic should restart from t=0.
    sys.update(dt, {0, 0, 0}, {0, 0, 0}, no_input);
    sys.update(dt, {0, 0, 0}, {0, 0, 0}, no_input);

    auto restarted = sys.current_state();
    // Should be near start of rail (X ~0), not where we left off (X ~5).
    check(approx(restarted.position.x, 0.0f, 2.5f), "zone reset: re-entering resets to t=0");
}

// ── Test 20: cinematic_rail — completion callback ──────────────────────────

void test_cinematic_rail_completion_callback() {
    std::printf("cinematic_rail completion callback:\n");

    gseurat::CameraZoneSystem sys;

    gseurat::CameraRail rail;
    rail.path.control_points = {
        {0, 10, 0}, {10, 10, 0}
    };
    rail.has_target_path = false;

    gseurat::CameraParams defaults;
    defaults.mode = gseurat::CameraMode::cinematic_rail;
    defaults.rail_index = 0;
    defaults.cinematic_duration = 0.5f;  // Short so we finish quickly
    defaults.cinematic_easing = gseurat::GsEasing::Linear;
    defaults.cinematic_playback = gseurat::CinematicPlayback::once;
    defaults.play_on_enter = true;
    defaults.target_mode = gseurat::TargetMode::player;
    defaults.min_ground_clearance = 0.0f;
    defaults.pitch_min = -89.0f;
    defaults.pitch_max = 89.0f;

    sys.load_from_data({}, {}, {rail}, defaults);

    int callback_zone = -999;
    sys.set_on_cinematic_complete([&](int zone_id) {
        callback_zone = zone_id;
    });

    float dt = 1.0f / 60.0f;
    gseurat::CameraZoneSystem::InputState no_input;

    // Run 1 second (60 frames) — 0.5s duration means it finishes.
    for (int i = 0; i < 60; ++i) sys.update(dt, {5, 0, 0}, {0, 0, 0}, no_input);

    check(callback_zone == -1, "completion callback: fired with zone entity -1 (world fallback)");
}
```

And add all new test calls to `main()`:

```cpp
test_cinematic_rail_once();
test_cinematic_rail_loop();
test_cinematic_rail_ping_pong();
test_cinematic_rail_manual();
test_cinematic_rail_target_path();
test_cinematic_rail_zone_change_reset();
test_cinematic_rail_completion_callback();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cmake --build --preset macos-debug --target test_camera_zone_system 2>&1 | tail -20`
Expected: Compilation error — `set_cinematic_t`, `advance_cinematic_t`, `set_on_cinematic_complete` not declared.

- [ ] **Step 3: Add state variables and public API to camera_zone_system.hpp**

Add to the **public section** (after `set_orbit_from_camera`, line 62):

```cpp
    /// Set cinematic progress to an absolute value [0, 1].
    void set_cinematic_t(float t);

    /// Add delta to current cinematic progress. Clamped to [0, 1].
    void advance_cinematic_t(float delta_t);

    /// Register a callback that fires when a cinematic_rail (once) reaches t=1.
    using CinematicCompleteCallback = std::function<void(int zone_entity_id)>;
    void set_on_cinematic_complete(CinematicCompleteCallback cb);
```

Add `#include <functional>` to the includes.

Add to the **private section** (after `last_rail_t_`, line 100):

```cpp
    // ── Cinematic rail state ────────────────────────────────────────
    enum class CinematicState : uint8_t { idle, playing, paused, finished };

    float cinematic_timer_{0.0f};
    CinematicState cinematic_state_{CinematicState::idle};
    bool cinematic_reverse_{false};
    CinematicCompleteCallback on_cinematic_complete_;

    // Helper: look up active zone's params.
    const CameraParams* active_params_ptr() const;
```

- [ ] **Step 4: Implement the cinematic_rail evaluate_vcam branch**

Replace the stub in `camera_zone_system.cpp` (lines 236-250) with:

```cpp
    case CameraMode::cinematic_rail: {
        int ri = params.rail_index;
        if (ri >= 0 && ri < static_cast<int>(rails_.size()) && rails_[ri].path.valid()) {
            // Step 1: Advance timer (time-driven modes only).
            if (cinematic_state_ == CinematicState::playing &&
                params.cinematic_playback != CinematicPlayback::manual) {
                if (cinematic_reverse_) {
                    cinematic_timer_ -= dt;
                } else {
                    cinematic_timer_ += dt;
                }
            }

            // Step 2: Compute base t.
            float base_t = (params.cinematic_duration > 0.0f)
                ? cinematic_timer_ / params.cinematic_duration
                : 1.0f;

            // Step 3: Handle playback mode boundaries.
            switch (params.cinematic_playback) {
                case CinematicPlayback::once:
                    base_t = std::clamp(base_t, 0.0f, 1.0f);
                    if (base_t >= 1.0f && cinematic_state_ == CinematicState::playing) {
                        cinematic_state_ = CinematicState::finished;
                        cinematic_timer_ = params.cinematic_duration;
                        if (on_cinematic_complete_) {
                            on_cinematic_complete_(active_zone_entity_);
                        }
                    }
                    break;
                case CinematicPlayback::loop:
                    if (base_t >= 1.0f) {
                        cinematic_timer_ = std::fmod(cinematic_timer_, params.cinematic_duration);
                        base_t = cinematic_timer_ / params.cinematic_duration;
                    }
                    if (base_t < 0.0f) base_t += 1.0f;
                    break;
                case CinematicPlayback::ping_pong:
                    if (base_t >= 1.0f && !cinematic_reverse_) {
                        cinematic_reverse_ = true;
                        cinematic_timer_ = params.cinematic_duration;
                        base_t = 1.0f;
                    } else if (base_t <= 0.0f && cinematic_reverse_) {
                        cinematic_reverse_ = false;
                        cinematic_timer_ = 0.0f;
                        base_t = 0.0f;
                    }
                    base_t = std::clamp(base_t, 0.0f, 1.0f);
                    break;
                case CinematicPlayback::manual:
                    base_t = std::clamp(base_t, 0.0f, 1.0f);
                    break;
            }

            // Step 4: Apply easing.
            float eased_t = apply_easing(std::clamp(base_t, 0.0f, 1.0f), params.cinematic_easing);

            // Step 5: Evaluate spline position.
            state.position = rails_[ri].path.evaluate(eased_t);

            // Step 6: Evaluate target based on target_mode.
            switch (params.target_mode) {
                case TargetMode::player:
                    state.target = spring_target_;
                    break;
                case TargetMode::target_path:
                    if (rails_[ri].has_target_path && rails_[ri].target_path.valid()) {
                        state.target = rails_[ri].target_path.evaluate(eased_t);
                    } else {
                        state.target = spring_target_;
                    }
                    break;
                case TargetMode::fixed_point:
                    state.target = params.fixed_position;
                    break;
            }

            // Step 7: Apply min_ground_clearance.
            float min_y = spring_target_.y + params.min_ground_clearance;
            if (state.position.y < min_y) {
                state.position.y = min_y;
            }
        } else {
            state.position = params.fixed_position;
            state.target = spring_target_;
        }
        break;
    }
```

Add `#include "gseurat/engine/gs_animator.hpp"` to the includes of `camera_zone_system.cpp`.

- [ ] **Step 5: Add zone-change reset and auto-start logic to update()**

In `update()`, after the line `active_zone_entity_ = new_zone;` (line 366), add:

```cpp
    // Reset cinematic state on zone change.
    if (new_zone != prev_zone_entity_) {
        cinematic_timer_ = 0.0f;
        cinematic_state_ = CinematicState::idle;
        cinematic_reverse_ = false;
    }
```

After the active_params lookup block (after line 377), add:

```cpp
    // Auto-start cinematic rail if play_on_enter.
    if (active_params->mode == CameraMode::cinematic_rail &&
        cinematic_state_ == CinematicState::idle &&
        active_params->play_on_enter) {
        cinematic_state_ = CinematicState::playing;
    }
```

- [ ] **Step 6: Implement public methods**

Add to the end of `camera_zone_system.cpp` (before the closing namespace brace):

```cpp
// ── Cinematic manual control ───────────────────────────────────────────────

const CameraParams* CameraZoneSystem::active_params_ptr() const {
    for (const auto& [id, vol] : volumes_) {
        if (id == active_zone_entity_) return &vol.params;
    }
    return &default_params_;
}

void CameraZoneSystem::set_cinematic_t(float t) {
    const auto* params = active_params_ptr();
    cinematic_timer_ = std::clamp(t, 0.0f, 1.0f) * params->cinematic_duration;
    if (cinematic_state_ == CinematicState::idle ||
        cinematic_state_ == CinematicState::finished) {
        cinematic_state_ = CinematicState::playing;
    }
}

void CameraZoneSystem::advance_cinematic_t(float delta_t) {
    const auto* params = active_params_ptr();
    cinematic_timer_ += delta_t * params->cinematic_duration;
    cinematic_timer_ = std::clamp(cinematic_timer_, 0.0f, params->cinematic_duration);
    if (cinematic_state_ == CinematicState::idle ||
        cinematic_state_ == CinematicState::finished) {
        cinematic_state_ = CinematicState::playing;
    }
}

void CameraZoneSystem::set_on_cinematic_complete(CinematicCompleteCallback cb) {
    on_cinematic_complete_ = std::move(cb);
}
```

- [ ] **Step 7: Build and run all tests**

Run: `cmake --build --preset macos-debug --target test_camera_zone_system && ./build/macos-debug/test_camera_zone_system`
Expected: All 40 tests pass (26 existing + 7 from Task 2 test 13 + 7 new cinematic tests).

- [ ] **Step 8: Run parse_easing test to verify no regression**

Run: `./build/macos-debug/test_parse_easing`
Expected: All 11 tests pass.

- [ ] **Step 9: Commit**

```bash
git add include/gseurat/engine/camera_zone_system.hpp src/engine/camera_zone_system.cpp \
        tests/test_camera_zone_system.cpp
git commit -m "feat(camera): implement cinematic_rail mode with time/manual/callback support"
```

---

### Task 4: Register Bridge Command and Add CommandContext Pointer

**Files:**
- Modify: `include/gseurat/engine/command_context.hpp:20-42` (add CameraZoneSystem pointer)
- Modify: `src/engine/command_dispatcher.cpp:630` (register `set_cinematic_t` command)
- Modify: `src/demo/island_demo_state.cpp` (wire up camera_zone_system pointer)

- [ ] **Step 1: Add CameraZoneSystem pointer to CommandContext**

In `command_context.hpp`, add a forward declaration before the struct:

```cpp
class CameraZoneSystem;
```

And add a member after `camera_sync_source` (line 41):

```cpp
CameraZoneSystem* camera_zone_system = nullptr;
```

- [ ] **Step 2: Register the bridge command**

In `command_dispatcher.cpp`, after the `sync_camera` handler (after line 630), add:

```cpp
    register_command("set_cinematic_t", [this](const json& cmd) -> CommandResult {
        if (!ctx_.camera_zone_system) {
            return std::unexpected(std::string("camera_zone_system not available"));
        }
        if (cmd.contains("t")) {
            ctx_.camera_zone_system->set_cinematic_t(cmd["t"].get<float>());
        } else if (cmd.contains("delta_t")) {
            ctx_.camera_zone_system->advance_cinematic_t(cmd["delta_t"].get<float>());
        } else {
            return std::unexpected(std::string("set_cinematic_t requires 't' or 'delta_t' parameter"));
        }
        return json{{"type", "ok"}};
    });
```

Add `#include "gseurat/engine/camera_zone_system.hpp"` to the includes of `command_dispatcher.cpp`.

- [ ] **Step 3: Wire up in IslandDemoState**

In `island_demo_state.cpp`, after `camera_zone_system_->load_from_data(...)` (around line 290), add:

```cpp
        // Wire up camera_zone_system for bridge commands.
        app.command_dispatcher().context().camera_zone_system = camera_zone_system_.get();
```

In the cleanup section where `camera_zone_system_.reset()` is called (around line 667), add before the reset:

```cpp
        app.command_dispatcher().context().camera_zone_system = nullptr;
```

Do the same for the other `camera_zone_system_.reset()` around line 1990.

- [ ] **Step 4: Build full project**

Run: `cmake --build --preset macos-debug 2>&1 | tail -10`
Expected: Build succeeds with 0 errors.

- [ ] **Step 5: Run camera tests to verify no regression**

Run: `./build/macos-debug/test_camera_zone_system`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add include/gseurat/engine/command_context.hpp src/engine/command_dispatcher.cpp \
        src/demo/island_demo_state.cpp
git commit -m "feat(bridge): register set_cinematic_t command for editor scrubbing"
```

---

### Task 5: Add setCinematicT to Level Designer useEngine Hook

**Files:**
- Modify: `tools/apps/level-designer/src/hooks/useEngine.ts:390-466` (add helper + export)

- [ ] **Step 1: Add setCinematicT helper**

After the `flash` callback (line 411), add:

```typescript
  // -------------------------------------------------------------------------
  // Cinematic rail control
  // -------------------------------------------------------------------------

  /**
   * Set the cinematic rail progress to an absolute value [0, 1].
   * Useful for editor timeline scrubbing.
   */
  const setCinematicT = useCallback(
    (t: number): Promise<OkResponse | null> =>
      sendCommand<OkResponse>({ cmd: 'set_cinematic_t', t }),
    [sendCommand],
  );

  /**
   * Advance the cinematic rail progress by a delta amount.
   * Useful for incremental gameplay-driven inputs.
   */
  const advanceCinematicT = useCallback(
    (deltaT: number): Promise<OkResponse | null> =>
      sendCommand<OkResponse>({ cmd: 'set_cinematic_t', delta_t: deltaT }),
    [sendCommand],
  );
```

Add to the return object (after `flash`):

```typescript
    // Cinematic rail
    setCinematicT,
    advanceCinematicT,
```

- [ ] **Step 2: Build TS tooling**

Run: `cd /Users/eccyan/dev/GSeurat/tools && pnpm build 2>&1 | tail -10`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add tools/apps/level-designer/src/hooks/useEngine.ts
git commit -m "feat(level-designer): add setCinematicT/advanceCinematicT to useEngine"
```

---

### Task 6: Full Build Verification and Integration Test

**Files:**
- No new files. Verification only.

- [ ] **Step 1: Full C++ build**

Run: `cmake --build --preset macos-debug 2>&1 | tail -10`
Expected: Build succeeds.

- [ ] **Step 2: Run all camera tests**

Run: `./build/macos-debug/test_camera_zone_system && ./build/macos-debug/test_parse_easing`
Expected: All tests pass.

- [ ] **Step 3: Full TS build**

Run: `cd /Users/eccyan/dev/GSeurat/tools && pnpm build 2>&1 | tail -10`
Expected: Build succeeds.

- [ ] **Step 4: Verify existing camera modes are unchanged**

Run: `./build/macos-debug/test_camera_zone_system 2>&1 | head -60`
Expected: Tests 1-12 (all pre-existing) pass without changes.

- [ ] **Step 5: Grep for leftover stubs**

Run: Grep for `"Stub"` or `"timer added in later task"` in `camera_zone_system.cpp`.
Expected: No matches (stub was replaced).
