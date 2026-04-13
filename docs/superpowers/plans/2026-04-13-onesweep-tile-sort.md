# Onesweep Tile Sort Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 8-pass radix sort (38 barriers) with a 4-pass Onesweep radix sort (10 barriers) for tile binning, restoring 60 FPS on Apple Silicon TBDR GPUs.

**Architecture:** New `gs_onesweep.comp` shader performs fused histogram + decoupled-lookback prefix sum + scatter in a single dispatch per pass. `TileSortEntry` shrinks from 16 to 8 bytes with a packed 32-bit key (`tile_id[31:16] | depth_q[15:0]`). Near/far extracted from projection matrix on CPU, passed via UBO. Old sort kept behind `use_onesweep_` toggle for A/B comparison.

**Tech Stack:** C++23, Vulkan 1.1, GLSL 450, glslc (`--target-env=vulkan1.1`)

**Worktree:** `/Users/eccyan/dev/GSeurat-onesweep` (branch `perf/onesweep-tile-sort`)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `shaders/gs_onesweep.comp` | Create | Fused Onesweep sort shader |
| `shaders/gs_tile_bin.comp` | Modify | 8-byte entry, packed key, UBO near/far |
| `shaders/gs_tile_ranges.comp` | Modify | 8-byte entry, key>>16 for tile_id |
| `shaders/gs_tile_render.comp` | Modify | 8-byte entry, sentinel check |
| `shaders/gs_tile_prepare_indirect.comp` | Modify | Add Onesweep workgroup count to indirect args |
| `shaders/CMakeLists.txt` | Modify | Add gs_onesweep.comp |
| `src/engine/gs_renderer.cpp` | Modify | GsUniforms, buffers, pipelines, dispatch |
| `include/gseurat/engine/gs_renderer.hpp` | Modify | New members for Onesweep pipeline/buffers |
| `tests/test_tile_sort_key.cpp` | Create | CPU unit tests for key packing |
| `CMakeLists.txt` | Modify | Add test target |

---

### Task 1: CPU Key-Packing Utility and Tests

**Files:**
- Create: `tests/test_tile_sort_key.cpp`
- Modify: `CMakeLists.txt`

- [ ] **Step 1: Write the test**

Create `tests/test_tile_sort_key.cpp`:

```cpp
#include <cassert>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>

// Key packing logic (will be shared with shader via matching algorithm)
static uint32_t pack_tile_sort_key(uint32_t tile_id, float depth, float near_z, float far_z) {
    float t = (depth - near_z) / (far_z - near_z);
    if (t < 0.0f) t = 0.0f;
    if (t > 1.0f) t = 1.0f;
    uint32_t depth_q = static_cast<uint32_t>(t * 65535.0f);
    if (depth_q > 0xFFFEu) depth_q = 0xFFFEu;  // 0xFFFF reserved for sentinel
    return (tile_id << 16u) | depth_q;
}

static void extract_near_far(const glm::mat4& proj, float& near_z, float& far_z) {
    // Vulkan [0,1] clip depth: proj[2][2] = -far/(far-near), proj[3][2] = -(far*near)/(far-near)
    float A = proj[2][2];
    float B = proj[3][2];
    near_z = B / A;
    far_z  = B / (A + 1.0f);
}

int main() {
    // Test 1: Key packing preserves sort order
    {
        uint32_t k1 = pack_tile_sort_key(5, 10.0f, 0.1f, 1000.0f);
        uint32_t k2 = pack_tile_sort_key(5, 20.0f, 0.1f, 1000.0f);
        assert(k1 < k2);  // same tile, closer depth sorts first
    }

    // Test 2: Tile ID is primary sort key
    {
        uint32_t k1 = pack_tile_sort_key(3, 500.0f, 0.1f, 1000.0f);
        uint32_t k2 = pack_tile_sort_key(4, 1.0f, 0.1f, 1000.0f);
        assert(k1 < k2);  // tile 3 < tile 4 regardless of depth
    }

    // Test 3: Depth clamping at boundaries
    {
        uint32_t k_near = pack_tile_sort_key(0, -5.0f, 0.1f, 1000.0f);
        uint32_t k_far  = pack_tile_sort_key(0, 9999.0f, 0.1f, 1000.0f);
        assert((k_near & 0xFFFFu) == 0);       // clamped to 0
        assert((k_far & 0xFFFFu) == 0xFFFEu);  // clamped to max (0xFFFF reserved)
    }

    // Test 4: Sentinel key is maximum
    {
        uint32_t sentinel = 0xFFFFFFFFu;
        uint32_t k_max = pack_tile_sort_key(0xFFFFu - 1, 1000.0f, 0.1f, 1000.0f);
        assert(k_max < sentinel);
    }

    // Test 5: Near/far extraction from projection matrix
    {
        float near_in = 0.1f, far_in = 1000.0f;
        glm::mat4 proj = glm::perspectiveLH_ZO(glm::radians(60.0f), 1.0f, near_in, far_in);
        float near_out, far_out;
        extract_near_far(proj, near_out, far_out);
        assert(std::abs(near_out - near_in) < 0.01f);
        assert(std::abs(far_out - far_in) < 1.0f);
    }

    // Test 6: 16-bit depth has sufficient precision
    {
        // Two Gaussians 0.02 apart at depth ~10 should get different keys
        uint32_t k1 = pack_tile_sort_key(0, 10.0f, 0.1f, 1000.0f);
        uint32_t k2 = pack_tile_sort_key(0, 10.02f, 0.1f, 1000.0f);
        assert(k1 != k2);  // 0.02 / 1000 * 65535 ≈ 1.3 — should differ by at least 1
    }

    std::printf("PASS: test_tile_sort_key (6 tests)\n");
    return 0;
}
```

