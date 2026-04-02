# Index-Merge Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split static and dynamic Gaussians into independent GPU pipelines with a merge shader, eliminating redundant static sorting when the camera is stationary.

**Architecture:** Two independent preprocess+sort paths (static and dynamic) write to offset regions of a unified projected SSBO. A GPU merge shader combines the two sorted index arrays via binary search (Merge Path). The tile rasterizer reads from the merged index buffer with zero branching.

**Tech Stack:** C++23, Vulkan compute shaders (GLSL 450), VMA, GLM

---

## File Structure

| File | Responsibility |
|------|---------------|
| `shaders/gs_merge.comp` | **NEW** — GPU merge path shader combining static+dynamic sorted arrays |
| `shaders/gs_preprocess.comp` | **MODIFY** — add push constant for projected offset and gaussian count |
| `shaders/gs_render.comp` | **MODIFY** — read from merged sort buffer and counts SSBO |
| `shaders/CMakeLists.txt` | **MODIFY** — add gs_merge.comp to compilation list |
| `include/gseurat/engine/gs_renderer.hpp` | **MODIFY** — add static/dynamic buffer members, merge pipeline, new APIs |
| `src/engine/gs_renderer.cpp` | **MODIFY** — split buffer allocation, 4-phase dispatch, descriptor sets |
| `include/gseurat/engine/renderer.hpp` | **MODIFY** — replace gs_active/scene buffers with static/dynamic split |
| `src/engine/renderer.cpp` | **MODIFY** — split CPU data flow into static/dynamic paths |

---

### Task 1: Create the merge shader

**Files:**
- Create: `shaders/gs_merge.comp`
- Modify: `shaders/CMakeLists.txt:31`

- [ ] **Step 1: Write gs_merge.comp**

```glsl
#version 450
layout(local_size_x = 256) in;

struct SortEntry {
    uint key;
    uint index;
};

layout(set = 0, binding = 0) readonly buffer StaticSort {
    SortEntry static_entries[];
};

layout(set = 0, binding = 1) readonly buffer DynamicSort {
    SortEntry dynamic_entries[];
};

layout(set = 0, binding = 2) writeonly buffer MergedSort {
    SortEntry merged_entries[];
};

layout(set = 0, binding = 3) buffer Counts {
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
    // lo/hi bound the number of static elements in merged[0..tid-1]
    uint lo = (tid > dynamic_count) ? (tid - dynamic_count) : 0;
    uint hi = min(tid, static_count);

    while (lo < hi) {
        uint mid = (lo + hi) / 2;
        uint d_idx = tid - mid;
        // Ascending sort (near first). Stable: static wins on equal depth.
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

- [ ] **Step 2: Add gs_merge.comp to shader CMakeLists**

In `shaders/CMakeLists.txt`, add after the `gs_radix_scatter.comp` line (line 30):

```cmake
    ${SHADER_SOURCE_DIR}/gs_merge.comp
```

So lines 28-32 become:

```cmake
    ${SHADER_SOURCE_DIR}/gs_radix_histogram.comp
    ${SHADER_SOURCE_DIR}/gs_radix_scan.comp
    ${SHADER_SOURCE_DIR}/gs_radix_scatter.comp
    ${SHADER_SOURCE_DIR}/gs_merge.comp
    ${SHADER_SOURCE_DIR}/gs_post_process.comp
```

- [ ] **Step 3: Verify shader compiles**

Run: `cmake --build --preset macos-debug --target shaders 2>&1 | grep -E "merge|error"`
Expected: `Compiling shader gs_merge.comp` with no errors

- [ ] **Step 4: Commit**

```bash
git add shaders/gs_merge.comp shaders/CMakeLists.txt
git commit -m "feat(gs): add merge path compute shader for static/dynamic index merge"
```

---

### Task 2: Add push constants to preprocess shader

**Files:**
- Modify: `shaders/gs_preprocess.comp:40-65,118-120,328-354,440-441,465-474`

The preprocess shader currently reads `gaussian_count` from `params.z` in the uniform buffer and writes `projected[idx]` and `sort_entries[idx]` using the raw global invocation ID. We need to:
1. Add a push constant block with `projected_offset` and `gaussian_count`
2. Use the push constant `gaussian_count` for the bounds check (instead of `params.z`)
3. Write to `projected[projected_offset + idx]`
4. Store `projected_offset + idx` as the sort entry index (global index into unified SSBO)

- [ ] **Step 1: Add push constant block**

After the `BoneBuffer` binding (line 65) and before the `hash_uint` function (line 67), add:

```glsl
layout(push_constant) uniform PushConstants {
    uint projected_offset;  // 0 for static, max_static_count for dynamic
    uint gaussian_count;    // number of Gaussians in this layer
};
```

- [ ] **Step 2: Replace params.z bounds check with push constant**

At line 120, change:

```glsl
    if (idx >= params.z) return;
```

to:

```glsl
    if (idx >= gaussian_count) return;
```

- [ ] **Step 3: Update projected write to use offset**

At line 465, change:

```glsl
    projected[idx] = splat;
```

to:

```glsl
    projected[projected_offset + idx] = splat;
```

- [ ] **Step 4: Update sort entry index to use global offset**

At lines 470-471, change:

```glsl
    sort_entries[idx].key = uint(depth_norm * 65535.0);
    sort_entries[idx].index = idx;
```

to:

```glsl
    sort_entries[idx].key = uint(depth_norm * 65535.0);
    sort_entries[idx].index = projected_offset + idx;
```

- [ ] **Step 5: Update ALL culled sort entry writes to use global offset**

There are 5 cull points that write `sort_entries[idx].index = idx;` (lines 329, 337, 354, 363, 441). Change each to:

```glsl
    sort_entries[idx].index = projected_offset + idx;
