# Onesweep Tile Sort — Technical Specification

**Goal:** Replace the 8-pass radix sort (38 barriers, 27 dispatches) with a 4-pass Onesweep radix sort (10 barriers, 7 dispatches) for tile binning, making it viable on Apple Silicon TBDR.

**Scope:** New `gs_onesweep.comp` shader, modified `gs_tile_bin.comp`, modified `gs_tile_ranges.comp` and `gs_tile_render.comp` for 8-byte entries, C++ dispatch changes in `gs_renderer.cpp`.

---

## 1. Data Structures

### 1.1 TileSortEntry (8 bytes, down from 16)

```glsl
struct TileSortEntry {
    uint key;    // bits [31:16] = tile_id, bits [15:0] = depth_q (linear uint16)
    uint index;  // index into projected[] buffer
};
```

**Key packing:**
- `tile_id` = `ty * tiles_x + tx` (max 65,535 tiles = 4096×4096 @ 16px)
- `depth_q` = linear quantization of view-space depth to [0, 65535]

```glsl
float t = clamp((depth - near_z) / (far_z - near_z), 0.0, 1.0);
uint depth_q = min(uint(t * 65535.0), 0xFFFEu);  // 0xFFFF reserved for sentinel
uint key = (tile_id << 16) | depth_q;
```

**Sentinel value:** `key = 0xFFFFFFFF` (tile_id=0xFFFF, depth=0xFFFF). Buffer is filled with this before tile binning. Sort pushes sentinels to the end.

### 1.2 Onesweep Status Buffer

One `uint` per workgroup per pass. Encodes a two-phase state machine:

```
bits [31:30] = state
  00 = NOT_READY  (workgroup hasn't processed this pass yet)
  01 = LOCAL      (local histogram sum available, predecessors not yet included)
  11 = INCLUSIVE  (full inclusive prefix sum available)
bits [29:0]  = sum value (max 1,073,741,823 — far exceeds 512K entry capacity)
```

**Buffer size:** `4 passes × 256 bins × max_workgroups × sizeof(uint32)`. At 512K entries / 2048 per WG = 256 workgroups → 4 × 256 × 256 × 4 = 1MB. Each digit bin in each workgroup has its own status entry, enabling per-digit lookback without inter-digit synchronization.

### 1.3 GsUniforms Extension

Add `tile_sort_params` to the existing `GsUniforms` struct (CPU-side and all shader UBO declarations):

```cpp
glm::vec4 tile_sort_params;  // x = near_z, y = far_z, z = tiles_x, w = tiles_y
```

**CPU extraction from projection matrix (Vulkan [0,1] clip depth):**

```cpp
float near_z = proj[3][2] / proj[2][2];
float far_z  = proj[3][2] / (proj[2][2] + 1.0f);
uniforms.tile_sort_params = glm::vec4(near_z, far_z,
    float(tiles_x), float(tiles_y));
```

This replaces the `tiles_x`/`tiles_y` push constants in `gs_tile_bin.comp`.

---

## 2. Onesweep Shader Design

### 2.1 Overview

A single shader (`gs_onesweep.comp`) performs histogram + lookback prefix sum + scatter in one dispatch per pass. No separate histogram, scan, or scatter dispatches.

**Workgroup configuration:**
- 256 threads
- 2048 entries per workgroup (8 per thread)
- Shared memory: ~19KB

### 2.2 Shared Memory Layout

```glsl
shared uint s_local_histogram[256];   // 1KB  — per-digit count for this WG
shared uint s_keys[2048];             // 8KB  — loaded sort keys (for re-read during scatter)
shared uint s_indices[2048];          // 8KB  — loaded indices
shared uint s_prefix[256];            // 1KB  — exclusive prefix of local histogram (scatter offsets)
shared uint s_digit_count[256];       // 1KB  — batch digit count for stable rank advancement
// Total: 19KB
```

### 2.3 Algorithm (per pass)

```
Phase 1: Load & Histogram
  - Each thread loads 8 entries from global input into shared s_keys[] / s_indices[]
  - Extract 8-bit digit: (key >> (pass * 8)) & 0xFF
  - atomicAdd to s_local_histogram[digit]
  - barrier()

Phase 2: Publish local histogram & lookback
  - Thread 0..255 each owns one digit bin
  - Store local_histogram[tid] to global status buffer with LOCAL flag
  - memoryBarrierBuffer()
  - Lookback: walk predecessors to compute inclusive prefix
  - Store inclusive prefix to global status buffer with INCLUSIVE flag
  - memoryBarrierBuffer()
  - Compute s_prefix[tid] = inclusive - local_histogram[tid]  (exclusive prefix)
  - barrier()

Phase 3: Scatter
  - Process entries in batches of 256 (8 batches for 2048 entries)
  - Per batch:
    a. Each thread extracts digit from s_keys[batch_offset + tid]
    b. Compute stable rank via shared-memory sequential scan:
       rank = count of threads j < tid in this batch with same digit
    c. Write to output[s_prefix[digit] + rank]
    d. Advance s_prefix[digit] by batch digit count
  - barrier() between batches
```

