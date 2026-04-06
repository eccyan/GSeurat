# AppBase Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose AppBase's scattered state into 4 cohesive state objects and replace `AppBase&` in satellite classes with per-consumer context structs.

**Architecture:** Four state structs (`GsTerrainState`, `SceneObjectState`, `DrawLists`, `GameplayState`) replace ~20 individual AppBase members. Two context structs (`SceneLoadContext`, `CommandContext`) replace the `AppBase&` reference in `GsSceneLoader` and `CommandDispatcher`. Const/mutable access is controlled at the context struct level.

**Tech Stack:** C++23, GLM, nlohmann/json, GLFW

**Spec:** `docs/superpowers/specs/2026-04-06-appbase-decomposition-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `include/gseurat/engine/gs_terrain_state.hpp` | Create | GS terrain/cloud/PBD state aggregate |
| `include/gseurat/engine/scene_object_state.hpp` | Create | Scene path, game objects, portals, transition flag |
| `include/gseurat/engine/draw_lists.hpp` | Create | Per-frame sprite draw lists |
| `include/gseurat/engine/gameplay_state.hpp` | Create | Dialog, flags, play time |
| `include/gseurat/engine/scene_load_context.hpp` | Create | Context struct for GsSceneLoader |
| `include/gseurat/engine/command_context.hpp` | Create | Context struct for CommandDispatcher |
| `include/gseurat/engine/app_base.hpp` | Modify | Replace ~20 members with 4 state objects, replace ~25 accessors with 8 |
| `include/gseurat/engine/gs_scene_loader.hpp` | Modify | Drop `AppBase&`, take `SceneLoadContext&` |
| `include/gseurat/engine/command_dispatcher.hpp` | Modify | Replace `AppBase&` with `CommandContext` |
| `src/engine/app_base.cpp` | Modify | Update internal refs, construct contexts |
| `src/engine/gs_scene_loader.cpp` | Modify | `app_.X()` → `ctx.X` throughout |
| `src/engine/command_dispatcher.cpp` | Modify | `app_.X()` → `ctx_.X` throughout |
| `src/demo/demo_app.cpp` | Modify | Update to state object accessors |
| `src/demo/island_demo_state.cpp` | Modify | `app.set_gs_parallax_active(b)` → `app.gs_terrain().parallax_active = b` |
| `src/demo/gs_demo_state.cpp` | Modify | Same pattern |
| `src/staging/staging_app.cpp` | Modify | `current_scene_path_` → `scene_objects_.current_scene_path`, `terrain_aabb_` → `gs_terrain_.terrain_aabb` |
| `src/staging/staging_state.cpp` | Modify | `app.current_scene_path()` → `app.scene_objects().current_scene_path`, etc. |

---

### Task 1: Create State Object Headers

**Files:**
- Create: `include/gseurat/engine/gs_terrain_state.hpp`
- Create: `include/gseurat/engine/scene_object_state.hpp`
- Create: `include/gseurat/engine/draw_lists.hpp`
- Create: `include/gseurat/engine/gameplay_state.hpp`

- [ ] **Step 1: Create `gs_terrain_state.hpp`**

```cpp
#pragma once

#include "gseurat/engine/collision_gen.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/gs_parallax_camera.hpp"
#include "gseurat/engine/scene_loader.hpp"

#include <glm/glm.hpp>
#include <vector>

namespace gseurat {

struct GsTerrainState {
    AABB terrain_aabb{};
    glm::vec3 cloud_center{0.0f};
    float cloud_extent = 100.0f;
    std::vector<glm::vec3> pbd_anchors;
    std::vector<PbdConfig> pbd_configs;
    CollisionGrid collision_grid;
    GsParallaxCamera parallax_camera;
    bool parallax_active = false;
    uint32_t frame_counter = 0;
    uint32_t render_interval = 4;
    glm::vec2 last_compute_offset{0.0f};

    glm::vec2 aabb_offset() const {
        return {terrain_aabb.min.x, terrain_aabb.min.y};
    }

    void reset() {
        *this = GsTerrainState{};
    }
};

}  // namespace gseurat
```

Note: `AABB` is defined in `gaussian_cloud.hpp` (lines 22-33). `PbdConfig` is defined in `scene_loader.hpp` (lines 30-42). `CollisionGrid` is in `collision_gen.hpp`. `GsParallaxCamera` is in `gs_parallax_camera.hpp`.

- [ ] **Step 2: Create `scene_object_state.hpp`**

```cpp
#pragma once

#include "gseurat/engine/scene_loader.hpp"

#include <string>
#include <vector>

namespace gseurat {

struct SceneObjectState {
    std::string current_scene_path = "assets/scenes/test_scene.json";
    std::vector<GameObjectData> game_objects;
    std::vector<PortalData> portals;
    bool transitioning = false;
};

}  // namespace gseurat
```

Note: `GameObjectData` and `PortalData` are defined in `scene_loader.hpp` (lines 44-53 and 119-125).

- [ ] **Step 3: Create `draw_lists.hpp`**

```cpp
#pragma once

#include "gseurat/engine/sprite_batch.hpp"

#include <vector>

