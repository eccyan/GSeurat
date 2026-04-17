# Phase 4: Ogg Vorbis Streaming — Design Spec

**Date:** 2026-04-18
**Status:** Design approved, ready for implementation planning
**Branch:** `feature/audio-phase4-streaming`
**Depends on:** Phases 1–3 (#273, #274, #275, #276), all merged

---

## 1. Purpose and scope

Add streaming audio playback from compressed Ogg Vorbis files via a new
`StreamingAudioSource : IAudioSource`. A dedicated background decode thread
(`AudioStreamManager`) incrementally decodes Ogg Vorbis into a lock-free PCM
ring buffer. The audio thread reads from the ring buffer — same `read_frames`
contract as in-memory and mmap sources. Mixer unchanged.

### In scope

- `AudioRingBuffer` — lock-free circular float buffer with monotonic cursors
- `StreamingAudioSource : IAudioSource` — ring-buffered decode with dual-strategy read
- `AudioStreamManager` — single shared decode thread (CV wake/sleep, priority seeks)
- Ogg Vorbis decode via miniaudio's bundled `ma_decoder` (stb_vorbis backend)
- Format auto-detection: `"OggS"` magic → streaming path
- Seamless looping via decode-thread `ma_decoder_seek_to_pcm_frame(loop_start)`
- Hard seek support (flush ring → silence → async re-decode)
- Safe source removal (per-source `refilling_` flag + bounded spin-wait)
- Island demo migration: field theme stems → `.ogg`
- Golden tests (ring buffer unit test + streaming pipeline test)

### Out of scope

- Opus codec (future extension — same architecture, different `ma_decoder` config)
- Streaming for SFX (oneshots stay in-memory)
- Custom Ogg encoder/cooker (use `ffmpeg` to produce `.ogg` files)
- Per-sample crossfade at loop boundaries in streaming (ambient noise tolerance)
- Bricklayer / Audio Composer UI changes

---

## 2. `AudioRingBuffer` — lock-free circular float buffer

```cpp
class AudioRingBuffer {
    std::vector<float>        buffer_;
    std::atomic<uint64_t>     read_pos_{0};   // monotonic frames consumed
    std::atomic<uint64_t>     write_pos_{0};  // monotonic frames produced
    uint32_t                  channels_;
    uint32_t                  capacity_frames_;  // power-of-two

public:
    AudioRingBuffer(uint32_t capacity_frames, uint32_t channels);

    uint32_t write(const float* data, uint32_t frames) noexcept;
    uint32_t read(float* out, uint32_t frames) noexcept;

    uint32_t available_frames() const noexcept;
    uint32_t free_frames() const noexcept;
    void flush() noexcept;  // reset cursors (hard seek)
};
```

- **Monotonic cursors** — never wrap; index via `pos & (capacity - 1)`
- **Wrap-around** — two `memcpy` calls if read/write spans the buffer end
- **Default capacity** — 44100 frames (~1 second stereo = ~352 KB)
- **Power-of-two** capacity for mask-based indexing

---

## 3. `StreamingAudioSource`

```cpp
class StreamingAudioSource final : public IAudioSource {
public:
    static std::expected<std::unique_ptr<StreamingAudioSource>, LoadError>
        create(std::string_view path, uint32_t sample_rate,
               uint64_t loop_start, uint64_t loop_end,
               AudioStreamManager* manager,
               uint32_t ring_capacity_frames = 44100);

    AudioFormat format() const noexcept override;
    uint64_t total_frames() const noexcept override;
    void read_frames(uint64_t start_frame, uint32_t frame_count,
                     std::span<float> out) const noexcept override;

    // Decode thread interface
    void refill(uint32_t max_frames);
    bool needs_refill() const noexcept;  // below 50% capacity
    bool has_seek_request() const noexcept;
    void process_seek_request();

private:
    AudioRingBuffer              ring_;
    ma_decoder                   decoder_;
    AudioFormat                  format_;
    uint64_t                     total_frames_;

    uint64_t                     loop_start_;
    uint64_t                     loop_end_;
    uint64_t                     decode_cursor_;

    mutable std::atomic<uint64_t> expected_read_cursor_{0};
    mutable std::atomic<int64_t>  seek_request_{-1};
    std::atomic<bool>             refilling_{false};

    AudioStreamManager*           manager_;  // for notify_consumption
};
```

### `read_frames` — dual strategy

```
Sequential (hot path):
  start_frame == expected_read_cursor_ →
    pop frames from ring buffer
    if underrun: zero-fill remainder
    advance expected_read_cursor_
    notify manager (wake decode thread if needed)

Hard seek (cold path):
  start_frame != expected_read_cursor_ →
    flush ring buffer
    set seek_request_ = start_frame
    output silence (zeros)
    set expected_read_cursor_ = start_frame + frame_count
    notify manager
```

### Decode-thread `refill`

```
if has_seek_request:
    process_seek_request  → ma_decoder_seek + reset decode_cursor
    return

decode up to min(max_frames, frames_until_loop_end) from ma_decoder
write decoded frames into ring buffer
advance decode_cursor

if decode_cursor == loop_end:
    ma_decoder_seek_to_pcm_frame(loop_start)
    decode_cursor = loop_start
```

---

## 4. `AudioStreamManager` — decode thread

```cpp
class AudioStreamManager {
public:
    AudioStreamManager();
    ~AudioStreamManager();

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
```

### Worker loop

```
while (!stop_) {
    lock mutex
    process seek requests (highest priority)
    find hungriest source (needs_refill)
    if found:
        unlock mutex  // release during I/O
        source->refill(4096)
    else:
        cv_.wait until stop_ or any source needs refill
}
```

### Safe removal

```cpp
void AudioStreamManager::remove_source(StreamingAudioSource* src) {
    { lock_guard lock(mutex_);
      std::erase(sources_, src); }
    // Spin-wait for in-flight refill (bounded ~1-2ms)
    while (src->refilling_.load(std::memory_order_acquire))
        std::this_thread::yield();
}
```

Per-source `refilling_` flag avoids shared_ptr overhead. The spin is bounded
because `refill` decodes at most 4096 frames (~1-2ms).

---

## 5. Format auto-detection

Extend the existing `load_audio_source` helper in `audio_engine.cpp`:

```cpp
if (magic == "GSAU") → MmapAudioSource
if (magic == "OggS") → StreamingAudioSource::create(path, sr, loop_start, loop_end, &stream_manager_)
if (magic == "RIFF") → MemoryAudioSource (WAV)
```

**Important:** `load_audio_source` needs loop points for streaming sources.
Currently, `load_track_group` calls `load_audio_source` per-stem inside a
loop over `cfg.track_groups[].stems[]`. The loop points come from the
`TrackGroupMetadata`. Pass them through:

```cpp
load_audio_source(s.source_path, cfg.sample_rate,
                   &stream_manager_, tg.loop_start, tg.loop_end);
```

For `load_sfx`, loop points are 0/0 (no loop, no streaming — Ogg SFX would
stream but that's fine; auto-detection handles it transparently).

---

## 6. Engine ownership + destruction order

```
AudioEngineImpl owns:
  1. AudioStreamManager stream_manager_   (decode thread)
  2. Mixer mixer_                         (audio-thread state)
  3. std::vector<...> sfx_registry_       (SFX sources)
  4. IAudioDevice device_                 (miniaudio callback)

Destruction order:
  1. device_->stop()          — audio thread stops
  2. stream_manager_ dtor     — joins decode thread
  3. registry/sfx destroyed   — sources freed (ring buffers freed)
  4. mixer_ dtor              — state freed
```

Safe because: audio thread is stopped before decode thread is stopped,
decode thread is stopped before sources are destroyed.

---

## 7. Testing

| # | Test | Assertion |
|---|---|---|
| 1 | `AudioRingBuffer` write/read | round-trip data matches |
| 2 | `AudioRingBuffer` wrap-around | data correct across boundary |
| 3 | `AudioRingBuffer` overflow | excess writes return 0 (non-blocking) |
| 4 | `AudioRingBuffer` flush | cursors reset, available = 0 |
| 5 | Streaming pipeline | load `.ogg`, play, render, output non-zero |
| 6 | Streaming loop | render past source length, still playing |
| 7 | Hard seek | change start_frame mid-stream, brief silence then resumes |

### Test fixtures

- `tests/test_data/audio/dc_unity.ogg` — generated via `ffmpeg -i dc_unity.wav -c:a libvorbis -q:a 5`
- Committed to repo; no CI ffmpeg dependency

**Note:** Ogg Vorbis is lossy — round-trip WAV→Ogg→decode won't be
bit-identical to the original WAV. Streaming tests assert **approximate**
values (within Vorbis quantization tolerance), not exact matches.

---

## 8. Files

**New:**
- `src/engine/audio/audio_ring_buffer.hpp` — lock-free PCM ring
- `src/engine/audio/streaming_audio_source.hpp` — streaming source header
- `src/engine/audio/streaming_audio_source.cpp` — ring + decoder + seek
- `src/engine/audio/audio_stream_manager.hpp` — decode thread header
- `src/engine/audio/audio_stream_manager.cpp` — worker loop
- `tests/test_audio_ring_buffer.cpp`
- `tests/test_audio_streaming.cpp`
- `tests/test_data/audio/dc_unity.ogg`

**Modified:**
- `src/engine/audio/audio_engine.cpp` — `AudioStreamManager` member, Ogg auto-detection
- `examples/island_demo/assets/audio/field_theme.music.json` — `.ogg` paths
- `examples/island_demo/assets/audio/field_theme/` — add `.ogg` stems
- `CMakeLists.txt` — new sources + tests

**Unchanged:** `IAudioSource`, `MemoryAudioSource`, `MmapAudioSource`, mixer,
RTPC, effect chain, `OneshotVoice`, `AudioZone`, Bricklayer.

---

## 9. Decision log

| # | Decision | Rationale |
|---|---|---|
| 1 | Single shared decode thread, not per-source | Avoids thread bloat for 4-stem music; follows `AsyncLoader` pattern |
| 2 | Contiguous circular ring buffer | Industry standard for audio streaming; cache-friendly, simple wrap |
| 3 | Monotonic cursors with mask indexing | Never-wrapping cursors simplify available/free calculations |
| 4 | Dual-strategy `read_frames` | Sequential = ring pop (hot), mismatch = flush + silence + seek (cold) |
| 5 | Decode-thread loop handling | Transparent seek at `loop_end`; 1-second ring absorbs ~1ms seek latency |
| 6 | Per-source `refilling_` flag | Safe removal without shared_ptr; bounded spin-wait (~1-2ms) |
| 7 | `"OggS"` magic auto-detection | Transparent — mixer doesn't know source is streaming |
| 8 | No streaming for SFX | Oneshots are short; in-memory loading is sufficient |
| 9 | ffmpeg for Ogg fixture, not custom encoder | Committed to repo; no CI dependency |
| 10 | Approximate assertions for Ogg tests | Lossy codec; can't bit-match like WAV/.gsaudio |
