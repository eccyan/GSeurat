# Data-Driven Bone-Animated NPCs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move knight and slime NPC spawning from hardcoded C++ into scene JSON, so portal transitions handle NPCs automatically via `init_scene`.

**Architecture:** Add a `BoneAnimatedTag` marker component (trivially copyable) to ECS, with full animation state in a side map (`BoneAnimationRegistry`). The scene loader assigns bone indices during PLY merge. A new `bone_animation_system` drives playback and uploads transforms each frame.

**Tech Stack:** C++23, ECS (header-only archetype), GLM, nlohmann/json, existing `BoneAnimationPlayer`/`BoneAnimationStateMachine`/`CharacterData`.

---

### Task 1: Add BoneAnimatedTag component and BoneAnimationRegistry

**Files:**
- Modify: `include/gseurat/demo/island_components.hpp`
- Create: `include/gseurat/demo/bone_animation_registry.hpp`
- Modify: `src/engine/app_base.cpp` (component registration)

- [ ] **Step 1: Add BoneAnimatedTag to island_components.hpp**

Add after the `CollisionGridRef` struct (around line 94):

```cpp
/// Marker component for bone-animated entities (actual state in BoneAnimationRegistry).
struct BoneAnimatedTag {
    uint32_t registry_id = 0;  // key into BoneAnimationRegistry
};
```

- [ ] **Step 2: Create bone_animation_registry.hpp**

```cpp
#pragma once

#include "gseurat/character/bone_animation_player.hpp"
#include "gseurat/character/bone_animation_state_machine.hpp"
#include "gseurat/character/character_manifest.hpp"
#include "gseurat/engine/ecs/types.hpp"

#include <glm/glm.hpp>
#include <memory>
#include <string>
#include <unordered_map>

namespace gseurat {

struct BoneAnimationEntry {
    std::string manifest_path;
    std::string default_clip;
    std::string requested_clip;       // set by behavior systems
    uint32_t first_bone_index = 0;
    uint32_t bone_count = 0;
    float char_scale = 1.0f;         // from game object scale
    float gs_scale_multiplier = 1.0f; // scene scale_multiplier
    glm::vec3 spawn_pos{0.0f};       // initial world position (for bone transform anchoring)
    glm::vec3 current_pos{0.0f};     // updated by walker system
    float facing_angle = 0.0f;       // updated by walker system

    // Lazy-initialized
    std::unique_ptr<CharacterData> character_data;
    std::unique_ptr<BoneAnimationPlayer> anim_player;
    std::unique_ptr<BoneAnimationStateMachine> anim_sm;
    bool initialized = false;
};

class BoneAnimationRegistry {
public:
    uint32_t add(ecs::Entity entity, BoneAnimationEntry entry) {
        uint32_t id = next_id_++;
        entries_[id] = std::move(entry);
        entity_to_id_[entity] = id;
        return id;
    }

    BoneAnimationEntry* get(uint32_t id) {
        auto it = entries_.find(id);
        return it != entries_.end() ? &it->second : nullptr;
    }

    BoneAnimationEntry* get_by_entity(ecs::Entity entity) {
        auto it = entity_to_id_.find(entity);
        if (it == entity_to_id_.end()) return nullptr;
        return get(it->second);
    }

    void clear() {
        entries_.clear();
        entity_to_id_.clear();
        next_id_ = 1;
    }

    const std::unordered_map<uint32_t, BoneAnimationEntry>& entries() const {
        return entries_;
    }

private:
    std::unordered_map<uint32_t, BoneAnimationEntry> entries_;
    std::unordered_map<ecs::Entity, uint32_t> entity_to_id_;
    uint32_t next_id_ = 1;
};

}  // namespace gseurat
```

- [ ] **Step 3: Register BoneAnimatedTag component in app_base.cpp**

Add after the `NpcWalker` registration (around line 342):

```cpp
component_registry_.register_component<BoneAnimatedTag>("BoneAnimated",
    [](const nlohmann::json& j) -> BoneAnimatedTag {
        BoneAnimatedTag c;
        // registry_id is assigned by scene loader, not from JSON
        (void)j;
        return c;
    },
    [](const BoneAnimatedTag& c) -> nlohmann::json {
        return {{"registry_id", c.registry_id}};
    });
```

- [ ] **Step 4: Add include for island_components.hpp in app_base.cpp**

Ensure `#include "gseurat/demo/island_components.hpp"` is present (it should already be, since NpcWalker is registered there).

- [ ] **Step 5: Build to verify compilation**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add include/gseurat/demo/island_components.hpp \
        include/gseurat/demo/bone_animation_registry.hpp \
        src/engine/app_base.cpp