- [ ] **Step 2: Add test to CMakeLists.txt**

After the `add_gseurat_test(test_feature_flags)` line:

```cmake
add_gseurat_test(test_tile_sort_key)
```

- [ ] **Step 3: Build and run test**

Run: `cmake --build --preset macos-debug --target test_tile_sort_key && ctest --test-dir build/macos-debug -R test_tile_sort_key -V`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tests/test_tile_sort_key.cpp CMakeLists.txt
git commit -m "test: key packing and near/far extraction for Onesweep tile sort"
```

---

### Task 2: Extend GsUniforms with tile_sort_params

**Files:**
- Modify: `src/engine/gs_renderer.cpp:35-55` (GsUniforms struct)
- Modify: `src/engine/gs_renderer.cpp:2234-2266` (render() UBO fill)
- Modify: `shaders/gs_preprocess.comp` (Uniforms block)
- Modify: `shaders/gs_render.comp` (Uniforms block)
- Modify: `shaders/gs_tile_render.comp` (Uniforms block)

- [ ] **Step 1: Add tile_sort_params to C++ GsUniforms**

In `src/engine/gs_renderer.cpp`, add after `pl_area` (line 54):

```cpp
    glm::vec4 tile_sort_params;  // x = near_z, y = far_z, z = tiles_x, w = tiles_y
```

- [ ] **Step 2: Populate tile_sort_params in render()**

In `src/engine/gs_renderer.cpp`, in the `render()` function, after `uniforms.actor_rotation` is set (around line 2262), add:

```cpp
    // Extract near/far from Vulkan [0,1] perspective projection
    float near_z = proj[3][2] / proj[2][2];
    float far_z  = proj[3][2] / (proj[2][2] + 1.0f);
    uint32_t tiles_x = (width + 15) / 16;
    uint32_t tiles_y = (height + 15) / 16;
    uniforms.tile_sort_params = glm::vec4(near_z, far_z,
        static_cast<float>(tiles_x), static_cast<float>(tiles_y));
```

- [ ] **Step 3: Add tile_sort_params to all shader Uniforms blocks**

In each of these shaders, add after the `pl_area[8]` line in the `Uniforms` block:

```glsl
    vec4 tile_sort_params;  // x = near_z, y = far_z, z = tiles_x, w = tiles_y
