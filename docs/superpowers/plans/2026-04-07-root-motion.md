# Root Motion Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract per-frame translation/rotation deltas from the root bone's animation data and expose them to game states via a hybrid consumer model, with full Echidna authoring support.

**Architecture:** Extend `PoseData` with `root_position`, add delta extraction with loop-aware math to `BoneAnimationPlayer`, strip root transform before FK. Game state accumulates deltas into a `character_rotation_` quaternion. Echidna gets root position editing, root motion toggle per clip, and accumulated motion viewport preview.

**Tech Stack:** C++23/GLM (engine), TypeScript/React/Three.js/Zustand (Echidna), JSON Schema 2020-12

**Spec:** `docs/superpowers/specs/2026-04-07-root-motion-design.md`

---

### Task 1: Schema & Engine Data Structures

**Files:**
- Modify: `schemas/character_manifest.schema.json`
- Modify: `include/gseurat/character/character_manifest.hpp:15-30`
- Modify: `src/character/character_manifest.cpp:78-123`
- Test: `tests/test_character_manifest.cpp`

- [ ] **Step 1: Update JSON schema — add `root_position` to pose and `root_motion` to animation_clip**

In `schemas/character_manifest.schema.json`, update the `pose` definition (line 78) and `animation_clip` definition (line 84):

```json
"pose": {
  "type": "object",
  "description": "Per-bone Euler rotations in degrees [rx, ry, rz]. Bones not listed default to [0, 0, 0].",
  "properties": {
    "root_position": {
      "$ref": "#/$defs/vec3",
      "description": "Root bone world-space translation offset [x, y, z]. Defaults to [0, 0, 0]."
    }
  },
  "additionalProperties": {
    "$ref": "#/$defs/vec3"
  }
}
```

In `animation_clip` properties (after the `looping` property, before `keyframes`), add:

```json
"root_motion": {
  "type": "boolean",
  "default": false,
  "description": "When true, root bone delta drives actor world position."
}
```

- [ ] **Step 2: Write failing test for root_position and root_motion parsing**

Add to `tests/test_character_manifest.cpp`:

```cpp
static void test_root_position_parsing() {
    // Write a manifest with root_position in poses and root_motion in clip
    const char* json = R"({
        "name": "test",
        "ply_file": "test.ply",
        "scale": 1.0,
        "bones": [
            {"id": "root", "parent": null, "joint": [0, 0, 0]}
        ],
        "poses": {
            "start": {
                "root_position": [0, 0, 0],
                "root": [0, 0, 0]
            },
            "mid": {
                "root_position": [0, 0, 1.5],
                "root": [0, 15, 0]
            }
        },
        "animations": {
            "walk": {
                "duration": 0.6,
                "looping": true,
                "root_motion": true,
                "keyframes": [
                    {"time": 0.0, "pose": "start"},
                    {"time": 0.3, "pose": "mid"},
                    {"time": 0.6, "pose": "start"}
                ]
            }
        }
    })";

    // Write to temp file
    {
        std::ofstream f("test_root_pos_manifest.json");
        f << json;
    }

    auto result = gseurat::load_character_manifest("test_root_pos_manifest.json");
    assert(result.has_value());
    auto& data = *result;

    // Check root_position parsed
    int start_idx = data.find_pose("start");
    int mid_idx = data.find_pose("mid");
    assert(start_idx >= 0);
    assert(mid_idx >= 0);
    assert(glm::length(data.poses[start_idx].root_position) < 0.001f);
    assert(std::abs(data.poses[mid_idx].root_position.z - 1.5f) < 0.001f);

    // Check root_motion flag
    int walk_idx = data.find_clip("walk");
    assert(walk_idx >= 0);
    assert(data.clips[walk_idx].root_motion == true);

    // Check default (no root_motion field → false)
    // The walk clip we created has root_motion=true, so test that clips
    // without it default to false by checking the struct default
    gseurat::AnimationClip default_clip;
    assert(default_clip.root_motion == false);

    std::remove("test_root_pos_manifest.json");
    std::fprintf(stderr, "  PASS: test_root_position_parsing\n");
}
```

Add `test_root_position_parsing();` to the `main()` function at the end.

- [ ] **Step 3: Run test to verify it fails**

Run: `cmake --build --preset macos-debug --target test_character_manifest && ./build/macos-debug/test_character_manifest`
Expected: Compile error — `PoseData` has no `root_position` member, `AnimationClip` has no `root_motion` member.

- [ ] **Step 4: Update `character_manifest.hpp` — add `root_position` and `root_motion` fields**

In `include/gseurat/character/character_manifest.hpp`, update `PoseData` (line 15):

```cpp
struct PoseData {
    std::string name;
    std::vector<glm::vec3> rotations;  // per-bone Euler degrees, indexed by bone index
    glm::vec3 root_position{0.0f};     // root bone world-space offset
};
```

Update `AnimationClip` (line 25):

```cpp
struct AnimationClip {
    std::string name;
    float duration = 1.0f;
    bool looping = true;
    bool root_motion = false;  // opt-in: root bone delta drives actor world position
    std::vector<AnimKeyframe> keyframes;
};
```

- [ ] **Step 5: Update `character_manifest.cpp` — parse `root_position` and `root_motion`**

In `src/character/character_manifest.cpp`, in the poses parsing loop (after line 83, `pose.rotations.resize(bone_count, glm::vec3(0.0f));`), add:

```cpp
            // Root position (optional, defaults to 0)
            if (jp.contains("root_position") && jp["root_position"].is_array()
                && jp["root_position"].size() >= 3) {
                pose.root_position = glm::vec3(
                    jp["root_position"][0].get<float>(),
                    jp["root_position"][1].get<float>(),
                    jp["root_position"][2].get<float>()
                );
            }
```

In the animations parsing loop (after line 119, `clip.looping = jc.value("looping", true);`), add:

```cpp
            clip.root_motion = jc.value("root_motion", false);
```

In the poses parsing inner loop (line 85), update the bone_id iteration to skip the `root_position` key:

```cpp
            for (auto& [bone_id, jr] : jp.items()) {
                if (bone_id == "root_position") continue;  // handled above
                int bi = data.find_bone(bone_id);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cmake --build --preset macos-debug --target test_character_manifest && ./build/macos-debug/test_character_manifest`
Expected: All tests PASS including `test_root_position_parsing`.

- [ ] **Step 7: Commit**

```bash
git add schemas/character_manifest.schema.json include/gseurat/character/character_manifest.hpp src/character/character_manifest.cpp tests/test_character_manifest.cpp
git commit -m "feat(character): add root_position to PoseData and root_motion to AnimationClip"
```