namespace gseurat {

struct DrawLists {
    std::vector<SpriteDrawInfo> entity;
    std::vector<SpriteDrawInfo> outline;
    std::vector<SpriteDrawInfo> shadow;
    std::vector<SpriteDrawInfo> reflection;
    std::vector<SpriteDrawInfo> overlay;
    std::vector<SpriteDrawInfo> ui;
    std::vector<SpriteDrawInfo> minimap;

    void clear_per_frame() {
        overlay.clear();
        ui.clear();
    }
};

}  // namespace gseurat
```

Note: `SpriteDrawInfo` is defined in `sprite_batch.hpp` (line 15).

- [ ] **Step 4: Create `gameplay_state.hpp`**

```cpp
#pragma once

#include "gseurat/engine/dialog.hpp"

#include <string>
#include <unordered_map>
#include <vector>

namespace gseurat {

struct GameplayState {
    enum class Mode { Explore, Dialog };
    Mode mode = Mode::Explore;
    DialogState dialog;
    std::vector<DialogScript> npc_dialogs;
    std::unordered_map<std::string, bool> flags;
    float play_time = 0.0f;
};

}  // namespace gseurat
```

Note: `DialogState` and `DialogScript` are in `dialog.hpp` (lines 14-44).

- [ ] **Step 5: Verify headers compile**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`

Expected: Build succeeds (headers are not yet included anywhere).

- [ ] **Step 6: Commit**

```bash
git add include/gseurat/engine/gs_terrain_state.hpp \
        include/gseurat/engine/scene_object_state.hpp \
        include/gseurat/engine/draw_lists.hpp \
        include/gseurat/engine/gameplay_state.hpp
git commit -m "refactor: add state object headers for AppBase decomposition"
```

---

### Task 2: Integrate State Objects into AppBase

Replace ~20 scattered members with 4 state objects. Add temporary shim accessors that delegate to the new state objects so all existing code continues to compile unchanged.

**Files:**
- Modify: `include/gseurat/engine/app_base.hpp`

- [ ] **Step 1: Add state object includes to `app_base.hpp`**

At the top of `app_base.hpp`, add these includes (alongside existing includes):

```cpp
#include "gseurat/engine/gs_terrain_state.hpp"
#include "gseurat/engine/scene_object_state.hpp"
#include "gseurat/engine/draw_lists.hpp"
#include "gseurat/engine/gameplay_state.hpp"
```

Remove includes that are now transitively included via the state headers (if any become redundant). The following includes in `app_base.hpp` are now covered by state object headers and can be removed if desired (optional cleanup):
- `collision_gen.hpp` — included by `gs_terrain_state.hpp`
- `gs_parallax_camera.hpp` — included by `gs_terrain_state.hpp`
- `dialog.hpp` — included by `gameplay_state.hpp`

- [ ] **Step 2: Replace member variables with state objects**

In the `protected` section of AppBase, replace the scattered members with 4 state objects.

**Remove these members:**

```cpp
// GS terrain (lines ~194-201 of current app_base.hpp)
GsParallaxCamera gs_parallax_camera_;
bool gs_parallax_active_ = false;
uint32_t gs_frame_counter_ = 0;
uint32_t gs_render_interval_ = 4;
glm::vec2 gs_last_compute_offset_{0.0f};

// Collision grid (line ~194)
CollisionGrid collision_grid_;

// PBD (lines ~211-214)
std::vector<glm::vec3> pbd_anchors_;
std::vector<PbdConfig> pbd_configs_;

// Terrain AABB and cloud (lines ~271-273)
AABB terrain_aabb_;
glm::vec3 gs_cloud_center_{0.0f};
float gs_cloud_extent_ = 100.0f;

// Scene objects (lines ~204-206, 209)
std::string current_scene_path_ = "assets/scenes/test_scene.json";
std::vector<PortalData> portals_;
bool transitioning_ = false;
std::vector<GameObjectData> scene_game_object_data_;

// Draw lists (lines ~177-180, 283-284, 246)
std::vector<SpriteDrawInfo> entity_sprites_;
std::vector<SpriteDrawInfo> outline_sprites_;
std::vector<SpriteDrawInfo> shadow_sprites_;
std::vector<SpriteDrawInfo> reflection_sprites_;
std::vector<SpriteDrawInfo> overlay_sprites_;
std::vector<SpriteDrawInfo> ui_sprites_;
std::vector<SpriteDrawInfo> minimap_sprites_;

// Gameplay (lines ~186, 190-191, 255-256)
GameMode game_mode_ = GameMode::Explore;
DialogState dialog_state_;
std::vector<DialogScript> npc_dialogs_;
std::unordered_map<std::string, bool> game_flags_;
float play_time_ = 0.0f;
```

**Add these 4 state objects (in the protected section):**

```cpp
// ── Cohesive state objects ──
GsTerrainState gs_terrain_;
SceneObjectState scene_objects_;
DrawLists draw_lists_;
GameplayState gameplay_;
```

- [ ] **Step 3: Add new state object accessors (public section)**

```cpp
// State object accessors
GsTerrainState& gs_terrain() { return gs_terrain_; }
const GsTerrainState& gs_terrain() const { return gs_terrain_; }
SceneObjectState& scene_objects() { return scene_objects_; }
const SceneObjectState& scene_objects() const { return scene_objects_; }
DrawLists& draw_lists() { return draw_lists_; }
const DrawLists& draw_lists() const { return draw_lists_; }
GameplayState& gameplay() { return gameplay_; }
const GameplayState& gameplay() const { return gameplay_; }
```

