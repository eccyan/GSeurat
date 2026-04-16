// tests/test_transition_system.cpp
//
// Standalone unit test for the scene transition state machine.
// No Vulkan dependency — uses ITransitionHost fake.

#include "gseurat/engine/ecs/components/portal_target.hpp"
#include "gseurat/engine/ecs/components/scene_transition.hpp"
#include "gseurat/engine/ecs/components/screen_fade.hpp"
#include "gseurat/engine/ecs/world.hpp"
#include "gseurat/engine/systems/portal_trigger_handler.hpp"
#include "gseurat/engine/systems/transition_system.hpp"
#include "gseurat/engine/trigger_components.hpp"

#include <cassert>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

using namespace gseurat;

struct FakeHost : ITransitionHost {
    struct Call {
        std::string scene;
        glm::vec3   position;
    };
    std::vector<Call> transition_calls;
    void transition_scene(const std::string& s, const glm::vec3& p) override {
        transition_calls.push_back({s, p});
    }
};

static bool approx(float a, float b, float eps = 0.001f) {
    return std::fabs(a - b) < eps;
}

// Creates a transient transition entity directly (bypassing the handler).
static ecs::Entity spawn_direct(ecs::World& w, const std::string& scene, glm::vec3 pos, float dur) {
    auto e = w.create();
    SceneTransition st;
    st.current_state       = SceneTransition::State::SceneOut;
    st.timer               = 0.0f;
    st.transition_duration = dur;
    st.target_scene        = scene;
    st.target_position     = pos;
    st.load_dispatched     = false;
    w.add<SceneTransition>(e, st);

    ScreenFade fade;
    fade.transition_color = glm::vec3(1.0f);
    fade.alpha            = 0.0f;
    w.add<ScreenFade>(e, fade);
    return e;
}

