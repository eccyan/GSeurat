// Priority #2: RequestTransition waits until the next marker, then begins xfade.
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
    std::printf("\n=== Marker-aligned transition — priority #2 ===\n\n");

    auto engine = AudioEngine::create(
        {.sample_rate=48000, .buffer_frames=128, .max_active_groups=3},
        AudioEngine::Mode::Offline).value();

    auto make_src = [](const char* p) {
        return MemoryAudioSource::from_wav_file(p, 48000).value();
    };
    const char* dc_path = "../../tests/test_data/audio/dc_unity.wav";

    // Group A: dc_unity, with a marker at frame 1000. One-shot (long enough).
    {
        TrackGroupMetadata meta{};
        meta.id = 1; meta.name = "A"; meta.sample_rate = 48000;
        meta.loop_start = 0; meta.loop_end = 0;
        meta.markers.push_back({1000, "mark_a"});
        meta.stems.push_back({"dc_unity.wav", 1.0f});
        std::vector<std::unique_ptr<IAudioSource>> stems;
        stems.push_back(std::move(make_src(dc_path)));
        engine->register_track_group_for_test(std::move(meta), std::move(stems));
    }
    // Group B: dc_unity, no markers.
    {
        TrackGroupMetadata meta{};
        meta.id = 2; meta.name = "B"; meta.sample_rate = 48000;
        meta.loop_start = 0; meta.loop_end = 0;
        meta.stems.push_back({"dc_unity.wav", 1.0f});
        std::vector<std::unique_ptr<IAudioSource>> stems;
        stems.push_back(std::move(make_src(dc_path)));
        engine->register_track_group_for_test(std::move(meta), std::move(stems));
    }

    engine->play_group(1);
    // Request transition A->B with 500-frame xfade
    const float xfade_ms = 500.0f * 1000.0f / 48000.0f;
    engine->request_transition(1, 2, xfade_ms);

    std::vector<float> out(4000 * 2, 0.0f);
    engine->render_offline(out, 4000);

    // Before marker (frame 500): only A plays at full volume, output = 0.5
    check(approx(out[500 * 2], 0.5f), "pre-marker: only A, out approx 0.5");

    // At the marker (frame 1000), the transition triggers:
    //   - A starts CrossfadingOut (volume 1->0 over 500 frames)
    //   - B is activated but starts rendering on the NEXT render() call (~128-frame latency)
    //
    // Well after xfade completes (frame 1000 + 128 + 500 + margin = ~1800):
    // A should be Idle, B should be Playing at full volume.
    // Give enough render time:
    std::vector<float> out2(2000 * 2, 0.0f);
    engine->render_offline(out2, 2000);

    check(!engine->is_group_playing(1), "A is Idle after xfade completes");
    check( engine->is_group_playing(2), "B is Playing after xfade completes");

    std::printf("\n=== %d passed, %d failed ===\n", passed, failed);
    return failed == 0 ? 0 : 1;
}