- [ ] **Step 4: Convert old accessors to shim delegates**

Replace the old accessor implementations with shims that delegate to state objects. These are temporary — they'll be removed once all consumers are migrated.

```cpp
// ── Temporary shim accessors (remove after consumer migration) ──

// GsTerrainState shims
glm::vec2 gs_aabb_offset() const { return gs_terrain_.aabb_offset(); }
const AABB& terrain_aabb() const { return gs_terrain_.terrain_aabb; }
void set_terrain_aabb(const AABB& aabb) { gs_terrain_.terrain_aabb = aabb; }
glm::vec3 gs_cloud_center() const { return gs_terrain_.cloud_center; }
void set_gs_cloud_center(const glm::vec3& c) { gs_terrain_.cloud_center = c; }
float gs_cloud_extent() const { return gs_terrain_.cloud_extent; }
void set_gs_cloud_extent(float e) { gs_terrain_.cloud_extent = e; }
void set_gs_frame_counter(uint32_t v) { gs_terrain_.frame_counter = v; }
void set_gs_parallax_active(bool active) { gs_terrain_.parallax_active = active; }
GsParallaxCamera& gs_parallax_camera() { return gs_terrain_.parallax_camera; }
const std::vector<glm::vec3>& pbd_anchors() const { return gs_terrain_.pbd_anchors; }
std::vector<glm::vec3>& pbd_anchors_mutable() { return gs_terrain_.pbd_anchors; }
const std::vector<PbdConfig>& pbd_configs() const { return gs_terrain_.pbd_configs; }
std::vector<PbdConfig>& pbd_configs_mutable() { return gs_terrain_.pbd_configs; }

// SceneObjectState shims
const std::string& current_scene_path() const { return scene_objects_.current_scene_path; }
void set_current_scene_path(const std::string& path) { scene_objects_.current_scene_path = path; }
bool is_transitioning() const { return scene_objects_.transitioning; }
void set_transitioning(bool t) { scene_objects_.transitioning = t; }
const std::vector<GameObjectData>& scene_game_objects() const { return scene_objects_.game_objects; }
std::vector<GameObjectData>& scene_game_object_data_mutable() { return scene_objects_.game_objects; }

// DrawLists shims
std::vector<SpriteDrawInfo>& overlay_sprites() { return draw_lists_.overlay; }
std::vector<SpriteDrawInfo>& ui_sprites() { return draw_lists_.ui; }
std::vector<SpriteDrawInfo>& entity_sprites() { return draw_lists_.entity; }

// GameplayState shims
enum class GameMode { Explore, Dialog };
GameMode game_mode() const {
    return gameplay_.mode == GameplayState::Mode::Explore ? GameMode::Explore : GameMode::Dialog;
}
void set_game_mode(GameMode m) {
    gameplay_.mode = (m == GameMode::Explore) ? GameplayState::Mode::Explore : GameplayState::Mode::Dialog;
}
DialogState& dialog_state() { return gameplay_.dialog; }
const std::vector<DialogScript>& npc_dialogs() const { return gameplay_.npc_dialogs; }
std::unordered_map<std::string, bool>& game_flags() { return gameplay_.flags; }
float play_time() const { return gameplay_.play_time; }
```

**Important:** The `GameMode` enum was previously nested in AppBase (`AppBase::GameMode`). The shim preserves API compatibility by re-declaring it. If any code references `AppBase::GameMode` explicitly, it will continue to work.

- [ ] **Step 5: Update internal AppBase references in `app_base.cpp`**

In `src/engine/app_base.cpp`, update all direct member access to use state objects:

In `main_loop()`:
- `overlay_sprites_.clear()` → `draw_lists_.overlay.clear()`
- `ui_sprites_.clear()` → `draw_lists_.ui.clear()`
- `play_time_ += dt` → `gameplay_.play_time += dt`
- `if (!ui_sprites_.empty())` → `if (!draw_lists_.ui.empty())`
- `ui_batches.push_back(ui::UIDrawBatch{ui_sprites_, std::nullopt})` → `ui_batches.push_back(ui::UIDrawBatch{draw_lists_.ui, std::nullopt})`
- `if (feature_flags_.minimap && !minimap_sprites_.empty())` → `if (feature_flags_.minimap && !draw_lists_.minimap.empty())`
- `ui_batches.push_back(ui::UIDrawBatch{minimap_sprites_, std::nullopt})` → `ui_batches.push_back(ui::UIDrawBatch{draw_lists_.minimap, std::nullopt})`
- `renderer_.draw_scene(scene_, entity_sprites_, outline_sprites_, reflection_sprites_, shadow_sprites_, ...)` → `renderer_.draw_scene(scene_, draw_lists_.entity, draw_lists_.outline, draw_lists_.reflection, draw_lists_.shadow, ...)`

- [ ] **Step 6: Update `StagingApp::main_loop()` internal references**

