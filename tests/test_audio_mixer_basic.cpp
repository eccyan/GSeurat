// Test: Mixer renders a single-stem group at unity gain. Output == input (dc_unity decoded value).
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
    std::printf("\n=== Mixer basic single-stem playback ===\n\n");

    auto engine_r = AudioEngine::create(
        {.sample_rate=48000, .buffer_frames=512, .max_active_groups=2},
        AudioEngine::Mode::Offline);
    check(engine_r.has_value(), "engine creates in offline mode");
    auto engine = std::move(engine_r.value());

    // Build a one-shot group from dc_unity (constant 0.5 per sample, mono)
    TrackGroupMetadata meta{};
    meta.id = 1;
    meta.name = "dc_test";
    meta.sample_rate = 48000;
    meta.loop_start = 0;
    meta.loop_end = 0;  // one-shot
    meta.stems.push_back({"dc_unity.wav", 1.0f});

    std::vector<std::unique_ptr<IAudioSource>> stems;
    stems.push_back(std::move(
        MemoryAudioSource::from_wav_file("../../tests/test_data/audio/dc_unity.wav", 48000).value()));

    const uint32_t gid = engine->register_track_group_for_test(std::move(meta), std::move(stems));
    engine->play_group(gid);

    // Render 1000 stereo frames
    std::vector<float> out(1000 * 2, 0.0f);
    engine->render_offline(out, 1000);

    // dc_unity decodes to ~0.5 per sample. With stem_vol=1, group_vol=1,
    // output should be ~0.5 on both L and R (mono broadcast).
    bool all_expected = true;
    for (size_t i = 100; i < 900; ++i) {
        if (!approx(out[i * 2], 0.5f) || !approx(out[i * 2 + 1], 0.5f)) {
            std::printf("  MISMATCH at frame %zu: L=%f R=%f\n", i, out[i * 2], out[i * 2 + 1]);
            all_expected = false;
            break;
        }
    }
    check(all_expected, "mid-stream stereo output approx 0.5 on both channels");

    // After 1000 frames, group should still be active (source has 24000 frames)
    engine->render_offline({out.data(), 256 * 2}, 256);  // advance master clock
    check(engine->is_group_playing(1), "group still playing (one-shot not exhausted)");

    std::printf("\n=== %d passed, %d failed ===\n", passed, failed);
    return failed == 0 ? 0 : 1;
}
