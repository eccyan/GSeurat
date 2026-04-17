# Interactive Music Audio Engine — Design Spec

**Date:** 2026-04-17
**Status:** Phase 1 — Design approved, ready for implementation planning
**Branch:** `feature/audio-engine-interactive-music`
**Supersedes:** `src/engine/audio_system.{hpp,cpp}` (to be deleted)

---

## 1. Purpose and scope

This spec defines the Phase 1 implementation of GSeurat's interactive music audio
engine — a stem-based, lock-free, sample-accurate runtime for vertical remixing
(per-stem volume control) and horizontal transitions (marker-aligned crossfades
between track groups).

### Phase 1 scope (locked)

| Concern | Decision |
|---|---|
| Asset format | JSON metadata + loose WAV files; **no custom binary format** |
| Format support | **WAV only, fully decoded to float PCM in memory** (no streaming, no Ogg/Opus) |
| RTPC | **Volume-only** (no DSP effects) — `IDSPEffect` interface prepared for Phase 2 |
| Scene integration | **Scene schema + `AudioZone` Game Object component** (data-driven) |
| Authoring tool | **Audio Composer UI upgrades deferred** (hand-edit `music_config.json` in Phase 1) |
| SFX | **Out of scope** — old `AudioSystem` is deleted; SFX returns in Phase 1.5 |
| Testing | **Offline render mode + deterministic golden tests** |
| Backend | miniaudio used only for device callback + WAV decode; **all interactive logic is custom C++23** |

### Non-goals (Phase 1)

- No streaming decoders, no compressed formats, no mmap binary format.
- No DSP effects (LPF, reverb, EQ) — `IDSPEffect` interface only.
- No spatial audio beyond what AABB-based zone triggering provides.
- No sample-rate conversion — stems must match engine sample rate or load fails.
- No stem unload — loaded track groups live until engine shutdown.
- No SFX (one-shot playback); deferred to Phase 1.5.
- No Audio Composer UI work (timeline editor, marker placement, waveform scrubber).
- No Game Director control-server integration tests (offline harness proves correctness).

---

## 2. Architecture overview

### Chosen shape: **flat mixer + `TrackGroupState` state machines**

Alternatives considered and rejected:
- **Node graph:** over-engineered for Phase 1 (no DSP routing needed); harder to
  golden-test; more surfaces for lock-free bugs.
- **Fixed bus architecture:** Phase 1 has no SFX and no DSP, so "bus" collapses
  to a volume knob. Can be added later by wrapping group outputs.

The flat mixer keeps the audio-thread hot path linear and data-oriented:
an array of `TrackGroupState` structs iterated per callback.

### Thread topology

```
┌─────────────────┐       SPSC command queue       ┌─────────────────┐
│  Game thread    │ ───── try_push (lock-free) ───▶│  Audio thread   │
│  (main loop)    │                                 │  (ma_device cb  │
│                 │ ─── RTPC atomic stores ────────▶│   or offline    │
│                 │                                 │   pump)         │
│                 │ ◀── atomic master clock + ─────│                 │
│                 │      active_group_bitmap        │                 │
└─────────────────┘                                 └─────────────────┘
```

- **One producer (game thread), one consumer (audio thread).** No other thread
  touches the command queue.
- **Asset loading is game-thread-only** and happens *before* any command
  references the asset. The audio thread only sees stable `const IAudioSource*`
  pointers whose lifetime outlives any referencing command (Phase 1 = engine
  lifetime).
- **No stem unload in Phase 1** — radically simplifies lifetime reasoning.

---

## 3. Module layout