```

The `.key = 0xFFFF` stays the same — culled entries are still culled.

- [ ] **Step 6: Verify shader compiles**

Run: `cmake --build --preset macos-debug --target shaders 2>&1 | grep -E "preprocess|error"`
Expected: `Compiling shader gs_preprocess.comp` with no errors

- [ ] **Step 7: Commit**

```bash
git add shaders/gs_preprocess.comp
git commit -m "feat(gs): add push constants to preprocess shader for static/dynamic offset"
```

---

### Task 3: Update render shader for merged buffers

**Files:**
- Modify: `shaders/gs_render.comp:15-18,24-26,49-51,86,104-105,108`

The render shader currently reads from `SortBuffer` (binding 1) and `VisibleCountBuffer` (binding 4). We change it to read from the merged sort buffer and counts SSBO.

- [ ] **Step 1: Replace SortBuffer binding with MergedSortBuffer**

At lines 24-26, change:

```glsl
layout(set = 0, binding = 1) readonly buffer SortBuffer {
    SortEntry sort_entries[];
};
```

to:

```glsl
layout(set = 0, binding = 1) readonly buffer MergedSortBuffer {
    SortEntry merged_entries[];
};
```

- [ ] **Step 2: Replace VisibleCountBuffer with CountsBuffer**

At lines 49-51, change:

```glsl
layout(set = 0, binding = 4) readonly buffer VisibleCountBuffer {
    uint visible_count;
};
```

to:

```glsl
layout(set = 0, binding = 4) readonly buffer CountsBuffer {
    uint static_count;
    uint dynamic_count;
    uint merged_visible_count;
};
```

- [ ] **Step 3: Update loop bound**

At line 86, change:

```glsl
    uint count = visible_count;
```

to:

```glsl
    uint count = merged_visible_count;
```

- [ ] **Step 4: Update sort entry reads**

At line 105, change:

```glsl
        uint idx = sort_entries[s].index;
```

to:

```glsl
        uint idx = merged_entries[s].index;
```

At line 108, change:

```glsl
        if (sort_entries[s].key == 0xFFFF) break;
```

to:

```glsl
        if (merged_entries[s].key == 0xFFFF) break;
```

- [ ] **Step 5: Search for any other sort_entries references in gs_render.comp and update them**

Run: `grep -n "sort_entries" shaders/gs_render.comp`

Replace every remaining `sort_entries[...]` with `merged_entries[...]`.

- [ ] **Step 6: Verify shader compiles**

Run: `cmake --build --preset macos-debug --target shaders 2>&1 | grep -E "render|error"`
Expected: `Compiling shader gs_render.comp` with no errors

- [ ] **Step 7: Commit**

```bash
git add shaders/gs_render.comp
git commit -m "feat(gs): update render shader to read from merged sort buffer and counts SSBO"
```

---

### Task 4: Add static/dynamic buffer members to GsRenderer header

**Files:**
- Modify: `include/gseurat/engine/gs_renderer.hpp:46-63,134-174,184-204`

Add new buffer members, APIs, and pipeline objects for the split architecture. Keep old members temporarily (removed in Task 6 when the dispatch logic is rewritten).

- [ ] **Step 1: Add new public API methods**

After line 51 (`update_gaussian_data`), add:

```cpp
    // Static/dynamic split API
    void update_static_gaussians(const Gaussian* data, uint32_t count);
    void update_dynamic_gaussians(const Gaussian* data, uint32_t count);
    uint32_t max_static_count() const { return max_static_count_; }
    uint32_t max_dynamic_count() const { return max_dynamic_count_; }
    uint32_t static_count() const { return static_count_; }
    uint32_t dynamic_count() const { return dynamic_count_; }
    bool static_dirty() const { return static_dirty_; }
    void set_static_dirty(bool d) { static_dirty_ = d; }
```

- [ ] **Step 2: Add push constant struct**

After line 44 (`GsPostProcessUbo`), before `class GsRenderer`, add:

```cpp
// Push constants for preprocess shader (static/dynamic offset)
struct GsPreprocessPush {
    uint32_t projected_offset;
    uint32_t gaussian_count;
};
```

- [ ] **Step 3: Add new buffer members**

After `bone_ssbo_` (line 169), add:

```cpp
    // Static/dynamic split buffers
    Buffer static_gaussian_ssbo_;
    Buffer dynamic_gaussian_ssbo_;
    Buffer static_sort_a_;
    Buffer static_sort_b_;
    Buffer dynamic_sort_a_;
    Buffer dynamic_sort_b_;
    Buffer static_histogram_ssbo_;
    Buffer dynamic_histogram_ssbo_;
    Buffer merged_sort_ssbo_;
    Buffer counts_ssbo_;  // {static_visible, dynamic_visible, merged_visible}

    uint32_t static_count_ = 0;
    uint32_t dynamic_count_ = 0;
    uint32_t max_static_count_ = 0;
    uint32_t max_dynamic_count_ = 0;
    uint32_t static_sort_size_ = 0;
    uint32_t dynamic_sort_size_ = 0;
    uint32_t static_sort_workgroups_ = 0;
    uint32_t dynamic_sort_workgroups_ = 0;
    bool static_dirty_ = true;
