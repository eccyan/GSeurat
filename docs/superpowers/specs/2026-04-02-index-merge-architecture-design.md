# Index-Merge Architecture for Static/Dynamic Gaussian Splitting

## Problem

The current GS pipeline processes all Gaussians (terrain, props, particles, character, animations) in a single buffer. Every frame, the entire buffer is preprocessed, sorted, and rendered — even when 95%+ of the data (static terrain/props) hasn't changed. This causes:

1. **Wasted GPU work**: 200K static Gaussians re-sorted every frame even when camera is stationary
2. **Artifact coupling**: Dynamic particle updates force full re-upload, causing ghost/flicker artifacts in static content
3. **LOD interference**: Budget system decimates static and dynamic uniformly — particles compete with terrain for budget

## Solution: Index-Merge with Static/Dynamic Split

Partition Gaussians into two independent pipelines (static and dynamic), each with its own preprocess and sort passes. A GPU merge shader combines the two sorted arrays into a single depth-ordered index buffer for rendering. The render shader reads from a unified projected SSBO with zero branching.

## Architecture

### Buffer Layout

| Buffer | Size | Updated | Purpose |
|--------|------|---------|---------|
| `static_gaussian_ssbo_` | `max_static × 64 bytes` | On camera move / chunk change | Static input (terrain, props, VFX objects) |
| `dynamic_gaussian_ssbo_` | `max_dynamic × 64 bytes` | Every frame | Dynamic input (particles, character, animated regions) |
| `projected_ssbo_` | `(max_static + max_dynamic) × 48 bytes` | Mixed | Unified projected splats. `[0..max_static-1]` = static region, `[max_static..max_static+max_dynamic-1]` = dynamic region |
| `static_sort_a/b_` | `static_sort_size × 8 bytes` | On camera move | Static radix sort ping-pong |
| `dynamic_sort_a/b_` | `dynamic_sort_size × 8 bytes` | Every frame | Dynamic radix sort ping-pong |
| `static_histogram_ssbo_` | `256 × static_workgroups × 4 bytes` | On camera move | Static sort histograms |
| `dynamic_histogram_ssbo_` | `256 × dynamic_workgroups × 4 bytes` | Every frame | Dynamic sort histograms |
| `merged_sort_ssbo_` | `(max_static + max_dynamic) × 8 bytes` | Every frame | Final merged depth-sorted indices |
| `counts_ssbo_` | `12 bytes` | Every frame | `{static_visible_count, dynamic_visible_count, merged_visible_count}` |
| `bone_ssbo_` | `32 × 64 bytes` | Every frame | Bone transforms (unchanged) |
| `uniform_buffer_` | `~512 bytes` | Every frame | View/proj/lighting (unchanged) |

### Capacity Management

```cpp
// At load time:
max_static_count_ = cloud.size() + vfx_object_headroom;
max_dynamic_count_ = kParticleHeadroom + kAnimatorHeadroom;  // 8K-16K
projected_capacity_ = max_static_count_ + max_dynamic_count_;

// Sort sizes (power-of-2 aligned):
static_sort_size_ = round_up_pow2(max_static_count_);
dynamic_sort_size_ = round_up_pow2(max_dynamic_count_);
```

### Per-Frame Command Buffer Flow

```
PHASE 1: DYNAMIC (every frame)
  1. vkCmdFillBuffer(counts_ssbo_, offset=4, size=4, value=0)  // reset dynamic_visible_count
  2. Barrier: TRANSFER_WRITE → COMPUTE_SHADER
  3. Bind dynamic_preprocess_set_, push {offset=max_static_count_, count=dynamic_count}
  4. Dispatch preprocess: (dynamic_count + 255) / 256
     - Writes projected_ssbo_[max_static_count_ + i]
     - Sort keys store global index: max_static_count_ + local_id
     - atomicAdd dynamic_visible_count for non-culled
  5. Barrier: SHADER_WRITE → SHADER_READ
  6. Radix sort dynamic_sort_a ↔ dynamic_sort_b (2 digit passes)
  7. Barrier: SHADER_WRITE → SHADER_READ

PHASE 2: STATIC (only when static_dirty_)
  8.  vkCmdFillBuffer(counts_ssbo_, offset=0, size=4, value=0)  // reset static_visible_count
  9.  Barrier: TRANSFER_WRITE → COMPUTE_SHADER
  10. Bind static_preprocess_set_, push {offset=0, count=static_count}
  11. Dispatch preprocess: (static_count + 255) / 256
      - Writes projected_ssbo_[i]
      - Sort keys store global index: local_id
      - atomicAdd static_visible_count for non-culled
  12. Barrier: SHADER_WRITE → SHADER_READ
  13. Radix sort static_sort_a ↔ static_sort_b (2 digit passes)
  14. Barrier: SHADER_WRITE → SHADER_READ
  15. static_dirty_ = false

PHASE 3: MERGE (every frame)
  16. Bind merge_set_ with final static sort buf + final dynamic sort buf + counts_ssbo_
  17. Dispatch merge: (max_static + max_dynamic + 255) / 256
      - Thread 0 writes merged_visible_count = static_count + dynamic_count
      - Each thread: binary search merge path → write merged_sort_ssbo_[tid]
  18. Barrier: SHADER_WRITE → SHADER_READ

PHASE 4: RENDER (every frame, unchanged logic)
  19. Bind render_set_ with projected_ssbo_ (unified) + merged_sort_ssbo_ + counts_ssbo_
  20. Dispatch tile rasterizer: ((w+15)/16, (h+15)/16, 1)
      - Loop bound: merged_visible_count (from counts_ssbo_)
      - Index: projected[merged_sort[i].index] — zero branching
  21. Barrier: SHADER_WRITE → SHADER_READ

PHASE 5: POST-PROCESS (unchanged)
  22. Post-process pass
  23. Image layout transition → SHADER_READ_ONLY for blit
```

