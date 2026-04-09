#include "gseurat/staging/visual_state.hpp"
#include <cstdio>
#include <cstring>
#include <nlohmann/json.hpp>

static int passed = 0, failed = 0;
static void check(bool cond, const char* msg) {
    if (cond) { std::printf("  PASS: %s\n", msg); passed++; }
    else { std::printf("  FAIL: %s\n", msg); failed++; }
}

void test_panel_on_screen() {
    gseurat::PanelInfo p;
    p.name = "Render Settings";
    p.visible = true;
    p.pos_x = 1020; p.pos_y = 30;
    p.size_w = 250; p.size_h = 400;
    p.display_w = 1280; p.display_h = 720;

    check(p.is_on_screen(), "panel at 1020 fits in 1280 display");

    p.display_w = 1024;
    check(!p.is_on_screen(), "panel at 1020+250 exceeds 1024 display");

    p.pos_x = -300;
    check(!p.is_on_screen(), "panel fully off left edge");

    p.pos_x = 0; p.pos_y = -500;
    check(!p.is_on_screen(), "panel fully off top edge");
}

void test_visual_state_to_json() {
    gseurat::VisualState vs;
    vs.panels.push_back({"Info", true, 10, 30, 250, 120, 1280, 720});
    vs.gizmos.push_back({"lights", true, 3});
    vs.scene.gaussians_visible = 4521;
    vs.scene.gaussians_total = 12000;
    vs.scene.game_objects_loaded = 8;
    vs.scene.terrain_loaded = true;
    vs.scene.character_visible = true;
    vs.features["bloom"] = true;
    vs.features["dof"] = false;
    vs.camera_review.active = false;

    auto j = vs.to_json();

    check(j["panels"].is_array(), "panels is array");
    check(j["panels"][0]["name"] == "Info", "panel name serialized");
    check(j["panels"][0]["on_screen"] == true, "on_screen computed");
    check(j["gizmos"]["lights"]["enabled"] == true, "gizmo enabled");
    check(j["gizmos"]["lights"]["count"] == 3, "gizmo count");
    check(j["scene"]["gaussians_visible"] == 4521, "gaussian visible");
    check(j["features"]["bloom"] == true, "feature bloom");
    check(j["camera_review"]["active"] == false, "camera review inactive");
}

void test_visual_state_diff() {
    gseurat::VisualState a;
    a.scene.gaussians_total = 12000;
    a.scene.game_objects_loaded = 8;
    a.features["bloom"] = true;
    a.gizmos.push_back({"lights", true, 3});

    gseurat::VisualState b;
    b.scene.gaussians_total = 8000;  // changed
    b.scene.game_objects_loaded = 8;  // same
    b.features["bloom"] = false;      // changed
    b.gizmos.push_back({"lights", true, 5}); // count changed

    auto diff = gseurat::visual_state_diff(a.to_json(), b.to_json());

    check(diff.contains("changed"), "diff has changed section");
    // Flatten comparison — check that gaussians_total is flagged
    auto changed = diff["changed"];
    bool found_gaussians = false;
    for (auto& [k, v] : changed.items()) {
        if (k.find("gaussians_total") != std::string::npos) found_gaussians = true;
    }
    check(found_gaussians, "gaussians_total flagged as changed");
}

int main() {
    std::printf("=== test_visual_state ===\n");
    test_panel_on_screen();
    test_visual_state_to_json();
    test_visual_state_diff();
    std::printf("\n%d passed, %d failed\n", passed, failed);
    return failed > 0 ? 1 : 0;
}
