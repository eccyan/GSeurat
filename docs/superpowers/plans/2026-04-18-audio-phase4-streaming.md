# Phase 4: Ogg Vorbis Streaming — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add streaming audio playback from Ogg Vorbis files via a lock-free ring buffer and a dedicated background decode thread, enabling long music tracks without full-file memory loading.

**Architecture:** `AudioRingBuffer` (lock-free, monotonic cursors, power-of-two capacity) feeds decoded float32 PCM from a background `AudioStreamManager` thread to `StreamingAudioSource::read_frames` on the audio thread. Seamless looping via decode-side `ma_decoder_seek`. Hard seek support with flush + silence + async re-decode. Format auto-detection via `"OggS"` magic bytes.

**Tech Stack:** C++23, miniaudio 0.11.21 (stb_vorbis backend for Ogg decode), `std::thread` + `std::condition_variable`, `std::atomic<uint64_t>` for ring buffer cursors.

**Spec:** `docs/superpowers/specs/2026-04-18-audio-phase4-streaming-design.md`

---

## File Structure

**New files:**
```
src/engine/audio/audio_ring_buffer.hpp          — lock-free PCM circular buffer
src/engine/audio/streaming_audio_source.hpp     — StreamingAudioSource class
src/engine/audio/streaming_audio_source.cpp     — ring + ma_decoder + seek logic
src/engine/audio/audio_stream_manager.hpp       — decode thread manager
src/engine/audio/audio_stream_manager.cpp       — worker loop + safe removal
tests/test_audio_ring_buffer.cpp                — ring buffer unit tests
tests/test_audio_streaming.cpp                  — streaming pipeline integration test
tests/test_data/audio/dc_unity.ogg              — Ogg Vorbis fixture (generated via ffmpeg)
```

**Modified files:**
```
src/engine/audio/audio_engine.cpp               — AudioStreamManager member, Ogg auto-detection, pass loop points
include/gseurat/engine/audio/audio_engine.hpp   — forward-declare AudioStreamManager (no API changes)
examples/island_demo/assets/audio/field_theme.music.json — update stem paths to .ogg
CMakeLists.txt                                  — new sources + tests
```

---

## Milestone 1 — AudioRingBuffer

### Task 1.1: AudioRingBuffer implementation + unit tests

**Files:**
- Create: `src/engine/audio/audio_ring_buffer.hpp`
- Create: `tests/test_audio_ring_buffer.cpp`
- Modify: `CMakeLists.txt`

- [ ] **Step 1: Create the ring buffer**

Create `src/engine/audio/audio_ring_buffer.hpp`:
```cpp
#pragma once
// Lock-free circular buffer for streaming float32 PCM audio.
// Single producer (decode thread) writes via write().
// Single consumer (audio thread) reads via read().
// Monotonic cursors — never wrap; index via (pos * channels) & mask.

#include <atomic>
#include <cstdint>
#include <cstring>
#include <vector>

namespace gseurat::audio {

class AudioRingBuffer {
public:
    AudioRingBuffer(uint32_t capacity_frames, uint32_t channels)
        : channels_(channels),
          capacity_frames_(capacity_frames),
          buffer_(static_cast<size_t>(capacity_frames) * channels, 0.0f) {
        // capacity_frames should be power-of-two for mask efficiency
    }

    // Decode thread: write decoded PCM frames. Returns frames actually written.
    uint32_t write(const float* data, uint32_t frames) noexcept {
        const uint32_t avail = free_frames();
        const uint32_t to_write = (frames < avail) ? frames : avail;
        if (to_write == 0) return 0;

        const uint64_t wp = write_pos_.load(std::memory_order_relaxed);
        const uint32_t buf_samples = capacity_frames_ * channels_;
        const uint32_t start_sample = static_cast<uint32_t>((wp * channels_) % buf_samples);
        const uint32_t write_samples = to_write * channels_;

        if (start_sample + write_samples <= buf_samples) {
            std::memcpy(buffer_.data() + start_sample, data, write_samples * sizeof(float));
        } else {
            const uint32_t first = buf_samples - start_sample;
            std::memcpy(buffer_.data() + start_sample, data, first * sizeof(float));
            std::memcpy(buffer_.data(), data + first, (write_samples - first) * sizeof(float));
        }

        write_pos_.store(wp + to_write, std::memory_order_release);
        return to_write;
    }

    // Audio thread: read PCM frames into output. Returns frames actually read.
    uint32_t read(float* out, uint32_t frames) noexcept {
        const uint32_t avail = available_frames();
        const uint32_t to_read = (frames < avail) ? frames : avail;
        if (to_read == 0) return 0;

        const uint64_t rp = read_pos_.load(std::memory_order_relaxed);
        const uint32_t buf_samples = capacity_frames_ * channels_;
        const uint32_t start_sample = static_cast<uint32_t>((rp * channels_) % buf_samples);
        const uint32_t read_samples = to_read * channels_;

        if (start_sample + read_samples <= buf_samples) {
            std::memcpy(out, buffer_.data() + start_sample, read_samples * sizeof(float));
        } else {
            const uint32_t first = buf_samples - start_sample;
            std::memcpy(out, buffer_.data() + start_sample, first * sizeof(float));
            std::memcpy(out + first, buffer_.data(), (read_samples - first) * sizeof(float));
        }

        read_pos_.store(rp + to_read, std::memory_order_release);
        return to_read;
    }

    uint32_t available_frames() const noexcept {
        const uint64_t wp = write_pos_.load(std::memory_order_acquire);
        const uint64_t rp = read_pos_.load(std::memory_order_relaxed);
        return static_cast<uint32_t>(wp - rp);
    }

    uint32_t free_frames() const noexcept {
        return capacity_frames_ - available_frames();
    }

    void flush() noexcept {
        const uint64_t wp = write_pos_.load(std::memory_order_relaxed);
        read_pos_.store(wp, std::memory_order_release);
    }

    uint32_t capacity() const noexcept { return capacity_frames_; }
    uint32_t channels() const noexcept { return channels_; }

private:
    uint32_t                  channels_;
    uint32_t                  capacity_frames_;
    std::vector<float>        buffer_;
    std::atomic<uint64_t>     read_pos_{0};
    std::atomic<uint64_t>     write_pos_{0};
};

}  // namespace gseurat::audio
```

