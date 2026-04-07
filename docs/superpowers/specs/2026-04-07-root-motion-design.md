# Root Motion for 3DGS Characters

**Date:** 2026-04-07
**Status:** Approved

## Problem

The current animation system is rotation-only at every layer: poses store per-bone Euler angles, the FK chain produces rotation-around-joint transforms, and character world position is driven entirely by player input. There is no mechanism to extract movement from animation data and apply it to the actor's world transform. This means walk cycles are cosmetic — legs swing but position comes from keyboard input, making it impossible to synchronize foot-to-ground contact or author animation-driven movement (dodge rolls, attack lunges, cinematic sequences).

## Solution

Implement a Root Motion system in three phases:

- **Phase 1 (Core Transform Logic):** Extend pose data with root bone translation, extract per-frame position/rotation deltas from the animation player, strip the root transform before FK, and let game states consume deltas via a hybrid model. Full Echidna authoring UI included.
- **Phase 2 (Covariance Rotation):** Apply the actor's accumulated world rotation to individual Gaussian quaternions/covariance matrices in the preprocess compute shader.
- **Phase 3 (SH Rotation):** Rotate spherical harmonic coefficients using Wigner D-matrices when higher-order SH bands are present.

This spec covers Phase 1 in full detail, with architectural provisions for Phases 2 and 3.

## Root Bone Convention

The first bone with `parent_index == -1` (i.e., `parent: null` in the manifest) is the root motion bone. This matches the existing single-root pattern — most characters have one root (e.g., "torso"). No additional fields or virtual bones are required.

## Data Structures

### Engine — `character_manifest.hpp`

**PoseData extension:**

```cpp
struct PoseData {
    std::string name;
    std::vector<glm::vec3> rotations;  // Per-bone Euler degrees (existing)
    glm::vec3 root_position{0.0f};     // Root bone world-space offset (NEW)
};
```

**AnimationClip extension:**

```cpp
struct AnimationClip {
    std::string name;
    float duration = 1.0f;
    bool looping = true;
    std::vector<AnimKeyframe> keyframes;
    bool root_motion = false;  // NEW: opt-in per clip
};
```

**BoneAnimationPlayer — new members:**

```cpp
class BoneAnimationPlayer {
public:
    // Existing API unchanged...

    // NEW: Root motion delta access (hybrid model)
    glm::vec3 delta_position() const;
    glm::quat delta_rotation() const;
    void reset_root_motion();

private:
    // NEW: Root motion state
    glm::vec3 prev_root_position_{0.0f};
    glm::quat prev_root_rotation_{1.0f, 0.0f, 0.0f, 0.0f};
    glm::vec3 frame_delta_position_{0.0f};
    glm::quat frame_delta_rotation_{1.0f, 0.0f, 0.0f, 0.0f};
};
```

The raw animation data (`PoseData`) remains stateless. The playback instance (`BoneAnimationPlayer`) owns the temporal state (`prev_root_position_`, `prev_root_rotation_`). This allows multiple entities to share the same `CharacterData` while playing back at different times.

### Echidna — `types.ts`

```typescript
interface PoseData {
  rotations: Record<string, [number, number, number]>;  // Existing
  rootPosition?: [number, number, number];               // NEW
}

interface AnimationClip {
  name: string;
  keyframes: AnimationKeyframe[];
  duration: number;
  playbackMode: PlaybackMode;
  rootMotion?: boolean;  // NEW: opt-in per clip
}
```

### Schema — `character_manifest.schema.json`

Poses gain an optional `root_position`:

```json
"root_position": {
  "type": "array",
  "items": { "type": "number" },
  "minItems": 3,
  "maxItems": 3,
  "description": "Root bone world-space translation offset [x, y, z]"
}
```

Animation clips gain an optional `root_motion`:

```json
"root_motion": {
  "type": "boolean",
  "default": false,
  "description": "When true, root bone delta drives actor world position"
}
```

### Manifest JSON Example

```json
{
  "poses": {
    "walk_1": {
      "left_arm": [8, 0, 0],
      "right_arm": [-8, 0, 0],
      "root_position": [0, 0, 0.5]
    },
    "walk_2": {
      "left_arm": [-8, 0, 0],
      "right_arm": [8, 0, 0],
      "root_position": [0, 0, 1.0]
    }
  },
  "animations": {
    "walk": {
      "duration": 0.6,
      "looping": true,
      "root_motion": true,
      "keyframes": [
        { "time": 0.0, "pose": "walk_1" },
        { "time": 0.3, "pose": "walk_2" },
        { "time": 0.6, "pose": "walk_1" }
      ]
    }
  }
}
```

## Delta Extraction

