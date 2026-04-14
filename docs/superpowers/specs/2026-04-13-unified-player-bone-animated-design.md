# Unified Player Character with BoneAnimated Registry

**Date:** 2026-04-13
**Status:** Draft

## Problem

The player character uses separate `character_data_`, `anim_player_`, `anim_sm_` members on `IslandDemoState`, with ~80 lines of manual bone transform math in `update_walk_animation()`. This duplicates what the engine-level `BoneAnimationRegistry` and `gather_bone_animation_transforms()` already do for NPCs. Two code paths for the same operation.

## Goal

Make the player character use a `BoneAnimationEntry` in the `BoneAnimationRegistry`, eliminating the duplicate animation machinery. The player entity remains code-created (not scene JSON) because of the bone 0 terrain sway and +1 bone index offset.

## Design

### BoneAnimationEntry Changes

Add one field:

```cpp
float y_offset = 0.0f;  // additive visual Y offset (jump arc, bounce)
```

`gather_bone_animation_transforms()` applies `y_offset` to `current_pos.y` when building the `to_world` matrix:

```cpp
glm::vec3 effective_pos = entry.current_pos;
effective_pos.y += entry.y_offset;
// ... use effective_pos in to_world matrix
```

### Player Registration

After PLY merge in `on_enter()`, the player creates its own `BoneAnimationEntry` manually (not via `populate_bone_animation_registry()`, since the player has special bone allocation):

```cpp
BoneAnimationEntry player_entry;
player_entry.manifest_path = "assets/characters/snes_hero/snes_hero.manifest.json";
player_entry.default_clip = "idle";
player_entry.first_bone_index = 1;  // bone 0 = terrain sway
player_entry.bone_count = character_data->bones.size();  // 6 for snes_hero
player_entry.char_scale = kCharScale;
player_entry.gs_scale_multiplier = gs_scale_;
player_entry.spawn_pos = player_pos;
player_entry.current_pos = player_pos;
// Transfer ownership of CharacterData to the entry
player_entry.character_data = std::move(character_data);
player_entry.anim_player = std::make_unique<BoneAnimationPlayer>(*player_entry.character_data);
player_entry.anim_sm = std::make_unique<BoneAnimationStateMachine>(*player_entry.anim_player);
// Register clips
for (const auto& clip : player_entry.character_data->clips) {
    player_entry.anim_sm->add_state(clip.name, clip.name);
}
player_entry.anim_sm->set_state("idle");
player_entry.initialized = true;  // skip lazy init in bone_animation_system
player_registry_id_ = app.bone_animation_registry().add(player_entity_, std::move(player_entry));
```

The player entry is pre-initialized (set `initialized = true`) to skip the lazy init in `bone_animation_system`, since we need to set up the state machine with the correct clips immediately.

### Player Behavior (update_walk_animation)

Simplified flow:

1. **Write bone 0** — terrain sway, unchanged
2. **Access player entry** via `app.bone_animation_registry().get(player_registry_id_)`
3. **Set per-frame state:**
   - `entry->current_pos = character_origin_`
   - `entry->facing_angle = facing_angle_`
   - `entry->y_offset = jump_y` (0 when not jumping)
   - `entry->requested_clip = speed > 0.1f ? "walk" : "idle"` (or "jump" during jump)
4. **Read root motion** from `entry->anim_player`:
   - If current clip has root motion, accumulate delta into `character_origin_` and `character_rotation_`
5. **Call `gather_bone_animation_transforms()`** — handles ALL bones (player 1-7 + NPCs 8+)
6. **Upload** `bones[]` array

### What Gets Removed from IslandDemoState

**Header (`island_demo_state.hpp`):**
- `std::unique_ptr<CharacterData> character_data_`
- `std::unique_ptr<BoneAnimationPlayer> anim_player_`
- `std::unique_ptr<BoneAnimationStateMachine> anim_sm_`

**Source (`island_demo_state.cpp`):**
- Animation state machine setup in `on_enter()` (~8 lines)
- Manual `from_world` / `to_world` matrix construction in `update_walk_animation()` (~30 lines)
- Manual bone transform loop `bones[i + 1] = to_world * anim_bones[i] * from_world` (~10 lines)
- `anim_sm_` / `anim_player_` cleanup in `on_exit()`
- Direct `anim_sm_->set_state()` calls — replaced with `entry->requested_clip = ...`
- Direct `anim_player_->update(dt)` call — handled by `bone_animation_system()`

**Added:**
- `uint32_t player_registry_id_ = 0` member
- Player entry creation after PLY merge (~15 lines)
- Per-frame state setting (~5 lines)
- Root motion reading from registry entry (~10 lines)

Net reduction: ~30 lines removed, duplicate code path eliminated.

### What Stays the Same

- Player entity code-created with `PlayerController` + `Transform`
- PLY merge with +1 bone index offset (shader skips bone 0)
- Jump arc calculation (parabolic `4 * kJumpHeight * t * (1-t)`)
- Camera coupling to `character_origin_`
- Portal transition flow (player re-created in code, entry re-created manually)
- `bone_animation_system()` updates all BoneAnimated entities — including the player, since it has a tag

### Portal Transition

On portal transition:
1. `app.world().clear()` destroys player entity
2. `app.clear_scene()` clears the registry (including player entry)
3. Scene loads, NPCs get populated via `populate_bone_animation_registry()`
4. Player entity is re-created in code
5. Player `BoneAnimationEntry` is re-created and added to registry
6. `player_registry_id_` is updated

### Bone Allocation

- Bone 0: terrain sway (written directly, not via registry)
- Bones 1-7: player character (via registry, `first_bone_index = 1`)
- Bones 8+: NPCs (via registry, allocated by scene loader)

Player bone allocation is NOT part of `gs_terrain_.bone_slot_counter` (that starts at 8). The player entry's `first_bone_index = 1` is hardcoded.

### BoneAnimatedTag on Player Entity

The player entity gets a `BoneAnimatedTag` component with its `registry_id` set. This allows `bone_animation_system()` to update the player's animation (advance playback, check clip transitions) alongside NPCs.

## Testing

1. **Build succeeds** — debug and release
2. **Startup** — Player appears with idle animation at spawn
3. **Walk** — Player walks with walk animation, root motion works
4. **Jump** — Player jumps with correct Y arc and jump clip
5. **Portal round-trip** — Player animation works after entering and leaving dungeon
6. **NPCs unaffected** — Knight and slimes still animate correctly
7. **Bone indices** — Log confirms player at bones 1-7, NPCs at 8+
8. **No regressions** — Collision, camera, particles all unchanged
