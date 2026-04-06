# PBD Physics Solver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the procedural wind-sway PBD shader with a real Position Based Dynamics solver that supports velocity, gravity, distance constraints, ground collision, and per-element parameters — enabling dangling chains, falling objects, flags, and soft bodies.

**Architecture:** The solver runs as a single compute shader dispatched before `gs_preprocess.comp`. Each PBD element carries its own physics state (position, previous position, velocity, inverse mass) and per-element parameters (gravity, damping, stiffness). A separate constraint buffer defines distance constraints between element pairs. The solver loop: (1) apply external forces → (2) predict positions → (3) iteratively project constraints → (4) update velocity and write output for preprocess. The preprocess shader consumes PBD output (position + rotation) unchanged from today.

**Tech Stack:** GLSL 450 compute shaders, Vulkan 1.3, C++23, GLM, VMA

---

## File Structure

| File | Responsibility |
|------|---------------|
| `shaders/pbd_solver.comp` | **Modify**: Full PBD solver (forces → predict → constrain → velocity update) |
| `include/gseurat/engine/gs_renderer.hpp` | **Modify**: Expanded `PbdState`, new `PbdConstraint` struct, new `PbdElementParams`, updated API |
| `src/engine/gs_renderer.cpp` | **Modify**: Constraint buffer creation, descriptor updates, per-element upload API |
| `tests/test_pbd_solver.cpp` | **Modify**: Tests for new structs, Verlet integration, constraint projection math |
| `include/gseurat/engine/pbd_types.hpp` | **Create**: Shared PBD type definitions (used by renderer + future scene loader) |

---

### Task 1: Define PBD Types Header

**Files:**
- Create: `include/gseurat/engine/pbd_types.hpp`
- Test: `tests/test_pbd_solver.cpp`

The new header defines all PBD data types shared between the renderer API and future scene loader. Keeping them in a dedicated header avoids pulling `gs_renderer.hpp` into scene loading code.

- [ ] **Step 1: Write the failing test for new struct layouts**

Add to `tests/test_pbd_solver.cpp` (new test function at the end, before `main`):

```cpp
// At the top, add include:
#include "gseurat/engine/pbd_types.hpp"

// New test function:
static void test_pbd_physics_state_layout() {
    std::printf("=== PbdPhysicsState struct layout ===\n");
    using namespace gseurat;

    // GPU state: 4 × vec4 = 64 bytes (std430)
    check(sizeof(PbdPhysicsState) == 64, "PbdPhysicsState is 64 bytes (4 x vec4)");
    check(offsetof(PbdPhysicsState, position) == 0, "position at offset 0");
    check(offsetof(PbdPhysicsState, prev_position) == 16, "prev_position at offset 16");
    check(offsetof(PbdPhysicsState, velocity) == 32, "velocity at offset 32");
    check(offsetof(PbdPhysicsState, params) == 48, "params at offset 48");

    // Constraint: 2 × vec4 = 32 bytes (std430)
    check(sizeof(PbdConstraint) == 32, "PbdConstraint is 32 bytes (2 x vec4)");
    check(offsetof(PbdConstraint, indices) == 0, "indices at offset 0");
    check(offsetof(PbdConstraint, params) == 16, "params at offset 16");

    // Element params: 3 × vec4 = 48 bytes (std430)
    check(sizeof(PbdElementParams) == 48, "PbdElementParams is 48 bytes (3 x vec4)");
    check(offsetof(PbdElementParams, gravity) == 0, "gravity at offset 0");
    check(offsetof(PbdElementParams, wind) == 16, "wind at offset 16");
    check(offsetof(PbdElementParams, dynamics) == 32, "dynamics at offset 32");
}
```

Also add `test_pbd_physics_state_layout();` to `main()`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cmake --build --preset macos-debug --target test_pbd_solver 2>&1 | tail -5`
Expected: Compile error — `pbd_types.hpp` not found.

- [ ] **Step 3: Create the types header**

Create `include/gseurat/engine/pbd_types.hpp`:

```cpp
#pragma once

#include <glm/glm.hpp>
#include <cstdint>

