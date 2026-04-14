# Bone Animation Engine Promotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `BoneAnimationRegistry`, `BoneAnimatedTag`, and `bone_animation_system` from the demo layer to the engine layer, with `AppBase` owning the registry and handling lifecycle automatically.

**Architecture:** `AppBase` owns a `BoneAnimationRegistry` instance. The scene loader (already engine-level) populates bone allocations. A new engine-level `populate_bone_animation_registry()` function converts allocations into registry entries after entity creation. `bone_animation_system` and `gather_bone_animation_transforms()` are engine-level functions. The demo state loses its registry member and delegates to `app.bone_animation_registry()`.

**Tech Stack:** C++23, ECS (header-only archetype), GLM, nlohmann/json, BoneAnimationPlayer/BoneAnimationStateMachine/CharacterData.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `include/gseurat/engine/bone_animated_component.hpp` | Create | `BoneAnimatedTag` struct (moved from `island_components.hpp`) |
| `include/gseurat/engine/bone_animation_registry.hpp` | Move from `include/gseurat/demo/` | `BoneAnimationEntry`, `BoneAnimationRegistry` |
| `include/gseurat/engine/bone_animation_system.hpp` | Create | Declarations: `bone_animation_system`, `gather_bone_animation_transforms`, `populate_bone_animation_registry` |
| `src/engine/bone_animation_system.cpp` | Create | Implementations of the three engine functions |
| `include/gseurat/engine/app_base.hpp` | Modify | Add registry member + accessor |
| `src/engine/app_base.cpp` | Modify | Register system, clear in `clear_scene`, populate in `load_gs_scene`, update include paths |
| `src/engine/gs_scene_loader.cpp` | Modify | Update include path for `BoneAnimatedTag` |
| `include/gseurat/demo/island_components.hpp` | Modify | Remove `BoneAnimatedTag` (now engine-level) |
| `include/gseurat/demo/island_systems.hpp` | Modify | Remove `bone_animation_system`, remove global accessor declarations |
| `src/demo/island_systems.cpp` | Modify | Remove `bone_animation_system`, remove global accessor, update `npc_walker_system` registry access |
| `include/gseurat/demo/island_demo_state.hpp` | Modify | Remove `bone_anim_registry_` member, remove registry include |
| `src/demo/island_demo_state.cpp` | Modify | Use `app.bone_animation_registry()`, remove population loops, use `gather_bone_animation_transforms()` |
| `include/gseurat/demo/bone_animation_registry.hpp` | Delete | Moved to engine |
| `CMakeLists.txt` | Modify | Add `src/engine/bone_animation_system.cpp` to `gseurat_core` |

---

### Task 1: Create engine-level BoneAnimatedTag component

**Files:**
- Create: `include/gseurat/engine/bone_animated_component.hpp`

- [ ] **Step 1: Create the new engine-level component header**

```cpp
// include/gseurat/engine/bone_animated_component.hpp
#pragma once

#include <cstdint>

namespace gseurat {

/// Marker component for bone-animated entities.
/// Actual animation state lives in BoneAnimationRegistry (side map).
/// Stored in ECS archetype (trivially copyable).
struct BoneAnimatedTag {
    uint32_t registry_id = 0;  // key into BoneAnimationRegistry
};

}  // namespace gseurat
```

- [ ] **Step 2: Build to verify no conflicts**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds (new header not yet included anywhere)

- [ ] **Step 3: Commit**

```bash
git add include/gseurat/engine/bone_animated_component.hpp
git commit -m "feat(engine): add BoneAnimatedTag component at engine level"
```

---

### Task 2: Move BoneAnimationRegistry to engine layer

**Files:**
- Move: `include/gseurat/demo/bone_animation_registry.hpp` → `include/gseurat/engine/bone_animation_registry.hpp`
- Modify: `include/gseurat/demo/island_demo_state.hpp`
- Modify: `src/demo/island_systems.cpp`

- [ ] **Step 1: Move the registry header to the engine directory**

