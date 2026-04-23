# Island Demo Feature Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire KCC collision showcase, cinematic camera rail, and audio stem-layer fading into the island demo as a seamless exploration path.

**Architecture:** Three features compose along a single exploration path: static primitive colliders near the dungeon portal (pure scene data), a cinematic_rail CameraVolume on the bridge (pure scene data), and an AudioZoneComponent extension for per-stem fading (~20 lines C++). All inter-system communication is spatial polling only.

**Tech Stack:** C++23, nlohmann/json, GLM, miniaudio (AudioEngine), custom test framework (pass/fail counters)

**Spec:** `docs/superpowers/specs/2026-04-23-island-demo-feature-integration-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `include/gseurat/engine/components/audio_zone_component.hpp` | Modify | Add `StemFadeAction` struct + two new vectors |
| `src/engine/systems/audio_zone_system.cpp` | Modify | Dispatch `set_stem_volume()` on enter/exit |
| `tests/test_audio_zone_system.cpp` | Modify | Add stem fade tests |
| `examples/island_demo/assets/audio/island_demo.music.json` | Modify | Add vista_strings stem |
| `examples/island_demo/assets/scenes/seurat_island.json` | Modify | Add 8 collider game objects + bridge CameraVolume + bridge CameraRail + bridge AudioZone |
| `schemas/scene.schema.json` | Modify | Add stem_fade_on_enter/exit to AudioZoneComponent schema |

---

### Task 1: Extend AudioZoneComponent with StemFadeAction

**Files:**
- Modify: `include/gseurat/engine/components/audio_zone_component.hpp`
- Test: `tests/test_audio_zone_system.cpp`

- [ ] **Step 1: Write the failing test for stem fade on enter**

Add to `tests/test_audio_zone_system.cpp` — append before the final printf summary:

```cpp
    // --- Stem fade tests ---
    std::printf("\n--- Stem fade on enter/exit ---\n");

    // Reset zone state
    zone.player_inside = false;

    // Configure stem fade actions
    zone.stem_fade_on_enter.push_back({1, 0, 1.0f, 1500.0f});
    zone.stem_fade_on_exit.push_back({1, 0, 0.0f, 1500.0f});

    // Move inside -> stem fade should fire
    sys.tick({5, 5, 5}, {&zone, 1});
    engine->render_offline(out, 256);
    check(engine->is_group_playing(1), "stem fade: group playing after enter");

    // Move outside -> stem fade exit should fire
    sys.tick({-5, 0, 0}, {&zone, 1});
    engine->render_offline(out, 256);
    // The stem fade exit command was dispatched (set_stem_volume called)
    // We verify no crash and group was stopped via normal exit action
    check(!engine->is_group_playing(1), "stem fade: group stopped after exit");

    // Clean up stem actions for subsequent tests
    zone.stem_fade_on_enter.clear();
    zone.stem_fade_on_exit.clear();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cmake --build --preset macos-debug --target test_audio_zone_system && ./build/macos-debug/test_audio_zone_system`
Expected: FAIL — `stem_fade_on_enter` and `stem_fade_on_exit` are not members of `AudioZoneComponent`

- [ ] **Step 3: Add StemFadeAction struct and fields to AudioZoneComponent**

In `include/gseurat/engine/components/audio_zone_component.hpp`, add after the existing includes:

```cpp
#include <vector>
```

Then add the struct before `AudioZoneComponent` and new fields inside it:

```cpp
struct StemFadeAction {
    uint32_t group_id = 0;
    uint32_t stem_index = 0;
    float    target_volume = 0.0f;
    float    fade_ms = 0.0f;
};

struct AudioZoneComponent {
    glm::vec3 bounds_min{0};
    glm::vec3 bounds_max{0};
    uint32_t  track_group_id = 0;

    enum class Action : uint8_t { Play, PlayOrTransition, Stop };
    Action action_on_enter = Action::Play;
    Action action_on_exit  = Action::Stop;
    float  enter_xfade_ms  = 1000.0f;
    float  exit_fade_ms    = 500.0f;
    bool   align_to_next_marker = true;

    std::vector<StemFadeAction> stem_fade_on_enter;
    std::vector<StemFadeAction> stem_fade_on_exit;