In `src/staging/staging_app.cpp`:
- Line 91: `overlay_sprites_.clear()` → `draw_lists_.overlay.clear()`
- Line 92: `ui_sprites_.clear()` → `draw_lists_.ui.clear()`
- Line 107: `play_time_ += dt` → `gameplay_.play_time += dt`
- Line 145: `renderer_.draw_scene(scene_, entity_sprites_, outline_sprites_, reflection_sprites_, shadow_sprites_, ...)` → `renderer_.draw_scene(scene_, draw_lists_.entity, draw_lists_.outline, draw_lists_.reflection, draw_lists_.shadow, ...)`

- [ ] **Step 7: Update `StagingApp::clear_scene()` internal references**

In `src/staging/staging_app.cpp`, line 328-330:
- `terrain_aabb_ = AABB{};` → `gs_terrain_.terrain_aabb = AABB{};`
- `terrain_aabb_.min = glm::vec3(0.0f);` → `gs_terrain_.terrain_aabb.min = glm::vec3(0.0f);`
- `terrain_aabb_.max = glm::vec3(0.0f);` → `gs_terrain_.terrain_aabb.max = glm::vec3(0.0f);`

- [ ] **Step 8: Update `DemoApp::init_scene()` and `DemoApp::run()` internal references**

In `src/demo/demo_app.cpp`:
- Line 42: `set_current_scene_path(path)` → `scene_objects_.current_scene_path = path` (DemoApp inherits AppBase, so direct member access)
- Line 62: `set_current_scene_path(scene_path_)` stays if using the shim, OR `scene_objects_.current_scene_path = scene_path_` for direct access
- Line 78: `current_scene_path_ = scene_path` → `scene_objects_.current_scene_path = scene_path`

Actually, in `DemoApp::run()` line 42, `set_current_scene_path(path)` calls through the base class. Since this is a subclass accessing the base, either the shim or direct member works. Use the shim for now — it'll be cleaned up in Task 3.

- [ ] **Step 9: Verify build**

Run: `cmake --build --preset macos-debug 2>&1 | tail -10`

Expected: Build succeeds. All shim accessors ensure API compatibility.

- [ ] **Step 10: Run tests**

Run: `cd build/macos-debug && ctest --output-on-failure 2>&1 | tail -20`

Expected: All tests pass.

- [ ] **Step 11: Commit**

```bash
git add include/gseurat/engine/app_base.hpp src/engine/app_base.cpp \
        src/demo/demo_app.cpp src/staging/staging_app.cpp
git commit -m "refactor: replace scattered AppBase members with state objects

Introduce GsTerrainState, SceneObjectState, DrawLists, GameplayState as
cohesive state aggregates. Temporary shim accessors preserve API compatibility."
```

---

### Task 3: Migrate All Consumers to State Object Accessors

Update GameStates and App subclasses to access state through `app.gs_terrain()`, `app.scene_objects()`, etc. instead of the old shim accessors.

**Files:**
- Modify: `src/demo/island_demo_state.cpp`
- Modify: `src/demo/gs_demo_state.cpp`
- Modify: `src/staging/staging_state.cpp`
- Modify: `src/demo/demo_app.cpp`
- Modify: `src/staging/staging_app.cpp`

- [ ] **Step 1: Migrate `island_demo_state.cpp`**

Replace these patterns:

| Old | New |
|-----|-----|
| `app.set_gs_parallax_active(false)` | `app.gs_terrain().parallax_active = false` |

That's the only state-object accessor used in island_demo_state.cpp. The rest (`app.feature_flags()`, `app.renderer()`, `app.world()`, `app.input()`, `app.scene()`) are subsystem accessors that stay on AppBase.

- [ ] **Step 2: Migrate `gs_demo_state.cpp`**

Replace these patterns:

| Old | New |
|-----|-----|
| `app.current_scene_path()` | `app.scene_objects().current_scene_path` |
| `app.set_gs_parallax_active(false)` | `app.gs_terrain().parallax_active = false` |

The `current_scene_path()` call is on line 25: `app.init_scene(app.current_scene_path())` → `app.init_scene(app.scene_objects().current_scene_path)`.

The `set_gs_parallax_active(false)` call is on line 28.

- [ ] **Step 3: Migrate `staging_state.cpp`**

Replace these patterns:

| Old | New |
|-----|-----|
| `app.current_scene_path()` (lines 36, 37, 60, 188, 243) | `app.scene_objects().current_scene_path` |
| `app.gs_cloud_center()` (line 141) | `app.gs_terrain().cloud_center` |
| `app.gs_cloud_extent()` (line 142) | `app.gs_terrain().cloud_extent` |
| `app.scene_game_objects()` (line 754) | `app.scene_objects().game_objects` |
| `app.gs_aabb_offset()` (line 755) | `app.gs_terrain().aabb_offset()` |

- [ ] **Step 4: Migrate `demo_app.cpp` subclass internal access**

In `DemoApp::run()` (line 42):
- `set_current_scene_path(path)` → `scene_objects_.current_scene_path = path`

In `DemoApp::init_scene()` (line 78):
- `current_scene_path_ = scene_path` → already changed in Task 2 Step 8 to `scene_objects_.current_scene_path = scene_path`

Verify these are consistent.

- [ ] **Step 5: Migrate `staging_app.cpp` subclass internal access**

In `StagingApp::main_loop()` (line 62):
- `set_current_scene_path(scene_path_)` → `scene_objects_.current_scene_path = scene_path_`

