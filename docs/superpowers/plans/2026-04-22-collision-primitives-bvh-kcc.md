# 3D Collision System Implementation Plan (Spec 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 2D CollisionGrid with 3D primitive colliders, a static BVH, and a velocity-based Kinematic Character Controller.

**Architecture:** Hybrid ECS + cached CollisionWorld. ColliderComponent and KinematicBody are ECS components (source of truth). CollisionSystem maintains packed ColliderInstance caches (static + dynamic) and a static BVH. The KCC uses capsule sweeps for movement, wall sliding, and ground detection.

**Tech Stack:** C++23, GLM, nlohmann/json, std::variant, std::ranges

**Spec:** `docs/superpowers/specs/2026-04-22-collision-primitives-bvh-kcc-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|----------------|
| `include/gseurat/engine/collision/primitive.hpp` | ColliderShape variant (BoxData, SphereData, CapsuleData), hit/contact/sweep structs |
| `include/gseurat/engine/collision/intersect.hpp` | All intersection function declarations |
| `src/engine/collision/intersect.cpp` | Intersection implementations (AABB, ray, overlap, sweep) |
| `include/gseurat/engine/collision/bvh.hpp` | BVH node struct, build/query class |
| `src/engine/collision/bvh.cpp` | BVH construction + query implementations |
| `include/gseurat/engine/collision/collision_system.hpp` | CollisionSystem class (cache, BVH owner, KCC) |
| `src/engine/collision/collision_system.cpp` | CollisionSystem + KCC implementation |
| `include/gseurat/engine/ecs/components/collider_component.hpp` | ColliderComponent ECS struct |
| `include/gseurat/engine/ecs/components/kinematic_body.hpp` | KinematicBody ECS struct |
| `tests/test_primitive_aabb.cpp` | AABB computation tests |
| `tests/test_intersect.cpp` | Ray, overlap, sweep intersection tests |
| `tests/test_bvh.cpp` | BVH build + query tests |
| `tests/test_collision_system.cpp` | CollisionSystem cache, sweep, trigger tests |
| `tests/test_kcc.cpp` | KCC gravity, ground, wall-slide, jump tests |
| `tests/test_collider_json.cpp` | Component JSON round-trip tests |

### Modified Files

| File | Changes |
|------|---------|
| `include/gseurat/engine/gaussian_cloud.hpp` | Add `longest_axis()` to existing `AABB` struct |
| `src/engine/app_base.cpp` | Register ColliderComponent + KinematicBody |
| `src/engine/scene_loader.cpp` | Parse ColliderComponent shape JSON |
| `schemas/scene.schema.json` | Add ColliderComponent + KinematicBody schema |
| `src/demo/island_demo_state.cpp` | Replace grid movement with KinematicBody input |
| `CMakeLists.txt` | Add new collision source files + test targets |

### Removed Files

| File | Reason |
|------|--------|
| `include/gseurat/engine/ecs/components/player_jump.hpp` | Replaced by KinematicBody |

---

## Task 1: Primitive Types & AABB Computation

**Files:**
- Modify: `include/gseurat/engine/gaussian_cloud.hpp` (add `longest_axis()` to AABB)
- Create: `include/gseurat/engine/collision/primitive.hpp`
- Create: `include/gseurat/engine/collision/intersect.hpp`
- Create: `src/engine/collision/intersect.cpp` (AABB functions only in this task)
- Create: `tests/test_primitive_aabb.cpp`
- Modify: `CMakeLists.txt`

### Context

The existing `gseurat::AABB` in `gaussian_cloud.hpp` has `min`, `max`, `center()`, `extent()`, `expand()`. We reuse it everywhere — no new AABB type. We add `longest_axis()` returning `uint32_t` (0=X, 1=Y, 2=Z) for BVH splitting.

The new `collision/primitive.hpp` defines `BoxData`, `SphereData`, `CapsuleData`, `ColliderShape` variant, and hit structs (`RayHit`, `Contact`, `SweepHit`). No intersection logic — just data types.

The `intersect.hpp`/`.cpp` pair starts with AABB computation functions. Later tasks add ray, overlap, and sweep functions to the same files.

### Steps

- [ ] **Step 1:** Add `longest_axis()` to `gseurat::AABB` in `gaussian_cloud.hpp`:

```cpp
uint32_t longest_axis() const {
    glm::vec3 e = extent();
    if (e.x >= e.y && e.x >= e.z) return 0;
    return (e.y >= e.z) ? 1 : 2;
}
```

- [ ] **Step 2:** Create `include/gseurat/engine/collision/primitive.hpp` with:
  - `enum class ColliderType : uint8_t { Box, Sphere, Capsule }`
  - `struct BoxData { glm::vec3 half_extents{0.5f}; }`
  - `struct SphereData { float radius{0.5f}; }`
  - `struct CapsuleData { float radius{0.3f}; float half_height{0.5f}; }` — half_height is the cylinder segment half-length, total height = `2*half_height + 2*radius`
  - `using ColliderShape = std::variant<BoxData, SphereData, CapsuleData>;`
  - `struct RayHit { float t; glm::vec3 point; glm::vec3 normal; }`
  - `struct Contact { glm::vec3 point; glm::vec3 normal; float depth; }`
  - `struct SweepHit { float t; glm::vec3 point; glm::vec3 normal; }`

- [ ] **Step 3:** Create `include/gseurat/engine/collision/intersect.hpp` declaring:

```cpp
#pragma once
#include "gseurat/engine/collision/primitive.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"  // for AABB
#include <glm/gtc/quaternion.hpp>
#include <optional>
#include <vector>

