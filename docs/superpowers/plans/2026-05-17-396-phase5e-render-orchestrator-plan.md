# Phase 5e — `GsRenderer::render()` Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shrink `GsRenderer::render()` from 451 LOC of inline glue to an ~80-LOC orchestrator dominated by subsystem `dispatch()` calls, completing the engine-refactor #396.

**Architecture:** Extract a new `GsPbdSystem` symmetric with `GsSortSystem`/`GsTileBinSystem`/`GsPostProcessSystem`. Maximal-collapse the existing systems' surfaces so each exposes a single `dispatch()` entry that internalizes its sub-passes, internal barriers, and timestamps. Cross-system barriers move with the dispatch that produces their `srcAccessMask`, attaching to the producer side. The orchestrator gets five private helpers (`build_uniforms`, `read_prev_timestamps`, `reset_timestamps`, `transition_outputs_for_compute`, `clear_outputs`) for renderer-local concerns.

**Tech Stack:** C++23, Vulkan 1.3 (with MoltenVK on Apple Silicon), VMA, CMake presets (`macos-debug`/`macos-release`), no test framework on the render path (verification via build + 5-second island_demo smoke).

**Spec:** `docs/superpowers/specs/2026-05-17-phase5e-render-orchestrator-design.md`

---

## Preflight context (read once before Task 1)

