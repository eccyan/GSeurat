# ECS-Based Scene Transition System (Transient Entity Pattern)

## Problem

GSeurat can currently parse `PortalData` from scene JSON (`scene_loader.cpp:484-501`), but nothing consumes it:

1. **No portal trigger system exists.** Portals sit as POD inside `SceneData.portals[]` and never fire.
2. **`AppBase::init_scene()` is synchronous and non-composable** — no way to overlay a fade-out, swap the scene, and fade back in without hardcoding the flow into the scene manager.
3. **No scene-swap presentation layer.** A portal transition today would be a hard cut with a single-frame visual jump.

Any ad-hoc implementation risks coupling gameplay (triggers), scene management, and presentation (fade colors/durations) together, producing a scene transition path that must be reinvented for every new trigger type (teleports, cutscene entries, save-point respawns).

## Solution

A **transient-entity state machine** built purely on the existing ECS. When a portal trigger fires, it spawns a short-lived entity carrying two components:

- `SceneTransition` — state machine (FadeOut → Loading → FadeIn), timer, target scene, target position
- `ScreenFade` — full-screen overlay color and alpha consumed by the post-process shader

A single system (`transition_system`) advances the state machine, triggers the synchronous scene swap during the `Loading` state (invisible under a fully-opaque overlay), and destroys the entity when `FadeIn` completes. When no `SceneTransition` entity exists, no transition state lives anywhere — the engine is in its normal gameplay mode.

Portal triggering uses the existing `ProximityTrigger` component paired with a new `PortalTarget` component. A Game Object authored in Bricklayer with both components becomes a functioning portal without any special engine handling.

## Architecture and Data Flow

```
[Authoring — Bricklayer]
  Game Object with components:
    { ProximityTrigger { radius }, PortalTarget { target_scene, target_position, ... } }
                              │
                              │ scene load → world.create() + attach both
                              ▼
[Runtime systems, in this order each frame]

  proximity_trigger_system
      ├─ detects player-in-radius
      └─ sets ProximityTrigger.triggered = true on matching entities
                              │
                              ▼
  portal_trigger_handler
      ├─ concurrency check: any existing ScreenFade? → skip this frame
      ├─ find first entity with triggered ProximityTrigger AND PortalTarget
      ├─ validate PortalTarget.target_scene is not empty
      └─ spawn transient entity:
           world.add<SceneTransition>(state=FadeOut, target_scene, target_position, ...)
           world.add<ScreenFade>(color, alpha=0)
                              │
                              ▼
  transition_system (advances every frame)
      ├─ FadeOut : alpha 0 → 1 over fade_duration
      ├─ Loading : first tick  → host.init_scene() + host.set_player_position()
      │            second tick → transition to FadeIn (one-frame settle)
      ├─ FadeIn  : alpha 1 → 0 over fade_duration
      └─ on FadeIn completion → world.destroy(entity)
                              │
                              ▼
[Per-frame, after run_all()]

  AppBase::update()
      ├─ view<ScreenFade> → PostProcessParams.overlay_color / .overlay_alpha
      └─ if no ScreenFade exists → overlay_alpha stays 0 → shader mix() is a no-op
                              │
                              ▼
  gs_post_process.comp
      └─ final_rgb = mix(scene_rgb, overlay.rgb, overlay.alpha)
```

**Concurrency invariant:** only one transient transition entity exists at any time. `portal_trigger_handler` bails early if any `ScreenFade` exists in the world.

## Components

### `SceneTransition`

Runtime state machine owner. Not registered in `ComponentRegistry` (never authored, never serialized).

```cpp
// include/gseurat/engine/ecs/components/scene_transition.hpp
namespace gseurat {

struct SceneTransition {
    enum class State : uint8_t { FadeOut, Loading, FadeIn };

    State       current_state   = State::FadeOut;
    float       timer           = 0.0f;      // seconds into current state
    float       fade_duration   = 0.5f;      // FadeOut and FadeIn each take this long
    std::string target_scene;
    glm::vec3   target_position{0.0f};
    bool        load_dispatched = false;     // guards exactly-once init_scene call
};

}  // namespace gseurat
```

### `ScreenFade`

Runtime overlay state. Not registered (never authored, never serialized — saving mid-transition would persist a "fully white screen" state into saves).

```cpp
// include/gseurat/engine/ecs/components/screen_fade.hpp
namespace gseurat {

struct ScreenFade {
    glm::vec3 color{1.0f};  // default white
    float     alpha{0.0f};  // 0 = transparent, 1 = fully covering
};

}  // namespace gseurat
```

### `PortalTarget`

