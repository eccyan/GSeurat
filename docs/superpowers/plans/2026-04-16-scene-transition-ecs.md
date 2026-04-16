# Scene Transition ECS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a transient-entity scene-transition state machine to GSeurat (FadeOut → Loading → FadeIn) driven by `ProximityTrigger + PortalTarget` Game Objects, rendered via the existing post-process composite shader.

**Architecture:** Three new components (`PortalTarget` registered; `SceneTransition`, `ScreenFade` runtime-only), three new systems (`transition_system`, `portal_trigger_handler`, plus a single per-frame `ScreenFade → PostProcessParams` push), and a one-line `mix()` addition to the composite shader. Portal trigger handler runs after `proximity_trigger_system`, spawns transient entities, and enforces a one-transition-at-a-time invariant via the presence of `ScreenFade`.

**Tech Stack:** C++23, GLSL (Vulkan compute), CMake. No new external dependencies.

**Spec:** `docs/superpowers/specs/2026-04-16-scene-transition-ecs-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `include/gseurat/engine/ecs/components/scene_transition.hpp` | Create | `SceneTransition` struct + `State` enum |
| `include/gseurat/engine/ecs/components/screen_fade.hpp` | Create | `ScreenFade` struct |
| `include/gseurat/engine/ecs/components/portal_target.hpp` | Create | `PortalTarget` struct |
| `include/gseurat/engine/systems/transition_system.hpp` | Create | `ITransitionHost` interface + `transition_system()` |
| `include/gseurat/engine/systems/portal_trigger_handler.hpp` | Create | `portal_trigger_handler()` declaration |
| `src/engine/systems/transition_system.cpp` | Create | State machine implementation |
| `src/engine/systems/portal_trigger_handler.cpp` | Create | Spawn logic + concurrency invariant |
| `schemas/components/portal_target.schema.json` | Create | Bricklayer-authorable schema |
| `schemas/components/scene_transition.schema.json` | Create | Documentation-only |
| `schemas/components/screen_fade.schema.json` | Create | Documentation-only |
| `tests/test_transition_system.cpp` | Create | 10 unit tests, no Vulkan |
| `include/gseurat/engine/post_process.hpp` | Modify | +2 fields on `PostProcessParams` |
| `include/gseurat/engine/app_base.hpp` | Modify | Inherit `ITransitionHost`, add `set_player_position` |
| `src/engine/app_base.cpp` | Modify | Register `PortalTarget`; add 3 systems; implement `ITransitionHost` overrides; push `ScreenFade` to `PostProcessParams` each frame |
| `shaders/gs_post_process.comp` | Modify | +overlay `vec4` in UBO; +1 `mix()` line |
| `src/engine/post_process.cpp` | Modify | Pass overlay fields into UBO |
| `CMakeLists.txt` | Modify | Add `test_transition_system` target |

---

### Task 1: Create the three component headers

**Files:**
- Create: `include/gseurat/engine/ecs/components/scene_transition.hpp`
- Create: `include/gseurat/engine/ecs/components/screen_fade.hpp`
- Create: `include/gseurat/engine/ecs/components/portal_target.hpp`

- [ ] **Step 1: Create `scene_transition.hpp`**

```cpp
// include/gseurat/engine/ecs/components/scene_transition.hpp
#pragma once

#include <glm/glm.hpp>

#include <cstdint>
#include <string>

namespace gseurat {

struct SceneTransition {
    enum class State : uint8_t { FadeOut, Loading, FadeIn };

    State       current_state   = State::FadeOut;
    float       timer           = 0.0f;
    float       fade_duration   = 0.5f;
    std::string target_scene;
    glm::vec3   target_position{0.0f};
    bool        load_dispatched = false;
};

}  // namespace gseurat
```

- [ ] **Step 2: Create `screen_fade.hpp`**

```cpp
// include/gseurat/engine/ecs/components/screen_fade.hpp
#pragma once

#include <glm/glm.hpp>

namespace gseurat {

struct ScreenFade {
    glm::vec3 color{1.0f};  // default white
    float     alpha{0.0f};  // 0 = transparent, 1 = fully covering
};

}  // namespace gseurat
```

- [ ] **Step 3: Create `portal_target.hpp`**

```cpp
// include/gseurat/engine/ecs/components/portal_target.hpp
#pragma once

#include <glm/glm.hpp>

#include <string>

