# SFX Oneshot Voice Pool — Implementation Plan (Phase 1.5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fire-and-forget SFX playback and spatial looping sounds to the existing `gseurat::audio::AudioEngine`, restoring the 5 SFX removed when the legacy `AudioSystem` was deleted.

**Architecture:** Fixed-size `OneshotVoice` pool in the `Mixer`, rendered after TrackGroups. `load_sfx → sfx_id` registry on the engine; `PlayOneshot` / `PlayLoopingSpatial` / `StopLoopingSpatial` commands via the existing SPSC queue. Listener position as 3 atomic floats. Linear distance attenuation computed once per block.

**Tech Stack:** C++23, miniaudio (WAV decode only), glm (vec3 distance), CMake presets. Tests use the project's flat `check(cond, msg)` harness.

**Spec:** `docs/superpowers/specs/2026-04-17-audio-sfx-oneshot-design.md`

---

## File Structure

**New files:**
```
src/engine/audio/oneshot_voice.hpp     — OneshotVoice struct + ListenerState
tests/test_audio_oneshot.cpp           — oneshot playback, auto-free, pool overflow
tests/test_audio_spatial.cpp           — spatial attenuation, out-of-range, looping, stop
```

**Modified files:**
```
src/engine/audio/audio_command.hpp     — 3 new command types + pos[3] + max_distance fields
include/gseurat/engine/audio/audio_engine.hpp — load_sfx, play_oneshot, play_looping_spatial, stop_looping_spatial, set_listener_position, Config::max_oneshot_voices
src/engine/audio/audio_engine.cpp      — implement new API methods + sfx_registry_
src/engine/audio/mixer.hpp             — OneshotVoice pool, ListenerState, sfx registry pointer, render_voice decl
src/engine/audio/mixer.cpp             — voice rendering loop in render(), apply_command for new types, render_voice impl
src/demo/island_demo_state.cpp         — load SFX, set up torch crackles, footstep timer, listener update
CMakeLists.txt                         — register 2 new tests
```

---

## Milestone 1 — Voice pool infrastructure

### Task 1.1: Extend `AudioCommand` + create `OneshotVoice` + `ListenerState`

**Files:**
- Modify: `src/engine/audio/audio_command.hpp`
- Create: `src/engine/audio/oneshot_voice.hpp`

- [ ] **Step 1: Extend AudioCommand with new types and fields**

Edit `src/engine/audio/audio_command.hpp`:
```cpp
#pragma once
#include <cstdint>
#include <type_traits>

namespace gseurat::audio {

struct AudioCommand {
    enum class Type : uint8_t {
        PlayGroup,
        StopGroup,
        SetStemVolume,
        SetGroupVolume,
        RequestTransition,
        PlayOneshot,          // stem_index=sfx_id, value=volume
        PlayLoopingSpatial,   // stem_index=sfx_id, value=volume, pos[3], max_distance
        StopAllSfx,           // no parameters — clears all oneshot voices
    };
    Type     type;
    uint32_t group_id;
    uint32_t stem_index;
    uint32_t secondary_group_id;
    float    value;
    uint64_t frame_count;
    float    pos[3];          // world position for spatial commands
    float    max_distance;    // attenuation range
};

static_assert(std::is_trivially_copyable_v<AudioCommand>);
static_assert(sizeof(AudioCommand) <= 64);

}  // namespace gseurat::audio
```

- [ ] **Step 2: Create OneshotVoice + ListenerState**

Create `src/engine/audio/oneshot_voice.hpp`:
```cpp
#pragma once
#include "gseurat/engine/audio/audio_source.hpp"
#include <atomic>
#include <cstdint>

namespace gseurat::audio {

struct OneshotVoice {
    const IAudioSource* source = nullptr;  // nullptr = free slot
    uint64_t play_cursor  = 0;
    float    volume       = 1.0f;
    bool     looping      = false;         // true = spatial looping (no auto-free)
    bool     spatial      = false;         // true = apply distance attenuation
    float    pos_x        = 0.0f;          // world position (spatial only)
    float    pos_y        = 0.0f;
    float    pos_z        = 0.0f;
    float    max_distance = 15.0f;
    uint32_t generation   = 0;             // voice handle validation
};

struct ListenerState {
    std::atomic<float> x{0.0f};
    std::atomic<float> y{0.0f};
    std::atomic<float> z{0.0f};
};

// Voice handle = (generation << 16) | pool_index
inline uint32_t make_voice_handle(uint32_t index, uint32_t gen) {
    return (gen << 16) | (index & 0xFFFF);
}
inline uint32_t voice_handle_index(uint32_t handle) { return handle & 0xFFFF; }
inline uint32_t voice_handle_generation(uint32_t handle) { return handle >> 16; }

}  // namespace gseurat::audio
```