```

Files to modify:
- `shaders/gs_preprocess.comp` — Uniforms at binding 3
- `shaders/gs_render.comp` — Uniforms at binding 2
- `shaders/gs_tile_render.comp` — Uniforms at binding 2

The field must be in the same position in ALL shaders that share this UBO. Even if a shader doesn't use `tile_sort_params`, the struct layout must match for the binding to be valid.

- [ ] **Step 4: Build**

Run: `cmake --build --preset macos-debug`
Expected: Build succeeds with no errors (shader recompilation + C++ rebuild).

- [ ] **Step 5: Run all tests**

Run: `ctest --test-dir build/macos-debug --output-on-failure`
Expected: All tests pass (UBO size change doesn't affect CPU-only tests).

- [ ] **Step 6: Commit**

```bash
git add src/engine/gs_renderer.cpp shaders/gs_preprocess.comp shaders/gs_render.comp shaders/gs_tile_render.comp
git commit -m "feat(gs): add tile_sort_params (near/far/tiles) to GsUniforms UBO"
```

---

### Task 3: Convert TileSortEntry to 8 bytes across shaders

**Files:**
- Modify: `shaders/gs_tile_bin.comp`
- Modify: `shaders/gs_tile_ranges.comp`
- Modify: `shaders/gs_tile_render.comp`

- [ ] **Step 1: Update gs_tile_bin.comp**

Replace the entire `TileSortEntry` struct and key-writing logic. The shader needs access to the UBO for near/far (add Uniforms binding). Replace push constants with just `max_entries` (tiles_x/tiles_y now from UBO).

Full replacement for `gs_tile_bin.comp`:

```glsl
#version 450

// Tile binning pass: duplicates each visible Gaussian into per-tile sort entries.
// Each thread processes one visible Gaussian from the merged sort array,
// computes its tile overlap, and writes one TileSortEntry per overlapping tile.
layout(local_size_x = 256) in;

struct ProjectedSplat {
    vec2 center;
    float depth;
    float radius;
    vec4 conic_opacity;
    vec4 color;
};

// 8 bytes — packed key + index
struct TileSortEntry {
    uint key;    // [31:16] = tile_id, [15:0] = depth_q (linear uint16)
    uint index;  // index into projected[] buffer
};

struct SortEntry {
    uint key;
    uint index;
};

layout(set = 0, binding = 0) readonly buffer ProjectedBuffer {
    ProjectedSplat projected[];
};

layout(set = 0, binding = 1) readonly buffer MergedSortBuffer {
    SortEntry merged_entries[];
};

layout(set = 0, binding = 2) readonly buffer CountsBuffer {
    uint static_count;
    uint dynamic_count;
    uint merged_visible_count;
};

layout(set = 0, binding = 3) writeonly buffer TileSortBuffer {
    TileSortEntry tile_entries[];
};

layout(set = 0, binding = 4) buffer TileSortCountBuffer {
    uint tile_sort_count;
};

layout(set = 0, binding = 5) uniform Uniforms {
    mat4 view;
    mat4 proj;
    mat4 inv_view;
    mat4 inv_proj;
    uvec4 params;
    vec4 shadow_box;
    vec4 cone_dir;
    vec4 cam_pos;
    vec4 effect_flags;
    vec4 light_params;
    vec4 touch_point;
    vec4 effect_params;
    vec4 effect_params2;
    vec4 point_light_params;
    vec4 actor_rotation;
    vec4 pl_pos_rad[8];
    vec4 pl_color[8];
    vec4 pl_dir_cone[8];
    vec4 pl_area[8];
    vec4 tile_sort_params;  // x = near_z, y = far_z, z = tiles_x, w = tiles_y
};

layout(push_constant) uniform PushConstants {
    uint max_entries;
};

void main() {
    uint gid = gl_GlobalInvocationID.x;
    uint visible = static_count + dynamic_count;
    if (gid >= visible) return;

    SortEntry entry = merged_entries[gid];
    if (entry.key == 0xFFFFu) return;

    uint idx = entry.index;
    ProjectedSplat splat = projected[idx];

    if (splat.radius <= 0.0) return;

    vec2 c = splat.center;
    float r = splat.radius;
    uint tiles_x = uint(tile_sort_params.z);
    uint tiles_y = uint(tile_sort_params.w);

    int tx_min = max(0, int(floor((c.x - r) / 16.0)));
    int tx_max = min(int(tiles_x) - 1, int(floor((c.x + r) / 16.0)));
    int ty_min = max(0, int(floor((c.y - r) / 16.0)));
    int ty_max = min(int(tiles_y) - 1, int(floor((c.y + r) / 16.0)));

    // Quantize depth linearly to uint16
    float near_z = tile_sort_params.x;
    float far_z  = tile_sort_params.y;
    float t = clamp((splat.depth - near_z) / (far_z - near_z), 0.0, 1.0);
    uint depth_q = min(uint(t * 65535.0), 0xFFFEu);

    for (int ty = ty_min; ty <= ty_max; ty++) {
        for (int tx = tx_min; tx <= tx_max; tx++) {
            uint tile_id = uint(ty) * tiles_x + uint(tx);
            uint sort_key = (tile_id << 16u) | depth_q;
            uint offset = atomicAdd(tile_sort_count, 1);
            if (offset < max_entries) {
                tile_entries[offset].key = sort_key;
                tile_entries[offset].index = idx;
            }
        }
    }
}
```

- [ ] **Step 2: Update gs_tile_ranges.comp**

Replace `TileSortEntry` struct and update tile_id extraction:

```glsl
#version 450

