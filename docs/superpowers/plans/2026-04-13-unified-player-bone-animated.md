# Unified Player BoneAnimated Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the player character use a `BoneAnimationEntry` in the engine-level `BoneAnimationRegistry`, eliminating duplicate animation machinery while keeping player-specific behaviors (jump arc, root motion, bone 0 terrain sway).

**Architecture:** The player entity remains code-created but registers a pre-initialized `BoneAnimationEntry` in the registry. Player behavior code accesses the entry via a stored `registry_id` to set clips, read root motion, and set `y_offset` for jump arcs. `gather_bone_animation_transforms()` handles ALL bone transforms (player + NPCs).

**Tech Stack:** C++23, ECS, GLM, BoneAnimationPlayer/BoneAnimationStateMachine/CharacterData.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `include/gseurat/engine/bone_animation_registry.hpp` | Modify | Add `y_offset` field to `BoneAnimationEntry` |
| `src/engine/bone_animation_system.cpp` | Modify | Apply `y_offset` in `gather_bone_animation_transforms()` |
| `include/gseurat/demo/island_demo_state.hpp` | Modify | Remove `character_data_`/`anim_player_`/`anim_sm_`, add `player_registry_id_` |
| `src/demo/island_demo_state.cpp` | Modify | Register player in registry, use entry for animation state, simplify bone gathering |

---

### Task 1: Add y_offset field to BoneAnimationEntry and apply in gather

**Files:**
- Modify: `include/gseurat/engine/bone_animation_registry.hpp`
- Modify: `src/engine/bone_animation_system.cpp`

- [ ] **Step 1: Add y_offset field to BoneAnimationEntry**

In `include/gseurat/engine/bone_animation_registry.hpp`, add after line 25 (`float facing_angle = 0.0f;`):

```cpp
    float y_offset = 0.0f;            // additive visual Y offset (jump arc, bounce)
```

- [ ] **Step 2: Apply y_offset in gather_bone_animation_transforms()**

In `src/engine/bone_animation_system.cpp`, in `gather_bone_animation_transforms()`, change lines 78-79 from:

```cpp
        glm::mat4 to_world =
            glm::translate(glm::mat4(1.0f), entry.current_pos + y_off) *
```

to:

```cpp
        glm::vec3 effective_pos = entry.current_pos;
        effective_pos.y += entry.y_offset;
        glm::mat4 to_world =
            glm::translate(glm::mat4(1.0f), effective_pos + y_off) *
```

- [ ] **Step 3: Build to verify**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add include/gseurat/engine/bone_animation_registry.hpp \
        src/engine/bone_animation_system.cpp
git commit -m "feat(engine): add y_offset to BoneAnimationEntry for jump arcs"
```

---

### Task 2: Register player character in BoneAnimationRegistry

**Files:**
- Modify: `include/gseurat/demo/island_demo_state.hpp`
- Modify: `src/demo/island_demo_state.cpp`

This is the core task. It removes the three player animation members, adds `player_registry_id_`, registers the player in the registry, and rewrites all code that used those members.

- [ ] **Step 1: Update the header**

In `include/gseurat/demo/island_demo_state.hpp`:

Remove lines 70-73 (the player animation members):
```cpp
    // Data-driven bone animation
    std::unique_ptr<gseurat::CharacterData> character_data_;
    std::unique_ptr<gseurat::BoneAnimationPlayer> anim_player_;
    std::unique_ptr<gseurat::BoneAnimationStateMachine> anim_sm_;
```

Replace with:
```cpp
    // Player animation (managed via BoneAnimationRegistry)
    uint32_t player_registry_id_ = 0;
```

- [ ] **Step 2: Update on_enter() — character manifest loading and registry registration**

In `src/demo/island_demo_state.cpp`, the character manifest loading block (lines 270-282) currently loads into `character_data_`. Change it to a local variable and move the registry registration to after the PLY merge.

Replace lines 270-282 (the manifest loading block):

```cpp
    // Load character manifest (heap-allocated via unique_ptr)
    {
        auto loaded = gseurat::load_character_manifest(
            "assets/characters/snes_hero/snes_hero.manifest.json");
        if (loaded) {
            character_data_ = std::make_unique<gseurat::CharacterData>(std::move(*loaded));
            ShutdownAuditor::record<gseurat::CharacterData>(character_data_.get());
            std::fprintf(stderr, "[IslandDemo] Character manifest loaded: %zu bones, %zu clips\n",
                         character_data_->bones.size(), character_data_->clips.size());
        } else {
            std::fprintf(stderr, "[IslandDemo] WARNING: Failed to load character manifest!\n");
        }
    }
