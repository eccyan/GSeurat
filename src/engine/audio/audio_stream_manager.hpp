#pragma once
// AudioStreamManager: background decode-thread manager for streaming audio.
//
// Owns a single worker thread that refills StreamingAudioSource ring buffers.
// Worker loop priority: seek requests first, then hungriest source refill.
// I/O (ma_decoder reads) happens outside the critical section.

#include <atomic>
#include <condition_variable>
#include <mutex>
#include <thread>
#include <vector>

namespace gseurat::audio {

class StreamingAudioSource;

class AudioStreamManager {
public:
    AudioStreamManager();
    ~AudioStreamManager();

    AudioStreamManager(const AudioStreamManager&) = delete;
    AudioStreamManager& operator=(const AudioStreamManager&) = delete;

    /// Register a source for background refill. Thread-safe.
    void add_source(StreamingAudioSource* src);

    /// Deregister a source. Blocks until any in-flight refill completes (~1-2ms max).
    void remove_source(StreamingAudioSource* src);

    /// Wake the worker — called by sources after consumption.
    void notify_consumption();

private:
    void worker_loop();

    std::thread thread_;
    std::mutex mutex_;
    std::condition_variable cv_;
    std::atomic<bool> stop_{false};
    std::vector<StreamingAudioSource*> sources_;
};

}  // namespace gseurat::audio