- [ ] **Step 2: Write the unit test**

Create `tests/test_audio_ring_buffer.cpp`:
```cpp
// Test: AudioRingBuffer — write/read, wrap-around, overflow, flush.
#include "audio_ring_buffer.hpp"

#include <cmath>
#include <cstdio>
#include <vector>

using gseurat::audio::AudioRingBuffer;

static int passed = 0, failed = 0;
static void check(bool c, const char* m) {
    if (c) { std::printf("  PASS: %s\n", m); ++passed; }
    else   { std::printf("  FAIL: %s\n", m); ++failed; }
}

int main() {
    std::printf("\n=== AudioRingBuffer Tests ===\n\n");

    // --- Basic write/read round-trip (mono) ---
    {
        AudioRingBuffer rb(1024, 1);
        check(rb.available_frames() == 0, "empty: available == 0");
        check(rb.free_frames() == 1024, "empty: free == capacity");

        float data[256];
        for (int i = 0; i < 256; ++i) data[i] = static_cast<float>(i);
        check(rb.write(data, 256) == 256, "write 256 frames");
        check(rb.available_frames() == 256, "available == 256 after write");

        float out[256]{};
        check(rb.read(out, 256) == 256, "read 256 frames");
        bool match = true;
        for (int i = 0; i < 256; ++i) if (out[i] != data[i]) { match = false; break; }
        check(match, "read data matches written data");
        check(rb.available_frames() == 0, "available == 0 after read");
    }

    // --- Stereo write/read ---
    {
        AudioRingBuffer rb(512, 2);
        float data[128];  // 64 frames * 2 channels
        for (int i = 0; i < 128; ++i) data[i] = static_cast<float>(i) * 0.1f;
        check(rb.write(data, 64) == 64, "stereo: write 64 frames");
        float out[128]{};
        check(rb.read(out, 64) == 64, "stereo: read 64 frames");
        bool match = true;
        for (int i = 0; i < 128; ++i) if (out[i] != data[i]) { match = false; break; }
        check(match, "stereo: data matches");
    }

    // --- Wrap-around ---
    {
        AudioRingBuffer rb(64, 1);  // small buffer to force wrap
        float data[48];
        for (int i = 0; i < 48; ++i) data[i] = static_cast<float>(i);
        float out[48]{};

        rb.write(data, 48);  // fill 48 of 64
        rb.read(out, 48);    // drain all — read_pos = 48

        // Now write 48 more — wraps at position 64
        for (int i = 0; i < 48; ++i) data[i] = static_cast<float>(i + 100);
        check(rb.write(data, 48) == 48, "wrap: write spans boundary");
        check(rb.read(out, 48) == 48, "wrap: read spans boundary");
        bool match = true;
        for (int i = 0; i < 48; ++i) if (out[i] != static_cast<float>(i + 100)) { match = false; break; }
        check(match, "wrap: data correct across boundary");
    }

    // --- Overflow: write more than free space ---
    {
        AudioRingBuffer rb(64, 1);
        float data[128];
        for (int i = 0; i < 128; ++i) data[i] = static_cast<float>(i);
        check(rb.write(data, 128) == 64, "overflow: capped at capacity");
        check(rb.available_frames() == 64, "overflow: buffer full");
        check(rb.write(data, 1) == 0, "overflow: zero when full");
    }

    // --- Underrun: read more than available ---
    {
        AudioRingBuffer rb(64, 1);
        float out[64]{};
        check(rb.read(out, 64) == 0, "underrun: zero when empty");
    }

    // --- Flush ---
    {
        AudioRingBuffer rb(64, 1);
        float data[32];
        for (int i = 0; i < 32; ++i) data[i] = 1.0f;
        rb.write(data, 32);
        check(rb.available_frames() == 32, "pre-flush: 32 available");
        rb.flush();
        check(rb.available_frames() == 0, "post-flush: 0 available");
        check(rb.free_frames() == 64, "post-flush: full capacity free");
    }

    std::printf("\n=== %d passed, %d failed ===\n", passed, failed);
    return failed == 0 ? 0 : 1;
}
```