    bool   player_inside = false;  // hysteresis
};
```

- [ ] **Step 4: Extend AudioZoneSystem::tick() with stem fade dispatch**

In `src/engine/systems/audio_zone_system.cpp`, add stem fade dispatch inside the enter block (after the existing switch) and exit block (after the existing switch):

```cpp
void AudioZoneSystem::tick(glm::vec3 player_pos, std::span<AudioZoneComponent> zones) {
    if (!engine_) return;
    for (auto& z : zones) {
        const bool now_in = inside_aabb(player_pos, z.bounds_min, z.bounds_max);
        if (now_in && !z.player_inside) {
            // Enter
            switch (z.action_on_enter) {
            case AudioZoneComponent::Action::Play:
                engine_->play_group(z.track_group_id);
                break;
            case AudioZoneComponent::Action::PlayOrTransition:
                engine_->play_group(z.track_group_id);
                break;
            case AudioZoneComponent::Action::Stop:
                engine_->stop_group(z.track_group_id);
                break;
            }
            for (const auto& a : z.stem_fade_on_enter) {
                engine_->set_stem_volume(a.group_id, a.stem_index,
                                         a.target_volume, a.fade_ms);
            }
        } else if (!now_in && z.player_inside) {
            // Exit
            for (const auto& a : z.stem_fade_on_exit) {
                engine_->set_stem_volume(a.group_id, a.stem_index,
                                         a.target_volume, a.fade_ms);
            }
            switch (z.action_on_exit) {
            case AudioZoneComponent::Action::Stop:
                if (z.exit_fade_ms > 0) {
                    engine_->set_group_volume(z.track_group_id, 0.0f, z.exit_fade_ms);
                }
                engine_->stop_group(z.track_group_id);
                break;
            case AudioZoneComponent::Action::Play:
            case AudioZoneComponent::Action::PlayOrTransition:
                break;
            }
        }
        z.player_inside = now_in;
    }
}
```

Note: stem fade on exit fires **before** the group-level stop, so the fade command reaches the mixer before the group is stopped. For zones using `PlayOrTransition` on exit (like our bridge zone), the group never stops — only the stem fades.

- [ ] **Step 5: Run test to verify it passes**

Run: `cmake --build --preset macos-debug --target test_audio_zone_system && ./build/macos-debug/test_audio_zone_system`
Expected: All tests PASS (existing + new stem fade tests)

- [ ] **Step 6: Commit**

```bash
git add include/gseurat/engine/components/audio_zone_component.hpp \
        src/engine/systems/audio_zone_system.cpp \
        tests/test_audio_zone_system.cpp
git commit -m "feat(audio): add per-stem fade actions to AudioZoneComponent

Extends AudioZoneComponent with stem_fade_on_enter/exit vectors and
dispatches set_stem_volume() calls in AudioZoneSystem::tick()."
```

---

### Task 2: Update Scene Schema for Stem Fade Actions

**Files:**
- Modify: `schemas/scene.schema.json`

- [ ] **Step 1: Find the AudioZoneComponent section in the schema**

The AudioZoneComponent is not yet in the schema. Find the `components` properties section (near ColliderComponent and KinematicBody definitions) and add it.

Search for `"ColliderComponent"` in `schemas/scene.schema.json` to locate the right section. Add `AudioZoneComponent` as a sibling property.

- [ ] **Step 2: Add AudioZoneComponent with stem fade to schema**

Add the following definition alongside existing component schemas:

```json
"AudioZoneComponent": {
  "type": "object",
  "properties": {
    "bounds_min": {
      "type": "array",
      "items": { "type": "number" },
      "minItems": 3, "maxItems": 3,
      "description": "AABB minimum corner [x, y, z]"
    },
    "bounds_max": {
      "type": "array",
      "items": { "type": "number" },
      "minItems": 3, "maxItems": 3,
      "description": "AABB maximum corner [x, y, z]"
    },
    "track_group_id": { "type": "integer" },
    "action_on_enter": {
      "type": "string",
      "enum": ["Play", "PlayOrTransition", "Stop"]
    },
    "action_on_exit": {
      "type": "string",
      "enum": ["Play", "PlayOrTransition", "Stop"]
    },
    "enter_xfade_ms": { "type": "number" },
    "exit_fade_ms": { "type": "number" },
    "align_to_next_marker": { "type": "boolean" },
    "stem_fade_on_enter": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "group_id": { "type": "integer" },
          "stem_index": { "type": "integer" },
          "target_volume": { "type": "number" },
          "fade_ms": { "type": "number" }
        },
        "required": ["group_id", "stem_index", "target_volume", "fade_ms"]
      }
    },
    "stem_fade_on_exit": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "group_id": { "type": "integer" },
          "stem_index": { "type": "integer" },
          "target_volume": { "type": "number" },
          "fade_ms": { "type": "number" }
        },
        "required": ["group_id", "stem_index", "target_volume", "fade_ms"]
      }
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add schemas/scene.schema.json
git commit -m "chore(schema): add AudioZoneComponent with stem fade actions"
```

---

### Task 3: Add Vista Strings Stem to Island BGM

**Files:**
- Modify: `examples/island_demo/assets/audio/island_demo.music.json`

- [ ] **Step 1: Add the vista_strings stem**

Open `examples/island_demo/assets/audio/island_demo.music.json`. The existing track group (id: 1, name: "Field") has 4 stems. Add a 5th stem at the end of the `stems` array with `initial_volume: 0`:

```json
{
  "source": "assets/audio/field/vista_strings.wav",
  "initial_volume": 0
}
```

The full stems array becomes:
```json
"stems": [
  { "source": "assets/audio/field/music_bass.wav", "initial_volume": 1 },
  { "source": "assets/audio/field/music_harmony.wav", "initial_volume": 1 },
  { "source": "assets/audio/field/music_melody.wav", "initial_volume": 1 },
  { "source": "assets/audio/field/music_percussion.wav", "initial_volume": 1 },
  { "source": "assets/audio/field/vista_strings.wav", "initial_volume": 0 }
]
```

This makes the vista_strings stem index **4** (0-based).

- [ ] **Step 2: Create a placeholder audio file**

The audio file doesn't need to be final — create a silent WAV placeholder so the engine can load without error:

```bash
# Generate 10 seconds of silence at 44100 Hz mono 16-bit
ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 10 -c:a pcm_s16le \
  examples/island_demo/assets/audio/field/vista_strings.wav