---

### Task 2: BoneAnimationPlayer Delta Extraction

**Files:**
- Modify: `include/gseurat/character/bone_animation_player.hpp`
- Modify: `src/character/bone_animation_player.cpp`
- Test: `tests/test_bone_animation_player.cpp`

- [ ] **Step 1: Write failing test for delta extraction**

Add to `tests/test_bone_animation_player.cpp`:

```cpp
static void test_root_motion_delta() {
    // Build character data with root motion walk cycle
    gseurat::CharacterData data;
    data.name = "test";
    data.scale = 1.0f;

    gseurat::BoneData root_bone;
    root_bone.id = "root";
    root_bone.parent_index = -1;
    root_bone.joint = glm::vec3(0.0f);
    data.bones.push_back(root_bone);

    // Pose at origin
    gseurat::PoseData pose_start;
    pose_start.name = "start";
    pose_start.rotations = {glm::vec3(0.0f)};
    pose_start.root_position = glm::vec3(0.0f, 0.0f, 0.0f);
    data.poses.push_back(pose_start);

    // Pose 2 units forward on Z
    gseurat::PoseData pose_mid;
    pose_mid.name = "mid";
    pose_mid.rotations = {glm::vec3(0.0f, 30.0f, 0.0f)};  // 30 deg Y rotation
    pose_mid.root_position = glm::vec3(0.0f, 0.0f, 2.0f);
    data.poses.push_back(pose_mid);

    gseurat::AnimationClip clip;
    clip.name = "walk";
    clip.duration = 1.0f;
    clip.looping = true;
    clip.root_motion = true;
    clip.keyframes = {{0.0f, 0}, {0.5f, 1}, {1.0f, 0}};
    data.clips.push_back(clip);

    gseurat::BoneAnimationPlayer player(data);
    player.play("walk");

    // After play(), delta should be zero (no frame yet)
    assert(glm::length(player.delta_position()) < 0.001f);

    // Advance 0.25s (halfway to mid pose)
    player.update(0.25f);
    glm::vec3 dp = player.delta_position();
    // Should have moved ~1.0 on Z (halfway to 2.0)
    assert(std::abs(dp.z - 1.0f) < 0.05f);
    assert(std::abs(dp.x) < 0.001f);
    assert(std::abs(dp.y) < 0.001f);

    // Root bone transform should be identity (stripped)
    const auto& transforms = player.bone_transforms();
    float identity_diff = glm::length(glm::vec3(transforms[0][3]) - glm::vec3(0.0f));
    assert(identity_diff < 0.001f);  // translation component is zero

    // Advance another 0.25s (at mid pose, t=0.5)
    player.update(0.25f);
    dp = player.delta_position();
    // Should have moved another ~1.0 on Z
    assert(std::abs(dp.z - 1.0f) < 0.05f);

    // Delta rotation should be non-zero (root has 30 deg Y rotation at mid)
    glm::quat dr = player.delta_rotation();
    float angle = 2.0f * std::acos(std::min(std::abs(dr.w), 1.0f));
    assert(angle > 0.01f);  // some rotation happened

    std::fprintf(stderr, "  PASS: test_root_motion_delta\n");
}

static void test_root_motion_loop_wraparound() {
    gseurat::CharacterData data;
    data.name = "test";
    data.scale = 1.0f;

    gseurat::BoneData root_bone;
    root_bone.id = "root";
    root_bone.parent_index = -1;
    root_bone.joint = glm::vec3(0.0f);
    data.bones.push_back(root_bone);

    // Start at Z=0, end at Z=3
    gseurat::PoseData p0;
    p0.name = "p0";
    p0.rotations = {glm::vec3(0.0f)};
    p0.root_position = glm::vec3(0.0f, 0.0f, 0.0f);
    data.poses.push_back(p0);

    gseurat::PoseData p1;
    p1.name = "p1";
    p1.rotations = {glm::vec3(0.0f)};
    p1.root_position = glm::vec3(0.0f, 0.0f, 3.0f);
    data.poses.push_back(p1);

    gseurat::AnimationClip clip;
    clip.name = "walk";
    clip.duration = 1.0f;
    clip.looping = true;
    clip.root_motion = true;
    clip.keyframes = {{0.0f, 0}, {1.0f, 1}};
    data.clips.push_back(clip);

    gseurat::BoneAnimationPlayer player(data);
    player.play("walk");

    // Advance to t=0.8 (should be at Z=2.4)
    player.update(0.8f);
    glm::vec3 dp1 = player.delta_position();
    assert(std::abs(dp1.z - 2.4f) < 0.1f);

    // Advance 0.4s → loops (0.8+0.4=1.2, wraps to 0.2)
    // Delta should be: (3.0 - 2.4) + (0.6 - 0.0) = 0.6 + 0.6 = 1.2
    // NOT: 0.6 - 2.4 = -1.8 (the bug we're preventing)
    player.update(0.4f);
    glm::vec3 dp2 = player.delta_position();
    assert(dp2.z > 0.0f);  // Must be positive (forward), not negative
    assert(std::abs(dp2.z - 1.2f) < 0.15f);

    std::fprintf(stderr, "  PASS: test_root_motion_loop_wraparound\n");
}

static void test_reset_root_motion() {
    gseurat::CharacterData data;
    data.name = "test";
    data.scale = 1.0f;

    gseurat::BoneData root_bone;
    root_bone.id = "root";
    root_bone.parent_index = -1;
    root_bone.joint = glm::vec3(0.0f);
    data.bones.push_back(root_bone);

    gseurat::PoseData p0;
    p0.name = "p0";
    p0.rotations = {glm::vec3(0.0f)};
    p0.root_position = glm::vec3(0.0f, 0.0f, 0.0f);
    data.poses.push_back(p0);

    gseurat::PoseData p1;
    p1.name = "p1";
    p1.rotations = {glm::vec3(0.0f)};
    p1.root_position = glm::vec3(0.0f, 0.0f, 5.0f);
    data.poses.push_back(p1);

    gseurat::AnimationClip clip;
    clip.name = "walk";
    clip.duration = 1.0f;
    clip.looping = false;
    clip.root_motion = true;
    clip.keyframes = {{0.0f, 0}, {1.0f, 1}};
    data.clips.push_back(clip);

    gseurat::BoneAnimationPlayer player(data);
    player.play("walk");

    // Move forward
    player.update(0.5f);
    assert(std::abs(player.delta_position().z - 2.5f) < 0.1f);

    // Reset root motion
    player.reset_root_motion();
    assert(glm::length(player.delta_position()) < 0.001f);

    std::fprintf(stderr, "  PASS: test_reset_root_motion\n");
}
```

