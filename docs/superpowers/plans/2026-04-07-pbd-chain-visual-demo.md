# PBD Chain Visual Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the GPU PBD hijack chain demo with a CPU-side PBD simulation rendered as glowing orbs + rope segments via dynamic Gaussians.

**Architecture:** CPU Verlet physics stored in `IslandDemoState`, visual Gaussians appended to `Renderer::gs_pending_dynamics_` during `update()`, merged into the dynamic buffer during `record_gs_compute()`. No GPU PBD pipeline changes.

**Tech Stack:** C++23, GLM, existing `Gaussian` struct and dynamic buffer pipeline.

**Spec:** `docs/superpowers/specs/2026-04-07-pbd-chain-visual-demo-design.md`

---

### File Structure

| File | Responsibility |
|------|----------------|
| `include/gseurat/engine/renderer.hpp` | Add `gs_pending_dynamics_` staging buffer and `append_dynamic_gaussians()` public method |
| `src/engine/renderer.cpp` | Drain `gs_pending_dynamics_` into `gs_dynamic_buffer_` during `record_gs_compute()` |
| `include/gseurat/demo/island_demo_state.hpp` | Add PbdNode/PbdLink structs, simulation state, step/gather method declarations |
| `src/demo/island_demo_state.cpp` | Replace J handler, implement CPU PBD simulation + visual gather |

---

### Task 1: Add pending dynamics staging buffer to Renderer

**Files:**
- Modify: `include/gseurat/engine/renderer.hpp:236`
- Modify: `src/engine/renderer.cpp:963-1012`

- [ ] **Step 1: Add staging buffer and public method to renderer.hpp**

In `include/gseurat/engine/renderer.hpp`, add a public method after the existing `gs_particle_emitters()` accessor (around line 100):

```cpp
void append_dynamic_gaussians(const Gaussian* data, uint32_t count);
```

Add the staging buffer as a private member after `gs_dynamic_buffer_` (after line 236):

```cpp
std::vector<Gaussian> gs_pending_dynamics_;
```

- [ ] **Step 2: Implement append method and drain in record_gs_compute**

In `src/engine/renderer.cpp`, add the append method:

```cpp
void Renderer::append_dynamic_gaussians(const Gaussian* data, uint32_t count) {
    gs_pending_dynamics_.insert(gs_pending_dynamics_.end(), data, data + count);
}
```

In `record_gs_compute`, after the VFX instance loop (after the `std::erase_if(vfx_instances_, ...)` at line 984) and before the dynamic upload block (line 1006), insert:

```cpp
// Append pending dynamics from game states (e.g., PBD chain demo)
if (!gs_pending_dynamics_.empty()) {
    gs_dynamic_buffer_.insert(gs_dynamic_buffer_.end(),
                              gs_pending_dynamics_.begin(),
                              gs_pending_dynamics_.end());
    gs_pending_dynamics_.clear();
}
```

- [ ] **Step 3: Build and verify**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds with no new errors.

- [ ] **Step 4: Commit**

```bash
git add include/gseurat/engine/renderer.hpp src/engine/renderer.cpp
git commit -m "feat(renderer): add pending dynamics staging buffer for game state Gaussians"
```

---

### Task 2: Add CPU PBD structs and members to IslandDemoState

**Files:**
- Modify: `include/gseurat/demo/island_demo_state.hpp`

- [ ] **Step 1: Add PBD structs and member variables**

In `include/gseurat/demo/island_demo_state.hpp`, add the structs inside the `IslandDemoState` class private section, near the existing `pbd_chain_active_` member (around line 92):

Replace:
```cpp
    bool pbd_chain_active_ = false;
```

