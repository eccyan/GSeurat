# PBD Solver -- GPU-Driven Position Based Dynamics

## Overview

Position Based Dynamics (PBD) is a physics simulation method that works directly on particle positions rather than forces and accelerations. The GSeurat PBD solver runs as a GPU compute shader, enabling physically plausible motion for Gaussian Splatting objects: swaying foliage, dangling chains, falling objects, flapping flags, and more.

The solver implements Verlet integration for time-stepping, iterative distance constraint projection for connectivity, and ground plane collision. It dispatches before the GS preprocess pass, writing per-element positions and rotations that the preprocess shader consumes to transform attached Gaussians.

## Architecture

```
CPU (per frame)                         GPU Pipeline
------------------------------------    ------------------------------------------
upload_pbd_elements()  -->  states_ssbo_    (binding 0, read/write)
                       -->  params_ssbo_    (binding 1, read-only)
upload_pbd_constraints() -> constraints_ssbo_ (binding 2, read-only)
                            pbd_ubo_        (binding 3, time/dt/iterations/counts)

                                        +---------------------+
                                        |  pbd_solver.comp    |  Phase 0
                                        |  Verlet predict     |
                                        |  ground collision   |
                                        |  constraint project |
                                        |  rotation output    |
                                        +---------+-----------+
                                                  | barrier (SHADER_WRITE -> SHADER_READ)
                                        +---------+-----------+
                                        | gs_preprocess.comp  |  Phase 1-2
                                        | reads pbd_states[]  |
                                        | at binding 6        |
                                        +---------+-----------+
                                                  |
                                        +---------+-----------+
                                        | sort -> merge ->    |  Phase 3-4
                                        | tile rasterize      |
                                        +---------------------+
```

The preprocess shader sees PBD output as a `PbdState { vec4 position; vec4 rotation; }` at binding 6. The solver writes the rotation quaternion into the `prev_position` slot of `PbdPhysicsState`, which aligns with the `rotation` field of the preprocess `PbdState` struct (both are the second vec4).

## GPU Buffers

### PbdPhysicsState (binding 0, read/write, 64 bytes)

```glsl
struct PbdPhysicsState {
    vec4 position;       // xyz = current position, w = inv_mass (0 = pinned)
    vec4 prev_position;  // xyz = previous frame position, w = unused
    vec4 velocity;       // xyz = current velocity, w = unused
    vec4 params;         // x = sway_threshold, yzw = reserved
};
```

- **inv_mass** (position.w): Inverse mass. Zero means pinned (immovable anchor). Positive values allow motion; higher values = lighter.
- **prev_position**: Used for Verlet velocity estimation. After the solver finishes, this slot is overwritten with the output rotation quaternion for the preprocess shader.
- Max elements: 64 (`kMaxPbdElements`)

### PbdElementParams (binding 1, read-only, 48 bytes)

```glsl
struct PbdElementParams {
    vec4 gravity;   // xyz = gravity vector, w = damping (0-1)
    vec4 wind;      // xyz = wind direction, w = wind_strength
    vec4 dynamics;  // x = wind_frequency, y = ground_y, z = bounce, w = unused
};
```

Each element has its own gravity, wind, and collision parameters, allowing different behavior per object (e.g., heavy chains vs. light foliage).

### PbdConstraint (binding 2, read-only, 32 bytes)

```glsl
struct PbdConstraint {
    uvec4 indices;  // x = element_a, y = element_b, zw = unused
    vec4 params;    // x = rest_length, y = stiffness (0-1), zw = unused
};
```

Distance constraints maintain a target rest length between two elements. Max constraints: 128 (`kMaxPbdConstraints`).

### PBD Uniforms (binding 3)

```glsl
layout(set = 0, binding = 3) uniform PbdUniforms {
    float time;              // elapsed time (for wind phase)
    float dt;                // frame delta time
    uint  iterations;        // constraint solver iterations (default 4)
    uint  count;             // number of active elements
    uint  constraint_count;  // number of active constraints
    uint  pad0, pad1, pad2;  // alignment padding
};
```

## Solver Algorithm

The solver executes in a single compute dispatch (`local_size_x = 64`). Each thread processes one PBD element:

1. **External forces**: Accumulate gravity and sinusoidal wind force. Wind uses per-element phase variation via `dot(pos, hash_vec)` to prevent synchronized motion.

2. **Verlet integration**: Predict the next position from the current and previous positions:
   ```
   velocity = (position - prev_position) * damping
   predicted = position + velocity + acceleration * dt^2
   ```

3. **Ground collision**: If `predicted.y < ground_y`, clamp to the ground plane. Reflect the previous position above ground scaled by the bounce coefficient for restitution.