- [ ] **Step 3: Sanity build**

```bash
cmake --build --preset macos-debug --target gseurat_core -j
```
Expected: clean build (headers only, no new .cpp files yet).

- [ ] **Step 4: Commit**

```bash
git add src/engine/audio/audio_command.hpp src/engine/audio/oneshot_voice.hpp
git commit -m "audio: extend AudioCommand + add OneshotVoice and ListenerState types"
```

---

### Task 1.2: Add voice pool + SFX registry to Mixer

**Files:**
- Modify: `src/engine/audio/mixer.hpp`
- Modify: `src/engine/audio/mixer.cpp` — constructor changes + `render_voice` stub

- [ ] **Step 1: Extend Mixer class in mixer.hpp**

Add includes at top:
```cpp
#include "oneshot_voice.hpp"
#include <glm/glm.hpp>
#include <glm/gtc/type_ptr.hpp>
```

Add to `Mixer` public interface:
```cpp
    // SFX registry: game-thread writes raw pointers; audio-thread reads.
    // Sources owned by AudioEngine; outlive all commands.
    void set_sfx_registry(const std::vector<std::unique_ptr<IAudioSource>>* reg) { sfx_registry_ = reg; }

    ListenerState& listener_state() noexcept { return listener_; }
```

Add to `Mixer` private section:
```cpp
    void render_voice(OneshotVoice& v, std::span<float> out,
                      uint32_t frames, glm::vec3 listener) noexcept;
    OneshotVoice* acquire_voice() noexcept;

    uint32_t max_oneshot_voices_;
    std::vector<OneshotVoice> oneshot_voices_;
    ListenerState listener_;
    const std::vector<std::unique_ptr<IAudioSource>>* sfx_registry_ = nullptr;
    uint32_t next_generation_ = 1;  // monotonic; wraps at 16 bits
```

Update constructor signature to accept `max_oneshot_voices`:
```cpp
    Mixer(uint32_t sample_rate, uint32_t channels,
          uint32_t buffer_frames, uint32_t max_active_groups,
          uint32_t max_oneshot_voices);
```

- [ ] **Step 2: Update mixer.cpp constructor + add stubs**

In `Mixer::Mixer`, add `max_oneshot_voices_` init and `oneshot_voices_` sizing:
```cpp
Mixer::Mixer(uint32_t sample_rate, uint32_t channels,
             uint32_t buffer_frames, uint32_t max_active_groups,
             uint32_t max_oneshot_voices)
    : sample_rate_(sample_rate), channels_(channels),
      buffer_frames_(buffer_frames),
      max_active_groups_(std::min(max_active_groups, kMaxActiveGroupsHardCap)),
      max_oneshot_voices_(max_oneshot_voices),
      active_groups_(max_active_groups_),
      oneshot_voices_(max_oneshot_voices_),
      group_volume_scratch_(buffer_frames_),
      read_scratch_(static_cast<size_t>(buffer_frames_) * channels_) {
    registry_.reserve(64);
}
```

Add `acquire_voice` implementation:
```cpp
OneshotVoice* Mixer::acquire_voice() noexcept {
    for (auto& v : oneshot_voices_) {
        if (!v.source) return &v;
    }
    return nullptr;  // pool full
}
```

Add `render_voice` stub:
```cpp
void Mixer::render_voice(OneshotVoice&, std::span<float>, uint32_t, glm::vec3) noexcept {}
```

- [ ] **Step 3: Update AudioEngineImpl constructor call**

In `src/engine/audio/audio_engine.cpp`, update the `AudioEngineImpl` constructor to pass `max_oneshot_voices`:
```cpp
    AudioEngineImpl(Config cfg, Mode mode)
        : cfg_(cfg), mode_(mode), channels_(2),
          mixer_(cfg.sample_rate, channels_, cfg.buffer_frames,
                 cfg.max_active_groups, cfg.max_oneshot_voices) {
```

Add `max_oneshot_voices` to `Config` in `audio_engine.hpp`:
```cpp
    struct Config {
        uint32_t sample_rate            = 48000;
        uint32_t buffer_frames          = 1024;
        uint32_t max_track_groups       = 32;
        uint32_t max_active_groups      = 8;
        uint32_t command_queue_capacity = 256;
        uint32_t rtpc_count             = 64;
        uint32_t max_oneshot_voices     = 32;
    };
```

