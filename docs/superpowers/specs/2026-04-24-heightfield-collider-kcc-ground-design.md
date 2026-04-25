# Heightfield Collider & KCC Ground Detection

**Date:** 2026-04-24
**Status:** Approved
**Scope:** C++ Engine (`collision/`), Scene Schema, Offline Migration, Bricklayer Export

## Problem Statement

Ground detection in the island demo uses a legacy 2D `CollisionGrid::elevation[]` array — a flat per-cell float lookup baked into `scene.json`. This creates a split architecture: the new 3D `CollisionSystem` (BVH + Box/Sphere/Capsule primitives) handles walls, triggers, and raycasts, while ground snapping still runs through a separate code path in `island_demo_state::update_player()` that directly reads grid elevations.

This split has three consequences:

1. **The KCC cannot walk on 3D primitives.** Box ramps, boulders, and elevated platforms placed via `ColliderComponent` are invisible to the legacy ground-snapper. The player clips through them.
2. **Elevation data bloats scene JSON.** Thousands of floats in a JSON array create a parsing bottleneck at load time.
3. **Resolution is grid-locked.** One float per cell at `cell_size = 1.0` means terrain resolution is fixed at 1 world-unit, with no sub-unit detail or smooth slopes.

## Goals

- Unify ground detection under the 3D `CollisionSystem` so the KCC sweeps against terrain and primitives identically.
- Replace the JSON elevation array with a resolution-independent 16-bit PNG heightmap.
- Keep the `CollisionGrid` struct alive for `solid`, `nav_zone`, and `light_probe` (those migrate independently).
- Provide an offline migration script to convert existing elevation data to PNG.

## Non-Goals

- Migrating `solid` cells to primitive colliders (handled by existing `migrate_collision_grid.py`).
- Migrating `nav_zone` or `light_probe` to volumetric systems.
- GPU-side terrain rendering (this spec is collision-only).
- Multi-layer terrain (overhangs, caves). Single-layer heightfield only.

---

## Architecture

### 1. HeightfieldComponent (ECS)

A new ECS component, separate from `ColliderComponent`. Heightfields are fundamentally different from convex primitives: they are large, non-convex, and spatially extended. Forcing them into the `ColliderShape` `std::variant` would bloat the variant's memory footprint (which currently holds tiny POD structs) and ruin cache locality for every other physics calculation.

**Header:** `include/gseurat/engine/ecs/components/heightfield_component.hpp`

```cpp
struct HeightfieldData {
    std::vector<uint16_t> samples;   // Row-major height samples
    uint32_t img_width{0};           // Pixel columns
    uint32_t img_height{0};          // Pixel rows
};

struct HeightfieldComponent {
    std::string image_path;          // 16-bit PNG grayscale (relative to assets/)
    float width{100.0f};             // World-space X extent
    float length{100.0f};            // World-space Z extent
    float min_height{0.0f};          // World Y at pixel value 0
    float max_height{50.0f};         // World Y at pixel value 65535
    uint32_t collision_mask{0xFFFFFFFF};

    // Loaded at runtime (not serialized)
    HeightfieldData data;
    AABB world_aabb;                 // Computed from transform + extents
};
```

**Spatial mapping:** The heightmap stretches to fill the component's `width` x `length` footprint. The entity's `Transform::position` defines the min-corner (origin) of the heightfield in world space. Pixel resolution is decoupled from world size — swapping a 256x256 PNG for a 1024x1024 PNG changes fidelity without changing the terrain's physical footprint.

**Vertical mapping:** A raw uint16 sample `s` maps to world Y as:

```
world_y = min_height + (s / 65535.0) * (max_height - min_height)
```

### 2. Scene JSON Schema

```json
{
  "HeightfieldComponent": {
    "type": "object",
    "required": ["image_path", "width", "length", "min_height", "max_height"],
    "properties": {
      "image_path":     { "type": "string" },
      "width":          { "type": "number", "exclusiveMinimum": 0 },
      "length":         { "type": "number", "exclusiveMinimum": 0 },
      "min_height":     { "type": "number" },
      "max_height":     { "type": "number" },
      "collision_mask": { "type": "integer", "default": 4294967295 }
    }
  }
}
```

**Example scene entry:**

```json
{
  "name": "terrain",
  "components": {
    "Transform": { "position": [0, 0, 0] },
    "HeightfieldComponent": {
      "image_path": "assets/terrain/seurat_island_heightmap.png",
      "width": 200.0,
      "length": 200.0,
      "min_height": -5.0,
      "max_height": 40.0
    }
  }
}
```