```
include/gseurat/engine/audio/
  audio_engine.hpp         — public facade (replaces audio_system.hpp)
  audio_source.hpp         — IAudioSource interface
  memory_audio_source.hpp  — in-memory PCM implementation
  track_group.hpp          — TrackGroupMetadata, Marker, StemMetadata
  dsp_effect.hpp           — IDSPEffect interface (Phase 2 placeholder, zero impls)

src/engine/audio/
  audio_engine.cpp         — facade; owns device + mixer; dispatches commands
  mixer.hpp / .cpp         — audio-thread-owned flat mixer
  command_queue.hpp        — SPSC lock-free ring buffer (header-only)
  slew_limiter.hpp         — per-sample slew-rate limiter (header-only)
  track_group_state.hpp    — internal runtime state for a playing group
  memory_audio_source.cpp  — WAV decode (miniaudio) → float PCM
  metadata_loader.hpp/.cpp — music_config.json parser (nlohmann/json)
  backend/
    audio_device.hpp       — IAudioDevice interface
    miniaudio_device.cpp   — ma_device-backed real-time impl
    offline_device.cpp     — pure offline pump (no audio hardware)

tests/audio/
  CMakeLists.txt
  fixtures/
    sine_loop.wav          — 0.5s sine, integer-cycle loop boundary
    sine_loop.json         — loop_start=0, loop_end=24000
    dc_unity.wav           — constant 1.0 float — slew asserts become trivial
    three_marker_loop.json — marker-aligned transition fixture
  golden/
    loop_boundary.bin
    crossfade_1500ms.bin
  test_command_queue.cpp
  test_slew_limiter.cpp
  test_loop_boundary.cpp    — priority #1
  test_marker_transition.cpp — priority #2
  test_crossfade_curve.cpp   — priority #3
  test_rtpc_binding.cpp      — priority #5
```

**Deleted files:**
- `include/gseurat/engine/audio_system.hpp`
- `src/engine/audio_system.cpp`

---

## 4. Core types

### 4.1 `IAudioSource` — the wait-free contract

```cpp
namespace gseurat::audio {

struct AudioFormat {
    uint32_t sample_rate;
    uint8_t  channels;      // 1 or 2
};

// Audio-thread-safe: every method MUST be wait-free.
// No allocation, no syscalls, no mutex, no throwing.
class IAudioSource {
public:
    virtual ~IAudioSource() = default;
    virtual AudioFormat format() const noexcept = 0;
    virtual uint64_t    total_frames() const noexcept = 0;
    // Reads frame_count frames starting at start_frame into out.
    // out is interleaved float32; out.size() == frame_count * channels.
    virtual void read_frames(uint64_t start_frame,
                             uint32_t frame_count,
                             std::span<float> out_interleaved) const noexcept = 0;
};

} // namespace gseurat::audio
```

### 4.2 `MemoryAudioSource` — Phase 1's only implementation

```cpp
class MemoryAudioSource final : public IAudioSource {
public:
    static std::expected<std::unique_ptr<MemoryAudioSource>, LoadError>
        from_wav_file(std::string_view path, uint32_t target_sample_rate);

    AudioFormat format() const noexcept override;
    uint64_t    total_frames() const noexcept override;
    void        read_frames(uint64_t start_frame, uint32_t frame_count,
                            std::span<float> out) const noexcept override;

private:
    std::vector<float> pcm_;   // interleaved float32, always
    AudioFormat        format_;
};
```

WAV decode uses miniaudio's decoder. All formats (int16/int24/int32/float) are
converted to float32 at load. Channel count is preserved (mono or stereo).
Sample-rate mismatch fails loudly (`LoadError::SampleRateMismatch`) — no
resampler in Phase 1.

### 4.3 Metadata

```cpp
struct Marker {
    uint64_t    frame;       // sample-accurate position
    std::string name;        // debug label (optional)
};

struct StemMetadata {
    std::string source_path;     // project-root-relative
    float       initial_volume = 1.0f;
};

struct TrackGroupMetadata {
    uint32_t                  id;
    std::string               name;
    uint32_t                  sample_rate;   // all stems must match
    uint64_t                  loop_start;    // frames; 0 = start
    uint64_t                  loop_end;      // frames; 0 = no loop
    std::vector<Marker>       markers;       // strictly ascending, validated at load
    std::vector<StemMetadata> stems;
    float                     bpm = 0.0f;    // informational only
};
```