- Worktree: `/Users/eccyan/dev/GSeurat/.worktrees/phase5e-orchestrator`. All `cd` operations and file paths in this plan are relative to that worktree unless prefixed with `/`.
- Branch: `refactor/396-phase5e-render-orchestrator`, branched from `main` at commit `7eb2b072` (PR #460 merge).
- Spec already committed as `6b3eaba0` on the branch. No need to recreate.
- Build commands need `dangerouslyDisableSandbox: true` (FetchContent writes `.git/config` in cloned subrepos).
- LSP shows false-positive errors for `glm::`, `vk_mem_alloc.h`, `<vulkan/vulkan.h>` symbols — trust the compiler, not the LSP.
- Memory note for the subagent: never auto-run the regression harness; it OOMs 16 GB Macs. Use only the smoke pattern in §"Verification" below.

### Files modified or created

```
[create] include/gseurat/engine/gs_renderer/pbd/gs_pbd_system.hpp
[create] src/engine/gs_renderer/pbd/gs_pbd_system.cpp
[modify] include/gseurat/engine/gs_renderer.hpp                                       — remove ~25 PBD/preprocess fields, add 5 helper decls
[modify] src/engine/gs_renderer.cpp                                                    — render() body 451 → ~80 LOC; helpers added
[modify] include/gseurat/engine/gs_renderer/sort/gs_sort_system.hpp                    — add dispatch(); absorb preprocess fields
[modify] src/engine/gs_renderer/sort/gs_sort_system.cpp                                — absorb preprocess/init/static-tail-fill/timestamps
[modify] include/gseurat/engine/gs_renderer/tile_bin/gs_tile_bin_system.hpp            — add dispatch() + emitted_timestamps_this_frame()
[modify] src/engine/gs_renderer/tile_bin/gs_tile_bin_system.cpp                        — absorb timestamps + tile→post barrier
[modify] include/gseurat/engine/gs_renderer/post/gs_post_process_system.hpp            — (docstring only — no surface change)
[modify] src/engine/gs_renderer/post/gs_post_process_system.cpp                        — absorb processed-image final transition
[modify] CMakeLists.txt                                                                — add the two new pbd files to gseurat_core sources
```

### Verification pattern (used by every task)

Repeat these three gates at the end of every task. **Do not advance to the next task if any gate fails.**

**Gate A — Build (both presets):**
```bash
cd /Users/eccyan/dev/GSeurat/.worktrees/phase5e-orchestrator
cmake --build --preset macos-debug
cmake --build --preset macos-release
```
Both must exit 0. Run from the worktree; both build commands need `dangerouslyDisableSandbox: true`.

**Gate B — Demo smoke (debug):**
```bash
cd /Users/eccyan/dev/GSeurat/.worktrees/phase5e-orchestrator/build/macos-debug
./island_demo &
DEMO_PID=$!
sleep 5
kill -INT $DEMO_PID
wait $DEMO_PID 2>/dev/null
```
Required signals in the captured output:
- Last line contains `ShutdownAuditor: No tracked objects alive.`
- Zero lines matching `VUID-` or `validation layer` (validation-layer clean)
- Zero lines matching `\[renderer/watchdog\] wait_current_frame_fence TIMEOUT` (PR #460's fence watchdog)

If any required signal is missing or violation found, the change introduced a regression. Revert / fix before proceeding.

**Gate C — Commit:**
The exact commit command appears in each task's final step. Always use the HEREDOC form with the `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.

### Naming convention reconciliation

The spec used `init_pipelines()` and `update_preprocess_descriptors()` for system surfaces. The existing codebase uses `init(device, pipeline_cache, pool, resources)` and `write_descriptors()` (see `gs_sort_system.hpp:42`, `gs_post_process_system.hpp:40`, `gs_tile_bin_system.hpp:46`). **This plan follows the codebase convention** — new `GsPbdSystem` uses `init()` / `write_descriptors()`; `GsSortSystem`'s new preprocess plumbing extends `init()` / `write_descriptors()` rather than introducing a parallel surface.

---

## Task 1: Extract `GsPbdSystem`

Move the inline PBD dispatch (`src/engine/gs_renderer.cpp:1947–1997`) plus all PBD state (pipeline, layout, descriptor set + layout, UBO, counts, upload/clear bodies) into a new system class. `GsRenderer`'s public `upload_pbd_elements`/`upload_pbd_constraints`/`clear_pbd` keep their signatures and forward to `pbd_`. The inline dispatch site becomes `pbd_.dispatch(cmd, frame, time_, tile_.determinism_test_active())`.

**Files:**
- Create: `include/gseurat/engine/gs_renderer/pbd/gs_pbd_system.hpp`
- Create: `src/engine/gs_renderer/pbd/gs_pbd_system.cpp`
- Modify: `include/gseurat/engine/gs_renderer.hpp` (remove `pbd_pipeline_layout_`, `pbd_pipeline_`, `pbd_set_`, `pbd_count_`, `pbd_constraint_count_`; add `GsPbdSystem pbd_;` member; forward public PBD methods)
- Modify: `src/engine/gs_renderer.cpp` (move bodies of `upload_pbd_elements`/`upload_pbd_constraints`/`clear_pbd`; replace inline PBD block with `pbd_.dispatch(...)`; route PBD pipeline + set creation into `pbd_.init()`)
- Modify: `CMakeLists.txt` (add `src/engine/gs_renderer/pbd/gs_pbd_system.cpp` to `gseurat_core` sources)

- [ ] **Step 1.1: Read current PBD plumbing in `src/engine/gs_renderer.cpp`**

Use Read on these line ranges to confirm the body you'll be moving:
- `src/engine/gs_renderer.cpp:300–340` — PBD descriptor set layout creation inside `create_descriptor_resources`
- `src/engine/gs_renderer.cpp:418–426` — PBD pipeline creation inside `create_compute_pipelines`
- `src/engine/gs_renderer.cpp:1280–1300` — `pbd_constraint_ssbo` / `pbd_uniform_buffer` allocation inside `init_streaming`
- `src/engine/gs_renderer.cpp:1581–1600` — PBD descriptor set writes inside `update_descriptors`
- `src/engine/gs_renderer.cpp:1947–1997` — inline PBD dispatch in `render()`
- `src/engine/gs_renderer.cpp:2203–2240` — `upload_pbd_elements` / `upload_pbd_constraints` / `clear_pbd` bodies

Note the constants `kPbdSolverIterations` (referenced at line 1975) and `kLocalSize` (PBD workgroup size, line 619); confirm where they're defined so the new file can include them via existing headers.

- [ ] **Step 1.2: Create the new header `include/gseurat/engine/gs_renderer/pbd/gs_pbd_system.hpp`**

```cpp
#pragma once

#include "gseurat/engine/buffer.hpp"
#include "gseurat/engine/pbd_types.hpp"
#include "gseurat/engine/types.hpp"  // kMaxFramesInFlight

#include <vk_mem_alloc.h>
#include <vulkan/vulkan.h>

#include <cstdint>

namespace gseurat {

struct GsResourceManager;

// Phase 5e: PBD (Position Based Dynamics) solver extraction. Owns:
//  - pbd_set_layout, pbd_pipeline_layout, pbd_pipeline (compute)
//  - one shared pbd_set (single instance — solver descriptor set is not
//    per-frame; the underlying buffers are stable across frames)
//  - element/state counts (pbd_count_, pbd_constraint_count_)
//  - dispatch body (UBO upload, pipeline+set bind, push constants,
//    vkCmdDispatch, PBD→preprocess pipeline barrier)
//
// Storage buffers (resources_->pbd_state_ssbo, pbd_params_ssbo,
// pbd_constraint_ssbo, pbd_uniform_buffer) remain owned by
// GsResourceManager — this system holds only the pipeline-side state.
//
// Lifetime: by-value member of GsRenderer. init() runs at GsRenderer::init
// time after the shared gs_pool_ exists.
class GsPbdSystem {
public:
    GsPbdSystem() = default;
    ~GsPbdSystem();

    GsPbdSystem(const GsPbdSystem&)            = delete;
    GsPbdSystem& operator=(const GsPbdSystem&) = delete;
    GsPbdSystem(GsPbdSystem&&)                 = delete;
    GsPbdSystem& operator=(GsPbdSystem&&)      = delete;

    // Create set layout, pipeline layout, pipeline, and allocate one
    // descriptor set from `pool`. `allocator` is held for the lifetime of
    // upload_constraints (which sizes the constraint SSBO on first upload).
    void init(VkDevice device, VmaAllocator allocator,
              VkPipelineCache pipeline_cache, VkDescriptorPool pool,
              GsResourceManager* resources);

    // (Re)write the single descriptor set against the current
    // resources_->pbd_state_ssbo / pbd_params_ssbo / pbd_constraint_ssbo /
    // pbd_uniform_buffer. Called from GsRenderer::update_descriptors after
    // buffer (re)creation.
    void write_descriptors();

    // Element-state uploads. Copies `count` entries into the mapped
    // pbd_state_ssbo and pbd_params_ssbo (resources owned by
    // GsResourceManager). Sets pbd_count_ = count.
    void upload_elements(const PbdPhysicsState* states,
                         const PbdElementParams* params,
                         uint32_t count);

    // Constraint upload. Allocates / resizes resources_->pbd_constraint_ssbo
    // if `count` exceeds capacity, then memcpys constraints in. Sets
    // pbd_constraint_count_ = count.
    void upload_constraints(const PbdConstraint* constraints, uint32_t count);

    // Reset counts to zero. Does NOT destroy the buffers; they remain
    // allocated for the next frame's reuse.
    void clear();

    // Per-frame dispatch. Early-exits if `count() == 0` or
    // `determinism_test_active`. On dispatch, emits the PBD UBO upload,
    // pipeline+set bind, push constants (pbd_count_), the workgroup
    // dispatch, and the PBD-write → preprocess-read pipeline barrier as
    // the final operation (so the next system's read of pbd_state_ssbo
    // sees finished writes).
    void dispatch(VkCommandBuffer cmd, uint32_t frame_in_flight,
                  float time, bool determinism_test_active) noexcept;

    // Read-only state accessors (forwarded by GsRenderer for ABI stability)
    uint32_t count()             const { return pbd_count_; }
    uint32_t constraint_count()  const { return pbd_constraint_count_; }

    // Prewarm: 1 pipeline (gs_pbd.comp).
    struct PrewarmEntry {
        VkPipeline             pipeline;
        VkPipelineLayout       pipeline_layout;
        VkDescriptorSetLayout  set_layout;
    };
    PrewarmEntry prewarm_entry() const {
        return {pbd_pipeline_, pbd_pipeline_layout_, pbd_set_layout_};
    }

    // Tear down. Idempotent against null handles.
    void shutdown();

private:
    VkDevice           device_     = VK_NULL_HANDLE;
    VmaAllocator       allocator_  = VK_NULL_HANDLE;
    GsResourceManager* resources_  = nullptr;

    VkDescriptorSetLayout pbd_set_layout_         = VK_NULL_HANDLE;
    VkPipelineLayout      pbd_pipeline_layout_    = VK_NULL_HANDLE;
    VkPipeline            pbd_pipeline_           = VK_NULL_HANDLE;
    VkDescriptorSet       pbd_set_                = VK_NULL_HANDLE;

    uint32_t pbd_count_            = 0;
    uint32_t pbd_constraint_count_ = 0;
};

}  // namespace gseurat
```

- [ ] **Step 1.3: Create the new implementation `src/engine/gs_renderer/pbd/gs_pbd_system.cpp`**

Important: the bodies in this file are **copied verbatim** from `src/engine/gs_renderer.cpp` at the line ranges in Step 1.1. The only changes are: (a) replace `pbd_pipeline_`/`pbd_set_`/`pbd_count_`/`pbd_constraint_count_` references with the system's member names (they happen to match), (b) replace `resources_->...` reference style (the system holds `resources_` directly), (c) move the set-layout and pipeline creation code from `create_descriptor_resources`/`create_compute_pipelines`/`update_descriptors` into the system's `init()`/`write_descriptors()`.

```cpp
#include "gseurat/engine/gs_renderer/pbd/gs_pbd_system.hpp"

#include "gseurat/engine/gs_renderer/gs_resources.hpp"

#include <cstdio>
#include <cstring>
#include <vector>

namespace gseurat {

namespace {
// Mirror the renderer-level constants. kPbdSolverIterations is defined in
// gs_renderer.cpp as a file-static; duplicate it here to keep the system
// self-contained.
constexpr uint32_t kPbdSolverIterations = 6;
constexpr uint32_t kPbdWorkgroupSize    = 64;
}  // namespace

GsPbdSystem::~GsPbdSystem() {
    shutdown();
}

void GsPbdSystem::init(VkDevice device, VmaAllocator allocator,
                       VkPipelineCache pipeline_cache, VkDescriptorPool pool,
                       GsResourceManager* resources) {
    device_    = device;
    allocator_ = allocator;
    resources_ = resources;

    // ---- Descriptor set layout: { pbd_states(rw), pbd_params(ro),
    //                               pbd_constraints(ro), pbd_uniforms(ubo) }
    const VkDescriptorSetLayoutBinding bindings[] = {
        {0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        {1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        {2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        {3, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
    };
    VkDescriptorSetLayoutCreateInfo dsl_ci{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO};
    dsl_ci.bindingCount = 4;
    dsl_ci.pBindings    = bindings;
    vkCreateDescriptorSetLayout(device_, &dsl_ci, nullptr, &pbd_set_layout_);

    // ---- Pipeline layout (push constants: uint32_t pbd_count)
    VkPushConstantRange pc{VK_SHADER_STAGE_COMPUTE_BIT, 0, sizeof(uint32_t)};
    VkPipelineLayoutCreateInfo pl_ci{VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
    pl_ci.setLayoutCount         = 1;
    pl_ci.pSetLayouts            = &pbd_set_layout_;
    pl_ci.pushConstantRangeCount = 1;
    pl_ci.pPushConstantRanges    = &pc;
    vkCreatePipelineLayout(device_, &pl_ci, nullptr, &pbd_pipeline_layout_);

    // ---- Pipeline (gs_pbd.comp).  Inline the body of the `create_pipeline`
    // lambda from gs_renderer.cpp:375–411, adapted to the system's own
    // members.  The original is a lambda local to create_compute_pipelines();
    // expose `load_shader_module` either by adding a public free-function
    // overload in gs_renderer.cpp or by writing the SPIR-V load inline here:
    {
        std::vector<char> spv_bytes;
        // Read shaders/gs_pbd.comp.spv from disk into spv_bytes (same I/O
        // pattern as load_shader_module — open binary, seek-to-end for size,
        // read into char buffer, cast to const uint32_t*).
        VkShaderModuleCreateInfo sm_ci{VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO};
        sm_ci.codeSize = spv_bytes.size();
        sm_ci.pCode    = reinterpret_cast<const uint32_t*>(spv_bytes.data());
        VkShaderModule module = VK_NULL_HANDLE;
        vkCreateShaderModule(device_, &sm_ci, nullptr, &module);

        VkComputePipelineCreateInfo pi{};
        pi.sType        = VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO;
        pi.stage.sType  = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
        pi.stage.stage  = VK_SHADER_STAGE_COMPUTE_BIT;
        pi.stage.module = module;
        pi.stage.pName  = "main";
        pi.layout       = pbd_pipeline_layout_;
        vkCreateComputePipelines(device_, pipeline_cache, 1, &pi, nullptr, &pbd_pipeline_);
        vkDestroyShaderModule(device_, module, nullptr);
    }
    // If a shared `load_shader_module(device, spv_path)` free function
    // already exists in gseurat/engine — grep `grep -rn load_shader_module
    // src/engine/` — prefer it over the inline SPIR-V load above.

    // ---- Allocate the single descriptor set from the shared pool
    VkDescriptorSetAllocateInfo ds_ai{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO};
    ds_ai.descriptorPool     = pool;
    ds_ai.descriptorSetCount = 1;
    ds_ai.pSetLayouts        = &pbd_set_layout_;
    vkAllocateDescriptorSets(device_, &ds_ai, &pbd_set_);
}

void GsPbdSystem::write_descriptors() {
    // Body lifted from gs_renderer.cpp:1581–1600 verbatim (replace `pbd_set_`
    // self-reference, `resources_->...` access).  Writes 4 descriptors:
    // pbd_state_ssbo (binding 0), pbd_params_ssbo (binding 1),
    // pbd_constraint_ssbo (binding 2), pbd_uniform_buffer (binding 3).
}

void GsPbdSystem::upload_elements(const PbdPhysicsState* states,
                                  const PbdElementParams* params,
                                  uint32_t count) {
    // Body lifted from gs_renderer.cpp:2203–2214 verbatim.
    pbd_count_ = count;
}

void GsPbdSystem::upload_constraints(const PbdConstraint* constraints,
                                     uint32_t count) {
    // Body lifted from gs_renderer.cpp:2215–2222 verbatim.
    pbd_constraint_count_ = count;
}

void GsPbdSystem::clear() {
    pbd_count_            = 0;
    pbd_constraint_count_ = 0;
    // Body of GsRenderer::clear_pbd at gs_renderer.cpp:2223–2238 — buffer-
    // contents zero-fill stays here.
}

void GsPbdSystem::dispatch(VkCommandBuffer cmd, uint32_t frame_in_flight,
                           float time, bool determinism_test_active) noexcept {
    (void)frame_in_flight;  // PBD set is not per-frame; reserved for symmetry.
    if (pbd_count_ == 0 || determinism_test_active) return;

    GS_LABEL(cmd, "PBD");

    // UBO upload — body from gs_renderer.cpp:1964–1979.
    struct {
        float    time;
        float    dt;
        uint32_t iterations;
        uint32_t count;
        uint32_t constraint_count;
        uint32_t pad[3];
    } pbd_ubo;
    pbd_ubo.time             = time;
    pbd_ubo.dt               = 1.0f / 60.0f;
    pbd_ubo.iterations       = kPbdSolverIterations;
    pbd_ubo.count            = pbd_count_;
    pbd_ubo.constraint_count = pbd_constraint_count_;
    pbd_ubo.pad[0] = pbd_ubo.pad[1] = pbd_ubo.pad[2] = 0;
    std::memcpy(resources_->pbd_uniform_buffer.mapped(), &pbd_ubo, sizeof(pbd_ubo));

    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, pbd_pipeline_);
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                            pbd_pipeline_layout_, 0, 1, &pbd_set_, 0, nullptr);
    vkCmdPushConstants(cmd, pbd_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                       0, sizeof(uint32_t), &pbd_count_);
    vkCmdDispatch(cmd, (pbd_count_ + kPbdWorkgroupSize - 1) / kPbdWorkgroupSize, 1, 1);

    // PBD write → preprocess read barrier — last operation, as per
    // spec §5.4 (barrier moves with the producing dispatch).
    VkMemoryBarrier pbd_barrier{};
    pbd_barrier.sType         = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
    pbd_barrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
    pbd_barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
    vkCmdPipelineBarrier(cmd,
        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
        0, 1, &pbd_barrier, 0, nullptr, 0, nullptr);
}