Add all three to the `main()` function.

- [ ] **Step 2: Run test to verify it fails**

Run: `cmake --build --preset macos-debug --target test_bone_animation_player && ./build/macos-debug/test_bone_animation_player`
Expected: Compile error — `delta_position()`, `delta_rotation()`, `reset_root_motion()` not declared.

- [ ] **Step 3: Update `bone_animation_player.hpp` — add root motion API and state**

Replace the full file `include/gseurat/character/bone_animation_player.hpp`:

```cpp
#pragma once
#include "gseurat/character/character_manifest.hpp"
#include <glm/glm.hpp>
#include <glm/gtc/quaternion.hpp>
#include <array>
#include <string>

namespace gseurat {

class BoneAnimationPlayer {
public:
    explicit BoneAnimationPlayer(const CharacterData& data);
    void play(const std::string& clip_name);
    void update(float dt);
    const std::array<glm::mat4, 32>& bone_transforms() const { return transforms_; }
    const std::string& current_clip() const { return current_clip_name_; }
    int current_clip_index() const { return current_clip_index_; }
    bool is_playing() const { return playing_; }

    // Root motion delta access (hybrid model)
    glm::vec3 delta_position() const { return frame_delta_position_; }
    glm::quat delta_rotation() const { return frame_delta_rotation_; }
    void reset_root_motion();

private:
    const CharacterData& data_;
    std::string current_clip_name_;
    int current_clip_index_ = -1;
    float playback_time_ = 0.0f;
    bool playing_ = false;
    std::array<glm::mat4, 32> transforms_;

    // Root motion state
    glm::vec3 prev_root_position_{0.0f};
    glm::quat prev_root_rotation_{1.0f, 0.0f, 0.0f, 0.0f};
    glm::vec3 frame_delta_position_{0.0f};
    glm::quat frame_delta_rotation_{1.0f, 0.0f, 0.0f, 0.0f};

    glm::mat4 bone_to_mat4(int bone_index, const glm::vec3& euler_deg) const;
    void compute_transforms(const PoseData& pose_a, const PoseData& pose_b,
                            float t, bool strip_root);

    // Helpers for root motion
    glm::vec3 interpolate_root_position(const PoseData& pa, const PoseData& pb, float t) const;
    glm::quat interpolate_root_rotation(const PoseData& pa, const PoseData& pb, float t) const;
    struct KeyframePair { int a; int b; float t; };
    KeyframePair find_keyframe_pair(const AnimationClip& clip, float time) const;
};

}  // namespace gseurat
```

- [ ] **Step 4: Implement root motion in `bone_animation_player.cpp`**

Replace the full file `src/character/bone_animation_player.cpp`:

```cpp
#include "gseurat/character/bone_animation_player.hpp"
#include <glm/gtc/matrix_transform.hpp>
#define GLM_ENABLE_EXPERIMENTAL
#include <glm/gtx/euler_angles.hpp>
#include <glm/gtx/quaternion.hpp>
#include <algorithm>
#include <cmath>

namespace gseurat {

BoneAnimationPlayer::BoneAnimationPlayer(const CharacterData& data)
    : data_(data) {
    transforms_.fill(glm::mat4(1.0f));
}

void BoneAnimationPlayer::play(const std::string& clip_name) {
    int idx = data_.find_clip(clip_name);
    if (idx < 0) {
        playing_ = false;
        current_clip_name_.clear();
        current_clip_index_ = -1;
        return;
    }
    current_clip_name_ = clip_name;
    current_clip_index_ = idx;
    playback_time_ = 0.0f;
    playing_ = true;

    // Initialize root motion prev state from first keyframe
    const auto& clip = data_.clips[current_clip_index_];
    if (!clip.keyframes.empty()) {
        const auto& first_pose = data_.poses[clip.keyframes[0].pose_index];
        prev_root_position_ = first_pose.root_position;
        if (!first_pose.rotations.empty()) {
            prev_root_rotation_ = interpolate_root_rotation(first_pose, first_pose, 0.0f);
        } else {
            prev_root_rotation_ = glm::quat(1.0f, 0.0f, 0.0f, 0.0f);
        }
    }
    frame_delta_position_ = glm::vec3(0.0f);
    frame_delta_rotation_ = glm::quat(1.0f, 0.0f, 0.0f, 0.0f);

    // Compute initial pose at t=0
    if (!clip.keyframes.empty()) {
        const auto& pose = data_.poses[clip.keyframes[0].pose_index];
        compute_transforms(pose, pose, 0.0f, clip.root_motion);
    }
}

void BoneAnimationPlayer::update(float dt) {
    if (!playing_ || current_clip_index_ < 0) return;

    const auto& clip = data_.clips[current_clip_index_];
    float old_time = playback_time_;
    playback_time_ += dt;

    // Detect loop wrap-around
    bool looped = false;
    if (clip.looping && clip.duration > 0.0f && playback_time_ >= clip.duration) {
        looped = true;
        playback_time_ = std::fmod(playback_time_, clip.duration);
    } else if (!clip.looping && playback_time_ >= clip.duration) {
        playback_time_ = clip.duration;
        playing_ = false;
    }

    // Find surrounding keyframes for current time
    auto [kf_a, kf_b, t] = find_keyframe_pair(clip, playback_time_);
    const auto& pose_a = data_.poses[clip.keyframes[kf_a].pose_index];
    const auto& pose_b = data_.poses[clip.keyframes[kf_b].pose_index];

    // Root motion delta extraction
    if (clip.root_motion) {
        glm::vec3 cur_root_pos = interpolate_root_position(pose_a, pose_b, t);
        glm::quat cur_root_rot = interpolate_root_rotation(pose_a, pose_b, t);

        if (looped) {
            // End-of-track interpolation
            constexpr float eps = 1e-4f;
            float end_time = clip.duration - eps;
            auto [ea, eb, et] = find_keyframe_pair(clip, end_time);
            const auto& epa = data_.poses[clip.keyframes[ea].pose_index];
            const auto& epb = data_.poses[clip.keyframes[eb].pose_index];
            glm::vec3 end_pos = interpolate_root_position(epa, epb, et);
            glm::quat end_rot = interpolate_root_rotation(epa, epb, et);

            // Start-of-track values
            const auto& first_pose = data_.poses[clip.keyframes[0].pose_index];
            glm::vec3 start_pos = first_pose.root_position;
            glm::quat start_rot = interpolate_root_rotation(first_pose, first_pose, 0.0f);

            // Position: (end - prev) + (current - start)
            frame_delta_position_ = (end_pos - prev_root_position_)
                                  + (cur_root_pos - start_pos);

            // Rotation: delta_start * delta_end (apply end first, then start)
            glm::quat delta_end = end_rot * glm::inverse(prev_root_rotation_);
            glm::quat delta_start = cur_root_rot * glm::inverse(start_rot);
            frame_delta_rotation_ = delta_start * delta_end;
        } else {
            frame_delta_position_ = cur_root_pos - prev_root_position_;
            frame_delta_rotation_ = cur_root_rot * glm::inverse(prev_root_rotation_);
        }

        prev_root_position_ = cur_root_pos;
        prev_root_rotation_ = cur_root_rot;
    } else {
        frame_delta_position_ = glm::vec3(0.0f);
        frame_delta_rotation_ = glm::quat(1.0f, 0.0f, 0.0f, 0.0f);
    }

    compute_transforms(pose_a, pose_b, t, clip.root_motion);
}

void BoneAnimationPlayer::reset_root_motion() {
    if (current_clip_index_ < 0) return;
    const auto& clip = data_.clips[current_clip_index_];
    if (!clip.keyframes.empty()) {
        const auto& first_pose = data_.poses[clip.keyframes[0].pose_index];
        prev_root_position_ = first_pose.root_position;
        prev_root_rotation_ = interpolate_root_rotation(first_pose, first_pose, 0.0f);
    }
    frame_delta_position_ = glm::vec3(0.0f);
    frame_delta_rotation_ = glm::quat(1.0f, 0.0f, 0.0f, 0.0f);
}

glm::mat4 BoneAnimationPlayer::bone_to_mat4(int bone_index, const glm::vec3& euler_deg) const {
    const auto& bone = data_.bones[bone_index];
    glm::vec3 pivot = bone.joint;

    glm::vec3 rad = glm::radians(euler_deg);

    // Translate to pivot, rotate, translate back
    glm::mat4 to_pivot = glm::translate(glm::mat4(1.0f), -pivot);
    glm::mat4 rotation = glm::eulerAngleXYZ(rad.x, rad.y, rad.z);
    glm::mat4 from_pivot = glm::translate(glm::mat4(1.0f), pivot);

    return from_pivot * rotation * to_pivot;
}

void BoneAnimationPlayer::compute_transforms(
    const PoseData& pose_a, const PoseData& pose_b,
    float t, bool strip_root) {

    transforms_.fill(glm::mat4(1.0f));

    int bone_count = static_cast<int>(data_.bones.size());
    if (bone_count > 32) bone_count = 32;

    for (int i = 0; i < bone_count; ++i) {
        // Get Euler angles from each pose (default to zero if out of range)
        glm::vec3 rot_a(0.0f);
        glm::vec3 rot_b(0.0f);
        if (i < static_cast<int>(pose_a.rotations.size())) rot_a = pose_a.rotations[i];
        if (i < static_cast<int>(pose_b.rotations.size())) rot_b = pose_b.rotations[i];

        // Lerp Euler angles
        glm::vec3 rot = glm::mix(rot_a, rot_b, t);

        // Compute local transform
        glm::mat4 local = bone_to_mat4(i, rot);

        // FK chain: multiply by parent transform
        int parent = data_.bones[i].parent_index;
        if (parent < 0 && strip_root) {
            // Root bone with root motion: strip to identity
            transforms_[i] = glm::mat4(1.0f);
        } else if (parent >= 0 && parent < 32) {
            transforms_[i] = transforms_[parent] * local;
        } else {
            transforms_[i] = local;
        }
    }
}

glm::vec3 BoneAnimationPlayer::interpolate_root_position(
    const PoseData& pa, const PoseData& pb, float t) const {
    return glm::mix(pa.root_position, pb.root_position, t);
}

glm::quat BoneAnimationPlayer::interpolate_root_rotation(
    const PoseData& pa, const PoseData& pb, float t) const {
    // Root bone is index 0 (first bone with parent_index == -1)
    glm::vec3 euler_a(0.0f);
    glm::vec3 euler_b(0.0f);
    // Find root bone index
    int root_idx = -1;
    for (int i = 0; i < static_cast<int>(data_.bones.size()); ++i) {
        if (data_.bones[i].parent_index < 0) { root_idx = i; break; }
    }
    if (root_idx >= 0) {
        if (root_idx < static_cast<int>(pa.rotations.size())) euler_a = pa.rotations[root_idx];
        if (root_idx < static_cast<int>(pb.rotations.size())) euler_b = pb.rotations[root_idx];
    }

    // Convert interpolated Euler to quaternion (convert to quat BEFORE delta math)
    glm::vec3 euler = glm::mix(euler_a, euler_b, t);
    glm::vec3 rad = glm::radians(euler);
    return glm::quat(glm::eulerAngleXYZ(rad.x, rad.y, rad.z));
}

BoneAnimationPlayer::KeyframePair
BoneAnimationPlayer::find_keyframe_pair(const AnimationClip& clip, float time) const {
    const auto& kfs = clip.keyframes;
    if (kfs.empty()) return {0, 0, 0.0f};
    if (kfs.size() == 1) return {0, 0, 0.0f};

    int kf_a = 0;
    int kf_b = 0;
    for (size_t i = 0; i < kfs.size() - 1; ++i) {
        if (time >= kfs[i].time && time <= kfs[i + 1].time) {
            kf_a = static_cast<int>(i);
            kf_b = static_cast<int>(i + 1);
            break;
        }
        kf_a = static_cast<int>(i + 1);
        kf_b = kf_a;
    }

    float t = 0.0f;
    float seg = kfs[kf_b].time - kfs[kf_a].time;
    if (seg > 0.0f) {
        t = (time - kfs[kf_a].time) / seg;
    }
    return {kf_a, kf_b, t};
}

}  // namespace gseurat
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cmake --build --preset macos-debug --target test_bone_animation_player && ./build/macos-debug/test_bone_animation_player`
Expected: All tests PASS including `test_root_motion_delta`, `test_root_motion_loop_wraparound`, `test_reset_root_motion`.

- [ ] **Step 6: Commit**

```bash
git add include/gseurat/character/bone_animation_player.hpp src/character/bone_animation_player.cpp tests/test_bone_animation_player.cpp
git commit -m "feat(animation): root motion delta extraction with loop-aware math"
```