namespace gseurat {

// ── AABB computation ──
AABB compute_aabb(const BoxData& box, const glm::vec3& pos, const glm::quat& rot);
AABB compute_aabb(const SphereData& sphere, const glm::vec3& pos, const glm::quat& rot);
AABB compute_aabb(const CapsuleData& capsule, const glm::vec3& pos, const glm::quat& rot);
AABB compute_aabb(const ColliderShape& shape, const glm::vec3& pos, const glm::quat& rot);
bool aabb_overlaps(const AABB& a, const AABB& b);

}  // namespace gseurat
```

- [ ] **Step 4:** Create `src/engine/collision/intersect.cpp` implementing:
  - `compute_aabb(BoxData, pos, rot)`: For OBB, compute rotated axes via `rot * vec3(1,0,0)` etc., take `abs()` of each, multiply by `half_extents`, sum for expanded half-extents. Return `{pos - expanded, pos + expanded}`.
  - `compute_aabb(SphereData, pos, rot)`: Return `{pos - radius, pos + radius}`.
  - `compute_aabb(CapsuleData, pos, rot)`: Capsule is aligned along local Y-axis. Transform top/bottom hemisphere centers (`pos + rot * (0, ±half_height, 0)`), compute AABB enclosing both, expand by radius.
  - `compute_aabb(ColliderShape, pos, rot)`: `std::visit` dispatcher.
  - `aabb_overlaps(a, b)`: Standard 3-axis separating test.

- [ ] **Step 5:** Write `tests/test_primitive_aabb.cpp` testing:
  - Identity-rotation box AABB matches `pos ± half_extents`
  - 90-degree rotated box AABB swaps axes correctly
  - Sphere AABB is `pos ± radius` regardless of rotation
  - Capsule AABB at identity rotation spans `[pos.x-r, pos.x+r] × [pos.y-hh-r, pos.y+hh+r] × [pos.z-r, pos.z+r]`
  - Rotated capsule (90° around Z) swaps X and Y extents
  - `aabb_overlaps`: overlapping pair returns true, separated pair returns false, touching edge returns true
  - `ColliderShape` variant dispatch works for all three types
  - `AABB::longest_axis()` returns correct axis index

- [ ] **Step 6:** Add to `CMakeLists.txt`:
  - Add `src/engine/collision/intersect.cpp` to `gseurat_core` sources
  - Add test: `add_gseurat_test(test_primitive_aabb src/engine/collision/intersect.cpp)`

- [ ] **Step 7:** Run tests, verify all pass:

```bash
cmake --build --preset macos-debug --target test_primitive_aabb && ctest -R test_primitive_aabb -V
```

- [ ] **Step 8:** Commit:

```bash
git add include/gseurat/engine/collision/ src/engine/collision/ tests/test_primitive_aabb.cpp \
        include/gseurat/engine/gaussian_cloud.hpp CMakeLists.txt
git commit -m "feat(collision): add primitive types and AABB computation"
```

---

## Task 2: Ray-Primitive Intersection

**Files:**
- Modify: `include/gseurat/engine/collision/intersect.hpp` (add ray declarations)
- Modify: `src/engine/collision/intersect.cpp` (add ray implementations)
- Create: `tests/test_intersect.cpp`
- Modify: `CMakeLists.txt`

### Context

Ray intersection is used for editor picking (Spec 2) and gameplay raycasts. Three implementations: ray-sphere (quadratic), ray-OBB (transform to local space + slab test), ray-capsule (ray vs cylinder + hemisphere caps).

### Steps

- [ ] **Step 1:** Add to `intersect.hpp`:

```cpp
// ── Ray-primitive intersection ──
std::optional<RayHit> ray_intersect(
    const glm::vec3& origin, const glm::vec3& direction,
    const ColliderShape& shape, const glm::vec3& pos, const glm::quat& rot);

// Shape-specific (called by variant dispatcher above)
std::optional<RayHit> ray_vs_sphere(
    const glm::vec3& origin, const glm::vec3& direction,
    const glm::vec3& center, float radius);