void GsPbdSystem::shutdown() {
    if (device_ == VK_NULL_HANDLE) return;
    if (pbd_pipeline_)        vkDestroyPipeline(device_, pbd_pipeline_, nullptr);
    if (pbd_pipeline_layout_) vkDestroyPipelineLayout(device_, pbd_pipeline_layout_, nullptr);
    if (pbd_set_layout_)      vkDestroyDescriptorSetLayout(device_, pbd_set_layout_, nullptr);
    pbd_pipeline_ = VK_NULL_HANDLE;
    pbd_pipeline_layout_ = VK_NULL_HANDLE;
    pbd_set_layout_      = VK_NULL_HANDLE;
    pbd_set_             = VK_NULL_HANDLE;
    device_              = VK_NULL_HANDLE;
}

}  // namespace gseurat
```

Note: `GS_LABEL` is defined in `gseurat/engine/debug.hpp` and needs to be available; if `gs_renderer/pbd/gs_pbd_system.cpp` doesn't compile against it, add the include for that header.

- [ ] **Step 1.4: Add the new source file to `CMakeLists.txt`**

Open `CMakeLists.txt` and grep for the existing line `src/engine/gs_renderer/sort/gs_sort_system.cpp` (or any of the 5a-5d system .cpp entries). Add `src/engine/gs_renderer/pbd/gs_pbd_system.cpp` next to it in the same `target_sources(gseurat_core PRIVATE ...)` block. Alphabetical ordering by directory is the existing convention.

- [ ] **Step 1.5: Modify `include/gseurat/engine/gs_renderer.hpp` — add include + member, prepare for field removal**

Add include near the other system includes (around line 5–10):
```cpp
#include "gseurat/engine/gs_renderer/pbd/gs_pbd_system.hpp"
```

Find the private section where `tile_`, `sort_`, `post_`, `streaming_` are declared (search for `GsPostProcessSystem post_;` — declarations are colocated). Add:
```cpp
GsPbdSystem pbd_;
```

**Do not remove** the existing `pbd_pipeline_layout_`, `pbd_pipeline_`, `pbd_set_`, `pbd_count_`, `pbd_constraint_count_` fields yet (Step 1.10 removes them after the migration is complete). At this checkpoint, both old fields and the new `pbd_` member coexist.

- [ ] **Step 1.6: Modify `src/engine/gs_renderer.cpp` — wire `pbd_.init()` into the existing init flow**

In `GsRenderer::init()` (around line 83+), after the existing `sort_.init(...)` / `tile_.init(...)` / `post_.init(...)` calls and after the shared `gs_pool_` is allocated, add:
```cpp
pbd_.init(device, allocator_, pipeline_cache, gs_pool_, resources_);
```

The exact insertion point: just after `post_.init(...)` (this preserves the spec's destruction order pbd → tile → sort → post → streaming → resources, which is the reverse of init order). Search the file for `post_.init(` to find the line.

- [ ] **Step 1.7: Build — confirm new file compiles alongside legacy fields**

Run Gate A (both presets). Expected: both build green. `pbd_` is constructed but unused; old fields still drive runtime behavior. This is the "scaffolding lands first" checkpoint.

If build fails, fix linker errors (likely missing `create_pipeline` helper or shader path) before continuing.

- [ ] **Step 1.8: Wire `pbd_.write_descriptors()` into `GsRenderer::update_descriptors`**

In `src/engine/gs_renderer.cpp`, find the existing PBD descriptor writes at line ~1581–1600 inside `update_descriptors()`. Replace that block with a single call:
```cpp
pbd_.write_descriptors();
```
The legacy block is now dead but kept around the call site momentarily. **Comment out** the original block with `// Phase 5e step 1.8: migrated to pbd_.write_descriptors() — pending removal in step 1.10`. Don't delete yet; we want a single-revert checkpoint.

- [ ] **Step 1.9: Forward the public API + replace the inline dispatch**

In `src/engine/gs_renderer.cpp`, replace the bodies of `GsRenderer::upload_pbd_elements` / `upload_pbd_constraints` / `clear_pbd` (lines 2203–2238) with forwarders:
```cpp
void GsRenderer::upload_pbd_elements(const PbdPhysicsState* states,
                                      const PbdElementParams* params,
                                      uint32_t count) {
    pbd_.upload_elements(states, params, count);
    pbd_count_ = count;  // mirror to legacy field — removed in step 1.10
}

void GsRenderer::upload_pbd_constraints(const PbdConstraint* constraints,
                                         uint32_t count) {
    pbd_.upload_constraints(constraints, count);
    pbd_constraint_count_ = count;  // mirror to legacy field — removed in step 1.10
}

void GsRenderer::clear_pbd() {
    pbd_.clear();
    pbd_count_            = 0;
    pbd_constraint_count_ = 0;
}
```

The legacy `pbd_count_` / `pbd_constraint_count_` getters at hpp lines 313–314 keep returning the renderer's mirrored field for now (next step removes them).

Then in `render()` (gs_renderer.cpp:1947–1997), replace the entire PBD dispatch block (the 50-LOC `if (pbd_count_ > 0 && !tile_.determinism_test_active()) { ... }`) with the single call:
```cpp
pbd_.dispatch(cmd, frame_in_flight, time_, tile_.determinism_test_active());
```

Run Gate A + Gate B. If smoke shows missing wind sway on trees, the descriptor writes in step 1.8 are off — re-check that `pbd_.write_descriptors()` is called *after* `resources_->pbd_*` buffers are allocated.

- [ ] **Step 1.10: Remove the legacy PBD state from `GsRenderer`**

From `include/gseurat/engine/gs_renderer.hpp`:
- Delete `pbd_pipeline_layout_`, `pbd_pipeline_`, `pbd_set_` (lines 484–486)
- Delete `pbd_count_`, `pbd_constraint_count_` (lines 445–446)
- Change `uint32_t pbd_count() const { return pbd_count_; }` to `uint32_t pbd_count() const { return pbd_.count(); }`
- Change `uint32_t pbd_constraint_count() const { return pbd_constraint_count_; }` to `uint32_t pbd_constraint_count() const { return pbd_.constraint_count(); }`

From `src/engine/gs_renderer.cpp`:
- Delete the PBD descriptor set layout creation block (lines ~300–340 portion that touches PBD specifically — read the block in step 1.1 to identify)
- Delete the PBD pipeline creation block (lines 418–426)
- Delete the commented-out descriptor write block from step 1.8
- Delete the PBD destruction calls inside `GsRenderer::shutdown` (search for `vkDestroyPipeline(*, pbd_pipeline_, *)` and surrounding) — they're now redundant because `pbd_.shutdown()` is called from the destructor.
- Remove the mirror assignments (`pbd_count_ = count;`, etc.) added in step 1.9 — the forwarders are now pure delegation.

Update the prewarm aggregator: at gs_renderer.cpp:897, where the entry list includes `pbd_solver`, replace the inline pipeline reference with `pbd_.prewarm_entry().pipeline` etc.

- [ ] **Step 1.11: Final build + smoke for Task 1**

Run Gate A (both presets) and Gate B (debug smoke). Expected:
- Both builds exit 0
- Demo runs ~5s with characters animating, wind sway visible on tree foliage (PBD active)
- Validation layer clean
- `ShutdownAuditor: No tracked objects alive.` on exit

- [ ] **Step 1.12: Commit Task 1**

```bash
cd /Users/eccyan/dev/GSeurat/.worktrees/phase5e-orchestrator
git add CMakeLists.txt \
        include/gseurat/engine/gs_renderer.hpp \
        include/gseurat/engine/gs_renderer/pbd/gs_pbd_system.hpp \
        src/engine/gs_renderer.cpp \
        src/engine/gs_renderer/pbd/gs_pbd_system.cpp
git commit -m "$(cat <<'EOF'
refactor(engine): extract GsPbdSystem (#396 phase 5e step 1)

Move PBD pipeline/descriptors/state and the inline render() dispatch
body into a new symmetric subsystem under
src/engine/gs_renderer/pbd/.  GsRenderer::upload_pbd_*/clear_pbd remain
as public forwarders; render() now calls pbd_.dispatch() instead of
inlining the pipeline bind + descriptor bind + UBO upload + dispatch +
barrier sequence.

The PBD→preprocess write→read barrier moves with the dispatch (spec §5.4):
it is now the final operation pbd_.dispatch() emits, before sort_'s
preprocess is invoked from the orchestrator.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `GsSortSystem` absorbs preprocess pipeline + descriptors

Move the preprocess pipeline, layout, descriptor set layout, and the two per-frame descriptor sets (`static_preprocess_sets_[2]`, `dynamic_preprocess_sets_[2]`) from `GsRenderer` into `GsSortSystem`. Add a `sort_.dispatch_preprocess(cmd, frame, count, is_static)` method that calls back into the existing inline preprocess sequence. `render()` still has the two preprocess call sites; this task only moves *plumbing*, not orchestration.

**Files:**
- Modify: `include/gseurat/engine/gs_renderer/sort/gs_sort_system.hpp` (add preprocess fields + accessors + `dispatch_preprocess()` decl)
- Modify: `src/engine/gs_renderer/sort/gs_sort_system.cpp` (add preprocess init/write/dispatch bodies)
- Modify: `include/gseurat/engine/gs_renderer.hpp` (remove `preprocess_layout_`, `preprocess_pipeline_layout_`, `preprocess_pipeline_`, `static_preprocess_sets_`, `dynamic_preprocess_sets_`)
- Modify: `src/engine/gs_renderer.cpp` (move preprocess plumbing, replace two inline preprocess blocks in render() with `sort_.dispatch_preprocess(...)`)

- [ ] **Step 2.1: Extend `GsSortSystem` public surface**

In `include/gseurat/engine/gs_renderer/sort/gs_sort_system.hpp`, between `dispatch_merge(...)` and `onesweep_hist_pipeline()` accessors (around line 67–72), add:
```cpp
    // Phase 5e: preprocess dispatch — projects 3D gaussians, computes
    // depth keys, writes sort entries. Called once for dynamic and once
    // for static per frame from GsRenderer::render() (until step 4
    // collapses the orchestrator further).
    //
    // `is_static = false` selects dynamic_preprocess_sets_[frame] and
    // pushes (static_offset = streaming.max_static_count(), count, dyn_flag = 1).
    // `is_static = true ` selects static_preprocess_sets_[frame] and
    // pushes (static_offset = 0, count, dyn_flag = 0).
    void dispatch_preprocess(VkCommandBuffer cmd, uint32_t frame_in_flight,
                             uint32_t count, uint32_t static_offset,
                             bool is_static);
```

In the private section near `merge_sets_` (line 107), add the preprocess pipeline/layout/set fields:
```cpp
    // Preprocess pipeline (Phase 5e — moved from GsRenderer)
    VkDescriptorSetLayout                              preprocess_layout_              = VK_NULL_HANDLE;
    VkPipelineLayout                                   preprocess_pipeline_layout_     = VK_NULL_HANDLE;
    VkPipeline                                         preprocess_pipeline_            = VK_NULL_HANDLE;
    std::array<VkDescriptorSet, kMaxFramesInFlight>    static_preprocess_sets_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight>    dynamic_preprocess_sets_{};
```

- [ ] **Step 2.2: Extend `GsSortSystem::init` to create preprocess layout/pipeline/sets**

In `src/engine/gs_renderer/sort/gs_sort_system.cpp`, inside `init(...)` (after the existing onesweep + merge creation):

Copy the body of `GsRenderer::create_descriptor_resources` lines ~270–290 that creates `preprocess_layout_` (5-binding descriptor layout) into a new section here. Then copy the descriptor set allocation block for the 4 preprocess sets (referenced at gs_renderer.cpp:342–346, 366–369).

Then copy `GsRenderer::create_compute_pipelines` block at gs_renderer.cpp:412–414 (the `create_pipeline("shaders/gs_preprocess.comp.spv", ...)` call) — adapt to use the local `create_pipeline` helper or duplicate the inline pipeline-creation code from another system (`gs_sort_system.cpp` already has analogous code for the onesweep pipelines — model it on those calls).

- [ ] **Step 2.3: Implement `GsSortSystem::write_descriptors` extension for preprocess sets**

The existing `GsSortSystem::write_descriptors()` writes 26 descriptor sets. Extend it to also write the 4 preprocess sets (2 static + 2 dynamic). Copy the bodies from `GsRenderer::update_descriptors` at gs_renderer.cpp:1511–1565 verbatim (replace `static_preprocess_sets_[f]` / `dynamic_preprocess_sets_[f]` with `this->static_preprocess_sets_[f]` / `this->dynamic_preprocess_sets_[f]`).

- [ ] **Step 2.4: Implement `GsSortSystem::dispatch_preprocess`**

Add at the end of `src/engine/gs_renderer/sort/gs_sort_system.cpp`:
```cpp
void GsSortSystem::dispatch_preprocess(VkCommandBuffer cmd, uint32_t frame_in_flight,
                                       uint32_t count, uint32_t static_offset,
                                       bool is_static) {
    if (count == 0) return;
    GS_LABEL(cmd, is_static ? "Preprocess.Static" : "Preprocess.Dynamic");

    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, preprocess_pipeline_);
    VkDescriptorSet set = is_static
        ? static_preprocess_sets_[frame_in_flight]
        : dynamic_preprocess_sets_[frame_in_flight];
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                            preprocess_pipeline_layout_, 0, 1, &set, 0, nullptr);
    GsPreprocessPush push{static_offset, count, is_static ? 0u : 1u};
    vkCmdPushConstants(cmd, preprocess_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                       0, sizeof(GsPreprocessPush), &push);
    vkCmdDispatch(cmd, (count + 255) / 256, 1, 1);
}
```

`GsPreprocessPush` is defined in `include/gseurat/engine/gs_renderer.hpp:42–46`. Either include `gs_renderer.hpp` (cycle risk — `gs_sort_system.hpp` is already included by `gs_renderer.hpp`) or duplicate the small POD into a new shared header. **Cleanest move: copy the 4-line struct into `gs_sort_system.hpp` and include from there.** Update `gs_renderer.hpp` to remove the original definition.

- [ ] **Step 2.5: Extend `GsSortSystem::shutdown` to destroy preprocess resources**

At the end of `GsSortSystem::shutdown()`, add:
```cpp
    if (preprocess_pipeline_)        vkDestroyPipeline(device_, preprocess_pipeline_, nullptr);
    if (preprocess_pipeline_layout_) vkDestroyPipelineLayout(device_, preprocess_pipeline_layout_, nullptr);
    if (preprocess_layout_)          vkDestroyDescriptorSetLayout(device_, preprocess_layout_, nullptr);
    preprocess_pipeline_        = VK_NULL_HANDLE;
    preprocess_pipeline_layout_ = VK_NULL_HANDLE;
    preprocess_layout_          = VK_NULL_HANDLE;
