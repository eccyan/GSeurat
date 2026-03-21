#pragma once

#include "gseurat/engine/game_state.hpp"

namespace gseurat {

class TitleState : public GameState {
public:
    void on_enter(AppBase& app) override;
    void update(AppBase& app, float dt) override;
    void build_draw_lists(AppBase& app) override;

private:
    float blink_timer_ = 0.0f;
    bool show_prompt_ = true;
    int selected_item_ = 0;
    bool has_save_ = false;
};

}  // namespace gseurat
