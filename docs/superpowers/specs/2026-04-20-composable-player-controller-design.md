# Composable Player Controller

**Date:** 2026-04-20
**Status:** Approved

## Problem

The player is currently a special-case entity created manually in `IslandDemoState`, with movement parameters hardcoded as constants. The Player Spawn section in Bricklayer has fixed fields (speed, acceleration, jump_height, jump_duration) that can't be extended without changing UI code. Games that don't use jumps still see jump fields. The player can't be swapped at runtime.

## Design

The player becomes a regular game object in the `game_objects` array. Behaviors are composed from optional ECS components. Bricklayer renders component editors dynamically from `.schema.json` files — no hardcoded player UI.

### Components

**`PlayerController`** (engine-level):

```cpp
// include/gseurat/engine/ecs/components/player_controller.hpp
struct PlayerController {
    float speed = 20.0f;        // units/sec
    float acceleration = 20.0f; // blend rate
};
```

Presence on an entity means "this is the player-controlled character." The engine auto-attaches `PlayerTag` when it finds this component during scene load.

**`PlayerJump`** (engine-level):

```cpp
// include/gseurat/engine/ecs/components/player_jump.hpp
struct PlayerJump {
    float height = 4.0f;      // peak height in units
    float duration = 0.8f;    // seconds for full arc
    // Runtime state (not serialized)
    bool active = false;
    float timer = 0.0f;
};
```

Optional. If absent on the player entity, Space key does nothing.

Both registered in engine's `ComponentRegistry` (in `app_base.cpp`), available to all consumers.

### Scene JSON Format

The player is a game object entry:

```json
{
  "game_objects": [
    {
      "id": "player",
      "name": "Player",
      "position": [187, 1.97, 197],
      "rotation": [0, 0, 0],
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
  ]
}
```

No top-level `player` block. Position on the game object is the spawn point.

### Component Schemas

Bricklayer auto-discovers these from `assets/components/`:

**`player_controller.schema.json`:**
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

**`player_jump.schema.json`:**
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

No Bricklayer UI code changes needed — `ComponentFieldEditor` renders fields dynamically from schema.

### Engine Loading

1. `gs_scene_loader.cpp` creates ECS entities for all game objects and attaches components via `ComponentRegistry` (existing behavior).
2. **New:** After entity creation, scan for `PlayerController` and auto-attach `PlayerTag`:
   ```cpp
   ctx.world.view<PlayerController, ecs::Transform>().each(
       [&](ecs::Entity e, PlayerController&, ecs::Transform&) {
           ctx.world.add<PlayerTag>(e);
       });
   ```

### Demo Changes

- `on_enter()`: No longer creates the player entity manually. Queries for the entity with `PlayerController` + `PlayerTag` from the scene loader.
- `update_player()`: Reads `speed` and `acceleration` from `PlayerController` component. Checks for `PlayerJump` — if present, enables jump with its params; if absent, no jump.
- Character PLY/animation setup: Triggered by `BoneAnimated` on the player entity, same as NPCs.

### Runtime Swapping

Move control between entities by moving components:

```cpp
world.remove<PlayerController>(entity_a);
world.remove<PlayerTag>(entity_a);
world.add<PlayerController>(entity_b, {20.0f, 20.0f});
world.add<PlayerTag>(entity_b);
```

Camera, triggers, and control server automatically follow the new `PlayerTag` holder.

### Backward Compatibility

The scene loader keeps parsing the legacy `player` block as a fallback:

```cpp
if (j.contains("player")) {
    data.legacy_player_position = coord::GridPos(parse_vec3(p["position"]));
    // ...
}
```

The demo checks: if an entity with `PlayerController` exists, use it. Otherwise, fall back to legacy `player` block (create entity manually). Existing scenes and consumers are not broken.

Bricklayer auto-converts old `.bricklayer` files with a `player` block into a game object with `PlayerController` during project import.

### Bricklayer Changes

- Remove `PlayerProperties` component and Player Spawn section from `ScenePropertiesPanel.tsx`
- Remove `PlayerData` controller fields from store types, defaults, export, and import
- Revert `player.speed/acceleration/jump_height/jump_duration` from scene schema
- Add legacy `player` block → game object migration in `projectIO.ts`

### Files Changed

| Layer | Files | Change |
|-------|-------|--------|
| Engine (new) | `include/gseurat/engine/ecs/components/player_controller.hpp` | PlayerController struct |
| Engine (new) | `include/gseurat/engine/ecs/components/player_jump.hpp` | PlayerJump struct |
| Engine | `app_base.cpp` | Register both components in ComponentRegistry |
| Engine | `gs_scene_loader.cpp` | Auto-attach PlayerTag to PlayerController entities |
| Engine | `scene_loader.cpp/hpp` | Remove player_speed etc., keep legacy player block parsing |
| Engine | `scene.schema.json` | Revert player controller fields |
| Demo | `island_demo_state.cpp/hpp` | Read from ECS components, remove hardcoded constants |
| Demo | `island_components.hpp` | Remove PlayerController (moved to engine) |
| Demo | `demo_app.cpp` | Remove PlayerController registration (moved to engine) |
| Bricklayer | `ScenePropertiesPanel.tsx` | Remove PlayerProperties section |
| Bricklayer | `types.ts`, `useSceneStore.ts` | Remove PlayerData controller fields |
| Bricklayer | `sceneExport.ts`, `projectIO.ts` | Remove player export, add legacy migration |
| Assets (new) | `player_controller.schema.json` | Component schema for Bricklayer |
| Assets (new) | `player_jump.schema.json` | Component schema for Bricklayer |
| Assets | `seurat_island.json`, `.bricklayer` | Migrate player to game object |

### Future Extensions

New player abilities are added by:
1. Define a C++ struct (e.g., `PlayerDash { float distance; float cooldown; }`)
2. Register in `ComponentRegistry`
3. Add a `.schema.json` file
4. Implement the system that queries the component

Bricklayer automatically shows the new component in the "Add Component" dropdown with editable fields — zero UI code changes.