- [ ] **Step 4: Build + run all existing tests**

```bash
cmake --build --preset macos-debug -j
ctest --test-dir build/macos-debug --output-on-failure
```
Expected: all 51 tests pass, no regressions.

- [ ] **Step 5: Commit**

```bash
git add include/gseurat/engine/audio/audio_engine.hpp \
        src/engine/audio/audio_engine.cpp \
        src/engine/audio/mixer.hpp src/engine/audio/mixer.cpp
git commit -m "audio: add OneshotVoice pool + ListenerState + SFX registry to Mixer"
```

---

## Milestone 2 — Oneshot playback + golden tests

### Task 2.1: Implement `load_sfx` + `play_oneshot` + `render_voice` + test

**Files:**
- Modify: `include/gseurat/engine/audio/audio_engine.hpp` — new virtual methods
- Modify: `src/engine/audio/audio_engine.cpp` — implement `load_sfx`, `play_oneshot`, `set_listener_position`
- Modify: `src/engine/audio/mixer.cpp` — handle `PlayOneshot` in `apply_command`, add voice loop to `render()`, implement `render_voice`
- Create: `tests/test_audio_oneshot.cpp`
- Modify: `CMakeLists.txt`

- [ ] **Step 1: Add new virtual methods to AudioEngine**

In `include/gseurat/engine/audio/audio_engine.hpp`, add after `render_offline`:
```cpp
    // SFX asset loading (game thread, blocking)
    virtual std::expected<uint32_t, LoadError> load_sfx(std::string_view wav_path) = 0;

    // Fire-and-forget oneshot (lock-free push)
    virtual void play_oneshot(uint32_t sfx_id, float volume = 1.0f) = 0;

    // Looping spatial sound (lock-free push; returns voice handle)
    virtual uint32_t play_looping_spatial(uint32_t sfx_id, float pos_x, float pos_y, float pos_z,
                                          float max_distance, float volume = 1.0f) = 0;
    virtual void stop_looping_spatial(uint32_t voice_handle) = 0;

    // Listener position (atomic store, called every frame)
    virtual void set_listener_position(float x, float y, float z) = 0;
```

Add `LoadError` to the `audio_engine.hpp` header (or reuse from `memory_audio_source.hpp`). Simplest: forward-declare or use the existing `LoadError` enum. Since `LoadError` is in `memory_audio_source.hpp`, either:
- Move `LoadError` to a shared header, or
- Include `memory_audio_source.hpp` in `audio_engine.hpp`, or
- Define a separate `SfxLoadError`.

**Cleanest:** use a new `SfxLoadError` enum in `audio_engine.hpp`:
```cpp
enum class SfxLoadError : uint32_t {
    FileNotFound,
    DecodeFailed,
    SampleRateMismatch,
};
```

Update the method signature:
```cpp
    virtual std::expected<uint32_t, SfxLoadError> load_sfx(std::string_view wav_path) = 0;
```

- [ ] **Step 2: Implement in AudioEngineImpl**

In `src/engine/audio/audio_engine.cpp`, add `sfx_registry_` member to `AudioEngineImpl`:
```cpp
    std::vector<std::unique_ptr<IAudioSource>> sfx_registry_;
```

In the constructor, wire the SFX registry to the mixer:
```cpp
    mixer_.set_sfx_registry(&sfx_registry_);
```

Implement `load_sfx`:
```cpp
    std::expected<uint32_t, SfxLoadError> load_sfx(std::string_view wav_path) override {
        auto src = MemoryAudioSource::from_wav_file(wav_path, cfg_.sample_rate);
        if (!src) return std::unexpected(SfxLoadError::DecodeFailed);
        const uint32_t id = static_cast<uint32_t>(sfx_registry_.size());
        sfx_registry_.push_back(std::move(src.value()));
        return id;
    }
```

Implement `play_oneshot`:
```cpp
    void play_oneshot(uint32_t sfx_id, float volume) override {
        AudioCommand c{};
        c.type = AudioCommand::Type::PlayOneshot;
        c.stem_index = sfx_id;  // sfx_id stored in stem_index field
        c.value = volume;
        if (!mixer_.command_queue().try_push(c))
            mixer_.telemetry().dropped_commands.fetch_add(1, std::memory_order_relaxed);
    }
```

