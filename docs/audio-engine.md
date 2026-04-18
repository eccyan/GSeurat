# Audio Engine Reference

GSeurat's audio engine is a lock-free, sample-accurate, stem-based interactive music and SFX runtime built in C++23. It replaces a previous miniaudio-based system with a custom mixer that keeps all mixing, synchronization, and state-machine logic independent of the audio backend.

## Architecture

```
Game Thread                         Audio Thread              Decode Thread
──────────────                      ────────────────────────   ──────────────────
AudioEngine API                     Mixer::render()            AudioStreamManager
  play_group(id)   ──SPSC queue──>    drain commands             worker_loop():
  set_stem_volume() ─────────────>    apply RTPC bindings          poll sources
  request_transition() ──────────>    render TrackGroups            refill ring
  play_oneshot()   ──────────────>      └─ source → fx → gain      buffers via
  set_rtpc(id,v)   ──atomic bus──>    render OneshotVoices         ma_decoder
  set_listener()   ──atomic xyz──>      └─ spatial atten.
                                      advance master clock    StreamingAudioSource
                                                               ↕ AudioRingBuffer
                                    read_frames() ◄────────── (lock-free)
```

### Threading rules

| Rule | Enforcement |
|---|---|
| Audio thread never allocates | `IAudioSource::read_frames` contract; mixer uses fixed-size arrays |
| Audio thread never blocks | No mutex, no file I/O, no logging; `try_pop` is wait-free |
| Audio thread never throws | All methods `noexcept` |
| Decode thread does I/O | Ogg decode + disk reads are fine on the background thread |
| Game→audio communication | SPSC ring buffer (commands) + atomic bus (RTPC, listener) |
| Decode→audio communication | Lock-free `AudioRingBuffer` (monotonic cursors) |
| Audio→game introspection | Atomic master clock, dropped-command counter, active-group bitmap |

## Interactive Music (TrackGroups)

Music is organized into **Track Groups** — bundles of stems (WAV or `.gsaudio` files) that share playback state.

### Features

- **Multi-stem playback** — up to 8 stems per group, mixed synchronously
- **Sample-accurate looping** — chunk-split at loop boundaries with zero-gap wrap
- **Marker-aligned transitions** — crossfade between groups at musically meaningful points
- **Vertical remixing** — per-stem volume control via RTPC for layered intensity

### Metadata format (`music_config.json`)

```json
{
  "version": 2,
  "sample_rate": 44100,
  "track_groups": [
    {
      "id": 1,
      "name": "field_theme",
      "loop_start": 0,
      "loop_end": 352800,
      "markers": [
        { "frame": 0, "name": "bar_1" },
        { "frame": 176400, "name": "bar_4" }
      ],
      "stems": [
        { "source": "assets/audio/field_theme/bass_drone.gsaudio", "initial_volume": 0.8 },
        { "source": "assets/audio/field_theme/harmony_pad.gsaudio", "initial_volume": 0.5 },
        { "source": "assets/audio/field_theme/melody.gsaudio", "initial_volume": 0.0 },
        { "source": "assets/audio/field_theme/percussion.gsaudio", "initial_volume": 0.0 }
      ]
    }
  ]
}
```

All time values are in **frames** (not seconds or milliseconds). Markers must be strictly ascending.

### C++ API

```cpp
#include "gseurat/engine/audio/audio_engine.hpp"
using namespace gseurat::audio;

// Create engine (usually done once in DemoApp::run())
auto engine = AudioEngine::create(
    {.sample_rate = 44100, .buffer_frames = 1024,
     .max_active_groups = 8, .max_oneshot_voices = 32},
    AudioEngine::Mode::Realtime).value();

// Load and play music
auto group_id = engine->load_track_group("assets/audio/field_theme.music.json").value();
engine->play_group(group_id);

// Vertical remixing — fade melody in over 2 seconds
engine->set_stem_volume(group_id, /*stem=*/2, /*target=*/1.0f, /*fade_ms=*/2000.0f);

// Transition to another group at the next marker with 1.5s crossfade
engine->request_transition(group_id, other_group_id, /*xfade_ms=*/1500.0f);
```

## SFX (Oneshot Voice Pool)

Short, fire-and-forget sounds use a separate voice pool that doesn't compete with TrackGroup slots.

```cpp
// Load SFX
auto footstep_id = engine->load_sfx("assets/audio/footstep.wav").value();

// Play oneshot
engine->play_oneshot(footstep_id, /*volume=*/0.5f);

// Looping spatial sound (e.g., torch crackle)
engine->play_looping_spatial(torch_id,
    /*pos_x=*/195.0f, /*pos_y=*/4.5f, /*pos_z=*/181.0f,
    /*max_distance=*/15.0f, /*volume=*/0.6f);

// Update listener each frame
engine->set_listener_position(player_x, player_y, player_z);
```

### Spatial attenuation

Linear distance falloff computed once per audio block:

```
gain = 1.0 - clamp(distance / max_distance, 0, 1)
```

Voices beyond `max_distance` skip rendering but advance their cursor (virtualization — they stay in sync if the player returns).

