// Priority #1: sample-accurate loop wrap — no gap, no duplicate.
// Uses sine_loop.wav (480Hz sine at 48kHz, 50 full cycles in 24000 frames).
// When looped at frame 24000, wrap is bit-continuous: sin(0) == sin(2π*50) == 0.
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
static bool approx(float a, float b, float eps = 1e-3f) { return std::fabs(a - b) < eps; }

int main() {
    std::printf("\n=== Loop boundary — priority #1 ===\n\n");

    auto engine = AudioEngine::create(
        {.sample_rate=48000, .buffer_frames=128,  // small block size forces wrap mid-block
         .max_active_groups=2},
        AudioEngine::Mode::Offline).value();

    // Build a looping group from sine_loop.wav
    TrackGroupMetadata meta{};
    meta.id = 1;
    meta.name = "sine";
    meta.sample_rate = 48000;
    meta.loop_start = 0;
    meta.loop_end = 24000;  // loop at exactly 24000 frames
    meta.stems.push_back({"sine_loop.wav", 1.0f});

    std::vector<std::unique_ptr<IAudioSource>> stems;
    stems.push_back(std::move(
        MemoryAudioSource::from_wav_file("../../tests/test_data/audio/sine_loop.wav", 48000).value()));
    const uint32_t gid = engine->register_track_group_for_test(std::move(meta), std::move(stems));

    engine->play_group(gid);

    // Render 50,000 stereo frames — wraps twice (50000 / 24000 = 2+ loops)
    std::vector<float> out(50000 * 2, 0.0f);
    engine->render_offline(out, 50000);

    // Key assertions:
    //  frame 0:     sine starts at 0 → output ≈ 0
    //  frame 23999: last frame before wrap — NOT zero (sine mid-cycle)
    //  frame 24000: first frame of second loop → ≈ 0 (same as frame 0)
    //  frame 48000: first frame of third loop → ≈ 0
    //  frame 24001 should equal frame 1 (seamless continuity)

    check(approx(out[0 * 2], 0.0f),           "out[0] approx 0 (sine starts at 0)");
    check(approx(out[24000 * 2], 0.0f),       "out[24000] approx 0 (first wrap)");
    check(approx(out[48000 * 2], 0.0f),       "out[48000] approx 0 (second wrap)");

    // Frame 23999 should NOT be zero — proves no gap at boundary
    check(!approx(out[23999 * 2], 0.0f, 1e-4f),
          "out[23999] is not zero — no gap before wrap");

    // Seamless continuity: frame 24001 should match frame 1
    check(approx(out[24001 * 2], out[1 * 2], 1e-3f),
          "out[24001] == out[1] — seamless loop");

    // Group should still be playing (it's looping, not one-shot)
    check(engine->is_group_playing(1), "group still playing (looping)");

    std::printf("\n=== %d passed, %d failed ===\n", passed, failed);
    return failed == 0 ? 0 : 1;
}
