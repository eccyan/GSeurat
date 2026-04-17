// Test: SlewLimiter — linear ramp, snap-to-target, settled(), overshoot protection.
// Run: ctest -R test_audio_slew_limiter
#include "gseurat/engine/audio/slew_limiter.hpp"

#include <cmath>
#include <cstdio>

using gseurat::audio::SlewLimiter;

static int passed = 0, failed = 0;
static void check(bool c, const char* m) {
    if (c) { std::printf("  PASS: %s\n", m); ++passed; }
    else   { std::printf("  FAIL: %s\n", m); ++failed; }
}
static bool approx(float a, float b, float eps = 1e-6f) { return std::fabs(a - b) < eps; }

int main() {
    std::printf("\n=== SlewLimiter Tests ===\n\n");

    // --- Initial state ---
    {
        SlewLimiter s;
        check(s.settled(),               "default settled()");
        check(approx(s.current(), 1.0f), "default current()==1.0");
    }

    // --- Snap (fade_frames == 0) ---
    {
        SlewLimiter s;
        s.set_target(0.0f, 0);
        check(approx(s.tick(), 0.0f),    "fade=0 snaps to target in one tick");
        check(s.settled(),               "snapped is settled");
    }

    // --- Linear ramp down 1.0 → 0.0 over 100 frames ---
    {
        SlewLimiter s;
        s.set_target(0.0f, 100);
        for (int i = 0; i < 99; ++i) (void)s.tick();
        const float penultimate = s.current();
        const float final_v = s.tick();
        check(approx(penultimate, 0.01f, 1e-4f), "after 99 ticks ≈ 0.01");
        check(approx(final_v,     0.0f,  1e-4f), "after 100 ticks == target");
        check(s.settled(),                        "settled after reaching target");
    }

    // --- Linear ramp up 0.0 → 1.0 over 48 frames ---
    {
        SlewLimiter s;
        s.set_target(0.0f, 0);
        (void)s.tick();                  // snap to 0
        s.set_target(1.0f, 48);
        for (int i = 0; i < 48; ++i) (void)s.tick();
        check(approx(s.current(), 1.0f, 1e-5f), "ramped up to 1.0 exactly");
        check(s.settled(),                       "settled after up-ramp");
    }

    // --- Overshoot protection: one extra tick shouldn't push past target ---
    {
        SlewLimiter s;
        s.set_target(0.0f, 10);
        for (int i = 0; i < 20; ++i) (void)s.tick();
        check(approx(s.current(), 0.0f), "no overshoot past target");
    }

    std::printf("\n=== %d passed, %d failed ===\n", passed, failed);
    return failed == 0 ? 0 : 1;
}