std::optional<RayHit> ray_vs_box(
    const glm::vec3& origin, const glm::vec3& direction,
    const glm::vec3& pos, const glm::quat& rot, const BoxData& box);
std::optional<RayHit> ray_vs_capsule(
    const glm::vec3& origin, const glm::vec3& direction,
    const glm::vec3& pos, const glm::quat& rot, const CapsuleData& capsule);
```

- [ ] **Step 2:** Implement in `intersect.cpp`:
  - `ray_vs_sphere`: Solve quadratic `|O + tD - C|^2 = r^2`. Return smallest positive `t`. Normal = `normalize(point - center)`.
  - `ray_vs_box`: Transform ray into box local space (inverse rotation). Slab test on 3 axes. Return closest entry `t` and face normal (transform back to world).
  - `ray_vs_capsule`: Capsule = cylinder of radius `r` between two hemisphere centers, capped with hemispheres. Test ray vs infinite cylinder (quadratic in XZ of capsule-local space). Clamp `t` to cylinder height range. Also test ray vs top/bottom spheres. Return closest hit.
  - `ray_intersect`: `std::visit` dispatcher.

- [ ] **Step 3:** Write `tests/test_intersect.cpp` — ray tests:
  - Ray along -Y hitting sphere at origin: hit at `t = pos.y - radius`
  - Ray missing sphere (parallel offset): no hit
  - Ray along -Z hitting axis-aligned box: correct face normal
  - Ray along -X hitting 90°-Y-rotated box: enters via what was originally the Z face
  - Ray along -Y hitting upright capsule: hits top hemisphere
  - Ray along -X hitting upright capsule: hits cylinder side
  - Ray with `t < 0` (behind origin): no hit
  - Zero-radius sphere: still works (point hit)

- [ ] **Step 4:** Add test to CMakeLists.txt: `add_gseurat_test(test_intersect src/engine/collision/intersect.cpp)`

- [ ] **Step 5:** Run tests, verify all pass.

- [ ] **Step 6:** Commit: `git commit -m "feat(collision): add ray-primitive intersection"`

---

## Task 3: Capsule-Primitive Overlap & Penetration

**Files:**
- Modify: `include/gseurat/engine/collision/intersect.hpp`
- Modify: `src/engine/collision/intersect.cpp`
- Modify: `tests/test_intersect.cpp`

### Context

The KCC needs overlap tests returning penetration depth + normal for push-out. Three functions: capsule-vs-sphere, capsule-vs-capsule, capsule-vs-box. All return `std::optional<Contact>` with normal pointing from primitive toward capsule.

Key math: each reduces to "closest point on segment A to primitive B", then checks distance < sum of radii. The capsule segment is from `pos + rot*(0,-hh,0)` to `pos + rot*(0,+hh,0)`.

### Steps

- [ ] **Step 1:** Add to `intersect.hpp`:

```cpp
// ── Capsule overlap with penetration ──
std::optional<Contact> capsule_vs_sphere(
    const glm::vec3& cap_pos, const glm::quat& cap_rot, const CapsuleData& capsule,
    const glm::vec3& sph_pos, const SphereData& sphere);
std::optional<Contact> capsule_vs_capsule(
    const glm::vec3& pos_a, const glm::quat& rot_a, const CapsuleData& a,
    const glm::vec3& pos_b, const glm::quat& rot_b, const CapsuleData& b);
std::optional<Contact> capsule_vs_box(
    const glm::vec3& cap_pos, const glm::quat& cap_rot, const CapsuleData& capsule,
    const glm::vec3& box_pos, const glm::quat& box_rot, const BoxData& box);
```

Also add internal helper (in .cpp, not header):

```cpp
// Closest point on line segment [a,b] to point p
glm::vec3 closest_point_on_segment(const glm::vec3& a, const glm::vec3& b, const glm::vec3& p);
// Closest points between two line segments [a1,b1] and [a2,b2]
std::pair<glm::vec3, glm::vec3> closest_points_segments(
    const glm::vec3& a1, const glm::vec3& b1,
    const glm::vec3& a2, const glm::vec3& b2);
// Closest point on OBB surface to point p
glm::vec3 closest_point_on_obb(
    const glm::vec3& p,
    const glm::vec3& box_pos, const glm::quat& box_rot, const BoxData& box);