namespace gseurat {

// GPU PBD state per element (std430, 4 × vec4 = 64 bytes)
// Written by pbd_solver.comp, read by gs_preprocess.comp
struct PbdPhysicsState {
    glm::vec4 position;       // xyz = current position, w = inv_mass (0 = pinned)
    glm::vec4 prev_position;  // xyz = previous frame position, w = unused
    glm::vec4 velocity;       // xyz = current velocity, w = unused
    glm::vec4 params;         // x = sway_threshold, yzw = unused (reserved)
};

// Distance constraint between two PBD elements (std430, 2 × vec4 = 32 bytes)
struct PbdConstraint {
    glm::uvec4 indices;  // x = element_a, y = element_b, zw = unused
    glm::vec4 params;    // x = rest_length, y = stiffness (0-1), zw = unused
};

// Per-element simulation parameters (std430, 3 × vec4 = 48 bytes)
// Uploaded once (or when params change), not every frame
struct PbdElementParams {
    glm::vec4 gravity;   // xyz = gravity vector, w = damping (0-1)
    glm::vec4 wind;      // xyz = wind direction, w = wind_strength
    glm::vec4 dynamics;  // x = wind_frequency, y = ground_y (collision plane), z = bounce, w = unused
};

// Limits
static constexpr uint32_t kMaxPbdElements = 64;
static constexpr uint32_t kMaxPbdConstraints = 128;
static constexpr uint32_t kPbdSolverIterations = 4;

}  // namespace gseurat
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cmake --build --preset macos-debug --target test_pbd_solver && ctest --test-dir build/macos-debug -R test_pbd_solver --output-on-failure 2>&1 | tail -10`
Expected: All tests pass including new layout checks.

- [ ] **Step 5: Commit**

```bash
git add include/gseurat/engine/pbd_types.hpp tests/test_pbd_solver.cpp
git commit -m "feat(pbd): add PbdPhysicsState, PbdConstraint, PbdElementParams types"
```

---

### Task 2: Test Verlet Integration and Constraint Projection Math

**Files:**
- Modify: `tests/test_pbd_solver.cpp`

Add CPU-side mirrors of the GPU math we'll implement in the solver, then test them. This locks down the physics before we touch shaders.

- [ ] **Step 1: Write tests for Verlet integration**

Add to `tests/test_pbd_solver.cpp`:

```cpp
// CPU mirror of Verlet integration (matches pbd_solver.comp)
static glm::vec3 verlet_integrate(glm::vec3 pos, glm::vec3 prev_pos,
                                   glm::vec3 accel, float dt, float damping) {
    glm::vec3 velocity = (pos - prev_pos) * damping;
    return pos + velocity + accel * dt * dt;
}

// CPU mirror of distance constraint projection
static void project_distance_constraint(
    glm::vec3& pos_a, glm::vec3& pos_b,
    float inv_mass_a, float inv_mass_b,
    float rest_length, float stiffness) {
    glm::vec3 delta = pos_b - pos_a;
    float dist = glm::length(delta);
    if (dist < 1e-6f) return;
    float error = (dist - rest_length) / dist;
    float w_sum = inv_mass_a + inv_mass_b;
    if (w_sum < 1e-6f) return;
    glm::vec3 correction = delta * error * stiffness;
    pos_a += correction * (inv_mass_a / w_sum);
    pos_b -= correction * (inv_mass_b / w_sum);
}

static void test_verlet_integration() {
    std::printf("=== Verlet integration ===\n");

    float dt = 1.0f / 60.0f;

    // Free fall from rest: pos=(0,10,0), prev_pos=(0,10,0), gravity=(0,-9.8,0)
    glm::vec3 pos(0, 10, 0);
    glm::vec3 prev(0, 10, 0);
    glm::vec3 gravity(0, -9.8f, 0);
    glm::vec3 new_pos = verlet_integrate(pos, prev, gravity, dt, 1.0f);

    // After one step: y = 10 + 0 + (-9.8) * dt^2 ≈ 9.9973
    check(new_pos.x == 0.0f, "free fall: x unchanged");
    check(new_pos.z == 0.0f, "free fall: z unchanged");
    check(new_pos.y < 10.0f, "free fall: y decreased");
    check(approx(new_pos.y, 10.0f + gravity.y * dt * dt, 0.001f), "free fall: correct displacement");

    // With velocity (prev != pos): moving right at 1 unit/frame
    pos = glm::vec3(1, 0, 0);
    prev = glm::vec3(0, 0, 0);
    new_pos = verlet_integrate(pos, prev, glm::vec3(0), dt, 1.0f);
    check(new_pos.x > 1.0f, "velocity: continues moving right");
    check(approx(new_pos.x, 2.0f, 0.01f), "velocity: x ≈ 2.0 (constant velocity)");

    // Damping reduces velocity
    new_pos = verlet_integrate(pos, prev, glm::vec3(0), dt, 0.5f);
    check(new_pos.x < 2.0f, "damping: reduced forward motion");
    check(approx(new_pos.x, 1.5f, 0.01f), "damping: x ≈ 1.5 (half velocity)");

    // Pinned element (inv_mass = 0): handled by caller, not by verlet
    // (solver skips integration for inv_mass == 0)
}

