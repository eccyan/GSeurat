# Island Demo Feature Integration — Design Specification

## Goal

Enhance the GSeurat "Island" demo by integrating the Kinematic Character Controller (KCC/Spec 1), cinematic camera rails, and audio stem-layer mixing into a seamless exploration experience. The player walks through a physics showcase near the dungeon portal, then crosses the bridge where a cinematic camera sweep and audio layer fade demonstrate the engine's streaming, rendering, and mixing capabilities — all without interrupting player agency.

## Architecture

Three features compose into a single continuous exploration path:

1. **KCC Showcase** (dungeon portal approach) — static primitive colliders placed as terrain obstacles; zero new engine code.
2. **Cinematic Camera Rail** (bridge crossing) — a `cinematic_rail` CameraVolume with a spline that crosses the chunk boundary; zero new engine code.
3. **Audio Stem Layer** (bridge crossing, co-located) — extends `AudioZoneComponent` with per-stem fade actions (~20 lines new C++).

All inter-system communication uses spatial polling (AABB containment). No event bus, no forced input freeze.

## Constraints

- Polling-only architecture: systems communicate via shared component state and `contains(shape, player_pos)`.
- Player retains full movement control at all times.
- No new visual assets — KCC obstacles use existing wireframe debug rendering (F10).
- CollisionGrid removal and Spec 2b (3D gizmos) are explicitly out of scope.

---

## Section 1: KCC Showcase — Dungeon Portal Approach

### Purpose

Demonstrate wall-sliding, ground-probing, and smooth deflection against all three primitive collider types (Box, Sphere, Capsule). Pure showcase — zero friction, no puzzles.

### Location

~20m radius around the dungeon portal at world position [203, 1.5, 175] on seurat_island. The obstacles form a natural-looking "ruined courtyard" the player walks through when approaching the portal.

### Primitive Placement

All obstacles are static colliders (no `KinematicBody`), baked into the Static BVH via `rebuild_cache()`.

| Object | Shape | Position (approx) | Rotation | Purpose |
|--------|-------|--------------------|----------|---------|
| Angled stone wall A | Box (half_extents: [3, 2, 0.4]) | [198, 0, 170] | Y-axis ~30° | Wall-slide along angled surface |
| Angled stone wall B | Box (half_extents: [3, 2, 0.4]) | [208, 0, 172] | Y-axis ~-25° | Wall-slide, opposite angle |
| Boulder A | Sphere (radius: 1.2) | [200, 0, 178] | identity | Smooth curved deflection |
| Boulder B | Sphere (radius: 1.0) | [205, 0.5, 168] | identity | Curved deflection, elevated |
| Boulder C | Sphere (radius: 1.5) | [197, 0, 174] | identity | Large-radius slide |
| Ruined pillar A | Capsule (radius: 0.5, half_height: 1.5) | [202, 0, 173] | identity | Capsule-vs-capsule sweep |
| Ruined pillar B | Capsule (radius: 0.5, half_height: 1.5) | [206, 0, 177] | identity | Capsule-vs-capsule sweep |
| Low ramp | Box (half_extents: [2, 0.5, 3]) | [201, 0, 165] | X-axis ~15° | Ground-probe slope detection |

### ECS Configuration (per obstacle)

```
Transform:
  position: [x, y, z]
  rotation: [rx, ry, rz, rw]   # quaternion, identity for most

ColliderComponent:
  shape: Box{half_extents} | Sphere{radius} | Capsule{radius, half_height}
  offset: [0, 0, 0]
  local_rotation: identity (rotation handled by Transform)
  collision_mask: 0x01          # solid obstacle layer
  is_trigger: false
  is_dynamic: false             # → static cache → BVH
```

No `KinematicBody` on any obstacle — they are excluded from KCC self-collision by `rebuild_cache()`.

### Player Entity (unchanged)

```
PlayerController + KinematicBody + PlayerJump + ColliderComponent(Capsule)
```

The KCC sweep handles all interactions automatically. No new engine code required.

---

## Section 2: Cinematic Camera Rail — Bridge Crossing

### Purpose

Demonstrate 3DGS rendering and zero-copy loader performance via a sweeping camera movement triggered during natural exploration. The spline crosses the chunk boundary (seurat_island → northern_forest), stress-testing the WorldStreamer.

### Location

The bridge/crossing area between seurat_island and northern_forest. The existing `forest_edge` camera zone is centered at [160, 5, 100].

### 2A. CameraVolume (Cinematic Trigger)

```
CameraVolume:
  id: "bridge_cinematic"
  shape: AABB
    center: [175, 5, 120]
    half_extents: [25, 15, 15]
  params:
    mode: cinematic_rail
    rail_id: "bridge_vista_rail"
    play_on_enter: true
    playback_mode: "once"         # single sweep, then blend back
    blend_time: 1.5               # seconds, smooth transition
    target_mode: "player"         # camera looks at player during sweep
    priority: 10                  # overrides surrounding zones
```

### 2B. CameraRail (Spline Path)

A sweeping arc that rises to show the panorama across the chunk boundary:

```
Rail:
  id: "bridge_vista_rail"
  control_points:
    - [175,  8, 135]    # start: behind player, slightly elevated
    - [155, 18, 110]    # rise: pull left and up for wide view
    - [160, 22,  80]    # apex: highest point, crosses chunk boundary (z < 96)
    - [175, 18,  60]    # descend: swing right, deep in northern_forest chunk
    - [185, 12,  90]    # settle: come back down toward bridge exit
    - [180,  8, 115]    # end: near player level, close to exit
```

Points at z=80 and z=60 are in the northern_forest chunk (chunk offset z=-1, cell size z=192 → boundary at ~z=96). This forces simultaneous loading of both chunks.