int main() {
    // ====== Test 1: SceneOut ramp ======
    {
        ecs::World w;
        FakeHost host;
        spawn_direct(w, "dummy.json", {0, 0, 0}, 1.0f);

        transition_system(w, host, 0.25f);
        bool checked = false;
        w.view<ScreenFade>().each([&](ecs::Entity, ScreenFade& f) {
            assert(approx(f.alpha, 0.25f) && "alpha should be 0.25 after 0.25s of 1.0s transition");
            checked = true;
        });
        assert(checked);

        transition_system(w, host, 0.5f);
        w.view<ScreenFade>().each([&](ecs::Entity, ScreenFade& f) {
            assert(approx(f.alpha, 0.75f) && "alpha should be 0.75 after 0.75s");
        });
        printf("PASS: Test 1 - SceneOut ramp\n");
    }

    // ====== Test 2: SceneOut → Loading at alpha=1 ======
    {
        ecs::World w;
        FakeHost host;
        spawn_direct(w, "dummy.json", {0, 0, 0}, 0.5f);

        transition_system(w, host, 0.5f);

        w.view<SceneTransition, ScreenFade>().each(
            [&](ecs::Entity, SceneTransition& st, ScreenFade& f) {
                assert(st.current_state == SceneTransition::State::Loading);
                assert(approx(st.timer, 0.0f) && "timer resets on state change");
                assert(approx(f.alpha, 1.0f) && "alpha pinned at 1.0");
            });
        printf("PASS: Test 2 - SceneOut completion transitions to Loading\n");
    }

    // ====== Test 3: Loading first tick calls host exactly once ======
    {
        ecs::World w;
        FakeHost host;
        spawn_direct(w, "target.json", {7.0f, 0.0f, 3.0f}, 0.5f);

        transition_system(w, host, 0.5f);
        transition_system(w, host, 0.016f);

        assert(host.transition_calls.size() == 1);
        assert(host.transition_calls[0].scene == "target.json");
        assert(approx(host.transition_calls[0].position.x, 7.0f));
        assert(approx(host.transition_calls[0].position.z, 3.0f));
        printf("PASS: Test 3 - Loading first tick calls host exactly once\n");
    }

    // ====== Test 4: Loading second tick → SceneIn, no re-call ======
    {
        ecs::World w;
        FakeHost host;
        spawn_direct(w, "target.json", {0, 0, 0}, 0.5f);

        transition_system(w, host, 0.5f);
        transition_system(w, host, 0.016f);
        transition_system(w, host, 0.016f);

        assert(host.transition_calls.size() == 1 && "host should NOT be re-called");
        w.view<SceneTransition>().each([&](ecs::Entity, SceneTransition& st) {
            assert(st.current_state == SceneTransition::State::SceneIn);
            assert(approx(st.timer, 0.0f));
        });
        printf("PASS: Test 4 - Loading one-frame settle advances to SceneIn\n");
    }

    // ====== Test 5: SceneIn ramp ======
    {
        ecs::World w;
        FakeHost host;
        spawn_direct(w, "target.json", {0, 0, 0}, 1.0f);

        transition_system(w, host, 1.0f);
        transition_system(w, host, 0.016f);
        transition_system(w, host, 0.016f);
        transition_system(w, host, 0.25f);

        w.view<ScreenFade>().each([&](ecs::Entity, ScreenFade& f) {
            assert(approx(f.alpha, 0.75f));
        });
        printf("PASS: Test 5 - SceneIn ramp\n");
    }

    // ====== Test 6: SceneIn completion destroys entity ======
    {
        ecs::World w;
        FakeHost host;
        spawn_direct(w, "target.json", {0, 0, 0}, 0.5f);

        transition_system(w, host, 0.5f);
        transition_system(w, host, 0.016f);
        transition_system(w, host, 0.016f);
        transition_system(w, host, 0.5f);

        assert(w.view<SceneTransition>().count() == 0);
        assert(w.view<ScreenFade>().count() == 0);
        printf("PASS: Test 6 - SceneIn completion destroys entity\n");
    }

    // ====== Test 7: Portal handler spawns transient entity ======
    {
        ecs::World w;
        auto portal = w.create();
        ProximityTrigger pt;
        pt.triggered = true;
        pt.radius = 2.0f;
        w.add<ProximityTrigger>(portal, pt);

        PortalTarget pta;
        pta.target_scene = "dungeon.json";
        pta.target_position = glm::vec3(5, 0, 3);
        pta.transition_color = glm::vec3(0.2f, 0.2f, 0.2f);
        pta.transition_duration = 0.3f;
        w.add<PortalTarget>(portal, pta);

        portal_trigger_handler(w);

        assert(w.view<SceneTransition>().count() == 1);
        assert(w.view<ScreenFade>().count() == 1);

        w.view<SceneTransition, ScreenFade>().each(
            [&](ecs::Entity, SceneTransition& st, ScreenFade& f) {
                assert(st.target_scene == "dungeon.json");
                assert(approx(st.target_position.x, 5.0f));
                assert(approx(st.transition_duration, 0.3f));
                assert(approx(f.transition_color.r, 0.2f));
                assert(approx(f.alpha, 0.0f));
            });
        printf("PASS: Test 7 - Portal handler spawns transient entity\n");
    }

    // ====== Test 8: Portal handler skips empty target_scene ======
    {
        ecs::World w;
        auto portal = w.create();
        ProximityTrigger pt;
        pt.triggered = true;
        w.add<ProximityTrigger>(portal, pt);

        PortalTarget pta;
        w.add<PortalTarget>(portal, pta);

        portal_trigger_handler(w);

        assert(w.view<SceneTransition>().count() == 0);
        printf("PASS: Test 8 - Portal handler skips empty target_scene\n");
    }

    // ====== Test 9: Concurrency invariant ======
    {
        ecs::World w;
        spawn_direct(w, "in_progress.json", {0, 0, 0}, 0.5f);

        auto portal = w.create();
        ProximityTrigger pt;
        pt.triggered = true;
        w.add<ProximityTrigger>(portal, pt);
        PortalTarget pta;
        pta.target_scene = "new_scene.json";
        w.add<PortalTarget>(portal, pta);

        portal_trigger_handler(w);

        assert(w.view<ScreenFade>().count() == 1);
        assert(w.view<SceneTransition>().count() == 1);
        w.view<SceneTransition>().each([&](ecs::Entity, SceneTransition& st) {
            assert(st.target_scene == "in_progress.json");
        });
        printf("PASS: Test 9 - Concurrency invariant holds\n");
    }

    // ====== Test 10: End-to-end full cycle ======
    {
        ecs::World w;
        FakeHost host;

        auto portal = w.create();
        ProximityTrigger pt;
        pt.triggered = true;
        w.add<ProximityTrigger>(portal, pt);
        PortalTarget pta;
        pta.target_scene = "final.json";
        pta.target_position = glm::vec3(1, 2, 3);
        pta.transition_duration = 0.2f;
        w.add<PortalTarget>(portal, pta);

        portal_trigger_handler(w);
        assert(w.view<SceneTransition>().count() == 1);

        transition_system(w, host, 0.2f);
        transition_system(w, host, 0.016f);
        transition_system(w, host, 0.016f);
        transition_system(w, host, 0.2f);

        assert(host.transition_calls.size() == 1);
        assert(host.transition_calls[0].scene == "final.json");
        assert(w.view<SceneTransition>().count() == 0);
        printf("PASS: Test 10 - End-to-end full cycle\n");
    }

    // ====== Test 11: transition_duration=0 produces no NaN, instant transition ======
    {
        ecs::World w;
        FakeHost host;
        spawn_direct(w, "instant.json", {0, 0, 0}, 0.0f);  // zero transition duration

        // First tick: should immediately advance SceneOut to Loading at alpha=1
        transition_system(w, host, 0.016f);
        bool checked = false;
        w.view<SceneTransition, ScreenFade>().each(
            [&](ecs::Entity, SceneTransition& st, ScreenFade& f) {
                assert(!std::isnan(f.alpha) && "alpha must not be NaN with transition_duration=0");
                assert(approx(f.alpha, 1.0f) && "instant SceneOut pins alpha at 1");
                assert(st.current_state == SceneTransition::State::Loading);
                checked = true;
            });
        assert(checked);
        printf("PASS: Test 11 - transition_duration=0 produces no NaN\n");
    }

    // ====== Test 12: handler consumes the source portal trigger to prevent re-fire ======
    {
        ecs::World w;
        auto portal = w.create();
        ProximityTrigger pt;
        pt.triggered = true;
        pt.one_shot = false;  // explicitly NOT one-shot — would re-fire without the consume
        w.add<ProximityTrigger>(portal, pt);

        PortalTarget pta;
        pta.target_scene = "next.json";
        w.add<PortalTarget>(portal, pta);

        portal_trigger_handler(w);

        // Verify trigger was consumed
        auto* trig = w.try_get<ProximityTrigger>(portal);
        assert(trig != nullptr);
        assert(trig->triggered == false && "handler should reset triggered");
        assert(trig->was_triggered == true && "handler should latch was_triggered");
        printf("PASS: Test 12 - handler consumes source portal trigger\n");
    }

    // ====== Test 13: transition_scene called exactly once with correct args ======
    {
        ecs::World w;
        FakeHost host;
        spawn_direct(w, "next.json", glm::vec3(11.0f, 0.0f, 22.0f), 0.5f);

        transition_system(w, host, 0.5f);     // SceneOut → Loading
        transition_system(w, host, 0.016f);   // Loading first tick: dispatch
        transition_system(w, host, 0.016f);   // Loading second tick: → SceneIn
        transition_system(w, host, 0.5f);     // SceneIn complete → destroy

        assert(host.transition_calls.size() == 1 && "transition_scene called exactly once");
        assert(host.transition_calls[0].scene == "next.json");
        assert(approx(host.transition_calls[0].position.x, 11.0f));
        assert(approx(host.transition_calls[0].position.z, 22.0f));
        printf("PASS: Test 13 - transition_scene called exactly once with correct args\n");
    }

    // ====== Test 14: effect_type propagates through portal handler ======
    {
        ecs::World w;
        FakeHost host;

        auto portal = w.create();
        ProximityTrigger pt;
        pt.triggered = true;
        w.add<ProximityTrigger>(portal, pt);

        PortalTarget pta;
        pta.target_scene = "wipe_scene.json";
        pta.target_position = glm::vec3(0, 0, 0);
        pta.transition_duration = 0.5f;
        pta.transition_color = glm::vec3(1.0f);
        pta.effect_type = 1;  // Left-to-Right Wipe
        w.add<PortalTarget>(portal, pta);

        portal_trigger_handler(w);

        // Spawned ScreenFade should carry the effect_type forward.
        assert(w.view<ScreenFade>().count() == 1);
        w.view<ScreenFade>().each([&](ecs::Entity, ScreenFade& f) {
            assert(f.effect_type == 1 && "effect_type should propagate from PortalTarget to ScreenFade");
        });

        // And SceneTransition state machine still runs correctly.
        transition_system(w, host, 0.5f);  // SceneOut → Loading
        w.view<SceneTransition>().each([&](ecs::Entity, SceneTransition& st) {
            assert(st.current_state == SceneTransition::State::Loading);
        });
        transition_system(w, host, 0.016f);  // dispatch
        transition_system(w, host, 0.016f);  // → SceneIn
        w.view<SceneTransition>().each([&](ecs::Entity, SceneTransition& st) {
            assert(st.current_state == SceneTransition::State::SceneIn);
        });
        assert(host.transition_calls.size() == 1);
        printf("PASS: Test 14 - effect_type propagates through portal handler\n");
    }

    printf("\nAll scene transition tests passed!\n");
    return 0;
}
