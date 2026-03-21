#pragma once

#include "gseurat/engine/game_state.hpp"

namespace gseurat {

class DemoGameplayState : public GameState {
public:
    void on_enter(AppBase& app) override;
    void on_exit(AppBase& app) override;
    void update(AppBase& app, float dt) override;
    void build_draw_lists(AppBase& app) override;

private:
    int selected_item_ = 0;
    bool panel_visible_ = true;
    bool scroll_needs_update_ = false;
};

}  // namespace gseurat
