// Unit test: AsyncLoader — queue semantics, ordering, cancel, shutdown
//
// Build:
//   c++ -std=c++23 -I include \
//       tests/test_async_loader.cpp src/engine/async_loader.cpp \
//       -o build/test_async_loader
//
// Run: ./build/test_async_loader

#include "vulkan_game/engine/async_loader.hpp"

#include <cassert>
#include <chrono>
#include <cstdio>
#include <thread>

using namespace vulkan_game;

// Helper: poll with timeout (avoids hanging on failure)
static std::vector<LoadResult> poll_until(AsyncLoader& loader, uint32_t count,
                                          int timeout_ms = 2000) {
    std::vector<LoadResult> all;
    auto deadline = std::chrono::steady_clock::now() +
                    std::chrono::milliseconds(timeout_ms);
    while (all.size() < count &&
           std::chrono::steady_clock::now() < deadline) {
        auto batch = loader.poll_results();
        for (auto& r : batch) all.push_back(std::move(r));
        if (all.size() < count) {
            std::this_thread::sleep_for(std::chrono::milliseconds(5));
        }
    }
    return all;
}

int main() {
    // 1. Submit a job, poll_results returns it
    {
        AsyncLoader loader;
        loader.init();

        uint32_t id = loader.submit([]() -> std::any { return 42; });
        assert(id > 0);

        auto results = poll_until(loader, 1);
        assert(results.size() == 1);
        assert(results[0].request_id == id);
        assert(results[0].success == true);
        assert(std::any_cast<int>(results[0].data) == 42);

        loader.shutdown();
        std::printf("PASS: submit and poll\n");
    }

    // 2. Multiple requests are all processed
    {
        AsyncLoader loader;
        loader.init();

        std::vector<uint32_t> ids;
        for (int i = 0; i < 10; ++i) {
            ids.push_back(loader.submit([i]() -> std::any { return i * 10; }));
        }

        auto results = poll_until(loader, 10);
        assert(results.size() == 10);

        // All IDs should be present (order may vary due to timing)
        std::unordered_set<uint32_t> result_ids;
        for (const auto& r : results) {
            result_ids.insert(r.request_id);
        }
        for (uint32_t id : ids) {
            assert(result_ids.count(id) == 1);
        }

        loader.shutdown();
        std::printf("PASS: multiple requests all processed\n");
    }

    // 3. poll_results returns empty when nothing is complete
    {
        AsyncLoader loader;
        loader.init();

        auto results = loader.poll_results();
        assert(results.empty());

        loader.shutdown();
        std::printf("PASS: poll_results empty when idle\n");
    }

    // 4. cancel() prevents result from appearing (best-effort)
    {
        AsyncLoader loader;
        loader.init();

        // Submit a slow job then cancel it before it can run
        uint32_t slow_id = loader.submit([]() -> std::any {
            std::this_thread::sleep_for(std::chrono::milliseconds(200));
            return std::string("slow");
        });
        // Submit a fast job after
        uint32_t fast_id = loader.submit([]() -> std::any {
            return std::string("fast");
        });

        loader.cancel(slow_id);

        // Wait for results — we should get at least the fast one
        auto results = poll_until(loader, 1, 3000);

        // The cancelled job's result should not appear
        bool found_slow = false;
        bool found_fast = false;
        for (const auto& r : results) {
            if (r.request_id == slow_id) found_slow = true;
            if (r.request_id == fast_id) found_fast = true;
        }
        assert(found_fast);
        assert(!found_slow);

        loader.shutdown();
        std::printf("PASS: cancel prevents result\n");
    }

    // 5. shutdown() while requests are pending does not hang
    {
        AsyncLoader loader;
        loader.init();

        for (int i = 0; i < 100; ++i) {
            loader.submit([i]() -> std::any {
                std::this_thread::sleep_for(std::chrono::milliseconds(10));
                return i;
            });
        }

        // Shutdown immediately — should not hang
        auto start = std::chrono::steady_clock::now();
        loader.shutdown();
        auto elapsed = std::chrono::steady_clock::now() - start;
        // Should complete reasonably quickly (< 2s), not process all 100 jobs
        assert(elapsed < std::chrono::seconds(2));
        std::printf("PASS: shutdown with pending requests\n");
    }

    // 6. Job that throws is reported as error
    {
        AsyncLoader loader;
        loader.init();

        uint32_t id = loader.submit([]() -> std::any {
            throw std::runtime_error("test error");
            return std::any{};
        });

        auto results = poll_until(loader, 1);
        assert(results.size() == 1);
        assert(results[0].request_id == id);
        assert(results[0].success == false);
        assert(results[0].error.find("test error") != std::string::npos);

        loader.shutdown();
        std::printf("PASS: job exception reported as error\n");
    }

    // 7. Request IDs are unique and monotonically increasing
    {
        AsyncLoader loader;
        loader.init();

        uint32_t id1 = loader.submit([]() -> std::any { return 1; });
        uint32_t id2 = loader.submit([]() -> std::any { return 2; });
        uint32_t id3 = loader.submit([]() -> std::any { return 3; });
        assert(id1 < id2);
        assert(id2 < id3);

        poll_until(loader, 3);
        loader.shutdown();
        std::printf("PASS: monotonic request IDs\n");
    }

    // 8. pending_count tracks in-flight + queued work
    {
        AsyncLoader loader;
        loader.init();

        assert(loader.pending_count() == 0);

        // Submit a slow job to keep the worker busy
        loader.submit([]() -> std::any {
            std::this_thread::sleep_for(std::chrono::milliseconds(200));
            return 0;
        });
        // Submit more while first is running
        loader.submit([]() -> std::any { return 1; });
        loader.submit([]() -> std::any { return 2; });

        // Give worker a moment to pick up the first job
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
        // Should have some pending
        assert(loader.pending_count() >= 1);

        // Wait for all to complete
        poll_until(loader, 3);
        // After all results polled, give worker a moment to finish
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
        assert(loader.pending_count() == 0);

        loader.shutdown();
        std::printf("PASS: pending_count tracking\n");
    }

    // 9. Double init/shutdown is safe
    {
        AsyncLoader loader;
        loader.init();
        loader.init();  // second init should be no-op
        loader.shutdown();
        loader.shutdown();  // second shutdown should be no-op
        std::printf("PASS: double init/shutdown safe\n");
    }

    // 10. Can reuse after shutdown + init
    {
        AsyncLoader loader;
        loader.init();
        loader.submit([]() -> std::any { return 1; });
        poll_until(loader, 1);
        loader.shutdown();

        loader.init();
        uint32_t id = loader.submit([]() -> std::any { return 2; });
        auto results = poll_until(loader, 1);
        assert(results.size() == 1);
        assert(results[0].request_id == id);
        assert(std::any_cast<int>(results[0].data) == 2);
        loader.shutdown();
        std::printf("PASS: reuse after shutdown\n");
    }

    std::printf("\nAll async_loader tests passed.\n");
    return 0;
}
