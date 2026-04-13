# Engine Promotion: Debug Overlay, Bone Orchestration, Trigger Systems — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote debug visualization, bone animation orchestration, and trigger systems from demo/staging to engine layer.

**Architecture:** Three promotions that touch overlapping files. Part 1 adds line/circle to UIContext and engine-level gizmo/metric utilities. Part 2 moves bone gather+upload into AppBase::update_game(). Part 3 moves trigger components and systems to engine, eliminating demo-layer island_systems entirely.

**Tech Stack:** C++23, GLM, ECS (header-only archetype), Vulkan (SpriteDrawInfo for rendering)

---

### Task 1: UIContext line() and circle() primitives

**Files:**
- Modify: `include/gseurat/engine/ui/ui_context.hpp`
- Modify: `src/engine/ui/ui_context.cpp`

- [ ] **Step 1: Add line() and circle() declarations to UIContext**

In `include/gseurat/engine/ui/ui_context.hpp`, add after the `panel()` method (line 48):

```cpp
void line(float x1, float y1, float x2, float y2, float thickness,
          glm::vec4 color = {1.0f, 1.0f, 1.0f, 1.0f});
void circle(float cx, float cy, float radius, int segments,
            float thickness, glm::vec4 color = {1.0f, 1.0f, 1.0f, 1.0f});
```

- [ ] **Step 2: Implement line() in UIContext**

In `src/engine/ui/ui_context.cpp`, add after the `panel()` method (after line 144):

```cpp
void UIContext::line(float x1, float y1, float x2, float y2, float thickness,
                     glm::vec4 color) {
    float dx = x2 - x1;
    float dy = y2 - y1;
    if (std::abs(dx) < 0.001f && std::abs(dy) < 0.001f) return;

    float cx = (x1 + x2) * 0.5f;
    float cy = (y1 + y2) * 0.5f;

    // SpriteDrawInfo is axis-aligned, so approximate lines as thin rects.
    // For debug wireframes (projected box edges, circle segments) this is
    // sufficient — most segments are near-axis-aligned after 3D→2D projection.
    if (std::abs(dx) >= std::abs(dy)) {
        draw_rect(cx, cy, std::abs(dx), std::max(thickness, std::abs(dy)), color);
    } else {
        draw_rect(cx, cy, std::max(thickness, std::abs(dx)), std::abs(dy), color);
    }
}
```

- [ ] **Step 3: Implement circle() in UIContext**

In `src/engine/ui/ui_context.cpp`, add after `line()`:

```cpp
void UIContext::circle(float cx, float cy, float radius, int segments,
                       float thickness, glm::vec4 color) {
    if (segments < 3) segments = 3;
    float step = 2.0f * 3.14159265f / static_cast<float>(segments);
    for (int i = 0; i < segments; i++) {
        float a1 = static_cast<float>(i) * step;
        float a2 = static_cast<float>(i + 1) * step;
        float x1 = cx + std::cos(a1) * radius;
        float y1 = cy + std::sin(a1) * radius;
        float x2 = cx + std::cos(a2) * radius;
        float y2 = cy + std::sin(a2) * radius;
        line(x1, y1, x2, y2, thickness, color);
    }
}
```

- [ ] **Step 4: Build and verify**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add include/gseurat/engine/ui/ui_context.hpp src/engine/ui/ui_context.cpp
git commit -m "feat(ui): add line() and circle() primitives to UIContext"
```

---

### Task 2: Engine debug_draw utilities (3D gizmo projection)

**Files:**
- Create: `include/gseurat/engine/debug_draw.hpp`
- Create: `src/engine/debug_draw.cpp`
- Modify: `CMakeLists.txt`

- [ ] **Step 1: Create debug_draw.hpp**

Create `include/gseurat/engine/debug_draw.hpp`:

```cpp
#pragma once

#include "gseurat/engine/gs_animator.hpp"  // GsAnimRegion

#include <glm/glm.hpp>
#include <functional>

namespace gseurat {

using DrawLineFn = std::function<void(float x1, float y1, float x2, float y2,
                                       float thickness, glm::vec4 color)>;

// Project a 3D world position to 2D screen coordinates.
// Returns false if the point is behind the camera.
bool project_to_screen(const glm::vec3& world_pos, const glm::mat4& vp,
                        float screen_w, float screen_h,
                        float& out_x, float& out_y);

// Draw a wireframe sphere (projected circle on screen).
void draw_sphere_gizmo(const glm::vec3& center, float radius,
                         const glm::mat4& vp, float sw, float sh,
                         glm::vec4 color, const DrawLineFn& draw_line);

// Draw a wireframe axis-aligned box (8 corners, 12 edges).
void draw_box_gizmo(const glm::vec3& center, const glm::vec3& half_extents,
                      const glm::mat4& vp, float sw, float sh,
                      glm::vec4 color, const DrawLineFn& draw_line);

// Draw a region wireframe (sphere or box depending on shape).
void draw_region_gizmo(const GsAnimRegion& region, const glm::vec3& offset,
                         const glm::mat4& vp, float sw, float sh,
                         glm::vec4 color, const DrawLineFn& draw_line);

}  // namespace gseurat
```

- [ ] **Step 2: Create debug_draw.cpp**

Create `src/engine/debug_draw.cpp`:

```cpp
#include "gseurat/engine/debug_draw.hpp"