Copy `include/gseurat/demo/bone_animation_registry.hpp` to `include/gseurat/engine/bone_animation_registry.hpp`. The content is unchanged — just the location moves.

```bash
cp include/gseurat/demo/bone_animation_registry.hpp include/gseurat/engine/bone_animation_registry.hpp
rm include/gseurat/demo/bone_animation_registry.hpp
```

- [ ] **Step 2: Update include in island_demo_state.hpp**

In `include/gseurat/demo/island_demo_state.hpp`, change line 13:

Old:
```cpp
#include "gseurat/demo/bone_animation_registry.hpp"
```

New:
```cpp
#include "gseurat/engine/bone_animation_registry.hpp"
```

- [ ] **Step 3: Update include in island_systems.cpp**

In `src/demo/island_systems.cpp`, change line 3:

Old:
```cpp
#include "gseurat/demo/bone_animation_registry.hpp"
```

New:
```cpp
#include "gseurat/engine/bone_animation_registry.hpp"
```

- [ ] **Step 4: Build to verify**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add include/gseurat/engine/bone_animation_registry.hpp \
        include/gseurat/demo/island_demo_state.hpp \
        src/demo/island_systems.cpp
git rm include/gseurat/demo/bone_animation_registry.hpp
git commit -m "refactor(engine): move BoneAnimationRegistry from demo to engine layer"
```

---

### Task 3: Create engine-level bone_animation_system

**Files:**
- Create: `include/gseurat/engine/bone_animation_system.hpp`
- Create: `src/engine/bone_animation_system.cpp`
- Modify: `CMakeLists.txt`

- [ ] **Step 1: Create the header**

```cpp
// include/gseurat/engine/bone_animation_system.hpp
#pragma once

#include "gseurat/engine/ecs/world.hpp"

#include <glm/glm.hpp>
#include <cstdint>

namespace gseurat {

class BoneAnimationRegistry;
struct GsTerrainState;

/// Engine-level bone animation update. Iterates BoneAnimatedTag entities,
/// lazy-initializes from character manifests, advances animation playback.
void bone_animation_system(ecs::World& world, float dt, BoneAnimationRegistry& registry);

/// Gather NPC bone transforms from the registry into a bone array.
/// Writes transforms at [first_bone_index .. first_bone_index + bone_count) for each initialized entry.
/// Returns the highest bone slot used (for total_bones calculation).
[[nodiscard]] uint32_t gather_bone_animation_transforms(
    const BoneAnimationRegistry& registry,
    glm::mat4* bones,
    uint32_t max_bones = 32);

/// Populate registry from BoneAllocation data + existing BoneAnimatedTag ECS entities.
/// Matches allocations to entities by comparing world positions (< 1.0 unit tolerance).
void populate_bone_animation_registry(
    BoneAnimationRegistry& registry,
    ecs::World& world,
    const GsTerrainState& terrain);

}  // namespace gseurat
```

- [ ] **Step 2: Create the implementation**

```cpp
// src/engine/bone_animation_system.cpp
#include "gseurat/engine/bone_animation_system.hpp"
#include "gseurat/engine/bone_animation_registry.hpp"
#include "gseurat/engine/bone_animated_component.hpp"
#include "gseurat/engine/gs_terrain_state.hpp"
#include "gseurat/engine/ecs/default_components.hpp"
#include "gseurat/character/character_manifest.hpp"

#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/quaternion.hpp>

#include <cstdio>

