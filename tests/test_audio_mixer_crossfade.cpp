// Priority #3: set_group_volume with fade_frames produces exact linear ramp.
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
static bool approx(float a, float b, float eps = 1e-2f) { return std::fabs(a - b) < eps; }

int main() {
    std::printf("\n=== Crossfade curve — priority #3 ===\n\n");

    auto engine = AudioEngine::create(
        {.sample_rate=48000, .buffer_frames=256, .max_active_groups=2},
        AudioEngine::Mode::Offline).value();

    // dc_unity = constant 0.5 per sample, mono. One-shot (loop_end=0).
    TrackGroupMetadata meta{};
    meta.id = 1;
    meta.name = "dc";
    meta.sample_rate = 48000;
    meta.loop_start = 0;
    meta.loop_end = 0;
    meta.stems.push_back({"dc_unity.wav", 1.0f});

    std::vector<std::unique_ptr<IAudioSource>> stems;
    stems.push_back(std::move(
        MemoryAudioSource::from_wav_file("../../tests/test_data/audio/dc_unity.wav", 48000).value()));
    engine->register_track_group_for_test(std::move(meta), std::move(stems));

    engine->play_group(1);

    // Fade group volume from 1.0 → 0.0 over 1000 frames.
    // ms = 1000 frames * 1000ms / 48000 = 20.8333... ms
    const float fade_ms = 1000.0f * 1000.0f / 48000.0f;
    engine->set_group_volume(1, 0.0f, fade_ms);

    std::vector<float> out(2000 * 2, 0.0f);
    engine->render_offline(out, 2000);

    // Frame 0: gain == 1.0 (command drained at start of first block), output ≈ 0.5
    // Frame 500: gain ≈ 0.5 (midpoint of ramp), output ≈ 0.25
    // Frame 1000: gain == 0.0, output ≈ 0.0
    // Frame 1500: gain still 0 (settled), output ≈ 0.0
    check(approx(out[0 * 2],    0.5f),  "frame 0: gain=1.0, out approx 0.5");
    check(approx(out[500 * 2],  0.25f), "frame 500: gain=0.5, out approx 0.25");
    check(approx(out[1000 * 2], 0.0f),  "frame 1000: gain=0.0, out = 0");
    check(approx(out[1500 * 2], 0.0f),  "frame 1500: gain still 0");

    std::printf("\n=== %d passed, %d failed ===\n", passed, failed);
    return failed == 0 ? 0 : 1;
}