#include <algorithm>
#include <cmath>

namespace gseurat {

bool project_to_screen(const glm::vec3& world_pos, const glm::mat4& vp,
                        float screen_w, float screen_h,
                        float& out_x, float& out_y) {
    glm::vec4 clip = vp * glm::vec4(world_pos, 1.0f);
    if (clip.w <= 0.001f) return false;
    glm::vec3 ndc = glm::vec3(clip) / clip.w;
    if (ndc.z < 0.0f || ndc.z > 1.0f) return false;
    out_x = (ndc.x * 0.5f + 0.5f) * screen_w;
    out_y = (1.0f - (ndc.y * 0.5f + 0.5f)) * screen_h;  // Y-down for screen
    return true;
}

void draw_sphere_gizmo(const glm::vec3& center, float radius,
                         const glm::mat4& vp, float sw, float sh,
                         glm::vec4 color, const DrawLineFn& draw_line) {
    float cx, cy;
    if (!project_to_screen(center, vp, sw, sh, cx, cy)) return;

    // Project an edge point to estimate screen-space radius
    glm::vec3 edge = center + glm::vec3(radius, 0.0f, 0.0f);
    float ex, ey;
    float sr = 15.0f;  // fallback screen radius
    if (project_to_screen(edge, vp, sw, sh, ex, ey)) {
        sr = std::abs(ex - cx);
        sr = std::clamp(sr, 3.0f, 300.0f);
    }

    // Draw circle as line segments
    constexpr int segments = 24;
    constexpr float step = 2.0f * 3.14159265f / static_cast<float>(segments);
    for (int i = 0; i < segments; i++) {
        float a1 = static_cast<float>(i) * step;
        float a2 = static_cast<float>(i + 1) * step;
        float x1 = cx + std::cos(a1) * sr;
        float y1 = cy + std::sin(a1) * sr;
        float x2 = cx + std::cos(a2) * sr;
        float y2 = cy + std::sin(a2) * sr;
        draw_line(x1, y1, x2, y2, 1.5f, color);
    }
}

void draw_box_gizmo(const glm::vec3& center, const glm::vec3& half,
                      const glm::mat4& vp, float sw, float sh,
                      glm::vec4 color, const DrawLineFn& draw_line) {
    glm::vec3 corners[8] = {
        center + glm::vec3(-half.x, -half.y, -half.z),
        center + glm::vec3( half.x, -half.y, -half.z),
        center + glm::vec3( half.x,  half.y, -half.z),
        center + glm::vec3(-half.x,  half.y, -half.z),
        center + glm::vec3(-half.x, -half.y,  half.z),
        center + glm::vec3( half.x, -half.y,  half.z),
        center + glm::vec3( half.x,  half.y,  half.z),
        center + glm::vec3(-half.x,  half.y,  half.z),
    };
    float pts_x[8], pts_y[8];
    bool vis[8];
    for (int i = 0; i < 8; i++) {
        vis[i] = project_to_screen(corners[i], vp, sw, sh, pts_x[i], pts_y[i]);
    }
    constexpr int edges[12][2] = {
        {0,1},{1,2},{2,3},{3,0}, {4,5},{5,6},{6,7},{7,4}, {0,4},{1,5},{2,6},{3,7}
    };
    for (const auto& e : edges) {
        if (vis[e[0]] && vis[e[1]]) {
            draw_line(pts_x[e[0]], pts_y[e[0]], pts_x[e[1]], pts_y[e[1]], 1.0f, color);
        }
    }
}

void draw_region_gizmo(const GsAnimRegion& region, const glm::vec3& offset,
                         const glm::mat4& vp, float sw, float sh,
                         glm::vec4 color, const DrawLineFn& draw_line) {
    glm::vec3 center = region.center + offset;
    if (region.shape == GsAnimRegion::Shape::Box) {
        draw_box_gizmo(center, region.half_extents, vp, sw, sh, color, draw_line);
    } else {
        draw_sphere_gizmo(center, region.radius, vp, sw, sh, color, draw_line);
    }
}

}  // namespace gseurat
```

- [ ] **Step 3: Add debug_draw.cpp to CMakeLists.txt**

In `CMakeLists.txt`, add after the `src/engine/bone_animation_system.cpp` line (line 190):

```cmake
    src/engine/debug_draw.cpp
