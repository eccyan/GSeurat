// Test: VFX light element activation/deactivation and rotation_y transforms.
//
// Validates:
// 1. Light elements activate/deactivate based on timeline
// 2. rotation_y correctly transforms element positions
// 3. PointLight coordinate mapping (world XYZ → PointLight format)
// 4. Looping vs non-looping light behavior
//
// Run: ctest -R test_vfx_lights_rotation

#include "gseurat/engine/gs_vfx.hpp"

#include <cassert>
#include <cmath>
#include <cstdio>
#include <vector>

static int passed = 0;
static int failed = 0;

static void check(bool cond, const char* msg) {
    if (cond) {
        std::printf("  PASS: %s\n", msg);
        passed++;
    } else {
        std::printf("  FAIL: %s\n", msg);
        failed++;
    }
}

static bool approx(float a, float b, float eps = 0.1f) {
    return std::fabs(a - b) < eps;
}

// Helper to create a VFX preset with a single light element
static gseurat::VfxPreset make_light_preset(
    glm::vec3 light_pos, float start, float duration, bool loop,
    glm::vec3 color = {1, 0.5f, 0}, float intensity = 5.0f, float radius = 10.0f)
{
    gseurat::VfxPreset preset;
    preset.name = "test_light";
    preset.duration = 3.0f;

    gseurat::VfxElementData el;
    el.name = "light1";
    el.type = "light";
    el.position = light_pos;
    el.start = start;
    el.duration = duration;
    el.loop = loop;
    el.light_color = color;
    el.light_intensity = intensity;
    el.light_radius = radius;
    preset.elements.push_back(el);

    return preset;
}

// Dummy buffer + animator for update() calls
static std::vector<gseurat::Gaussian> dummy_buffer;
static gseurat::GaussianAnimator dummy_animator;

void test_light_activates_at_start_time() {
    std::printf("Light activates at start time:\n");

    auto preset = make_light_preset({5, 10, 0}, 1.0f, 2.0f, false);
    gseurat::VfxInstance inst;
    inst.init(preset, {0, 0, 0}, false, 0.0f);

    // Before start time — no lights
    inst.update(0.5f, dummy_buffer, dummy_animator);
    check(inst.active_lights().empty(), "no lights before start time (t=0.5)");

    // At start time — light activates
    inst.update(0.6f, dummy_buffer, dummy_animator);  // elapsed = 1.1
    check(inst.active_lights().size() == 1, "light active after start time (t=1.1)");
}

void test_light_deactivates_after_duration() {
    std::printf("Light deactivates after duration:\n");

    auto preset = make_light_preset({0, 0, 0}, 0.0f, 1.0f, false);
    gseurat::VfxInstance inst;
    inst.init(preset, {0, 0, 0}, false, 0.0f);

    inst.update(0.5f, dummy_buffer, dummy_animator);
    check(inst.active_lights().size() == 1, "light active during window (t=0.5)");

    inst.update(0.6f, dummy_buffer, dummy_animator);  // elapsed = 1.1
    check(inst.active_lights().empty(), "light off after duration (t=1.1)");
}

void test_looping_light_stays_active() {
    std::printf("Looping light stays active:\n");

    auto preset = make_light_preset({0, 0, 0}, 0.5f, 0.0f, true);
    gseurat::VfxInstance inst;
    inst.init(preset, {0, 0, 0}, true, 0.0f);

    inst.update(0.3f, dummy_buffer, dummy_animator);
    check(inst.active_lights().empty(), "not yet active before start (t=0.3)");

    inst.update(0.3f, dummy_buffer, dummy_animator);  // elapsed = 0.6
    check(inst.active_lights().size() == 1, "active after start time (t=0.6)");

    // Still active much later
    inst.update(2.0f, dummy_buffer, dummy_animator);  // elapsed = 2.6
    check(inst.active_lights().size() == 1, "still active at t=2.6 (looping)");
}

