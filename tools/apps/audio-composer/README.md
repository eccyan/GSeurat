# Audio Composer

4-layer interactive music editor for authoring the engine's `AudioSystem` music layers and `MusicState` presets. Produces WAV files and state configuration consumed directly by the game.

## Layout

```
+----------------------------------------------------------------+
|  File  Edit  Transport         [Play] [Stop]  BPM: [120]       |
+----------------------------------------------------------------+
|  t=0s          t=2s            t=4s            t=8s            |
+--- Bass Drone ------------------------------------------------- |
|  [==waveform==========================]  Vol: [====|--] 0.80   |
+--- Harmony Pad ------------------------------------------------ |
|  [==waveform===============]            Vol: [==|----] 0.50   |
+--- Melody ----------------------------------------------------- |
|  [==waveform=========]                  Vol: [=======] 0.00   |
+--- Percussion ------------------------------------------------- |
|  [==waveform=================]          Vol: [===|---] 0.00   |
+----------------------------------------------------------------+
|  MusicState Presets    |  Crossfade         |  Layer Controls  |
|  [Explore]             |  Rate: [3.0]       |  [Import WAV]    |
|  [NearNPC ]            |  (exp. decay)      |  [Export WAV]    |
|  [Dialog  ]            |                    |  [AI Generate]   |
+----------------------------------------------------------------+
```

## Features

### 4-Lane Timeline

Each lane represents one music layer. The timeline shows the waveform of the loaded WAV file for that layer. All 4 layers loop simultaneously in the engine — the timeline reflects their individual lengths.

Scrub by clicking anywhere on the timeline. All lanes play in sync.

### Waveform Visualization

WAV data is decoded client-side via the Web Audio API and rendered as a peak-normalized waveform. The playback cursor moves in real time during preview.

### MusicState Preset Editor

Three presets map to the engine's `MusicState` enum. Each preset specifies a target volume (0.0-1.0) for each of the 4 layers.

| State | Bass Drone | Harmony Pad | Melody | Percussion |
|---|---|---|---|---|
| Explore | 0.8 | 0.5 | 0.0 | 0.0 |
| NearNPC | 0.8 | 0.2 | 0.7 | 0.0 |
| Dialog | 0.4 | 0.0 | 0.0 | 0.0 |

Click any preset row to load its values into the lane volume sliders. Editing a slider updates the preset table. Changes are saved to the exported JSON.

### Crossfade Control

The crossfade rate field controls the exponential decay coefficient used by the engine:

```
current += (target - current) * (1 - exp(-rate * dt))
```

A rate of 3.0 reaches ~90% of the target volume in 0.75 seconds. Higher values are snappier; lower values are smoother.

### Web Audio Playback

Preview uses the browser's Web Audio API — no engine connection required. Each layer is an `AudioBufferSourceNode` looped independently. The volume sliders map directly to `GainNode` values, giving an accurate preview of how the engine will mix the layers.

### WAV Import and Export

Each lane has an independent Import button. Accepted formats: WAV 44100 Hz 16-bit mono (the engine's native format). Other formats are automatically converted in the browser before saving.

Clicking "Export All" writes all 4 WAV files to `assets/audio/` via the bridge REST API:

```
music_bass.wav
music_harmony.wav
music_melody.wav
music_percussion.wav
```

State preset configuration is exported as `assets/audio/music_config.json` which the engine's `AudioSystem::init()` reads on startup.

### AI Generation

When AudioCraft is running at `localhost:8001`, each lane shows an "AI Generate" button. Enter a prompt such as "dark ambient bass drone with slow LFO modulation" and AudioCraft's MusicGen model generates a short loop. The audio is returned as a WAV and loaded into the lane.

Generated clips are typically 5-30 seconds and loop seamlessly if the model is prompted accordingly.

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Space` | Play / pause |
| `S` | Stop and return to start |
| `Ctrl+S` | Save and export |
| `1` / `2` / `3` | Preview Explore / NearNPC / Dialog preset volumes |