### 3. CollisionSystem Integration

#### 3.1 Cache & BVH Registration

During `rebuild_cache()`, the system scans for `HeightfieldComponent` entities in addition to `ColliderComponent` entities. Each heightfield produces a single large AABB inserted into the master BVH.

**Index tagging:** The static cache and heightfield cache are separate vectors. BVH indices use contiguous ranges:

- `[0, N)` — primitive colliders (existing `static_cache_`)
- `[N, N+H)` — heightfield colliders (new `heightfield_cache_`)

When a BVH query returns a candidate index, the system checks which range it falls in and dispatches to the appropriate narrow-phase test. This avoids polluting `ColliderInstance` with heightfield concerns.

**New members on `CollisionSystem`:**

```cpp
std::vector<HeightfieldInstance> heightfield_cache_;

struct HeightfieldInstance {
    ecs::Entity entity;
    glm::vec3 origin;                // Transform position (min-corner)
    float width, length;
    float min_height, max_height;
    uint32_t collision_mask;
    const HeightfieldData* data;     // Non-owning pointer to component data
    AABB world_aabb;
};
```

#### 3.2 Elevation Query (Core Building Block)

```
sample_height(hf: HeightfieldInstance, world_x: float, world_z: float) -> optional<float>:
    u = (world_x - hf.origin.x) / hf.width
    v = (world_z - hf.origin.z) / hf.length
    if u < 0 or u > 1 or v < 0 or v > 1: return nullopt

    px = u * (hf.data.img_width - 1)
    pz = v * (hf.data.img_height - 1)

    // Bilinear interpolation of 4 surrounding texels
    ix = floor(px),  iz = floor(pz)
    fx = px - ix,    fz = pz - iz
    s00 = sample(ix,   iz  )
    s10 = sample(ix+1, iz  )
    s01 = sample(ix,   iz+1)
    s11 = sample(ix+1, iz+1)
    s = lerp(lerp(s00, s10, fx), lerp(s01, s11, fx), fz)

    return hf.min_height + (s / 65535.0) * (hf.max_height - hf.min_height)
```

#### 3.3 Surface Normal

At any point (x, z), compute via central differences over a small epsilon (half a texel in world space):

```
eps = hf.width / hf.data.img_width * 0.5
dx = sample_height(x + eps, z) - sample_height(x - eps, z)
dz = sample_height(x, z + eps) - sample_height(x, z - eps)
normal = normalize(-dx, 2 * eps, -dz)
```

This provides smooth normals that the KCC uses for the `ground_angle_cos` walkability check. The epsilon of half a texel prevents aliasing at cell boundaries.

### 4. Intersection Functions

All added to `include/gseurat/engine/collision/intersect.hpp`.

#### 4.1 `ray_vs_heightfield`

```
ray_vs_heightfield(origin, direction, hf) -> optional<RayHit>
```

1. Early-out if ray AABB misses heightfield AABB.
2. Clip ray entry/exit to heightfield XZ bounds.
3. **DDA grid traversal:** step through heightfield cells along the ray direction (Bresenham-style), one cell at a time.
4. At each cell, construct 2 triangles from the cell's 4 corner heights.
5. Test ray against each triangle (Moller-Trumbore).
6. Return the closest hit with interpolated surface normal.

**Cell triangulation:** Each cell `(cx, cz)` with corners at heights `h00, h10, h01, h11` splits into two triangles along the shorter diagonal (reduces thin-triangle artifacts).

#### 4.2 `capsule_vs_heightfield`

```
capsule_vs_heightfield(cap_pos, cap_rot, capsule, hf) -> optional<Contact>
```

1. Compute capsule's XZ footprint: segment endpoints (rotated Y-axis) expanded by `capsule.radius`.
2. Map footprint to heightfield grid cell range.
3. For each cell in range, generate 2 triangles.
4. Run `capsule_vs_triangle` for each triangle, collecting the deepest penetrating contact.
5. Return the deepest contact (push-out direction = triangle normal).

#### 4.3 `sweep_capsule_vs_heightfield` (Analytic)

```
sweep_capsule_vs_heightfield(cap_pos, cap_rot, capsule, direction, max_dist, hf)
    -> optional<SweepHit>
```

**Analytic triangle-gathering approach** (no discretized stepping):

1. Compute the **swept AABB** of the capsule's full movement vector (from t=0 to t=1).
2. Map the swept AABB's XZ footprint onto the heightfield grid to get a bounded integer cell range.
3. Iterate over that cell patch (typically 1-4 cells for per-frame player movement).
4. For each cell, generate its 2 triangles from corner heights.
5. Run analytic `sweep_capsule_vs_triangle` against each triangle.
6. Return the earliest valid hit fraction, contact point, and surface normal.

