# SFX Oneshot Voice Pool — Design Spec (Phase 1.5)

**Date:** 2026-04-17
**Status:** Design approved, ready for implementation planning
**Branch:** `feature/audio-sfx-oneshot`
**Depends on:** Phase 1 interactive music engine (PR #273, merged)

---

## 1. Purpose and scope

Add fire-and-forget SFX playback and spatial looping sounds to the existing
`gseurat::audio::AudioEngine`. Restores the 5 SFX removed when the legacy
`AudioSystem` was deleted in Phase 1: footstep, dialog open/close/blip, and
torch crackle (with distance attenuation).

### In scope

- `OneshotVoice` fixed-size pool in the `Mixer` (alongside `active_groups_`)
- `load_sfx(path) → sfx_id` asset registration
- `play_oneshot(sfx_id, volume)` — fire-and-forget, auto-free on completion
- `play_looping_spatial(sfx_id, pos, max_dist, volume) → voice_handle` — looping with distance attenuation
- `stop_looping_spatial(voice_handle)` — stop a specific looping voice
- `set_listener_position(vec3)` — atomic per-frame update from game thread
- Simple linear distance attenuation: `gain = 1 - clamp(dist / max_dist, 0, 1)`
- Island demo wiring: footstep timer, dialog callbacks, torch crackle positions
- Offline golden tests for oneshot playback, auto-free, spatial attenuation

### Out of scope

- Stereo panning (all SFX are mono; spatial is volume-only)
- HRTF / advanced spatialization
- Voice stealing (pool full → reject + increment dropped counter)
- RTPC binding to oneshot voices
- Data-driven SFX triggers / new ECS components
- Bricklayer UI changes
- Scene schema changes (reuses existing `torch_audio_positions`)

---

## 2. Architecture

### Voice pool

A fixed-size array of `OneshotVoice` structs in the `Mixer`, rendered after
TrackGroups in the same `render()` call.

```cpp
struct OneshotVoice {
    const IAudioSource* source = nullptr;  // nullptr = free slot
    uint64_t play_cursor = 0;
    float    volume      = 1.0f;
    bool     looping     = false;          // true = spatial looping (no auto-free)
    bool     spatial     = false;          // true = apply distance attenuation
    glm::vec3 position{0};                 // world-space (spatial only)
    float    max_distance = 15.0f;         // attenuation range
    uint32_t generation  = 0;              // voice handle validation
};
```

- Pool size: `Config::max_oneshot_voices` (default 32).
- **Auto-free:** when `play_cursor >= source->total_frames()` and `!looping`,
  set `source = nullptr` to release the slot.
- **Pool full:** reject the command, increment `dropped_commands`. No voice
  stealing in this phase.

### Voice handles

`play_looping_spatial` returns a `uint32_t` handle encoding the pool index
and generation counter:

```cpp
// handle = (generation << 16) | index
// 16 bits for index (max 65535 voices — far more than 32)
// 16 bits for generation (wraps at 65535 — acceptable)
```

`stop_looping_spatial(handle)` extracts the index and generation, validates
against the current slot's generation, and frees the slot only if they match.
Prevents use-after-free on recycled slots.

### New `AudioCommand` types

```cpp
PlayOneshot,         // sfx_id, value=volume
PlayLoopingSpatial,  // sfx_id, value=volume, position (packed), max_distance
StopLoopingSpatial,  // group_id=voice_handle (generation + index)
```

**Position packing in `AudioCommand`:** The existing `AudioCommand` struct is
a fixed-size POD (≤64 bytes). Position needs 3 floats (12 bytes). Options:

- Extend `AudioCommand` with a `float pos[3]` field. Struct grows but stays
  within 64 bytes (current size is ~28 bytes, plenty of room).
- Reuse existing fields creatively (fragile). Prefer explicit fields.

Updated `AudioCommand`:
```cpp
struct AudioCommand {
    enum class Type : uint8_t {
        PlayGroup, StopGroup, SetStemVolume, SetGroupVolume,
        RequestTransition,
        PlayOneshot,          // NEW
        PlayLoopingSpatial,   // NEW
        StopLoopingSpatial,   // NEW
    };
    Type     type;
    uint32_t group_id;            // also: voice_handle for StopLoopingSpatial
    uint32_t stem_index;          // also: sfx_id for PlayOneshot/PlayLoopingSpatial
    uint32_t secondary_group_id;
    float    value;               // volume
    uint64_t frame_count;
    float    pos[3];              // NEW: world position for spatial commands
    float    max_distance;        // NEW: attenuation range
};
static_assert(sizeof(AudioCommand) <= 64);
```

### Listener position

Three atomic floats alongside the RTPC bus in the `Mixer`:

```cpp
struct ListenerState {
    std::atomic<float> x{0}, y{0}, z{0};
};
```

- `set_listener_position()` does 3 relaxed atomic stores (game thread, every frame).
- `Mixer::render()` snapshots once per block into a local `glm::vec3`.
- Same pattern as RTPC bus — no queue, no blocking.

### SFX registry

```cpp
// In AudioEngine (game-thread owned)
std::vector<std::unique_ptr<IAudioSource>> sfx_registry_;
```

`load_sfx(path)` decodes WAV via `MemoryAudioSource::from_wav_file`, pushes
to the vector, returns the index. Audio thread accesses the raw pointer via
`sfx_registry_[sfx_id].get()` — safe because sources outlive all commands
(no unload in Phase 1.5).

---

## 3. Mixer hot path

### Voice rendering in `Mixer::render()`

After the existing TrackGroup loop:

```cpp
// 4. Snapshot listener position (once per block)
const glm::vec3 listener = snapshot_listener_position();

// 5. Render oneshot voices
for (auto& v : oneshot_voices_) {
    if (!v.source) continue;
    render_voice(v, out, frames_this_block, listener);
}
```

### `render_voice` — straight-line, no chunk-splitting

```cpp
void Mixer::render_voice(OneshotVoice& v, std::span<float> out,
                          uint32_t frames, glm::vec3 listener) noexcept {
    const uint64_t source_len = v.source->total_frames();
    uint32_t to_render = frames;

    if (!v.looping && v.play_cursor + to_render > source_len) {
        to_render = static_cast<uint32_t>(source_len - v.play_cursor);
    }
    if (to_render == 0) {
        v.source = nullptr;  // auto-free
        return;
    }

    // Distance attenuation (spatial only, once per block)
    float spatial_gain = 1.0f;
    if (v.spatial) {
        const float dist = glm::length(listener - v.position);
        spatial_gain = 1.0f - std::clamp(dist / v.max_distance, 0.0f, 1.0f);
        if (spatial_gain <= 0.0f) {
            // Out of range — advance cursor, skip rendering
            v.play_cursor += to_render;
            if (v.looping && v.play_cursor >= source_len) v.play_cursor = 0;
            return;
        }
    }

    const float gain = v.volume * spatial_gain;
    // Read source into scratch, apply gain, sum into out
    // (same mono→stereo broadcast as TrackGroup mix_chunk)

    v.play_cursor += to_render;

    if (v.looping && v.play_cursor >= source_len) {
        v.play_cursor = 0;   // simple wrap (no chunk-split — ambient noise tolerance)
    }
    if (!v.looping && v.play_cursor >= source_len) {
        v.source = nullptr;  // auto-free
    }
}
```

**Key properties:**
- No chunk-splitting — oneshots don't need sample-accurate loop boundaries.
  Looping spatial voices (torch crackle) use a simple cursor wrap; a tiny
  discontinuity in ambient noise is inaudible.
- Spatial gain computed **once per block** (not per-sample). Player doesn't
  move measurably in ~21ms.
- **Out-of-range virtualization** — voices beyond `max_distance` advance
  their cursor but don't render. Saves CPU; stays in sync if player returns.
- Linear falloff: `1 - dist/max_dist`. Matches the old system's close-range
  behavior. Can swap to inverse-square in a future phase.

---

## 4. Public API additions

```cpp
class AudioEngine {
public:
    // ... existing Phase 1 API unchanged ...

    // SFX asset loading (game thread, blocking)
    std::expected<uint32_t, LoadError> load_sfx(std::string_view wav_path);

    // Fire-and-forget oneshot (lock-free push)
    void play_oneshot(uint32_t sfx_id, float volume = 1.0f);

    // Looping spatial sound (lock-free push; returns voice handle)
    uint32_t play_looping_spatial(uint32_t sfx_id, glm::vec3 position,
                                   float max_distance, float volume = 1.0f);
    void stop_looping_spatial(uint32_t voice_handle);

    // Listener position (atomic store, called every frame)
    void set_listener_position(glm::vec3 pos);

    // Config addition
    struct Config {
        // ... existing fields ...
        uint32_t max_oneshot_voices = 32;
    };
};
```

---

## 5. Demo wiring

### SFX loading (scene init)

```cpp
sfx_footstep_     = engine->load_sfx("assets/audio/footstep.wav").value();
sfx_dialog_open_  = engine->load_sfx("assets/audio/dialog_open.wav").value();
sfx_dialog_close_ = engine->load_sfx("assets/audio/dialog_close.wav").value();
sfx_dialog_blip_  = engine->load_sfx("assets/audio/dialog_blip.wav").value();
sfx_torch_        = engine->load_sfx("assets/audio/torch_crackle.wav").value();
```

### Torch crackle setup (after scene load)

```cpp
for (const auto& pos : scene_data.torch_audio_positions) {
    engine->play_looping_spatial(sfx_torch_, pos, 15.0f, 0.6f);
}
```

Un-orphans the existing `torch_audio_positions` scene data field.

### Listener update (per frame)

```cpp
engine->set_listener_position(player_position);
```

### Footstep trigger

```cpp
if (player_is_moving && footstep_timer_ <= 0.0f) {
    engine->play_oneshot(sfx_footstep_, 0.5f);
    footstep_timer_ = 0.35f;
}
footstep_timer_ -= dt;
```

### Dialog sounds

```cpp
engine->play_oneshot(sfx_dialog_open_, 0.7f);   // on open
engine->play_oneshot(sfx_dialog_close_, 0.7f);   // on close
engine->play_oneshot(sfx_dialog_blip_, 0.4f);    // on advance
```

### Unchanged surfaces

- `AudioZone` / `AudioZoneSystem` — untouched.
- `music_config.json` / metadata loader — untouched.
- Bricklayer — no new panels.
- Scene schema — `torch_audio_positions` already exists, no changes.

---

## 6. Testing — offline golden tests

Same pattern as Phase 1: offline render mode, deterministic assertions.

| Priority | Test | Assertion |
|---|---|---|
| 1 | Oneshot playback | play dc_unity oneshot, output ≈ 0.5 * volume |
| 2 | Auto-free | play short source, render past end, voice slot freed |
| 3 | Spatial attenuation | voice at known distance, output gain = `1 - dist/max_dist` |
| 4 | Out-of-range silence | listener far away, output is zero |
| 5 | Looping spatial | render past source length, voice keeps playing |
| 6 | Stop looping | stop via handle, voice silenced immediately |
| 7 | Pool overflow | push 33 oneshots (pool=32), dropped counter increments |

Test fixtures: reuse existing `dc_unity.wav` and `sine_loop.wav`.

---

## 7. Files changed

**New files:**
- `src/engine/audio/oneshot_voice.hpp` — `OneshotVoice` struct

**Modified files:**
- `include/gseurat/engine/audio/audio_engine.hpp` — new API methods + Config field
- `src/engine/audio/audio_engine.cpp` — `load_sfx`, `play_oneshot`, `play_looping_spatial`, `stop_looping_spatial`, `set_listener_position`
- `src/engine/audio/audio_command.hpp` — new command types + `pos[3]` / `max_distance` fields
- `src/engine/audio/mixer.hpp` — `OneshotVoice` pool, `ListenerState`, `render_voice`, SFX registry pointer
- `src/engine/audio/mixer.cpp` — voice rendering loop, `apply_command` for new types
- `src/demo/island_demo_state.cpp` — SFX load, torch setup, footstep timer, listener update
- `CMakeLists.txt` — new test registrations

**New test files:**
- `tests/test_audio_oneshot.cpp`
- `tests/test_audio_spatial.cpp`

**No changes to:**
- Scene schema, Bricklayer, AudioZone system, metadata loader, music_config format

---

## 8. Decision log

| # | Decision | Rationale |
|---|---|---|
| 1 | OneshotVoice pool, not reuse TrackGroups | SFX don't need markers, loops, RTPC, transitions. Keep active_groups slots for music. |
| 2 | Simple distance attenuation in our mixer | Maintains backend-agnostic, golden-testable principle. No miniaudio spatial delegation. |
| 3 | `load_sfx → sfx_id` explicit registry | No lazy I/O during gameplay. Predictable loading. |
| 4 | Programmatic triggers, not data-driven | Footsteps tied to animation frames, dialog to UI events. Data-driven SFX is future work. |
| 5 | Reject on pool full, not voice steal | 32 slots for 5 SFX types is ample. Overflow = bug we want to detect. |
| 6 | Linear falloff | Matches old system. Inverse-square is future work. |
| 7 | Spatial gain once per block | Player moves negligibly in ~21ms. Saves per-sample `glm::length`. |
| 8 | Voice handle = generation + index | Prevents use-after-free on recycled pool slots. |
| 9 | Listener as atomic floats, not queued | Every-frame updates would flood the command queue. |
| 10 | Simple cursor wrap for looping spatial | Ambient noise tolerates tiny discontinuity. No chunk-split needed. |
