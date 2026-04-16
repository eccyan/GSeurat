#include "gseurat/engine/systems/portal_trigger_handler.hpp"

#include "gseurat/engine/ecs/components/portal_target.hpp"
#include "gseurat/engine/ecs/components/scene_transition.hpp"
#include "gseurat/engine/ecs/components/screen_fade.hpp"
#include "gseurat/engine/trigger_components.hpp"

#include <cstdio>
#include <optional>

namespace gseurat {

void portal_trigger_handler(ecs::World& world) {
    bool transition_in_flight = false;
    world.view<ScreenFade>().each(
        [&](ecs::Entity, ScreenFade&) { transition_in_flight = true; });
    if (transition_in_flight) return;

    std::optional<PortalTarget> to_spawn;
    ecs::Entity consumed_portal_entity{};
    world.view<ProximityTrigger, PortalTarget>().each(
        [&](ecs::Entity e, ProximityTrigger& trig, PortalTarget& portal) {
            if (to_spawn.has_value()) return;
            if (!trig.triggered) return;
            if (portal.target_scene.empty()) return;
            to_spawn = portal;
            consumed_portal_entity = e;
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

    // Mark the source portal as consumed so it doesn't re-fire after FadeIn completes
    // (defensive: even if init_scene retains the portal entity, this prevents a re-spawn).
    if (auto* trig = world.try_get<ProximityTrigger>(consumed_portal_entity)) {
        trig->triggered = false;
        trig->was_triggered = true;
    }

    std::fprintf(stderr,
        "[SceneTransition] spawned: target='%s' position=(%.1f, %.1f, %.1f) "
        "fade_duration=%.2fs\n",
        to_spawn->target_scene.c_str(),
        to_spawn->target_position.x, to_spawn->target_position.y, to_spawn->target_position.z,
        to_spawn->fade_duration);
}

}  // namespace gseurat
