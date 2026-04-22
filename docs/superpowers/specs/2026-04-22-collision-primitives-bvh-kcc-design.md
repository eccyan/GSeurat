# 3D Collision System — Spec 1: Primitives, BVH, KCC

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the 2D CollisionGrid with a 3D primitive collider system backed by a static BVH, and rewrite the Kinematic Character Controller to use continuous gravity, capsule sweeps, and wall sliding.

**Scope:** Engine-side only (Phases 1-3 of the full collision revamp). No Bricklayer UI, no bridge commands, no migration tooling. Those are deferred to Spec 2.

**Architecture:** Hybrid ECS + cached CollisionWorld. Colliders are ECS components (`ColliderComponent`) for serialization and inspector support. A `CollisionSystem` maintains packed `ColliderInstance` caches and a static BVH for fast queries. The KCC queries the `CollisionSystem`, never the ECS directly.

---

## 1. Primitive Geometry

### 1.1 Data Types

New file: `include/gseurat/engine/collision/primitive.hpp`

```cpp
#pragma once

#include <glm/glm.hpp>
#include <glm/gtc/quaternion.hpp>
#include <variant>
#include <cstdint>

namespace gseurat {

enum class ColliderType : uint8_t { Box, Sphere, Capsule };

struct BoxData {
    glm::vec3 half_extents{0.5f};
};

struct SphereData {
    float radius{0.5f};
};

struct CapsuleData {
    float radius{0.3f};
    float half_height{0.5f};  // Half the cylinder segment length
    // Total capsule height = 2 * half_height + 2 * radius
};

using ColliderShape = std::variant<BoxData, SphereData, CapsuleData>;

struct AABB {
    glm::vec3 min{0.0f};
    glm::vec3 max{0.0f};

    glm::vec3 center() const { return (min + max) * 0.5f; }
    glm::vec3 extents() const { return (max - min) * 0.5f; }
    uint32_t longest_axis() const {
        glm::vec3 e = extents();
        if (e.x >= e.y && e.x >= e.z) return 0;
        return (e.y >= e.z) ? 1 : 2;
    }
};

struct RayHit {
    float t;             // Distance along ray
    glm::vec3 point;     // World-space contact point
    glm::vec3 normal;    // Surface normal at contact
};

struct Contact {
    glm::vec3 point;     // World-space contact point
    glm::vec3 normal;    // Push-out direction (toward capsule)
    float depth;         // Penetration depth
};

struct SweepHit {
    float t;             // Fraction of sweep distance [0, 1]
    glm::vec3 point;     // World-space contact point
    glm::vec3 normal;    // Surface normal at contact
};

}  // namespace gseurat
```

### 1.2 Intersection Functions

New file: `include/gseurat/engine/collision/intersect.hpp`
Implementation: `src/engine/collision/intersect.cpp`

Six categories of free functions in `namespace gseurat`:

**1. AABB computation:**
```cpp
AABB compute_aabb(const BoxData& box, const glm::vec3& pos, const glm::quat& rot);
AABB compute_aabb(const SphereData& sphere, const glm::vec3& pos, const glm::quat& rot);
AABB compute_aabb(const CapsuleData& capsule, const glm::vec3& pos, const glm::quat& rot);
AABB compute_aabb(const ColliderShape& shape, const glm::vec3& pos, const glm::quat& rot);
```

Box AABB: rotate each half-extent axis by `rot`, take absolute values, sum for expanded half-extents. Sphere: `pos - radius` to `pos + radius`. Capsule: transform two hemisphere centers by rotation, expand by radius.

**2. AABB-AABB overlap:**
```cpp
bool aabb_overlaps(const AABB& a, const AABB& b);
```

**3. Ray-primitive intersection:**
```cpp
std::optional<RayHit> ray_intersect(
    const glm::vec3& origin, const glm::vec3& direction,
    const ColliderShape& shape, const glm::vec3& pos, const glm::quat& rot);
```

Dispatches to shape-specific implementations. Ray-sphere: quadratic formula. Ray-capsule: ray vs infinite cylinder + hemisphere caps. Ray-box (OBB): transform ray into box local space, then slab test.