```

- [ ] **Step 4: Add merge pipeline and descriptor set members**

After `radix_scatter_set_ba_` (line 191), add:

```cpp
    // Merge pipeline
    VkDescriptorSetLayout merge_layout_ = VK_NULL_HANDLE;
    VkPipelineLayout merge_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipeline merge_pipeline_ = VK_NULL_HANDLE;
    VkDescriptorSet merge_set_ = VK_NULL_HANDLE;

    // Static/dynamic preprocess and sort descriptor sets
    VkDescriptorSet static_preprocess_set_ = VK_NULL_HANDLE;
    VkDescriptorSet dynamic_preprocess_set_ = VK_NULL_HANDLE;
    VkDescriptorSet static_histogram_set_a_ = VK_NULL_HANDLE;
    VkDescriptorSet static_histogram_set_b_ = VK_NULL_HANDLE;
    VkDescriptorSet static_scatter_set_ab_ = VK_NULL_HANDLE;
    VkDescriptorSet static_scatter_set_ba_ = VK_NULL_HANDLE;
    VkDescriptorSet static_scan_set_ = VK_NULL_HANDLE;
    VkDescriptorSet dynamic_histogram_set_a_ = VK_NULL_HANDLE;
    VkDescriptorSet dynamic_histogram_set_b_ = VK_NULL_HANDLE;
    VkDescriptorSet dynamic_scatter_set_ab_ = VK_NULL_HANDLE;
    VkDescriptorSet dynamic_scatter_set_ba_ = VK_NULL_HANDLE;
    VkDescriptorSet dynamic_scan_set_ = VK_NULL_HANDLE;
```

- [ ] **Step 5: Update kParticleHeadroom and add kDynamicHeadroom**

At line 57, change:

```cpp
    static constexpr uint32_t kParticleHeadroom = 2048;
```

to:

```cpp
    static constexpr uint32_t kParticleHeadroom = 2048;
    static constexpr uint32_t kDynamicHeadroom = 8192;  // particles + character + animated regions
