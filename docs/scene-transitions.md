# Scene Transitions — ECS-Based State Machine

GSeurat's scene transitions are implemented as a **transient entity state machine** on the existing ECS. The gameplay trigger (portal), the state machine (fade out → load → fade in), and the visual presentation (post-process overlay shader) are fully decoupled — adding a new trigger source or a new visual effect does not require touching the others.

When no transition is running, no transition state exists anywhere. There is no global "fade manager" — the world is either mid-transition (a transient entity with `SceneTransition + ScreenFade` exists) or it is not.

## Architecture

```
┌─────────────────────────────────┐
│  Authoring (Bricklayer)         │
│                                 │
│  Game Object with components:   │
│    ProximityTrigger { radius }  │
│    PortalTarget {               │
│      target_scene               │
│      target_position            │
│      transition_color           │
│      transition_duration        │
│      effect_type                │
│    }                            │
└────────────┬────────────────────┘
             │ scene load → world.create() + attach components
             ▼
┌─────────────────────────────────┐
│  proximity_trigger_system       │  detects player-in-radius
│                                 │  sets ProximityTrigger.triggered = true
└────────────┬────────────────────┘
             ▼
┌─────────────────────────────────┐
│  portal_trigger_handler         │  concurrency check: existing ScreenFade? → skip
│                                 │  find triggered PortalTarget, validate target_scene
│                                 │  spawn transient entity carrying:
│                                 │    SceneTransition (state = SceneOut)
│                                 │    ScreenFade     (alpha = 0, effect_type)
└────────────┬────────────────────┘
             ▼
┌─────────────────────────────────┐
│  transition_system              │  SceneOut : alpha 0 → 1 over transition_duration
│                                 │  Loading  : tick 1 → host.transition_scene()
│                                 │             tick 2 → advance to SceneIn (one-frame settle)
│                                 │  SceneIn  : alpha 1 → 0 over transition_duration
│                                 │  on SceneIn completion → world.destroy(entity)
└────────────┬────────────────────┘
             ▼
┌─────────────────────────────────┐
│  AppBase::update                │  view<ScreenFade> → PostProcessParams.overlay_*
│                                 │  no ScreenFade → overlay_alpha stays 0 (no-op)
└────────────┬────────────────────┘
             ▼
┌─────────────────────────────────┐
│  gs_post_process.comp           │  branches on overlay_effect_type:
│                                 │    0 → solid fade
│                                 │    1 → left-to-right wipe
│                                 │    2 → iris wipe (aspect-corrected circle)
└─────────────────────────────────┘
```

**Concurrency invariant:** at most one transient transition entity exists at any time. `portal_trigger_handler` bails early if any `ScreenFade` exists in the world.

## Components

| Component | Authoring | Lifetime | Purpose |
|---|---|---|---|
| `PortalTarget` | Bricklayer | Scene-bound | Marks an entity as a portal destination. Paired with `ProximityTrigger`. |
| `SceneTransition` | Runtime only | Transient (single transition) | State machine: `SceneOut → Loading → SceneIn`. |
| `ScreenFade` | Runtime only (auto-attached); optional manual use for ambient tints, damage flashes, cutscene fades | Transient or persistent | Full-screen overlay color, alpha, and effect selection consumed by the post-process shader. |

### `PortalTarget`

```cpp
struct PortalTarget {
    std::string target_scene;            // e.g. "assets/scenes/dungeon.json"
    glm::vec3   target_position{0.0f};   // player spawn position in target scene
    glm::vec3   transition_color{1.0f};  // overlay color (white by default)
    float       transition_duration{0.5f}; // seconds for each of SceneOut and SceneIn
    int         effect_type{0};          // 0 = solid, 1 = LR wipe, 2 = iris wipe
};
```

### `SceneTransition`

```cpp
struct SceneTransition {
    enum class State : uint8_t { SceneOut, Loading, SceneIn };

    State       current_state       = State::SceneOut;
    float       timer               = 0.0f;   // seconds into current state
    float       transition_duration = 0.5f;   // each of SceneOut and SceneIn
    std::string target_scene;
    glm::vec3   target_position{0.0f};
    bool        load_dispatched     = false;  // guards exactly-once transition_scene call
};
```

