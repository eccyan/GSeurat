# Bone Transform Coordinate Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix PC bone animations so body parts stay attached to the character instead of flying over the head due to a world/model coordinate space mismatch.

**Architecture:** Add `gs_scale_` member to `IslandDemoState`, then replace the broken `root_xform * anim_bones[i]` bone transform with `to_world * anim_bones[i] * from_world` which properly converts between world and model coordinate spaces.

**Tech Stack:** C++23, GLM, Vulkan compute (unchanged)

---

### Task 1: Add gs_scale_ member variable

**Files:**
- Modify: `include/gseurat/demo/island_demo_state.hpp:48-51`
- Modify: `src/demo/island_demo_state.cpp:165-167`

- [ ] **Step 1: Add gs_scale_ member to IslandDemoState**

In `include/gseurat/demo/island_demo_state.hpp`, add `gs_scale_` after line 50 (`character_spawn_pos_`):

```cpp
    // Character Gaussians (for walk animation bone transforms)
    bool character_spawned_ = false;
    uint32_t debug_frame_ = 0;
    glm::vec3 character_spawn_pos_{0.0f};  // where Gaussians were placed
    glm::vec3 character_origin_{0.0f};     // current player position
    float gs_scale_ = 1.0f;               // scene scale_multiplier (for bone coord conversion)
    std::vector<Gaussian> map_gaussians_;  // original map data before character merge
```

- [ ] **Step 2: Store gs_scale_ during init**

In `src/demo/island_demo_state.cpp`, after line 167 (`const float gs_scale = ...`), add:

```cpp
        const float gs_scale = scene_data.gaussian_splat
            ? scene_data.gaussian_splat->scale_multiplier : 1.0f;
        gs_scale_ = gs_scale;
```

- [ ] **Step 3: Build to verify compilation**

Run: `cmake --build --preset macos-debug 2>&1 | tail -3`
Expected: `ninja: no work to do.` or successful build with no errors.

- [ ] **Step 4: Commit**

```bash
git add include/gseurat/demo/island_demo_state.hpp src/demo/island_demo_state.cpp
git commit -m "refactor: store gs_scale_ for bone coordinate conversion"
```

---

### Task 2: Fix bone transform coordinate space

**Files:**
- Modify: `src/demo/island_demo_state.cpp:716-767`

- [ ] **Step 1: Replace update_walk_animation with fixed coordinate transforms**

Replace the entire `update_walk_animation` method in `src/demo/island_demo_state.cpp` (lines 716-767) with:

```cpp
void IslandDemoState::update_walk_animation(AppBase& app, float dt) {
    if (!character_spawned_) return;

    // Terrain sway (bone 0 — map Gaussians)
    env_anim_time_ += dt;
    float terrain_sway_y = std::sin(env_anim_time_ * 1.0f) * 0.05f;
    float terrain_sway_x = std::sin(env_anim_time_ * 0.6f) * 0.02f;
    glm::mat4 terrain_bone = glm::translate(glm::mat4(1.0f),
        glm::vec3(terrain_sway_x, terrain_sway_y, 0.0f));

    if (anim_player_ && anim_sm_) {
        float speed = glm::length(glm::vec2(player_velocity_.x, player_velocity_.z));
        anim_sm_->set_state(speed > 0.1f ? "walk" : "idle");
        anim_player_->update(dt);

        // Build world↔model coordinate conversion matrices.
        // During spawning, character Gaussians were placed at:
        //   world = spawn + Ry(pi) * model * S + (0, 2, 0)
        // where S = diag(kCharScale, kCharScale * gs_scale, kCharScale).
        // The animation FK chain computes pivot rotations in model space,
        // so we must convert: world → model → animate → world.
        constexpr float kCharScale = 0.45f;
        const glm::vec3 y_off(0.0f, 2.0f, 0.0f);
        const glm::vec3 scale_vec(kCharScale, kCharScale * gs_scale_, kCharScale);
        const glm::vec3 inv_scale(1.0f / scale_vec.x, 1.0f / scale_vec.y, 1.0f / scale_vec.z);

        // from_world: undo spawn transform (world pos → model pos)
        //   = Ry(-pi) * S^-1 * T(-(spawn + y_off))
        glm::mat4 from_world =
            glm::rotate(glm::mat4(1.0f), -glm::pi<float>(), {0, 1, 0}) *
            glm::scale(glm::mat4(1.0f), inv_scale) *
            glm::translate(glm::mat4(1.0f), -(character_spawn_pos_ + y_off));

        // to_world: apply current transform (model pos → current world pos)
        //   = T(origin + y_off) * Ry(facing) * S * Ry(pi)
        glm::mat4 to_world =
            glm::translate(glm::mat4(1.0f), character_origin_ + y_off) *
            glm::rotate(glm::mat4(1.0f), facing_angle_, {0, 1, 0}) *
            glm::scale(glm::mat4(1.0f), scale_vec) *
            glm::rotate(glm::mat4(1.0f), glm::pi<float>(), {0, 1, 0});

        glm::mat4 bones[32];
        bones[0] = terrain_bone;
        const auto& anim_bones = anim_player_->bone_transforms();
        int bone_count = static_cast<int>(character_data_->bones.size());
        for (int i = 0; i < bone_count && i < 31; ++i) {
            bones[i + 1] = to_world * anim_bones[i] * from_world;
        }

        // NPC bone transforms — translate from spawn to current position
        for (const auto& npc : npc_infos_) {
            if (npc.bone_index >= 32) continue;
            auto* npc_t = app.world().try_get<ecs::Transform>(npc.entity);
            if (!npc_t) continue;
            glm::vec3 npc_offset = npc_t->position - npc.spawn_pos;
            bones[npc.bone_index] = glm::translate(glm::mat4(1.0f), npc_offset);
        }

        int total_bones = static_cast<int>(next_bone_index_);
        if (total_bones < bone_count + 1) total_bones = bone_count + 1;
        app.renderer().gs_renderer().upload_bone_transforms(bones, total_bones);
    } else {
        // Fallback: no animation data, just translate character to current position
        glm::vec3 root_offset = character_origin_ - character_spawn_pos_;
        glm::mat4 root_translate = glm::translate(glm::mat4(1.0f), root_offset);
        glm::vec3 spawn = character_spawn_pos_;
        glm::mat4 root_rotate =
            glm::translate(glm::mat4(1.0f), spawn) *
            glm::rotate(glm::mat4(1.0f), facing_angle_, {0, 1, 0}) *
            glm::translate(glm::mat4(1.0f), -spawn);
        glm::mat4 root_xform = root_translate * root_rotate;

        glm::mat4 bones[2];
        bones[0] = terrain_bone;
        bones[1] = root_xform;
        app.renderer().gs_renderer().upload_bone_transforms(bones, 2);
    }
}
```

- [ ] **Step 2: Build to verify compilation**

Run: `cmake --build --preset macos-debug 2>&1 | tail -3`
Expected: Successful build with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/demo/island_demo_state.cpp
git commit -m "fix: bone transform world/model coordinate space conversion

Bone pivot rotations were applied in model space to Gaussians stored
in world space. World-coordinate Z (~197) bled into Y during X-axis
rotation, causing ±27 unit displacement on a 5-unit-tall character.

Fix wraps animation with from_world/to_world matrices that convert
between world and model coordinate spaces."
```

---

### Task 3: Visual verification with game director

**Files:** None (testing only)

- [ ] **Step 1: Build release and launch demo**

```bash
cmake --build --preset macos-release --target gseurat_demo 2>&1 | tail -3
cd build/macos-release && ./gseurat_demo &
sleep 6 && python3 scripts/game_director.py player
```

Expected: Player position reported, demo running.

- [ ] **Step 2: Capture idle animation**

```bash
python3 scripts/game_director.py screenshot anim_verify/idle.png
```

Expected: Character visible as a coherent figure with no body parts displaced.

- [ ] **Step 3: Walk forward and capture walk animation**

```bash
python3 scripts/game_director.py walk forward 0.5
python3 scripts/game_director.py screenshot anim_verify/walk_forward.png
```

Expected: Character walking with arms/legs swinging naturally near the body.

- [ ] **Step 4: Walk in other directions**

```bash
python3 scripts/game_director.py walk right 0.3
python3 scripts/game_director.py screenshot anim_verify/walk_right.png
python3 scripts/game_director.py walk left 0.5
python3 scripts/game_director.py screenshot anim_verify/walk_left.png
```

Expected: Character facing correct direction, limbs staying attached.

- [ ] **Step 5: Verify idle after walking**

```bash
sleep 1
python3 scripts/game_director.py screenshot anim_verify/idle_after.png
```

Expected: Character returns to idle pose, breathing animation visible as subtle movement.

- [ ] **Step 6: Verify NPC slimes still work**

```bash
python3 scripts/game_director.py goto torch_1
python3 scripts/game_director.py screenshot anim_verify/npc_check.png
```

Expected: NPC slimes visible and positioned correctly near torches.

- [ ] **Step 7: Quit demo**

```bash
python3 scripts/game_director.py quit
```
