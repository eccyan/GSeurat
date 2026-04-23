# Collision Editor Integration Implementation Plan (Spec 2a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable level designers to create, edit, and visualize primitive colliders through Bricklayer and see 3D wireframes in the engine viewport. Migrate existing CollisionGrid data to the new system.

**Architecture:** Bridge CRUD commands operate on ECS entities with ColliderComponent. Bricklayer manages collider data in its Zustand store and syncs via bridge. The engine renders depth-tested wireframes via a dedicated VK_POLYGON_MODE_LINE pipeline. A Python migration script converts CollisionGrid to Box collider entities.

**Tech Stack:** C++23, Vulkan, GLSL 450, TypeScript/React, Python 3

**Spec:** `docs/superpowers/specs/2026-04-22-collision-editor-integration-design.md`

---

## File Structure

### New Files — Engine

| File | Responsibility |
|------|----------------|
| `include/gseurat/engine/ecs/components/nav_zone_volume.hpp` | NavZoneVolume component |
| `include/gseurat/engine/ecs/components/light_probe.hpp` | LightProbe component |
| `include/gseurat/engine/collision/debug_wireframe.hpp` | DebugColliderDrawInfo struct, wireframe mesh generation declarations |
| `src/engine/collision/debug_wireframe.cpp` | Wireframe vertex generation, pipeline setup, draw method |
| `shaders/debug_wireframe.vert` | Wireframe vertex shader with shape-aware scaling |
| `shaders/debug_wireframe.frag` | Wireframe fragment shader |

### New Files — Bricklayer

| File | Responsibility |
|------|----------------|
| `tools/apps/level-designer/src/components/ColliderPropertiesPanel.tsx` | Selected collider editing panel |
| `tools/apps/level-designer/src/components/ColliderListPanel.tsx` | Scrollable collider list with selection |
| `tools/apps/level-designer/src/utils/math-utils.ts` | Euler/quaternion conversion utilities |

### New Files — Scripts

| File | Responsibility |
|------|----------------|
| `scripts/migrate_collision_grid.py` | Migration script |
| `tests/test_migration.py` | Migration unit tests |

### Modified Files

| File | Changes |
|------|---------|
| `include/gseurat/engine/command_context.hpp` | Add `CollisionSystem*` pointer |
| `include/gseurat/engine/feature_flags.hpp` | Add `debug_colliders` flag |
| `src/engine/command_dispatcher.cpp` | Register 4 collider commands |
| `src/engine/app_base.cpp` | Register NavZoneVolume + LightProbe |
| `src/demo/island_demo_state.cpp` | Wire CollisionSystem into CommandContext, build wireframe draw list |
| `src/engine/renderer.hpp` | Add wireframe pipeline members |
| `src/engine/renderer.cpp` | Add wireframe pipeline creation + draw pass |
| `schemas/scene.schema.json` | Add NavZoneVolume + LightProbe component schemas |
| `tools/apps/level-designer/src/store/useEditorStore.ts` | Add colliders state |
| `tools/apps/level-designer/src/hooks/useEngine.ts` | Add collider command helpers |
| `tools/apps/level-designer/src/hooks/useEngineSync.ts` | Add collider sync |
| `CMakeLists.txt` | Add new sources, shader compilation |

---

## Task 1: NavZoneVolume & LightProbe Components

**Files:**
- Create: `include/gseurat/engine/ecs/components/nav_zone_volume.hpp`
- Create: `include/gseurat/engine/ecs/components/light_probe.hpp`
- Modify: `src/engine/app_base.cpp`
- Modify: `schemas/scene.schema.json`

### Steps

- [ ] **Step 1:** Create `include/gseurat/engine/ecs/components/nav_zone_volume.hpp`:

```cpp
#pragma once
#include <cstdint>
#include <nlohmann/json.hpp>

namespace gseurat {

struct NavZoneVolume {
    uint8_t zone_id{0};
};

inline NavZoneVolume nav_zone_volume_from_json(const nlohmann::json& j) {
    NavZoneVolume v;
    if (j.contains("zone_id")) v.zone_id = j["zone_id"].get<uint8_t>();
    return v;
}

inline nlohmann::json nav_zone_volume_to_json(const NavZoneVolume& v) {
    return {{"zone_id", v.zone_id}};
}

}  // namespace gseurat
```

