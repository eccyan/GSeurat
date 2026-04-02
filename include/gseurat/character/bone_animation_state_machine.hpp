#pragma once
#include "gseurat/character/bone_animation_player.hpp"
#include <string>
#include <unordered_map>

namespace gseurat {

class BoneAnimationStateMachine {
public:
    explicit BoneAnimationStateMachine(BoneAnimationPlayer& player);
    void add_state(const std::string& state_name, const std::string& clip_name);
    void set_state(const std::string& state_name);
    const std::string& current_state() const { return current_state_; }

private:
    BoneAnimationPlayer& player_;
    std::string current_state_;
    std::unordered_map<std::string, std::string> state_to_clip_;
};

}  // namespace gseurat
