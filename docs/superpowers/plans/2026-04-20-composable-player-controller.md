# Composable Player Controller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the player a regular game object with composable ECS components (`PlayerController`, `PlayerJump`) instead of a hardcoded special case, with Bricklayer rendering component editors dynamically from schema files.

**Architecture:** Move `PlayerController` from demo to engine, add `PlayerJump` as an optional component. The engine auto-attaches `PlayerTag` to entities with `PlayerController` during scene load. The demo reads movement/jump params from ECS components instead of hardcoded constants. Bricklayer removes the fixed Player Spawn section and relies on the existing dynamic component UI. Legacy `player` block in scene JSON is kept as a fallback.

**Tech Stack:** C++23 (engine), TypeScript/React (Bricklayer), JSON schemas

**Spec:** `docs/superpowers/specs/2026-04-20-composable-player-controller-design.md`

---

### Task 1: Create engine-level PlayerController and PlayerJump components

**Files:**
- Create: `include/gseurat/engine/ecs/components/player_controller.hpp`
- Create: `include/gseurat/engine/ecs/components/player_jump.hpp`

- [ ] **Step 1: Create PlayerController header**

Create `include/gseurat/engine/ecs/components/player_controller.hpp`:

```cpp
#pragma once

namespace gseurat {

/// Marks an entity as the player-controlled character.
/// Presence triggers auto-attachment of PlayerTag during scene load.
struct PlayerController {
    float speed = 20.0f;        // movement speed (units/sec)
    float acceleration = 20.0f; // velocity blend rate
};

}  // namespace gseurat
```

- [ ] **Step 2: Create PlayerJump header**

Create `include/gseurat/engine/ecs/components/player_jump.hpp`:

```cpp
#pragma once

namespace gseurat {

/// Optional jump ability. If absent on the player entity, jump input is ignored.
struct PlayerJump {
    float height = 4.0f;      // peak height in units
    float duration = 0.8f;    // seconds for full arc
    // Runtime state (not serialized to JSON)
    bool active = false;
    float timer = 0.0f;
};

}  // namespace gseurat
```

- [ ] **Step 3: Build to verify headers compile**

Run: `cmake --build --preset macos-release --target gseurat_demo 2>&1 | tail -5`
Expected: Build succeeds (headers are not yet included anywhere, this is a sanity check)

- [ ] **Step 4: Commit**

```bash
git add include/gseurat/engine/ecs/components/player_controller.hpp \
        include/gseurat/engine/ecs/components/player_jump.hpp
git commit -m "feat(engine): add PlayerController and PlayerJump component headers"
```

---

### Task 2: Register components in engine ComponentRegistry

**Files:**
- Modify: `src/engine/app_base.cpp` (around lines 439-441, where PlayerTag is registered)

- [ ] **Step 1: Add includes to app_base.cpp**

At the top of `src/engine/app_base.cpp`, add after existing component includes:

```cpp
#include "gseurat/engine/ecs/components/player_controller.hpp"
#include "gseurat/engine/ecs/components/player_jump.hpp"
```

- [ ] **Step 2: Register PlayerController in ComponentRegistry**

In `app_base.cpp`, after the `PlayerTag` registration (around line 441), add:

```cpp
    component_registry_.register_component<PlayerController>("PlayerController",
        [](const nlohmann::json& j) -> PlayerController {
            PlayerController c;
            if (j.contains("speed")) c.speed = j["speed"].get<float>();
            if (j.contains("acceleration")) c.acceleration = j["acceleration"].get<float>();
            return c;
        },
        [](const PlayerController& c) -> nlohmann::json {
            return {{"speed", c.speed}, {"acceleration", c.acceleration}};
        });

    component_registry_.register_component<PlayerJump>("PlayerJump",
        [](const nlohmann::json& j) -> PlayerJump {
            PlayerJump c;
            if (j.contains("height")) c.height = j["height"].get<float>();
            if (j.contains("duration")) c.duration = j["duration"].get<float>();
            return c;
        },
        [](const PlayerJump& c) -> nlohmann::json {
            return {{"height", c.height}, {"duration", c.duration}};
        });
```

- [ ] **Step 3: Build to verify registration compiles**

Run: `cmake --build --preset macos-release --target gseurat_demo 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/engine/app_base.cpp
git commit -m "feat(engine): register PlayerController and PlayerJump in ComponentRegistry"
```

---

### Task 3: Auto-attach PlayerTag during scene load