git commit -m "feat: add BoneAnimatedTag component and BoneAnimationRegistry"
```

---

### Task 2: Extend scene loader with bone-aware PLY merging

**Files:**
- Modify: `include/gseurat/engine/gs_terrain_state.hpp`
- Modify: `src/engine/gs_scene_loader.cpp`

- [ ] **Step 1: Add bone allocation storage to GsTerrainState**

In `include/gseurat/engine/gs_terrain_state.hpp`, add after `pbd_configs` (line 18):

```cpp
// Bone-animated game object allocations (populated by scene loader)
struct BoneAllocation {
    std::string manifest_path;
    std::string default_clip;
    uint32_t first_bone_index = 0;
    uint32_t bone_count = 0;
    float char_scale = 1.0f;
    float gs_scale_multiplier = 1.0f;
    glm::vec3 world_pos{0.0f};
    size_t game_object_index = 0;  // index into snapped_objects for entity lookup
};
std::vector<BoneAllocation> bone_allocations;
uint32_t bone_slot_counter = 8;  // first 8 reserved for player
```

Add `#include <string>` to the header if not already present.

- [ ] **Step 2: Add bone index assignment in the PLY merge loop**

In `src/engine/gs_scene_loader.cpp`, before the game object PLY merge loop (around line 99), add bone allocation scanning:

```cpp
// Pre-scan: allocate bone slots for BoneAnimated game objects
ctx.terrain.bone_allocations.clear();
ctx.terrain.bone_slot_counter = 8;  // reserve 0-7 for player
for (size_t i = 0; i < snapped_objects.size(); ++i) {
    const auto& go = snapped_objects[i];
    if (go.components.is_null() || !go.components.contains("BoneAnimated")) continue;
    const auto& ba_json = go.components["BoneAnimated"];
    std::string manifest_path = ba_json.value("manifest", std::string{});
    if (manifest_path.empty()) continue;

    auto manifest = load_character_manifest(manifest_path);
    if (!manifest) {
        std::fprintf(stderr, "[GS] BoneAnimated: failed to load manifest '%s'\n",
                     manifest_path.c_str());
        continue;
    }
    uint32_t bone_count = static_cast<uint32_t>(manifest->bones.size());
    if (ctx.terrain.bone_slot_counter + bone_count > 32) {
        std::fprintf(stderr, "[GS] BoneAnimated: bone budget exceeded for '%s' (need %u, have %u)\n",
                     go.id.c_str(), bone_count, 32 - ctx.terrain.bone_slot_counter);
        continue;
    }

    GsTerrainState::BoneAllocation alloc;
    alloc.manifest_path = manifest_path;
    alloc.default_clip = ba_json.value("default_clip", std::string{"idle"});
    alloc.first_bone_index = ctx.terrain.bone_slot_counter;
    alloc.bone_count = bone_count;
    alloc.char_scale = go.scale;
    alloc.gs_scale_multiplier = gs_scale_multiplier;
    alloc.world_pos = world_positions[i].vec();
    alloc.game_object_index = i;
    ctx.terrain.bone_allocations.push_back(alloc);
    ctx.terrain.bone_slot_counter += bone_count;

    std::fprintf(stderr, "[GS] BoneAnimated '%s': bones %u-%u (count=%u)\n",
                 go.id.c_str(), alloc.first_bone_index,
                 alloc.first_bone_index + bone_count - 1, bone_count);
}
```

Add `#include "gseurat/character/character_manifest.hpp"` at the top of gs_scene_loader.cpp.

- [ ] **Step 3: Apply bone indices during PLY merge**

Inside the existing PLY merge loop (around line 141, where each Gaussian is transformed), add bone index remapping. Find the block that transforms placed Gaussians and add a check:

After the transform application and before `merged.push_back(g)`, check if this game object has a bone allocation:

```cpp
// Check if this game object has bone animation
uint32_t ba_first_bone = 0;
bool has_bone_anim = false;
for (const auto& alloc : ctx.terrain.bone_allocations) {
    if (alloc.game_object_index == i) {
        ba_first_bone = alloc.first_bone_index;
        has_bone_anim = true;
        break;
    }
}
```

Then in the per-Gaussian loop, if `has_bone_anim`:
```cpp
if (has_bone_anim) {
    g.bone_index = ba_first_bone + g.bone_index;
}
```

This replaces the PBD bone_index assignment for these objects (PBD and bone animation are mutually exclusive per game object — PBD is for trees, bone animation is for characters).

