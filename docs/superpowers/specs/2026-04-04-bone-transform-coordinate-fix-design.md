# Bone Transform Coordinate Space Fix

**Date:** 2026-04-04
**Status:** Approved

## Problem

PC bone animations cause body parts (cape, arms, legs) to fly over the head or disappear below ground. Root cause: bone pivot rotations are computed in model space but applied to Gaussians stored in world space.

An 8-degree X-axis rotation around a model-space pivot causes the world-space Z coordinate (~197) to bleed into Y, producing ~27 units of vertical displacement on a character only ~5 units tall.

## Solution: Approach A — Fix Bone Transform Composition

Wrap the animation transform with proper world-to-model and model-to-world coordinate conversions in `update_walk_animation()`.

### Transform Chain

Replace:
```cpp
bones[i + 1] = root_xform * anim_bones[i];
```

With:
```cpp
bones[i + 1] = to_world * anim_bones[i] * from_world;
```

Where:
- `from_world` = `Ry(-pi) * S_inv * T(-(spawn + y_offset))` — converts world position back to model space by undoing the spawning transform
- `to_world` = `T(origin + y_offset) * Ry(facing) * S * Ry(pi)` — converts model space to current world position with facing rotation
- `S` = `diag(kCharScale, kCharScale * gs_scale, kCharScale)` — the non-uniform scale applied during character spawning
- `y_offset` = `(0, 2, 0)` — the constant vertical offset added during spawning

### Mathematical Verification

For a left-arm Gaussian at world pos `(187.6, 5.35, 197)` with joint pivot at `(-1.35, 0.45, 0)` and 8-degree X rotation:

**Before fix (current bug):**
- Rotation applied in world space: `Y' = 5*cos(8) - 197*sin(8) = -22.5` (27-unit displacement)

**After fix:**
- `from_world` converts to model space: `(-1.33, 3.0, 0)` (near pivot)
- Rotation applied in model space: `Y' = 2.55*cos(8) = 2.525` (0.025-unit displacement)
- `to_world` converts back to world space with correct small offset

### State Storage

Add `gs_scale_` (float) as a member variable of `IslandDemoState`, initialized from `scene_data.gaussian_splat->scale_multiplier` during `init_scene()`.

All other required values (`character_spawn_pos_`, `character_origin_`, `facing_angle_`, `kCharScale`) are already stored.

### Scope

- **Changed:** `update_walk_animation()` in `island_demo_state.cpp` (transform composition)
- **Changed:** `IslandDemoState` class — add `gs_scale_` member
- **Unchanged:** `bone_animation_player.cpp` — FK chain stays the same
- **Unchanged:** `character_manifest.cpp` — manifest loading stays the same
- **Unchanged:** `gs_preprocess.comp` — GPU shader stays the same
- **Unchanged:** `snes_hero.manifest.json` — animation data stays the same
- **Unchanged:** Terrain bone (index 0) and NPC bones — not affected

### Testing

1. Build and launch demo
2. Walk the PC in all directions — verify limbs stay attached to body
3. Verify idle breathing animation looks natural
4. Verify walk-to-idle and idle-to-walk transitions
5. Verify NPC slimes still animate correctly
6. Verify terrain sway still works