layout(local_size_x = 256) in;

struct TileSortEntry {
    uint key;    // [31:16] = tile_id, [15:0] = depth_q
    uint index;
};

layout(set = 0, binding = 0) readonly buffer SortedEntries {
    TileSortEntry entries[];
};

layout(set = 0, binding = 1) buffer TileRanges {
    uint ranges[];
};

layout(set = 0, binding = 2) readonly buffer TileSortCount {
    uint tile_count;
};

layout(push_constant) uniform PushConstants {
    uint num_tiles;
    uint max_entries;
};

void main() {
    uint i = gl_GlobalInvocationID.x;
    uint clamped_count = min(tile_count, max_entries);
    if (i >= clamped_count) return;

    uint tile_id = entries[i].key >> 16u;

    // Skip sentinel entries
    if (tile_id >= num_tiles) return;

    bool is_first = (i == 0) || ((entries[i - 1].key >> 16u) != tile_id);
    if (is_first) {
        ranges[tile_id * 2u] = i;
    }

    atomicAdd(ranges[tile_id * 2u + 1u], 1u);
}
```

- [ ] **Step 3: Update gs_tile_render.comp TileSortEntry**

In `shaders/gs_tile_render.comp`, replace lines 17-22:

```glsl
struct TileSortEntry {
    uint key;    // [31:16] = tile_id, [15:0] = depth_q
    uint index;  // index into projected[]
};
```

And update the sentinel check at line 119:

```glsl
        if (entry.key == 0xFFFFFFFFu) break;  // sentinel
```

(This line is already checking for 0xFFFFFFFF on key_hi; now it checks on the packed key — sentinels have key=0xFFFFFFFF so this is correct.)

- [ ] **Step 4: Update C++ buffer sizes (16 → 8 bytes per entry)**

In `src/engine/gs_renderer.cpp`, find all places where tile sort entry size is 16 and change to 8.

In `init()` (line 92, dummy buffer):
```cpp
        tile_sort_a_ = Buffer::create_storage_gpu_only(allocator_, 8);  // was 16
```

In `dispatch_tile_sort()` (line 2087, sentinel fill size):
```cpp
        vkCmdFillBuffer(cmd, tile_sort_a_.buffer(), 0,
                        static_cast<VkDeviceSize>(tile_sort_size_) * 8, 0xFFFFFFFF);  // was * 16
```

Search for `* 16` near `tile_sort` and `entry_buf_size` in both `load_cloud_legacy` and `init_streaming`:
```cpp
        VkDeviceSize entry_buf_size = static_cast<VkDeviceSize>(tile_sort_size_) * 8;  // was * 16