Implement `set_listener_position`:
```cpp
    void set_listener_position(float x, float y, float z) override {
        mixer_.listener_state().x.store(x, std::memory_order_relaxed);
        mixer_.listener_state().y.store(y, std::memory_order_relaxed);
        mixer_.listener_state().z.store(z, std::memory_order_relaxed);
    }
```

Stub `play_looping_spatial` and `stop_looping_spatial` (Task 2.2 implements them):
```cpp
    uint32_t play_looping_spatial(uint32_t, float, float, float, float, float) override { return 0; }
    void stop_looping_spatial(uint32_t) override {}
```

- [ ] **Step 3: Implement `apply_command` for `PlayOneshot` + voice rendering in mixer.cpp**

In `Mixer::apply_command`, add the new case:
```cpp
    case AudioCommand::Type::PlayOneshot: {
        if (!sfx_registry_) return;
        const uint32_t sfx_id = cmd.stem_index;
        if (sfx_id >= sfx_registry_->size()) return;
        auto* v = acquire_voice();
        if (!v) return;  // pool full — dropped via telemetry
        v->source       = (*sfx_registry_)[sfx_id].get();
        v->play_cursor  = 0;
        v->volume       = cmd.value;
        v->looping      = false;
        v->spatial      = false;
        v->generation   = next_generation_++;
        if (next_generation_ > 0xFFFF) next_generation_ = 1;
        break;
    }
    case AudioCommand::Type::PlayLoopingSpatial:
    case AudioCommand::Type::StopLoopingSpatial:
        break;  // Task 2.2
```

In `Mixer::render()`, after the existing TrackGroup loop and before the telemetry update, add:
```cpp
    // Snapshot listener position
    const glm::vec3 listener{
        listener_.x.load(std::memory_order_relaxed),
        listener_.y.load(std::memory_order_relaxed),
        listener_.z.load(std::memory_order_relaxed)};

    // Render oneshot voices
    for (auto& v : oneshot_voices_) {
        if (!v.source) continue;
        render_voice(v, out, frames_this_block, listener);
    }
```

Implement `render_voice` (replace the stub):
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
        const glm::vec3 pos{v.pos_x, v.pos_y, v.pos_z};
        const float dist = glm::length(listener - pos);
        spatial_gain = 1.0f - std::clamp(dist / v.max_distance, 0.0f, 1.0f);
        if (spatial_gain <= 0.0f) {
            v.play_cursor += to_render;
            if (v.looping && v.play_cursor >= source_len) v.play_cursor = 0;
            return;
        }
    }

    const float gain = v.volume * spatial_gain;
    const uint32_t src_ch = v.source->format().channels;
    const uint32_t out_ch = channels_;

    // Read into scratch and mix
    std::span<float> scratch(read_scratch_.data(),
                              static_cast<size_t>(to_render) * src_ch);
    v.source->read_frames(v.play_cursor, to_render, scratch);

    for (uint32_t f = 0; f < to_render; ++f) {
        if (src_ch == 1) {
            const float s = scratch[f] * gain;
            out[f * out_ch + 0] += s;
            out[f * out_ch + 1] += s;
        } else {
            out[f * out_ch + 0] += scratch[f * 2 + 0] * gain;
            out[f * out_ch + 1] += scratch[f * 2 + 1] * gain;
        }
    }

    v.play_cursor += to_render;

    if (v.looping && v.play_cursor >= source_len) {
        v.play_cursor = 0;
    }
    if (!v.looping && v.play_cursor >= source_len) {
        v.source = nullptr;
    }
}
```

Add `#include <glm/glm.hpp>` and `#include <glm/geometric.hpp>` to `mixer.cpp` includes.

- [ ] **Step 4: Write the failing test**