```

- [ ] **Step 2.6: Replace the two inline preprocess blocks in `render()`**

In `src/engine/gs_renderer.cpp`, find the dynamic preprocess block at lines 2068–2076 (inside `if (dynamic_count_ > 0)`). Replace the entire 9-line body with:
```cpp
    sort_.dispatch_preprocess(cmd, frame_in_flight, dynamic_count_,
                              streaming_.max_static_count(),
                              /*is_static=*/false);
```

Find the static preprocess block at lines 2090–2102 (inside `if (streaming_.static_dirty() && streaming_.static_count() > 0)`). Replace the 12-line body with:
```cpp
    sort_.dispatch_preprocess(cmd, frame_in_flight, streaming_.static_count(),
                              /*static_offset=*/0u,
                              /*is_static=*/true);
```

- [ ] **Step 2.7: Remove legacy preprocess state from `GsRenderer`**

From `include/gseurat/engine/gs_renderer.hpp`:
- Delete lines 468 (`preprocess_layout_`), 474–475 (`static_preprocess_sets_`, `dynamic_preprocess_sets_`), 478 (`preprocess_pipeline_layout_`), 480 (`preprocess_pipeline_`)
- Delete the `GsPreprocessPush` struct at lines 42–46 (moved to `gs_sort_system.hpp` in step 2.4)

From `src/engine/gs_renderer.cpp`:
- Delete `preprocess_layout_` creation in `create_descriptor_resources` (the block referenced by step 2.2)
- Delete the preprocess sets from the descriptor allocation array (lines 342–346, 366–369) — the array size shrinks by 4
- Delete the preprocess pipeline creation in `create_compute_pipelines` (lines 412–414)
- Delete `update_descriptors` blocks for static/dynamic preprocess sets (lines 1511–1565) — replace the call site with `sort_.write_descriptors();` if not already invoking it
- Delete prewarm entry for `gs_preprocess` at line 885–886 — route via `sort_.prewarm_entries()` instead (add preprocess to `GsSortSystem::prewarm_entries()` array size 3→4)
- Delete shutdown calls for preprocess pipeline/layouts at gs_renderer.cpp:2354, 2364, 2372

- [ ] **Step 2.8: Build + smoke + commit Task 2**

Run Gate A + Gate B. Expected: identical visual output to Task 1 endpoint (no behavior change; only ownership moved).

```bash
cd /Users/eccyan/dev/GSeurat/.worktrees/phase5e-orchestrator
git add include/gseurat/engine/gs_renderer.hpp \
        include/gseurat/engine/gs_renderer/sort/gs_sort_system.hpp \
        src/engine/gs_renderer.cpp \
        src/engine/gs_renderer/sort/gs_sort_system.cpp
