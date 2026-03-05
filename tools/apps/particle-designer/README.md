# Particle Designer

Visual editor for `EmitterConfig` values with a real-time canvas simulation that mirrors the engine's particle physics. Changes apply to the running engine automatically.

## Layout

```
+-----------------------------+---------------------------+
|  Presets        [New] [Del] |                           |
|  ----------------           |   Canvas Preview          |
|  torch_ember     [active]   |   (black background)      |
|  dust_puff                  |                           |
|  magic_aura                 |   [particles simulated    |
|  rain                       |    in JS matching         |
|  snow                       |    engine behavior]       |
|  campfire                   |                           |
|  firefly                    |   FPS: 60  Count: 47/600  |
|  explosion                  |                           |
+-----------------------------+---------------------------+
|  EmitterConfig Parameters                               |
|  -------------------------------------------------------+
|  Spawn Rate     [====|----]  12.0 /s                    |
|  Lifetime Min   [=|--------]  0.4 s                    |
|  Lifetime Max   [===|------]  0.8 s                    |
|  Speed Min      [==|-------]  0.5                      |
|  Speed Max      [=====|----]  1.2                      |
|  Gravity        [---|-------] -0.1                     |
|  Spread Angle   [======|---]  360 deg                  |
|  Color Start    [swatch]                                |
|  Color End      [swatch]                                |
|  Size Start     [===|------]  0.08                     |
|  Size End       [=|--------]  0.02                     |
|  Atlas Tile     [ SoftGlow v ]                          |
|  Emitter Shape  [ Point v ]                             |
|  Burst          [ ] one-shot                            |
+-----------------------------+---------------------------+
```

## Features

### Canvas Simulation

The preview canvas runs a JavaScript particle simulation that matches the engine's `ParticleSystem` behavior:

- xorshift RNG seeded identically to the C++ implementation
- Same spawn rate, velocity distribution, and linear color/size interpolation
- Particle count displayed live; hard cap matches the engine's 600-particle pool

The camera is fixed at the emitter origin. Background is black to match the engine's dark scene default.

### EmitterConfig Parameters

All 16 fields of the C++ `EmitterConfig` struct are exposed as sliders or pickers:

| Parameter | Type | Range |
|---|---|---|
| `spawn_rate` | float | 0 – 100 /s |
| `lifetime_min` | float | 0.05 – 10 s |
| `lifetime_max` | float | 0.05 – 10 s |
| `speed_min` | float | 0 – 20 |
| `speed_max` | float | 0 – 20 |
| `gravity` | float | -10 – 10 |
| `spread_angle` | float | 0 – 360 deg |
| `color_start` | vec4 | RGBA picker |
| `color_end` | vec4 | RGBA picker |
| `size_start` | float | 0.01 – 2.0 |
| `size_end` | float | 0.01 – 2.0 |
| `atlas_tile` | enum | Circle / SoftGlow / Spark / SmokePuff / Raindrop / Snowflake |
| `emitter_shape` | enum | Point / Circle / Box |
| `emitter_radius` | float | 0 – 10 (when shape = Circle) |
| `burst_count` | int | 0 = continuous, >0 = one-shot |
| `burst_interval` | float | seconds between bursts |

### Built-In Presets

| Preset | Atlas Tile | Description |
|---|---|---|
| `torch_ember` | SoftGlow | Warm orange upward sparks with slow fade |
| `dust_puff` | SmokePuff | Gray-brown puff, triggered on footstep |
| `magic_aura` | Spark | Colored rotating sparks around NPC |
| `rain` | Raindrop | High-rate downward streaks, slight spread |
| `snow` | Snowflake | Slow drift, low gravity, gentle spread |
| `campfire` | SoftGlow | Orange-yellow rising column with smoke end color |
| `firefly` | Circle | Low spawn rate, random-walk velocity, green tint |
| `explosion` | Spark | Burst mode, high speed, wide spread, fast fade |

Selecting a preset loads its values into all sliders. Modifying any value creates an unsaved copy.

### Auto-Sync to Engine

Every parameter change sends an updated `EmitterConfig` payload to the bridge:

```json
{ "cmd": "set_emitter_config", "emitter_index": 0, "config": { ... } }
```

The emitter index corresponds to the order emitters are listed in the scene JSON. Use the emitter index selector at the top of the parameter panel to target specific emitters.

### AI Suggestions

When Ollama is available, enter a description such as "gentle blue fairy dust that drifts upward and fades" and the tool requests a suggested `EmitterConfig` JSON. The suggestion is applied as a new unsaved preset ready for manual tuning.

## Export

"Copy JSON" copies the current `EmitterConfig` as a JSON object ready to paste into the scene file's `emitters` array. "Save Preset" adds it to the local preset list stored in browser `localStorage`.