### Update Flow in `BoneAnimationPlayer::update(dt)`

1. Advance `playback_time_` by `dt`
2. Detect loop wrap-around
3. Interpolate current keyframe pair → raw root position + root Euler rotation
4. Convert root Euler to quaternion **immediately** (before any delta math — avoids gimbal lock)
5. Compute deltas with loop-aware math
6. Update `prev_` state
7. Strip root: set root bone local transform to identity
8. Compute FK chain for remaining bones

### Normal Delta (No Loop)

```
ΔP = pos_current - pos_previous
ΔR = q_current × q_previous⁻¹
```

### Loop Wrap-Around Delta

When the animation loops, the root bone snaps from its end-of-track position back to the start. A naive `current - prev` would produce a massive backward delta. Instead:

```
delta_end_pos   = end_pos - prev_pos        // Distance remaining to end of track
delta_start_pos = cur_pos - start_pos       // Distance from start to current position
ΔP = delta_end_pos + delta_start_pos

delta_end_rot   = end_rot × prev_rot⁻¹     // Rotation to end of track
delta_start_rot = cur_rot × start_rot⁻¹    // Rotation from start
ΔR = delta_start_rot × delta_end_rot       // Apply end first, then start (GLM order)
```

The quaternion multiplication order is critical: `delta_start * delta_end` applies `delta_end` first (completing the rotation to the end of the track), then `delta_start` (rotation from the start of the new cycle). This is correct GLM/standard quaternion convention where `Q_A × Q_B` applies `Q_B` first.

**Multi-loop edge case:** If `dt > clip.duration` (severe hitch), one loop's worth of delta is lost. Acceptable for standard gameplay. If fast-forward/timescale support is needed later, multiply the full-track delta `(end - start)` by the loop count.

### Root Stripping in `compute_transforms()`

When computing the FK chain, the root bone (first bone with `parent_index == -1`) gets identity instead of its interpolated local transform:

```cpp
if (parent < 0 && strip_root) {
    transforms_[i] = glm::mat4(1.0f);  // Identity — motion stripped
} else if (parent < 0) {
    transforms_[i] = local;             // No root motion — keep local
} else {
    transforms_[i] = transforms_[parent] * local;  // FK chain
}
```

This anchors the skeleton to the Splat Cloud's local origin. World-space movement comes from the game state applying deltas to the actor transform.

### `reset_root_motion()`

Called on clip transitions (by `BoneAnimationStateMachine`) and teleports:

```cpp
void BoneAnimationPlayer::reset_root_motion() {
    auto& first_pose = poses[clip.keyframes[0].pose_index];
    prev_root_position_ = first_pose.root_position;
    prev_root_rotation_ = euler_to_quat(first_pose.rotations[0]);
    frame_delta_position_ = glm::vec3(0.0f);
    frame_delta_rotation_ = glm::quat(1.0f, 0.0f, 0.0f, 0.0f);
}
```

## Game State Integration (Hybrid Model)

The animation player is a pure data provider. It computes `delta_position()` and `delta_rotation()` every frame regardless. The game state (consumer) decides whether to apply them.

### `IslandDemoState` Changes

**New member:**

```cpp
glm::quat character_rotation_{1.0f, 0.0f, 0.0f, 0.0f};
```

When root motion is inactive, `character_rotation_` is derived from the input-driven `facing_angle_`. When root motion takes over, the quaternion accumulates deltas and becomes the source of truth.

**Consumer logic:**

```cpp
if (clip.root_motion) {
    // Delta position rotated by current world orientation
    glm::vec3 world_delta = character_rotation_ * anim_player_->delta_position();
    character_origin_ += world_delta;

    // Accumulate rotation delta
    character_rotation_ = glm::normalize(
        character_rotation_ * anim_player_->delta_rotation());

    // Sync facing_angle_ for systems that need a scalar angle
    facing_angle_ = glm::yaw(character_rotation_);
} else {
    // Input-driven movement (existing behavior)
    character_origin_ += player_velocity_ * dt;
    character_rotation_ = glm::angleAxis(facing_angle_, glm::vec3(0, 1, 0));
}
```

Using `character_rotation_` (not a static `facing_angle_`) to rotate the delta position is essential: if the animation rotates the root bone (e.g., a 90-degree turn), the accumulated quaternion ensures subsequent translation deltas are oriented correctly in world space.

**Updated `to_world` matrix:**

```cpp
glm::mat4 to_world =
    glm::translate(glm::mat4(1.0f), character_origin_ + y_off) *
    glm::mat4_cast(character_rotation_) *  // Was: rotate(facing_angle_)
    glm::scale(glm::mat4(1.0f), scale_vec);
```

