# GPU Compute Pipeline

Vulkan descriptor pools, set layouts, pipelines, and compute shaders used by GSeurat's Gaussian Splatting renderer.

This document covers the **wire-level Vulkan details** — binding indices, descriptor types, push-constant sizes, shader paths. For the architectural rationale (why the renderer is an orchestrator over six subsystems, how cross-system barriers are organised, the resource-ownership summary), see `docs/architecture.md`. Where this document discusses pipelines and sets, it attributes them to the **subsystem that owns** them — `Gs*System::init()` is where the layout is created and the descriptor set is allocated.

---

## Descriptor Pools

GSeurat allocates five independent descriptor pools. The first two belong to the GS compute path and are owned by `GsRenderer`; the rest are owned by other subsystems and unaffected by the #396 engine refactor.

### GS Compute (`gs_pool_`) — owned by `GsRenderer`

Source: `src/engine/gs_renderer.cpp:225-246` (`create_descriptor_resources()`)

| Descriptor Type | Count |
|---|---|
| `STORAGE_BUFFER` | 416 |
| `STORAGE_IMAGE` | 24 |
| `UNIFORM_BUFFER` | 48 |
| **Max Sets** | **236** |

`gs_pool_` is created by `GsRenderer` and **shared** with the four compute subsystems — each `Gs*System::init()` allocates its own descriptor sets from this pool. The pool is reset (`vkResetDescriptorPool`) before any subsystem allocation runs, so the four `init()` calls own the complete allocation order. Total sets currently allocated: **51** (see [Per-Subsystem Allocation](#per-subsystem-allocation)). Pool headroom: 185 sets.

### Compose (`compose_pool_`) — owned by `GsRenderer`

Source: `src/engine/gs_renderer.cpp:418-449` (`create_compose_pipeline()`)

| Descriptor Type | Count |
|---|---|
| `STORAGE_BUFFER` | 12 (`kSetsPerSource × kSources × 2 bindings`) |
| **Max Sets** | **6** (`kMaxFramesInFlight × 3 sources`) |

Dedicated pool for the `gs_compose.comp` pass — kept separate from `gs_pool_` so that adding new compose sources (currently VFX + PBD + particles) does not perturb the GS pool's allocation indexing. Allocates exactly 6 sets — two per source (one per frame in flight).

### Sprites / Graphics (`DescriptorManager::pool_`)

Source: `src/engine/descriptor.cpp:40-55`

| Descriptor Type | Count |
|---|---|
| `UNIFORM_BUFFER` | 32 (`kMaxFramesInFlight × 16`) |
| `COMBINED_IMAGE_SAMPLER` | 64 (`kMaxFramesInFlight × 32`) |
| **Max Sets** | **32** (`kMaxFramesInFlight × 16`) |
| **Flags** | `FREE_DESCRIPTOR_SET_BIT` |

Single sprite layout with 3 bindings (UBO + diffuse texture + normal map), used for sprite rendering. Unchanged by #396.

### PostProcess Graphics (`PostProcessPipeline::pp_pool_`)

Source: `src/engine/post_process.cpp:551-568`

| Descriptor Type | Count |
|---|---|
| `COMBINED_IMAGE_SAMPLER` | 10 |
| `UNIFORM_BUFFER` | 1 |
| **Max Sets** | **6** |

Graphics-stage post-process — bloom blur passes and final composite to swapchain. Distinct from the **compute** post-process (fog / tone-map / DoF / etc.) owned by `GsPostProcessSystem`. Allocates 5 sets: 4 single-sampler (offscreen, bloom_a, bloom_b, dof_a) + 1 composite (4 samplers + light glow UBO).

### ImGui / DevOverlay (`imgui_pool_`)

Source: `src/engine/dev_overlay.cpp:18-28`

| Descriptor Type | Count |
|---|---|
| `COMBINED_IMAGE_SAMPLER` | 100 |
| **Max Sets** | **100** |
| **Flags** | `FREE_DESCRIPTOR_SET_BIT` |

---

## Compute Descriptor Set Layouts

Every binding uses `VK_SHADER_STAGE_COMPUTE_BIT`. Layouts are grouped by owning subsystem.

### Owned by `GsSortSystem`

Source: `src/engine/gs_renderer/sort/gs_sort_system.cpp:21-219` (`GsSortSystem::init`)

#### Preprocess (`preprocess_layout_`)

Frustum culling + 2D projection of Gaussian splats. Also re-applies bone and PBD transforms each frame.

| Binding | Type | Resource |
|---|---|---|
| 0 | `STORAGE_BUFFER` | gaussians |
| 1 | `STORAGE_BUFFER` | projected |
| 2 | `STORAGE_BUFFER` | sort_keys |
| 3 | `UNIFORM_BUFFER` | uniforms |
| 4 | `STORAGE_BUFFER` | visible_count |
| 5 | `STORAGE_BUFFER` | bones |
| 6 | `STORAGE_BUFFER` | pbd_states |
| 8 | `STORAGE_BUFFER` | page_table |

Shader: `shaders/gs_preprocess.comp.spv` | Push constants: `sizeof(GsPreprocessPush)`

#### Onesweep Histogram (`onesweep_hist_layout_`)

Histogram phase of the GPU radix sort (Onesweep with decoupled lookback).

| Binding | Type | Resource |
|---|---|---|
| 0 | `STORAGE_BUFFER` | input |
| 1 | `STORAGE_BUFFER` | status (lookback) |
| 2 | `STORAGE_BUFFER` | indirect_args |

Shader: `shaders/gs_onesweep_histogram.comp.spv` | Push constants: 4 bytes (`pass`)

#### Onesweep Scatter (`onesweep_scatter_layout_`)

Scatter phase — reads histogram lookback and redistributes keys.

| Binding | Type | Resource |
|---|---|---|
| 0 | `STORAGE_BUFFER` | input |
| 1 | `STORAGE_BUFFER` | output |
| 2 | `STORAGE_BUFFER` | status (lookback) |
| 3 | `STORAGE_BUFFER` | indirect_args |

Shader: `shaders/gs_onesweep_scatter.comp.spv` | Push constants: 4 bytes (`pass`)

`GsTileBinSystem` re-uses these two layouts (via `sort_->onesweep_hist_set_layout()` / `…scatter_set_layout()`) to allocate its own tile-sort descriptor sets — the layouts are sort-owned, the sets are tile-bin-owned.

#### Merge (`merge_layout_`)

Combines static + dynamic sorted keys into the merged sort buffer.

| Binding | Type | Resource |
|---|---|---|
| 0 | `STORAGE_BUFFER` | static_sort |
| 1 | `STORAGE_BUFFER` | dynamic_sort |
| 2 | `STORAGE_BUFFER` | merged_sort |
| 3 | `STORAGE_BUFFER` | counts |

Shader: `shaders/gs_merge.comp.spv` | Push constants: none

### Owned by `GsTileBinSystem`

Source: `src/engine/gs_renderer/tile_bin/gs_tile_bin_system.cpp:21-245` (`GsTileBinSystem::init`)

#### Tile Binning (`tile_bin_layout_`)

Assigns projected splats to screen-space tiles via a deterministic 3-pass count → scan → scatter pipeline. The `tile_count` and `tile_bin` compute pipelines share this layout (and share `tile_bin_pipeline_layout_`): count uses bindings 0–3 + 6; scatter uses 0–2 + 4–6.

| Binding | Type | Resource |
|---|---|---|
| 0 | `STORAGE_BUFFER` | projected |
| 1 | `STORAGE_BUFFER` | merged_sort |
| 2 | `STORAGE_BUFFER` | counts |
| 3 | `STORAGE_BUFFER` | per_splat_tile_count (count writes) |
| 4 | `STORAGE_BUFFER` | per_splat_tile_offset (scatter reads) |
| 5 | `STORAGE_BUFFER` | tile_entries (scatter writes) |
| 6 | `UNIFORM_BUFFER` | uniforms |

Shaders:
- `shaders/gs_tile_count.comp.spv` — pass 1, per-splat tile-overlap count. Reuses `tile_bin_pipeline_layout_` (no push values touched).
- `shaders/gs_tile_bin.comp.spv` — pass 3 (scatter). Push constants: 4 bytes (`max_entries`).

#### Tile Scan (`tile_scan_layout_`)

Three-dispatch hierarchical exclusive prefix-sum over `per_splat_tile_count[]`, producing the deterministic write offsets the scatter consumes. Single shader dispatched 3× via the `pass` push constant — pass 0 = local 256-element scan + write block sums, pass 1 = single-workgroup chunked scan over block sums (also writes the grand total into `tile_sort_count`), pass 2 = add scanned base back to per-splat offsets.

| Binding | Type | Resource |
|---|---|---|
| 0 | `STORAGE_BUFFER` | per_splat_tile_count (input) |
| 1 | `STORAGE_BUFFER` | per_splat_tile_offset (output) |
| 2 | `STORAGE_BUFFER` | scan_block_sums (intermediate) |
| 3 | `STORAGE_BUFFER` | tile_sort_count (pass 1 writes total) |

Shader: `shaders/gs_tile_scan.comp.spv` | Push constants: 12 bytes (`pass`, `num_elements`, `num_blocks`)

Capacity: pass 1's chunked scan supports up to 256 × 256 = 65 536 blocks → 16.7 M visible splats, well above `tile_sort_capacity_`'s 2 M cap.

Headless GPU correctness coverage: `tests/test_tile_scan_gpu.cpp` (8 cases including 262 K-element multi-chunk).

#### Tile Indirect Dispatch (`tile_indirect_layout_`)

Prepares `VkDispatchIndirectCommand` from the tile-sort count.

| Binding | Type | Resource |
|---|---|---|
| 0 | `STORAGE_BUFFER` | tile_sort_count |
| 1 | `STORAGE_BUFFER` | indirect_args |

Shader: `shaders/gs_tile_prepare_indirect.comp.spv` | Push constants: 4 bytes (`max_entries`)

#### Tile Range Detection (`tile_ranges_layout_`)

Detects per-tile start/end ranges in the sorted tile entry buffer.

| Binding | Type | Resource |
|---|---|---|
| 0 | `STORAGE_BUFFER` | sorted_entries |
| 1 | `STORAGE_BUFFER` | tile_ranges |
| 2 | `STORAGE_BUFFER` | tile_count |

Shader: `shaders/gs_tile_ranges.comp.spv` | Push constants: 8 bytes (`num_tiles`, `max_entries`)

#### Tile Render (`tile_render_layout_`)

Per-tile alpha-blended Gaussian rasterization (the production path). Allocated per-frame as `tile_render_sets_[kMaxFramesInFlight]` so each frame's set binds the frame's matching `output_image[frame]` / `depth_image[frame]`.

| Binding | Type | Resource |
|---|---|---|
| 0 | `STORAGE_BUFFER` | projected |
| 1 | `STORAGE_BUFFER` | tile_entries |
| 2 | `UNIFORM_BUFFER` | uniforms |
| 3 | `STORAGE_IMAGE` | output_image (per frame) |
| 4 | `STORAGE_BUFFER` | tile_ranges |
| 5 | `STORAGE_IMAGE` | depth_image (per frame) |

Shader: `shaders/gs_tile_render.comp.spv` | Push constants: none

### Owned by `GsPostProcessSystem`

Source: `src/engine/gs_renderer/post/gs_post_process_system.cpp:19-87` (`GsPostProcessSystem::init`)

#### Post-Process Compute (`set_layout_`)

Fog, tone-mapping, vignette, bloom premix, DoF, chromatic aberration. Allocated per-frame as `sets_[kMaxFramesInFlight]`.

| Binding | Type | Resource |
|---|---|---|
| 0 | `STORAGE_IMAGE` | input — `output_image[frame]` (readonly via `VK_IMAGE_LAYOUT_GENERAL`) |
| 1 | `STORAGE_IMAGE` | depth — `depth_image[frame]` (readonly via `GENERAL`) |
| 2 | `STORAGE_IMAGE` | output — `processed_image[frame]` (writeonly via `GENERAL`) |
| 3 | `UNIFORM_BUFFER` | `GsPostProcessUbo` |

Shader: `shaders/gs_post_process.comp.spv` | Push constants: none (dimensions live in the UBO)

### Owned by `GsPbdSystem`

Source: `src/engine/gs_renderer/pbd/gs_pbd_system.cpp:21-93` (`GsPbdSystem::init`)

#### PBD Solver (`pbd_set_layout_`)

Position-Based Dynamics constraint solver for hair, foliage sway, dangling chains. Single descriptor set — not per-frame, because the underlying buffers are stable across frames.

| Binding | Type | Resource |
|---|---|---|
| 0 | `STORAGE_BUFFER` | pbd_states (read/write) |
| 1 | `STORAGE_BUFFER` | pbd_params (readonly) |
| 2 | `STORAGE_BUFFER` | pbd_constraints (readonly) |
| 3 | `UNIFORM_BUFFER` | pbd_uniforms |

Shader: `shaders/pbd_solver.comp.spv` | Push constants: 4 bytes (`pbd_count`, `uint32_t`)

### Owned by `GsRenderer` (Compose)

Source: `src/engine/gs_renderer.cpp:371-449` (`create_compose_pipeline()`)

#### Compose (`compose_layout_`)

Renderer-owned compute pass that copies typed `RenderState` writer buffers (VFX / PBD / particles) into slots inside the persistent-dynamic prefix of the dynamic Gaussian SSBO. Runs in `Renderer::record_gs_prepass`, **before** `GsRenderer::render()`. Three named sets — `compose_sets_vfx_`, `compose_sets_pbd_`, `compose_sets_particles_` — each per-frame; all share this layout.

| Binding | Type | Resource |
|---|---|---|
| 0 | `STORAGE_BUFFER` | src — `RenderState::{vfx,pbd,particles}_buffer(frame)` (readonly) |
| 1 | `STORAGE_BUFFER` | dst — `dynamic_gaussian_ssbo` (RW) |

Shader: `shaders/gs_compose.comp.spv` | Push constants: 8 bytes (`splat_count`, `dst_offset`)

---

## Graphics Descriptor Set Layouts

These are unchanged by the #396 refactor.

### Sprite Layout (`DescriptorManager::sprite_layout_`)

Source: `src/engine/descriptor.cpp:8-37`

| Binding | Type | Stage | Resource |
|---|---|---|---|
| 0 | `UNIFORM_BUFFER` | Vertex + Fragment | MVP / lighting UBO |
| 1 | `COMBINED_IMAGE_SAMPLER` | Fragment | diffuse texture |
| 2 | `COMBINED_IMAGE_SAMPLER` | Fragment | normal map |

### PostProcess Single Sampler (`pp_layout_`)

Source: `src/engine/post_process.cpp:508-523`

| Binding | Type | Stage | Resource |
|---|---|---|---|
| 0 | `COMBINED_IMAGE_SAMPLER` | Fragment | bloom pass input |

### Composite (`composite_layout_`)

Source: `src/engine/post_process.cpp:525-549`

| Binding | Type | Stage | Resource |
|---|---|---|---|
| 0 | `COMBINED_IMAGE_SAMPLER` | Fragment | offscreen color |
| 1 | `COMBINED_IMAGE_SAMPLER` | Fragment | bloom |
| 2 | `COMBINED_IMAGE_SAMPLER` | Fragment | DoF |
| 3 | `COMBINED_IMAGE_SAMPLER` | Fragment | depth |
| 4 | `UNIFORM_BUFFER` | Fragment | light glow UBO |

---

## Per-Subsystem Allocation

Before the #396 refactor a single `vkAllocateDescriptorSets` in `gs_renderer.cpp` allocated 30 sets in a fixed indexed order. That centralised allocation is gone: each subsystem now allocates its own sets from `gs_pool_` inside its `init()` method, and the renderer never refers to sets by global slot index.

| Subsystem | Sets | Breakdown |
|---|---|---|
| `GsSortSystem` | 30 | 24 depth-sort (legacy × static × dynamic, each `{hist_a, hist_b, scatter_ab, scatter_ba}`, × 2 frames) + 2 merge (per frame) + 4 preprocess (2 static + 2 dynamic, per frame) |
| `GsTileBinSystem` | 18 | 10 tile-pipeline (`tile_bin`, `tile_scan`, `tile_indirect`, `tile_ranges`, `tile_render`, × 2 frames) + 8 onesweep (`hist_a`, `hist_b`, `scatter_ab`, `scatter_ba`, × 2 frames) using *borrowed* `GsSortSystem` layouts |
| `GsPostProcessSystem` | 2 | 1 per frame in flight |
| `GsPbdSystem` | 1 | Not per-frame (PBD buffers stable across frames) |
| **Total in `gs_pool_`** | **51** | — |
| `GsRenderer` compose (separate pool) | 6 | 3 sources (VFX / PBD / particles) × 2 frames |

To trace a set from allocation to use: open the subsystem's `.cpp`, find the `vkAllocateDescriptorSets` call in `init()`, then follow the matching `write_descriptors()` and `dispatch()` to see what buffers it binds and which `vkCmdDispatch` consumes it.

---

## Constants

| Constant | Value | Location |
|---|---|---|
| `kMaxFramesInFlight` | 2 | `include/gseurat/engine/types.hpp:12` |
| `kMaxLights` | 8 | `include/gseurat/engine/types.hpp:42` |
| `kDynamicHeadroom` | 1 048 576 | `include/gseurat/engine/gs_renderer/streaming/gs_streaming_system.hpp:48` |
| `kTileSortPasses` | 4 | `include/gseurat/engine/gs_renderer/tile_bin/gs_tile_bin_system.hpp:117` |

---

## Capacity

**`gs_pool_` headroom** (current allocation vs. pool limit):

| Resource | Allocated | Pool Limit | Remaining |
|---|---|---|---|
| Sets | 51 | 236 | 185 |
| `STORAGE_BUFFER` | ~170 | 416 | ~246 |
| `STORAGE_IMAGE` | 8 | 24 | 16 |
| `UNIFORM_BUFFER` | 8 | 48 | 40 |

`STORAGE_BUFFER` is the dominant resource — sort + tile-bin allocate the bulk of it. `STORAGE_IMAGE` is bounded by per-frame `output_image` / `depth_image` views (each consumed by `tile_render` and `post_process`).

**Per-frame intermediate images.** With `kMaxFramesInFlight = 2`, a single shared `output_image_` / `depth_image_` / `processed_image_` would be written by frame N+1's compute dispatch while frame N's composite-blit is still sampling it on the GPU — there is no producer/consumer fence between adjacent in-flight frames on those images. On Apple/MoltenVK with a 3-image swapchain that race manifested as a "first-rendered configuration flashes back" ghost. Each frame now writes into its own image and binds its own descriptor set; the `Renderer` passes its `current_frame_` index through `gs_renderer_.render(cmd, frame, view, proj)` and uses the matching `output_views_[frame]` for the swapchain blit (`DescriptorManager::allocate_sprite_sets_per_frame`).

Adding a new compute pass with a typical layout (4 SSBOs + 1 UBO + 1 storage image) is well within pool limits without resizing.

---

## Frame Execution Order

`GsRenderer::render()` is a ~73-line orchestrator that invokes subsystem `dispatch()` calls in a fixed order. Each `dispatch()` may emit many `vkCmd*` calls internally — the orchestrator never sees them. The `dispatch_compose_*` passes run earlier, in `Renderer::record_gs_prepass`, before `GsRenderer::render` is called.

```
Renderer::draw_scene
 ├── Renderer::record_gs_prepass
 │     ├── GsRenderer::dispatch_compose_vfx       — gs_compose.comp
 │     ├── GsRenderer::dispatch_compose_pbd       — gs_compose.comp
 │     └── GsRenderer::dispatch_compose_particles — gs_compose.comp
 │
 └── GsRenderer::render
       ├── (if !skip_gs_compute)
       │     ├── transition_outputs_for_compute   — UNDEFINED → GENERAL on output + depth
       │     ├── clear_outputs                    — vkCmdClearColorImage on output + depth
       │     ├── GsPbdSystem::dispatch            — pbd_solver.comp
       │     ├── GsSortSystem::dispatch           — preprocess + onesweep depth-sort + merge
       │     └── GsTileBinSystem::dispatch        — tile_count → tile_scan ×3 → tile_bin
       │                                            → tile_prepare_indirect → onesweep tile-sort
       │                                            → tile_ranges → tile_render
       │
       └── GsPostProcessSystem::dispatch          — gs_post_process.comp
```

Within each subsystem's `dispatch()`:

- **`GsSortSystem::dispatch`** prepares sort buffers (static-tail fill, counts SSBO reset, dynamic sort fill with `0xFFFFFFFFu` sentinel) behind a global `TRANSFER → COMPUTE` barrier, emits the depth-sort begin timestamp, runs dynamic preprocess + Onesweep depth sort (if `dynamic_count > 0`), runs static preprocess + sort (if static is dirty), runs the merge, emits the `sort → tile` cross-system barrier, and emits the depth-sort end timestamp.
- **`GsTileBinSystem::dispatch`** runs the six tile-phase passes, borrows the Onesweep histogram/scatter pipelines from `GsSortSystem` for the tile-sort, emits the four tile-phase timestamps, and emits the final `tile → post` cross-system barrier.
- **`GsPostProcessSystem::dispatch`** emits a leading `UNDEFINED → GENERAL` transition on the per-frame `processed_image`, dispatches `gs_post_process.comp`, and emits a trailing `GENERAL → SHADER_READ_ONLY_OPTIMAL` transition (the cross-system barrier handing off to the swapchain blit's fragment shader).
- **`GsPbdSystem::dispatch`** uploads the PBD UBO, dispatches `pbd_solver.comp`, and emits the `pbd → preprocess` cross-system barrier (this system's last operation).

The graphics-stage **PostProcess** (bloom blur, composite to swapchain) runs after `GsRenderer::render` returns, inside `Renderer::draw_scene`, consuming `processed_image[frame]` via the graphics pipeline. It is independent of the GS compute path and unaffected by the #396 refactor.