In `StagingApp::init_scene()` (line 316):
- `current_scene_path_ = scene_path` → `scene_objects_.current_scene_path = scene_path`

The clear_scene changes were already done in Task 2 Step 7.

- [ ] **Step 6: Verify build**

Run: `cmake --build --preset macos-debug 2>&1 | tail -10`

Expected: Build succeeds.

- [ ] **Step 7: Run tests**

Run: `cd build/macos-debug && ctest --output-on-failure 2>&1 | tail -20`

Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/demo/island_demo_state.cpp src/demo/gs_demo_state.cpp \
        src/staging/staging_state.cpp src/demo/demo_app.cpp \
        src/staging/staging_app.cpp
git commit -m "refactor: migrate GameStates and Apps to state object accessors"
```

---

### Task 4: Remove Shim Accessors

Now that all consumers use state object accessors directly, remove the temporary shims from AppBase.

**Files:**
- Modify: `include/gseurat/engine/app_base.hpp`

- [ ] **Step 1: Remove shim accessors from `app_base.hpp`**

Remove the entire "Temporary shim accessors" block added in Task 2 Step 4. This includes:

```cpp
// Remove ALL of these:
glm::vec2 gs_aabb_offset() const;
const AABB& terrain_aabb() const;
void set_terrain_aabb(const AABB& aabb);
glm::vec3 gs_cloud_center() const;
void set_gs_cloud_center(const glm::vec3& c);
float gs_cloud_extent() const;
void set_gs_cloud_extent(float e);
void set_gs_frame_counter(uint32_t v);
void set_gs_parallax_active(bool active);
GsParallaxCamera& gs_parallax_camera();
const std::vector<glm::vec3>& pbd_anchors() const;
std::vector<glm::vec3>& pbd_anchors_mutable();
const std::vector<PbdConfig>& pbd_configs() const;
std::vector<PbdConfig>& pbd_configs_mutable();
const std::string& current_scene_path() const;
void set_current_scene_path(const std::string& path);
bool is_transitioning() const;
void set_transitioning(bool t);
const std::vector<GameObjectData>& scene_game_objects() const;
std::vector<GameObjectData>& scene_game_object_data_mutable();
std::vector<SpriteDrawInfo>& overlay_sprites();
std::vector<SpriteDrawInfo>& ui_sprites();
std::vector<SpriteDrawInfo>& entity_sprites();
GameMode game_mode() const;
void set_game_mode(GameMode m);
DialogState& dialog_state();
const std::vector<DialogScript>& npc_dialogs() const;
std::unordered_map<std::string, bool>& game_flags();
float play_time() const;
```

Also remove the `GameMode` enum re-declaration (it's now `GameplayState::Mode`).

**Keep** the `GsSceneLoader& gs_scene_loader()` accessor and `GsSceneLoader gs_scene_loader_` member — those will be removed in Task 5.

- [ ] **Step 2: Verify build**

Run: `cmake --build --preset macos-debug 2>&1 | tail -10`

Expected: Build succeeds. If any call site was missed, the compiler will report it — fix before proceeding.

- [ ] **Step 3: Run tests**

Run: `cd build/macos-debug && ctest --output-on-failure 2>&1 | tail -20`

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add include/gseurat/engine/app_base.hpp
git commit -m "refactor: remove temporary shim accessors from AppBase"
```

---

### Task 5: Create Context Structs and Rewire GsSceneLoader

Create `SceneLoadContext`, change `GsSceneLoader::load()` to take it instead of using `AppBase&`, and remove the `GsSceneLoader` member from AppBase.

**Files:**
- Create: `include/gseurat/engine/scene_load_context.hpp`
- Modify: `include/gseurat/engine/gs_scene_loader.hpp`
- Modify: `src/engine/gs_scene_loader.cpp`
- Modify: `include/gseurat/engine/app_base.hpp`
- Modify: `src/engine/app_base.cpp`

- [ ] **Step 1: Create `scene_load_context.hpp`**

```cpp
#pragma once

namespace gseurat {

struct GsTerrainState;
struct SceneObjectState;
class Renderer;
class Scene;
namespace ecs { class World; }
class ComponentRegistry;
class ResourceManager;
struct FeatureFlags;

struct SceneLoadContext {
    GsTerrainState& terrain;
    SceneObjectState& scene_objects;
    Renderer& renderer;
    Scene& scene;
    ecs::World& world;
    ComponentRegistry& components;
    ResourceManager& resources;
    const FeatureFlags& feature_flags;
};

}  // namespace gseurat
```

- [ ] **Step 2: Update `gs_scene_loader.hpp`**

Replace the entire file:

```cpp
#pragma once

#include "gseurat/engine/scene_loader.hpp"

namespace gseurat {

struct SceneLoadContext;

struct GsSceneOptions {
    bool add_default_light = false;
    bool set_god_rays = false;
};

class GsSceneLoader {
public:
    void load(SceneLoadContext& ctx, const SceneData& scene_data,
              const GsSceneOptions& opts = {});
};

}  // namespace gseurat
```

Key changes:
- No more `AppBase& app_` member
- No more constructor taking `AppBase&`
- `load()` takes `SceneLoadContext&` as first parameter

