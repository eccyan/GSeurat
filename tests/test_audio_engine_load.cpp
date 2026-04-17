#include "gseurat/engine/audio/audio_engine.hpp"
#include <cstdio>
#include <vector>

using namespace gseurat::audio;
static int passed = 0, failed = 0;
static void check(bool c, const char* m) {
    if (c) { std::printf("  PASS: %s\n", m); ++passed; }
    else   { std::printf("  FAIL: %s\n", m); ++failed; }
}

int main() {
    std::printf("\n=== AudioEngine::load_track_group Tests ===\n\n");

    auto engine = AudioEngine::create(
        {.sample_rate=48000, .buffer_frames=128, .max_active_groups=2},
        AudioEngine::Mode::Offline).value();

    auto r = engine->load_track_group("../../tests/test_data/audio/sine_loop.json");
    check(r.has_value(), "load sine_loop.json via engine");
    if (r) check(r.value() == 1, "returned group id = 1");

    // After loading, can play the group
    if (r) {
        engine->play_group(r.value());
        std::vector<float> out(256 * 2);
        engine->render_offline(out, 256);
        check(engine->is_group_playing(1), "group 1 is playing after load+play");
    }

    // Mismatch: engine at 44100, file at 48000
    auto engine2 = AudioEngine::create(
        {.sample_rate=44100, .buffer_frames=128},
        AudioEngine::Mode::Offline).value();
    auto r2 = engine2->load_track_group("../../tests/test_data/audio/sine_loop.json");
    check(!r2.has_value(), "44100 engine rejects 48000 file");

    std::printf("\n=== %d passed, %d failed ===\n", passed, failed);
    return failed == 0 ? 0 : 1;
}