## RTPC (Real-Time Parameter Control)

Game variables can be mapped to audio parameters via an atomic bus.

```cpp
// Bind RTPC 10 to stem volume (vertical remixing)
engine->bind_stem_volume_to_rtpc(group_id, /*stem=*/2, /*rtpc_id=*/10,
    /*min_out=*/0.0f, /*max_out=*/1.0f);

// Bind RTPC 10 to effect cutoff (dungeon muffling)
engine->bind_effect_param_to_rtpc(group_id, /*stem=*/0, /*effect_index=*/0,
    /*param_id=*/StateVariableFilter::kParamCutoff,
    /*rtpc_id=*/10, /*min_out=*/800.0f, /*max_out=*/20000.0f);

// Set the value each frame from game logic (0 = muffled, 1 = open)
engine->set_rtpc(10, entering_dungeon ? 0.0f : 1.0f);
```

`set_rtpc()` is an atomic store — safe to call every frame without flooding the command queue.

## DSP Effect Chain

Each stem supports up to 4 chained `IDSPEffect` instances, processed in-place between source read and gain application.

### StateVariableFilter (built-in)

Topology-Preserving Transform (TPT) SVF supporting LPF, HPF, and BPF modes.

```cpp
// Add LPF to a stem (must be called BEFORE play_group)
engine->add_stem_effect(group_id, /*stem=*/0,
    AudioEngine::create_svf(44100, /*type=*/0, /*cutoff=*/20000.0f, /*Q=*/0.707f));
//                                   0=LPF  1=HPF  2=BPF

// Parameters bindable to RTPC:
// kParamCutoff    (0) — Hz, range [20, 20000]
// kParamResonance (1) — Q, range [0.5, 20]
// kParamType      (2) — 0=LPF, 1=HPF, 2=BPF
```

Coefficients are recomputed once per audio block (~21ms at 1024 frames / 48kHz). Software flush-to-zero protects against denormals on all platforms.

## Asset Formats

Three formats are supported, auto-detected via magic bytes in the first 4 bytes of the file:

| Format | Magic | Loading | Memory | Best for |
|---|---|---|---|---|
| WAV | `RIFF` | Full decode at load (miniaudio) | Full file in RAM | Quick iteration, small SFX |
| `.gsaudio` | `GSAU` | Memory-mapped (zero decode) | Mapped pages | Large uncompressed stems |
| Ogg Vorbis | `OggS` | Background streaming decode | ~352 KB ring buffer | Long music, disk savings |

All three can coexist freely — just change the file extension in `music_config.json`.

### WAV (legacy, still supported)

Standard PCM WAV files decoded at load time by miniaudio into float32 arrays. Fully in-memory. Supported via format auto-detection (RIFF magic).

### `.gsaudio` (fast loading)

Pre-baked binary format with raw float32 PCM. Loaded via memory-mapped file — zero decode overhead.

**Header (32 bytes, little-endian):**

```
Offset  Size  Type        Field
0       4     char[4]     magic "GSAU"
4       4     uint32_le   version (1)
8       4     uint32_le   sample_rate
12      1     uint8       channels (1 or 2)
13      3     uint8[3]    reserved
16      8     uint64_le   frame_count
24      8     uint8[8]    reserved
32+     N     float32[]   interleaved PCM payload
```

**Python cooker:**

```bash
# Convert single file
python3 tools/scripts/wav_to_gsaudio.py input.wav -o output.gsaudio

# Batch convert
python3 tools/scripts/wav_to_gsaudio.py assets/audio/*.wav --output-dir assets/audio/
```

Format auto-detection reads the first 4 bytes: `GSAU` magic → mmap path, `RIFF` magic → WAV decode.

### Ogg Vorbis (streaming, smallest on disk)

Compressed audio streamed from disk in real-time. A background decode thread (`AudioStreamManager`) incrementally decodes Ogg Vorbis into a lock-free ring buffer; the audio thread reads from the ring buffer via `read_frames` — transparent to the mixer.

**Conversion:**

```bash
# Using oggenc (brew install vorbis-tools)
oggenc input.wav -o output.ogg -q 6
```

**Disk savings:**

| Format | 8s stereo stem | 4 stems |
|---|---|---|
| WAV / `.gsaudio` | 2.8 MB | 11.2 MB |
| Ogg Vorbis | ~35-70 KB | ~140-280 KB |

**Streaming architecture:**

```
AudioStreamManager (decode thread)
  └─ polls active StreamingAudioSources
     └─ ma_decoder_read_pcm_frames → AudioRingBuffer
                                         ↓ (lock-free)
                                    Audio thread reads via read_frames()
```

- **Seamless looping** — decode thread seeks decoder to `loop_start` when reaching `loop_end`; the 1-second ring buffer absorbs the ~1ms seek latency
- **Hard seek support** — if `start_frame` doesn't match the expected cursor, the ring buffer is flushed, silence is emitted for one block (~21ms), and the decode thread seeks asynchronously
- **Safe removal** — per-source `refilling_` atomic flag with bounded spin-wait prevents use-after-free during source destruction

