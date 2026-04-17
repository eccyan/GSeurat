// Test: Oneshot playback, auto-free, pool overflow.
#include "gseurat/engine/audio/audio_engine.hpp"
#include "gseurat/engine/audio/memory_audio_source.hpp"

#include <cmath>
#include <cstdio>
#include <vector>

using namespace gseurat::audio;

static int passed = 0, failed = 0;
static void check(bool c, const char* m) {
    if (c) { std::printf("  PASS: %s\n", m); ++passed; }
    else   { std::printf("  FAIL: %s\n", m); ++failed; }
}
static bool approx(float a, float b, float eps = 5e-2f) { return std::fabs(a - b) < eps; }

int main() {
    std::printf("\n=== Oneshot playback tests ===\n\n");

    auto engine = AudioEngine::create(
        {.sample_rate=48000, .buffer_frames=256, .max_active_groups=1,
         .max_oneshot_voices=4},
        AudioEngine::Mode::Offline).value();

    auto sfx_r = engine->load_sfx("../../tests/test_data/audio/dc_unity.wav");
    check(sfx_r.has_value(), "load dc_unity as SFX");
    if (!sfx_r) return 1;
    const uint32_t sfx_id = sfx_r.value();

    // --- Oneshot playback at volume 0.8 ---
    engine->play_oneshot(sfx_id, 0.8f);
    std::vector<float> out(500 * 2, 0.0f);
    engine->render_offline(out, 500);
    // dc_unity = 0.5 per sample, gain = 0.8 -> output ~= 0.4
    check(approx(out[200 * 2], 0.4f), "oneshot output approx 0.4 (0.5 * 0.8)");

    // --- Auto-free: dc_unity has 24000 frames. Render past it. ---
    std::vector<float> out2(25000 * 2, 0.0f);
    engine->play_oneshot(sfx_id, 1.0f);
    engine->render_offline(out2, 25000);
    // Frame 23999 should have output; frame 24500+ should be zero
    check(!approx(out2[23999 * 2], 0.0f), "frame 23999: still playing");
    check(approx(out2[24500 * 2], 0.0f, 1e-4f), "frame 24500: silence (auto-freed)");

    // --- Pool overflow: pool=4, push 5 ---
    for (int i = 0; i < 5; ++i) engine->play_oneshot(sfx_id, 1.0f);
    std::vector<float> out3(256 * 2, 0.0f);
    engine->render_offline(out3, 256);
    check(engine->dropped_command_count() >= 1, "pool overflow increments dropped counter");

    std::printf("\n=== %d passed, %d failed ===\n", passed, failed);
    return failed == 0 ? 0 : 1;
}
