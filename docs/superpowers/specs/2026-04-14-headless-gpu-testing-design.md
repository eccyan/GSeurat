# Headless GPU Testing Framework — Design Spec

**Goal:** Validate GPU compute shaders (starting with Onesweep radix sort) via headless Vulkan execution — no window, no swapchain, pure VRAM computation with CPU readback verification.

**Motivation:** GPU compute bugs (AMD coherency issues, workgroup sizing edge cases) are invisible in CPU-only tests. Running the actual SPIR-V shaders on actual hardware catches what unit tests cannot.

---

## 1. Headless VkContext

Extend `VkContext` with `init_headless()` alongside the existing `init(GLFWwindow*)`.

**Changes to `vk_context.hpp`:**
- Add `void init_headless();`
- Add `bool headless_ = false;` private member

**`init_headless()` behavior:**
- Creates VkInstance WITHOUT `VK_KHR_surface` or presentation extensions. Keeps `VK_KHR_PORTABILITY_ENUMERATION` for macOS.
- Skips VkSurfaceKHR creation entirely.
- Physical device selection: same discrete > integrated preference logic, but skips surface format/present mode checks.
- Queue family selection: finds a family with `VK_QUEUE_COMPUTE_BIT | VK_QUEUE_TRANSFER_BIT`, ignoring present support. Stores in `graphics_queue_family_` / `graphics_queue_` (reuses existing members — all compute dispatches go through these in production too).
- Device creation: enables same device features, creates VMA allocator identically.
- `shutdown()`: checks `headless_` to skip surface destruction.

**No other engine code changes.** Tests use the same `VkContext`, `Buffer`, and VMA patterns as production.

## 2. GPU Test Harness — `GpuTestContext`

Location: `tests/gpu_test_context.hpp` (header-only or with minimal `.cpp`)

Wraps:
- `VkContext ctx_` initialized via `init_headless()`
- `VkCommandPool cmd_pool_`
- `VkCommandBuffer cmd_`
- `VkFence fence_`

Public API:
```cpp
struct GpuTestContext {
    void init();       // init_headless + create pool/cmd/fence
    void shutdown();   // destroy in reverse order

    VkContext& context();
    VmaAllocator allocator();
    VkCommandBuffer begin_commands();                     // reset + begin
    void submit_and_wait();                               // end + submit + wait on fence

    // Convenience: upload CPU vector to GPU-only storage buffer via staging
    Buffer upload(const void* data, VkDeviceSize size);
    // Convenience: copy GPU buffer to CPU-readable readback buffer, return mapped ptr
    const void* readback(const Buffer& gpu_buf, VkDeviceSize size);
};
```

Uses existing `Buffer::create_staging()`, `Buffer::create_storage_gpu_only()`, `Buffer::create_readback()`.

## 3. Onesweep Test Runner — `OnesweepTestRunner`

Location: `tests/onesweep_test_runner.hpp` / `.cpp`

Encapsulates the full Onesweep pipeline:
- Loads compiled SPIR-V from `build/<preset>/shaders/gs_onesweep_histogram.comp.spv` and `gs_onesweep_scatter.comp.spv`
- Creates descriptor set layouts, pipeline layouts, pipelines (same bindings as `gs_renderer.cpp`)
- Allocates: buffer A (input/output), buffer B (ping-pong), status buffer, indirect args buffer

**Descriptor layouts (matching production):**
- Histogram: set 0 = {binding 0: input SSBO, binding 1: status SSBO (coherent), binding 2: indirect args SSBO}
- Scatter: set 0 = {binding 0: input SSBO, binding 1: output SSBO, binding 2: status SSBO, binding 3: indirect args SSBO}

**Push constant:** single `uint32_t pass` (0-3)

Public API:
```cpp
struct OnesweepTestRunner {
    void init(GpuTestContext& gpu);
    void shutdown();

    // Sort entries on GPU. Returns sorted result.
    std::vector<TileSortEntry> sort(GpuTestContext& gpu,
                                     const std::vector<TileSortEntry>& input);
};
```

`sort()` implementation:
1. Upload input to buffer A, fill buffer A remainder with 0xFFFFFFFF sentinels
2. Write indirect args: `{num_workgroups, 1, 1, ranges_wg, 0, 0, entry_count, histogram_count}`
3. Clear status buffer with `vkCmdFillBuffer(..., 0)`
4. Record 4 passes: histogram dispatch → barrier → scatter dispatch → barrier (ping-pong A↔B)
5. Copy final output to readback buffer
6. `submit_and_wait()`, memcpy result to vector

## 4. Test Cases — `test_onesweep_gpu.cpp`

Uses existing custom assert pattern (`assert()` + printf PASS/FAIL).

### test_basic_sort
- Generate 100,000 random TileSortEntry (random keys, sequential indices)
- Sort via OnesweepTestRunner
- Assert `std::is_sorted(result.begin(), result.end(), by_key)`

### test_stable_sort
- Generate entries with many duplicate keys but unique indices
- Sort, then for each group of equal keys, verify indices appear in original relative order

### test_low_workgroup_count
- Generate exactly 50 × 2048 = 102,400 entries
- Sort and verify sorted — catches AMD decoupled-lookback coherency issues at specific workgroup counts

### test_single_workgroup
- Generate exactly 2048 entries (1 workgroup, minimum dispatch)
- Sort and verify — edge case where lookback has no predecessors

### test_sentinel_fill
- Generate 1000 real entries, capacity = 4096 (2 workgroups)
- Pre-fill buffer with 0xFFFFFFFF sentinels
- Sort and verify: first 1000 entries are sorted real data, remaining 3096 are sentinels

## 5. Build Integration

**New CMake function** in `CMakeLists.txt`:
```cmake
function(add_gseurat_gpu_test NAME)
    add_executable(${NAME} tests/${NAME}.cpp ${ARGN})
    target_include_directories(${NAME} PRIVATE
        ${PROJECT_SOURCE_DIR}/include
        ${PROJECT_SOURCE_DIR}/tests)
    target_compile_definitions(${NAME} PRIVATE GLM_FORCE_DEPTH_ZERO_TO_ONE)
    target_link_libraries(${NAME} PRIVATE gseurat_core Vulkan::Vulkan
        glm::glm GPUOpen::VulkanMemoryAllocator)
    add_test(NAME ${NAME} COMMAND ${NAME}
             WORKING_DIRECTORY ${PROJECT_SOURCE_DIR})
    set_tests_properties(${NAME} PROPERTIES LABELS "gpu")
endfunction()
```

- Links `gseurat_core` (VkContext, Buffer, etc.) — no GLFW dependency needed
- `LABELS gpu` allows CI to skip with `ctest --label-exclude gpu` on headless machines
- Shader SPIR-V: tests reference compiled shaders from build directory (same as production via existing `compile_shaders` target)
- GPU test executables depend on `compile_shaders` target

## 6. File Structure

```
include/gseurat/engine/vk_context.hpp    — add init_headless() declaration
src/engine/vk_context.cpp                — add init_headless() implementation
tests/gpu_test_context.hpp               — GpuTestContext harness (new)
tests/gpu_test_context.cpp               — GpuTestContext implementation (new)
tests/onesweep_test_runner.hpp           — OnesweepTestRunner (new)
tests/onesweep_test_runner.cpp           — OnesweepTestRunner implementation (new)
tests/test_onesweep_gpu.cpp              — 5 GPU test cases (new)
CMakeLists.txt                           — add_gseurat_gpu_test + deps
```