void test_light_color_and_intensity() {
    std::printf("Light color and intensity:\n");

    auto preset = make_light_preset({0, 5, 0}, 0.0f, 3.0f, false,
                                    {1.0f, 0.5f, 0.0f}, 7.0f, 25.0f);
    gseurat::VfxInstance inst;
    inst.init(preset, {0, 0, 0}, false, 0.0f);

    inst.update(0.1f, dummy_buffer, dummy_animator);
    check(inst.active_lights().size() == 1, "light is active");

    const auto& pl = inst.active_lights()[0];
    check(approx(pl.color.r, 1.0f), "color.r = 1.0");
    check(approx(pl.color.g, 0.5f), "color.g = 0.5");
    check(approx(pl.color.b, 0.0f), "color.b = 0.0");
    check(approx(pl.color.a, 7.0f), "intensity = 7.0");
    check(approx(pl.position_and_radius.w, 25.0f), "radius = 25.0");
}

void test_light_coordinate_mapping() {
    std::printf("Light coordinate mapping (world → PointLight):\n");

    // Light at position (10, 20, 30), instance at origin, no rotation
    auto preset = make_light_preset({10, 20, 30}, 0.0f, 3.0f, false);
    gseurat::VfxInstance inst;
    inst.init(preset, {0, 0, 0}, false, 0.0f);

    inst.update(0.1f, dummy_buffer, dummy_animator);
    const auto& pl = inst.active_lights()[0];

    // PointLight: x=world_x, y=world_z, z=world_y (height), w=radius
    check(approx(pl.position_and_radius.x, 10.0f), "pl.x = world_x = 10");
    check(approx(pl.position_and_radius.y, 30.0f), "pl.y = world_z = 30");
    check(approx(pl.position_and_radius.z, 20.0f), "pl.z = world_y (height) = 20");
}

void test_light_with_instance_offset() {
    std::printf("Light position includes instance offset:\n");

    auto preset = make_light_preset({5, 10, 0}, 0.0f, 3.0f, false);
    gseurat::VfxInstance inst;
    inst.init(preset, {100, 200, 300}, false, 0.0f);

    inst.update(0.1f, dummy_buffer, dummy_animator);
    const auto& pl = inst.active_lights()[0];

    // world_pos = instance_pos + element_pos = (105, 210, 300)
    check(approx(pl.position_and_radius.x, 105.0f), "x = 100 + 5 = 105");
    check(approx(pl.position_and_radius.z, 210.0f), "z (height) = 200 + 10 = 210");
    check(approx(pl.position_and_radius.y, 300.0f), "y = 300 + 0 = 300");
}

void test_rotation_90_degrees() {
    std::printf("Rotation 90 degrees:\n");

    // Light at (10, 0, 0), rotated 90° around Y
    // rotate_y: x' = x*cos + z*sin, z' = -x*sin + z*cos
    // cos(90°) ≈ 0, sin(90°) ≈ 1
    // So (10, 0, 0) → (0, 0, -10)
    auto preset = make_light_preset({10, 0, 0}, 0.0f, 3.0f, false);
    gseurat::VfxInstance inst;
    inst.init(preset, {0, 0, 0}, false, 90.0f);

    inst.update(0.1f, dummy_buffer, dummy_animator);
    const auto& pl = inst.active_lights()[0];

    check(approx(pl.position_and_radius.x, 0.0f, 0.5f), "rotated x ≈ 0");
    // world_z maps to pl.y, world_y maps to pl.z
    check(approx(pl.position_and_radius.y, -10.0f, 0.5f), "rotated z ≈ -10");
}

void test_rotation_180_degrees() {
    std::printf("Rotation 180 degrees:\n");

    // (10, 5, 0) rotated 180° → (-10, 5, 0)
    auto preset = make_light_preset({10, 5, 0}, 0.0f, 3.0f, false);
    gseurat::VfxInstance inst;
    inst.init(preset, {0, 0, 0}, false, 180.0f);

    inst.update(0.1f, dummy_buffer, dummy_animator);
    const auto& pl = inst.active_lights()[0];

    check(approx(pl.position_and_radius.x, -10.0f, 0.5f), "rotated x ≈ -10");
    check(approx(pl.position_and_radius.z, 5.0f, 0.5f), "height unchanged = 5");
}