```

If `ffmpeg` is not available, copy any existing WAV as a placeholder:

```bash
cp examples/island_demo/assets/audio/field/music_harmony.wav \
   examples/island_demo/assets/audio/field/vista_strings.wav
```

- [ ] **Step 3: Commit**

```bash
git add examples/island_demo/assets/audio/island_demo.music.json \
        examples/island_demo/assets/audio/field/vista_strings.wav
git commit -m "feat(demo): add vista_strings stem to island BGM (silent placeholder)"
```

---

### Task 4: Add KCC Showcase Colliders to Scene JSON

**Files:**
- Modify: `examples/island_demo/assets/scenes/seurat_island.json`

- [ ] **Step 1: Locate the game_objects array**

In `examples/island_demo/assets/scenes/seurat_island.json`, find the `"game_objects"` array. All 8 obstacles are added as entries with `ColliderComponent` in their `components` object.

- [ ] **Step 2: Add the 8 primitive collider game objects**

Append these 8 objects to the `game_objects` array. Each has a `Transform` (via position/rotation/scale fields) and a `ColliderComponent`:

```json
{
  "id": "kcc_wall_a",
  "name": "Angled Stone Wall A",
  "position": [198, 0, 170],
  "rotation": [0, 30, 0],
  "scale": 1.0,
  "components": {
    "ColliderComponent": {
      "shape": { "type": "box", "half_extents": [3.0, 2.0, 0.4] },
      "offset": [0, 2, 0],
      "local_rotation": [0, 0, 0, 1],
      "collision_mask": 1,
      "is_trigger": false,
      "is_dynamic": false
    }
  }
},
{
  "id": "kcc_wall_b",
  "name": "Angled Stone Wall B",
  "position": [208, 0, 172],
  "rotation": [0, -25, 0],
  "scale": 1.0,
  "components": {
    "ColliderComponent": {
      "shape": { "type": "box", "half_extents": [3.0, 2.0, 0.4] },
      "offset": [0, 2, 0],
      "local_rotation": [0, 0, 0, 1],
      "collision_mask": 1,
      "is_trigger": false,
      "is_dynamic": false
    }
  }
},
{
  "id": "kcc_boulder_a",
  "name": "Boulder A",
  "position": [200, 0, 178],
  "rotation": [0, 0, 0],
  "scale": 1.0,
  "components": {
    "ColliderComponent": {
      "shape": { "type": "sphere", "radius": 1.2 },
      "offset": [0, 1.2, 0],
      "local_rotation": [0, 0, 0, 1],
      "collision_mask": 1,
      "is_trigger": false,
      "is_dynamic": false
    }
  }
},
{
  "id": "kcc_boulder_b",
  "name": "Boulder B",
  "position": [205, 0.5, 168],
  "rotation": [0, 0, 0],
  "scale": 1.0,
  "components": {
    "ColliderComponent": {
      "shape": { "type": "sphere", "radius": 1.0 },
      "offset": [0, 1.0, 0],
      "local_rotation": [0, 0, 0, 1],
      "collision_mask": 1,
      "is_trigger": false,
      "is_dynamic": false
    }
  }
},
{
  "id": "kcc_boulder_c",
  "name": "Boulder C",
  "position": [197, 0, 174],
  "rotation": [0, 0, 0],
  "scale": 1.0,
  "components": {
    "ColliderComponent": {
      "shape": { "type": "sphere", "radius": 1.5 },
      "offset": [0, 1.5, 0],
      "local_rotation": [0, 0, 0, 1],
      "collision_mask": 1,
      "is_trigger": false,
      "is_dynamic": false
    }
  }
},
{
  "id": "kcc_pillar_a",
  "name": "Ruined Pillar A",
  "position": [202, 0, 173],
  "rotation": [0, 0, 0],
  "scale": 1.0,
  "components": {
    "ColliderComponent": {
      "shape": { "type": "capsule", "radius": 0.5, "half_height": 1.5 },
      "offset": [0, 2.0, 0],
      "local_rotation": [0, 0, 0, 1],
      "collision_mask": 1,
      "is_trigger": false,
      "is_dynamic": false
    }
  }
},
{
  "id": "kcc_pillar_b",
  "name": "Ruined Pillar B",
  "position": [206, 0, 177],
  "rotation": [0, 0, 0],
  "scale": 1.0,
  "components": {
    "ColliderComponent": {
      "shape": { "type": "capsule", "radius": 0.5, "half_height": 1.5 },
      "offset": [0, 2.0, 0],
      "local_rotation": [0, 0, 0, 1],
      "collision_mask": 1,
      "is_trigger": false,
      "is_dynamic": false
    }
  }
},
{
  "id": "kcc_ramp",
  "name": "Low Ramp",
  "position": [201, 0, 165],
  "rotation": [15, 0, 0],
  "scale": 1.0,
  "components": {
    "ColliderComponent": {
      "shape": { "type": "box", "half_extents": [2.0, 0.5, 3.0] },
      "offset": [0, 0.5, 0],
      "local_rotation": [0, 0, 0, 1],
      "collision_mask": 1,
      "is_trigger": false,
      "is_dynamic": false
    }
  }
}
```

**Important notes:**
- `offset` raises each collider center to half-height above the ground so the shape sits on the terrain, not buried in it.
- `rotation` is Euler degrees `[pitch, yaw, roll]` — the scene loader converts to quaternion using the YXZ convention.
- `collision_mask: 1` matches the player's default collision mask.
- `is_dynamic: false` ensures these go into the static BVH cache.

- [ ] **Step 3: Build and run to verify colliders load**

Run: `cmake --build --preset macos-debug`
Expected: Build succeeds. The collision system will pick up the new entities on next `rebuild_cache()`.

- [ ] **Step 4: Commit**

```bash
git add examples/island_demo/assets/scenes/seurat_island.json
git commit -m "feat(demo): add KCC showcase colliders near dungeon portal