static void test_distance_constraint() {
    std::printf("=== Distance constraint projection ===\n");

    // Two free elements, stretched apart: rest_length=1, actual=2
    glm::vec3 a(0, 0, 0);
    glm::vec3 b(2, 0, 0);
    project_distance_constraint(a, b, 1.0f, 1.0f, 1.0f, 1.0f);
    float dist = glm::length(b - a);
    check(approx(dist, 1.0f, 0.01f), "equal mass: distance corrected to rest_length");
    // Both should move equally
    check(approx(a.x, 0.5f, 0.01f), "equal mass: a moved to 0.5");
    check(approx(b.x, 1.5f, 0.01f), "equal mass: b moved to 1.5");

    // One pinned (inv_mass=0): only free element moves
    a = glm::vec3(0, 0, 0);
    b = glm::vec3(2, 0, 0);
    project_distance_constraint(a, b, 0.0f, 1.0f, 1.0f, 1.0f);
    check(approx(a.x, 0.0f, 0.01f), "pinned a: didn't move");
    check(approx(b.x, 1.0f, 0.01f), "pinned a: b moved to rest_length");

    // Compressed (closer than rest_length): should push apart
    a = glm::vec3(0, 0, 0);
    b = glm::vec3(0.5f, 0, 0);
    project_distance_constraint(a, b, 1.0f, 1.0f, 1.0f, 1.0f);
    dist = glm::length(b - a);
    check(approx(dist, 1.0f, 0.01f), "compressed: pushed to rest_length");

    // Partial stiffness: doesn't fully correct
    a = glm::vec3(0, 0, 0);
    b = glm::vec3(2, 0, 0);
    project_distance_constraint(a, b, 1.0f, 1.0f, 1.0f, 0.5f);
    dist = glm::length(b - a);
    check(approx(dist, 1.5f, 0.01f), "half stiffness: corrected halfway");
}
```

Add both test functions to `main()`.

- [ ] **Step 2: Run tests to verify they pass**

These are pure CPU math tests — they should pass immediately since we defined the functions inline.

Run: `cmake --build --preset macos-debug --target test_pbd_solver && ctest --test-dir build/macos-debug -R test_pbd_solver --output-on-failure 2>&1 | tail -10`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/test_pbd_solver.cpp
git commit -m "test(pbd): add Verlet integration and distance constraint tests"
```

---

### Task 3: Expand GsRenderer PBD API

**Files:**
- Modify: `include/gseurat/engine/gs_renderer.hpp`
- Modify: `src/engine/gs_renderer.cpp`

Replace the old `PbdState` / `set_pbd_anchors` / `set_pbd_wind` API with the new physics-based API. The old API was: set anchor positions + global wind. The new API: upload per-element physics state + per-element params + constraints.

- [ ] **Step 1: Update the header**

In `include/gseurat/engine/gs_renderer.hpp`:

1. Add `#include "gseurat/engine/pbd_types.hpp"` at the top (after `buffer.hpp`).

2. Replace the PBD public section:

```cpp
    // PBD (Position Based Dynamics) solver
    // Upload physics state for each element. Elements with inv_mass=0 are pinned.
    void upload_pbd_elements(const PbdPhysicsState* states,
                             const PbdElementParams* params,
                             uint32_t count);
    // Upload distance constraints between element pairs
    void upload_pbd_constraints(const PbdConstraint* constraints, uint32_t count);
    void clear_pbd();
    uint32_t pbd_count() const { return pbd_count_; }
    uint32_t pbd_constraint_count() const { return pbd_constraint_count_; }
```

3. Remove the old `PbdState` struct, `set_pbd_anchors`, `set_pbd_wind`, `kMaxPbdElements` from the header (they move to `pbd_types.hpp`).

4. Replace the private PBD section:

```cpp
    // PBD solver resources
    Buffer pbd_state_ssbo_;          // PbdPhysicsState[] (read/write by solver, read by preprocess)
    Buffer pbd_params_ssbo_;         // PbdElementParams[] (read by solver)
    Buffer pbd_constraint_ssbo_;     // PbdConstraint[] (read by solver)
    Buffer pbd_uniform_buffer_;      // PBD solver uniforms (time, dt, iteration count)
    uint32_t pbd_count_ = 0;
    uint32_t pbd_constraint_count_ = 0;
```

- [ ] **Step 2: Update buffer creation in `load_cloud`**

In `src/engine/gs_renderer.cpp`, find the PBD buffer creation block (near `bone_ssbo_` creation) and replace:

```cpp
    // PBD physics solver buffers
    pbd_state_ssbo_ = Buffer::create_storage(allocator_,
        kMaxPbdElements * sizeof(PbdPhysicsState));
    pbd_params_ssbo_ = Buffer::create_storage(allocator_,
        kMaxPbdElements * sizeof(PbdElementParams));
    pbd_constraint_ssbo_ = Buffer::create_storage(allocator_,
        kMaxPbdConstraints * sizeof(PbdConstraint));
    pbd_count_ = 0;
    pbd_constraint_count_ = 0;
    // Zero-initialize state (all elements pinned with identity rotation)
    {
        auto* states = static_cast<PbdPhysicsState*>(pbd_state_ssbo_.mapped());
        for (uint32_t i = 0; i < kMaxPbdElements; ++i) {
            states[i].position = glm::vec4(0.0f, 0.0f, 0.0f, 0.0f);  // inv_mass=0 (pinned)
            states[i].prev_position = glm::vec4(0.0f);
            states[i].velocity = glm::vec4(0.0f);
            states[i].params = glm::vec4(0.0f);
        }
    }
    // PBD uniform buffer: time(float), dt(float), iterations(uint), count(uint),
    //                      constraint_count(uint) + padding = 32 bytes
    pbd_uniform_buffer_ = Buffer::create_storage(allocator_, 32);
```

- [ ] **Step 3: Implement upload API**

In `src/engine/gs_renderer.cpp`, replace old `set_pbd_anchors`, `set_pbd_wind`, `clear_pbd` with:

```cpp
void GsRenderer::upload_pbd_elements(const PbdPhysicsState* states,
                                      const PbdElementParams* params,
                                      uint32_t count) {
    if (count == 0) return;
    uint32_t n = std::min(count, kMaxPbdElements);
    if (pbd_state_ssbo_.mapped()) {
        std::memcpy(pbd_state_ssbo_.mapped(), states, n * sizeof(PbdPhysicsState));
    }
    if (pbd_params_ssbo_.mapped()) {
        std::memcpy(pbd_params_ssbo_.mapped(), params, n * sizeof(PbdElementParams));
    }
    pbd_count_ = n;
}

void GsRenderer::upload_pbd_constraints(const PbdConstraint* constraints,
                                         uint32_t count) {
    if (count == 0) return;
    uint32_t n = std::min(count, kMaxPbdConstraints);
    if (pbd_constraint_ssbo_.mapped()) {
        std::memcpy(pbd_constraint_ssbo_.mapped(), constraints, n * sizeof(PbdConstraint));
    }
    pbd_constraint_count_ = n;
}

void GsRenderer::clear_pbd() {
    pbd_count_ = 0;
    pbd_constraint_count_ = 0;
    if (pbd_state_ssbo_.mapped()) {
        auto* states = static_cast<PbdPhysicsState*>(pbd_state_ssbo_.mapped());
        for (uint32_t i = 0; i < kMaxPbdElements; ++i) {
            states[i] = PbdPhysicsState{};
        }
    }
}
```

- [ ] **Step 4: Update descriptor layout and writes**

The preprocess layout needs binding 6 to point to `pbd_state_ssbo_` (same struct, different size). The PBD solver descriptor set needs 4 bindings:

```
binding 0: PbdPhysicsState[]   (read/write storage)
binding 1: PbdElementParams[]  (read-only storage)
binding 2: PbdConstraint[]     (read-only storage)
binding 3: PbdUniforms         (uniform buffer)
```

Update `create_descriptor_resources()`:
- Change PBD layout from 2 bindings to 4 bindings (add params + constraints as storage buffers).
- Update all descriptor writes to use the new buffer names (`pbd_state_ssbo_`, `pbd_params_ssbo_`, `pbd_constraint_ssbo_`).
- Update preprocess descriptor writes: binding 6 → `pbd_state_ssbo_` (was `pbd_ssbo_`).

- [ ] **Step 5: Update render dispatch**

In `render()`, replace the PBD uniform upload:

```cpp
        if (pbd_count_ > 0) {
            static_dirty_ = true;
            // Update PBD uniform: time, dt, iterations, count, constraint_count
            struct {
                float time;
                float dt;
                uint32_t iterations;
                uint32_t count;
                uint32_t constraint_count;
                uint32_t pad[3];  // align to 32 bytes
            } pbd_ubo;
            pbd_ubo.time = time_;
            pbd_ubo.dt = 1.0f / 60.0f;  // fixed timestep
            pbd_ubo.iterations = kPbdSolverIterations;
            pbd_ubo.count = pbd_count_;
            pbd_ubo.constraint_count = pbd_constraint_count_;
            std::memcpy(pbd_uniform_buffer_.mapped(), &pbd_ubo, sizeof(pbd_ubo));

            vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, pbd_pipeline_);
            vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                    pbd_pipeline_layout_, 0, 1, &pbd_set_, 0, nullptr);
            vkCmdPushConstants(cmd, pbd_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                               0, sizeof(uint32_t), &pbd_count_);
            vkCmdDispatch(cmd, (pbd_count_ + 63) / 64, 1, 1);

            // Barrier: PBD write → preprocess read
            VkMemoryBarrier pbd_barrier{};
            pbd_barrier.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
            pbd_barrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
            pbd_barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
            vkCmdPipelineBarrier(cmd,
                VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                0, 1, &pbd_barrier, 0, nullptr, 0, nullptr);
        }
```