### Preprocess Shader Changes

The existing `gs_preprocess.comp` gains a push constant for the projected SSBO write offset:

```glsl
layout(push_constant) uniform PushConstants {
    uint projected_offset;  // 0 for static, max_static_count for dynamic
    uint gaussian_count;
};

void main() {
    uint gid = gl_GlobalInvocationID.x;
    if (gid >= gaussian_count) return;

    // ... existing projection, frustum cull, bone skinning, effects ...

    // Write to offset region of unified projected SSBO
    projected[projected_offset + gid] = splat;

    // Sort key uses global index for unified lookup in render
    sort_entries[gid] = SortEntry(depth_key, projected_offset + gid);
}
```

### Merge Shader (NEW: `gs_merge.comp`)

Binary search merge path algorithm. Each thread writes one entry in the merged output.

```glsl
#version 450
layout(local_size_x = 256) in;

struct SortEntry { uint key; uint index; };

layout(binding = 0) readonly buffer StaticSort  { SortEntry static_entries[]; };
layout(binding = 1) readonly buffer DynamicSort { SortEntry dynamic_entries[]; };
layout(binding = 2) writeonly buffer MergedSort { SortEntry merged_entries[]; };
layout(binding = 3) buffer Counts {
    uint static_count;
    uint dynamic_count;
    uint merged_visible_count;
};

void main() {
    uint tid = gl_GlobalInvocationID.x;

    // Thread 0 computes total for render shader
    if (tid == 0) {
        merged_visible_count = static_count + dynamic_count;
    }

    uint total = static_count + dynamic_count;
    if (tid >= total) return;

    // Merge path: binary search for partition point
    uint lo = (tid > dynamic_count) ? (tid - dynamic_count) : 0;
    uint hi = min(tid, static_count);

    while (lo < hi) {
        uint mid = (lo + hi) / 2;
        uint d_idx = tid - mid;
        // Ascending sort (near→far). Stable: static wins on equal depth.
        if (d_idx > 0 && static_entries[mid].key <= dynamic_entries[d_idx - 1].key) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }

    uint s_idx = lo;
    uint d_idx = tid - s_idx;

    if (s_idx < static_count &&
        (d_idx >= dynamic_count || static_entries[s_idx].key <= dynamic_entries[d_idx].key)) {
        merged_entries[tid] = static_entries[s_idx];
    } else {
        merged_entries[tid] = dynamic_entries[d_idx];
    }
}
```

### Render Shader Changes

Minimal — swap buffer sources:

```glsl
// Before:
uint idx = sort_entries[s].index;
// After:
uint idx = merged_entries[s].index;  // global index into unified projected SSBO

// Loop bound:
// Before: visible_count
// After: merged_visible_count (from counts_ssbo_)
```

### Radix Sort Shaders

No changes. The existing histogram/scan/scatter shaders are reused with different descriptor sets for static vs dynamic buffers. Ping-pong state (which buffer holds the final result) is tracked on the CPU:

```cpp
// After sort dispatch:
// Even number of digit passes → result in buffer A
// Odd number → result in buffer B
bool static_result_in_a_ = (num_sort_passes_ % 2 == 0);
bool dynamic_result_in_a_ = (num_sort_passes_ % 2 == 0);
```

The merge descriptor set binds whichever buffer holds the final result.

### CPU-Side Data Flow

#### Static Path (on camera dirty)

```cpp
// In Renderer::record_gs_prepass():
if (static_dirty_) {
    // Gather from chunk grid (with LOD if enabled)
    if (flags.gs_lod && gs_gaussian_budget_ > 0) {
        gs_chunk_grid_.gather_lod(visible, cam_pos, budget, static_buffer_);
    } else {
        gs_chunk_grid_.gather(visible, static_buffer_);
    }

    // Append VFX object PLY geometry
    for (auto& inst : vfx_instances_) {
        inst.append_objects(static_buffer_);
    }

    // Upload to static SSBO
    gs_renderer_.update_static_gaussians(static_buffer_.data(),
                                          static_cast<uint32_t>(static_buffer_.size()));
}
```

#### Dynamic Path (every frame)

