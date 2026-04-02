# Bone Animation Player — Design Spec

**Date:** 2026-04-03
**Status:** Approved
**Goal:** Replace procedural sine-based character animation with a data-driven keyframe system that loads authored poses from Echidna and interpolates between them at runtime.

## Motivation

The GSeurat demo aims to recreate SNES-style design using Gaussians. Characters need smooth, authored animations — not hardcoded `sin(time)` math. Echidna already supports pose keyframes and animation timelines, but the engine ignores them. This spec bridges the gap.

## Architecture Overview

```
Manifest JSON → CharacterManifestLoader → CharacterData
                                              ↓
Input → BoneAnimationStateMachine → current clip + time
                                              ↓
                              BoneAnimationPlayer
                                              ↓
                            mat4[32] bone transforms
                                              ↓
                          upload_bone_transforms() → GPU (unchanged)
```

No GPU shader changes. All new code is CPU-side. The existing GPU skinning pipeline (`gs_preprocess.comp` binding 5) stays untouched.

## Character Manifest Format

A JSON file that bundles geometry reference, bone hierarchy, poses, and animation clips.

**File naming:** `assets/characters/{name}/{name}.manifest.json`

```json
{
  "name": "warm_robot",
  "ply_file": "warm_robot.ply",
  "scale": 0.5,
  "bones": [
    { "id": "torso", "parent": null, "joint": [16, 3, 16] },
    { "id": "head", "parent": "torso", "joint": [16, 7, 16] },
    { "id": "left_arm", "parent": "torso", "joint": [13, 6, 16] },
    { "id": "right_arm", "parent": "torso", "joint": [19, 6, 16] },
    { "id": "left_leg", "parent": "torso", "joint": [14, 3, 16] },
    { "id": "right_leg", "parent": "torso", "joint": [18, 3, 16] },
    { "id": "antenna", "parent": "head", "joint": [16, 10, 16] }
  ],
  "poses": {
    "rest": {
      "torso": [0, 0, 0],
      "head": [0, 0, 0],
      "left_arm": [0, 0, -80],
      "right_arm": [0, 0, 80],
      "left_leg": [0, 0, 0],
      "right_leg": [0, 0, 0],
      "antenna": [0, 0, 0]
    },
    "walk_1": {
      "torso": [5, 0, 0],
      "left_arm": [30, 0, -80],
      "right_arm": [-30, 0, 80],
      "left_leg": [-25, 0, 0],
      "right_leg": [25, 0, 0]
    },
    "walk_2": {
      "torso": [5, 0, 0],
      "left_arm": [-30, 0, -80],
      "right_arm": [30, 0, 80],
      "left_leg": [25, 0, 0],
      "right_leg": [-25, 0, 0]
    }
  },
  "animations": {
    "idle": {
      "duration": 2.0,
      "looping": true,
      "keyframes": [
        { "time": 0.0, "pose": "rest" },
        { "time": 1.0, "pose": "breathe" },
        { "time": 2.0, "pose": "rest" }
      ]
    },
    "walk": {
      "duration": 0.6,
      "looping": true,
      "keyframes": [
        { "time": 0.0, "pose": "walk_1" },
        { "time": 0.3, "pose": "walk_2" },
        { "time": 0.6, "pose": "walk_1" }
      ]
    }
  }
}
```

### Format Rules

- **Poses** store per-bone Euler rotations in degrees (XYZ order). Bones not listed in a pose inherit `[0, 0, 0]`.
- **Animations** reference poses by name with absolute timestamps in seconds.
- **Keyframes** must be sorted by time. First keyframe time should be 0.0. Last keyframe time should equal duration.
- **Bone hierarchy** uses string IDs with parent references. `null` parent = root bone.
- **Joint positions** are in voxel grid coordinates (world-space from Echidna). Scaled by `scale` at load time.
- **PLY file** path is relative to the manifest file location.
- **Max 32 bones** (GPU limit in `gs_preprocess.comp`).

### JSON Schema

The manifest must be validated against `schemas/character_manifest.schema.json` at load time.

## Engine Components

### 1. CharacterManifestLoader

**File:** `include/gseurat/character/character_manifest.hpp` + `src/character/character_manifest.cpp`

