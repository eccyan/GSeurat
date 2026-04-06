# AppBase Decomposition Design

## Goal

Decompose the AppBase god class (37 members, 57+ public methods, 13+ responsibility domains) into cohesive state objects with per-consumer context structs, so that satellite classes declare explicit dependencies instead of holding an opaque `AppBase&` reference.

## Architecture

AppBase currently serves as a monolithic container where every subsystem, satellite class, and GameState reaches in through 25+ accessors. The refactoring extracts 4 cohesive state objects that own related data, and introduces per-consumer context structs that bundle only the references each satellite needs. Const/mutable access is controlled at the context struct level — read-only by default, mutable only where the consumer actually writes.

## State Objects

Four plain aggregate structs, owned by AppBase as members. Each groups related state that was previously scattered across individual AppBase members.

### GsTerrainState

Owns all Gaussian Splatting terrain/cloud geometry state.

**File:** `include/gseurat/engine/gs_terrain_state.hpp`

```cpp
#pragma once
#include "gseurat/engine/collision_gen.hpp"
#include "gseurat/engine/gs_parallax_camera.hpp"
#include "gseurat/engine/pbd_types.hpp"
#include "gseurat/engine/types.hpp"
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

**Members moved from AppBase:** `terrain_aabb_`, `gs_cloud_center_`, `gs_cloud_extent_`, `pbd_anchors_`, `pbd_configs_`, `collision_grid_`, `gs_parallax_camera_`, `gs_parallax_active_`, `gs_frame_counter_`, `gs_render_interval_`, `gs_last_compute_offset_`

### SceneObjectState

Owns scene-level data for transitions and game object persistence.

**File:** `include/gseurat/engine/scene_object_state.hpp`

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

**Members moved from AppBase:** `current_scene_path_`, `scene_game_object_data_`, `portals_`, `transitioning_`

### DrawLists

Per-frame sprite draw lists populated by GameStates, consumed by the renderer.

**File:** `include/gseurat/engine/draw_lists.hpp`

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

**Members moved from AppBase:** `entity_sprites_`, `outline_sprites_`, `shadow_sprites_`, `reflection_sprites_`, `overlay_sprites_`, `ui_sprites_`, `minimap_sprites_`

### GameplayState

Dialog, flags, and timing state.

**File:** `include/gseurat/engine/gameplay_state.hpp`

```cpp
#pragma once
#include "gseurat/engine/dialog.hpp"
#include "gseurat/engine/direction.hpp"
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

**Members moved from AppBase:** `game_mode_`, `dialog_state_`, `npc_dialogs_`, `game_flags_`, `play_time_`

## Context Structs

Per-consumer structs that bundle only the references each satellite needs. Const/mutable access enforced at the type level.

### SceneLoadContext

**File:** `include/gseurat/engine/scene_load_context.hpp`

```cpp
#pragma once

namespace gseurat {

// Forward declarations
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
    const FeatureFlags& feature_flags;  // read-only
};

}  // namespace gseurat
```

**Consumer:** `GsSceneLoader::load()` takes `SceneLoadContext&` as first parameter instead of accessing `AppBase&` member.

### CommandContext

**File:** `include/gseurat/engine/command_context.hpp`

```cpp
#pragma once
#include <functional>
#include <string>

struct GLFWwindow;

namespace gseurat {

// Forward declarations
struct GsTerrainState;
struct SceneObjectState;
class Renderer;
class Scene;
namespace ecs { class World; }
class ComponentRegistry;
class InputManager;
struct FeatureFlags;

struct CommandContext {
    const GsTerrainState& terrain;  // read-only
    SceneObjectState& scene_objects;
    Renderer& renderer;
    Scene& scene;
    ecs::World& world;
    ComponentRegistry& components;
    InputManager& input;
    FeatureFlags& feature_flags;
    GLFWwindow*& window;

    // Virtual lifecycle callbacks (wrapping AppBase virtual methods)
    std::function<void(const std::string&)> init_scene;
    std::function<void()> clear_scene;
};

}  // namespace gseurat
```

**Consumer:** `CommandDispatcher` holds `CommandContext` instead of `AppBase&`.

## AppBase Changes

### New members (replace ~20 scattered members)

```cpp
GsTerrainState gs_terrain_;
SceneObjectState scene_objects_;
DrawLists draw_lists_;
GameplayState gameplay_;
```

### New accessors (replace ~25 scattered accessors)

```cpp
GsTerrainState& gs_terrain() { return gs_terrain_; }
const GsTerrainState& gs_terrain() const { return gs_terrain_; }
SceneObjectState& scene_objects() { return scene_objects_; }
const SceneObjectState& scene_objects() const { return scene_objects_; }
DrawLists& draw_lists() { return draw_lists_; }
const DrawLists& draw_lists() const { return draw_lists_; }
GameplayState& gameplay() { return gameplay_; }
const GameplayState& gameplay() const { return gameplay_; }
```

### Removed accessors (examples)

