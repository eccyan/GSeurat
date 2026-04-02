#include "gseurat/character/bone_animation_state_machine.hpp"

namespace gseurat {

BoneAnimationStateMachine::BoneAnimationStateMachine(BoneAnimationPlayer& player)
    : player_(player) {}

void BoneAnimationStateMachine::add_state(
    const std::string& state_name, const std::string& clip_name) {
    state_to_clip_[state_name] = clip_name;
}

void BoneAnimationStateMachine::set_state(const std::string& state_name) {
    auto it = state_to_clip_.find(state_name);
    if (it == state_to_clip_.end()) return;  // ignore unregistered
    if (state_name == current_state_) return;  // skip same state
    current_state_ = state_name;
    player_.play(it->second);
}

}  // namespace gseurat