```

- [ ] **Step 4: Build and verify**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add include/gseurat/engine/debug_draw.hpp src/engine/debug_draw.cpp CMakeLists.txt
git commit -m "feat(engine): add debug_draw gizmo projection utilities"
```

---

### Task 3: DebugMetrics in AppBase

**Files:**
- Modify: `include/gseurat/engine/app_base.hpp`
- Modify: `src/engine/app_base.cpp`
- Modify: `include/gseurat/demo/island_demo_state.hpp`
- Modify: `src/demo/island_demo_state.cpp`
- Modify: `include/gseurat/staging/staging_state.hpp`
- Modify: `src/staging/staging_state.cpp`

- [ ] **Step 1: Add DebugMetrics struct and member to AppBase**

In `include/gseurat/engine/app_base.hpp`, add before the `class AppBase` declaration (before line 52):

```cpp
struct DebugMetrics {
    float fps = 0.0f;
    float frame_times[300]{};
    int frame_time_idx = 0;
    int frame_count = 0;
    float timer = 0.0f;
    static constexpr float kUpdateInterval = 0.5f;

    void update(float dt) {
        frame_count++;
        timer += dt;
        if (timer >= kUpdateInterval) {
            fps = static_cast<float>(frame_count) / timer;
            frame_count = 0;
            timer = 0.0f;
        }
        frame_times[frame_time_idx] = dt * 1000.0f;
        frame_time_idx = (frame_time_idx + 1) % 300;
    }
};
```

Add a public accessor in `AppBase` (after the `screen_effects()` accessor, around line 128):

```cpp
DebugMetrics& debug_metrics() { return debug_metrics_; }
const DebugMetrics& debug_metrics() const { return debug_metrics_; }
```

Add the member in the protected section (after `screen_effects_`, around line 194):

```cpp
DebugMetrics debug_metrics_;
```

- [ ] **Step 2: Call debug_metrics_.update(dt) in main_loop()**

In `src/engine/app_base.cpp`, in `main_loop()`, add after the dt clamp (after line 83 `if (dt > 0.1f) dt = 0.1f;`):

```cpp
        debug_metrics_.update(dt);
```

- [ ] **Step 3: Remove FPS tracking from IslandDemoState**

In `include/gseurat/demo/island_demo_state.hpp`, remove these members (lines 126-129):

```cpp
    // FPS tracking
    std::chrono::steady_clock::time_point fps_clock_{};
    int fps_frame_count_ = 0;
    float fps_ = 0.0f;
```

Also remove the `<chrono>` include if no longer needed (line 17). Check: `fps_clock_` was the only chrono usage — yes, remove it.

In `src/demo/island_demo_state.cpp`, find and remove the FPS computation block (around lines 593-601):

```cpp
        auto now = std::chrono::steady_clock::now();
        if (fps_frame_count_ == 0) fps_clock_ = now;
        fps_frame_count_++;
        float elapsed = std::chrono::duration<float>(now - fps_clock_).count();
        if (elapsed >= 0.5f) {
            fps_ = static_cast<float>(fps_frame_count_) / elapsed;
            fps_frame_count_ = 0;
            fps_clock_ = now;
        }
```

Replace all `fps_` references in `build_draw_lists()` with `app.debug_metrics().fps`:

- Line 1672: `glm::vec4 fps_color = fps_ >= 30.0f ? green : red;` → `float fps_val = app.debug_metrics().fps; glm::vec4 fps_color = fps_val >= 30.0f ? green : red;`
- Line 1713: `ui.label(f1(fps_) + " FPS", ...)` → `ui.label(f1(fps_val) + " FPS", ...)`
- Line 1765: `ui.label(f1(fps_) + " FPS", ...)` → `ui.label(f1(fps_val) + " FPS", ...)`

- [ ] **Step 4: Remove FPS tracking from StagingState**

In `include/gseurat/staging/staging_state.hpp`, remove these members (lines 68-72):

```cpp
    float fps_ = 0.0f;
    float fps_timer_ = 0.0f;
    uint32_t frame_count_ = 0;
    std::array<float, 300> frame_times_{};
    int frame_time_idx_ = 0;
```

Also remove the `<array>` include (line 13) if no longer needed. Check: `frame_times_` was the only `std::array` usage — yes, remove it.

In `src/staging/staging_state.cpp`, find the FPS update block (around lines 331-339) and remove it:

```cpp
    frame_count_++;
    fps_timer_ += dt;
    if (fps_timer_ >= 0.5f) {
        fps_ = static_cast<float>(frame_count_) / fps_timer_;
        frame_count_ = 0;
        fps_timer_ = 0.0f;
    }
    frame_times_[frame_time_idx_] = dt * 1000.0f;
    frame_time_idx_ = (frame_time_idx_ + 1) % frame_times_.size();
```

Replace all `fps_` references with `app.debug_metrics().fps`:

- In `draw_performance()` (line 1061): `ImGui::Text("FPS: %.1f (%.2f ms)", fps_, ...)` → `ImGui::Text("FPS: %.1f (%.2f ms)", app.debug_metrics().fps, ...)`
- In `draw_viewport_info()` (line 670): `ImGui::Text("FPS: %.1f", fps_)` → `ImGui::Text("FPS: %.1f", app.debug_metrics().fps)`

Replace `frame_times_` and `frame_time_idx_` references with `app.debug_metrics().frame_times` and `app.debug_metrics().frame_time_idx`:

- In `draw_performance()` (line 1066): `ordered[i] = frame_times_[(frame_time_idx_ + i) % 300]` → `ordered[i] = app.debug_metrics().frame_times[(app.debug_metrics().frame_time_idx + i) % 300]`

Note: `draw_performance()` and `draw_viewport_info()` don't receive `AppBase&` — they need it. Check the signatures. They already receive `AppBase& app` as parameter (see staging_state.hpp line 45-54 — all `draw_*` methods take `AppBase& app`). Good.

- [ ] **Step 5: Build and verify**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add include/gseurat/engine/app_base.hpp src/engine/app_base.cpp \
        include/gseurat/demo/island_demo_state.hpp src/demo/island_demo_state.cpp \
        include/gseurat/staging/staging_state.hpp src/staging/staging_state.cpp
git commit -m "refactor(engine): promote DebugMetrics to AppBase, remove demo/staging FPS tracking"
```

---

### Task 4: Promote trigger components to engine

**Files:**
- Create: `include/gseurat/engine/trigger_components.hpp`
- Modify: `include/gseurat/demo/island_components.hpp`

- [ ] **Step 1: Create engine/trigger_components.hpp**

Create `include/gseurat/engine/trigger_components.hpp`:

```cpp
#pragma once

#include "gseurat/engine/collision_gen.hpp"

#include <cstdint>

namespace gseurat {

struct ProximityTrigger {
    float radius = 5.0f;
    bool one_shot = false;
    bool triggered = false;
    bool was_triggered = false;
};

struct EmitterToggle {
    uint32_t emitter_index = 0;
    bool active = false;
};

struct LightToggle {
    float color_r = 1.0f;
    float color_g = 1.0f;
    float color_b = 1.0f;
    float radius = 10.0f;
    float intensity = 1.0f;
    bool active = false;
};

struct EmissiveToggle {
    float emission = 2.0f;
    float color_r = 1.0f;
    float color_g = 1.0f;
    float color_b = 1.0f;
    float effect_radius = 3.0f;
    float current_emission = 0.0f;
    bool applied = false;
};

struct LinkedTrigger {
    uint32_t target_entity = 0;
    bool fired = false;
};

// Singleton: stores collision grid pointer for NPC systems.
struct CollisionGridRef {
    const CollisionGrid* grid = nullptr;
    float origin_x = 0.0f;
    float origin_z = 0.0f;
};

// Patrolling NPC — wanders randomly within patrol_radius of home position.
struct NpcWalker {
    float patrol_radius = 8.0f;
    float speed = 5.0f;
    float pause_duration = 2.0f;
    float home_x = 0.0f;
    float home_z = 0.0f;
    float target_x = 0.0f;
    float target_z = 0.0f;
    float pause_timer = 0.0f;
    bool initialized = false;
    bool paused = true;
};

}  // namespace gseurat
```

- [ ] **Step 2: Slim down island_components.hpp**

Replace the entire content of `include/gseurat/demo/island_components.hpp` with:

```cpp
#pragma once

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

struct BurstEffect {
    uint32_t emitter_index = 0;
    bool fired = false;
};

struct ScatterEffect {
    float radius = 2.0f;
    float lifetime = 2.0f;
    bool fired = false;
};

// Triggers a GS animation effect on nearby Gaussians when player approaches.
struct AnimationTrigger {
    char effect_name[16] = "pulse";
    float anim_radius = 5.0f;
    float lifetime = 3.0f;
    bool loop = false;
    bool fired = false;
};

// Hidden discovery zone — rewards exploration with a celebration burst.
struct DiscoveryZone {
    float color_r = 1.0f;
    float color_g = 0.8f;
    float color_b = 0.2f;
    float burst_height = 8.0f;
    bool discovered = false;
};