```
terrain_aabb(), set_terrain_aabb(), gs_cloud_center(), set_gs_cloud_center(),
gs_cloud_extent(), set_gs_cloud_extent(), gs_aabb_offset(),
pbd_anchors(), pbd_anchors_mutable(), pbd_configs(), pbd_configs_mutable(),
scene_game_objects(), scene_game_object_data_mutable(),
current_scene_path(), set_current_scene_path(), is_transitioning(), set_transitioning(),
overlay_sprites(), ui_sprites(), entity_sprites(),
game_mode(), set_game_mode(), dialog_state(), npc_dialogs(), game_flags(), play_time()
```

### Satellite construction

```cpp
// GsSceneLoader becomes stateless — context passed per call
GsSceneLoader loader;
loader.load(scene_load_ctx, scene_data, opts);

// CommandDispatcher holds context
CommandDispatcher command_dispatcher_{CommandContext{
    .terrain = gs_terrain_,
    .scene_objects = scene_objects_,
    .renderer = renderer_,
    .scene = scene_,
    .world = world_,
    .components = component_registry_,
    .input = input_,
    .feature_flags = feature_flags_,
    .window = window_,
    .init_scene = [this](const std::string& p) { init_scene(p); },
    .clear_scene = [this]() { clear_scene(); },
}};
```

### GameStates

GameStates continue receiving `AppBase&` but access state through the new objects:

```cpp
// Before
app.terrain_aabb()
app.set_gs_cloud_center(center)
app.game_flags()["found_crystal"] = true;

// After
app.gs_terrain().terrain_aabb
app.gs_terrain().cloud_center = center;
app.gameplay().flags["found_crystal"] = true;
```

## GsSceneLoader Signature Change

`GsSceneLoader` drops its `AppBase& app_` member. The `load` method takes a context:

```cpp
class GsSceneLoader {
public:
    void load(SceneLoadContext& ctx, const SceneData& scene_data,
              const GsSceneOptions& opts = {});
};
```

AppBase no longer owns a `GsSceneLoader` member. The `load_gs_scene` convenience method constructs a context and calls the loader:

```cpp
void AppBase::load_gs_scene(const SceneData& data, const GsSceneOptions& opts) {
    SceneLoadContext ctx{
        gs_terrain_, scene_objects_, renderer_, scene_,
        world_, component_registry_, resources_, feature_flags_
    };
    GsSceneLoader loader;
    loader.load(ctx, data, opts);
}
```

## CommandDispatcher Signature Change

`CommandDispatcher` stores `CommandContext` instead of `AppBase&`:

```cpp
class CommandDispatcher {
public:
    explicit CommandDispatcher(CommandContext ctx);
    // ... rest unchanged
private:
    CommandContext ctx_;
    // ...
};
```

All handler lambdas change from `app_.renderer()` to `ctx_.renderer`, `app_.feature_flags()` to `ctx_.feature_flags`, etc.

## Migration Steps

1. **Introduce state object headers** — Create 4 new header files. No behavior change.
2. **Replace AppBase members with state objects** — Move members into structs, update internal references. Add temporary shim accessors for backward compatibility.
3. **Update all consumers to use state object accessors** — GameStates, DemoApp, StagingApp switch to `app.gs_terrain()`, `app.draw_lists()`, etc. Remove shim accessors.
4. **Introduce context structs and rewire satellites** — Create context headers. Change `GsSceneLoader::load()` signature. Change `CommandDispatcher` constructor. Remove `AppBase&` from both.
5. **Remove dead code** — Delete old scattered accessors.

Each step must pass `ctest`. Steps 1-3 are pure internal refactoring. Step 4 changes signatures but not behavior.

## Testing

No new tests needed for the state objects (plain aggregates). Existing test coverage:
- `test_scene_loading` — exercises SceneLoader paths
- `test_incremental_sync` — exercises game object data
- `test_component_registry` — exercises component attachment
- `test_island_systems` — exercises ECS system scheduling

Integration testing via game director (demo) and staging app validates end-to-end after step 4.

## Files Touched

| File | Change |
|------|--------|
| `include/gseurat/engine/gs_terrain_state.hpp` | **New** |
| `include/gseurat/engine/scene_object_state.hpp` | **New** |
| `include/gseurat/engine/draw_lists.hpp` | **New** |
| `include/gseurat/engine/gameplay_state.hpp` | **New** |
| `include/gseurat/engine/scene_load_context.hpp` | **New** |
| `include/gseurat/engine/command_context.hpp` | **New** |
| `include/gseurat/engine/app_base.hpp` | Replace ~20 members with 4 state objects, replace ~25 accessors with 8 |
| `include/gseurat/engine/gs_scene_loader.hpp` | Remove `AppBase&`, take `SceneLoadContext&` |
| `include/gseurat/engine/command_dispatcher.hpp` | Replace `AppBase&` with `CommandContext` |
| `src/engine/app_base.cpp` | Update all internal references, construct contexts |
| `src/engine/gs_scene_loader.cpp` | `app_.X()` to `ctx.X` throughout |
| `src/engine/command_dispatcher.cpp` | `app_.X()` to `ctx_.X` throughout |
| `src/demo/demo_app.cpp` | Update to state object accessors |
| `src/demo/island_demo_state.cpp` | Update to state object accessors |
| `src/staging/staging_app.cpp` | Update to state object accessors |
| `src/staging/staging_state.cpp` | Update to state object accessors |