- [ ] **Step 3: Register in CMakeLists.txt**

Add the test (ring buffer is header-only, no source to add to gseurat_core):
```cmake
add_gseurat_test(test_audio_ring_buffer)
target_include_directories(test_audio_ring_buffer PRIVATE ${PROJECT_SOURCE_DIR}/src/engine/audio)
```

- [ ] **Step 4: Build, run, verify**

```bash
cmake --build --preset macos-debug --target test_audio_ring_buffer -j
ctest --test-dir build/macos-debug -R test_audio_ring_buffer --output-on-failure
```

- [ ] **Step 5: Commit**

```bash
git add src/engine/audio/audio_ring_buffer.hpp \
        tests/test_audio_ring_buffer.cpp CMakeLists.txt
git commit -m "audio: add AudioRingBuffer (lock-free PCM circular buffer) + tests"
```

---

## Milestone 2 — Ogg fixture + StreamingAudioSource + AudioStreamManager

### Task 2.1: Generate Ogg Vorbis test fixture

**Files:**
- Create: `tests/test_data/audio/dc_unity.ogg`

- [ ] **Step 1: Generate the fixture**

```bash
ffmpeg -i tests/test_data/audio/dc_unity.wav -c:a libvorbis -q:a 5 tests/test_data/audio/dc_unity.ogg -y
```

If `ffmpeg` is not available, install: `brew install ffmpeg`

- [ ] **Step 2: Verify**

```bash
ffprobe tests/test_data/audio/dc_unity.ogg 2>&1 | grep -E "Duration|Stream"
```
Expected: mono, 48000 Hz, ~0.5s duration, vorbis codec.

- [ ] **Step 3: Commit**

```bash
git add tests/test_data/audio/dc_unity.ogg
git commit -m "tests: add dc_unity.ogg fixture (Ogg Vorbis, generated via ffmpeg)"
```

---

### Task 2.2: StreamingAudioSource + AudioStreamManager + integration test

**Files:**
- Create: `src/engine/audio/streaming_audio_source.hpp`
- Create: `src/engine/audio/streaming_audio_source.cpp`
- Create: `src/engine/audio/audio_stream_manager.hpp`
- Create: `src/engine/audio/audio_stream_manager.cpp`
- Create: `tests/test_audio_streaming.cpp`
- Modify: `CMakeLists.txt`

- [ ] **Step 1: Create AudioStreamManager header**

Create `src/engine/audio/audio_stream_manager.hpp`:
```cpp
#pragma once
#include <atomic>
#include <condition_variable>
#include <mutex>
#include <thread>
#include <vector>

namespace gseurat::audio {

class StreamingAudioSource;  // forward

class AudioStreamManager {
public:
    AudioStreamManager();
    ~AudioStreamManager();

    AudioStreamManager(const AudioStreamManager&) = delete;
    AudioStreamManager& operator=(const AudioStreamManager&) = delete;

    void add_source(StreamingAudioSource* src);
    void remove_source(StreamingAudioSource* src);
    void notify_consumption();

private:
    void worker_loop();

    std::thread                        thread_;
    std::mutex                         mutex_;
    std::condition_variable            cv_;
    std::atomic<bool>                  stop_{false};
    std::vector<StreamingAudioSource*> sources_;
};

}  // namespace gseurat::audio
```

- [ ] **Step 2: Create StreamingAudioSource header**