```

- [ ] **Step 6: Commit**

```bash
git add include/gseurat/engine/gs_renderer.hpp
git commit -m "feat(gs): add static/dynamic buffer members and merge pipeline to GsRenderer header"
```

---

### Task 5: Implement buffer allocation for split architecture

**Files:**
- Modify: `src/engine/gs_renderer.cpp:410-490,492-542`

Rewrite `load_cloud()` to allocate static and dynamic buffers separately, plus the unified projected SSBO and merged sort buffer. Also add the `update_static_gaussians()` and `update_dynamic_gaussians()` methods.

- [ ] **Step 1: Rewrite load_cloud() buffer allocation**

Replace the buffer creation section (lines 418-490) with code that:
1. Sets `max_static_count_` from cloud size + headroom
2. Sets `max_dynamic_count_` to `kDynamicHeadroom`
3. Calculates sort sizes for both static and dynamic
4. Creates unified `projected_ssbo_` sized for `max_static + max_dynamic`
5. Creates separate static/dynamic gaussian, sort, and histogram SSBOs
6. Creates `merged_sort_ssbo_` and `counts_ssbo_`
7. Uploads initial cloud data to `static_gaussian_ssbo_`

```cpp
void GsRenderer::load_cloud(const GaussianCloud& cloud) {
    if (cloud.empty()) return;

    if (initialized_) {
        vkDeviceWaitIdle(device_);
    }

    sort_done_once_ = false;
    static_dirty_ = true;

    // Capacity planning
    max_static_count_ = cloud.count() + kParticleHeadroom;  // headroom for VFX objects
    max_dynamic_count_ = kDynamicHeadroom;
    static_count_ = cloud.count();
    dynamic_count_ = 0;

    // Legacy fields (kept for ensure_capacity compatibility)
    gaussian_count_ = static_count_;
    max_gaussian_count_ = max_static_count_ + max_dynamic_count_;

    // Sort sizes (power-of-2, 1024-element workgroups)
    auto calc_sort = [](uint32_t max_count) -> std::pair<uint32_t, uint32_t> {
        uint32_t sz = ((max_count + 1023) / 1024) * 1024;
        if (sz < max_count) sz = max_count;
        uint32_t wg = sz / 1024;
        if (wg == 0) wg = 1;
        sz = wg * 1024;
        return {sz, wg};
    };

    auto [ss, swg] = calc_sort(max_static_count_);
    static_sort_size_ = ss;
    static_sort_workgroups_ = swg;

    auto [ds, dwg] = calc_sort(max_dynamic_count_);
    dynamic_sort_size_ = ds;
    dynamic_sort_workgroups_ = dwg;

    // Legacy sort fields (for any code still referencing them)
    sort_size_ = static_sort_size_;
    num_sort_workgroups_ = static_sort_workgroups_;
    num_sort_passes_ = 2;

    // Destroy all existing buffers
    gaussian_ssbo_.destroy(allocator_);
    projected_ssbo_.destroy(allocator_);
    sort_keys_ssbo_.destroy(allocator_);
    sort_b_ssbo_.destroy(allocator_);
    histogram_ssbo_.destroy(allocator_);
    uniform_buffer_.destroy(allocator_);
    visible_count_ssbo_.destroy(allocator_);
    bone_ssbo_.destroy(allocator_);
    static_gaussian_ssbo_.destroy(allocator_);
    dynamic_gaussian_ssbo_.destroy(allocator_);
    static_sort_a_.destroy(allocator_);
    static_sort_b_.destroy(allocator_);
    dynamic_sort_a_.destroy(allocator_);
    dynamic_sort_b_.destroy(allocator_);
    static_histogram_ssbo_.destroy(allocator_);
    dynamic_histogram_ssbo_.destroy(allocator_);
    merged_sort_ssbo_.destroy(allocator_);
    counts_ssbo_.destroy(allocator_);

    // === Allocate split buffers ===
    uint32_t projected_capacity = max_static_count_ + max_dynamic_count_;

    static_gaussian_ssbo_ = Buffer::create_storage(allocator_,
        static_cast<VkDeviceSize>(max_static_count_) * sizeof(GpuGaussian));
    dynamic_gaussian_ssbo_ = Buffer::create_storage(allocator_,
        static_cast<VkDeviceSize>(max_dynamic_count_) * sizeof(GpuGaussian));

    // Unified projected SSBO: [0..max_static-1] static, [max_static..] dynamic
    projected_ssbo_ = Buffer::create_storage(allocator_,
        static_cast<VkDeviceSize>(projected_capacity) * sizeof(ProjectedSplat));

    // Sort ping-pong buffers (separate for static and dynamic)
    static_sort_a_ = Buffer::create_storage(allocator_,
        static_cast<VkDeviceSize>(static_sort_size_) * sizeof(SortEntry));
    static_sort_b_ = Buffer::create_storage(allocator_,
        static_cast<VkDeviceSize>(static_sort_size_) * sizeof(SortEntry));
    dynamic_sort_a_ = Buffer::create_storage(allocator_,
        static_cast<VkDeviceSize>(dynamic_sort_size_) * sizeof(SortEntry));
    dynamic_sort_b_ = Buffer::create_storage(allocator_,
        static_cast<VkDeviceSize>(dynamic_sort_size_) * sizeof(SortEntry));

    // Histograms (separate)
    static_histogram_ssbo_ = Buffer::create_storage(allocator_,
        static_cast<VkDeviceSize>(256) * static_sort_workgroups_ * sizeof(uint32_t));
    dynamic_histogram_ssbo_ = Buffer::create_storage(allocator_,
        static_cast<VkDeviceSize>(256) * dynamic_sort_workgroups_ * sizeof(uint32_t));

    // Merged sort output
    merged_sort_ssbo_ = Buffer::create_storage(allocator_,
        static_cast<VkDeviceSize>(projected_capacity) * sizeof(SortEntry));

    // Counts SSBO: {static_visible, dynamic_visible, merged_visible}
    counts_ssbo_ = Buffer::create_storage(allocator_, 3 * sizeof(uint32_t));

    // Uniform buffer and bone SSBO (unchanged)
    uniform_buffer_ = Buffer::create_uniform(allocator_, sizeof(GsUniforms));
    bone_ssbo_ = Buffer::create_storage(allocator_, kMaxBones * sizeof(glm::mat4));
    bone_count_ = 0;
    {
        auto* bones = static_cast<glm::mat4*>(bone_ssbo_.mapped());
        for (uint32_t i = 0; i < kMaxBones; ++i) bones[i] = glm::mat4(1.0f);
    }

    // Upload initial cloud data to static buffer
    {
        auto* gpu_data = static_cast<GpuGaussian*>(static_gaussian_ssbo_.mapped());
        for (uint32_t i = 0; i < static_count_; ++i) {
            const auto& g = cloud.gaussians()[i];
            gpu_data[i].pos_opacity = glm::vec4(g.position, g.opacity);
            float bone_as_float;
            uint32_t bone_idx = g.bone_index;
            std::memcpy(&bone_as_float, &bone_idx, sizeof(float));
            gpu_data[i].scale_pad = glm::vec4(g.scale, bone_as_float);
            gpu_data[i].rot = glm::vec4(g.rotation.x, g.rotation.y, g.rotation.z, g.rotation.w);
            gpu_data[i].color_pad = glm::vec4(g.color, g.emission);
        }
    }

    // Initialize sort buffers with sentinel keys
    auto init_sort = [](Buffer& buf, uint32_t size, uint32_t valid_count) {
        auto* sort = static_cast<SortEntry*>(buf.mapped());
        for (uint32_t i = 0; i < size; ++i) {
            sort[i].key = 0xFFFFFFFF;
            sort[i].index = i < valid_count ? i : 0;
        }
    };
    init_sort(static_sort_a_, static_sort_size_, static_count_);
    init_sort(static_sort_b_, static_sort_size_, static_count_);
    init_sort(dynamic_sort_a_, dynamic_sort_size_, 0);
    init_sort(dynamic_sort_b_, dynamic_sort_size_, 0);

    // Zero counts
    auto* counts = static_cast<uint32_t*>(counts_ssbo_.mapped());
    counts[0] = 0;  // static_visible
    counts[1] = 0;  // dynamic_visible
    counts[2] = 0;  // merged_visible

    // Keep legacy buffers as aliases for backward compatibility during transition
    gaussian_ssbo_ = static_gaussian_ssbo_;
    sort_keys_ssbo_ = static_sort_a_;
    sort_b_ssbo_ = static_sort_b_;
    histogram_ssbo_ = static_histogram_ssbo_;
    visible_count_ssbo_ = counts_ssbo_;  // counts_ssbo_ replaces visible_count

    update_descriptors();
}
```

- [ ] **Step 2: Add update_static_gaussians()**

After the existing `update_gaussian_data()` method (line 592):

```cpp
void GsRenderer::update_static_gaussians(const Gaussian* data, uint32_t count) {
    if (count == 0 || count > max_static_count_) return;
    static_count_ = count;
    static_dirty_ = true;

    auto* gpu_data = static_cast<GpuGaussian*>(static_gaussian_ssbo_.mapped());
    for (uint32_t i = 0; i < count; ++i) {
        gpu_data[i].pos_opacity = glm::vec4(data[i].position, data[i].opacity);
        float bone_f;
        uint32_t bi = data[i].bone_index;
        std::memcpy(&bone_f, &bi, sizeof(float));
        gpu_data[i].scale_pad = glm::vec4(data[i].scale, bone_f);
        gpu_data[i].rot = glm::vec4(data[i].rotation.x, data[i].rotation.y,
                                     data[i].rotation.z, data[i].rotation.w);
        gpu_data[i].color_pad = glm::vec4(data[i].color, data[i].emission);
    }

    // Reinit static sort buffers
    auto init_sort = [](Buffer& buf, uint32_t size, uint32_t valid) {
        auto* sort = static_cast<SortEntry*>(buf.mapped());
        for (uint32_t i = 0; i < size; ++i) {
            sort[i].key = 0xFFFFFFFF;
            sort[i].index = i < valid ? i : 0;
        }
    };
    init_sort(static_sort_a_, static_sort_size_, static_count_);
    init_sort(static_sort_b_, static_sort_size_, static_count_);
}
```

- [ ] **Step 3: Add update_dynamic_gaussians()**

Right after `update_static_gaussians()`:

```cpp
void GsRenderer::update_dynamic_gaussians(const Gaussian* data, uint32_t count) {
    if (count > max_dynamic_count_) count = max_dynamic_count_;
    dynamic_count_ = count;

    if (count == 0) return;

    auto* gpu_data = static_cast<GpuGaussian*>(dynamic_gaussian_ssbo_.mapped());
    for (uint32_t i = 0; i < count; ++i) {
        gpu_data[i].pos_opacity = glm::vec4(data[i].position, data[i].opacity);
        float bone_f;
        uint32_t bi = data[i].bone_index;
        std::memcpy(&bone_f, &bi, sizeof(float));
        gpu_data[i].scale_pad = glm::vec4(data[i].scale, bone_f);
        gpu_data[i].rot = glm::vec4(data[i].rotation.x, data[i].rotation.y,
                                     data[i].rotation.z, data[i].rotation.w);
        gpu_data[i].color_pad = glm::vec4(data[i].color, data[i].emission);
    }

    // Reinit dynamic sort buffers
    auto init_sort = [](Buffer& buf, uint32_t size, uint32_t valid) {
        auto* sort = static_cast<SortEntry*>(buf.mapped());
        for (uint32_t i = 0; i < size; ++i) {
            sort[i].key = 0xFFFFFFFF;
            sort[i].index = i < valid ? i : 0;
        }
    };
    init_sort(dynamic_sort_a_, dynamic_sort_size_, dynamic_count_);
    init_sort(dynamic_sort_b_, dynamic_sort_size_, dynamic_count_);
}
```

- [ ] **Step 4: Commit**

```bash
git add src/engine/gs_renderer.cpp
git commit -m "feat(gs): implement split buffer allocation and static/dynamic upload methods"
```

---

### Task 6: Create merge pipeline and descriptor sets

**Files:**
- Modify: `src/engine/gs_renderer.cpp` — `create_compute_pipelines()`, `create_descriptor_resources()`, `update_descriptors()`

This task adds the merge pipeline, creates descriptor sets for static/dynamic preprocess and sort, and updates the render descriptor to use merged buffers.

- [ ] **Step 1: Add merge pipeline creation**

In `create_compute_pipelines()`, after the radix scatter pipeline creation, add:

```cpp
    // Merge pipeline
    {
        auto merge_code = read_shader_file("shaders/gs_merge.comp.spv");
        VkShaderModule merge_module = create_shader_module(device_, merge_code);

        VkDescriptorSetLayoutBinding bindings[] = {
            {0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr}, // static sort
            {1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr}, // dynamic sort
            {2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr}, // merged sort
            {3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr}, // counts
        };

        VkDescriptorSetLayoutCreateInfo layout_info{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO};
        layout_info.bindingCount = 4;
        layout_info.pBindings = bindings;
        vkCreateDescriptorSetLayout(device_, &layout_info, nullptr, &merge_layout_);

        VkPipelineLayoutCreateInfo pipe_layout{VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
        pipe_layout.setLayoutCount = 1;
        pipe_layout.pSetLayouts = &merge_layout_;
        vkCreatePipelineLayout(device_, &pipe_layout, nullptr, &merge_pipeline_layout_);

        VkComputePipelineCreateInfo ci{VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO};
        ci.stage.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
        ci.stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
        ci.stage.module = merge_module;
        ci.stage.pName = "main";
        ci.layout = merge_pipeline_layout_;
        vkCreateComputePipelines(device_, VK_NULL_HANDLE, 1, &ci, nullptr, &merge_pipeline_);

        vkDestroyShaderModule(device_, merge_module, nullptr);
    }
```

- [ ] **Step 2: Add push constant range to preprocess pipeline layout**

In the preprocess pipeline creation section, add a push constant range:

```cpp
    VkPushConstantRange push_range{};
    push_range.stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
    push_range.offset = 0;
    push_range.size = sizeof(GsPreprocessPush);

    // Update pipeline layout creation to include push constant
    VkPipelineLayoutCreateInfo pipe_layout{VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
    pipe_layout.setLayoutCount = 1;
    pipe_layout.pSetLayouts = &preprocess_layout_;
    pipe_layout.pushConstantRangeCount = 1;
    pipe_layout.pPushConstantRanges = &push_range;
```

- [ ] **Step 3: Create static/dynamic descriptor sets in create_descriptor_resources()**

Allocate descriptor sets for static preprocess, dynamic preprocess, static radix sort (histogram A/B, scan, scatter AB/BA), dynamic radix sort, and the merge set. Reuse the existing layout objects — the layouts are identical, just bound to different buffers.

- [ ] **Step 4: Update descriptor writes in update_descriptors()**

Write descriptors for:
- `static_preprocess_set_`: static_gaussian(0), projected(1), static_sort_a(2), uniforms(3), counts(4, offset 0), bones(5)
- `dynamic_preprocess_set_`: dynamic_gaussian(0), projected(1), dynamic_sort_a(2), uniforms(3), counts(4, offset 4), bones(5)
- `merge_set_`: static_sort_final(0), dynamic_sort_final(1), merged_sort(2), counts(3)
- `render_set_`: projected(0), merged_sort(1), uniforms(2), output_image(3), counts(4), depth_image(5)
- Static/dynamic radix sets: same pattern as existing, using respective sort/histogram buffers

Note: For the counts SSBO binding in preprocess sets, the preprocess shader uses `VisibleCountBuffer { uint visible_count; }` which maps to offset 0 (static) or offset 4 (dynamic) of the counts SSBO. Since Vulkan descriptor buffer info supports offset+range, bind with appropriate offset:
- Static preprocess: offset=0, range=4 (static_visible_count)
- Dynamic preprocess: offset=4, range=4 (dynamic_visible_count)

Actually, the preprocess shader declaration is `buffer VisibleCountBuffer { uint visible_count; }` — it only sees one uint. By binding the counts SSBO with the right offset, we achieve separate atomic counters without changing the shader's VisibleCountBuffer declaration.

Wait — the preprocess shader's visible_count binding (binding 4) uses `atomicAdd(visible_count, 1u)`. The variable name `visible_count` maps to offset 0 within whatever buffer is bound. By binding `counts_ssbo_` at offset 0 for static (writing to `counts[0]`) and at offset 4 for dynamic (writing to `counts[1]`), each preprocess pass increments its own counter.

- [ ] **Step 5: Commit**

```bash
git add src/engine/gs_renderer.cpp
git commit -m "feat(gs): add merge pipeline, push constants, and split descriptor sets"
```

---

### Task 7: Rewrite render() dispatch for 4-phase flow

**Files:**
- Modify: `src/engine/gs_renderer.cpp:783-929`

Replace the single-pass dispatch with the 4-phase flow: dynamic preprocess+sort → (conditional) static preprocess+sort → merge → render.

- [ ] **Step 1: Write the 4-phase dispatch**

Replace the dispatch section (after uniform update, inside the `!skip_gs_compute` block):

```cpp
    // Image transitions and clear (unchanged)
    // ... existing image barrier + clear code ...

    // === PHASE 1: DYNAMIC (every frame) ===
    if (dynamic_count_ > 0) {
        // Reset dynamic visible count (counts_ssbo_ offset 4)
        vkCmdFillBuffer(cmd, counts_ssbo_.buffer(), 4, sizeof(uint32_t), 0);
        {
            VkMemoryBarrier fill_barrier{VK_STRUCTURE_TYPE_MEMORY_BARRIER};
            fill_barrier.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
            fill_barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
            vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT,
                VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 1, &fill_barrier, 0, nullptr, 0, nullptr);
        }

        // Dynamic preprocess
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, preprocess_pipeline_);
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
            preprocess_pipeline_layout_, 0, 1, &dynamic_preprocess_set_, 0, nullptr);
        GsPreprocessPush dyn_push{max_static_count_, dynamic_count_};
        vkCmdPushConstants(cmd, preprocess_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
            0, sizeof(GsPreprocessPush), &dyn_push);
        vkCmdDispatch(cmd, (dynamic_count_ + 255) / 256, 1, 1);

        insert_compute_barrier(cmd);

        // Dynamic radix sort
        dispatch_radix_sort(cmd, dynamic_sort_size_, dynamic_sort_workgroups_,
            dynamic_histogram_set_a_, dynamic_histogram_set_b_,
            dynamic_scan_set_,
            dynamic_scatter_set_ab_, dynamic_scatter_set_ba_);
    }

    // === PHASE 2: STATIC (only when dirty) ===
    if (static_dirty_ && static_count_ > 0) {
        // Reset static visible count (counts_ssbo_ offset 0)
        vkCmdFillBuffer(cmd, counts_ssbo_.buffer(), 0, sizeof(uint32_t), 0);
        {
            VkMemoryBarrier fill_barrier{VK_STRUCTURE_TYPE_MEMORY_BARRIER};
            fill_barrier.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
            fill_barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
            vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT,
                VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 1, &fill_barrier, 0, nullptr, 0, nullptr);
        }

        // Static preprocess
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, preprocess_pipeline_);
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
            preprocess_pipeline_layout_, 0, 1, &static_preprocess_set_, 0, nullptr);
        GsPreprocessPush stat_push{0, static_count_};
        vkCmdPushConstants(cmd, preprocess_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
            0, sizeof(GsPreprocessPush), &stat_push);
        vkCmdDispatch(cmd, (static_count_ + 255) / 256, 1, 1);

        insert_compute_barrier(cmd);

        // Static radix sort
        dispatch_radix_sort(cmd, static_sort_size_, static_sort_workgroups_,
            static_histogram_set_a_, static_histogram_set_b_,
            static_scan_set_,
            static_scatter_set_ab_, static_scatter_set_ba_);

        static_dirty_ = false;
    }

    // === PHASE 3: MERGE ===
    {
        // Determine which sort buffer holds the final result
        // (even passes → result in A, for both static and dynamic)
        // Update merge_set_ bindings if needed based on ping-pong state
        // With num_sort_passes_=2, result is always in buffer A

        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, merge_pipeline_);
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
            merge_pipeline_layout_, 0, 1, &merge_set_, 0, nullptr);
        uint32_t total = max_static_count_ + max_dynamic_count_;
        vkCmdDispatch(cmd, (total + 255) / 256, 1, 1);

        insert_compute_barrier(cmd);
    }

    // === PHASE 4: RENDER (unchanged tile rasterizer) ===
    {
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, render_pipeline_);
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
            render_pipeline_layout_, 0, 1, &render_set_, 0, nullptr);
        uint32_t tiles_x = (width + 15) / 16;
        uint32_t tiles_y = (height + 15) / 16;
        vkCmdDispatch(cmd, tiles_x, tiles_y, 1);
    }