With:
```cpp
    bool pbd_chain_active_ = false;

    // CPU-side PBD chain simulation (J key demo)
    struct PbdNode {
        glm::vec3 position{0.0f};
        glm::vec3 prev_position{0.0f};
        glm::vec3 velocity{0.0f};
        float inv_mass = 0.0f;
    };
    struct PbdLink {
        uint32_t a = 0, b = 0;
        float rest_length = 3.0f;
        float stiffness = 0.8f;
    };
    static constexpr int kPbdNodeCount = 3;
    static constexpr int kPbdLinkCount = 2;
    static constexpr int kPbdIterations = 4;
    static constexpr float kPbdDamping = 0.98f;
    static constexpr float kPbdGravity = -9.8f;
    std::array<PbdNode, kPbdNodeCount> pbd_nodes_;
    std::array<PbdLink, kPbdLinkCount> pbd_links_;
```

Add `#include <array>` at the top of the file if not already present.

Add private method declarations alongside the existing methods (after `update_environment_animation`):

```cpp
    void step_pbd_chain(float dt);
    void gather_pbd_chain(Renderer& renderer);
```

- [ ] **Step 2: Build and verify**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add include/gseurat/demo/island_demo_state.hpp
git commit -m "feat(island): add CPU PBD chain structs and member declarations"
```

---

### Task 3: Replace J key handler with CPU PBD initialization

**Files:**
- Modify: `src/demo/island_demo_state.cpp:331-364`

- [ ] **Step 1: Replace the J key handler**

Replace the entire J key block (lines 331-364) with:

```cpp
    // J → toggle PBD chain demo (CPU-side, rendered as dynamic Gaussians)
    if (app.input().was_key_pressed(GLFW_KEY_J)) {
        if (pbd_chain_active_) {
            pbd_chain_active_ = false;
            std::fprintf(stderr, "[IslandDemo] PBD chain demo OFF\n");
        } else {
            glm::vec3 top = character_origin_ + glm::vec3(3.0f, 8.0f, 0.0f);
            for (int i = 0; i < kPbdNodeCount; ++i) {
                glm::vec3 p = top - glm::vec3(0.0f, static_cast<float>(i) * 3.0f, 0.0f);
                pbd_nodes_[i].position = p;
                pbd_nodes_[i].prev_position = p;
                pbd_nodes_[i].velocity = glm::vec3(0.0f);
                pbd_nodes_[i].inv_mass = (i == 0) ? 0.0f : 1.0f;
            }
            pbd_links_[0] = {0, 1, 3.0f, 0.8f};
            pbd_links_[1] = {1, 2, 3.0f, 0.8f};
            pbd_chain_active_ = true;
            std::fprintf(stderr, "[IslandDemo] PBD chain demo ON (CPU, 3 nodes, 2 links)\n");
        }
    }
```

- [ ] **Step 2: Remove the PBD types include if no longer needed**

Check if `#include "gseurat/engine/pbd_types.hpp"` is still used elsewhere in `island_demo_state.cpp` (it was only used for `PbdPhysicsState`, `PbdElementParams`, `PbdConstraint` in the old J handler). If no other usage remains, remove the include.

- [ ] **Step 3: Build and verify**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds. Warnings about unused includes are acceptable.

- [ ] **Step 4: Commit**

```bash
git add src/demo/island_demo_state.cpp
git commit -m "feat(island): replace GPU PBD chain toggle with CPU PBD initialization"
```

---

### Task 4: Implement CPU PBD simulation step

**Files:**
- Modify: `src/demo/island_demo_state.cpp`

- [ ] **Step 1: Implement step_pbd_chain**

Add the following method at the end of `island_demo_state.cpp` (before the closing namespace brace, or after `update_environment_animation`):