**4. Capsule-primitive overlap + penetration:**
```cpp
std::optional<Contact> capsule_vs_box(
    const glm::vec3& cap_pos, const glm::quat& cap_rot, const CapsuleData& capsule,
    const glm::vec3& box_pos, const glm::quat& box_rot, const BoxData& box);

std::optional<Contact> capsule_vs_sphere(
    const glm::vec3& cap_pos, const glm::quat& cap_rot, const CapsuleData& capsule,
    const glm::vec3& sph_pos, const SphereData& sphere);

std::optional<Contact> capsule_vs_capsule(
    const glm::vec3& pos_a, const glm::quat& rot_a, const CapsuleData& a,
    const glm::vec3& pos_b, const glm::quat& rot_b, const CapsuleData& b);
```

Normal always points from primitive toward capsule (push-out direction).

Capsule-vs-box: find closest point on capsule segment to OBB (segment-OBB closest point), then check if distance < capsule radius. Capsule-vs-sphere: closest point on capsule segment to sphere center. Capsule-vs-capsule: closest point between two line segments.

**5. Capsule sweep:**
```cpp
std::optional<SweepHit> sweep_capsule(
    const glm::vec3& cap_pos, const glm::quat& cap_rot, const CapsuleData& capsule,
    const glm::vec3& direction, float max_distance,
    const ColliderShape& shape, const glm::vec3& pos, const glm::quat& rot);
```

Minkowski sum reduction: inflate the target primitive by capsule radius, then sweep the capsule's center-segment against the inflated shape. For sweep-vs-box: inflate box half-extents by capsule radius, add hemisphere caps at box edges, sweep the segment. For sweep-vs-sphere: inflate sphere radius, sweep segment.

**6. AABB-frustum test:**
```cpp
bool aabb_in_frustum(const AABB& aabb, const glm::vec4 planes[6]);
```

Half-plane test against 6 frustum planes. Returns true if AABB is at least partially inside.

### 1.3 What We're NOT Building

- No GJK/EPA — closed-form solutions for all three primitive types.
- No sphere-vs-box or box-vs-box overlap — only capsule-vs-primitive (character is always capsule).
- No continuous collision detection (CCD) beyond the capsule sweep.

---

## 2. ECS Components

### 2.1 ColliderComponent

New file: `include/gseurat/engine/ecs/components/collider_component.hpp`

```cpp
#pragma once

#include "gseurat/engine/collision/primitive.hpp"
#include <glm/gtc/quaternion.hpp>

namespace gseurat {

struct ColliderComponent {
    ColliderShape shape{SphereData{0.5f}};
    glm::vec3 offset{0.0f};                // Local offset from entity Transform
    glm::quat local_rotation{1, 0, 0, 0};  // Local rotation (identity default)
    uint32_t collision_mask{0xFFFFFFFF};
    bool is_trigger{false};                 // Overlap-only (no physics push-out)
    bool is_dynamic{false};                 // Routes to dynamic list (per-frame sync)
};

}  // namespace gseurat
```

### 2.2 JSON Serialization

Registered in `app_base.cpp` via `ComponentRegistry`:

```cpp
component_registry_.register_component<ColliderComponent>("ColliderComponent",
    collider_from_json, collider_to_json);
```

JSON format:
```json
{
  "ColliderComponent": {
    "shape": { "type": "box", "half_extents": [2, 0.5, 2] },
    "offset": [0, -0.25, 0],
    "local_rotation": [0, 0, 0, 1],
    "collision_mask": 4294967295,
    "is_trigger": false,
    "is_dynamic": false
  }
}
```

The `shape` field uses a tagged object:
- `{"type": "box", "half_extents": [x, y, z]}`
- `{"type": "sphere", "radius": r}`
- `{"type": "capsule", "radius": r, "half_height": h}`

Unknown `type` strings fall back to `SphereData{0.5f}`. Missing fields use component defaults.

### 2.3 Schema Extension

Add `ColliderComponent` to the `components` definition in `scene.schema.json`:

```json
"ColliderComponent": {
  "type": "object",
  "properties": {
    "shape": {
      "type": "object",
      "properties": {
        "type": { "type": "string", "enum": ["box", "sphere", "capsule"] },
        "half_extents": { "$ref": "#/$defs/vec3" },
        "radius": { "type": "number", "minimum": 0 },
        "half_height": { "type": "number", "minimum": 0 }
      },
      "required": ["type"]
    },
    "offset": { "$ref": "#/$defs/vec3" },
    "local_rotation": { "$ref": "#/$defs/vec4" },
    "collision_mask": { "type": "integer", "default": 4294967295 },
    "is_trigger": { "type": "boolean", "default": false },
    "is_dynamic": { "type": "boolean", "default": false }
  }
}
```