namespace gseurat {

struct PortalTarget {
    std::string target_scene;
    glm::vec3   target_position{0.0f};
    glm::vec3   fade_color{1.0f};
    float       fade_duration{0.5f};
};

}  // namespace gseurat
```

- [ ] **Step 4: Build to verify the headers compile cleanly**

Run: `cmake --build build/macos-debug --target gseurat_core 2>&1 | tail -3`
Expected: Build succeeds (no reference to these headers yet, but they must not have syntax errors — a subsequent task will include them).

- [ ] **Step 5: Commit**

```bash
git add include/gseurat/engine/ecs/components/
git commit -m "feat: add SceneTransition, ScreenFade, PortalTarget component headers"
```

---

### Task 2: Create the schemas

**Files:**
- Create: `schemas/components/portal_target.schema.json`
- Create: `schemas/components/scene_transition.schema.json`
- Create: `schemas/components/screen_fade.schema.json`

- [ ] **Step 1: Create `portal_target.schema.json`**

```json
{
  "name": "PortalTarget",
  "description": "Pair with ProximityTrigger on a Game Object to make it a scene portal.",
  "category": "Gameplay",
  "fields": [
    { "name": "target_scene",    "type": "string", "default": "" },
    { "name": "target_position", "type": "vec3",   "default": [0, 0, 0] },
    { "name": "fade_color",      "type": "vec3",   "default": [1, 1, 1] },
    { "name": "fade_duration",   "type": "float",  "default": 0.5, "min": 0 }
  ]
}
```

- [ ] **Step 2: Create `scene_transition.schema.json` (documentation-only)**

```json
{
  "name": "SceneTransition",
  "description": "Runtime-only state machine for scene transitions. Not authored in Bricklayer — attached at runtime by portal_trigger_handler. Listed here as reference only.",
  "category": "Runtime",
  "runtime_only": true,
  "fields": [
    { "name": "fade_duration",   "type": "float",  "default": 0.5, "min": 0 },
    { "name": "target_scene",    "type": "string", "default": "" },
    { "name": "target_position", "type": "vec3",   "default": [0, 0, 0] }
  ]
}
```

- [ ] **Step 3: Create `screen_fade.schema.json` (documentation-only)**

```json
{
  "name": "ScreenFade",
  "description": "Runtime-only full-screen overlay (color + alpha) consumed by post-process. Not authored in Bricklayer.",
  "category": "Runtime",
  "runtime_only": true,
  "fields": [
    { "name": "color", "type": "vec3",  "default": [1, 1, 1] },
    { "name": "alpha", "type": "float", "default": 0, "min": 0, "max": 1 }
  ]
}
```

- [ ] **Step 4: Commit**

```bash
git add schemas/components/portal_target.schema.json schemas/components/scene_transition.schema.json schemas/components/screen_fade.schema.json
git commit -m "feat: add component schemas for PortalTarget, SceneTransition, ScreenFade"
```

---

### Task 3: Define `ITransitionHost` + `transition_system` (test-first)

**Files:**
- Create: `include/gseurat/engine/systems/transition_system.hpp`
- Create: `src/engine/systems/transition_system.cpp`
- Create: `tests/test_transition_system.cpp`
- Modify: `CMakeLists.txt`

This task follows test-driven development. We write the tests first, watch them fail, then implement.

- [ ] **Step 1: Create the header declaring `ITransitionHost` and `transition_system`**

```cpp
// include/gseurat/engine/systems/transition_system.hpp
#pragma once

#include "gseurat/engine/ecs/world.hpp"

#include <glm/glm.hpp>

#include <string>

namespace gseurat {

/// Abstract host for the transition system. AppBase implements this;
/// tests provide a fake to avoid Vulkan dependencies.
struct ITransitionHost {
    virtual void init_scene(const std::string& path) = 0;
    virtual void set_player_position(const glm::vec3& pos) = 0;
    virtual ~ITransitionHost() = default;
};

/// Advances any SceneTransition entities in the world by dt.
/// On FadeOut→Loading, invokes host.init_scene() then host.set_player_position().
/// Destroys the transient entity when FadeIn completes.
void transition_system(ecs::World& world, ITransitionHost& host, float dt);

}  // namespace gseurat
```

- [ ] **Step 2: Create `portal_trigger_handler.hpp` (declaration only)**

```cpp
// include/gseurat/engine/systems/portal_trigger_handler.hpp
#pragma once

#include "gseurat/engine/ecs/world.hpp"

namespace gseurat {

/// Consumes ProximityTrigger.triggered on entities that also have PortalTarget
/// and spawns a transient SceneTransition entity. Enforces the one-transition-
/// at-a-time invariant by checking for existing ScreenFade entities.
void portal_trigger_handler(ecs::World& world);

}  // namespace gseurat
```

- [ ] **Step 3: Create `tests/test_transition_system.cpp` with all 10 tests**

```cpp
// tests/test_transition_system.cpp
//
// Standalone unit test for the scene transition state machine.
// No Vulkan dependency — uses ITransitionHost fake.
//
// Build (wired via add_gseurat_test):
//   cmake --build build/macos-debug --target test_transition_system
// Run:
//   ./build/macos-debug/test_transition_system

