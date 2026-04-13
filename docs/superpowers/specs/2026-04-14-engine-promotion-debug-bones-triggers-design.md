# Engine Promotion: Debug Overlay, Bone Orchestration, Trigger Systems

**Date:** 2026-04-14
**Status:** Draft

## Problem

Three categories of functionality live in the demo/staging layer but are general-purpose engine concerns:

1. **Debug visualization** — Staging has 3D gizmos (wireframe spheres, boxes, region shapes) and performance metrics via ImGui. The demo app has no gizmo support and duplicates FPS tracking logic. Developers debugging the demo must switch to Staging or add ad-hoc logging.

2. **Bone animation orchestration** — `IslandDemoState::update_walk_animation()` directly calls `gather_bone_animation_transforms()` and `upload_bone_transforms()` every frame (~25 lines). Any app with characters must duplicate this orchestration.

3. **Trigger systems** — `ProximityTrigger`, `LinkedTrigger`, `EmissiveToggle`, `NpcWalker`, `CollisionGridRef` are demo-only components with systems in `island_systems.cpp`. These are generic ECS patterns, not island-specific.

## Goal

Promote all three to the engine layer so both demo and staging (and future apps) get them for free.

---

## Part 1: Engine Debug Overlay

### UIContext Line/Circle Primitives

Add two methods to `UIContext`:

```cpp
void line(float x1, float y1, float x2, float y2, float thickness,
          glm::vec4 color = {1.0f, 1.0f, 1.0f, 1.0f});
void circle(float cx, float cy, float radius, int segments,
            float thickness, glm::vec4 color = {1.0f, 1.0f, 1.0f, 1.0f});
```

`line()` emits a thin rotated quad (two triangles) via `SpriteDrawInfo` with a 1x1 white pixel UV region. `circle()` calls `line()` N times around the perimeter.

### Engine Debug Draw Utilities

New file: `include/gseurat/engine/debug_draw.hpp`

Pure functions for 3D-to-2D projected gizmos. No dependency on ImGui or UIContext — they accept a callback for line drawing:

```cpp
using DrawLineFn = std::function<void(float x1, float y1, float x2, float y2,
                                       float thickness, glm::vec4 color)>;

bool project_to_screen(const glm::vec3& world_pos, const glm::mat4& vp,
                        float screen_w, float screen_h, float& sx, float& sy);

void draw_sphere_gizmo(const glm::vec3& center, float radius,
                         const glm::mat4& vp, float sw, float sh,
                         glm::vec4 color, const DrawLineFn& draw_line);

void draw_box_gizmo(const glm::vec3& center, const glm::vec3& half_extents,
                      const glm::mat4& vp, float sw, float sh,
                      glm::vec4 color, const DrawLineFn& draw_line);

void draw_region_gizmo(const GsAnimRegion& region, const glm::vec3& offset,
                         const glm::mat4& vp, float sw, float sh,
                         glm::vec4 color, const DrawLineFn& draw_line);
```

Staging's `draw_gizmos()` can switch to calling these with an ImGui-backed `DrawLineFn`. Demo can call them with a UIContext-backed `DrawLineFn`. The math moves from `staging_state.cpp` to the engine.

### DebugMetrics in AppBase

New struct in `app_base.hpp`:

```cpp
struct DebugMetrics {
    float fps = 0.0f;
    float frame_times[300]{};
    int frame_time_idx = 0;
    int frame_count = 0;
    std::chrono::steady_clock::time_point fps_clock{};
    static constexpr float kFpsUpdateInterval = 0.5f;

    void update(float dt);  // advance ring buffer, compute FPS
};
```

`AppBase` owns a `DebugMetrics debug_metrics_` member and calls `debug_metrics_.update(dt)` in `main_loop()`. Both demo HUD and staging performance panel read from it instead of maintaining their own FPS counters.

**Removed from demo:** `fps_`, `fps_frame_count_`, `fps_clock_` members from `IslandDemoState`.
**Removed from staging:** `fps_`, `fps_timer_`, `frame_times_`, `frame_time_idx_`, `frame_count_` members from `StagingState`.

---

## Part 2: Bone Animation Orchestration

### Current Flow (demo)

