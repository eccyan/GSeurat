# Cross-Frame SSBO Race Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the every-other-frame blank swapchain image by per-frame double-buffering the compute SSBOs that feed the (already per-frame) GS output images, then restore Option A by routing PBD + characters into the dynamic tail, and content-fix the dungeon scene so its torches stop overflowing the dynamic headroom.

**Architecture:** Convert single-instance `Buffer X_ssbo_` fields to `std::array<Buffer, kMaxFramesInFlight>`, and the matching compute descriptor sets to per-frame arrays. The dispatch path (already receiving `frame_in_flight`) binds the per-frame set / buffer per frame. Static-tail buffers stay single-instance (they only mutate on `static_dirty_=true`, which is GPU-fenced). Per-frame intermediate images and their render/post-process descriptor sets are already per-frame and need no allocation change — only re-binding to the per-frame compute buffers.

**Tech Stack:** C++23, Vulkan 1.4 (MoltenVK on M5), CMake (`macos-release`, `macos-release-with-diag`, `macos-debug` presets), Game Director (Python over Unix socket).

**Spec:** `docs/superpowers/specs/2026-05-11-cross-frame-ssbo-race-fix-design.md` (commit `6b62fe90`).

**Branch:** `fix/cross-frame-ssbo-race` (already created off `origin/main`, spec already committed).

---

## File Structure

Almost all engine changes live in two files. Demo and content changes are isolated to Phases 4–5.

| File | Phases | Role |
|---|---|---|
| `include/gseurat/engine/gs_renderer.hpp` | 1, 2 | Buffer + descriptor set member declarations |
| `src/engine/gs_renderer.cpp` | 1, 2, 3 | Buffer create/destroy, `update_descriptors`, dispatch routing |
| `src/demo/island_demo_state.cpp` | 4 | `on_enter` + `perform_portal_transition` cloud partitioning |
| `assets/scenes/dungeon.json` (or equivalent) | 5 | Torch VFX content reduction |

Shader files (`shaders/gs_*.comp`) are **untouched** — binding indices stay the same; only the descriptor-set→buffer wiring changes.

---

## Racing SSBO Inventory (Phase 1 scope)

These single-instance buffers all become `std::array<Buffer, kMaxFramesInFlight>`:

| Buffer | Header line | Factory | Notes |
|---|---|---|---|
| `projected_ssbo_` | hpp:445 | `create_storage` | Frustum-cull output |
| `sort_keys_ssbo_` | hpp:446 | `create_storage` | Legacy depth-sort key A |
| `sort_b_ssbo_` | hpp:447 | `create_storage` | Legacy depth-sort key B |
| `visible_count_ssbo_` | hpp:450 | `create_storage_readback` | Atomic counter |
| `dynamic_sort_a_` | hpp:468 | `create_storage_host_dst` | Dynamic-tail sort A |
| `dynamic_sort_b_` | hpp:469 | `create_storage_host_dst` | Dynamic-tail sort B |
| `counts_ssbo_` | hpp:471 | `create_storage_readback` | {static, dyn, merged} counts |
| `merged_sort_ssbo_` | hpp:445-area | `create_storage` | Per-frame merge output |

Compute descriptor sets that become per-frame (hpp:573–613):
- `preprocess_set_` → `preprocess_sets_[f]`
- `sort_set_` → `sort_sets_[f]`
- `static_preprocess_set_` → `static_preprocess_sets_[f]`
- `dynamic_preprocess_set_` → `dynamic_preprocess_sets_[f]`
- Depth-onesweep histogram + scatter sets

`render_sets_[f]` and `post_process_sets_[f]` already exist as per-frame arrays. Their bindings get rewritten to point at the per-frame buffer slot in Phase 2.

---

## Phase 1 — Per-frame storage for racing SSBOs