```cpp
void IslandDemoState::step_pbd_chain(float dt) {
    // Pin node 0 to follow the player
    pbd_nodes_[0].position = character_origin_ + glm::vec3(3.0f, 8.0f, 0.0f);
    pbd_nodes_[0].prev_position = pbd_nodes_[0].position;

    float ground_y = character_origin_.y - 2.0f;

    // Verlet integration for free nodes
    for (int i = 0; i < kPbdNodeCount; ++i) {
        if (pbd_nodes_[i].inv_mass <= 0.0f) continue;

        glm::vec3 pos = pbd_nodes_[i].position;
        glm::vec3 prev = pbd_nodes_[i].prev_position;
        glm::vec3 vel = (pos - prev) * kPbdDamping;
        glm::vec3 accel(0.0f, kPbdGravity, 0.0f);

        pbd_nodes_[i].prev_position = pos;
        pbd_nodes_[i].position = pos + vel + accel * dt * dt;

        // Ground collision
        if (pbd_nodes_[i].position.y < ground_y) {
            pbd_nodes_[i].position.y = ground_y;
            if (pbd_nodes_[i].prev_position.y > ground_y) {
                pbd_nodes_[i].prev_position.y =
                    ground_y + (pbd_nodes_[i].prev_position.y - ground_y) * 0.3f;
            }
        }
    }

    // Constraint projection
    for (int iter = 0; iter < kPbdIterations; ++iter) {
        for (int li = 0; li < kPbdLinkCount; ++li) {
            const auto& link = pbd_links_[li];
            auto& na = pbd_nodes_[link.a];
            auto& nb = pbd_nodes_[link.b];

            glm::vec3 delta = nb.position - na.position;
            float dist = glm::length(delta);
            if (dist < 1e-6f) continue;

            float error = (dist - link.rest_length) / dist;
            glm::vec3 correction = delta * error * link.stiffness / static_cast<float>(kPbdIterations);

            float w_sum = na.inv_mass + nb.inv_mass;
            if (w_sum < 1e-6f) continue;

            if (na.inv_mass > 0.0f)
                na.position += correction * (na.inv_mass / w_sum);
            if (nb.inv_mass > 0.0f)
                nb.position -= correction * (nb.inv_mass / w_sum);
        }
    }

    // Update velocities
    for (int i = 0; i < kPbdNodeCount; ++i) {
        pbd_nodes_[i].velocity =
            (pbd_nodes_[i].position - pbd_nodes_[i].prev_position) / std::max(dt, 1e-6f);
    }
}
```

- [ ] **Step 2: Wire step into update()**

In the `update()` method, after the `update_walk_animation(app, dt);` call (line 424) and before `update_camera(app, dt);` (line 430), add:

```cpp
    // PBD chain physics step
    if (pbd_chain_active_) {
        step_pbd_chain(dt);
    }
```