- [ ] **Step 2:** Create `include/gseurat/engine/ecs/components/light_probe.hpp`:

```cpp
#pragma once
#include <glm/glm.hpp>
#include <nlohmann/json.hpp>

namespace gseurat {

struct LightProbe {
    glm::vec3 color{0.5f};
};

inline LightProbe light_probe_from_json(const nlohmann::json& j) {
    LightProbe lp;
    if (j.contains("color") && j["color"].is_array()) {
        auto& c = j["color"];
        lp.color = glm::vec3(c[0].get<float>(), c[1].get<float>(), c[2].get<float>());
    }
    return lp;
}

inline nlohmann::json light_probe_to_json(const LightProbe& lp) {
    return {{"color", {lp.color.x, lp.color.y, lp.color.z}}};
}

}  // namespace gseurat
```

- [ ] **Step 3:** Register both components in `app_base.cpp` inside `init_game_object_system()`, alongside existing registrations:

```cpp
#include "gseurat/engine/ecs/components/nav_zone_volume.hpp"
#include "gseurat/engine/ecs/components/light_probe.hpp"

// In init_game_object_system():
component_registry_.register_component<NavZoneVolume>("NavZoneVolume",
    [](const nlohmann::json& j) -> NavZoneVolume { return nav_zone_volume_from_json(j); },
    [](const NavZoneVolume& v) -> nlohmann::json { return nav_zone_volume_to_json(v); });

component_registry_.register_component<LightProbe>("LightProbe",
    [](const nlohmann::json& j) -> LightProbe { return light_probe_from_json(j); },
    [](const LightProbe& lp) -> nlohmann::json { return light_probe_to_json(lp); });
```

- [ ] **Step 4:** Add schema entries to `schemas/scene.schema.json` under the components properties:

```json
"NavZoneVolume": {
  "type": "object",
  "properties": {
    "zone_id": { "type": "integer", "minimum": 0, "maximum": 255, "default": 0 }
  }
},
"LightProbe": {
  "type": "object",
  "properties": {
    "color": { "type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3 }
  }
}
```

- [ ] **Step 5:** Build to verify: `cmake --preset macos-debug && cmake --build --preset macos-debug`

- [ ] **Step 6:** Commit:
```bash
git add include/gseurat/engine/ecs/components/nav_zone_volume.hpp \
        include/gseurat/engine/ecs/components/light_probe.hpp \
        src/engine/app_base.cpp schemas/scene.schema.json
git commit -m "feat(collision): add NavZoneVolume and LightProbe ECS components"
```

---

## Task 2: Bridge Commands — CommandContext + add/update/remove/list_colliders

**Files:**
- Modify: `include/gseurat/engine/command_context.hpp`
- Modify: `src/engine/command_dispatcher.cpp`
- Modify: `src/demo/island_demo_state.cpp`

### Context

Commands follow the existing pattern in `command_dispatcher.cpp`. The `CommandContext` gets a `CollisionSystem*` pointer (same pattern as `CameraZoneSystem*`). Commands use `SceneObjectState::game_objects` for ID lookup.

### Steps

- [ ] **Step 1:** Add `CollisionSystem*` to `CommandContext` in `command_context.hpp`:

```cpp
// Add forward declaration before the struct:
class CollisionSystem;

// Add inside CommandContext struct, after camera_zone_system:
CollisionSystem* collision_system = nullptr;
```

- [ ] **Step 2:** Wire the pointer in `island_demo_state.cpp`, in the same location where `camera_zone_system` is wired into CommandContext (typically in `on_enter()` after collision system init, and nulled in `on_exit()` before cleanup).

- [ ] **Step 3:** Register `add_collider` command in `command_dispatcher.cpp`:

The handler creates an ECS entity with Transform + ColliderComponent, stores the game object data in `scene_objects.game_objects`, and marks the collision system dirty.

Parse: `id` (string), `name` (string), `position` (vec3 array), `rotation` (vec4 array, quaternion [x,y,z,w]), `collider` (object matching ColliderComponent JSON format from Spec 1).

Create entity: `world.create()`, add Transform from position, add ColliderComponent parsed via `collider_from_json()`. Store game object info in `scene_objects`. Call `collision_system->mark_dirty()`.

