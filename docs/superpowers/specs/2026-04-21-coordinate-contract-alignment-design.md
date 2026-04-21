# Coordinate Contract Standardization & Bricklayer Viewport Alignment

**Date:** 2026-04-21
**Status:** Draft
**Scope:** Scene JSON coordinate contract, C++ loader unification, GSVX v2 header, Bricklayer viewport offset

---

## Problem Statement

The Staging view (C++ ImGui) and Bricklayer preview (React/Three.js) are misaligned because:

1. **Type confusion:** Game object positions are loaded as `coord::GridPos` but some other entities (camera zones, lights, particle emitters) use raw `glm::vec3` without coordinate annotation.
2. **Inconsistent conversion:** Staging applies `coord::to_world()` for game objects, emitters, and animations but uses inline manual offsets for lights, and defers conversion to `CameraReviewState` for camera zones/rails.
3. **No offset in Bricklayer:** The Bricklayer viewport renders all entities at their raw grid coordinates without applying `terrain_aabb.min`, while Staging renders everything in world space.

Level designers see markers and zones in different positions between the two views.

---

## Design Decision: "All Scene JSON = GridPos"

**Contract:** Every position stored in scene JSON is in **grid coordinate space** (0-based, relative to terrain origin). The consumer is responsible for converting to world coordinates at load time using `terrain_aabb`.

This decouples the exported scene data from the terrain's absolute world position.

---

## Part 1: Standardize the C++ Loader

### 1.1 Scene JSON Entity Coordinate Status

| Entity | Current Load Type | Conversion Today | Change Needed |
|--------|-------------------|------------------|---------------|
| Game Objects | `GridPos` | `coord::to_world()` in gs_scene_loader:99 | None |
| Player | `GridPos` | `coord::to_world()` in gs_scene_loader | None |
| VFX Instances | `GridPos` | `coord::to_world()` in gs_scene_loader:439 | None |
| Particle Emitters | `glm::vec3` | `coord::to_world(GridPos(...))` in gs_scene_loader:361 | Type annotation only |
| GS Animations | `glm::vec3` | `coord::to_world(GridPos(...))` in gs_scene_loader:369 | Type annotation only |
| **Lights** | `glm::vec3` | Inline `+= terrain_aabb.min.x/y` in gs_scene_loader:335-336 | Migrate to `coord::to_world()` |
| **Camera Zones** | `glm::vec3` | `shape_to_world()` in camera_review_state.cpp:22-28 | Move to gs_scene_loader |
| **Camera Rails** | `glm::vec3` | `coord::to_world()` in camera_review_state.cpp:72-73 | Move to gs_scene_loader |
| **Camera Triggers** | `glm::vec3` | `shape_to_world()` in camera_review_state.cpp:54 | Move to gs_scene_loader |

### 1.2 Changes to `scene_loader.cpp` (parsing)

No changes needed. The parser already loads positions as raw vec3 from JSON. The coordinate space interpretation happens at the consumer level (gs_scene_loader).

### 1.3 Changes to `gs_scene_loader.cpp` (conversion)

**Lights (lines 331-338):** Replace the inline offset with `coord::to_world()`.

Before:
```cpp
for (const auto& pl : scene_data.static_lights) {
    PointLight t = pl;
    t.position_and_radius.x += ctx.terrain.terrain_aabb.min.x;
    t.position_and_radius.z += ctx.terrain.terrain_aabb.min.y;
    gs_lights.push_back(t);
}
```

After:
```cpp
for (const auto& pl : scene_data.static_lights) {
    PointLight t = pl;
    // Light internal layout: {x, z, y_height, radius} (swizzled in scene_loader.cpp:354)
    // Apply ground-plane offset only (XZ). Height (Y) is unaffected because
    // terrain_aabb.min.y is the vertical floor which lights are already relative to.
    glm::vec3 grid_pos(t.position_and_radius.x, 0.0f, t.position_and_radius.y);
    auto world = coord::to_world(coord::GridPos(grid_pos), ctx.terrain.terrain_aabb);
    t.position_and_radius.x = world.vec().x;
    t.position_and_radius.y = world.vec().z;  // internal slot 1 = world Z
    // Slot 2 (height) stays unchanged — already in correct local space
    gs_lights.push_back(t);
}
```