Level-designer-authored in Bricklayer. Registered in `ComponentRegistry`.

```cpp
// include/gseurat/engine/ecs/components/portal_target.hpp
namespace gseurat {

struct PortalTarget {
    std::string target_scene;
    glm::vec3   target_position{0.0f};
    glm::vec3   fade_color{1.0f};          // default white
    float       fade_duration{0.5f};
};

}  // namespace gseurat
```

### Schemas

`schemas/components/portal_target.schema.json`:

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

`schemas/components/scene_transition.schema.json` and `schemas/components/screen_fade.schema.json` are written **for documentation only** — the C++ structs are not registered, and these schemas are not consumed by Bricklayer or the scene loader.

### Registration

In `AppBase::init()`, alongside existing component registrations:

```cpp
component_registry_.register_component<PortalTarget>("PortalTarget",
    [](const json& j) {
        PortalTarget c;
        if (j.contains("target_scene"))    c.target_scene    = j["target_scene"].get<std::string>();
        if (j.contains("target_position")) c.target_position = parse_vec3(j["target_position"]);
        if (j.contains("fade_color"))      c.fade_color      = parse_vec3(j["fade_color"]);
        if (j.contains("fade_duration"))   c.fade_duration   = j["fade_duration"].get<float>();
        return c;
    },
    [](const PortalTarget& c) -> json {
        return {
            {"target_scene", c.target_scene},
            {"target_position", {c.target_position.x, c.target_position.y, c.target_position.z}},
            {"fade_color", {c.fade_color.x, c.fade_color.y, c.fade_color.z}},
            {"fade_duration", c.fade_duration}
        };
    });
```

## TransitionSystem

### Interface

```cpp
// include/gseurat/engine/systems/transition_system.hpp
namespace gseurat {

/// Abstract host for the transition system. AppBase implements this;
/// tests provide a fake to avoid Vulkan dependencies.
struct ITransitionHost {
    /// Clear all scene state (ECS world, bone registry, etc.) before loading
    /// a new scene. Called by transition_system on FadeOut→Loading,
    /// immediately before init_scene().
    virtual void clear_scene() = 0;
    virtual void init_scene(const std::string& path) = 0;
    virtual void set_player_position(const glm::vec3& pos) = 0;
    virtual ~ITransitionHost() = default;
};

/// Advances any SceneTransition entities in the world by dt.
/// Drives paired ScreenFade alpha, calls host.init_scene on FadeOut→Loading,
/// destroys the entity when FadeIn completes.
void transition_system(ecs::World& world, ITransitionHost& host, float dt);

}  // namespace gseurat
```

### Implementation

```cpp
// src/engine/systems/transition_system.cpp
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
                        // First Loading tick: swap synchronously under fully-opaque overlay.
                        // Clear first so destination scene's entities don't pile on top of
                        // the source scene's (especially the PlayerTag entity).
                        host.clear_scene();
                        host.init_scene(st.target_scene);
                        host.set_player_position(st.target_position);
                        st.load_dispatched = true;
                        // Stay in Loading one more tick so renderer presents the new scene
                        // at least once before FadeIn starts.
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
```

**Design choices:**

- **`load_dispatched`** guards the exactly-once scene-swap call. The one-frame settle ensures the renderer submits at least one frame of the new scene before `FadeIn` begins.
- **Deferred destroy** collects entity IDs and destroys after `view.each()` returns to avoid iterator invalidation.
- **Linear interpolation** for alpha (no easing). Easing can be added later by replacing `t` with `ease(t)`.
- **`ITransitionHost`** isolates the system from `AppBase` for testability — `AppBase` inherits this interface.
- **`fade_duration <= 0` guard.** A `progress()` helper short-circuits to `1.0f` when `fade_duration` is non-positive, preventing NaN propagation from `timer / 0` through `std::clamp`. Effectively makes a zero-duration portal an instant cut. Covered by Test 11.
- **Source-portal trigger consume.** After spawning the transient entity, `portal_trigger_handler` resets the source `ProximityTrigger` (`triggered = false; was_triggered = true`). Combined with `host.clear_scene()` removing the portal entity entirely on the Loading tick, this is belt-and-suspenders: even if a host's `clear_scene` somehow doesn't drop the portal, the trigger won't re-fire because the transient `ScreenFade` blocks the handler's concurrency invariant during the transition, and the consumed flag prevents re-fire after FadeIn destroys the transient. Covered by Test 12.
- **`host.clear_scene()` called before `host.init_scene()`** in the Loading dispatch. Without it, the destination scene's entities pile on top of the source's — including a duplicated `PlayerTag` that breaks `proximity_trigger_system`. Covered by Test 13.

