# Viewport-Linked Camera Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bidirectional camera state sync between Bricklayer (Three.js) and Staging (C++ engine) via a "Staging Camera Lock" toggle, so orbiting in one moves the other.

**Architecture:** Bricklayer sends `sync_camera` commands over the WebSocket bridge when OrbitControls changes. The C++ engine registers a `sync_camera` command handler that overrides the Camera directly (bypassing CameraZoneSystem). The engine broadcasts `camera_sync` events to subscribed clients. Echo suppression via `source` field prevents infinite loops.

**Tech Stack:** TypeScript (React/Three.js/Zustand), C++23, WebSocket bridge

---

### Task 1: Add `sync_camera` command handler to C++ engine

**Files:**
- Modify: `src/engine/command_dispatcher.cpp:49` (register in `register_default_commands`)
- Modify: `include/gseurat/engine/command_dispatcher.hpp` (add `camera_override_` flag)

- [ ] **Step 1: Read the current `register_default_commands` to find insertion point**

Read `src/engine/command_dispatcher.cpp` lines 49-80. New command registration goes alongside existing commands.

- [ ] **Step 2: Read `CommandDispatcher` header for context struct**

Read `include/gseurat/engine/command_dispatcher.hpp` to understand `CommandContext` and how the renderer/camera is accessed.

- [ ] **Step 3: Add `camera_sync_override` flag and `control_server` pointer to `CommandContext`**

In `include/gseurat/engine/command_context.hpp`, add two fields to the `CommandContext` struct (after the `clear_scene` function, before the closing `};`):

```cpp
    ControlServer* control_server = nullptr;  // For subscribe/broadcast commands
    bool camera_sync_override = false;        // Set by sync_camera, suppresses CameraZoneSystem for one frame
```

Also add forward declaration at the top of the file (after `class DebugDumpRegistry;`):

```cpp
class ControlServer;
```

Wherever `CommandContext` is constructed (search for `CommandContext{` in `app_base.cpp` or `staging_state.cpp`), add `&control_server_` to the initializer.

- [ ] **Step 4: Register `sync_camera` command**

In `src/engine/command_dispatcher.cpp`, inside `register_default_commands()`, add:

```cpp
    register_command("sync_camera", [this](const json& cmd) -> CommandResult {
        auto pos = cmd.value("position", std::vector<float>{0, 0, 0});
        auto tgt = cmd.value("target", std::vector<float>{0, 0, 0});

        if (pos.size() < 3 || tgt.size() < 3) {
            return std::unexpected(std::string("sync_camera requires position and target arrays of length 3"));
        }

        auto& cam = ctx_.renderer->camera();
        cam.set_position(glm::vec3(pos[0], pos[1], pos[2]));
        cam.set_target(glm::vec3(tgt[0], tgt[1], tgt[2]));
        ctx_.camera_sync_override = true;

        return json{{"type", "ok"}};
    });
```

- [ ] **Step 5: Register `subscribe` command (if not already registered)**

In `src/engine/command_dispatcher.cpp`, inside `register_default_commands()`, add:

```cpp
    register_command("subscribe", [this](const json& cmd) -> CommandResult {
        if (!ctx_.control_server) {
            return std::unexpected(std::string("control_server not available"));
        }
        auto events = cmd.value("events", std::vector<std::string>{});
        ctx_.control_server->subscribe_events(events);
        return json{{"type", "ok"}, {"subscribed", events}};
    });

    register_command("unsubscribe", [this](const json& cmd) -> CommandResult {
        if (!ctx_.control_server) {
            return std::unexpected(std::string("control_server not available"));
        }
        ctx_.control_server->unsubscribe_all();
        return json{{"type", "ok"}};
    });
```

Note: Check if `ctx_` has a `control_server` pointer. If not, it needs to be added to `CommandContext`. Read the header to confirm.

- [ ] **Step 6: Build and verify**

Run: `cmake --build --preset macos-debug`
Expected: Build succeeds

- [ ] **Step 7: Commit**

```bash
git add src/engine/command_dispatcher.cpp include/gseurat/engine/command_dispatcher.hpp
git commit -m "feat(bridge): add sync_camera and subscribe commands for camera sync"
```