Return: `{"type": "ok", "id": "<id>"}`.

- [ ] **Step 4:** Register `update_collider` command:

Lookup entity by `id` in `scene_objects.game_objects`. If not found, return error. Update Transform position and/or ColliderComponent fields (partial update — only specified fields change). Mark dirty.

Return: `{"type": "ok"}`.

- [ ] **Step 5:** Register `remove_collider` command:

Lookup entity by `id`. Destroy entity via `world.destroy()`. Remove from `scene_objects.game_objects`. Mark dirty.

Return: `{"type": "ok"}`.

- [ ] **Step 6:** Register `list_colliders` command:

Query `world.view<ecs::Transform, ColliderComponent>()`. For each entity, find matching game object data from `scene_objects.game_objects` to get the ID and name. Build JSON array of all colliders with their full state.

Return: `{"type": "ok", "colliders": [...]}`.

- [ ] **Step 7:** Build to verify: `cmake --build --preset macos-debug`

- [ ] **Step 8:** Commit:
```bash
git add include/gseurat/engine/command_context.hpp src/engine/command_dispatcher.cpp \
        src/demo/island_demo_state.cpp
git commit -m "feat(collision): add bridge commands for collider CRUD"
```

---

## Task 3: Feature Flag + Wireframe Shaders

**Files:**
- Modify: `include/gseurat/engine/feature_flags.hpp`
- Modify: `src/engine/command_dispatcher.cpp` (add to flag_map)
- Create: `shaders/debug_wireframe.vert`
- Create: `shaders/debug_wireframe.frag`

### Steps

- [ ] **Step 1:** Add `debug_colliders` to `FeatureFlags` struct:

```cpp
// Under "// Effects" section:
bool debug_colliders = false;    // Collider wireframe debug visualization
```

Update `entries()` array to include it (increment array size, add entry):
```cpp
{"Debug Colliders", "---", "DEBUG", &FeatureFlags::debug_colliders},
```

Update `gs_viewer()` to include it as `false`.

- [ ] **Step 2:** Add `"debug_colliders"` to the `flag_map` in `set_feature` command handler in `command_dispatcher.cpp`:

```cpp
{"debug_colliders", &FeatureFlags::debug_colliders},
```

- [ ] **Step 3:** Create `shaders/debug_wireframe.vert`:

```glsl
#version 450

layout(location = 0) in vec3 in_position;

layout(set = 0, binding = 0) uniform UBO {
    mat4 vp;
} ubo;

layout(push_constant) uniform PushConstants {
    mat4 model;        // Translation + rotation (no non-uniform scale)
    vec4 color;
    vec4 shape_params; // x=type(0=box,1=sphere,2=capsule), y=radius, z=half_height
    vec4 extents;      // Box half_extents.xyz
} pc;

layout(location = 0) out vec4 frag_color;

void main() {
    vec3 pos = in_position;
    int shape_type = int(pc.shape_params.x);

    if (shape_type == 0) {
        // Box: scale unit cube vertices by half_extents
        pos *= pc.extents.xyz;
    } else if (shape_type == 1) {
        // Sphere: scale by radius
        pos *= pc.shape_params.y;
    } else {
        // Capsule: vertex.y convention:
        //   |y| <= 0.501 → cylinder segment
        //   |y| > 0.501  → hemisphere cap
        float r = pc.shape_params.y;
        float hh = pc.shape_params.z;

        if (abs(pos.y) <= 0.501) {
            pos.x *= r;
            pos.z *= r;
            pos.y *= hh * 2.0;
        } else {
            float sign_y = sign(pos.y);
            vec3 local_pos = vec3(pos.x, abs(pos.y) - 0.5, pos.z);
            local_pos *= r * 2.0;
            pos = vec3(local_pos.x, local_pos.y + sign_y * hh, local_pos.z);
        }
    }

    gl_Position = ubo.vp * pc.model * vec4(pos, 1.0);
    frag_color = pc.color;
}
```

- [ ] **Step 4:** Create `shaders/debug_wireframe.frag`:

```glsl
#version 450

layout(location = 0) in vec4 frag_color;
layout(location = 0) out vec4 out_color;

void main() {
    out_color = frag_color;
}
```