### 4.4 `IDSPEffect` — Phase 2 placeholder

```cpp
class IDSPEffect {
public:
    virtual ~IDSPEffect() = default;
    virtual void process(std::span<float> inout, uint32_t channels) noexcept = 0;
    virtual void set_parameter(uint32_t id, float value) noexcept = 0;
};
```

Zero implementations in Phase 1. Declared now so `StemRuntime` has a
`IDSPEffect* chain[K]` slot that Phase 2 fills.

### 4.5 Public engine API

```cpp
class AudioEngine {
public:
    struct Config {
        uint32_t sample_rate            = 48000;
        uint32_t buffer_frames          = 1024;
        uint32_t max_track_groups       = 32;   // loaded
        uint32_t max_active_groups      = 8;    // concurrently playing
        uint32_t command_queue_capacity = 256;  // must be power-of-two
        uint32_t rtpc_count             = 64;
    };
    enum class Mode { Realtime, Offline };

    static std::expected<std::unique_ptr<AudioEngine>, InitError>
        create(Config cfg, Mode mode);
    ~AudioEngine();

    // Asset loading (game thread, blocking I/O OK)
    std::expected<uint32_t, LoadError>
        load_track_group(std::string_view config_json_path);

    // Command API — lock-free push; no blocking, no allocation
    void play_group        (uint32_t group_id);
    void stop_group        (uint32_t group_id);
    void set_stem_volume   (uint32_t group_id, uint32_t stem_index,
                             float target, float fade_ms);
    void set_group_volume  (uint32_t group_id, float target, float fade_ms);
    void request_transition(uint32_t from_id, uint32_t to_id, float xfade_ms);
    void set_rtpc          (uint32_t rtpc_id, float value);

    // Offline mode only. Asserts mode == Offline.
    void render_offline(std::span<float> interleaved_out, uint64_t num_frames);

    // Introspection (atomic reads; game-thread-safe)
    uint64_t current_frame()           const noexcept;
    bool     is_group_playing(uint32_t) const noexcept;
    uint32_t dropped_command_count()    const noexcept;
};
```

**Error handling:**
- `std::expected` for fallible loads. No exceptions cross `.hpp` boundaries.
- Command API calls *cannot fail* at the API surface: queue-full → silently
  drop, increment `dropped_commands_`. Game thread observes the counter via
  `dropped_command_count()`.
- All audio-thread methods are `noexcept`.

---

## 5. Lock-free communication

### 5.1 SPSC ring buffer

```cpp
template <typename T, uint32_t CapacityPow2>
class SpscRingBuffer {
    static_assert((CapacityPow2 & (CapacityPow2 - 1)) == 0);
    static_assert(std::is_trivially_copyable_v<T>);

    alignas(64) std::atomic<uint32_t> head_{0};   // producer writes
    alignas(64) std::atomic<uint32_t> tail_{0};   // consumer writes
    alignas(64) std::array<T, CapacityPow2> slots_;

public:
    [[nodiscard]] bool try_push(const T& v) noexcept;  // producer
    [[nodiscard]] bool try_pop (T& out)    noexcept;  // consumer
    uint32_t approx_size() const noexcept;             // diagnostics
};
```

Standard Lamport SPSC pattern:
- Producer: load `tail` (acquire), compute new `head`, check full, store value,
  store `head` (release).
- Consumer: load `head` (acquire), check empty, load value, store `tail` (release).
- Head/tail cache-line aligned to eliminate false sharing.
- Capacity power-of-two so wrap is a mask, not modulo.

### 5.2 `AudioCommand` POD