```

- [ ] **Step 2: Extract radix sort dispatch into helper method**

Add a private method `dispatch_radix_sort()` that encapsulates the 3-dispatch-per-digit loop, parameterized by sort size, workgroup count, and descriptor sets:

```cpp
void GsRenderer::dispatch_radix_sort(
    VkCommandBuffer cmd, uint32_t sort_size, uint32_t num_workgroups,
    VkDescriptorSet hist_a, VkDescriptorSet hist_b,
    VkDescriptorSet scan,
    VkDescriptorSet scatter_ab, VkDescriptorSet scatter_ba)
{
    uint32_t histogram_count = 256 * num_workgroups;
    for (uint32_t digit = 0; digit < num_sort_passes_; ++digit) {
        uint32_t digit_shift = digit * 8;
        bool read_from_a = (digit % 2 == 0);
        uint32_t push_data[2] = {sort_size, digit_shift};

        // Histogram
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, radix_histogram_pipeline_);
        auto hist_set = read_from_a ? hist_a : hist_b;
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
            radix_histogram_pipeline_layout_, 0, 1, &hist_set, 0, nullptr);
        vkCmdPushConstants(cmd, radix_histogram_pipeline_layout_,
            VK_SHADER_STAGE_COMPUTE_BIT, 0, 8, push_data);
        vkCmdDispatch(cmd, num_workgroups, 1, 1);

        insert_compute_barrier(cmd);

        // Scan
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, radix_scan_pipeline_);
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
            radix_scan_pipeline_layout_, 0, 1, &scan, 0, nullptr);
        vkCmdPushConstants(cmd, radix_scan_pipeline_layout_,
            VK_SHADER_STAGE_COMPUTE_BIT, 0, 4, &histogram_count);
        vkCmdDispatch(cmd, 1, 1, 1);

        insert_compute_barrier(cmd);

        // Scatter
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, radix_scatter_pipeline_);
        auto scat_set = read_from_a ? scatter_ab : scatter_ba;
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
            radix_scatter_pipeline_layout_, 0, 1, &scat_set, 0, nullptr);
        vkCmdPushConstants(cmd, radix_scatter_pipeline_layout_,
            VK_SHADER_STAGE_COMPUTE_BIT, 0, 8, push_data);
        vkCmdDispatch(cmd, num_workgroups, 1, 1);

        insert_compute_barrier(cmd);
    }
}
```

Declare this in the header as a private method:
```cpp
    void dispatch_radix_sort(VkCommandBuffer cmd, uint32_t sort_size, uint32_t num_workgroups,
        VkDescriptorSet hist_a, VkDescriptorSet hist_b, VkDescriptorSet scan,
        VkDescriptorSet scatter_ab, VkDescriptorSet scatter_ba);
