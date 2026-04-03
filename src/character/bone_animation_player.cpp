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
        compute_transforms(pose, pose, 0.0f);
    }
}

void BoneAnimationPlayer::update(float dt) {
    if (!playing_ || current_clip_index_ < 0) return;

    const auto& clip = data_.clips[current_clip_index_];
    playback_time_ += dt;

    // Handle looping
    if (clip.looping && clip.duration > 0.0f) {
        playback_time_ = std::fmod(playback_time_, clip.duration);
    } else if (playback_time_ >= clip.duration) {
        playback_time_ = clip.duration;
        playing_ = false;
    }

    // Find surrounding keyframes
    const auto& keyframes = clip.keyframes;
    if (keyframes.empty()) return;

    // Find the two keyframes surrounding playback_time_
    int kf_a = 0;
    int kf_b = 0;
    for (size_t i = 0; i < keyframes.size() - 1; ++i) {
        if (playback_time_ >= keyframes[i].time && playback_time_ <= keyframes[i + 1].time) {
            kf_a = static_cast<int>(i);
            kf_b = static_cast<int>(i + 1);
            break;
        }
        // If we're past this segment, advance
        kf_a = static_cast<int>(i + 1);
        kf_b = kf_a;
    }

    const auto& pose_a = data_.poses[keyframes[kf_a].pose_index];
    const auto& pose_b = data_.poses[keyframes[kf_b].pose_index];

    float t = 0.0f;
    float segment_duration = keyframes[kf_b].time - keyframes[kf_a].time;
    if (segment_duration > 0.0f) {
        t = (playback_time_ - keyframes[kf_a].time) / segment_duration;
    }

    compute_transforms(pose_a, pose_b, t);
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

void BoneAnimationPlayer::compute_transforms(const PoseData& pose_a, const PoseData& pose_b, float t) {
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
        if (parent >= 0 && parent < 32) {
            transforms_[i] = transforms_[parent] * local;
        } else {
            transforms_[i] = local;
        }
    }
}

}  // namespace gseurat
