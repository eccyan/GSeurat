// Test: GS post-process parameter struct and UBO packing.
//
// Validates:
// 1. GsPostProcessParams default values match PostProcessParams
// 2. Parameter forwarding round-trip
// 3. GsPostProcessUbo packing matches std140 layout (7 × vec4 = 112 bytes)
// 4. Feature flag interaction (disabled effects → zero values)
//
// Run: ctest -R test_gs_post_process

#include "gseurat/engine/gs_renderer.hpp"
#include "gseurat/engine/post_process.hpp"

#include <cassert>
#include <cmath>
#include <cstdio>
#include <cstring>

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

static bool approx(float a, float b, float eps = 0.001f) {
    return std::fabs(a - b) < eps;
}

// Helper: convert PostProcessParams → GsPostProcessParams (mirrors renderer.cpp logic)
static gseurat::GsPostProcessParams from_pp(const gseurat::PostProcessParams& pp) {
    gseurat::GsPostProcessParams gs{};
    gs.fog_density = pp.fog_density;
    gs.fog_color_r = pp.fog_color_r;
    gs.fog_color_g = pp.fog_color_g;
    gs.fog_color_b = pp.fog_color_b;
    gs.exposure = pp.exposure;
    gs.vignette_radius = pp.vignette_radius;
    gs.vignette_softness = pp.vignette_softness;
    gs.bloom_intensity = pp.bloom_intensity;
    gs.bloom_threshold = pp.bloom_threshold;
    gs.fade_amount = pp.fade_amount;
    gs.flash_r = pp.flash_r;
    gs.flash_g = pp.flash_g;
    gs.flash_b = pp.flash_b;
    gs.ca_intensity = pp.ca_intensity;
    gs.dof_focus_distance = pp.dof_focus_distance;
    gs.dof_focus_range = pp.dof_focus_range;
    gs.dof_max_blur = pp.dof_max_blur;
    return gs;
}

// Helper: pack GsPostProcessParams into UBO (mirrors gs_renderer.cpp logic)
static gseurat::GsPostProcessUbo pack_ubo(const gseurat::GsPostProcessParams& p,
                                            float width, float height) {
    gseurat::GsPostProcessUbo ubo{};
    ubo.fog_params = glm::vec4(p.fog_density, p.fog_color_r, p.fog_color_g, p.fog_color_b);
    ubo.exposure_vignette = glm::vec4(p.exposure, p.vignette_radius, p.vignette_softness,
                                       p.bloom_intensity);
    ubo.bloom_fade = glm::vec4(p.bloom_threshold, p.fade_amount, p.flash_r, p.flash_g);
    ubo.effects = glm::vec4(p.flash_b, p.ca_intensity, p.dof_focus_distance, p.dof_focus_range);
    ubo.dimensions = glm::vec4(p.dof_max_blur, width, height, p.far_plane);
    return ubo;
}

// ── Default values ──

static void test_defaults_match_post_process() {
    std::printf("=== Default values match PostProcessParams ===\n");
    gseurat::PostProcessParams pp{};
    gseurat::GsPostProcessParams gs{};

    check(approx(gs.fog_density, pp.fog_density), "fog_density default matches");
    check(approx(gs.fog_color_r, pp.fog_color_r), "fog_color_r default matches");
    check(approx(gs.fog_color_g, pp.fog_color_g), "fog_color_g default matches");
    check(approx(gs.fog_color_b, pp.fog_color_b), "fog_color_b default matches");
    check(approx(gs.exposure, pp.exposure), "exposure default matches");
    check(approx(gs.vignette_radius, pp.vignette_radius), "vignette_radius default matches");
    check(approx(gs.vignette_softness, pp.vignette_softness), "vignette_softness default matches");
    check(approx(gs.bloom_intensity, pp.bloom_intensity), "bloom_intensity default matches");
    check(approx(gs.bloom_threshold, pp.bloom_threshold), "bloom_threshold default matches");
    check(approx(gs.fade_amount, pp.fade_amount), "fade_amount default matches");
    check(approx(gs.flash_r, pp.flash_r), "flash_r default matches");
    check(approx(gs.flash_g, pp.flash_g), "flash_g default matches");
    check(approx(gs.flash_b, pp.flash_b), "flash_b default matches");
    check(approx(gs.ca_intensity, pp.ca_intensity), "ca_intensity default matches");
    check(approx(gs.dof_focus_distance, pp.dof_focus_distance), "dof_focus_distance default matches");
    check(approx(gs.dof_focus_range, pp.dof_focus_range), "dof_focus_range default matches");
}

