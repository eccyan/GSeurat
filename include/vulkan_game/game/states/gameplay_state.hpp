#pragma once

#include "vulkan_game/engine/game_state.hpp"

namespace vulkan_game {

class GameplayState : public GameState {
public:
    void on_enter(AppBase& app) override;
    void on_exit(AppBase& app) override;
    void update(AppBase& app, float dt) override;
    void build_draw_lists(AppBase& app) override;
};

}  // namespace vulkan_game