### 2.4 Lookback Protocol (Phase 2 detail)

```glsl
layout(set = 0, binding = N, std430) coherent buffer StatusBuffer {
    uint status[];  // [pass * max_workgroups + wg_id]
};

// --- Publishing (thread tid, workgroup wg_id) ---
// Only thread tid < 256 participates (one per digit bin)
uint local_sum = s_local_histogram[tid];

// Publish partial (LOCAL) — predecessor workgroups can start accumulating
uint status_idx = pass * max_workgroups + wg_id;
// Pack for per-digit publishing: each WG publishes 256 separate digit statuses
// Actually: we publish the TOTAL count for this workgroup, not per-digit.
// The standard Onesweep publishes per-digit, but for 8-bit radix with 256 bins,
// each thread publishes its own digit's status independently.

// Per-digit status buffer: status[pass * 256 * max_workgroups + digit * max_workgroups + wg_id]
uint digit_status_idx = pass * 256u * max_workgroups + tid * max_workgroups + wg_id;

atomicExchange(status[digit_status_idx], (1u << 30) | local_sum);
memoryBarrierBuffer();

// --- Lookback (thread tid looks back for digit tid) ---
uint aggregate = 0u;
int pred = int(wg_id) - 1;
while (pred >= 0) {
    uint val;
    // Spin-read: must use atomic to bypass cache on Apple Silicon
    do {
        memoryBarrierBuffer();
        val = atomicOr(status[pass * 256u * max_workgroups + tid * max_workgroups + uint(pred)], 0u);
    } while ((val >> 30u) == 0u);  // NOT_READY — spin

    uint state = val >> 30u;
    uint sum   = val & 0x3FFFFFFFu;
    aggregate += sum;

    if (state == 3u) break;  // INCLUSIVE — includes all prior WGs
    pred--;
}

// Publish inclusive
uint inclusive = aggregate + local_sum;
atomicExchange(status[digit_status_idx], (3u << 30) | inclusive);
memoryBarrierBuffer();

// Exclusive prefix for this digit in this workgroup
s_prefix[tid] = aggregate;
barrier();
```

### 2.5 Stable Scatter (Phase 3 detail)

Preserves insertion order for entries with the same digit — critical for depth-sorted Gaussians within each tile.

```glsl
for (uint batch = 0; batch < 8; batch++) {
    uint base = batch * 256u;
    uint my_key = s_keys[base + tid];
    uint my_idx = s_indices[base + tid];
    uint digit = (my_key >> (pass * 8u)) & 0xFFu;

    // Store digit for sequential rank scan
    s_digits[tid] = digit;  // reuse shared memory (overlay on unused region)
    barrier();

    // Stable rank: count how many threads before me in this batch have same digit
    uint rank = 0u;
    for (uint j = 0u; j < tid; j++) {
        if (s_digits[j] == digit) rank++;
    }

    // Scatter to output
    uint dst = s_prefix[digit] + rank;
    out_keys[dst] = my_key;
    out_indices[dst] = my_idx;

    // Advance prefix for next batch
    barrier();
    // Count entries per digit in this batch
    s_digit_count[tid] = 0u;
    barrier();
    atomicAdd(s_digit_count[digit], 1u);
    barrier();
    s_prefix[tid] += s_digit_count[tid];
    barrier();
}
```

### 2.6 Push Constants

```glsl
layout(push_constant) uniform PushConstants {
    uint pass;           // 0..3
    uint max_workgroups; // ceil(entry_count / 2048)
    uint entry_count;    // actual number of tile sort entries
};
```

---

## 3. Modified Shaders

### 3.1 gs_tile_bin.comp Changes

- `TileSortEntry` struct changes from 16 bytes to 8 bytes (remove `key_hi`, `key_lo`, `_pad`; add packed `key`)
- Depth quantization uses `tile_sort_params.xy` (near_z, far_z) from UBO instead of raw `floatBitsToUint`
- `tiles_x`, `tiles_y` read from UBO `tile_sort_params.zw` instead of push constants
- Push constants reduce to just `max_entries`