```

- [ ] **Step 2:** Implement helpers in `intersect.cpp`:
  - `closest_point_on_segment`: Project `p` onto line `a→b`, clamp parameter to [0,1].
  - `closest_points_segments`: Solve 2-parameter system for closest approach between two lines, clamp both to [0,1], handle degenerate (parallel) case.
  - `closest_point_on_obb`: Transform `p` into box local space, clamp to `[-half_extents, +half_extents]`, transform back to world.

- [ ] **Step 3:** Implement overlap functions:
  - `capsule_vs_sphere`: Compute capsule segment endpoints. Find closest point on segment to sphere center. Distance = `length(closest - sph_pos)`. If `distance < capsule.radius + sphere.radius`, return Contact with `depth = combined_radius - distance`, `normal = normalize(closest - sph_pos)`, `point` at midpoint.
  - `capsule_vs_capsule`: Find closest points between two capsule segments. If distance < `a.radius + b.radius`, return Contact.
  - `capsule_vs_box`: For each point on capsule segment (sample endpoints + closest point to OBB center), find closest point on OBB surface. Use the pair with minimum distance. If distance < `capsule.radius`, return Contact with `depth = radius - distance`.

- [ ] **Step 4:** Add overlap tests to `tests/test_intersect.cpp`:
  - Capsule at (0,1,0) overlapping sphere at (0.5,1,0) with combined radii > 0.5: returns contact with correct normal and depth
  - Capsule and sphere far apart: no contact
  - Two parallel capsules side by side within radius sum: contact
  - Capsule resting on top of box (Y-axis contact): normal ≈ (0,1,0), depth > 0
  - Capsule next to box wall (X-axis contact): normal ≈ (1,0,0)
  - Capsule not touching box: no contact

- [ ] **Step 5:** Run tests, verify all pass.

- [ ] **Step 6:** Commit: `git commit -m "feat(collision): add capsule-primitive overlap with penetration"`

---

## Task 4: Capsule Sweep

**Files:**
- Modify: `include/gseurat/engine/collision/intersect.hpp`
- Modify: `src/engine/collision/intersect.cpp`
- Modify: `tests/test_intersect.cpp`

### Context

The primary KCC movement query. Sweeps a capsule along a direction and reports the first collision. Minkowski sum reduction: inflate the target primitive by capsule radius, then sweep the capsule's center-segment against the inflated shape.

### Steps

- [ ] **Step 1:** Add to `intersect.hpp`:

```cpp
// ── Capsule sweep ──
std::optional<SweepHit> sweep_capsule(
    const glm::vec3& cap_pos, const glm::quat& cap_rot, const CapsuleData& capsule,
    const glm::vec3& direction, float max_distance,
    const ColliderShape& shape, const glm::vec3& pos, const glm::quat& rot);
```

- [ ] **Step 2:** Implement in `intersect.cpp`:
  - `sweep_vs_sphere`: Inflate sphere radius by capsule radius. Sweep capsule center-point (or center-segment midpoint) as a ray against inflated sphere. For the segment: sweep both endpoints, take earliest hit.
  - `sweep_vs_box`: Inflate box half-extents by capsule radius (rounded box / Minkowski sum). Sweep capsule center-segment endpoints as rays against inflated rounded-box. Handle edge rounding with sphere sweeps at box edges.
  - `sweep_vs_capsule`: Inflate target capsule radius by sweep capsule radius. Sweep center-segment against inflated capsule (reduce to moving-point-vs-capsule).
  - Main dispatcher: `std::visit` on target shape.
  - `SweepHit.t` is fraction of `max_distance` in [0, 1].

- [ ] **Step 3:** Add sweep tests to `tests/test_intersect.cpp`:
  - Capsule sweeping downward onto a box floor: hit at expected `t`, normal ≈ (0,1,0)
  - Capsule sweeping forward into a wall box: hit with normal perpendicular to wall face
  - Capsule sweeping past a sphere (miss): no hit
  - Capsule sweeping into a sphere: hit at correct `t`
  - Zero-distance sweep: no hit (or immediate contact if overlapping)
  - Sweep along a direction parallel to wall (no hit)

- [ ] **Step 4:** Run tests, verify all pass.

- [ ] **Step 5:** Commit: `git commit -m "feat(collision): add capsule sweep intersection"`

---

## Task 5: ECS Components — ColliderComponent & KinematicBody

**Files:**
- Create: `include/gseurat/engine/ecs/components/collider_component.hpp`
- Create: `include/gseurat/engine/ecs/components/kinematic_body.hpp`
- Create: `tests/test_collider_json.cpp`
- Modify: `CMakeLists.txt`

### Context

ECS components for the collision system. `ColliderComponent` holds shape, offset, local rotation, mask, is_trigger, is_dynamic. `KinematicBody` holds velocity, gravity_scale, grounded state, and designer-facing jump parameters with `recompute_derived()`.

Both register with `ComponentRegistry` for JSON serialization. Follow the pattern in `app_base.cpp` (see existing `ProximityTrigger`, `EmitterToggle` registrations).

### Steps

- [ ] **Step 1:** Create `include/gseurat/engine/ecs/components/collider_component.hpp`:

```cpp
#pragma once
#include "gseurat/engine/collision/primitive.hpp"
#include <glm/gtc/quaternion.hpp>
#include <nlohmann/json_fwd.hpp>

