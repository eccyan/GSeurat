// Test: SPSC ring buffer — push/pop, full/empty, wrap-around, capacity invariant.
// Run: ctest -R test_audio_command_queue
#include "gseurat/engine/audio/command_queue.hpp"

#include <cassert>
#include <cstdio>
#include <cstdint>

using gseurat::audio::SpscRingBuffer;

static int passed = 0;
static int failed = 0;

static void check(bool cond, const char* msg) {
    if (cond) { std::printf("  PASS: %s\n", msg); ++passed; }
    else      { std::printf("  FAIL: %s\n", msg); ++failed; }
}

int main() {
    std::printf("\n=== SpscRingBuffer Tests ===\n\n");

    // --- Push/pop round-trip ---
    {
        SpscRingBuffer<uint32_t, 4> q;
        check(q.try_push(42),     "push 42 returns true");
        uint32_t v = 0;
        check(q.try_pop(v),       "pop returns true");
        check(v == 42,            "popped value matches pushed");
    }

    // --- Empty pop fails ---
    {
        SpscRingBuffer<uint32_t, 4> q;
        uint32_t v = 0;
        check(!q.try_pop(v),      "pop on empty returns false");
    }

    // --- Full push fails (capacity N actually holds N-1 slots — standard SPSC) ---
    {
        SpscRingBuffer<uint32_t, 4> q;  // capacity=4 → holds up to 3
        check(q.try_push(1), "push 1");
        check(q.try_push(2), "push 2");
        check(q.try_push(3), "push 3");
        check(!q.try_push(4), "push 4 fails (full)");
    }

    // --- Wrap-around correctness ---
    {
        SpscRingBuffer<uint32_t, 4> q;
        uint32_t sink = 0;
        // Fill/drain enough to wrap past index 4
        for (uint32_t i = 0; i < 100; ++i) {
            check(q.try_push(i * 10), "wrap: push");
            check(q.try_pop(sink),    "wrap: pop");
            check(sink == i * 10,     "wrap: value match");
        }
    }

    std::printf("\n=== %d passed, %d failed ===\n", passed, failed);
    return failed == 0 ? 0 : 1;
}