- [ ] **Step 3: Build and verify**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/demo/island_demo_state.cpp
git commit -m "feat(island): implement CPU Verlet PBD simulation for chain demo"
```

---

### Task 5: Implement visual gather (glowing orbs + rope segments)

**Files:**
- Modify: `src/demo/island_demo_state.cpp`

- [ ] **Step 1: Add a deterministic hash helper at file scope**

Near the top of `island_demo_state.cpp` (in the anonymous namespace or as a static function):

```cpp
namespace {
// Deterministic offset from index — no frame-to-frame jitter
glm::vec3 det_offset(uint32_t seed, float radius) {
    // Simple hash → 3 floats in [-1, 1]
    auto h = [](uint32_t n) -> float {
        n = (n << 13u) ^ n;
        n = n * (n * n * 15731u + 789221u) + 1376312589u;
        return static_cast<float>(n & 0x7fffffffu) / static_cast<float>(0x7fffffff) * 2.0f - 1.0f;
    };
    return glm::vec3(h(seed), h(seed * 7u + 3u), h(seed * 13u + 17u)) * radius;
}
}  // namespace
```

- [ ] **Step 2: Implement gather_pbd_chain**

Add the method after `step_pbd_chain`:

```cpp
void IslandDemoState::gather_pbd_chain(Renderer& renderer) {
    std::vector<Gaussian> buf;
    buf.reserve(120);

    uint32_t seed = 0;

    // --- Orb nodes ---
    for (int ni = 0; ni < kPbdNodeCount; ++ni) {
        const auto& node = pbd_nodes_[ni];
        float speed = glm::length(node.velocity);
        glm::vec3 center = node.position;

        // Core (5 Gaussians)
        for (int i = 0; i < 5; ++i) {
            Gaussian g{};
            g.position = center + det_offset(seed++, 0.1f);
            g.scale = glm::vec3(0.3f);
            g.rotation = glm::quat(1.0f, 0.0f, 0.0f, 0.0f);
            g.color = glm::vec3(1.0f, 0.85f, 0.3f);
            g.opacity = 0.95f;
            g.emission = 3.0f + speed * 0.3f;
            buf.push_back(g);
        }

        // Mid layer (8 Gaussians)
        for (int i = 0; i < 8; ++i) {
            Gaussian g{};
            g.position = center + det_offset(seed++, 0.3f);
            g.scale = glm::vec3(0.5f);
            g.rotation = glm::quat(1.0f, 0.0f, 0.0f, 0.0f);
            g.color = glm::vec3(1.0f, 0.6f, 0.15f);
            g.opacity = 0.7f;
            g.emission = 1.0f;
            buf.push_back(g);
        }

        // Halo (12 Gaussians)
        for (int i = 0; i < 12; ++i) {
            Gaussian g{};
            g.position = center + det_offset(seed++, 0.6f);
            g.scale = glm::vec3(0.9f);
            g.rotation = glm::quat(1.0f, 0.0f, 0.0f, 0.0f);
            g.color = glm::vec3(1.0f, 0.9f, 0.7f);
            g.opacity = 0.25f;
            g.emission = 0.3f;
            buf.push_back(g);
        }
    }

    // --- Rope segments ---
    for (int li = 0; li < kPbdLinkCount; ++li) {
        const auto& link = pbd_links_[li];
        glm::vec3 pa = pbd_nodes_[link.a].position;
        glm::vec3 pb = pbd_nodes_[link.b].position;

        constexpr int kRopeCount = 15;
        for (int i = 0; i < kRopeCount; ++i) {
            float t = static_cast<float>(i + 1) / static_cast<float>(kRopeCount + 1);
            Gaussian g{};
            g.position = glm::mix(pa, pb, t);
            g.scale = glm::vec3(0.15f);
            g.rotation = glm::quat(1.0f, 0.0f, 0.0f, 0.0f);
            g.color = glm::vec3(1.0f, 0.7f, 0.2f);
            g.opacity = 0.6f * (1.0f - 2.0f * std::abs(t - 0.5f));
            g.emission = 0.5f;
            buf.push_back(g);
        }
    }

    renderer.append_dynamic_gaussians(buf.data(), static_cast<uint32_t>(buf.size()));
}
```

- [ ] **Step 3: Wire gather into update()**

In the `update()` method, right after the `step_pbd_chain(dt)` call added in Task 4, add the gather call inside the same `if` block:

```cpp
    // PBD chain physics step + visual gather
    if (pbd_chain_active_) {
        step_pbd_chain(dt);
        gather_pbd_chain(app.renderer());
    }
```

- [ ] **Step 4: Build and verify**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/demo/island_demo_state.cpp
git commit -m "feat(island): render PBD chain as glowing orbs + rope segments"
```

---

### Task 6: Clean up old PBD includes and verify end-to-end

**Files:**
- Modify: `src/demo/island_demo_state.cpp` (if needed)

- [ ] **Step 1: Check for remaining GPU PBD references in island_demo_state.cpp**

Search for any remaining references to `upload_pbd_elements`, `upload_pbd_constraints`, `clear_pbd`, `PbdPhysicsState`, `PbdElementParams`, `PbdConstraint` in `src/demo/island_demo_state.cpp`. The terrain PBD re-upload at line ~250-272 (inside `on_enter`) should remain — it uses the GPU PBD for tree sway and is unrelated to the chain demo.

If the only remaining uses of `pbd_types.hpp` are in the terrain re-upload block, keep the include. If the include is no longer used at all, remove it.

- [ ] **Step 2: Full rebuild**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds with no new warnings.

- [ ] **Step 3: Verify visually**

Run the demo and press J:
- Expect: 3 glowing gold orbs appear above and to the right of the player
- The top orb stays pinned, the lower two swing as a pendulum
- Amber rope dots connect the orbs
- Trees continue swaying normally (terrain PBD unaffected)
- Press J again: orbs and ropes disappear immediately
- Press J while walking: the pinned orb follows the player

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(island): clean up PBD chain demo — remove unused GPU PBD references"
```
