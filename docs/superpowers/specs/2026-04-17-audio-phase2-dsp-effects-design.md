# Phase 2: DSP Effects — Design Spec

**Date:** 2026-04-17
**Status:** Design approved, ready for implementation planning
**Branch:** `feature/audio-phase2-dsp`
**Depends on:** Phase 1 (#273) + Phase 1.5 (#274), both merged

---

## 1. Purpose and scope

Add per-stem DSP effect processing to the interactive music engine via the
existing `IDSPEffect` interface prepared in Phase 1. Ships a single
`StateVariableFilter` implementation (TPT/Zavalishin SVF) supporting LPF, HPF,
and BPF modes, with RTPC binding to filter parameters for runtime control.

Primary use case: "SNES-style" muffled music when entering dungeons — sweep
the LPF cutoff from 20 kHz → 800 Hz via a single RTPC.

### In scope

- `StateVariableFilter : IDSPEffect` — Zavalishin TPT SVF with LPF/HPF/BPF mode
- Per-stem effect chain activation (`StemRuntime::effect_chain[4]`)
- 3-line insertion in `mix_chunk` (process chain between source read and gain)
- Extended `RtpcBinding` with `Target` enum (`StemVolume` / `EffectParam`)
- `bind_effect_param_to_rtpc()` public API
- `add_stem_effect()` public API (game thread, before `play_group`)
- `AudioEngine::create_svf()` factory
- Block-rate coefficient smoothing (coefficients recomputed once per `process()`)
- Software FTZ denormal protection (per-sample snap)
- Demo wiring: dungeon muffling via RTPC → 4-stem LPF cutoff
- Offline golden tests (dc_unity fixture: LPF passes DC, HPF blocks DC)

### Out of scope

- Oneshot voice DSP (no effect chain on `OneshotVoice`)
- Runtime effect chain modification (must set up before `play_group`)
- Per-sample or sub-block coefficient smoothing
- Hardware FTZ/DAZ flags (TODO for Phase 3)
- Additional effect types (reverb, delay, EQ) — future phases
- Bricklayer UI for effect configuration

---

## 2. `StateVariableFilter` implementation

### Topology-Preserving Transform (TPT) SVF

Zavalishin 2012 formulation. Numerically stable at all frequencies, no
zero-delay feedback issues.

```cpp
class StateVariableFilter final : public IDSPEffect {
public:
    enum class Type : uint8_t { LPF, HPF, BPF };

    static constexpr uint32_t kParamCutoff    = 0;  // Hz, range [20, 20000]
    static constexpr uint32_t kParamResonance = 1;  // Q,  range [0.5, 20]
    static constexpr uint32_t kParamType      = 2;  // 0=LPF, 1=HPF, 2=BPF

    StateVariableFilter(float sample_rate, Type type = Type::LPF,
                         float cutoff_hz = 20000.0f, float resonance = 0.707f);

    void process(std::span<float> inout, uint32_t channels) noexcept override;
    void set_parameter(uint32_t id, float value) noexcept override;

private:
    float sample_rate_;
    Type  type_;
    float cutoff_hz_  = 20000.0f;
    float resonance_  = 0.707f;

    // SVF coefficients (recomputed once per process() call)
    float g_ = 0.0f, k_ = 0.0f;
    float a1_ = 0.0f, a2_ = 0.0f, a3_ = 0.0f;

    // Per-channel state
    struct ChannelState { float ic1eq = 0.0f, ic2eq = 0.0f; };
    std::array<ChannelState, 2> state_{};

    void recompute_coefficients() noexcept;
};
```

### Coefficient computation

```
g  = tan(π * cutoff / sample_rate)
k  = 1 / Q
a1 = 1 / (1 + g * (g + k))
a2 = g * a1
a3 = g * a2
```

Computed once at the start of `process()`. Block-rate granularity (~21 ms at
1024-frame blocks) is sufficient for slow environmental sweeps.

### Per-sample DSP loop

```
v3 = v0 - ic2eq
v1 = a1 * ic1eq + a2 * v3
v2 = ic2eq + a2 * ic1eq + a3 * v3
ic1eq = 2 * v1 - ic1eq
ic2eq = 2 * v2 - ic2eq

LPF output = v2
HPF output = v0 - k*v1 - v2
BPF output = v1
```

Software FTZ after state update:
```
if (|ic1eq| < 1e-15) ic1eq = 0
if (|ic2eq| < 1e-15) ic2eq = 0
```

### Parameter flow

`set_parameter(id, value)` stores the raw target value. No internal slew —
smoothing is handled by the RTPC binding layer which calls `set_parameter`
with already-smoothed values. `process()` reads the stored values and
recomputes coefficients at block start.

---

## 3. Effect chain integration

### `StemRuntime` — activate the chain slot

```cpp
struct StemRuntime {
    const IAudioSource* source = nullptr;
    SlewLimiter         volume;
    IDSPEffect*         effect_chain[kMaxEffectsPerStem]{};
    uint8_t             effect_count = 0;
};
```

Effects owned by `TrackGroupRegistryEntry` (game-thread lifetime). Audio
thread sees raw pointers — same pattern as `IAudioSource*`.

### `mix_chunk` — 3 lines inserted

Between source read and gain application:

```cpp
stem.source->read_frames(g.play_cursor, chunk_frames, scratch);

// Effect chain (in-place on scratch)
for (uint8_t ei = 0; ei < stem.effect_count; ++ei) {
    if (stem.effect_chain[ei])
        stem.effect_chain[ei]->process(scratch, src_ch);
}

// Gain and sum (existing, unchanged)
```

The mixer does not know about SVF, LPF, or any specific effect type.

### Effect ownership in registry

```cpp
struct TrackGroupRegistryEntry {
    TrackGroupMetadata                          metadata;
    std::vector<std::unique_ptr<IAudioSource>>  owned_stems;
    std::vector<std::unique_ptr<IDSPEffect>>    owned_effects;  // NEW
};
```

`add_stem_effect` pushes into `owned_effects` and wires the raw pointer
into `StemRuntime::effect_chain`. Must be called before `play_group`.

---

## 4. RTPC extension

### Extended `RtpcBinding`

```cpp
struct RtpcBinding {
    enum class Target : uint8_t { StemVolume, EffectParam };
    Target   target         = Target::StemVolume;
    uint32_t group_id       = 0;
    uint32_t stem_index     = 0;
    uint32_t rtpc_id        = 0;
    float    min_out        = 0.0f;
    float    max_out        = 1.0f;
    // EffectParam only:
    uint32_t effect_index   = 0;
    uint32_t parameter_id   = 0;
};
```

### Evaluation in `Mixer::render()`

```cpp
switch (b.target) {
case RtpcBinding::Target::StemVolume:
    g->stems[b.stem_index].volume.set_target(mapped, 32);
    break;
case RtpcBinding::Target::EffectParam:
    if (b.effect_index < g->stems[b.stem_index].effect_count) {
        auto* fx = g->stems[b.stem_index].effect_chain[b.effect_index];
        if (fx) fx->set_parameter(b.parameter_id, mapped);
    }
    break;
}
```

---

## 5. Public API additions

```cpp
class AudioEngine {
public:
    // ... existing API ...

    // Add effect to a stem's chain (game thread, before play_group)
    virtual void add_stem_effect(uint32_t group_id, uint32_t stem_index,
                                  std::unique_ptr<IDSPEffect> effect) = 0;

    // Bind RTPC to an effect parameter
    virtual void bind_effect_param_to_rtpc(
        uint32_t group_id, uint32_t stem_index,
        uint32_t effect_index, uint32_t parameter_id,
        uint32_t rtpc_id, float min_out, float max_out) = 0;

    // Factory for built-in effects
    static std::unique_ptr<IDSPEffect> create_svf(
        float sample_rate,
        StateVariableFilter::Type type = StateVariableFilter::Type::LPF,
        float cutoff_hz = 20000.0f, float resonance = 0.707f);
};
```

---

## 6. Demo wiring — dungeon muffling

### Setup in `IslandDemoState::on_enter`

After `load_track_group`, add a LPF to each stem and bind all to RTPC 10:

```cpp
for (uint32_t si = 0; si < 4; ++si) {
    auto lpf = AudioEngine::create_svf(44100, StateVariableFilter::Type::LPF,
                                        20000.0f, 0.707f);
    ae->add_stem_effect(group_id, si, std::move(lpf));
    ae->bind_effect_param_to_rtpc(group_id, si, 0,
        StateVariableFilter::kParamCutoff, 10, 800.0f, 20000.0f);
}
ae->set_rtpc(10, 1.0f);  // start fully open
```

### Portal transition

```cpp
// Entering dungeon
ae->set_rtpc(10, 0.0f);  // cutoff → 800 Hz (muffled)

// Returning to overworld
ae->set_rtpc(10, 1.0f);  // cutoff → 20000 Hz (open)
```

---

## 7. Testing

### Golden tests using dc_unity fixture

| # | Test | Assertion |
|---|---|---|
| 1 | LPF passes DC | dc_unity through LPF@1kHz → output ≈ 0.5 (DC is 0 Hz, fully passed) |
| 2 | HPF blocks DC | dc_unity through HPF@5kHz → output ≈ 0 (DC fully attenuated) |
| 3 | Bypass at 20kHz | LPF@20kHz → output ≈ input (transparent) |
| 4 | RTPC → cutoff | Set RTPC to 0 (maps to 800 Hz), dc through HPF@800 → near zero |
| 5 | Denormal safety | 10s silence through filter, state stays zero |
| 6 | Effect chain | LPF then HPF on same stem, assert combined behavior |

---

## 8. Files changed

**New files:**
- `src/engine/audio/state_variable_filter.hpp`
- `src/engine/audio/state_variable_filter.cpp`
- `tests/test_audio_svf.cpp`
- `tests/test_audio_effect_chain.cpp`

**Modified files:**
- `src/engine/audio/track_group_state.hpp` — activate `effect_chain[]`
- `src/engine/audio/mixer.hpp` — extend `RtpcBinding`, add `owned_effects` to registry
- `src/engine/audio/mixer.cpp` — 3 lines in `mix_chunk`, RTPC switch
- `include/gseurat/engine/audio/audio_engine.hpp` — new API methods
- `src/engine/audio/audio_engine.cpp` — implement new methods
- `src/demo/island_demo_state.cpp` — LPF + RTPC wiring
- `CMakeLists.txt` — new sources + tests

**Unchanged:** `IDSPEffect` interface, `SlewLimiter`, `SpscRingBuffer`,
`MemoryAudioSource`, `OneshotVoice`, scene schema, Bricklayer.

---

## 9. Decision log

| # | Decision | Rationale |
|---|---|---|
| 1 | Single `StateVariableFilter` with LPF/HPF/BPF enum | SVF computes all 3 taps in one pass; zero extra cost |
| 2 | Block-rate coefficient smoothing | ~21ms granularity is sufficient for environmental sweeps; avoids per-sample trig |
| 3 | No internal slew in filter | RTPC layer already smooths; double-slewing is redundant |
| 4 | Unified `RtpcBinding::Target` enum | One binding system for volume + effect params; no parallel arrays |
| 5 | Software FTZ per-sample | Portable, deterministic; hardware FTZ deferred to Phase 3 |
| 6 | TPT/Zavalishin SVF | Numerically stable at all frequencies; industry standard |
| 7 | Effect chain set up before `play_group` | Avoids lock-free pointer swapping during audio-thread processing |
| 8 | No oneshot DSP | SFX are short; filtering adds complexity with minimal artistic value |
| 9 | `dc_unity` as filter test fixture | 0 Hz signal: LPF passes, HPF blocks — deterministic, no FFT needed |
