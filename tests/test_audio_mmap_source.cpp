// Test: MmapAudioSource — load .gsaudio, format, read_frames, magic reject,
// SR reject, round-trip golden (WAV vs .gsaudio bit-identical).
#include "gseurat/engine/audio/mmap_audio_source.hpp"
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
    std::printf("\n=== MmapAudioSource Tests ===\n\n");

    const char* gsaudio_path = "../../tests/test_data/audio/dc_unity.gsaudio";
    const char* wav_path     = "../../tests/test_data/audio/dc_unity.wav";

    // --- Load .gsaudio ---
    {
        auto r = MmapAudioSource::from_gsaudio_file(gsaudio_path, 48000);
        check(r.has_value(), "load dc_unity.gsaudio");
        if (!r) return 1;
        auto& src = *r.value();
        check(src.format().sample_rate == 48000, "sample_rate == 48000");
        check(src.format().channels == 1, "channels == 1");
        check(src.total_frames() == 24000, "total_frames == 24000");
    }

    // --- read_frames ---
    {
        auto src = MmapAudioSource::from_gsaudio_file(gsaudio_path, 48000).value();
        std::vector<float> out(256);
        src->read_frames(1000, 256, out);
        bool all_half = true;
        for (float s : out) if (!approx(s, 0.5f, 1e-2f)) { all_half = false; break; }
        check(all_half, "read_frames: all samples approx 0.5");
    }

    // --- Magic mismatch (WAV) rejected ---
    {
        auto r = MmapAudioSource::from_gsaudio_file(wav_path, 48000);
        check(!r.has_value(), "WAV rejected by from_gsaudio_file");
    }

    // --- SR mismatch ---
    {
        auto r = MmapAudioSource::from_gsaudio_file(gsaudio_path, 44100);
        check(!r.has_value(), "SR mismatch rejected");
        check(r.error() == LoadError::SampleRateMismatch, "error is SampleRateMismatch");
    }

    // --- Round-trip golden: WAV vs .gsaudio bit-identical ---
    {
        auto wav_src = MemoryAudioSource::from_wav_file(wav_path, 48000).value();
        auto mmap_src = MmapAudioSource::from_gsaudio_file(gsaudio_path, 48000).value();

        check(wav_src->total_frames() == mmap_src->total_frames(), "round-trip: same frame count");

        const uint32_t N = static_cast<uint32_t>(wav_src->total_frames());
        std::vector<float> wav_buf(N);
        std::vector<float> mmap_buf(N);
        wav_src->read_frames(0, N, wav_buf);
        mmap_src->read_frames(0, N, mmap_buf);

        // The WAV is 16-bit PCM; miniaudio and the Python cooker may
        // produce slightly different float representations of the same
        // int16 sample.  Allow 1 LSB of int16 tolerance (1/32767).
        constexpr float kEps = 1.0f / 32767.0f;
        bool match = true;
        for (uint32_t i = 0; i < N; ++i) {
            if (!approx(wav_buf[i], mmap_buf[i], kEps)) {
                std::printf("  MISMATCH at %u: wav=%f mmap=%f\n", i, wav_buf[i], mmap_buf[i]);
                match = false;
                break;
            }
        }
        check(match, "round-trip: WAV and .gsaudio match within int16 tolerance");
    }

    // --- Invalid path ---
    {
        auto r = MmapAudioSource::from_gsaudio_file("nonexistent.gsaudio", 48000);
        check(!r.has_value(), "invalid path rejected");
    }

    std::printf("\n=== %d passed, %d failed ===\n", passed, failed);
    return failed == 0 ? 0 : 1;
}