namespace gseurat {

void bone_animation_system(ecs::World& world, float dt, BoneAnimationRegistry& registry) {
    world.view<BoneAnimatedTag, ecs::Transform>().each(
        [&](ecs::Entity entity, BoneAnimatedTag& tag, ecs::Transform& t) {
            auto* entry = registry.get(tag.registry_id);
            if (!entry) return;

            // Lazy initialization
            if (!entry->initialized) {
                auto manifest = load_character_manifest(entry->manifest_path);
                if (!manifest) return;
                entry->character_data = std::make_unique<CharacterData>(std::move(*manifest));
                entry->anim_player = std::make_unique<BoneAnimationPlayer>(*entry->character_data);
                entry->anim_sm = std::make_unique<BoneAnimationStateMachine>(*entry->anim_player);

                // Register clips as states
                for (const auto& clip : entry->character_data->clips) {
                    entry->anim_sm->add_state(clip.name, clip.name);
                }
                entry->anim_sm->set_state(entry->default_clip);

                entry->spawn_pos = t.position.vec();
                entry->current_pos = t.position.vec();
                entry->initialized = true;
                std::fprintf(stderr, "[BoneAnimSystem] Initialized '%s': %u bones, clip='%s'\n",
                             entry->manifest_path.c_str(), entry->bone_count, entry->default_clip.c_str());
            }

            // Update position from Transform (NpcWalker moves this)
            entry->current_pos = t.position.vec();

            // Check for clip change from behavior systems
            if (!entry->requested_clip.empty() &&
                entry->requested_clip != entry->anim_sm->current_state()) {
                entry->anim_sm->set_state(entry->requested_clip);
            }

            // Advance animation
            entry->anim_player->update(dt);
        });
}

uint32_t gather_bone_animation_transforms(
    const BoneAnimationRegistry& registry,
    glm::mat4* bones,
    uint32_t max_bones) {

    uint32_t highest_slot = 0;

    for (const auto& [id, entry] : registry.entries()) {
        if (!entry.initialized || !entry.anim_player) continue;
        if (entry.first_bone_index + entry.bone_count > max_bones) continue;

        const float scale_val = entry.char_scale;
        const glm::vec3 y_off(0.0f, 2.0f, 0.0f);
        const glm::vec3 char_scale(scale_val, scale_val * entry.gs_scale_multiplier, scale_val);
        const glm::vec3 inv_scale(1.0f / char_scale.x, 1.0f / char_scale.y, 1.0f / char_scale.z);

        glm::mat4 from_world =
            glm::rotate(glm::mat4(1.0f), -glm::pi<float>(), {0, 1, 0}) *
            glm::scale(glm::mat4(1.0f), inv_scale) *
            glm::translate(glm::mat4(1.0f), -(entry.spawn_pos + y_off));

        glm::quat rot = glm::angleAxis(entry.facing_angle, glm::vec3(0, 1, 0));
        glm::mat4 to_world =
            glm::translate(glm::mat4(1.0f), entry.current_pos + y_off) *
            glm::mat4_cast(rot) *
            glm::scale(glm::mat4(1.0f), char_scale) *
            glm::rotate(glm::mat4(1.0f), glm::pi<float>(), {0, 1, 0});

        const auto& npc_bones = entry.anim_player->bone_transforms();
        for (uint32_t i = 0; i < entry.bone_count && (entry.first_bone_index + i) < max_bones; ++i) {
            bones[entry.first_bone_index + i] = to_world * npc_bones[i] * from_world;
        }

        uint32_t end_slot = entry.first_bone_index + entry.bone_count;
        if (end_slot > highest_slot) highest_slot = end_slot;
    }

    return highest_slot;
}

void populate_bone_animation_registry(
    BoneAnimationRegistry& registry,
    ecs::World& world,
    const GsTerrainState& terrain) {

    registry.clear();

    for (const auto& alloc : terrain.bone_allocations) {
        world.view<BoneAnimatedTag, ecs::Transform>().each(
            [&](ecs::Entity entity, BoneAnimatedTag& tag, ecs::Transform& t) {
                if (tag.registry_id != 0) return;  // already assigned
                glm::vec3 diff = t.position.vec() - alloc.world_pos;
                if (glm::length(diff) < 1.0f) {
                    BoneAnimationEntry entry;
                    entry.manifest_path = alloc.manifest_path;
                    entry.default_clip = alloc.default_clip;
                    entry.first_bone_index = alloc.first_bone_index;
                    entry.bone_count = alloc.bone_count;
                    entry.char_scale = alloc.char_scale;
                    entry.gs_scale_multiplier = alloc.gs_scale_multiplier;
                    entry.spawn_pos = alloc.world_pos;
                    entry.current_pos = alloc.world_pos;
                    tag.registry_id = registry.add(entity, std::move(entry));
                }
            });
    }
}

}  // namespace gseurat
```

- [ ] **Step 3: Add to CMakeLists.txt**

In `CMakeLists.txt`, add `src/engine/bone_animation_system.cpp` to the `gseurat_core` OBJECT library. Add after line 189 (`src/engine/world_streamer.cpp`):

```cmake
    src/engine/bone_animation_system.cpp