### 2.4 KinematicBody Component

New file: `include/gseurat/engine/ecs/components/kinematic_body.hpp`

```cpp
#pragma once

#include <glm/glm.hpp>

namespace gseurat {

struct KinematicBody {
    glm::vec3 velocity{0.0f};
    float gravity_scale{1.0f};            // Multiplier on world gravity
    bool grounded{false};                  // Set by CollisionSystem each frame
    glm::vec3 ground_normal{0, 1, 0};     // Normal of surface we're standing on

    // Designer-facing jump parameters (source of truth)
    float desired_jump_height{2.0f};       // World units
    float time_to_apex{0.4f};              // Seconds

    // Derived at load / parameter change
    float derived_gravity{0.0f};           // 2h / t^2
    float derived_jump_velocity{0.0f};     // 2h / t

    void recompute_derived() {
        if (time_to_apex > 0.0f) {
            derived_gravity = (2.0f * desired_jump_height) / (time_to_apex * time_to_apex);
            derived_jump_velocity = 2.0f * desired_jump_height / time_to_apex;
        }
    }
};

}  // namespace gseurat
```

Registered via `ComponentRegistry`. JSON format:
```json
{
  "KinematicBody": {
    "gravity_scale": 1.0,
    "desired_jump_height": 2.0,
    "time_to_apex": 0.4
  }
```

`velocity`, `grounded`, `ground_normal`, and derived fields are runtime-only — not serialized.

### 2.5 PlayerJump Deprecation

The existing `PlayerJump` component (parabolic arc with `height`, `duration`, `active`, `timer`) is removed. Its designer-facing parameters (`height` → `desired_jump_height`, `duration/2` → `time_to_apex`) migrate to `KinematicBody`. The parabolic arc calculation in `island_demo_state.cpp` is replaced by physics-based velocity in the KCC.

---

## 3. CollisionSystem

### 3.1 ColliderInstance (Internal Cache)

```cpp
struct ColliderInstance {
    ecs::Entity entity;            // Back-reference to ECS entity
    uint32_t collider_index;       // Which collider on that entity (future multi-collider)
    glm::vec3 world_position;      // Baked: Transform.position + offset
    glm::quat world_rotation;      // Baked: Transform.rotation * local_rotation
    ColliderShape shape;            // Copied from ColliderComponent
    AABB world_aabb;               // Pre-computed for BVH / broad-phase
    uint32_t collision_mask;
    bool is_trigger;
};
```

### 3.2 System Class

New file: `include/gseurat/engine/collision/collision_system.hpp`
Implementation: `src/engine/collision/collision_system.cpp`

```cpp
class CollisionSystem {
public:
    // ── Configuration ──────────────────────────────────────────────
    float world_gravity{20.0f};
    float skin_width{0.01f};
    float ground_probe_distance{0.1f};
    float ground_angle_cos{0.707f};      // cos(45deg)
    uint32_t max_slide_iterations{1};
    float jump_cut_multiplier{0.5f};

    // ── Cache management ───────────────────────────────────────────
    void rebuild_cache(ecs::World& world);  // Full rebuild from ECS
    void sync_dynamics(ecs::World& world);  // Per-frame transform sync for dynamics
    void mark_dirty();

    // ── Queries ────────────────────────────────────────────────────
    struct SweepResult {
        SweepHit hit;
        ecs::Entity entity;
        bool is_trigger;
    };

    struct OverlapResult {
        ecs::Entity entity;
        bool is_trigger;
    };

    std::optional<SweepResult> sweep(
        const glm::vec3& pos, const glm::quat& rot,
        const CapsuleData& capsule,
        const glm::vec3& direction, float max_distance,
        uint32_t mask) const;

    std::vector<OverlapResult> overlap_aabb(const AABB& query, uint32_t mask) const;

    std::optional<RayHit> raycast(
        const glm::vec3& origin, const glm::vec3& direction,
        float max_dist, uint32_t mask) const;

    // ── Per-frame update ───────────────────────────────────────────
    void update(ecs::World& world, float dt);

private:
    std::vector<ColliderInstance> static_cache_;
    std::vector<ColliderInstance> dynamic_cache_;
    std::vector<BVHNode> bvh_nodes_;
    bool dirty_{true};

    void rebuild_bvh();
    void run_kcc(ecs::World& world, float dt);
};
```