#include "gseurat/engine/ecs/components/portal_target.hpp"
#include "gseurat/engine/ecs/components/scene_transition.hpp"
#include "gseurat/engine/ecs/components/screen_fade.hpp"
#include "gseurat/engine/ecs/world.hpp"
#include "gseurat/engine/systems/portal_trigger_handler.hpp"
#include "gseurat/engine/systems/transition_system.hpp"
#include "gseurat/engine/trigger_components.hpp"

#include <cassert>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

using namespace gseurat;

struct FakeHost : ITransitionHost {
    std::vector<std::string> init_scene_calls;
    std::vector<glm::vec3>   set_player_position_calls;
    void init_scene(const std::string& p) override { init_scene_calls.push_back(p); }
    void set_player_position(const glm::vec3& p) override { set_player_position_calls.push_back(p); }
};

static bool approx(float a, float b, float eps = 0.001f) {
    return std::fabs(a - b) < eps;
}

// Creates a transient transition entity directly (bypassing the handler).
// Used by tests that focus on transition_system state machine behavior.
static ecs::Entity spawn_direct(ecs::World& w, const std::string& scene, glm::vec3 pos, float dur) {
    auto e = w.create();
    SceneTransition st;
    st.current_state   = SceneTransition::State::FadeOut;
    st.timer           = 0.0f;
    st.fade_duration   = dur;
    st.target_scene    = scene;
    st.target_position = pos;
    st.load_dispatched = false;
    w.add<SceneTransition>(e, st);

    ScreenFade fade;
    fade.color = glm::vec3(1.0f);
    fade.alpha = 0.0f;
    w.add<ScreenFade>(e, fade);
    return e;
}