git commit -m "$(cat <<'EOF'
refactor(engine): GsSortSystem absorbs preprocess pipeline + descriptors
                  (#396 phase 5e step 2)

Move the preprocess pipeline, descriptor set layout, pipeline layout,
and the two per-frame preprocess descriptor set arrays (static_*, dynamic_*)
from GsRenderer into GsSortSystem.  Add sort_.dispatch_preprocess(cmd,
frame, count, static_offset, is_static) so the orchestrator's render() calls
both preprocess sites through one entry point.

The GsPreprocessPush struct moves from gs_renderer.hpp to gs_sort_system.hpp
to break the include cycle.  Renderer-side update_descriptors() now defers
all preprocess descriptor writes to sort_.write_descriptors().

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `GsSortSystem` absorbs sort-buffer init + static-tail fill

Move the three "sort-phase preparation" blocks (counts SSBO reset, dynamic_sort_a/b fill, static-tail fill with dirty-flag check) from `render()` into `GsSortSystem`. Expose them as `sort_.prepare_buffers(cmd, frame, dynamic_count, streaming)`. `render()` still has explicit timestamp + barrier handling around the call; full collapse is Task 4.

**Files:**
- Modify: `include/gseurat/engine/gs_renderer/sort/gs_sort_system.hpp` (add `prepare_buffers()`)
- Modify: `src/engine/gs_renderer/sort/gs_sort_system.cpp` (implement `prepare_buffers()` body)
- Modify: `src/engine/gs_renderer.cpp` (replace three inline blocks in render() with `sort_.prepare_buffers(...)`)
- Modify: `include/gseurat/engine/gs_renderer/sort/gs_sort_system.hpp` — forward-declare `GsStreamingSystem`

- [ ] **Step 3.1: Forward-declare `GsStreamingSystem` in sort_system.hpp**

In `include/gseurat/engine/gs_renderer/sort/gs_sort_system.hpp` near the `struct GsResourceManager;` forward declaration (line 12):
```cpp
class GsStreamingSystem;
```

- [ ] **Step 3.2: Add the `prepare_buffers()` decl to `GsSortSystem`**

In `gs_sort_system.hpp` between `dispatch_preprocess` (added in Task 2) and the existing `dispatch_depth_*` methods, add:
```cpp
    // Phase 5e: sort-phase buffer preparation.  Performs:
    //   1. Static-tail fill (if streaming.is_static_tail_dirty(frame)) —
    //      2× vkCmdFillBuffer + 2-barrier on static_sort_as/bs[frame].
    //      Calls streaming.clear_static_tail_dirty(frame) after.
    //   2. Counts SSBO reset (12 bytes if static_dirty, else 8 bytes from offset 4).
    //   3. Dynamic sort_a/b fill 0xFFFFFFFFu (if dynamic_count > 0).
    //   4. TRANSFER→COMPUTE barrier.
    void prepare_buffers(VkCommandBuffer cmd, uint32_t frame_in_flight,
                         uint32_t dynamic_count,
                         GsStreamingSystem& streaming);
```

- [ ] **Step 3.3: Add `#include` for `GsStreamingSystem` in sort_system.cpp**

In `src/engine/gs_renderer/sort/gs_sort_system.cpp`, add at the top:
```cpp
#include "gseurat/engine/gs_renderer/streaming/gs_streaming_system.hpp"
```

- [ ] **Step 3.4: Implement `GsSortSystem::prepare_buffers`**

Copy the three blocks from `src/engine/gs_renderer.cpp` verbatim into the new function body:
- Static-tail fill: lines 1795–1837 (without the `if (streaming_.is_static_tail_dirty(frame_in_flight) && streaming_.static_count() < streaming_.static_sort_size())` wrapper-as-written — the wrapper stays, but reference `streaming.is_static_tail_dirty(frame_in_flight)` via the parameter)
- Counts SSBO reset: lines 2011–2019
- Dynamic sort fill + TRANSFER→COMPUTE barrier: lines 2041–2056

Full method body (the bodies inside should be copied byte-for-byte from the line ranges above; structure shown for clarity):
```cpp
void GsSortSystem::prepare_buffers(VkCommandBuffer cmd, uint32_t frame_in_flight,
                                    uint32_t dynamic_count,
                                    GsStreamingSystem& streaming) {
    // 1. Static-tail fill — body from gs_renderer.cpp:1795–1837
    if (streaming.is_static_tail_dirty(frame_in_flight) &&
        streaming.static_count() < streaming.static_sort_size()) {
        // [lift gs_renderer.cpp:1810–1836 verbatim, replacing
        //  resources_->static_sort_as[..] with this->resources_->static_sort_as[..]
        //  and streaming_. with streaming.]
        streaming.clear_static_tail_dirty(frame_in_flight);
    }

    // 2. Counts SSBO reset — body from gs_renderer.cpp:2011–2019
    const bool static_dirty_this_frame =
        streaming.static_dirty() && streaming.static_count() > 0;
    if (static_dirty_this_frame) {
        vkCmdFillBuffer(cmd, resources_->counts_ssbos[frame_in_flight].buffer(), 0, 12, 0);
    } else {
        vkCmdFillBuffer(cmd, resources_->counts_ssbos[frame_in_flight].buffer(), 4, 8, 0);
    }

    // 3. Dynamic sort_a/b fill — body from gs_renderer.cpp:2041–2046
    if (dynamic_count > 0 && resources_->dynamic_sort_as[frame_in_flight].buffer()
                          && resources_->dynamic_sort_bs[frame_in_flight].buffer()) {
        const VkDeviceSize dyn_sort_bytes =
            static_cast<VkDeviceSize>(dynamic_sort_size_) * sizeof(SortEntry);
        vkCmdFillBuffer(cmd, resources_->dynamic_sort_as[frame_in_flight].buffer(),
                        0, dyn_sort_bytes, 0xFFFFFFFFu);
        vkCmdFillBuffer(cmd, resources_->dynamic_sort_bs[frame_in_flight].buffer(),
                        0, dyn_sort_bytes, 0xFFFFFFFFu);
    }

    // 4. TRANSFER→COMPUTE barrier — body from gs_renderer.cpp:2047–2056
    VkMemoryBarrier fill_barrier{};
    fill_barrier.sType         = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
    fill_barrier.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
    fill_barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
    vkCmdPipelineBarrier(cmd,
        VK_PIPELINE_STAGE_TRANSFER_BIT,
        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
        0, 1, &fill_barrier, 0, nullptr, 0, nullptr);
}
```

Note: `SortEntry` is defined in `gseurat/engine/sort_entry.hpp`. `dynamic_sort_size_` is already a `GsSortSystem` field (line 131 of the existing header).

- [ ] **Step 3.5: Replace the three inline blocks in `render()`**

In `src/engine/gs_renderer.cpp`:
- Replace the entire static-tail fill block at lines 1795–1837 with a single call: `// moved into sort_.prepare_buffers() — see step 3.5` (the call itself is added below).
- Replace the counts SSBO reset block at lines 2007–2019 with `// moved into sort_.prepare_buffers()`.
- Replace the dynamic sort fill + barrier block at lines 2041–2056 with `// moved into sort_.prepare_buffers()`.

Then add a single call just before the depth-sort timestamp begin (around line 2058–2062):
```cpp
    sort_.prepare_buffers(cmd, frame_in_flight, dynamic_count_, streaming_);
```

This single call replaces ~58 LOC of inline glue.

- [ ] **Step 3.6: Build + smoke + commit Task 3**

Run Gate A + Gate B. Expected: identical behavior — sort timing within ±0.5 ms of baseline.

```bash
cd /Users/eccyan/dev/GSeurat/.worktrees/phase5e-orchestrator
git add include/gseurat/engine/gs_renderer/sort/gs_sort_system.hpp \
        src/engine/gs_renderer.cpp \
        src/engine/gs_renderer/sort/gs_sort_system.cpp
git commit -m "$(cat <<'EOF'
refactor(engine): GsSortSystem absorbs sort-buffer init + static-tail fill
                  (#396 phase 5e step 3)

Lift the three sort-phase preparation blocks out of render() into
sort_.prepare_buffers(cmd, frame, dynamic_count, streaming):
  1. Static-tail fill — consults streaming.is_static_tail_dirty(frame),
     emits 2× vkCmdFillBuffer + 2-barrier, calls clear_static_tail_dirty.
  2. Counts SSBO reset — 12B or 8B depending on streaming.static_dirty().
  3. Dynamic sort_a/b fill 0xFFFFFFFFu — if dynamic_count > 0.
  4. Final TRANSFER→COMPUTE barrier.

render() drops ~58 LOC.  Streaming-system reference is passed in per-call
rather than held by sort_ (frame-scope dependency, not lifetime).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `GsSortSystem.dispatch()` — single entry, internal timestamps + barriers

Collapse `dispatch_preprocess` + `dispatch_depth_dynamic` + `dispatch_depth_static` + `dispatch_merge` + `prepare_buffers` + their internal compute barriers + the depth-sort timestamp pair into one `sort_.dispatch(cmd, frame, dynamic_count, streaming, timestamp_pool, ts_slot_offset)` entry.

**Files:**
- Modify: `include/gseurat/engine/gs_renderer/sort/gs_sort_system.hpp` (add `dispatch()`, mark `dispatch_preprocess` / `dispatch_depth_*` / `dispatch_merge` / `prepare_buffers` private — kept as helpers)
- Modify: `src/engine/gs_renderer/sort/gs_sort_system.cpp` (implement `dispatch()` calling existing helpers)
- Modify: `src/engine/gs_renderer.cpp` (replace ~50 LOC of render() with one call to `sort_.dispatch(...)`)

- [ ] **Step 4.1: Add `dispatch()` decl to `GsSortSystem` public surface**

In `include/gseurat/engine/gs_renderer/sort/gs_sort_system.hpp` above `dispatch_preprocess` (which now becomes private):
```cpp
    // Phase 5e: single depth-sort phase entry. Internalizes:
    //   - prepare_buffers (static-tail fill + counts reset + sort buffer fill)
    //   - ts_slot_offset + 0 timestamp (depth_sort_begin)
    //   - dynamic preprocess + sort (if dynamic_count > 0)
    //   - static preprocess + sort (if streaming.static_dirty() && static_count > 0)
    //   - merge dispatch (always)
    //   - final compute→compute barrier
    //   - ts_slot_offset + 1 timestamp (depth_sort_end)
    void dispatch(VkCommandBuffer cmd, uint32_t frame_in_flight,
                  uint32_t dynamic_count,
                  GsStreamingSystem& streaming,
                  VkQueryPool timestamp_pool,
                  uint32_t ts_slot_offset);
```

Move `dispatch_preprocess`, `dispatch_depth_dynamic`, `dispatch_depth_static`, `dispatch_depth_legacy`, `dispatch_merge`, `prepare_buffers` to the private section. (They remain callable from inside the class and are still called via the public `dispatch()`. `dispatch_depth_legacy` may stay public if it has external callers — grep first.)

Run: `grep -n "sort_\.dispatch_depth_legacy\|sort_\.dispatch_depth_dynamic\|sort_\.dispatch_depth_static\|sort_\.dispatch_merge" src/`
If only `src/engine/gs_renderer.cpp:render()` references them (it does, after Task 3), move them all to private.

- [ ] **Step 4.2: Implement `GsSortSystem::dispatch()`**

In `src/engine/gs_renderer/sort/gs_sort_system.cpp`:
```cpp
void GsSortSystem::dispatch(VkCommandBuffer cmd, uint32_t frame_in_flight,
                             uint32_t dynamic_count,
                             GsStreamingSystem& streaming,
                             VkQueryPool timestamp_pool,
                             uint32_t ts_slot_offset) {
    prepare_buffers(cmd, frame_in_flight, dynamic_count, streaming);

    // Depth sort timestamp: begin
    if (timestamp_pool != VK_NULL_HANDLE) {
        vkCmdWriteTimestamp(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                           timestamp_pool, ts_slot_offset + 0);
    }

    // Phase 1: dynamic preprocess + sort
    if (dynamic_count > 0) {
        GS_LABEL(cmd, "Dynamic");
        dispatch_preprocess(cmd, frame_in_flight, dynamic_count,
                            streaming.max_static_count(), /*is_static=*/false);
        // compute → compute barrier (preprocess → sort)
        VkMemoryBarrier b{VK_STRUCTURE_TYPE_MEMORY_BARRIER, nullptr,
                          VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT};
        vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                             VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                             0, 1, &b, 0, nullptr, 0, nullptr);
        dispatch_depth_dynamic(cmd, frame_in_flight);
    }

    // Phase 2: static preprocess + sort
    if (streaming.static_dirty() && streaming.static_count() > 0) {
        GS_LABEL(cmd, "Static");
        dispatch_preprocess(cmd, frame_in_flight, streaming.static_count(),
                            /*static_offset=*/0u, /*is_static=*/true);
        VkMemoryBarrier b{VK_STRUCTURE_TYPE_MEMORY_BARRIER, nullptr,
                          VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT};
        vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                             VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                             0, 1, &b, 0, nullptr, 0, nullptr);
        dispatch_depth_static(cmd, frame_in_flight);
        streaming.tick_static_dirty();
    }

    // Phase 3: merge (always)
    uint32_t total_upper = streaming.static_sort_size() + dynamic_sort_size_;
    dispatch_merge(cmd, frame_in_flight, total_upper);

    // Sort → tile barrier (cross-system; spec §5.4 producer-side)
    VkMemoryBarrier final_b{VK_STRUCTURE_TYPE_MEMORY_BARRIER, nullptr,
                            VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT};
    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                         VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                         0, 1, &final_b, 0, nullptr, 0, nullptr);

    // Depth sort timestamp: end
    if (timestamp_pool != VK_NULL_HANDLE) {
        vkCmdWriteTimestamp(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                           timestamp_pool, ts_slot_offset + 1);
    }
}
```

Note: the inline compute→compute barriers between preprocess and sort were `insert_compute_barrier(cmd)` calls in gs_renderer.cpp — re-create them as inline `VkMemoryBarrier` blocks here. The original `insert_compute_barrier` is a private helper on GsRenderer; do not call across the system boundary.

- [ ] **Step 4.3: Replace the depth-sort phase block in `render()`**

In `src/engine/gs_renderer.cpp`, delete the entire block from line 2058 (`// === Depth sort timestamp: begin ===`) through line 2126 (after `// === Depth sort timestamp: end ===`). Also delete the now-redundant `sort_.prepare_buffers(...)` call added in Task 3 step 3.5 (it's now inside `sort_.dispatch`).

