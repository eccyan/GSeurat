# GPU Compute Pipeline

Vulkan descriptor pools, set layouts, and compute shaders used by GSeurat's
Gaussian Splatting renderer.

## Descriptor Pools

GSeurat allocates four independent descriptor pools, each owned by a different
subsystem.

### GS Renderer (`gs_pool_`)

Source: `src/engine/gs_renderer.cpp:233-249`

| Descriptor Type | Count |
|---|---|
| `STORAGE_BUFFER` | 256 |
| `STORAGE_IMAGE` | 24 |
| `UNIFORM_BUFFER` | 32 |
| **Max Sets** | **128** |

Currently allocates **30 sets** (see [Set Allocation](#set-allocation) below).
98 sets remain available.

### Sprites / Graphics (`DescriptorManager`)

Source: `src/engine/descriptor.cpp:39-55`

| Descriptor Type | Count |
|---|---|
| `UNIFORM_BUFFER` | 32 (`kMaxFramesInFlight * 16`) |
| `COMBINED_IMAGE_SAMPLER` | 64 (`kMaxFramesInFlight * 32`) |
| **Max Sets** | **32** |
| **Flags** | `FREE_DESCRIPTOR_SET_BIT` |

Single layout with 3 bindings (UBO + texture sampler + normal map), used for
sprite rendering.

### PostProcess (`pp_pool_`)

Source: `src/engine/post_process.cpp:541-558`

| Descriptor Type | Count |
|---|---|
| `COMBINED_IMAGE_SAMPLER` | 10 |
| `UNIFORM_BUFFER` | 1 |
| **Max Sets** | **6** |

Allocates 5 sets: 4 single-sampler (offscreen, bloom_a, bloom_b, dof_a) + 1
composite (4 samplers + light glow UBO).

### ImGui / DevOverlay (`imgui_pool_`)

Source: `src/engine/dev_overlay.cpp:19-28`

| Descriptor Type | Count |
|---|---|
| `COMBINED_IMAGE_SAMPLER` | 100 |
| **Max Sets** | **100** |
| **Flags** | `FREE_DESCRIPTOR_SET_BIT` |

---

## Compute Descriptor Set Layouts

All compute layouts live in `src/engine/gs_renderer.cpp:251-433`. Every binding
uses `VK_SHADER_STAGE_COMPUTE_BIT`.

### Preprocess (`preprocess_layout_`)

Frustum culling and 2D projection of Gaussian splats.

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

Shader: `gs_preprocess.comp` | Push constants: `GsPreprocessPush`

### Sort (`sort_layout_`) — Legacy

| Binding | Type | Resource |
|---|---|---|
| 0 | `STORAGE_BUFFER` | sort keys |
| 1 | `UNIFORM_BUFFER` | uniforms |

Shader: `gs_sort.comp` | Push constants: 8 bytes

### Render (`render_layout_`)

Full-screen Gaussian rasterization (non-tiled path). Allocated per-frame as `render_sets_[kMaxFramesInFlight]` — each frame's set binds the frame's matching `output_image[frame]` / `depth_image[frame]`.

| Binding | Type | Resource |
|---|---|---|
| 0 | `STORAGE_BUFFER` | projected |
| 1 | `STORAGE_BUFFER` | sort_keys |
| 2 | `UNIFORM_BUFFER` | uniforms |
| 3 | `STORAGE_IMAGE` | output_image (per frame) |
| 4 | `STORAGE_BUFFER` | visible_count |
| 5 | `STORAGE_IMAGE` | depth_image (per frame) |

Shader: `gs_render.comp`

### Post-Process (`post_process_layout_`)

Fog, tone mapping, vignette, bloom, DoF, chromatic aberration. Allocated per-frame as `post_process_sets_[kMaxFramesInFlight]` — each frame's set reads / writes the frame's matching images.

| Binding | Type | Resource |
|---|---|---|
| 0 | `STORAGE_IMAGE` | input (readonly, per frame = output_image[frame]) |
| 1 | `STORAGE_IMAGE` | depth (readonly, per frame = depth_image[frame]) |
| 2 | `STORAGE_IMAGE` | output (writeonly, per frame = processed_image[frame]) |
| 3 | `UNIFORM_BUFFER` | UBO |

Shader: `gs_post_process.comp`

### Merge (`merge_layout_`)

Merges static and dynamic sort key buffers after independent radix sorts.

| Binding | Type | Resource |
|---|---|---|
| 0 | `STORAGE_BUFFER` | static_sort |
| 1 | `STORAGE_BUFFER` | dynamic_sort |
| 2 | `STORAGE_BUFFER` | merged_sort |
| 3 | `STORAGE_BUFFER` | counts |

Shader: `gs_merge.comp`

### Tile Binning (`tile_bin_layout_`)

Assigns projected splats to screen-space tiles. Implemented as a deterministic
3-pass count → exclusive-scan → scatter pipeline rather than a single-pass
`atomicAdd`, so the entry order in `tile_sort_a_` is bit-stable across frames
with identical input. Two compute pipelines share this layout (count uses
bindings 0-3, 6; scatter uses 0-2, 4-6).

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
- `gs_tile_count.comp` — pass 1, writes per-splat tile-overlap count.
- `gs_tile_bin.comp` — pass 3 (scatter), reads precomputed offsets and writes `TileSortEntry` blocks. Push constants: 4 bytes (`max_entries`).

### Tile Scan (`tile_scan_layout_`)

Three-dispatch hierarchical exclusive prefix-sum over `per_splat_tile_count[]`,
producing the deterministic write offsets the scatter consumes. Single shader
dispatched 3× via the `pass` push constant: pass 0 = local 256-element scan +
write block sums, pass 1 = single-workgroup chunked scan over block sums (also
writes the grand total to `tile_sort_count`), pass 2 = add scanned base back
to per-splat offsets.

| Binding | Type | Resource |
|---|---|---|
| 0 | `STORAGE_BUFFER` | per_splat_tile_count (input) |
| 1 | `STORAGE_BUFFER` | per_splat_tile_offset (output) |
| 2 | `STORAGE_BUFFER` | scan_block_sums (intermediate) |
| 3 | `STORAGE_BUFFER` | tile_sort_count (pass 1 writes total) |

Shader: `gs_tile_scan.comp` | Push constants: 12 bytes (`pass`, `num_elements`, `num_blocks`)

Capacity: pass 1's chunked scan supports up to 256 × 256 = 65 536 blocks → 16.7 M visible splats, well above `tile_sort_capacity_`'s 2 M cap.

Headless GPU correctness coverage: `tests/test_tile_scan_gpu.cpp` (8 cases including 262 K-element multi-chunk).

### Tile Range Detection (`tile_ranges_layout_`)

Detects per-tile start/end ranges in the sorted tile entry buffer.

| Binding | Type | Resource |
|---|---|---|
| 0 | `STORAGE_BUFFER` | sorted_entries |
| 1 | `STORAGE_BUFFER` | tile_ranges |
| 2 | `STORAGE_BUFFER` | tile_count |

Shader: `gs_tile_ranges.comp` | Push constants: 8 bytes (num_tiles + max_entries)

### Tile Indirect Dispatch (`tile_indirect_layout_`)

Prepares `VkDispatchIndirectCommand` from tile sort count.

| Binding | Type | Resource |
|---|---|---|
| 0 | `STORAGE_BUFFER` | tile_sort_count |
| 1 | `STORAGE_BUFFER` | indirect_args |

Shader: `gs_tile_prepare_indirect.comp` | Push constants: 4 bytes (max_entries)

### Tile Render (`tile_render_layout_`)

Per-tile Gaussian rasterization (production path, ~3x faster than full-screen). Allocated per-frame as `tile_render_sets_[kMaxFramesInFlight]` — each frame's set binds the frame's matching `output_image[frame]` / `depth_image[frame]`.

| Binding | Type | Resource |
|---|---|---|
| 0 | `STORAGE_BUFFER` | projected |
| 1 | `STORAGE_BUFFER` | tile_entries |
| 2 | `UNIFORM_BUFFER` | uniforms |
| 3 | `STORAGE_IMAGE` | output_image (per frame) |
| 4 | `STORAGE_BUFFER` | tile_ranges |
| 5 | `STORAGE_IMAGE` | depth_image (per frame) |

Shader: `gs_tile_render.comp`

### Onesweep Histogram (`onesweep_hist_layout_`)

Histogram phase of the GPU radix sort (Onesweep algorithm).

| Binding | Type | Resource |
|---|---|---|
| 0 | `STORAGE_BUFFER` | input |
| 1 | `STORAGE_BUFFER` | status (lookback) |
| 2 | `STORAGE_BUFFER` | indirect_args |

Shader: `gs_onesweep_histogram.comp` | Push constants: 4 bytes (pass)

### Onesweep Scatter (`onesweep_scatter_layout_`)

Scatter phase of the GPU radix sort — reads histogram lookback and redistributes
keys.

| Binding | Type | Resource |
|---|---|---|
| 0 | `STORAGE_BUFFER` | input |
| 1 | `STORAGE_BUFFER` | output |
| 2 | `STORAGE_BUFFER` | status (lookback) |
| 3 | `STORAGE_BUFFER` | indirect_args |

Shader: `gs_onesweep_scatter.comp` | Push constants: 4 bytes (pass)

### PBD Solver (`pbd_layout_`)

Position-Based Dynamics constraint solver for hair/cloth simulation.

| Binding | Type | Resource |
|---|---|---|
| 0 | `STORAGE_BUFFER` | pbd_states (read/write) |
| 1 | `STORAGE_BUFFER` | pbd_params (readonly) |
| 2 | `STORAGE_BUFFER` | pbd_constraints (readonly) |
| 3 | `UNIFORM_BUFFER` | pbd_uniforms |

Shader: `pbd_solver.comp` | Push constants: 4 bytes (pbd_count)

---

## Graphics Descriptor Set Layouts

### Sprite Layout (`DescriptorManager`)

Source: `src/engine/descriptor.cpp:8-37`

| Binding | Type | Stage | Resource |
|---|---|---|---|
| 0 | `UNIFORM_BUFFER` | Vertex + Fragment | MVP / lighting UBO |
| 1 | `COMBINED_IMAGE_SAMPLER` | Fragment | diffuse texture |
| 2 | `COMBINED_IMAGE_SAMPLER` | Fragment | normal map |

### PostProcess Single Sampler (`pp_layout_`)

Source: `src/engine/post_process.cpp:498-512`

| Binding | Type | Stage | Resource |
|---|---|---|---|
| 0 | `COMBINED_IMAGE_SAMPLER` | Fragment | bloom pass input |

### Composite (`composite_layout_`)

Source: `src/engine/post_process.cpp:515-538`

| Binding | Type | Stage | Resource |
|---|---|---|---|
| 0 | `COMBINED_IMAGE_SAMPLER` | Fragment | offscreen color |
| 1 | `COMBINED_IMAGE_SAMPLER` | Fragment | bloom |
| 2 | `COMBINED_IMAGE_SAMPLER` | Fragment | DoF |
| 3 | `COMBINED_IMAGE_SAMPLER` | Fragment | depth |
| 4 | `UNIFORM_BUFFER` | Fragment | light glow UBO |

---

## Set Allocation

The GS Renderer allocates all 30 sets in a single `vkAllocateDescriptorSets`
call (`gs_renderer.cpp:439-504`).

| Index | Layout | Purpose |
|---|---|---|
| 0 | preprocess | Legacy preprocess |
| 1 | sort | Legacy sort |
| 2 | render | Legacy render |
| 3 | post_process | Compute post-process |
| 4 | preprocess | Static splat preprocess |
| 5 | preprocess | Dynamic splat preprocess |
| 6 | merge | Static/dynamic merge |
| 7 | render | Merged render |
| 8 | pbd | PBD solver |
| 9 | tile_bin | Tile binning (count + scatter) |
| 10 | tile_ranges | Tile range detection |
| 11 | tile_indirect | Indirect dispatch prep |
| 12 | tile_render | Tile render |
| 13-14 | onesweep_hist | Tile sort histogram A/B |
| 15-16 | onesweep_scatter | Tile sort scatter A->B / B->A |
| 17-18 | onesweep_hist | Depth sort histogram A/B (legacy) |
| 19-20 | onesweep_scatter | Depth sort scatter (legacy) |
| 21-22 | onesweep_hist | Depth sort histogram A/B (static) |
| 23-24 | onesweep_scatter | Depth sort scatter (static) |
| 25-26 | onesweep_hist | Depth sort histogram A/B (dynamic) |
| 27-28 | onesweep_scatter | Depth sort scatter (dynamic) |
| 29 | tile_scan | Deterministic tile-bin prefix-sum |
| 30 | render | Render set (frame-in-flight 1) — paired with slot 2 |
| 31 | post_process | Post-process set (frame-in-flight 1) — paired with slot 3 |
| 32 | tile_render | Tile render set (frame-in-flight 1) — paired with slot 12 |

---

## Constants

| Constant | Value | Location |
|---|---|---|
| `kMaxFramesInFlight` | 2 | `include/gseurat/engine/types.hpp:12` |
| `kMaxLights` | 8 | `include/gseurat/engine/types.hpp:42` |
| `kMaxBones` | 32 | `include/gseurat/engine/gs_renderer.hpp:186` |
| `kParticleHeadroom` | 2048 | `include/gseurat/engine/gs_renderer.hpp:112` |
| `kDynamicHeadroom` | 8192 | `include/gseurat/engine/gs_renderer.hpp:113` |
| `kTileSortPasses` | 4 | `include/gseurat/engine/gs_renderer.hpp:444` |
| `ENTRIES_PER_WG` | 2048 | `src/engine/gs_renderer.cpp:614` |

---

## Capacity

**GS Renderer pool headroom:**

| Resource | Allocated | Pool Limit | Remaining |
|---|---|---|---|
| Sets | 33 | 160 | 127 |
| `STORAGE_BUFFER` | ~120 | 256 | ~136 |
| `STORAGE_IMAGE` | 14 | 24 | 10 |
| `UNIFORM_BUFFER` | 9 | 32 | 23 |

The set count grew from 30 to 33 when `output_image_` / `depth_image_` /
`processed_image_` were promoted to per-frame `std::array<…, kMaxFramesInFlight>`
arrays — the render, post_process, and tile_render descriptor sets that bind
those images had to follow, so each gets one set per frame in flight (slots
2, 3, 12 hold the frame-0 set; slots 30, 31, 32 hold the frame-1 set). The
storage-image count grew similarly: 3 images × 2 frames = 6, plus one extra
sampler view per frame, vs. the original 3 single shared images.

**Per-frame intermediates rationale.** With `kMaxFramesInFlight = 2`, a
single shared `output_image_` / `depth_image_` / `processed_image_` would be
written by frame N+1's compute dispatch while frame N's composite-blit is
still sampling it on the GPU — there is no producer/consumer fence between
adjacent in-flight frames on those images. On Apple/MoltenVK with a 3-image
swapchain that race manifested as a "first-rendered configuration flashes
back" ghost. Each frame now writes into its own image and binds its own
descriptor set; the `Renderer` passes its `current_frame_` index through
`gs_renderer_.render(cmd, frame, view, proj)` and uses the matching
`output_views_[frame]` for the swapchain blit (`DescriptorManager::allocate_sprite_sets_per_frame`).

Adding a new compute pass with a typical layout (4 SSBOs + 1 UBO + 1 storage
image) is well within pool limits without resizing.

---

## Frame Execution Order

Each frame dispatches compute work in this order:

1. **Preprocess** (static + dynamic) — frustum cull, project to 2D
2. **Onesweep radix sort** (4 passes per buffer) — depth-sort splats
3. **Merge** — combine static + dynamic sorted keys
4. **Tile binning** — deterministic 3-pass pipeline:
   1. **Count** (`gs_tile_count.comp`) — per-splat tile-overlap count
   2. **Scan** (`gs_tile_scan.comp`, dispatched 3×) — exclusive prefix-sum → write offsets, also writes grand total
   3. **Scatter** (`gs_tile_bin.comp`) — write `TileSortEntry` blocks at precomputed offsets
5. **Tile sort** (onesweep, 4 passes) — sort within tiles
6. **Tile range detection** — find per-tile entry ranges
7. **Tile render** — per-tile alpha-blended rasterization
8. **Post-process** (compute) — fog, tone mapping, bloom, DoF
9. **Post-process** (graphics) — bloom blur passes, composite to swapchain
10. **PBD solver** — runs when physics objects are active