- [ ] **Step 6: Update shutdown**

Replace `pbd_ssbo_` destroy with `pbd_state_ssbo_`, `pbd_params_ssbo_`, `pbd_constraint_ssbo_` destroys.

- [ ] **Step 7: Build and verify tests still pass**

Run: `cmake --build --preset macos-debug && ctest --test-dir build/macos-debug --output-on-failure 2>&1 | tail -10`
Expected: All tests pass. (The existing `test_pbd_solver` layout test for the old `PbdState` will need updating to use `PbdPhysicsState` — fix any compile errors.)

- [ ] **Step 8: Commit**

```bash
git add include/gseurat/engine/gs_renderer.hpp src/engine/gs_renderer.cpp tests/test_pbd_solver.cpp
git commit -m "refactor(pbd): expand GsRenderer to physics-based PBD API with constraints"
```

---

### Task 4: Rewrite PBD Solver Shader

**Files:**
- Modify: `shaders/pbd_solver.comp`

Replace the sine-wave placeholder with a real PBD solver: external forces → Verlet predict → constraint projection loop → velocity update → output position+rotation for preprocess.

- [ ] **Step 1: Write the new solver shader**

Replace `shaders/pbd_solver.comp` entirely:

```glsl
#version 450

layout(local_size_x = 64) in;

struct PbdPhysicsState {
    vec4 position;       // xyz = pos, w = inv_mass
    vec4 prev_position;  // xyz = prev pos, w = unused
    vec4 velocity;       // xyz = velocity, w = unused
    vec4 params;         // x = sway_threshold, yzw = reserved
};

struct PbdElementParams {
    vec4 gravity;   // xyz = gravity, w = damping
    vec4 wind;      // xyz = wind_dir, w = wind_strength
    vec4 dynamics;  // x = wind_freq, y = ground_y, z = bounce, w = unused
};

struct PbdConstraint {
    uvec4 indices;  // x = elem_a, y = elem_b, zw = unused
    vec4 params;    // x = rest_length, y = stiffness, zw = unused
};

layout(set = 0, binding = 0) buffer StateBuffer {
    PbdPhysicsState states[];
};

layout(set = 0, binding = 1) readonly buffer ParamsBuffer {
    PbdElementParams elem_params[];
};

layout(set = 0, binding = 2) readonly buffer ConstraintBuffer {
    PbdConstraint constraints[];
};

layout(set = 0, binding = 3) uniform PbdUniforms {
    float time;
    float dt;
    uint iterations;
    uint count;
    uint constraint_count;
    uint pad0;
    uint pad1;
    uint pad2;
};

layout(push_constant) uniform PushConstants {
    uint pbd_count;
};

// Build quaternion from axis-angle
vec4 axis_angle_to_quat(vec3 axis, float angle) {
    float half_a = angle * 0.5;
    float s = sin(half_a);
    return vec4(axis * s, cos(half_a));
}

// Compute rotation quaternion from displacement relative to rest position
vec4 displacement_to_rotation(vec3 rest_pos, vec3 current_pos, vec3 anchor) {
    vec3 rest_dir = rest_pos - anchor;
    vec3 curr_dir = current_pos - anchor;
    float rest_len = length(rest_dir);
    float curr_len = length(curr_dir);
    if (rest_len < 0.001 || curr_len < 0.001) return vec4(0, 0, 0, 1);

    rest_dir /= rest_len;
    curr_dir /= curr_len;

    vec3 axis = cross(rest_dir, curr_dir);
    float axis_len = length(axis);
    if (axis_len < 1e-6) return vec4(0, 0, 0, 1);

    float angle = asin(clamp(axis_len, -1.0, 1.0));
    if (dot(rest_dir, curr_dir) < 0.0) angle = 3.14159265 - angle;

    return axis_angle_to_quat(normalize(axis), angle);
}

void main() {
    uint idx = gl_GlobalInvocationID.x;
    if (idx >= pbd_count) return;

    PbdPhysicsState state = states[idx];
    PbdElementParams ep = elem_params[idx];

    float inv_mass = state.position.w;
    vec3 pos = state.position.xyz;
    vec3 prev_pos = state.prev_position.xyz;
    vec3 vel = state.velocity.xyz;

    // Store rest position for rotation computation
    vec3 rest_pos = state.prev_position.xyz;

    // Skip pinned elements (inv_mass == 0)
    if (inv_mass > 0.0) {
        // --- External forces ---
        vec3 accel = ep.gravity.xyz;
        float damping = ep.damping.w;

        // Wind force (sinusoidal, per-element phase variation)
        float wind_strength = ep.wind.w;
        if (wind_strength > 0.0) {
            vec3 wind_dir = normalize(ep.wind.xyz);
            float freq = ep.dynamics.x;
            float phase = dot(pos, vec3(0.37, 0.13, 0.71));
            float wind_force = sin(time * freq + phase) * wind_strength;
            accel += wind_dir * wind_force;
        }

        // --- Verlet integration ---
        vel = (pos - prev_pos) * damping;
        vec3 predicted = pos + vel + accel * dt * dt;

        prev_pos = pos;
        pos = predicted;

        // --- Ground collision ---
        float ground_y = ep.dynamics.y;
        float bounce = ep.dynamics.z;
        if (pos.y < ground_y) {
            pos.y = ground_y;
            // Reflect velocity with bounce factor
            if (prev_pos.y > ground_y) {
                float penetration_vel = (prev_pos.y - ground_y);
                prev_pos.y = pos.y + penetration_vel * bounce;
            }
        }
    }

    // Write predicted position (constraints will correct it)
    states[idx].prev_position = vec4(prev_pos, 0.0);
    states[idx].position = vec4(pos, inv_mass);

    // --- Synchronize all threads before constraint solving ---
    memoryBarrierBuffer();
    barrier();

    // --- Constraint projection (iterative) ---
    for (uint iter = 0; iter < iterations; iter++) {
        // Each thread processes constraints that involve its element
        for (uint ci = 0; ci < constraint_count; ci++) {
            PbdConstraint c = constraints[ci];
            uint a = c.indices.x;
            uint b = c.indices.y;

            // Only process if this thread owns element a or b
            if (a != idx && b != idx) continue;

            float rest_length = c.params.x;
            float stiffness = c.params.y;

            vec3 pos_a = states[a].position.xyz;
            vec3 pos_b = states[b].position.xyz;
            float inv_mass_a = states[a].position.w;
            float inv_mass_b = states[b].position.w;

            vec3 delta = pos_b - pos_a;
            float dist = length(delta);
            if (dist < 1e-6) continue;

            float w_sum = inv_mass_a + inv_mass_b;
            if (w_sum < 1e-6) continue;

            float error = (dist - rest_length) / dist;
            vec3 correction = delta * error * stiffness / float(iterations);

            if (a == idx && inv_mass_a > 0.0) {
                pos = states[idx].position.xyz + correction * (inv_mass_a / w_sum);
                states[idx].position = vec4(pos, inv_mass);
            }
            if (b == idx && inv_mass_b > 0.0) {
                pos = states[idx].position.xyz - correction * (inv_mass_b / w_sum);
                states[idx].position = vec4(pos, inv_mass);
            }
        }

        memoryBarrierBuffer();
        barrier();
    }

    // --- Update velocity from position change ---
    pos = states[idx].position.xyz;
    prev_pos = states[idx].prev_position.xyz;
    vel = (pos - prev_pos) / max(dt, 1e-6);

    states[idx].velocity = vec4(vel, 0.0);

    // --- Compute rotation for preprocess shader ---
    // Derive rotation from how much this element moved from its rest direction
    // relative to its anchor (element 0 or pinned parent)
    vec4 rot = displacement_to_rotation(rest_pos, pos, rest_pos - vel * dt);

    // For wind sway compatibility: if no constraints, use wind-based rotation
    if (constraint_count == 0 && inv_mass > 0.0) {
        float wind_strength = ep.wind.w;
        vec3 wind_dir = ep.wind.xyz;
        float freq = ep.dynamics.x;
        float phase = dot(states[idx].position.xyz, vec3(0.37, 0.13, 0.71));
        float sway_angle = sin(time * freq + phase) * wind_strength;
        vec3 sway_axis = normalize(cross(normalize(wind_dir), vec3(0, 1, 0)));
        if (length(sway_axis) < 0.001) sway_axis = vec3(1, 0, 0);
        rot = axis_angle_to_quat(sway_axis, sway_angle);
    }

    // Write rotation to prev_position.w and velocity.w is unused
    // Actually, preprocess reads PbdState {position, rotation} at binding 6.
    // We need to output in the format preprocess expects.
    // The preprocess shader reads:
    //   pbd_states[].position (vec4) and pbd_states[].rotation (vec4)
    // Our PbdPhysicsState has 4 vec4s but preprocess only reads first 2 as PbdState.
    // So position (vec4 slot 0) and prev_position (vec4 slot 1) map to
    // PbdState.position and PbdState.rotation in preprocess.
    // Therefore: write rotation into prev_position slot.
    states[idx].prev_position = rot;
}
```