> **Note:** The light position layout `{x, z, y_height, radius}` is a swizzled internal format (scene_loader.cpp:354 swaps y↔z on load). The AABB ground-plane offset applies to x and z only. Height remains untouched because it's relative to the terrain surface, not to world origin. If a future terrain has non-zero `terrain_aabb.min.y` (floating terrain), the height field would need adjustment — but this is not a current scenario.

**Camera Zones, Rails, Triggers:** Add a conversion pass in `GsSceneLoader::load()` that converts all camera zone geometry from grid to world BEFORE storing in `SceneObjectState`. This centralizes the conversion and removes the burden from `CameraReviewState`.

New code in gs_scene_loader.cpp (after terrain AABB is set):
```cpp
// Convert camera zone coordinates Grid→World (centralized)
if (scene_data.camera_zones) {
    auto& cz = ctx.scene_objects.camera_zones;
    cz = *scene_data.camera_zones;
    for (auto& [name, vol] : cz.volumes) {
        vol.shape = shape_to_world(vol.shape, ctx.terrain.terrain_aabb);
    }
    for (auto& [name, rail] : cz.rails) {
        for (auto& pt : rail.path.control_points)
            pt = coord::to_world(coord::GridPos(pt), ctx.terrain.terrain_aabb).vec();
        if (rail.has_target_path) {
            for (auto& pt : rail.target_path.control_points)
                pt = coord::to_world(coord::GridPos(pt), ctx.terrain.terrain_aabb).vec();
        }
    }
    for (auto& trigger : cz.triggers) {
        trigger.shape = shape_to_world(trigger.shape, ctx.terrain.terrain_aabb);
    }
}
```

**Impact on `CameraReviewState`:** `load_zone_data()` and `activate()` no longer need to perform Grid→World conversion — they receive pre-converted world-space data. The `shape_to_world()` helper moves to a shared location (e.g., `coordinate.hpp` or remains as a static in gs_scene_loader.cpp).

### 1.4 Type Safety (Documentation, not code change)

The raw `glm::vec3` in `SceneData` structs (emitter positions, animation centers, camera zone centers) represents **GridPos** per the contract. We do NOT wrap every `glm::vec3` field in a `GridPos` type because:
- Many structs are shared between pre-conversion (grid) and post-conversion (world) contexts
- Adding GridPos wrappers to `CameraVolume`, `GsEmitterConfig`, `GsAnimRegion`, `PointLight` would require duplicating these structs or adding a coordinate-space template parameter — too invasive for the value

Instead: add a doc comment to `SceneData` in `scene_loader.hpp`:
```cpp
/// All positions in SceneData are in Grid coordinate space (0-based, relative
/// to terrain origin). Consumers must call coord::to_world() with the terrain
/// AABB before using positions for rendering or physics.
struct SceneData { ... };
```

---

## Part 2: Terrain AABB Delivery to Bricklayer

### 2.1 Evaluation of Approaches

| Approach | Pros | Cons |
|----------|------|------|
| **A. Bake into GSVX v2 header** | Zero runtime cost; works offline (no engine needed); single source of truth | Format version bump; need to re-cook existing assets |
| **B. Bridge query (get_terrain_info)** | No format change; always fresh | Requires Staging running; adds latency |
| **C. Parse PLY header in Bricklayer** | No engine dependency | Already parses full PLY for point cloud — just expose bounds |
| **D. Store in scene.json** | Trivial to read | Redundant; can drift from actual PLY bounds |

### 2.2 Recommended: Dual path (A + C)

