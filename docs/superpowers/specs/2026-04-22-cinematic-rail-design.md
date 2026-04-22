# Cinematic Rail Camera Mode — Design Spec

## Goal

Implement the `cinematic_rail` camera mode in `CameraZoneSystem` to support time-driven, event-driven, and gameplay-driven camera movement along spline paths, independent of the player's world position. Also support timeline scrubbing from the level editor (Bricklayer).

## Architecture

The cinematic rail mode reuses the existing 4-stage camera pipeline (resolve -> evaluate -> blend -> constrain). All changes are confined to Stage 2 (`evaluate_vcam`) and the state variables that feed it. A new `CinematicPlayback` enum and five new `CameraParams` fields control behavior. Two public methods on `CameraZoneSystem` enable gameplay code to drive the camera manually. A new bridge command enables editor scrubbing.

## 1. CameraParams Extensions

Add to `CameraParams` (in `camera_volume.hpp`):

```cpp
// Cinematic rail parameters (only used when mode == cinematic_rail)
float cinematic_duration{5.0f};          // Seconds from start to end of rail
GsEasing cinematic_easing{GsEasing::InOutQuad};  // Easing applied to t
CinematicPlayback cinematic_playback{CinematicPlayback::once};
bool play_on_enter{true};                // Auto-start on zone enter
TargetMode target_mode{TargetMode::player};  // Look-at target source
```

### New Enums

```cpp
enum class CinematicPlayback : uint8_t {
    once,       // Play once, stop at t=1
    loop,       // Wrap t from 1 back to 0
    ping_pong,  // Reverse direction at endpoints
    manual,     // Timer does NOT auto-advance; driven by API
};

enum class TargetMode : uint8_t {
    player,       // Look at player position (spring-damped)
    target_path,  // Look at target_path.evaluate(t') — uses same eased t
    fixed_point,  // Look at CameraParams::fixed_position
};
```

### Reusing GsEasing

The existing `GsEasing` enum (30+ curves in `gs_animator.hpp`) is reused directly. The `parse_easing` lambda in `scene_loader.cpp` is promoted to a free function in `gs_animator.hpp` so that both GsAnimParams and CameraParams parsing can share it. Schema strings use snake_case names (e.g., `"in_out_quad"`, `"in_elastic"`, `"linear"`).

### Schema Changes

Add to `camera_params` definition in `scene.schema.json`:

```json
"cinematic_duration": { "type": "number", "minimum": 0, "default": 5.0 },
"cinematic_easing": { "type": "string", "default": "in_out_quad" },
"cinematic_playback": { "type": "string", "enum": ["once", "loop", "ping_pong", "manual"], "default": "once" },
"play_on_enter": { "type": "boolean", "default": true },
"target_mode": { "type": "string", "enum": ["player", "target_path", "fixed_point"], "default": "player" }
```

### JSON Parsing

In `scene_loader.cpp`, parse these fields alongside existing CameraParams fields. Unknown easing strings fall back to `GsEasing::Linear`. Unknown playback/target_mode strings fall back to their defaults.

## 2. Cinematic State in CameraZoneSystem

### New State Variables

Add to `CameraZoneSystem` private section (under a new `// -- Cinematic rail state` comment):

```cpp
// ── Cinematic rail state ────────────────────────────────────────
enum class CinematicState : uint8_t { idle, playing, paused, finished };

float cinematic_timer_{0.0f};          // Raw elapsed time (seconds)
CinematicState cinematic_state_{CinematicState::idle};
bool cinematic_reverse_{false};        // Ping-pong direction flag
```

### Zone-Change Reset

When `active_zone_entity_` changes in `update()`, after the existing blend setup code, add:

```cpp
cinematic_timer_ = 0.0f;
cinematic_state_ = CinematicState::idle;
cinematic_reverse_ = false;
```

This ensures entering a new zone always starts from a clean cinematic state. If the new zone's mode is `cinematic_rail` and `play_on_enter` is true, set `cinematic_state_ = CinematicState::playing`.

### Auto-Start Logic

In `update()`, after zone change detection and params lookup, if the mode is `cinematic_rail` and state is `idle` and `play_on_enter` is true:

```cpp
if (active_params->mode == CameraMode::cinematic_rail &&
    cinematic_state_ == CinematicState::idle &&
    active_params->play_on_enter) {
    cinematic_state_ = CinematicState::playing;
}
```

## 3. evaluate_vcam — Cinematic Rail Branch

Replace the current stub with:

### Step 1: Advance timer (time-driven modes only)

```cpp
if (cinematic_state_ == CinematicState::playing &&
    params.cinematic_playback != CinematicPlayback::manual) {
    if (cinematic_reverse_) {
        cinematic_timer_ -= dt;
    } else {
        cinematic_timer_ += dt;
    }
}
```

### Step 2: Compute base t

```cpp
float base_t = (params.cinematic_duration > 0.0f)
    ? cinematic_timer_ / params.cinematic_duration
    : 1.0f;
```

### Step 3: Handle playback mode boundaries

```
once:       clamp base_t to [0, 1]. If base_t >= 1.0, set cinematic_state_ = finished.
loop:       base_t = fmod(base_t, 1.0). If negative, wrap to positive.
ping_pong:  if base_t >= 1.0, flip cinematic_reverse_ = true, clamp timer.
            if base_t <= 0.0, flip cinematic_reverse_ = false, clamp timer.
manual:     clamp base_t to [0, 1]. (No auto-advance; value set externally.)
```

### Step 4: Apply easing

```cpp
float eased_t = apply_easing(std::clamp(base_t, 0.0f, 1.0f), params.cinematic_easing);
```

