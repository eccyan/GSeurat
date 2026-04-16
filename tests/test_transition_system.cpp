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
    std::vector<std::string> init_scene_calls;
    std::vector<glm::vec3>   set_player_position_calls;
    void init_scene(const std::string& p) override { init_scene_calls.push_back(p); }
    void set_player_position(const glm::vec3& p) override { set_player_position_calls.push_back(p); }
};

static bool approx(float a, float b, float eps = 0.001f) {
    return std::fabs(a - b) < eps;
}

// Creates a transient transition entity directly (bypassing the handler).
static ecs::Entity spawn_direct(ecs::World& w, const std::string& scene, glm::vec3 pos, float dur) {
    auto e = w.create();
    SceneTransition st;
    st.current_state   = SceneTransition::State::FadeOut;
    st.timer           = 0.0f;
    st.fade_duration   = dur;
    st.target_scene    = scene;
    st.target_position = pos;
    st.load_dispatched = false;
    w.add<SceneTransition>(e, st);

    ScreenFade fade;
    fade.color = glm::vec3(1.0f);
    fade.alpha = 0.0f;
    w.add<ScreenFade>(e, fade);
    return e;
}

int main() {
    // ====== Test 1: FadeOut ramp ======
    {
        ecs::World w;
        FakeHost host;
        spawn_direct(w, "dummy.json", {0, 0, 0}, 1.0f);

        transition_system(w, host, 0.25f);
        bool checked = false;
        w.view<ScreenFade>().each([&](ecs::Entity, ScreenFade& f) {
            assert(approx(f.alpha, 0.25f) && "alpha should be 0.25 after 0.25s of 1.0s fade");
            checked = true;
        });
        assert(checked);

        transition_system(w, host, 0.5f);
        w.view<ScreenFade>().each([&](ecs::Entity, ScreenFade& f) {
            assert(approx(f.alpha, 0.75f) && "alpha should be 0.75 after 0.75s");
        });
        printf("PASS: Test 1 - FadeOut ramp\n");
    }

    // ====== Test 2: FadeOut → Loading at alpha=1 ======
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
        printf("PASS: Test 2 - FadeOut completion transitions to Loading\n");
    }

    // ====== Test 3: Loading first tick calls host exactly once ======
    {
        ecs::World w;
        FakeHost host;
        spawn_direct(w, "target.json", {7.0f, 0.0f, 3.0f}, 0.5f);

        transition_system(w, host, 0.5f);
        transition_system(w, host, 0.016f);

        assert(host.init_scene_calls.size() == 1);
        assert(host.init_scene_calls[0] == "target.json");
        assert(host.set_player_position_calls.size() == 1);
        assert(approx(host.set_player_position_calls[0].x, 7.0f));
        assert(approx(host.set_player_position_calls[0].z, 3.0f));
        printf("PASS: Test 3 - Loading first tick calls host exactly once\n");
    }

    // ====== Test 4: Loading second tick → FadeIn, no re-call ======
    {
        ecs::World w;
        FakeHost host;
        spawn_direct(w, "target.json", {0, 0, 0}, 0.5f);

        transition_system(w, host, 0.5f);
        transition_system(w, host, 0.016f);
        transition_system(w, host, 0.016f);

        assert(host.init_scene_calls.size() == 1 && "host should NOT be re-called");
        w.view<SceneTransition>().each([&](ecs::Entity, SceneTransition& st) {
            assert(st.current_state == SceneTransition::State::FadeIn);
            assert(approx(st.timer, 0.0f));
        });
        printf("PASS: Test 4 - Loading one-frame settle advances to FadeIn\n");
    }

    // ====== Test 5: FadeIn ramp ======
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
        printf("PASS: Test 5 - FadeIn ramp\n");
    }

    // ====== Test 6: FadeIn completion destroys entity ======
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
        printf("PASS: Test 6 - FadeIn completion destroys entity\n");
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
        pta.fade_color = glm::vec3(0.2f, 0.2f, 0.2f);
        pta.fade_duration = 0.3f;
        w.add<PortalTarget>(portal, pta);

        portal_trigger_handler(w);

        assert(w.view<SceneTransition>().count() == 1);
        assert(w.view<ScreenFade>().count() == 1);

        w.view<SceneTransition, ScreenFade>().each(
            [&](ecs::Entity, SceneTransition& st, ScreenFade& f) {
                assert(st.target_scene == "dungeon.json");
                assert(approx(st.target_position.x, 5.0f));
                assert(approx(st.fade_duration, 0.3f));
                assert(approx(f.color.r, 0.2f));
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
        pta.fade_duration = 0.2f;
        w.add<PortalTarget>(portal, pta);

        portal_trigger_handler(w);
        assert(w.view<SceneTransition>().count() == 1);

        transition_system(w, host, 0.2f);
        transition_system(w, host, 0.016f);
        transition_system(w, host, 0.016f);
        transition_system(w, host, 0.2f);

        assert(host.init_scene_calls.size() == 1);
        assert(host.init_scene_calls[0] == "final.json");
        assert(w.view<SceneTransition>().count() == 0);
        printf("PASS: Test 10 - End-to-end full cycle\n");
    }

    printf("\nAll scene transition tests passed!\n");
    return 0;
}