// Triggers a VFX instance (multi-element composition) on proximity.
struct VfxTrigger {
    char vfx_path[64] = "";
    bool fired = false;
};

}  // namespace gseurat
```

- [ ] **Step 3: Build and verify**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds (all existing code still compiles — island_components.hpp re-exports trigger types via the include)

- [ ] **Step 4: Commit**

```bash
git add include/gseurat/engine/trigger_components.hpp include/gseurat/demo/island_components.hpp
git commit -m "refactor(engine): promote trigger components to engine layer"
```

---

### Task 5: Promote trigger systems to engine

**Files:**
- Create: `include/gseurat/engine/trigger_systems.hpp`
- Create: `src/engine/trigger_systems.cpp`
- Delete: `include/gseurat/demo/island_systems.hpp`
- Delete: `src/demo/island_systems.cpp`
- Modify: `src/engine/app_base.cpp`
- Modify: `src/demo/island_demo_state.cpp`
- Modify: `CMakeLists.txt`

- [ ] **Step 1: Create engine/trigger_systems.hpp**

Create `include/gseurat/engine/trigger_systems.hpp`:

```cpp
#pragma once

#include "gseurat/engine/ecs/world.hpp"

namespace gseurat {

class BoneAnimationRegistry;

void proximity_trigger_system(ecs::World& world, float dt);
void linked_trigger_system(ecs::World& world, float dt);
void emissive_toggle_system(ecs::World& world, float dt);
void npc_walker_system(ecs::World& world, float dt, BoneAnimationRegistry& registry);

}  // namespace gseurat
```

- [ ] **Step 2: Add PlayerTag to trigger_components.hpp and create engine/trigger_systems.cpp**

The original `proximity_trigger_system` queried `PlayerController` to find the player. Since `PlayerController` stays in demo, we add a trivial `PlayerTag` to the engine. Demo attaches both `PlayerController` and `PlayerTag` to the player entity.

Add to the end of `include/gseurat/engine/trigger_components.hpp` (before closing `}`):

```cpp
// Marks the player entity for engine systems that need player position.
struct PlayerTag {};
```

Create `src/engine/trigger_systems.cpp`:

```cpp
#include "gseurat/engine/trigger_systems.hpp"
#include "gseurat/engine/trigger_components.hpp"
#include "gseurat/engine/bone_animation_registry.hpp"
#include "gseurat/engine/ecs/default_components.hpp"

#include <cmath>
#include <cstdio>
#include <cstdlib>