**Files:**
- Modify: `src/engine/gs_scene_loader.cpp` (after line 253, game object entity creation loop)

- [ ] **Step 1: Add include**

At the top of `src/engine/gs_scene_loader.cpp`, add:

```cpp
#include "gseurat/engine/ecs/components/player_controller.hpp"
```

- [ ] **Step 2: Add PlayerTag auto-attach after game object creation**

In `gs_scene_loader.cpp`, after the game object entity creation loop (after line 253: the closing `}` of `for (size_t i = 0; i < snapped_objects.size(); ++i)`), add:

```cpp
            // Auto-attach PlayerTag to entities with PlayerController
            ctx.world.view<PlayerController, ecs::Transform>().each(
                [&](ecs::Entity e, PlayerController&, ecs::Transform&) {
                    if (!ctx.world.has<PlayerTag>(e)) {
                        ctx.world.add<PlayerTag>(e);
                    }
                });
```

- [ ] **Step 3: Build**

Run: `cmake --build --preset macos-release --target gseurat_demo 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/engine/gs_scene_loader.cpp
git commit -m "feat(engine): auto-attach PlayerTag to PlayerController entities on scene load"
```

---

### Task 4: Remove PlayerController from demo, update demo to read from ECS

**Files:**
- Modify: `include/gseurat/demo/island_components.hpp` (remove PlayerController struct, lines 10-15)
- Modify: `include/gseurat/demo/island_demo_state.hpp` (remove player_speed_, player_accel_, jump_height_, jump_duration_)
- Modify: `src/demo/demo_app.cpp` (remove PlayerController registration, lines 88-98)
- Modify: `src/demo/island_demo_state.cpp` (read from ECS components)

- [ ] **Step 1: Remove PlayerController from island_components.hpp**

In `include/gseurat/demo/island_components.hpp`, remove lines 10-15 (the `PlayerController` struct). Keep the include of `trigger_components.hpp` since other structs use it. Add the engine PlayerController include:

Replace:
```cpp
#include "gseurat/engine/trigger_components.hpp"
#include "gseurat/engine/bone_animated_component.hpp"

#include <cstdint>

namespace gseurat {

struct PlayerController {
    float speed = 10.0f;
    float acceleration = 10.0f;
    float velocity_x = 0.0f;
    float velocity_z = 0.0f;
};
```

With:
```cpp
#include "gseurat/engine/trigger_components.hpp"
#include "gseurat/engine/bone_animated_component.hpp"
#include "gseurat/engine/ecs/components/player_controller.hpp"
#include "gseurat/engine/ecs/components/player_jump.hpp"

#include <cstdint>

namespace gseurat {
```

- [ ] **Step 2: Remove PlayerController registration from demo_app.cpp**

In `src/demo/demo_app.cpp`, remove the `register_component<PlayerController>` block (lines 88-98). The engine now registers it.

- [ ] **Step 3: Remove hardcoded member variables from island_demo_state.hpp**

In `include/gseurat/demo/island_demo_state.hpp`:

Remove these four member variables:
```cpp
    float jump_duration_ = 0.8f;  // from scene data (player.jump_duration)
    float jump_height_ = 4.0f;   // from scene data (player.jump_height)
```
and:
```cpp
    float player_speed_ = 20.0f;   // from scene data (player.speed)
    float player_accel_ = 20.0f;   // from scene data (player.acceleration)
```

- [ ] **Step 4: Update island_demo_state.cpp — player entity creation in on_enter()**

In `src/demo/island_demo_state.cpp`, find the player entity creation block (around line 297-315). Replace the manual entity creation with a query for the PlayerController entity that the scene loader already created:

Replace:
```cpp
    // Initialize player controller from scene data
    player_speed_ = scene_data.player_speed;
    player_accel_ = scene_data.player_acceleration;
    jump_height_ = scene_data.player_jump_height;
    jump_duration_ = scene_data.player_jump_duration;

    // Create player entity
    player_entity_ = app.world().create();
    app.world().add<ecs::Transform>(player_entity_, {coord::WorldPos(player_pos), {1.0f, 1.0f}});
    app.world().add<PlayerController>(player_entity_, {player_speed_, player_accel_});

    // Mark player for engine proximity trigger system
    app.world().add<PlayerTag>(player_entity_);
```

