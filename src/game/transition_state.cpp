#include "vulkan_game/game/states/transition_state.hpp"
#include "vulkan_game/engine/app_base.hpp"
#include "vulkan_game/engine/ecs/default_components.hpp"
#include "vulkan_game/game/components.hpp"

namespace vulkan_game {

TransitionState::TransitionState(std::string target_scene, glm::vec3 spawn_pos, Direction facing)
    : target_scene_(std::move(target_scene))
    , spawn_position_(spawn_pos)
    , spawn_facing_(facing) {}

void TransitionState::on_enter(AppBase& app) {
    app.set_transitioning(true);
    phase_ = FadeOut;
    fade_ = 0.0f;
}

void TransitionState::on_exit(AppBase& app) {
    app.set_transitioning(false);
    app.renderer().set_fade_amount(0.0f);
}

void TransitionState::update(AppBase& app, float dt) {
    switch (phase_) {
        case FadeOut:
            fade_ += dt * kFadeSpeed;
            if (fade_ >= 1.0f) {
                fade_ = 1.0f;
                phase_ = Load;
            }
            app.renderer().set_fade_amount(fade_);
            break;

        case Load: {
            // Preserve day/night time across scene transitions
            float saved_time = app.day_night_system().time_of_day();

            // Clear old scene and load new one
            app.clear_scene();
            app.init_scene(target_scene_);

            // Restore day/night time if new scene has it enabled
            if (app.day_night_system().active()) {
                app.day_night_system().set_time_of_day(saved_time);
            }

            // Set player position and facing
            if (app.player_id().valid()) {
                app.world().get<ecs::Transform>(app.player_id()).position = spawn_position_;
                app.world().get<ecs::Facing>(app.player_id()).dir = spawn_facing_;

                auto& anim = app.world().get<ecs::Animation>(app.player_id());
                anim.state_machine.transition_to(
                    "idle_" + std::string(direction_suffix(spawn_facing_)));

                app.renderer().camera().set_follow_target(spawn_position_);
            }

            phase_ = FadeIn;
            break;
        }

        case FadeIn:
            fade_ -= dt * kFadeSpeed;
            if (fade_ <= 0.0f) {
                fade_ = 0.0f;
                phase_ = Done;
            }
            app.renderer().set_fade_amount(fade_);
            break;

        case Done:
            app.state_stack().pop(app);
            break;
    }
}

void TransitionState::build_draw_lists(AppBase& /*app*/) {
    // Fade effect is handled via renderer's fade_amount, no sprites needed
}

}  // namespace vulkan_game