```

- [ ] **Step 5: Update tile_bin descriptor layout (add binding 5 for UBO)**

In `create_descriptor_resources()`, find the tile_bin_layout_ creation (around line 375-387). Add a 6th binding for the uniform buffer:

```cpp
    // Tile bin layout: { projected(0), merged(1), counts(2), tile_entries(3), tile_sort_count(4), uniforms(5) }
    {
        VkDescriptorSetLayoutBinding bindings[] = {
            {0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {5, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        };
        VkDescriptorSetLayoutCreateInfo ci{};
        ci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        ci.bindingCount = 6;
        ci.pBindings = bindings;
        vkCreateDescriptorSetLayout(device_, &ci, nullptr, &tile_bin_layout_);
    }
```

Update the tile_bin descriptor set write to include the uniform buffer at binding 5.

Update tile_bin push constant size from 12 to 4 (only `max_entries` now):
```cpp
    create_pipeline("shaders/gs_tile_bin.comp.spv", tile_bin_layout_, 4,
                    tile_bin_pipeline_layout_, tile_bin_pipeline_);
```

Update `dispatch_tile_sort` tile bin push from 12 bytes to 4:
```cpp
        uint32_t push_data[1] = {tile_sort_capacity_};
        vkCmdPushConstants(cmd, tile_bin_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                           0, 4, push_data);
```

- [ ] **Step 6: Build and test**

Run: `cmake --build --preset macos-debug && ctest --test-dir build/macos-debug --output-on-failure`
Expected: All tests pass. Shaders recompile. Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add shaders/gs_tile_bin.comp shaders/gs_tile_ranges.comp shaders/gs_tile_render.comp \
        src/engine/gs_renderer.cpp include/gseurat/engine/gs_renderer.hpp
git commit -m "refactor(gs): convert TileSortEntry to 8-byte packed key format"
```

---

### Task 4: Create gs_onesweep.comp shader

**Files:**
- Create: `shaders/gs_onesweep.comp`
- Modify: `shaders/CMakeLists.txt`

- [ ] **Step 1: Create the Onesweep shader**

Create `shaders/gs_onesweep.comp`:

```glsl
#version 450

// Onesweep radix sort: fused histogram + decoupled-lookback prefix sum + stable scatter.
// One dispatch per 8-bit radix pass (4 passes for 32-bit key).
// Uses coherent buffer + memoryBarrierBuffer() for Apple Silicon TBDR compatibility.
layout(local_size_x = 256) in;

// 8-byte tile sort entry
struct TileSortEntry {
    uint key;
    uint index;
};

layout(set = 0, binding = 0) readonly buffer InputBuffer {
    TileSortEntry in_entries[];
};

layout(set = 0, binding = 1) writeonly buffer OutputBuffer {
    TileSortEntry out_entries[];
};

// Per-digit lookback status: status[pass * 256 * max_workgroups + digit * max_workgroups + wg_id]
// Encoding: bits [31:30] = state (00=NOT_READY, 01=LOCAL, 11=INCLUSIVE), bits [29:0] = sum
layout(set = 0, binding = 2, std430) coherent buffer StatusBuffer {
    uint status[];
};

layout(set = 0, binding = 3) readonly buffer IndirectArgs {
    uint sort_dispatch_x;   // [0]: sort workgroups
    uint sort_dispatch_y;   // [1]: 1
    uint sort_dispatch_z;   // [2]: 1
    uint ranges_dispatch_x; // [3]: ranges workgroups
    uint ranges_dispatch_y; // [4]
    uint ranges_dispatch_z; // [5]
    uint entry_count;       // [6]: clamped tile_sort_count
    uint histogram_count;   // [7]: 256 * sort_workgroups (unused by onesweep)
};

layout(push_constant) uniform PushConstants {
    uint pass;            // 0..3 (which 8-bit digit to sort on)
    uint max_workgroups;  // total workgroups dispatched
};

// Shared memory: 19KB total (under 32KB Apple Silicon limit)
shared uint s_local_histogram[256];  // 1KB  — per-digit count for this workgroup
shared uint s_keys[2048];           // 8KB  — loaded sort keys
shared uint s_indices[2048];        // 8KB  — loaded indices
shared uint s_prefix[256];          // 1KB  — exclusive prefix of local histogram
shared uint s_digits[256];          // 1KB  — batch digit scratch for stable rank

const uint ENTRIES_PER_WG = 2048u;
const uint ENTRIES_PER_THREAD = 8u;
const uint NOT_READY = 0u;
const uint LOCAL_FLAG = 1u << 30u;
const uint INCLUSIVE_FLAG = 3u << 30u;
const uint VALUE_MASK = 0x3FFFFFFFu;

void main() {
    uint lid = gl_LocalInvocationID.x;
    uint wg_id = gl_WorkGroupID.x;
    uint wg_offset = wg_id * ENTRIES_PER_WG;
    uint total = entry_count;

    // ========================================
    // Phase 1: Load entries & build histogram
    // ========================================
    s_local_histogram[lid] = 0u;
    barrier();

    // Load 8 entries per thread into shared memory
    for (uint t = 0u; t < ENTRIES_PER_THREAD; t++) {
        uint idx = wg_offset + t * 256u + lid;
        uint k = 0xFFFFFFFFu;  // sentinel default
        uint v = 0u;
        if (idx < total) {
            k = in_entries[idx].key;
            v = in_entries[idx].index;
        }
        s_keys[t * 256u + lid] = k;
        s_indices[t * 256u + lid] = v;

        // Extract digit and count
        uint digit = (k >> (pass * 8u)) & 0xFFu;
        if (idx < total) {
            atomicAdd(s_local_histogram[digit], 1u);
        }
    }
    barrier();

    // ========================================
    // Phase 2: Decoupled lookback prefix sum
    // ========================================
    // Each thread handles one digit bin (tid 0..255)
    uint my_local_count = s_local_histogram[lid];

    // Publish LOCAL status — our partial count for this digit
    uint status_base = pass * 256u * max_workgroups + lid * max_workgroups;
    atomicExchange(status[status_base + wg_id], LOCAL_FLAG | my_local_count);
    memoryBarrierBuffer();

    // Lookback: accumulate prefix from predecessor workgroups
    uint aggregate = 0u;
    if (wg_id > 0u) {
        int pred = int(wg_id) - 1;
        while (pred >= 0) {
            uint val;
            // Spin-read with memory barrier for Apple Silicon weak ordering
            uint spin_count = 0u;
            do {
                memoryBarrierBuffer();
                val = atomicOr(status[status_base + uint(pred)], 0u);
                spin_count++;
                // Safety: if stuck for 1M iterations, break (should never happen)
                if (spin_count > 1000000u) break;
            } while ((val >> 30u) == 0u);

            uint state = val >> 30u;
            uint sum = val & VALUE_MASK;
            aggregate += sum;

            if (state == 3u) break;  // INCLUSIVE — includes all prior workgroups
            pred--;
        }
    }

    // Publish INCLUSIVE status
    uint inclusive = aggregate + my_local_count;
    atomicExchange(status[status_base + wg_id], INCLUSIVE_FLAG | inclusive);
    memoryBarrierBuffer();

    // Exclusive prefix for this digit in this workgroup
    s_prefix[lid] = aggregate;
    barrier();

    // ========================================
    // Phase 3: Stable scatter
    // ========================================
    for (uint batch = 0u; batch < ENTRIES_PER_THREAD; batch++) {
        uint local_idx = batch * 256u + lid;
        uint global_idx = wg_offset + local_idx;
        uint my_key = s_keys[local_idx];
        uint my_index = s_indices[local_idx];
        uint digit = (my_key >> (pass * 8u)) & 0xFFu;

        // Store digit for stable rank computation
        s_digits[lid] = digit;
        barrier();

        if (global_idx < total) {
            // Stable rank: count threads before me in this batch with same digit
            uint rank = 0u;
            for (uint j = 0u; j < lid; j++) {
                // Only count entries that are valid (within total)
                uint j_global = wg_offset + batch * 256u + j;
                if (j_global < total && s_digits[j] == digit) {
                    rank++;
                }
            }

            uint dst = s_prefix[digit] + rank;
            out_entries[dst].key = my_key;
            out_entries[dst].index = my_index;
        }

        // Advance prefix for next batch
        barrier();

        // Count entries per digit in this batch (only thread 0..255 increment their own digit)
        // Reset digit_count (reuse s_local_histogram as scratch)
        s_local_histogram[lid] = 0u;
        barrier();
        if (global_idx < total) {
            atomicAdd(s_local_histogram[digit], 1u);
        }
        barrier();
        s_prefix[lid] += s_local_histogram[lid];
        barrier();
    }
}
```

- [ ] **Step 2: Add to shader build**

In `shaders/CMakeLists.txt`, add before `gs_post_process.comp` (line 38):

```cmake
    ${SHADER_SOURCE_DIR}/gs_onesweep.comp
```

- [ ] **Step 3: Build to verify shader compiles**

Run: `cmake --build --preset macos-debug`
Expected: `Compiling shader gs_onesweep.comp` in output. Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add shaders/gs_onesweep.comp shaders/CMakeLists.txt
git commit -m "feat(gs): Onesweep radix sort compute shader with decoupled lookback"
```

---

### Task 5: C++ Onesweep pipeline and buffer infrastructure

**Files:**
- Modify: `include/gseurat/engine/gs_renderer.hpp`
- Modify: `src/engine/gs_renderer.cpp`

- [ ] **Step 1: Add Onesweep members to GsRenderer header**

In `include/gseurat/engine/gs_renderer.hpp`, add after `tile_scan_set_` (line 409):

```cpp
    // Onesweep sort (Phase 2 TBDR optimization)
    VkDescriptorSetLayout onesweep_layout_ = VK_NULL_HANDLE;
    VkPipelineLayout onesweep_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipeline onesweep_pipeline_ = VK_NULL_HANDLE;
    VkDescriptorSet onesweep_set_ab_ = VK_NULL_HANDLE;  // read A → write B
    VkDescriptorSet onesweep_set_ba_ = VK_NULL_HANDLE;  // read B → write A
    Buffer onesweep_status_;    // per-digit lookback status buffer
    bool use_onesweep_ = true;  // A/B toggle (true = onesweep, false = old 8-pass)
    uint32_t onesweep_max_wg_ = 0;
```

- [ ] **Step 2: Create Onesweep descriptor set layout**

In `src/engine/gs_renderer.cpp`, in `create_descriptor_resources()`, add after the tile_sort_layout_ creation (after line 401):

```cpp
    // Onesweep layout: { input(0), output(1), status(2), indirect_args(3) }
    {
        VkDescriptorSetLayoutBinding bindings[] = {
            {0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        };
        VkDescriptorSetLayoutCreateInfo ci{};
        ci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        ci.bindingCount = 4;
        ci.pBindings = bindings;
        vkCreateDescriptorSetLayout(device_, &ci, nullptr, &onesweep_layout_);
    }
```

- [ ] **Step 3: Allocate Onesweep descriptor sets in the pool**

Add `onesweep_layout_` twice to the descriptor pool allocation array (for AB and BA sets). Find where tile_sort_layout_ is allocated twice (around line 500-501) and add:

```cpp
        onesweep_layout_, onesweep_layout_,               // onesweep A→B, B→A
```

Also increment the pool's `maxSets` count by 2.

- [ ] **Step 4: Create Onesweep pipeline**

In `create_compute_pipelines()`, add after tile_scatter pipeline creation (after line 632):

```cpp
    // Onesweep pipeline (push: pass + max_workgroups = 8 bytes)
    create_pipeline("shaders/gs_onesweep.comp.spv", onesweep_layout_, 8,
                    onesweep_pipeline_layout_, onesweep_pipeline_);
```

- [ ] **Step 5: Allocate status buffer and write descriptor sets**

In `init_streaming()` (and `load_cloud_legacy` for the non-streaming path), after tile sort buffers are allocated, add:

```cpp
    // Onesweep status buffer: 4 passes × 256 digits × max_workgroups
    onesweep_max_wg_ = (tile_sort_capacity_ + 2047) / 2048;
    if (onesweep_max_wg_ == 0) onesweep_max_wg_ = 1;
    VkDeviceSize status_size = 4ull * 256ull * onesweep_max_wg_ * sizeof(uint32_t);
    onesweep_status_ = Buffer::create_storage_gpu_only(allocator_, status_size);
```

Write descriptor sets for onesweep_set_ab_ (input=A, output=B, status, indirect_args) and onesweep_set_ba_ (input=B, output=A, status, indirect_args).

- [ ] **Step 6: Add cleanup for Onesweep resources**

In `shutdown()`, add:

```cpp
    destroy_pipeline(onesweep_pipeline_);
    destroy_layout(onesweep_pipeline_layout_);
    destroy_set_layout(onesweep_layout_);
    onesweep_status_.destroy(allocator_);
```

- [ ] **Step 7: Build**

Run: `cmake --build --preset macos-debug`
Expected: Build succeeds.

- [ ] **Step 8: Commit**

```bash
git add include/gseurat/engine/gs_renderer.hpp src/engine/gs_renderer.cpp
git commit -m "feat(gs): Onesweep pipeline, descriptor sets, and status buffer allocation"
```

---

### Task 6: Wire Onesweep into dispatch_tile_sort

**Files:**
- Modify: `src/engine/gs_renderer.cpp`

- [ ] **Step 1: Add Onesweep dispatch path**

In `dispatch_tile_sort()`, after the indirect barrier (line 2134), add an `if (use_onesweep_)` branch that replaces the radix sort loop:

```cpp
    if (use_onesweep_) {
        // === Onesweep: clear status buffer ===
        VkDeviceSize status_size = 4ull * 256ull * onesweep_max_wg_ * sizeof(uint32_t);
        vkCmdFillBuffer(cmd, onesweep_status_.buffer(), 0, status_size, 0);
        {
            VkMemoryBarrier sb{};
            sb.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
            sb.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
            sb.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
            vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT,
                VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 1, &sb, 0, nullptr, 0, nullptr);
        }

        // === Onesweep: 4 radix passes ===
        for (uint32_t pass = 0; pass < 4; pass++) {
            uint32_t push_data[2] = {pass, onesweep_max_wg_};
            bool read_from_a = (pass % 2 == 0);
            VkDescriptorSet set = read_from_a ? onesweep_set_ab_ : onesweep_set_ba_;

            vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, onesweep_pipeline_);
            vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                    onesweep_pipeline_layout_, 0, 1, &set, 0, nullptr);
            vkCmdPushConstants(cmd, onesweep_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                               0, 8, push_data);
            vkCmdDispatchIndirect(cmd, tile_indirect_args_.buffer(), 0);

            insert_compute_barrier(cmd);
        }
        // After 4 passes (even), result is in tile_sort_a_
    } else {
        // === Old 8-pass radix sort (fallback) ===
        // ... existing code stays here unchanged ...
    }