This is O(cells_covered) with exact time-of-impact — no tunneling, no binary search, no step-size tuning. Player movement per frame typically covers 1-4 cells, making this effectively O(1).

### 5. KCC Changes

**Zero changes to KCC logic.** The existing `run_kcc()` in `CollisionSystem` already does:

1. Horizontal capsule sweep → the heightfield is now a valid hit target (slopes block lateral movement)
2. Vertical capsule sweep → the heightfield blocks falling
3. Ground probe (downward sweep) → the heightfield returns ground contact with surface normal

The KCC remains completely agnostic to what it sweeps against. The heightfield is "just another shape" in the collision world.

**Legacy removal:** The manual ground-snapping code in `island_demo_state::update_player()` (lines 1092-1128) that reads `collision_grid_.get_elevation()` is deleted. The KCC handles ground detection natively.

### 6. Heightmap Loading

**File:** `src/engine/collision/heightfield_loader.cpp`

```cpp
HeightfieldData load_heightfield(const std::string& path);
```

- Uses `stb_image` (already a project dependency) to load 16-bit PNG.
- Validates: single channel, 16-bit depth, non-zero dimensions.
- Stores raw uint16 samples in row-major order.
- Called once during scene load, stored in the `HeightfieldComponent`.

---

## Offline Migration

### `scripts/migrate_elevation_to_png.py`

Converts existing `collision.elevation[]` arrays in scene JSON files to 16-bit PNG heightmaps. Same pattern as `migrate_collision_grid.py`.

**Pipeline:**

1. Scan all `*.json` scene files for `collision.elevation` arrays.
2. Read `collision.width`, `collision.height`, `collision.cell_size`.
3. Compute `min_elev` and `max_elev` from the float array.
4. Normalize each float to uint16: `pixel = round((elev - min_elev) / (max_elev - min_elev) * 65535)`.
5. Write 16-bit grayscale PNG to `assets/terrain/<scene_name>_heightmap.png`.
6. Inject a `HeightfieldComponent` game object into the scene JSON:
   - `image_path`: relative path to generated PNG
   - `width`: `collision.width * collision.cell_size`
   - `length`: `collision.height * collision.cell_size`
   - `min_height`: `min_elev`
   - `max_height`: `max_elev`
7. Strip `collision.elevation` from the JSON (retain `solid`, `nav_zone`, `light_probe`).
8. Print summary: files processed, PNG dimensions, height ranges.

**Dependencies:** Python `Pillow` for 16-bit PNG I/O.

### Bricklayer Export (Forward-Looking)

When Bricklayer exports a scene with terrain, it writes the heightmap PNG directly and references it via `HeightfieldComponent` in the scene JSON. No elevation arrays are generated going forward.

---

## Legacy Transition

The `CollisionGrid` struct is **not deleted**. It loses its `elevation` vector but retains:

| Field | Status | Future Migration |
|-------|--------|------------------|
| `elevation` | **Removed** by this spec (migrated to PNG heightfield) | — |
| `solid` | Retained | Migrates to primitive `ColliderComponent` boxes via `migrate_collision_grid.py` |
| `nav_zone` | Retained | Future: `NavZoneVolume` components |
| `light_probe` | Retained | Future: probe volumes or SH grid |

The demo's `update_player()` ground-snapping code path is deleted. All ground detection goes through the KCC's unified sweep.

---

## Test Plan

### Unit Tests: `test_heightfield_intersect.cpp`

| Test | Description |
|------|-------------|
| `ray_flat_plane` | Ray down onto flat heightfield, verify hit at expected Y |
| `ray_sloped_plane` | Ray onto 45-degree slope, verify hit point and normal |
| `ray_miss` | Ray parallel to terrain surface, verify no hit |
| `ray_grazing` | Near-parallel ray, verify stable hit detection |
| `capsule_on_flat` | Capsule resting on flat terrain, verify upward contact normal |
| `capsule_on_slope` | Capsule on slope, verify angled contact normal |
| `capsule_cliff_edge` | Capsule radius overlapping cliff edge, verify contact at edge |
| `sweep_onto_ramp` | Horizontal sweep onto rising terrain, verify hit fraction |
| `sweep_across_flat` | Horizontal sweep over flat terrain, verify no hit (capsule above surface) |
| `sweep_miss` | Sweep that doesn't intersect terrain, verify no hit |
| `normal_45_slope` | Verify computed normal on known 45-degree slope matches `(0, 0.707, -0.707)` |

