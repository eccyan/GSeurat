# GSeurat Engine Architecture

GSeurat is a C++23 / Vulkan engine for real-time **3D Gaussian Splatting** rendering. Its core design tenet is that the renderer is a **thin orchestrator over autonomous subsystems**: `GsRenderer::render()` is approximately 80 lines of straight-line code whose sole job is to invoke six self-contained subsystems in the correct order. Each subsystem owns its own pipelines, descriptor sets, GPU resources, and the pipeline barriers it must emit. Adding a new GPU pass means writing a new subsystem class, not editing the renderer.

This document captures the architecture as it stands after the engine refactor (issue #396, completed 2026-05-19). The historical journey, design rationale, and per-phase trade-offs are recorded in `docs/superpowers/specs/2026-05-02-engine-refactor-phase1-design.md` and `docs/superpowers/specs/2026-05-17-phase5e-render-orchestrator-design.md`.

---

## 1. Frame Pipeline at a Glance

```
AppBase::main_loop
  │
  ├── renderer_.wait_current_frame_fence()       ← previous frame's GPU work on this slot is finished
  ├── render_state_->begin_frame(frame)           ← reset CPU-side dirty ranges
  │
  ├── ECS systems write into RenderState         ← bones, particles, etc. (CPU mapped writes)
  │
  └── Renderer::draw_scene
        │
        └── gs_renderer_.render(cmd, frame, view, proj)
              │   (~73 LOC orchestrator)
              ├── guards (empty scene / frame-out-of-range)
              ├── build_uniforms(view, proj)
              ├── read_prev_timestamps(frame, ts_offset)
              ├── reset_timestamps(cmd, frame, ts_offset)
              │
              ├── if (!skip_gs_compute):
              │     ├── transition_outputs_for_compute(cmd, frame)
              │     ├── clear_outputs(cmd, frame)
              │     ├── pbd_.dispatch(...)            ── PBD solver
              │     ├── sort_.dispatch(...)           ── depth-sort phase (preprocess + onesweep + merge)
              │     └── tile_.dispatch(...)           ── tile binning + rasterization
              │
              └── post_.dispatch(...)                ── fog, tone mapping, bloom, DoF
        │
        └── render_state_->end_frame(frame)        ← flush mapped writes if non-coherent memory
        └── vkQueueSubmit                          ← GPU starts new work on this slot
```

Each subsystem `dispatch()` is the **single entry point** for its phase of work. Internally a subsystem may issue many `vkCmd*` calls, but the orchestrator never sees them.

---

## 2. The Orchestrator: `GsRenderer`

`GsRenderer` exists for two reasons: to **own** the subsystems by value (single-allocation lifecycle, deterministic destruction order), and to **sequence** their dispatches. It does not own GPU pipelines, descriptor sets, or pipeline-stage barriers.

```cpp
class GsRenderer {
 public:
  void render(VkCommandBuffer cmd,
              uint32_t        frame_in_flight,
              const glm::mat4& view,
              const glm::mat4& proj);
 private:
  GsResourceManager*  resources_ = nullptr;   // non-owning; AppBase owns the unique_ptr
                                              //   and binds via set_resources()
  GsStreamingSystem   streaming_;
  GsSortSystem        sort_;
  GsTileBinSystem     tile_;
  GsPbdSystem         pbd_;
  GsPostProcessSystem post_;

  // Five small private helpers for renderer-local concerns
  // (uniform construction, GPU timing readback / reset, output-image
  // lifecycle). `transition_outputs_for_compute()` emits the
  // UNDEFINED → GENERAL transitions on the per-frame output and depth
  // images that bracket the compute phase — these are renderer-owned
  // image-lifecycle barriers, distinct from the cross-system barriers
  // (PBD → sort, sort → tile, tile → post, post → blit) that live
  // inside the subsystems on the producer side.
  void build_uniforms(const glm::mat4& view, const glm::mat4& proj) noexcept;
  void read_prev_timestamps(uint32_t frame, uint32_t ts_slot_offset) noexcept;
  void reset_timestamps(VkCommandBuffer cmd, uint32_t frame, uint32_t ts_slot_offset) noexcept;
  void transition_outputs_for_compute(VkCommandBuffer cmd, uint32_t frame) noexcept;
  void clear_outputs(VkCommandBuffer cmd, uint32_t frame) noexcept;
};
```

The full `render()` body is reproduced in `docs/superpowers/specs/2026-05-17-phase5e-render-orchestrator-design.md` §3.3.

### Why an orchestrator?

The pre-refactor `GsRenderer::render()` was 451 lines of inline glue. It directly bound pipelines, recorded descriptor sets, emitted barriers, and managed timestamp queries — all interleaved with the high-level "what happens per frame" logic. The orchestrator pattern preserves the high-level structure as code an operator can read at a glance, while pushing every concrete GPU concern into a system that can be understood, modified, and tested in isolation.

---

## 3. The Six Subsystems

Each subsystem under `include/gseurat/engine/gs_renderer/` follows the same surface contract:

```cpp
class Gs<Name>System {
 public:
  Gs<Name>System() = default;
  ~Gs<Name>System();
  Gs<Name>System(const Gs<Name>System&) = delete;   // move-disabled, by-value member
  Gs<Name>System& operator=(const Gs<Name>System&) = delete;

  void init(VkDevice, VkPipelineCache, VkDescriptorPool, GsResourceManager*);
  void write_descriptors();
  void dispatch(VkCommandBuffer cmd, uint32_t frame_in_flight, /* phase-specific args */);
  void shutdown();
};
```

Move-disabled by design: each subsystem holds raw Vulkan handles that must be destroyed deterministically when `GsRenderer` is destroyed. Forbidding moves prevents accidental ownership transfers that would invalidate the renderer's destructors.

### 3.1 `GsResourceManager` — Passive Resource Container

**Path:** `include/gseurat/engine/gs_renderer/gs_resources.hpp` (struct `GsResourceManager`)

A plain `struct` of `Buffer`, `Image`, and `VkImageView` handles plus a handful of sizing scalars (`output_width`, `output_height`, `uniform_buffer_size`). It owns no logic — its sole responsibility is to give every subsystem a stable place to look up the GPU resources they share (output images, depth images, the GS uniform buffer, sort SSBOs, etc.).

**Lifetime:** `AppBase` owns the `std::unique_ptr<GsResourceManager>` (`AppBase::gs_resources_`) and binds it into the renderer via `renderer_.gs_renderer().set_resources(gs_resources_.get())` during `init_render_state`. `GsRenderer` holds a non-owning `GsResourceManager* resources_` pointer; each subsystem holds its own non-owning pointer set at `init()` time. Subsystems read shared GPU resources via `resources_->X` directly.

### 3.2 `GsStreamingSystem` — Chunk Lifecycle and GPU Page Table

**Path:** `include/gseurat/engine/gs_renderer/streaming/`

Owns the slab allocator, transfer queue, async PLY load, GPU page table, chunk inventory, and frustum-based eviction. The renderer's `load_cloud_async` / `unload_cloud` / `poll_transfers` / `clear_chunks` public methods are thin forwarders into this system.

This system's `dispatch()` is implicit — its work runs across `poll_transfers()` (called from `AppBase::draw_scene` before the `GsRenderer::render` call) and reads-from-state via getters (`static_count()`, `static_sort_size()`, `is_static_tail_dirty(frame)`, etc.) that the sort system queries.

Largest of the six subsystems by line count (~1,080 LOC across header + impl) — chunk lifecycle plus async transfer coordination is intrinsically complex.

### 3.3 `GsPbdSystem` — Position-Based Dynamics Solver

**Path:** `include/gseurat/engine/gs_renderer/pbd/`

Runs the GPU PBD solver (`gs_pbd.comp`) for hair, foliage sway, dangling chains, and similar Verlet-integrated constraint physics. Owns the PBD compute pipeline, its descriptor set, and the per-frame UBO. The renderer's public `upload_pbd_elements` / `upload_pbd_constraints` / `clear_pbd` forward into this system; the inline 50-line PBD dispatch sequence that lived in `render()` before Phase 5e is now a single `pbd_.dispatch(cmd, frame, time, determinism_test_active)` call.

`pbd_.dispatch()` is unconditional from the orchestrator; the system early-exits internally when `count() == 0` or when the determinism-test harness is active.

### 3.4 `GsSortSystem` — Depth Sort Phase (Preprocess + Onesweep + Merge)

**Path:** `include/gseurat/engine/gs_renderer/sort/`

The depth-sort phase has three logical steps — projection / culling (preprocess), sorting (Onesweep radix), and consolidation (merge) — but presents a single `dispatch()` entry to the orchestrator. Internally `dispatch()`:

1. **Prepares sort buffers.** Static-tail fill (per-buffer barrier inside an `if (streaming.is_static_tail_dirty)` guard), counts-SSBO reset, dynamic sort-buffer fill with `0xFFFFFFFFu` sentinel, then a global `TRANSFER → COMPUTE` barrier.
2. **Emits the depth-sort-begin timestamp** at `ts_slot_offset + 0`.
3. **Dynamic preprocess + sort** if `dynamic_count > 0` — projects, depth-sorts via Onesweep (decoupled lookback, 2-dispatch).
4. **Static preprocess + sort** if `streaming.static_dirty() && streaming.static_count() > 0`, then `streaming.tick_static_dirty()`.
5. **Merge** (always) — combines static + dynamic sorted entries into `merged_sort_ssbo`.
6. **Emits the sort → tile cross-system barrier** as the last operation it performs.
7. **Emits the depth-sort-end timestamp** at `ts_slot_offset + 1`.

Owns the preprocess pipeline + 4 per-frame preprocess descriptor sets, the onesweep histogram and scatter pipelines, the merge pipeline + per-frame merge descriptor sets, and 24 depth-sort descriptor sets (4 sets × 3 paths × 2 frames-in-flight).

### 3.5 `GsTileBinSystem` — Tile Binning + Tile Sort + Tile Rasterization

**Path:** `include/gseurat/engine/gs_renderer/tile_bin/`

Six GPU passes — `tile_count → tile_scan ×3 → tile_bin → tile_prepare_indirect → onesweep_radix_sort ×4 → tile_ranges → tile_render` — exposed as a single `dispatch()`. The system also tracks determinism-harness state (`determinism_test_active_`, `determinism_readback_emitted_`).

`dispatch()` emits the four tile-phase timestamps (`ts_slot_offset + 2..5`) and the final `tile → post` cross-system barrier. It borrows the Onesweep histogram/scatter pipelines from `GsSortSystem` rather than recreating them.

The Onesweep radix sort delivers a 5× speedup over the legacy 4-pass radix on AMD RX 6600M (524K tile entries) by replacing the synchronous histogram/scan/scatter sequence with a single decoupled-lookback chain. See `README.md` § *3D Gaussian Splatting* for benchmark numbers.

### 3.6 `GsPostProcessSystem` — Fog, Tone Mapping, Bloom, DoF

**Path:** `include/gseurat/engine/gs_renderer/post/`

Single-pass compute that consumes the tile-rasterized output and produces the final processed image. Owns the post-process pipeline, its per-frame descriptor set, and the runtime parameters (`GsPostProcessParams`, fog density, bloom intensity, DoF focus, etc.).

`dispatch()` emits two barriers:
- A leading `UNDEFINED → GENERAL` transition on the per-frame `processed_image`.
- A trailing `GENERAL → SHADER_READ_ONLY_OPTIMAL` transition — the cross-system barrier handing off to the swapchain blit's fragment shader.

`post_.dispatch()` is unconditional in the orchestrator (i.e. runs even when `skip_gs_compute` is true), because effects like screen fades animate every frame regardless of whether new splats were rendered.

---

## 4. Cross-System Barrier Discipline

The four cross-system pipeline barriers all live on the **producer side** — they are the last `vkCmdPipelineBarrier` the upstream system emits before its `dispatch()` returns:

| # | Producer | Consumer | `srcAccessMask → dstAccessMask` | `srcStageMask → dstStageMask` |
|---|---|---|---|---|
| 1 | `GsPbdSystem::dispatch` | `GsSortSystem::dispatch` (preprocess phase) | `SHADER_WRITE → SHADER_READ` | `COMPUTE → COMPUTE` |
| 2 | `GsSortSystem::dispatch` | `GsTileBinSystem::dispatch` | `SHADER_WRITE → SHADER_READ \| SHADER_WRITE` | `COMPUTE → COMPUTE` |
| 3 | `GsTileBinSystem::dispatch` | `GsPostProcessSystem::dispatch` | `SHADER_WRITE → SHADER_READ \| SHADER_WRITE` | `COMPUTE → COMPUTE` |
| 4 | `GsPostProcessSystem::dispatch` | Fragment-shader blit (in `Renderer::draw_scene`) | `SHADER_WRITE → SHADER_READ`, `GENERAL → SHADER_READ_ONLY_OPTIMAL` | `COMPUTE → FRAGMENT` |

**Rule (spec §5.4):** *A barrier moves with the dispatch that produces its `srcAccessMask`.* Within-system barriers (preprocess → sort, sort → merge, tile count → tile scan, etc.) stay inside the system. Cross-system barriers attach to the producer.

This rule is what made the refactor's verbatim-move discipline possible — the verification gate during the Phase 5e merge compared the api_dump output of every `vkCmdPipelineBarrier` between pre-refactor `main` and the refactor branch, and produced a zero-line diff across 187 lines of access masks, stage masks, and layouts.

The shared barrier helper itself — `insert_compute_barrier(VkCommandBuffer)` — lives in `include/gseurat/engine/gs_renderer/gs_renderer_internal.hpp` and is used by `gs_renderer.cpp`, `gs_sort_system.cpp`, and `gs_tile_bin_system.cpp`.

---

## 5. `RenderState` and the Frame Lifecycle

`RenderState` (`include/gseurat/engine/render_state.hpp`) is the typed CPU-to-GPU bridge for per-frame data that ECS systems produce and the renderer consumes (bones, eventually vfx, pbd, particles). It owns **persistent-mapped, per-frame-in-flight** buffers and exposes typed `Writer` objects (`BonesWriter`, etc.) that ECS systems use to push data without touching Vulkan directly.

The frame lifecycle is bracketed by two calls that `AppBase` makes around the body of `main_loop`:

```cpp
renderer_.wait_current_frame_fence();          // GPU done with this slot
render_state_->begin_frame(frame);              // clear dirty ranges
// ... ECS systems mutate via writers; CPU mapped writes happen here ...
render_state_->end_frame(frame);                // flush mapped ranges if non-coherent
// vkQueueSubmit follows
```

`begin_frame` / `end_frame` are no-ops on Apple Silicon (`HOST_COHERENT` unified memory), but on platforms with non-coherent host-visible memory `end_frame` emits the necessary `vkFlushMappedMemoryRanges`. The bracket also encodes the synchronization contract: CPU writes are race-free against the previous frame's GPU reads on the same slot, because the fence wait precedes `begin_frame`.

`RenderState` is owned by `AppBase` and passed by mutable reference into the ECS scheduler and by const reference into `Renderer::draw_scene`. The transition from "renderer pulls from AppBase" (pre-refactor) to "ECS pushes to RenderState, renderer consumes RenderState" is a multi-PR migration that is still partially in progress; `BonesWriter` is fully wired, with the remaining writers (vfx, pbd, particles) following the same pattern as they migrate.

---

## 6. Resource Ownership Summary

| Concern | Owner |
|---|---|
| View / projection matrices | Passed into `GsRenderer::render` from `Renderer::draw_scene` |
| Per-frame uniform values (lights, fog, effects, time, camera, etc.) | `GsRenderer` private fields, fed by existing `set_*` accessors; aggregated into `GsUniforms` via `build_uniforms()` |
| Uniform buffer (mapped GPU memory) | `GsResourceManager::uniform_buffer` (owned by `AppBase`) |
| Output / depth / processed images (per frame in flight) | `GsResourceManager::output_images[]` / `depth_images[]` / `processed_images[]` |
| Sort entries, counts SSBO, projected SSBO | `GsResourceManager` |
| Preprocess pipeline + descriptor sets | `GsSortSystem` |
| Onesweep histogram & scatter pipelines | `GsSortSystem` (shared with `GsTileBinSystem` via getters) |
| Merge pipeline | `GsSortSystem` |
| Tile-bin pipelines (count / scan / indirect / bin / ranges / render) | `GsTileBinSystem` |
| Post-process pipeline + per-frame descriptor set + runtime params | `GsPostProcessSystem` |
| PBD pipeline + descriptor set + UBO + element / constraint counts | `GsPbdSystem` |
| Chunk lifecycle, dirty flags, page table, transfer queue | `GsStreamingSystem` |
| Timestamp query pool + accumulators + reporting period | `GsRenderer` (centralized — read via `read_prev_timestamps`, slot offset passed into `sort_` and `tile_`) |
| Frame-level flags (`skip_sort_`, `sort_done_once_`, `dynamic_count_`, `time_`) | `GsRenderer` |

---

## 7. Code Layout

```
include/gseurat/engine/
  gs_renderer.hpp                       — GsRenderer class + public API
  gs_renderer/
    gs_renderer_internal.hpp            — shared insert_compute_barrier helper
    gs_resources.hpp                    — passive resource struct
    pbd/gs_pbd_system.hpp               — GsPbdSystem
    post/gs_post_process_system.hpp     — GsPostProcessSystem
    post/post_process_params.hpp        — runtime parameters (fog / bloom / DoF / etc.)
    sort/gs_sort_system.hpp             — GsSortSystem + GsPreprocessPush struct
    streaming/gs_streaming_system.hpp   — GsStreamingSystem
    tile_bin/gs_tile_bin_system.hpp     — GsTileBinSystem
  render_state.hpp                      — RenderState + writer types

src/engine/
  gs_renderer.cpp                       — orchestrator (~2,025 LOC; render() body ~73 LOC)
  gs_renderer/
    gs_resources.cpp
    pbd/gs_pbd_system.cpp
    post/gs_post_process_system.cpp
    sort/gs_sort_system.cpp
    streaming/gs_streaming_system.cpp
    tile_bin/gs_tile_bin_system.cpp
```

To trace a GPU pass from API call to shader execution: start in `gs_renderer.cpp::render()`, identify which subsystem `dispatch()` owns the pass, open that subsystem's `.cpp` file, and find the corresponding `vkCmdDispatch` or `vkCmdPipelineBarrier`. Shader sources live in `shaders/` and are referenced by their `.spv` paths inside each subsystem's `init()`.

---

## 8. Where the Refactor Came From

This architecture is the result of issue #396, a six-month effort that decomposed a 3,919-LOC monolithic `gs_renderer.cpp` (Phase 1 baseline) into the structure described above. The full design history — including the alternatives considered, the trade-offs accepted, and the per-phase rollout — is in:

- `docs/superpowers/specs/2026-05-02-engine-refactor-phase1-design.md` — the parent design document covering Phases 0 through 5
- `docs/superpowers/specs/2026-05-17-phase5e-render-orchestrator-design.md` — the closing Phase 5e spec (orchestrator rewrite)
- `docs/superpowers/plans/2026-05-17-396-phase5e-render-orchestrator-plan.md` — the 7-commit implementation plan that delivered the final shape

These are intentionally preserved as design artifacts. The current document is the **current state**; those documents are the **journey**.