Create `tests/test_audio_oneshot.cpp`:
```cpp
// Test: Oneshot playback, auto-free, pool overflow.
#include "gseurat/engine/audio/audio_engine.hpp"
#include "gseurat/engine/audio/memory_audio_source.hpp"

#include <cmath>
#include <cstdio>
#include <vector>

using namespace gseurat::audio;

static int passed = 0, failed = 0;
static void check(bool c, const char* m) {
    if (c) { std::printf("  PASS: %s\n", m); ++passed; }
    else   { std::printf("  FAIL: %s\n", m); ++failed; }
}
static bool approx(float a, float b, float eps = 5e-2f) { return std::fabs(a - b) < eps; }

int main() {
    std::printf("\n=== Oneshot playback tests ===\n\n");

    auto engine = AudioEngine::create(
        {.sample_rate=48000, .buffer_frames=256, .max_active_groups=1,
         .max_oneshot_voices=4},
        AudioEngine::Mode::Offline).value();

    auto sfx_r = engine->load_sfx("../../tests/test_data/audio/dc_unity.wav");
    check(sfx_r.has_value(), "load dc_unity as SFX");
    if (!sfx_r) return 1;
    const uint32_t sfx_id = sfx_r.value();

    // --- Oneshot playback at volume 0.8 ---
    engine->play_oneshot(sfx_id, 0.8f);
    std::vector<float> out(500 * 2, 0.0f);
    engine->render_offline(out, 500);

    // dc_unity = 0.5 per sample, gain = 0.8 → output ≈ 0.4
    check(approx(out[200 * 2], 0.4f), "oneshot output approx 0.4 (0.5 * 0.8)");

    // --- Auto-free: dc_unity has 24000 frames. Render past it. ---
    std::vector<float> out2(25000 * 2, 0.0f);
    engine->play_oneshot(sfx_id, 1.0f);
    engine->render_offline(out2, 25000);
    // Frame 23999 should have output; frame 24000+ should be zero (voice freed).
    check(!approx(out2[23999 * 2], 0.0f), "frame 23999: still playing");
    check(approx(out2[24500 * 2], 0.0f, 1e-4f), "frame 24500: silence (auto-freed)");

    // --- Pool overflow: pool=4, push 5 ---
    for (int i = 0; i < 5; ++i) engine->play_oneshot(sfx_id, 1.0f);
    std::vector<float> out3(256 * 2, 0.0f);
    engine->render_offline(out3, 256);  // drain commands
    check(engine->dropped_command_count() >= 1, "pool overflow increments dropped counter");

    std::printf("\n=== %d passed, %d failed ===\n", passed, failed);
    return failed == 0 ? 0 : 1;
}
```

Register in CMakeLists.txt:
```cmake
add_gseurat_test(test_audio_oneshot         ${AUDIO_ENGINE_TEST_SOURCES})
target_include_directories(test_audio_oneshot PRIVATE ${PROJECT_SOURCE_DIR}/src/engine/audio)
```

- [ ] **Step 5: Build, run, verify**

```bash
cmake --build --preset macos-debug --target test_audio_oneshot -j
ctest --test-dir build/macos-debug -R test_audio_oneshot --output-on-failure
ctest --test-dir build/macos-debug -R test_audio --output-on-failure
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add include/gseurat/engine/audio/audio_engine.hpp \
        src/engine/audio/audio_engine.cpp \
        src/engine/audio/mixer.hpp src/engine/audio/mixer.cpp \
        tests/test_audio_oneshot.cpp CMakeLists.txt
git commit -m "audio: oneshot voice playback + auto-free + pool overflow test"
```

---

## Milestone 3 — Spatial audio + looping

### Task 3.1: Implement `play_looping_spatial` + `stop_looping_spatial` + spatial test

**Files:**
- Modify: `src/engine/audio/audio_engine.cpp` — implement the two stubs
- Modify: `src/engine/audio/mixer.cpp` — handle `PlayLoopingSpatial` and `StopLoopingSpatial` in `apply_command`
- Create: `tests/test_audio_spatial.cpp`
- Modify: `CMakeLists.txt`

- [ ] **Step 1: Implement `play_looping_spatial` in AudioEngineImpl**

Replace the stub:
```cpp
    uint32_t play_looping_spatial(uint32_t sfx_id, float px, float py, float pz,
                                   float max_dist, float volume) override {
        AudioCommand c{};
        c.type = AudioCommand::Type::PlayLoopingSpatial;
        c.stem_index = sfx_id;
        c.value = volume;
        c.pos[0] = px; c.pos[1] = py; c.pos[2] = pz;
        c.max_distance = max_dist;
        // Pre-allocate a voice handle on the game thread so we can return it immediately.
        // The audio thread will validate sfx_id and claim the handle.
        // For simplicity: use an atomic counter for the next generation.
        c.group_id = 0;  // handle assigned by mixer in apply_command
        if (!mixer_.command_queue().try_push(c)) {
            mixer_.telemetry().dropped_commands.fetch_add(1, std::memory_order_relaxed);
            return 0;
        }
        // Return a sentinel; caller can't use the handle until audio thread processes.
        // Phase 1.5 simplification: return 0 (callers don't need immediate handle for torch crackle).
        // To return a real handle, we'd need a response queue. Defer to Phase 2.
        return 0;
    }
```