namespace gseurat {

void proximity_trigger_system(ecs::World& world, float dt) {
    (void)dt;
    glm::vec3 player_pos{0.0f};
    bool found = false;
    world.view<PlayerTag, ecs::Transform>().each(
        [&](ecs::Entity, PlayerTag&, ecs::Transform& t) {
            player_pos = t.position.vec();
            found = true;
        });
    if (!found) return;

    world.view<ProximityTrigger, ecs::Transform>().each(
        [&](ecs::Entity, ProximityTrigger& pt, ecs::Transform& t) {
            if (pt.one_shot && pt.was_triggered) {
                pt.triggered = true;
                return;
            }
            float dx = t.position.x() - player_pos.x;
            float dz = t.position.z() - player_pos.z;
            float dist = std::sqrt(dx * dx + dz * dz);
            bool was = pt.triggered;
            pt.triggered = dist < pt.radius;
            if (pt.triggered && !was) {
                std::fprintf(stderr, "[ProximityTrigger] ENTER at (%.1f, %.1f, %.1f) dist=%.1f\n",
                    t.position.x(), t.position.y(), t.position.z(), dist);
            }
            if (pt.triggered && pt.one_shot) {
                pt.was_triggered = true;
            }
        });
}

void linked_trigger_system(ecs::World& world, float dt) {
    (void)dt;
    world.view<LinkedTrigger, ProximityTrigger>().each(
        [&](ecs::Entity, LinkedTrigger& lt, ProximityTrigger& pt) {
            if (!pt.triggered || lt.fired) return;
            lt.fired = true;
            ecs::Entity target{lt.target_entity};
            auto* target_pt = world.try_get<ProximityTrigger>(target);
            if (target_pt) {
                target_pt->triggered = true;
                target_pt->was_triggered = true;
            }
            auto* target_et = world.try_get<EmissiveToggle>(target);
            if (target_et) {
                target_et->current_emission = target_et->emission;
            }
        });
}

void emissive_toggle_system(ecs::World& world, float dt) {
    world.view<EmissiveToggle, ProximityTrigger>().each(
        [&](ecs::Entity, EmissiveToggle& et, ProximityTrigger& pt) {
            float target = pt.triggered ? et.emission : 0.0f;
            et.current_emission += (target - et.current_emission) * std::min(1.0f, dt * 3.0f);
        });
}

void npc_walker_system(ecs::World& world, float dt, BoneAnimationRegistry& registry) {
    const CollisionGrid* grid = nullptr;
    float grid_ox = 0.0f, grid_oz = 0.0f;
    world.view<CollisionGridRef>().each(
        [&](ecs::Entity, CollisionGridRef& ref) {
            grid = ref.grid;
            grid_ox = ref.origin_x;
            grid_oz = ref.origin_z;
        });

    world.view<NpcWalker, ecs::Transform>().each(
        [&](ecs::Entity entity, NpcWalker& npc, ecs::Transform& t) {
            if (!npc.initialized) {
                npc.initialized = true;
                npc.home_x = t.position.x();
                npc.home_z = t.position.z();
                npc.target_x = npc.home_x;
                npc.target_z = npc.home_z;
                npc.paused = true;
                npc.pause_timer = 0.5f;
            }

            if (npc.paused) {
                npc.pause_timer -= dt;
                if (npc.pause_timer <= 0.0f) {
                    npc.paused = false;
                    float angle = static_cast<float>(std::rand()) / RAND_MAX * 6.28318f;
                    float dist = static_cast<float>(std::rand()) / RAND_MAX * npc.patrol_radius;
                    npc.target_x = npc.home_x + std::cos(angle) * dist;
                    npc.target_z = npc.home_z + std::sin(angle) * dist;
                }
                auto* ba_entry = registry.get_by_entity(entity);
                if (ba_entry) {
                    ba_entry->requested_clip = "idle";
                }
                return;
            }

            float dx = npc.target_x - t.position.x();
            float dz = npc.target_z - t.position.z();
            float dist = std::sqrt(dx * dx + dz * dz);

            if (dist < 1.0f) {
                npc.paused = true;
                npc.pause_timer = npc.pause_duration;
                return;
            }

            float step = npc.speed * dt;
            if (step > dist) step = dist;
            t.position.vec().x += (dx / dist) * step;
            t.position.vec().z += (dz / dist) * step;

            if (grid && grid->width > 0 && !grid->elevation.empty()) {
                int gx = static_cast<int>((t.position.x() - grid_ox) / grid->cell_size);
                int gz = static_cast<int>((t.position.z() - grid_oz) / grid->cell_size);
                if (gx >= 0 && gx < static_cast<int>(grid->width) &&
                    gz >= 0 && gz < static_cast<int>(grid->height)) {
                    if (grid->is_solid(static_cast<uint32_t>(gx),
                                       static_cast<uint32_t>(gz))) {
                        t.position.vec().x -= (dx / dist) * step;
                        t.position.vec().z -= (dz / dist) * step;
                        npc.paused = true;
                        npc.pause_timer = 0.5f;
                        return;
                    }
                    t.position.vec().y = grid->get_elevation(
                        static_cast<uint32_t>(gx), static_cast<uint32_t>(gz));
                }
            }

            auto* ba_entry = registry.get_by_entity(entity);
            if (ba_entry) {
                ba_entry->requested_clip = npc.paused ? "idle" : "walk";
                if (!npc.paused) {
                    float ddx = npc.target_x - t.position.x();
                    float ddz = npc.target_z - t.position.z();
                    if (ddx * ddx + ddz * ddz > 0.01f) {
                        ba_entry->facing_angle = std::atan2(ddx, ddz);
                    }
                }
            }
        });
}

}  // namespace gseurat
```

- [ ] **Step 3: Delete island_systems files**

Delete `include/gseurat/demo/island_systems.hpp` and `src/demo/island_systems.cpp`.

- [ ] **Step 4: Update app_base.cpp — replace demo includes with engine includes and register all systems**

In `src/engine/app_base.cpp`:

Replace `#include "gseurat/demo/island_components.hpp"` (line 4) with:
```cpp
#include "gseurat/engine/trigger_components.hpp"
#include "gseurat/engine/trigger_systems.hpp"
```

In `init_game_object_system()`, register `PlayerTag`:

```cpp
    component_registry_.register_component<PlayerTag>("PlayerTag",
        [](const nlohmann::json&) -> PlayerTag { return {}; },
        [](const PlayerTag&) -> nlohmann::json { return {}; });
```

Add the four trigger systems after the existing `bone_animation` system registration (after line 363):