8 static primitive obstacles (2 angled boxes, 3 spheres, 2 capsules,
1 tilted ramp) arranged as a ruined courtyard approach."
```

---

### Task 5: Add Cinematic Camera Rail and Volume to Scene JSON

**Files:**
- Modify: `examples/island_demo/assets/scenes/seurat_island.json`

- [ ] **Step 1: Add the bridge_vista_rail to the rails array**

In `examples/island_demo/assets/scenes/seurat_island.json`, find the `"camera_zones"` → `"rails"` array (which currently has `"main_path_rail"`). Append a new rail:

```json
{
  "id": "bridge_vista_rail",
  "control_points": [
    [175,  8, 135],
    [155, 18, 110],
    [160, 22,  80],
    [175, 18,  60],
    [185, 12,  90],
    [180,  8, 115]
  ]
}
```

- [ ] **Step 2: Add the bridge_cinematic volume to the volumes array**

In the `"camera_zones"` → `"volumes"` array (which has town_center, cliff_overlook, forest_edge, dungeon_approach), append:

```json
{
  "id": "bridge_cinematic",
  "shape": {
    "type": "aabb",
    "center": [175, 5, 120],
    "half_extents": [25, 15, 15]
  },
  "params": {
    "mode": "cinematic_rail",
    "rail_id": "bridge_vista_rail",
    "play_on_enter": true,
    "cinematic_playback": "once",
    "cinematic_duration": 8.0,
    "cinematic_easing": "in_out_quad",
    "blend_time": 1.5,
    "target_mode": "player",
    "priority": 10
  }
}
```

**Key fields:**
- `priority: 10` overrides the surrounding `forest_edge` (priority 1) and `town_center` (priority 1).
- `cinematic_duration: 8.0` — 8 seconds for the full sweep (enough to appreciate the panorama).
- `cinematic_easing: "in_out_quad"` — smooth ease-in/out for the spline traversal.
- `rail_id: "bridge_vista_rail"` — resolved to a rail_index by `parse_camera_zones()`.
- `target_mode: "player"` — camera looks at the player during the sweep.

- [ ] **Step 3: Build to verify camera zone loads**

Run: `cmake --build --preset macos-debug`
Expected: Build succeeds. No parsing errors.

- [ ] **Step 4: Commit**

```bash
git add examples/island_demo/assets/scenes/seurat_island.json
git commit -m "feat(demo): add cinematic camera rail on bridge crossing