int main() {
    // ====== Test 1: FadeOut ramp — alpha climbs 0 → 1 linearly ======
    {
        ecs::World w;
        FakeHost host;
        spawn_direct(w, "dummy.json", {0, 0, 0}, 1.0f);

        transition_system(w, host, 0.25f);
        bool checked = false;
        w.view<ScreenFade>().each([&](ecs::Entity, ScreenFade& f) {
            assert(approx(f.alpha, 0.25f) && "alpha should be 0.25 after 0.25s of 1.0s fade");
            checked = true;
        });
        assert(checked);

        transition_system(w, host, 0.5f);
        w.view<ScreenFade>().each([&](ecs::Entity, ScreenFade& f) {
            assert(approx(f.alpha, 0.75f) && "alpha should be 0.75 after 0.75s");
        });
        printf("PASS: Test 1 - FadeOut ramp\n");
    }

    // ====== Test 2: FadeOut → Loading transition at alpha=1.0 ======
    {
        ecs::World w;
        FakeHost host;
        spawn_direct(w, "dummy.json", {0, 0, 0}, 0.5f);

        // Advance exactly to completion
        transition_system(w, host, 0.5f);

        w.view<SceneTransition, ScreenFade>().each(
            [&](ecs::Entity, SceneTransition& st, ScreenFade& f) {
                assert(st.current_state == SceneTransition::State::Loading);
                assert(approx(st.timer, 0.0f) && "timer resets on state change");
                assert(approx(f.alpha, 1.0f) && "alpha pinned at 1.0");
            });
        printf("PASS: Test 2 - FadeOut completion transitions to Loading\n");
    }

    // ====== Test 3: Loading first tick calls init_scene + set_player_position once ======
    {
        ecs::World w;
        FakeHost host;
        spawn_direct(w, "target.json", {7.0f, 0.0f, 3.0f}, 0.5f);

        transition_system(w, host, 0.5f);     // FadeOut→Loading
        transition_system(w, host, 0.016f);   // First Loading tick: dispatches load

        assert(host.init_scene_calls.size() == 1);
        assert(host.init_scene_calls[0] == "target.json");
        assert(host.set_player_position_calls.size() == 1);
        assert(approx(host.set_player_position_calls[0].x, 7.0f));
        assert(approx(host.set_player_position_calls[0].z, 3.0f));
        printf("PASS: Test 3 - Loading first tick calls host exactly once\n");
    }

    // ====== Test 4: Loading second tick transitions to FadeIn without re-calling host ======
    {
        ecs::World w;
        FakeHost host;
        spawn_direct(w, "target.json", {0, 0, 0}, 0.5f);

        transition_system(w, host, 0.5f);     // FadeOut→Loading
        transition_system(w, host, 0.016f);   // Loading tick 1: dispatches load
        transition_system(w, host, 0.016f);   // Loading tick 2: advances to FadeIn

        assert(host.init_scene_calls.size() == 1 && "host should NOT be re-called");
        w.view<SceneTransition>().each([&](ecs::Entity, SceneTransition& st) {
            assert(st.current_state == SceneTransition::State::FadeIn);
            assert(approx(st.timer, 0.0f));
        });
        printf("PASS: Test 4 - Loading one-frame settle advances to FadeIn\n");
    }

    // ====== Test 5: FadeIn ramp — alpha descends 1 → 0 ======
    {
        ecs::World w;
        FakeHost host;
        spawn_direct(w, "target.json", {0, 0, 0}, 1.0f);

        transition_system(w, host, 1.0f);    // complete FadeOut
        transition_system(w, host, 0.016f);  // Loading 1
        transition_system(w, host, 0.016f);  // Loading 2 → FadeIn
        transition_system(w, host, 0.25f);   // FadeIn partial

        w.view<ScreenFade>().each([&](ecs::Entity, ScreenFade& f) {
            assert(approx(f.alpha, 0.75f) && "alpha should be 1 - 0.25/1.0 = 0.75");
        });
        printf("PASS: Test 5 - FadeIn ramp\n");
    }

    // ====== Test 6: FadeIn completion destroys the entity ======
    {
        ecs::World w;
        FakeHost host;
        spawn_direct(w, "target.json", {0, 0, 0}, 0.5f);

        // Exact completion: FadeOut 0.5 + Loading (2 ticks) + FadeIn 0.5
        transition_system(w, host, 0.5f);
        transition_system(w, host, 0.016f);
        transition_system(w, host, 0.016f);
        transition_system(w, host, 0.5f);

        assert(w.view<SceneTransition>().count() == 0 && "entity should be destroyed");
        assert(w.view<ScreenFade>().count() == 0);
        printf("PASS: Test 6 - FadeIn completion destroys entity\n");
    }

    // ====== Test 7: Portal handler spawns transient entity when triggered ======
    {
        ecs::World w;
        auto portal = w.create();
        ProximityTrigger pt;
        pt.triggered = true;    // simulate proximity_trigger_system having fired
        pt.radius = 2.0f;
        w.add<ProximityTrigger>(portal, pt);

        PortalTarget pta;
        pta.target_scene = "dungeon.json";
        pta.target_position = glm::vec3(5, 0, 3);
        pta.fade_color = glm::vec3(0.2f, 0.2f, 0.2f);
        pta.fade_duration = 0.3f;
        w.add<PortalTarget>(portal, pta);

        portal_trigger_handler(w);

        assert(w.view<SceneTransition>().count() == 1 && "should spawn one transient entity");
        assert(w.view<ScreenFade>().count() == 1);

        w.view<SceneTransition, ScreenFade>().each(
            [&](ecs::Entity, SceneTransition& st, ScreenFade& f) {
                assert(st.target_scene == "dungeon.json");
                assert(approx(st.target_position.x, 5.0f));
                assert(approx(st.fade_duration, 0.3f));
                assert(approx(f.color.r, 0.2f));
                assert(approx(f.alpha, 0.0f));
            });
        printf("PASS: Test 7 - Portal handler spawns transient entity\n");
    }

    // ====== Test 8: Portal handler skips portals with empty target_scene ======
    {
        ecs::World w;
        auto portal = w.create();
        ProximityTrigger pt;
        pt.triggered = true;
        w.add<ProximityTrigger>(portal, pt);

        PortalTarget pta;  // target_scene left empty
        w.add<PortalTarget>(portal, pta);

        portal_trigger_handler(w);

        assert(w.view<SceneTransition>().count() == 0 && "should not spawn for empty target");
        printf("PASS: Test 8 - Portal handler skips empty target_scene\n");
    }

    // ====== Test 9: Concurrency invariant — ScreenFade present blocks new spawns ======
    {
        ecs::World w;
        // Pre-existing transition
        spawn_direct(w, "in_progress.json", {0, 0, 0}, 0.5f);

        // Firing portal
        auto portal = w.create();
        ProximityTrigger pt;
        pt.triggered = true;
        w.add<ProximityTrigger>(portal, pt);
        PortalTarget pta;
        pta.target_scene = "new_scene.json";
        w.add<PortalTarget>(portal, pta);

        portal_trigger_handler(w);

        // Still exactly one ScreenFade (the pre-existing one, not a new one)
        assert(w.view<ScreenFade>().count() == 1 && "no second transient entity");
        assert(w.view<SceneTransition>().count() == 1);
        w.view<SceneTransition>().each([&](ecs::Entity, SceneTransition& st) {
            assert(st.target_scene == "in_progress.json" && "original transition preserved");
        });
        printf("PASS: Test 9 - Concurrency invariant holds\n");
    }

    // ====== Test 10: End-to-end full cycle ======
    {
        ecs::World w;
        FakeHost host;

        auto portal = w.create();
        ProximityTrigger pt;
        pt.triggered = true;
        w.add<ProximityTrigger>(portal, pt);
        PortalTarget pta;
        pta.target_scene = "final.json";
        pta.target_position = glm::vec3(1, 2, 3);
        pta.fade_duration = 0.2f;
        w.add<PortalTarget>(portal, pta);

        // Frame 1: handler spawns entity
        portal_trigger_handler(w);
        assert(w.view<SceneTransition>().count() == 1);

        // Advance 0.2s FadeOut + 2 Loading ticks + 0.2s FadeIn
        transition_system(w, host, 0.2f);
        transition_system(w, host, 0.016f);
        transition_system(w, host, 0.016f);
        transition_system(w, host, 0.2f);

        assert(host.init_scene_calls.size() == 1);
        assert(host.init_scene_calls[0] == "final.json");
        assert(w.view<SceneTransition>().count() == 0 && "entity destroyed at cycle end");
        printf("PASS: Test 10 - End-to-end full cycle\n");
    }

    printf("\nAll scene transition tests passed!\n");
    return 0;
}
```

- [ ] **Step 4: Register the test target in `CMakeLists.txt`**

Find the section with the other `add_gseurat_test(...)` calls (around line 358) and add this line after `test_gaussian_cloud`:

```cmake
add_gseurat_test(test_transition_system  src/engine/systems/transition_system.cpp
                                          src/engine/systems/portal_trigger_handler.cpp)