Replace with one call:
```cpp
    sort_.dispatch(cmd, frame_in_flight, dynamic_count_, streaming_,
                   timestamp_pool_, ts_slot_offset);
```

Verify the calculation of `ts_slot_offset` at line 1854 is still in scope at the new call site. (It is — it's computed early in `render()`.)

- [ ] **Step 4.4: Build + smoke + commit Task 4**

Run Gate A + Gate B. Expected: behavior unchanged; `GS_LOG_FRAME` should still emit `DepthSort:` averages within ±0.5 ms of pre-refactor baseline.

```bash
cd /Users/eccyan/dev/GSeurat/.worktrees/phase5e-orchestrator
git add include/gseurat/engine/gs_renderer/sort/gs_sort_system.hpp \
        src/engine/gs_renderer.cpp \
        src/engine/gs_renderer/sort/gs_sort_system.cpp
git commit -m "$(cat <<'EOF'
refactor(engine): GsSortSystem.dispatch() — single depth-sort entry
                  (#396 phase 5e step 4)

Collapse render()'s depth-sort phase (~68 LOC) into one
sort_.dispatch(cmd, frame, dynamic_count, streaming, ts_pool, ts_offset)
call.  Internalizes:
  - prepare_buffers (Task 3 helper)
  - depth_sort_begin/end timestamps (ts+0, ts+1)
  - dynamic preprocess + sort (if dynamic_count > 0)
  - static preprocess + sort (if streaming.static_dirty() && static_count > 0)
  - merge dispatch (always)
  - sort → tile cross-system barrier (producer-side per spec §5.4)

Sub-method surface (dispatch_preprocess, dispatch_depth_*, dispatch_merge,
prepare_buffers) moved to private — they remain available as helpers
for the public dispatch() entry but are no longer part of the system's
external surface.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `GsTileBinSystem.dispatch()` — single entry, absorb timestamps + final barrier

Collapse `tile_.dispatch_sort` + `tile_.dispatch_render` + the four tile-phase timestamps + the final compute→compute barrier (currently in `render()` at lines 2128–2154) into a single `tile_.dispatch(cmd, frame, width, height, timestamp_pool, ts_slot_offset)`. Expose `emitted_timestamps_this_frame()` so the orchestrator can keep its `timestamps_written_per_slot_[frame]` flag.

**Files:**
- Modify: `include/gseurat/engine/gs_renderer/tile_bin/gs_tile_bin_system.hpp` (add `dispatch()`, `emitted_timestamps_this_frame()`; mark `dispatch_sort` / `dispatch_render` private)
- Modify: `src/engine/gs_renderer/tile_bin/gs_tile_bin_system.cpp` (implement `dispatch()`)
- Modify: `src/engine/gs_renderer.cpp` (replace lines 2128–2154 with one `tile_.dispatch(...)` call)

- [ ] **Step 5.1: Add `dispatch()` decl + `emitted_timestamps_this_frame()` accessor**

In `include/gseurat/engine/gs_renderer/tile_bin/gs_tile_bin_system.hpp` above `dispatch_sort` (line 65):
```cpp
    // Phase 5e: single tile-phase entry. Internalizes:
    //   - ts_slot_offset + 2 (tile_sort_begin)
    //   - dispatch_sort (existing internal 6-pass)
    //   - ts_slot_offset + 3 (tile_sort_end)
    //   - ts_slot_offset + 4 (raster_begin)
    //   - dispatch_render
    //   - ts_slot_offset + 5 (raster_end)
    //   - final compute→compute barrier (tile → post-process)
    void dispatch(VkCommandBuffer cmd, uint32_t frame_in_flight,
                  uint32_t width, uint32_t height,
                  VkQueryPool timestamp_pool, uint32_t ts_slot_offset);
    bool emitted_timestamps_this_frame() const { return emitted_timestamps_; }
```

Move `dispatch_sort` and `dispatch_render` to the private section.

Add to the private section near the determinism state (line 167):
```cpp
    bool emitted_timestamps_ = false;
```

- [ ] **Step 5.2: Implement `GsTileBinSystem::dispatch()`**

In `src/engine/gs_renderer/tile_bin/gs_tile_bin_system.cpp`:
```cpp
void GsTileBinSystem::dispatch(VkCommandBuffer cmd, uint32_t frame_in_flight,
                                uint32_t width, uint32_t height,
                                VkQueryPool timestamp_pool, uint32_t ts_slot_offset) {
    // === Tile sort: begin ===
    if (timestamp_pool != VK_NULL_HANDLE) {
        vkCmdWriteTimestamp(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                           timestamp_pool, ts_slot_offset + 2);
    }
    dispatch_sort(cmd, frame_in_flight);
    if (timestamp_pool != VK_NULL_HANDLE) {
        vkCmdWriteTimestamp(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                           timestamp_pool, ts_slot_offset + 3);
    }

    // === Tile rasterize: begin ===
    if (timestamp_pool != VK_NULL_HANDLE) {
        vkCmdWriteTimestamp(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                           timestamp_pool, ts_slot_offset + 4);
    }
    dispatch_render(cmd, frame_in_flight, width, height);
    if (timestamp_pool != VK_NULL_HANDLE) {
        vkCmdWriteTimestamp(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                           timestamp_pool, ts_slot_offset + 5);
    }

    emitted_timestamps_ = (timestamp_pool != VK_NULL_HANDLE);

    // Tile rasterize → post-process barrier (cross-system producer-side)
    VkMemoryBarrier b{VK_STRUCTURE_TYPE_MEMORY_BARRIER, nullptr,
                      VK_ACCESS_SHADER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT};
    vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                         VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                         0, 1, &b, 0, nullptr, 0, nullptr);
}
```

- [ ] **Step 5.3: Replace the tile-phase block in `render()`**

In `src/engine/gs_renderer.cpp`, delete lines 2128–2154 (the four `vkCmdWriteTimestamp` calls + `tile_.dispatch_sort` + `tile_.dispatch_render` + the post-rasterize `insert_compute_barrier`). Replace with:
```cpp
    tile_.dispatch(cmd, frame_in_flight, width, height,
                   timestamp_pool_, ts_slot_offset);
    sort_done_once_ = true;
    timestamps_written_per_slot_[frame_in_flight] = tile_.emitted_timestamps_this_frame();
```

Note: `sort_done_once_ = true` was at line 2151; the assignment stays at the renderer level because it's read by the orchestrator's `skip_gs_compute` calculation on subsequent frames. The original `timestamps_written_per_slot_[frame_in_flight] = true` write at line 2148 inside the if-block becomes the `emitted_timestamps_this_frame()`-driven assignment shown above.

- [ ] **Step 5.4: Build + smoke + commit Task 5**

Run Gate A + Gate B. Expected: `GS_LOG_FRAME` still emits `TileSort:` and `Rasterize:` averages within ±0.5 ms of baseline.

```bash
cd /Users/eccyan/dev/GSeurat/.worktrees/phase5e-orchestrator
git add include/gseurat/engine/gs_renderer/tile_bin/gs_tile_bin_system.hpp \
        src/engine/gs_renderer.cpp \
        src/engine/gs_renderer/tile_bin/gs_tile_bin_system.cpp
git commit -m "$(cat <<'EOF'
refactor(engine): GsTileBinSystem.dispatch() — single tile-phase entry
                  (#396 phase 5e step 5)

Collapse render()'s tile phase (~26 LOC) into one tile_.dispatch(cmd,
frame, w, h, ts_pool, ts_offset) call.  Internalizes:
  - tile_sort_begin/end timestamps (ts+2, ts+3)
  - dispatch_sort (existing internal 6-pass)
  - raster_begin/end timestamps (ts+4, ts+5)
  - dispatch_render
  - tile → post-process cross-system barrier (producer-side per spec §5.4)

Adds emitted_timestamps_this_frame() so the orchestrator's
timestamps_written_per_slot_[] flag tracks accurately.  Sub-methods
(dispatch_sort, dispatch_render) moved to private.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `GsPostProcessSystem` absorbs final processed_image transition

Move the `processed_image GENERAL → SHADER_READ_ONLY_OPTIMAL` barrier (currently lines 2167–2183 of `render()`) into `GsPostProcessSystem::dispatch()`. The transition becomes the last operation of `post_.dispatch()`. Per spec §5.4, the producer side owns the barrier.

**Files:**
- Modify: `src/engine/gs_renderer/post/gs_post_process_system.cpp` (append final-transition barrier emission inside `dispatch()`)
- Modify: `src/engine/gs_renderer.cpp` (delete lines 2167–2183)
- Modify: `include/gseurat/engine/gs_renderer/post/gs_post_process_system.hpp` (update docstring; no surface change)

- [ ] **Step 6.1: Update the `GsPostProcessSystem::dispatch` docstring**

