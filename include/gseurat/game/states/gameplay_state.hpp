#pragma once

#include "gseurat/engine/game_state.hpp"

namespace gseurat {

class GameplayState : public GameState {
public:
    void on_enter(AppBase& app) override;
    void on_exit(AppBase& app) override;
    void update(AppBase& app, float dt) override;
    void build_draw_lists(AppBase& app) override;
};

}  // namespace gseurat