- [ ] **Step 5:** Compile shaders (follow existing shader compilation pattern in CMakeLists.txt or build script):

```bash
glslc shaders/debug_wireframe.vert -o shaders/debug_wireframe.vert.spv
glslc shaders/debug_wireframe.frag -o shaders/debug_wireframe.frag.spv
```

Add shader compilation to CMakeLists.txt if there's an existing shader compile target. Otherwise, compile manually and commit the .spv files.

- [ ] **Step 6:** Build to verify feature flag compiles: `cmake --build --preset macos-debug`

- [ ] **Step 7:** Commit:
```bash
git add include/gseurat/engine/feature_flags.hpp src/engine/command_dispatcher.cpp \
        shaders/debug_wireframe.vert shaders/debug_wireframe.frag \
        shaders/debug_wireframe.vert.spv shaders/debug_wireframe.frag.spv
git commit -m "feat(collision): add debug_colliders feature flag and wireframe shaders"
```

---

## Task 4: Wireframe Pipeline + Base Meshes + Rendering

**Files:**
- Create: `include/gseurat/engine/collision/debug_wireframe.hpp`
- Create: `src/engine/collision/debug_wireframe.cpp`
- Modify: `include/gseurat/engine/renderer.hpp`
- Modify: `src/engine/renderer.cpp`
- Modify: `src/demo/island_demo_state.cpp`
- Modify: `CMakeLists.txt`

### Context

This task creates the Vulkan wireframe pipeline, generates base shape line-list meshes (cube, sphere, capsule), and integrates the draw pass into the renderer. The demo state builds a `DebugColliderDrawInfo` vector from the collision caches each frame.

### Steps

- [ ] **Step 1:** Create `include/gseurat/engine/collision/debug_wireframe.hpp`:

```cpp
#pragma once

#include "gseurat/engine/collision/primitive.hpp"
#include <glm/glm.hpp>
#include <glm/gtc/quaternion.hpp>
#include <vector>

namespace gseurat {

struct DebugColliderDrawInfo {
    glm::mat4 model;            // Translation + rotation (no scale)
    glm::vec4 color;
    ColliderType shape_type;
    float radius{0.0f};
    float half_height{0.0f};
    glm::vec3 half_extents{0.0f};
};

// Shape mesh ranges in the shared vertex buffer
struct WireframeMeshRange {
    uint32_t offset;  // vertex offset
    uint32_t count;   // vertex count
};

struct WireframeMeshData {
    std::vector<glm::vec3> vertices;  // All shapes concatenated
    WireframeMeshRange cube;
    WireframeMeshRange sphere;
    WireframeMeshRange capsule;
};

// Generate all base shape line-list vertices
WireframeMeshData generate_wireframe_meshes();

}  // namespace gseurat
```

- [ ] **Step 2:** Implement `src/engine/collision/debug_wireframe.cpp`:

Generate unit cube (12 edges = 24 vertices), unit sphere (3 great circles × 32 segments = 192 vertices), unit capsule (~256 vertices with hemisphere caps, cylinder lines, equator circles).

The cube vertices are edges of [-1,1]^3. The sphere vertices are 3 orthogonal circles (XY, XZ, YZ planes). The capsule uses the vertex Y convention: `|y| <= 0.5` for cylinder, `|y| > 0.5` for hemisphere caps.

- [ ] **Step 3:** Add wireframe pipeline members to `renderer.hpp`:

```cpp
// Under private section:
VkPipeline wireframe_pipeline_{VK_NULL_HANDLE};
VkPipelineLayout wireframe_pipeline_layout_{VK_NULL_HANDLE};
VkBuffer wireframe_vertex_buffer_{VK_NULL_HANDLE};
VmaAllocation wireframe_vertex_alloc_{nullptr};
WireframeMeshData wireframe_meshes_;

void create_wireframe_pipeline();
void destroy_wireframe_pipeline();

public:
void draw_debug_colliders(VkCommandBuffer cmd,
                          const std::vector<DebugColliderDrawInfo>& draw_list);
```

- [ ] **Step 4:** Implement wireframe pipeline creation in `renderer.cpp`:

