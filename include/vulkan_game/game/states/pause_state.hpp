#pragma once

#include "vulkan_game/engine/game_state.hpp"

namespace vulkan_game {

class PauseState : public GameState {
public:
    void on_enter(AppBase& app) override;
    void update(AppBase& app, float dt) override;
    void build_draw_lists(AppBase& app) override;
    bool is_overlay() const override { return true; }

private:
    int selected_item_ = 0;
};

}  // namespace vulkan_game
