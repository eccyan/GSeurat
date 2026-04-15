# Promote Bone Animation to Engine Layer

**Date:** 2026-04-13
**Status:** Draft

## Problem

`BoneAnimationRegistry`, `BoneAnimatedTag`, and `bone_animation_system` live in the demo layer (`island_components.hpp`, `island_systems.cpp`, `bone_animation_registry.hpp`). This means any new game state that wants data-driven bone-animated NPCs must duplicate the registry wiring, population from `BoneAllocation`, transform upload, and lifecycle management. The scene loader already handles bone slot allocation at the engine level, but the runtime side is demo-only.

## Goal

Move these three pieces to the engine layer so any game built on GSeurat gets data-driven bone animation out of the box. `AppBase` owns the registry, clears it automatically on scene transitions, registers `bone_animation_system` as an engine-level system, and populates the registry from `BoneAllocation` data after scene load.

## Design Decisions

### AppBase Ownership

`AppBase` owns a `BoneAnimationRegistry` instance and exposes it via `bone_animation_registry()` accessor. This parallels `gs_terrain()`, `scene_objects()`, and `draw_lists()`.

The registry is cleared in `AppBase::clear_scene()` (which `GsTerrainState::reset()` already clears bone_allocations). The registry is populated in `AppBase::load_gs_scene()` after entity creation, replacing the manual population loops currently in `island_demo_state.cpp`.

### No More Global Accessor

The current `set_bone_animation_registry()` / `get_bone_animation_registry()` global pointer pattern is eliminated. `bone_animation_system` becomes a method or uses the registry passed through the system scheduler. Since the system scheduler already passes `ecs::World&`, and the registry lives on `AppBase`, the system needs access to `AppBase`. The cleanest approach: `bone_animation_system` takes an `AppBase&` parameter, registered as a bound lambda.

### Bone Transform Upload

The bone transform gathering loop (lines 1474-1498 of `island_demo_state.cpp`) moves to a new engine-level function `gather_bone_animation_transforms()`. The demo state calls this after writing player bones, before `upload_bone_transforms`. This keeps player-specific bone logic in the demo while NPC bone gathering is engine-level.

### File Moves

| From (demo) | To (engine) |
|---|---|
| `include/gseurat/demo/bone_animation_registry.hpp` | `include/gseurat/engine/bone_animation_registry.hpp` |
| `BoneAnimatedTag` in `island_components.hpp` | `include/gseurat/engine/bone_animated_component.hpp` |
| `bone_animation_system` in `island_systems.cpp` | `src/engine/bone_animation_system.cpp` + `include/gseurat/engine/bone_animation_system.hpp` |

### Registry Population

`AppBase::load_gs_scene()` already creates ECS entities for game objects. After entity creation, it populates the registry from `bone_allocations` — the same loop currently duplicated in `island_demo_state.cpp` (on_enter and portal return). This eliminates both copies.

The chunk NPC merging code in `island_demo_state.cpp` (lines 330-398) also populates `bone_allocations`. Since chunks are demo-specific (world streaming), this stays in the demo. The registry population in `load_gs_scene` picks up all allocations regardless of source.

### What Changes in IslandDemoState

- Remove `bone_anim_registry_` member — use `app.bone_animation_registry()` instead
- Remove `set_bone_animation_registry(&bone_anim_registry_)` and `set_bone_animation_registry(nullptr)` calls
- Remove both registry population loops (on_enter and portal return) — `load_gs_scene` handles it
- Remove `bone_animation_system` registration — engine registers it automatically
- Replace bone transform gathering with call to engine-level `gather_bone_animation_transforms()`
- Portal return: after `init_scene`, registry is already populated. Just need to re-populate for chunk NPCs (handled by chunk processing code that writes to `bone_allocations`, then a single `populate_bone_registry()` call)

### What Stays in IslandDemoState

- Player character animation (CharacterData, BoneAnimationPlayer, anim_sm) — special root motion, jump arcs, camera coupling
- Player bone transform upload (bones 0-7)
- Chunk NPC PLY merging (world streaming is demo-level)
- Portal transition logic

### NpcWalker Registry Access

`npc_walker_system` currently uses the global `g_bone_anim_registry` pointer to set `requested_clip` and `facing_angle`. With the global removed, `npc_walker_system` needs access to the registry. Two options:

Since `NpcWalker` stays in the demo layer (it's a behavior component, not engine infrastructure), the npc_walker_system will accept the registry as a captured pointer in its lambda registration, same pattern as other demo systems that access app state.

## New Engine API

### bone_animation_registry.hpp (moved, unchanged API)

```cpp
// include/gseurat/engine/bone_animation_registry.hpp
namespace gseurat {
struct BoneAnimationEntry { /* unchanged */ };
class BoneAnimationRegistry { /* unchanged */ };
}
```

### bone_animated_component.hpp (new file)

```cpp
// include/gseurat/engine/bone_animated_component.hpp
#pragma once
#include <cstdint>

namespace gseurat {

/// Marker component for bone-animated entities.
/// Actual animation state lives in BoneAnimationRegistry (side map).
struct BoneAnimatedTag {
    uint32_t registry_id = 0;
};

}  // namespace gseurat
```

### bone_animation_system.hpp (new file)

```cpp
// include/gseurat/engine/bone_animation_system.hpp
#pragma once
#include "gseurat/engine/ecs/world.hpp"
#include <glm/glm.hpp>

namespace gseurat {

class AppBase;
class BoneAnimationRegistry;

/// Engine-level bone animation update. Iterates BoneAnimatedTag entities,
/// lazy-inits from manifests, advances playback.
void bone_animation_system(ecs::World& world, float dt, BoneAnimationRegistry& registry);

/// Gather NPC bone transforms from the registry into a bone array.
/// Writes transforms at [first_bone_index .. first_bone_index + bone_count) for each entry.
/// Returns the highest bone slot used (for total_bones calculation).
[[nodiscard]] uint32_t gather_bone_animation_transforms(
    const BoneAnimationRegistry& registry,
    glm::mat4* bones,
    uint32_t max_bones = 32);

/// Populate registry from BoneAllocation data + existing ECS entities.
void populate_bone_animation_registry(
    BoneAnimationRegistry& registry,
    ecs::World& world,
    const struct GsTerrainState& terrain);

}  // namespace gseurat
```

### AppBase additions

```cpp
// In app_base.hpp
#include "gseurat/engine/bone_animation_registry.hpp"

// Public accessor:
BoneAnimationRegistry& bone_animation_registry() { return bone_anim_registry_; }
const BoneAnimationRegistry& bone_animation_registry() const { return bone_anim_registry_; }

// Protected member:
BoneAnimationRegistry bone_anim_registry_;
```

### Lifecycle Integration

- `AppBase::clear_scene()`: add `bone_anim_registry_.clear();`
- `AppBase::load_gs_scene()`: after entity creation, call `populate_bone_animation_registry()`
- `AppBase::init_game_object_system()`: register `bone_animation_system` as engine system
- `AppBase::init_game_object_system()`: move `BoneAnimatedTag` registration here (already there, just update include)

## Testing

1. **Build succeeds** — both debug and release
2. **Startup** — Knight and slimes appear with animation on the island
3. **Portal round-trip** — Enter dungeon, exit back. NPCs present. Registry auto-populated.
4. **Bone indices** — Log bone allocations at load time, verify no overlap with player (0-7)
5. **Animation playback** — Knight patrols with walk/idle transitions, slimes bounce
6. **Forest NPCs** — Chunk-loaded NPCs (forest guardian, patrol knight) animate correctly
7. **No regressions** — Player animation, portal transitions, collision all unchanged