namespace gseurat {

struct ColliderComponent {
    ColliderShape shape{SphereData{0.5f}};
    glm::vec3 offset{0.0f};
    glm::quat local_rotation{1, 0, 0, 0};
    uint32_t collision_mask{0xFFFFFFFF};
    bool is_trigger{false};
    bool is_dynamic{false};
};

// JSON serialization (implementations in scene_loader.cpp or a dedicated .cpp)
ColliderComponent collider_from_json(const nlohmann::json& j);
nlohmann::json collider_to_json(const ColliderComponent& c);

}  // namespace gseurat
```

- [ ] **Step 2:** Create `include/gseurat/engine/ecs/components/kinematic_body.hpp`:

```cpp
#pragma once
#include <glm/glm.hpp>
#include <nlohmann/json_fwd.hpp>

namespace gseurat {

struct KinematicBody {
    glm::vec3 velocity{0.0f};
    float gravity_scale{1.0f};
    bool grounded{false};
    glm::vec3 ground_normal{0, 1, 0};

    float desired_jump_height{2.0f};
    float time_to_apex{0.4f};

    float derived_gravity{0.0f};
    float derived_jump_velocity{0.0f};

    void recompute_derived() {
        if (time_to_apex > 0.0f) {
            derived_gravity = (2.0f * desired_jump_height) / (time_to_apex * time_to_apex);
            derived_jump_velocity = 2.0f * desired_jump_height / time_to_apex;
        }
    }
};

KinematicBody kinematic_body_from_json(const nlohmann::json& j);
nlohmann::json kinematic_body_to_json(const KinematicBody& kb);

}  // namespace gseurat
```

- [ ] **Step 3:** Implement JSON serialization functions. `collider_from_json` parses:
  - `shape.type` → "box"/"sphere"/"capsule", unknown falls back to SphereData{0.5f}
  - `shape.half_extents` / `shape.radius` / `shape.half_height` per type
  - `offset`, `local_rotation` (as [x,y,z,w] quaternion), `collision_mask`, `is_trigger`, `is_dynamic`
  
  `kinematic_body_from_json` parses `gravity_scale`, `desired_jump_height`, `time_to_apex` only (velocity/grounded/derived are runtime). Calls `recompute_derived()` after parsing.

  `collider_to_json` and `kinematic_body_to_json` reverse the process.

- [ ] **Step 4:** Write `tests/test_collider_json.cpp`:
  - Round-trip BoxData: `to_json(from_json(json)) == json`
  - Round-trip SphereData
  - Round-trip CapsuleData
  - Unknown shape type falls back to sphere
  - Missing fields use defaults
  - KinematicBody: `desired_jump_height=3.0, time_to_apex=0.5` → `derived_gravity = 24.0, derived_jump_velocity = 12.0`
  - KinematicBody round-trip preserves designer params, derived are recomputed

- [ ] **Step 5:** Add test to CMakeLists.txt. The JSON serialization .cpp file needs to be compiled — either add it to `gseurat_core` or compile as part of the test.

- [ ] **Step 6:** Run tests, verify all pass.

- [ ] **Step 7:** Commit: `git commit -m "feat(collision): add ColliderComponent and KinematicBody ECS components"`

---

## Task 6: Schema & Component Registration

**Files:**
- Modify: `schemas/scene.schema.json`
- Modify: `src/engine/app_base.cpp`
- Modify: `CMakeLists.txt` (if JSON impl needs a new .cpp)

### Steps

- [ ] **Step 1:** Add `ColliderComponent` and `KinematicBody` definitions to `scene.schema.json` under the `components` properties of the `game_objects` items. Follow the format from the spec (Section 2.3).

- [ ] **Step 2:** In `app_base.cpp`, register both components alongside existing registrations:

```cpp
#include "gseurat/engine/ecs/components/collider_component.hpp"
#include "gseurat/engine/ecs/components/kinematic_body.hpp"

// In register_default_components() or equivalent:
component_registry_.register_component<ColliderComponent>("ColliderComponent",
    collider_from_json, collider_to_json);
component_registry_.register_component<KinematicBody>("KinematicBody",
    kinematic_body_from_json, kinematic_body_to_json);
```

- [ ] **Step 3:** Build the full engine to verify registration compiles: `cmake --build --preset macos-debug`

- [ ] **Step 4:** Commit: `git commit -m "feat(collision): register components in schema and app_base"`

---

## Task 7: BVH Construction

**Files:**
- Create: `include/gseurat/engine/collision/bvh.hpp`
- Create: `src/engine/collision/bvh.cpp`
- Create: `tests/test_bvh.cpp`
- Modify: `CMakeLists.txt`

### Context

Flat-array BVH with top-down longest-axis median split. Nodes stored in `std::vector<BVHNode>`. Leaf nodes reference contiguous ranges in a reordered collider array. Build reorders the input `ColliderInstance` array in-place for spatial coherence.

### Steps

- [ ] **Step 1:** Create `include/gseurat/engine/collision/bvh.hpp`:

```cpp
#pragma once
#include "gseurat/engine/gaussian_cloud.hpp"  // AABB
#include <cstdint>
#include <optional>
#include <vector>
#include <glm/glm.hpp>