### 3.3 Cache Rebuild

`rebuild_cache(world)`:
1. Clear `static_cache_` and `dynamic_cache_`
2. Query `world.view<Transform, ColliderComponent>()`
3. For each entity, bake world transform, compute AABB, push to appropriate cache based on `is_dynamic`
4. Call `rebuild_bvh()` (over `static_cache_` only)
5. Clear `dirty_`

### 3.4 Dynamic Sync

`sync_dynamics(world)`:
1. For each entry in `dynamic_cache_`, fetch current `Transform` and `ColliderComponent` from ECS
2. Re-bake `world_position`, `world_rotation`, `world_aabb`
3. Runs every frame before KCC queries — no BVH rebuild

### 3.5 Update Loop

`update(world, dt)`:
1. If `dirty_`: `rebuild_cache(world)`
2. `sync_dynamics(world)` (always, even if not dirty)
3. `run_kcc(world, dt)` — processes all `KinematicBody` entities

### 3.6 Query Flow

`sweep(pos, rot, capsule, direction, distance, mask)`:
1. Compute swept AABB = union of capsule AABB at start and end positions
2. Broad-phase: traverse BVH (`bvh_nodes_`), collect `static_cache_` indices whose AABBs overlap swept AABB
3. Broad-phase: linear scan `dynamic_cache_`, same AABB overlap test
4. Narrow-phase: for each candidate, apply `collision_mask` filter, then `sweep_capsule()` from `intersect.hpp`
5. Return closest hit (smallest `t`)

`overlap_aabb(query, mask)`: same broad+narrow but returns all overlapping instances.

`raycast(origin, direction, max_dist, mask)`: BVH traversal with ray-AABB slab test, narrow-phase `ray_intersect`, return closest.

---

## 4. BVH Construction & Queries

### 4.1 Node Structure

Part of `include/gseurat/engine/collision/bvh.hpp`:

```cpp
struct BVHNode {
    AABB bounds;
    uint32_t left;       // Internal: left child index. Leaf: first collider index.
    uint32_t right;      // Internal: right child index. Leaf: collider count.
    bool is_leaf{false};
};
```

Tree stored as flat `std::vector<BVHNode>`. Leaf nodes reference ranges in `static_cache_`.

### 4.2 Construction

Top-down recursive, longest-axis median split:

1. Compute parent AABB encompassing all colliders in range `[begin, end)`
2. If count <= `MAX_LEAF_SIZE` (4): create leaf node, return
3. Split axis = `parent_aabb.longest_axis()`
4. `std::ranges::nth_element` by center coordinate on split axis → O(n) median selection
5. Create internal node with left = build(begin, mid), right = build(mid, end)

Build reorders `static_cache_` in-place so leaf ranges are contiguous in memory.

### 4.3 AABB Query

```cpp
void BVH::query_aabb(const AABB& query, std::vector<uint32_t>& out) const;
```

Stack-based iterative traversal:
1. Push root index
2. Pop. If `query` doesn't overlap `node.bounds`, skip
3. Leaf: append collider indices `[left, left + right)` to output
4. Internal: push left and right children

### 4.4 Raycast Query

```cpp
std::optional<std::pair<uint32_t, float>> BVH::raycast(
    const glm::vec3& origin, const glm::vec3& inv_dir,
    float max_t) const;
```

Stack traversal with ray-AABB slab test. Tracks closest `t`, prunes branches whose AABB entry distance exceeds current best. Returns collider index + `t` of closest hit (narrow-phase done by caller).

---

## 5. Kinematic Character Controller

### 5.1 Overview

The KCC runs inside `CollisionSystem::run_kcc()` for each entity with `Transform + KinematicBody + ColliderComponent` where the collider shape is `CapsuleData`.

### 5.2 Per-Frame Steps

**Step 1 — Apply gravity:**
```
if (velocity.y > 0):
    velocity.y -= body.derived_gravity * dt     // Jump ascent (designer-tuned)
else if (!grounded):
    velocity.y -= world_gravity * gravity_scale * dt  // Fall (fast-fall feel)
else if (grounded && velocity.y < 0):
    velocity.y = 0
```