```glsl
// New key packing
float t = clamp((splat.depth - tile_sort_params.x) / (tile_sort_params.y - tile_sort_params.x), 0.0, 1.0);
uint depth_q = min(uint(t * 65535.0), 0xFFFEu);
uint key = (tile_id << 16u) | depth_q;
tile_entries[offset].key = key;
tile_entries[offset].index = idx;
```

### 3.2 gs_tile_ranges.comp Changes

- `TileSortEntry` struct updated to 8-byte format
- Tile ID extraction: `uint tile_id = entries[i].key >> 16u;` (was `entries[i].key_hi`)
- Sentinel check: `if (tile_id == 0xFFFFu) return;` (was `>= num_tiles`)
- Boundary detection unchanged (compare adjacent `key >> 16`)

### 3.3 gs_tile_render.comp Changes

- `TileSortEntry` struct updated to 8-byte format
- Sentinel check: `if (entry.key == 0xFFFFFFFFu) break;` (was `entry.key_hi == 0xFFFFFFFFu`)
- Index access: `uint idx = entry.index;` (unchanged)

### 3.4 UBO Changes (all GS shaders)

Add `tile_sort_params` vec4 to the Uniforms block in:
- `gs_preprocess.comp`
- `gs_tile_bin.comp`
- `gs_tile_render.comp`
- `gs_render.comp`
- `gs_onesweep.comp` (new)

Must match C++ struct order. Place after `pl_area[8]` (last current field).

---

## 4. C++ Changes

### 4.1 GsUniforms Struct (`gs_renderer.cpp`)

```cpp
// Add after pl_area[kMaxGsPointLights]:
glm::vec4 tile_sort_params;  // x = near_z, y = far_z, z = tiles_x, w = tiles_y
```

### 4.2 Buffer Allocation Changes

**Tile sort buffers shrink by half (8 bytes/entry):**

```cpp
// Was: entry_buf_size = tile_sort_size_ * 16
VkDeviceSize entry_buf_size = static_cast<VkDeviceSize>(tile_sort_size_) * 8;
tile_sort_a_ = Buffer::create_storage_gpu_only(allocator_, entry_buf_size);
tile_sort_b_ = Buffer::create_storage_gpu_only(allocator_, entry_buf_size);
```

**New: Onesweep status buffer (per-digit lookback):**

```cpp
// 4 passes × 256 digit bins × max_workgroups
uint32_t onesweep_max_wg = (tile_sort_capacity_ + 2047) / 2048;
VkDeviceSize status_size = 4ull * 256ull * onesweep_max_wg * sizeof(uint32_t);
// At 256 WGs: 4 × 256 × 256 × 4 = 1MB
onesweep_status_ = Buffer::create_storage_gpu_only(allocator_, status_size);
```

### 4.3 New Compute Pipeline

Create `onesweep_pipeline_` and `onesweep_layout_` with:
- Descriptor set layout matching the Onesweep shader bindings
- Push constant range: 12 bytes (pass, max_workgroups, entry_count)

### 4.4 dispatch_tile_sort Replacement

The new dispatch sequence replaces the entire 8-pass radix section:

```cpp
void GsRenderer::dispatch_tile_sort(VkCommandBuffer cmd) {
    if (!tile_binning_enabled_ || !tile_sort_a_.buffer() || tile_sort_capacity_ == 0) return;

    uint32_t tiles_x = (output_width_ + 15) / 16;
    uint32_t tiles_y = (output_height_ + 15) / 16;

    // 1. Fill sentinels (1 barrier)
    vkCmdFillBuffer(cmd, tile_sort_a_.buffer(), 0, tile_sort_size_ * 8, 0xFFFFFFFF);
    insert_transfer_to_compute_barrier(cmd);

    // 2. Tile binning (1 barrier)
    // ... bind tile_bin_pipeline_, push max_entries, dispatch ...
    insert_compute_barrier(cmd);

    // 3. Prepare indirect args (1 barrier)
    // ... bind, dispatch(1,1,1) ...
    insert_indirect_barrier(cmd);

    // 4. Clear onesweep status buffer
    vkCmdFillBuffer(cmd, onesweep_status_.buffer(), 0, status_buf_size, 0);
    insert_transfer_to_compute_barrier(cmd);

    // 5. Onesweep: 4 passes (1 barrier each)
    for (uint32_t pass = 0; pass < 4; pass++) {
        uint32_t push[3] = {pass, onesweep_wg_count, tile_sort_count};
        vkCmdPushConstants(cmd, onesweep_layout_, VK_SHADER_STAGE_COMPUTE_BIT, 0, 12, push);

        // Ping-pong: even passes read A write B, odd read B write A
        VkDescriptorSet set = (pass % 2 == 0) ? onesweep_set_ab_ : onesweep_set_ba_;
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                onesweep_layout_, 0, 1, &set, 0, nullptr);
        vkCmdDispatchIndirect(cmd, tile_indirect_args_.buffer(), 0);
        insert_compute_barrier(cmd);
    }

    // 6. Tile ranges (2 barriers: fill + dispatch)
    // ... fill tile_ranges with 0, barrier, dispatch, barrier ...
}
```

