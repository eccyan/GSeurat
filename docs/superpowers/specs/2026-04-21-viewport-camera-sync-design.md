# Viewport-Linked Camera Sync (Bricklayer <-> Staging)

## Problem

Level designers author camera zones in Bricklayer's Three.js viewport but can only see the final result by exporting to JSON, loading in Staging, and walking through the scene. There is no real-time feedback loop — orbiting the camera in Bricklayer does not update Staging, and vice versa.

This forces a slow export-reload-check cycle that breaks creative flow, especially when fine-tuning camera zone framing and transitions.

## Solution

Bidirectional camera state sync over the existing WebSocket bridge (port 9100), gated by a "Staging Camera Lock" toggle in Bricklayer. When locked, orbiting in either tool moves the camera in the other.

## Protocol

### New Bridge Commands

**Bricklayer -> Engine (push camera state):**
```json
{
  "cmd": "sync_camera",
  "source": "bricklayer",
  "position": [x, y, z],
  "target": [x, y, z],
  "fov": 45.0
}
```

**Engine -> Bricklayer (camera state event, via broadcast):**
```json
{
  "type": "camera_sync",
  "source": "engine",
  "position": [x, y, z],
  "target": [x, y, z],
  "fov": 45.0
}
```

**Subscribe to camera events (uses existing subscribe infrastructure):**
```json
{"cmd": "subscribe", "events": ["camera_sync"]}
```

### Echo Suppression

Each update carries a `source` field (`"bricklayer"` or `"engine"`). Recipients ignore updates whose source matches their own identity. This prevents the infinite echo loop:

```
Bricklayer sends camera -> Engine receives -> Engine broadcasts -> Bricklayer receives
  (Bricklayer ignores because source == "bricklayer")
```

## Data Flow

```
┌─────────────────────┐                          ┌─────────────────────┐
│   Bricklayer        │                          │   Engine / Staging  │
│                     │                          │                     │
│ OrbitControls       │  sync_camera (throttle)  │ Camera              │
│   onChange ─────────┼─────────────────────────→│   set pos/target    │
│                     │                          │   camera_override_  │
│ update controls  ←──┼──────────────────────────┤ per-frame broadcast │
│   (if source !=     │   camera_sync event      │   (if subscribed)   │
│    "bricklayer")    │                          │                     │
└─────────────────────┘                          └─────────────────────┘
```

### Throttling

- **Bricklayer -> Engine**: Throttle to 60 Hz max (16ms). OrbitControls fires onChange on every pixel of mouse movement; sending every update would flood the bridge.
- **Engine -> Bricklayer**: Throttle to 30 Hz (33ms). Lower rate is acceptable since Staging camera movement is smoother than mouse-driven orbit.

## Bricklayer UI

### Toggle Button

- Location: Viewport toolbar (top-right, next to existing gizmo mode buttons)
- Icon: Lock icon (locked = syncing, unlocked = independent)
- Label: "Staging Camera Lock"
- Visual feedback: Orange border on viewport when locked (matches existing selection highlight color)

### Store

```typescript
// In useSceneStore
stagingCameraLock: boolean;
toggleStagingCameraLock: () => void;
```

### Behavior

When `stagingCameraLock` is toggled ON:
1. Send `subscribe` command for `camera_sync` events
2. Attach throttled listener to `OrbitControls.onChange`
3. Set `isRemoteUpdate` flag during incoming camera application (suppress onChange echo)

When toggled OFF:
1. Send `unsubscribe` for `camera_sync`
2. Remove onChange listener
3. Camera returns to independent operation

## C++ Engine Side

### New Command: `sync_camera`

Registered in `CommandDispatcher`:

```cpp
register_command("sync_camera", [this](const json& cmd) -> CommandResult {
    auto pos = cmd.value("position", std::vector<float>{0,0,0});
    auto tgt = cmd.value("target", std::vector<float>{0,0,0});
    float fov = cmd.value("fov", 45.0f);

    camera_.set_position(glm::vec3(pos[0], pos[1], pos[2]));
    camera_.set_target(glm::vec3(tgt[0], tgt[1], tgt[2]));
    camera_.set_fov(fov);
    camera_override_ = true;  // Skip CameraZoneSystem this frame

    return {true, json{{"status", "ok"}}};
});
```

### Camera Override Flag

- `camera_override_` (bool) in `AppBase` or `StagingState`
- When true: `CameraZoneSystem::update()` is skipped for that frame
- Reset to false at end of frame
- Allows engine's zone system to resume when no sync commands arrive

### Per-Frame Broadcast

In `AppBase::update()` or `StagingState::update()`:

```cpp
if (control_server_.has_subscribers("camera_sync")) {
    auto pos = camera_.position();
    auto tgt = camera_.target();
    control_server_.broadcast(json{
        {"type", "camera_sync"},
        {"source", "engine"},
        {"position", {pos.x, pos.y, pos.z}},
        {"target", {tgt.x, tgt.y, tgt.z}},
        {"fov", camera_.fov()}
    });
}
```

Throttled to 30 Hz via a frame counter or timestamp check.

## Future-Proofing (Option B+: Capture Walkthrough)

The `camera_sync` event stream already carries timestamped camera state from engine to client. A future "capture walkthrough" feature requires only:

1. A "Record" button in Bricklayer that starts accumulating `camera_sync` events with timestamps
2. A "Stop" button that converts the recorded stream to camera rail control points (Catmull-Rom fitting)
3. Import the rail into `cameraRails[]` in the scene store

No protocol changes are needed. The architecture supports this naturally.

## Testing

1. **Unit test (C++)**: Send `sync_camera` command via control server -> verify Camera position/target updated
2. **Unit test (C++)**: Verify `camera_override_` suppresses CameraZoneSystem for one frame
3. **Integration test**: Connect two bridge clients, send sync_camera from one, verify camera_sync broadcast received by the other
4. **UI test**: Toggle Staging Camera Lock in Bricklayer, orbit viewport, verify Staging camera follows (Game Director screenshot comparison)
5. **Echo test**: Verify no camera jitter when both sides are connected (source field filtering works)

## Files Changed

| File | Change |
|------|--------|
| `tools/packages/engine-client/src/types.ts` | Add `SyncCameraCommand`, `CameraSyncEvent` types |
| `tools/packages/engine-client/src/bridge.ts` | Add camera sync helpers |
| `tools/apps/bricklayer/src/store/types.ts` | Add `stagingCameraLock` field |
| `tools/apps/bricklayer/src/store/useSceneStore.ts` | Add toggle action, camera sync logic |
| `tools/apps/bricklayer/src/viewport/Viewport.tsx` | Add StagingCameraLock button, onChange hook |
| `tools/apps/bricklayer/src/viewport/StagingCameraLockButton.tsx` | New — toggle button component |
| `src/engine/command_dispatcher.cpp` | Register `sync_camera` command |
| `src/engine/app_base.cpp` | Add per-frame camera broadcast (throttled) |
| `src/staging/staging_state.cpp` | Add `camera_override_` flag, integrate with zone system |
| `include/gseurat/engine/control_server.hpp` | Add `has_subscribers()` helper |