Spline path sweeps across chunk boundary (z=80, z=60 in northern_forest)
to stress-test WorldStreamer during panoramic camera movement."
```

---

### Task 6: Add Bridge Audio Zone to Scene JSON

**Files:**
- Modify: `examples/island_demo/assets/scenes/seurat_island.json`

- [ ] **Step 1: Locate the audio_zones array**

In `examples/island_demo/assets/scenes/seurat_island.json`, find the `"audio_zones"` array. If it doesn't exist for this scene file, create it at the top level alongside `"camera_zones"` and `"game_objects"`.

- [ ] **Step 2: Add the bridge vista audio zone**

Add this entry to the `"audio_zones"` array:

```json
{
  "id": "bridge_vista_audio",
  "center": [175, 5, 120],
  "half_extents": [25, 15, 15],
  "music_config": "assets/audio/island_demo.music.json",
  "crossfade_ms": 1500,
  "ambient_volume": 1.0,
  "action_on_enter": "PlayOrTransition",
  "action_on_exit": "PlayOrTransition",
  "stem_fade_on_enter": [
    {
      "group_id": 1,
      "stem_index": 4,
      "target_volume": 1.0,
      "fade_ms": 1500
    }
  ],
  "stem_fade_on_exit": [
    {
      "group_id": 1,
      "stem_index": 4,
      "target_volume": 0.0,
      "fade_ms": 1500
    }
  ]
}
```

**Key values:**
- `group_id: 1` — the "Field" track group in island_demo.music.json.
- `stem_index: 4` — the vista_strings stem added in Task 3 (0-based, 5th stem).
- `fade_ms: 1500` — matches the camera's `blend_time: 1.5`.
- `action_on_enter/exit: "PlayOrTransition"` — keeps the base BGM playing; never stops the group.

- [ ] **Step 3: Extend scene_loader to parse stem fade actions**

In `src/engine/scene_loader.cpp`, find the audio zones parsing block (around line 625). After parsing the existing fields, add parsing for the new stem fade arrays:

```cpp
// Inside the for (const auto& az : j["audio_zones"]) loop, after existing field parsing:
if (az.contains("action_on_enter")) {
    std::string ae = az["action_on_enter"].get<std::string>();
    // Store as string in AudioZoneRef for later conversion
    ref.action_on_enter_str = ae;
}
if (az.contains("action_on_exit")) {
    ref.action_on_exit_str = az["action_on_exit"].get<std::string>();
}
if (az.contains("stem_fade_on_enter")) {
    for (const auto& sf : az["stem_fade_on_enter"]) {
        StemFadeAction a;
        a.group_id = sf.value("group_id", 0u);
        a.stem_index = sf.value("stem_index", 0u);
        a.target_volume = sf.value("target_volume", 0.0f);
        a.fade_ms = sf.value("fade_ms", 0.0f);
        ref.stem_fade_on_enter.push_back(a);
    }
}
if (az.contains("stem_fade_on_exit")) {
    for (const auto& sf : az["stem_fade_on_exit"]) {
        StemFadeAction a;
        a.group_id = sf.value("group_id", 0u);
        a.stem_index = sf.value("stem_index", 0u);
        a.target_volume = sf.value("target_volume", 0.0f);
        a.fade_ms = sf.value("fade_ms", 0.0f);
        ref.stem_fade_on_exit.push_back(a);
    }
}
```

Also update `SceneData::AudioZoneRef` in `include/gseurat/engine/scene_loader.hpp` to include the new fields:

```cpp
struct AudioZoneRef {
    std::string id;
    glm::vec3 center{0.0f};
    glm::vec3 half_extents{0.0f};
    std::string music_config;
    float crossfade_ms = 2000.0f;
    float ambient_volume = 1.0f;
    std::string action_on_enter_str;
    std::string action_on_exit_str;
    std::vector<StemFadeAction> stem_fade_on_enter;
    std::vector<StemFadeAction> stem_fade_on_exit;
};
```

Add the include at the top of `scene_loader.hpp`:
```cpp
#include "gseurat/engine/components/audio_zone_component.hpp"
```

- [ ] **Step 4: Wire stem fade actions into AudioZoneComponent construction**

Find where `AudioZoneRef` data is converted to `AudioZoneComponent` in `island_demo_state.cpp` (the `on_enter()` method). After the existing audio zone setup code, copy the stem fade vectors:

```cpp
// After constructing the AudioZoneComponent from the AudioZoneRef:
zone_component.stem_fade_on_enter = ref.stem_fade_on_enter;
zone_component.stem_fade_on_exit = ref.stem_fade_on_exit;
```

If the action strings are parsed:
```cpp
if (ref.action_on_enter_str == "PlayOrTransition")
    zone_component.action_on_enter = AudioZoneComponent::Action::PlayOrTransition;