4. **Write predicted position** and synchronize (`memoryBarrierBuffer` + `barrier`).

5. **Constraint projection** (N iterations, default 4): For each constraint involving this element, compute the position correction:
   ```
   error = (distance - rest_length) / distance
   correction = delta * error * stiffness / iterations
   ```
   Corrections are distributed between the two elements proportional to their inverse masses. Each iteration is followed by a barrier.

6. **Velocity update**: Derive the post-solve velocity from the position change: `velocity = (position - prev_position) / dt`.

7. **Rotation output**: Compute a quaternion and write it into `prev_position` for the preprocess shader:
   - In wind sway mode (no constraints): procedural sine-wave axis-angle rotation
   - In constraint mode: velocity-derived tilt rotation (lean in direction of movement, capped at ~28 degrees)
   - Pinned elements: identity quaternion (no rotation)

## Index Segmentation

The `bone_index` field in each Gaussian determines how it is transformed by the preprocess shader:

| Range | Behavior | Maps to |
|-------|----------|---------|
| 0 | No transform | Pass-through |
| 1-31 | Bone skinning | `bone_transforms[bone_idx]` |
| 32-63 | PBD dynamics | `pbd_states[bone_idx - 32]` |

A single PBD element can drive hundreds of Gaussians. All foliage Gaussians belonging to one tree branch share the same PBD index. Set `bone_index` to values 32-63 when creating Gaussian data.

## C++ API

```cpp
#include <gseurat/engine/pbd_types.hpp>

// Upload element states and per-element parameters (max kMaxPbdElements = 64)
gs_renderer.upload_pbd_elements(states, params, count);

// Upload distance constraints (max kMaxPbdConstraints = 128)
gs_renderer.upload_pbd_constraints(constraints, count);

// Reset all PBD state (zero elements and constraints)
gs_renderer.clear_pbd();

// Query
gs_renderer.pbd_count();             // active element count
gs_renderer.pbd_constraint_count();  // active constraint count
```

## Parameters Reference

| Parameter | Location | Description | Typical Value |
|-----------|----------|-------------|---------------|
| inv_mass | PbdPhysicsState.position.w | Inverse mass (0 = pinned/anchor) | 0.0 (pinned) or 1.0 |
| gravity | PbdElementParams.gravity.xyz | Gravity acceleration vector | (0, -9.8, 0) |
| damping | PbdElementParams.gravity.w | Velocity damping per frame (0 = full damp, 1 = none) | 0.98 |
| wind_dir | PbdElementParams.wind.xyz | Wind direction (normalized) | (1, 0, 0) |
| wind_strength | PbdElementParams.wind.w | Wind force amplitude | 0.3 |
| wind_freq | PbdElementParams.dynamics.x | Wind oscillation frequency | 2.0 |
| ground_y | PbdElementParams.dynamics.y | Ground collision plane Y | -100.0 (disabled) |
| bounce | PbdElementParams.dynamics.z | Restitution coefficient (0-1) | 0.3 |
| rest_length | PbdConstraint.params.x | Target distance between elements | Varies |
| stiffness | PbdConstraint.params.y | Constraint stiffness (0-1) | 0.8 |

## Wind Sway Mode

When `constraint_count == 0`, the solver falls back to a backward-compatible wind sway mode. Instead of deriving rotation from velocity, it generates procedural sine-wave rotations from the wind parameters -- the same visual behavior as the original pre-physics placeholder. This means existing scenes that only use `upload_pbd_elements()` without constraints continue to work unchanged.

## Dispatch Order

The PBD solver is dispatched as **Phase 0** in the GS compute pipeline:

1. **Phase 0**: PBD solver (if `pbd_count_ > 0`) -- writes element states
2. Memory barrier (`SHADER_WRITE -> SHADER_READ`)
3. **Phase 1**: Dynamic preprocess + sort
4. **Phase 2**: Static preprocess + sort (if dirty)
5. **Phase 3**: Merge
6. **Phase 4**: Tile rasterization
7. Post-process

When `pbd_count_ == 0`, Phase 0 is skipped entirely -- zero overhead for scenes without PBD.

## Demo Controls

- **J key** (island demo): Toggles a dangling chain demo. Spawns 3 PBD elements (1 pinned anchor + 2 free-hanging) connected by 2 distance constraints near the player character. Press J again to clear.

## Testing

`test_pbd_solver` validates CPU-side contracts without requiring a GPU:

| Test | What it verifies |
|------|------------------|
| PbdPhysicsState layout | 64 bytes, correct field offsets for GPU std430 |
| PbdElementParams layout | 48 bytes, correct field offsets |
| PbdConstraint layout | 32 bytes, correct field offsets |
| Index segmentation | Round-trip encoding, correct range routing (0/1-31/32-63) |
| Quaternion multiplication | Identity, composition, unit length preservation |
| Quaternion-vector rotation | Axis rotations, magnitude preservation |
| PBD transform composition | Anchor-relative rotation, rigid-body distance preservation |
| Axis-angle conversion | Zero angle -> identity, unit length, 180deg edge case |
| Verlet integration | Position prediction with gravity and damping |
| Constraint projection | Distance correction, mass-weighted distribution, pinned elements |

```bash
ctest --test-dir build/macos-debug -R test_pbd_solver
```

## Scene Format

PBD behavior is configured per game object via the optional `pbd` block in scene JSON. This replaces the earlier hardcoded tree detection that inferred sway behavior from object names.

### Wind Sway Mode

For foliage and gentle oscillation, use `"mode": "wind_sway"`:

```json
{
  "id": "oak_tree", "name": "Oak Tree",
  "position": [10, 0, 15], "ply_file": "assets/props/tree.ply",
  "pbd": {
    "mode": "wind_sway",
    "wind_strength": 0.06,
    "wind_frequency": 0.8,
    "wind_direction": [1, 0, 0],
    "sway_threshold": 0.7
  }
}
```

### Physics Mode

For constraint-based dynamics (chains, pendulums, hanging objects), use `"mode": "physics"`:

```json
{
  "id": "chain_anchor", "name": "Chain Anchor",
  "position": [5, 10, 5], "ply_file": "assets/props/chain_link.ply",
  "pbd": {
    "mode": "physics",
    "pinned": true,
    "gravity": [0, -9.8, 0],
    "damping": 0.98,
    "constraints": [
      { "target": "chain_link_1", "rest_length": 2.0, "stiffness": 0.9 }
    ]
  }
}
```

### Field Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mode` | `"wind_sway"` \| `"physics"` | *(required)* | Simulation mode |
| `sway_threshold` | number | 0.7 | Height fraction above which Gaussians sway (wind_sway mode) |
| `wind_direction` | vec3 | [1, 0, 0] | Wind direction vector |
| `wind_strength` | number | 0.06 | Wind force amplitude |
| `wind_frequency` | number | 0.8 | Wind oscillation frequency |
| `gravity` | vec3 | [0, -9.8, 0] | Gravity acceleration (physics mode) |
| `damping` | number | 0.98 | Velocity damping per frame (0 = full damp, 1 = none) |
| `ground_y` | number | -1000 | Ground collision plane Y (-1000 effectively disables) |
| `bounce` | number | 0.3 | Restitution coefficient (0-1) |
| `pinned` | boolean | false | If true, element is an immovable anchor (inv_mass = 0) |
| `constraints` | array | [] | Distance constraints to other game objects (physics mode) |
| `constraints[].target` | string | *(required)* | ID of the connected game object |
| `constraints[].rest_length` | number | 3.0 | Target distance between elements |
| `constraints[].stiffness` | number | 0.8 | Constraint stiffness (0-1) |

### Replacing Hardcoded Tree Detection

Before the `pbd` block, the engine used heuristic name matching (e.g., objects named "tree" or "palm") to decide which game objects received wind sway. This was fragile and prevented non-tree objects from using PBD.

Now, the scene loader checks `GameObjectData.pbd` directly. If present, the config drives PBD element setup. If absent, the object has no PBD behavior -- no name-based guessing.

### Mutual Exclusion with GS Animations

PBD elements use `bone_index` values 32-63 (see [Index Segmentation](#index-segmentation)). The GS animation system (`GsAnimator`) skips any Gaussian with `bone_index >= 32`, ensuring PBD-driven Gaussians are never double-transformed by both the animation and physics systems.

### Bricklayer UI

The Bricklayer map editor (port 5180) exposes PBD configuration in the game object inspector panel. When a game object has a PLY file, a **PBD Mode** dropdown appears with three options: *None*, *Wind Sway*, and *Physics*. Selecting a mode reveals the relevant parameter fields. Changes are saved into the `pbd` block of the scene JSON.

## Future Extensions

- **Bending constraints**: Resist angular change between three connected elements (stiff branches, hair)
- **Cloth grids**: 2D constraint grids for flags and fabric simulation
- **Bricklayer UI**: Visual PBD element placement, constraint wiring, parameter tuning in the map editor
- **Scale/covariance updates**: Soft-body deformation (stretching, squashing) for advanced VFX
- **Self-collision**: Prevent PBD elements from overlapping each other