- [ ] **Step 3: Rewrite `gs_scene_loader.cpp` to use context**

Replace `app_` with `ctx` throughout. The mechanical transformation:

| Old | New |
|-----|-----|
| `app_.renderer()` | `ctx.renderer` |
| `app_.scene()` | `ctx.scene` |
| `app_.set_terrain_aabb(terrain_aabb)` | `ctx.terrain.terrain_aabb = terrain_aabb` |
| `app_.scene_game_object_data_mutable() = snapped_objects` | `ctx.scene_objects.game_objects = snapped_objects` |
| `app_.pbd_anchors_mutable()` | `ctx.terrain.pbd_anchors` |
| `app_.pbd_configs_mutable()` | `ctx.terrain.pbd_configs` |
| `app_.set_gs_cloud_center(...)` | `ctx.terrain.cloud_center = ...` |
| `app_.set_gs_cloud_extent(...)` | `ctx.terrain.cloud_extent = ...` |
| `app_.world()` | `ctx.world` |
| `app_.component_registry()` | `ctx.components` |
| `app_.resources()` | `ctx.resources` |
| `app_.feature_flags()` | `ctx.feature_flags` |
| `app_.gs_parallax_camera()` | `ctx.terrain.parallax_camera` |
| `app_.set_gs_parallax_active(true)` | `ctx.terrain.parallax_active = true` |
| `app_.set_gs_frame_counter(0)` | `ctx.terrain.frame_counter = 0` |
| `app_.terrain_aabb()` | `ctx.terrain.terrain_aabb` |

Update the function signature:

```cpp
void GsSceneLoader::load(SceneLoadContext& ctx, const SceneData& scene_data,
                          const GsSceneOptions& opts) {
    auto& renderer = ctx.renderer;
    auto& scene = ctx.scene;
    // ... rest of the method with ctx instead of app_
```

Replace `#include "gseurat/engine/app_base.hpp"` with `#include "gseurat/engine/scene_load_context.hpp"` plus the specific headers needed:

```cpp
#include "gseurat/engine/gs_scene_loader.hpp"
#include "gseurat/engine/scene_load_context.hpp"
#include "gseurat/engine/gs_terrain_state.hpp"
#include "gseurat/engine/scene_object_state.hpp"
#include "gseurat/engine/coordinate.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/gs_vfx.hpp"
#include "gseurat/engine/pbd_types.hpp"
#include "gseurat/engine/renderer.hpp"
#include "gseurat/engine/resource_manager.hpp"
#include "gseurat/engine/scene.hpp"
#include "gseurat/engine/feature_flags.hpp"
#include "gseurat/engine/ecs/ecs.hpp"
#include "gseurat/engine/component_registry.hpp"
```

- [ ] **Step 4: Remove `GsSceneLoader` member from AppBase**

In `include/gseurat/engine/app_base.hpp`:
- Remove `#include "gseurat/engine/gs_scene_loader.hpp"` (if still present from before)
- Remove the `GsSceneLoader gs_scene_loader_{*this};` member
- Remove the `GsSceneLoader& gs_scene_loader()` accessor

In the `load_gs_scene` method declaration, keep it as-is:
```cpp
void load_gs_scene(const SceneData& scene_data, const GsSceneOptions& opts = {});
```

But now `app_base.hpp` needs a forward declaration of `GsSceneOptions`. Add:
```cpp
struct GsSceneOptions;
```
And include `gs_scene_loader.hpp` only in `app_base.cpp`.

- [ ] **Step 5: Update `app_base.cpp` to construct context**

In `src/engine/app_base.cpp`, add include:
```cpp
#include "gseurat/engine/gs_scene_loader.hpp"
#include "gseurat/engine/scene_load_context.hpp"
```

Replace the `load_gs_scene` method:

```cpp
void AppBase::load_gs_scene(const SceneData& scene_data, const GsSceneOptions& opts) {
    SceneLoadContext ctx{
        gs_terrain_, scene_objects_, renderer_, scene_,
        world_, component_registry_, resources_, feature_flags_
    };
    GsSceneLoader loader;
    loader.load(ctx, scene_data, opts);
}
```

- [ ] **Step 6: Verify build**

Run: `cmake --build --preset macos-debug 2>&1 | tail -10`

Expected: Build succeeds.

- [ ] **Step 7: Run tests**

Run: `cd build/macos-debug && ctest --output-on-failure 2>&1 | tail -20`

Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add include/gseurat/engine/scene_load_context.hpp \
        include/gseurat/engine/gs_scene_loader.hpp \
        src/engine/gs_scene_loader.cpp \
        include/gseurat/engine/app_base.hpp \
        src/engine/app_base.cpp
git commit -m "refactor: GsSceneLoader takes SceneLoadContext instead of AppBase&

GsSceneLoader is now fully decoupled from AppBase. It receives only the
specific subsystems it needs via SceneLoadContext, with const FeatureFlags
enforcing read-only access to feature configuration."
```

---

### Task 6: Create CommandContext and Rewire CommandDispatcher

Create `CommandContext`, change `CommandDispatcher` to hold it instead of `AppBase&`.

**Files:**
- Create: `include/gseurat/engine/command_context.hpp`
- Modify: `include/gseurat/engine/command_dispatcher.hpp`
- Modify: `src/engine/command_dispatcher.cpp`
- Modify: `src/engine/app_base.cpp`
- Modify: `include/gseurat/engine/app_base.hpp`

- [ ] **Step 1: Create `command_context.hpp`**

```cpp
#pragma once

