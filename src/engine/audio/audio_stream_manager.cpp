// AudioStreamManager — background decode thread for streaming audio sources.

#include "audio_stream_manager.hpp"
#include "streaming_audio_source.hpp"

#include <algorithm>
#include <chrono>

namespace gseurat::audio {

AudioStreamManager::AudioStreamManager()
    : thread_([this] { worker_loop(); })
{
}

AudioStreamManager::~AudioStreamManager() {
    stop_.store(true, std::memory_order_release);
    cv_.notify_one();
    if (thread_.joinable()) {
        thread_.join();
    }
}

void AudioStreamManager::add_source(StreamingAudioSource* src) {
    {
        std::lock_guard lock(mutex_);
        sources_.push_back(src);
    }
    cv_.notify_one();
}

void AudioStreamManager::remove_source(StreamingAudioSource* src) {
    {
        std::lock_guard lock(mutex_);
        auto it = std::find(sources_.begin(), sources_.end(), src);
        if (it != sources_.end()) {
            sources_.erase(it);
        }
    }

    // Spin-wait for any in-flight refill to complete (~1-2ms max).
    while (src->refilling_.load(std::memory_order_acquire)) {
        std::this_thread::yield();
    }
}

void AudioStreamManager::notify_consumption() {
    cv_.notify_one();
}

void AudioStreamManager::worker_loop() {
    constexpr uint32_t kRefillFrames = 4096;

    while (!stop_.load(std::memory_order_acquire)) {
        StreamingAudioSource* target = nullptr;

        {
            std::unique_lock lock(mutex_);

            // Priority: process seek requests first.
            for (auto* src : sources_) {
                if (src->has_seek_request()) {
                    src->process_seek_request();
                }
            }

            // Find the hungriest source that needs refill.
            for (auto* src : sources_) {
                if (src->needs_refill()) {
                    target = src;
                    break;
                }
            }

            if (!target) {
                // All buffers are full — sleep until woken.
                cv_.wait(lock, [this] {
                    if (stop_.load(std::memory_order_relaxed)) return true;
                    for (auto* s : sources_) {
                        if (s->needs_refill() || s->has_seek_request()) return true;
                    }
                    return false;
                });
                continue;  // Re-check after wake.
            }
        }

        // Refill outside the lock (I/O happens here).
        target->refill(kRefillFrames);
    }
}

}  // namespace gseurat::audio