With:
```cpp
    // Find the player entity created by scene loader (has PlayerController + PlayerTag)
    player_entity_ = ecs::kNullEntity;
    app.world().view<PlayerController, PlayerTag, ecs::Transform>().each(
        [&](ecs::Entity e, PlayerController&, PlayerTag&, ecs::Transform&) {
            player_entity_ = e;
        });

    // Legacy fallback: if no game object has PlayerController, create player manually
    if (!player_entity_.valid()) {
        player_entity_ = app.world().create();
        app.world().add<ecs::Transform>(player_entity_, {coord::WorldPos(player_pos), {1.0f, 1.0f}});
        app.world().add<PlayerController>(player_entity_, {20.0f, 20.0f});
        app.world().add<PlayerTag>(player_entity_);
    }
```

- [ ] **Step 5: Update update_player() to read from ECS components**

In `src/demo/island_demo_state.cpp`, in `update_player()`, replace the references to member variables with ECS component queries.

At the start of `update_player()` (after the Transform query), add:

```cpp
    auto* pc = app.world().try_get<PlayerController>(player_entity_);
    if (!pc) return;  // No player controller = no input handling
    const float speed = pc->speed;
    const float accel = pc->acceleration;
```

Then replace:
- `player_speed_` → `speed`
- `player_accel_` → `accel`

For jump logic, replace the jump section to check for PlayerJump component:

```cpp
    // Jump (only if PlayerJump component exists)
    auto* pj = app.world().try_get<PlayerJump>(player_entity_);
    if (pj) {
        if (app.input().was_key_pressed(GLFW_KEY_SPACE) && !pj->active) {
            pj->active = true;
            pj->timer = 0.0f;
            // ... trigger jump animation
        }
        if (pj->active) {
            pj->timer += dt;
            if (pj->timer >= pj->duration) {
                pj->active = false;
                pj->timer = 0.0f;
                // ... end jump animation
            } else {
                float t = pj->timer / pj->duration;
                float jump_y = 4.0f * pj->height * t * (1.0f - t);
                // ... apply jump Y offset
            }
        }
    }
```

Replace `jumping_` → `pj->active`, `jump_time_` → `pj->timer`, `jump_duration_` → `pj->duration`, `jump_height_` → `pj->height` throughout. Also update the character Y offset code (around line 1323) to query PlayerJump similarly.

- [ ] **Step 6: Update portal restore block**

In `src/demo/island_demo_state.cpp`, find the portal restore block (around line 1968) that re-creates the player entity after portal transitions. Apply the same pattern — query for existing PlayerController entity rather than creating manually. Replace:

```cpp
        {player_speed_, player_accel_});
```

With a similar legacy-fallback query as in Step 4.

- [ ] **Step 7: Remove jumping_ and jump_time_ member variables from hpp**

In `include/gseurat/demo/island_demo_state.hpp`, remove:
```cpp
    bool jumping_ = false;
    float jump_time_ = 0.0f;
```

These are now stored on the `PlayerJump` component.

- [ ] **Step 8: Build**

Run: `cmake --build --preset macos-release --target gseurat_demo 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 9: Commit**

```bash
git add include/gseurat/demo/island_components.hpp \
        include/gseurat/demo/island_demo_state.hpp \
        src/demo/demo_app.cpp \
        src/demo/island_demo_state.cpp
git commit -m "refactor(demo): read player params from ECS components instead of hardcoded constants"
```

---

### Task 5: Revert hardcoded player controller fields from engine SceneData and scene schema

**Files:**
- Modify: `include/gseurat/engine/scene_loader.hpp` (remove player_speed, etc.)
- Modify: `src/engine/scene_loader.cpp` (remove parsing/serialization of player controller fields)
- Modify: `schemas/scene.schema.json` (remove player controller fields)

- [ ] **Step 1: Remove player controller fields from SceneData**

In `include/gseurat/engine/scene_loader.hpp`, remove these four fields from the `SceneData` struct (around lines 155-158):

```cpp
    float player_speed = 20.0f;
    float player_acceleration = 20.0f;
    float player_jump_height = 4.0f;
    float player_jump_duration = 0.8f;
```

- [ ] **Step 2: Remove parsing from scene_loader.cpp**

In `src/engine/scene_loader.cpp`, in the `if (j.contains("player"))` block (around lines 415-418), remove:

```cpp
        data.player_speed = p.value("speed", 20.0f);
        data.player_acceleration = p.value("acceleration", 20.0f);
        data.player_jump_height = p.value("jump_height", 4.0f);
        data.player_jump_duration = p.value("jump_duration", 0.8f);