Create `src/engine/audio/streaming_audio_source.hpp`:
```cpp
#pragma once
#include "gseurat/engine/audio/audio_source.hpp"
#include "gseurat/engine/audio/memory_audio_source.hpp"  // LoadError
#include "audio_ring_buffer.hpp"

#include <atomic>
#include <expected>
#include <memory>
#include <string>
#include <string_view>

// Forward-declare miniaudio types to avoid including the full header
struct ma_decoder;

namespace gseurat::audio {

class AudioStreamManager;

class StreamingAudioSource final : public IAudioSource {
public:
    static std::expected<std::unique_ptr<StreamingAudioSource>, LoadError>
        create(std::string_view path, uint32_t sample_rate,
               uint64_t loop_start, uint64_t loop_end,
               AudioStreamManager* manager,
               uint32_t ring_capacity_frames = 44100);

    ~StreamingAudioSource() override;

    StreamingAudioSource(const StreamingAudioSource&) = delete;
    StreamingAudioSource& operator=(const StreamingAudioSource&) = delete;

    AudioFormat format()       const noexcept override { return format_; }
    uint64_t    total_frames() const noexcept override { return total_frames_; }

    void read_frames(uint64_t start_frame,
                     uint32_t frame_count,
                     std::span<float> out_interleaved) const noexcept override;

    // Decode thread interface
    void refill(uint32_t max_frames);
    bool needs_refill() const noexcept;
    bool has_seek_request() const noexcept;
    void process_seek_request();

    // Safe removal guard
    std::atomic<bool> refilling_{false};

private:
    StreamingAudioSource(std::unique_ptr<ma_decoder> decoder,
                          AudioFormat fmt, uint64_t total_frames,
                          uint64_t loop_start, uint64_t loop_end,
                          AudioStreamManager* manager,
                          uint32_t ring_capacity_frames);

    std::unique_ptr<ma_decoder>     decoder_;
    AudioRingBuffer                 ring_;
    AudioFormat                     format_;
    uint64_t                        total_frames_;

    uint64_t                        loop_start_;
    uint64_t                        loop_end_;
    uint64_t                        decode_cursor_{0};

    mutable std::atomic<uint64_t>   expected_read_cursor_{0};
    mutable std::atomic<int64_t>    seek_request_{-1};

    AudioStreamManager*             manager_;
};

}  // namespace gseurat::audio
```

- [ ] **Step 3: Create StreamingAudioSource implementation**

Create `src/engine/audio/streaming_audio_source.cpp`:

Key implementation points:
- `create()`: open `ma_decoder` in streaming mode (output format float32, channels 0 = auto, sample_rate 0 = auto), validate sample rate match, query total frames (may be 0 for Vorbis — accept it), register with manager, pre-fill ring buffer
- `read_frames()`: dual strategy — sequential reads pop from ring, mismatched `start_frame` triggers flush + seek request + silence output
- `refill()`: set `refilling_ = true`, decode via `ma_decoder_read_pcm_frames` into a stack buffer (4096 frames), write to ring, handle loop wrap (seek decoder to `loop_start` when `decode_cursor` reaches `loop_end`), set `refilling_ = false`
- `process_seek_request()`: read `seek_request_`, call `ma_decoder_seek_to_pcm_frame`, update `decode_cursor_`, clear request
- `needs_refill()`: ring buffer below 50% capacity
- Destructor: deregister from manager, uninit decoder