Use `PipelineBuilder` with:
- `set_rasterizer(VK_POLYGON_MODE_LINE, VK_CULL_MODE_NONE)`
- `set_input_assembly(VK_PRIMITIVE_TOPOLOGY_LINE_LIST)`
- `set_depth_stencil(true, false)` — read depth, don't write
- `set_color_blend_alpha()` — translucent wireframes
- Push constant range: 112 bytes (mat4 + vec4 + vec4 + vec4)
- Render pass: same scene render pass as sprites

Create vertex buffer from `generate_wireframe_meshes()` output. Upload via staging buffer (following existing VMA patterns).

Call `create_wireframe_pipeline()` from existing pipeline initialization code.

- [ ] **Step 5:** Implement `draw_debug_colliders()`:

For each `DebugColliderDrawInfo`:
1. Bind wireframe pipeline (once at start)
2. Push constants: model, color, shape_params (type, radius, half_height), extents (half_extents)
3. Select mesh range based on `shape_type`
4. `vkCmdDraw(range.count, 1, range.offset, 0)`

- [ ] **Step 6:** Insert wireframe draw call in `draw_scene()`, after entity rendering, guarded by `feature_flags.debug_colliders`.

- [ ] **Step 7:** In `island_demo_state.cpp`, build the wireframe draw list in `build_draw_lists()`:

Iterate `collision_system_.static_cache()` and `collision_system_.dynamic_cache()`. For each `ColliderInstance`, construct a `DebugColliderDrawInfo` with:
- `model` = translation(world_position) * mat4_cast(world_rotation)
- `color` from the color scheme (green for static solid, cyan for dynamic, yellow for trigger)
- Shape params from the variant

Pass the draw list to the renderer.

- [ ] **Step 8:** Add `src/engine/collision/debug_wireframe.cpp` to `gseurat_core` in `CMakeLists.txt`.

- [ ] **Step 9:** Build to verify: `cmake --build --preset macos-debug`

- [ ] **Step 10:** Commit:
```bash
git add include/gseurat/engine/collision/debug_wireframe.hpp \
        src/engine/collision/debug_wireframe.cpp \
        include/gseurat/engine/renderer.hpp src/engine/renderer.cpp \
        src/demo/island_demo_state.cpp CMakeLists.txt
git commit -m "feat(collision): add Vulkan wireframe debug rendering pipeline"
```

---

## Task 5: Bricklayer — Math Utils + Store Extensions

**Files:**
- Create: `tools/apps/level-designer/src/utils/math-utils.ts`
- Modify: `tools/apps/level-designer/src/store/useEditorStore.ts`

### Steps

- [ ] **Step 1:** Create `tools/apps/level-designer/src/utils/math-utils.ts`:

```typescript
// Euler angles (degrees) to quaternion [x, y, z, w]
// Uses ZYX convention (yaw-pitch-roll)
export function eulerToQuat(
  pitchDeg: number,
  yawDeg: number,
  rollDeg: number,
): [number, number, number, number] {
  const p = (pitchDeg * Math.PI) / 360; // half angle in radians
  const y = (yawDeg * Math.PI) / 360;
  const r = (rollDeg * Math.PI) / 360;

  const cp = Math.cos(p), sp = Math.sin(p);
  const cy = Math.cos(y), sy = Math.sin(y);
  const cr = Math.cos(r), sr = Math.sin(r);

  return [
    sr * cp * cy - cr * sp * sy, // x
    cr * sp * cy + sr * cp * sy, // y
    cr * cp * sy - sr * sp * cy, // z
    cr * cp * cy + sr * sp * sy, // w
  ];
}

// Quaternion [x, y, z, w] to Euler angles (degrees)
export function quatToEuler(
  q: [number, number, number, number],
): [number, number, number] {
  const [x, y, z, w] = q;

  // Pitch (X)
  const sinP = 2 * (w * x + y * z);
  const cosP = 1 - 2 * (x * x + y * y);
  const pitch = Math.atan2(sinP, cosP);

  // Yaw (Y)
  const sinY = 2 * (w * y - z * x);
  const yaw = Math.abs(sinY) >= 1
    ? (Math.sign(sinY) * Math.PI) / 2
    : Math.asin(sinY);

  // Roll (Z)
  const sinR = 2 * (w * z + x * y);
  const cosR = 1 - 2 * (y * y + z * z);
  const roll = Math.atan2(sinR, cosR);

  return [
    (pitch * 180) / Math.PI,
    (yaw * 180) / Math.PI,
    (roll * 180) / Math.PI,
  ];
}
```