**Responsibility:** Parse manifest JSON, validate against schema, build runtime data structures.

```cpp
struct BoneData {
    std::string id;
    int parent_index;          // -1 for root
    glm::vec3 joint;           // pivot point (scaled)
};

struct PoseData {
    std::string name;
    std::vector<glm::vec3> rotations;  // per-bone Euler degrees, indexed by bone index
};

struct Keyframe {
    float time;
    int pose_index;
};

struct AnimationClip {
    std::string name;
    float duration;
    bool looping;
    std::vector<Keyframe> keyframes;
};

struct CharacterData {
    std::string name;
    std::string ply_path;      // resolved absolute path
    float scale;
    std::vector<BoneData> bones;
    std::vector<PoseData> poses;
    std::vector<AnimationClip> clips;

    // Lookup helpers
    int find_bone(const std::string& id) const;
    int find_pose(const std::string& name) const;
    int find_clip(const std::string& name) const;
};

// Load and validate manifest
CharacterData load_character_manifest(const std::string& manifest_path);
```

### 2. BoneAnimationPlayer

**File:** `include/gseurat/character/bone_animation_player.hpp` + `src/character/bone_animation_player.cpp`

**Responsibility:** Given a clip and elapsed time, compute interpolated bone transforms.

```cpp
class BoneAnimationPlayer {
public:
    explicit BoneAnimationPlayer(const CharacterData& data);

    // Set the current animation clip by name
    void play(const std::string& clip_name);

    // Advance time and compute transforms
    void update(float dt);

    // Get the computed bone transforms (max 32)
    const std::array<glm::mat4, 32>& bone_transforms() const;

    // Query
    const std::string& current_clip() const;
    bool is_playing() const;

private:
    const CharacterData& data_;
    int current_clip_index_ = -1;
    float playback_time_ = 0.0f;
    bool playing_ = false;
    std::array<glm::mat4, 32> transforms_;

    // Interpolate between two poses at factor t (0..1)
    void lerp_poses(const PoseData& a, const PoseData& b, float t);

    // Convert per-bone Euler rotations to mat4 transforms with pivot points
    glm::mat4 bone_to_mat4(int bone_index, const glm::vec3& rotation) const;
};
```

**Interpolation algorithm:**
1. Find the two keyframes surrounding `playback_time_`
2. Compute `t = (time - kf_a.time) / (kf_b.time - kf_a.time)`
3. For each bone: `lerp(pose_a.rotations[i], pose_b.rotations[i], t)`
4. Convert interpolated Euler angles to mat4 via `bone_to_mat4()`:
   - Translate to pivot point
   - Apply rotation (glm::eulerAngleXYZ)
   - Translate back
   - Multiply by parent transform (FK chain)
5. Store result in `transforms_[i]`

**Looping:** When `playback_time_ >= duration` and `looping == true`, wrap via `fmod(time, duration)`.

### 3. BoneAnimationStateMachine

**File:** `include/gseurat/character/bone_animation_state_machine.hpp` + `src/character/bone_animation_state_machine.cpp`

**Responsibility:** Map game states to animation clips.

```cpp
class BoneAnimationStateMachine {
public:
    explicit BoneAnimationStateMachine(BoneAnimationPlayer& player);

    // Register states
    void add_state(const std::string& state_name, const std::string& clip_name);

    // Transition
    void set_state(const std::string& state_name);

    // Current
    const std::string& current_state() const;

private:
    BoneAnimationPlayer& player_;
    std::string current_state_;
    std::unordered_map<std::string, std::string> state_to_clip_;
};
```

For the demo:
- `"idle"` → `"idle"` clip
- `"walk"` → `"walk"` clip
- `IslandDemoState` calls `set_state("walk")` when movement detected, `set_state("idle")` when stopped

### 4. Integration with IslandDemoState

Replace the current procedural `update_walk_animation()` with:

```cpp
// In init:
character_data_ = load_character_manifest("assets/characters/warm_robot/warm_robot.manifest.json");
anim_player_ = std::make_unique<BoneAnimationPlayer>(character_data_);
anim_sm_ = std::make_unique<BoneAnimationStateMachine>(*anim_player_);
anim_sm_->add_state("idle", "idle");
anim_sm_->add_state("walk", "walk");

// In update:
bool moving = glm::length(velocity) > 0.1f;
anim_sm_->set_state(moving ? "walk" : "idle");
anim_player_->update(dt);
gs_renderer_.upload_bone_transforms(anim_player_->bone_transforms().data(), character_data_.bones.size());
```