- [ ] **Step 4: Build to verify compilation**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add include/gseurat/engine/gs_terrain_state.hpp \
        src/engine/gs_scene_loader.cpp
git commit -m "feat: bone-aware PLY merging in scene loader"
```

---

### Task 3: Add bone_animation_system

**Files:**
- Modify: `include/gseurat/demo/island_systems.hpp`
- Modify: `src/demo/island_systems.cpp`

- [ ] **Step 1: Declare bone_animation_system in island_systems.hpp**

Add after the `npc_walker_system` declaration:

```cpp
void bone_animation_system(ecs::World& world, float dt);
```

- [ ] **Step 2: Add global BoneAnimationRegistry accessor**

The system needs access to the registry. Add a simple global accessor in `island_systems.hpp`:

```cpp
class BoneAnimationRegistry;
void set_bone_animation_registry(BoneAnimationRegistry* reg);
BoneAnimationRegistry* get_bone_animation_registry();
```

- [ ] **Step 3: Implement bone_animation_system in island_systems.cpp**

Add at the end of the file:

```cpp
#include "gseurat/demo/bone_animation_registry.hpp"
#include "gseurat/character/character_manifest.hpp"

namespace {
BoneAnimationRegistry* g_bone_anim_registry = nullptr;
}

void set_bone_animation_registry(BoneAnimationRegistry* reg) {
    g_bone_anim_registry = reg;
}

BoneAnimationRegistry* get_bone_animation_registry() {
    return g_bone_anim_registry;
}

