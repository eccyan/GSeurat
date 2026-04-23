# Collision Editor Integration — Spec 2a: Bridge CRUD, Bricklayer Panel, Wireframes, Migration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable level designers to create, edit, and visualize primitive colliders through Bricklayer's property panel and see accurate 3D wireframes in the engine viewport. Migrate existing CollisionGrid data to the new system.

**Scope:** Bridge commands, Bricklayer UI panel, Vulkan wireframe pipeline, migration script. No 3D gizmo interaction (raycasting, drag handles) — that's Spec 2b.

**Depends on:** Spec 1 (PR #353, merged) — ColliderComponent, KinematicBody, CollisionSystem, BVH, KCC.

---

## 1. Bridge Commands for Collider CRUD

### 1.1 Command Set

| Command | Direction | Purpose |
|---------|-----------|---------|
| `add_collider` | Bricklayer -> Engine | Create entity with Transform + ColliderComponent |
| `update_collider` | Bricklayer -> Engine | Modify shape, position, rotation, flags |
| `remove_collider` | Bricklayer -> Engine | Destroy collider entity |
| `list_colliders` | Bricklayer -> Engine | Get all colliders for initial sync |
| `collider_updated` | Engine -> Bricklayer | Event: engine modified a collider (Spec 2b gizmo prep) |

### 1.2 Addressing

Colliders are addressed by **game object ID** (string), not array index. Game object IDs are stable across add/remove operations and match the `game_objects[].id` field in scene JSON.

### 1.3 Command Payloads

**add_collider:**
```json
{
  "cmd": "add_collider",
  "id": "floor_001",
  "name": "Floor",
  "position": [0, -0.5, 0],
  "rotation": [0, 0, 0, 1],
  "collider": {
    "shape": {"type": "box", "half_extents": [10, 0.5, 10]},
    "is_trigger": false,
    "is_dynamic": false,
    "collision_mask": 4294967295
  }
}
```

- `position`: world-space `[x, y, z]`
- `rotation`: quaternion `[x, y, z, w]` applied as `ColliderComponent::local_rotation`
- `collider`: matches `ColliderComponent` JSON format from Spec 1
- Returns: `{"type": "ok", "id": "floor_001"}`

**update_collider:**
```json
{
  "cmd": "update_collider",
  "id": "floor_001",
  "position": [0, -1, 0],
  "rotation": [0, 0, 0, 1],
  "collider": {"shape": {"type": "box", "half_extents": [12, 0.5, 12]}}
}
```

Partial update — only specified fields change. Missing fields are left unchanged. Marks `CollisionSystem` dirty for BVH rebuild.

**remove_collider:**
```json
{"cmd": "remove_collider", "id": "floor_001"}
```

Returns `{"type": "ok"}`. Marks `CollisionSystem` dirty.

**list_colliders:**
```json
{"cmd": "list_colliders"}
```

Returns:
```json
{
  "type": "ok",
  "colliders": [
    {
      "id": "floor_001",
      "name": "Floor",
      "position": [0, -0.5, 0],
      "rotation": [0, 0, 0, 1],
      "collider": {
        "shape": {"type": "box", "half_extents": [10, 0.5, 10]},
        "is_trigger": false,
        "is_dynamic": false,
        "collision_mask": 4294967295
      }
    }
  ]
}
```

### 1.4 Engine Integration

Commands registered in `command_dispatcher.cpp`. The `CollisionSystem*` pointer is added to `CommandContext` (same pattern as `CameraZoneSystem*`).

**Entity lookup:** A private helper `find_entity_by_game_object_id(world, id)` scans entities with a `GameObjectId` component (or uses the existing `SceneObjectState::game_object_ids` map if available). This lookup is used by `update_collider` and `remove_collider`.

**add_collider flow:**
1. `world.create()` + `world.add<Transform>(pos)` + `world.add<ColliderComponent>(parsed)` 
2. Store game object ID mapping
3. `collision_system->mark_dirty()`

**update_collider flow:**
1. Look up entity by ID
2. Modify `Transform::position` and/or `ColliderComponent` fields
3. `collision_system->mark_dirty()`

**remove_collider flow:**
1. Look up entity by ID
2. `world.destroy(entity)`
3. Remove from ID mapping
4. `collision_system->mark_dirty()`

### 1.5 Event: collider_updated

Broadcast when the engine modifies a collider (stub for now — used by Spec 2b gizmo):
```json
{
  "event": "collider_updated",
  "id": "floor_001",
  "position": [0, -0.5, 0],
  "rotation": [0, 0, 0, 1],
  "collider": { ... }
}
```

Only broadcast if `control_server_.is_event_subscribed("collider_updated")`.

---

## 2. Bricklayer Collider Properties Panel

### 2.1 Data Model (Zustand Store)

Add to `useEditorStore`:

```typescript
interface ColliderData {
  id: string;
  name: string;
  position: [number, number, number];
  rotation: [number, number, number, number]; // quaternion [x,y,z,w]
  shape:
    | { type: 'box'; half_extents: [number, number, number] }
    | { type: 'sphere'; radius: number }
    | { type: 'capsule'; radius: number; half_height: number };
  collision_mask: number;
  is_trigger: boolean;
  is_dynamic: boolean;
}
```

Store additions:
- `colliders: ColliderData[]`
- `selectedColliderId: string | null`
- `addCollider(data: ColliderData): void`
- `updateCollider(id: string, partial: Partial<ColliderData>): void`
- `removeCollider(id: string): void`
- `setSelectedCollider(id: string | null): void`
- `setColliders(data: ColliderData[]): void` — bulk load from `list_colliders`

### 2.2 Properties Panel

New component: `ColliderPropertiesPanel.tsx`

Rendered when `selectedColliderId` is set and matches a collider in the store. Fields:

| Field | Widget | Notes |
|-------|--------|-------|
| Name | TextInput | Free text |
| Position | Vec3Input (x, y, z) | World-space |
| Rotation | Vec3Input (pitch, yaw, roll degrees) | **Euler angles for UX**. Converted to/from quaternion internally using `glm`-compatible ZYX convention |
| Shape type | Dropdown (box/sphere/capsule) | Changing type resets shape params to defaults |
| Half extents | Vec3Input | Box only |
| Radius | NumberInput | Sphere and capsule |
| Half height | NumberInput | Capsule only |
| Is trigger | Checkbox | |
| Is dynamic | Checkbox | |
| Collision mask | NumberInput | Collapsed "Advanced" section |
| Delete | Button | Confirmation dialog |

**Euler-to-quaternion conversion:** Uses the standard ZYX (yaw-pitch-roll) convention:
```typescript
function eulerToQuat(pitchDeg: number, yawDeg: number, rollDeg: number): [number, number, number, number]
function quatToEuler(q: [number, number, number, number]): [number, number, number]
```

These utilities live in a shared `math-utils.ts` file in the level-designer app.

### 2.3 Collider List Panel

New component: `ColliderListPanel.tsx`

Shown in the sidebar when the colliders layer is active:
- Scrollable list of all colliders (name + shape icon)
- Click to select (sets `selectedColliderId`)
- Selected item highlighted
- "+" button at top to add new collider at position (0, 0, 0)
- Right-click context menu: duplicate, delete

### 2.4 Layer Integration

Add `'colliders'` to the `activeLayer` type union. When active:
- `ColliderListPanel` shown in sidebar
- `ColliderPropertiesPanel` shown when a collider is selected
- Wireframe rendering auto-enabled in engine via `set_feature("debug_colliders", true)`

### 2.5 useEngine Hook Extensions

Add to `useEngine.ts`:

```typescript
const addCollider = useCallback(
  (data: ColliderData): Promise<OkResponse | null> =>
    sendCommand<OkResponse>({ cmd: 'add_collider', ...data }),
  [sendCommand],
);

const updateCollider = useCallback(
  (id: string, data: Partial<ColliderData>): Promise<OkResponse | null> =>
    sendCommand<OkResponse>({ cmd: 'update_collider', id, ...data }),
  [sendCommand],
);

const removeCollider = useCallback(
  (id: string): Promise<OkResponse | null> =>
    sendCommand<OkResponse>({ cmd: 'remove_collider', id }),
  [sendCommand],
);

const listColliders = useCallback(
  (): Promise<ListCollidersResponse | null> =>
    sendCommand<ListCollidersResponse>({ cmd: 'list_colliders' }),
  [sendCommand],
);
```

### 2.6 Sync Pattern

Extend `useEngineSync.ts`:
- On Bricklayer connect: call `listColliders()`, populate store with `setColliders()`
- Store collider mutations → diff → bridge commands
- Subscribe to `collider_updated` event → update store (prep for Spec 2b)

---

## 3. Vulkan Wireframe Debug Rendering

### 3.1 Pipeline

New `DebugWireframePipeline` built via existing `PipelineBuilder`:

| Setting | Value |
|---------|-------|
| Polygon mode | `VK_POLYGON_MODE_LINE` |
| Primitive topology | `VK_PRIMITIVE_TOPOLOGY_LINE_LIST` |
| Cull mode | `VK_CULL_MODE_NONE` |
| Depth test | Read enabled, write disabled |
| Blending | Alpha blend (translucent wireframes) |
| Line width | 1.0 (default, no `wideLines` requirement) |
| Render pass | Same scene render pass as sprites |

### 3.2 Shaders

**`shaders/debug_wireframe.vert`:**

```glsl
#version 450

layout(location = 0) in vec3 in_position;

layout(set = 0, binding = 0) uniform UBO {
    mat4 vp;
} ubo;

layout(push_constant) uniform PushConstants {
    mat4 model;       // Translation + rotation only (no non-uniform scale)
    vec4 color;
    vec4 shape_params; // x=type(0=box,1=sphere,2=capsule), y=radius, z=half_height, w=unused
    vec4 extents;      // Box: half_extents.xyz. Sphere/Capsule: unused.
} pc;

layout(location = 0) out vec4 frag_color;

void main() {
    vec3 pos = in_position;
    int shape_type = int(pc.shape_params.x);

    if (shape_type == 0) {
        // Box: scale unit cube by half_extents
        pos *= pc.extents.xyz;
    } else if (shape_type == 1) {
        // Sphere: scale unit sphere by radius
        pos *= pc.shape_params.y;
    } else {
        // Capsule: vertex.y sign determines hemisphere vs cylinder
        // Vertices are authored with y in [-1, 1]:
        //   |y| <= 0.5 → cylinder segment, scale xz by radius, y by half_height*2
        //   y > 0.5 → top hemisphere, scale by radius, translate +half_height
        //   y < -0.5 → bottom hemisphere, scale by radius, translate -half_height
        float r = pc.shape_params.y;
        float hh = pc.shape_params.z;

        if (abs(pos.y) <= 0.501) {
            // Cylinder region
            pos.x *= r;
            pos.z *= r;
            pos.y *= hh * 2.0;
        } else {
            // Hemisphere cap
            float sign_y = sign(pos.y);
            vec3 local = vec3(pos.x, abs(pos.y) - 0.5, pos.z); // normalize to unit hemi
            local *= r * 2.0; // scale hemisphere to radius
            pos = vec3(local.x, local.y + sign_y * hh, local.z);
        }
    }

    gl_Position = ubo.vp * pc.model * vec4(pos, 1.0);
    frag_color = pc.color;
}
```

**`shaders/debug_wireframe.frag`:**

```glsl
#version 450

layout(location = 0) in vec4 frag_color;
layout(location = 0) out vec4 out_color;

void main() {
    out_color = frag_color;
}
```

### 3.3 Base Shape Meshes (Line Lists)

Generated once at pipeline creation. Stored in a single shared `VkBuffer` with known offset/count ranges:

| Shape | Description | Approx vertices |
|-------|-------------|-----------------|
| Unit Cube | 12 edges of [-1,1]^3 as line pairs | 24 |
| Unit Sphere | 3 orthogonal great circles, 32 segments each | 192 |
| Unit Capsule | 2 hemisphere half-circles (top/bottom), 4 longitudinal lines, 2 equator circles | ~256 |

Each vertex is a `glm::vec3` (position only — color comes from push constants).

**Capsule vertex convention:**
- Vertices with `|y| <= 0.5` are in the cylinder region
- Vertices with `y > 0.5` belong to the top hemisphere
- Vertices with `y < -0.5` belong to the bottom hemisphere
- The vertex shader uses this convention to apply shape-specific scaling

### 3.4 Color Scheme

| State | Color (RGBA) |
|-------|-------------|
| Static solid | `(0.2, 0.9, 0.2, 0.8)` — green |
| Dynamic solid | `(0.2, 0.8, 0.9, 0.8)` — cyan |
| Trigger volume | `(0.9, 0.9, 0.2, 0.5)` — yellow, more transparent |
| Selected | `(1.0, 1.0, 1.0, 1.0)` — white |

### 3.5 Draw List Interface

The renderer is decoupled from the collision system via a draw info struct:

```cpp
struct DebugColliderDrawInfo {
    glm::mat4 model;          // Translation + rotation (no scale)
    glm::vec4 color;
    ColliderType shape_type;
    float radius{0.0f};       // Sphere/Capsule
    float half_height{0.0f};  // Capsule
    glm::vec3 half_extents{0.0f}; // Box
};
```

The demo state builds a `std::vector<DebugColliderDrawInfo>` each frame from the collision caches and passes it to the renderer's draw method.

### 3.6 Rendering Integration

Inserted in `Renderer::draw_scene()` after entity rendering, before post-process:

1. If `feature_flags.debug_colliders` is false, skip
2. Bind wireframe pipeline
3. Bind UBO descriptor set (same VP matrix as scene)
4. Bind wireframe vertex buffer
5. For each `DebugColliderDrawInfo`:
   - Push constants: `{model, color, shape_params, extents}`
   - `vkCmdDraw(vertex_count, 1, vertex_offset, 0)` for the appropriate shape mesh

### 3.7 Feature Flag

`FeatureFlags::debug_colliders` (default `false`). Controlled via:
- Bridge: `set_feature("debug_colliders", true)` (existing `set_feature` command)
- Bricklayer: auto-enables when colliders layer is active
- Engine: F10 keyboard toggle

---

## 4. Migration Script

### 4.1 Purpose

Convert existing `CollisionGrid` data in scene JSON to Box collider game objects. Also migrate `nav_zone[]` and `light_probe[]` to component-based entities.

### 4.2 Greedy Rectangle Merge

For solid cells and nav zones, adjacent cells are merged into larger boxes:

1. Build 2D boolean grid from `solid[]`
2. Scan left-to-right, top-to-bottom
3. For each unvisited solid cell at `(gx, gz)` with elevation `e`:
   - Expand right: while next cell is solid, unvisited, AND `elevation == e`
   - Expand down: while all cells in the current width are solid, unvisited, AND `elevation == e`
   - Mark all cells in the merged rectangle as visited
   - Emit one box

**Critical constraint:** Only merge cells with matching elevation. Cells with different elevations become separate boxes to preserve terrain topology (stairs, steps, slopes).

### 4.3 Box Generation

For each merged rectangle `(gx, gz, width, height)` with elevation `e`:
- `half_extents.x = (width * cell_size) / 2`
- `half_extents.z = (height * cell_size) / 2`
- `half_extents.y = 0.25` (0.5 units thick floor slab)
- `position.x = (gx + width/2) * cell_size` (center of merged rect, in grid coords)
- `position.z = (gz + height/2) * cell_size`
- `position.y = e - 0.25` (top of box aligns with grid elevation)

Position values are in grid coordinates (scene JSON space). The engine's scene loader handles the conversion to world space via terrain AABB offset.

### 4.4 NavZoneVolume Migration

For each unique non-zero `nav_zone` ID:
1. Run greedy merge on cells with that zone ID (elevation constraint not required for zones — they're volumes, not floors)
2. Output game objects with both `ColliderComponent` (`is_trigger: true`) and `NavZoneVolume` (`zone_id: N`)
3. Box Y position at grid elevation, `half_extents.y = 2.0` (tall enough to encompass walking entities)

**NavZoneVolume component:**
```cpp
struct NavZoneVolume {
    uint8_t zone_id{0};
};
```

Registered via `ComponentRegistry`. JSON: `{"NavZoneVolume": {"zone_id": 3}}`.

### 4.5 LightProbe Migration

For each cell with a non-default light probe color (not `(0.5, 0.5, 0.5)`):
1. Downsample: one probe per 4x4 cell block (average colors in the block)
2. Emit point entity with `LightProbe` component at block center position

**LightProbe component:**
```cpp
struct LightProbe {
    glm::vec3 color{0.5f};
};
```

Registered via `ComponentRegistry`. JSON: `{"LightProbe": {"color": [0.6, 0.5, 0.4]}}`.

### 4.6 Script

Python script: `scripts/migrate_collision_grid.py`

```
Usage:
  python3 scripts/migrate_collision_grid.py <scene.json> [options]

Options:
  --output <path>      Write to separate file (default: overwrite input)
  --remove-grid        Remove the "collision" field after migration
  --skip-nav-zones     Don't migrate nav_zone data
  --skip-light-probes  Don't migrate light_probe data
  --probe-block-size N Downsample probes to NxN blocks (default: 4)
  --dry-run            Print statistics without modifying files
```

Output: appends generated game objects to `game_objects[]` array in the scene JSON.

### 4.7 Generated ID Convention

- Floor colliders: `"migrated_floor_001"`, `"migrated_floor_002"`, ...
- Nav zones: `"migrated_navzone_3_001"` (zone ID 3, instance 1)
- Light probes: `"migrated_probe_001"`, ...

### 4.8 Testing

- Python unit test: 8x8 grid with known pattern → verify merged box count, positions, and elevation-respecting boundaries
- Integration: run on `seurat_island.json`, load in engine, verify KCC movement matches old grid behavior

---

## 5. New ECS Components

### 5.1 NavZoneVolume

New file: `include/gseurat/engine/ecs/components/nav_zone_volume.hpp`

```cpp
struct NavZoneVolume {
    uint8_t zone_id{0};
};
```

JSON: `{"NavZoneVolume": {"zone_id": 3}}`

Registered in `app_base.cpp`. Entities with NavZoneVolume also have `ColliderComponent` with `is_trigger: true`. Game code reads zone ID from overlap results.

### 5.2 LightProbe

New file: `include/gseurat/engine/ecs/components/light_probe.hpp`

```cpp
struct LightProbe {
    glm::vec3 color{0.5f};
};
```

JSON: `{"LightProbe": {"color": [0.6, 0.5, 0.4]}}`

Registered in `app_base.cpp`. Used by the renderer for ambient color sampling (replaces grid-based light probe lookup).

---

## 6. File Layout

### New Files — Engine

| File | Purpose |
|------|---------|
| `include/gseurat/engine/collision/debug_wireframe.hpp` | DebugColliderDrawInfo struct, wireframe mesh generation |
| `src/engine/collision/debug_wireframe.cpp` | Wireframe vertex generation + pipeline setup |
| `shaders/debug_wireframe.vert` | Wireframe vertex shader |
| `shaders/debug_wireframe.frag` | Wireframe fragment shader |
| `include/gseurat/engine/ecs/components/nav_zone_volume.hpp` | NavZoneVolume component |
| `include/gseurat/engine/ecs/components/light_probe.hpp` | LightProbe component |

### New Files — Bricklayer

| File | Purpose |
|------|---------|
| `tools/apps/level-designer/src/components/ColliderPropertiesPanel.tsx` | Collider editing panel |
| `tools/apps/level-designer/src/components/ColliderListPanel.tsx` | Collider list sidebar |
| `tools/apps/level-designer/src/utils/math-utils.ts` | Euler/quaternion conversion |

### New Files — Scripts

| File | Purpose |
|------|---------|
| `scripts/migrate_collision_grid.py` | Migration script |
| `tests/test_migration.py` | Migration unit tests |

### Modified Files

| File | Changes |
|------|---------|
| `src/engine/command_dispatcher.cpp` | Register 4 collider commands |
| `include/gseurat/engine/command_context.hpp` | Add `CollisionSystem*` pointer |
| `src/demo/island_demo_state.cpp` | Wire `CollisionSystem*` into CommandContext, build wireframe draw list |
| `src/engine/renderer.cpp` | Add wireframe pipeline creation + draw method |
| `include/gseurat/engine/renderer.hpp` | Add wireframe pipeline members |
| `include/gseurat/engine/feature_flags.hpp` | Add `debug_colliders` flag |
| `src/engine/app_base.cpp` | Register NavZoneVolume + LightProbe components |
| `schemas/scene.schema.json` | Add NavZoneVolume + LightProbe component schemas |
| `tools/apps/level-designer/src/store/useEditorStore.ts` | Add colliders state |
| `tools/apps/level-designer/src/hooks/useEngine.ts` | Add collider command helpers |
| `tools/apps/level-designer/src/hooks/useEngineSync.ts` | Add collider sync |
| `CMakeLists.txt` | Add wireframe sources, shader compilation |

---

## 7. Constraints

- No changes to existing CollisionGrid behavior — it continues to work alongside the new system during the transition period
- No 3D gizmo interaction (raycasting, drag handles) — deferred to Spec 2b
- Wireframe rendering uses the existing scene render pass — no new render pass
- Push constants stay within the 128-byte guaranteed minimum (`mat4` + `vec4` + `vec4` + `vec4` = 112 bytes)
- All bridge commands are JSON-over-WebSocket, matching existing protocol
- Migration script is Python (matching existing scripts like `scenario_runner.py`)

---

## 8. Testing Strategy

1. **Bridge commands:** Game Director integration test — add, list, update, remove colliders via socket, verify state
2. **Wireframe pipeline:** Visual verification via Staging or engine screenshot — load scene with colliders, enable `debug_colliders`, confirm wireframes render correctly
3. **Bricklayer panel:** Build succeeds (`pnpm build` in tools/), component renders (browser check)
4. **Collider sync:** Bridge round-trip — add in Bricklayer, verify in engine via `list_colliders`
5. **Migration script:** Python unit test with 8x8 grid, known pattern, verify box count/positions/elevations
6. **Migration integration:** Run on `seurat_island.json`, load in engine, verify KCC walks correctly on generated boxes
7. **Feature flag:** Toggle `debug_colliders` on/off, verify wireframes appear/disappear
8. **Build verification:** `cmake --build --preset macos-debug` and `pnpm build` both succeed