namespace gseurat {

struct BVHNode {
    AABB bounds;
    uint32_t left{0};    // Internal: left child index. Leaf: first collider index.
    uint32_t right{0};   // Internal: right child index. Leaf: collider count.
    bool is_leaf{false};
};

class BVH {
public:
    static constexpr uint32_t MAX_LEAF_SIZE = 4;

    /// Build BVH over a range of AABBs. Reorders `indices` in-place.
    /// `aabbs` is indexed by values in `indices`.
    void build(const std::vector<AABB>& aabbs, std::vector<uint32_t>& indices);

    /// Query: find all indices whose AABBs overlap `query`.
    void query_aabb(const AABB& query, const std::vector<AABB>& aabbs,
                    const std::vector<uint32_t>& indices,
                    std::vector<uint32_t>& out) const;

    /// Query: raycast, return index of closest hit (narrow-phase done by caller).
    std::optional<std::pair<uint32_t, float>> raycast(
        const glm::vec3& origin, const glm::vec3& inv_dir, float max_t,
        const std::vector<AABB>& aabbs, const std::vector<uint32_t>& indices) const;

    bool empty() const { return nodes_.empty(); }
    const std::vector<BVHNode>& nodes() const { return nodes_; }

private:
    std::vector<BVHNode> nodes_;

    uint32_t build_recursive(const std::vector<AABB>& aabbs,
                             std::vector<uint32_t>& indices,
                             uint32_t begin, uint32_t end);
};

}  // namespace gseurat
```

- [ ] **Step 2:** Implement `src/engine/collision/bvh.cpp`:
  - `build()`: Reserve nodes, call `build_recursive(aabbs, indices, 0, count)`.
  - `build_recursive(aabbs, indices, begin, end)`:
    1. Compute parent AABB from `aabbs[indices[begin..end)]`
    2. If `end - begin <= MAX_LEAF_SIZE`: push leaf node `{bounds, begin, end-begin, true}`, return its index
    3. `axis = bounds.longest_axis()`
    4. `mid = (begin + end) / 2`
    5. `std::nth_element(indices.begin()+begin, indices.begin()+mid, indices.begin()+end, [&](uint32_t a, uint32_t b) { return aabbs[a].center()[axis] < aabbs[b].center()[axis]; })`
    6. Push internal node (placeholder), recurse left `[begin, mid)` and right `[mid, end)`, fill in left/right child indices.
  - `query_aabb()`: Stack-based iterative. Push root, pop, test overlap, push children or emit leaf indices.
  - `raycast()`: Stack-based with ray-AABB slab test. Track closest `t`. Prune branches where entry `t > best_t`. For leaves, test ray-AABB of each indexed collider, return index + `t` of AABB hit (narrow-phase is caller's job).

- [ ] **Step 3:** Write `tests/test_bvh.cpp`:
  - Build BVH from 8 AABBs at known positions (2x2x2 grid of unit cubes)
  - `query_aabb` with small query overlapping 1 cube: returns exactly 1 index
  - `query_aabb` with large query overlapping all: returns all 8
  - `query_aabb` with query in empty space: returns 0
  - `raycast` along X axis through 2 cubes: returns closest
  - Build from 1 collider (degenerate): works, query returns it
  - Build from 0 colliders: `empty()` returns true, queries return nothing
  - Build from 100 random AABBs: doesn't crash, query results are subset of brute-force

- [ ] **Step 4:** Add to CMakeLists.txt: `src/engine/collision/bvh.cpp` to gseurat_core, and test: `add_gseurat_test(test_bvh src/engine/collision/bvh.cpp)`

- [ ] **Step 5:** Run tests, verify all pass.

- [ ] **Step 6:** Commit: `git commit -m "feat(collision): add static BVH construction and queries"`

---

## Task 8: CollisionSystem — Cache, Queries, Integration

**Files:**
- Create: `include/gseurat/engine/collision/collision_system.hpp`
- Create: `src/engine/collision/collision_system.cpp`
- Create: `tests/test_collision_system.cpp`
- Modify: `CMakeLists.txt`

### Context

CollisionSystem owns two caches (`static_cache_`, `dynamic_cache_`), the BVH, and the KCC. It provides `sweep()`, `overlap_aabb()`, `raycast()` queries. The `update()` method rebuilds caches if dirty, syncs dynamics, then runs the KCC.

### Steps

- [ ] **Step 1:** Create `include/gseurat/engine/collision/collision_system.hpp` per the spec Section 3.2. Key members:
  - `ColliderInstance` struct (entity, collider_index, world_position, world_rotation, shape, world_aabb, collision_mask, is_trigger)
  - Public config: `world_gravity`, `skin_width`, `ground_probe_distance`, `ground_angle_cos`, `max_slide_iterations`, `jump_cut_multiplier`
  - Public methods: `rebuild_cache()`, `sync_dynamics()`, `mark_dirty()`, `sweep()`, `overlap_aabb()`, `raycast()`, `update()`
  - Private: `static_cache_`, `dynamic_cache_`, BVH instance, `dirty_` flag, `run_kcc()`

- [ ] **Step 2:** Implement `src/engine/collision/collision_system.cpp`:
  - `rebuild_cache()`: Query `world.view<ecs::Transform, ColliderComponent>()`, bake world transforms, push to static or dynamic cache, call `rebuild_bvh()`, clear dirty.
  - `rebuild_bvh()`: Extract AABBs from `static_cache_` into temporary vector, build BVH with index array, reorder `static_cache_` to match BVH's reordered indices.
  - `sync_dynamics()`: For each `dynamic_cache_` entry, fetch current Transform + ColliderComponent, re-bake position/rotation/AABB.
  - `sweep()`: Compute swept AABB, query BVH for static candidates, linear scan dynamics, narrow-phase `sweep_capsule()` on each, return closest non-trigger hit.
  - `overlap_aabb()`: BVH + dynamic scan, return all overlapping (including triggers).
  - `raycast()`: BVH raycast for broad-phase, narrow-phase `ray_intersect()` on candidates, return closest.
  - `update()`: if dirty → rebuild, sync dynamics, run_kcc. (KCC implementation in Task 9.)

- [ ] **Step 3:** Write `tests/test_collision_system.cpp`:
  - Create World with 3 entities: 2 static boxes (floor + wall), 1 dynamic sphere
  - `rebuild_cache()`: verify `static_cache_.size() == 2`, `dynamic_cache_.size() == 1`
  - `mark_dirty()` + rebuild: cache updates
  - `sweep()` capsule downward: hits floor box
  - `sweep()` capsule into wall: hits wall box
  - `sweep()` capsule away from everything: no hit
  - `sync_dynamics()`: move dynamic entity's Transform, verify `dynamic_cache_` AABB updates
  - `overlap_aabb()` with trigger entity: returns it
  - Collision mask filtering: sweep with mask=0 returns no hits

- [ ] **Step 4:** Add to CMakeLists.txt: `src/engine/collision/collision_system.cpp` to gseurat_core. Test needs all collision sources:

```cmake
add_gseurat_test(test_collision_system
    src/engine/collision/collision_system.cpp
    src/engine/collision/intersect.cpp
    src/engine/collision/bvh.cpp)
