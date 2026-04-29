// GPU integration test for the refactored TransferQueue:
//   1. reserve_staging() returns a contiguous host slice from the ring.
//   2. submit() schedules a copy to a chosen device buffer.
//   3. poll_completions() drives the copy to completion (single-family path —
//      headless VkContext exposes only the graphics queue family, so this
//      exercises the fallback branch).
//   4. status(handle) transitions Pending → Complete.
//   5. Multiple back-to-back submits, including ring wrap-around, all land
//      with the right bytes at the right offsets.

#include "gpu_test_context.hpp"
#include "gseurat/engine/transfer_queue.hpp"

#include <atomic>
#include <cassert>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <thread>
#include <vector>

using namespace gseurat;

namespace {

void expect(bool cond, const char* msg) {
    if (!cond) {
        std::fprintf(stderr, "FAIL: %s\n", msg);
        std::exit(1);
    }
}

// Drive the queue until `expected_count` distinct handles report Complete or
// `max_polls` is exhausted.
void poll_until_complete(TransferQueue& tq, GpuTestContext& gpu,
                         const std::vector<TransferQueue::Handle>& handles,
                         int max_polls = 64) {
    for (int i = 0; i < max_polls; ++i) {
        auto cmd = gpu.begin_commands();
        tq.poll_completions(cmd);
        gpu.submit_and_wait();

        bool all_done = true;
        for (auto h : handles) {
            if (tq.status(h) != TransferQueue::Status::Complete) {
                all_done = false;
                break;
            }
        }
        if (all_done) return;
    }
    expect(false, "timed out waiting for transfers to complete");
}

}  // namespace