```cpp
struct AudioCommand {
    enum class Type : uint8_t {
        PlayGroup,
        StopGroup,
        SetStemVolume,       // group_id, stem_index, value, frame_count=fade_frames
        SetGroupVolume,      // group_id, value, frame_count=fade_frames
        SetRtpc,             // stem_index=rtpc_id, value
        RequestTransition,   // group_id=from, secondary_group_id=to, frame_count=xfade_frames
    };
    Type     type;
    uint32_t group_id;
    uint32_t stem_index;              // doubles as rtpc_id for SetRtpc
    uint32_t secondary_group_id;      // only used for RequestTransition
    float    value;
    uint64_t frame_count;             // fade/xfade duration in frames (NEVER ms)
};
static_assert(std::is_trivially_copyable_v<AudioCommand>);
static_assert(sizeof(AudioCommand) <= 64);
```

**ms → frames conversion happens on the game thread** at command construction
time: `frames = ms * sample_rate / 1000`. The audio thread never handles
`float ms` — all durations are integer frames. Preserves determinism under
offline render.

### 5.3 RTPC bus — separate from the command queue

RTPC values update frequently (potentially every game frame) and would flood
the command queue. Instead:

```cpp
struct RtpcBus {
    std::array<std::atomic<float>, 64> values;
    // writer: game thread; reader: audio thread (once per callback)
    // memory_order_relaxed is sufficient — smoothed per-callback anyway
};
```

`set_rtpc()` is a single atomic store — branchless, non-queue-consuming, safe
every frame. Audio thread snapshots the bus once per callback into a local
array, then applies per-binding to slew targets.

### 5.4 Telemetry — audio-thread → game-thread

```cpp
struct EngineTelemetry {
    std::atomic<uint64_t> current_frame{0};        // master clock
    std::atomic<uint32_t> dropped_commands{0};
    std::atomic<uint64_t> active_group_bitmap{0};  // bit i = group id i playing
};
```

Only audio thread writes; game thread reads with relaxed ordering.
`is_group_playing(id)` is a bit test — wait-free, branchless.

### 5.5 Threading rules (enforced in code review)

| Rule | Enforcement |
|---|---|
| Audio thread never allocates | `IAudioSource::read_frames` contract; mixer uses fixed-size arrays |
| Audio thread never blocks | No mutex, no file I/O, no logging |
| Audio thread never throws | All methods `noexcept` |
| Asset lifetime | `IAudioSource*` outlives all referencing commands (Phase 1 = engine lifetime) |

---

## 6. Mixer hot path & state machine

### 6.1 Per-group runtime state

```cpp
struct TrackGroupState {
    enum class Status : uint8_t {
        Idle,                  // slot free
        Playing,               // active (possibly with group_volume still slewing up on fade-in)
        CrossfadingOut,        // group_volume slewing to 0 → Idle when settled
        AwaitingTransition,    // playing; transition pending at next marker
    };

    uint32_t     group_id;
    Status       status;
    uint64_t     play_cursor;       // frame within stem timeline
    uint64_t     loop_start;
    uint64_t     loop_end;          // 0 = no loop
    SlewLimiter  group_volume;
    std::array<StemRuntime, kMaxStemsPerGroup> stems;
    uint8_t      stem_count;

    // Transition scheduling
    uint32_t pending_transition_target_group;
    uint64_t pending_transition_xfade_frames;

    // Cached marker range (stable pointers into TrackGroupMetadata)
    const Marker* markers_begin;
    const Marker* markers_end;
};

struct StemRuntime {
    const IAudioSource* source;
    SlewLimiter         volume;
    // Phase 2: IDSPEffect* effect_chain[kMaxEffectsPerStem]; — unused
};
```

`kMaxStemsPerGroup = 8` (compile-time constant; trivial to raise later).

### 6.2 Slew limiter

```cpp
class SlewLimiter {
    float current_ = 1.0f;
    float target_  = 1.0f;
    float step_    = 0.0f;   // delta per frame; 0 = snapped

public:
    void set_target(float target, uint64_t fade_frames) noexcept {
        target_ = target;
        step_   = (fade_frames == 0) ? 0.0f
                : (target - current_) / static_cast<float>(fade_frames);
    }

    [[gnu::always_inline]] float tick() noexcept {
        if (step_ == 0.0f) { current_ = target_; return current_; }
        current_ += step_;
        const bool reached = (step_ > 0) ? (current_ >= target_)
                                         : (current_ <= target_);
        if (reached) { current_ = target_; step_ = 0.0f; }
        return current_;
    }

    float current()  const noexcept { return current_; }
    bool  settled()  const noexcept { return step_ == 0.0f; }
};
```