**Step 2 — Horizontal sweep (XZ):**
```
h_delta = vec3(velocity.x, 0, velocity.z) * dt
if length(h_delta) > epsilon:
    hit = sweep(position, capsule, normalize(h_delta), length(h_delta), mask)
    if hit (and not trigger):
        position += direction * max(hit.t - skin_width, 0)
        wall_hit = hit
    else:
        position += h_delta
```

**Step 3 — Wall sliding:**
```
if wall_hit:
    remaining = h_delta * (1 - wall_hit.t)
    projected = remaining - dot(remaining, wall_hit.normal) * wall_hit.normal
    if length(projected) > epsilon:
        slide_hit = sweep(position, capsule, normalize(projected), length(projected), mask)
        if slide_hit:
            position += normalize(projected) * max(slide_hit.t - skin_width, 0)
        else:
            position += projected
    // Project velocity for next frame
    vel_xz = vec3(velocity.x, 0, velocity.z)
    vel_xz -= dot(vel_xz, wall_hit.normal) * wall_hit.normal
    velocity.x = vel_xz.x; velocity.z = vel_xz.z
```

Single slide iteration. If slide sweep also hits (corner), character stops.

**Step 4 — Vertical sweep (Y):**
```
v_delta = vec3(0, velocity.y, 0) * dt
if length(v_delta) > epsilon:
    hit = sweep(position, capsule, normalize(v_delta), length(v_delta), mask)
    if hit (and not trigger):
        position += direction * max(hit.t - skin_width, 0)
        if v_delta.y < 0:
            ground_hit = hit
        else:
            velocity.y = 0  // Hit ceiling
    else:
        position += v_delta
```

**Step 5 — Ground probe:**
```
probe = sweep(position, capsule, vec3(0,-1,0), ground_probe_distance, mask)
if probe and dot(probe.normal, vec3(0,1,0)) > ground_angle_cos:
    grounded = true
    ground_normal = probe.normal
    position.y -= max(probe.t - skin_width, 0)  // Snap to ground
else:
    grounded = false
    ground_normal = vec3(0, 1, 0)
```

**Step 6 — Write back:**
```
transform.position = position
body.velocity = velocity
body.grounded = grounded
body.ground_normal = ground_normal
```

### 5.3 Jump Input

Jump input is handled **outside** the KCC, in the player input system (existing `update_player` or a new `PlayerInputSystem`):

```
if jump_pressed and body.grounded:
    body.velocity.y = body.derived_jump_velocity
    body.grounded = false

if jump_released and body.velocity.y > 0:
    body.velocity.y *= jump_cut_multiplier  // Variable jump height
```

### 5.4 KCC Constants

| Constant | Default | Purpose |
|----------|---------|---------|
| `world_gravity` | 20.0 | Downward acceleration during fall |
| `skin_width` | 0.01 | Contact buffer to prevent float jitter |
| `ground_probe_distance` | 0.1 | Downward sweep to detect ground |
| `ground_angle_cos` | 0.707 | cos(45deg) — max slope for grounded |
| `max_slide_iterations` | 1 | Wall slide recursion depth |
| `jump_cut_multiplier` | 0.5 | Velocity damping on early jump release |

---

## 6. Registration & Integration

### 6.1 Component Registration

In `app_base.cpp`, alongside existing component registrations:

```cpp
component_registry_.register_component<ColliderComponent>("ColliderComponent",
    collider_from_json, collider_to_json);
component_registry_.register_component<KinematicBody>("KinematicBody",
    kinematic_body_from_json, kinematic_body_to_json);
```

### 6.2 System Registration

`CollisionSystem` is owned by the demo state (or `AppBase` for engine-level). It registers with `SystemScheduler`:

```cpp
scheduler_.add_system(SystemDecl{
    .name = "CollisionSystem",
    .fn = [this](ecs::World& w, float dt) { collision_system_.update(w, dt); },
    .reads = { /* Transform, ColliderComponent */ },
    .writes = { /* Transform, KinematicBody */ },
});
```

Must run **after** input systems (which set velocity from player input) and **before** rendering systems (which read final positions).

### 6.3 Scene Loading

When loading a scene with game objects that have `ColliderComponent`:
1. `ComponentRegistry` attaches `ColliderComponent` to entity
2. `CollisionSystem` detects dirty (new entities) and rebuilds cache + BVH on next `update()`
3. Entities with `KinematicBody` have `recompute_derived()` called after deserialization

### 6.4 Migration from update_player

The existing player movement code in `island_demo_state.cpp` (`update_player` function):

