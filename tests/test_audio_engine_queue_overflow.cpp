// Priority #4: pushing more commands than the queue holds increments the
// dropped-command counter; engine remains functional.
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
    std::printf("\n=== Queue overflow — priority #4 ===\n\n");

    auto engine = AudioEngine::create(
        {.sample_rate=48000, .buffer_frames=256, .max_active_groups=1},
        AudioEngine::Mode::Offline).value();

    // Queue capacity is 256 (power-of-two); holds 255 items (one sentinel slot).
    // Push 300 commands without rendering (nothing drains them).
    for (int i = 0; i < 300; ++i) engine->play_group(999);  // unknown id, cheap to push

    const uint32_t dropped = engine->dropped_command_count();
    std::printf("  INFO: dropped = %u (expected ~45)\n", dropped);
    check(dropped >= 44 && dropped <= 46,
          "dropped count approx 45 (300 - 255 held)");

    // After rendering, drain happens (kMaxCommandsPerBlock=32), freeing space.
    std::vector<float> out(256 * 2);
    engine->render_offline(out, 256);  // drains up to 32 commands

    // Push 30 more — these should NOT add to dropped count (space available).
    const uint32_t dropped_before = engine->dropped_command_count();
    for (int i = 0; i < 30; ++i) engine->play_group(999);
    check(engine->dropped_command_count() == dropped_before, "no new drops after drain");

    std::printf("\n=== %d passed, %d failed ===\n", passed, failed);
    return failed == 0 ? 0 : 1;
}
