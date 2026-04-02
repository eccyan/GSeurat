#pragma once
#include "gseurat/character/character_manifest.hpp"
#include <glm/glm.hpp>
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

private:
    const CharacterData& data_;
    std::string current_clip_name_;
    int current_clip_index_ = -1;
    float playback_time_ = 0.0f;
    bool playing_ = false;
    std::array<glm::mat4, 32> transforms_;

    glm::mat4 bone_to_mat4(int bone_index, const glm::vec3& euler_deg) const;
    void compute_transforms(const PoseData& pose_a, const PoseData& pose_b, float t);
};

}  // namespace gseurat