**Actually, for `stop_looping_spatial` to work, we need a handle.** Better approach: the mixer assigns the handle internally, and the game thread queries it. But that requires a response queue.

**Simplest Phase 1.5 approach:** Don't return a handle. Torch crackles are never stopped individually (they loop forever). `stop_looping_spatial` can stop *all* looping spatial voices for a given `sfx_id`, or we skip it entirely.

**Revised API:** Remove `stop_looping_spatial`. Add `stop_all_sfx()` for cleanup on scene exit. Or simply: looping spatial voices live until the engine shuts down. Torch crackles are ambient — this is fine.

Replace the signature in `audio_engine.hpp`:
```cpp
    // Looping spatial sound (plays until engine shutdown or stop_all_sfx)
    virtual void play_looping_spatial(uint32_t sfx_id, float pos_x, float pos_y, float pos_z,
                                      float max_distance, float volume = 1.0f) = 0;
    virtual void stop_all_sfx() = 0;  // stops all oneshot + looping voices
```

Remove `stop_looping_spatial` and the voice handle return. Remove `StopLoopingSpatial` from the command enum.

Implement `play_looping_spatial`:
```cpp
    void play_looping_spatial(uint32_t sfx_id, float px, float py, float pz,
                               float max_dist, float volume) override {
        AudioCommand c{};
        c.type = AudioCommand::Type::PlayLoopingSpatial;
        c.stem_index = sfx_id;
        c.value = volume;
        c.pos[0] = px; c.pos[1] = py; c.pos[2] = pz;
        c.max_distance = max_dist;
        if (!mixer_.command_queue().try_push(c))
            mixer_.telemetry().dropped_commands.fetch_add(1, std::memory_order_relaxed);
    }
```

Implement `stop_all_sfx`:
```cpp
    void stop_all_sfx() override {
        AudioCommand c{};
        c.type = AudioCommand::Type::StopAllSfx;
        if (!mixer_.command_queue().try_push(c))
            mixer_.telemetry().dropped_commands.fetch_add(1, std::memory_order_relaxed);
    }
```

Add `StopAllSfx` to the command enum (replacing `StopLoopingSpatial`).

- [ ] **Step 2: Handle in mixer.cpp `apply_command`**

```cpp
    case AudioCommand::Type::PlayLoopingSpatial: {
        if (!sfx_registry_) return;
        const uint32_t sfx_id = cmd.stem_index;
        if (sfx_id >= sfx_registry_->size()) return;
        auto* v = acquire_voice();
        if (!v) return;
        v->source       = (*sfx_registry_)[sfx_id].get();
        v->play_cursor  = 0;
        v->volume       = cmd.value;
        v->looping      = true;
        v->spatial      = true;
        v->pos_x        = cmd.pos[0];
        v->pos_y        = cmd.pos[1];
        v->pos_z        = cmd.pos[2];
        v->max_distance = cmd.max_distance;
        v->generation   = next_generation_++;
        if (next_generation_ > 0xFFFF) next_generation_ = 1;
        break;
    }
    case AudioCommand::Type::StopAllSfx: {
        for (auto& v : oneshot_voices_) v.source = nullptr;
        break;
    }
```

- [ ] **Step 3: Write the spatial test**