### 2C. Behavior

- Player retains full movement via `PlayerController` + KCC.
- Camera follows spline via existing `cinematic_rail` mode in `CameraZoneSystem::update()`.
- `target_mode: "player"` → camera look-at tracks the player's position during the sweep.
- Sweep ends when: rail animation completes OR player exits the AABB volume — whichever first.
- On end: `CameraZoneSystem` resolves to the next-highest-priority zone and blends with `blend_time: 1.5`.

### 2D. AudioZone (Vista Stem Layer Trigger)

**Engine extension required:** `AudioZoneComponent` currently supports only group-level play/stop. We extend it with per-stem fade actions.

#### New Fields on AudioZoneComponent

```cpp
struct StemFadeAction {
    uint32_t group_id;
    uint32_t stem_index;
    float    target_volume;
    float    fade_ms;
};

// Added to AudioZoneComponent:
std::vector<StemFadeAction> stem_fade_on_enter;
std::vector<StemFadeAction> stem_fade_on_exit;
```

#### Extension to AudioZoneSystem::tick()

On zone entry, after the existing `action_on_enter` switch, iterate `stem_fade_on_enter` and call:
```cpp
engine_->set_stem_volume(action.group_id, action.stem_index,
                         action.target_volume, action.fade_ms);
```

On zone exit, same pattern with `stem_fade_on_exit`.

This is ~20 lines of additional C++. The stem fade API (`set_stem_volume`) already exists.

#### Scene Configuration

```
AudioZoneComponent:
  bounds_min: [150, -10, 105]     # center [175,5,120] - half [25,15,15]
  bounds_max: [200, 20, 135]
  track_group_id: (resolved at load time from the seurat_island BGM .music.json)
  action_on_enter: PlayOrTransition   # keep base BGM playing
  action_on_exit: PlayOrTransition    # don't stop base BGM on exit
  enter_xfade_ms: 1500
  exit_fade_ms: 1500
  stem_fade_on_enter:
    - group_id: (same as track_group_id — the seurat_island BGM group)
      stem_index: (index of "vista_strings" stem in the group's stems array)
      target_volume: 1.0
      fade_ms: 1500                   # matches camera blend_time
  stem_fade_on_exit:
    - group_id: (same as track_group_id)
      stem_index: (index of "vista_strings" stem)
      target_volume: 0.0
      fade_ms: 1500
```

#### Prerequisite: Vista Strings Stem

Add a new stem to the seurat_island BGM `.music.json`:
```json
{
  "id": "vista_strings",
  "source": "assets/audio/stems/vista_strings.ogg",
  "initial_volume": 0.0
}
```

Silent by default. Fades in only when player enters the bridge zone.

---

## Section 3: System Execution Order & Cross-Cutting Concerns

### Execution Order (existing, unchanged)

```
1. update_player(dt)              → Input → velocity
2. collision_system_.update()     → KCC sweep (wall-slide, ground-probe)
3. audio_zone_system tick         → Zone containment → stem fades
4. update_camera(dt)              → CameraZoneSystem → cinematic rail eval
5. render                         → WorldStreamer culling + Vulkan pipeline
```

Step 2 resolves the player's final position before steps 3 and 4 poll spatial containment. No one-frame-delay issues.

### Debug Visualization

- F10 wireframe toggle (`debug_colliders` feature flag) renders all static BVH colliders, including the new showcase obstacles. No changes needed.
- CameraVolume and AudioZone AABBs are not rendered by the collision wireframe pipeline (they are not `ColliderComponent` entities). They are invisible triggers by design.

### Testing Strategy

**Integration testing via Game Director:**
- Collision: place player at [203, 0, 175], walk through showcase area — no stuck/tunneling.
- Camera: place player at [175, 0, 120] — verify `cinematic_rail` mode activates.
- Audio: verify stem volume changes via `debug_dump` audio domain on zone entry/exit.
- Streaming: during camera sweep, verify both chunks loaded — no pop-in.

**Visual verification:**
- Run demo end-to-end: dungeon portal approach → bridge crossing.
- Confirm KCC wall-sliding/deflection feels smooth.
- Confirm camera sweep and audio layer fade are synchronized.

### Schema Updates

- `schemas/scene.schema.json`: add `stem_fade_on_enter` / `stem_fade_on_exit` arrays to AudioZoneComponent definition.
- `.music.json` schema: no changes needed (stems array already supports arbitrary entries).

---

## Out of Scope

- **Spec 2b** (3D gizmo interaction) — separate future work.
- **CollisionGrid removal** — deferred until all scenes verified with new system.
- **Visual assets** (3DGS models for boulders/pillars) — uses wireframe debug rendering for now.
- **SystemScheduler adoption** — exists but unused; manual call chain is sufficient.
- **New audio assets** — `vista_strings.ogg` is a placeholder; actual audio production is separate.

---

## Summary of Engine Changes Required

| Change | Scope | Files |
|--------|-------|-------|
| Add `StemFadeAction` struct and fields to `AudioZoneComponent` | ~10 lines | `audio_zone_component.hpp` |
| Extend `AudioZoneSystem::tick()` with stem fade dispatch | ~10 lines | `audio_zone_system.cpp` |
| Add vista_strings stem to BGM track group | 1 JSON entry | `.music.json` |
| Scene JSON: 8 static colliders + 1 CameraVolume + 1 CameraRail + 1 AudioZone | Content only | `world.json` or scene files |
| Schema: stem fade actions | ~15 lines | `scene.schema.json` |

**Total new engine C++: ~20 lines.** Everything else is scene-JSON content placement using existing systems.