// ── Parameter forwarding ──

static void test_parameter_forwarding() {
    std::printf("=== Parameter forwarding ===\n");
    gseurat::PostProcessParams pp{};
    pp.fog_density = 0.5f;
    pp.fog_color_r = 0.8f;
    pp.fog_color_g = 0.7f;
    pp.fog_color_b = 0.6f;
    pp.exposure = 2.0f;
    pp.vignette_radius = 0.5f;
    pp.vignette_softness = 0.3f;
    pp.bloom_intensity = 0.8f;
    pp.bloom_threshold = 1.5f;
    pp.fade_amount = 0.2f;
    pp.flash_r = 0.1f;
    pp.flash_g = 0.2f;
    pp.flash_b = 0.3f;
    pp.ca_intensity = 0.05f;
    pp.dof_focus_distance = 20.0f;
    pp.dof_focus_range = 5.0f;
    pp.dof_max_blur = 0.8f;

    auto gs = from_pp(pp);

    check(approx(gs.fog_density, 0.5f), "fog_density forwarded");
    check(approx(gs.fog_color_r, 0.8f), "fog_color_r forwarded");
    check(approx(gs.fog_color_g, 0.7f), "fog_color_g forwarded");
    check(approx(gs.fog_color_b, 0.6f), "fog_color_b forwarded");
    check(approx(gs.exposure, 2.0f), "exposure forwarded");
    check(approx(gs.vignette_radius, 0.5f), "vignette_radius forwarded");
    check(approx(gs.vignette_softness, 0.3f), "vignette_softness forwarded");
    check(approx(gs.bloom_intensity, 0.8f), "bloom_intensity forwarded");
    check(approx(gs.bloom_threshold, 1.5f), "bloom_threshold forwarded");
    check(approx(gs.fade_amount, 0.2f), "fade_amount forwarded");
    check(approx(gs.flash_r, 0.1f), "flash_r forwarded");
    check(approx(gs.flash_g, 0.2f), "flash_g forwarded");
    check(approx(gs.flash_b, 0.3f), "flash_b forwarded");
    check(approx(gs.ca_intensity, 0.05f), "ca_intensity forwarded");
    check(approx(gs.dof_focus_distance, 20.0f), "dof_focus_distance forwarded");
    check(approx(gs.dof_focus_range, 5.0f), "dof_focus_range forwarded");
    check(approx(gs.dof_max_blur, 0.8f), "dof_max_blur forwarded");
}

// ── UBO packing ──

static void test_ubo_packing() {
    std::printf("=== UBO packing (std140 layout) ===\n");

    // UBO must be exactly 7 × vec4 = 112 bytes
    check(sizeof(gseurat::GsPostProcessUbo) == 112, "UBO size is 112 bytes");

    // Verify field offsets match std140 vec4 alignment
    check(offsetof(gseurat::GsPostProcessUbo, fog_params) == 0, "fog_params at offset 0");
    check(offsetof(gseurat::GsPostProcessUbo, exposure_vignette) == 16, "exposure_vignette at offset 16");
    check(offsetof(gseurat::GsPostProcessUbo, bloom_fade) == 32, "bloom_fade at offset 32");
    check(offsetof(gseurat::GsPostProcessUbo, effects) == 48, "effects at offset 48");
    check(offsetof(gseurat::GsPostProcessUbo, dimensions) == 64, "dimensions at offset 64");

    // Verify packing maps fields correctly
    gseurat::GsPostProcessParams p{};
    p.fog_density = 0.5f;
    p.fog_color_r = 0.1f;
    p.fog_color_g = 0.2f;
    p.fog_color_b = 0.3f;
    p.exposure = 1.5f;
    p.bloom_threshold = 2.0f;
    p.dof_focus_distance = 15.0f;

    auto ubo = pack_ubo(p, 320.0f, 240.0f);

    check(approx(ubo.fog_params.x, 0.5f), "UBO fog_density packed at fog_params.x");
    check(approx(ubo.fog_params.y, 0.1f), "UBO fog_color_r packed at fog_params.y");
    check(approx(ubo.fog_params.z, 0.2f), "UBO fog_color_g packed at fog_params.z");
    check(approx(ubo.fog_params.w, 0.3f), "UBO fog_color_b packed at fog_params.w");
    check(approx(ubo.exposure_vignette.x, 1.5f), "UBO exposure packed at exposure_vignette.x");
    check(approx(ubo.bloom_fade.x, 2.0f), "UBO bloom_threshold packed at bloom_fade.x");
    check(approx(ubo.effects.z, 15.0f), "UBO dof_focus_distance packed at effects.z");
    check(approx(ubo.dimensions.y, 320.0f), "UBO width packed at dimensions.y");
    check(approx(ubo.dimensions.z, 240.0f), "UBO height packed at dimensions.z");
    check(approx(ubo.dimensions.w, 1000.0f), "UBO far_plane packed at dimensions.w");
}