```cpp
#include "streaming_audio_source.hpp"
#include "audio_stream_manager.hpp"

#include <miniaudio.h>
#include <algorithm>
#include <cstring>

namespace gseurat::audio {

StreamingAudioSource::StreamingAudioSource(
    std::unique_ptr<ma_decoder> decoder,
    AudioFormat fmt, uint64_t total_frames,
    uint64_t loop_start, uint64_t loop_end,
    AudioStreamManager* manager,
    uint32_t ring_capacity_frames)
    : decoder_(std::move(decoder)),
      ring_(ring_capacity_frames, fmt.channels),
      format_(fmt),
      total_frames_(total_frames),
      loop_start_(loop_start),
      loop_end_(loop_end),
      manager_(manager) {}

StreamingAudioSource::~StreamingAudioSource() {
    if (manager_) manager_->remove_source(this);
    if (decoder_) ma_decoder_uninit(decoder_.get());
}

std::expected<std::unique_ptr<StreamingAudioSource>, LoadError>
StreamingAudioSource::create(std::string_view path, uint32_t sample_rate,
                              uint64_t loop_start, uint64_t loop_end,
                              AudioStreamManager* manager,
                              uint32_t ring_capacity_frames) {
    std::string path_str(path);
    auto dec = std::make_unique<ma_decoder>();

    ma_decoder_config cfg = ma_decoder_config_init(ma_format_f32, 0, 0);
    if (ma_decoder_init_file(path_str.c_str(), &cfg, dec.get()) != MA_SUCCESS) {
        return std::unexpected(LoadError::FileNotFound);
    }

    const uint32_t file_sr = dec->outputSampleRate;
    const uint32_t file_ch = dec->outputChannels;

    if (file_sr != sample_rate) {
        ma_decoder_uninit(dec.get());
        return std::unexpected(LoadError::SampleRateMismatch);
    }
    if (file_ch != 1 && file_ch != 2) {
        ma_decoder_uninit(dec.get());
        return std::unexpected(LoadError::ChannelCountUnsupported);
    }

    // Total frames may be 0 for some Vorbis files (stb_vorbis push mode).
    // If unknown, set to max and let EOF detection handle it.
    ma_uint64 total = 0;
    ma_decoder_get_length_in_pcm_frames(dec.get(), &total);
    if (total == 0) total = UINT64_MAX;

    AudioFormat fmt{file_sr, static_cast<uint8_t>(file_ch)};
    auto src = std::unique_ptr<StreamingAudioSource>(
        new StreamingAudioSource(std::move(dec), fmt, total,
                                  loop_start, loop_end, manager,
                                  ring_capacity_frames));

    // Pre-fill ring buffer before returning (game thread, blocking OK)
    src->refill(ring_capacity_frames);

    if (manager) manager->add_source(src.get());
    return src;
}

void StreamingAudioSource::read_frames(uint64_t start_frame,
                                         uint32_t frame_count,
                                         std::span<float> out) const noexcept {
    const uint64_t expected = expected_read_cursor_.load(std::memory_order_relaxed);

    if (start_frame == expected) {
        // Hot path: sequential read from ring buffer
        const uint32_t got = const_cast<AudioRingBuffer&>(ring_).read(out.data(), frame_count);
        if (got < frame_count) {
            // Underrun — zero-fill remainder
            std::memset(out.data() + got * format_.channels, 0,
                        static_cast<size_t>(frame_count - got) * format_.channels * sizeof(float));
        }
        expected_read_cursor_.store(start_frame + frame_count, std::memory_order_relaxed);
    } else {
        // Cold path: hard seek — flush + request async re-decode + silence
        const_cast<AudioRingBuffer&>(ring_).flush();
        seek_request_.store(static_cast<int64_t>(start_frame), std::memory_order_release);
        std::memset(out.data(), 0, out.size_bytes());
        expected_read_cursor_.store(start_frame + frame_count, std::memory_order_relaxed);
    }

    // Wake decode thread
    if (manager_) manager_->notify_consumption();
}

void StreamingAudioSource::refill(uint32_t max_frames) {
    refilling_.store(true, std::memory_order_release);

    // Check for seek request first
    const int64_t sreq = seek_request_.load(std::memory_order_acquire);
    if (sreq >= 0) {
        process_seek_request();
    }

    const uint32_t ch = format_.channels;
    float buf[4096 * 2];  // max 4096 stereo frames on stack
    uint32_t remaining = std::min(max_frames, ring_.free_frames());

    while (remaining > 0) {
        uint32_t to_decode = std::min(remaining, 4096u);

        // Cap at loop_end if looping
        if (loop_end_ > 0 && decode_cursor_ + to_decode > loop_end_) {
            to_decode = static_cast<uint32_t>(loop_end_ - decode_cursor_);
        }

        if (to_decode == 0) {
            // At loop boundary — wrap
            if (loop_end_ > 0) {
                ma_decoder_seek_to_pcm_frame(decoder_.get(), loop_start_);
                decode_cursor_ = loop_start_;
                continue;
            }
            break;  // EOF for non-looping
        }

        ma_uint64 frames_read = 0;
        ma_decoder_read_pcm_frames(decoder_.get(), buf, to_decode, &frames_read);
        if (frames_read == 0) {
            // EOF
            if (loop_end_ > 0) {
                ma_decoder_seek_to_pcm_frame(decoder_.get(), loop_start_);
                decode_cursor_ = loop_start_;
                continue;
            }
            break;
        }

        ring_.write(buf, static_cast<uint32_t>(frames_read));
        decode_cursor_ += frames_read;
        remaining -= static_cast<uint32_t>(frames_read);
    }

    refilling_.store(false, std::memory_order_release);
}

bool StreamingAudioSource::needs_refill() const noexcept {
    return ring_.available_frames() < ring_.capacity() / 2;
}

bool StreamingAudioSource::has_seek_request() const noexcept {
    return seek_request_.load(std::memory_order_relaxed) >= 0;
}

void StreamingAudioSource::process_seek_request() {
    const int64_t target = seek_request_.load(std::memory_order_acquire);
    if (target < 0) return;
    ma_decoder_seek_to_pcm_frame(decoder_.get(), static_cast<ma_uint64>(target));
    decode_cursor_ = static_cast<uint64_t>(target);
    seek_request_.store(-1, std::memory_order_release);
}

}  // namespace gseurat::audio
```

- [ ] **Step 4: Create AudioStreamManager implementation**