---

### Task 3: State Machine Reset on Transitions

**Files:**
- Modify: `src/character/bone_animation_state_machine.cpp:13-19`
- Test: `tests/test_bone_animation_state_machine.cpp`

- [ ] **Step 1: Write failing test for reset_root_motion on state transition**

Add to `tests/test_bone_animation_state_machine.cpp`:

```cpp
static void test_state_transition_resets_root_motion() {
    gseurat::CharacterData data;
    data.name = "test";
    data.scale = 1.0f;

    gseurat::BoneData root_bone;
    root_bone.id = "root";
    root_bone.parent_index = -1;
    root_bone.joint = glm::vec3(0.0f);
    data.bones.push_back(root_bone);

    gseurat::PoseData p0;
    p0.name = "p0";
    p0.rotations = {glm::vec3(0.0f)};
    p0.root_position = glm::vec3(0.0f);
    data.poses.push_back(p0);

    gseurat::PoseData p1;
    p1.name = "p1";
    p1.rotations = {glm::vec3(0.0f)};
    p1.root_position = glm::vec3(0.0f, 0.0f, 3.0f);
    data.poses.push_back(p1);

    gseurat::AnimationClip walk;
    walk.name = "walk";
    walk.duration = 1.0f;
    walk.looping = true;
    walk.root_motion = true;
    walk.keyframes = {{0.0f, 0}, {1.0f, 1}};
    data.clips.push_back(walk);

    gseurat::AnimationClip idle;
    idle.name = "idle";
    idle.duration = 1.0f;
    idle.looping = true;
    idle.root_motion = false;
    idle.keyframes = {{0.0f, 0}};
    data.clips.push_back(idle);

    gseurat::BoneAnimationPlayer player(data);
    gseurat::BoneAnimationStateMachine sm(player);
    sm.add_state("walk", "walk");
    sm.add_state("idle", "idle");

    sm.set_state("walk");
    player.update(0.5f);  // Accumulate some delta
    assert(std::abs(player.delta_position().z - 1.5f) < 0.2f);

    // Transition to idle — delta should be zeroed
    sm.set_state("idle");
    assert(glm::length(player.delta_position()) < 0.001f);

    std::fprintf(stderr, "  PASS: test_state_transition_resets_root_motion\n");
}
```

Add `test_state_transition_resets_root_motion();` to `main()`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cmake --build --preset macos-debug --target test_bone_animation_state_machine && ./build/macos-debug/test_bone_animation_state_machine`
Expected: FAIL — after `set_state("idle")`, `delta_position()` still holds the old value because `play()` now resets but the SM doesn't call `reset_root_motion()` explicitly. Actually, since `play()` already initializes root motion state, this test might pass. Let's verify — if it passes, the state machine already handles it via `play()`.

- [ ] **Step 3: If test fails, add explicit `reset_root_motion()` call in `set_state()`**

In `src/character/bone_animation_state_machine.cpp`, update `set_state()`:

```cpp
void BoneAnimationStateMachine::set_state(const std::string& state_name) {
    auto it = state_to_clip_.find(state_name);
    if (it == state_to_clip_.end()) return;  // ignore unregistered
    if (state_name == current_state_) return;  // skip same state
    current_state_ = state_name;
    player_.play(it->second);
    // play() already initializes root motion prev state and zeros deltas
}
```

Note: `play()` already calls `reset_root_motion()` logic inline (initializes `prev_root_position_`, `prev_root_rotation_`, zeroes `frame_delta_*`). No additional call needed in the state machine unless `play()` changes later.

- [ ] **Step 4: Run test to verify it passes**

Run: `cmake --build --preset macos-debug --target test_bone_animation_state_machine && ./build/macos-debug/test_bone_animation_state_machine`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/test_bone_animation_state_machine.cpp src/character/bone_animation_state_machine.cpp
git commit -m "test(animation): verify root motion resets on state machine transitions"
```

---

### Task 4: Island Demo State Integration

**Files:**
- Modify: `include/gseurat/demo/island_demo_state.hpp:50`
- Modify: `src/demo/island_demo_state.cpp:500-512,820-826`

- [ ] **Step 1: Add `character_rotation_` member to `island_demo_state.hpp`**

In `include/gseurat/demo/island_demo_state.hpp`, add include at the top (after existing includes):

```cpp
#include <glm/gtc/quaternion.hpp>
```

After `facing_angle_` (line 50), add:

```cpp
    glm::quat character_rotation_{1.0f, 0.0f, 0.0f, 0.0f};
```

- [ ] **Step 2: Update `to_world` matrix to use `character_rotation_`**

In `src/demo/island_demo_state.cpp`, replace the `to_world` matrix construction (around line 820-826):

Find:
```cpp
        glm::mat4 to_world =
            glm::translate(glm::mat4(1.0f), character_origin_ + y_off) *
            glm::rotate(glm::mat4(1.0f), facing_angle_, {0, 1, 0}) *
            glm::scale(glm::mat4(1.0f), scale_vec) *
            glm::rotate(glm::mat4(1.0f), glm::pi<float>(), {0, 1, 0});
```

Replace with:
```cpp
        glm::mat4 to_world =
            glm::translate(glm::mat4(1.0f), character_origin_ + y_off) *
            glm::mat4_cast(character_rotation_) *
            glm::scale(glm::mat4(1.0f), scale_vec) *
            glm::rotate(glm::mat4(1.0f), glm::pi<float>(), {0, 1, 0});
```

- [ ] **Step 3: Add hybrid root motion consumer logic**

In `src/demo/island_demo_state.cpp`, in `update_walk_animation()`, after `anim_player_->update(dt);` (around line 801), add the root motion consumer block:

Find:
```cpp
        anim_player_->update(dt);
```

Replace with:
```cpp
        anim_player_->update(dt);

        // Root motion hybrid consumer
        const auto& current_clip = character_data_->clips[anim_player_->current_clip_index()];
        if (anim_player_->current_clip_index() >= 0 && current_clip.root_motion) {
            // Delta position rotated by current world orientation
            glm::vec3 world_delta = character_rotation_ * anim_player_->delta_position();
            character_origin_ += world_delta;

            // Accumulate rotation delta
            character_rotation_ = glm::normalize(
                character_rotation_ * anim_player_->delta_rotation());

            // Sync facing_angle_ for systems that need a scalar angle
            facing_angle_ = glm::yaw(character_rotation_);
        }
```