- [ ] **Step 2:** Add collider types and state to `useEditorStore.ts`:

```typescript
export interface ColliderData {
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

Add state fields:
```typescript
colliders: ColliderData[];
selectedColliderId: string | null;
```

Add actions:
```typescript
addCollider: (data: ColliderData) => void;
updateCollider: (id: string, partial: Partial<ColliderData>) => void;
removeCollider: (id: string) => void;
setSelectedCollider: (id: string | null) => void;
setColliders: (data: ColliderData[]) => void;
```

- [ ] **Step 3:** Build to verify: `cd tools && pnpm build`

- [ ] **Step 4:** Commit:
```bash
git add tools/apps/level-designer/src/utils/math-utils.ts \
        tools/apps/level-designer/src/store/useEditorStore.ts
git commit -m "feat(bricklayer): add collider data model and Euler/quaternion utils"
```

---

## Task 6: Bricklayer — useEngine + useEngineSync Extensions

**Files:**
- Modify: `tools/apps/level-designer/src/hooks/useEngine.ts`
- Modify: `tools/apps/level-designer/src/hooks/useEngineSync.ts`

### Steps

- [ ] **Step 1:** Add collider command helpers to `useEngine.ts`:

```typescript
// Cinematic rail section is the model — add after it:

// ── Collider management ──