Create `src/engine/audio/audio_stream_manager.cpp`:
```cpp
#include "audio_stream_manager.hpp"
#include "streaming_audio_source.hpp"

#include <algorithm>

namespace gseurat::audio {

AudioStreamManager::AudioStreamManager() {
    thread_ = std::thread([this] { worker_loop(); });
}

AudioStreamManager::~AudioStreamManager() {
    stop_.store(true, std::memory_order_release);
    cv_.notify_one();
    if (thread_.joinable()) thread_.join();
}

void AudioStreamManager::add_source(StreamingAudioSource* src) {
    std::lock_guard lock(mutex_);
    sources_.push_back(src);
    cv_.notify_one();
}

void AudioStreamManager::remove_source(StreamingAudioSource* src) {
    {
        std::lock_guard lock(mutex_);
        std::erase(sources_, src);
    }
    // Spin-wait for in-flight refill (bounded ~1-2ms max)
    while (src->refilling_.load(std::memory_order_acquire)) {
        std::this_thread::yield();
    }
}

void AudioStreamManager::notify_consumption() {
    cv_.notify_one();
}

void AudioStreamManager::worker_loop() {
    while (!stop_.load(std::memory_order_acquire)) {
        StreamingAudioSource* target = nullptr;

        {
            std::unique_lock lock(mutex_);

            // Priority: process seek requests first
            for (auto* src : sources_) {
                if (src->has_seek_request()) {
                    target = src;
                    break;
                }
            }

            // Otherwise find hungriest source
            if (!target) {
                uint32_t lowest_fill = UINT32_MAX;
                for (auto* src : sources_) {
                    if (src->needs_refill()) {
                        // We don't have direct access to available_frames from here,
                        // so just pick the first one that needs refill.
                        // Could optimize later with fill-level comparison.
                        target = src;
                        break;
                    }
                }
            }

            if (!target) {
                // All buffers full — sleep
                cv_.wait(lock, [&] {
                    if (stop_.load(std::memory_order_relaxed)) return true;
                    for (auto* src : sources_) {
                        if (src->needs_refill() || src->has_seek_request()) return true;
                    }
                    return false;
                });
                continue;  // re-check after wake
            }
        }
        // Mutex released — decode outside critical section
        target->refill(4096);
    }
}

}  // namespace gseurat::audio
```

- [ ] **Step 5: Write the integration test**

Create `tests/test_audio_streaming.cpp`:
```cpp
// Test: StreamingAudioSource — load .ogg, play via engine, output non-zero.
#include "gseurat/engine/audio/audio_engine.hpp"
#include "streaming_audio_source.hpp"
#include "audio_stream_manager.hpp"

#include <cmath>
#include <cstdio>
#include <chrono>
#include <thread>
#include <vector>

using namespace gseurat::audio;

static int passed = 0, failed = 0;
static void check(bool c, const char* m) {
    if (c) { std::printf("  PASS: %s\n", m); ++passed; }
    else   { std::printf("  FAIL: %s\n", m); ++failed; }
}

int main() {
    std::printf("\n=== Streaming Audio Tests ===\n\n");

    const char* ogg_path = "../../tests/test_data/audio/dc_unity.ogg";

    // --- Standalone StreamingAudioSource test ---
    {
        AudioStreamManager mgr;
        auto src_r = StreamingAudioSource::create(ogg_path, 48000, 0, 0, &mgr, 44100);
        check(src_r.has_value(), "create StreamingAudioSource from .ogg");
        if (!src_r) {
            std::printf("  ERROR: failed to create streaming source\n");
            return 1;
        }
        auto& src = *src_r.value();
        check(src.format().sample_rate == 48000, "sample_rate == 48000");
        check(src.format().channels == 1, "channels == 1");

        // Let decode thread fill the ring buffer
        std::this_thread::sleep_for(std::chrono::milliseconds(100));

        // Read frames — should get non-zero data (dc_unity ≈ 0.5)
        std::vector<float> out(1024, 0.0f);
        src.read_frames(0, 1024, out);

        bool has_signal = false;
        for (float s : out) if (std::fabs(s) > 0.01f) { has_signal = true; break; }
        check(has_signal, "streaming output contains non-zero signal");

        // Approximate value check (Ogg is lossy, so not exact 0.5)
        bool approx_half = true;
        for (size_t i = 100; i < 900; ++i) {
            if (std::fabs(out[i] - 0.5f) > 0.1f) { approx_half = false; break; }
        }
        check(approx_half, "streaming output approximately 0.5 (within Vorbis tolerance)");
    }

    // --- Engine integration: load .ogg via load_track_group ---
    // This requires a music_config.json pointing to the .ogg file.
    // For now, use register_track_group_for_test with a pre-created streaming source.
    // Full engine integration is tested in Task 3.1.

    // --- SR mismatch ---
    {
        AudioStreamManager mgr;
        auto r = StreamingAudioSource::create(ogg_path, 44100, 0, 0, &mgr);
        check(!r.has_value(), "SR mismatch rejected");
    }

    std::printf("\n=== %d passed, %d failed ===\n", passed, failed);
    return failed == 0 ? 0 : 1;
}
```

- [ ] **Step 6: Register in CMakeLists.txt**

Add sources to `gseurat_core`:
```cmake
src/engine/audio/streaming_audio_source.cpp
src/engine/audio/audio_stream_manager.cpp
```

Add to `AUDIO_ENGINE_TEST_SOURCES`:
```cmake
src/engine/audio/streaming_audio_source.cpp
src/engine/audio/audio_stream_manager.cpp
```

Register tests:
```cmake
add_gseurat_test(test_audio_streaming
    ${AUDIO_ENGINE_TEST_SOURCES})
target_include_directories(test_audio_streaming PRIVATE ${PROJECT_SOURCE_DIR}/src/engine/audio)
```