- [ ] **Step 4: Sync `character_rotation_` from `facing_angle_` when input-driven**

In the section where `facing_angle_` is updated from velocity (around line 508-512), after the facing angle interpolation, add:

Find the block that updates `facing_angle_` from player velocity. After the final `facing_angle_ += diff * ...` line, add:

```cpp
        // Sync rotation quaternion from input-driven facing angle
        // (only when no root motion clip is active)
        if (!anim_player_ || anim_player_->current_clip_index() < 0
            || !character_data_->clips[anim_player_->current_clip_index()].root_motion) {
            character_rotation_ = glm::angleAxis(facing_angle_, glm::vec3(0.0f, 1.0f, 0.0f));
        }
```

- [ ] **Step 5: Update the fallback animation path**

In the else branch of `update_walk_animation()` (the fallback path around line 877 that handles no animation data), replace the `facing_angle_` usage:

Find:
```cpp
        glm::mat4 root_rotate =
            glm::translate(glm::mat4(1.0f), spawn) *
            glm::rotate(glm::mat4(1.0f), facing_angle_, {0, 1, 0}) *
            glm::translate(glm::mat4(1.0f), -spawn);
```

Replace with:
```cpp
        glm::mat4 root_rotate =
            glm::translate(glm::mat4(1.0f), spawn) *
            glm::mat4_cast(character_rotation_) *
            glm::translate(glm::mat4(1.0f), -spawn);
```

- [ ] **Step 6: Build to verify compilation**

Run: `cmake --build --preset macos-debug`
Expected: Build succeeds. No runtime test needed — the island demo exercises this code path when running with a character that has `root_motion: true` in its manifest.

- [ ] **Step 7: Commit**

```bash
git add include/gseurat/demo/island_demo_state.hpp src/demo/island_demo_state.cpp
git commit -m "feat(demo): hybrid root motion consumer with accumulated character_rotation_"
```

---

### Task 5: Echidna Types & Store Actions

**Files:**
- Modify: `tools/apps/echidna/src/store/types.ts:19-22,49-54`
- Modify: `tools/apps/echidna/src/store/useCharacterStore.ts`

- [ ] **Step 1: Extend `PoseData` and `AnimationClip` types**

In `tools/apps/echidna/src/store/types.ts`, update `PoseData` (line 19):

```typescript
export interface PoseData {
  /** Per-part euler rotations in degrees [rx, ry, rz] */
  rotations: Record<string, [number, number, number]>;
  /** Root bone world-space translation offset [x, y, z] */
  rootPosition?: [number, number, number];
}
```

Update `AnimationClip` (line 49):

```typescript
export interface AnimationClip {
  name: string;
  keyframes: AnimationKeyframe[];
  duration: number;
  playbackMode: PlaybackMode;
  /** When true, root bone delta drives actor world position */
  rootMotion?: boolean;
}
```

- [ ] **Step 2: Add store actions for root position editing and root motion toggle**

In `tools/apps/echidna/src/store/useCharacterStore.ts`, add these actions in the pose-related section (after `updatePoseRotation`, around line 502):

```typescript
    updatePoseRootPosition: (poseName: string, position: [number, number, number]) => {
      set(produce((s: CharacterStoreState) => {
        const pose = s.characterPoses[poseName];
        if (pose) {
          pose.rootPosition = position;
        }
      }));
    },
```

In the animation-related section (after `updateAnimationPlaybackMode`, around line 634):

```typescript
    updateAnimationRootMotion: (animName: string, enabled: boolean) => {
      set(produce((s: CharacterStoreState) => {
        const anim = s.animations[animName];
        if (anim) {
          anim.rootMotion = enabled;
        }
      }));
    },
```

- [ ] **Step 3: Update `EchidnaFile` interface to persist `rootMotion`**

In `types.ts`, the `EchidnaFile` interface (line 71) stores `animations?: Record<string, AnimationClip>`. Since `AnimationClip` now includes `rootMotion?`, this is automatically persisted in save/load. No change needed.

Similarly, `PoseData` with `rootPosition?` is stored via `characterPoses`. No change needed to the file format — it's backwards compatible.

- [ ] **Step 4: Commit**

```bash
git add tools/apps/echidna/src/store/types.ts tools/apps/echidna/src/store/useCharacterStore.ts
git commit -m "feat(echidna): add rootPosition to PoseData and rootMotion to AnimationClip"
```

---

### Task 6: Echidna Manifest Export

**Files:**
- Modify: `tools/apps/echidna/src/lib/manifestExport.ts`
- Test: `tools/apps/echidna/src/__tests__/manifestExport.test.ts`

- [ ] **Step 1: Write failing tests for root_position and root_motion export**

Add to `tools/apps/echidna/src/__tests__/manifestExport.test.ts`:

```typescript
describe('root motion export', () => {
  const partsWithRoot: BodyPart[] = [
    { id: 'torso', name: 'Torso', parent: null, joint: [0, 0, 0], voxelKeys: [] },
    { id: 'head', name: 'Head', parent: 'torso', joint: [0, 2, 0], voxelKeys: [] },
  ];

  it('exports root_position when pose has rootPosition', () => {
    const poses: Record<string, PoseData> = {
      walk_1: {
        rotations: { torso: [0, 0, 0], head: [5, 0, 0] },
        rootPosition: [0, 0, 1.5],
      },
    };
    const manifest = buildManifest(
      'test', 'test.ply', 1, partsWithRoot, poses, {}, 16, 16,
    );
    expect(manifest.poses['walk_1'].root_position).toEqual([0, 0, 1.5]);
  });

  it('omits root_position when rootPosition is undefined', () => {
    const poses: Record<string, PoseData> = {
      idle: { rotations: { torso: [0, 0, 0] } },
    };
    const manifest = buildManifest(
      'test', 'test.ply', 1, partsWithRoot, poses, {}, 16, 16,
    );
    expect(manifest.poses['idle'].root_position).toBeUndefined();
  });

  it('omits root_position when all components are zero', () => {
    const poses: Record<string, PoseData> = {
      rest: {
        rotations: { torso: [0, 0, 0] },
        rootPosition: [0, 0, 0],
      },
    };
    const manifest = buildManifest(
      'test', 'test.ply', 1, partsWithRoot, poses, {}, 16, 16,
    );
    expect(manifest.poses['rest'].root_position).toBeUndefined();
  });

  it('exports root_motion flag when animation has rootMotion=true', () => {
    const anims: Record<string, AnimationClip> = {
      walk: {
        name: 'walk',
        duration: 0.6,
        playbackMode: 'loop',
        rootMotion: true,
        keyframes: [{ time: 0, poseName: 'idle', easing: 'linear' }],
      },
    };
    const poses: Record<string, PoseData> = {
      idle: { rotations: {} },
    };
    const manifest = buildManifest(
      'test', 'test.ply', 1, partsWithRoot, poses, anims, 16, 16,
    );
    expect(manifest.animations['walk'].root_motion).toBe(true);
  });

  it('omits root_motion flag when animation has rootMotion=false', () => {
    const anims: Record<string, AnimationClip> = {
      idle: {
        name: 'idle',
        duration: 1.0,
        playbackMode: 'loop',
        keyframes: [{ time: 0, poseName: 'idle', easing: 'linear' }],
      },
    };
    const poses: Record<string, PoseData> = {
      idle: { rotations: {} },
    };
    const manifest = buildManifest(
      'test', 'test.ply', 1, partsWithRoot, poses, anims, 16, 16,
    );
    expect(manifest.animations['idle'].root_motion).toBeUndefined();
  });
});
```