In `include/gseurat/engine/gs_renderer/post/gs_post_process_system.hpp` lines 48–53, replace:
```cpp
    // Issue the gs_post_process.comp dispatch. Owns the processed_image
    // UNDEFINED→GENERAL pre-barrier. Caller owns the inter-pass barriers
    // around this (input layout transition before, SHADER_READ_ONLY after).
    // `frame_in_flight` selects the descriptor set + processed image slot.
    void dispatch(VkCommandBuffer cmd, uint32_t frame_in_flight,
                  uint32_t width, uint32_t height);
```
with:
```cpp
    // Issue the gs_post_process.comp dispatch. Owns both
    //  - the processed_image UNDEFINED→GENERAL pre-barrier (existing), and
    //  - the processed_image GENERAL→SHADER_READ_ONLY_OPTIMAL post-barrier
    //    (Phase 5e — absorbed from GsRenderer::render).
    // `frame_in_flight` selects the descriptor set + processed image slot.
    // Caller owns the upstream tile→post barrier (lives on GsTileBinSystem
    // per spec §5.4 producer-side rule).
    void dispatch(VkCommandBuffer cmd, uint32_t frame_in_flight,
                  uint32_t width, uint32_t height);
```

- [ ] **Step 6.2: Append the post-transition emit to `GsPostProcessSystem::dispatch`**

In `src/engine/gs_renderer/post/gs_post_process_system.cpp`, find the existing `dispatch(...)` function. At the very end of its body (after the existing `vkCmdDispatch(...)` for the post-process compute pipeline), append:
```cpp
    // Phase 5e: processed_image GENERAL → SHADER_READ_ONLY_OPTIMAL
    // (formerly at gs_renderer.cpp:2167–2183).
    VkImageMemoryBarrier barrier{};
    barrier.sType            = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
    barrier.srcAccessMask    = VK_ACCESS_SHADER_WRITE_BIT;
    barrier.dstAccessMask    = VK_ACCESS_SHADER_READ_BIT;
    barrier.oldLayout        = VK_IMAGE_LAYOUT_GENERAL;
    barrier.newLayout        = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
    barrier.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    barrier.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    barrier.image            = resources_->processed_images[frame_in_flight];
    barrier.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};

    vkCmdPipelineBarrier(cmd,
        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
        VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT,
        0, 0, nullptr, 0, nullptr, 1, &barrier);
```

- [ ] **Step 6.3: Delete the now-duplicate block in `render()`**

In `src/engine/gs_renderer.cpp`, delete lines 2167–2183 (the entire `// Transition this frame's processed image → SHADER_READ_ONLY ...` block ending at the closing brace before line 2184's function-end).

- [ ] **Step 6.4: Build + smoke + commit Task 6**

Run Gate A + Gate B. Expected: identical visual output — the fragment-shader blit downstream of `post_.dispatch()` requires `SHADER_READ_ONLY_OPTIMAL`; any garbled output indicates the barrier emission was lost.

```bash
cd /Users/eccyan/dev/GSeurat/.worktrees/phase5e-orchestrator
git add include/gseurat/engine/gs_renderer/post/gs_post_process_system.hpp \
        src/engine/gs_renderer.cpp \
        src/engine/gs_renderer/post/gs_post_process_system.cpp
git commit -m "$(cat <<'EOF'
refactor(engine): GsPostProcessSystem absorbs final processed_image
                  transition (#396 phase 5e step 6)

Move the processed_image GENERAL→SHADER_READ_ONLY_OPTIMAL barrier from
GsRenderer::render() into GsPostProcessSystem::dispatch() as the last
operation it emits.  Spec §5.4: barrier moves with the dispatch that
produces its srcAccessMask (SHADER_WRITE_BIT from the post-process
compute writeback).

The downstream fragment-shader blit (in Renderer::draw_scene) sees the
image in SHADER_READ_ONLY_OPTIMAL exactly as before; no orchestrator
glue needed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `GsRenderer::render()` — orchestrator shape (~80 LOC)

Extract the remaining renderer-local glue into five private helpers and rewrite `render()` as the orchestrator skeleton. After this task, the function body is ~80 LOC.

**Files:**
- Modify: `include/gseurat/engine/gs_renderer.hpp` (add 5 private helper decls)
- Modify: `src/engine/gs_renderer.cpp` (add 5 helper impls; rewrite `render()` body)

- [ ] **Step 7.1: Add private helper declarations**

In `include/gseurat/engine/gs_renderer.hpp` private section (near other private helpers; search for `void create_compute_pipelines();`):
```cpp
    void build_uniforms(const glm::mat4& view, const glm::mat4& proj) noexcept;
    void read_prev_timestamps(uint32_t frame) noexcept;
    void reset_timestamps(VkCommandBuffer cmd, uint32_t frame) noexcept;
    void transition_outputs_for_compute(VkCommandBuffer cmd, uint32_t frame) noexcept;
    void clear_outputs(VkCommandBuffer cmd, uint32_t frame) noexcept;
```

- [ ] **Step 7.2: Implement `GsRenderer::build_uniforms`**

In `src/engine/gs_renderer.cpp`, add the function (just before the existing `GsRenderer::render` definition at line 1733). Copy the body verbatim from `render()` lines 1752–1793, replacing the function-local `view`/`proj` references with the parameter names:
```cpp
void GsRenderer::build_uniforms(const glm::mat4& view, const glm::mat4& proj) noexcept {
    GsUniforms uniforms{};
    uniforms.view     = view;
    uniforms.proj     = proj;
    uniforms.inv_view = glm::inverse(view);
    uniforms.inv_proj = glm::inverse(proj);
    uint32_t width  = resources_->output_width;
    uint32_t height = resources_->output_height;
    uniforms.params = glm::uvec4(width, height, streaming_.gaussian_count(), streaming_.sort_size());
    uniforms.shadow_box = glm::vec4(shadow_box_margin_, shadow_box_cone_cos_,
                                     static_cast<float>(num_sort_passes_), scale_multiplier_);
    uniforms.cone_dir  = glm::vec4(shadow_box_cone_dir_, explode_t_);
    uniforms.cam_pos   = glm::vec4(shadow_box_cam_pos_, voxel_t_);
    uniforms.effect_flags = glm::vec4(
        static_cast<float>(toon_bands_),
        static_cast<float>(light_mode_),
        touch_active_ ? touch_time_ : 0.0f,
        time_);
    uniforms.light_params = glm::vec4(glm::normalize(light_dir_), light_intensity_);
    uniforms.touch_point  = glm::vec4(touch_point_, touch_radius_);
    uniforms.effect_params  = glm::vec4(water_y_, fire_y_min_, fire_y_max_, effect_strength_);
    uniforms.effect_params2 = glm::vec4(pulse_t_, xray_depth_, swirl_t_, burn_t_);
    uniforms.actor_rotation = glm::vec4(actor_rotation_.x, actor_rotation_.y,
                                        actor_rotation_.z, actor_rotation_.w);
    uniforms.point_light_params = glm::vec4(
        static_cast<float>(point_lights_.size()), pixel_art_intensity_, 0, 0);
    for (size_t i = 0; i < point_lights_.size() && i < kMaxGsPointLights; i++) {
        uniforms.pl_pos_rad[i]  = point_lights_[i].position_and_radius;
        uniforms.pl_color[i]    = point_lights_[i].color;
        uniforms.pl_dir_cone[i] = point_lights_[i].direction_and_cone;
        uniforms.pl_area[i]     = point_lights_[i].area_params;
    }
    float near_z = proj[3][2] / proj[2][2];
    float far_z  = proj[3][2] / (proj[2][2] + 1.0f);
    uint32_t tiles_x = (width + 15) / 16;
    uint32_t tiles_y = (height + 15) / 16;
    uniforms.tile_sort_params = glm::vec4(near_z, far_z,
        static_cast<float>(tiles_x), static_cast<float>(tiles_y));
    std::memcpy(resources_->uniform_buffer.mapped(), &uniforms, sizeof(uniforms));
}
```

- [ ] **Step 7.3: Implement `GsRenderer::read_prev_timestamps`**

```cpp
void GsRenderer::read_prev_timestamps(uint32_t frame) noexcept {
    const uint32_t ts_slot_offset = frame * kTimestampQueriesPerFrame;
    if (!timestamp_pool_ || !timestamps_written_per_slot_[frame]) return;

    uint64_t ts[kTimestampQueriesPerFrame]{};
#if GSEURAT_DEBUG_BUILD
    const auto t_wait_start = std::chrono::steady_clock::now();
#endif
    VkResult ts_result = vkGetQueryPoolResults(
        device_, timestamp_pool_, ts_slot_offset, kTimestampQueriesPerFrame,
        sizeof(ts), ts, sizeof(uint64_t),
        VK_QUERY_RESULT_64_BIT);
#if GSEURAT_DEBUG_BUILD
    const auto t_wait_end = std::chrono::steady_clock::now();
    const double wait_ms = std::chrono::duration<double, std::milli>(t_wait_end - t_wait_start).count();
    if (wait_ms > 100.0) {
        float prev_depth_ms = (ts_result == VK_SUCCESS && ts[1] > ts[0])
            ? static_cast<float>(ts[1] - ts[0]) * timestamp_period_ns_ / 1e6f : -1.0f;
        float prev_tile_ms = (ts_result == VK_SUCCESS && ts[3] > ts[2])
            ? static_cast<float>(ts[3] - ts[2]) * timestamp_period_ns_ / 1e6f : -1.0f;
        float prev_raster_ms = (ts_result == VK_SUCCESS && ts[5] > ts[4])
            ? static_cast<float>(ts[5] - ts[4]) * timestamp_period_ns_ / 1e6f : -1.0f;
        GS_LOG_FRAME("[gs_render/wd/WAIT_SLOW] wait_ms={:.1f} prev_depth={:.1f}ms prev_tile={:.1f}ms prev_raster={:.1f}ms "
                     "static={} dyn={} total={}",
                     wait_ms, prev_depth_ms, prev_tile_ms, prev_raster_ms,
                     streaming_.static_count(), dynamic_count_, streaming_.gaussian_count());
    }
#endif
    if (ts_result == VK_SUCCESS && ts[5] > ts[4] && ts[3] > ts[2] && ts[1] > ts[0]) {
        float depth_ms  = static_cast<float>(ts[1] - ts[0]) * timestamp_period_ns_ / 1e6f;
        float tile_ms   = static_cast<float>(ts[3] - ts[2]) * timestamp_period_ns_ / 1e6f;
        float raster_ms = static_cast<float>(ts[5] - ts[4]) * timestamp_period_ns_ / 1e6f;
        depth_sort_ms_last_ = depth_ms;
        tile_sort_ms_last_  = tile_ms;
        rasterize_ms_last_  = raster_ms;
        depth_sort_ms_accum_ += depth_ms;
        tile_sort_ms_accum_  += tile_ms;
        rasterize_ms_accum_  += raster_ms;
        ++timestamp_frame_;
        if (timestamp_frame_ % kTimestampAvgFrames == 0) {
            float d_avg = depth_sort_ms_accum_ / static_cast<float>(kTimestampAvgFrames);
            float t_avg = tile_sort_ms_accum_  / static_cast<float>(kTimestampAvgFrames);
            float r_avg = rasterize_ms_accum_  / static_cast<float>(kTimestampAvgFrames);
            GS_LOG_FRAME("[gs_renderer] DepthSort: {:.3f} ms  TileSort: {:.3f} ms  Rasterize: {:.3f} ms  Total: {:.3f} ms (avg {} frames)",
                         d_avg, t_avg, r_avg, d_avg + t_avg + r_avg, kTimestampAvgFrames);
            depth_sort_ms_avg_ = d_avg;
            tile_sort_ms_avg_  = t_avg;
            rasterize_ms_avg_  = r_avg;
            depth_sort_ms_accum_ = 0.0f;
            tile_sort_ms_accum_  = 0.0f;
            rasterize_ms_accum_  = 0.0f;
        }
    }
}
```

This is a verbatim move of gs_renderer.cpp:1854–1905.

- [ ] **Step 7.4: Implement `GsRenderer::reset_timestamps`**

```cpp
void GsRenderer::reset_timestamps(VkCommandBuffer cmd, uint32_t frame) noexcept {
    if (!timestamp_pool_) return;
    const uint32_t ts_slot_offset = frame * kTimestampQueriesPerFrame;
    vkCmdResetQueryPool(cmd, timestamp_pool_, ts_slot_offset, kTimestampQueriesPerFrame);
    timestamps_written_per_slot_[frame] = false;
}
```

Verbatim move of gs_renderer.cpp:1909–1912.

- [ ] **Step 7.5: Implement `GsRenderer::transition_outputs_for_compute`**

```cpp
void GsRenderer::transition_outputs_for_compute(VkCommandBuffer cmd, uint32_t frame) noexcept {
    const VkImage out_img   = resources_->output_images[frame];
    const VkImage depth_img = resources_->depth_images[frame];

    VkImageMemoryBarrier barriers[2]{};
    barriers[0].sType            = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
    barriers[0].srcAccessMask    = 0;
    barriers[0].dstAccessMask    = VK_ACCESS_SHADER_WRITE_BIT;
    barriers[0].oldLayout        = VK_IMAGE_LAYOUT_UNDEFINED;
    barriers[0].newLayout        = VK_IMAGE_LAYOUT_GENERAL;
    barriers[0].srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    barriers[0].dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
    barriers[0].image            = out_img;
    barriers[0].subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};

    barriers[1]       = barriers[0];
    barriers[1].image = depth_img;

    vkCmdPipelineBarrier(cmd,
        VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT,
        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
        0, 0, nullptr, 0, nullptr, 2, barriers);
}
```

Verbatim move of gs_renderer.cpp:1918–1938.

- [ ] **Step 7.6: Implement `GsRenderer::clear_outputs`**

```cpp
void GsRenderer::clear_outputs(VkCommandBuffer cmd, uint32_t frame) noexcept {
    const VkImage out_img   = resources_->output_images[frame];
    const VkImage depth_img = resources_->depth_images[frame];
    VkClearColorValue clear_color = {{0.0f, 0.0f, 0.0f, 0.0f}};
    VkImageSubresourceRange range = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
    vkCmdClearColorImage(cmd, out_img,   VK_IMAGE_LAYOUT_GENERAL, &clear_color, 1, &range);
    vkCmdClearColorImage(cmd, depth_img, VK_IMAGE_LAYOUT_GENERAL, &clear_color, 1, &range);
}
```

Verbatim move of gs_renderer.cpp:1940–1945.

- [ ] **Step 7.7: Rewrite `GsRenderer::render` body**

Replace the entire body of `GsRenderer::render` (lines 1734–2184) with the orchestrator skeleton. The function signature stays exactly the same.

```cpp
void GsRenderer::render(VkCommandBuffer cmd, uint32_t frame_in_flight,
                        const glm::mat4& view, const glm::mat4& proj) {
    if (streaming_.gaussian_count() == 0 &&
        streaming_.static_count() == 0 &&
        dynamic_count_ == 0) return;
    if (frame_in_flight >= kMaxFramesInFlight) {
        std::fprintf(stderr, "[gs_renderer] render(): frame_in_flight=%u out of range\n",
                     frame_in_flight);
        return;
    }
    GS_LABEL(cmd, "GS.Render");

    const uint32_t width        = resources_->output_width;
    const uint32_t height       = resources_->output_height;
    const uint32_t ts_offset    = frame_in_flight * kTimestampQueriesPerFrame;

    build_uniforms(view, proj);
    read_prev_timestamps(frame_in_flight);
    reset_timestamps(cmd, frame_in_flight);

    const bool skip_gs_compute = skip_sort_ && sort_done_once_;

    if (!skip_gs_compute) {
        transition_outputs_for_compute(cmd, frame_in_flight);
        clear_outputs(cmd, frame_in_flight);

        pbd_.dispatch(cmd, frame_in_flight, time_, tile_.determinism_test_active());

        sort_.dispatch(cmd, frame_in_flight, dynamic_count_, streaming_,
                       timestamp_pool_, ts_offset);

        tile_.dispatch(cmd, frame_in_flight, width, height,
                       timestamp_pool_, ts_offset);

        sort_done_once_ = true;
        timestamps_written_per_slot_[frame_in_flight] = tile_.emitted_timestamps_this_frame();
    }

    post_.dispatch(cmd, frame_in_flight, width, height);
}
```

Verify the line count of the new body: 27 statements + comments + braces should compile to ~45–55 source lines plus blanks. Within the ~80-LOC target.

- [ ] **Step 7.8: Build + smoke + commit Task 7**

Run Gate A + Gate B.

```bash
cd /Users/eccyan/dev/GSeurat/.worktrees/phase5e-orchestrator
git add include/gseurat/engine/gs_renderer.hpp \
        src/engine/gs_renderer.cpp