```

- [ ] **Step 3: Verify build compiles**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds (link errors from renderer.cpp calling new APIs are expected and fixed in Task 8)

- [ ] **Step 4: Commit**

```bash
git add src/engine/gs_renderer.cpp include/gseurat/engine/gs_renderer.hpp
git commit -m "feat(gs): implement 4-phase render dispatch with radix sort helper"
```

---

### Task 8: Update Renderer CPU-side data flow

**Files:**
- Modify: `include/gseurat/engine/renderer.hpp:221-229`
- Modify: `src/engine/renderer.cpp:828-1001`

Replace the single `gs_active_buffer_` / `gs_scene_buffer_` merge with separate static and dynamic paths.

- [ ] **Step 1: Update Renderer header members**

In `include/gseurat/engine/renderer.hpp`, replace the buffer members (around lines 221-229):

```cpp
    // Replace:
    // std::vector<Gaussian> gs_active_buffer_;
    // std::vector<Gaussian> gs_scene_buffer_;
    // uint32_t gs_scene_base_count_ = 0;

    // With:
    std::vector<Gaussian> gs_static_buffer_;
    std::vector<Gaussian> gs_dynamic_buffer_;
    glm::mat4 gs_prev_view_{0.0f};  // for camera dirty detection
    bool gs_static_force_dirty_ = false;
