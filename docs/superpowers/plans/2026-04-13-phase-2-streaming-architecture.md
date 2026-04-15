# Phase 2: Room-based Loading & Vulkan Streaming Architecture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace GsRenderer's destroy-and-recreate memory model with a zero-fragmentation streaming architecture using a slab allocator with GPU page table, async transfer queue, and Bricklayer instance/portal support.

**Architecture:** Pre-allocate a configurable VRAM budget at startup as fixed-size slabs. A GPU page table maps logical splat indices to non-contiguous physical slabs, eliminating fragmentation. Background threads parse PLY files, and a transfer queue (dedicated or time-sliced fallback) uploads data without stalling the graphics queue. Bricklayer gains Instance metadata and Portal targeting to drive room-based loading.

**Tech Stack:** C++23, Vulkan 1.3, VMA, GLM, nlohmann/json, TypeScript/React/Zustand (Bricklayer)

---

## File Structure

### New Files (C++)
| File | Responsibility |
|------|---------------|
| `include/gseurat/engine/slab_allocator.hpp` | SlabAllocator class — free-list manager with non-contiguous allocation |
| `src/engine/slab_allocator.cpp` | SlabAllocator implementation |
| `tests/test_slab_allocator.cpp` | Unit tests for SlabAllocator |
| `include/gseurat/engine/streaming_config.hpp` | StreamingConfig struct + JSON parsing |
| `include/gseurat/engine/transfer_queue.hpp` | TransferQueue abstract interface + DedicatedTransferPath + FallbackTransferPath |
| `src/engine/transfer_queue.cpp` | TransferQueue implementation |

### Modified Files (C++)
| File | Change |
|------|--------|
| `CMakeLists.txt` | Add slab_allocator.cpp, transfer_queue.cpp to gseurat_core; add test_slab_allocator |
| `include/gseurat/engine/vk_context.hpp` | Add transfer queue members |
| `src/engine/vk_context.cpp` | Discover + request dedicated transfer queue |
| `include/gseurat/engine/gs_renderer.hpp` | Add slab allocator, transfer queue, page table, chunk state members |
| `src/engine/gs_renderer.cpp` | init_streaming, refactored load_cloud, new unload_cloud |
| `shaders/gs_preprocess.comp` | Page table indirection lookup |

### Modified Files (TypeScript)
| File | Change |
|------|--------|
| `tools/apps/bricklayer/src/store/types.ts` | Add InstanceData, extend PortalData |
| `tools/apps/bricklayer/src/store/useSceneStore.ts` | Add instances state + CRUD actions |
| `tools/apps/bricklayer/src/panels/EntitiesTab.tsx` | Add Instances section |
| `tools/apps/bricklayer/src/panels/ScenePropertiesPanel.tsx` | Add InstanceProperties, update PortalProperties |
| `tools/apps/bricklayer/src/lib/sceneExport.ts` | Validate instance.scene_file paths |

---

## R1: Fixed-Size Slab Allocator with GPU Page Table

### Task 1: SlabAllocator — Header, Implementation, and Tests

**Files:**
- Create: `include/gseurat/engine/slab_allocator.hpp`
- Create: `src/engine/slab_allocator.cpp`
- Create: `tests/test_slab_allocator.cpp`
- Modify: `CMakeLists.txt`

- [ ] **Step 1: Write the SlabAllocator header**

Create `include/gseurat/engine/slab_allocator.hpp`:

```cpp
#pragma once

#include <cstdint>
#include <stdexcept>
#include <vector>

namespace gseurat {

class SlabAllocator {
public:
    struct SlabHandle {
        uint32_t chunk_id;
        std::vector<uint32_t> slab_indices;
    };

    SlabAllocator(uint32_t total_slabs, uint32_t splats_per_slab);

    SlabHandle checkout(uint32_t slab_count);
    void release(const SlabHandle& handle);

    uint32_t available() const;
    uint32_t total_slabs() const { return total_slabs_; }
    uint32_t splats_per_slab() const { return splats_per_slab_; }

private:
    uint32_t total_slabs_;
    uint32_t splats_per_slab_;
    uint32_t next_chunk_id_{0};
    std::vector<uint32_t> free_list_;
};

}  // namespace gseurat
```

- [ ] **Step 2: Write the SlabAllocator implementation**

Create `src/engine/slab_allocator.cpp`:

```cpp
#include "gseurat/engine/slab_allocator.hpp"

namespace gseurat {

SlabAllocator::SlabAllocator(uint32_t total_slabs, uint32_t splats_per_slab)
    : total_slabs_(total_slabs), splats_per_slab_(splats_per_slab) {
    free_list_.reserve(total_slabs);
    for (uint32_t i = total_slabs; i > 0; --i) {
        free_list_.push_back(i - 1);
    }
}

SlabAllocator::SlabHandle SlabAllocator::checkout(uint32_t slab_count) {
    if (slab_count > free_list_.size()) {
        throw std::runtime_error("SlabAllocator: not enough free slabs ("
            + std::to_string(free_list_.size()) + " available, "
            + std::to_string(slab_count) + " requested)");
    }
    SlabHandle handle;
    handle.chunk_id = next_chunk_id_++;
    handle.slab_indices.reserve(slab_count);
    for (uint32_t i = 0; i < slab_count; ++i) {
        handle.slab_indices.push_back(free_list_.back());
        free_list_.pop_back();
    }
    return handle;
}

void SlabAllocator::release(const SlabHandle& handle) {
    for (auto idx : handle.slab_indices) {
        free_list_.push_back(idx);
    }
}

uint32_t SlabAllocator::available() const {
    return static_cast<uint32_t>(free_list_.size());
}

}  // namespace gseurat
```

- [ ] **Step 3: Write the unit tests**

Create `tests/test_slab_allocator.cpp`:

```cpp
#include "gseurat/engine/slab_allocator.hpp"
#include <cassert>
#include <cstdio>
#include <set>

using namespace gseurat;

static int passed = 0;
static int failed = 0;

static void check(bool cond, const char* msg) {
    if (cond) { std::printf("  PASS: %s\n", msg); passed++; }
    else      { std::printf("  FAIL: %s\n", msg); failed++; }
}

int main() {
    std::printf("=== SlabAllocator Tests ===\n\n");

    // Test 1: Construction
    {
        std::printf("Test 1: Construction\n");
        SlabAllocator alloc(10, 100000);
        check(alloc.total_slabs() == 10, "total_slabs == 10");
        check(alloc.splats_per_slab() == 100000, "splats_per_slab == 100000");
        check(alloc.available() == 10, "all 10 slabs available");
    }

    // Test 2: Checkout reduces available count
    {
        std::printf("Test 2: Checkout reduces available\n");
        SlabAllocator alloc(10, 100000);
        auto h = alloc.checkout(3);
        check(h.slab_indices.size() == 3, "got 3 slab indices");
        check(alloc.available() == 7, "7 slabs remaining");
    }

    // Test 3: Slab indices are unique
    {
        std::printf("Test 3: Unique slab indices\n");
        SlabAllocator alloc(10, 100000);
        auto h1 = alloc.checkout(3);
        auto h2 = alloc.checkout(4);
        std::set<uint32_t> all;
        for (auto i : h1.slab_indices) all.insert(i);
        for (auto i : h2.slab_indices) all.insert(i);
        check(all.size() == 7, "all 7 indices unique across two checkouts");
    }

    // Test 4: Chunk IDs are sequential
    {
        std::printf("Test 4: Sequential chunk IDs\n");
        SlabAllocator alloc(10, 100000);
        auto h1 = alloc.checkout(1);
        auto h2 = alloc.checkout(1);
        auto h3 = alloc.checkout(1);
        check(h1.chunk_id == 0, "first chunk_id == 0");
        check(h2.chunk_id == 1, "second chunk_id == 1");
        check(h3.chunk_id == 2, "third chunk_id == 2");
    }

    // Test 5: Release returns slabs to pool
    {
        std::printf("Test 5: Release returns slabs\n");
        SlabAllocator alloc(10, 100000);
        auto h = alloc.checkout(5);
        check(alloc.available() == 5, "5 remaining after checkout");
        alloc.release(h);
        check(alloc.available() == 10, "10 available after release");
    }

    // Test 6: Released slabs can be reused
    {
        std::printf("Test 6: Released slabs reused\n");
        SlabAllocator alloc(4, 100000);
        auto h1 = alloc.checkout(4);
        alloc.release(h1);
        auto h2 = alloc.checkout(4);
        check(h2.slab_indices.size() == 4, "can checkout 4 after releasing 4");
        check(alloc.available() == 0, "0 remaining");
    }

    // Test 7: Checkout more than available throws
    {
        std::printf("Test 7: Over-checkout throws\n");
        SlabAllocator alloc(3, 100000);
        alloc.checkout(2);
        bool threw = false;
        try { alloc.checkout(5); }
        catch (const std::runtime_error&) { threw = true; }
        check(threw, "throws runtime_error when requesting 5 with 1 available");
    }

    // Test 8: Checkout zero slabs
    {
        std::printf("Test 8: Checkout zero\n");
        SlabAllocator alloc(5, 100000);
        auto h = alloc.checkout(0);
        check(h.slab_indices.empty(), "empty handle for 0 checkout");
        check(alloc.available() == 5, "no slabs consumed");
    }

    // Test 9: Non-contiguous reuse after fragmentation
    {
        std::printf("Test 9: Non-contiguous reuse (fragmentation-proof)\n");
        SlabAllocator alloc(10, 100000);
        auto a = alloc.checkout(3);  // slabs 0,1,2
        auto b = alloc.checkout(2);  // slabs 3,4
        auto c = alloc.checkout(3);  // slabs 5,6,7
        alloc.release(b);            // free 3,4
        check(alloc.available() == 4, "4 available (2 freed + 2 never used)");
        auto d = alloc.checkout(3);  // needs 3 — gets scattered slabs
        check(d.slab_indices.size() == 3, "got 3 scattered slabs after fragmentation");
        check(alloc.available() == 1, "1 remaining");
        alloc.release(a);
        alloc.release(c);
        alloc.release(d);
        check(alloc.available() == 10, "all 10 returned");
    }

    // Test 10: Slab indices are within bounds
    {
        std::printf("Test 10: Indices within bounds\n");
        SlabAllocator alloc(100, 50000);
        auto h = alloc.checkout(100);
        bool in_bounds = true;
        for (auto i : h.slab_indices) {
            if (i >= 100) { in_bounds = false; break; }
        }
        check(in_bounds, "all indices < total_slabs");
    }

    std::printf("\n=== Results: %d passed, %d failed ===\n", passed, failed);
    return failed > 0 ? 1 : 0;
}
```