void test_rotation_with_offset() {
    std::printf("Rotation with instance offset:\n");

    // Light at (10, 0, 0), instance at (50, 0, 50), rotated 90°
    // Rotated position: (0, 0, -10) + instance: (50, 0, 40)
    auto preset = make_light_preset({10, 0, 0}, 0.0f, 3.0f, false);
    gseurat::VfxInstance inst;
    inst.init(preset, {50, 0, 50}, false, 90.0f);

    inst.update(0.1f, dummy_buffer, dummy_animator);
    const auto& pl = inst.active_lights()[0];

    check(approx(pl.position_and_radius.x, 50.0f, 0.5f), "x = 50 + 0 = 50");
    check(approx(pl.position_and_radius.y, 40.0f, 0.5f), "z = 50 + (-10) = 40 → pl.y");
}

void test_multiple_lights_timeline() {
    std::printf("Multiple lights with staggered timeline:\n");

    gseurat::VfxPreset preset;
    preset.name = "multi_light";
    preset.duration = 5.0f;

    // Light A: active 0-2s
    gseurat::VfxElementData el_a;
    el_a.name = "A";
    el_a.type = "light";
    el_a.position = {0, 0, 0};
    el_a.start = 0.0f;
    el_a.duration = 2.0f;
    el_a.loop = false;
    el_a.light_color = {1, 0, 0};
    el_a.light_intensity = 5.0f;
    el_a.light_radius = 10.0f;
    preset.elements.push_back(el_a);

    // Light B: active 1-4s
    gseurat::VfxElementData el_b;
    el_b.name = "B";
    el_b.type = "light";
    el_b.position = {10, 0, 0};
    el_b.start = 1.0f;
    el_b.duration = 3.0f;
    el_b.loop = false;
    el_b.light_color = {0, 0, 1};
    el_b.light_intensity = 3.0f;
    el_b.light_radius = 20.0f;
    preset.elements.push_back(el_b);

    gseurat::VfxInstance inst;
    inst.init(preset, {0, 0, 0}, false, 0.0f);

    // t=0.5: only A
    inst.update(0.5f, dummy_buffer, dummy_animator);
    check(inst.active_lights().size() == 1, "t=0.5: only light A active");

    // t=1.5: both A and B
    inst.update(1.0f, dummy_buffer, dummy_animator);
    check(inst.active_lights().size() == 2, "t=1.5: both A and B active");

    // t=2.5: only B
    inst.update(1.0f, dummy_buffer, dummy_animator);
    check(inst.active_lights().size() == 1, "t=2.5: only light B active");

    // t=4.5: neither
    inst.update(2.0f, dummy_buffer, dummy_animator);
    check(inst.active_lights().empty(), "t=4.5: no lights active");
}

void test_active_lights_cleared_each_frame() {
    std::printf("Active lights cleared each frame:\n");

    auto preset = make_light_preset({0, 0, 0}, 0.0f, 1.0f, false);
    gseurat::VfxInstance inst;
    inst.init(preset, {0, 0, 0}, false, 0.0f);

    inst.update(0.1f, dummy_buffer, dummy_animator);
    check(inst.active_lights().size() == 1, "frame 1: 1 light");

    // Second update — should still be exactly 1, not 2
    inst.update(0.1f, dummy_buffer, dummy_animator);
    check(inst.active_lights().size() == 1, "frame 2: still 1 (not accumulated)");
}

int main() {
    std::printf("=== VFX Light Elements & Rotation Tests ===\n\n");

    test_light_activates_at_start_time();
    test_light_deactivates_after_duration();
    test_looping_light_stays_active();
    test_light_color_and_intensity();
    test_light_coordinate_mapping();
    test_light_with_instance_offset();
    test_rotation_90_degrees();
    test_rotation_180_degrees();
    test_rotation_with_offset();
    test_multiple_lights_timeline();
    test_active_lights_cleared_each_frame();

    std::printf("\n=== Results: %d passed, %d failed ===\n", passed, failed);
    return failed > 0 ? 1 : 0;
}