**Important design note:** The preprocess shader reads binding 6 as `PbdState { vec4 position; vec4 rotation; }`. Our `PbdPhysicsState` has `position` at offset 0 and `prev_position` at offset 16. After the solver finishes, we overwrite `prev_position` with the rotation quaternion, so preprocess reads `position.xyz` as the world position and the second vec4 as the rotation. This avoids changing the preprocess shader.

- [ ] **Step 2: Build to verify shader compiles**

Run: `cmake --build --preset macos-debug 2>&1 | tail -10`
Expected: Build succeeds, `pbd_solver.comp.spv` generated.

- [ ] **Step 3: Commit**

```bash
git add shaders/pbd_solver.comp
git commit -m "feat(pbd): rewrite solver with Verlet integration, constraints, ground collision"
```

---

### Task 5: Update Island Demo to Use New API

**Files:**
- Modify: `src/demo/island_demo_state.cpp`
- Modify: `src/engine/app_base.cpp`

Migrate the tree sway demo from the old `set_pbd_anchors`/`set_pbd_wind` API to the new `upload_pbd_elements`/`upload_pbd_constraints` API.

- [ ] **Step 1: Update app_base.cpp tree PBD setup**

In `src/engine/app_base.cpp`, the `pbd_anchors_` vector currently stores `glm::vec3` positions. Change it to store `PbdPhysicsState` + `PbdElementParams` pairs. Replace the anchor push in the game object merge loop:

```cpp
// Where previously: pbd_anchors_.push_back(adjusted_pos);
// Now store full physics state:
PbdPhysicsState state{};
state.position = glm::vec4(adjusted_pos, 1.0f);  // inv_mass=1 (free)
state.prev_position = glm::vec4(adjusted_pos, 0.0f);
state.velocity = glm::vec4(0.0f);
state.params = glm::vec4(sway_threshold, 0.0f, 0.0f, 0.0f);

PbdElementParams params{};
params.gravity = glm::vec4(0.0f, 0.0f, 0.0f, 0.98f);  // no gravity, 0.98 damping
params.wind = glm::vec4(1.0f, 0.0f, 0.3f, 0.06f);      // wind dir + strength
params.dynamics = glm::vec4(0.8f, -100.0f, 0.0f, 0.0f); // freq, ground_y (below scene), bounce

pbd_states_.push_back(state);
pbd_params_.push_back(params);
```

Update `app_base.hpp`: replace `std::vector<glm::vec3> pbd_anchors_` with:
```cpp
std::vector<PbdPhysicsState> pbd_states_;
std::vector<PbdElementParams> pbd_params_;
```
And the public accessor:
```cpp
const std::vector<PbdPhysicsState>& pbd_states() const { return pbd_states_; }
const std::vector<PbdElementParams>& pbd_params() const { return pbd_params_; }
```

- [ ] **Step 2: Update island_demo_state.cpp PBD setup**

Replace the old `set_pbd_anchors` / `set_pbd_wind` calls:

```cpp
    // Set up PBD solver for tree sway
    {
        const auto& states = app.pbd_states();
        const auto& params = app.pbd_params();
        if (!states.empty()) {
            app.renderer().gs_renderer().upload_pbd_elements(
                states.data(), params.data(),
                static_cast<uint32_t>(states.size()));
            // No constraints for wind sway (procedural mode)
            std::fprintf(stderr, "[IslandDemo] PBD: %zu elements uploaded\n", states.size());
        }
    }
```

- [ ] **Step 3: Build and run**

Run: `cmake --build --preset macos-release 2>&1 | tail -5`
Expected: Build succeeds. Tree sway should still work (the solver falls back to wind-based rotation when `constraint_count == 0`).

- [ ] **Step 4: Commit**

```bash
git add include/gseurat/engine/app_base.hpp src/engine/app_base.cpp src/demo/island_demo_state.cpp
git commit -m "refactor(pbd): migrate island demo to new physics-based PBD API"
```

---

### Task 6: Update Existing Tests

**Files:**
- Modify: `tests/test_pbd_solver.cpp`

Update the existing struct layout test to use `PbdPhysicsState` instead of the old `GsRenderer::PbdState`. Remove references to the deleted type.

- [ ] **Step 1: Fix compile errors in existing tests**

Replace the old `test_pbd_state_layout` function:

```cpp
static void test_pbd_state_layout() {
    std::printf("=== PbdPhysicsState struct layout ===\n");
    using namespace gseurat;

    check(sizeof(PbdPhysicsState) == 64, "PbdPhysicsState is 64 bytes (4 x vec4)");
    check(kMaxPbdElements == 64, "kMaxPbdElements is 64");
    check(kMaxPbdConstraints == 128, "kMaxPbdConstraints is 128");
}
```

