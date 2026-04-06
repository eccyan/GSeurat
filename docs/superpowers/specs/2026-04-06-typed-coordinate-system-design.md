# Typed Coordinate System Design

## Goal

Introduce compile-time coordinate space safety via `Position<Space>` template types, preventing bugs where positions in one coordinate system are silently used in another (e.g., the Grid/World mismatch fixed in PR #145).

## Background

GSeurat has multiple coordinate systems:

| Space | Origin | Used By |
|-------|--------|---------|
| **Grid** | 0-based, from Bricklayer/scene JSON | `SceneLoader`, `SceneData`, `GameObjectData` |
| **World** | PLY terrain AABB origin | Renderer, ECS, GS pipeline, physics |
| **CellIndex** | Integer grid indices scaled by `cell_size` | `CollisionGrid` lookups |
| **Local** | Per-object model origin | Game object PLY merge, PBD tagging |
| **Camera** | View space | GS parallax camera, Staging orbit camera |
| **Screen** | Pixel coordinates | UI, mouse input, minimap |

Currently all positions are `glm::vec3`. Conversions are manual `+=` of offset vectors with no compile-time enforcement. PR #145 was caused by using Grid positions in World context without applying `terrain_aabb_min_`.

## Architecture

### Hub-and-Spoke Through World

World is the canonical coordinate space. All conversions go through World:

```
Grid ↔ World ↔ Camera
                ↕
CellIndex ↔ World ↔ Screen
                ↕
Local ↔ World
```

No direct cross-space conversions (e.g., Grid → Screen). If needed, convert Grid → World → Screen in two explicit steps. This keeps the number of conversion functions linear (2 per space) and makes the conversion path obvious.

### Core Type: `Position<Space>`

```cpp
namespace gseurat::coord {

// Tag types — empty structs, zero runtime cost
struct Grid {};
struct World {};
struct CellIndex {};
struct Local {};
struct Camera {};
struct Screen {};

template <typename Space>
class Position {
public:
    Position() : v_(0.0f) {}
    explicit Position(glm::vec3 v) : v_(v) {}
    explicit Position(float x, float y, float z) : v_(x, y, z) {}

    const glm::vec3& vec() const { return v_; }
    glm::vec3& vec() { return v_; }

    float x() const { return v_.x; }
    float y() const { return v_.y; }
    float z() const { return v_.z; }

    // Same-space arithmetic only
    Position operator+(const Position& rhs) const { return Position(v_ + rhs.v_); }
    Position operator-(const Position& rhs) const { return Position(v_ - rhs.v_); }
    Position& operator+=(const Position& rhs) { v_ += rhs.v_; return *this; }
    Position& operator-=(const Position& rhs) { v_ -= rhs.v_; return *this; }

    bool operator==(const Position& rhs) const { return v_ == rhs.v_; }
    bool operator!=(const Position& rhs) const { return v_ != rhs.v_; }

private:
    glm::vec3 v_;
};

// Convenience aliases
using GridPos = Position<Grid>;
using WorldPos = Position<World>;
using CellPos = Position<CellIndex>;
using LocalPos = Position<Local>;
using CameraPos = Position<Camera>;
using ScreenPos = Position<Screen>;

} // namespace gseurat::coord
```

**Design decisions:**
- Constructor from `glm::vec3` is `explicit` — prevents accidental wrapping.
- `.vec()` accessor for interop with GLM math and Vulkan APIs.
- Cross-space arithmetic is a compile error (different template instantiations).
- Zero runtime overhead — same layout as `glm::vec3`.

### Conversion Functions

Free functions in `gseurat::coord` namespace. Each conversion takes the context needed for that transform.

#### Phase 1: Grid ↔ World and CellIndex ↔ World

```cpp
// Grid ↔ World: offset by terrain AABB min
WorldPos to_world(GridPos pos, const AABB& terrain_aabb);
GridPos  to_grid(WorldPos pos, const AABB& terrain_aabb);

// CellIndex ↔ World: scale by cell_size, offset by grid origin
WorldPos to_world(CellPos cell, const CollisionGrid& grid, const AABB& terrain_aabb);
CellPos  to_cell(WorldPos pos, const CollisionGrid& grid, const AABB& terrain_aabb);
```

**Grid → World** is `pos.vec() + terrain_aabb.min`.
**World → Grid** is `pos.vec() - terrain_aabb.min`.
**CellIndex → World** is `vec3(cell.x * cell_size, elevation, cell.z * cell_size) + terrain_aabb.min`.
**World → CellIndex** is `int((pos.x - terrain_aabb.min.x) / cell_size)`, etc.

#### Phase 2: Local ↔ World, Camera ↔ World, Screen ↔ World

```cpp
// Local ↔ World: apply/invert model transform matrix
WorldPos  to_world(LocalPos pos, const glm::mat4& model_transform);
LocalPos  to_local(WorldPos pos, const glm::mat4& inv_model_transform);

// Camera ↔ World: apply/invert view matrix
WorldPos  to_world(CameraPos pos, const glm::mat4& inv_view);
CameraPos to_camera(WorldPos pos, const glm::mat4& view);

// Screen ↔ World: apply/invert VP matrix + viewport dimensions
WorldPos  to_world(ScreenPos pos, const glm::mat4& inv_vp, uint32_t viewport_w, uint32_t viewport_h);
ScreenPos to_screen(WorldPos pos, const glm::mat4& vp, uint32_t viewport_w, uint32_t viewport_h);
```

These are declared in Phase 1 but implemented when their subsystems are migrated.

### AABB Offset Unification

Currently there are two separate offset mechanisms:
- `terrain_aabb_min_` (vec3) — for game objects
- `gs_aabb_offset_` (vec2, XY only) — for lights, emitters, animations, VFX

Both represent the same Grid → World conversion. After this change, both use the same `to_world(GridPos, AABB)` function. The `gs_aabb_offset_` member is removed; `terrain_aabb_min_` (or equivalently the stored `AABB`) is the single source of truth.

**Important:** The current `gs_aabb_offset_` applies only XY (mapping to XZ in world), while `terrain_aabb_min_` applies full XYZ. The unified conversion uses the full AABB min, which is the correct behavior (PR #145 proved Y-axis offset was also needed).

### PointLight Position Handling

`PointLight.position_and_radius` is a packed `glm::vec4` with swizzled components (`x=worldX, y=worldZ, z=height, w=radius`). This packed format stays as `glm::vec4` — it is a renderer-internal representation, not a coordinate in any of our defined spaces. The typed boundary is at the scene JSON level: light positions in `SceneData` are parsed as `GridPos`, then converted to `WorldPos` via `to_world()`, and finally packed into the swizzled `glm::vec4` when constructing the `PointLight` struct for the renderer.

### Migration Plan

#### Phase 1 (This PR)

Scope: Grid ↔ World and CellIndex ↔ World — the exact bug class from PR #145.

**New files:**
- `include/gseurat/engine/coordinate.hpp` — `Position<Space>`, tag types, all conversion declarations
- `src/engine/coordinate.cpp` — Phase 1 conversion implementations
- `tests/test_coordinate.cpp` — conversion correctness, round-trip, type distinction

**Modified files:**
- `include/gseurat/engine/scene_loader.hpp` — `GameObjectData.position` becomes `coord::GridPos`, other position fields in `SceneData` (emitters, animations, VFX, lights, portals, player) become `coord::GridPos`
- `src/engine/scene_loader.cpp` — parse into `GridPos` instead of `glm::vec3`
- `include/gseurat/engine/app_base.hpp` — remove `gs_aabb_offset_`, store `AABB terrain_aabb_` instead of `terrain_aabb_min_`, `scene_game_object_data_` positions become `coord::WorldPos`
- `src/engine/app_base.cpp` — replace manual `+= terrain_aabb_min_` / `+= gs_aabb_offset_` with `coord::to_world()` calls
- `include/gseurat/engine/ecs/default_components.hpp` — `Transform.position` becomes `coord::WorldPos`
- `src/demo/island_systems.cpp` — collision grid lookups use `coord::to_cell()`
- `tests/test_scene_loading.cpp` — update to use typed positions
- `tools/apps/bricklayer/src/lib/sceneExport.ts` — no change (TypeScript side stays as plain arrays)

**Removed:**
- `gs_aabb_offset_` member from `AppBase`
- All manual `+= aabb.min.x` / `+= aabb.min.y` offset arithmetic scattered through `app_base.cpp`

#### Phase 2 (Future PRs)

- `LocalPos` for game object PLY merge (PBD tagging, bone transforms)
- `CameraPos` for GS parallax and Staging orbit camera
- `ScreenPos` for UI hit testing, minimap rendering

### What This Catches at Compile Time

1. **PR #145 bug class:** Passing `GridPos` to an API expecting `WorldPos` (e.g., `ecs::Transform`, renderer) is a type error.
2. **Forgotten offset:** Using a `GridPos` from `SceneData` without converting is a compile error at any call site that expects `WorldPos`.
3. **Mixed offsets:** Adding a `GridPos` to a `WorldPos` is a compile error (cross-space arithmetic).
4. **Collision grid indexing:** Passing `WorldPos` directly to `get_elevation(uint32_t, uint32_t)` requires explicit `to_cell()` conversion.

### What This Does NOT Catch

- Incorrect AABB values (wrong terrain loaded) — runtime issue.
- Using the wrong AABB for conversion — same type, wrong data. Mitigated by storing one canonical AABB in AppBase.
- Swizzle bugs within a single coordinate space (e.g., XYZ component mixups in `PointLight`).

### Testing Strategy

1. **Unit tests (`test_coordinate.cpp`):**
   - Grid → World → Grid round-trip with known AABB
   - CellIndex → World → CellIndex round-trip
   - Verify offset arithmetic matches current manual logic
   - Edge cases: zero AABB, negative coordinates, fractional cell indices

2. **Migration tests (`test_scene_loading.cpp`):**
   - Existing Section 10 (AABB offset) rewritten with typed positions
   - Verify `SceneLoader::from_json()` returns `GridPos` values
   - Verify conversion produces same `WorldPos` as current manual arithmetic

3. **Compile-time safety (negative tests):**
   - Document expected compile errors in comments (e.g., `// GridPos p; WorldPos w = p; // ERROR: no implicit conversion`)
   - Cannot be automated in ctest, but serve as documentation

### Constraints

- `Position<Space>` must be trivially copyable (ECS archetype storage uses memcpy).
- Zero runtime overhead — `sizeof(Position<Space>) == sizeof(glm::vec3)` (12 bytes).
- `glm::vec3` has no virtual functions and standard layout; `Position<Space>` wrapping it preserves these properties.
- Phase 1 can be merged independently; Phase 2 is additive.