### Step 5: Evaluate spline position

```cpp
state.position = rails_[ri].path.evaluate(eased_t);
```

### Step 6: Evaluate target based on target_mode

```
player:       state.target = spring_target_ (spring-damped player position, already computed)
target_path:  state.target = rails_[ri].target_path.evaluate(eased_t) (if valid; else fall back to player)
fixed_point:  state.target = params.fixed_position
```

### Step 7: Apply min_ground_clearance

Same as `rail_follow` — ensure `state.position.y >= spring_target_.y + params.min_ground_clearance`.

### Step 8: Completion event stub

When `cinematic_state_` transitions to `finished`:

```cpp
if (on_cinematic_complete_) {
    on_cinematic_complete_(active_zone_entity_);
}
```

## 4. Public API for Manual Control

Add to `CameraZoneSystem` public interface:

```cpp
/// Set cinematic progress to an absolute value [0, 1].
/// Useful for mapping to character walk distance or editor scrubbing.
void set_cinematic_t(float t);

/// Add delta to current cinematic progress. Clamped to [0, 1].
/// Useful for button presses or incremental gameplay inputs.
void advance_cinematic_t(float delta_t);
```

### Implementation

Both methods convert the `t` value to `cinematic_timer_` by multiplying with the active zone's `cinematic_duration`. The active zone's params are looked up from the current `active_zone_entity_`.

```cpp
void CameraZoneSystem::set_cinematic_t(float t) {
    const auto* params = active_params();  // helper to look up active zone params
    cinematic_timer_ = std::clamp(t, 0.0f, 1.0f) * params->cinematic_duration;
    if (cinematic_state_ == CinematicState::idle ||
        cinematic_state_ == CinematicState::finished) {
        cinematic_state_ = CinematicState::playing;
    }
}

void CameraZoneSystem::advance_cinematic_t(float delta_t) {
    const auto* params = active_params();
    cinematic_timer_ += delta_t * params->cinematic_duration;
    cinematic_timer_ = std::clamp(cinematic_timer_, 0.0f, params->cinematic_duration);
    if (cinematic_state_ == CinematicState::idle ||
        cinematic_state_ == CinematicState::finished) {
        cinematic_state_ = CinematicState::playing;
    }
}
```

Both methods auto-transition from `idle`/`finished` to `playing` so the next `update()` evaluates the new position. In `manual` mode, the timer won't auto-advance further — only subsequent API calls move it.

### Helper: active_params()

A small private helper to avoid duplicating the active-zone lookup:

```cpp
const CameraParams* active_params() const;
```

Returns `&default_params_` for world fallback, or the matching volume's params.

## 5. Completion Callback

Add to `CameraZoneSystem`:

```cpp
using CinematicCompleteCallback = std::function<void(int zone_entity_id)>;

void set_on_cinematic_complete(CinematicCompleteCallback cb);
```

Private member:

```cpp
CinematicCompleteCallback on_cinematic_complete_;
```

This is a stub/hook point. Game logic can register a callback to react when a `once` playback reaches `t=1.0`.

## 6. Bridge Command: `set_cinematic_t`

Register in `command_dispatcher.cpp`:

```json
{
  "cmd": "set_cinematic_t",
  "t": 0.5,
  "delta_t": null
}
```

Behavior:
- If `t` is present: calls `camera_zone_system.set_cinematic_t(t)`.
- If `delta_t` is present (and `t` is not): calls `camera_zone_system.advance_cinematic_t(delta_t)`.
- Returns `{"type": "ok"}`.

This serves both editor scrubbing (absolute `t`) and gameplay event forwarding (relative `delta_t`).

## 7. Level Editor Integration (Bricklayer)

### useEngine Hook

Add a `setCinematicT` helper to `useEngine.ts`:

```typescript
const setCinematicT = useCallback(
  (t: number): Promise<OkResponse | null> =>
    sendCommand<OkResponse>({ cmd: 'set_cinematic_t', t }),
  [sendCommand],
);
```

### Timeline Scrubbing

When the user drags a timeline slider in Bricklayer's camera zone editor, it calls `engine.setCinematicT(sliderValue)`. The engine instantly reflects the camera position for that frame. This reuses the existing `camera_sync_override` pathway — the bridge command sets the cinematic timer, and the next `update()` evaluates the spline at the new `t`.

No new React components are required in this phase. The timeline scrub UI is a future Bricklayer feature that will consume this API.

## Constraints

- No changes to `free_look`, `rail_follow`, `fixed_point`, or `side_scroll` behavior.
- No ECS components. Camera remains procedural (Systems + States).
- Reuses existing `glm` math, `apply_easing`, and `SplinePath::evaluate`.
- All new CameraParams fields have defaults that preserve backward compatibility.
- Existing scene JSON files without the new fields continue to work unchanged.
- The `parse_easing` function is promoted from a local lambda to a shared free function, but its behavior is identical.

## Testing Strategy

1. **Schema validation**: Verify new fields parse correctly with defaults.
2. **Unit tests**: Time-based `t` progression for `once`, `loop`, `ping_pong` modes.
3. **Manual mode test**: Verify timer does not advance with `dt`; only `set_cinematic_t` / `advance_cinematic_t` move it.
4. **Easing test**: Verify `apply_easing` is applied to base `t` before spline evaluation.
5. **Zone-change reset test**: Verify `cinematic_timer_`, `cinematic_state_`, `cinematic_reverse_` all reset on zone transition.
6. **Integration test**: Bridge command `set_cinematic_t` sets position via Game Director socket.
7. **Build verification**: `cmake --build --preset macos-debug` succeeds with no new warnings.