```

- [ ] **Step 4: Build to verify**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds (new code compiles but isn't called yet)

- [ ] **Step 5: Commit**

```bash
git add include/gseurat/engine/bone_animation_system.hpp \
        src/engine/bone_animation_system.cpp \
        CMakeLists.txt
git commit -m "feat(engine): add bone_animation_system, gather transforms, and populate registry"
```

---

### Task 4: Integrate registry into AppBase

**Files:**
- Modify: `include/gseurat/engine/app_base.hpp`
- Modify: `src/engine/app_base.cpp`

- [ ] **Step 1: Add registry member and accessor to app_base.hpp**

In `include/gseurat/engine/app_base.hpp`, add the include after line 25 (`#include "gseurat/engine/gs_terrain_state.hpp"`):

```cpp
#include "gseurat/engine/bone_animation_registry.hpp"
```

Add the public accessor after line 83 (`const DrawLists& draw_lists() const { return draw_lists_; }`):

```cpp
    BoneAnimationRegistry& bone_animation_registry() { return bone_anim_registry_; }
    [[nodiscard]] const BoneAnimationRegistry& bone_animation_registry() const { return bone_anim_registry_; }
```

Add the protected member after line 175 (`GsTerrainState gs_terrain_;`):

```cpp
    BoneAnimationRegistry bone_anim_registry_;
```

- [ ] **Step 2: Update clear_scene in app_base.cpp**

In `src/engine/app_base.cpp`, change line 154 from:

```cpp
void AppBase::clear_scene() {}
```

to:

```cpp
void AppBase::clear_scene() {
    bone_anim_registry_.clear();
}
```

- [ ] **Step 3: Update load_gs_scene to populate registry after entity creation**

In `src/engine/app_base.cpp`, add include at the top (after the existing includes):

```cpp
#include "gseurat/engine/bone_animation_system.hpp"
```

Change the `load_gs_scene` method (lines 377-384) from:

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

to:

```cpp
void AppBase::load_gs_scene(const SceneData& scene_data, const GsSceneOptions& opts) {
    SceneLoadContext ctx{
        gs_terrain_, scene_objects_, renderer_, scene_,
        world_, component_registry_, resources_, feature_flags_
    };
    GsSceneLoader loader;
    loader.load(ctx, scene_data, opts);

    // Populate bone animation registry from allocations created by the scene loader
    populate_bone_animation_registry(bone_anim_registry_, world_, gs_terrain_);
}
```

- [ ] **Step 4: Register bone_animation_system as an engine system**

In `src/engine/app_base.cpp`, update the `BoneAnimatedTag` component registration in `init_game_object_system()`. First, change the include at line 4 from:

```cpp
#include "gseurat/demo/island_components.hpp"
```

to:

```cpp
#include "gseurat/demo/island_components.hpp"
#include "gseurat/engine/bone_animated_component.hpp"
#include "gseurat/engine/bone_animation_system.hpp"
```

Then, at the end of `init_game_object_system()` (after the `BoneAnimatedTag` registration, after line 353), add the system registration:

```cpp
    // Register engine-level bone animation system
    system_scheduler_.add_system({"bone_animation",
        [this](ecs::World& w, float dt) {
            bone_animation_system(w, dt, bone_anim_registry_);
        }, {}, {}});
```