```
IslandDemoState::update_walk_animation():
  1. Write bone 0 (terrain sway)
  2. Set entry->current_pos, facing_angle, y_offset, requested_clip
  3. Read root motion delta from entry->anim_player
  4. Call gather_bone_animation_transforms() into local bones[32]
  5. Call upload_bone_transforms()
```

Steps 4-5 are pure engine work. Steps 1-3 are player behavior.

### New Flow

`AppBase::update_game(dt)` gains a bone orchestration step after `system_scheduler_.run_all()`:

```cpp
void AppBase::update_game(float dt) {
    system_scheduler_.run_all(world_, dt);

    // Bone animation orchestration (after all behavior systems have set
    // requested_clip, current_pos, facing_angle, y_offset on their entries)
    if (!bone_anim_registry_.entries().empty()) {
        glm::mat4 bones[32];
        // Bone 0 left as identity — demo overrides it before upload if needed
        bones[0] = glm::mat4(1.0f);
        uint32_t highest = gather_bone_animation_transforms(
            bone_anim_registry_, bones, 32);
        uint32_t total = std::max(highest, gs_terrain_.bone_slot_counter);
        renderer_.gs_renderer().upload_bone_transforms(bones, static_cast<int>(total));
    }
}
```

### Demo Changes

`update_walk_animation()` simplifies to:

1. Compute terrain sway → write `bones_override_[0]` (new member, or pass to AppBase)
2. Set player entry fields: `current_pos`, `facing_angle`, `y_offset`, `requested_clip`
3. Read root motion from `entry->anim_player`

No more `gather_bone_animation_transforms()` or `upload_bone_transforms()` calls in demo.

### Bone 0 Override Mechanism

The demo needs to write bone 0 (terrain sway) before upload. Add a hook:

```cpp
// In AppBase:
std::function<void(glm::mat4* bones, uint32_t count)> bone_pre_upload_hook_;
```

Demo sets this in `on_enter()`:
```cpp
app.set_bone_pre_upload_hook([this](glm::mat4* bones, uint32_t) {
    float sway_y = std::sin(env_anim_time_ * 1.0f) * 0.05f;
    float sway_x = std::sin(env_anim_time_ * 0.6f) * 0.02f;
    bones[0] = glm::translate(glm::mat4(1.0f), glm::vec3(sway_x, sway_y, 0.0f));
});
```

And clears it in `on_exit()`:
```cpp
app.set_bone_pre_upload_hook(nullptr);
```

### Actor Rotation

`set_actor_rotation(character_rotation_)` stays in demo's `update_walk_animation()` — it's player-specific state that the engine doesn't need to know about.

Wait — the engine orchestration needs it too since it affects the GS preprocess shader. Two options:

**Option chosen:** Add `actor_rotation` to `AppBase` or let the demo call `set_actor_rotation()` after `update_game()`. Since `update_walk_animation()` runs before `build_draw_lists()`, the demo can call `set_actor_rotation()` in its update pass. The engine upload happens in `update_game()`, the rotation is set separately — both happen before render. This keeps it simple.

---

## Part 3: Generic Trigger Systems

### Component Migration

Move from `island_components.hpp` to new `engine/trigger_components.hpp`:

| Component | Why engine-level |
|-----------|-----------------|
| `ProximityTrigger` | Generic spatial trigger, used by any game |
| `LinkedTrigger` | Generic chain reaction, reusable |
| `EmissiveToggle` | Generic glow-on-proximity, reusable |
| `NpcWalker` | Generic patrol AI, reusable |
| `CollisionGridRef` | Singleton for grid access, any app needs it |
| `EmitterToggle` | Generic emitter activation, reusable |
| `LightToggle` | Generic light activation, reusable |

**Stay in demo** (island-specific):

| Component | Why demo-specific |
|-----------|------------------|
| `PlayerController` | Game-specific player movement tuning |
| `BurstEffect` | Island celebration effect |
| `ScatterEffect` | Island scatter effect |
| `AnimationTrigger` | Island GS animation effect (references GsAnimEffect names) |
| `DiscoveryZone` | Island exploration mechanic |
| `VfxTrigger` | Island VFX composition trigger |

### System Migration

Move from `island_systems.cpp` to new `engine/trigger_systems.cpp`:

```cpp
void proximity_trigger_system(ecs::World& world, float dt);
void linked_trigger_system(ecs::World& world, float dt);
void emissive_toggle_system(ecs::World& world, float dt);
void npc_walker_system(ecs::World& world, float dt, BoneAnimationRegistry& registry);
```

