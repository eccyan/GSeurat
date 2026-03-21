#pragma once
#include "gseurat/engine/animation.hpp"
#include <string>
#include <glm/glm.hpp>

namespace gseurat {

class AnimationStateMachine {
public:
    void configure(Tileset tileset);
    void add_clip(AnimationClip clip);
    void transition_to(const std::string& state_name);  // no-op if same state
    void update(float dt);
    glm::vec2 current_uv_min() const;
    glm::vec2 current_uv_max() const;
    const std::string& current_state() const { return current_state_; }

private:
    AnimationController controller_;
    std::string current_state_;  // "" = no state active; first transition always triggers play()
};

}  // namespace gseurat