```

Keep `gs_particle_emitters_`, `gs_animator_`, `gs_scene_animations_`, `vfx_instances_`, `gs_prev_visible_` as-is.

- [ ] **Step 2: Rewrite record_gs_prepass() static path**

In the chunk culling section (lines 828-880), change the gather + upload to use `gs_static_buffer_` and `update_static_gaussians()`:

```cpp
    if (flags.gs_rendering && gs_initialized_ && gs_renderer_.has_cloud()) {
        // Camera dirty detection
        bool camera_dirty = (gs_view_ != gs_prev_view_)
                         || budget_changed
                         || gs_static_force_dirty_;
        if (camera_dirty) {
            gs_prev_view_ = gs_view_;
            gs_static_force_dirty_ = false;
        }

        if (flags.gs_chunk_culling && !gs_skip_chunk_cull_ && !gs_chunk_grid_.empty()) {
            glm::mat4 gs_vp = gs_proj_ * gs_view_;
            auto visible = gs_chunk_grid_.visible_chunks(gs_vp);

            if (visible != gs_prev_visible_ || budget_changed) {
                camera_dirty = true;
                if (gs_budget_locked_) {
                    gs_budget_locked_ = false;
                    gs_stable_frame_count_ = 0;
                }
            }
            gs_prev_visible_ = visible;

            if (camera_dirty) {
                // Rebuild static buffer
                if (flags.gs_lod && gs_gaussian_budget_ > 0) {
                    glm::vec3 cam_pos = glm::vec3(glm::inverse(gs_view_)[3]);
                    gs_chunk_grid_.gather_lod(visible, cam_pos, gs_gaussian_budget_,
                                              gs_static_buffer_);
                } else {
                    gs_chunk_grid_.gather(visible, gs_static_buffer_);
                }

                // Append VFX object PLY geometry to static
                for (auto& inst : vfx_instances_) {
                    inst.append_objects(gs_static_buffer_);
                }

                // Upload static
                if (!gs_static_buffer_.empty()) {
                    gs_renderer_.update_static_gaussians(
                        gs_static_buffer_.data(),
                        static_cast<uint32_t>(gs_static_buffer_.size()));
                }
            }
        }
```

- [ ] **Step 3: Rewrite dynamic path**

Replace the particle/animation section (lines 882-998):

```cpp
        // === Dynamic path (every frame) ===
        gs_dynamic_buffer_.clear();

        // Particles
        if (flags.particles) {
            for (auto& emitter : gs_particle_emitters_) {
                emitter.update(dt);
                emitter.gather(gs_dynamic_buffer_);
            }
            gs_particle_emitters_.erase(
                std::remove_if(gs_particle_emitters_.begin(), gs_particle_emitters_.end(),
                    [](const GaussianParticleEmitter& e) { return !e.active() && e.alive_count() == 0; }),
                gs_particle_emitters_.end());
        }

        // VFX instance emitter particles
        if (flags.particles || flags.animation) {
            for (auto& inst : vfx_instances_) {
                inst.update(dt, gs_dynamic_buffer_, gs_animator_);
            }
            std::erase_if(vfx_instances_,
                [](const VfxInstance& i) { return i.is_finished(); });
        }

        // VFX lights (unchanged logic)
        {
            auto all_lights = gs_static_lights_;
            for (const auto& inst : vfx_instances_) {
                for (const auto& vl : inst.active_lights()) {
                    if (all_lights.size() < 8) all_lights.push_back(vl);
                }
            }
            if (!all_lights.empty()) {
                if (gs_renderer_.light_mode() < 2) gs_renderer_.set_light_mode(2);
                gs_renderer_.set_point_lights(all_lights);
            }
        }

        // Upload dynamic
        if (!gs_dynamic_buffer_.empty()) {
            gs_renderer_.update_dynamic_gaussians(
                gs_dynamic_buffer_.data(),
                static_cast<uint32_t>(gs_dynamic_buffer_.size()));
        } else {
            // Ensure dynamic count is 0 so merge skips it
            gs_renderer_.update_dynamic_gaussians(nullptr, 0);
        }

        gs_renderer_.render(cmd, gs_view_, gs_proj_);
    }