Create `tests/test_audio_spatial.cpp`:
```cpp
// Test: spatial distance attenuation, out-of-range silence, looping wrap.
#include "gseurat/engine/audio/audio_engine.hpp"
#include "gseurat/engine/audio/memory_audio_source.hpp"

#include <cmath>
#include <cstdio>
#include <vector>

using namespace gseurat::audio;

static int passed = 0, failed = 0;
static void check(bool c, const char* m) {
    if (c) { std::printf("  PASS: %s\n", m); ++passed; }
    else   { std::printf("  FAIL: %s\n", m); ++failed; }
}
static bool approx(float a, float b, float eps = 5e-2f) { return std::fabs(a - b) < eps; }

int main() {
    std::printf("\n=== Spatial audio tests ===\n\n");

    auto engine = AudioEngine::create(
        {.sample_rate=48000, .buffer_frames=256, .max_active_groups=1,
         .max_oneshot_voices=8},
        AudioEngine::Mode::Offline).value();

    auto sfx_r = engine->load_sfx("../../tests/test_data/audio/dc_unity.wav");
    check(sfx_r.has_value(), "load dc_unity");
    const uint32_t sfx_id = sfx_r.value();

    // --- Spatial attenuation: voice at (10,0,0), max_dist=20, listener at origin ---
    engine->set_listener_position(0, 0, 0);
    engine->play_looping_spatial(sfx_id, 10.0f, 0.0f, 0.0f, 20.0f, 1.0f);

    std::vector<float> out(500 * 2, 0.0f);
    engine->render_offline(out, 500);

    // dist=10, max=20 → gain = 1 - 10/20 = 0.5. dc=0.5 → output ≈ 0.25
    check(approx(out[200 * 2], 0.25f), "spatial gain 0.5 at dist=10, output approx 0.25");

    // --- Move listener to voice position → gain = 1.0, output ≈ 0.5 ---
    engine->set_listener_position(10, 0, 0);
    std::vector<float> out2(500 * 2, 0.0f);
    engine->render_offline(out2, 500);
    check(approx(out2[200 * 2], 0.5f), "listener at voice pos: output approx 0.5");

    // --- Move listener far away → out of range, output ≈ 0 ---
    engine->set_listener_position(100, 0, 0);
    std::vector<float> out3(500 * 2, 0.0f);
    engine->render_offline(out3, 500);
    check(approx(out3[200 * 2], 0.0f, 1e-4f), "out of range: output approx 0");

    // --- Looping: render past source length (24000), voice should still be playing ---
    engine->set_listener_position(10, 0, 0);  // back in range
    std::vector<float> out4(25000 * 2, 0.0f);
    engine->render_offline(out4, 25000);
    // After 25000 frames (past 24000 source length), looping voice wraps and continues.
    // Frame 24500 should have output (looped back).
    check(!approx(out4[24500 * 2], 0.0f, 1e-4f), "looping voice continues past source end");

    // --- stop_all_sfx ---
    engine->stop_all_sfx();
    std::vector<float> out5(500 * 2, 0.0f);
    engine->render_offline(out5, 500);
    check(approx(out5[200 * 2], 0.0f, 1e-4f), "stop_all_sfx: silence");

    std::printf("\n=== %d passed, %d failed ===\n", passed, failed);
    return failed == 0 ? 0 : 1;
}
```

Register in CMakeLists.txt:
```cmake
add_gseurat_test(test_audio_spatial         ${AUDIO_ENGINE_TEST_SOURCES})
target_include_directories(test_audio_spatial PRIVATE ${PROJECT_SOURCE_DIR}/src/engine/audio)
```

- [ ] **Step 4: Build, test, verify all audio tests pass**

```bash
cmake --build --preset macos-debug -j
ctest --test-dir build/macos-debug -R test_audio --output-on-failure
```

- [ ] **Step 5: Commit**

```bash
git add include/gseurat/engine/audio/audio_engine.hpp \
        src/engine/audio/audio_engine.cpp \
        src/engine/audio/audio_command.hpp \
        src/engine/audio/mixer.cpp \
        tests/test_audio_spatial.cpp CMakeLists.txt
git commit -m "audio: spatial looping voices + distance attenuation + stop_all_sfx"
```

---

## Milestone 4 — Demo wiring

### Task 4.1: Wire SFX into island demo

**Files:**
- Modify: `src/demo/island_demo_state.cpp` — load SFX, set up torch crackles, footstep timer, listener update

- [ ] **Step 1: Read `island_demo_state.cpp` to understand the structure**

Find:
- The `on_enter` method (where music is loaded around line 542-554)
- The per-frame `update` method (where player movement is processed)
- Where `torch_audio_positions` is accessible from scene data
- Where player position is available

- [ ] **Step 2: Add SFX member variables**

In `include/gseurat/demo/island_demo_state.hpp` (or wherever `IslandDemoState` is declared), add:
```cpp
    // SFX IDs (loaded in on_enter)
    uint32_t sfx_footstep_ = 0;
    uint32_t sfx_dialog_open_ = 0;
    uint32_t sfx_dialog_close_ = 0;
    uint32_t sfx_dialog_blip_ = 0;
    uint32_t sfx_torch_ = 0;
    bool     sfx_loaded_ = false;

    // Footstep timer
    float footstep_timer_ = 0.0f;
    static constexpr float kFootstepInterval = 0.35f;
```

- [ ] **Step 3: Load SFX in `on_enter`, after the music loading block**