```

Wrap the existing 8-pass radix loop (lines 2136-2194) in the `else` block.

- [ ] **Step 2: Update gs_tile_prepare_indirect.comp**

The indirect args need to include Onesweep workgroup count at `indirect_args[0]`. Currently `indirect_args[0]` = `ceil(count/1024)` for the old sort. For Onesweep, it should be `ceil(count/2048)`.

Update the prepare_indirect shader to write both:

```glsl
// indirect_args[0..2]: Onesweep dispatch args (workgroups = ceil(count/2048))
uint onesweep_wgs = (clamped_count + 2047u) / 2048u;
if (onesweep_wgs == 0u) onesweep_wgs = 1u;
indirect_args[0] = onesweep_wgs;
indirect_args[1] = 1u;
indirect_args[2] = 1u;

// indirect_args[3..5]: Ranges dispatch args (unchanged)
indirect_args[3] = (clamped_count + 255u) / 256u;
indirect_args[4] = 1u;
indirect_args[5] = 1u;

// indirect_args[6]: clamped entry count
indirect_args[6] = clamped_count;
```

(If the old sort needs 1024-based workgroups, we can add a separate field or recalculate. Since Onesweep replaces it, 2048-based is correct.)

- [ ] **Step 3: Add use_onesweep to feature flag control**

In `src/engine/renderer.cpp`, where `gs_renderer_.set_tile_binning(flags.gs_tile_binning)` is called, also expose the onesweep toggle (or hard-wire it to true for now). In `gs_renderer.hpp`, add:

```cpp
    void set_use_onesweep(bool v) { use_onesweep_ = v; }
