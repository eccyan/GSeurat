#include "gseurat/character/character_manifest.hpp"

#include <fstream>
#include <nlohmann/json.hpp>

namespace gseurat {

int CharacterData::find_bone(const std::string& id) const {
    for (int i = 0; i < static_cast<int>(bones.size()); ++i) {
        if (bones[i].id == id) return i;
    }
    return -1;
}

int CharacterData::find_pose(const std::string& n) const {
    for (int i = 0; i < static_cast<int>(poses.size()); ++i) {
        if (poses[i].name == n) return i;
    }
    return -1;
}

int CharacterData::find_clip(const std::string& n) const {
    for (int i = 0; i < static_cast<int>(clips.size()); ++i) {
        if (clips[i].name == n) return i;
    }
    return -1;
}

std::optional<CharacterData> load_character_manifest(const std::string& path) {
    std::ifstream file(path);
    if (!file.is_open()) return std::nullopt;

    nlohmann::json root;
    try {
        root = nlohmann::json::parse(file);
    } catch (...) {
        return std::nullopt;
    }

    CharacterData data;
    data.name = root.value("name", "");
    data.ply_file = root.value("ply_file", "");
    data.scale = root.value("scale", 1.0f);

    // --- Bones ---
    if (root.contains("bones")) {
        for (auto& jb : root["bones"]) {
            BoneData bone;
            bone.id = jb.value("id", "");

            // Resolve parent string to index (-1 for null/root)
            bone.parent_index = -1;
            if (jb.contains("parent") && !jb["parent"].is_null()) {
                const auto parent_id = jb["parent"].get<std::string>();
                for (int i = 0; i < static_cast<int>(data.bones.size()); ++i) {
                    if (data.bones[i].id == parent_id) {
                        bone.parent_index = i;
                        break;
                    }
                }
            }

            // Joint position scaled by data.scale
            if (jb.contains("joint") && jb["joint"].is_array() && jb["joint"].size() >= 3) {
                bone.joint = glm::vec3(
                    jb["joint"][0].get<float>(),
                    jb["joint"][1].get<float>(),
                    jb["joint"][2].get<float>()
                ) * data.scale;
            }

            data.bones.push_back(std::move(bone));
        }
    }

    const int bone_count = static_cast<int>(data.bones.size());

    // --- Poses ---
    if (root.contains("poses") && root["poses"].is_object()) {
        for (auto& [pose_name, jp] : root["poses"].items()) {
            PoseData pose;
            pose.name = pose_name;
            pose.rotations.resize(bone_count, glm::vec3(0.0f));

            for (auto& [bone_id, jr] : jp.items()) {
                int bi = data.find_bone(bone_id);
                if (bi >= 0 && jr.is_array() && jr.size() >= 3) {
                    pose.rotations[bi] = glm::vec3(
                        jr[0].get<float>(),
                        jr[1].get<float>(),
                        jr[2].get<float>()
                    );
                }
            }

            data.poses.push_back(std::move(pose));
        }
    }

    // --- Animations ---
    if (root.contains("animations") && root["animations"].is_object()) {
        for (auto& [clip_name, jc] : root["animations"].items()) {
            AnimationClip clip;
            clip.name = clip_name;
            clip.duration = jc.value("duration", 1.0f);
            clip.looping = jc.value("looping", true);

            if (jc.contains("keyframes") && jc["keyframes"].is_array()) {
                for (auto& jk : jc["keyframes"]) {
                    AnimKeyframe kf;
                    kf.time = jk.value("time", 0.0f);

                    // Resolve pose name to index
                    const auto pose_name = jk.value("pose", "");
                    kf.pose_index = data.find_pose(pose_name);

                    clip.keyframes.push_back(kf);
                }
            }

            data.clips.push_back(std::move(clip));
        }
    }

    return data;
}

}  // namespace gseurat