```

- [ ] **Step 5: Attempt to build — expect LINK failure**

Run: `cmake --build build/macos-debug --target test_transition_system 2>&1 | tail -5`
Expected: **FAIL** — the test compiles but linking fails with undefined symbols `transition_system` and `portal_trigger_handler` (their .cpp files don't exist yet). This is the "red" step of TDD: tests are written and wired up, waiting for implementation.

- [ ] **Step 6: Implement `transition_system.cpp`**

```cpp
// src/engine/systems/transition_system.cpp
#include "gseurat/engine/systems/transition_system.hpp"

#include "gseurat/engine/ecs/components/scene_transition.hpp"
#include "gseurat/engine/ecs/components/screen_fade.hpp"

#include <algorithm>
#include <vector>

namespace gseurat {

void transition_system(ecs::World& world, ITransitionHost& host, float dt) {
    std::vector<ecs::Entity> to_destroy;

    world.view<SceneTransition, ScreenFade>().each(
        [&](ecs::Entity e, SceneTransition& st, ScreenFade& fade) {
            st.timer += dt;

            switch (st.current_state) {
                case SceneTransition::State::FadeOut: {
                    const float t = std::clamp(st.timer / st.fade_duration, 0.0f, 1.0f);
                    fade.alpha = t;
                    if (t >= 1.0f) {
                        st.current_state = SceneTransition::State::Loading;
                        st.timer = 0.0f;
                        fade.alpha = 1.0f;
                    }
                    break;
                }

                case SceneTransition::State::Loading: {
                    if (!st.load_dispatched) {
                        host.init_scene(st.target_scene);
                        host.set_player_position(st.target_position);
                        st.load_dispatched = true;
                    } else {
                        st.current_state = SceneTransition::State::FadeIn;
                        st.timer = 0.0f;
                    }
                    break;
                }

                case SceneTransition::State::FadeIn: {
                    const float t = std::clamp(st.timer / st.fade_duration, 0.0f, 1.0f);
                    fade.alpha = 1.0f - t;
                    if (t >= 1.0f) {
                        fade.alpha = 0.0f;
                        to_destroy.push_back(e);
                    }
                    break;
                }
            }
        });

    for (auto e : to_destroy) world.destroy(e);
}

}  // namespace gseurat
```

- [ ] **Step 7: Implement `portal_trigger_handler.cpp`**

```cpp
// src/engine/systems/portal_trigger_handler.cpp
#include "gseurat/engine/systems/portal_trigger_handler.hpp"

#include "gseurat/engine/ecs/components/portal_target.hpp"
#include "gseurat/engine/ecs/components/scene_transition.hpp"
#include "gseurat/engine/ecs/components/screen_fade.hpp"
#include "gseurat/engine/trigger_components.hpp"