int main() {
    GpuTestContext gpu;
    gpu.init();

    // Single-family fallback: headless VkContext only exposes the graphics
    // family, so transfer_family == graphics_family and the queue chooses
    // its non-dedicated path.
    const std::uint64_t staging_size = 256 * 1024;  // 256 KB
    TransferQueue tq(
        gpu.device(), gpu.allocator(),
        gpu.context().graphics_queue(),
        gpu.queue_family(), gpu.queue_family(),
        /*dedicated=*/false,
        staging_size,
        /*budget_mb=*/64);

    // ── Test 1: single submit round-trip ──
    {
        auto dest = Buffer::create_storage_gpu_only(gpu.allocator(), 4096);

        auto res = tq.reserve_staging(1024);
        expect(res.has_value(), "reserve_staging(1024) succeeded");
        expect(res->size == 1024, "reservation size matches request");

        // Write a recognizable pattern.
        for (int i = 0; i < 1024; ++i) {
            res->host_ptr[i] = static_cast<std::byte>(i & 0xFF);
        }

        auto h = tq.submit(*res, dest.buffer(), /*dest_offset=*/0);
        expect(static_cast<bool>(h), "submit returned a non-null handle");
        expect(tq.status(h) == TransferQueue::Status::Pending,
               "status is Pending immediately after submit");

        poll_until_complete(tq, gpu, {h});
        expect(tq.status(h) == TransferQueue::Status::Complete,
               "status transitioned to Complete after poll");

        // Read back and verify.
        auto cmd = gpu.begin_commands();
        auto rb = gpu.readback_from_gpu(cmd, dest, 1024);
        gpu.submit_and_wait();
        const auto* got = static_cast<const std::uint8_t*>(rb.mapped());
        for (int i = 0; i < 1024; ++i) {
            expect(got[i] == (i & 0xFF), "byte mismatch in roundtrip");
        }
        rb.destroy(gpu.allocator());
        dest.destroy(gpu.allocator());
        std::printf("[TEST] single-submit roundtrip OK\n");
    }

    // ── Test 2: multiple destinations in a single batch ──
    {
        auto dest_a = Buffer::create_storage_gpu_only(gpu.allocator(), 256);
        auto dest_b = Buffer::create_storage_gpu_only(gpu.allocator(), 256);

        auto res_a = tq.reserve_staging(64);
        auto res_b = tq.reserve_staging(64);
        expect(res_a && res_b, "two consecutive reservations succeed");
        expect(res_a->staging_offset != res_b->staging_offset,
               "reservations get distinct staging offsets");
        std::memset(res_a->host_ptr, 0xAA, 64);
        std::memset(res_b->host_ptr, 0xBB, 64);

        auto h_a = tq.submit(*res_a, dest_a.buffer(), 0);
        auto h_b = tq.submit(*res_b, dest_b.buffer(), 0);
        poll_until_complete(tq, gpu, {h_a, h_b});

        auto cmd = gpu.begin_commands();
        auto rb_a = gpu.readback_from_gpu(cmd, dest_a, 64);
        auto rb_b = gpu.readback_from_gpu(cmd, dest_b, 64);
        gpu.submit_and_wait();

        const auto* a = static_cast<const std::uint8_t*>(rb_a.mapped());
        const auto* b = static_cast<const std::uint8_t*>(rb_b.mapped());
        for (int i = 0; i < 64; ++i) {
            expect(a[i] == 0xAA, "dest_a byte mismatch");
            expect(b[i] == 0xBB, "dest_b byte mismatch");
        }
        rb_a.destroy(gpu.allocator());
        rb_b.destroy(gpu.allocator());
        dest_a.destroy(gpu.allocator());
        dest_b.destroy(gpu.allocator());
        std::printf("[TEST] multi-destination batch OK\n");
    }

    // ── Test 3: ring wrap-around ──
    // Reserve+submit chunks that together exceed staging_size, forcing the
    // ring read pointer to advance and the write pointer to wrap.
    {
        auto dest = Buffer::create_storage_gpu_only(gpu.allocator(), staging_size * 2);
        const std::uint64_t chunk_bytes = 32 * 1024;       // 32 KB
        const int chunks = 16;                              // 512 KB total > 256 KB ring
        std::vector<TransferQueue::Handle> handles;
        for (int c = 0; c < chunks; ++c) {
            std::optional<TransferQueue::Reservation> res;
            // Spin until reservation succeeds (poll between attempts so the
            // ring can retire in-flight bytes).
            for (int attempt = 0; attempt < 64 && !res; ++attempt) {
                res = tq.reserve_staging(chunk_bytes);
                if (!res) {
                    auto cmd = gpu.begin_commands();
                    tq.poll_completions(cmd);
                    gpu.submit_and_wait();
                }
            }
            expect(res.has_value(), "wrap-around reservation eventually succeeds");

            std::memset(res->host_ptr, c & 0xFF, chunk_bytes);
            auto h = tq.submit(*res, dest.buffer(), c * chunk_bytes);
            handles.push_back(h);
        }
        poll_until_complete(tq, gpu, handles, /*max_polls=*/256);

        auto cmd = gpu.begin_commands();
        auto rb = gpu.readback_from_gpu(cmd, dest, chunks * chunk_bytes);
        gpu.submit_and_wait();
        const auto* p = static_cast<const std::uint8_t*>(rb.mapped());
        for (int c = 0; c < chunks; ++c) {
            for (std::uint64_t i = 0; i < chunk_bytes; ++i) {
                if (p[c * chunk_bytes + i] != (c & 0xFF)) {
                    std::fprintf(stderr,
                        "wrap-around mismatch at chunk %d offset %llu: got 0x%02X want 0x%02X\n",
                        c, static_cast<unsigned long long>(i), p[c * chunk_bytes + i], c & 0xFF);
                    std::exit(1);
                }
            }
        }
        rb.destroy(gpu.allocator());
        dest.destroy(gpu.allocator());
        std::printf("[TEST] %d-chunk ring wrap-around OK\n", chunks);
    }

    // ── Test 4: enqueue_completion fires after preceding submits ──
    {
        auto dest = Buffer::create_storage_gpu_only(gpu.allocator(), 1024);
        auto res = tq.reserve_staging(256);
        expect(res.has_value(), "reservation for completion-marker test");
        std::memset(res->host_ptr, 0xCC, 256);
        auto h = tq.submit(*res, dest.buffer(), 0);

        bool fired = false;
        tq.enqueue_completion([&fired]() { fired = true; });

        // Single poll completes both the copy and the marker (fallback path
        // is synchronous: callbacks fire as soon as the frame_cmd is recorded
        // because the copy is in the same command buffer).
        for (int i = 0; i < 16 && !fired; ++i) {
            auto cmd = gpu.begin_commands();
            tq.poll_completions(cmd);
            gpu.submit_and_wait();
        }
        expect(fired, "enqueue_completion callback fired");
        expect(tq.status(h) == TransferQueue::Status::Complete,
               "preceding submit also Complete");
        dest.destroy(gpu.allocator());
        std::printf("[TEST] enqueue_completion ordering OK\n");
    }

    // ── Test 5: oversized reservation rejected ──
    {
        auto res = tq.reserve_staging(staging_size + 1);
        expect(!res.has_value(), "oversized reservation refused");
        std::printf("[TEST] oversized reservation rejected\n");
    }

    // ── Test 6: poll(VK_NULL_HANDLE) is safe in single-family mode ──
    // The unified poll_completions submits its own command buffer regardless
    // of `frame_cmd`; `frame_cmd` is consulted only for the cross-queue
    // acquire barrier when transfer/graphics families differ. In the
    // single-family fixture used here, passing VK_NULL_HANDLE must not
    // crash, must not drop the chunk, and must still produce a byte-perfect
    // upload after subsequent polls drive the fence to signal.
    {
        auto dest = Buffer::create_storage_gpu_only(gpu.allocator(), 256);
        auto res = tq.reserve_staging(64);
        expect(res.has_value(), "reservation for null-frame test");
        std::memset(res->host_ptr, 0xDD, 64);
        auto h = tq.submit(*res, dest.buffer(), 0);

        tq.poll_completions(VK_NULL_HANDLE);  // safe in single-family mode
        const auto s = tq.status(h);
        expect(s == TransferQueue::Status::Pending
            || s == TransferQueue::Status::InFlight,
               "status is Pending or InFlight after null-cmd poll (not lost)");

        // Driving the queue to completion still works.
        poll_until_complete(tq, gpu, {h});

        auto cmd = gpu.begin_commands();
        auto rb = gpu.readback_from_gpu(cmd, dest, 64);
        gpu.submit_and_wait();
        const auto* p = static_cast<const std::uint8_t*>(rb.mapped());
        for (int i = 0; i < 64; ++i) {
            expect(p[i] == 0xDD, "byte mismatch after recovered poll");
        }
        rb.destroy(gpu.allocator());
        dest.destroy(gpu.allocator());
        std::printf("[TEST] poll(VK_NULL_HANDLE) is safe (single-family path)\n");
    }

    // ── Test 7: request_cancel breaks a worker's reserve_staging spin loop ──
    // Regression for an engine-shutdown deadlock: workers loop forever on
    // `reserve_staging` when the ring is full; shutdown joins them while
    // still holding the lock that would have freed the ring.
    {
        // Fill the ring so further reservations will block.
        auto pad = tq.reserve_staging(staging_size);
        expect(pad.has_value(), "saturating reservation for cancellation test");

        std::atomic<bool> worker_returned{false};
        std::thread worker([&]() {
            std::optional<TransferQueue::Reservation> r;
            while (!(r = tq.reserve_staging(64))) {
                if (tq.is_shutting_down()) {
                    worker_returned.store(true);
                    return;
                }
                std::this_thread::sleep_for(std::chrono::milliseconds(1));
            }
            // Should never succeed in this test — if it does, fail loud.
            std::fprintf(stderr, "FAIL: worker got reservation despite saturated ring\n");
            std::exit(1);
        });

        // Give the worker a chance to enter its retry loop.
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
        expect(!worker_returned.load(), "worker is still spinning before cancel");

        tq.request_cancel();
        worker.join();
        expect(worker_returned.load(), "worker observed cancel and exited");
        std::printf("[TEST] request_cancel unblocks worker spin loop\n");
    }

    tq.shutdown();

    // ── Test 8: per-frame transfer budget spreads work across polls ─────
    // Build a separate TransferQueue with a small budget and a ring large
    // enough to hold every reservation in flight, then verify that chunks
    // exceeding the budget get deferred to subsequent polls (instead of
    // recording into one giant submission). Allowance: a single chunk is
    // always permitted even if it alone exceeds the budget — otherwise
    // oversize payloads would never make progress.
    {
        constexpr std::uint64_t kRing       = 4ull * 1024 * 1024;  // 4 MB ring
        constexpr std::uint64_t kChunkBytes = 384ull * 1024;       // 384 KB each
        constexpr int           kChunks     = 5;                    // 5 × 384 KB = 1.875 MB
        constexpr std::uint32_t kBudgetMB   = 1;                    // 1 MB → 2 chunks/poll

        TransferQueue tiny(
            gpu.device(), gpu.allocator(),
            gpu.context().graphics_queue(),
            gpu.queue_family(), gpu.queue_family(),
            /*dedicated=*/false,
            kRing,
            kBudgetMB);

        auto dest = Buffer::create_storage_gpu_only(gpu.allocator(),
                                                     kChunks * kChunkBytes);

        std::vector<TransferQueue::Handle> handles;
        for (int c = 0; c < kChunks; ++c) {
            auto res = tiny.reserve_staging(kChunkBytes);
            expect(res.has_value(), "tiny-budget reservation succeeded");
            std::memset(res->host_ptr, 0xE0 + c, kChunkBytes);
            handles.push_back(tiny.submit(*res, dest.buffer(),
                                          static_cast<std::uint64_t>(c) * kChunkBytes));
        }

        // First poll: budget allows 2 × 384 KB = 768 KB before the third
        // chunk would push us over 1 MB. Three chunks must remain Pending.
        {
            auto cmd = gpu.begin_commands();
            tiny.poll_completions(cmd);
            gpu.submit_and_wait();

            int still_pending = 0;
            for (auto h : handles) {
                if (tiny.status(h) == TransferQueue::Status::Pending) still_pending++;
            }
            expect(still_pending >= 2,
                   "first poll deferred at least the budget-exceeding tail");
        }

        // Drive the rest to completion across multiple polls.
        for (int i = 0; i < 32; ++i) {
            auto cmd = gpu.begin_commands();
            tiny.poll_completions(cmd);
            gpu.submit_and_wait();
            bool all_done = true;
            for (auto h : handles) {
                if (tiny.status(h) != TransferQueue::Status::Complete) {
                    all_done = false;
                    break;
                }
            }
            if (all_done) break;
        }
        for (auto h : handles) {
            expect(tiny.status(h) == TransferQueue::Status::Complete,
                   "all budgeted chunks eventually complete");
        }

        // Verify bytes landed correctly across the destination buffer.
        auto cmd = gpu.begin_commands();
        auto rb = gpu.readback_from_gpu(cmd, dest, kChunks * kChunkBytes);
        gpu.submit_and_wait();
        const auto* p = static_cast<const std::uint8_t*>(rb.mapped());
        for (int c = 0; c < kChunks; ++c) {
            const auto expected = static_cast<std::uint8_t>(0xE0 + c);
            for (std::uint64_t i = 0; i < kChunkBytes; ++i) {
                if (p[c * kChunkBytes + i] != expected) {
                    std::fprintf(stderr,
                        "byte mismatch chunk %d offset %llu: got 0x%02X want 0x%02X\n",
                        c, static_cast<unsigned long long>(i),
                        p[c * kChunkBytes + i], expected);
                    std::exit(1);
                }
            }
        }
        rb.destroy(gpu.allocator());
        dest.destroy(gpu.allocator());
        tiny.shutdown();
        std::printf("[TEST] per-frame budget defers excess across polls\n");
    }

    gpu.shutdown();
    std::printf("[ALL TESTS PASSED]\n");
    return 0;
}