**Linear slewing** for Phase 1:
- Simplest correct implementation.
- Golden tests assert exact sample values.
- Equal-power curves can be layered in Phase 2 by pairing two linear slews
  with a cosine LUT — zero mixer change.

### 6.3 Flat mixer loop

```cpp
void Mixer::render(std::span<float> out, uint32_t frames_this_block) noexcept {
    std::fill(out.begin(), out.end(), 0.0f);

    // Bounded command drain — at most kMaxCommandsPerBlock per callback.
    AudioCommand cmd;
    for (uint32_t i = 0; i < kMaxCommandsPerBlock && commands_.try_pop(cmd); ++i) {
        apply_command(cmd);
    }

    // RTPC snapshot once per block
    std::array<float, 64> rtpc_snapshot;
    for (uint32_t i = 0; i < rtpc_count_; ++i) {
        rtpc_snapshot[i] = rtpc_bus_->values[i].load(std::memory_order_relaxed);
    }
    apply_rtpc_bindings(rtpc_snapshot);

    for (auto& g : active_groups_) {
        if (g.status == TrackGroupState::Status::Idle) continue;
        render_group(g, out, frames_this_block);
    }

    telemetry_.current_frame.fetch_add(frames_this_block, std::memory_order_relaxed);
    publish_active_group_bitmap();
}
```

`kMaxCommandsPerBlock = 32` — bounds drain so bursts can't stall rendering.
Undrained commands wait one block (~21 ms at 1024 frames / 48 kHz).

### 6.4 Zero-latency loop boundary

This is the most critical correctness code — pure integer arithmetic:

```cpp
void Mixer::render_group(TrackGroupState& g, std::span<float> out,
                         uint32_t frames_remaining) noexcept {
    uint32_t out_offset = 0;
    while (frames_remaining > 0) {
        const uint64_t frames_until_boundary = (g.loop_end > 0)
            ? (g.loop_end - g.play_cursor)
            : (g.stems[0].source->total_frames() - g.play_cursor);

        const uint32_t chunk = static_cast<uint32_t>(
            std::min<uint64_t>(frames_remaining, frames_until_boundary));

        mix_chunk(g, out, out_offset, chunk);

        out_offset       += chunk;
        frames_remaining -= chunk;
        g.play_cursor    += chunk;

        // Zero-latency loop wrap — no gap, no duplicate.
        if (g.loop_end > 0 && g.play_cursor == g.loop_end) {
            g.play_cursor = g.loop_start;
            maybe_trigger_pending_transition(g);  // loop wrap = implicit marker
        } else if (g.loop_end == 0 &&
                   g.play_cursor >= g.stems[0].source->total_frames()) {
            g.status = TrackGroupState::Status::Idle;
            return;
        }
    }
}
```

**Invariant:** `play_cursor` never exceeds `loop_end`. Chunk is capped exactly
at the boundary; next iteration resumes at `loop_start`. Sample-accurate
regardless of block-size alignment.

### 6.5 `mix_chunk` — innermost loop

```cpp
void Mixer::mix_chunk(TrackGroupState& g, std::span<float> out,
                      uint32_t out_offset, uint32_t chunk_frames) noexcept {
    const uint32_t channels = format_.channels;

    // Pre-compute per-frame group-volume array (fixes the "tick-once-per-stem" bug).
    for (uint32_t f = 0; f < chunk_frames; ++f) {
        group_volume_scratch_[f] = g.group_volume.tick();
    }

    for (uint32_t si = 0; si < g.stem_count; ++si) {
        auto& stem = g.stems[si];
        std::span<float> scratch(read_scratch_.data(), chunk_frames * channels);
        stem.source->read_frames(g.play_cursor, chunk_frames, scratch);

        for (uint32_t f = 0; f < chunk_frames; ++f) {
            const float gain = stem.volume.tick() * group_volume_scratch_[f];
            for (uint32_t c = 0; c < channels; ++c) {
                out[(out_offset + f) * channels + c] += scratch[f * channels + c] * gain;
            }
        }
    }
}
```