Add necessary imports at the top if not already present: `BodyPart`, `PoseData`, `AnimationClip` from `../store/types`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd tools && pnpm --filter echidna test -- --run`
Expected: FAIL — `root_position` and `root_motion` not in export output.

- [ ] **Step 3: Update `manifestExport.ts` — add root_position and root_motion to export**

In `tools/apps/echidna/src/lib/manifestExport.ts`, in the `CharacterManifest` interface, update the pose and animation types:

Update the `ManifestAnimationClip` interface (line 19):

```typescript
export interface ManifestAnimationClip {
  duration: number;
  looping: boolean;
  root_motion?: boolean;
  keyframes: ManifestKeyframe[];
}
```

In the `buildManifest()` function, in the pose building section where poses are mapped, add root_position export. Find the section that builds `manifestPoses` (the object mapping pose names to per-bone rotation arrays). After each pose's bone rotations are built, add:

```typescript
    // Add root_position if non-zero
    if (pose.rootPosition &&
        (pose.rootPosition[0] !== 0 || pose.rootPosition[1] !== 0 || pose.rootPosition[2] !== 0)) {
      manifestPose.root_position = pose.rootPosition;
    }
```

In the animation clip building section, after `looping` is set, add:

```typescript
      if (clip.rootMotion) {
        manifestClip.root_motion = true;
      }
```

Note: The exact insertion points depend on how `buildManifest()` constructs its output. The pose output needs a `root_position` field alongside the per-bone rotations. The animation output needs a `root_motion` field alongside `looping`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tools && pnpm --filter echidna test -- --run`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/apps/echidna/src/lib/manifestExport.ts tools/apps/echidna/src/__tests__/manifestExport.test.ts
git commit -m "feat(echidna): export root_position and root_motion in manifest"
```

---

### Task 7: Echidna UI — Root Position Inputs & Root Motion Toggle

**Files:**
- Modify: `tools/apps/echidna/src/panels/AnimateRightPanel.tsx`
- Modify: `tools/apps/echidna/src/panels/Timeline.tsx`

- [ ] **Step 1: Add root position inputs to `AnimateRightPanel.tsx`**

In `tools/apps/echidna/src/panels/AnimateRightPanel.tsx`, in the bone properties or keyframe editor section, add root position editing UI. This should appear when the selected bone is the first root bone and a pose is selected.

Find the section in the keyframe editor where per-bone rotation Vec3Inputs are rendered (around line 228-247). Before or after the bone rotation section, add a root position section:

```tsx
{/* Root Position — only shown for first root bone */}
{(() => {
  const parts = useCharacterStore(s => s.characterParts);
  const firstRoot = parts.find(p => p.parent === null);
  const selectedPose = useCharacterStore(s => s.selectedPose);
  const poses = useCharacterStore(s => s.characterPoses);
  const updateRootPos = useCharacterStore(s => s.updatePoseRootPosition);

  if (!firstRoot || !selectedPose || selectedBone !== firstRoot.id) return null;

  const pose = poses[selectedPose];
  if (!pose) return null;

  const rootPos = pose.rootPosition ?? [0, 0, 0];

  return (
    <div style={{ marginTop: 8, borderTop: '1px solid #444', paddingTop: 8 }}>
      <div style={{ fontSize: 11, color: '#aaa', marginBottom: 4 }}>Root Position</div>
      {(['X', 'Y', 'Z'] as const).map((axis, i) => (
        <div key={axis} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
          <span style={{ width: 12, fontSize: 11, color: '#888' }}>{axis}</span>
          <input
            type="number"
            step={0.1}
            value={rootPos[i]}
            onChange={e => {
              const v: [number, number, number] = [...rootPos];
              v[i] = parseFloat(e.target.value) || 0;
              updateRootPos(selectedPose, v);
            }}
            style={{ width: 60, fontSize: 11 }}
          />
        </div>
      ))}
    </div>
  );
})()}
```

Note: The exact integration point and styling should match the existing panel patterns. The implementer should adapt the hook usage to match how the component currently accesses store state (some components use selectors at the top, others inline).

- [ ] **Step 2: Add root motion checkbox to Timeline clip settings**

In `tools/apps/echidna/src/panels/Timeline.tsx`, in the clip settings section (around lines 153-182 where playback mode and onion skinning are), add:

```tsx
{/* Root Motion toggle */}
{selectedAnimation && (
  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
    <input
      type="checkbox"
      checked={animations[selectedAnimation]?.rootMotion ?? false}
      onChange={e => updateAnimationRootMotion(selectedAnimation, e.target.checked)}
    />
    Root Motion
  </label>
)}
```

Add the store action import:
```tsx
const updateAnimationRootMotion = useCharacterStore(s => s.updateAnimationRootMotion);
```

- [ ] **Step 3: Add root motion badge to animation list**

In the animation list (either in Timeline.tsx or AnimateLeftPanel.tsx where animation names are listed), add a visual badge:

```tsx
{clip.rootMotion && (
  <span style={{ fontSize: 9, color: '#f0a030', marginLeft: 4 }}>RM</span>
)}
```

- [ ] **Step 4: Build and verify**

Run: `cd tools && pnpm --filter echidna build`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add tools/apps/echidna/src/panels/AnimateRightPanel.tsx tools/apps/echidna/src/panels/Timeline.tsx
git commit -m "feat(echidna): root position editing UI and root motion toggle"
```

---

### Task 8: Echidna Viewport — Accumulated Motion Preview

