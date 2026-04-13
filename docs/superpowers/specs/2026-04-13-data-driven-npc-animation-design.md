# Data-Driven Bone-Animated NPCs

**Date:** 2026-04-13
**Status:** Draft

## Problem

Knight and slime NPCs are hardcoded in `island_demo_state.cpp` (~200 lines of manual PLY merging, bone slot assignment, and re-spawn logic). Portal transitions require manually re-creating NPCs, which caused the "NPCs gone after dungeon" bug (PR #233). Adding or changing NPCs requires C++ code changes.

## Goal

Define bone-animated NPCs entirely in scene JSON. Portal transitions automatically handle NPC creation/destruction via the standard `init_scene` flow.

## Design Decisions

- **Demo-level, not engine-level** — New component and system live in the demo layer (`island_components.hpp`, `island_systems.hpp`), consistent with existing demo components. Can be promoted to engine later.
- **Sequential bone slot allocation** — Scene loader assigns bone indices automatically at load time. No manual bookkeeping.
- **Scene loader handles PLY merge** — `GsSceneLoader` assigns bone indices during Gaussian merging, so portal transitions work automatically.
- **Generic animation system** — One `bone_animation_system` updates all `BoneAnimated` entities. Behavior components (NpcWalker, PlayerController) choose which clip to play.

## New Component: `BoneAnimated`

### Scene JSON

```json
{
  "id": "knight_01",
  "name": "Knight",
  "position": [202, 0, 187],
  "ply_file": "assets/characters/knight/knight.ply",
  "scale": 0.45,
  "components": {
    "BoneAnimated": {
      "manifest": "assets/characters/knight/knight.manifest.json",
      "default_clip": "idle"
    },
    "NpcWalker": { "patrol_radius": 12.0, "speed": 8.0 }
  }
}
```

### C++ Struct (`island_components.hpp`)

```cpp
struct BoneAnimated {
    std::string manifest_path;       // path to character manifest JSON
    std::string default_clip;        // initial animation clip name
    uint32_t first_bone_index = 0;   // assigned by scene loader
    uint32_t bone_count = 0;         // from manifest, set at load time
    std::string requested_clip;      // set by behavior systems (NpcWalker, etc.)
};
```

Note: ECS archetypes use memcpy, so `BoneAnimated` cannot be stored directly in the archetype. It must use an indirection pattern — either a side map keyed by entity, or a pointer/index into a separate storage. The recommended approach is a `std::unordered_map<ecs::Entity, BoneAnimated>` managed by the animation system.

### Registration

```cpp
// In app_base.cpp init_game_object_system() or island demo setup
registry.register_component<BoneAnimatedTag>("BoneAnimated", ...);
```

Where `BoneAnimatedTag` is a trivially-copyable marker struct stored in the archetype, and the full `BoneAnimated` data lives in the side map.

## Scene Loader Changes

### Bone Slot Allocator

In `GsSceneLoader::load()`, before the game object merge loop:

```
bone_slot_counter = kPlayerBoneReserve (8)
```

For each game object with a `BoneAnimated` component:

1. Parse `manifest` path from component JSON
2. Load manifest to get bone count
3. Assign `first_bone_index = bone_slot_counter`
4. Advance `bone_slot_counter += bone_count`
5. Guard: if `bone_slot_counter > 32`, log warning and skip

### PLY Merge with Bone Indices

The existing PLY merge loop in `GsSceneLoader::load()` already iterates game object Gaussians and applies position/rotation/scale transforms. Extend it:

- If the game object has a `BoneAnimated` component, read `first_bone_index` from the allocation
- For each Gaussian: `g.bone_index = first_bone_index + g.bone_index`

This replaces the per-character merge code in `island_demo_state.cpp`.

### Allocation Storage

The scene loader stores allocations in `SceneLoadContext` so the animation system can access them:

```cpp
// In SceneLoadContext or a new BoneAllocationMap
struct BoneAllocation {
    std::string manifest_path;
    std::string default_clip;
    uint32_t first_bone_index;
    uint32_t bone_count;
    glm::vec3 spawn_pos;  // for bone transform world-space conversion
};
std::unordered_map<ecs::Entity, BoneAllocation> bone_allocations;
```

## New System: `bone_animation_system`

### Initialization

On first tick (or when a new `BoneAnimated` entity appears), the system:

1. Loads `CharacterData` from the manifest path
2. Creates `BoneAnimationPlayer` and `BoneAnimationStateMachine`
3. Plays the `default_clip`
4. Stores these in a side map keyed by entity

### Per-Frame Update

For each `BoneAnimated` entity:

1. Check `requested_clip` — if different from current, transition
2. Call `anim_player.update(dt)`
3. Compute world-space bone transforms:
   - `world_transform = translate(current_pos) * rotate(facing) * scale`
   - `bone_world[i] = to_world * bone_local[i] * from_world`
4. Write transforms into the bone SSBO at `[first_bone_index .. first_bone_index + bone_count)`

### Clip Selection Convention

Behavior components set `requested_clip` on the `BoneAnimated` side map entry:

- `NpcWalker`: `"walk"` when moving, `"idle"` when paused
- Future components can set any clip name from the manifest

## What Gets Removed from `island_demo_state.cpp`

- `KnightInfo` struct and `knight_info_` member
- `knight_data_`, `knight_anim_player_`, `knight_anim_sm_` members
- `NpcInfo` struct and `npc_infos_` member  
- `next_bone_index_` member
- Knight spawning code in `on_enter()` (~60 lines)
- Slime Gaussian merging in `on_enter()` (~40 lines)
- Knight/slime bone transform gathering in `update_walk_animation()` (~80 lines)
- All NPC re-spawn code in portal transition (~70 lines)

## What Stays in `island_demo_state.cpp`

- Player character spawning and animation (special root motion, jump arcs, camera coupling)
- Portal transition logic (simplified: `world.clear()` + `init_scene()` + re-create player entity)
- Player bone transform upload (bones 0-7)

## Scene JSON Updates

### `seurat_island.json`

Add `BoneAnimated` component to existing knight and slime game objects:

```json
{
  "id": "knight_01",
  "name": "Knight",
  "position": [202, 0, 187],
  "ply_file": "assets/characters/knight/knight.ply",
  "scale": 0.45,
  "components": {
    "BoneAnimated": {
      "manifest": "assets/characters/knight/knight.manifest.json",
      "default_clip": "idle"
    },
    "NpcWalker": { "patrol_radius": 12.0, "speed": 8.0, "pause_duration": 1.5 }
  }
}
```

Slime NPCs similarly get `BoneAnimated` with `"manifest": "assets/characters/slime/slime.manifest.json"`.

### `dungeon.json` / `northern_forest.json`

These scenes can now add animated NPCs by just adding game objects with `BoneAnimated` — no C++ changes needed.

## Testing

1. **Build succeeds** — no compilation errors
2. **Startup** — Knight and slimes appear with animation on the island
3. **Portal round-trip** — Enter dungeon, exit back. NPCs present without re-spawn code.
4. **Bone indices** — Log bone allocations at load time, verify no overlap with player (0-7)
5. **Animation playback** — Knight patrols with walk/idle transitions, slimes bounce
6. **No regressions** — Player animation, portal transitions, collision all unchanged
