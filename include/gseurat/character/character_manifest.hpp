#pragma once
#include <glm/glm.hpp>
#include <optional>
#include <string>
#include <vector>

namespace gseurat {

struct BoneData {
    std::string id;
    int parent_index = -1;   // -1 for root
    glm::vec3 joint{0.0f};   // pivot point (already scaled)
};

struct PoseData {
    std::string name;
    std::vector<glm::vec3> rotations;  // per-bone Euler degrees, indexed by bone index
};

struct AnimKeyframe {
    float time = 0.0f;
    int pose_index = 0;
};

struct AnimationClip {
    std::string name;
    float duration = 1.0f;
    bool looping = true;
    std::vector<AnimKeyframe> keyframes;
};

struct CharacterData {
    std::string name;
    std::string ply_file;
    float scale = 1.0f;
    std::vector<BoneData> bones;
    std::vector<PoseData> poses;
    std::vector<AnimationClip> clips;

    int find_bone(const std::string& id) const;
    int find_pose(const std::string& name) const;
    int find_clip(const std::string& name) const;
};

std::optional<CharacterData> load_character_manifest(const std::string& path);

}  // namespace gseurat
