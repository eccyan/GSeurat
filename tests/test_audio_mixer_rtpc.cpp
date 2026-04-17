// Priority #5: RTPC -> stem volume binding.
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
    std::printf("\n=== RTPC binding — priority #5 ===\n\n");

    auto engine = AudioEngine::create(
        {.sample_rate=48000, .buffer_frames=256, .max_active_groups=2},
        AudioEngine::Mode::Offline).value();

    // dc_unity = 0.5 per sample. stem initial_volume = 0.0 (silent by default).
    TrackGroupMetadata meta{};
    meta.id = 1;
    meta.name = "dc";
    meta.sample_rate = 48000;
    meta.loop_start = 0;
    meta.loop_end = 0;
    meta.stems.push_back({"dc_unity.wav", 0.0f});  // initial volume 0!

    std::vector<std::unique_ptr<IAudioSource>> stems;
    stems.push_back(std::move(
        MemoryAudioSource::from_wav_file("../../tests/test_data/audio/dc_unity.wav", 48000).value()));
    engine->register_track_group_for_test(std::move(meta), std::move(stems));

    // Bind stem 0 volume to RTPC id=5, mapping [0,1] → [0,1]
    engine->bind_stem_volume_to_rtpc(1, 0, 5, 0.0f, 1.0f);
    engine->play_group(1);

    // RTPC=0 → stem vol should stay 0 → output ≈ 0
    engine->set_rtpc(5, 0.0f);
    std::vector<float> out(2000 * 2, 0.0f);
    engine->render_offline(out, 500);
    // Check a frame well into the render (after smoothing settles)
    check(approx(out[400 * 2], 0.0f), "rtpc=0 -> stem vol 0 -> out approx 0");

    // RTPC=1 → stem vol should ramp to 1 → output ≈ 0.5
    engine->set_rtpc(5, 1.0f);
    engine->render_offline({out.data() + 500 * 2, 1000 * 2}, 1000);
    // After 32-frame smooth + a few blocks, stem vol should be 1.0
    check(approx(out[(500 + 500) * 2], 0.5f), "rtpc=1 -> stem vol 1 -> out approx 0.5");

    std::printf("\n=== %d passed, %d failed ===\n", passed, failed);
    return failed == 0 ? 0 : 1;
}
