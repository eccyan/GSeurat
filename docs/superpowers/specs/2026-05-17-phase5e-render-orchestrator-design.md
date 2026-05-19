# Engine Refactor Phase 5e — `GsRenderer::render()` Orchestrator Design

**Date:** 2026-05-17
**Author:** eccyan + Claude (brainstorming session)
**Branch:** `refactor/396-phase5e-render-orchestrator`
**Status:** Draft, awaiting review
**Predecessor:** PR #460 (`refactor/396-phase4-close`, merged 2026-05-17 as commit `7eb2b072`)
**Parent design:** `docs/superpowers/specs/2026-05-02-engine-refactor-phase1-design.md` §5.1, §6 (Phase 5e row)

---

## 1. Context

Phases 1–4 of the engine refactor (#396) and Phases 5a–5d (subsystem extraction) have all landed. The parent design's Phase 5e row reads "Extract `GsStreamingSystem`. `GsRenderer::render()` becomes ~80 LOC orchestrator. Risk: Highest." Streaming was extracted in earlier work, but `render()` itself remains at **451 LOC** (lines 1733–2184 of `src/engine/gs_renderer.cpp`, total file 2388 LOC).

What remains inline in `render()` is **glue logic**:

| Block | Lines | LOC | Concern |
|---|---|---|---|
| Guards + image handle fetch | 1735–1750 | ~15 | Pure orchestration |
| `GsUniforms` construction + UBO memcpy | 1752–1793 | ~42 | Renderer-owned (~15 setter-fed fields) |
| Static_sort tail fill (per-slot dirty flag) | 1795–1837 | ~42 | Streaming-flagged, consumed by sort buffers |
| GPU timestamp readback + reset | 1839–1912 | ~73 | Diagnostic (kept in debug builds) |
| Output/depth image GENERAL transition | 1914–1938 | ~20 | Render-target lifecycle |
| Output/depth image clear | 1940–1945 | ~6 | Render-target lifecycle |
| **PBD dispatch inline** (full pipeline+set+UBO+dispatch+barrier) | 1947–1997 | ~50 | Physics — wrong owner |
| Counts SSBO reset + dynamic sort buffer init | 1999–2056 | ~58 | Sort-phase preparation |
| Depth-sort phase (dyn preprocess+sort, static preprocess+sort, merge) | 2058–2126 | ~68 | Sort-phase — preprocess still inline |
| Tile sort + tile rasterize + timestamps | 2128–2154 | ~26 | Tile-phase orchestration |
| Post-process call | 2161–2164 | 4 | Clean (5b-extracted) |
| Processed image GENERAL→SHADER_READ_ONLY | 2167–2183 | ~17 | Post-phase blit prep |

Phases 5a–5d extracted the *dispatch internals* of sort, tile-bin, post-process, streaming, and resources. What did **not** move was the surrounding plumbing: preprocess pipeline binding, sort-buffer initialization, static-tail fill, PBD dispatch, GPU timestamps, image lifecycle transitions, and uniform construction.

This design specifies the final extraction: make `GsRenderer::render()` an ~80-LOC orchestrator whose body is dominated by subsystem `dispatch()` calls plus a small set of private helpers for renderer-local concerns.

---

## 2. Goals & Non-Goals

### In scope

1. **Extract a new `GsPbdSystem`** under `include/gseurat/engine/gs_renderer/pbd/` and `src/engine/gs_renderer/pbd/`, symmetric with `GsSortSystem`/`GsTileBinSystem`/`GsPostProcessSystem`/`GsStreamingSystem`. Absorbs PBD pipeline, descriptor set, UBO, state fields, upload/clear methods, and dispatch body.
2. **Maximal-collapse `GsSortSystem` surface**: replace `dispatch_depth_dynamic` / `dispatch_depth_static` / `dispatch_merge` with a single `dispatch()` entry that internalizes preprocess (both dynamic and static), sort-buffer init, static-tail fill, all three sort sub-passes, internal barriers, and the depth-sort timestamp pair.
3. **Maximal-collapse `GsTileBinSystem` surface**: replace `dispatch_sort` / `dispatch_render` with a single `dispatch()` entry that internalizes both sub-dispatches, their four timestamps, and the final compute→compute barrier.
4. **`GsPostProcessSystem` absorbs the processed-image final transition** (`GENERAL → SHADER_READ_ONLY_OPTIMAL`) as the last operation of its existing `dispatch()`.
5. **Private orchestrator helpers** on `GsRenderer`: `build_uniforms(view, proj)`, `read_prev_timestamps(frame)`, `reset_timestamps(cmd, frame)`, `transition_outputs_for_compute(cmd, frame)`, `clear_outputs(cmd, frame)`.
6. **Final `render()` body shape**: ~80 LOC, dominated by subsystem `dispatch()` calls plus the five helpers above.
7. **`GsRenderer` public API unchanged**: `render(cmd, frame_in_flight, view, proj)` signature stays; existing `set_*` / `upload_pbd_*` / `clear_pbd` etc. continue to work (PBD methods forward to `pbd_`).

### Out of scope (deferred / not happening)

- **Signature change to `render(cmd, const RenderState&, const Camera&, FrameIndex)`** (parent design §5.1 ideal). Would re-open Phase 4 caller migration; explicitly out per user direction.
- **`PointLightsWriter` revival** — deleted in PR #460 as dead architecture. Stays deleted.
- **`Camera` struct extraction** packaging view/proj/near/far/cam_pos — would touch every `Renderer::draw_scene` caller.
- **Effect-parameter migration into `RenderState`** — the ~15 setter-fed fields (`water_y_`, `pulse_t_`, `light_dir_`, etc.) stay as `GsRenderer` private state.
- **Separate `GsPreprocessSystem`** — preprocess is logically part of the depth-sort phase; folded into `GsSortSystem` per maximal-collapse decision.
- **Pipeline-creation decentralization beyond extraction** — each system owns its pipelines, but they're created from `GsRenderer::create_compute_pipelines()` calling each system's new `init_pipelines()` method. Full decentralization of startup ordering is out of scope.
- **Performance changes** — strictly a code-organization refactor. No GPU work added or removed.
- **New unit tests** — the render path has no existing unit coverage; adding tests would require a Vulkan test harness. Existing `tests/test_render_state.cpp` is preserved unchanged.

---

## 3. Architecture

### 3.1 File-level changes

```
include/gseurat/engine/gs_renderer.hpp                              (shrink: remove ~25 private fields, add 5 helpers)
src/engine/gs_renderer.cpp                                          (shrink: render() body ~451 → ~80 LOC)

include/gseurat/engine/gs_renderer/pbd/                             [new directory]
└── gs_pbd_system.hpp                                               [new file]
src/engine/gs_renderer/pbd/
└── gs_pbd_system.cpp                                               [new file]

include/gseurat/engine/gs_renderer/sort/gs_sort_system.hpp          (expand surface: new dispatch(), init_pipelines())
src/engine/gs_renderer/sort/gs_sort_system.cpp                      (absorb preprocess + sort-buffer init + static-tail fill + timestamps)

include/gseurat/engine/gs_renderer/tile_bin/gs_tile_bin_system.hpp  (collapse surface to single dispatch())
src/engine/gs_renderer/tile_bin/gs_tile_bin_system.cpp              (absorb timestamps + final barrier)

include/gseurat/engine/gs_renderer/post/gs_post_process_system.hpp  (no surface change)
src/engine/gs_renderer/post/gs_post_process_system.cpp              (absorb final processed_image transition)
```

### 3.2 Post-extraction `GsRenderer` class shape

```cpp
class GsRenderer {
public:
  // Public API — unchanged
  void render(VkCommandBuffer cmd, uint32_t frame_in_flight,
              const glm::mat4& view, const glm::mat4& proj);
  // ... existing set_point_lights, set_shadow_box_params, upload_pbd_elements
  //     (forwards to pbd_), upload_pbd_constraints (forwards), clear_pbd (forwards)
  //     remain. AppBase callers do not change.

private:
  // Owned subsystems
  GsResources         resources_;
  GsStreamingSystem   streaming_;
  GsSortSystem        sort_;        // ABSORBS: preprocess, sort-buffer init, static-tail fill,
                                    //          3 sort sub-passes, depth-sort timestamps (ts+0, ts+1)
  GsTileBinSystem     tile_;        // ABSORBS: tile sort + tile render, 4 timestamps
                                    //          (ts+2..ts+5), final compute→compute barrier
  GsPbdSystem         pbd_;         // NEW: full PBD dispatch + pipeline + descriptors + UBO + state
  GsPostProcessSystem post_;        // ABSORBS: final processed_image GENERAL→SHADER_READ_ONLY

  // Orchestrator-local glue (kept)
  //   - Uniform-construction sources: light_dir_, point_lights_, water_y_, pulse_t_, time_, etc.
  //   - Timestamp pool + accumulators: timestamp_pool_, depth_sort_ms_accum_, etc.
  //   - Frame-level flags: skip_sort_, sort_done_once_, dynamic_count_

  // Private helpers (new)
  void build_uniforms(const glm::mat4& view, const glm::mat4& proj) noexcept;
  void read_prev_timestamps(uint32_t frame) noexcept;
  void reset_timestamps(VkCommandBuffer cmd, uint32_t frame) noexcept;
  void transition_outputs_for_compute(VkCommandBuffer cmd, uint32_t frame) noexcept;
  void clear_outputs(VkCommandBuffer cmd, uint32_t frame) noexcept;
};
```

### 3.3 Target `render()` body

```cpp
void GsRenderer::render(VkCommandBuffer cmd, uint32_t frame_in_flight,
                        const glm::mat4& view, const glm::mat4& proj) {
  // Guards
  if (streaming_.gaussian_count() == 0 &&
      streaming_.static_count() == 0 &&
      dynamic_count_ == 0) return;
  if (frame_in_flight >= kMaxFramesInFlight) {
    std::fprintf(stderr, "[gs_renderer] render(): frame_in_flight=%u out of range\n",
                 frame_in_flight);
    return;
  }
  GS_LABEL(cmd, "GS.Render");

  uint32_t width  = resources_->output_width;
  uint32_t height = resources_->output_height;

  build_uniforms(view, proj);
  read_prev_timestamps(frame_in_flight);
  reset_timestamps(cmd, frame_in_flight);

  bool skip_gs_compute = skip_sort_ && sort_done_once_;

  if (!skip_gs_compute) {
    transition_outputs_for_compute(cmd, frame_in_flight);
    clear_outputs(cmd, frame_in_flight);

    pbd_.dispatch(cmd, frame_in_flight, time_, tile_.determinism_test_active());

    sort_.dispatch(cmd, frame_in_flight, dynamic_count_,
                   streaming_.max_static_count(),
                   streaming_,
                   timestamp_pool_, frame_in_flight * kTimestampQueriesPerFrame);

    tile_.dispatch(cmd, frame_in_flight, width, height,
                   timestamp_pool_, frame_in_flight * kTimestampQueriesPerFrame);

    sort_done_once_ = true;
    timestamps_written_per_slot_[frame_in_flight] = tile_.emitted_timestamps_this_frame();
  }

  post_.dispatch(cmd, frame_in_flight, width, height);
}
```

Roughly 35 statements / ~45 LOC of substantive code (plus blank lines and braces, totaling ~80 LOC formatted). The `GS_LABEL` produces the same single outer span; each system call produces its own internal labels (already present today). RenderDoc traces remain readable.

---

## 4. Per-System Absorption Detail

### 4.1 `GsPbdSystem` (new)

**Absorbs from `GsRenderer`:**

- Fields: `pbd_pipeline_`, `pbd_pipeline_layout_`, `pbd_set_`, `pbd_set_layout_`, `pbd_uniform_buffer_`, `pbd_count_`, `pbd_constraint_count_`
- Setters: `upload_pbd_elements(states, params, count)`, `upload_pbd_constraints(constraints, count)`, `clear_pbd()` — implementations move to the new class
- Dispatch body (current lines 1947–1997)

**Public surface:**

```cpp
class GsPbdSystem {
public:
  void init_pipelines(VkDevice device, VmaAllocator allocator,
                      VkDescriptorPool pool, VkPipelineCache cache,
                      GsResources& resources);
  void upload_elements(const PbdPhysicsState* states,
                       const PbdElementParams* params,
                       uint32_t count);
  void upload_constraints(const PbdConstraint* constraints, uint32_t count);
  void clear();
  // Caller passes time and the determinism guard; the system early-exits
  // if pbd_count_ == 0 || determinism_test_active.
  void dispatch(VkCommandBuffer cmd, uint32_t frame_in_flight,
                float time, bool determinism_test_active) noexcept;
  uint32_t count() const noexcept { return pbd_count_; }
  void shutdown(VmaAllocator allocator);
};
```

`GsRenderer`'s public `upload_pbd_elements` / `upload_pbd_constraints` / `clear_pbd` remain and **forward** to the corresponding `pbd_` methods. AppBase callers (`gs_demo_state.cpp`, `staging_state.cpp`, `gs_scene_loader.cpp`) do not change.

**Barrier ownership:** the PBD→preprocess `vkCmdPipelineBarrier` (current lines 1989–1996) becomes the *last* operation `GsPbdSystem::dispatch()` emits. The orchestrator subsequently calls `sort_.dispatch()`, whose first work is preprocess; the barrier connects them across the system boundary.

### 4.2 `GsSortSystem` (expand surface)

**Absorbs from `GsRenderer::render()`:**

- Preprocess pipeline: `preprocess_pipeline_`, `preprocess_pipeline_layout_`, `dynamic_preprocess_sets_[frame]`, `static_preprocess_sets_[frame]` (current lines 2068–2076, 2090–2102)
- Sort-buffer initialization: counts SSBO reset (12 or 8 bytes depending on `static_dirty`), dynamic_sort_a/b fill with `0xFFFFFFFFu` (current lines 2011–2056)
- Static-tail fill: dirty-flag consultation + 2× `vkCmdFillBuffer` + 2-barrier (current lines 1795–1837)
- Depth-sort timestamps: `ts_slot_offset + 0` (begin) and `+ 1` (end) (current lines 2059–2062, 2123–2126)
- Final `insert_compute_barrier(cmd)` before tile phase (current line 2120)

**New public surface (replaces `dispatch_depth_dynamic` / `dispatch_depth_static` / `dispatch_merge`):**

```cpp
class GsSortSystem {
public:
  // Existing init/shutdown plus:
  void init_pipelines(VkDevice device, VkPipelineCache cache,
                      VkDescriptorPool pool, GsResources& resources);
  // Preprocess descriptor refresh is internal to GsSortSystem; the existing
  // GsRenderer::update_descriptors() call site forwards to sort_ (and the
  // other systems) so callers don't change.

  // Single dispatch entry — internalizes everything from "start of GS compute"
  // (after image transitions + clears) through "merge complete, ready for tile phase".
  void dispatch(VkCommandBuffer cmd,
                uint32_t frame_in_flight,
                uint32_t dynamic_count,
                uint32_t static_count_for_dyn_offset,   // = streaming.max_static_count()
                GsStreamingSystem& streaming,             // for static_dirty + static_count
                                                          //     + is/clear_static_tail_dirty
                                                          //     + tick_static_dirty
                VkQueryPool timestamp_pool,
                uint32_t ts_slot_offset) noexcept;
};
```

**Why pass `GsStreamingSystem&` by reference rather than constructor-binding:** the dependency is *per-frame* (sort consults streaming state at dispatch time). Constructor binding would tie sort's lifetime to a specific streaming instance and complicate test scaffolding. The reference-per-call pattern keeps the dependency explicit at the call site.

**Internal sequencing (preserved verbatim):**

```
[ts begin (slot+0)]
maybe_fill_static_tail (if streaming.is_static_tail_dirty(frame))
  → 2× vkCmdFillBuffer + 2-barrier
  → streaming.clear_static_tail_dirty(frame)
init_sort_buffers (counts SSBO reset + dynamic_sort_a/b fill if dynamic_count>0)
  → vkCmdFillBuffer
  → TRANSFER→COMPUTE barrier
if (dynamic_count > 0):
  dispatch_dyn_preprocess
  insert_compute_barrier
  dispatch_depth_dynamic (existing onesweep)
if (streaming.static_dirty() && streaming.static_count() > 0):
  dispatch_static_preprocess
  insert_compute_barrier
  dispatch_depth_static (existing onesweep)
  streaming.tick_static_dirty()
dispatch_merge (existing)
insert_compute_barrier
[ts end (slot+1)]
```

### 4.3 `GsTileBinSystem` (collapse surface)

**Absorbs from `GsRenderer::render()`:**

- Four timestamps: `ts_slot_offset + 2/3/4/5` (current lines 2129–2132, 2134–2137, 2140–2143, 2145–2149)
- Final `insert_compute_barrier(cmd)` after tile rasterize (current line 2154)
- `timestamps_written_per_slot_[frame] = true` write (current line 2148) — moved into the system and exposed via `emitted_timestamps_this_frame()`.

**New public surface (replaces `dispatch_sort` + `dispatch_render`):**

```cpp
class GsTileBinSystem {
public:
  void dispatch(VkCommandBuffer cmd, uint32_t frame_in_flight,
                uint32_t width, uint32_t height,
                VkQueryPool timestamp_pool,
                uint32_t ts_slot_offset) noexcept;
  bool emitted_timestamps_this_frame() const noexcept;
  // existing: bool determinism_test_active() const noexcept;
};
```

**Internal sequencing:**

```
[ts tile_sort_begin (slot+2)]
dispatch_tile_sort (existing internal sub-passes)
[ts tile_sort_end (slot+3)]
[ts raster_begin (slot+4)]
dispatch_tile_render (existing internal sub-passes)
[ts raster_end (slot+5)]
emitted_timestamps_ = (timestamp_pool != VK_NULL_HANDLE);
insert_compute_barrier
```

### 4.4 `GsPostProcessSystem` (minor expansion)

**Absorbs from `GsRenderer::render()`:** Final processed_image `GENERAL → SHADER_READ_ONLY_OPTIMAL` transition (current lines 2167–2183), appended to the existing `dispatch()` body. No new public method.

The transition becomes the last operation `post_.dispatch()` emits. This is safe because no orchestrator code after `post_.dispatch()` touches `processed_image`; the next consumer is `Renderer::draw_scene`'s blit, which expects `SHADER_READ_ONLY_OPTIMAL`.

### 4.5 `GsRenderer` private helpers (new)

```cpp
void GsRenderer::build_uniforms(const glm::mat4& view, const glm::mat4& proj) noexcept;
  // Body: current lines 1752–1793 verbatim. Reads ~15 setter-fed fields
  // (light_dir_, light_intensity_, point_lights_, shadow_box_*, water_y_,
  //  fire_y_min/max_, pulse_t_, swirl_t_, burn_t_, touch_*, actor_rotation_,
  //  time_, num_sort_passes_, scale_multiplier_, voxel_t_, explode_t_,
  //  toon_bands_, light_mode_, pixel_art_intensity_, effect_strength_).
  // Writes resources_->uniform_buffer.mapped() via std::memcpy.

void GsRenderer::read_prev_timestamps(uint32_t frame) noexcept;
  // Body: current lines 1855–1905. Non-blocking vkGetQueryPoolResults;
  // updates depth_sort_ms_*_, tile_sort_ms_*_, rasterize_ms_*_ accumulators;
  // emits GS_LOG_FRAME averages every kTimestampAvgFrames. Preserves the
  // debug-only watchdog (wait_ms > 100.0).

void GsRenderer::reset_timestamps(VkCommandBuffer cmd, uint32_t frame) noexcept;
  // Body: current lines 1909–1912. vkCmdResetQueryPool for this slot only;
  // clears timestamps_written_per_slot_[frame].

void GsRenderer::transition_outputs_for_compute(VkCommandBuffer cmd, uint32_t frame) noexcept;
  // Body: current lines 1918–1938. 2× UNDEFINED→GENERAL barrier on
  // out_img (resources_->output_images[frame]) and depth_img
  // (resources_->depth_images[frame]).

void GsRenderer::clear_outputs(VkCommandBuffer cmd, uint32_t frame) noexcept;
  // Body: current lines 1940–1945. 2× vkCmdClearColorImage on out_img and depth_img.
```

These remain on `GsRenderer` because each needs access to `resources_->output_images/depth_images/uniform_buffer`, plus the renderer-owned timestamp_pool_ and 12 timing accumulator fields.

---

## 5. Data Flow

### 5.1 Single-frame flow (post-Phase 5e)

```
AppBase::main_loop
  ├─ renderer_.wait_current_frame_fence()            ← PR #460
  ├─ render_state_->begin_frame(frame)               ← PR #460
  ├─ ECS systems write through RenderState (today: BonesWriter only)
  ├─ Renderer::draw_scene  →  gs_renderer_.render(cmd, frame, view, proj)
  │     ├─ guards (no data / frame out of range)
  │     ├─ GS_LABEL "GS.Render"
  │     ├─ build_uniforms(view, proj)
  │     ├─ read_prev_timestamps(frame)
  │     ├─ reset_timestamps(cmd, frame)
  │     ├─ if (!skip_gs_compute):
  │     │     ├─ transition_outputs_for_compute(cmd, frame)
  │     │     ├─ clear_outputs(cmd, frame)
  │     │     ├─ pbd_.dispatch(cmd, frame, time_, tile_.determinism_test_active())
  │     │     │     └─ emits: UBO upload, pipeline+set bind, push constants,
  │     │     │              dispatch, PBD→preprocess barrier
  │     │     ├─ sort_.dispatch(cmd, frame, dynamic_count_,
  │     │     │                 streaming_.max_static_count(),
  │     │     │                 streaming_,
  │     │     │                 timestamp_pool_, ts_slot_offset)
  │     │     │     └─ emits: ts begin, static-tail fill (if dirty),
  │     │     │              sort-buffer init, dyn preprocess+sort,
  │     │     │              static preprocess+sort, merge, sort→tile barrier,
  │     │     │              ts end
  │     │     ├─ tile_.dispatch(cmd, frame, width, height,
  │     │     │                 timestamp_pool_, ts_slot_offset)
  │     │     │     └─ emits: 4× ts, tile sort + tile rasterize,
  │     │     │              tile→post barrier
  │     │     └─ sort_done_once_ = true;
  │     │        timestamps_written_per_slot_[frame] = tile_.emitted_timestamps_this_frame();
  │     └─ post_.dispatch(cmd, frame, width, height)
  │           └─ emits: processed_image UNDEFINED→GENERAL, UBO upload,
  │                    post-process dispatch, processed_image GENERAL→SHADER_READ_ONLY
  ├─ render_state_->end_frame(frame)                 ← PR #460
  └─ vkQueueSubmit
```

### 5.2 State ownership map (post-5e)

| Concern | Owner |
|---|---|
| `view`/`proj` matrices | passed in to `render()` from `Renderer::draw_scene` |
| Per-frame uniform values (lights, effects, time, touch, etc.) | `GsRenderer` private fields, fed by existing `set_*` methods |
| Uniform buffer (mapped GPU memory) | `GsResources::uniform_buffer` |
| Output / depth / processed images | `GsResources::output_images[frame]` etc. |
| Counts SSBO | `GsResources::counts_ssbos[frame]` |
| Static/dynamic sort entries | `GsResources::static_sort_as/bs[frame]`, `dynamic_sort_as/bs[frame]` |
| Preprocess pipeline + descriptor sets | `GsSortSystem` (moved from `GsRenderer`) |
| Onesweep sort pipelines | `GsSortSystem` (already) |
| Merge pipeline | `GsSortSystem` (already) |
| Tile-bin pipelines (count/scan/indirect/bin/ranges/render) | `GsTileBinSystem` (already) |
| Post-process pipeline + UBO | `GsPostProcessSystem` (already) |
| PBD pipeline + UBO + state | `GsPbdSystem` (new — moved from `GsRenderer`) |
| Streaming chunk lifecycle, dirty flags, static_count | `GsStreamingSystem` (already) |
| Timestamp query pool + accumulators + period | `GsRenderer` (centralized; slot offset passed into `sort_` and `tile_`) |
| `dynamic_count_`, `skip_sort_`, `sort_done_once_`, `time_` | `GsRenderer` (frame-level orchestrator state) |

### 5.3 Synchronization invariants (preserved verbatim)

These are existing GPU-correctness invariants; the extraction must not break any of them. They define the cross-system barrier contracts.

1. **Slot fence wait before any CPU mapped write** — PR #460 enforces this at the AppBase level. Phase 5e does not touch.
2. **Static-tail fill happens before any consumer of `static_sort_a/b[frame]`** — within `sort_.dispatch()`, the fill is the first sub-step, sequenced via command buffer ordering.
3. **PBD write → preprocess read barrier** — last operation `pbd_.dispatch()` emits. `sort_.dispatch()`'s preprocess sub-step is the consumer.
4. **Sort merge → tile sort barrier** — last operation `sort_.dispatch()` emits. `tile_.dispatch()`'s tile-sort is the consumer.
5. **Tile rasterize → post-process barrier** — last operation `tile_.dispatch()` emits. `post_.dispatch()` is the consumer.
6. **Post processed_image GENERAL → SHADER_READ_ONLY** — last operation `post_.dispatch()` emits, for downstream fragment-shader blit.
7. **Per-slot timestamp ordering**: reset before writes. `reset_timestamps()` is called at the orchestrator level before `sort_.dispatch()` or `tile_.dispatch()` writes any timestamp.

### 5.4 Barrier-movement rule

**A barrier moves with the dispatch that produces its `srcAccessMask`.** Cross-system barriers attach to the producer side (last operation of the upstream system's `dispatch()`). Within-system barriers stay inside the system. This rule alone determines barrier placement for every block being extracted.

---

## 6. Error Handling

### 6.1 Orchestrator early returns

Both preserved from the current `render()`:

```cpp
if (streaming_.gaussian_count() == 0 &&
    streaming_.static_count() == 0 &&
    dynamic_count_ == 0) return;
if (frame_in_flight >= kMaxFramesInFlight) {
    std::fprintf(stderr, "[gs_renderer] render(): frame_in_flight=%u out of range\n",
                 frame_in_flight);
    return;
}
```

### 6.2 Per-system early-return ownership

| System | Internal guard | Source of truth |
|---|---|---|
| `pbd_.dispatch` | `if (pbd_count_ == 0 \|\| determinism_test_active) return;` | Today: `if (pbd_count_ > 0 && !tile_.determinism_test_active())` at line 1963. **Moves inside `pbd_.dispatch()`** so the orchestrator call is unconditional. |
| `sort_.dispatch` | Conditional dyn/static preprocess+sort sub-steps; merge always runs (it reads counts SSBO populated by preprocess). | Today implicit at lines 2065, 2088; preserved by sort_ owning the conditionals. |
| `tile_.dispatch` | Always runs when called; gated by orchestrator's `if (!skip_gs_compute)`. | Unchanged. |
| `post_.dispatch` | Runs every frame (params change continuously per comment at line 2158). | Unchanged. |

### 6.3 Timestamp readback failure modes (preserved)

`vkGetQueryPoolResults` is called **without** `VK_QUERY_RESULT_WAIT_BIT` (lines 1860–1863). On `VK_NOT_READY`, the measurement is silently dropped (no accumulator update, no log). The debug-build watchdog (`wait_ms > 100.0` → `GS_LOG_FRAME`) is preserved verbatim. This logic moves wholesale into `read_prev_timestamps()`.

### 6.4 Validation-layer cleanliness gate

The current demo runs validation-layer-clean (zero errors, zero warnings) in `macos-debug`. The Phase 5e PR must preserve this: zero validation messages during a 5-second demo smoke run. Any new warning is a merge blocker.

---

## 7. Verification Plan

### 7.1 Per-commit gates

Each of the 7 commits must pass all of these before the next commit begins:

1. **Build green:** `cmake --build --preset macos-debug` and `cmake --build --preset macos-release` (both with `dangerouslyDisableSandbox: true` due to FetchContent `.git/config` writes).
2. **C++ test suite:** existing unit tests (including `tests/test_render_state.cpp`) pass.
3. **Demo smoke (debug):** run `build/macos-debug/island_demo` for ~5 seconds, then SIGINT. Required output:
   - `ShutdownAuditor: No tracked objects alive.` on exit
   - Zero validation-layer messages on stderr
   - No fence-watchdog `TIMEOUT` log
4. **Demo smoke (release):** run `build/macos-release/island_demo` for ~5 seconds. Required: visible island_demo render with characters animating and PBD wind sway active.

### 7.2 End-of-PR gates

5. **RenderDoc structural diff:** Capture one frame from the demo on `main`-at-merge-base and one on the 5e branch (HEAD of commit 7). Compare label hierarchy + dispatch/barrier sequence — must be structurally identical. Any divergence in `srcAccessMask`/`dstAccessMask`/`srcStageMask`/`dstStageMask` is a merge blocker.
6. **Pre-extraction vs post-extraction timestamp comparison:** the depth_sort_ms / tile_sort_ms / rasterize_ms averages logged via `GS_LOG_FRAME` should match pre-5e baseline within noise (±0.5 ms).
7. **CI green across all 3 OSes** (ubuntu-24.04, macos-latest, windows-latest) on the final commit.

### 7.3 Verification non-goals

- **No new unit tests.** The render path lacks coverage and adding it requires a Vulkan harness out of scope here.
- **No automated regression harness.** Per CLAUDE.md and project memory, the SSIM harness crushes 16 GB Macs and is not used.
- **No performance benchmark.** This is a code-organization refactor; performance neutrality is asserted via the timestamp comparison above, not a separate benchmark.

---

## 8. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Barrier dropped during extraction → race or hang | Medium | High | RenderDoc trace diff (§7.2) + validation layer cleanliness (§6.4). Barrier-movement rule (§5.4). |
| Descriptor-set lifetime confusion (set used after pool reset) | Low | High | Each system owns its descriptor sets allocated from a shared pool. `init_pipelines()` ordering preserved (called from `create_compute_pipelines()` in the same order as today). |
| Timestamp slot offset miscounted (system reads/writes wrong slot) | Low | Medium | Each system uses fixed offsets documented in headers (sort: +0, +1; tile: +2..+5). `ts_slot_offset` passed in as `frame * kTimestampQueriesPerFrame`. Rely on log inspection — `GS_LOG_FRAME` averages match pre-5e baseline within noise. |
| Static-tail-fill skipped on edge case (Unload→shrink without dirty flag set) | Low | High | Logic moves verbatim into `sort_.dispatch()`; dirty-flag protocol (`is_static_tail_dirty` / `clear_static_tail_dirty`) is unchanged. |
| `GsRenderer` constructor / shutdown ordering breaks | Medium | Medium | `pbd_` initialized in `init()` (not as a default-constructed member). Destruction order: `pbd_ → tile_ → sort_ → post_ → streaming_ → resources_` — matches today's implicit dependency order. |
| `clear_pbd()` semantics drift between forwarder and implementation | Low | Medium | `GsRenderer::clear_pbd()` keeps forwarding; AppBase callers don't change. `GsPbdSystem::clear()` performs the same buffer reset as today's `clear_pbd()`. |
| `tile_.determinism_test_active()` cross-reference from `pbd_.dispatch()` | Low | Low | Pass the bool as a parameter from the orchestrator. Avoids `pbd_` holding a `tile_&` reference for one boolean. |
| Commit 7 (orchestrator rewrite) introduces a barrier omission late in the series | Medium | High | The commit cadence is intentionally ordered so commits 1–6 leave behavior unchanged (forwarders / wrappers); commit 7 is purely a body rewrite calling already-extracted methods. Each commit's smoke gate catches regressions before the next layer lands. |

---

## 9. Commit Cadence

Single PR (`refactor/396-phase5e-render-orchestrator`), 7 commits, each independently building and smoke-clean:

| # | Commit | Files touched | Approx LOC delta | Verification |
|---|---|---|---|---|
| 0 | `docs(specs): #396 Phase 5e — render() orchestrator design` (this spec) | 1 | +400 / 0 | trivially clean |
| 1 | `refactor(engine): extract GsPbdSystem` — new files + move pipeline/state/dispatch; `GsRenderer::upload_pbd_*` and `clear_pbd` forward | 6 | +200 / −80 | build + smoke |
| 2 | `refactor(engine): GsSortSystem absorbs preprocess pipeline + descriptors` | 4 | +90 / −90 | build + smoke |
| 3 | `refactor(engine): GsSortSystem absorbs sort-buffer init + static-tail fill` | 4 | +120 / −110 | build + smoke |
| 4 | `refactor(engine): GsSortSystem.dispatch() — single entry, internal timestamps + barriers` | 4 | +80 / −90 | build + smoke |
| 5 | `refactor(engine): GsTileBinSystem.dispatch() — absorb timestamps + final barrier` | 4 | +50 / −40 | build + smoke |
| 6 | `refactor(engine): GsPostProcessSystem absorbs final processed_image transition` | 4 | +20 / −18 | build + smoke |
| 7 | `refactor(engine): GsRenderer::render() — orchestrator shape (~80 LOC)` — extract 5 private helpers; rewrite `render()` body | 2 | +120 / −280 | build + smoke + RenderDoc diff |

**Final `gs_renderer.cpp` LOC target:** ~2050 (down from 2388, a 14% reduction). The bulk of the LOC reduction comes from commit 1 (PBD removal) and commit 7 (orchestrator rewrite). Commits 2–6 are roughly net-zero — code moves rather than disappears.

**Why this ordering**: commits 1–6 are forwarders/wrappers — each adds the new surface while keeping the old code path live (orchestrator calls the new method which in turn forwards to the existing inline logic, or the new surface coexists with the old). Commit 7 deletes the redundant inline code and rewrites `render()` to call only the new surfaces. This ordering means any commit can be reverted in isolation without breaking the next.

---

## 10. Open Questions

None outstanding. The three macro-level scope decisions are resolved:

1. **Scope ceiling**: decomposition only (no signature change, no Phase 4 reopen).
2. **PBD ownership**: new `GsPbdSystem`, symmetric with the other systems.
3. **System surface collapse**: maximal — each system exposes a single `dispatch()` entry that internalizes all its sub-passes, barriers, and timestamps.

---

## 11. Approval gate

Upon approval:

1. Spec is committed to `refactor/396-phase5e-render-orchestrator` (this commit).
2. Implementation transitions to the **writing-plans** skill, which produces `docs/superpowers/plans/2026-05-17-396-phase5e-render-orchestrator-plan.md` — a step-by-step plan derived from the 7-commit cadence in §9, with each commit broken into bite-sized TDD-style steps.
3. Execution proceeds via **subagent-driven-development**: one subagent per commit, two-stage review (spec compliance, then code quality) between each.