### Integration Tests: `test_heightfield_kcc.py`

Via Game Director Unix socket:

| Test | Description |
|------|-------------|
| `kcc_grounded_on_terrain` | Spawn KCC on heightfield, verify `grounded == true` |
| `kcc_slope_tracking` | Walk KCC up slope, verify Y tracks heightfield elevation |
| `kcc_cliff_fall` | Walk KCC off cliff edge, verify `grounded == false` and gravity applies |
| `kcc_box_on_terrain` | Place box ramp on heightfield, verify KCC walks onto box (unified sweep) |
| `kcc_steep_rejection` | Walk KCC into steep slope (> 45 degrees), verify blocked and not grounded |

### Migration Tests: `test_migrate_elevation.py`

| Test | Description |
|------|-------------|
| `round_trip` | Generate PNG from known elevation array, load PNG, verify heights match within uint16 quantization tolerance (max error = height_range / 65535) |
| `output_format` | Verify output PNG is 16-bit grayscale, single channel |
| `json_cleanup` | Verify scene JSON no longer contains `elevation` array after migration |
| `component_injection` | Verify `HeightfieldComponent` appears in migrated scene JSON with correct extents |

### Performance Benchmark

| Metric | Target |
|--------|--------|
| `sweep_capsule_vs_heightfield` on 1024x1024 grid | < 5 microseconds per query |
| `sample_height` bilinear lookup | < 100 nanoseconds |
| Scene load time with PNG heightfield vs. JSON elevation array | Faster (binary decode vs. JSON float parsing) |

---

## Implementation Notes

### Backface Culling in `ray_vs_heightfield`

Triangles generated from heightfield cells are **single-sided** (normal pointing upward). Rays hitting the backface (fired from below the terrain toward the top) must be rejected — return no hit. This matches the single-layer terrain constraint and prevents the KCC from "snapping" to the underside of terrain if it somehow ends up beneath. Implementers should check `dot(ray_direction, triangle_normal) < 0` before accepting a hit.

### Heightmap Data Deduplication

In the MVP, each `HeightfieldComponent` owns its `HeightfieldData` (the `std::vector<uint16_t>` samples). If multiple terrain chunks reference the same PNG file, the image will be loaded and stored multiple times. This is acceptable for the initial implementation where scenes have a single terrain entity.

For future multi-chunk terrains, `load_heightfield()` should be structured to allow easy migration to `ResourceManager` caching (e.g., returning a `std::shared_ptr<HeightfieldData>` keyed by image path). The loader function signature and `HeightfieldComponent` storage should be designed with this transition in mind — use an indirection (`const HeightfieldData*` pointer in `HeightfieldInstance`, owned data in a cache) rather than embedding the vector directly in the component.

---

## File Manifest

| File | Action |
|------|--------|
| `include/gseurat/engine/ecs/components/heightfield_component.hpp` | **New** |
| `include/gseurat/engine/collision/heightfield_loader.hpp` | **New** |
| `src/engine/collision/heightfield_loader.cpp` | **New** |
| `include/gseurat/engine/collision/intersect.hpp` | **Modify** — add `ray_vs_heightfield`, `capsule_vs_heightfield`, `sweep_capsule_vs_heightfield`, `capsule_vs_triangle`, `sweep_capsule_vs_triangle` |
| `src/engine/collision/intersect.cpp` | **Modify** — implement heightfield intersection functions and triangle primitives |
| `include/gseurat/engine/collision/collision_system.hpp` | **Modify** — add `heightfield_cache_`, `HeightfieldInstance` |
| `src/engine/collision/collision_system.cpp` | **Modify** — scan `HeightfieldComponent` in `rebuild_cache()`, dispatch in `sweep()`/`raycast()`/`overlap_aabb()` |
| `src/engine/scene_loader.cpp` | **Modify** — deserialize `HeightfieldComponent`, call `load_heightfield()` |
| `schemas/scene.schema.json` | **Modify** — add `HeightfieldComponent` definition |
| `src/demo/island_demo_state.cpp` | **Modify** — remove manual elevation snapping from `update_player()` |
| `include/gseurat/engine/collision_gen.hpp` | **Modify** — remove `elevation` vector from `CollisionGrid` |
| `scripts/migrate_elevation_to_png.py` | **New** |
| `tests/test_heightfield_intersect.cpp` | **New** |
| `tests/test_heightfield_kcc.py` | **New** |
| `tests/test_migrate_elevation.py` | **New** |