---

### Task 2: Add per-frame camera broadcast in `AppBase`

**Files:**
- Modify: `src/engine/app_base.cpp:117` (after `poll_control_server()`)
- Modify: `include/gseurat/engine/app_base.hpp` (add throttle timestamp)

- [ ] **Step 1: Add broadcast throttle state to AppBase**

In `include/gseurat/engine/app_base.hpp`, add to private members:

```cpp
float camera_broadcast_timer_ = 0.0f;
static constexpr float kCameraBroadcastInterval = 1.0f / 30.0f;  // 30 Hz
```

- [ ] **Step 2: Add camera broadcast after state update**

In `src/engine/app_base.cpp`, after `state_stack_.update(*this, dt);` (line 148), add:

```cpp
        // Broadcast camera state to subscribed clients (throttled to 30 Hz)
        camera_broadcast_timer_ += dt;
        if (camera_broadcast_timer_ >= kCameraBroadcastInterval &&
            control_server_.has_client() &&
            control_server_.is_event_subscribed("camera_sync")) {
            camera_broadcast_timer_ = 0.0f;
            auto pos = renderer_.camera().position();
            auto tgt = renderer_.camera().target();
            control_server_.broadcast(nlohmann::json{
                {"event", "camera_sync"},
                {"source", "engine"},
                {"position", {pos.x, pos.y, pos.z}},
                {"target", {tgt.x, tgt.y, tgt.z}}
            });
        }

        // Reset camera sync override at frame end
        command_dispatcher_.context().camera_sync_override = false;
```

- [ ] **Step 3: Add `context()` accessor to CommandDispatcher**

In `include/gseurat/engine/command_dispatcher.hpp`, add public accessor:

```cpp
    CommandContext& context() { return ctx_; }
    const CommandContext& context() const { return ctx_; }
```

- [ ] **Step 4: Build and verify**

Run: `cmake --build --preset macos-debug`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/engine/app_base.cpp include/gseurat/engine/app_base.hpp include/gseurat/engine/command_dispatcher.hpp
git commit -m "feat(bridge): broadcast camera_sync events at 30Hz to subscribed clients"
```

---

### Task 3: Wire camera override into CameraZoneSystem skip

**Files:**
- Modify: `src/staging/staging_state.cpp` or `src/demo/island_demo_state.cpp` (wherever CameraZoneSystem::update is called)

- [ ] **Step 1: Find where CameraZoneSystem::update is called**

The camera zone system update is in `src/demo/island_demo_state.cpp:1023-1037` and `src/staging/camera_review_state.cpp:186`. Both need to check the override flag.

- [ ] **Step 2: Add override check before CameraZoneSystem update in island_demo_state**

In `src/demo/island_demo_state.cpp`, around line 1023, wrap the camera zone system update:

```cpp
    if (camera_zone_system_ && !app.command_dispatcher().context().camera_sync_override) {
        CameraZoneSystem::InputState input{};
        // ... existing code ...
        camera_zone_system_->update(dt, player_pos, player_velocity_, input);
        auto state = camera_zone_system_->current_state();
        // ... apply camera state ...
    }
```

- [ ] **Step 3: Add override check in camera_review_state**

In `src/staging/camera_review_state.cpp`, around line 186, add the same guard. The `CameraReviewState` needs access to the override flag — pass it via the `update()` method parameter or check `AppBase`'s dispatcher.

- [ ] **Step 4: Build and verify**

Run: `cmake --build --preset macos-debug`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/demo/island_demo_state.cpp src/staging/camera_review_state.cpp
git commit -m "feat(camera): skip CameraZoneSystem when sync_camera override is active"
```

---

### Task 4: Add TypeScript bridge types

**Files:**
- Modify: `tools/packages/engine-client/src/types.ts:190`

- [ ] **Step 1: Add SyncCameraCommand type**

In `tools/packages/engine-client/src/types.ts`, after `SetCameraCommand` (line 190):

```typescript
export interface SyncCameraCommand {
  cmd: "sync_camera";
  source: "bricklayer";
  position: [number, number, number];
  target: [number, number, number];
}

export interface CameraSyncEvent {
  event: "camera_sync";
  source: "engine" | "bricklayer";
  position: [number, number, number];
  target: [number, number, number];
}
```