#include <functional>
#include <string>

struct GLFWwindow;

namespace gseurat {

struct GsTerrainState;
struct SceneObjectState;
class Renderer;
class Scene;
namespace ecs { class World; }
class ComponentRegistry;
class InputManager;
struct FeatureFlags;

struct CommandContext {
    const GsTerrainState& terrain;
    SceneObjectState& scene_objects;
    Renderer& renderer;
    Scene& scene;
    ecs::World& world;
    ComponentRegistry& components;
    InputManager& input;
    FeatureFlags& feature_flags;
    GLFWwindow*& window;

    std::function<void(const std::string&)> init_scene;
    std::function<void()> clear_scene;
};

}  // namespace gseurat
```

- [ ] **Step 2: Update `command_dispatcher.hpp`**

Replace `AppBase&` with `CommandContext`:

```cpp
#pragma once

#include "gseurat/engine/command_context.hpp"
#include "gseurat/engine/input_manager.hpp"

#include <expected>
#include <functional>
#include <nlohmann/json.hpp>
#include <string>
#include <unordered_map>

namespace gseurat {

using CommandResult = std::expected<nlohmann::json, std::string>;
using CommandHandler = std::function<CommandResult(const nlohmann::json&)>;

class CommandDispatcher {
public:
    explicit CommandDispatcher(CommandContext ctx) : ctx_(std::move(ctx)) {}

    void register_command(std::string name, CommandHandler handler);
    void register_default_commands();
    void dispatch(const nlohmann::json& cmd, nlohmann::json& response);

private:
    CommandContext ctx_;
    std::unordered_map<std::string, CommandHandler> handlers_;
};

}  // namespace gseurat
```

- [ ] **Step 3: Rewrite `command_dispatcher.cpp` to use context**

Replace `app_` with `ctx_` throughout. The mechanical transformation:

| Old | New |
|-----|-----|
| `app_.feature_flags()` | `ctx_.feature_flags` |
| `app_.renderer()` | `ctx_.renderer` |
| `app_.renderer().gs_renderer()` | `ctx_.renderer.gs_renderer()` |
| `app_.renderer().post_process_params()` | `ctx_.renderer.post_process_params()` |
| `app_.scene()` | `ctx_.scene` |
| `app_.current_scene_path()` | `ctx_.scene_objects.current_scene_path` |
| `app_.set_current_scene_path(temp_path)` | `ctx_.scene_objects.current_scene_path = temp_path` |
| `app_.terrain_aabb()` | `ctx_.terrain.terrain_aabb` |
| `app_.scene_game_object_data_mutable()` | `ctx_.scene_objects.game_objects` |
| `app_.world()` | `ctx_.world` |
| `app_.component_registry()` | `ctx_.components` |
| `app_.input()` | `ctx_.input` |
| `app_.window()` | `ctx_.window` |
| `app_.clear_scene()` | `ctx_.clear_scene()` |
| `app_.init_scene(path)` | `ctx_.init_scene(path)` |

Replace includes:

```cpp
#include "gseurat/engine/command_dispatcher.hpp"
#include "gseurat/engine/gs_terrain_state.hpp"
#include "gseurat/engine/scene_object_state.hpp"
#include "gseurat/engine/renderer.hpp"
#include "gseurat/engine/scene.hpp"
#include "gseurat/engine/coordinate.hpp"
#include "gseurat/engine/gs_vfx.hpp"
#include "gseurat/engine/feature_flags.hpp"
#include "gseurat/engine/ecs/ecs.hpp"
#include "gseurat/engine/component_registry.hpp"
#include "gseurat/demo/island_components.hpp"

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

#include <filesystem>
#include <fstream>
```

Remove `#include "gseurat/engine/app_base.hpp"`.

- [ ] **Step 4: Update AppBase to construct CommandContext**

In `include/gseurat/engine/app_base.hpp`:
- The `CommandDispatcher` member can no longer be initialized with `{*this}`.
- Change the member declaration. Since `CommandContext` contains `std::function` members that capture `this`, the context must be constructed after `this` is valid. Use a helper method.

Replace in AppBase:

```cpp
// Old:
CommandDispatcher command_dispatcher_{*this};

// New:
CommandDispatcher command_dispatcher_{build_command_context()};
```

Add a private helper:

```cpp
private:
    CommandContext build_command_context();
```

In `src/engine/app_base.cpp`, add:

```cpp
#include "gseurat/engine/command_context.hpp"

CommandContext AppBase::build_command_context() {
    return CommandContext{
        .terrain = gs_terrain_,
        .scene_objects = scene_objects_,
        .renderer = renderer_,
        .scene = scene_,
        .world = world_,
        .components = component_registry_,
        .input = input_,
        .feature_flags = feature_flags_,
        .window = window_,
        .init_scene = [this](const std::string& path) { init_scene(path); },
        .clear_scene = [this]() { clear_scene(); },
    };
}
```

