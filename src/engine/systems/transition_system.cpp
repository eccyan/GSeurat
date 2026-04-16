#include "gseurat/engine/systems/transition_system.hpp"

#include "gseurat/engine/ecs/components/scene_transition.hpp"
#include "gseurat/engine/ecs/components/screen_fade.hpp"

#include <algorithm>
#include <vector>

namespace gseurat {

void transition_system(ecs::World& world, ITransitionHost& host, float dt) {
    auto progress = [](const SceneTransition& st) -> float {
        if (st.fade_duration <= 0.0f) return 1.0f;  // instant fade, never NaN
        return std::clamp(st.timer / st.fade_duration, 0.0f, 1.0f);
    };

    std::vector<ecs::Entity> to_destroy;

    world.view<SceneTransition, ScreenFade>().each(
        [&](ecs::Entity e, SceneTransition& st, ScreenFade& fade) {
            st.timer += dt;

            switch (st.current_state) {
                case SceneTransition::State::FadeOut: {
                    const float t = progress(st);
                    fade.alpha = t;
                    if (t >= 1.0f) {
                        st.current_state = SceneTransition::State::Loading;
                        st.timer = 0.0f;
                        fade.alpha = 1.0f;
                    }
                    break;
                }

                case SceneTransition::State::Loading: {
                    if (!st.load_dispatched) {
                        // Clear old scene first — destination scene's init_scene
                        // will create new ECS entities that must not collide with
                        // the source scene's leftover state (player, triggers, etc.).
                        host.clear_scene();
                        host.init_scene(st.target_scene);
                        host.set_player_position(st.target_position);
                        st.load_dispatched = true;
                    } else {
                        st.current_state = SceneTransition::State::FadeIn;
                        st.timer = 0.0f;
                    }
                    break;
                }

                case SceneTransition::State::FadeIn: {
                    const float t = progress(st);
                    fade.alpha = 1.0f - t;
                    if (t >= 1.0f) {
                        fade.alpha = 0.0f;
                        to_destroy.push_back(e);
                    }
                    break;
                }
            }
        });

    for (auto e : to_destroy) world.destroy(e);
}

}  // namespace gseurat