```

with:

```cpp
    // Load character manifest into a local — ownership transfers to BoneAnimationRegistry
    std::unique_ptr<gseurat::CharacterData> player_char_data;
    {
        auto loaded = gseurat::load_character_manifest(
            "assets/characters/snes_hero/snes_hero.manifest.json");
        if (loaded) {
            player_char_data = std::make_unique<gseurat::CharacterData>(std::move(*loaded));
            std::fprintf(stderr, "[IslandDemo] Character manifest loaded: %zu bones, %zu clips\n",
                         player_char_data->bones.size(), player_char_data->clips.size());
        } else {
            std::fprintf(stderr, "[IslandDemo] WARNING: Failed to load character manifest!\n");
        }
    }
```

Note: `ShutdownAuditor::record` is removed — the registry's `clear()` leaks CharacterData intentionally (the macOS allocator workaround is already built into the registry).

- [ ] **Step 3: Replace animation state machine setup with registry registration**

Replace lines 458-466 (the animation setup block):

```cpp
        // Initialize data-driven bone animation
        if (character_data_) {
            anim_player_ = std::make_unique<gseurat::BoneAnimationPlayer>(*character_data_);
            anim_sm_ = std::make_unique<gseurat::BoneAnimationStateMachine>(*anim_player_);
            anim_sm_->add_state("idle", "idle");
            anim_sm_->add_state("walk", "walk");
            anim_sm_->add_state("jump", "jump");
            anim_sm_->set_state("idle");
        }
```

with:

```cpp
        // Register player character in BoneAnimationRegistry
        if (player_char_data) {
            gseurat::BoneAnimationEntry player_entry;
            player_entry.manifest_path = "assets/characters/snes_hero/snes_hero.manifest.json";
            player_entry.default_clip = "idle";
            player_entry.first_bone_index = 1;  // bone 0 = terrain sway
            player_entry.bone_count = static_cast<uint32_t>(player_char_data->bones.size());
            player_entry.char_scale = kCharScale;
            player_entry.gs_scale_multiplier = gs_scale_;
            player_entry.spawn_pos = player_pos;
            player_entry.current_pos = player_pos;

            // Pre-initialize animation (skip lazy init in bone_animation_system)
            player_entry.character_data = std::move(player_char_data);
            player_entry.anim_player = std::make_unique<gseurat::BoneAnimationPlayer>(
                *player_entry.character_data);
            player_entry.anim_sm = std::make_unique<gseurat::BoneAnimationStateMachine>(
                *player_entry.anim_player);
            for (const auto& clip : player_entry.character_data->clips) {
                player_entry.anim_sm->add_state(clip.name, clip.name);
            }
            player_entry.anim_sm->set_state("idle");
            player_entry.initialized = true;

            player_registry_id_ = app.bone_animation_registry().add(
                player_entity_, std::move(player_entry));

            // Add BoneAnimatedTag to player entity so bone_animation_system updates it
            app.world().add<gseurat::BoneAnimatedTag>(player_entity_,
                {player_registry_id_});
        }