```cpp
    system_scheduler_.add_system({"proximity_trigger",
        [](ecs::World& w, float dt) {
            proximity_trigger_system(w, dt);
        }, {}, {}});

    system_scheduler_.add_system({"linked_trigger",
        [](ecs::World& w, float dt) {
            linked_trigger_system(w, dt);
        }, {}, {}});

    system_scheduler_.add_system({"emissive_toggle",
        [](ecs::World& w, float dt) {
            emissive_toggle_system(w, dt);
        }, {}, {}});

    system_scheduler_.add_system({"npc_walker",
        [this](ecs::World& w, float dt) {
            npc_walker_system(w, dt, bone_anim_registry_);
        }, {}, {}});
```

- [ ] **Step 5: Update island_demo_state.cpp — remove island_systems include, add PlayerTag to player entity**

In `src/demo/island_demo_state.cpp`:

Remove `#include "gseurat/demo/island_systems.hpp"` (line 10).

Add `#include "gseurat/engine/trigger_systems.hpp"` (not strictly needed if no direct calls remain, but good for clarity — actually not needed since systems are registered via app_base).

Remove the `set_npc_bone_registry(&app.bone_animation_registry())` call in `on_enter()` (line 262).

Remove the `set_npc_bone_registry(nullptr)` call in `on_exit()` (line 527).

Find where the player entity is created and add `PlayerTag`. Search for where `PlayerController` is added to the player entity. The player entity gets `PlayerController` via `app.world().add<PlayerController>(...)`. Add `PlayerTag` there too:

```cpp
app.world().add<PlayerTag>(player_entity_);
```

- [ ] **Step 6: Update CMakeLists.txt**

Add `src/engine/trigger_systems.cpp` after `src/engine/bone_animation_system.cpp` (around line 190).

Remove `src/demo/island_systems.cpp` from the demo sources list.

- [ ] **Step 7: Build and verify**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 8: Commit**

```bash
git add include/gseurat/engine/trigger_components.hpp \
        include/gseurat/engine/trigger_systems.hpp \
        src/engine/trigger_systems.cpp \
        src/engine/app_base.cpp \
        src/demo/island_demo_state.cpp \
        CMakeLists.txt
git rm include/gseurat/demo/island_systems.hpp src/demo/island_systems.cpp
git commit -m "refactor(engine): promote trigger systems to engine, eliminate island_systems"
```

---

### Task 6: Bone animation orchestration in AppBase

**Files:**
- Modify: `include/gseurat/engine/app_base.hpp`
- Modify: `src/engine/app_base.cpp`
- Modify: `src/demo/island_demo_state.cpp`
- Modify: `include/gseurat/demo/island_demo_state.hpp`

- [ ] **Step 1: Add bone_pre_upload_hook to AppBase**

In `include/gseurat/engine/app_base.hpp`, add a public setter and protected member.

Public (after `debug_metrics()` accessor):

```cpp
    // Hook called before bone transforms are uploaded — allows overriding bone 0 etc.
    void set_bone_pre_upload_hook(std::function<void(glm::mat4*, uint32_t)> hook) {
        bone_pre_upload_hook_ = std::move(hook);
    }
```

Protected (after `debug_metrics_`):

```cpp
    std::function<void(glm::mat4*, uint32_t)> bone_pre_upload_hook_;
```

- [ ] **Step 2: Add bone orchestration to update_game()**

In `src/engine/app_base.cpp`, replace the `update_game` one-liner (line 159):

```cpp
void AppBase::update_game(float dt) { system_scheduler_.run_all(world_, dt); }
```

With:

```cpp
void AppBase::update_game(float dt) {
    system_scheduler_.run_all(world_, dt);

    // Bone animation orchestration: gather transforms and upload to GPU
    if (!bone_anim_registry_.entries().empty()) {
        glm::mat4 bones[32];
        bones[0] = glm::mat4(1.0f);  // identity — hook can override

        if (bone_pre_upload_hook_) {
            bone_pre_upload_hook_(bones, 32);
        }

        uint32_t highest = gather_bone_animation_transforms(
            bone_anim_registry_, bones, 32);
        uint32_t total = std::max(highest, gs_terrain_.bone_slot_counter);
        renderer_.gs_renderer().upload_bone_transforms(
            bones, static_cast<int>(total));
    }
}
```

Add required include at top of `app_base.cpp` if not already present:

```cpp
#include "gseurat/engine/gs_renderer.hpp"
```

(Check: `gs_renderer()` is accessed via `renderer_` which returns `GsRenderer&` — the include is likely already pulled in via `renderer.hpp`. Verify at build time.)

- [ ] **Step 3: Simplify island_demo_state update_walk_animation()**

In `src/demo/island_demo_state.cpp`, replace `update_walk_animation()` (lines 1415-1501) with:

```cpp
void IslandDemoState::update_walk_animation(AppBase& app, float dt) {
    if (!character_spawned_) return;

    // Terrain sway (bone 0) — written via pre-upload hook
    env_anim_time_ += dt;

    auto* pe = app.bone_animation_registry().get(player_registry_id_);
    if (!pe || !pe->anim_player) return;

    // Set requested clip based on movement speed (if not jumping)
    if (!jumping_) {
        float speed = glm::length(glm::vec2(player_velocity_.x, player_velocity_.z));
        pe->requested_clip = speed > 0.1f ? "walk" : "idle";
    }

    // Update entry position and facing
    glm::vec3 ground_pos = character_origin_;
    float jump_y_offset = 0.0f;
    if (jumping_) {
        float t = jump_time_ / kJumpDuration;
        jump_y_offset = 4.0f * kJumpHeight * t * (1.0f - t);
        ground_pos.y -= jump_y_offset;
    }
    pe->current_pos = ground_pos;
    pe->facing_angle = facing_angle_;
    pe->y_offset = jump_y_offset;

    // Root motion consumer
    if (pe->anim_player->current_clip_index() >= 0) {
        const auto& current_clip = pe->character_data->clips[
            pe->anim_player->current_clip_index()];
        if (current_clip.root_motion) {
            glm::vec3 world_delta = character_rotation_ * pe->anim_player->delta_position();
            character_origin_ += world_delta;
            character_rotation_ = glm::normalize(
                character_rotation_ * pe->anim_player->delta_rotation());
            glm::vec3 forward = character_rotation_ * glm::vec3(0.0f, 0.0f, -1.0f);
            facing_angle_ = std::atan2(forward.x, -forward.z);
            pe->current_pos = character_origin_;
            pe->facing_angle = facing_angle_;
        }
    }

    // Actor rotation (for GS preprocess shader)
    app.renderer().gs_renderer().set_actor_rotation(character_rotation_);
}
```

- [ ] **Step 4: Set up bone_pre_upload_hook in on_enter() and clear in on_exit()**

In `on_enter()`, after the player entity is created and character is spawned, add:

```cpp
    app.set_bone_pre_upload_hook([this](glm::mat4* bones, uint32_t) {
        float sway_y = std::sin(env_anim_time_ * 1.0f) * 0.05f;
        float sway_x = std::sin(env_anim_time_ * 0.6f) * 0.02f;
        bones[0] = glm::translate(glm::mat4(1.0f),
            glm::vec3(sway_x, sway_y, 0.0f));
    });
```

In `on_exit()`, add:

```cpp
    app.set_bone_pre_upload_hook(nullptr);
```

- [ ] **Step 5: Remove update_environment_animation if it only did terrain sway**

Check: `update_environment_animation()` may have done more than terrain sway. If it only computed terrain sway and updated `env_anim_time_`, its body can be inlined into the hook. If it did other things, keep it. The implementer should check and decide.

- [ ] **Step 6: Remove gather/upload includes no longer needed in island_demo_state.cpp**

Remove `#include "gseurat/engine/bone_animation_system.hpp"` from island_demo_state.cpp if `gather_bone_animation_transforms` is no longer called there.

- [ ] **Step 7: Build and verify**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 8: Commit**

```bash
git add include/gseurat/engine/app_base.hpp src/engine/app_base.cpp \
        src/demo/island_demo_state.cpp include/gseurat/demo/island_demo_state.hpp
git commit -m "refactor(engine): promote bone animation orchestration to AppBase"
```

---

### Task 7: Final build verification and cleanup

**Files:**
- Possibly modify any files with leftover references

- [ ] **Step 1: Full debug build**

Run: `cmake --build --preset macos-debug 2>&1 | tail -10`
Expected: Build succeeds with no errors

- [ ] **Step 2: Full release build**

Run: `cmake --build --preset macos-release 2>&1 | tail -10`
Expected: Build succeeds with no errors

- [ ] **Step 3: Verify no references to deleted files**

Run: `grep -r 'island_systems' include/ src/ --include='*.hpp' --include='*.cpp'`
Expected: No matches (all references removed)

Run: `grep -r 'set_npc_bone_registry' include/ src/ --include='*.hpp' --include='*.cpp'`
Expected: No matches

Run: `grep -r 'g_npc_bone_registry' include/ src/ --include='*.hpp' --include='*.cpp'`
Expected: No matches

- [ ] **Step 4: Verify no demo includes in engine layer**

Run: `grep -r 'demo/' src/engine/ include/gseurat/engine/ --include='*.hpp' --include='*.cpp'`
Expected: No matches (engine must not depend on demo)

- [ ] **Step 5: Commit any cleanup fixes**

```bash
git add -A
git commit -m "chore: cleanup stale references after engine promotion"
```

(Only if there are changes to commit.)