## Portal Trigger Hookup

### Handler

```cpp
// include/gseurat/engine/systems/portal_trigger_handler.hpp
namespace gseurat {

/// Consumes ProximityTrigger.triggered on entities that also have PortalTarget
/// and spawns a transient SceneTransition entity. Runs AFTER proximity_trigger_system
/// and BEFORE transition_system in the same frame.
void portal_trigger_handler(ecs::World& world);

}  // namespace gseurat
```

### Implementation

```cpp
// src/engine/systems/portal_trigger_handler.cpp
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
            if (portal.target_scene.empty()) return;   // misconfigured, silently skip
            to_spawn = portal;
        });

    if (!to_spawn.has_value()) return;

    auto e = world.create();
    world.add<SceneTransition>(e, SceneTransition{
        .current_state   = SceneTransition::State::FadeOut,
        .timer           = 0.0f,
        .fade_duration   = to_spawn->fade_duration,
        .target_scene    = to_spawn->target_scene,
        .target_position = to_spawn->target_position,
        .load_dispatched = false,
    });
    world.add<ScreenFade>(e, ScreenFade{
        .color = to_spawn->fade_color,
        .alpha = 0.0f,
    });
}
```

### System registration order

In `AppBase::init()`:

```cpp
system_scheduler_.add_system({"proximity_trigger",
    [](ecs::World& w, float dt) { proximity_trigger_system(w, dt); }, {}, {}});
system_scheduler_.add_system({"portal_trigger_handler",
    [](ecs::World& w, float) { portal_trigger_handler(w); }, {}, {}});
system_scheduler_.add_system({"transition_system",
    [this](ecs::World& w, float dt) { transition_system(w, *this, dt); }, {}, {}});
```

Ordering guarantees within one frame: proximity detects → handler spawns → transition system advances by full `dt`. Whether the just-spawned entity is iterated on the same frame as its spawn (ECS archetype migration is immediate) or on frame N+1 (depending on view-iteration semantics), the first frame of FadeOut has alpha ≈ 0 — imperceptible to the player and correct semantically.

### Level designer workflow

A functioning portal in `examples/island_demo/assets/scenes/some_scene.json`:

```json
{
  "id": "portal_to_dungeon",
  "position": [25, 0, 14],
  "scale": 1.0,
  "components": {
    "ProximityTrigger": { "radius": 2.5, "one_shot": true },
    "PortalTarget": {
      "target_scene": "assets/scenes/dungeon.json",
      "target_position": [5, 0, 3],
      "fade_color": [1.0, 1.0, 1.0],
      "fade_duration": 0.4
    }
  }
}
```

### Edge cases

- **Empty `target_scene`** — silently skipped; defensive against half-configured portals.
- **Multiple portals firing same frame** — first found wins; the concurrency invariant blocks subsequent spawns.
- **`one_shot=false` portal re-firing during FadeIn** — `init_scene` has already rebuilt the ECS world by the time FadeIn starts, so the original trigger entity no longer exists. Safe.
- **Target position inside another portal's radius** — that portal fires on its first frame. Level-design bug, not engine bug; not defended against.
- **Cancellation / queueing** — not supported. Transitions run to completion; subsequent triggers dropped.

## Renderer Hookup

### `PostProcessParams` extension

```cpp
// include/gseurat/engine/post_process.hpp (add to existing struct)
struct PostProcessParams {
    // ... existing fields ...

    glm::vec3 overlay_color{1.0f};  // ScreenFade.color
    float     overlay_alpha{0.0f};  // ScreenFade.alpha (0 = no overlay)
};
```

The two fields pack into one `vec4 overlay` slot on the GPU side. Exact std140/std430 placement verified during implementation against the current `PostProcessUbo` layout.

### Composite shader change

```glsl
// shaders/gs_post_process.comp (near end, after fade/flash/vignette/tone-mapping, before writing output)

// Full-screen overlay — applied in LDR, after tone mapping, so alpha=1.0
// produces a pure solid color uncontaminated by bloom/vignette/tonemap.
color.rgb = mix(color.rgb, ubo.overlay.rgb, ubo.overlay.a);
```

### Producer in `AppBase::update()`

```cpp
PostProcessParams pp;
pp.fade_amount = /* existing */;
// ... other existing fields ...

// Consume ScreenFade if one exists. The concurrency invariant guarantees at most one.
world_.view<ScreenFade>().each(
    [&](ecs::Entity, ScreenFade& fade) {
        pp.overlay_color = fade.color;
        pp.overlay_alpha = fade.alpha;
    });

renderer_.set_post_process(pp);
```