**Keep:** Input handling (WASD → velocity direction, camera-relative), facing angle computation, smooth acceleration blending.

**Remove:** Grid solidity check, Y-snap to `get_elevation()`, `PlayerJump` parabolic arc.

**Replace with:** Set `KinematicBody.velocity` from input, handle jump input (set `velocity.y`), let `CollisionSystem::update()` handle all physics.

The `CollisionGridRef` singleton entity is no longer created. `CollisionGrid` usage in `update_player` is eliminated.

---

## 7. File Layout

### New Files (Engine)

| File | Purpose |
|------|---------|
| `include/gseurat/engine/collision/primitive.hpp` | AABB, shapes, hit structs |
| `include/gseurat/engine/collision/intersect.hpp` | All intersection function declarations |
| `src/engine/collision/intersect.cpp` | Intersection implementations |
| `include/gseurat/engine/collision/bvh.hpp` | BVH node struct + query/build declarations |
| `src/engine/collision/bvh.cpp` | BVH construction + query implementations |
| `include/gseurat/engine/collision/collision_system.hpp` | CollisionSystem class |
| `src/engine/collision/collision_system.cpp` | CollisionSystem + KCC implementation |
| `include/gseurat/engine/ecs/components/collider_component.hpp` | ColliderComponent struct |
| `include/gseurat/engine/ecs/components/kinematic_body.hpp` | KinematicBody struct |

### Modified Files

| File | Changes |
|------|---------|
| `src/engine/app_base.cpp` | Register ColliderComponent + KinematicBody |
| `src/engine/scene_loader.cpp` | Parse ColliderComponent shape JSON |
| `schemas/scene.schema.json` | Add ColliderComponent schema |
| `src/demo/island_demo_state.cpp` | Replace update_player grid logic with KinematicBody input |
| `include/gseurat/engine/ecs/components/player_jump.hpp` | Deprecated / removed |
| `CMakeLists.txt` | Add new collision source files |

### Test Files

| File | Purpose |
|------|---------|
| `tests/test_primitive_aabb.cpp` | AABB computation for all shapes |
| `tests/test_intersect.cpp` | Ray, overlap, and sweep tests |
| `tests/test_bvh.cpp` | BVH build, AABB query, raycast query |
| `tests/test_collision_system.cpp` | Cache rebuild, sweep queries, trigger detection |
| `tests/test_kcc.cpp` | Gravity, ground detection, wall sliding, jump |
| `tests/test_collider_json.cpp` | Serialization round-trip |

---

## 8. Constraints

- No changes to camera zone, audio zone, or trigger system behavior.
- No ECS structural changes — uses existing `World`, `ComponentRegistry`, `SystemScheduler`.
- All new code in `namespace gseurat`.
- C++23 (`std::variant`, `std::ranges::nth_element`, `std::optional`).
- Existing scene JSON files without `ColliderComponent` continue to work unchanged. The old `CollisionGrid` data is still loaded and usable — removal is Spec 2.
- During the transition period, `island_demo_state.cpp` may maintain both code paths (grid fallback if no colliders present) to avoid breaking the demo.

---

## 9. Testing Strategy

1. **Primitive AABB tests:** Verify AABB computation for each shape type, including rotated OBBs.
2. **Intersection tests:** Ray-box, ray-sphere, ray-capsule. Capsule-vs-box, capsule-vs-sphere, capsule-vs-capsule. Capsule sweep vs each shape. Edge cases: tangent hits, zero-length sweeps, parallel rays.
3. **BVH tests:** Build with known collider positions, verify AABB query returns correct candidates, verify raycast returns closest hit.
4. **CollisionSystem tests:** Cache rebuild populates static/dynamic correctly. Sweep queries combine BVH + dynamic linear scan. Mark dirty triggers rebuild.
5. **KCC tests:** Gravity applies when not grounded. Ground probe detects floor. Wall sliding projects correctly. Jump velocity set correctly from derived params. Variable jump height (early release). Ceiling hit kills upward velocity.
6. **JSON round-trip:** ColliderComponent and KinematicBody serialize/deserialize correctly through ComponentRegistry.
7. **Integration test:** Game Director socket — spawn player above floor colliders, verify gravity pulls to ground, verify movement blocked by wall colliders.
8. **Build verification:** `cmake --build --preset macos-debug` succeeds with no new warnings.
