#include "vulkan_game/engine/async_loader.hpp"

#include <stdexcept>

namespace vulkan_game {

AsyncLoader::~AsyncLoader() {
    shutdown();
}

void AsyncLoader::init() {
    if (initialized_) return;
    initialized_ = true;
    stop_requested_.store(false, std::memory_order_relaxed);

    // Clear any stale state from a previous init/shutdown cycle
    {
        std::lock_guard lock(result_mutex_);
        completed_.clear();
    }
    {
        std::lock_guard lock(cancel_mutex_);
        cancelled_.clear();
    }

    worker_ = std::thread([this] { worker_loop(); });
}

void AsyncLoader::shutdown() {
    if (!initialized_) return;
    initialized_ = false;

    // Signal stop
    stop_requested_.store(true, std::memory_order_release);

    // Wake the worker if it's waiting
    request_cv_.notify_all();

    // Join
    if (worker_.joinable()) {
        worker_.join();
    }

    // Clear remaining requests
    {
        std::lock_guard lock(request_mutex_);
        request_queue_.clear();
    }
}

uint32_t AsyncLoader::submit(std::function<std::any()> job) {
    uint32_t id = next_id_.fetch_add(1, std::memory_order_relaxed);

    {
        std::lock_guard lock(request_mutex_);
        request_queue_.push_back(Request{id, std::move(job)});
    }
    request_cv_.notify_one();

    return id;
}

std::vector<LoadResult> AsyncLoader::poll_results() {
    std::lock_guard lock(result_mutex_);
    std::vector<LoadResult> out;
    out.swap(completed_);
    return out;
}

void AsyncLoader::cancel(uint32_t request_id) {
    // Mark as cancelled — worker checks before processing and before posting result
    {
        std::lock_guard lock(cancel_mutex_);
        cancelled_.insert(request_id);
    }

    // Also remove from request queue if still pending
    {
        std::lock_guard lock(request_mutex_);
        std::erase_if(request_queue_, [request_id](const Request& r) {
            return r.id == request_id;
        });
    }
}

uint32_t AsyncLoader::pending_count() const {
    uint32_t queued = 0;
    {
        std::lock_guard lock(request_mutex_);
        queued = static_cast<uint32_t>(request_queue_.size());
    }
    return queued + in_flight_.load(std::memory_order_relaxed);
}

void AsyncLoader::worker_loop() {
    while (!stop_requested_.load(std::memory_order_acquire)) {
        Request req;

        // Wait for a request
        {
            std::unique_lock lock(request_mutex_);
            request_cv_.wait(lock, [this] {
                return !request_queue_.empty() ||
                       stop_requested_.load(std::memory_order_acquire);
            });

            if (stop_requested_.load(std::memory_order_acquire)) break;
            if (request_queue_.empty()) continue;

            req = std::move(request_queue_.front());
            request_queue_.pop_front();
        }

        // Check if cancelled
        {
            std::lock_guard lock(cancel_mutex_);
            if (cancelled_.count(req.id)) {
                cancelled_.erase(req.id);
                continue;
            }
        }

        in_flight_.fetch_add(1, std::memory_order_relaxed);

        // Execute the job
        LoadResult result;
        result.request_id = req.id;

        try {
            result.data = req.job();
            result.success = true;
        } catch (const std::exception& e) {
            result.success = false;
            result.error = e.what();
        } catch (...) {
            result.success = false;
            result.error = "unknown error";
        }

        in_flight_.fetch_sub(1, std::memory_order_relaxed);

        // Check if cancelled while running
        {
            std::lock_guard lock(cancel_mutex_);
            if (cancelled_.count(req.id)) {
                cancelled_.erase(req.id);
                continue;  // discard result
            }
        }

        // Post result
        {
            std::lock_guard lock(result_mutex_);
            completed_.push_back(std::move(result));
        }
    }
}

}  // namespace vulkan_game
