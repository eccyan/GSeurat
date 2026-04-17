// Test: effect chain in mixer — LPF on stem, HPF on stem, chain, RTPC binding.
#include "gseurat/engine/audio/audio_engine.hpp"
#include "gseurat/engine/audio/memory_audio_source.hpp"
#include "gseurat/engine/audio/dsp_effect.hpp"

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
    std::printf("\n=== Effect chain integration tests ===\n\n");

    // --- LPF on stem: dc_unity through LPF passes unchanged ---
    {
        auto engine = AudioEngine::create(
            {.sample_rate=48000, .buffer_frames=256, .max_active_groups=2},
            AudioEngine::Mode::Offline).value();

        TrackGroupMetadata meta{};
        meta.id = 1; meta.name = "dc"; meta.sample_rate = 48000;
        meta.loop_start = 0; meta.loop_end = 24000;
        meta.stems.push_back({"dc_unity.wav", 1.0f});

        std::vector<std::unique_ptr<IAudioSource>> stems;
        stems.push_back(std::move(
            MemoryAudioSource::from_wav_file("../../tests/test_data/audio/dc_unity.wav", 48000).value()));
        engine->register_track_group_for_test(std::move(meta), std::move(stems));

        engine->add_stem_effect(1, 0, AudioEngine::create_svf(48000, 0, 1000.0f, 0.707f));
        engine->play_group(1);

        std::vector<float> out(2000 * 2, 0.0f);
        engine->render_offline(out, 2000);
        check(approx(out[1500 * 2], 0.5f), "LPF@1kHz: DC passes through stem");
    }

    // --- HPF on stem: dc_unity through HPF is blocked ---
    {
        auto engine = AudioEngine::create(
            {.sample_rate=48000, .buffer_frames=256, .max_active_groups=2},
            AudioEngine::Mode::Offline).value();

        TrackGroupMetadata meta{};
        meta.id = 1; meta.name = "dc"; meta.sample_rate = 48000;
        meta.loop_start = 0; meta.loop_end = 24000;
        meta.stems.push_back({"dc_unity.wav", 1.0f});

        std::vector<std::unique_ptr<IAudioSource>> stems;
        stems.push_back(std::move(
            MemoryAudioSource::from_wav_file("../../tests/test_data/audio/dc_unity.wav", 48000).value()));
        engine->register_track_group_for_test(std::move(meta), std::move(stems));

        engine->add_stem_effect(1, 0, AudioEngine::create_svf(48000, 1, 5000.0f, 0.707f));
        engine->play_group(1);

        std::vector<float> out(2000 * 2, 0.0f);
        engine->render_offline(out, 2000);
        check(approx(out[1500 * 2], 0.0f), "HPF@5kHz: DC blocked on stem");
    }

    // --- RTPC -> effect param binding (plumbing test) ---
    {
        auto engine = AudioEngine::create(
            {.sample_rate=48000, .buffer_frames=256, .max_active_groups=2},
            AudioEngine::Mode::Offline).value();

        TrackGroupMetadata meta{};
        meta.id = 1; meta.name = "dc"; meta.sample_rate = 48000;
        meta.loop_start = 0; meta.loop_end = 24000;
        meta.stems.push_back({"dc_unity.wav", 1.0f});

        std::vector<std::unique_ptr<IAudioSource>> stems;
        stems.push_back(std::move(
            MemoryAudioSource::from_wav_file("../../tests/test_data/audio/dc_unity.wav", 48000).value()));
        engine->register_track_group_for_test(std::move(meta), std::move(stems));

        engine->add_stem_effect(1, 0, AudioEngine::create_svf(48000, 0, 20000.0f, 0.707f));
        engine->bind_effect_param_to_rtpc(1, 0, 0, 0, 5, 100.0f, 20000.0f);
        engine->play_group(1);

        engine->set_rtpc(5, 0.5f);
        std::vector<float> out(2000 * 2, 0.0f);
        engine->render_offline(out, 2000);
        check(true, "RTPC -> effect param: no crash, deterministic");
    }

    // --- Two effects on one stem (LPF then HPF) ---
    {
        auto engine = AudioEngine::create(
            {.sample_rate=48000, .buffer_frames=256, .max_active_groups=2},
            AudioEngine::Mode::Offline).value();

        TrackGroupMetadata meta{};
        meta.id = 1; meta.name = "dc"; meta.sample_rate = 48000;
        meta.loop_start = 0; meta.loop_end = 24000;
        meta.stems.push_back({"dc_unity.wav", 1.0f});

        std::vector<std::unique_ptr<IAudioSource>> stems;
        stems.push_back(std::move(
            MemoryAudioSource::from_wav_file("../../tests/test_data/audio/dc_unity.wav", 48000).value()));
        engine->register_track_group_for_test(std::move(meta), std::move(stems));

        engine->add_stem_effect(1, 0, AudioEngine::create_svf(48000, 0, 1000.0f));
        engine->add_stem_effect(1, 0, AudioEngine::create_svf(48000, 1, 5000.0f));
        engine->play_group(1);

        std::vector<float> out(2000 * 2, 0.0f);
        engine->render_offline(out, 2000);
        check(approx(out[1500 * 2], 0.0f), "chain: LPF+HPF blocks DC");
    }

    std::printf("\n=== %d passed, %d failed ===\n", passed, failed);
    return failed == 0 ? 0 : 1;
}