**Correctness note:** `group_volume` must advance once per output frame, not
once per stem per frame. We pre-compute it into a scratch array before the
stem loop. Both scratch buffers (`group_volume_scratch_` and `read_scratch_`)
are fixed-size `Mixer` members sized to `Config::buffer_frames * 2` — no
allocation on the hot path.

### 6.6 Marker-aligned transition state machine

```
                RequestTransition (queued before marker)
     Playing ─────────────────────────▶ AwaitingTransition
        ▲                                       │
        │                  render_group hits next marker
        │                         or loop wrap point
        │                                       ▼
        │                         Start crossfade:
        │                            old → CrossfadingOut (group_vol slews 1→0)
        │                            new → Playing        (group_vol slews 0→1,
        │                                                  stem vols at initial_volume)
        │                                       │
        │                         xfade_frames elapse
        └────────── CrossfadingOut ─────────▶ Idle
```

Marker lookup on the hot path — linear scan from a cached `markers_begin`:

```cpp
const Marker* next_marker_after(const TrackGroupState& g, uint64_t cursor) noexcept {
    const Marker* m = g.markers_begin;
    while (m < g.markers_end && m->frame <= cursor) ++m;
    return (m < g.markers_end) ? m : nullptr;
}
```

When `status == AwaitingTransition`, each chunk checks whether `play_cursor`
crossed a marker during rendering. If yes, **split the chunk at the marker
frame**: finish the pre-marker frames with the old group, then kick off the
crossfade at the exact marker frame.

**Loop boundary is an implicit marker:** the `loop_end → loop_start` wrap
itself triggers `maybe_trigger_pending_transition`, so "transition at end of
loop" works without an explicit marker at `loop_end`.

---

## 7. Scene integration & metadata schema

### 7.1 Extended `music_config.json` (Phase 1 hand-authored)

```jsonc
{
  "$schema": "./music_config.schema.json",
  "version": 2,
  "sample_rate": 48000,
  "track_groups": [
    {
      "id": 1,
      "name": "field_theme",
      "loop_start": 0,
      "loop_end": 1411200,
      "markers": [
        { "frame": 0,       "name": "bar_1" },
        { "frame": 352800,  "name": "bar_4" },
        { "frame": 705600,  "name": "bar_8" },
        { "frame": 1058400, "name": "bar_12" }
      ],
      "stems": [
        { "source": "assets/audio/field_theme/bass_drone.wav",  "initial_volume": 1.0 },
        { "source": "assets/audio/field_theme/harmony_pad.wav", "initial_volume": 0.8 },
        { "source": "assets/audio/field_theme/melody.wav",      "initial_volume": 0.0 },
        { "source": "assets/audio/field_theme/percussion.wav",  "initial_volume": 0.0 }
      ]
    }
  ]
}
```

**Schema rules:**
- `loop_start` / `loop_end` / `markers[].frame` are **frames** (integers),
  never seconds or ms.
- `markers` strictly ascending; duplicates rejected.
- All stems must share top-level `sample_rate`; mismatch rejected.
- `version == 2` required; version 1 (old format) rejected — hand-migrate.

The JSON schema ships at `tools/apps/audio-composer/schemas/music_config.schema.json`.
Validation also runs at engine load.

### 7.2 `scene.schema.json` extensions

