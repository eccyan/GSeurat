#pragma once

#include "vulkan_game/engine/game_state.hpp"

namespace vulkan_game {

class TitleState : public GameState {
public:
    void on_enter(App& app) override;
    void update(App& app, float dt) override;
    void build_draw_lists(App& app) override;

private:
    float blink_timer_ = 0.0f;
    bool show_prompt_ = true;
    int selected_item_ = 0;
    bool has_save_ = false;
};

}  // namespace vulkan_game