### Why post-process, not sprite overlay

- **Correctness**: sprite batch renders before composite, so a sprite fade would be bloomed, vignetted, and tone-mapped — at `alpha=1.0` a white sprite would come out corner-darkened.
- **Performance**: one GPU ALU instruction added to an already-running compute shader. No new draw call, no new descriptor set.
- **Simplicity**: no z-ordering, no camera-space quad, no billboard math.

## Testing

### Interface extraction for testability

`AppBase` inherits `ITransitionHost`:

```cpp
class AppBase : public ITransitionHost /* ... */ {
    void init_scene(const std::string& path) override { /* existing body */ }
    void set_player_position(const glm::vec3& pos) override { /* existing body */ }
};
```

Tests use a stub:

```cpp
struct FakeHost : gseurat::ITransitionHost {
    std::vector<std::string> init_scene_calls;
    std::vector<glm::vec3>   set_player_position_calls;
    void init_scene(const std::string& p) override { init_scene_calls.push_back(p); }
    void set_player_position(const glm::vec3& p) override { set_player_position_calls.push_back(p); }
};
```

### Test cases

`tests/test_transition_system.cpp` — standalone test executable, no Vulkan:

1. **FadeOut ramp** — alpha climbs from 0 to 1 linearly over `fade_duration`
2. **FadeOut → Loading transition** — when alpha reaches 1.0, state advances, timer resets, alpha pinned at 1.0
3. **Loading exactly-once** — first Loading tick calls `host.init_scene()` + `host.set_player_position()`; subsequent Loading ticks do not re-call
4. **Loading one-frame settle** — second Loading tick advances to FadeIn without re-calling host methods
5. **FadeIn ramp** — alpha descends from 1 to 0 linearly over `fade_duration`
6. **FadeIn destroys entity** — on completion, `world.entity_count()` decreases by 1
7. **Portal handler spawns on trigger** — proximity fires + PortalTarget → new entity with both `SceneTransition` and `ScreenFade`
8. **Portal handler skips empty target** — `PortalTarget.target_scene == ""` → no spawn
9. **Portal handler respects concurrency invariant** — existing `ScreenFade` → no spawn even if new trigger fires
10. **End-to-end full cycle** — spawn → advance through all three states → entity destroyed; `FakeHost` recorded exactly one `init_scene` call with correct path

### Not automatically tested

- GPU rendering of the overlay (`mix()` in the shader) — manual screenshot verification via Game Director after implementation
- Actual PLY load inside `init_scene` — covered by existing `test_gaussian_cloud`

## Files Touched

**New files (11):**
```
include/gseurat/engine/ecs/components/scene_transition.hpp
include/gseurat/engine/ecs/components/screen_fade.hpp
include/gseurat/engine/ecs/components/portal_target.hpp
include/gseurat/engine/systems/transition_system.hpp
include/gseurat/engine/systems/portal_trigger_handler.hpp
src/engine/systems/transition_system.cpp
src/engine/systems/portal_trigger_handler.cpp
schemas/components/scene_transition.schema.json   (documentation-only)
schemas/components/screen_fade.schema.json         (documentation-only)
schemas/components/portal_target.schema.json
tests/test_transition_system.cpp
```

**Modified files (5):**
```
include/gseurat/engine/post_process.hpp            (+2 fields on PostProcessParams)
shaders/gs_post_process.comp                        (+1 mix() line + vec4 overlay in UBO)
include/gseurat/engine/app_base.hpp                 (inherit ITransitionHost)
src/engine/app_base.cpp                             (register PortalTarget; add 2 systems;
                                                     ScreenFade → PostProcessParams per frame;
                                                     ITransitionHost method overrides)
CMakeLists.txt                                      (add test_transition_system target)
```

**Scope estimate:** ~700–900 lines total.

## Out of Scope

- **Async scene loading** — `Loading` state uses synchronous `init_scene`. Future upgrade to true async is an internal change with no public API impact (component schemas unchanged).
- **Transition cancellation / pause** — transitions run to completion once started.
- **Non-portal triggers** — `portal_trigger_handler` only consumes `ProximityTrigger + PortalTarget` pairs. Interact-key triggers, cutscene entries, and save-point respawns are future features that would follow the same pattern (new companion component + new handler, same transient-entity machinery).
- **In-scene teleport** — the transition always calls `init_scene`. A pure teleport (move player, no scene swap) is a separate, simpler feature.
- **Easing / curves** — linear interpolation only. Easing functions are a cheap additive enhancement.
- **Per-transition audio hooks** — no audio integration in this feature. Sound designers can respond to `ScreenFade` presence from their own system.