#include <optional>

namespace gseurat {

void portal_trigger_handler(ecs::World& world) {
    // Concurrency invariant: skip if a transition is already running.
    bool transition_in_flight = false;
    world.view<ScreenFade>().each(
        [&](ecs::Entity, ScreenFade&) { transition_in_flight = true; });
    if (transition_in_flight) return;

    std::optional<PortalTarget> to_spawn;
    world.view<ProximityTrigger, PortalTarget>().each(
        [&](ecs::Entity, ProximityTrigger& trig, PortalTarget& portal) {
            if (to_spawn.has_value()) return;
            if (!trig.triggered) return;
            if (portal.target_scene.empty()) return;
            to_spawn = portal;
        });

    if (!to_spawn.has_value()) return;

    auto e = world.create();

    SceneTransition st;
    st.current_state   = SceneTransition::State::FadeOut;
    st.timer           = 0.0f;
    st.fade_duration   = to_spawn->fade_duration;
    st.target_scene    = to_spawn->target_scene;
    st.target_position = to_spawn->target_position;
    st.load_dispatched = false;
    world.add<SceneTransition>(e, st);

    ScreenFade fade;
    fade.color = to_spawn->fade_color;
    fade.alpha = 0.0f;
    world.add<ScreenFade>(e, fade);
}

}  // namespace gseurat
```

- [ ] **Step 8: Build and run the tests**

Run:
```
cmake --build build/macos-debug --target test_transition_system 2>&1 | tail -5
./build/macos-debug/test_transition_system
```

Expected: Build succeeds. All 10 tests print PASS, final line "All scene transition tests passed!".

- [ ] **Step 9: Commit**

```bash
git add include/gseurat/engine/systems/ src/engine/systems/ tests/test_transition_system.cpp CMakeLists.txt
git commit -m "feat: implement transition_system + portal_trigger_handler with TDD tests"
```

---

### Task 4: Wire overlay into PostProcessParams and UBO

**Files:**
- Modify: `include/gseurat/engine/post_process.hpp`
- Modify: `src/engine/post_process.cpp`
- Modify: `shaders/gs_post_process.comp`

- [ ] **Step 1: Add fields to `PostProcessParams`**

In `include/gseurat/engine/post_process.hpp`, find the `PostProcessParams` struct (ends at the line `float flash_b = 0.0f;` around line 36) and add two fields just before the closing `};`:

```cpp
    float flash_b = 0.0f;
    // Scene-transition overlay (ScreenFade): final mix() applied after tone mapping.
    // overlay_alpha == 0 produces a shader no-op.
    float overlay_r = 1.0f;
    float overlay_g = 1.0f;
    float overlay_b = 1.0f;
    float overlay_alpha = 0.0f;
};
```

(Using scalar floats instead of `glm::vec3` to match the existing convention in this struct — see `flash_r/g/b`.)

- [ ] **Step 2: Find where `PostProcessParams` is uploaded to the UBO**

Run: `grep -n "flash_r\|flash_color\|fade_amount" src/engine/post_process.cpp | head -20`

Expected: locate the function that copies `PostProcessParams` fields into the GPU UBO struct. Read the surrounding code (±30 lines) to understand the UBO layout.

- [ ] **Step 3: Add overlay fields to the UBO struct and upload path**

The existing UBO in `gs_post_process.comp` (and mirror struct in `post_process.cpp`) already carries a `vec4` per related concept (e.g. `flash_color`). Add one more `vec4 overlay` entry (xyz = color, w = alpha) to both sides. Concretely:

In `src/engine/post_process.cpp`, in the UBO mirror struct (search for the `struct` near where `fade_amount` is assigned), add:

```cpp
// existing fields: fade_amount, flash_r/g/b packed as vec4, etc.
float overlay_r, overlay_g, overlay_b, overlay_alpha;  // matches GLSL vec4 overlay
```

and in the copy function:

```cpp
ubo.overlay_r     = params.overlay_r;
ubo.overlay_g     = params.overlay_g;
ubo.overlay_b     = params.overlay_b;
ubo.overlay_alpha = params.overlay_alpha;
```

(The exact struct/function name depends on what `grep` finds in Step 2. The pattern should match how `flash_r/g/b` is currently uploaded.)

- [ ] **Step 4: Add the matching GLSL struct field**

In `shaders/gs_post_process.comp`, find the UBO declaration (search for `layout(set = 0, binding = 0) uniform` or the struct where `fade_amount` is declared) and add:

```glsl
vec4 overlay;  // xyz = overlay color, w = overlay alpha (0 = no overlay)
```

Keep the declaration order identical to the C++ mirror struct (critical — std140/std430 alignment depends on order).

- [ ] **Step 5: Add the `mix()` at the end of the shader**

In `shaders/gs_post_process.comp`, find the final color assignment (the last place `color` or `out_color` is computed before writing to the output image). Add immediately before the `imageStore` or output write:

```glsl
    // Scene-transition overlay (last thing applied, after tone mapping)
    color.rgb = mix(color.rgb, ubo.overlay.rgb, ubo.overlay.a);