### `ScreenFade`

```cpp
struct ScreenFade {
    glm::vec3 transition_color{1.0f};  // default white
    float     alpha{0.0f};             // 0 = transparent, 1 = fully covering
    int       effect_type{0};          // 0 = solid, 1 = LR wipe, 2 = iris wipe
};
```

`ScreenFade` is registered in `ComponentRegistry` so designers can attach it directly to any Game Object (for ambient tints, cutscene fades, damage flashes). During portal transitions, `portal_trigger_handler` attaches `ScreenFade` automatically to the transient entity — no authoring required.

## Transition State Machine

`transition_system` runs each frame and advances any entity that has both `SceneTransition` and `ScreenFade`.

| State | Trigger | Work | Transition |
|---|---|---|---|
| `SceneOut` | Entity spawned by handler | `alpha = timer / transition_duration` | On `alpha ≥ 1.0` → `Loading` (timer reset, alpha pinned at 1.0) |
| `Loading` | First tick: `load_dispatched == false` | `host.transition_scene(target_scene, target_position)` — atomic clear + load + player-placement under fully-opaque overlay | Second tick → `SceneIn` (one-frame settle ensures renderer presents new scene at least once before fade-in) |
| `SceneIn` | Entered after Loading | `alpha = 1.0 - (timer / transition_duration)` | On `alpha ≤ 0.0` → destroy entity |

### Safety invariants

- **`transition_duration ≤ 0` is valid.** A `progress()` helper short-circuits to `1.0f`, making zero-duration portals an instant cut (no NaN propagation).
- **`load_dispatched` guards exactly-once scene load.** Even if Loading is re-entered due to a bug elsewhere, `host.transition_scene()` is called at most once per transition.
- **Deferred destroy.** Entities to destroy and scene swaps to dispatch are collected during `view.each()` iteration and applied after iteration completes — touching the world from inside a view callback (especially the atomic scene swap) would invalidate archetype pointers.
- **`portal_trigger_handler` concurrency check** — if any `ScreenFade` entity exists, the handler returns immediately, so a second portal firing mid-transition is a no-op.
- **Source portal consume.** After spawning the transient, the handler resets the source `ProximityTrigger` (`triggered = false; was_triggered = true`) as belt-and-suspenders defense against re-fire.

### `ITransitionHost`

The system calls one atomic host method on the `SceneOut → Loading` boundary, plus a non-blocking query each frame in `SceneIn`:

```cpp
struct ITransitionHost {
    virtual void transition_scene(const std::string& target_scene,
                                  const glm::vec3& target_position) = 0;
    // Optional: defaults to false. When true, transition_system pins the
    // SceneIn fade overlay at alpha=1.0 and resets its timer each frame,
    // so the kFadeIn animation only starts once the host reports the new
    // scene is fully ready. Hosts that load synchronously can leave the
    // default; hosts using the async load path (see "Async Scene Loading"
    // below) override to forward their loading state.
    virtual bool is_async_loading() const { return false; }
    virtual ~ITransitionHost() = default;
};
```

`AppBase` implements this interface by clearing the ECS world + bone registry, loading the destination scene, and placing `PlayerTag` at the target position. Its `is_async_loading()` override forwards `is_async_loading_gs_scene()` so the SceneIn fade stays opaque while a worker thread is parsing PLYs. Game apps that need extra recovery (collision grids, camera state, audio regions) override `transition_scene` to wrap the base behavior.

The single-method design for `transition_scene` is deliberate: portal transitions are atomic — you cannot "move the player" to an entity that doesn't exist between clear and load. Tests provide a `FakeHost` implementation to exercise the state machine without Vulkan.

## Async Scene Loading

`AppBase::transition_scene` for the demo's portal path is implemented as a two-phase split that keeps the main thread free of long PLY-parse stalls:

```cpp
// Phase A — synchronous, fast (<100ms): drain GPU, clear world, kick off
// worker. `begin_async_load_gs_scene` is non-blocking.
app.world().clear();
app.clear_scene();
app.begin_async_load_gs_scene(SceneLoader::load(target_scene), opts);

pending_portal_post_load_ = [this, target_scene, target_position](AppBase& a) {
    finish_portal_transition(a, target_scene, target_position);
};

// Phase B — drained from update() once is_async_loading_gs_scene() is false.
// Performs collision-grid restore, player respawn, character re-merge, etc.
```

