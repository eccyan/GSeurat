#include "gseurat/character/bone_animation_player.hpp"
#include <glm/gtc/matrix_transform.hpp>
#define GLM_ENABLE_EXPERIMENTAL
#include <glm/gtx/euler_angles.hpp>
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

    // Compute initial pose at t=0
    const auto& clip = data_.clips[current_clip_index_];
    if (clip.keyframes.size() >= 1) {
        const auto& pose = data_.poses[clip.keyframes[0].pose_index];
        compute_transforms(pose, pose, 0.0f, clip.root_motion);
    }

    // Initialize root motion state from first keyframe
    if (clip.root_motion && !clip.keyframes.empty()) {
        const auto& first_pose = data_.poses[clip.keyframes[0].pose_index];
        prev_root_position_ = first_pose.root_position;
        prev_root_rotation_ = interpolate_root_rotation(first_pose, first_pose, 0.0f);
    }
    frame_delta_position_ = glm::vec3(0.0f);
    frame_delta_rotation_ = glm::quat(1.0f, 0.0f, 0.0f, 0.0f);
}

void BoneAnimationPlayer::update(float dt) {
    if (!playing_ || current_clip_index_ < 0) return;

    const auto& clip = data_.clips[current_clip_index_];
    playback_time_ += dt;

    // Detect loop wrap-around
    bool looped = false;
    if (clip.looping && clip.duration > 0.0f) {
        if (playback_time_ >= clip.duration) {
            looped = true;
            playback_time_ = std::fmod(playback_time_, clip.duration);
        }
    } else if (playback_time_ >= clip.duration) {
        playback_time_ = clip.duration;
        playing_ = false;
    }

    // Find surrounding keyframes and interpolate
    auto kfp = find_keyframe_pair(clip, playback_time_);
    const auto& pose_a = data_.poses[clip.keyframes[kfp.a].pose_index];
    const auto& pose_b = data_.poses[clip.keyframes[kfp.b].pose_index];

    // Root motion delta computation
    if (clip.root_motion) {
        glm::vec3 cur_pos = interpolate_root_position(pose_a, pose_b, kfp.t);
        glm::quat cur_rot = interpolate_root_rotation(pose_a, pose_b, kfp.t);

        if (looped) {
            // Loop-aware delta: (end - prev) + (current - start)
            // Read end-of-clip pose directly (avoids magic epsilon sampling)
            const auto& end_pose = data_.poses[clip.keyframes.back().pose_index];
            glm::vec3 end_pos = end_pose.root_position;
            glm::quat end_rot = interpolate_root_rotation(end_pose, end_pose, 0.0f);

            // Get start-of-clip position/rotation
            const auto& start_pose = data_.poses[clip.keyframes[0].pose_index];
            glm::vec3 start_pos = start_pose.root_position;
            glm::quat start_rot = interpolate_root_rotation(start_pose, start_pose, 0.0f);

            // Position: (end - prev) + (current - start)
            frame_delta_position_ = (end_pos - prev_root_position_) + (cur_pos - start_pos);

            // Rotation: delta_start * delta_end
            // GLM right-to-left: compose (progress into new loop) after (remainder of old loop)
            glm::quat delta_end = end_rot * glm::inverse(prev_root_rotation_);
            glm::quat delta_start = cur_rot * glm::inverse(start_rot);
            frame_delta_rotation_ = delta_start * delta_end;
        } else {
            // Normal: delta = current - previous
            frame_delta_position_ = cur_pos - prev_root_position_;
            frame_delta_rotation_ = cur_rot * glm::inverse(prev_root_rotation_);
        }

        prev_root_position_ = cur_pos;
        prev_root_rotation_ = cur_rot;
    } else {
        frame_delta_position_ = glm::vec3(0.0f);
        frame_delta_rotation_ = glm::quat(1.0f, 0.0f, 0.0f, 0.0f);
    }

    compute_transforms(pose_a, pose_b, kfp.t, clip.root_motion);
}

void BoneAnimationPlayer::reset_root_motion() {
    if (current_clip_index_ < 0) return;

    const auto& clip = data_.clips[current_clip_index_];
    if (clip.root_motion && !clip.keyframes.empty()) {
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

void BoneAnimationPlayer::compute_transforms(const PoseData& pose_a, const PoseData& pose_b,
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

        // strip_root: root bone (parent_index < 0) gets identity
        if (strip_root && parent < 0) {
            transforms_[i] = glm::mat4(1.0f);
        } else if (parent >= 0 && parent < 32) {
            transforms_[i] = transforms_[parent] * local;
        } else {
            transforms_[i] = local;
        }
    }
}

glm::vec3 BoneAnimationPlayer::interpolate_root_position(const PoseData& pose_a,
                                                          const PoseData& pose_b,
                                                          float t) const {
    return glm::mix(pose_a.root_position, pose_b.root_position, t);
}

glm::quat BoneAnimationPlayer::interpolate_root_rotation(const PoseData& pose_a,
                                                          const PoseData& pose_b,
                                                          float t) const {
    // Root motion bone is the first bone with parent_index < 0 (convention from spec).
    // This must match the bone that compute_transforms() strips when strip_root=true.
    int root_idx = -1;
    for (int i = 0; i < static_cast<int>(data_.bones.size()); ++i) {
        if (data_.bones[i].parent_index < 0) { root_idx = i; break; }
    }

    glm::vec3 euler_a(0.0f);
    glm::vec3 euler_b(0.0f);
    if (root_idx >= 0) {
        if (root_idx < static_cast<int>(pose_a.rotations.size())) euler_a = pose_a.rotations[root_idx];
        if (root_idx < static_cast<int>(pose_b.rotations.size())) euler_b = pose_b.rotations[root_idx];
    }

    // Convert each to quaternion, then slerp (avoids gimbal lock and Euler discontinuities)
    glm::vec3 rad_a = glm::radians(euler_a);
    glm::vec3 rad_b = glm::radians(euler_b);
    glm::quat q_a = glm::quat(glm::eulerAngleXYZ(rad_a.x, rad_a.y, rad_a.z));
    glm::quat q_b = glm::quat(glm::eulerAngleXYZ(rad_b.x, rad_b.y, rad_b.z));
    return glm::slerp(q_a, q_b, t);
}

BoneAnimationPlayer::KeyframePair BoneAnimationPlayer::find_keyframe_pair(
    const AnimationClip& clip, float time) const {
    const auto& keyframes = clip.keyframes;
    if (keyframes.empty()) return {0, 0, 0.0f};

    int kf_a = 0;
    int kf_b = 0;
    for (size_t i = 0; i < keyframes.size() - 1; ++i) {
        if (time >= keyframes[i].time && time <= keyframes[i + 1].time) {
            kf_a = static_cast<int>(i);
            kf_b = static_cast<int>(i + 1);
            break;
        }
        kf_a = static_cast<int>(i + 1);
        kf_b = kf_a;
    }

    float t = 0.0f;
    float segment_duration = keyframes[kf_b].time - keyframes[kf_a].time;
    if (segment_duration > 0.0f) {
        t = (time - keyframes[kf_a].time) / segment_duration;
    }

    return {kf_a, kf_b, t};
}

}  // namespace gseurat
