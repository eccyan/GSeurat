// Test: MemoryAudioSource — WAV load, format introspection, read_frames correctness,
// sample-rate mismatch failure, mid-stream read.
#include "gseurat/engine/audio/memory_audio_source.hpp"

#include <array>
#include <cmath>
#include <cstdio>

using gseurat::audio::MemoryAudioSource;
using gseurat::audio::LoadError;

static int passed = 0, failed = 0;
static void check(bool c, const char* m) {
    if (c) { std::printf("  PASS: %s\n", m); ++passed; }
    else   { std::printf("  FAIL: %s\n", m); ++failed; }
}
static bool approx(float a, float b, float eps = 1e-3f) { return std::fabs(a - b) < eps; }

int main() {
    std::printf("\n=== MemoryAudioSource Tests ===\n\n");

    const char* sine_path = "../../tests/test_data/audio/sine_loop.wav";
    const char* dc_path   = "../../tests/test_data/audio/dc_unity.wav";

    // --- Load sine_loop.wav at 48kHz ---
    {
        auto result = MemoryAudioSource::from_wav_file(sine_path, 48000);
        check(result.has_value(),               "load sine_loop.wav @ 48000");
        if (!result) return 1;
        auto& src = *result.value();
        check(src.format().sample_rate == 48000, "sample_rate==48000");
        check(src.format().channels == 1,        "channels==1");
        check(src.total_frames() == 24000,       "total_frames==24000");
    }

    // --- Sample-rate mismatch fails loudly ---
    {
        auto result = MemoryAudioSource::from_wav_file(sine_path, 44100);
        check(!result.has_value(),                               "44100 != file SR fails");
        check(result.error() == LoadError::SampleRateMismatch,   "error is SampleRateMismatch");
    }

    // --- Read first frame of sine (starts at ~0) ---
    {
        auto src = MemoryAudioSource::from_wav_file(sine_path, 48000).value();
        std::array<float, 1> out{};
        src->read_frames(0, 1, out);
        check(approx(out[0], 0.0f), "sine[0] approx 0");
    }

    // --- Mid-stream read (frame 12000 is exactly at cycle midpoint) ---
    {
        auto src = MemoryAudioSource::from_wav_file(sine_path, 48000).value();
        // 480Hz sine at SR=48000 -> 100 samples per cycle.
        // Frame 12000 = 120 full cycles later, sin(0) == 0 again.
        std::array<float, 1> out{};
        src->read_frames(12000, 1, out);
        check(approx(out[0], 0.0f), "sine[12000] approx 0 (zero-crossing)");
    }

    // --- dc_unity: every decoded sample approx 0.5 ---
    {
        auto src = MemoryAudioSource::from_wav_file(dc_path, 48000).value();
        std::array<float, 256> out{};
        src->read_frames(1000, 256, out);
        bool all_half = true;
        for (float s : out) if (!approx(s, 0.5f, 1e-2f)) { all_half = false; break; }
        check(all_half, "dc_unity mid-stream all approx 0.5");
    }

    std::printf("\n=== %d passed, %d failed ===\n", passed, failed);
    return failed == 0 ? 0 : 1;
}
