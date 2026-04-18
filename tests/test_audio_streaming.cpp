// Integration test for StreamingAudioSource + AudioStreamManager.
// Verifies Ogg Vorbis streaming, ring buffer refill, and SR mismatch rejection.

#include "gseurat/engine/audio/audio_source.hpp"
#include "streaming_audio_source.hpp"
#include "audio_stream_manager.hpp"

#include <cmath>
#include <cstdio>
#include <chrono>
#include <thread>
#include <vector>

using namespace gseurat::audio;

static int passed = 0, failed = 0;

static void check(bool c, const char* m) {
    if (c) { std::printf("  PASS: %s\n", m); ++passed; }
    else   { std::printf("  FAIL: %s\n", m); ++failed; }
}

int main() {
    std::printf("\n=== Streaming Audio Tests ===\n\n");

    const char* ogg_path = "../../tests/test_data/audio/dc_unity.ogg";

    // --- Basic streaming ---
    {
        std::printf("--- Basic streaming from .ogg ---\n");
        AudioStreamManager mgr;
        auto src_r = StreamingAudioSource::create(ogg_path, 48000, 0, 0, &mgr, 44100);
        check(src_r.has_value(), "create from .ogg");
        if (!src_r) {
            std::printf("  ERROR: could not create streaming source\n");
            return 1;
        }
        auto& src = *src_r.value();
        check(src.format().sample_rate == 48000, "SR == 48000");
        check(src.format().channels == 1, "channels == 1");

        // Wait for decode thread to fill ring buffer.
        std::this_thread::sleep_for(std::chrono::milliseconds(200));

        std::vector<float> out(1024, 0.0f);
        src.read_frames(0, 1024, out);

        bool has_signal = false;
        for (float s : out) {
            if (std::fabs(s) > 0.01f) { has_signal = true; break; }
        }
        check(has_signal, "output has non-zero signal");

        // dc_unity.ogg is a DC signal at ~0.5. Check middle samples.
        bool approx_half = true;
        for (size_t i = 100; i < 900; ++i) {
            if (std::fabs(out[i] - 0.5f) > 0.15f) {
                approx_half = false;
                std::printf("    sample[%zu] = %.4f (expected ~0.5)\n", i, out[i]);
                break;
            }
        }
        check(approx_half, "output approximately 0.5 (Vorbis tolerance)");
    }

    // --- SR mismatch rejection ---
    {
        std::printf("\n--- SR mismatch rejection ---\n");
        AudioStreamManager mgr;
        auto r = StreamingAudioSource::create(ogg_path, 44100, 0, 0, &mgr);
        check(!r.has_value(), "SR mismatch rejected");
    }

    std::printf("\n=== %d passed, %d failed ===\n", passed, failed);
    return failed == 0 ? 0 : 1;
}