```

- [ ] **Step 3: Remove serialization from scene_loader.cpp**

In `src/engine/scene_loader.cpp`, in the player serialization block (around lines 1160-1163), remove:

```cpp
        p["speed"] = data.player_speed;
        p["acceleration"] = data.player_acceleration;
        p["jump_height"] = data.player_jump_height;
        p["jump_duration"] = data.player_jump_duration;
```

- [ ] **Step 4: Revert scene schema**

In `schemas/scene.schema.json`, in the `player` definition (around lines 234-243), remove the four controller fields, restoring it to:

```json
    "player": {
      "type": "object",
      "properties": {
        "position": { "$ref": "#/definitions/vec3" },
        "tint": { "$ref": "#/definitions/color4" },
        "facing": { "$ref": "#/definitions/direction" },
        "character_id": { "type": "string" }
      },
      "additionalProperties": false
    },
```

- [ ] **Step 5: Build**

Run: `cmake --build --preset macos-release --target gseurat_demo 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add include/gseurat/engine/scene_loader.hpp \
        src/engine/scene_loader.cpp \
        schemas/scene.schema.json
git commit -m "revert(engine): remove hardcoded player controller fields from SceneData and schema"
```

---

### Task 6: Create component schema files for Bricklayer

**Files:**
- Create: `examples/island_demo/assets/components/player_controller.schema.json`
- Create: `examples/island_demo/assets/components/player_jump.schema.json`

- [ ] **Step 1: Create PlayerController schema**

Create `examples/island_demo/assets/components/player_controller.schema.json`:

```json
{
  "name": "PlayerController",
  "description": "Marks entity as player-controlled. Handles movement input.",
  "category": "Player",
  "fields": [
    { "name": "speed", "type": "float", "default": 20, "min": 0, "step": 1 },
    { "name": "acceleration", "type": "float", "default": 20, "min": 0, "step": 1 }
  ]
}
```

- [ ] **Step 2: Create PlayerJump schema**

Create `examples/island_demo/assets/components/player_jump.schema.json`:

```json
{
  "name": "PlayerJump",
  "description": "Optional jump ability for the player.",
  "category": "Player",
  "fields": [
    { "name": "height", "type": "float", "default": 4, "min": 0, "step": 0.5 },
    { "name": "duration", "type": "float", "default": 0.8, "min": 0.1, "step": 0.1 }
  ]
}
```

- [ ] **Step 3: Commit**

```bash
git add examples/island_demo/assets/components/player_controller.schema.json \
        examples/island_demo/assets/components/player_jump.schema.json
git commit -m "feat(assets): add PlayerController and PlayerJump component schemas for Bricklayer"
```

---

### Task 7: Remove Player Spawn section from Bricklayer

**Files:**
- Modify: `tools/apps/bricklayer/src/panels/ScenePropertiesPanel.tsx` (remove PlayerProperties)
- Modify: `tools/apps/bricklayer/src/store/types.ts` (revert PlayerData)
- Modify: `tools/apps/bricklayer/src/store/useSceneStore.ts` (revert defaultPlayer)
- Modify: `tools/apps/bricklayer/src/lib/sceneExport.ts` (remove player controller export)
- Modify: `tools/apps/bricklayer/src/lib/projectIO.ts` (remove player controller import, add legacy migration)

- [ ] **Step 1: Revert PlayerData type**

In `tools/apps/bricklayer/src/store/types.ts`, revert `PlayerData` to remove controller fields:

```typescript
export interface PlayerData {
  position: [number, number, number];
  tint: [number, number, number, number];
  facing: string;
  character_id: string;
}
```

- [ ] **Step 2: Revert defaultPlayer()**

In `tools/apps/bricklayer/src/store/useSceneStore.ts`, revert `defaultPlayer()`:

```typescript
function defaultPlayer(): PlayerData {
  return {
    position: [0, 0, 0],
    tint: [1, 1, 1, 1],
    facing: 'down',
    character_id: '',
  };
}
```

- [ ] **Step 3: Remove controller fields from sceneExport.ts**

In `tools/apps/bricklayer/src/lib/sceneExport.ts`, revert the player export block to remove controller fields:

```typescript
  const playerObj: Record<string, unknown> = {
    position: state.player.position,
    tint: state.player.tint,
    facing: state.player.facing,
  };
  if (state.player.character_id) {
    playerObj.character_id = state.player.character_id;
  }
  scene.player = playerObj;
