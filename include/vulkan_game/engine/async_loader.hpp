#pragma once

#include <any>
#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <functional>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_set>
#include <vector>

namespace vulkan_game {

// --- Result wrapper returned by poll_results() ---

struct LoadResult {
    uint32_t request_id = 0;
    bool success = true;
    std::string error;       // non-empty on failure
    std::any data;           // TexturePixels, GaussianCloud, etc.
};

// --- Convenience result types ---

struct TexturePixels {
    std::vector<uint8_t> pixels;   // RGBA
    uint32_t width = 0;
    uint32_t height = 0;
    std::string path;
};

// --- Async loader: single worker thread with request/result queues ---

class AsyncLoader {
public:
    AsyncLoader() = default;
    ~AsyncLoader();

    AsyncLoader(const AsyncLoader&) = delete;
    AsyncLoader& operator=(const AsyncLoader&) = delete;

    // Start the worker thread. Must be called before submitting jobs.
    void init();

    // Stop the worker thread and discard pending requests.
    void shutdown();

    // Submit a generic job. The callable runs on the worker thread and must
    // return std::any (the payload stored in LoadResult::data).
    // Returns a request ID that can be used with cancel().
    uint32_t submit(std::function<std::any()> job);

    // Poll for completed results (non-blocking). Returns all results that
    // have finished since the last call.
    std::vector<LoadResult> poll_results();

    // Best-effort cancel: if the request hasn't started yet, it won't run.
    // If it's already running, the result is discarded when it completes.
    void cancel(uint32_t request_id);

    // Number of pending + in-flight requests.
    uint32_t pending_count() const;

private:
    struct Request {
        uint32_t id = 0;
        std::function<std::any()> job;
    };

    void worker_loop();

    std::thread worker_;
    std::atomic<bool> stop_requested_{false};
    bool initialized_ = false;

    mutable std::mutex request_mutex_;
    std::condition_variable request_cv_;
    std::deque<Request> request_queue_;

    mutable std::mutex result_mutex_;
    std::vector<LoadResult> completed_;

    mutable std::mutex cancel_mutex_;
    std::unordered_set<uint32_t> cancelled_;

    std::atomic<uint32_t> next_id_{1};
    std::atomic<uint32_t> in_flight_{0};
};

}  // namespace vulkan_game