const addCollider = useCallback(
  (data: ColliderData): Promise<OkResponse | null> =>
    sendCommand<OkResponse>({
      cmd: 'add_collider',
      id: data.id,
      name: data.name,
      position: data.position,
      rotation: data.rotation,
      collider: {
        shape: data.shape,
        collision_mask: data.collision_mask,
        is_trigger: data.is_trigger,
        is_dynamic: data.is_dynamic,
      },
    }),
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

interface ListCollidersResponse {
  type: string;
  colliders: ColliderData[];
}

const listColliders = useCallback(
  (): Promise<ListCollidersResponse | null> =>
    sendCommand<ListCollidersResponse>({ cmd: 'list_colliders' }),
  [sendCommand],
);
```

Add all four to the return object.

- [ ] **Step 2:** Add collider sync to `useEngineSync.ts`:

On connect: call `listColliders()`, populate store with `setColliders()`.

Subscribe to store changes on `colliders` array — diff and dispatch bridge commands (same pattern as lights sync: additions → `addCollider`, removals → `removeCollider`, updates → `updateCollider`).

When colliders layer becomes active: `setFeature("debug_colliders", true)`. When deactivated: `setFeature("debug_colliders", false)`.

- [ ] **Step 3:** Build: `cd tools && pnpm build`

- [ ] **Step 4:** Commit:
```bash
git add tools/apps/level-designer/src/hooks/useEngine.ts \
        tools/apps/level-designer/src/hooks/useEngineSync.ts
git commit -m "feat(bricklayer): add collider bridge commands and sync"
```

---

## Task 7: Bricklayer — ColliderListPanel + ColliderPropertiesPanel

**Files:**
- Create: `tools/apps/level-designer/src/components/ColliderListPanel.tsx`
- Create: `tools/apps/level-designer/src/components/ColliderPropertiesPanel.tsx`
- Modify: parent component that renders panels based on active layer

### Steps

- [ ] **Step 1:** Create `ColliderListPanel.tsx`:

Scrollable list of colliders from the store. Each item shows name + shape type icon/label. Click to select (sets `selectedColliderId`). Selected item highlighted. "+" button at top creates a new collider with default values (box at origin). Delete via right-click or inline button.

Uses `useEditorStore` for state, `useEngine` for commands.

- [ ] **Step 2:** Create `ColliderPropertiesPanel.tsx`:

Renders when `selectedColliderId` matches a collider. Fields per spec Section 2.2:
- Name (TextInput)
- Position (Vec3Input)
- Rotation (Vec3Input in degrees — uses `eulerToQuat`/`quatToEuler` from math-utils.ts)
- Shape type (dropdown — changing type resets shape params to defaults)
- Shape-specific params (conditional rendering)
- Flags (checkboxes)
- Collision mask (collapsible advanced section)
- Delete button

Uses existing UI-kit components: `NumberSlider` or `NumberInput`, following the pattern in the existing `PropertiesPanel.tsx`.

On field change: calls `updateCollider(id, partial)` on the store, which triggers sync.

- [ ] **Step 3:** Wire panels into the layout — when `activeLayer === 'colliders'`, render `ColliderListPanel` in the sidebar and `ColliderPropertiesPanel` in the properties area. Follow the existing layer-switching pattern.

- [ ] **Step 4:** Add `'colliders'` to the `activeLayer` type union in the store.

- [ ] **Step 5:** Build: `cd tools && pnpm build`

- [ ] **Step 6:** Commit:
```bash
git add tools/apps/level-designer/src/components/ColliderListPanel.tsx \
        tools/apps/level-designer/src/components/ColliderPropertiesPanel.tsx \
        tools/apps/level-designer/src/store/useEditorStore.ts
git commit -m "feat(bricklayer): add collider list and properties panels"
```

---

## Task 8: Migration Script

**Files:**
- Create: `scripts/migrate_collision_grid.py`
- Create: `tests/test_migration.py`

### Steps

- [ ] **Step 1:** Create `scripts/migrate_collision_grid.py`:

Implements the greedy rectangle merge algorithm:
1. Load scene JSON
2. Extract `collision` field (width, height, cell_size, solid[], elevation[])
3. Greedy merge: scan cells, expand right/down only when `solid == True AND elevation == start_elevation`
4. For each merged rectangle: compute position (grid coords), half_extents, elevation-aligned Y
5. Generate `game_objects` entries with `ColliderComponent`
6. Optionally migrate `nav_zone[]` → `NavZoneVolume` boxes (no elevation constraint for zones)
7. Optionally migrate `light_probe[]` → `LightProbe` entities with NxN downsampling
8. Append to scene JSON `game_objects` array
9. Optionally remove `collision` field (`--remove-grid`)

ID convention: `migrated_floor_001`, `migrated_navzone_3_001`, `migrated_probe_001`.

CLI: `python3 scripts/migrate_collision_grid.py <scene.json> [--output <path>] [--remove-grid] [--skip-nav-zones] [--skip-light-probes] [--probe-block-size N] [--dry-run]`

- [ ] **Step 2:** Create `tests/test_migration.py`:

Test with an 8x8 grid:
- 4x4 block of solid cells at same elevation → merges into 1 box
- Two 2x2 blocks at different elevations → 2 separate boxes (elevation constraint)
- Single isolated solid cell → 1 box
- Verify box positions and half_extents match expected values
- Verify nav zone migration produces trigger boxes with zone IDs
- Verify light probe downsampling reduces entity count (4x4 block → 1 probe)
- Verify `--dry-run` doesn't modify the file

- [ ] **Step 3:** Run tests: `python3 -m pytest tests/test_migration.py -v`

- [ ] **Step 4:** Integration test: run on `examples/island_demo/assets/scenes/seurat_island.json`, verify output is valid JSON with collider game objects

- [ ] **Step 5:** Commit:
```bash
git add scripts/migrate_collision_grid.py tests/test_migration.py
git commit -m "feat(collision): add CollisionGrid migration script with greedy merge"
```

---

## Verification Checklist

After all tasks complete:

- [ ] Spec Section 1 (Bridge CRUD): add/update/remove/list_colliders commands — **Task 2**
- [ ] Spec Section 2 (Bricklayer Panel): Store, properties panel, list panel, sync — **Tasks 5, 6, 7**
- [ ] Spec Section 3 (Wireframe Rendering): Pipeline, shaders, base meshes, feature flag — **Tasks 3, 4**
- [ ] Spec Section 4 (Migration): Script, greedy merge, elevation constraint, nav zones, light probes — **Task 8**
- [ ] Spec Section 5 (Components): NavZoneVolume, LightProbe — **Task 1**
- [ ] Engine build: `cmake --build --preset macos-debug` — no new warnings
- [ ] Tools build: `cd tools && pnpm build` — succeeds
- [ ] All existing collision tests still pass: `ctest --test-dir build/macos-debug -R "test_primitive|test_intersect|test_bvh|test_collision|test_kcc|test_collider"`
- [ ] Migration tests pass: `python3 -m pytest tests/test_migration.py`
