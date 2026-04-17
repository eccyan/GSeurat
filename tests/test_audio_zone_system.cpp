// Test: AudioZoneSystem enter/exit triggers correct engine commands.
#include "gseurat/engine/audio/audio_engine.hpp"
#include "gseurat/engine/audio/memory_audio_source.hpp"
#include "audio_zone_system.hpp"
#include "gseurat/engine/components/audio_zone_component.hpp"

#include <cstdio>
#include <vector>

using namespace gseurat;

static int passed = 0, failed = 0;
static void check(bool c, const char* m) {
    if (c) { std::printf("  PASS: %s\n", m); ++passed; }
    else   { std::printf("  FAIL: %s\n", m); ++failed; }
}

int main() {
    std::printf("\n=== AudioZoneSystem Tests ===\n\n");

    auto engine = audio::AudioEngine::create(
        {.sample_rate=48000, .buffer_frames=256, .max_active_groups=2},
        audio::AudioEngine::Mode::Offline).value();

    // Register a minimal test group (needs at least 1 stem for is_group_playing to work)
    audio::TrackGroupMetadata meta{};
    meta.id = 1; meta.name = "test"; meta.sample_rate = 48000;
    meta.loop_start = 0; meta.loop_end = 24000;
    meta.stems.push_back({"dc_unity.wav", 1.0f});
    std::vector<std::unique_ptr<audio::IAudioSource>> stems;
    stems.push_back(std::move(
        audio::MemoryAudioSource::from_wav_file("../../tests/test_data/audio/dc_unity.wav", 48000).value()));
    engine->register_track_group_for_test(std::move(meta), std::move(stems));

    AudioZoneComponent zone{};
    zone.bounds_min = {0, 0, 0};
    zone.bounds_max = {10, 10, 10};
    zone.track_group_id = 1;
    zone.action_on_enter = AudioZoneComponent::Action::Play;
    zone.action_on_exit  = AudioZoneComponent::Action::Stop;

    AudioZoneSystem sys{engine.get()};

    // Outside -> no trigger
    sys.tick({-5, 0, 0}, {&zone, 1});
    std::vector<float> out(256 * 2);
    engine->render_offline(out, 256);
    check(!engine->is_group_playing(1), "outside: group not playing");

    // Move inside -> play triggered
    sys.tick({5, 5, 5}, {&zone, 1});
    engine->render_offline(out, 256);
    check(engine->is_group_playing(1), "enter zone: group playing");

    // Stay inside -> no duplicate command (hysteresis)
    sys.tick({6, 5, 5}, {&zone, 1});
    check(engine->dropped_command_count() == 0, "re-tick inside: no duplicate push");

    // Move outside -> stop triggered
    sys.tick({-5, 0, 0}, {&zone, 1});
    engine->render_offline(out, 256);
    check(!engine->is_group_playing(1), "exit zone: group stopped");

    std::printf("\n=== %d passed, %d failed ===\n", passed, failed);
    return failed == 0 ? 0 : 1;
}