```jsonc
{
  "audio": {
    "preload_track_groups": [
      "assets/audio/field_theme.music.json",
      "assets/audio/dialog_mode.music.json"
    ]
  },

  "game_objects": [
    {
      "id": "music_zone_field",
      "position": [0, 0, 0],
      "components": {
        "AudioZone": {
          "bounds": { "type": "aabb", "min": [-50, 0, -50], "max": [50, 20, 50] },
          "track_group_name": "field_theme",
          "on_enter": {
            "action": "play_or_transition",
            "xfade_ms": 1500,
            "align_to_next_marker": true
          },
          "on_exit": {
            "action": "stop",
            "fade_ms": 800
          }
        }
      }
    }
  ]
}
```

### 7.3 `AudioZoneComponent`

```cpp
struct AudioZoneComponent {
    AABB     bounds;
    uint32_t track_group_id;   // resolved at scene load
    enum class Action : uint8_t { Play, PlayOrTransition, Stop };
    Action   on_enter_action;
    Action   on_exit_action;
    float    enter_xfade_ms;
    float    exit_fade_ms;
    bool     align_to_next_marker;

    bool     player_inside = false;   // hysteresis
};

class AudioZoneSystem {
    AudioEngine* engine_;
public:
    void update(const PlayerTransform& p, std::span<AudioZoneComponent> zones);
};
```

**Reuses the existing `ProximityTrigger` AABB infrastructure** — `AudioZone` is
a thin wrapper mapping enter/exit events to `AudioEngine` commands. No new
spatial query code.

Registered via the existing `ComponentRegistry` + `SystemScheduler`.

### 7.4 Demo migration — old `AudioSystem` → new engine

- `field_theme` → a global AudioZone (full map AABB).
- Per-NPC "near NPC" states → small AudioZone around each NPC.
- `dialog_mode` → **programmatic trigger** (direct `engine->play_group()` /
  `request_transition()` from dialog open/close code). Not everything fits a
  spatial box; the C++ API supports this.

### 7.5 Bricklayer UI — minimum viable

One new panel, appears when an `AudioZone` is selected in
`ScenePropertiesPanel.tsx`:

- **Bounds:** existing AABB gizmo + `NumberInput` drag-to-scrub.
- **Track Group:** dropdown from `audio.preload_track_groups` (loads each JSON
  to show `name` field).
- **On Enter:** action dropdown, xfade slider (0–5000 ms), "align to marker" checkbox.
- **On Exit:** action dropdown, fade slider.

**No** timeline editor, waveform scrubber, marker placement UI, or multi-stem
volume preview.

### 7.6 Unchanged surfaces

- `CommandDispatcher` (control server): no new audio commands. Debug via
  offline render, not bridge.
- `scene_export.ts`: passes through new `audio` / `AudioZone` fields.
- `gseurat_engine` CMake target: gains `src/engine/audio/**`; no new
  third-party dependencies (miniaudio vendored; `nlohmann/json` already used).

---

## 8. Testing — offline render harness

### 8.1 API

```cpp
// Mode::Offline only.
void AudioEngine::render_offline(std::span<float> out, uint64_t num_frames);
```

Identical mixer body to the realtime callback, but pumped from the test
thread. No `ma_device`.

**Determinism guarantees:**
- Same command sequence + same render call pattern → bit-identical output.
- Master clock advances exactly `num_frames` per call.
- Commands pushed before `render_offline` are guaranteed drained that call
  (tests stay under 32 queued commands, trivial in practice).

### 8.2 Priority-ordered test coverage

1. **Loop boundary** — zero-latency wrap; no gap, no duplicate. Foundational.
2. **Marker-aligned transition timing** — crossfade begins exactly at marker
   frame, not block-aligned.
3. **Slew-rate limiter** — linear ramp exactly `fade_frames` long; no overshoot.
4. **Command queue overflow** — push N commands, assert dropped count matches.
5. **RTPC-to-volume binding** — atomic store → per-frame slewed gain matches
   linear interpolation.

### 8.3 Golden test pattern