The supporting API on `AppBase`:

| Method | Phase | Notes |
|---|---|---|
| `begin_async_load_gs_scene(SceneData, opts)` | Phase A | Spawns a `std::async(std::launch::async, …)` worker that runs `GsSceneLoader::parse()` (PLY load + Gaussian merge, no Vulkan / ECS access). |
| `tick_async_load_gs_scene()` | every frame | Called from `main_loop`. Non-blocking poll via `wait_for(0s)`. When the future is ready, runs `GsSceneLoader::finalize_on_main` (Vulkan + ECS) and arms `loading_monitor_` for the streaming-upload phase. |
| `is_async_loading_gs_scene()` | every frame | True between `begin_…` and the frame `tick_…` consumes the future. |
| `load_gs_scene(SceneData, opts)` | sync | Convenience wrapper that calls `parse()` then `finalize_on_main()` on the calling thread. Used by the initial scene load where a loading screen is already up. |

`GsSceneLoader::parse(SceneData) → ParsedScene` is the CPU-only contract. It owns no Vulkan / ECS resources and is safe to invoke from a worker thread. `finalize_on_main(ctx, parsed, opts)` is the main-thread half — it performs `init_gs`, ECS entity creation, bone registry population, light upload, VFX instance setup, etc.

While Phase B is pending, `IslandDemoState::update()` checks `app.is_async_loading_gs_scene()` and drains the deferred lambda once it flips false. The SceneIn `ScreenFade` entity is created in Phase A (not Phase B), so the opaque overlay covers the entire async-parse + GPU-upload window — without that earlier creation, the user would see the per-frame `processed_image_` slots from the OLD scene flash through during the parse.

## Transition Effects

Effects are selected at runtime via `effect_type` on `PortalTarget` / `ScreenFade`, which feeds `overlay_effect_type` in the GS post-process UBO. The post-process compute shader branches on this value to produce the visual.

The state machine is **completely agnostic** to the effect — it drives `alpha` from 0 → 1 during `SceneOut` and from 1 → 0 during `SceneIn`. The shader interprets `alpha` differently per effect.

| `effect_type` | Name | Visual | Shader logic |
|---|---|---|---|
| `0` | Solid fade | Full-screen color fade | `mix(color, overlay.rgb, overlay.a)` |
| `1` | Left-to-right wipe | Hard-edged vertical wipe that sweeps across the screen | `step(uv.x, overlay.a)` gates the overlay column |
| `2` | Iris wipe (circular) | Aspect-corrected shrinking circle that closes to a point | `step(current_radius, dist)` where `current_radius = mix(max_radius, 0.0, overlay.a)` |

### Effect: solid fade (default)

```glsl
color = mix(color, overlay.rgb, overlay.a);
```

The classic full-screen fade. Color is blended uniformly across the framebuffer. Cheap and readable; used by default when `effect_type` is omitted.

### Effect: left-to-right wipe

```glsl
float wipe = step(uv.x, overlay.a);
color = mix(color, overlay.rgb, wipe);
```

Hard pixelated edge — at `alpha = 0.3`, all pixels with `uv.x < 0.3` show the overlay color, the rest show the scene. Produces a clean wipe-in / wipe-out when the alpha sweeps 0 → 1 → 0 across SceneOut → Loading → SceneIn.

### Effect: iris wipe (aspect-corrected)

```glsl
float aspect = dimensions.y / dimensions.z;
vec2 center_uv = uv * 2.0 - 1.0;
center_uv.x *= aspect;

float dist = length(center_uv);
float max_radius = length(vec2(aspect, 1.0));
float current_radius = mix(max_radius, 0.0, overlay.a);

float iris = step(current_radius, dist);
color = mix(color, overlay.rgb, iris);
```

A classic circular reveal/cover. Aspect correction ensures the iris stays perfectly circular regardless of framebuffer shape. `step()` gives a hard pixel-art edge consistent with the engine's aesthetic.

### Adding a new effect

Because the state machine is decoupled from presentation, adding a new transition effect is a **single-file shader change + schema bump**:

1. Add a new `else if (overlay_effect_type == Nu)` branch to `shaders/gs_post_process.comp`.
2. Bump the `max` on the `effect_type` field in `portal_target.schema.json`, `screen_fade.schema.json`, and the Bricklayer `BUILTIN_SCHEMAS` entries.
3. Use it by setting `effect_type: N` on a `PortalTarget` in a scene JSON.

No engine C++, no state machine, no post-process pipeline changes.

## Renderer Hookup

`PostProcessParams` (in `include/gseurat/engine/post_process.hpp`) exposes four fields that are forwarded into the GS post-process UBO (`GsPostProcessUbo`):

```cpp
float     overlay_r = 1.0f;
float     overlay_g = 1.0f;
float     overlay_b = 1.0f;
float     overlay_alpha = 0.0f;
uint32_t  overlay_effect_type = 0;
```

The UBO packs these into `vec4 overlay` + `uint overlay_effect_type` with three padding `uint`s for std140 alignment (144-byte UBO total). `AppBase::update()` reads `ScreenFade` each frame and writes the fields into `PostProcessParams`:

```cpp
auto& pp = renderer_.post_process_params();
pp.overlay_r = 1.0f;
pp.overlay_g = 1.0f;
pp.overlay_b = 1.0f;
pp.overlay_alpha = 0.0f;
pp.overlay_effect_type = 0;
world_.view<ScreenFade>().each(
    [&](ecs::Entity, ScreenFade& fade) {
        pp.overlay_r = fade.transition_color.r;
        pp.overlay_g = fade.transition_color.g;
        pp.overlay_b = fade.transition_color.b;
        pp.overlay_alpha = fade.alpha;
        pp.overlay_effect_type = static_cast<uint32_t>(fade.effect_type);
    });
```

### Why in the post-process compute, not a sprite

- **Correctness.** Sprites render before composite, so an overlay sprite would be bloomed, vignetted, and tone-mapped — at `alpha = 1.0` a white sprite would come out corner-darkened by the vignette. Applying the overlay last, in LDR, guarantees a pure solid color.
- **Performance.** Adds a handful of ALU instructions to an already-running compute shader. No new draw call, no new descriptor set.
- **Simplicity.** No z-ordering, no camera-space quad, no billboard math.

## Authoring a Portal

A functioning portal in `examples/island_demo/assets/scenes/seurat_island.json`:

```json
{
  "id": "portal_dungeon",
  "name": "Dungeon Portal",
  "position": [25, 0, 14],
  "scale": 1.0,
  "components": {
    "ProximityTrigger": { "radius": 2.5, "one_shot": true },
    "PortalTarget": {
      "target_scene": "assets/scenes/dungeon.json",
      "target_position": [5, 0, 3],
      "transition_color": [1.0, 1.0, 1.0],
      "transition_duration": 0.4,
      "effect_type": 2
    }
  }
}
```

Bricklayer auto-generates the property editor from `portal_target.schema.json`; the level designer sees labelled fields for `target_scene`, `target_position`, `transition_color`, `transition_duration`, and `effect_type`. The `effect_type` input clamps to `[0, 2]`.

### Edge cases

| Condition | Behavior |
|---|---|
| `target_scene == ""` | Silently skipped (defensive against half-configured portals). |
| Multiple portals triggered in the same frame | First one found wins; the concurrency invariant blocks subsequent spawns. |
| `one_shot == false` portal re-firing during SceneIn | Safe — `transition_scene` rebuilt the ECS world, so the original trigger entity no longer exists. |
| `target_position` inside another portal's radius | That portal fires on its first frame. Level-design bug, not engine bug. |
| Cancellation / queueing | Not supported. Transitions run to completion; subsequent triggers dropped. |

## Testing

`tests/test_transition_system.cpp` is a standalone test executable (no Vulkan) that covers:

1. SceneOut alpha ramp (0 → 1 linear over `transition_duration`).
2. SceneOut → Loading transition on `alpha ≥ 1.0`; timer reset, alpha pinned.
3. Loading exactly-once: first tick calls `host.transition_scene()`; subsequent Loading ticks do not re-call.
4. Loading one-frame settle: second Loading tick advances to SceneIn without re-calling host methods.
5. SceneIn alpha ramp (1 → 0 linear).
6. SceneIn completion destroys the transient entity.
7. Portal handler spawns on trigger (proximity + `PortalTarget` → transient with both components).
8. Portal handler skips empty `target_scene`.
9. Portal handler respects the concurrency invariant.
10. End-to-end full cycle with `FakeHost` recording exactly one `transition_scene` call with correct path.
11. `transition_duration ≤ 0` safety (no NaN propagation).
12. Source-portal trigger consume after spawn.
13. `host.transition_scene` is called atomically (no half-cleared state observable mid-transition).
14. `effect_type` propagates from `PortalTarget` through `portal_trigger_handler` to `ScreenFade`.
15. `effect_type = 2` (iris wipe) specifically propagates end-to-end.

`tests/test_gs_post_process.cpp` verifies the UBO layout (144 bytes, `overlay_effect_type` at offset 128).

GPU rendering of the overlay is manually verified via Game Director screenshots after changes.

## Extending the System

The transient-entity pattern is intended to be reusable for other trigger sources. The template is always:

1. Add a companion component to describe trigger-specific data (`PortalTarget`, `RespawnTarget`, `CutsceneEntry`, …).
2. Add a handler that looks for that component alongside an existing trigger (`ProximityTrigger`, `InteractTrigger`, …) and spawns the transient `SceneTransition + ScreenFade` entity.
3. Register the handler in `AppBase::init()` **before** `transition_system`.

The state machine itself does not need to change.

### Known out-of-scope items

- **Transition cancellation / pause.** Transitions run to completion once started.
- **Non-portal triggers.** `portal_trigger_handler` only handles `ProximityTrigger + PortalTarget` pairs; interact-key triggers, cutscene entries, and save-point respawns are future features that follow the same pattern (new companion component + new handler, same transient-entity machinery).
- **Per-transition audio hooks.** Sound designers can respond to `ScreenFade` presence from their own system.
- **Easing / curves.** Linear interpolation only. Easing functions would be a cheap additive enhancement — replace `t` with `ease(t)` in `transition_system`.

## File Map

| Area | Files |
|---|---|
| Components | `include/gseurat/engine/ecs/components/{scene_transition,screen_fade,portal_target}.hpp` |
| Systems | `include/gseurat/engine/systems/{transition_system,portal_trigger_handler}.hpp`<br>`src/engine/systems/{transition_system,portal_trigger_handler}.cpp` |
| Async load | `include/gseurat/engine/app_base.hpp` (`begin_async_load_gs_scene`, `tick_async_load_gs_scene`, `is_async_loading_gs_scene`)<br>`include/gseurat/engine/gs_scene_loader.hpp` (`parse`, `finalize_on_main`, `ParsedScene`)<br>`src/demo/island_demo_state.cpp` (`perform_portal_transition` Phase A, `finish_portal_transition` Phase B) |
| Registration & host | `src/engine/app_base.cpp` (`register_component<PortalTarget>`, `register_component<ScreenFade>`, `transition_scene` override, `is_async_loading` override, system registration order) |
| Renderer | `include/gseurat/engine/post_process.hpp`, `include/gseurat/engine/gs_renderer.hpp`, `src/engine/gs_renderer.cpp`, `src/engine/renderer.cpp` |
| Shader | `shaders/gs_post_process.comp` (UBO `overlay` + `overlay_effect_type`, effect branches) |
| Schemas | `examples/island_demo/assets/components/{portal_target,screen_fade,scene_transition}.schema.json` |
| Bricklayer | `tools/apps/bricklayer/src/store/useSceneStore.ts` (`BUILTIN_SCHEMAS`) |
| Demo scenes | `examples/island_demo/assets/scenes/{seurat_island,dungeon}.json` (portal Game Objects) |
| Tests | `tests/test_transition_system.cpp`, `tests/test_gs_post_process.cpp` |

## Design References

- [Scene transition ECS design spec](superpowers/specs/2026-04-16-scene-transition-ecs-design.md)
- [Scene transition ECS implementation plan](superpowers/plans/2026-04-16-scene-transition-ecs.md)
- [Portal Bricklayer cleanup spec](superpowers/specs/2026-04-16-portal-bricklayer-cleanup-design.md)
