// Test: AudioRingBuffer — lock-free PCM circular buffer.
// Run: ctest -R test_audio_ring_buffer
#include "audio_ring_buffer.hpp"

#include <cmath>
#include <cstdio>
#include <vector>

using gseurat::audio::AudioRingBuffer;

static int passed = 0;
static int failed = 0;

static void check(bool cond, const char* msg) {
    if (cond) { std::printf("  PASS: %s\n", msg); ++passed; }
    else      { std::printf("  FAIL: %s\n", msg); ++failed; }
}

static bool approx(float a, float b, float eps = 1e-6f) {
    return std::fabs(a - b) < eps;
}

// ---- 1. Basic write/read round-trip (mono) ----------------------------------
static void test_basic_mono() {
    std::printf("\n[1] Basic mono write/read\n");

    AudioRingBuffer rb(/*channels=*/1, /*capacity_frames=*/16);

    const float src[4] = {0.1f, 0.2f, 0.3f, 0.4f};
    const uint32_t written = rb.write(src, 4);
    check(written == 4, "write 4 frames returns 4");
    check(rb.available_frames() == 4, "available_frames() == 4 after write");
    check(rb.free_frames() == 12,     "free_frames() == 12 after write");

    float dst[4] = {};
    const uint32_t read = rb.read(dst, 4);
    check(read == 4, "read 4 frames returns 4");
    check(rb.available_frames() == 0, "available_frames() == 0 after read");

    check(approx(dst[0], 0.1f), "dst[0] == 0.1");
    check(approx(dst[1], 0.2f), "dst[1] == 0.2");
    check(approx(dst[2], 0.3f), "dst[2] == 0.3");
    check(approx(dst[3], 0.4f), "dst[3] == 0.4");
}

// ---- 2. Stereo write/read ---------------------------------------------------
static void test_stereo() {
    std::printf("\n[2] Stereo write/read\n");

    AudioRingBuffer rb(/*channels=*/2, /*capacity_frames=*/32);

    // 2 frames × 2 channels = 4 samples: [L0,R0,L1,R1]
    const float src[4] = {-1.0f, 1.0f, -0.5f, 0.5f};
    const uint32_t written = rb.write(src, 2);
    check(written == 2, "stereo: write 2 frames");

    float dst[4] = {};
    const uint32_t read = rb.read(dst, 2);
    check(read == 2, "stereo: read 2 frames");

    check(approx(dst[0], -1.0f), "stereo: dst[0] L0");
    check(approx(dst[1],  1.0f), "stereo: dst[1] R0");
    check(approx(dst[2], -0.5f), "stereo: dst[2] L1");
    check(approx(dst[3],  0.5f), "stereo: dst[3] R1");
}

// ---- 3. Wrap-around ---------------------------------------------------------
static void test_wrap_around() {
    std::printf("\n[3] Wrap-around (small buffer, fill/drain multiple times)\n");

    // Capacity=8 frames, mono.  Fill 7, drain 7, repeat — this exercises the
    // wrap-around path multiple times across the ring boundary.
    AudioRingBuffer rb(/*channels=*/1, /*capacity_frames=*/8);

    bool all_ok = true;
    for (uint32_t round = 0; round < 8; ++round) {
        // Write 7 frames with value = (float)round
        std::vector<float> src(7, static_cast<float>(round));
        const uint32_t w = rb.write(src.data(), 7);
        if (w != 7) { all_ok = false; break; }

        std::vector<float> dst(7, 0.0f);
        const uint32_t r = rb.read(dst.data(), 7);
        if (r != 7) { all_ok = false; break; }

        for (uint32_t i = 0; i < 7; ++i) {
            if (!approx(dst[i], static_cast<float>(round))) {
                all_ok = false;
                break;
            }
        }
        if (!all_ok) break;
    }
    check(all_ok, "wrap-around: 8 fill/drain rounds, all values correct");
    check(rb.available_frames() == 0, "wrap-around: empty after all rounds");
}