```

- [ ] **Step 5:** Run tests, verify all pass.

- [ ] **Step 6:** Commit: `git commit -m "feat(collision): add CollisionSystem with cache, BVH queries, and sweep"`

---

## Task 9: Kinematic Character Controller

**Files:**
- Modify: `src/engine/collision/collision_system.cpp` (add `run_kcc()`)
- Create: `tests/test_kcc.cpp`
- Modify: `CMakeLists.txt`

### Context

The KCC runs inside `CollisionSystem::run_kcc()`. For each entity with `Transform + KinematicBody + ColliderComponent (CapsuleData)`:
1. Apply gravity (split: derived_gravity for ascent, world_gravity for fall)
2. Horizontal sweep (XZ) with skin_width
3. Wall sliding (single iteration, velocity projection)
4. Vertical sweep (Y) with ceiling detection
5. Ground probe (short downward sweep)
6. Write back transform + body state

### Steps

- [ ] **Step 1:** Implement `CollisionSystem::run_kcc(ecs::World& world, float dt)` in `collision_system.cpp`:
  - Query `world.view<ecs::Transform, KinematicBody, ColliderComponent>()`
  - For each entity where shape is CapsuleData:
    - Extract capsule data, position, velocity
    - **Gravity**: if `velocity.y > 0` use `derived_gravity`, else use `world_gravity * gravity_scale`. If grounded and `velocity.y < 0`, zero it.
    - **Horizontal sweep**: decompose velocity to XZ, sweep, apply skin_width offset
    - **Wall slide**: project remaining movement along wall normal (spec Section 5.2 Step 3), sweep again, project velocity for next frame
    - **Vertical sweep**: sweep along Y velocity, detect floor/ceiling hits
    - **Ground probe**: sweep downward by `ground_probe_distance`, check `dot(normal, up) > ground_angle_cos`
    - **Write back**: update Transform position, KinematicBody velocity/grounded/ground_normal

- [ ] **Step 2:** Write `tests/test_kcc.cpp`:
  - **Gravity test**: Entity above floor (large box at y=0), not grounded, after update: velocity.y decreases, position.y decreases
  - **Ground detection**: Entity just above floor, after update: `grounded == true`, `ground_normal ≈ (0,1,0)`, position snapped to floor + skin_width + capsule bottom
  - **Grounded no gravity**: Entity on floor, grounded, velocity.y = 0 stays 0
  - **Wall blocking**: Entity moving +X, wall box at x=5, after update: position.x stops before wall
  - **Wall sliding**: Entity moving diagonally (+X, +Z) into wall with normal (-1,0,0): after update, Z movement preserved, X blocked
  - **Ceiling hit**: Entity jumping (velocity.y > 0), box above: velocity.y becomes 0 on hit
  - **Jump derived params**: `desired_jump_height=2, time_to_apex=0.4` → `derived_gravity=25, derived_jump_velocity=10`
  - **Variable jump (input test)**: Set velocity.y to derived_jump_velocity, then multiply by jump_cut_multiplier (simulating early release) → velocity.y halved
  - **Steep slope**: Floor box tilted beyond 45° → `grounded == false`, entity slides

- [ ] **Step 3:** Add to CMakeLists.txt:

```cmake
add_gseurat_test(test_kcc
    src/engine/collision/collision_system.cpp
    src/engine/collision/intersect.cpp
    src/engine/collision/bvh.cpp)