- [ ] **Step 7: Build, run, verify all tests**

```bash
cmake --build --preset macos-debug -j
ctest --test-dir build/macos-debug -R test_audio --output-on-failure
```

- [ ] **Step 8: Commit**

```bash
git add src/engine/audio/streaming_audio_source.hpp \
        src/engine/audio/streaming_audio_source.cpp \
        src/engine/audio/audio_stream_manager.hpp \
        src/engine/audio/audio_stream_manager.cpp \
        tests/test_audio_streaming.cpp CMakeLists.txt
git commit -m "audio: add StreamingAudioSource + AudioStreamManager (Ogg Vorbis streaming)"
```

---

## Milestone 3 — Engine integration + demo migration

### Task 3.1: Ogg auto-detection + pass loop points to streaming

**Files:**
- Modify: `src/engine/audio/audio_engine.cpp` — extend `load_audio_source`, add `AudioStreamManager` member

- [ ] **Step 1: Add AudioStreamManager to AudioEngineImpl**

In `audio_engine.cpp`, add `#include "streaming_audio_source.hpp"` and `#include "audio_stream_manager.hpp"`.

Add `AudioStreamManager stream_manager_;` member to `AudioEngineImpl` (before `mixer_` to ensure correct destruction order — stream manager stops before mixer).

- [ ] **Step 2: Extend load_audio_source signature**

Update `load_audio_source` to accept loop points and stream manager:

```cpp
static std::expected<std::unique_ptr<IAudioSource>, LoadError>
load_audio_source(std::string_view path, uint32_t sample_rate,
                   AudioStreamManager* stream_mgr = nullptr,
                   uint64_t loop_start = 0, uint64_t loop_end = 0) {
    std::ifstream f(std::string(path), std::ios::binary);
    if (!f) return std::unexpected(LoadError::FileNotFound);
    char magic[4]{};
    f.read(magic, 4);
    f.close();

    if (magic[0] == 'G' && magic[1] == 'S' && magic[2] == 'A' && magic[3] == 'U') {
        return MmapAudioSource::from_gsaudio_file(path, sample_rate);
    }
    if (magic[0] == 'O' && magic[1] == 'g' && magic[2] == 'g' && magic[3] == 'S') {
        if (stream_mgr) {
            return StreamingAudioSource::create(path, sample_rate,
                                                 loop_start, loop_end, stream_mgr);
        }
        // Fallback: no stream manager, decode fully into memory
        return MemoryAudioSource::from_wav_file(path, sample_rate);
    }
    return MemoryAudioSource::from_wav_file(path, sample_rate);
}
```

- [ ] **Step 3: Update call sites**

In `load_track_group`, pass loop points and stream manager:
```cpp
auto src_r = load_audio_source(s.source_path, cfg.sample_rate,
                                &stream_manager_, tg.loop_start, tg.loop_end);
```

In `load_sfx`, keep simple (no streaming for SFX):
```cpp
auto src = load_audio_source(wav_path, cfg_.sample_rate);
```

- [ ] **Step 4: Verify destruction order**

In `AudioEngineImpl`, ensure member order is:
```cpp
    Config   cfg_;
    Mode     mode_;
    uint32_t channels_;
    AudioStreamManager stream_manager_;  // destroyed AFTER device stops
    Mixer    mixer_;
    std::unique_ptr<IAudioDevice> device_;
    std::vector<std::unique_ptr<IAudioSource>> sfx_registry_;
```

Destruction order (reverse of declaration): sfx_registry → device (stops audio thread) → mixer → stream_manager (joins decode thread). Safe.

**Wait** — `device_` must stop BEFORE `stream_manager_` joins, because the audio thread calls `read_frames` on streaming sources. If the audio thread is still running when `stream_manager_` joins and `remove_source` spin-waits, there's a deadlock risk. Fix: explicitly stop device in destructor before natural destruction order:

```cpp
~AudioEngineImpl() override {
    if (device_) device_->stop();  // stop audio thread first
    // stream_manager_ dtor will join decode thread
    // sources destroyed after both threads are stopped
}
```

This is already the pattern from Phase 1.5.

- [ ] **Step 5: Build + run ALL tests (debug + release)**

```bash
cmake --build --preset macos-debug -j
ctest --test-dir build/macos-debug --output-on-failure
cmake --build --preset macos-release --target gseurat_demo -j
```

- [ ] **Step 6: Commit**

```bash
git add src/engine/audio/audio_engine.cpp
git commit -m "audio: Ogg Vorbis auto-detection + AudioStreamManager in engine"
```

---

### Task 3.2: Cook demo stems to Ogg + update music_config

**Files:**
- Create: `examples/island_demo/assets/audio/field_theme/*.ogg` (4 files)
- Modify: `examples/island_demo/assets/audio/field_theme.music.json`

