#include "gseurat/engine/systems/transition_system.hpp"

#include "gseurat/engine/ecs/components/scene_transition.hpp"
#include "gseurat/engine/ecs/components/screen_fade.hpp"

#include <algorithm>
#include <cstdio>
#include <vector>

namespace gseurat {

void transition_system(ecs::World& world, ITransitionHost& host, float dt) {
    auto progress = [](const SceneTransition& st) -> float {
        if (st.fade_duration <= 0.0f) return 1.0f;
        return std::clamp(st.timer / st.fade_duration, 0.0f, 1.0f);
    };

    // Collected during iteration, processed AFTER view.each returns.
    // Necessary because host.clear_scene() destroys ECS entities and
    // invalidates the view's archetype pointers — anything done from
    // inside view.each that touches the world is undefined behavior.
    struct PendingDispatch {
        std::string scene;
        glm::vec3   position;
    };
    std::vector<PendingDispatch> to_dispatch;
    std::vector<ecs::Entity>     to_destroy;

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
                        std::fprintf(stderr, "[SceneTransition] FadeOut -> Loading (target='%s')\n",
                                     st.target_scene.c_str());
                    }
                    break;
                }

                case SceneTransition::State::Loading: {
                    if (!st.load_dispatched) {
                        // Queue dispatch; actual host calls happen below.
                        to_dispatch.push_back({st.target_scene, st.target_position});
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
                        std::fprintf(stderr, "[SceneTransition] FadeIn complete -> destroying entity\n");
                    }
                    break;
                }
            }
        });

    // Safe now — view iteration is complete.
    // Note: host.transition_scene() will destroy the transient SceneTransition+
    // ScreenFade entity (along with everything else). That's expected — the
    // transition is now "consumed". The next frame, the per-frame ScreenFade
    // reset in AppBase will see no entity and the overlay returns to alpha=0
    // automatically.
    for (const auto& d : to_dispatch) {
        host.transition_scene(d.scene, d.position);
    }

    for (auto e : to_destroy) world.destroy(e);
}

}  // namespace gseurat