// ── Feature flag interaction ──

static void test_feature_flags_disable_effects() {
    std::printf("=== Feature flags disable effects ===\n");

    // Simulate what renderer.cpp does when flags are off
    gseurat::PostProcessParams pp{};
    pp.fog_density = 0.5f;
    pp.bloom_intensity = 0.8f;
    pp.vignette_radius = 0.6f;
    pp.exposure = 2.0f;
    pp.dof_max_blur = 1.0f;

    // Simulate flags off (same logic as renderer.cpp):
    // if (!flags.bloom) pp.bloom_intensity = 0.0f;
    // if (!flags.fog) pp.fog_density = 0.0f;
    // if (!flags.vignette) pp.vignette_radius = 2.0f;
    // if (!flags.tone_mapping) pp.exposure = 1.0f;
    // if (!flags.depth_of_field) pp.dof_max_blur = 0.0f;
    pp.bloom_intensity = 0.0f;
    pp.fog_density = 0.0f;
    pp.vignette_radius = 2.0f;
    pp.exposure = 1.0f;
    pp.dof_max_blur = 0.0f;

    auto gs = from_pp(pp);

    check(approx(gs.fog_density, 0.0f), "fog disabled → density 0");
    check(approx(gs.bloom_intensity, 0.0f), "bloom disabled → intensity 0");
    check(approx(gs.vignette_radius, 2.0f), "vignette disabled → radius 2.0 (no visible effect)");
    check(approx(gs.exposure, 1.0f), "tone mapping disabled → exposure 1.0 (neutral)");
    check(approx(gs.dof_max_blur, 0.0f), "DoF disabled → max_blur 0");
}

// ── dof_max_blur default differs ──

static void test_dof_max_blur_default() {
    std::printf("=== DoF max_blur GS default ===\n");
    gseurat::PostProcessParams pp{};
    gseurat::GsPostProcessParams gs{};

    // GS default is 0.5 (lighter blur for pixel-art), PP default is 1.0
    check(approx(pp.dof_max_blur, 1.0f), "PostProcessParams dof_max_blur default is 1.0");
    check(approx(gs.dof_max_blur, 0.5f), "GsPostProcessParams dof_max_blur default is 0.5");
}

// ── Background UBO packing ──

static void test_background_ubo_packing() {
    std::printf("\n== test_background_ubo_packing ==\n");

    // UBO should be 7 × vec4 = 112 bytes (was 5 × vec4 = 80)
    check(sizeof(gseurat::GsPostProcessUbo) == 112,
          "GsPostProcessUbo is 112 bytes (7 x vec4)");

    // Check that background fields pack correctly
    gseurat::GsPostProcessUbo ubo{};
    ubo.ground_sky = glm::vec4(0.4f, 0.3f, 0.2f, 0.5f);  // ground rgb + horizon_y
    ubo.sky_enable = glm::vec4(0.5f, 0.6f, 0.8f, 1.0f);   // sky rgb + enable flag

    // Verify field offsets via pointer arithmetic
    const auto* base = reinterpret_cast<const char*>(&ubo);
    const auto* ground_ptr = reinterpret_cast<const char*>(&ubo.ground_sky);
    const auto* sky_ptr = reinterpret_cast<const char*>(&ubo.sky_enable);

    check(ground_ptr - base == 80, "ground_sky at offset 80 (after 5 existing vec4s)");
    check(sky_ptr - base == 96, "sky_enable at offset 96");

    check(approx(ubo.ground_sky.x, 0.4f), "ground_sky.x = ground_r");
    check(approx(ubo.ground_sky.w, 0.5f), "ground_sky.w = horizon_y");
    check(approx(ubo.sky_enable.z, 0.8f), "sky_enable.z = sky_b");
    check(approx(ubo.sky_enable.w, 1.0f), "sky_enable.w = enable flag");
}

int main() {
    std::printf("test_gs_post_process\n");

    test_defaults_match_post_process();
    test_parameter_forwarding();
    test_ubo_packing();
    test_feature_flags_disable_effects();
    test_dof_max_blur_default();
    test_background_ubo_packing();

    std::printf("\n%d passed, %d failed\n", passed, failed);
    return failed > 0 ? 1 : 0;
}