**Important**: `build_command_context()` is called during member initialization. At that point, all member references are valid (they're default-constructed), but `this` is fully formed. The `std::function` lambdas capture `this` — they're only *called* later (not during construction), so this is safe.

- [ ] **Step 5: Update `app_base.hpp` includes**

Add to `app_base.hpp`:
```cpp
#include "gseurat/engine/command_context.hpp"
```

The `#include "gseurat/engine/command_dispatcher.hpp"` is already there. Since `command_dispatcher.hpp` now includes `command_context.hpp`, we might not need the explicit include — but being explicit is clearer.

- [ ] **Step 6: Verify build**

Run: `cmake --build --preset macos-debug 2>&1 | tail -10`

Expected: Build succeeds.

- [ ] **Step 7: Run tests**

Run: `cd build/macos-debug && ctest --output-on-failure 2>&1 | tail -20`

Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add include/gseurat/engine/command_context.hpp \
        include/gseurat/engine/command_dispatcher.hpp \
        src/engine/command_dispatcher.cpp \
        include/gseurat/engine/app_base.hpp \
        src/engine/app_base.cpp
git commit -m "refactor: CommandDispatcher takes CommandContext instead of AppBase&

CommandDispatcher is now fully decoupled from AppBase. It receives only the
specific subsystems it needs via CommandContext, with const GsTerrainState
enforcing read-only access to terrain data. Virtual lifecycle methods
(init_scene, clear_scene) are passed as std::function callbacks."
```

---

### Task 7: Final Cleanup and Verification

Remove any remaining dead code, verify everything builds and tests pass, run integration test.

**Files:**
- Modify: `include/gseurat/engine/app_base.hpp` (if needed)

- [ ] **Step 1: Audit AppBase for dead accessors**

Search for any remaining accessors that are no longer called:

```bash
# Check if any old accessor names are still referenced
grep -rn "gs_scene_loader()\|gs_aabb_offset()\|terrain_aabb()\|set_terrain_aabb\|gs_cloud_center()\|set_gs_cloud_center\|gs_cloud_extent()\|set_gs_cloud_extent\|set_gs_frame_counter\|set_gs_parallax_active\|gs_parallax_camera()\|pbd_anchors()\|pbd_anchors_mutable\|pbd_configs()\|pbd_configs_mutable\|scene_game_objects()\|scene_game_object_data_mutable\|current_scene_path()\|set_current_scene_path\|is_transitioning()\|set_transitioning\|overlay_sprites()\|ui_sprites()\|entity_sprites()\|game_mode()\|set_game_mode\|dialog_state()\|npc_dialogs()\|game_flags()\|play_time()" src/ include/
```

If any hits remain, they were missed in earlier tasks — fix them.

- [ ] **Step 2: Verify clean build**

Run: `cmake --build --preset macos-debug 2>&1 | tail -10`

Expected: Clean build, no warnings.

- [ ] **Step 3: Run full test suite**

Run: `cd build/macos-debug && ctest --output-on-failure 2>&1 | tail -30`

Expected: All tests pass.

- [ ] **Step 4: Verify release build**

Run: `cmake --build --preset macos-release 2>&1 | tail -10`

Expected: Clean build. Release builds may catch different warnings.

- [ ] **Step 5: Commit any final cleanup**

```bash
git add -A
git commit -m "refactor: final cleanup after AppBase decomposition"
```

(Only if there are changes to commit.)

- [ ] **Step 6: Integration test — Demo app via game director**

Build and launch the demo:
```bash
cmake --build --preset macos-release --target gseurat_demo
cd build/macos-release && ./gseurat_demo &
```

Wait for socket, then test:
```bash
sleep 6
python3 scripts/game_director.py player
python3 scripts/game_director.py perf
python3 scripts/game_director.py triggers
python3 scripts/game_director.py features
python3 scripts/game_director.py screenshot /tmp/decomp_test.png
python3 scripts/game_director.py quit
```

Expected: All commands return valid JSON. Screenshot shows the island scene. Player position is non-null.

- [ ] **Step 7: Integration test — Staging app**

```bash
cd build/macos-release
./gseurat_staging --scene assets/scenes/seurat_island.json &
sleep 6
```

Test via socket:
```python
python3 -c "
import socket, json
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect('/tmp/gseurat.sock')
s.sendall(json.dumps({'cmd': 'get_features'}).encode() + b'\n')
s.settimeout(5)
data = b''
while True:
    try:
        chunk = s.recv(4096)
        if not chunk: break
        data += chunk
        if b'\n' in data: break
    except socket.timeout: break
print(json.loads(data.split(b'\n')[0]))
s.close()
"
```

Then test reload:
```python
python3 -c "
import socket, json
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect('/tmp/gseurat.sock')
s.sendall(json.dumps({'cmd': 'reload_scene'}).encode() + b'\n')
s.settimeout(5)
data = b''
while True:
    try:
        chunk = s.recv(4096)
        if not chunk: break
        data += chunk
        if b'\n' in data: break
    except socket.timeout: break
print(json.loads(data.split(b'\n')[0]))
s.close()
"
```

Expected: Features list returned. Reload succeeds.

Quit staging:
```python
python3 -c "
import socket, json
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect('/tmp/gseurat.sock')
s.sendall(json.dumps({'cmd': 'quit'}).encode() + b'\n')
s.close()
"
```