```

Note: `player_pos` is already a local variable available at this scope (defined around line 240).

- [ ] **Step 4: Update jump input to use registry**

In `src/demo/island_demo_state.cpp`, find the jump input handler (lines 577-580):

```cpp
    if (app.input().was_key_pressed(GLFW_KEY_SPACE) && !jumping_) {
        jumping_ = true;
        jump_time_ = 0.0f;
        if (anim_sm_) anim_sm_->set_state("jump");
```

Change to:

```cpp
    if (app.input().was_key_pressed(GLFW_KEY_SPACE) && !jumping_) {
        jumping_ = true;
        jump_time_ = 0.0f;
        auto* pe = app.bone_animation_registry().get(player_registry_id_);
        if (pe) pe->requested_clip = "jump";
```

- [ ] **Step 5: Update jump completion to use registry**

Find lines 1030-1035 (jump completion):

```cpp
        if (jump_time_ >= kJumpDuration) {
            jumping_ = false;
            jump_time_ = 0.0f;
            // Return to idle or walk based on movement
            float spd = glm::length(glm::vec2(player_velocity_.x, player_velocity_.z));
            if (anim_sm_) anim_sm_->set_state(spd > 0.1f ? "walk" : "idle");
```

Change to:

```cpp
        if (jump_time_ >= kJumpDuration) {
            jumping_ = false;
            jump_time_ = 0.0f;
            // Return to idle or walk based on movement
            float spd = glm::length(glm::vec2(player_velocity_.x, player_velocity_.z));
            auto* pe = app.bone_animation_registry().get(player_registry_id_);
            if (pe) pe->requested_clip = spd > 0.1f ? "walk" : "idle";
```

- [ ] **Step 6: Update facing angle sync to use registry**

Find lines 1056-1059 (the facing angle sync that reads from `anim_player_`/`character_data_`):

```cpp
    if (!anim_player_ || anim_player_->current_clip_index() < 0
        || !character_data_->clips[anim_player_->current_clip_index()].root_motion) {
```

Change to:

```cpp
    auto* player_entry = app.bone_animation_registry().get(player_registry_id_);
    bool has_root_motion = false;
    if (player_entry && player_entry->anim_player &&
        player_entry->anim_player->current_clip_index() >= 0) {
        has_root_motion = player_entry->character_data->clips[
            player_entry->anim_player->current_clip_index()].root_motion;
    }
    if (!has_root_motion) {
```

- [ ] **Step 7: Rewrite update_walk_animation() to use registry**

Replace lines 1367-1447 (the entire walk animation function body after the terrain sway) with:

```cpp
void IslandDemoState::update_walk_animation(AppBase& app, float dt) {
    if (!character_spawned_) return;

    // Terrain sway (bone 0 — map Gaussians)
    env_anim_time_ += dt;
    float terrain_sway_y = std::sin(env_anim_time_ * 1.0f) * 0.05f;
    float terrain_sway_x = std::sin(env_anim_time_ * 0.6f) * 0.02f;
    glm::mat4 terrain_bone = glm::translate(glm::mat4(1.0f),
        glm::vec3(terrain_sway_x, terrain_sway_y, 0.0f));

    auto* pe = app.bone_animation_registry().get(player_registry_id_);
    if (pe && pe->anim_player && pe->anim_sm) {
        // Set clip based on movement (unless jumping — jump clip set elsewhere)
        if (!jumping_) {
            float speed = glm::length(glm::vec2(player_velocity_.x, player_velocity_.z));
            pe->requested_clip = speed > 0.1f ? "walk" : "idle";
        }

        // Set per-frame state on registry entry
        pe->current_pos = character_origin_;
        pe->facing_angle = facing_angle_;

        // Jump Y offset (visual only — not in ECS Transform)
        float jump_y = 0.0f;
        if (jumping_) {
            float t = jump_time_ / kJumpDuration;
            jump_y = 4.0f * kJumpHeight * t * (1.0f - t);
        }
        pe->y_offset = jump_y;

        // Root motion — read delta from animation player
        // Note: bone_animation_system already called anim_player->update(dt) and
        // handled clip transitions via requested_clip before this function runs.
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
                // Update entry position after root motion
                pe->current_pos = character_origin_;
                pe->facing_angle = facing_angle_;
            }
        }

        // Gather ALL bone transforms (player + NPCs) from registry
        glm::mat4 bones[32];
        bones[0] = terrain_bone;
        uint32_t highest = gather_bone_animation_transforms(
            app.bone_animation_registry(), bones, 32);

        int total_bones = static_cast<int>(highest);
        if (app.gs_terrain().bone_slot_counter > highest) {
            total_bones = static_cast<int>(app.gs_terrain().bone_slot_counter);
        }
        if (total_bones < 2) total_bones = 2;  // at least terrain + 1 player bone
        app.renderer().gs_renderer().upload_bone_transforms(bones, total_bones);
        app.renderer().gs_renderer().set_actor_rotation(character_rotation_);
    } else {
        // Fallback: no animation data, just translate character to current position
        glm::vec3 root_offset = character_origin_ - character_spawn_pos_;
        glm::mat4 root_translate = glm::translate(glm::mat4(1.0f), root_offset);
        glm::vec3 spawn = character_spawn_pos_;
        glm::mat4 root_rotate =
            glm::translate(glm::mat4(1.0f), spawn) *
            glm::mat4_cast(character_rotation_) *
            glm::translate(glm::mat4(1.0f), -spawn);
        glm::mat4 root_xform = root_translate * root_rotate;

        glm::mat4 bones[2];
        bones[0] = glm::translate(glm::mat4(1.0f),
            glm::vec3(terrain_sway_x, terrain_sway_y, 0.0f));
        bones[1] = root_xform;
        app.renderer().gs_renderer().upload_bone_transforms(bones, 2);
        app.renderer().gs_renderer().set_actor_rotation(character_rotation_);
    }
}
```

- [ ] **Step 8: Update on_exit() — remove player animation cleanup**

In `on_exit()` (lines 507-519), remove:

```cpp
    // Release animation objects before state destruction
    set_npc_bone_registry(nullptr);
    anim_sm_.reset();
    anim_player_.reset();

    // Attempt guarded free of CharacterData.
    // macOS allocator hangs when freeing CharacterData with populated vectors
    // during Vulkan/VMA teardown (ASan clean — not heap corruption).
    // Intentionally leak on exit: process teardown reclaims the memory anyway.
    if (character_data_) {
        ShutdownAuditor::remove(character_data_.get());
        (void)character_data_.release();  // leak — delete hangs on macOS
        std::fprintf(stderr, "[IslandDemo] CharacterData leaked (macOS allocator hang workaround)\n");
    }
```

Replace with:

```cpp
    set_npc_bone_registry(nullptr);
    player_registry_id_ = 0;
    // Note: CharacterData leak is handled by BoneAnimationRegistry::clear()
    // which is called by AppBase::clear_scene()
```

- [ ] **Step 9: Update portal transition — re-create player registry entry**

In the portal transition code, find where the player animation state machine is re-created after portal return. Search for `anim_player_` or `anim_sm_` in the portal transition section.

If the portal transition code re-creates `anim_player_`/`anim_sm_` (it may have been set up identically to `on_enter`), replace it with the same registry registration pattern from Step 3. The player character manifest needs to be reloaded (since the registry was cleared), and a new entry registered.

After `populate_bone_animation_registry(app.bone_animation_registry(), app.world(), app.gs_terrain());` in the portal return path, add:

```cpp
                    // Re-register player in BoneAnimationRegistry
                    {
                        auto loaded = gseurat::load_character_manifest(
                            "assets/characters/snes_hero/snes_hero.manifest.json");
                        if (loaded) {
                            auto pcd = std::make_unique<gseurat::CharacterData>(std::move(*loaded));
                            gseurat::BoneAnimationEntry player_entry;
                            player_entry.manifest_path = "assets/characters/snes_hero/snes_hero.manifest.json";
                            player_entry.default_clip = "idle";
                            player_entry.first_bone_index = 1;
                            player_entry.bone_count = static_cast<uint32_t>(pcd->bones.size());
                            player_entry.char_scale = kCharScale;
                            player_entry.gs_scale_multiplier = gs_scale_;
                            player_entry.spawn_pos = spawn;
                            player_entry.current_pos = spawn;
                            player_entry.character_data = std::move(pcd);
                            player_entry.anim_player = std::make_unique<gseurat::BoneAnimationPlayer>(
                                *player_entry.character_data);
                            player_entry.anim_sm = std::make_unique<gseurat::BoneAnimationStateMachine>(
                                *player_entry.anim_player);
                            for (const auto& clip : player_entry.character_data->clips) {
                                player_entry.anim_sm->add_state(clip.name, clip.name);
                            }
                            player_entry.anim_sm->set_state("idle");
                            player_entry.initialized = true;
                            player_registry_id_ = app.bone_animation_registry().add(
                                player_entity_, std::move(player_entry));
                            app.world().add<gseurat::BoneAnimatedTag>(player_entity_,
                                {player_registry_id_});
                        }
                    }
```

Where `spawn` and `player_entity_` are the local variables already available in the portal return scope.

- [ ] **Step 10: Remove ShutdownAuditor include if no longer needed**

Check if `ShutdownAuditor` is used elsewhere in `island_demo_state.cpp`. The `ShutdownAuditor::report()` call in `on_exit()` stays. Only the `record`/`remove` calls for `character_data_` are removed. The include stays since `report()` is still called.

- [ ] **Step 11: Build to verify**

Run: `cmake --build --preset macos-debug 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 12: Commit**

```bash
git add include/gseurat/demo/island_demo_state.hpp \
        src/demo/island_demo_state.cpp
git commit -m "refactor(demo): player character uses BoneAnimationRegistry for animation"
```

---

### Task 3: Verify and test

**Files:** None (testing only)

- [ ] **Step 1: Build debug**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 2: Build release**

Run: `cmake --build --preset macos-release --target gseurat_demo 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Run tests**

Run: `cd build/macos-debug && ctest --output-on-failure 2>&1 | tail -20`
Expected: All tests pass

- [ ] **Step 4: Verify no old patterns remain**

Run:
```bash
grep -n 'anim_player_\|anim_sm_\|character_data_' include/gseurat/demo/island_demo_state.hpp src/demo/island_demo_state.cpp
```
Expected: No matches (all replaced with registry access)

- [ ] **Step 5: Commit if any fixes needed**

```bash
git add -A
git commit -m "fix: final adjustments for unified player bone animation"
```
