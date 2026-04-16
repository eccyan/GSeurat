#include "gseurat/engine/systems/portal_trigger_handler.hpp"

#include "gseurat/engine/ecs/components/portal_target.hpp"
#include "gseurat/engine/ecs/components/scene_transition.hpp"
#include "gseurat/engine/ecs/components/screen_fade.hpp"
#include "gseurat/engine/trigger_components.hpp"

#include <optional>

namespace gseurat {

void portal_trigger_handler(ecs::World& world) {
    bool transition_in_flight = false;
    world.view<ScreenFade>().each(
        [&](ecs::Entity, ScreenFade&) { transition_in_flight = true; });
    if (transition_in_flight) return;

    std::optional<PortalTarget> to_spawn;
    world.view<ProximityTrigger, PortalTarget>().each(
        [&](ecs::Entity, ProximityTrigger& trig, PortalTarget& portal) {
            if (to_spawn.has_value()) return;
            if (!trig.triggered) return;
            if (portal.target_scene.empty()) return;
            to_spawn = portal;
        });

    if (!to_spawn.has_value()) return;

    auto e = world.create();

    SceneTransition st;
    st.current_state   = SceneTransition::State::FadeOut;
    st.timer           = 0.0f;
    st.fade_duration   = to_spawn->fade_duration;
    st.target_scene    = to_spawn->target_scene;
    st.target_position = to_spawn->target_position;
    st.load_dispatched = false;
    world.add<SceneTransition>(e, st);

    ScreenFade fade;
    fade.color = to_spawn->fade_color;
    fade.alpha = 0.0f;
    world.add<ScreenFade>(e, fade);
}

}  // namespace gseurat