- [ ] **Step 2: Add to Command union type**

Find the `Command` union type in `types.ts` and add `SyncCameraCommand`:

```typescript
export type Command = ... | SyncCameraCommand;
```

- [ ] **Step 3: Build packages**

Run: `cd tools && pnpm build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add tools/packages/engine-client/src/types.ts
git commit -m "feat(engine-client): add SyncCameraCommand and CameraSyncEvent types"
```

---

### Task 5: Add `stagingCameraLock` to Bricklayer store

**Files:**
- Modify: `tools/apps/bricklayer/src/store/types.ts:273` (near `cameraShowDebugVolumes`)
- Modify: `tools/apps/bricklayer/src/store/useSceneStore.ts:420,657`

- [ ] **Step 1: Add type to store types**

In `tools/apps/bricklayer/src/store/types.ts`, near `cameraShowDebugVolumes` (line 273):

```typescript
  stagingCameraLock: boolean;
```

- [ ] **Step 2: Add default value and action to store**

In `tools/apps/bricklayer/src/store/useSceneStore.ts`:

Add default near line 420 (next to `cameraShowDebugVolumes: false`):
```typescript
  stagingCameraLock: false,
```

Add setter near line 657 (next to `setCameraShowDebugVolumes`):
```typescript
  setStagingCameraLock: (v) => set({ stagingCameraLock: v }),
```

- [ ] **Step 3: Build**

Run: `cd tools && pnpm build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add tools/apps/bricklayer/src/store/types.ts tools/apps/bricklayer/src/store/useSceneStore.ts
git commit -m "feat(bricklayer): add stagingCameraLock store field"
```

---

### Task 6: Create StagingCameraSync component

**Files:**
- Create: `tools/apps/bricklayer/src/viewport/StagingCameraSync.tsx`

- [ ] **Step 1: Create the component**

Create `tools/apps/bricklayer/src/viewport/StagingCameraSync.tsx`:

```tsx
/**
 * StagingCameraSync — bidirectional camera sync between Bricklayer and Staging.
 *
 * When stagingCameraLock is true:
 * - Sends Bricklayer's OrbitControls camera to Staging via sync_camera command (throttled 60Hz)
 * - Listens for camera_sync events from Staging and applies them to OrbitControls
 * - Uses source field for echo suppression
 */
import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { sendBridgeCommand, getBridgeClient } from '@gseurat/engine-client';
import { useSceneStore } from '../store/useSceneStore.js';
import { getOrbitControls } from './Viewport.js';
import type { CameraSyncEvent } from '@gseurat/engine-client';

const SEND_INTERVAL_MS = 16; // ~60 Hz

export function StagingCameraSync() {
  const locked = useSceneStore((s) => s.stagingCameraLock);
  const { camera } = useThree();
  const lastSendRef = useRef(0);
  const isRemoteUpdateRef = useRef(false);

  // Subscribe to camera_sync events when locked
  useEffect(() => {
    if (!locked) return;

    // Tell engine we want camera_sync events
    sendBridgeCommand({ cmd: 'subscribe', events: ['camera_sync'] });

    const client = getBridgeClient();
    if (!client) return;

    const off = client.on('camera_sync', (data: unknown) => {
      const event = data as CameraSyncEvent;
      if (event.source === 'bricklayer') return; // Echo suppression

      const controls = getOrbitControls();
      if (!controls) return;

      isRemoteUpdateRef.current = true;
      camera.position.set(event.position[0], event.position[1], event.position[2]);
      controls.target.set(event.target[0], event.target[1], event.target[2]);
      controls.update();
      isRemoteUpdateRef.current = false;
    });

    return () => {
      off();
      sendBridgeCommand({ cmd: 'unsubscribe' });
    };
  }, [locked, camera]);

  // Send camera state on each frame when locked
  useEffect(() => {
    if (!locked) return;

    let frameId: number;

    const sendLoop = () => {
      frameId = requestAnimationFrame(sendLoop);

      const now = performance.now();
      if (now - lastSendRef.current < SEND_INTERVAL_MS) return;
      if (isRemoteUpdateRef.current) return; // Don't echo back

      const controls = getOrbitControls();
      if (!controls) return;

      const pos = camera.position;
      const tgt = controls.target;

      lastSendRef.current = now;
      sendBridgeCommand({
        cmd: 'sync_camera',
        source: 'bricklayer',
        position: [pos.x, pos.y, pos.z],
        target: [tgt.x, tgt.y, tgt.z],
      });
    };

    frameId = requestAnimationFrame(sendLoop);
    return () => cancelAnimationFrame(frameId);
  }, [locked, camera]);

  return null; // Render nothing — pure side-effect component
}
```