**Goal:** All listed buffers become per-frame arrays. All accesses temporarily use slot `[0]` so behavior is unchanged. Build succeeds; demo runs identically (still flickers — that's expected, the race fix lands in Phase 3).

### Task 1.1 — Convert buffer declarations to per-frame arrays

**Files:**
- Modify: `include/gseurat/engine/gs_renderer.hpp:443-471`

- [ ] **Step 1: Update member declarations**

In `include/gseurat/engine/gs_renderer.hpp`, replace each single-instance racing buffer with an array:

```cpp
// Before
Buffer projected_ssbo_;
Buffer sort_keys_ssbo_;
Buffer sort_b_ssbo_;
Buffer visible_count_ssbo_;
Buffer dynamic_sort_a_;
Buffer dynamic_sort_b_;
Buffer counts_ssbo_;
Buffer merged_sort_ssbo_;

// After
std::array<Buffer, kMaxFramesInFlight> projected_ssbos_{};
std::array<Buffer, kMaxFramesInFlight> sort_keys_ssbos_{};
std::array<Buffer, kMaxFramesInFlight> sort_b_ssbos_{};
std::array<Buffer, kMaxFramesInFlight> visible_count_ssbos_{};
std::array<Buffer, kMaxFramesInFlight> dynamic_sort_as_{};
std::array<Buffer, kMaxFramesInFlight> dynamic_sort_bs_{};
std::array<Buffer, kMaxFramesInFlight> counts_ssbos_{};
std::array<Buffer, kMaxFramesInFlight> merged_sort_ssbos_{};
```

Leave `static_gaussian_ssbo_`, `dynamic_gaussian_ssbo_`, `gaussian_ssbo_`, `static_sort_a_`, `static_sort_b_`, `uniform_buffer_`, `bone_ssbo_`, `pbd_*` unchanged.

- [ ] **Step 2: Audit hpp accessors**

`grep -n "visible_count_ssbo_\|counts_ssbo_" include/gseurat/engine/gs_renderer.hpp` returns the host-readback helpers (~hpp:211–216). They read `.mapped()` from the buffer. Update to read slot `[0]` for now — the host-readback path will be revisited if it shows up as a hot path:

```cpp
// Around hpp:211-216
if (counts_ssbos_[0].mapped()) {
    auto* c = static_cast<const uint32_t*>(counts_ssbos_[0].mapped());
    ...
}
if (visible_count_ssbos_[0].mapped())
    return *static_cast<const uint32_t*>(visible_count_ssbos_[0].mapped());
```

- [ ] **Step 3: Build**

```bash
cmake --build build/macos-release-with-diag --target gseurat_demo 2>&1 | tail -20
```

Expected: many compile errors in `gs_renderer.cpp` referencing the old names. That's the next task.

### Task 1.2 — Update buffer create/destroy in `gs_renderer.cpp`

**Files:**
- Modify: `src/engine/gs_renderer.cpp:1141-1158` (destroy)
- Modify: `src/engine/gs_renderer.cpp:1180-1244` (create + sentinel-fill)

- [ ] **Step 1: Wrap creates in a per-frame loop**

Around `src/engine/gs_renderer.cpp:1180` (and 1191-1196, 1243-1244), replace each create call with a loop:

```cpp
for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
    projected_ssbos_[f]     = Buffer::create_storage(allocator_, projected_buf_size);
    sort_keys_ssbos_[f]     = Buffer::create_storage(allocator_, static_sort_buf_size);
    sort_b_ssbos_[f]        = Buffer::create_storage(allocator_, static_sort_buf_size);
    visible_count_ssbos_[f] = Buffer::create_storage_readback(allocator_, sizeof(uint32_t));
    dynamic_sort_as_[f]     = Buffer::create_storage_host_dst(allocator_, dynamic_sort_buf_size);
    dynamic_sort_bs_[f]     = Buffer::create_storage_host_dst(allocator_, dynamic_sort_buf_size);
    counts_ssbos_[f]        = Buffer::create_storage_readback(allocator_, 3 * sizeof(uint32_t));
    merged_sort_ssbos_[f]   = Buffer::create_storage(allocator_, merged_sort_buf_size);
}
```

Preserve the comments at 1181-1192 (TRANSFER_DST_BIT rationale) — move them just above the loop.

- [ ] **Step 2: Per-frame sentinel-fill**

Around `src/engine/gs_renderer.cpp:1207-1237`, wrap the `memset` and `sentinel_fill_sort` calls in the same per-frame loop. `static_gaussian_ssbo_` and `dynamic_gaussian_ssbo_` are NOT per-frame, so their memsets stay outside the loop:

```cpp
// Outside loop (unchanged)
std::memset(static_gaussian_ssbo_.mapped(), 0, ...);
std::memset(dynamic_gaussian_ssbo_.mapped(), 0, ...);

// Inside loop, per slot
for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
    std::memset(projected_ssbos_[f].mapped(), 0,
                static_cast<size_t>(max_static_count_ + max_dynamic_count_) * sizeof(ProjectedSplat));
    sentinel_fill_sort(dynamic_sort_as_[f], dynamic_sort_size_);
    sentinel_fill_sort(dynamic_sort_bs_[f], dynamic_sort_size_);
    std::memset(merged_sort_ssbos_[f].mapped(), 0, ...);
}
```

Static sort buffers stay outside the loop.

- [ ] **Step 3: Per-frame destroy**

Around `src/engine/gs_renderer.cpp:1141-1158`, wrap the racing-buffer destroys in a per-frame loop. Static / gaussian / uniform destroys stay outside.

```cpp
for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
    projected_ssbos_[f].destroy(allocator_);
    sort_keys_ssbos_[f].destroy(allocator_);
    sort_b_ssbos_[f].destroy(allocator_);
    visible_count_ssbos_[f].destroy(allocator_);
    dynamic_sort_as_[f].destroy(allocator_);
    dynamic_sort_bs_[f].destroy(allocator_);
    counts_ssbos_[f].destroy(allocator_);
    merged_sort_ssbos_[f].destroy(allocator_);
}
```

- [ ] **Step 4: Build**

```bash
cmake --build build/macos-release-with-diag --target gseurat_demo 2>&1 | tail -30
```

Expected: errors only at `update_descriptors`, dispatch sites, and other consumers that still reference the old single-instance names.

### Task 1.3 — Convert remaining consumers in `gs_renderer.cpp` to slot `[0]`

**Files:**
- Modify: `src/engine/gs_renderer.cpp` — every remaining touch site

- [ ] **Step 1: Locate touch sites**

```bash
grep -nE "projected_ssbo_\b|sort_keys_ssbo_\b|sort_b_ssbo_\b|visible_count_ssbo_\b|dynamic_sort_a_\b|dynamic_sort_b_\b|counts_ssbo_\b|merged_sort_ssbo_\b" src/engine/gs_renderer.cpp
```

This is the complete list of remaining single-instance reads/writes.

- [ ] **Step 2: Replace each `X_ssbo_` access with `X_ssbos_[0]`**

For every site — descriptor writes (`update_descriptors`, ~cpp:2310–2545), dispatch buffer-handle reads (cpp:2471, 2613–2642), the post-portal projected-tail zeroing (cpp:1594, 1820), the per-frame `vkCmdFillBuffer` for `dynamic_sort_a/b_` and `counts_ssbo_` inside `render()` (cpp:3484, 3487, 3512–3513).

Use slot `[0]` everywhere. **Do not** index by `frame_in_flight` yet — Phase 3 does that.

Pattern:
```cpp
// Before
projected_ssbo_.buffer()
// After
projected_ssbos_[0].buffer()

// Before
vkCmdFillBuffer(cmd, dynamic_sort_a_.buffer(), 0, dyn_sort_bytes, 0xFFFFFFFFu);
// After
vkCmdFillBuffer(cmd, dynamic_sort_as_[0].buffer(), 0, dyn_sort_bytes, 0xFFFFFFFFu);
```

- [ ] **Step 3: Build clean**

```bash
cmake --build build/macos-release-with-diag --target gseurat_demo 2>&1 | tail -10
```

Expected: build succeeds with no errors.

### Task 1.4 — Verify no behavior change

**Acceptance criterion:** Demo runs and looks visually identical to current `main` (still flickers — that's correct, we haven't fixed the race yet).

- [ ] **Step 1: Launch demo (user-side)**

Ask the user to launch:
```bash
cd build/macos-release-with-diag && ./gseurat_demo &
```

- [ ] **Step 2: Confirm demo enters Playing state**

```bash
sleep 6 && python3 scripts/game_director.py player
```

Expected: returns coords like `(187, 197)` — confirms socket alive and demo past loading.

- [ ] **Step 3: Capture 8 screenshots**

```bash
for i in 1 2 3 4 5 6 7 8; do
  python3 scripts/game_director.py screenshot /tmp/phase1_s$i.png
done
```

Expected: blank/rendered alternation still present (we haven't fixed it yet). Confirms behavior unchanged.

- [ ] **Step 4: Quit demo**

```bash
python3 scripts/game_director.py quit
```

### Task 1.5 — Phase 1 commit

- [ ] **Step 1: Stage + commit**

```bash
git add include/gseurat/engine/gs_renderer.hpp src/engine/gs_renderer.cpp
git commit -m "$(cat <<'EOF'
refactor(engine): convert racing GS SSBOs to per-frame arrays (storage only)

Phase 1 of cross-frame SSBO race fix. Converts projected, sort_keys,
sort_b, visible_count, dynamic_sort_a/b, counts, and merged_sort
buffers from single-instance to std::array<Buffer, kMaxFramesInFlight>.
All consumers still access slot [0] — no behavior change, no race fix
yet. Phase 2 introduces per-frame descriptor sets; Phase 3 wires
frame_in_flight into the dispatch path to actually use the per-frame
slots.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — Per-frame compute descriptor sets

**Goal:** Compute descriptor sets are arrays of `kMaxFramesInFlight`, with set `[f]` bound to the corresponding `*_ssbos_[f]`. Dispatch still uses set `[0]` — no race fix yet, but the per-frame plumbing is in place.

### Task 2.1 — Descriptor set field arrays

**Files:**
- Modify: `include/gseurat/engine/gs_renderer.hpp:573-613`

- [ ] **Step 1: Convert descriptor handles to arrays**

```cpp
// Before
VkDescriptorSet preprocess_set_ = VK_NULL_HANDLE;
VkDescriptorSet sort_set_ = VK_NULL_HANDLE;
VkDescriptorSet static_preprocess_set_ = VK_NULL_HANDLE;
VkDescriptorSet dynamic_preprocess_set_ = VK_NULL_HANDLE;

// After
std::array<VkDescriptorSet, kMaxFramesInFlight> preprocess_sets_{};
std::array<VkDescriptorSet, kMaxFramesInFlight> sort_sets_{};
std::array<VkDescriptorSet, kMaxFramesInFlight> static_preprocess_sets_{};
std::array<VkDescriptorSet, kMaxFramesInFlight> dynamic_preprocess_sets_{};
```

Onesweep histogram/scatter set fields — check `gs_renderer.hpp` for declarations (search for `histogram` / `scatter` / `onesweep`). If they're single-instance, array them too. If they're already per-something else (e.g., per-pass), document and skip — Phase 1 validation will surface any miss via SYNC-HAZARD.

### Task 2.2 — Pool allocation in `gs_renderer.cpp`

**Files:**
- Modify: `src/engine/gs_renderer.cpp:475-490` (descriptor set allocation)
- Modify: `src/engine/gs_renderer.cpp` — `create_descriptor_pool` site

- [ ] **Step 1: Allocate `kMaxFramesInFlight` of each compute set**

At cpp:475-490 the current code allocates one set per slot (`sets[0]` = preprocess, `sets[1]` = sort, etc.). Extend the allocation to allocate `kMaxFramesInFlight` of each:

```cpp
VkDescriptorSetLayout layouts[] = {
    /* preprocess */         preprocess_layout_, preprocess_layout_,
    /* sort */               sort_layout_, sort_layout_,
    /* render */             render_layout_, render_layout_,     // already per-frame
    /* post_process */       post_process_layout_, post_process_layout_,  // already per-frame
    /* static_preprocess */  static_preprocess_layout_, static_preprocess_layout_,
    /* dynamic_preprocess */ dynamic_preprocess_layout_, dynamic_preprocess_layout_,
    /* tile_render */        tile_render_layout_, tile_render_layout_,  // already per-frame
    // ... onesweep sets, doubled
};
VkDescriptorSet sets[std::size(layouts)] = {};
... vkAllocateDescriptorSets ...

preprocess_sets_[0] = sets[0];
preprocess_sets_[1] = sets[1];
sort_sets_[0]       = sets[2];
sort_sets_[1]       = sets[3];
// ... etc
```

- [ ] **Step 2: Audit `create_descriptor_pool` capacity**

Locate `create_descriptor_pool` (grep `vkCreateDescriptorPool`). The `maxSets` and per-type `descriptorCount` budgets need to absorb the doubled compute-set count. Bump the relevant counts by `kMaxFramesInFlight` factor for the affected pool sizes.

### Task 2.3 — `update_descriptors` writes per-frame sets

**Files:**
- Modify: `src/engine/gs_renderer.cpp:2310-2545`

- [ ] **Step 1: Wrap each per-set descriptor block in a per-frame loop**

For the preprocess block at cpp:2312-2341, wrap in `for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) { ... }` and:
- Use `preprocess_sets_[f]` as `dstSet`
- Bind `projected_ssbos_[f]`, `sort_keys_ssbos_[f]`, `visible_count_ssbos_[f]` as the per-frame buffer infos
- Single-instance buffers (`gaussian_ssbo_`, `bone_ssbo_`, `pbd_state_ssbo_`, `page_table_ssbo_`, `uniform_buffer_`) keep their existing bindings

Repeat the pattern for:
- Sort set block (cpp:2344-2353) → `sort_sets_[f]`, `sort_keys_ssbos_[f]`
- Static preprocess block (cpp:2482-2510) → `static_preprocess_sets_[f]`, per-frame `projected_ssbos_[f]`, `counts_ssbos_[f]`
- Dynamic preprocess block (cpp:2514-2540) → `dynamic_preprocess_sets_[f]`, per-frame `projected_ssbos_[f]`, `dynamic_sort_as_[f]`, `counts_ssbos_[f]`
- Onesweep set writes (cpp:2407 onward) — same per-frame pattern

The render set (cpp:2356-2382) and post_process set (cpp:2384-2404) **already** loop over `f` — just update their buffer bindings to use `projected_ssbos_[f]`, `sort_keys_ssbos_[f]`, `visible_count_ssbos_[f]`.

- [ ] **Step 2: Build clean**

```bash
cmake --build build/macos-release-with-diag --target gseurat_demo 2>&1 | tail -10
```

Expected: build succeeds. Dispatch sites still bind set `[0]` so behavior is unchanged.

### Task 2.4 — Verify Phase 2 still behaves identically to Phase 1

- [ ] **Step 1: Run demo, screenshot, verify flicker still present**

Same procedure as Task 1.4. Expected: same blank/rendered alternation.

This confirms the per-frame descriptor sets compile and run, with set `[0]` actively producing identical output.

### Task 2.5 — Phase 2 commit

```bash
git add include/gseurat/engine/gs_renderer.hpp src/engine/gs_renderer.cpp
git commit -m "$(cat <<'EOF'
refactor(engine): per-frame descriptor sets for GS compute pipeline

Phase 2 of cross-frame SSBO race fix. preprocess_set_, sort_set_,
static_preprocess_set_, dynamic_preprocess_set_, and onesweep sets
become std::array<VkDescriptorSet, kMaxFramesInFlight>. update_descriptors
writes each per-frame set to its corresponding *_ssbos_[f] slot. The
descriptor pool capacity is bumped to absorb the doubled compute-set
count. Dispatch sites still bind set [0]; Phase 3 routes frame_in_flight
to actually use the per-frame slot.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 — Wire `frame_in_flight` through dispatch

**Goal:** Each compute dispatch binds set `[frame_in_flight]`. The race is fixed: zero blank frames in screenshot regression. No SYNC-HAZARD warnings in validation layer.

### Task 3.1 — Route `frame_in_flight` into dispatch helpers

**Files:**
- Modify: `src/engine/gs_renderer.cpp` — `dispatch_gpu_compute`, `dispatch_depth_onesweep`, `dispatch_tile_render`, and any other dispatch helpers in `render()`

- [ ] **Step 1: Audit dispatch sites for `vkCmdBindDescriptorSets` calls binding the racing sets**

```bash
grep -n "vkCmdBindDescriptorSets\|preprocess_set\|sort_set\|static_preprocess_set\|dynamic_preprocess_set" src/engine/gs_renderer.cpp
```

For each binding of one of the racing sets, locate the enclosing function and confirm it has access to `frame_in_flight`. `render()` (cpp:3260) already receives `frame_in_flight`; internal helpers usually take `cmd` and read state — they may need a new `uint32_t frame_in_flight` parameter threaded in.

- [ ] **Step 2: Replace `[0]` with `[frame_in_flight]` at every binding**

```cpp
// Before (after Phase 2)
vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                        preprocess_pipeline_layout_, 0, 1,
                        &preprocess_sets_[0], 0, nullptr);
// After
vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                        preprocess_pipeline_layout_, 0, 1,
                        &preprocess_sets_[frame_in_flight], 0, nullptr);
```

Same pattern for `sort_sets_`, `static_preprocess_sets_`, `dynamic_preprocess_sets_`, onesweep sets.

- [ ] **Step 3: Also route per-frame buffer-handle reads**

A few sites read buffer handles directly (e.g., cpp:2471, 2613, 3484, 3487, 3512-3513 — `vkCmdFillBuffer` against the dynamic sort buffers, `vkCmdCopyBuffer` against merged_sort, etc.). Replace `[0]` with `[frame_in_flight]` at each. The render path already has `frame_in_flight` in scope.

- [ ] **Step 4: Build clean**

```bash
cmake --build build/macos-release-with-diag --target gseurat_demo 2>&1 | tail -10
```

### Task 3.2 — Run validation layers (macos-debug build)

**Goal:** Vulkan validation reports zero SYNC-HAZARD warnings.

- [ ] **Step 1: Build with validation**

```bash
cmake --build build/macos-debug --target gseurat_demo 2>&1 | tail -10
```

- [ ] **Step 2: Launch the debug demo and watch for SYNC-HAZARD**

```bash
cd build/macos-debug && ./gseurat_demo 2>&1 | grep -iE "(sync-hazard|SYNC_HAZARD|validation)"
```

Run for ~30 seconds, then quit. Expected: zero `SYNC-HAZARD-WRITE-AFTER-READ` / `READ-AFTER-WRITE` warnings.

If any appear, identify the buffer they cite and add it to Phase 1's array conversion. Re-run from Task 1.1 with that buffer included.

### Task 3.3 — Visual regression (screenshot test)

- [ ] **Step 1: Launch with-diag demo**

```bash
cd build/macos-release-with-diag && ./gseurat_demo &
sleep 6
python3 scripts/game_director.py player
```

- [ ] **Step 2: Take 30 screenshots**

```bash
for i in $(seq 1 30); do
  python3 scripts/game_director.py screenshot /tmp/phase3_s$i.png
done
```

- [ ] **Step 3: Eyeball-scan for blank frames**

Open `/tmp/phase3_s*.png` in Finder Quick Look (Space to preview, arrow keys to walk through). Acceptance: zero frames where the scene is a uniform dark gradient instead of rendered geometry.

- [ ] **Step 4: Quit demo**

```bash
python3 scripts/game_director.py quit
```

### Task 3.4 — Watchdog timing check

- [ ] **Step 1: Capture 60 seconds of stderr**

```bash
cd build/macos-release-with-diag && timeout 60 ./gseurat_demo 2> /tmp/phase3_wd.log
```

- [ ] **Step 2: Count WAIT_SLOW occurrences**

```bash
grep -c "WAIT_SLOW" /tmp/phase3_wd.log
```

Expected: dropped from ~1/30 frames to near-zero, since the GPU is no longer trailing behind the CPU on racing buffers.

### Task 3.5 — Phase 3 commit

```bash
git add src/engine/gs_renderer.cpp include/gseurat/engine/gs_renderer.hpp
git commit -m "$(cat <<'EOF'
fix(engine): route frame_in_flight to GS compute dispatch (cross-frame race fix)

Phase 3 of cross-frame SSBO race fix and the actual flicker fix.
Compute dispatches now bind preprocess_sets_[frame_in_flight] /
sort_sets_[frame_in_flight] / static_preprocess_sets_[f] /
dynamic_preprocess_sets_[f] / onesweep_sets_[f], routing each
in-flight frame to its own per-frame compute SSBOs. Frame N+1's
preprocess no longer clobbers projected/sort_keys/visible_count
that frame N's tile-render is still reading on the GPU.

Validation: 30 consecutive Game Director screenshots show zero
blank frames; macos-debug validation layer reports zero SYNC-HAZARD
warnings; watchdog WAIT_SLOW occurrences dropped to near-zero.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 — Restore Option A (PBD + characters into dynamic tail)

**Goal:** PBD-tagged splats and character/NPC bone-animated splats live in the dynamic tail. Static cloud retains only terrain + props. The "PBD lives in static, don't dirty per-frame" trade-off is removed since PBD now lives in the cheaply re-sortable per-frame dynamic.

### Task 4.1 — Locate current partition logic

**Files:**
- Modify: `src/demo/island_demo_state.cpp:346–410` (on_enter §A partition) and `src/demo/island_demo_state.cpp:2200–2280` (perform_portal_transition partition)

- [ ] **Step 1: Read current partition**

```bash
grep -n "bone_index\|persistent_dynamics\|set_persistent_dynamics" src/demo/island_demo_state.cpp
```

Currently the partition is "bone_index > 0 → dynamic" with PBD-tagged splats (bone_index ∈ [32,63]) staying in the static cloud per the comment at gs_renderer.cpp:3411–3429. Phase 4 changes the partition to also route PBD-tagged into dynamic.

### Task 4.2 — Update partition predicate to include PBD-tagged

- [ ] **Step 1: Modify `on_enter` partition**

In `src/demo/island_demo_state.cpp`'s on_enter §A partition (post-§A merge), change the predicate routing splats into `persistent_dynamics_pending` from "bone_index ∈ [1,31]" to "bone_index ∈ [1,63]" (i.e., any non-zero bone_index goes dynamic):

```cpp
// Before (pseudocode of current pattern)
for (const Gaussian& g : merged) {
    if (g.bone_index == 0) static_cloud.push_back(g);
    else if (g.bone_index >= 1 && g.bone_index <= 31)
        persistent_dynamics_pending.push_back(g);  // bone-animated → dynamic
    // PBD-tagged [32,63] currently falls through to static
}

// After
for (const Gaussian& g : merged) {
    if (g.bone_index == 0) static_cloud.push_back(g);
    else persistent_dynamics_pending.push_back(g);  // any non-zero → dynamic
}
```

- [ ] **Step 2: Mirror the change in `perform_portal_transition`**

Apply the same predicate update at the post-§B re-merge partition (covers both the re-merge and `skip_phase_b_remerge=true` paths).

### Task 4.3 — Remove the now-obsolete static-PBD trade-off comment

**Files:**
- Modify: `src/engine/gs_renderer.cpp:3411–3429`

- [ ] **Step 1: Delete the comment block**

The comment block at cpp:3411–3429 documents the old "PBD lives in static, don't dirty per-frame" trade-off. With PBD in the dynamic tail, the trade-off no longer applies — delete the block (and the `static_dirty_=true` discussion). Leave the PBD compute dispatch itself in place; just the explanatory comment goes.

### Task 4.4 — Verify PBD + characters render correctly post-Option-A

- [ ] **Step 1: Launch demo**

```bash
cd build/macos-release-with-diag && ./gseurat_demo &
sleep 6
python3 scripts/game_director.py player
```

- [ ] **Step 2: Confirm PBD wind sway is visible while camera is stationary**

```bash
python3 scripts/game_director.py screenshot /tmp/phase4_idle1.png
sleep 1
python3 scripts/game_director.py screenshot /tmp/phase4_idle2.png
```

Expected: the two screenshots show slightly different tree poses (wind sway is animating frame-to-frame). With the old static-PBD trade-off, idle screenshots were pose-identical until the camera moved.

- [ ] **Step 3: Walk to dungeon portal and back**

```bash
python3 scripts/game_director.py walk forward 3
python3 scripts/game_director.py screenshot /tmp/phase4_postwalk.png
```

Expected: character renders correctly through the walk. No flicker. No dynamic-tail overflow warning in stderr (`grep "dynamic.*overflow\|exceeded.*headroom" /tmp/<your-demo-log>`).

- [ ] **Step 4: Quit demo**

```bash
python3 scripts/game_director.py quit
```

### Task 4.5 — Phase 4 commit

```bash
git add src/demo/island_demo_state.cpp src/engine/gs_renderer.cpp
git commit -m "$(cat <<'EOF'
refactor(demo): Option A — PBD + characters into dynamic tail

With the cross-frame SSBO race fixed (Phases 1-3), restore Option A:
all non-zero-bone_index splats route into the persistent-dynamic
prefix. Static cloud now contains only terrain + props (bone_index == 0).
PBD wind sway is visible while camera is stationary (no longer gated
on static_dirty_=true).

Removes the obsolete trade-off comment block at gs_renderer.cpp:3411-3429
describing why PBD-tagged splats had to stay in static.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5 — Dungeon torch content fix

**Goal:** Dungeon scene's total dynamic count fits under `kDynamicHeadroom` (1 MiB) with comfortable room for PC + NPCs + PBD trees.

### Task 5.1 — Identify the dungeon scene file + torch config

- [ ] **Step 1: Find the dungeon scene**

```bash
find assets/scenes -name '*dungeon*' 2>&1
grep -rn "dungeon\|torch_dungeon" assets/scenes/ examples/island_demo/ 2>&1 | head -20
```

- [ ] **Step 2: Find torch VFX entries**

```bash
grep -nE "torch_small|torch.*vfx|vfx_preset.*torch" <dungeon scene path>
```

### Task 5.2 — Measure current dungeon dynamic count

- [ ] **Step 1: Launch demo, walk into dungeon, capture stderr**

```bash
cd build/macos-release-with-diag && ./gseurat_demo 2> /tmp/dungeon_log.txt &
sleep 6
python3 scripts/game_director.py goto <dungeon POI from game-director POI list>
sleep 2
python3 scripts/game_director.py quit
```

- [ ] **Step 2: Inspect dynamic count**

```bash
grep -E "dyn=|dynamic_count_|dynamic.*overflow" /tmp/dungeon_log.txt | tail -20
```

Note the steady-state `dyn=...` value and any overflow / cap-hit lines.

### Task 5.3 — Reduce torch particle count

- [ ] **Step 1: Identify the per-torch splat / particle budget**

If torches use a `torch_small.ply` asset, count splats: `wc -l <torch.ply>` (subtract header lines) or `python3 scripts/ply_inspect.py <path>` if that exists. If torches use procedural VFX, find their config (particle count × per-torch instances).

- [ ] **Step 2: Reduce by a measured factor**

Aim for the dungeon's steady-state `dyn` to be ≤ 600 k (leaves ≥ 400 k of headroom in the 1 MiB cap for characters + PBD). Decide between:
- **Decimate torch PLY:** rerun the PLY generator with a tighter density, or stride-sample at load time (the engine already has `kMaxVfxObjectSplats = 2048` as a fallback cap).
- **Reduce torch instance count:** drop the number of torches placed in the dungeon scene JSON.

Choose the option that keeps the dungeon visually acceptable. Default: decimate PLY first; only drop instances if decimation looks bad.

- [ ] **Step 3: Re-run measurement**

Repeat Task 5.2's launch + walk + log inspect. Expected: `dyn ≤ 600k`, no overflow warnings.

### Task 5.4 — Verify dungeon renders cleanly

- [ ] **Step 1: Tour the dungeon**

```bash
cd build/macos-release-with-diag && ./gseurat_demo &
sleep 6
python3 scripts/game_director.py tour dungeon
```

Expected: full tour completes; no flicker; torches still visually present (just lower density).

- [ ] **Step 2: Quit**

```bash
python3 scripts/game_director.py quit
```

### Task 5.5 — Phase 5 commit

```bash
git add <modified scene files / PLY assets>
git commit -m "$(cat <<'EOF'
content(scenes): cap dungeon torch density to fit kDynamicHeadroom

Trims dungeon torch particle / instance density so the scene's
steady-state dynamic GS count stays under 1 MiB (the
kDynamicHeadroom budget). Pairs with Option A (Phase 4) which
pushes PC + NPCs + PBD trees into the same dynamic tail. The
kMaxVfxObjectSplats=2048 engine-side cap remains as a safety net.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final Integration Check

After Phase 5, run the full validation plan from the spec one more time:

- [ ] **30-screenshot flicker regression** — zero blanks across island + dungeon
- [ ] **`tour` POI walk** — all POIs reached, all triggers fire
- [ ] **Portal transition** — bridge ↔ dungeon round-trip twice
- [ ] **VRAM check** — Activity Monitor shows ≈ 400 MB overhead vs. pre-Phase-1
- [ ] **Frame timing** — `WAIT_SLOW` near-zero in 60 s capture
- [ ] **Determinism harness** — existing snapshot-diff still passes
- [ ] **Validation layers** — `macos-debug` 30 s run shows zero SYNC-HAZARDs

If everything passes, the branch is ready for PR review.

---

## Self-review notes

Spec coverage — every spec section is covered:
- §1 Postmortem → motivates plan, no plan task needed
- §2 Affected buffers → Phase 1 task tables; descriptor sets → Phase 2
- §3 Memory budget → flagged in spec, no plan task (verified during runtime check)
- §4 Phases → Phases 1–5 of this plan match 1:1
- §5 Validation plan → Phase 3 / Phase 4 / Phase 5 validation gates + Final Integration Check
- §6 Risks → covered by per-phase validation gates and the "if SYNC-HAZARD found, add buffer to Phase 1" loop
- §7 Out of scope → no plan tasks (correct)
- §8 Acceptance → tracked by Final Integration Check

No placeholders. Type / naming consistency: `*_ssbos_` (plural) for arrays; `*_sets_` (plural) for descriptor set arrays; matches across Phase 1 and Phase 2 references.
