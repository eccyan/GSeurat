// Test: spatial distance attenuation, out-of-range silence, looping wrap, stop_all_sfx.
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
    std::printf("\n=== Spatial audio tests ===\n\n");

    auto engine = AudioEngine::create(
        {.sample_rate=48000, .buffer_frames=256, .max_active_groups=1,
         .max_oneshot_voices=8},
        AudioEngine::Mode::Offline).value();

    auto sfx_r = engine->load_sfx("../../tests/test_data/audio/dc_unity.wav");
    check(sfx_r.has_value(), "load dc_unity");
    if (!sfx_r) return 1;
    const uint32_t sfx_id = sfx_r.value();

    // --- Spatial attenuation: voice at (10,0,0), max_dist=20, listener at origin ---
    engine->set_listener_position(0, 0, 0);
    engine->play_looping_spatial(sfx_id, 10.0f, 0.0f, 0.0f, 20.0f, 1.0f);

    std::vector<float> out(500 * 2, 0.0f);
    engine->render_offline(out, 500);

    // dist=10, max=20 -> gain = 1 - 10/20 = 0.5. dc=0.5 -> output approx 0.25
    check(approx(out[200 * 2], 0.25f), "spatial gain 0.5 at dist=10, output approx 0.25");

    // --- Move listener to voice position -> gain = 1.0, output approx 0.5 ---
    engine->set_listener_position(10, 0, 0);
    std::vector<float> out2(500 * 2, 0.0f);
    engine->render_offline(out2, 500);
    check(approx(out2[200 * 2], 0.5f), "listener at voice pos: output approx 0.5");

    // --- Move listener far away -> out of range, output approx 0 ---
    engine->set_listener_position(100, 0, 0);
    std::vector<float> out3(500 * 2, 0.0f);
    engine->render_offline(out3, 500);
    check(approx(out3[200 * 2], 0.0f, 1e-4f), "out of range: output approx 0");

    // --- Looping: render past source length (24000), voice should still be playing ---
    engine->set_listener_position(10, 0, 0);  // back in range
    std::vector<float> out4(25000 * 2, 0.0f);
    engine->render_offline(out4, 25000);
    // After 25000 frames, looping voice wraps and continues. Frame 24500 has output.
    check(!approx(out4[24500 * 2], 0.0f, 1e-4f), "looping voice continues past source end");

    // --- stop_all_sfx ---
    engine->stop_all_sfx();
    std::vector<float> out5(500 * 2, 0.0f);
    engine->render_offline(out5, 500);
    check(approx(out5[200 * 2], 0.0f, 1e-4f), "stop_all_sfx: silence");

    std::printf("\n=== %d passed, %d failed ===\n", passed, failed);
    return failed == 0 ? 0 : 1;
}