- [ ] **Step 1: Convert stems to Ogg Vorbis**

```bash
for f in bass_drone harmony_pad melody percussion; do
    ffmpeg -i "examples/island_demo/assets/audio/field_theme/${f}.wav" \
           -c:a libvorbis -q:a 6 \
           "examples/island_demo/assets/audio/field_theme/${f}.ogg" -y
done
```

Verify:
```bash
ls -la examples/island_demo/assets/audio/field_theme/*.ogg
```

- [ ] **Step 2: Update music_config.json**

Edit `examples/island_demo/assets/audio/field_theme.music.json` — change stem paths from `.gsaudio` to `.ogg`:
```json
"stems": [
    { "source": "assets/audio/field_theme/bass_drone.ogg",    "initial_volume": 0.8 },
    { "source": "assets/audio/field_theme/harmony_pad.ogg",   "initial_volume": 0.5 },
    { "source": "assets/audio/field_theme/melody.ogg",        "initial_volume": 0.0 },
    { "source": "assets/audio/field_theme/percussion.ogg",    "initial_volume": 0.0 }
]
```

- [ ] **Step 3: Sync assets + build release**

```bash
cmake --build --preset macos-release --target sync_assets -j
cmake --build --preset macos-release --target gseurat_demo -j
```

**CRITICAL (per feedback_verify_runtime_integration):** Verify demo runs and audio plays. Check stderr for `[IslandDemo] Field theme loaded and playing`. Test dungeon portal transition (music should muffle and continue looping). Launch from the build directory:
```bash
cd build/macos-release && ./gseurat_demo
```

- [ ] **Step 4: Full debug test suite**

```bash
ctest --test-dir build/macos-debug --output-on-failure
```

- [ ] **Step 5: Commit**

```bash
git add examples/island_demo/assets/audio/field_theme/*.ogg \
        examples/island_demo/assets/audio/field_theme.music.json
git commit -m "demo: migrate field theme stems to Ogg Vorbis (streaming)"
```

---

## Milestone 4 — Finalize + PR

- [ ] **Step 1: Full test run**

```bash
ctest --test-dir build/macos-debug --output-on-failure
```

- [ ] **Step 2: Push + PR**

```bash
git push -u origin feature/audio-phase4-streaming
gh pr create --title "Phase 4: Ogg Vorbis streaming audio" --body "$(cat <<'EOF'
## Summary

Adds streaming audio playback from compressed Ogg Vorbis files, enabling
long music tracks without full-file memory loading.

- **AudioRingBuffer** — lock-free circular float buffer with monotonic cursors
- **StreamingAudioSource** — `IAudioSource` backed by ring buffer + ma_decoder
- **AudioStreamManager** — single shared decode thread (CV wake/sleep)
- **Dual-strategy `read_frames`** — sequential = ring pop, hard seek = flush + silence + async re-decode
- **Seamless looping** — decode-side `ma_decoder_seek` at loop boundary
- **Safe removal** — per-source `refilling_` flag with bounded spin-wait
- **Format auto-detection** — `"OggS"` magic → streaming path
- **Demo migration** — field theme stems now stream from `.ogg`

### Key files

- Spec: `docs/superpowers/specs/2026-04-18-audio-phase4-streaming-design.md`
- Ring buffer: `src/engine/audio/audio_ring_buffer.hpp`
- Streaming source: `src/engine/audio/streaming_audio_source.{hpp,cpp}`
- Stream manager: `src/engine/audio/audio_stream_manager.{hpp,cpp}`
- Tests: `tests/test_audio_ring_buffer.cpp`, `tests/test_audio_streaming.cpp`

## Test plan

- [x] `ctest` — all tests pass (2 new: ring_buffer, streaming)
- [ ] Launch demo — field theme streams from .ogg
- [ ] Dungeon portal — music muffles + loops seamlessly
- [x] Release build succeeds

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Cross-cutting reminders

- **Worktree:** all work in `.worktrees/feature-audio-phase4-streaming`.
- **Fixture paths:** `../../tests/test_data/audio/` from build dir.
- **dc_unity.ogg is 48000 Hz** (matches the WAV fixture). Demo stems are **44100 Hz**.
- **`DemoApp::run()` creates AudioEngine** — verified since Phase 1.5 fix.
- **Build BOTH presets** — debug for tests, release for demo.
- **Ogg Vorbis is lossy** — streaming tests use approximate assertions, not bit-exact.
- **`stream_manager_` must be declared before `mixer_`** in `AudioEngineImpl` so it's destroyed after the mixer (reverse declaration order).
- **Explicitly stop `device_` in destructor** before natural destruction hits `stream_manager_`.
- **`AUDIO_ENGINE_TEST_SOURCES`** — add streaming source + manager `.cpp` files.
- **ma_decoder forward-declaration** in the header; full `#include <miniaudio.h>` only in the `.cpp`.

---

*End of plan.*