```

- [ ] **Step 4: Build**

Run: `cmake --build --preset macos-debug`
Expected: Build succeeds. Full pipeline wired.

- [ ] **Step 5: Commit**

```bash
git add src/engine/gs_renderer.cpp include/gseurat/engine/gs_renderer.hpp \
        shaders/gs_tile_prepare_indirect.comp
git commit -m "feat(gs): wire Onesweep dispatch into tile sort pipeline with A/B toggle"
```

---

### Task 7: Visual verification and Windows build

- [ ] **Step 1: Build macOS debug**

Run: `cmake --build --preset macos-debug`
Expected: All 36+ tests pass, build clean.

- [ ] **Step 2: Push and build on Windows**

```bash
git push origin perf/onesweep-tile-sort
ssh windows "powershell -NoProfile -Command \"cd C:\\Users\\g00ec\\dev\\GSeurat; git fetch origin 2>&1; git checkout perf/onesweep-tile-sort 2>&1; git pull 2>&1; cmake --preset windows-release 2>&1; cmake --build --preset windows-release 2>&1\""
```

Expected: Windows build succeeds. Console shows tile binning remains enabled on AMD (vendor 0x1002), Onesweep active.

- [ ] **Step 3: Commit (no changes — verification only)**

No commit needed.

---

### Task 8: Control server Onesweep toggle

**Files:**
- Modify: `src/engine/command_dispatcher.cpp`

- [ ] **Step 1: Add use_onesweep to get/set feature**

In `src/engine/command_dispatcher.cpp`, after `gs_tile_binning` in `get_features`:

```cpp
        add("gs_onesweep", ctx_.renderer.gs_renderer().use_onesweep(), "Onesweep Sort");
```

In `set_feature`, after `gs_tile_binning`:

```cpp
        else if (name == "gs_onesweep") ctx_.renderer.gs_renderer().set_use_onesweep(enabled);
```

Add `bool use_onesweep() const { return use_onesweep_; }` to `gs_renderer.hpp` public section if not already present.

- [ ] **Step 2: Build**

Run: `cmake --build --preset macos-debug`

- [ ] **Step 3: Commit**

```bash
git add src/engine/command_dispatcher.cpp include/gseurat/engine/gs_renderer.hpp
git commit -m "feat(gs): expose use_onesweep toggle in control server"
```