**Final barrier count: 4 (sentinel fill) + 1 (bin) + 1 (indirect) + 1 (status clear) + 4 (onesweep passes) + 2 (ranges) = 13 barriers.**

Note: The status clear adds 1 extra barrier vs the initial estimate of 9. We can eliminate it by clearing the status buffer at the end of each frame (overlapped with rendering) or by using the pass index to distinguish stale data.

**Optimization — eliminate status clear:** Embed a `frame_id` in status entries. Each pass checks `frame_id` matches before treating status as valid. Stale entries from previous frames read as NOT_READY. This saves 1 barrier → **12 barriers total**.

### 4.5 Descriptor Set Layout for Onesweep

```
binding 0: input TileSortEntry[] (readonly)  — ping buffer
binding 1: output TileSortEntry[] (writeonly) — pong buffer
binding 2: StatusBuffer (coherent)            — onesweep lookback
binding 3: IndirectArgs (readonly)            — entry count
```

Ping-pong: two descriptor sets (AB and BA) as done for current histogram/scatter.

---

## 5. Pipeline Summary

### Before (38 barriers, 27 dispatches)

```
fill → bin → indirect → [histogram → scan → scatter] × 8 → fill_ranges → ranges
```

### After (12 barriers, 8 dispatches)

```
fill → bin → indirect → clear_status → onesweep×4 → fill_ranges → ranges
```

### Barrier Breakdown

| Phase | Barriers | Dispatches |
|-------|----------|------------|
| Fill sentinels | 1 | 0 |
| Tile bin | 1 | 1 |
| Prepare indirect | 1 | 1 |
| Clear status | 1 | 0 |
| Onesweep × 4 | 4 | 4 |
| Fill ranges | 1 | 0 |
| Tile ranges | 1 | 1 |
| **Total** | **10** | **7** |

(Corrected to 10 with the status clear; reducible to 9 with frame_id optimization.)

---

## 6. Deleted Shaders & Pipelines

After Onesweep is stable and verified on both AMD and Apple Silicon:

- Delete: `gs_tile_histogram.comp`, `gs_tile_scatter.comp`, `gs_radix_scan.comp`
- Delete: `tile_histogram_pipeline_`, `radix_scan_pipeline_`, `tile_scatter_pipeline_`
- Delete: `tile_histogram_set_a/b_`, `tile_scatter_set_ab/ba_`, `tile_scan_set_`
- Delete: `tile_histogram_ssbo_` buffer
- Keep: `gs_tile_prepare_indirect.comp` (still needed for indirect dispatch args)

During development, keep the old path behind a `use_onesweep_` bool for A/B comparison.

---

## 7. Testing Strategy

### 7.1 Unit Tests (CPU)

- Test key packing: `pack_tile_sort_key(tile_id, depth, near, far)` round-trips correctly
- Test near/far extraction from known projection matrices
- Test status buffer encoding/decoding: LOCAL and INCLUSIVE states

### 7.2 GPU Validation

- Compare sorted output of Onesweep vs old 8-pass radix on identical input
- Verify stable sort: entries with same tile_id preserve depth order
- Verify tile_ranges match expected values after sort

### 7.3 Visual Regression

- Game Director screenshot comparison: island demo before/after Onesweep
- Verify no alpha blending artifacts (incorrect sort order would cause visible popping)

### 7.4 Performance

- GPU timestamp profiling (existing infrastructure): compare rasterize pass time
- Target: <3ms on Apple Silicon (was ~18ms), <=0.7ms on AMD (parity with current)

---

## 8. Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Lookback deadlock on Apple | `memoryBarrierBuffer()` + `coherent` qualifier; add timeout counter (1M iterations) that falls back to old sort |
| Lookback spin-wait wastes GPU cycles | Expected: <10 iterations average for 256 WGs; degenerate case is 256 sequential WGs which still completes in microseconds |
| 16-bit depth quantization artifacts | 65K levels across depth range is sufficient for alpha blending; if artifacts appear, can widen to 20-bit depth / 12-bit tile_id |
| Shared memory pressure (19KB) | Well under 32KB limit; verified on Apple Silicon |
| Old sort regression on AMD | Keep `use_onesweep_` toggle; default true on both platforms; fall back if perf regresses |