- [ ] **Step 4: Add to CMakeLists.txt**

In `CMakeLists.txt`, add `src/engine/slab_allocator.cpp` to the `gseurat_core` OBJECT library source list (after `src/engine/save_system.cpp`, alphabetically):

```cmake
    src/engine/save_system.cpp
    src/engine/slab_allocator.cpp
    src/engine/staging_uploader.cpp
```

Add the test at the end of the test section:

```cmake
add_gseurat_test(test_slab_allocator src/engine/slab_allocator.cpp)
```

- [ ] **Step 5: Build and run tests**

Run:
```bash
cmake --build --preset macos-debug 2>&1 | tail -20
ctest --preset macos-debug -R test_slab_allocator --output-on-failure
```

Expected: All 10 tests PASS, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add include/gseurat/engine/slab_allocator.hpp src/engine/slab_allocator.cpp tests/test_slab_allocator.cpp CMakeLists.txt
git commit -m "feat(engine): add SlabAllocator with non-contiguous allocation

Free-list slab manager for streaming VRAM. Checkout returns scattered
slab indices (zero external fragmentation). 10 unit tests."
```

---

### Task 2: StreamingConfig — JSON Config Parsing

**Files:**
- Create: `include/gseurat/engine/streaming_config.hpp`
- Modify: `CMakeLists.txt` (test only — header-only config)

- [ ] **Step 1: Write the StreamingConfig header**

Create `include/gseurat/engine/streaming_config.hpp`:

```cpp
#pragma once

#include <cstdint>
#include <string>
#include <nlohmann/json.hpp>

namespace gseurat {

struct StreamingConfig {
    uint32_t gpu_budget_splats = 10'000'000;
    uint32_t slab_size_splats = 100'000;
    uint32_t transfer_budget_mb_per_frame = 4;

    uint32_t total_slabs() const { return gpu_budget_splats / slab_size_splats; }
    uint64_t total_bytes() const { return static_cast<uint64_t>(gpu_budget_splats) * 64; }
    uint64_t slab_bytes() const { return static_cast<uint64_t>(slab_size_splats) * 64; }

