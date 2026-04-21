# Staging GPU Buffer Clear Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the bug where old Gaussian data persists in GPU buffers when Staging switches scenes in streaming mode.

**Architecture:** Add chunk cleanup (slab checkin + `active_chunks_.clear()`) at the top of `GsRenderer::load_cloud()` before allocating new slabs. The GPU idle wait already precedes this point.

**Tech Stack:** C++23, Vulkan (VMA)

---

### Task 1: Add chunk cleanup to `load_cloud()`

**Files:**
- Modify: `src/engine/gs_renderer.cpp:815-830`

- [ ] **Step 1: Read current `load_cloud()` to confirm exact insertion point**

Read `src/engine/gs_renderer.cpp` lines 815-835. The cleanup goes after `vkDeviceWaitIdle(device_)` (line 826) and before `sort_done_once_ = false` (line 828).

- [ ] **Step 2: Add chunk cleanup block**

In `src/engine/gs_renderer.cpp`, after line 826 (`vkDeviceWaitIdle(device_);` inside the `if (initialized_)` block) and before `sort_done_once_ = false;` (line 828), insert:

```cpp
    // Release old scene data — return slabs to allocator, reset tracking state.
    // Without this, loading a second scene appends to active_chunks_ and old
    // Gaussian data persists in GPU buffers (visual corruption + VRAM leak).
    for (auto& chunk : active_chunks_) {
        slab_allocator_->release(chunk.handle);
    }
    active_chunks_.clear();
    static_count_ = 0;
    total_active_splats_ = 0;
```

This uses `slab_allocator_->release()` — the same method used by `unload_cloud()` at line 925.

- [ ] **Step 3: Build and verify compilation**

Run: `cmake --build --preset macos-debug`
Expected: Build succeeds

- [ ] **Step 4: Run existing tests**

Run: `cmake --build --preset macos-debug --target test_gaussian_cloud && ./build/macos-debug/test_gaussian_cloud`
Expected: All existing tests PASS (this change only affects streaming-mode `load_cloud`, not tested by unit tests)

- [ ] **Step 5: Commit**

```bash
git add src/engine/gs_renderer.cpp
git commit -m "fix(gs-renderer): clear active chunks on scene switch in streaming mode

load_cloud() was appending new chunks without clearing old ones,
causing old Gaussian data to persist in GPU buffers. Now returns
slabs to the allocator and resets tracking state before loading."
```

---

### Task 2: Verify fix via Game Director (if engine is runnable)

**Files:**
- None (manual verification)

- [ ] **Step 1: Build release for visual verification**

Run: `cmake --build --preset macos-release`

- [ ] **Step 2: Launch Staging and test scene switch**

If the engine is runnable locally:

```bash
# Terminal 1: launch staging
./build/macos-release/staging

# Terminal 2: load scene A, then scene B
python3 scripts/game_director.py snapshot save scene_a
python3 scripts/game_director.py load_scene examples/island_demo/assets/scenes/seurat_island.json
python3 scripts/game_director.py snapshot save scene_b
python3 scripts/game_director.py snapshot diff scene_a
```

Verify: snapshot diff shows only scene B elements, no lingering scene A Gaussians.

- [ ] **Step 3: Document verification result**

If manual testing was performed, note the result. If not runnable locally, the fix is verified by code review — the pattern matches `init_streaming()` line 804 and `unload_cloud()` line 925-926.