- [ ] **Step 2: Add to Viewport's SceneContent**

In `tools/apps/bricklayer/src/viewport/Viewport.tsx`, add import:

```typescript
import { StagingCameraSync } from './StagingCameraSync.js';
```

Add `<StagingCameraSync />` inside `SceneContent()`, before `<OrbitControls>` (around line 324):

```tsx
      <StagingCameraSync />
      <OrbitControls
```

- [ ] **Step 3: Build**

Run: `cd tools && pnpm build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add tools/apps/bricklayer/src/viewport/StagingCameraSync.tsx tools/apps/bricklayer/src/viewport/Viewport.tsx
git commit -m "feat(bricklayer): add StagingCameraSync component for bidirectional camera sync"
```

---

### Task 7: Add Staging Camera Lock toggle button to viewport

**Files:**
- Modify: `tools/apps/bricklayer/src/viewport/Viewport.tsx`

- [ ] **Step 1: Add toggle button to the Viewport component**

In `tools/apps/bricklayer/src/viewport/Viewport.tsx`, in the `Viewport()` function (line 348), add a toolbar overlay inside the wrapper div, after the `<Canvas>`:

```tsx
export function Viewport() {
  useComponentRegistry('Viewport');
  const gridWidth = useSceneStore((s) => s.gridWidth);
  const gridDepth = useSceneStore((s) => s.gridDepth);
  const stagingCameraLock = useSceneStore((s) => s.stagingCameraLock);
  const setStagingCameraLock = useSceneStore((s) => s.setStagingCameraLock);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas
        camera={{ position: [gridWidth / 2, 30, gridDepth + 20], fov: 50 }}
        style={{
          background: '#16162a',
          border: stagingCameraLock ? '2px solid #f59e0b' : '2px solid transparent',
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <SceneContent />
      </Canvas>
      <button
        onClick={() => setStagingCameraLock(!stagingCameraLock)}
        title={stagingCameraLock ? 'Unlock Staging camera' : 'Lock to Staging camera'}
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          padding: '4px 8px',
          fontSize: 12,
          background: stagingCameraLock ? '#f59e0b' : '#374151',
          color: stagingCameraLock ? '#000' : '#d1d5db',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
        }}
      >
        {stagingCameraLock ? 'Camera Locked' : 'Camera Lock'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Build**

Run: `cd tools && pnpm build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add tools/apps/bricklayer/src/viewport/Viewport.tsx
git commit -m "feat(bricklayer): add Staging Camera Lock toggle button with visual indicator"
```

---

### Task 8: Add expected-components entry and integration test

**Files:**
- Modify: relevant `expected-components.json` for Bricklayer
- Test via browser automation

- [ ] **Step 1: Add StagingCameraSync to expected components (if applicable)**

Check if `StagingCameraSync` needs to be in `expected-components.json`. Since it renders `null` and doesn't use `useComponentRegistry`, it does NOT need an entry. Skip if not needed.

- [ ] **Step 2: Run component registry health check**

Via Chrome MCP (if available):
```javascript
JSON.stringify(window.__COMPONENT_REGISTRY__.health())
```
Expected: No missing components

- [ ] **Step 3: Run Bricklayer build and verify no console errors**

Run: `cd tools && pnpm build`
Expected: Build succeeds with no TypeScript errors

- [ ] **Step 4: Commit (if any changes)**

```bash
git commit -m "test(bricklayer): verify StagingCameraSync integration"
```