This `to_world` is baked into each bone transform before GPU upload, so the preprocess shader receives correctly oriented world-space transforms without any shader changes in Phase 1.

## Echidna UI

### Pose Panel — Root Position Input

In `AnimateRightPanel.tsx`, when the selected bone is the first root bone (first part with `parent: null`), display 3 number inputs:

```
Root Position
  X: [___]  Y: [___]  Z: [___]
```

- Edits `pose.rootPosition` for the currently selected pose
- Non-root bones do not show this field
- Default is `[0, 0, 0]` when `rootPosition` is undefined

### Clip Settings — Root Motion Checkbox

An explicit "Enable Root Motion" checkbox in the animation/clip settings area:

- Defaults to unchecked
- Completely decoupled from whether `rootPosition` values are non-zero
- This is intentional: sometimes animators use root translation for visual effect (floating idle, hit reaction) without wanting it to drive the physics capsule

### Timeline — Root Motion Badge

Clips with `rootMotion: true` show a small indicator badge, so the author can see at a glance which clips drive world-space movement.

### Viewport Preview — Accumulated Motion

During animation playback:

- Accumulate root position deltas (translated by accumulated rotation) into a preview offset
- Accumulate root rotation deltas into preview rotation
- Apply both to the entire voxel mesh group each frame
- On loop: continue accumulating (character walks forward continuously)
- On playback stop: reset to origin

The viewport preview uses the same loop-aware delta math as the engine (delta_start * delta_end for quaternions, segmented addition for position) to ensure WYSIWYG.

### Manifest Export — `manifestExport.ts`

- Per-pose entries include `root_position: [x, y, z]` when non-zero
- Per-clip entries include `root_motion: true` when the checkbox is enabled
- Backwards compatible: existing manifests without these fields load and behave identically

## GPU Pipeline (Phase 1 scope)

### No shader changes in Phase 1

The root bone's transform is stripped to identity on the CPU. The `to_world` matrix (encoding `character_rotation_`) is baked into each bone transform before upload. The preprocess shader applies bone transforms as before — root-bone Gaussians get identity (no movement in local space), child bones get correctly oriented world-space transforms.

### Phase 2 prep: Covariance Rotation

The `character_rotation_` quaternion accumulated in the game state is the value Phase 2 needs. Upload as a uniform or per-actor buffer element. The preprocess shader multiplies each Gaussian's quaternion by this global rotation → covariance matrices rotate correctly.

### Phase 3 prep: SH Rotation

Same `character_rotation_` quaternion, used to build Wigner D-matrices applied to SH coefficients per Gaussian. Band-0 (DC) SH is rotationally invariant, so Phase 3 becomes relevant only when higher-order SH bands are loaded from photogrammetric PLY files.

## Files Changed

| File | Change | Phase |
|------|--------|-------|
| `include/gseurat/character/character_manifest.hpp` | `PoseData` + `root_position`, `AnimationClip` + `root_motion` | 1 |
| `src/character/character_manifest.cpp` | Parse `root_position` and `root_motion` from JSON | 1 |
| `schemas/character_manifest.schema.json` | Optional `root_position` array, `root_motion` boolean | 1 |
| `include/gseurat/character/bone_animation_player.hpp` | Delta accessors, reset, prev state members | 1 |
| `src/character/bone_animation_player.cpp` | Delta extraction, loop handling, root stripping | 1 |
| `src/character/bone_animation_state_machine.cpp` | Call `reset_root_motion()` on state transitions | 1 |
| `include/gseurat/demo/island_demo_state.hpp` | `character_rotation_` member | 1 |
| `src/demo/island_demo_state.cpp` | Hybrid consumer, updated `to_world` matrix | 1 |
| `tools/apps/echidna/src/store/types.ts` | `PoseData.rootPosition`, `AnimationClip.rootMotion` | 1 |
| `tools/apps/echidna/src/store/useCharacterStore.ts` | Root position editing actions, root motion toggle | 1 |
| `tools/apps/echidna/src/panels/AnimateRightPanel.tsx` | Root Position inputs for first root bone | 1 |
| `tools/apps/echidna/src/panels/Timeline.tsx` | Root Motion checkbox + badge | 1 |
| `tools/apps/echidna/src/viewport/VoxelMesh.tsx` | Accumulated translation + rotation preview | 1 |
| `tools/apps/echidna/src/lib/manifestExport.ts` | Export `root_position` and `root_motion` fields | 1 |
| `shaders/gs_preprocess.comp` | Per-Gaussian quaternion rotation by actor rotation | 2 |
| `shaders/gs_preprocess.comp` | SH coefficient rotation (Wigner D-matrices) | 3 |