```cpp
TEST_CASE("sample-accurate loop wrap — no gap, no duplicate") {
    auto engine = AudioEngine::create(
        {.sample_rate=48000, .buffer_frames=512, .max_active_groups=2},
        AudioEngine::Mode::Offline).value();
    const auto gid = engine->load_track_group(
        "tests/audio/fixtures/sine_loop.json").value();

    engine->play_group(gid);

    std::array<float, 2 * 48000> buffer{};
    const uint64_t loop_end = 24000;
    engine->render_offline({buffer.data(), loop_end * 2}, loop_end);
    engine->render_offline({buffer.data() + loop_end * 2, 2}, 1);

    REQUIRE(buffer[(loop_end - 1) * 2] == Approx(EXPECTED_LAST_FRAME));
    REQUIRE(buffer[loop_end       * 2] == Approx(EXPECTED_FIRST_FRAME));
}
```

Fixtures:
- `sine_loop.wav` — 0.5s sine, integer-cycle boundary (bit-verifiable wrap).
- `dc_unity.wav` — constant 1.0; slew assertions become trivial (output = gain).
- `three_marker_loop.json` — drives marker-transition timing tests.

Wired into the existing CI test job (see `project_ci_tests.md`); runs offline
with no audio device required — headless-CI safe.

---

## 9. Build integration

- No new third-party dependencies.
- miniaudio is already fetched via `FetchContent` at `0.11.21`.
- `nlohmann/json` is already in use for scene metadata.
- `tests/audio/CMakeLists.txt` joins the existing test-target glob; follows
  `project_ci_tests.md` conventions (each test target is standalone).

---

## 10. Future phases (for context only)

- **Phase 1.5 — SFX:** `PlayOneshot` API on the new engine; dialog blips,
  footsteps, torch crackles migrated from the deleted `AudioSystem`.
- **Phase 2 — DSP:** state-variable LPF for SNES-style aesthetic; RTPC binding
  to filter cutoff. Drops in via `IDSPEffect` / `StemRuntime::effect_chain`
  without mixer changes.
- **Phase 3 — Binary format:** `.gsaudio` mmap-ready format; new `IAudioSource`
  implementation. Mixer untouched.
- **Phase 4 — Streaming:** Ogg Vorbis / Opus via ring-buffered decoder;
  another `IAudioSource` implementation. Mixer untouched.
- **Phase 5 — Audio Composer upgrade:** timeline editor, marker placement,
  track-group organization, waveform scrubber.

---

## 11. Design decision log

| # | Decision | Rationale |
|---|---|---|
| 1 | Replace `AudioSystem`, don't run alongside | One audio system long-term; demo migration proves new engine |
| 2 | JSON + loose WAV; no binary format yet | `IAudioSource` abstraction is the right seam; binary is a Phase 3 drop-in |
| 3 | WAV-only, fully in-memory | Short stems; integer arithmetic; zero streaming complexity |
| 4 | Volume-only RTPC | Avoids per-sample smoothing + denormal hazards; DSP is Phase 2 |
| 5 | Scene schema + `AudioZone` component | Data-driven, fits existing ECS; `ProximityTrigger` reuse |
| 6 | Defer Audio Composer UI | Timeline editors are big UI work; hand-edit JSON proves engine |
| 7 | SFX out of scope; Phase 1.5 | Focus on interactive music correctness |
| 8 | Offline render golden tests | Audio engine = pure function `(cmds,time)→samples` |
| 9 | Flat mixer, not node graph | Matches Phase 1 scope; deterministic; easy to golden-test |
| 10 | Linear slew, not equal-power | Exact-sample assertions; equal-power is Phase 2 cosine LUT wrap |
| 11 | ms → frames on game thread | Audio thread stays integer-only; determinism under offline render |
| 12 | RTPC as atomic bus, not queue | Every-frame updates would flood queue |
| 13 | No stem unload in Phase 1 | Raw `const IAudioSource*` safe for engine lifetime |
| 14 | Fail loudly on sample-rate mismatch | Resampler is Phase 2 work |