```

- [ ] **Step 4:** Run tests, verify all pass.

- [ ] **Step 5:** Commit: `git commit -m "feat(collision): add KCC with gravity, sweep, wall-slide, and ground detection"`

---

## Task 10: Demo State Migration & Integration

**Files:**
- Modify: `src/demo/island_demo_state.cpp`
- Modify: `CMakeLists.txt` (ensure collision sources in gseurat_core)

### Context

Replace the grid-based `update_player` logic with KinematicBody-driven input. The CollisionSystem handles all physics. During the transition period, both code paths coexist — if no ColliderComponents exist in the scene, the old grid path runs (backward compatibility per spec Section 8).

### Steps

- [ ] **Step 1:** Add `CollisionSystem` member to the demo state class. Initialize in `on_enter()`.

- [ ] **Step 2:** Register `CollisionSystem` with `SystemScheduler`:

```cpp
scheduler_.add_system(SystemDecl{
    .name = "CollisionSystem",
    .fn = [this](ecs::World& w, float dt) { collision_system_.update(w, dt); },
    .reads = {},
    .writes = {},
});
```

Ensure it runs after input processing and before rendering.

- [ ] **Step 3:** In `update_player()`, add a branch: if the player entity has `KinematicBody`, use the new path:
  - Read input → compute desired XZ velocity (camera-relative, using existing acceleration blending)
  - Set `kinematic_body.velocity.x/z` from blended velocity
  - Handle jump input: if jump pressed and `body.grounded`, set `body.velocity.y = body.derived_jump_velocity`
  - Handle jump release: if jump released and `body.velocity.y > 0`, multiply by `jump_cut_multiplier`
  - Skip all grid collision / Y-snap code — CollisionSystem handles it in `update()`

- [ ] **Step 4:** Else (no KinematicBody): run existing grid-based logic unchanged. This preserves backward compatibility for scenes without collider data.

- [ ] **Step 5:** Remove the `PlayerJump` parabolic arc code from the new path (it only runs in the old grid path now).

- [ ] **Step 6:** Verify the full engine builds: `cmake --build --preset macos-debug`

- [ ] **Step 7:** Verify existing tests still pass: `ctest --preset macos-debug`

- [ ] **Step 8:** Commit: `git commit -m "feat(collision): integrate CollisionSystem into demo state, dual-path player movement"`

---

## Verification Checklist

After all tasks complete, verify against the spec:

- [ ] Spec Section 1 (Primitives): BoxData, SphereData, CapsuleData, ColliderShape variant, AABB computation, all intersection functions — **Tasks 1-4**
- [ ] Spec Section 2 (ECS Components): ColliderComponent, KinematicBody, JSON serialization, schema, PlayerJump deprecation — **Tasks 5-6**
- [ ] Spec Section 3 (CollisionSystem): ColliderInstance cache, static/dynamic split, rebuild, sync_dynamics, sweep/overlap/raycast queries — **Task 8**
- [ ] Spec Section 4 (BVH): BVHNode, flat array, top-down median split, AABB query, raycast query — **Task 7**
- [ ] Spec Section 5 (KCC): Gravity (split ascent/descent), horizontal sweep, wall sliding, vertical sweep, ground probe, variable jump — **Task 9**
- [ ] Spec Section 6 (Registration): app_base registration, SystemScheduler, scene loading — **Tasks 6, 10**
- [ ] Spec Section 7 (File Layout): All files created per table — **All tasks**
- [ ] Spec Section 8 (Constraints): No camera/audio/trigger changes, backward compatible, dual code path — **Task 10**
- [ ] Spec Section 9 (Testing): All 8 test categories covered — **Tasks 1-9**
- [ ] Build: `cmake --build --preset macos-debug` — no warnings
- [ ] All tests pass: `ctest --preset macos-debug`