void bone_animation_system(ecs::World& world, float dt) {
    if (!g_bone_anim_registry) return;

    world.view<BoneAnimatedTag, ecs::Transform>().each(
        [&](ecs::Entity entity, BoneAnimatedTag& tag, ecs::Transform& t) {
            auto* entry = g_bone_anim_registry->get(tag.registry_id);
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
```

- [ ] **Step 4: Add include for BoneAnimatedTag**

Ensure `#include "gseurat/demo/island_components.hpp"` is included in `island_systems.cpp` (should already be present).

- [ ] **Step 5: Build to verify compilation**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add include/gseurat/demo/island_systems.hpp \
        src/demo/island_systems.cpp
git commit -m "feat: add bone_animation_system with lazy initialization"
```

---

### Task 4: Wire bone_animation_system into island_demo_state and upload transforms

**Files:**
- Modify: `include/gseurat/demo/island_demo_state.hpp`
- Modify: `src/demo/island_demo_state.cpp`

- [ ] **Step 1: Add BoneAnimationRegistry member to IslandDemoState**

In `include/gseurat/demo/island_demo_state.hpp`, add include:

```cpp
#include "gseurat/demo/bone_animation_registry.hpp"
```

Add member after `world_streamer_` (around line 124):

```cpp
// Bone animation registry (data-driven NPC animation)
BoneAnimationRegistry bone_anim_registry_;
```

- [ ] **Step 2: Register the system and set up registry in on_enter()**

In `src/demo/island_demo_state.cpp`, in `on_enter()`, after the existing `add_system` calls (around line 258):

```cpp
app.system_scheduler().add_system({"bone_animation", bone_animation_system, {}, {}});
set_bone_animation_registry(&bone_anim_registry_);
```

- [ ] **Step 3: Populate registry from scene loader bone allocations**

After `init_scene` and the player entity creation (around line 253), add:

```cpp
// Populate bone animation registry from scene loader allocations
bone_anim_registry_.clear();
for (const auto& alloc : app.gs_terrain().bone_allocations) {
    // Find the ECS entity for this game object
    // The entity was created by gs_scene_loader at the same index
    // We need to match by transform position
    app.world().view<BoneAnimatedTag, ecs::Transform>().each(
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
                tag.registry_id = bone_anim_registry_.add(entity, std::move(entry));
            }
        });
}
```

- [ ] **Step 4: Add bone transform upload in update_walk_animation**

In `update_walk_animation()`, after the player bone transforms are written to `bones[]` (around line 1416) but before the existing knight/slime code, add NPC bone gathering:

```cpp
// Gather bone transforms from BoneAnimationRegistry (data-driven NPCs)
for (const auto& [id, entry] : bone_anim_registry_.entries()) {
    if (!entry.initialized || !entry.anim_player) continue;

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
    for (uint32_t i = 0; i < entry.bone_count && (entry.first_bone_index + i) < 32; ++i) {
        bones[entry.first_bone_index + i] = to_world * npc_bones[i] * from_world;
    }
}

// Update total bone count to include registry NPCs
if (app.gs_terrain().bone_slot_counter > static_cast<uint32_t>(total_bones)) {
    total_bones = static_cast<int>(app.gs_terrain().bone_slot_counter);
}
```

- [ ] **Step 5: Build to verify compilation**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add include/gseurat/demo/island_demo_state.hpp \
        src/demo/island_demo_state.cpp
git commit -m "feat: wire bone_animation_system into demo state with transform upload"
```

---

### Task 5: Update NpcWalker to set requested_clip on BoneAnimated entities

**Files:**
- Modify: `src/demo/island_systems.cpp`

- [ ] **Step 1: Update npc_walker_system to set requested_clip**

In `npc_walker_system` in `island_systems.cpp`, after the NpcWalker movement logic updates the transform, add clip request. At the end of the `each` lambda (before the closing brace), add:

```cpp
// Set animation clip based on movement state
if (g_bone_anim_registry) {
    auto* ba_entry = g_bone_anim_registry->get_by_entity(entity);
    if (ba_entry) {
        ba_entry->requested_clip = npc.paused ? "idle" : "walk";
        // Update facing angle from movement direction
        if (!npc.paused) {
            float dx = npc.target_x - t.position.x();
            float dz = npc.target_z - t.position.z();
            if (dx * dx + dz * dz > 0.01f) {
                ba_entry->facing_angle = std::atan2(dx, dz);
            }
        }
    }
}
```

Add `#include <cmath>` if not already present.

- [ ] **Step 2: Build to verify compilation**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/demo/island_systems.cpp
git commit -m "feat: NpcWalker sets requested_clip on BoneAnimated entries"
```

---

### Task 6: Add knight and slime NPCs to seurat_island.json

**Files:**
- Modify: `assets/scenes/seurat_island.json`

- [ ] **Step 1: Add knight game object with BoneAnimated component**

In the `game_objects` array of `assets/scenes/seurat_island.json`, add:

```json
{
  "id": "knight_01",
  "name": "Knight",
  "position": [202.0, 0.0, 187.0],
  "rotation": [0, 0, 0],
  "scale": 0.45,
  "ply_file": "assets/characters/knight/knight.ply",
  "components": {
    "BoneAnimated": {
      "manifest": "assets/characters/knight/knight.manifest.json",
      "default_clip": "idle"
    },
    "NpcWalker": {
      "patrol_radius": 12.0,
      "speed": 8.0,
      "pause_duration": 1.5
    }
  }
}
```

- [ ] **Step 2: Add slime NPC game objects with BoneAnimated component**

For each existing slime NPC in the `game_objects` array (those with `"name": "Slime ..."` and `NpcWalker` component), add `ply_file` and `BoneAnimated`:

```json
{
  "id": "slime_npc_1",
  "name": "Slime (scout)",
  "position": [190.0, 3.0, 210.0],
  "rotation": [0, 0, 0],
  "scale": 0.5,
  "ply_file": "assets/characters/slime/slime.ply",
  "components": {
    "BoneAnimated": {
      "manifest": "assets/characters/slime/slime.manifest.json",
      "default_clip": "idle"
    },
    "NpcWalker": {
      "patrol_radius": 20.0,
      "speed": 8.0,
      "pause_duration": 0.8
    },
    "ProximityTrigger": { "radius": 6 },
    "AnimationTrigger": {
      "effect_name": "pulse",
      "anim_radius": 4.0,
      "lifetime": 2.0,
      "loop": true
    }
  }
}
```

Repeat for all slime NPCs (slime_npc_1, slime_npc_2, slime_npc_3). Keep their existing positions and component data, just add `ply_file` and `BoneAnimated`.

- [ ] **Step 3: Commit**

```bash
git add assets/scenes/seurat_island.json
git commit -m "feat: add BoneAnimated component to knight and slime NPCs in scene JSON"
```

---

### Task 7: Remove hardcoded NPC code from island_demo_state

**Files:**
- Modify: `include/gseurat/demo/island_demo_state.hpp`
- Modify: `src/demo/island_demo_state.cpp`

- [ ] **Step 1: Remove NPC members from header**

In `include/gseurat/demo/island_demo_state.hpp`, remove:

- `NpcInfo` struct (lines 71-80)
- `std::vector<NpcInfo> npc_infos_` (line 81)
- `uint32_t next_bone_index_` (line 82)
- `kSlimeJumpDuration` and `kSlimeJumpHeight` constants (lines 83-84)
- `KnightInfo` struct (lines 87-95)
- `kKnightSpeed` and `kKnightPatrolRadius` constants (lines 96-97)
- `std::optional<KnightInfo> knight_info_` (line 98)
- `std::unique_ptr<gseurat::CharacterData> knight_data_` (line 99)
- `std::unique_ptr<gseurat::BoneAnimationPlayer> knight_anim_player_` (line 100)
- `std::unique_ptr<gseurat::BoneAnimationStateMachine> knight_anim_sm_` (line 101)

- [ ] **Step 2: Remove knight spawning code from on_enter()**

In `src/demo/island_demo_state.cpp`, remove the entire knight loading and PLY merge block (lines 331-389 approximately — from `// Load knight character manifest and PLY` through the end of the knight spawn).

- [ ] **Step 3: Remove slime Gaussian merging from on_enter()**

Remove the slime PLY loading and per-NPC merge block (lines 391-434 approximately — from `auto slime_cloud = GaussianCloud::load_ply("assets/characters/slime/slime.ply")` through the end of the NPC loop).

- [ ] **Step 4: Remove knight/slime bone transforms from update_walk_animation()**

Remove:
- The slime squish/jump transform block (the `for (auto& npc : npc_infos_)` loop, approximately lines 1420-1477)
- The knight bone transform block (the `if (knight_info_ && ...)` block, approximately lines 1479-1560)
- The `next_bone_index_` references in the total_bones calculation

Keep the player bone transform code and the new registry-based bone gathering from Task 4.

- [ ] **Step 5: Remove NPC re-spawn code from portal transition**

Remove the entire knight and slime re-spawn blocks from the portal `is_overworld` path (approximately lines 810-885 — the `if (knight_data_)` block and the slime re-spawn block added in PR #233).

Also remove from the `world.clear()` block:
- `npc_infos_.clear()`
- `knight_info_.reset()`

- [ ] **Step 6: Update portal transition to repopulate bone registry**

After the `init_scene` call in the portal transition, add registry repopulation (same pattern as Task 4 Step 3):

```cpp
// Repopulate bone animation registry for the new scene
bone_anim_registry_.clear();
for (const auto& alloc : app.gs_terrain().bone_allocations) {
    app.world().view<BoneAnimatedTag, ecs::Transform>().each(
        [&](ecs::Entity entity, BoneAnimatedTag& tag, ecs::Transform& t) {
            if (tag.registry_id != 0) return;
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
                tag.registry_id = bone_anim_registry_.add(entity, std::move(entry));
            }
        });
}
```

- [ ] **Step 7: Clean up on_exit()**

Remove knight_data_ cleanup from `on_exit()` if present. Add:

```cpp
bone_anim_registry_.clear();
set_bone_animation_registry(nullptr);
```

- [ ] **Step 8: Build to verify compilation**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 9: Commit**

```bash
git add include/gseurat/demo/island_demo_state.hpp \
        src/demo/island_demo_state.cpp
git commit -m "refactor: remove hardcoded NPC spawning, use data-driven bone animation"
```

---

### Task 8: Add bone_animation_registry.hpp to CMakeLists.txt and final build

**Files:**
- Modify: `CMakeLists.txt`

- [ ] **Step 1: Add new header to CMakeLists.txt**

If the project uses explicit source lists (it does — no globbing), add `include/gseurat/demo/bone_animation_registry.hpp` to the appropriate header list in CMakeLists.txt. Since it's a header-only file, it may only need to be in an IDE sources list if one exists.

Check if other headers from `include/gseurat/demo/` are listed. If not, no change needed (header-only, found via include path).

- [ ] **Step 2: Full release build**

Run: `cmake --build --preset macos-release --target gseurat_demo 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Verify the demo launches**

Run (from build dir): `./gseurat_demo`

Expected log output:
```
[GS] BoneAnimated 'knight_01': bones 8-13 (count=6)
[GS] BoneAnimated 'slime_npc_1': bones 14-14 (count=1)
[GS] BoneAnimated 'slime_npc_2': bones 15-15 (count=1)
[GS] BoneAnimated 'slime_npc_3': bones 16-16 (count=1)
[BoneAnimSystem] Initialized '...knight.manifest.json': 6 bones, clip='idle'
[BoneAnimSystem] Initialized '...slime.manifest.json': 1 bones, clip='idle'
```

- [ ] **Step 4: Test portal round-trip**

Walk to dungeon portal → enter → walk to exit portal → return to overworld.

Expected: Knight and slimes are present after return. No re-spawn log messages needed — `init_scene` handles everything.

- [ ] **Step 5: Commit if any final fixes were needed**

```bash
git add -A
git commit -m "fix: final adjustments for data-driven NPC animation"
```