// ---- 4. Overflow (write more than capacity) ---------------------------------
static void test_overflow() {
    std::printf("\n[4] Overflow (write more than capacity)\n");

    // Capacity=8 frames, mono.
    AudioRingBuffer rb(/*channels=*/1, /*capacity_frames=*/8);

    // Try to write 10 frames into a ring of size 8 — should accept only 8.
    std::vector<float> src(10, 1.0f);
    const uint32_t w = rb.write(src.data(), 10);
    check(w == 8, "overflow: write 10 into cap-8 returns 8");
    check(rb.available_frames() == 8, "overflow: available == capacity after overflow write");
    check(rb.free_frames() == 0,      "overflow: free == 0 when full");

    // Second write into a full ring should be rejected entirely.
    const uint32_t w2 = rb.write(src.data(), 1);
    check(w2 == 0, "overflow: write into full ring returns 0");
}

// ---- 5. Underrun (read from empty buffer) -----------------------------------
static void test_underrun() {
    std::printf("\n[5] Underrun (read from empty)\n");

    AudioRingBuffer rb(/*channels=*/1, /*capacity_frames=*/16);

    float dst[4] = {9.0f, 9.0f, 9.0f, 9.0f};
    const uint32_t r = rb.read(dst, 4);
    check(r == 0, "underrun: read from empty returns 0");
    // Output buffer must not have been modified.
    check(approx(dst[0], 9.0f), "underrun: dst[0] unchanged");

    // Partial underrun: write 2, request 4 — should return only 2.
    const float src[2] = {0.7f, 0.8f};
    rb.write(src, 2);
    const uint32_t r2 = rb.read(dst, 4);
    check(r2 == 2, "partial underrun: read 4 from 2-available returns 2");
    check(approx(dst[0], 0.7f), "partial underrun: dst[0] correct");
    check(approx(dst[1], 0.8f), "partial underrun: dst[1] correct");
}

// ---- 6. Flush ---------------------------------------------------------------
static void test_flush() {
    std::printf("\n[6] Flush (reset available to 0)\n");

    AudioRingBuffer rb(/*channels=*/1, /*capacity_frames=*/16);

    const float src[8] = {1,2,3,4,5,6,7,8};
    rb.write(src, 8);
    check(rb.available_frames() == 8, "flush: 8 frames available before flush");

    rb.flush();
    check(rb.available_frames() == 0, "flush: available == 0 after flush");
    check(rb.free_frames() == 16,     "flush: free == capacity after flush");

    // Verify we can write again after flush (ring is not broken).
    const float src2[4] = {10.0f, 20.0f, 30.0f, 40.0f};
    const uint32_t w = rb.write(src2, 4);
    check(w == 4, "flush: write after flush succeeds");

    float dst[4] = {};
    rb.read(dst, 4);
    check(approx(dst[0], 10.0f) && approx(dst[3], 40.0f),
          "flush: data after flush is correct");
}

// ---- 7. Wrap crossing ring boundary exactly ---------------------------------
static void test_wrap_boundary() {
    std::printf("\n[7] Wrap crossing ring boundary exactly\n");

    // capacity=4 mono.  Write 3, read 3 (write_pos=3, read_pos=3, offset=3).
    // Next write of 3 frames should cross the ring end at index 3 -> wraps to 0.
    AudioRingBuffer rb(/*channels=*/1, /*capacity_frames=*/4);

    const float prime[3] = {0.0f, 0.0f, 0.0f};
    rb.write(prime, 3);
    float sink[3] = {};
    rb.read(sink, 3);
    // Now offset = 3.  Write 3 frames that will wrap: 1 at index 3, 2 at 0-1.
    const float src[3] = {1.1f, 2.2f, 3.3f};
    const uint32_t w = rb.write(src, 3);
    check(w == 3, "boundary wrap: write 3 at offset-3 succeeds");

    float dst[3] = {};
    const uint32_t r = rb.read(dst, 3);
    check(r == 3,              "boundary wrap: read 3 back");
    check(approx(dst[0], 1.1f), "boundary wrap: dst[0]");
    check(approx(dst[1], 2.2f), "boundary wrap: dst[1]");
    check(approx(dst[2], 3.3f), "boundary wrap: dst[2]");
}

// ---- main -------------------------------------------------------------------
int main() {
    std::printf("\n=== AudioRingBuffer Tests ===\n");

    test_basic_mono();
    test_stereo();
    test_wrap_around();
    test_overflow();
    test_underrun();
    test_flush();
    test_wrap_boundary();

    std::printf("\n=== %d passed, %d failed ===\n", passed, failed);
    return failed == 0 ? 0 : 1;
}
