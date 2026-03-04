#pragma once

#include "vulkan_game/engine/game_state.hpp"

namespace vulkan_game {

class DemoGameplayState : public GameState {
public:
    void on_enter(App& app) override;
    void on_exit(App& app) override;
    void update(App& app, float dt) override;
    void build_draw_lists(App& app) override;

private:
    int selected_item_ = 0;
    bool panel_visible_ = true;
    bool scroll_needs_update_ = false;
};

}  // namespace vulkan_game
