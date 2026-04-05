# PBD Solver — GPU-Driven Position Based Dynamics

## Overview

The PBD solver adds a GPU-driven physics simulation pipeline for Gaussian Splatting objects that need dynamic motion — swaying trees, rustling foliage, flapping banners, etc. It runs as a compute shader dispatched **before** the GS preprocess pass, writing per-element position and rotation deltas that the preprocess shader consumes.

## The Rotation Trap

In 3DGS, each Gaussian has a position and a rotation quaternion that defines its orientation. Naive physics simulation that only updates position causes Gaussians to translate while keeping their original orientation, visually tearing apart structured objects like branches and leaves.

The PBD solver avoids this by providing **both position anchors and rotation quaternions**. The preprocess shader:
1. Rotates each Gaussian's local offset (relative to its anchor) by the PBD quaternion
2. Composes the PBD rotation with the Gaussian's original rotation

This preserves rigid-body structure during bending and swaying.

## Architecture

```
CPU (per frame)                    GPU Pipeline
────────────────                   ──────────────────────────────────
set_pbd_anchors()  ──►  pbd_ssbo_
set_pbd_wind()     ──►  pbd_ubo_
                                   ┌─────────────────┐
                                   │  pbd_solver.comp │  Phase 0 (new)
                                   │  writes rotation │
                                   │  + position      │
                                   └────────┬────────┘
                                            │ barrier
                                   ┌────────▼────────┐
                                   │ gs_preprocess    │  Phase 1-2
                                   │ reads pbd_states │
                                   │ at binding 6     │
                                   └────────┬────────┘
                                            │
                                   ┌────────▼────────┐
                                   │ sort → merge →   │  Phase 3-4
                                   │ tile rasterize   │
                                   └─────────────────┘
```

## Index Segmentation

The `bone_index` field in each Gaussian (packed into `GpuGaussian.scale_pad.w` as a float-encoded uint32) determines how it is transformed:

| Range | Behavior | Maps to |
|-------|----------|---------|
| 0 | No transform | Pass-through |
| 1 - 31 | Bone skinning | `bone_transforms[bone_idx]` |
| 32 - 63 | PBD dynamics | `pbd_states[bone_idx - 32]` |

This gives 32 PBD elements, each controlling a group of Gaussians. A single PBD element (e.g., index 32) can drive hundreds of Gaussians — all foliage Gaussians belonging to one tree branch would share the same PBD index.

## GPU Buffers

### PbdState SSBO (binding 6 in preprocess)

```glsl
struct PbdState {
    vec4 position;  // xyz = anchor position, w = unused
    vec4 rotation;  // xyzw = delta quaternion (identity = no change)
};

layout(set = 0, binding = 6) readonly buffer PbdBuffer {
    PbdState pbd_states[];  // max 32 elements
};
```

- 32 bytes per element, 1024 bytes total
- The PBD solver writes rotation quaternions; the preprocess shader reads them
- Identity quaternion `(0, 0, 0, 1)` = no rotation applied

### PBD Uniforms (binding 1 in solver)

```glsl
layout(set = 0, binding = 1) uniform PbdUniforms {
    vec4 params;    // x = time, y = wind_strength, z = wind_freq, w = pbd_count
    vec4 wind_dir;  // xyz = normalized wind direction, w = unused
};
```

## Preprocess Shader Integration

In `gs_preprocess.comp`, the PBD path applies anchor-relative rotation:

```glsl
if (bone_idx >= 32 && bone_idx < 64) {
    uint pbd_idx = bone_idx - 32;
    PbdState pbd = pbd_states[pbd_idx];
    vec4 pbd_q = normalize(pbd.rotation);

    // Rotate local offset around anchor point
    vec3 local_offset = pos - pbd.position.xyz;
    vec3 t = 2.0 * cross(pbd_q.xyz, local_offset);
    pos = pbd.position.xyz + local_offset + pbd_q.w * t + cross(pbd_q.xyz, t);

    // Compose with original Gaussian rotation
    rot_q = quat_mul(pbd_q, rot_q);
}
```

The vector rotation uses the optimized quaternion rotation formula (`q * v * q^-1` expanded) — no matrix conversion needed.

## PBD Solver Shader

`pbd_solver.comp` currently implements a wind sway placeholder:

- Each PBD element receives a sinusoidal oscillation based on its anchor position
- The sway axis is perpendicular to wind direction and world up
- Spatial phase variation via `dot(anchor, hash_vec)` prevents synchronized motion
- Output: axis-angle quaternion written to `pbd_states[].rotation`

This is designed to be replaced or extended with a full PBD constraint solver (distance constraints, bending constraints, collision) when needed.

## C++ API

```cpp
// Set anchor positions for PBD elements (max 32)
// Each anchor is the pivot point around which attached Gaussians rotate
gs_renderer.set_pbd_anchors(anchors, count);

// Configure wind parameters
gs_renderer.set_pbd_wind(
    glm::vec3(1, 0, 0),  // wind direction
    0.3f,                  // strength (max sway angle in radians)
    2.0f                   // frequency (oscillations per second)
);

// Reset all PBD state to identity (no simulation)
gs_renderer.clear_pbd();
```

## Assigning PBD Indices to Gaussians

When creating Gaussian data (e.g., in scene loading or procedural generation), set `bone_index` to values in the 32-63 range:

```cpp
Gaussian g;
g.position = glm::vec3(10, 5, 0);
g.bone_index = 32;  // First PBD element — tree trunk
// Other Gaussians on the same branch also use bone_index = 32
```

Multiple Gaussians sharing the same PBD index move as a rigid group around the anchor point. Use different indices (32, 33, 34, ...) for independently moving parts (e.g., separate branches).

## Dispatch Order

The PBD solver is dispatched as **Phase 0** in the GS compute pipeline:

1. **Phase 0**: PBD solver (if `pbd_count_ > 0`) — writes `pbd_states[]`
2. Memory barrier (`SHADER_WRITE → SHADER_READ`)
3. **Phase 1**: Dynamic preprocess + sort
4. **Phase 2**: Static preprocess + sort (if dirty)
5. **Phase 3**: Merge
6. **Phase 4**: Tile rasterization
7. Post-process

When `pbd_count_ == 0`, Phase 0 is skipped entirely — zero overhead for scenes without PBD.

## Testing

`test_pbd_solver` validates the CPU-side contracts without requiring a GPU:

| Test | What it verifies |
|------|------------------|
| PbdState layout | 32 bytes, correct field offsets for GPU std430 |
| Index segmentation | Round-trip encoding, correct range routing (0/1-31/32-63) |
| Quaternion multiplication | Identity, composition, unit length preservation |
| Quaternion-vector rotation | Axis rotations, magnitude preservation |
| PBD transform composition | Anchor-relative rotation, rigid-body distance preservation |
| Axis-angle conversion | Zero angle → identity, unit length, 180deg edge case |
| Wind sway output | Unit quaternions, bounded angles, spatial variation |

```bash
ctest --test-dir build/macos-debug -R test_pbd_solver
```

## Future Extensions

The current wind sway placeholder establishes the GPU pipeline. Future work may include:

- **Distance constraints**: maintain rest-length between connected PBD elements (chain/rope simulation)
- **Bending constraints**: resist angular change between parent-child elements (stiff branches)
- **Collision constraints**: prevent PBD elements from penetrating terrain or other objects
- **Multi-iteration solver**: multiple constraint projection passes per frame for stability
- **Scale/covariance updates**: soft-body deformation (stretching, squashing) for advanced VFX