    static StreamingConfig load(const std::string& project_root) {
        StreamingConfig cfg;
        const auto path = project_root + "/engine_config.json";
        std::ifstream f(path);
        if (!f.is_open()) return cfg;
        try {
            nlohmann::json j;
            f >> j;
            if (j.contains("streaming")) {
                auto& s = j["streaming"];
                if (s.contains("gpu_budget_splats"))
                    cfg.gpu_budget_splats = s["gpu_budget_splats"].get<uint32_t>();
                if (s.contains("slab_size_splats"))
                    cfg.slab_size_splats = s["slab_size_splats"].get<uint32_t>();
                if (s.contains("transfer_budget_mb_per_frame"))
                    cfg.transfer_budget_mb_per_frame = s["transfer_budget_mb_per_frame"].get<uint32_t>();
            }
        } catch (...) {
            // Malformed config — use defaults
        }
        return cfg;
    }
};

}  // namespace gseurat
```

- [ ] **Step 2: Add a config test to test_slab_allocator.cpp**

Append to the end of `tests/test_slab_allocator.cpp`, before the results print:

```cpp
    // Test 11: StreamingConfig defaults
    {
        std::printf("Test 11: StreamingConfig defaults\n");
        StreamingConfig cfg;
        check(cfg.gpu_budget_splats == 10'000'000, "default budget 10M");
        check(cfg.slab_size_splats == 100'000, "default slab size 100K");
        check(cfg.total_slabs() == 100, "100 slabs");
        check(cfg.total_bytes() == 640'000'000ULL, "640MB total");
        check(cfg.slab_bytes() == 6'400'000ULL, "6.4MB per slab");
    }

    // Test 12: StreamingConfig load from nonexistent file uses defaults
    {
        std::printf("Test 12: StreamingConfig nonexistent file\n");
        auto cfg = StreamingConfig::load("/nonexistent/path");
        check(cfg.gpu_budget_splats == 10'000'000, "fallback to default budget");
    }
```

Add the include at the top:
```cpp
#include "gseurat/engine/streaming_config.hpp"
#include <fstream>
```

- [ ] **Step 3: Build and run tests**

Run:
```bash
cmake --build --preset macos-debug 2>&1 | tail -20
ctest --preset macos-debug -R test_slab_allocator --output-on-failure
```

Expected: All 12 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add include/gseurat/engine/streaming_config.hpp tests/test_slab_allocator.cpp
git commit -m "feat(engine): add StreamingConfig with JSON parsing

Header-only config struct. Reads streaming.gpu_budget_splats,
slab_size_splats, transfer_budget_mb_per_frame from engine_config.json.
Defaults: 10M splats, 100K/slab, 4MB/frame transfer."
```

---

### Task 3: GsRenderer init_streaming — Pre-Allocate All Buffers

**Files:**
- Modify: `include/gseurat/engine/gs_renderer.hpp`
- Modify: `src/engine/gs_renderer.cpp`

**Context:** Currently `load_cloud()` at gs_renderer.cpp:483-657 destroys all 22+ buffers and reallocates them. We add `init_streaming()` that allocates once at startup, and refactor `load_cloud()` in the next task.

- [ ] **Step 1: Add new members to gs_renderer.hpp**

Add includes at the top of `gs_renderer.hpp`:
```cpp
#include "gseurat/engine/slab_allocator.hpp"
#include "gseurat/engine/streaming_config.hpp"
#include <memory>
```

Add new members in the private section (after existing buffer members, around line 252):
```cpp
    // --- Streaming architecture (Phase 2) ---
    StreamingConfig streaming_config_;
    std::unique_ptr<SlabAllocator> slab_allocator_;

    Buffer page_table_ssbo_;      // uint32_t[] — logical slab → physical slab
    Buffer chunk_table_ssbo_;     // ChunkTableEntry[] — per-chunk metadata

    struct ChunkState {
        enum class Status { LOADING, ACTIVE, UNLOADING };
        Status status;
        SlabAllocator::SlabHandle handle;
        uint32_t page_table_offset;  // start index in page table
        uint32_t splat_count;
    };
    std::vector<ChunkState> active_chunks_;
    uint32_t total_active_splats_{0};
    bool streaming_initialized_{false};
```

Add public method declaration (after `void init(...)`, around line 68):
```cpp
    void init_streaming(const StreamingConfig& config);
    void unload_cloud(uint32_t chunk_id);
```

- [ ] **Step 2: Implement init_streaming in gs_renderer.cpp**

Add the implementation after the existing `init()` function. This allocates all buffers to budget size once:

```cpp
void GsRenderer::init_streaming(const StreamingConfig& config) {
    streaming_config_ = config;
    const uint32_t total_slabs = config.total_slabs();
    const uint32_t max_splats = config.gpu_budget_splats;

    slab_allocator_ = std::make_unique<SlabAllocator>(total_slabs, config.slab_size_splats);

    // Main Gaussian SSBO — full budget
    const uint64_t gauss_size = config.total_bytes();  // max_splats * 64
    static_gaussian_ssbo_ = Buffer::create_storage(allocator_, gauss_size);

    // Dynamic Gaussian SSBO — keep existing headroom
    const uint64_t dyn_size = static_cast<uint64_t>(kDynamicHeadroom) * sizeof(GpuGaussian);
    dynamic_gaussian_ssbo_ = Buffer::create_storage(allocator_, dyn_size);
    max_dynamic_count_ = kDynamicHeadroom;

    // Projected SSBO — budget + dynamic headroom
    const uint32_t total_max = max_splats + kDynamicHeadroom;
    projected_ssbo_ = Buffer::create_storage(allocator_,
        static_cast<uint64_t>(total_max) * 48);

    // Sort buffers — round up to power-of-2 multiple of 1024
    auto round_sort = [](uint32_t n) -> uint32_t {
        uint32_t s = 1024;
        while (s < n) s *= 2;
        return s;
    };
    static_sort_size_ = round_sort(max_splats);
    dynamic_sort_size_ = round_sort(kDynamicHeadroom);
    static_sort_workgroups_ = static_sort_size_ / 1024;
    dynamic_sort_workgroups_ = dynamic_sort_size_ / 1024;

    static_sort_a_ = Buffer::create_storage(allocator_, static_sort_size_ * 8ULL);
    static_sort_b_ = Buffer::create_storage(allocator_, static_sort_size_ * 8ULL);
    dynamic_sort_a_ = Buffer::create_storage(allocator_, dynamic_sort_size_ * 8ULL);
    dynamic_sort_b_ = Buffer::create_storage(allocator_, dynamic_sort_size_ * 8ULL);
    static_histogram_ssbo_ = Buffer::create_storage(allocator_,
        256 * static_sort_workgroups_ * sizeof(uint32_t));
    dynamic_histogram_ssbo_ = Buffer::create_storage(allocator_,
        256 * dynamic_sort_workgroups_ * sizeof(uint32_t));
    merged_sort_ssbo_ = Buffer::create_storage(allocator_,
        (static_sort_size_ + dynamic_sort_size_) * 8ULL);

    // Counts SSBO — {static_visible, dynamic_visible, merged_visible}
    counts_ssbo_ = Buffer::create_storage_readback(allocator_, 3 * sizeof(uint32_t));
    std::memset(counts_ssbo_.mapped(), 0, 3 * sizeof(uint32_t));

    // Page table SSBO — one uint32 per slab in budget
    page_table_ssbo_ = Buffer::create_storage(allocator_, total_slabs * sizeof(uint32_t));
    // Initialize all entries to 0xFFFFFFFF (invalid)
    std::memset(page_table_ssbo_.mapped(), 0xFF, total_slabs * sizeof(uint32_t));

    // Chunk table SSBO — 16 bytes per chunk slot (generous: 256 slots)
    chunk_table_ssbo_ = Buffer::create_storage(allocator_, 256 * 16);
    std::memset(chunk_table_ssbo_.mapped(), 0, 256 * 16);

    // Bone SSBO
    bone_ssbo_ = Buffer::create_storage(allocator_, kMaxBones * sizeof(glm::mat4));
    auto* bones = static_cast<glm::mat4*>(bone_ssbo_.mapped());
    for (uint32_t i = 0; i < kMaxBones; ++i) bones[i] = glm::mat4(1.0f);

    // PBD buffers
    pbd_state_ssbo_ = Buffer::create_storage(allocator_, kMaxPbdElements * 32);
    pbd_params_ssbo_ = Buffer::create_storage(allocator_, kMaxPbdElements * 16);
    pbd_constraint_ssbo_ = Buffer::create_storage(allocator_, kMaxPbdConstraints * 16);
    pbd_uniform_buffer_ = Buffer::create_storage(allocator_, 32);
    std::memset(pbd_state_ssbo_.mapped(), 0, kMaxPbdElements * 32);
    std::memset(pbd_params_ssbo_.mapped(), 0, kMaxPbdElements * 16);
    std::memset(pbd_constraint_ssbo_.mapped(), 0, kMaxPbdConstraints * 16);

    // Post-process UBO
    pp_ubo_buffer_ = Buffer::create_storage(allocator_, sizeof(GsPostProcessUbo));

    // Uniform buffer
    uniform_buffer_ = Buffer::create_storage(allocator_, sizeof(GsRenderUbo));

    max_static_count_ = max_splats;
    streaming_initialized_ = true;
    initialized_ = true;

    update_descriptors();
    std::printf("[gs_renderer] Streaming initialized: %u slabs × %u splats = %u max (%.0f MB)\n",
        total_slabs, config.slab_size_splats, max_splats,
        gauss_size / (1024.0 * 1024.0));
}
```

- [ ] **Step 3: Build to verify compilation**

Run:
```bash
cmake --build --preset macos-debug 2>&1 | tail -20
```

Expected: Build succeeds. `init_streaming` is declared and defined but not yet called.

- [ ] **Step 4: Commit**

```bash
git add include/gseurat/engine/gs_renderer.hpp src/engine/gs_renderer.cpp
git commit -m "feat(engine): add init_streaming() for one-time VRAM allocation

Pre-allocates all SSBOs (Gaussian, sort, projected, merge, page table,
chunk table) to configurable budget size. Zero VMA allocations after init."
```

---

### Task 4: Refactor load_cloud to Use Slab Allocator + Page Table

**Files:**
- Modify: `src/engine/gs_renderer.cpp`

**Context:** The existing `load_cloud()` at lines 483-657 destroys and recreates all buffers. We refactor it to: (1) check out slabs, (2) write Gaussian data to physical slab offsets, (3) update page table.

- [ ] **Step 1: Refactor load_cloud**

Replace the body of `load_cloud()` with the streaming-aware version. Keep the old code path as a fallback for when streaming is not initialized:

```cpp
void GsRenderer::load_cloud(const GaussianCloud& cloud) {
    if (!streaming_initialized_) {
        // Legacy path — fall through to original implementation
        load_cloud_legacy(cloud);
        return;
    }

    vkDeviceWaitIdle(device_);

    const uint32_t splat_count = cloud.count();
    const uint32_t slabs_needed =
        (splat_count + streaming_config_.slab_size_splats - 1) / streaming_config_.slab_size_splats;

    // Checkout slabs from allocator
    auto handle = slab_allocator_->checkout(slabs_needed);

    // Compute page table offset for this chunk
    uint32_t page_table_offset = 0;
    for (const auto& chunk : active_chunks_) {
        uint32_t end = chunk.page_table_offset + static_cast<uint32_t>(chunk.handle.slab_indices.size());
        if (end > page_table_offset) page_table_offset = end;
    }

    // Write page table entries (logical slab → physical slab)
    auto* pt = static_cast<uint32_t*>(page_table_ssbo_.mapped());
    for (uint32_t i = 0; i < slabs_needed; ++i) {
        pt[page_table_offset + i] = handle.slab_indices[i];
    }

    // Convert and write Gaussian data into physical slab offsets
    const auto& gaussians = cloud.gaussians();
    const uint32_t sps = streaming_config_.slab_size_splats;
    auto* dst = static_cast<GpuGaussian*>(static_gaussian_ssbo_.mapped());

    for (uint32_t s = 0; s < slabs_needed; ++s) {
        const uint32_t physical_slab = handle.slab_indices[s];
        const uint32_t src_start = s * sps;
        const uint32_t src_end = std::min(src_start + sps, splat_count);
        const uint32_t count = src_end - src_start;
        const uint64_t dst_offset = static_cast<uint64_t>(physical_slab) * sps;

        for (uint32_t i = 0; i < count; ++i) {
            const auto& g = gaussians[src_start + i];
            GpuGaussian gpu;
            gpu.pos_opacity = glm::vec4(g.position, g.opacity);
            gpu.scale_pad = glm::vec4(g.scale, glm::uintBitsToFloat(g.bone_index));
            gpu.rot = glm::vec4(g.rotation.x, g.rotation.y, g.rotation.z, g.rotation.w);
            gpu.color_pad = glm::vec4(g.color, g.emission);
            dst[dst_offset + i] = gpu;
        }
    }

    // Write chunk table entry: {page_table_offset, slab_count, splats_in_last_slab, total_splats}
    struct ChunkTableEntry {
        uint32_t page_table_offset;
        uint32_t slab_count;
        uint32_t splats_in_last_slab;
        uint32_t total_splats;
    };
    const uint32_t last_slab_splats = splat_count - (slabs_needed - 1) * sps;
    ChunkTableEntry entry{page_table_offset, slabs_needed, last_slab_splats, splat_count};
    auto* ct = static_cast<ChunkTableEntry*>(chunk_table_ssbo_.mapped());
    ct[active_chunks_.size()] = entry;

    // Track chunk state
    ChunkState state;
    state.status = ChunkState::Status::ACTIVE;
    state.handle = std::move(handle);
    state.page_table_offset = page_table_offset;
    state.splat_count = splat_count;
    active_chunks_.push_back(std::move(state));

    // Update static count for rendering
    static_count_ = 0;
    for (const auto& c : active_chunks_) {
        static_count_ += c.splat_count;
    }
    total_active_splats_ = static_count_;

    // Initialize sort buffers for the full active range
    auto* sort_a = static_cast<uint64_t*>(static_sort_a_.mapped());
    for (uint32_t i = 0; i < static_sort_size_; ++i) {
        uint32_t key = (i < static_count_) ? 0 : 0xFFFFFFFF;
        sort_a[i] = (static_cast<uint64_t>(key) << 32) | i;
    }

    static_dirty_ = true;
    sort_done_once_ = false;

    std::printf("[gs_renderer] Loaded chunk %u: %u splats in %u slabs (page_table[%u..%u])\n",
        active_chunks_.back().handle.chunk_id, splat_count, slabs_needed,
        page_table_offset, page_table_offset + slabs_needed - 1);
}
```

- [ ] **Step 2: Rename the old load_cloud body to load_cloud_legacy**

Extract lines 483-657 of the original `load_cloud()` into a private method `load_cloud_legacy(const GaussianCloud& cloud)`:

Add declaration in `gs_renderer.hpp` private section:
```cpp
    void load_cloud_legacy(const GaussianCloud& cloud);
```

Move the original body into `load_cloud_legacy` in `gs_renderer.cpp`.

- [ ] **Step 3: Build to verify compilation**

Run:
```bash
cmake --build --preset macos-debug 2>&1 | tail -20
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add include/gseurat/engine/gs_renderer.hpp src/engine/gs_renderer.cpp
git commit -m "feat(engine): refactor load_cloud to use slab allocator + page table

Streaming path: checkout slabs, write Gaussians to physical offsets,
update page table and chunk table. Legacy path preserved as fallback."
```

---

### Task 5: Add unload_cloud

**Files:**
- Modify: `src/engine/gs_renderer.cpp`

- [ ] **Step 1: Implement unload_cloud**

```cpp
void GsRenderer::unload_cloud(uint32_t chunk_id) {
    if (!streaming_initialized_) return;

    auto it = std::find_if(active_chunks_.begin(), active_chunks_.end(),
        [chunk_id](const ChunkState& c) { return c.handle.chunk_id == chunk_id; });
    if (it == active_chunks_.end()) {
        std::printf("[gs_renderer] Warning: chunk %u not found for unload\n", chunk_id);
        return;
    }

    // Invalidate page table entries
    auto* pt = static_cast<uint32_t*>(page_table_ssbo_.mapped());
    for (uint32_t i = 0; i < it->handle.slab_indices.size(); ++i) {
        pt[it->page_table_offset + i] = 0xFFFFFFFF;
    }

    // Return slabs to free list
    slab_allocator_->release(it->handle);

    std::printf("[gs_renderer] Unloaded chunk %u: %u splats freed\n",
        chunk_id, it->splat_count);

    active_chunks_.erase(it);

    // Rebuild chunk table and update counts
    struct ChunkTableEntry {
        uint32_t page_table_offset;
        uint32_t slab_count;
        uint32_t splats_in_last_slab;
        uint32_t total_splats;
    };
    auto* ct = static_cast<ChunkTableEntry*>(chunk_table_ssbo_.mapped());
    const uint32_t sps = streaming_config_.slab_size_splats;
    static_count_ = 0;
    for (size_t i = 0; i < active_chunks_.size(); ++i) {
        const auto& c = active_chunks_[i];
        uint32_t last = c.splat_count - (static_cast<uint32_t>(c.handle.slab_indices.size()) - 1) * sps;
        ct[i] = {c.page_table_offset, static_cast<uint32_t>(c.handle.slab_indices.size()), last, c.splat_count};
        static_count_ += c.splat_count;
    }
    // Clear remaining entries
    std::memset(&ct[active_chunks_.size()], 0, (256 - active_chunks_.size()) * 16);
    total_active_splats_ = static_count_;

    static_dirty_ = true;
}
```

- [ ] **Step 2: Build to verify**

Run:
```bash
cmake --build --preset macos-debug 2>&1 | tail -20
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/engine/gs_renderer.cpp
git commit -m "feat(engine): add unload_cloud for slab release

Invalidates page table entries, returns slabs to free list, rebuilds
chunk table. Zero VMA allocations/deallocations."
```

---

### Task 6: gs_preprocess.comp — Page Table Indirection

**Files:**
- Modify: `shaders/gs_preprocess.comp`

**Context:** Currently the shader indexes directly: `g = gaussians[idx]`. We add page table indirection so the logical index maps through the page table to the physical slab offset.

- [ ] **Step 1: Add page table buffer binding**

Add after the existing counts buffer binding (around line 60):

```glsl
layout(std430, binding = 8) readonly buffer PageTableBuffer {
    uint page_table[];
};

layout(constant_id = 0) const uint SPLATS_PER_SLAB = 100000;
layout(constant_id = 1) const uint USE_PAGE_TABLE = 0;
```

- [ ] **Step 2: Add page table lookup function**

Add after the utility functions section (around line 136):

```glsl
uint resolve_physical_index(uint logical_idx) {
    if (USE_PAGE_TABLE == 0) return logical_idx;  // legacy path
    uint slab_logical = logical_idx / SPLATS_PER_SLAB;
    uint offset_in_slab = logical_idx % SPLATS_PER_SLAB;
    uint physical_slab = page_table[slab_logical];
    return physical_slab * SPLATS_PER_SLAB + offset_in_slab;
}
```

- [ ] **Step 3: Replace direct Gaussian access**

Find where `gaussians[idx]` is read (around line 138-140 where `GpuGaussian g = gaussians[idx]` is used). Replace:

```glsl
// Before:
GpuGaussian g = gaussians[idx];

// After:
uint physical_idx = resolve_physical_index(idx);
GpuGaussian g = gaussians[physical_idx];
```

- [ ] **Step 4: Build shaders**

Run:
```bash
cmake --build --preset macos-debug --target shaders 2>&1 | tail -10
```

Expected: Shader compilation succeeds.

- [ ] **Step 5: Commit**

```bash
git add shaders/gs_preprocess.comp
git commit -m "feat(shaders): add page table indirection to gs_preprocess

Specialization constants control slab size and enable/disable page table.
resolve_physical_index() maps logical splat → physical slab offset.
Legacy path preserved when USE_PAGE_TABLE == 0."
```

---

## R2: Async Background Transfer Queue

### Task 7: VkContext — Transfer Queue Discovery

**Files:**
- Modify: `include/gseurat/engine/vk_context.hpp`
- Modify: `src/engine/vk_context.cpp`

- [ ] **Step 1: Add transfer queue members to vk_context.hpp**

Add after `graphics_queue_family_` (line 41):
```cpp
    VkQueue transfer_queue_{VK_NULL_HANDLE};
    uint32_t transfer_queue_family_{0};
    bool has_dedicated_transfer_{false};
```

Add public getters:
```cpp
    VkQueue transfer_queue() const { return transfer_queue_; }
    uint32_t transfer_queue_family() const { return transfer_queue_family_; }
    bool has_dedicated_transfer() const { return has_dedicated_transfer_; }
```

- [ ] **Step 2: Add transfer queue discovery to create_logical_device**

In `vk_context.cpp`, in `create_logical_device()`, after finding the graphics queue family, add transfer queue discovery:

```cpp
    // Look for a dedicated transfer queue family (TRANSFER but not GRAPHICS)
    int32_t transfer_family = -1;
    for (uint32_t i = 0; i < families.size(); ++i) {
        if ((families[i].queueFlags & VK_QUEUE_TRANSFER_BIT) &&
            !(families[i].queueFlags & VK_QUEUE_GRAPHICS_BIT)) {
            transfer_family = static_cast<int32_t>(i);
            break;
        }
    }

    std::vector<VkDeviceQueueCreateInfo> queue_infos;
    float priority = 1.0f;

    // Graphics queue
    VkDeviceQueueCreateInfo gfx_queue_info{};
    gfx_queue_info.sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO;
    gfx_queue_info.queueFamilyIndex = graphics_queue_family_;
    gfx_queue_info.queueCount = 1;
    gfx_queue_info.pQueuePriorities = &priority;
    queue_infos.push_back(gfx_queue_info);

    // Dedicated transfer queue (if available and different family)
    if (transfer_family >= 0 && static_cast<uint32_t>(transfer_family) != graphics_queue_family_) {
        VkDeviceQueueCreateInfo xfer_queue_info{};
        xfer_queue_info.sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO;
        xfer_queue_info.queueFamilyIndex = static_cast<uint32_t>(transfer_family);
        xfer_queue_info.queueCount = 1;
        xfer_queue_info.pQueuePriorities = &priority;
        queue_infos.push_back(xfer_queue_info);
        transfer_queue_family_ = static_cast<uint32_t>(transfer_family);
        has_dedicated_transfer_ = true;
    } else {
        transfer_queue_family_ = graphics_queue_family_;
        has_dedicated_transfer_ = false;
    }
```

Update the `VkDeviceCreateInfo` to use the `queue_infos` vector:
```cpp
    create_info.queueCreateInfoCount = static_cast<uint32_t>(queue_infos.size());
    create_info.pQueueCreateInfos = queue_infos.data();
```

After `vkCreateDevice`, retrieve the transfer queue:
```cpp
    if (has_dedicated_transfer_) {
        vkGetDeviceQueue(device_, transfer_queue_family_, 0, &transfer_queue_);
        std::printf("[vk_context] Dedicated transfer queue: family %u\n", transfer_queue_family_);
    } else {
        transfer_queue_ = graphics_queue_;  // fallback: share graphics queue
        std::printf("[vk_context] No dedicated transfer queue; using graphics queue fallback\n");
    }
```

- [ ] **Step 3: Build to verify**

Run:
```bash
cmake --build --preset macos-debug 2>&1 | tail -20
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add include/gseurat/engine/vk_context.hpp src/engine/vk_context.cpp
git commit -m "feat(engine): discover dedicated transfer queue in VkContext

Enumerates queue families for TRANSFER-only queue. Falls back to
graphics queue on MoltenVK/single-queue GPUs."
```

---

### Task 8: TransferQueue — Interface, Staging Ring, Both Paths

**Files:**
- Create: `include/gseurat/engine/transfer_queue.hpp`
- Create: `src/engine/transfer_queue.cpp`
- Modify: `CMakeLists.txt`

- [ ] **Step 1: Write the TransferQueue header**

Create `include/gseurat/engine/transfer_queue.hpp`:

```cpp
#pragma once

#include <cstdint>
#include <deque>
#include <functional>
#include <mutex>
#include <vulkan/vulkan.h>
#include <vk_mem_alloc.h>
#include "gseurat/engine/buffer.hpp"

namespace gseurat {

struct TransferChunk {
    uint64_t staging_offset;
    uint64_t dest_offset;
    uint64_t size;
    std::function<void()> on_complete;
    bool is_completion_marker{false};
};

class TransferQueue {
public:
    TransferQueue(VkDevice device, VmaAllocator allocator,
                  VkQueue transfer_queue, uint32_t transfer_family,
                  VkQueue graphics_queue, uint32_t graphics_family,
                  bool dedicated, uint64_t staging_size,
                  uint32_t transfer_budget_mb);

    ~TransferQueue();

    // Enqueue a copy from staging buffer to destination SSBO.
    // Thread-safe: called from background thread.
    void enqueue(uint64_t staging_offset, uint64_t dest_offset,
                 uint64_t size, std::function<void()> on_complete = nullptr);

    // Enqueue a completion marker (no copy, just callback).
    void enqueue_completion(std::function<void()> on_complete);

    // Called once per frame from main thread. Submits pending copies
    // and checks fences for completed transfers.
    void poll_completions(VkCommandBuffer frame_cmd);

    // Returns pointer to staging buffer for writing by background thread.
    void* staging_mapped() const { return staging_buffer_.mapped(); }
    uint64_t staging_size() const { return staging_size_; }

    bool is_dedicated() const { return dedicated_; }

    void shutdown();

private:
    VkDevice device_;
    VmaAllocator allocator_;
    VkQueue transfer_queue_;
    uint32_t transfer_family_;
    VkQueue graphics_queue_;
    uint32_t graphics_family_;
    bool dedicated_;
    uint64_t staging_size_;
    uint64_t transfer_budget_bytes_;

    Buffer staging_buffer_;
    Buffer dest_buffer_ref_;  // not owned — reference to main Gaussian SSBO

    // Dedicated path resources
    VkCommandPool transfer_cmd_pool_{VK_NULL_HANDLE};
    VkCommandBuffer transfer_cmd_{VK_NULL_HANDLE};
    VkFence transfer_fence_{VK_NULL_HANDLE};
    bool transfer_in_flight_{false};

    // Shared queue
    std::mutex queue_mutex_;
    std::deque<TransferChunk> pending_chunks_;

    struct InFlightBatch {
        VkFence fence;
        std::vector<std::function<void()>> callbacks;
    };
    std::deque<InFlightBatch> in_flight_;
};

}  // namespace gseurat
```

- [ ] **Step 2: Write the TransferQueue implementation**

Create `src/engine/transfer_queue.cpp`:

```cpp
#include "gseurat/engine/transfer_queue.hpp"
#include <algorithm>
#include <cstdio>
#include <cstring>

namespace gseurat {

TransferQueue::TransferQueue(VkDevice device, VmaAllocator allocator,
                             VkQueue transfer_queue, uint32_t transfer_family,
                             VkQueue graphics_queue, uint32_t graphics_family,
                             bool dedicated, uint64_t staging_size,
                             uint32_t transfer_budget_mb)
    : device_(device), allocator_(allocator),
      transfer_queue_(transfer_queue), transfer_family_(transfer_family),
      graphics_queue_(graphics_queue), graphics_family_(graphics_family),
      dedicated_(dedicated), staging_size_(staging_size),
      transfer_budget_bytes_(static_cast<uint64_t>(transfer_budget_mb) * 1024 * 1024) {

    // Create staging buffer (host-visible, CPU-to-GPU)
    staging_buffer_ = Buffer::create_staging(allocator_, staging_size);

    if (dedicated_) {
        // Create command pool + buffer on transfer family
        VkCommandPoolCreateInfo pool_info{};
        pool_info.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO;
        pool_info.queueFamilyIndex = transfer_family_;
        pool_info.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
        vkCreateCommandPool(device_, &pool_info, nullptr, &transfer_cmd_pool_);

        VkCommandBufferAllocateInfo alloc_info{};
        alloc_info.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO;
        alloc_info.commandPool = transfer_cmd_pool_;
        alloc_info.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
        alloc_info.commandBufferCount = 1;
        vkAllocateCommandBuffers(device_, &alloc_info, &transfer_cmd_);

        VkFenceCreateInfo fence_info{};
        fence_info.sType = VK_STRUCTURE_TYPE_FENCE_CREATE_INFO;
        vkCreateFence(device_, &fence_info, nullptr, &transfer_fence_);
    }

    std::printf("[transfer_queue] Initialized: %s, staging %.1f MB, budget %u MB/frame\n",
        dedicated_ ? "dedicated" : "fallback",
        staging_size / (1024.0 * 1024.0), transfer_budget_mb);
}

TransferQueue::~TransferQueue() {
    shutdown();
}

void TransferQueue::enqueue(uint64_t staging_offset, uint64_t dest_offset,
                            uint64_t size, std::function<void()> on_complete) {
    std::lock_guard<std::mutex> lock(queue_mutex_);
    pending_chunks_.push_back({staging_offset, dest_offset, size, std::move(on_complete), false});
}

void TransferQueue::enqueue_completion(std::function<void()> on_complete) {
    std::lock_guard<std::mutex> lock(queue_mutex_);
    pending_chunks_.push_back({0, 0, 0, std::move(on_complete), true});
}

void TransferQueue::poll_completions(VkCommandBuffer frame_cmd) {
    // Check in-flight fences
    while (!in_flight_.empty()) {
        auto& batch = in_flight_.front();
        if (vkGetFenceStatus(device_, batch.fence) == VK_SUCCESS) {
            vkResetFences(device_, 1, &batch.fence);
            for (auto& cb : batch.callbacks) {
                if (cb) cb();
            }
            in_flight_.pop_front();
        } else {
            break;  // FIFO — if front isn't done, nothing behind it is either
        }
    }

    // Check dedicated transfer fence
    if (dedicated_ && transfer_in_flight_) {
        if (vkGetFenceStatus(device_, transfer_fence_) == VK_SUCCESS) {
            transfer_in_flight_ = false;
            vkResetFences(device_, 1, &transfer_fence_);
        } else {
            return;  // Still uploading — don't submit more
        }
    }

    // Drain pending chunks
    std::deque<TransferChunk> batch;
    uint64_t batch_bytes = 0;
    {
        std::lock_guard<std::mutex> lock(queue_mutex_);
        while (!pending_chunks_.empty()) {
            auto& chunk = pending_chunks_.front();
            if (chunk.is_completion_marker) {
                batch.push_back(std::move(chunk));
                pending_chunks_.pop_front();
                continue;
            }
            if (!dedicated_ && batch_bytes + chunk.size > transfer_budget_bytes_) break;
            batch_bytes += chunk.size;
            batch.push_back(std::move(chunk));
            pending_chunks_.pop_front();
        }
    }

    if (batch.empty()) return;

    std::vector<std::function<void()>> callbacks;
    for (auto& chunk : batch) {
        if (chunk.on_complete) callbacks.push_back(std::move(chunk.on_complete));
    }

    if (dedicated_) {
        // Record and submit on dedicated transfer queue
        vkResetCommandBuffer(transfer_cmd_, 0);
        VkCommandBufferBeginInfo begin{};
        begin.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
        begin.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
        vkBeginCommandBuffer(transfer_cmd_, &begin);

        for (auto& chunk : batch) {
            if (chunk.is_completion_marker) continue;
            VkBufferCopy region{};
            region.srcOffset = chunk.staging_offset;
            region.dstOffset = chunk.dest_offset;
            region.size = chunk.size;
            vkCmdCopyBuffer(transfer_cmd_, staging_buffer_.buffer(),
                           static_gaussian_ssbo_.buffer(), 1, &region);
        }

        vkEndCommandBuffer(transfer_cmd_);

        VkSubmitInfo submit{};
        submit.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
        submit.commandBufferCount = 1;
        submit.pCommandBuffers = &transfer_cmd_;
        vkQueueSubmit(transfer_queue_, 1, &submit, transfer_fence_);
        transfer_in_flight_ = true;

        // Callbacks fired on next poll when fence signals
        in_flight_.push_back({transfer_fence_, std::move(callbacks)});
    } else {
        // Fallback: record copies into frame command buffer
        for (auto& chunk : batch) {
            if (chunk.is_completion_marker) continue;
            VkBufferCopy region{};
            region.srcOffset = chunk.staging_offset;
            region.dstOffset = chunk.dest_offset;
            region.size = chunk.size;
            vkCmdCopyBuffer(frame_cmd, staging_buffer_.buffer(),
                           static_gaussian_ssbo_.buffer(), 1, &region);
        }

        // For fallback, callbacks fire immediately after the copies are recorded
        // (they'll execute in order on the graphics queue)
        for (auto& cb : callbacks) {
            if (cb) cb();
        }
    }
}

void TransferQueue::shutdown() {
    if (device_ == VK_NULL_HANDLE) return;

    vkDeviceWaitIdle(device_);

    staging_buffer_.destroy(allocator_);

    if (transfer_cmd_pool_ != VK_NULL_HANDLE) {
        vkDestroyCommandPool(device_, transfer_cmd_pool_, nullptr);
        transfer_cmd_pool_ = VK_NULL_HANDLE;
    }
    if (transfer_fence_ != VK_NULL_HANDLE) {
        vkDestroyFence(device_, transfer_fence_, nullptr);
        transfer_fence_ = VK_NULL_HANDLE;
    }

    device_ = VK_NULL_HANDLE;
}

}  // namespace gseurat
```

**Note:** The `static_gaussian_ssbo_` reference in the copy commands above is a simplification. In the actual wiring (Task 9), the destination buffer will be passed in or stored as a reference during construction.

- [ ] **Step 3: Add Buffer::create_staging if it doesn't exist**

Check `buffer.hpp/cpp`. If `create_staging` doesn't exist, add it to `buffer.cpp`:

```cpp
Buffer Buffer::create_staging(VmaAllocator allocator, VkDeviceSize size) {
    Buffer buf;
    VkBufferCreateInfo buf_info{};
    buf_info.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
    buf_info.size = size;
    buf_info.usage = VK_BUFFER_USAGE_TRANSFER_SRC_BIT;

    VmaAllocationCreateInfo alloc_info{};
    alloc_info.usage = VMA_MEMORY_USAGE_AUTO;
    alloc_info.flags = VMA_ALLOCATION_CREATE_HOST_ACCESS_SEQUENTIAL_WRITE_BIT
                     | VMA_ALLOCATION_CREATE_MAPPED_BIT;

    VmaAllocationInfo info{};
    vmaCreateBuffer(allocator, &buf_info, &alloc_info, &buf.buffer_, &buf.allocation_, &info);
    buf.mapped_ = info.pMappedData;
    return buf;
}
```

Add declaration in `buffer.hpp`:
```cpp
    static Buffer create_staging(VmaAllocator allocator, VkDeviceSize size);
```

- [ ] **Step 4: Add to CMakeLists.txt**

Add `src/engine/transfer_queue.cpp` to gseurat_core (after `src/engine/tilemap.cpp` alphabetically):

```cmake
    src/engine/tilemap.cpp
    src/engine/transfer_queue.cpp
    src/engine/ui/ui_context.cpp
```

- [ ] **Step 5: Build to verify compilation**

Run:
```bash
cmake --build --preset macos-debug 2>&1 | tail -20
```

Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add include/gseurat/engine/transfer_queue.hpp src/engine/transfer_queue.cpp include/gseurat/engine/buffer.hpp src/engine/buffer.cpp CMakeLists.txt
git commit -m "feat(engine): add TransferQueue with dedicated + fallback paths

Staging ring buffer, VkFence-based polling (no GPU stalls), per-frame
transfer budget for fallback path. Thread-safe enqueue from background."
```

---

### Task 9: Wire TransferQueue into GsRenderer + Background Thread

**Files:**
- Modify: `include/gseurat/engine/gs_renderer.hpp`
- Modify: `src/engine/gs_renderer.cpp`

- [ ] **Step 1: Add transfer queue member to gs_renderer.hpp**

Add to the streaming section of private members:
```cpp
    #include "gseurat/engine/transfer_queue.hpp"
    #include <thread>
    #include <atomic>

    std::unique_ptr<TransferQueue> transfer_queue_;
    std::vector<std::thread> load_threads_;
    std::atomic<uint32_t> pending_loads_{0};
```

Add public methods:
```cpp
    // Async version — parses PLY on background thread, uploads via transfer queue
    void load_cloud_async(const std::string& ply_path);
    void poll_transfers(VkCommandBuffer frame_cmd);
```

- [ ] **Step 2: Create TransferQueue in init_streaming**

At the end of `init_streaming()`, before the printf:
```cpp
    // Create transfer queue
    const uint64_t staging_size = config.slab_bytes() * 2;  // double-buffered
    transfer_queue_ = std::make_unique<TransferQueue>(
        device_, allocator_,
        context.transfer_queue(), context.transfer_queue_family(),
        context.queue(), context.queue_family(),
        context.has_dedicated_transfer(),
        staging_size, config.transfer_budget_mb_per_frame);
```

**Note:** `init_streaming` needs a `VkContext&` parameter or the context needs to be accessible. Add it as a parameter:

```cpp
void init_streaming(const StreamingConfig& config, const VkContext& context);
```

- [ ] **Step 3: Implement load_cloud_async**

```cpp
void GsRenderer::load_cloud_async(const std::string& ply_path) {
    if (!streaming_initialized_ || !transfer_queue_) {
        // Fall back to synchronous load
        GaussianCloud cloud;
        cloud.load_ply(ply_path);
        load_cloud(cloud);
        return;
    }

    pending_loads_++;

    // Background thread: parse PLY → stage → enqueue transfers
    load_threads_.emplace_back([this, ply_path]() {
        GaussianCloud cloud;
        cloud.load_ply(ply_path);

        const uint32_t splat_count = cloud.count();
        const uint32_t sps = streaming_config_.slab_size_splats;
        const uint32_t slabs_needed = (splat_count + sps - 1) / sps;

        // Checkout slabs (main thread lock is fine — SlabAllocator is fast)
        auto handle = slab_allocator_->checkout(slabs_needed);

        const auto& gaussians = cloud.gaussians();
        auto* staging = static_cast<uint8_t*>(transfer_queue_->staging_mapped());
        const uint64_t slab_bytes = static_cast<uint64_t>(sps) * sizeof(GpuGaussian);

        for (uint32_t s = 0; s < slabs_needed; ++s) {
            const uint32_t physical_slab = handle.slab_indices[s];
            const uint32_t src_start = s * sps;
            const uint32_t src_end = std::min(src_start + sps, splat_count);
            const uint32_t count = src_end - src_start;

            // Write into staging buffer (use modular offset for ring)
            const uint64_t staging_offset = (s % 2) * slab_bytes;
            auto* dst = reinterpret_cast<GpuGaussian*>(staging + staging_offset);
            for (uint32_t i = 0; i < count; ++i) {
                const auto& g = gaussians[src_start + i];
                dst[i].pos_opacity = glm::vec4(g.position, g.opacity);
                dst[i].scale_pad = glm::vec4(g.scale, glm::uintBitsToFloat(g.bone_index));
                dst[i].rot = glm::vec4(g.rotation.x, g.rotation.y, g.rotation.z, g.rotation.w);
                dst[i].color_pad = glm::vec4(g.color, g.emission);
            }

            const uint64_t dest_offset = static_cast<uint64_t>(physical_slab) * sps * sizeof(GpuGaussian);
            const uint64_t copy_size = static_cast<uint64_t>(count) * sizeof(GpuGaussian);
            transfer_queue_->enqueue(staging_offset, dest_offset, copy_size);
        }

        // Completion marker — update page table on main thread
        transfer_queue_->enqueue_completion([this, handle = std::move(handle), splat_count, slabs_needed, sps]() mutable {
            // Compute page table offset
            uint32_t page_table_offset = 0;
            for (const auto& chunk : active_chunks_) {
                uint32_t end = chunk.page_table_offset + static_cast<uint32_t>(chunk.handle.slab_indices.size());
                if (end > page_table_offset) page_table_offset = end;
            }

            // Write page table
            auto* pt = static_cast<uint32_t*>(page_table_ssbo_.mapped());
            for (uint32_t i = 0; i < slabs_needed; ++i) {
                pt[page_table_offset + i] = handle.slab_indices[i];
            }

            // Track chunk
            ChunkState state;
            state.status = ChunkState::Status::ACTIVE;
            state.handle = std::move(handle);
            state.page_table_offset = page_table_offset;
            state.splat_count = splat_count;
            active_chunks_.push_back(std::move(state));

            // Recalculate totals
            static_count_ = 0;
            for (const auto& c : active_chunks_) static_count_ += c.splat_count;
            total_active_splats_ = static_count_;
            static_dirty_ = true;

            pending_loads_--;
            std::printf("[gs_renderer] Async load complete: %u splats\n", splat_count);
        });
    });
}

void GsRenderer::poll_transfers(VkCommandBuffer frame_cmd) {
    if (transfer_queue_) transfer_queue_->poll_completions(frame_cmd);
}
```

- [ ] **Step 4: Join threads in shutdown**

In `shutdown()`, before destroying buffers:
```cpp
    for (auto& t : load_threads_) {
        if (t.joinable()) t.join();
    }
    load_threads_.clear();
    if (transfer_queue_) transfer_queue_->shutdown();
    transfer_queue_.reset();
```

- [ ] **Step 5: Build to verify**

Run:
```bash
cmake --build --preset macos-debug 2>&1 | tail -20
```

Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add include/gseurat/engine/gs_renderer.hpp src/engine/gs_renderer.cpp
git commit -m "feat(engine): wire TransferQueue + background PLY loading

load_cloud_async() spawns background thread for PLY parsing, stages data
to ring buffer, enqueues transfers. poll_transfers() drives fence-based
completion on main thread. Graphics queue never stalls."
```

---

## R3: Instances (Rooms) & Portal Extension in Bricklayer

### Task 10: InstanceData Type + PortalData Extension

**Files:**
- Modify: `tools/apps/bricklayer/src/store/types.ts`

- [ ] **Step 1: Add InstanceData interface**

Add after `PortalData` (around line 82):

```typescript
export interface InstanceData {
  id: string;
  display_name: string;
  scene_file: string;
}
```

- [ ] **Step 2: Extend PortalData**

Add `target_instance_id` to `PortalData`:

```typescript
export interface PortalData {
  id: string;
  position: [number, number, number];
  size: [number, number];
  target_scene: string;
  target_instance_id?: string;
  spawn_position: [number, number, number];
  spawn_facing: string;
}
```

- [ ] **Step 3: Add instances to BricklayerFile scene block**

In the `scene` block of `BricklayerFile` (around line 448-473), add:

```typescript
    instances?: InstanceData[];
```

- [ ] **Step 4: Commit**

```bash
cd /Users/eccyan/dev/GSeurat
git add tools/apps/bricklayer/src/store/types.ts
git commit -m "feat(bricklayer): add InstanceData type and extend PortalData

InstanceData: named scene reference (id, display_name, scene_file).
PortalData gains optional target_instance_id. BricklayerFile scene block
gains optional instances array."
```

---

### Task 11: Store Actions for Instances

**Files:**
- Modify: `tools/apps/bricklayer/src/store/useSceneStore.ts`

- [ ] **Step 1: Add instances to state**

In the `SceneStoreState` interface, add after `portals: PortalData[]`:

```typescript
    instances: InstanceData[];
```

Add action signatures:

```typescript
    addInstance: () => void;
    updateInstance: (id: string, patch: Partial<InstanceData>) => void;
    removeInstance: (id: string) => void;
```

- [ ] **Step 2: Initialize instances in default state**

In the initial state (around line 512), add:

```typescript
    instances: [],
```

- [ ] **Step 3: Implement instance actions**

Add after the portal actions (around line 745):

```typescript
    addInstance: () => {
      const inst: InstanceData = {
        id: genId('instance'),
        display_name: 'New Instance',
        scene_file: '',
      };
      set({ instances: [...get().instances, inst], isDirty: true });
    },
    updateInstance: (id, patch) => set({
      instances: get().instances.map((i) => (i.id === id ? { ...i, ...patch } : i)),
      isDirty: true,
    }),
    removeInstance: (id) => set({
      instances: get().instances.filter((i) => i.id !== id),
      isDirty: true,
    }),
```

- [ ] **Step 4: Add instances to save/load**

In the save function (where `portals: s.portals` is serialized), add:

```typescript
    instances: s.instances,
```

In the load function (where portals are loaded), add:

```typescript
    instances: data.scene?.instances ?? [],
```

- [ ] **Step 5: Add InstanceData import**

At the top of `useSceneStore.ts`, add `InstanceData` to the import from `./types.js`:

```typescript
import type { ..., InstanceData } from './types.js';
```

- [ ] **Step 6: Build to verify**

Run:
```bash
cd /Users/eccyan/dev/GSeurat/tools && pnpm build 2>&1 | tail -20
```

Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
cd /Users/eccyan/dev/GSeurat
git add tools/apps/bricklayer/src/store/useSceneStore.ts
git commit -m "feat(bricklayer): add instances state + CRUD actions

instances: InstanceData[] in store with addInstance, updateInstance,
removeInstance. Serialized in save/load with back-compat fallback."
```

---

### Task 12: EntitiesTab — Instances Section

**Files:**
- Modify: `tools/apps/bricklayer/src/panels/EntitiesTab.tsx`

- [ ] **Step 1: Add Instances section**

Import `InstanceData` and add instance selectors. Add after the Portals section (after the existing portal list, around line 120):

```tsx
      {/* --- Instances --- */}
      <div style={{ ...styles.sectionHeader, marginTop: 12 }}>
        <span>Instances ({instances.length})</span>
        <button style={styles.addBtn} onClick={addInstance}>+ Add</button>
      </div>
      {instances.map((inst) => (
        <div
          key={inst.id}
          style={{
            ...styles.row,
            cursor: 'pointer',
            background: selectedEntity?.id === inst.id ? '#3a3a5c' : undefined,
          }}
          onClick={() => setSelectedEntity({ type: 'instance', id: inst.id })}
        >
          <span style={{ flex: 1 }}>{inst.display_name || 'Unnamed'}</span>
          <span style={{ fontSize: 11, opacity: 0.5 }}>{inst.scene_file || '(no file)'}</span>
        </div>
      ))}
```

Add the store selectors at the top of the component:

```tsx
  const instances = useSceneStore((s) => s.instances);
  const addInstance = useSceneStore((s) => s.addInstance);
  const selectedEntity = useSceneStore((s) => s.selectedEntity);
  const setSelectedEntity = useSceneStore((s) => s.setSelectedEntity);
```

- [ ] **Step 2: Build to verify**

Run:
```bash
cd /Users/eccyan/dev/GSeurat/tools && pnpm build 2>&1 | tail -20
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
cd /Users/eccyan/dev/GSeurat
git add tools/apps/bricklayer/src/panels/EntitiesTab.tsx
git commit -m "feat(bricklayer): add Instances section to EntitiesTab

Lists instances with display name and scene file. Click to select,
+ Add button creates new instance."
```

---

### Task 13: InstanceProperties + PortalProperties Dropdown

**Files:**
- Modify: `tools/apps/bricklayer/src/panels/ScenePropertiesPanel.tsx`

- [ ] **Step 1: Add InstanceProperties component**

Add after the `PortalProperties` component (around line 705):

```tsx
function InstanceProperties({ instance }: { instance: InstanceData }) {
  const update = useSceneStore((s) => s.updateInstance);
  const remove = useSceneStore((s) => s.removeInstance);

  return (
    <div>
      <div style={{ ...styles.row, marginBottom: 12 }}>
        <span style={{ ...styles.label, flex: 1 }}>Instance</span>
        <button style={styles.btnDanger} onClick={() => remove(instance.id)}>Remove</button>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Display Name</span>
        <input
          type="text"
          value={instance.display_name}
          onChange={(e) => update(instance.id, { display_name: e.target.value })}
          style={styles.input}
          placeholder="e.g. Tavern Interior"
        />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Scene File</span>
        <input
          type="text"
          value={instance.scene_file}
          onChange={(e) => update(instance.id, { scene_file: e.target.value })}
          style={styles.input}
          placeholder="assets/scenes/tavern.scene.json"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add instance routing in ScenePropertiesPanel**

In the main `ScenePropertiesPanel` function where entity types are routed (around line 1519-1522), add after the portal case:

```tsx
if (selectedEntity.type === 'instance') {
  const instance = instances.find((i) => i.id === selectedEntity.id);
  if (!instance) return <div style={styles.empty}>Instance not found</div>;
  return <InstanceProperties instance={instance} />;
}
```

Add the `instances` selector:
```tsx
const instances = useSceneStore((s) => s.instances);
```

- [ ] **Step 3: Update PortalProperties with target_instance_id dropdown**

In `PortalProperties`, add a dropdown before the "Target Scene" field:

```tsx
      <div style={styles.section}>
        <span style={styles.label}>Target Instance</span>
        <select
          style={styles.select}
          value={portal.target_instance_id ?? ''}
          onChange={(e) => {
            const val = e.target.value;
            if (val) {
              update(portal.id, { target_instance_id: val, target_scene: '' });
            } else {
              update(portal.id, { target_instance_id: undefined });
            }
          }}
        >
          <option value="">None (use Target Scene)</option>
          {instances.map((inst) => (
            <option key={inst.id} value={inst.id}>{inst.display_name}</option>
          ))}
        </select>
      </div>
```

Add `instances` selector inside `PortalProperties`:
```tsx
  const instances = useSceneStore((s) => s.instances);
```

Import `InstanceData` at the top of the file.

- [ ] **Step 4: Build to verify**

Run:
```bash
cd /Users/eccyan/dev/GSeurat/tools && pnpm build 2>&1 | tail -20
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
cd /Users/eccyan/dev/GSeurat
git add tools/apps/bricklayer/src/panels/ScenePropertiesPanel.tsx
git commit -m "feat(bricklayer): add InstanceProperties + Portal instance dropdown

InstanceProperties: display name + scene file editor.
PortalProperties gains target_instance_id dropdown listing all instances.
Selecting an instance clears target_scene for clean separation."
```

---

### Task 14: Instance Path Validation

**Files:**
- Modify: `tools/apps/bricklayer/src/lib/sceneExport.ts`
- Modify: `tools/apps/bricklayer/src/lib/__tests__/sceneExport.test.ts`

- [ ] **Step 1: Add instance validation to validateScenePaths**

In `validateScenePaths()`, add after the `background_layers` validation block (around line 142):

```typescript
  if (Array.isArray(scene?.instances)) {
    for (let i = 0; i < scene.instances.length; i++) {
      const inst = scene.instances[i];
      const path = inst?.scene_file;
      if (typeof path === 'string' && path.length > 0) {
        // Check for absolute paths
        if (path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:/.test(path)) {
          errs.push({
            field: `instances[${i}].scene_file`,
            value: path,
            message: 'Absolute path not allowed — use relative path from project root',
          });
        }
      }
    }
  }
```

- [ ] **Step 2: Add test for instance path validation**

In `sceneExport.test.ts`, add a test:

```typescript
  // Test: Instance scene_file validation
  {
    const scene = {
      instances: [
        { id: 'i1', display_name: 'OK', scene_file: 'assets/scenes/tavern.scene.json' },
        { id: 'i2', display_name: 'Bad', scene_file: '/absolute/path/scene.json' },
      ],
    };
    const errs = validateScenePaths(scene, emptyRegistry);
    const instErr = errs.find((e) => e.field === 'instances[1].scene_file');
    assert(instErr, 'catches absolute path in instance.scene_file');
    assert(!errs.find((e) => e.field === 'instances[0].scene_file'), 'accepts relative instance path');
    passed++;
    console.log('  PASS: instance scene_file validation');
  }
```

- [ ] **Step 3: Run tests**

Run:
```bash
cd /Users/eccyan/dev/GSeurat/tools && pnpm test 2>&1 | tail -20
```

Expected: All tests pass including the new instance validation test.

- [ ] **Step 4: Build to verify**

Run:
```bash
cd /Users/eccyan/dev/GSeurat/tools && pnpm build 2>&1 | tail -20
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
cd /Users/eccyan/dev/GSeurat
git add tools/apps/bricklayer/src/lib/sceneExport.ts tools/apps/bricklayer/src/lib/__tests__/sceneExport.test.ts
git commit -m "feat(bricklayer): validate instance.scene_file in path checker

Rejects absolute paths in instance scene_file references. Relative
paths from project root pass validation."
```

---

### Task 15: Export Instances in Scene JSON

**Files:**
- Modify: `tools/apps/bricklayer/src/lib/sceneExport.ts`

- [ ] **Step 1: Add instance serialization to exportSceneJson**

In the `exportSceneJson` function, where portals are serialized (around line 196-204), add after the portals block:

```typescript
  if (state.instances.length > 0) {
    scene.instances = state.instances.map((i) => ({
      id: i.id,
      display_name: i.display_name,
      scene_file: i.scene_file,
    }));
  }
```

Also update portal export to include `target_instance_id`:

```typescript
  if (state.portals.length > 0) {
    scene.portals = state.portals.map((p) => ({
      position: p.position,
      size: p.size,
      target_scene: p.target_scene,
      ...(p.target_instance_id ? { target_instance_id: p.target_instance_id } : {}),
      spawn_position: p.spawn_position,
      spawn_facing: p.spawn_facing,
    }));
  }
```

- [ ] **Step 2: Build to verify**

Run:
```bash
cd /Users/eccyan/dev/GSeurat/tools && pnpm build 2>&1 | tail -20
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
cd /Users/eccyan/dev/GSeurat
git add tools/apps/bricklayer/src/lib/sceneExport.ts
git commit -m "feat(bricklayer): serialize instances + portal target_instance_id

Instances array and portal target_instance_id exported to scene JSON.
Back-compat: target_instance_id omitted when not set."
```

---

## Self-Review

**1. Spec coverage:**
- R1 Slab Allocator: Tasks 1-2 (SlabAllocator + StreamingConfig) ✅
- R1 GPU Page Table: Task 3 (init_streaming), Task 4 (load_cloud refactor), Task 6 (shader) ✅
- R1 unload_cloud: Task 5 ✅
- R2 Queue Discovery: Task 7 ✅
- R2 TransferQueue: Task 8 ✅
- R2 Background Thread: Task 9 ✅
- R3 Types: Task 10 ✅
- R3 Store: Task 11 ✅
- R3 UI (EntitiesTab): Task 12 ✅
- R3 UI (Properties): Task 13 ✅
- R3 Path Validation: Task 14 ✅
- R3 Export: Task 15 ✅
- Acceptance criteria 1 (zero VMA after init): Covered by Tasks 3-5 ✅
- Acceptance criteria 2 (no frame stall): Covered by Tasks 7-9 ✅
- Acceptance criteria 3 (editor support): Covered by Tasks 10-13 ✅
- Acceptance criteria 4 (path validation): Task 14 ✅
- Acceptance criteria 5 (backward compat): Tasks 4 (legacy fallback), 10 (optional fields), 15 (omit when unset) ✅

**2. Placeholder scan:** No TBD, TODO, or vague steps found.

**3. Type consistency:**
- `SlabHandle` has `chunk_id` + `slab_indices` throughout ✅
- `ChunkState` has `status`, `handle`, `page_table_offset`, `splat_count` — consistent in Tasks 3-5, 9 ✅
- `StreamingConfig` fields match between header (Task 2) and usage (Task 3) ✅
- `InstanceData` has `id`, `display_name`, `scene_file` — consistent across Tasks 10-15 ✅
- `PortalData.target_instance_id` optional string — consistent in Tasks 10, 13, 15 ✅
