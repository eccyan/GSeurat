#pragma once

#include "gseurat/engine/direction.hpp"
#include "gseurat/engine/game_state.hpp"

#include <glm/glm.hpp>

#include <string>

namespace gseurat {

class TransitionState : public GameState {
public:
    TransitionState(std::string target_scene, glm::vec3 spawn_pos, Direction facing);

    void on_enter(AppBase& app) override;
    void on_exit(AppBase& app) override;
    void update(AppBase& app, float dt) override;
    void build_draw_lists(AppBase& app) override;
    bool is_overlay() const override { return true; }

private:
    enum Phase { FadeOut, Load, FadeIn, Done };
    Phase phase_ = FadeOut;
    float fade_ = 0.0f;
    static constexpr float kFadeSpeed = 2.0f;  // 0.5s per fade

    std::string target_scene_;
    glm::vec3 spawn_position_;
    Direction spawn_facing_;
};

}  // namespace gseurat