## Scene Integration

### AudioZone component

Music can be triggered by spatial zones in the scene:

```json
{
  "audio": {
    "preload_track_groups": ["assets/audio/field_theme.music.json"]
  },
  "game_objects": [
    {
      "id": "music_zone",
      "components": {
        "AudioZone": {
          "bounds": { "type": "aabb", "min": [-200, -10, -200], "max": [200, 50, 200] },
          "track_group_name": "field_theme",
          "on_enter": { "action": "play", "xfade_ms": 1500, "align_to_next_marker": true },
          "on_exit": { "action": "stop", "fade_ms": 800 }
        }
      }
    }
  ]
}
```

### torch_audio_positions

Spatial looping SFX (torch crackle) are positioned via the `torch_audio_positions` array in the scene JSON:

```json
{
  "torch_audio_positions": [
    [195.0, 4.5, 181.0],
    [185.0, 3.5, 173.0]
  ]
}
```

## Offline Testing

The engine supports `Mode::Offline` for deterministic golden tests — no audio device needed.

```cpp
auto engine = AudioEngine::create(config, AudioEngine::Mode::Offline).value();
engine->load_track_group("test_fixture.json");
engine->play_group(1);

std::vector<float> output(1024 * 2);
engine->render_offline(output, 1024);  // pump mixer manually
// Assert sample values...
```

All golden tests run in CI without audio hardware.

## File Layout

```
include/gseurat/engine/audio/
  audio_engine.hpp          — public facade
  audio_source.hpp          — IAudioSource interface
  memory_audio_source.hpp   — in-memory PCM (WAV decode)
  mmap_audio_source.hpp     — mmap-backed PCM (.gsaudio)
  track_group.hpp           — metadata types
  dsp_effect.hpp            — IDSPEffect interface

include/gseurat/platform/
  memory_mapped_file.hpp    — cross-platform RAII mmap

src/engine/audio/
  audio_engine.cpp          — facade + format auto-detection (WAV/GSAU/OggS)
  mixer.{hpp,cpp}           — audio-thread mixer (TrackGroups + voices)
  command_queue.hpp         — SPSC lock-free ring buffer (commands)
  audio_ring_buffer.hpp     — lock-free PCM ring buffer (streaming)
  slew_limiter.hpp          — per-frame linear ramp
  state_variable_filter.{hpp,cpp} — TPT SVF (LPF/HPF/BPF)
  memory_audio_source.cpp   — WAV decode via miniaudio (in-memory)
  mmap_audio_source.cpp     — .gsaudio mmap loader (zero-decode)
  streaming_audio_source.{hpp,cpp} — Ogg Vorbis streaming via ring buffer
  audio_stream_manager.{hpp,cpp}   — background decode thread
  metadata_loader.{hpp,cpp} — music_config.json parser
  backend/
    miniaudio_device.{hpp,cpp} — realtime device callback

tools/scripts/
  wav_to_gsaudio.py         — WAV → .gsaudio cooker

schemas/
  music_config.schema.json  — JSON schema for music_config.json
```

## Weaver (Authoring Tool)

Weaver is a web-based visual editor for composing `music_config.json` v2 files. It replaces the legacy Audio Composer.

- **Project-based workflow** — `.weaver` project files separate editor state from runtime `music_config.json`
- **Multi-track management** — multiple TrackGroups per project, one loaded in memory at a time
- **Visual timeline** — canvas waveforms, draggable loop handles, markers, per-stem mute/solo
- **Staging integration** — "Open in Staging" pushes music to the running engine via bridge

See [Weaver documentation](docs/weaver.md) for details.

```bash
cd tools && pnpm --filter weaver dev  # http://localhost:5182
```

## Bridge Commands (audio)

| Command | Parameters | Description |
|---------|-----------|-------------|
| `reload_music_config` | `path` (relative) | Load a music_config.json and play the first group |
| `set_feature` | `name: "music"`, `enabled` | Toggle music playback on/off |

The `reload_music_config` command resolves stem paths via `resolve_asset_path()` (requires `set_project_root` to be called first).

## Design Specs

- [Phase 1: Interactive Music](docs/superpowers/specs/2026-04-17-audio-engine-interactive-music-design.md)
- [Phase 1.5: SFX Oneshot](docs/superpowers/specs/2026-04-17-audio-sfx-oneshot-design.md)
- [Phase 2: DSP Effects](docs/superpowers/specs/2026-04-17-audio-phase2-dsp-effects-design.md)
- [Phase 3: Mmap Asset Pipeline](docs/superpowers/specs/2026-04-17-audio-phase3-mmap-design.md)
- [Phase 4: Ogg Vorbis Streaming](docs/superpowers/specs/2026-04-18-audio-phase4-streaming-design.md)
- [Phase 5: Weaver](docs/superpowers/specs/2026-04-18-audio-phase5-weaver-design.md)
- [Phase 6: Multi-Track Management](docs/superpowers/specs/2026-04-18-audio-phase6-multitrack-design.md)