- [ ] **Step 5: Update BoneAnimatedTag registration to use engine-level header**

In `src/engine/app_base.cpp`, the `BoneAnimatedTag` registration at line 344 already works because we added the `bone_animated_component.hpp` include. But we need to make sure the type resolves from the engine header. The `island_components.hpp` still has a `BoneAnimatedTag` — we'll remove that in Task 6. For now, both define the same struct in the same namespace, which will cause a redefinition error. To avoid this, we do Task 6 (remove from island_components) in the same commit as this task.

**Actually, defer this step to Task 6 where we update island_components.hpp simultaneously.**

- [ ] **Step 6: Build to verify**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: May fail due to `BoneAnimatedTag` redefinition — that's expected, Task 5 fixes it.

- [ ] **Step 7: Commit (combined with Task 5 to avoid broken intermediate state)**

Do NOT commit yet — proceed to Task 5.

---

### Task 5: Remove demo-level bone animation code

This task MUST be done together with Task 4 to avoid compilation errors from duplicate `BoneAnimatedTag` definitions.

**Files:**
- Modify: `include/gseurat/demo/island_components.hpp`
- Modify: `include/gseurat/demo/island_systems.hpp`
- Modify: `src/demo/island_systems.cpp`

- [ ] **Step 1: Remove BoneAnimatedTag from island_components.hpp**

In `include/gseurat/demo/island_components.hpp`, remove lines 111-114:

```cpp
/// Marker component for bone-animated entities (actual state in BoneAnimationRegistry).
struct BoneAnimatedTag {
    uint32_t registry_id = 0;  // key into BoneAnimationRegistry
};
```

- [ ] **Step 2: Add engine include to island_components.hpp**

Since other files include `island_components.hpp` and expect `BoneAnimatedTag` to be available, add the engine include. At the top of `include/gseurat/demo/island_components.hpp`, after line 3 (`#include "gseurat/engine/collision_gen.hpp"`):

```cpp
#include "gseurat/engine/bone_animated_component.hpp"
```

- [ ] **Step 3: Remove bone_animation_system from island_systems.hpp**

In `include/gseurat/demo/island_systems.hpp`, remove lines 12-16:

```cpp
void bone_animation_system(ecs::World& world, float dt);

class BoneAnimationRegistry;
void set_bone_animation_registry(BoneAnimationRegistry* reg);
BoneAnimationRegistry* get_bone_animation_registry();
```

- [ ] **Step 4: Remove bone_animation_system and global accessor from island_systems.cpp**

In `src/demo/island_systems.cpp`:

Remove the `bone_animation_registry.hpp` include (line 3):
```cpp
#include "gseurat/demo/bone_animation_registry.hpp"
```

Replace it with:
```cpp
#include "gseurat/engine/bone_animation_registry.hpp"
```

Remove the anonymous namespace with the global pointer and accessor functions (lines 12-22):

```cpp
namespace {
BoneAnimationRegistry* g_bone_anim_registry = nullptr;
}  // namespace

void set_bone_animation_registry(BoneAnimationRegistry* reg) {
    g_bone_anim_registry = reg;
}

BoneAnimationRegistry* get_bone_animation_registry() {
    return g_bone_anim_registry;
}
```

Remove the entire `bone_animation_system` function (lines 24-65):

```cpp
void bone_animation_system(ecs::World& world, float dt) {
    // ... entire function body ...
}
```

- [ ] **Step 5: Update npc_walker_system to accept registry pointer**

The `npc_walker_system` currently uses `g_bone_anim_registry` which we just removed. We need a different approach. Since `npc_walker_system` is registered as a lambda in `island_demo_state.cpp`, we can capture the registry pointer there. But the current function signature `void npc_walker_system(ecs::World& world, float dt)` doesn't accept a registry.

**Approach:** Add a module-level setter for the registry pointer in `island_systems.cpp`, but scoped only to `npc_walker_system` needs:

In `src/demo/island_systems.cpp`, add after the includes:

```cpp
#include "gseurat/engine/bone_animation_registry.hpp"

namespace {
BoneAnimationRegistry* g_npc_bone_registry = nullptr;
}  // namespace
```

And add a new setter/getter pair. In `include/gseurat/demo/island_systems.hpp`, replace the removed lines with:

```cpp
// NPC walker needs registry access for clip/facing updates
class BoneAnimationRegistry;
void set_npc_bone_registry(BoneAnimationRegistry* reg);
```

In `src/demo/island_systems.cpp`, add before `npc_walker_system`:

```cpp
void set_npc_bone_registry(BoneAnimationRegistry* reg) {
    g_npc_bone_registry = reg;
}
```

Then in `npc_walker_system`, replace all 3 occurrences of `g_bone_anim_registry` with `g_npc_bone_registry`.

- [ ] **Step 6: Build to verify (together with Task 4)**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds (though demo state still references old patterns — fixed in Task 6)

- [ ] **Step 7: Commit Tasks 4+5 together**

```bash
git add include/gseurat/engine/app_base.hpp \
        src/engine/app_base.cpp \
        include/gseurat/demo/island_components.hpp \
        include/gseurat/demo/island_systems.hpp \
        src/demo/island_systems.cpp
git commit -m "refactor(engine): integrate BoneAnimationRegistry into AppBase, remove demo-level system"
```

---

### Task 6: Update IslandDemoState to use engine-level registry

**Files:**
- Modify: `include/gseurat/demo/island_demo_state.hpp`
- Modify: `src/demo/island_demo_state.cpp`

- [ ] **Step 1: Remove registry member from header**

In `include/gseurat/demo/island_demo_state.hpp`:

Remove the include at line 13:
```cpp
#include "gseurat/demo/bone_animation_registry.hpp"
```

Remove the member at line 94:
```cpp
    BoneAnimationRegistry bone_anim_registry_;
```

- [ ] **Step 2: Update on_enter() — remove registry setup and population**

In `src/demo/island_demo_state.cpp`, in `on_enter()`:

Remove lines 259-260:
```cpp
    app.system_scheduler().add_system({"bone_animation", bone_animation_system, {}, {}});
    set_bone_animation_registry(&bone_anim_registry_);
```

Replace with:
```cpp
    set_npc_bone_registry(&app.bone_animation_registry());
```

Add the include at the top of the file (after existing includes):
```cpp
#include "gseurat/engine/bone_animation_system.hpp"
```

Remove the registry population loop (lines 456-475 — the `bone_anim_registry_.clear()` through the end of the `for` loop over `bone_allocations`). This is now handled automatically by `AppBase::load_gs_scene()`.

**However**, the chunk NPC processing (lines 330-398) adds bone allocations to `app.gs_terrain().bone_allocations` AFTER `load_gs_scene` has already been called. So we need a single `populate_bone_animation_registry` call AFTER all chunk processing is done. Add this line after the chunk merge loop (after line 414, after the `world_streamer_` block closes):

```cpp
        // Re-populate registry with all bone allocations (main scene + chunks)
        populate_bone_animation_registry(app.bone_animation_registry(), app.world(), app.gs_terrain());
```

- [ ] **Step 3: Update on_exit() — remove registry cleanup**

In `src/demo/island_demo_state.cpp`, in `on_exit()`:

Remove lines 527-528:
```cpp
    bone_anim_registry_.clear();
    set_bone_animation_registry(nullptr);
```

Replace with:
```cpp
    set_npc_bone_registry(nullptr);
```

(The registry clear is now handled by `AppBase::clear_scene()`.)

- [ ] **Step 4: Update portal transition — remove registry repopulation**

In `src/demo/island_demo_state.cpp`, in the portal transition code:

Remove the registry repopulation block (lines 947-966 — from `bone_anim_registry_.clear()` through the end of the `for` loop). Replace with:

```cpp
                    // Re-populate bone animation registry for the new scene
                    populate_bone_animation_registry(app.bone_animation_registry(), app.world(), app.gs_terrain());
```