**Primary (immediate):** Option C — Bricklayer already parses the terrain PLY in `PlyPointCloud.tsx` to render the point cloud. During that parse, compute min/max bounds from the position data and expose them via a callback. This is zero additional memory (the positions are already in memory during parse) and negligible extra CPU (one min/max pass over the positions array that's already being filled).

**Secondary (future optimization):** Option A — Bake AABB into GSVX v2 header so Bricklayer can read just 48 bytes to get bounds without parsing the full PLY. This matters when we switch terrain rendering to .gsvx. Not needed for this PR.

**Why NOT bridge query:** Bricklayer must show the correct viewport offset even when Staging is not connected. The preview should be spatially correct standalone.

### 2.3 Implementation: PLY Bounds Extraction

Modify `parsePlyBuffer()` in `PlyPointCloud.tsx` to also return AABB:

```typescript
interface PlyParseResult {
  positions: Float32Array;
  colors: Float32Array;
  aabb: { min: [number, number, number]; max: [number, number, number] };
}

function parsePlyBuffer(buffer: ArrayBuffer): PlyParseResult | null {
  // ... existing parsing ...
  
  // Compute AABB during the existing vertex loop (no extra pass)
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  
  for (let i = 0; i < vertexCount; i++) {
    const off = i * stride;
    const x = dataView.getFloat32(off + xProp.offset, true);
    const y = dataView.getFloat32(off + yProp.offset, true);
    const z = dataView.getFloat32(off + zProp.offset, true);
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    // ... colors ...
  }
  
  return {
    positions, colors,
    aabb: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] }
  };
}
```

### 2.4 Store the AABB

Add to `useSceneStore`:
```typescript
terrainAabb: { min: [number, number, number]; max: [number, number, number] } | null;
setTerrainAabb: (aabb: { min: [number, number, number]; max: [number, number, number] } | null) => void;
```

`TerrainPlyReference` (or `PlyPointCloud`) calls `setTerrainAabb()` after parsing.

### 2.5 Future: GSVX v2 Header (out of scope for this PR)

When terrain rendering migrates to .gsvx, bump the version and store bounds in the reserved 16 bytes:

```
Offset  Size  Field
──────  ────  ──────────────
0       4     magic "GSVX"
4       4     version = 2
8       4     count
12      4     flags (bit 0 = has_bounds)
16      12    bounds_min [x, y, z] as float32
28      4     reserved (pad to 32)
```

Wait — 12 bytes for min leaves only 4 for max. Better: extend header to 56 bytes (16-byte aligned after 48 isn't ideal). Actually, we can use flags bit 0 to indicate "bounds follow payload" as a trailer, keeping header at 32 bytes. **Defer this decision to the GSVX v2 PR.**

---

## Part 3: Bricklayer Viewport Offset (Option A)

### 3.1 The Offset

Once `terrainAabb` is available in the store, Bricklayer's viewport must offset all entity markers by `terrain_aabb.min` to match Staging's world-space rendering.

The terrain PLY point cloud is already rendered at its native positions (which ARE world space — the PLY contains world-space coordinates). So the point cloud is correct. The problem is that **editor entities** (game objects, camera zones, lights) are stored/edited in grid space but the terrain backdrop is in world space.

Two approaches:
- **A.** Offset entity markers by `+terrain_aabb.min` (entities move to world space)
- **B.** Offset the terrain PLY by `-terrain_aabb.min` (terrain moves to grid space)

**Choice: Option B — shift the terrain to grid space.** Rationale:
- Bricklayer is a grid-space editor. All positions in the store are grid coords.
- Gizmo manipulations (drag to move) should produce grid coordinates directly.
- Shifting the terrain PLY display by `-aabb.min` means the PLY aligns with grid-space entities.
- No need to convert coordinates on every entity render or gizmo interaction.
- Fewer components need modification (just `TerrainPlyReference`).

### 3.2 Implementation

**`TerrainPlyReference.tsx`:** Apply negative AABB offset to the terrain group:

```tsx
export function TerrainPlyReference() {
  const terrainPlyFile = useSceneStore((s) => s.terrainPlyFile);
  const projectHandle = useSceneStore((s) => s.projectHandle);
  const visible = useSceneStore((s) => s.showTerrainPly);
  const terrainAabb = useSceneStore((s) => s.terrainAabb);

  if (!terrainPlyFile) return null;

  // Shift terrain from world space to grid space for viewport alignment
  const offset: [number, number, number] = terrainAabb
    ? [-terrainAabb.min[0], -terrainAabb.min[1], -terrainAabb.min[2]]
    : [0, 0, 0];

  return (
    <group position={offset}>
      <PlyPointCloud
        plyPath={terrainPlyFile}
        projectHandle={projectHandle}
        visible={visible}
        pointSize={2.5}
        opacity={1.0}
      />
    </group>
  );
}
```

### 3.3 Orbit Camera Target

Currently: `target={[gridWidth / 2, 0, gridDepth / 2]}` (Viewport.tsx:331)

This is the grid center, which is correct in grid space. With the terrain shifted to grid space, the orbit target naturally aligns with the terrain center. **No change needed** for the default orbit target — it's already in grid space.

However, for terrains that don't start at grid origin (rare but possible), compute the center from AABB extent:

```typescript
const orbitTarget = terrainAabb
  ? [(terrainAabb.max[0] - terrainAabb.min[0]) / 2,
     0,
     (terrainAabb.max[2] - terrainAabb.min[2]) / 2]
  : [gridWidth / 2, 0, gridDepth / 2];
```

### 3.4 Export Unchanged

Bricklayer's scene export (`sceneExport.ts`) already exports positions as grid coordinates. No change needed — the contract is already correct on the export side.

---

## Part 4: Summary of Changes

### C++ (Engine)

| File | Change |
|------|--------|
| `src/engine/gs_scene_loader.cpp` | Migrate light offset to `coord::to_world()`; add centralized camera zone/rail/trigger conversion |
| `src/staging/camera_review_state.cpp` | Remove `shape_to_world()` calls — zones arrive pre-converted |
| `include/gseurat/engine/scene_loader.hpp` | Add doc comment: "all SceneData positions are GridPos" |

### TypeScript (Bricklayer)

| File | Change |
|------|--------|
| `tools/apps/bricklayer/src/viewport/PlyPointCloud.tsx` | Compute AABB during PLY parse; expose via callback |
| `tools/apps/bricklayer/src/store/useSceneStore.ts` | Add `terrainAabb` state + setter |
| `tools/apps/bricklayer/src/viewport/TerrainPlyReference.tsx` | Apply `-aabb.min` offset to terrain group |
| `tools/apps/bricklayer/src/viewport/Viewport.tsx` | Optionally derive orbit target from terrain extent |

### Not Changed

- Scene JSON format (already stores GridPos)
- `sceneExport.ts` (already exports GridPos)
- GSVX format (v2 header deferred to follow-up)
- Bridge protocol (no new commands needed for this PR)

---

## Testing

1. **Unit test:** Verify `coord::to_world()` produces correct results for lights (accounting for the {x, z, y, r} layout)
2. **Integration test:** Load island_demo scene in Staging, verify all entities appear at same positions as before (regression)
3. **Visual comparison:** Open same scene in Bricklayer + Staging side-by-side; camera zones, game objects, and terrain should now align
4. **Game Director:** Run `python3 scripts/game_director.py visual_state` to capture Staging state; compare entity positions with Bricklayer's exported JSON + terrain_aabb offset
5. **Edge case:** Scene with no terrain PLY (terrainAabb = null) — should render identically to current behavior (no offset)

---

## Follow-up (separate PRs)

1. **GSVX v2 header** — bake AABB into binary format for zero-parse bounds access
2. **Live camera sync (Option B)** — bridge Bricklayer viewport camera to Staging in real-time
3. **Bridge terrain_info command** — engine reports terrain metadata after load (useful for validation)