Remove or update any test that references `GsRenderer::PbdState` or `GsRenderer::kMaxPbdElements`.

- [ ] **Step 2: Run full test suite**

Run: `cmake --build --preset macos-debug && ctest --test-dir build/macos-debug --output-on-failure 2>&1 | tail -10`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/test_pbd_solver.cpp
git commit -m "test(pbd): update tests for new PbdPhysicsState types"
```

---

### Task 7: Integration Test — Dangling Chain Demo

**Files:**
- Modify: `src/demo/island_demo_state.cpp`

Add a simple dangling chain (3 elements, 2 distance constraints, top element pinned) to verify the full constraint pipeline works. This can be activated with a key toggle (e.g., J key).

- [ ] **Step 1: Add chain demo**

In `island_demo_state.cpp`, add a method and key handler to spawn a short PBD chain:

```cpp
// In update(), after the N key handler:
    // J → toggle PBD chain demo
    if (app.input().was_key_pressed(GLFW_KEY_J)) {
        if (pbd_chain_active_) {
            app.renderer().gs_renderer().clear_pbd();
            pbd_chain_active_ = false;
            std::fprintf(stderr, "[IslandDemo] PBD chain demo OFF\n");
        } else {
            // 3-element chain: top pinned, middle and bottom free
            glm::vec3 top = character_origin_ + glm::vec3(3, 8, 0);
            PbdPhysicsState states[3];
            PbdElementParams params[3];

            for (int i = 0; i < 3; ++i) {
                glm::vec3 p = top - glm::vec3(0, i * 3.0f, 0);
                states[i].position = glm::vec4(p, i == 0 ? 0.0f : 1.0f); // top pinned
                states[i].prev_position = glm::vec4(p, 0.0f);
                states[i].velocity = glm::vec4(0.0f);
                states[i].params = glm::vec4(0.0f);

                params[i].gravity = glm::vec4(0, -9.8f, 0, 0.98f);
                params[i].wind = glm::vec4(0.0f);
                params[i].dynamics = glm::vec4(0, top.y - 10.0f, 0.3f, 0);
            }

            PbdConstraint constraints[2];
            constraints[0].indices = glm::uvec4(0, 1, 0, 0);
            constraints[0].params = glm::vec4(3.0f, 0.8f, 0, 0); // rest=3, stiffness=0.8
            constraints[1].indices = glm::uvec4(1, 2, 0, 0);
            constraints[1].params = glm::vec4(3.0f, 0.8f, 0, 0);

            app.renderer().gs_renderer().upload_pbd_elements(states, params, 3);
            app.renderer().gs_renderer().upload_pbd_constraints(constraints, 2);
            pbd_chain_active_ = true;
            std::fprintf(stderr, "[IslandDemo] PBD chain demo ON (3 elements, 2 constraints)\n");
        }
    }
```

Add `bool pbd_chain_active_ = false;` to the header's private section.

Note: This chain demo won't have visible Gaussians attached unless you also tag some Gaussians with `bone_index` 32-34. For initial testing, verify via stderr logs that the solver dispatches without GPU errors. Visual attachment of Gaussians to chain elements can come in a follow-up task.

- [ ] **Step 2: Build and test**

Run: `cmake --build --preset macos-release 2>&1 | tail -5`
Expected: Build succeeds. Launch demo, press J, verify "[IslandDemo] PBD chain demo ON" in logs and no GPU crash.

- [ ] **Step 3: Commit**

```bash
git add src/demo/island_demo_state.cpp include/gseurat/demo/island_demo_state.hpp
git commit -m "feat(pbd): add dangling chain demo (J key) for constraint testing"
```

---

### Task 8: Update Documentation

**Files:**
- Modify: `docs/pbd-solver.md`

Update the PBD documentation to reflect the new physics-based architecture.

- [ ] **Step 1: Update docs**

Key sections to update in `docs/pbd-solver.md`:
- **Architecture diagram**: show the new buffers (state, params, constraints)
- **GPU buffers**: document `PbdPhysicsState` (64 bytes), `PbdElementParams` (48 bytes), `PbdConstraint` (32 bytes)
- **Solver algorithm**: describe the Verlet → predict → constrain → velocity pipeline
- **C++ API**: document `upload_pbd_elements()`, `upload_pbd_constraints()`, `clear_pbd()`
- **Parameters table**: gravity, damping, stiffness, wind, ground_y, bounce
- **Constraint types**: distance constraints with rest_length and stiffness
- **Backward compatibility**: note that wind sway still works when `constraint_count == 0`

- [ ] **Step 2: Commit**

```bash
git add docs/pbd-solver.md
git commit -m "docs(pbd): update for physics-based solver architecture"
```
