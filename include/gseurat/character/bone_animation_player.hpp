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
    bool is_playing() const { return playing_; }

    // Root motion accessors
    glm::vec3 delta_position() const { return frame_delta_position_; }
    glm::quat delta_rotation() const { return frame_delta_rotation_; }
    void reset_root_motion();
    int current_clip_index() const { return current_clip_index_; }

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

    struct KeyframePair {
        int a = 0;
        int b = 0;
        float t = 0.0f;
    };

    glm::mat4 bone_to_mat4(int bone_index, const glm::vec3& euler_deg) const;
    void compute_transforms(const PoseData& pose_a, const PoseData& pose_b, float t, bool strip_root);
    glm::vec3 interpolate_root_position(const PoseData& pose_a, const PoseData& pose_b, float t) const;
    glm::quat interpolate_root_rotation(const PoseData& pose_a, const PoseData& pose_b, float t) const;
    KeyframePair find_keyframe_pair(const AnimationClip& clip, float time) const;
};

}  // namespace gseurat