```

- [ ] **Step 6: Build**

Run: `cmake --build build/macos-debug --target gseurat_core 2>&1 | tail -5`
Expected: Build succeeds. Shader is re-compiled (SPIR-V regenerated) as part of the build.

If shader compile fails due to layout mismatch, re-check the order of fields in the C++ mirror struct vs GLSL UBO declaration. They must be identical.

- [ ] **Step 7: Commit**

```bash
git add include/gseurat/engine/post_process.hpp src/engine/post_process.cpp shaders/gs_post_process.comp
git commit -m "feat: add overlay color+alpha to PostProcessParams for scene fades"
```

---

### Task 5: Implement `ITransitionHost` on `AppBase` and wire systems

**Files:**
- Modify: `include/gseurat/engine/app_base.hpp`
- Modify: `src/engine/app_base.cpp`

- [ ] **Step 1: Inherit `ITransitionHost` on `AppBase`**

In `include/gseurat/engine/app_base.hpp`, add the include and inheritance:

```cpp
#include "gseurat/engine/systems/transition_system.hpp"
```

Find the `class AppBase` declaration and change:

```cpp
class AppBase {
```

to:

```cpp
class AppBase : public ITransitionHost {
```

And inside the public section, add:

```cpp
    // ITransitionHost implementation
    void init_scene(const std::string& scene_path) override;  // existing, just add `override`
    void set_player_position(const glm::vec3& pos) override;
```

Note: `init_scene` is already declared virtual; we only need to add `override` and then the new `set_player_position`.

- [ ] **Step 2: Implement `set_player_position` in `app_base.cpp`**

Add at the bottom of `AppBase`'s method definitions (before the closing `}  // namespace gseurat`):

```cpp
void AppBase::set_player_position(const glm::vec3& pos) {
    world_.view<PlayerTag, ecs::Transform>().each(
        [&](ecs::Entity, PlayerTag&, ecs::Transform& t) {
            t.position = coord::WorldPos(pos);
        });
}
```

(Requires `#include "gseurat/engine/ecs/default_components.hpp"` and `#include "gseurat/engine/trigger_components.hpp"` at the top of the .cpp — check if already included; add if missing.)

- [ ] **Step 3: Register `PortalTarget` in the component registry**

In `src/engine/app_base.cpp`, find the block of `component_registry_.register_component<...>` calls (around line 226 onward). Add this registration after `LinkedTrigger`:

```cpp
    component_registry_.register_component<PortalTarget>("PortalTarget",
        [](const nlohmann::json& j) -> PortalTarget {
            PortalTarget c;
            if (j.contains("target_scene")) c.target_scene = j["target_scene"].get<std::string>();
            if (j.contains("target_position")) c.target_position = SceneLoader::parse_vec3(j["target_position"]);
            if (j.contains("fade_color")) c.fade_color = SceneLoader::parse_vec3(j["fade_color"]);
            if (j.contains("fade_duration")) c.fade_duration = j["fade_duration"].get<float>();
            return c;
        },
        [](const PortalTarget& c) -> nlohmann::json {
            return {
                {"target_scene", c.target_scene},
                {"target_position", {c.target_position.x, c.target_position.y, c.target_position.z}},
                {"fade_color", {c.fade_color.x, c.fade_color.y, c.fade_color.z}},
                {"fade_duration", c.fade_duration}
            };
        });
```

(`SceneLoader::parse_vec3` is a static helper that already exists — see `include/gseurat/engine/scene_loader.hpp:213`.)

Also add these includes at the top of the file:

```cpp
#include "gseurat/engine/ecs/components/portal_target.hpp"
#include "gseurat/engine/ecs/components/scene_transition.hpp"
#include "gseurat/engine/ecs/components/screen_fade.hpp"
#include "gseurat/engine/systems/portal_trigger_handler.hpp"
```

- [ ] **Step 4: Register the two new systems with the SystemScheduler**

In `src/engine/app_base.cpp`, find `system_scheduler_.add_system({"proximity_trigger", ...});` (around line 327). Add immediately after it:

```cpp
    system_scheduler_.add_system({"portal_trigger_handler",
        [](ecs::World& w, float) { portal_trigger_handler(w); },
        /* reads */ {}, /* writes */ {}});

    system_scheduler_.add_system({"transition_system",
        [this](ecs::World& w, float dt) { transition_system(w, *this, dt); },
        /* reads */ {}, /* writes */ {}});
```

- [ ] **Step 5: Push ScreenFade into PostProcessParams each frame**

Find where `PostProcessParams` is built per frame. Run: `grep -n "PostProcessParams\|params.fade_amount\|params\." src/engine/app_base.cpp | head -10`

Identify the function that assembles `PostProcessParams pp` (likely in `AppBase::update` or a helper called from it). Add this block BEFORE the params struct is passed to the renderer:

```cpp
    // Consume ScreenFade, if any. At most one exists (concurrency invariant).
    world_.view<ScreenFade>().each(
        [&](ecs::Entity, ScreenFade& fade) {
            pp.overlay_r     = fade.color.r;
            pp.overlay_g     = fade.color.g;
            pp.overlay_b     = fade.color.b;
            pp.overlay_alpha = fade.alpha;
        });
    // If no ScreenFade exists, overlay_alpha stays at its default 0.0 → shader no-ops.
```

Replace `pp` with the actual local variable name used in `app_base.cpp` (whatever the grep in Step 5 revealed).

- [ ] **Step 6: Build the full engine**

Run: `cmake --build build/macos-debug --target gseurat_core gseurat_demo 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 7: Re-run the full test suite to catch regressions**

Run: `ctest --test-dir build/macos-debug --output-on-failure 2>&1 | tail -20`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add include/gseurat/engine/app_base.hpp src/engine/app_base.cpp
git commit -m "feat: wire scene transitions into AppBase (ITransitionHost, PortalTarget registration, system scheduling)"
```

---

### Task 6: Author a portal in the island demo and manually verify

**Files:**
- Modify: one existing scene JSON in `examples/island_demo/assets/scenes/` to add a portal
- Optionally: create a second scene to portal *to*

- [ ] **Step 1: Identify the island demo's main scene and pick a destination**

Run: `ls examples/island_demo/assets/scenes/ | head -5`
Read the main scene. Pick:
- **A source scene** (the one the demo loads by default)
- **A destination scene** (any other .json, or the same scene again for a self-loop smoke test)

- [ ] **Step 2: Add a Game Object with ProximityTrigger + PortalTarget**

In the source scene JSON, add to the `game_objects` array:

```json
{
  "id": "test_portal_01",
  "name": "Test Portal",
  "position": [15, 0, 10],
  "scale": 1.0,
  "components": {
    "ProximityTrigger": { "radius": 2.0, "one_shot": true },
    "PortalTarget": {
      "target_scene": "assets/scenes/SOME_OTHER_SCENE.json",
      "target_position": [0, 0, 0],
      "fade_color": [1.0, 1.0, 1.0],
      "fade_duration": 0.5
    }
  }
}
```

Replace `SOME_OTHER_SCENE.json` with the destination scene path from Step 1, and pick coordinates inside a walkable area of the source scene.

- [ ] **Step 3: Launch the demo and visually test**

Run: `./build/macos-debug/gseurat_demo` (or the platform equivalent). Walk to the portal. Expected:
1. Player touches the portal radius → screen fades to white over ~0.5s.
2. Single frame of white (scene swap happens here).
3. Screen fades back in over ~0.5s, revealing the destination scene.
4. Player is at `target_position` in the new scene.

If the transition doesn't trigger: check that the source scene actually includes the portal Game Object after the edit (`grep PortalTarget <scene>.json`).

If no visual fade: check that the composite shader is being rebuilt (`ls -la build/macos-debug/shaders/gs_post_process.comp.spv` — should be recent) and that `overlay_alpha` reaches 1.0 at peak (add a `printf` in `transition_system` temporarily if needed).

- [ ] **Step 4: Commit the demo portal**

```bash
git add examples/island_demo/assets/scenes/SOME_SCENE.json
git commit -m "demo: add test portal to island demo for scene transition validation"
```

---

## Out of Scope (explicitly deferred)

- Async scene loading (Loading state currently uses synchronous `init_scene`).
- Easing / non-linear fade curves.
- Audio hooks tied to transition state changes.
- Bricklayer UI polish for the new `PortalTarget` schema (schema is registered; Bricklayer auto-generates editor from it).
- Non-portal triggers that want to reuse the transition machinery (interact key, cutscene entries, save respawns).

These can all layer onto this foundation without changing the component schemas or system APIs.