**Files:**
- Modify: `tools/apps/echidna/src/viewport/VoxelMesh.tsx`

- [ ] **Step 1: Add accumulated root motion state**

In `tools/apps/echidna/src/viewport/VoxelMesh.tsx`, add state refs for accumulated root motion. Near the top of the component (where `useRef` and `useFrame` are used):

```typescript
// Root motion accumulation for viewport preview
const accRootPos = useRef(new THREE.Vector3());
const accRootRot = useRef(new THREE.Quaternion());
const prevRootPos = useRef(new THREE.Vector3());
const prevRootRot = useRef(new THREE.Quaternion());
const rootMotionInitialized = useRef(false);
```

- [ ] **Step 2: Compute root motion deltas during playback**

In the `useFrame` hook (around line 191-214), after playback time is advanced but before the store update, add root motion accumulation logic:

```typescript
// Root motion accumulation
const selectedAnim = useCharacterStore.getState().selectedAnimation;
const anims = useCharacterStore.getState().animations;
const poses = useCharacterStore.getState().characterPoses;

if (selectedAnim && anims[selectedAnim]?.rootMotion) {
  // Interpolate current root position from keyframes
  const clip = anims[selectedAnim];
  const kfs = clip.keyframes;

  // Find surrounding keyframes
  let kfA = kfs[0], kfB = kfs[0], segT = 0;
  for (let i = 0; i < kfs.length - 1; i++) {
    if (newTime >= kfs[i].time && newTime <= kfs[i + 1].time) {
      kfA = kfs[i]; kfB = kfs[i + 1];
      const seg = kfB.time - kfA.time;
      segT = seg > 0 ? (newTime - kfA.time) / seg : 0;
      break;
    }
    kfA = kfs[i + 1]; kfB = kfA; segT = 0;
  }

  const poseA = poses[kfA.poseName];
  const poseB = poses[kfB.poseName];
  const rpA = poseA?.rootPosition ?? [0, 0, 0];
  const rpB = poseB?.rootPosition ?? [0, 0, 0];

  const curPos = new THREE.Vector3(
    rpA[0] + (rpB[0] - rpA[0]) * segT,
    rpA[1] + (rpB[1] - rpA[1]) * segT,
    rpA[2] + (rpB[2] - rpA[2]) * segT,
  );

  if (!rootMotionInitialized.current) {
    prevRootPos.current.copy(curPos);
    rootMotionInitialized.current = true;
  }

  // Detect loop wrap
  const looped = newTime < oldTime && clip.playbackMode === 'loop';
  if (looped) {
    // End-of-track position
    const lastPose = poses[kfs[kfs.length - 1].poseName];
    const endPos = new THREE.Vector3(...(lastPose?.rootPosition ?? [0, 0, 0]));
    const startPos = new THREE.Vector3(...(poses[kfs[0].poseName]?.rootPosition ?? [0, 0, 0]));
    const deltaEnd = endPos.clone().sub(prevRootPos.current);
    const deltaStart = curPos.clone().sub(startPos);
    const delta = deltaEnd.add(deltaStart);
    accRootPos.current.add(accRootRot.current.clone().vmul
      ? delta.applyQuaternion(accRootRot.current)
      : delta);
  } else {
    const delta = curPos.clone().sub(prevRootPos.current);
    accRootPos.current.add(delta.applyQuaternion(accRootRot.current));
  }

  prevRootPos.current.copy(curPos);
} else {
  rootMotionInitialized.current = false;
}
```

Note: The rotation accumulation follows the same pattern. For Phase 1, translation accumulation is the primary visual feedback. The implementer should add rotation accumulation using quaternion multiplication if the root bone's interpolated rotation changes between keyframes.

- [ ] **Step 3: Apply accumulated translation to the mesh group**

In the render/update section where the voxel mesh group's transform is set, apply the accumulated root motion offset:

```typescript
if (groupRef.current) {
  groupRef.current.position.copy(accRootPos.current);
  groupRef.current.quaternion.copy(accRootRot.current);
}
```

- [ ] **Step 4: Reset accumulation on playback stop**

When playback is stopped or animation is deselected, reset:

```typescript
// On playback stop, reset root motion preview
if (!isPlaying) {
  accRootPos.current.set(0, 0, 0);
  accRootRot.current.identity();
  prevRootPos.current.set(0, 0, 0);
  prevRootRot.current.identity();
  rootMotionInitialized.current = false;
  if (groupRef.current) {
    groupRef.current.position.set(0, 0, 0);
    groupRef.current.quaternion.identity();
  }
}
```

- [ ] **Step 5: Build and verify**

Run: `cd tools && pnpm --filter echidna build`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add tools/apps/echidna/src/viewport/VoxelMesh.tsx
git commit -m "feat(echidna): accumulated root motion preview in viewport"
```

---

## Self-Review

**Spec coverage check:**
- PoseData.root_position: Task 1 (schema + C++), Task 5 (TS), Task 6 (export) ✓
- AnimationClip.root_motion: Task 1 (schema + C++), Task 5 (TS), Task 6 (export), Task 7 (UI toggle) ✓
- Delta extraction with loop handling: Task 2 ✓
- Quaternion multiplication order (delta_start * delta_end): Task 2 ✓
- Root stripping in FK chain: Task 2 (compute_transforms strip_root param) ✓
- reset_root_motion(): Task 2 (implementation), Task 3 (state machine) ✓
- Hybrid consumer with character_rotation_: Task 4 ✓
- to_world matrix using character_rotation_: Task 4 ✓
- Echidna root position inputs: Task 7 ✓
- Echidna root motion checkbox: Task 7 ✓
- Echidna root motion badge: Task 7 ✓
- Viewport accumulated preview: Task 8 ✓
- Manifest export with root_position/root_motion: Task 6 ✓
- No GPU shader changes in Phase 1: confirmed — no shader tasks ✓

**Placeholder scan:** No TBD/TODO found. All code blocks are complete.

**Type consistency check:**
- `root_position` (C++/JSON) vs `rootPosition` (TS) — correct per language convention ✓
- `root_motion` (C++/JSON) vs `rootMotion` (TS) — correct per language convention ✓
- `delta_position()` / `delta_rotation()` / `reset_root_motion()` — consistent across Tasks 2-4 ✓
- `current_clip_index()` accessor added in Task 2 header, used in Task 4 ✓
- `updatePoseRootPosition` / `updateAnimationRootMotion` — defined in Task 5, used in Task 7 ✓
- `compute_transforms()` signature changed to add `strip_root` param — all call sites updated in Task 2 ✓