`npc_walker_system` signature changes: takes `BoneAnimationRegistry&` parameter instead of using the `g_npc_bone_registry` global. This matches the pattern established for `bone_animation_system`.

### Registration

`AppBase::init_game_object_system()` registers:
- All 7 promoted components (ProximityTrigger, LinkedTrigger, EmissiveToggle, NpcWalker, CollisionGridRef, EmitterToggle, LightToggle)
- All 4 systems as engine-level systems

Component registrations move from `app_base.cpp` (where they currently live referencing demo headers) to the same function but now referencing engine headers.

### Header Changes

- `island_components.hpp` keeps only: `PlayerController`, `BurstEffect`, `ScatterEffect`, `AnimationTrigger`, `DiscoveryZone`, `VfxTrigger`
- `island_components.hpp` adds: `#include "gseurat/engine/trigger_components.hpp"` for backward compatibility (demo code that includes island_components still sees ProximityTrigger etc.)
- `island_systems.hpp` — delete entirely (all four systems promoted to engine)
- `app_base.cpp` drops `#include "gseurat/demo/island_components.hpp"` — uses engine headers only

### Global State Elimination

`set_npc_bone_registry()` and `g_npc_bone_registry` are removed. The system registration lambda captures `this`:

```cpp
system_scheduler_.add_system({"npc_walker",
    [this](ecs::World& w, float dt) {
        npc_walker_system(w, dt, bone_anim_registry_);
    }, {}, {}});
```

Same pattern as the existing `bone_animation_system` registration.

---

## File Summary

### New Files
| File | Purpose |
|------|---------|
| `include/gseurat/engine/debug_draw.hpp` | 3D gizmo projection utilities |
| `src/engine/debug_draw.cpp` | Implementation |
| `include/gseurat/engine/trigger_components.hpp` | Promoted trigger/walker components |
| `include/gseurat/engine/trigger_systems.hpp` | Promoted system declarations |
| `src/engine/trigger_systems.cpp` | Promoted system implementations |

### Modified Files
| File | Changes |
|------|---------|
| `include/gseurat/engine/ui/ui_context.hpp` | Add `line()`, `circle()` |
| `src/engine/ui/ui_context.cpp` | Implement line/circle rendering |
| `include/gseurat/engine/app_base.hpp` | Add `DebugMetrics`, `bone_pre_upload_hook_`, accessor |
| `src/engine/app_base.cpp` | Bone orchestration in `update_game()`, register promoted systems, use engine headers |
| `include/gseurat/demo/island_components.hpp` | Remove promoted components, add include |
| `include/gseurat/demo/island_systems.hpp` | Remove promoted systems (or delete file) |
| `src/demo/island_systems.cpp` | Remove promoted systems, remove global registry |
| `src/demo/island_demo_state.cpp` | Remove bone gather/upload, remove FPS tracking, simplify update_walk_animation |
| `include/gseurat/demo/island_demo_state.hpp` | Remove FPS members |
| `src/staging/staging_state.cpp` | Optionally call engine gizmo helpers, remove FPS members |
| `include/gseurat/staging/staging_state.hpp` | Remove FPS members |
| `CMakeLists.txt` | Add new engine source files |

### Deleted Files
| File | Reason |
|------|--------|
| `include/gseurat/demo/island_systems.hpp` | All systems promoted to engine |
| `src/demo/island_systems.cpp` | All systems promoted to engine |

## Testing

1. **Build succeeds** — debug and release
2. **Demo startup** — Player appears, idle animation, NPCs patrol
3. **Demo HUD** — Tab cycles HUD modes, FPS reads from `DebugMetrics`
4. **NPC patrol** — Knight and slimes walk, animate, respect collision
5. **Proximity triggers** — Torches, crystals, animation triggers all fire
6. **Linked triggers** — Chain reactions still work
7. **Emissive toggle** — Crystal glow on/off with proximity
8. **Jump** — Player jump arc with y_offset works via bone orchestration
9. **Portal round-trip** — Animation works after dungeon entry/exit
10. **Staging gizmos** — Staging still renders gizmos (can optionally use engine helpers)
11. **No regressions** — Camera, particles, collision, audio unchanged