```

Note: Scene animations with the animator (the phase state machine) need adaptation — tagged Gaussians should be copied from `gs_static_buffer_` to `gs_dynamic_buffer_` on animation start, and `gs_static_force_dirty_` set. For the initial implementation, simplify by running animator transforms on the dynamic buffer only. The full animator integration can be refined in a follow-up.

- [ ] **Step 4: Update any remaining references to gs_active_buffer_ / gs_scene_buffer_**

Search for remaining uses:
```bash
grep -rn "gs_active_buffer_\|gs_scene_buffer_\|gs_scene_base_count_" src/ include/
```

Update or remove each reference. The `gs_scene_buffer_` was used by the animator's `tag_region()` — this now operates on `gs_static_buffer_` (for region identification) but copies to `gs_dynamic_buffer_` for actual animation.

- [ ] **Step 5: Verify build**

Run: `cmake --build --preset macos-debug 2>&1 | tail -20`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add include/gseurat/engine/renderer.hpp src/engine/renderer.cpp
git commit -m "feat(gs): split Renderer CPU data flow into static/dynamic paths"
```

---

### Task 9: Update shutdown and cleanup

**Files:**
- Modify: `src/engine/gs_renderer.cpp` — `shutdown()` method

- [ ] **Step 1: Destroy new buffers in shutdown()**

Add destruction of all new buffers and pipeline objects:

```cpp
    static_gaussian_ssbo_.destroy(allocator);
    dynamic_gaussian_ssbo_.destroy(allocator);
    static_sort_a_.destroy(allocator);
    static_sort_b_.destroy(allocator);
    dynamic_sort_a_.destroy(allocator);
    dynamic_sort_b_.destroy(allocator);
    static_histogram_ssbo_.destroy(allocator);
    dynamic_histogram_ssbo_.destroy(allocator);
    merged_sort_ssbo_.destroy(allocator);
    counts_ssbo_.destroy(allocator);

    if (merge_pipeline_) vkDestroyPipeline(device_, merge_pipeline_, nullptr);
    if (merge_pipeline_layout_) vkDestroyPipelineLayout(device_, merge_pipeline_layout_, nullptr);
    if (merge_layout_) vkDestroyDescriptorSetLayout(device_, merge_layout_, nullptr);
```

- [ ] **Step 2: Verify build**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/engine/gs_renderer.cpp
git commit -m "feat(gs): add cleanup for split buffers and merge pipeline"
```

---

### Task 10: Integration testing and verification

**Files:**
- No new files — run existing demo

- [ ] **Step 1: Build in debug mode**

Run: `cmake --build --preset macos-debug`
Expected: Clean build, no errors

- [ ] **Step 2: Copy assets and run demo**

```bash
cp -R assets/* build/macos-debug/assets/
```

Launch the demo and verify:
1. Static terrain/props render correctly
2. Particles (P key) render and are depth-sorted with terrain
3. Camera rotation triggers static re-sort (no stale frames)
4. Camera stationary → only dynamic pipeline runs (check via debug HUD or log)
5. No ghost artifacts, no flickering, no Z-fighting

- [ ] **Step 3: Test edge cases**

1. No particles (P off, N off) — pure static, merge skips dynamic
2. Particles only, no camera movement — static cached, only dynamic sorts
3. Rapid camera movement — static re-sorts every frame (same as before, no regression)

- [ ] **Step 4: Commit any fixes**

```bash
git add -u
git commit -m "fix(gs): integration fixes for index-merge architecture"
```

---

## Verification Summary

| Check | How |
|-------|-----|
| Shaders compile | `cmake --build --preset macos-debug --target shaders` |
| Full build | `cmake --build --preset macos-debug` |
| Static rendering | Disable particles, terrain renders correctly |
| Dynamic particles | Enable particles, correct depth ordering |
| Static caching | Camera still → Phase 2 skipped |
| No flicker | Static content stable when camera stationary |
| No ghosts | Clear images before render, proper barriers |
| No Z-fighting | Stable merge with static-first tie-breaking |