## Echidna Export Update

### Manifest Export

Add "Export Manifest..." to Echidna's File menu.

**File:** `tools/apps/echidna/src/lib/manifestExport.ts`

Maps Echidna's internal data to the manifest format:
- `characterParts` → `bones` array (with parent/joint)
- `characterPoses` → `poses` object (rotations in degrees)
- `animations` → `animations` object (keyframes with time + pose name)
- Character name + PLY filename reference

**Bridge endpoint:** `POST /api/characters/:name/export-manifest` — writes manifest JSON to disk (same pattern as PLY export #122).

## JSON Schemas

### `schemas/character_manifest.schema.json`

Validates the full manifest format. The engine loads and validates against this at `load_character_manifest()` time.

Key constraints enforced:
- `bones` array max length 32
- `poses` values are `[number, number, number]` arrays
- `keyframes` must have `time >= 0` and reference existing pose names
- `duration > 0` for all clips
- `ply_file` must be a non-empty string
- `scale > 0`

## Testing

### C++ Tests (CTest)

1. **test_character_manifest.cpp**
   - Load valid manifest JSON → verify bone count, pose count, clip count
   - Load manifest with missing required fields → verify error/exception
   - Load manifest with >32 bones → verify rejection
   - Verify bone parent index resolution (string ID → integer index)

2. **test_bone_animation_player.cpp**
   - Two-keyframe clip: at t=0 verify pose A, at t=duration verify pose A (looping), at t=duration/2 verify midpoint
   - Three-keyframe clip: verify correct pair selection at each time range
   - Looping: verify time wraps correctly
   - Non-looping: verify playback stops at last keyframe
   - FK chain: verify child bone transform includes parent rotation

3. **test_bone_animation_state_machine.cpp**
   - Register states, transition, verify clip changes
   - Transition to same state → verify no reset
   - Transition to new state → verify playback time resets

### TypeScript Tests (pnpm test)

4. **manifestExport.test.ts**
   - Generate manifest from Echidna store state → verify JSON structure
   - Verify bone hierarchy mapping (parent string IDs)
   - Verify pose rotation format (degrees, 3-element arrays)
   - Verify keyframe time ordering

## Files to Create/Modify

### New Files
- `schemas/character_manifest.schema.json`
- `include/gseurat/character/character_manifest.hpp`
- `src/character/character_manifest.cpp`
- `include/gseurat/character/bone_animation_player.hpp`
- `src/character/bone_animation_player.cpp`
- `include/gseurat/character/bone_animation_state_machine.hpp`
- `src/character/bone_animation_state_machine.cpp`
- `tests/test_character_manifest.cpp`
- `tests/test_bone_animation_player.cpp`
- `tests/test_bone_animation_state_machine.cpp`
- `tools/apps/echidna/src/lib/manifestExport.ts`
- `tools/apps/echidna/src/__tests__/manifestExport.test.ts`
- `assets/characters/warm_robot/warm_robot.manifest.json`

### Modified Files
- `CMakeLists.txt` — add new source files to `gseurat_core`
- `src/demo/island_demo_state.cpp` — replace procedural animation with `BoneAnimationPlayer`
- `include/gseurat/demo/island_demo_state.hpp` — add player/state machine members
- `tools/apps/echidna/src/panels/MenuBar.tsx` — add "Export Manifest..." menu item
- `tools/apps/bridge/src/index.ts` — add manifest export endpoint

## Scope Boundary

**In scope:**
- Character manifest format + schema
- Manifest loader with validation
- BoneAnimationPlayer with linear lerp interpolation
- BoneAnimationStateMachine (idle/walk states)
- Echidna manifest export
- Island demo integration (replace procedural animation)
- Unit tests for all new components

**Out of scope (future work):**
- Slerp rotation interpolation
- Per-keyframe easing curves
- Cross-fade / blend between states
- Echidna grid expansion (256x256x256)
- Additional animation clips beyond idle/walk
- Inverse kinematics
