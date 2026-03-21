#include "gseurat/engine/animation_state_machine.hpp"

namespace gseurat {

void AnimationStateMachine::configure(Tileset tileset) {
    controller_.set_sheet(tileset);
}

void AnimationStateMachine::add_clip(AnimationClip clip) {
    controller_.add_clip(std::move(clip));
}

void AnimationStateMachine::transition_to(const std::string& state_name) {
    if (state_name == current_state_) return;
    current_state_ = state_name;
    controller_.play(state_name);
}

void AnimationStateMachine::update(float dt) {
    controller_.update(dt);
}

glm::vec2 AnimationStateMachine::current_uv_min() const {
    return controller_.current_uv_min();
}

glm::vec2 AnimationStateMachine::current_uv_max() const {
    return controller_.current_uv_max();
}

}  // namespace gseurat