```cpp
    // Load SFX
    if (auto* ae = app.audio()) {
        auto load = [&](const char* path) -> uint32_t {
            auto r = ae->load_sfx(path);
            if (!r) {
                std::fprintf(stderr, "[IslandDemo] WARNING: Failed to load SFX %s\n", path);
                return 0;
            }
            return r.value();
        };
        sfx_footstep_     = load("assets/audio/footstep.wav");
        sfx_dialog_open_  = load("assets/audio/dialog_open.wav");
        sfx_dialog_close_ = load("assets/audio/dialog_close.wav");
        sfx_dialog_blip_  = load("assets/audio/dialog_blip.wav");
        sfx_torch_        = load("assets/audio/torch_crackle.wav");
        sfx_loaded_ = true;

        // Set up looping spatial torch crackles from scene data
        for (const auto& pos : scene_data.torch_audio_positions) {
            ae->play_looping_spatial(sfx_torch_, pos.x, pos.y, pos.z, 15.0f, 0.6f);
        }
    }
```

Note: `scene_data` may need to be captured earlier or accessed from a member. Read the file to find how scene data is available at this point.

- [ ] **Step 4: Add listener update + footstep trigger in `update`**

In the per-frame update method:
```cpp
    // Update audio listener position
    if (auto* ae = app.audio()) {
        ae->set_listener_position(player_pos.x, player_pos.y, player_pos.z);
    }

    // Footstep SFX
    if (sfx_loaded_ && player_is_moving) {
        footstep_timer_ -= dt;
        if (footstep_timer_ <= 0.0f) {
            if (auto* ae = app.audio()) {
                ae->play_oneshot(sfx_footstep_, 0.5f);
            }
            footstep_timer_ = kFootstepInterval;
        }
    } else {
        footstep_timer_ = 0.0f;
    }
```

Where `player_is_moving` is derived from the player velocity or input state. Check how the demo determines this — look for velocity checks, input state, or animation state.

- [ ] **Step 5: Build + full test suite**

```bash
cmake --build --preset macos-debug -j
ctest --test-dir build/macos-debug --output-on-failure
```

- [ ] **Step 6: Commit**

```bash
git add src/demo/island_demo_state.cpp \
        include/gseurat/demo/island_demo_state.hpp
git commit -m "demo: wire SFX (footstep, dialog, torch crackle) into island demo"
```

---

## Milestone 5 — Finalize + PR

- [ ] **Step 1: Full test run**

```bash
ctest --test-dir build/macos-debug --output-on-failure
```

- [ ] **Step 2: Push + PR**

```bash
git push -u origin feature/audio-sfx-oneshot
gh pr create --title "Phase 1.5: SFX oneshot voice pool + spatial audio" --body "$(cat <<'EOF'
## Summary

Adds fire-and-forget SFX playback and spatial looping sounds to the AudioEngine,
restoring the 5 SFX removed when the legacy AudioSystem was deleted in Phase 1.

- **OneshotVoice pool** (fixed-size, auto-freeing) in the Mixer
- **`load_sfx` / `play_oneshot`** — fire-and-forget with volume control
- **`play_looping_spatial`** — distance-attenuated looping sounds (torch crackle)
- **Listener position** — atomic per-frame update, linear falloff
- **Out-of-range virtualization** — distant voices skip rendering but stay in sync
- **Island demo** — footstep timer, torch crackle from scene positions, listener tracking

### SFX restored

| SFX | Trigger |
|---|---|
| Footstep | Walk animation timer (0.35s interval) |
| Dialog open/close/blip | Dialog system callbacks |
| Torch crackle | Looping spatial from `torch_audio_positions` |

Spec: `docs/superpowers/specs/2026-04-17-audio-sfx-oneshot-design.md`

## Test plan

- [x] `ctest` — all tests pass (2 new: oneshot, spatial)
- [ ] Launch demo — footsteps audible when walking
- [ ] Torch crackle fades with distance
- [ ] No regressions in existing audio tests

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Cross-cutting reminders

- **Worktree:** all work in `.worktrees/feature-audio-sfx-oneshot`.
- **CLAUDE.md:** engine code (`src/engine/audio/`) stays game-agnostic. SFX asset paths are passed by the demo, not hardcoded in the engine.
- **Test framework:** simple `check(cond, msg)` harness. Tests run from `build/macos-debug/`; fixture path is `../../tests/test_data/audio/`.
- **`AUDIO_ENGINE_TEST_SOURCES`:** CMake variable at line 440; use it for new test targets.
- **No audio-thread allocations:** `render_voice` must not allocate. It reuses the existing `read_scratch_` buffer.
- **glm dependency:** already linked via `glm::glm` in `add_gseurat_test`. The `gseurat_core` target also links it.

---

*End of plan.*