```

- [ ] **Step 4: Remove controller fields from projectIO.ts import**

In `tools/apps/bricklayer/src/lib/projectIO.ts`, revert the player import:

```typescript
        player: {
          position: engine.player?.position ?? [32, 0, 32],
          tint: engine.player?.tint ?? [1, 1, 1, 1],
          facing: engine.player?.facing ?? 'down',
          character_id: engine.player?.character_id ?? '',
        },
```

- [ ] **Step 5: Remove PlayerProperties from ScenePropertiesPanel.tsx**

In `tools/apps/bricklayer/src/panels/ScenePropertiesPanel.tsx`:

1. Remove the entire `PlayerProperties` function (lines 638-735)
2. Remove the `if (selectedEntity.type === 'player')` block (lines 1606-1608) that renders it

- [ ] **Step 6: Build Bricklayer**

Run: `cd tools && pnpm --filter bricklayer build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 7: Commit**

```bash
git add tools/apps/bricklayer/src/panels/ScenePropertiesPanel.tsx \
        tools/apps/bricklayer/src/store/types.ts \
        tools/apps/bricklayer/src/store/useSceneStore.ts \
        tools/apps/bricklayer/src/lib/sceneExport.ts \
        tools/apps/bricklayer/src/lib/projectIO.ts
git commit -m "refactor(bricklayer): remove hardcoded Player Spawn section, rely on dynamic component UI"
```

---

### Task 8: Migrate island demo scene data

**Files:**
- Modify: `examples/island_demo/assets/scenes/seurat_island.json`
- Modify: `examples/island_demo/tools_data/bricklayer/seurat_island.bricklayer`

- [ ] **Step 1: Add player game object to seurat_island.json**

In `examples/island_demo/assets/scenes/seurat_island.json`, add a player entry to the `game_objects` array. The position comes from the current `player.position` field ([187, 1.97, 197]). Scale matches `kCharScale` (0.45):

```json
    {
      "id": "player",
      "name": "Player",
      "position": [187, 1.9663, 197],
      "rotation": [0, 180, 0],
      "scale": 0.45,
      "ply_file": "assets/characters/warm_robot/warm_robot.ply",
      "components": {
        "PlayerController": { "speed": 20, "acceleration": 20 },
        "PlayerJump": { "height": 4, "duration": 0.8 },
        "BoneAnimated": {
          "manifest": "assets/characters/warm_robot/warm_robot.manifest.json",
          "default_clip": "idle"
        }
      }
    }
```

Keep the legacy `player` block for backward compatibility — it will be used as fallback by scenes that haven't migrated.

- [ ] **Step 2: Sync bricklayer file**

Update `examples/island_demo/tools_data/bricklayer/seurat_island.bricklayer` to add the same player game object in its `game_objects` array.

- [ ] **Step 3: Sync assets and build**

Run:
```bash
cmake --build --preset macos-release --target sync_assets 2>&1 | tail -2
cmake --build --preset macos-release --target gseurat_demo 2>&1 | tail -5
```
Expected: Both succeed

- [ ] **Step 4: Commit**

```bash
git add examples/island_demo/assets/scenes/seurat_island.json \
        examples/island_demo/tools_data/bricklayer/seurat_island.bricklayer
git commit -m "feat(demo): migrate player to game object with PlayerController + PlayerJump components"
```

---

### Task 9: Integration test with Game Director

**Files:** None (testing only)

- [ ] **Step 1: Launch demo and verify player spawns correctly**

```bash
cd build/macos-release && ./gseurat_demo &
sleep 7
python3 scripts/game_director.py player
```

Expected: Player position near (187, 2, 197)

- [ ] **Step 2: Verify game_objects command shows PlayerController entity**

```bash
python3 scripts/game_director.py game_objects
```

Expected: `Live NPCs` section includes a player entity with `PlayerController` component. The player game object appears in `Scene objects` with `[BoneAnimated, PlayerController, PlayerJump]` components.

- [ ] **Step 3: Test movement and jump**

```bash
python3 scripts/game_director.py walk forward 3
python3 scripts/game_director.py player
```

Expected: Player position changed (moved forward). Jump works if you press Space in-game.

- [ ] **Step 4: Take screenshot to verify visuals**

```bash
python3 scripts/game_director.py screenshot /tmp/player_composable.png
```

Expected: Player character visible on the island, same visual as before.

- [ ] **Step 5: Quit demo**

```bash
python3 scripts/game_director.py quit
```