else if (ref.action_on_enter_str == "Stop")
    zone_component.action_on_enter = AudioZoneComponent::Action::Stop;

if (ref.action_on_exit_str == "PlayOrTransition")
    zone_component.action_on_exit = AudioZoneComponent::Action::PlayOrTransition;
else if (ref.action_on_exit_str == "Stop")
    zone_component.action_on_exit = AudioZoneComponent::Action::Stop;
```

- [ ] **Step 5: Build and run all tests**

Run: `cmake --build --preset macos-debug && ctest --test-dir build/macos-debug --output-on-failure`
Expected: All tests pass. Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add examples/island_demo/assets/scenes/seurat_island.json \
        src/engine/scene_loader.cpp \
        include/gseurat/engine/scene_loader.hpp \
        src/demo/island_demo_state.cpp
git commit -m "feat(demo): add bridge audio zone with vista_strings stem fade

Co-located with CameraVolume, fades in stem index 4 (vista_strings)
over 1500ms on enter, matching the camera blend_time."
```

---

### Task 7: Integration Testing via Game Director

**Files:**
- No code changes — verification only

- [ ] **Step 1: Build the full project**

Run: `cmake --build --preset macos-debug`
Expected: Clean build, 0 errors.

- [ ] **Step 2: Run all unit tests**

Run: `ctest --test-dir build/macos-debug --output-on-failure`
Expected: All tests pass.

- [ ] **Step 3: Run Game Director collision test**

Test that the KCC showcase colliders are loaded into the BVH and the player can navigate through them:

```bash
python3 scripts/game_director.py teleport 203 2 175
python3 scripts/game_director.py wait 1
python3 scripts/game_director.py debug_dump collision
```

Verify: The debug dump shows 8+ static colliders in the BVH near the dungeon portal coordinates. The player entity has KinematicBody + ColliderComponent.

- [ ] **Step 4: Run Game Director camera test**

Test that the cinematic camera rail activates on the bridge:

```bash
python3 scripts/game_director.py teleport 175 2 120
python3 scripts/game_director.py wait 2
python3 scripts/game_director.py debug_dump eyes
```

Verify: The debug dump shows the camera in `cinematic_rail` mode with `bridge_vista_rail` active.

- [ ] **Step 5: Run Game Director audio test**

Test that the vista_strings stem fades in:

```bash
python3 scripts/game_director.py teleport 175 2 120
python3 scripts/game_director.py wait 2
python3 scripts/game_director.py debug_dump ears
```

Verify: The audio dump shows group 1 playing with stem index 4 at non-zero volume.

- [ ] **Step 6: Visual walkthrough**

Launch the demo and manually walk the path:
1. Start near town center
2. Walk toward the dungeon portal → colliders appear as wireframes (F10)
3. Walk through the courtyard → KCC wall-slides smoothly around all obstacles
4. Walk to the bridge → camera sweeps panoramically, vista_strings fade in
5. Continue across → camera blends back, audio layer fades out

Verify: No frame drops, no stuck positions, smooth transitions.

- [ ] **Step 7: Commit integration test results (if scripts were added)**

If no new test scripts were created, this step is skipped — the verification is manual/Game Director based.