- [ ] **Step 5: Update bone transform gathering in update_walk_animation()**

In `src/demo/island_demo_state.cpp`, in `update_walk_animation()`:

Replace lines 1473-1505 (the entire registry iteration block AND the total_bones update) with:

```cpp
        // Gather NPC bone transforms from engine-level registry
        uint32_t npc_highest = gather_bone_animation_transforms(
            app.bone_animation_registry(), bones, 32);

        // Total bones: player bones + registry NPCs
        int total_bones = bone_count + 1;
        if (npc_highest > static_cast<uint32_t>(total_bones)) {
            total_bones = static_cast<int>(npc_highest);
        }
        if (app.gs_terrain().bone_slot_counter > static_cast<uint32_t>(total_bones)) {
            total_bones = static_cast<int>(app.gs_terrain().bone_slot_counter);
        }
```

- [ ] **Step 6: Build to verify**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 7: Commit**

```bash
git add include/gseurat/demo/island_demo_state.hpp \
        src/demo/island_demo_state.cpp
git commit -m "refactor(demo): use engine-level bone animation registry via AppBase"
```

---

### Task 7: Update gs_scene_loader include and clean up

**Files:**
- Modify: `src/engine/gs_scene_loader.cpp` (if needed)
- Modify: `src/engine/app_base.cpp` (clean up duplicate includes)

- [ ] **Step 1: Check gs_scene_loader.cpp includes**

The scene loader references `"BoneAnimated"` as a string in JSON, not as a C++ type. It doesn't need to include the component header. Verify there's no `#include "island_components.hpp"` in it.

Run: `grep -n 'island_components\|bone_animated' src/engine/gs_scene_loader.cpp`

If no matches for the include, no change needed.

- [ ] **Step 2: Clean up app_base.cpp includes**

In `src/engine/app_base.cpp`, ensure there are no duplicate or unnecessary includes. The file should have:
- `#include "gseurat/demo/island_components.hpp"` — still needed for `PlayerController`, `ProximityTrigger`, `NpcWalker`, etc.
- `#include "gseurat/engine/bone_animated_component.hpp"` — for `BoneAnimatedTag` registration
- `#include "gseurat/engine/bone_animation_system.hpp"` — for system registration

Remove `#include "gseurat/engine/bone_animation_registry.hpp"` from `app_base.cpp` if present (it comes transitively via `app_base.hpp`).

- [ ] **Step 3: Full release build**

Run: `cmake --build --preset macos-release --target gseurat_demo 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Commit if any changes**

```bash
git add src/engine/gs_scene_loader.cpp src/engine/app_base.cpp
git commit -m "chore: clean up includes after bone animation engine promotion"
```

---

### Task 8: Verify and test

**Files:** None (testing only)

- [ ] **Step 1: Build debug**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds with no warnings related to bone animation

- [ ] **Step 2: Build release**

Run: `cmake --build --preset macos-release --target gseurat_demo 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Run existing tests**

Run: `cd build/macos-debug && ctest --output-on-failure 2>&1 | tail -20`
Expected: All tests pass

- [ ] **Step 4: Verify no demo code references old patterns**

Run:
```bash
grep -rn 'set_bone_animation_registry\|get_bone_animation_registry\|g_bone_anim_registry' src/ include/ --include='*.cpp' --include='*.hpp'
```
Expected: No matches (all replaced with `set_npc_bone_registry` / `g_npc_bone_registry` or removed)

Run:
```bash
grep -rn 'demo/bone_animation_registry' src/ include/ --include='*.cpp' --include='*.hpp'
```
Expected: No matches (all paths updated to `engine/bone_animation_registry`)

- [ ] **Step 5: Verify the deleted file is gone**

Run: `ls include/gseurat/demo/bone_animation_registry.hpp`
Expected: No such file

- [ ] **Step 6: Commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: final adjustments for bone animation engine promotion"
```