```cpp
dynamic_buffer_.clear();

// Particles
if (flags.particles) {
    for (auto& emitter : gs_particle_emitters_) {
        emitter.update(dt);
        emitter.gather(dynamic_buffer_);
    }
}

// Character bone-skinned Gaussians (already have bone_index set)
// These are appended to dynamic since they transform every frame

// VFX animated regions (copied from static on tag start)
// Animator transforms apply to copies in dynamic_buffer_

// Upload to dynamic SSBO
gs_renderer_.update_dynamic_gaussians(dynamic_buffer_.data(),
                                       static_cast<uint32_t>(dynamic_buffer_.size()));
```

#### Camera Dirty Detection

```cpp
bool camera_dirty = (gs_view_ != gs_prev_view_)
                 || budget_changed
                 || static_force_dirty_;
if (camera_dirty) {
    gs_prev_view_ = gs_view_;
    static_dirty_ = true;
}
```

#### Animator State Transitions

When animation tags a region of static Gaussians:

1. **Start frame**: Copy tagged Gaussians from `static_buffer_` to `dynamic_buffer_`. Set opacity=0 (preprocess will cull) at original positions in `static_buffer_`. Set `static_force_dirty_ = true`. Static rebuilds once.

2. **During animation**: Only `dynamic_buffer_` updates each frame. Animator transforms apply to the dynamic copies. Phase 2 skipped (static cached).

3. **End frame**: Next `gather_lod` naturally rebuilds `static_buffer_` with original data. Set `static_force_dirty_ = true`. Static rebuilds once.

### Descriptor Sets & Pipeline Objects

**Compute pipelines (7 total):**

| Pipeline | Shader | Notes |
|----------|--------|-------|
| `preprocess_pipeline_` | `gs_preprocess.comp` | Reused for static & dynamic (different descriptor set + push constants) |
| `radix_histogram_pipeline_` | `gs_radix_histogram.comp` | Reused for static & dynamic |
| `radix_scan_pipeline_` | `gs_radix_scan.comp` | Reused for static & dynamic |
| `radix_scatter_pipeline_` | `gs_radix_scatter.comp` | Reused for static & dynamic |
| `merge_pipeline_` | `gs_merge.comp` | **NEW** |
| `render_pipeline_` | `gs_render.comp` | Modified descriptor layout |
| `post_process_pipeline_` | `gs_post_process.comp` | Unchanged |

Preprocess/sort pipelines are reused by binding different descriptor sets. No duplicate pipeline objects needed.

### Edge Cases

1. **Zero dynamic Gaussians**: Skip Phase 1 and Phase 3. Bind static sort buffer directly as render input. Render loop bound = `static_visible_count`.

2. **Zero static Gaussians**: Skip Phase 2 and Phase 3. Bind dynamic sort buffer directly as render input. Render loop bound = `dynamic_visible_count`.

3. **Dynamic buffer overflow**: Clamp to `max_dynamic_count_`, log warning.

4. **Hybrid render interval** (future): Can be re-enabled per-layer. Static could use interval=4 with cached blit offset, dynamic always interval=1. Not implemented in this phase — both layers render every frame.

## Files to Create

| File | Purpose |
|------|---------|
| `shaders/gs_merge.comp` | Merge path binary search shader |

## Files to Modify

| File | Changes |
|------|---------|
| `include/gseurat/engine/gs_renderer.hpp` | Add static/dynamic buffer members, merge pipeline, new descriptor sets, `update_static_gaussians()` / `update_dynamic_gaussians()` APIs |
| `src/engine/gs_renderer.cpp` | Buffer allocation split, descriptor set creation, command buffer recording with 4-phase flow, push constants for preprocess offset |
| `shaders/gs_preprocess.comp` | Add push constant for `projected_offset` and `gaussian_count` |
| `shaders/gs_render.comp` | Read from `merged_sort_ssbo_` and `counts_ssbo_` instead of `sort_keys_ssbo_` and `visible_count_ssbo_` |
| `include/gseurat/engine/renderer.hpp` | Add `static_buffer_`, `dynamic_buffer_`, `static_dirty_`, `static_force_dirty_`, replace `gs_active_buffer_` / `gs_scene_buffer_` |
| `src/engine/renderer.cpp` | Split CPU-side data flow into static/dynamic paths, animator state transition logic |
| `shaders/CMakeLists.txt` | Add `gs_merge.comp` to shader compilation |
| `CMakeLists.txt` | No changes needed (no new .cpp files, just modified existing) |

## Verification

1. **Build**: `cmake --build --preset macos-debug` compiles with no errors
2. **Static-only rendering**: Disable particles/animation — scene renders identically to current
3. **Dynamic particles**: Enable particles — particles render correctly depth-sorted with static terrain
4. **Camera still optimization**: Confirm Phase 2 skipped when camera stationary (log or debug HUD counter)
5. **Animator transitions**: Trigger scene animation — tagged Gaussians move to dynamic, animate, return to static cleanly
6. **No flickering**: Static content stable when camera still, no Z-fighting at depth ties
7. **Performance**: Measure FPS improvement with camera stationary (expect significant gain from skipping static sort of 100-200K Gaussians)