git commit -m "$(cat <<'EOF'
refactor(engine): GsRenderer::render() — orchestrator shape (~80 LOC)
                  (#396 phase 5e step 7)

Extract the five renderer-local glue concerns from the inline render()
body into private helpers:
  - build_uniforms(view, proj) — 42-LOC GsUniforms construction + memcpy
  - read_prev_timestamps(frame) — non-blocking vkGetQueryPoolResults + accumulators
  - reset_timestamps(cmd, frame) — per-slot vkCmdResetQueryPool
  - transition_outputs_for_compute(cmd, frame) — 2× UNDEFINED→GENERAL
  - clear_outputs(cmd, frame) — 2× vkCmdClearColorImage

The new render() body is a 27-statement orchestrator dominated by the
five subsystem dispatch() calls and the five helpers above.  Total
function shrinks from 451 LOC to ~45 source statements (~80 LOC
formatted including blanks/braces).

This closes the engine refactor #396.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## End-of-PR verification (manual, run after Task 7 commits cleanly)

These are gates the user runs once before opening the PR. They are not subagent tasks.

- [ ] **Manual Gate: RenderDoc structural diff vs main-at-merge-base**

1. Check out `main` at `7eb2b072` in the main worktree.
2. Build macos-release, run island_demo, capture one RenderDoc frame.
3. Switch to `.worktrees/phase5e-orchestrator/`, ensure HEAD is at the Task 7 commit.
4. Build macos-release, run island_demo, capture a RenderDoc frame at the same scene state.
5. Diff the GS.Render label hierarchy + dispatch sequence + every barrier's `srcAccessMask`/`dstAccessMask`/`srcStageMask`/`dstStageMask`.

Expected: structurally identical command stream. Any divergence is a merge blocker.

- [ ] **Manual Gate: Timestamp baseline comparison**

Compare 30 seconds of `GS_LOG_FRAME` output between main and the 5e branch:
- `DepthSort:` average within ±0.5 ms
- `TileSort:` average within ±0.5 ms
- `Rasterize:` average within ±0.5 ms

- [ ] **CI gate: 3 OS green**

Push the branch and confirm CI green on ubuntu-24.04, macos-latest, windows-latest. Use `curl + REST API` with the keyring token; gh CLI is broken on macOS RSR May 15.

```bash
TOKEN=$(security find-internet-password -s github.com -a eccyan -w)
git push -u origin refactor/396-phase5e-render-orchestrator
# Then create PR via curl + REST API (see existing PR #460 commits for pattern).
```

---

## Final-LOC self-check

| File | Pre-5e LOC | Target post-5e LOC | Delta |
|---|---|---|---|
| `src/engine/gs_renderer.cpp` | 2388 | ~2050 | −338 |
| `include/gseurat/engine/gs_renderer.hpp` | 598 | ~560 | −38 |
| `src/engine/gs_renderer/sort/gs_sort_system.cpp` | (current) | +preprocess + buffer-init + dispatch wrapper ≈ +350 | +350 |
| `src/engine/gs_renderer/tile_bin/gs_tile_bin_system.cpp` | (current) | +dispatch wrapper ≈ +50 | +50 |
| `src/engine/gs_renderer/post/gs_post_process_system.cpp` | (current) | +final transition ≈ +20 | +20 |
| `src/engine/gs_renderer/pbd/gs_pbd_system.cpp` | 0 | ~230 | +230 |
| Net | — | — | ~+275 (code reorganization; LOC growth from new boilerplate + headers) |

`GsRenderer::render()` itself shrinks from 451 to ~80 LOC — the headline goal.
