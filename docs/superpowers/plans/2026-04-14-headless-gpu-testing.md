# Headless GPU Testing Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run Onesweep radix sort on actual GPU hardware without a window, validate correctness via CPU readback.

**Architecture:** Extend `VkContext` with `init_headless()` for windowless Vulkan. Build a `GpuTestContext` harness for command submission/readback. Build an `OnesweepTestRunner` that replicates the production 4-pass dispatch. Write 5 test cases covering basic sort, stability, edge cases, and the AMD coherency bug.

**Tech Stack:** C++23, Vulkan 1.3, VMA, existing `Buffer`/`VkContext`/`load_shader_module` engine code.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `include/gseurat/engine/vk_context.hpp` | Add `init_headless()` declaration, `headless_` flag |
| `src/engine/vk_context.cpp` | Implement `init_headless()`, headless instance/device/queue creation |
| `tests/gpu_test_context.hpp` | `GpuTestContext` — headless init, command pool, submit-and-wait, upload/readback |
| `tests/gpu_test_context.cpp` | `GpuTestContext` implementation |
| `tests/onesweep_test_runner.hpp` | `OnesweepTestRunner` — pipeline setup, 4-pass dispatch, sort API |
| `tests/onesweep_test_runner.cpp` | `OnesweepTestRunner` implementation |
| `tests/test_onesweep_gpu.cpp` | 5 GPU test cases |
| `CMakeLists.txt` | `add_gseurat_gpu_test` function + test registration |

---

### Task 1: Add `init_headless()` to VkContext

**Files:**
- Modify: `include/gseurat/engine/vk_context.hpp`
- Modify: `src/engine/vk_context.cpp`

- [ ] **Step 1: Add declaration and flag to header**

In `include/gseurat/engine/vk_context.hpp`, add `init_headless()` and `headless_` flag:

```cpp
// After line 13 (void init(GLFWwindow* window);):
    void init_headless();

// After line 49 (bool is_apple_gpu_{false};):
    bool headless_{false};
```

- [ ] **Step 2: Add `init_headless()` implementation**

In `src/engine/vk_context.cpp`, add after `init()` (line 29):

```cpp
void VkContext::init_headless() {
    headless_ = true;
    create_instance_headless();
    setup_debug_messenger();
    pick_physical_device_headless();
    create_logical_device_headless();
    create_allocator();
}
```

- [ ] **Step 3: Add `create_instance_headless()` private method**

In the header, add to private section (after line 29):
```cpp
    void create_instance_headless();
    void pick_physical_device_headless();
    void create_logical_device_headless();
```

In the cpp, add implementation:

```cpp
void VkContext::create_instance_headless() {
    VkApplicationInfo app_info{};
    app_info.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO;
    app_info.pApplicationName = "GSeurat-Test";
    app_info.applicationVersion = VK_MAKE_VERSION(0, 1, 0);
    app_info.pEngineName = "GSeurat";
    app_info.engineVersion = VK_MAKE_VERSION(1, 0, 0);
    app_info.apiVersion = VK_API_VERSION_1_3;

    std::vector<const char*> extensions;
    extensions.push_back(VK_KHR_PORTABILITY_ENUMERATION_EXTENSION_NAME);

#ifndef NDEBUG
    extensions.push_back(VK_EXT_DEBUG_UTILS_EXTENSION_NAME);
#endif

    VkInstanceCreateInfo create_info{};
    create_info.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO;
    create_info.pApplicationInfo = &app_info;
    create_info.enabledExtensionCount = static_cast<uint32_t>(extensions.size());
    create_info.ppEnabledExtensionNames = extensions.data();
    create_info.flags |= VK_INSTANCE_CREATE_ENUMERATE_PORTABILITY_BIT_KHR;

#ifndef NDEBUG
    const char* validation_layer = "VK_LAYER_KHRONOS_validation";
    create_info.enabledLayerCount = 1;
    create_info.ppEnabledLayerNames = &validation_layer;
#else
    create_info.enabledLayerCount = 0;
#endif

    if (vkCreateInstance(&create_info, nullptr, &instance_) != VK_SUCCESS) {
        throw std::runtime_error("Failed to create headless Vulkan instance");
    }
}
```

- [ ] **Step 4: Add `pick_physical_device_headless()`**

```cpp
void VkContext::pick_physical_device_headless() {
    uint32_t count = 0;
    vkEnumeratePhysicalDevices(instance_, &count, nullptr);
    if (count == 0) {
        throw std::runtime_error("No Vulkan-capable GPU found");
    }

    std::vector<VkPhysicalDevice> devices(count);
    vkEnumeratePhysicalDevices(instance_, &count, devices.data());

    VkPhysicalDevice fallback = VK_NULL_HANDLE;

    for (auto dev : devices) {
        // Check for compute+transfer queue support
        uint32_t family_count = 0;
        vkGetPhysicalDeviceQueueFamilyProperties(dev, &family_count, nullptr);
        std::vector<VkQueueFamilyProperties> families(family_count);
        vkGetPhysicalDeviceQueueFamilyProperties(dev, &family_count, families.data());

        bool has_compute = false;
        for (const auto& f : families) {
            if ((f.queueFlags & VK_QUEUE_COMPUTE_BIT) && (f.queueFlags & VK_QUEUE_TRANSFER_BIT)) {
                has_compute = true;
                break;
            }
        }
        if (!has_compute) continue;

        VkPhysicalDeviceProperties props;
        vkGetPhysicalDeviceProperties(dev, &props);

        if (props.deviceType == VK_PHYSICAL_DEVICE_TYPE_DISCRETE_GPU) {
            physical_device_ = dev;
            is_apple_gpu_ = (props.vendorID == 0x106B);
            std::printf("[vk_context] GPU: %s (vendor 0x%04X)%s [headless]\n",
                        props.deviceName, props.vendorID,
                        is_apple_gpu_ ? " [Apple — TBDR]" : "");
            return;
        }
        if (fallback == VK_NULL_HANDLE) fallback = dev;
    }

    if (fallback == VK_NULL_HANDLE) {
        throw std::runtime_error("No suitable GPU found for headless compute");
    }
    physical_device_ = fallback;

    VkPhysicalDeviceProperties props;
    vkGetPhysicalDeviceProperties(physical_device_, &props);
    is_apple_gpu_ = (props.vendorID == 0x106B);
    std::printf("[vk_context] GPU: %s (vendor 0x%04X)%s [headless]\n",
                props.deviceName, props.vendorID,
                is_apple_gpu_ ? " [Apple — TBDR]" : "");
}
```

- [ ] **Step 5: Add `create_logical_device_headless()`**

```cpp
void VkContext::create_logical_device_headless() {
    // Log subgroup properties
    {
        VkPhysicalDeviceSubgroupProperties subgroup_props{};
        subgroup_props.sType = VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_SUBGROUP_PROPERTIES;
        VkPhysicalDeviceProperties2 props2{};
        props2.sType = VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_PROPERTIES_2;
        props2.pNext = &subgroup_props;
        vkGetPhysicalDeviceProperties2(physical_device_, &props2);
        std::printf("[vk_context] Subgroup size: %u, supported stages: 0x%x, supported ops: 0x%x\n",
                    subgroup_props.subgroupSize,
                    subgroup_props.supportedStages,
                    subgroup_props.supportedOperations);
    }

    // Find compute+transfer queue family (no present required)
    uint32_t family_count = 0;
    vkGetPhysicalDeviceQueueFamilyProperties(physical_device_, &family_count, nullptr);
    std::vector<VkQueueFamilyProperties> families(family_count);
    vkGetPhysicalDeviceQueueFamilyProperties(physical_device_, &family_count, families.data());

    graphics_queue_family_ = UINT32_MAX;
    for (uint32_t i = 0; i < families.size(); ++i) {
        if ((families[i].queueFlags & VK_QUEUE_COMPUTE_BIT) &&
            (families[i].queueFlags & VK_QUEUE_TRANSFER_BIT)) {
            graphics_queue_family_ = i;
            break;
        }
    }
    if (graphics_queue_family_ == UINT32_MAX) {
        throw std::runtime_error("No compute+transfer queue family found");
    }

    // Look for dedicated transfer queue (same logic as windowed)
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

    VkDeviceQueueCreateInfo compute_info{};
    compute_info.sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO;
    compute_info.queueFamilyIndex = graphics_queue_family_;
    compute_info.queueCount = 1;
    compute_info.pQueuePriorities = &priority;
    queue_infos.push_back(compute_info);

    if (transfer_family >= 0 && static_cast<uint32_t>(transfer_family) != graphics_queue_family_) {
        VkDeviceQueueCreateInfo xfer_info{};
        xfer_info.sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO;
        xfer_info.queueFamilyIndex = static_cast<uint32_t>(transfer_family);
        xfer_info.queueCount = 1;
        xfer_info.pQueuePriorities = &priority;
        queue_infos.push_back(xfer_info);
        transfer_queue_family_ = static_cast<uint32_t>(transfer_family);
        has_dedicated_transfer_ = true;
    } else {
        transfer_queue_family_ = graphics_queue_family_;
        has_dedicated_transfer_ = false;
    }

    VkPhysicalDeviceFeatures features{};

    // No swapchain extension needed for headless
    std::vector<const char*> extensions;
    uint32_t ext_count = 0;
    vkEnumerateDeviceExtensionProperties(physical_device_, nullptr, &ext_count, nullptr);
    std::vector<VkExtensionProperties> available(ext_count);
    vkEnumerateDeviceExtensionProperties(physical_device_, nullptr, &ext_count, available.data());
    for (const auto& ext : available) {
        if (std::strcmp(ext.extensionName, "VK_KHR_portability_subset") == 0) {
            extensions.push_back("VK_KHR_portability_subset");
            break;
        }
    }

    VkDeviceCreateInfo create_info{};
    create_info.sType = VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO;
    create_info.queueCreateInfoCount = static_cast<uint32_t>(queue_infos.size());
    create_info.pQueueCreateInfos = queue_infos.data();
    create_info.pEnabledFeatures = &features;
    create_info.enabledExtensionCount = static_cast<uint32_t>(extensions.size());
    create_info.ppEnabledExtensionNames = extensions.data();

    if (vkCreateDevice(physical_device_, &create_info, nullptr, &device_) != VK_SUCCESS) {
        throw std::runtime_error("Failed to create headless logical device");
    }

    vkGetDeviceQueue(device_, graphics_queue_family_, 0, &graphics_queue_);

    if (has_dedicated_transfer_) {
        vkGetDeviceQueue(device_, transfer_queue_family_, 0, &transfer_queue_);
    } else {
        transfer_queue_ = graphics_queue_;
    }
}
```

- [ ] **Step 6: Guard surface destruction in shutdown()**

In `VkContext::shutdown()`, wrap the surface destroy (line 43):

```cpp
    if (!headless_) {
        vkDestroySurfaceKHR(instance_, surface_, nullptr);
    }
```

- [ ] **Step 7: Build to verify**

Run: `cmake --build --preset macos-debug 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 8: Commit**

```bash
git add include/gseurat/engine/vk_context.hpp src/engine/vk_context.cpp
git commit -m "feat(engine): add init_headless() to VkContext for windowless GPU compute"
```

---

### Task 2: GPU Test Harness (`GpuTestContext`)

**Files:**
- Create: `tests/gpu_test_context.hpp`
- Create: `tests/gpu_test_context.cpp`

- [ ] **Step 1: Create `tests/gpu_test_context.hpp`**

```cpp
#pragma once

#include "gseurat/engine/vk_context.hpp"
#include "gseurat/engine/buffer.hpp"

#include <vector>

namespace gseurat {

class GpuTestContext {
public:
    void init();
    void shutdown();

    VkContext& context() { return ctx_; }
    VmaAllocator allocator() { return ctx_.allocator(); }
    VkDevice device() { return ctx_.device(); }
    uint32_t queue_family() { return ctx_.graphics_queue_family(); }

    // Begin recording commands (resets command buffer)
    VkCommandBuffer begin_commands();

    // End recording, submit to compute queue, wait until complete
    void submit_and_wait();

    // Upload CPU data to a GPU-only storage buffer via staging + copy command.
    // Caller must call begin_commands() before, submit_and_wait() after.
    Buffer upload_to_gpu(VkCommandBuffer cmd, const void* data, VkDeviceSize size);

    // Copy GPU buffer contents to a CPU-readable readback buffer.
    // Caller must call begin_commands() before, submit_and_wait() after.
    // Returns pointer to mapped memory (valid until readback buffer is destroyed).
    Buffer readback_from_gpu(VkCommandBuffer cmd, const Buffer& gpu_buf, VkDeviceSize size);

private:
    VkContext ctx_;
    VkCommandPool cmd_pool_ = VK_NULL_HANDLE;
    VkCommandBuffer cmd_ = VK_NULL_HANDLE;
    VkFence fence_ = VK_NULL_HANDLE;

    // Staging buffers kept alive until submit_and_wait completes
    std::vector<Buffer> temp_buffers_;
};

}  // namespace gseurat
```

- [ ] **Step 2: Create `tests/gpu_test_context.cpp`**

```cpp
#include "gpu_test_context.hpp"

#include <cstdio>
#include <cstring>
#include <stdexcept>

namespace gseurat {

void GpuTestContext::init() {
    ctx_.init_headless();

    VkCommandPoolCreateInfo pool_info{};
    pool_info.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO;
    pool_info.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
    pool_info.queueFamilyIndex = ctx_.graphics_queue_family();
    if (vkCreateCommandPool(ctx_.device(), &pool_info, nullptr, &cmd_pool_) != VK_SUCCESS) {
        throw std::runtime_error("Failed to create command pool");
    }

    VkCommandBufferAllocateInfo alloc_info{};
    alloc_info.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO;
    alloc_info.commandPool = cmd_pool_;
    alloc_info.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
    alloc_info.commandBufferCount = 1;
    vkAllocateCommandBuffers(ctx_.device(), &alloc_info, &cmd_);

    VkFenceCreateInfo fence_info{};
    fence_info.sType = VK_STRUCTURE_TYPE_FENCE_CREATE_INFO;
    vkCreateFence(ctx_.device(), &fence_info, nullptr, &fence_);
}

void GpuTestContext::shutdown() {
    vkDeviceWaitIdle(ctx_.device());

    for (auto& buf : temp_buffers_) {
        buf.destroy(ctx_.allocator());
    }
    temp_buffers_.clear();

    if (fence_) vkDestroyFence(ctx_.device(), fence_, nullptr);
    if (cmd_pool_) vkDestroyCommandPool(ctx_.device(), cmd_pool_, nullptr);
    ctx_.shutdown();
}

VkCommandBuffer GpuTestContext::begin_commands() {
    // Clean up temp buffers from previous submission
    for (auto& buf : temp_buffers_) {
        buf.destroy(ctx_.allocator());
    }
    temp_buffers_.clear();

    vkResetCommandBuffer(cmd_, 0);
    VkCommandBufferBeginInfo begin_info{};
    begin_info.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
    begin_info.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
    vkBeginCommandBuffer(cmd_, &begin_info);
    return cmd_;
}

void GpuTestContext::submit_and_wait() {
    vkEndCommandBuffer(cmd_);

    VkSubmitInfo submit{};
    submit.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
    submit.commandBufferCount = 1;
    submit.pCommandBuffers = &cmd_;

    vkResetFences(ctx_.device(), 1, &fence_);
    vkQueueSubmit(ctx_.graphics_queue(), 1, &submit, fence_);
    vkWaitForFences(ctx_.device(), 1, &fence_, VK_TRUE, UINT64_MAX);
}

Buffer GpuTestContext::upload_to_gpu(VkCommandBuffer cmd, const void* data, VkDeviceSize size) {
    Buffer staging = Buffer::create_staging(ctx_.allocator(), size);
    staging.upload(data, size);

    Buffer gpu = Buffer::create_storage_gpu_only(ctx_.allocator(), size);

    VkBufferCopy region{};
    region.size = size;
    vkCmdCopyBuffer(cmd, staging.buffer(), gpu.buffer(), 1, &region);

    temp_buffers_.push_back(std::move(staging));
    return gpu;
}

Buffer GpuTestContext::readback_from_gpu(VkCommandBuffer cmd, const Buffer& gpu_buf, VkDeviceSize size) {
    Buffer readback = Buffer::create_readback(ctx_.allocator(), size);

    VkBufferCopy region{};
    region.size = size;
    vkCmdCopyBuffer(cmd, gpu_buf.buffer(), readback.buffer(), 1, &region);

    return readback;
}

}  // namespace gseurat
```

- [ ] **Step 3: Build to verify** (will build fully in Task 5 with CMake registration)

Skip build for now — this file will compile when registered in CMakeLists.txt in Task 5.

- [ ] **Step 4: Commit**

```bash
git add tests/gpu_test_context.hpp tests/gpu_test_context.cpp
git commit -m "feat(tests): add GpuTestContext harness for headless GPU testing"
```

---

### Task 3: Onesweep Test Runner

**Files:**
- Create: `tests/onesweep_test_runner.hpp`
- Create: `tests/onesweep_test_runner.cpp`

- [ ] **Step 1: Create `tests/onesweep_test_runner.hpp`**

```cpp
#pragma once

#include "gpu_test_context.hpp"

#include <cstdint>
#include <vector>

namespace gseurat {

struct TileSortEntry {
    uint32_t key;
    uint32_t index;
};

class OnesweepTestRunner {
public:
    void init(GpuTestContext& gpu);
    void shutdown(GpuTestContext& gpu);

    // Sort entries on GPU, return sorted result.
    // capacity = total buffer size in entries (must be multiple of 2048).
    // If capacity == 0, rounds up input.size() to next multiple of 2048.
    std::vector<TileSortEntry> sort(GpuTestContext& gpu,
                                     const std::vector<TileSortEntry>& input,
                                     uint32_t capacity = 0);

private:
    static constexpr uint32_t kEntriesPerWorkgroup = 2048;
    static constexpr uint32_t kNumPasses = 4;  // 32-bit key, 8 bits per pass

    VkDescriptorPool desc_pool_ = VK_NULL_HANDLE;
    VkDescriptorSetLayout hist_layout_ = VK_NULL_HANDLE;
    VkDescriptorSetLayout scatter_layout_ = VK_NULL_HANDLE;
    VkPipelineLayout hist_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipelineLayout scatter_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipeline hist_pipeline_ = VK_NULL_HANDLE;
    VkPipeline scatter_pipeline_ = VK_NULL_HANDLE;

    // Descriptor sets: A reads from buf_a, B reads from buf_b
    VkDescriptorSet hist_set_a_ = VK_NULL_HANDLE;
    VkDescriptorSet hist_set_b_ = VK_NULL_HANDLE;
    VkDescriptorSet scatter_set_ab_ = VK_NULL_HANDLE;  // input=A, output=B
    VkDescriptorSet scatter_set_ba_ = VK_NULL_HANDLE;  // input=B, output=A
};

}  // namespace gseurat
```

- [ ] **Step 2: Create `tests/onesweep_test_runner.cpp`**

```cpp
#include "onesweep_test_runner.hpp"
#include "gseurat/engine/pipeline.hpp"

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <stdexcept>

namespace gseurat {

void OnesweepTestRunner::init(GpuTestContext& gpu) {
    auto device = gpu.device();

    // --- Descriptor set layouts (matching production gs_renderer.cpp) ---

    // Histogram: { input(0), status(1), indirect_args(2) }
    {
        VkDescriptorSetLayoutBinding bindings[] = {
            {0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        };
        VkDescriptorSetLayoutCreateInfo ci{};
        ci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        ci.bindingCount = 3;
        ci.pBindings = bindings;
        vkCreateDescriptorSetLayout(device, &ci, nullptr, &hist_layout_);
    }

    // Scatter: { input(0), output(1), status(2), indirect_args(3) }
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
        vkCreateDescriptorSetLayout(device, &ci, nullptr, &scatter_layout_);
    }

    // --- Pipelines ---

    auto load_pipeline = [&](const char* spv_path,
                              VkDescriptorSetLayout layout,
                              VkPipelineLayout& out_layout,
                              VkPipeline& out_pipeline) {
        auto module = load_shader_module(device, spv_path);

        VkPushConstantRange push_range{};
        push_range.stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
        push_range.size = sizeof(uint32_t);  // pass index

        VkPipelineLayoutCreateInfo layout_info{};
        layout_info.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
        layout_info.setLayoutCount = 1;
        layout_info.pSetLayouts = &layout;
        layout_info.pushConstantRangeCount = 1;
        layout_info.pPushConstantRanges = &push_range;
        vkCreatePipelineLayout(device, &layout_info, nullptr, &out_layout);

        VkComputePipelineCreateInfo pi{};
        pi.sType = VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO;
        pi.stage.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
        pi.stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
        pi.stage.module = module;
        pi.stage.pName = "main";
        pi.layout = out_layout;

        if (vkCreateComputePipelines(device, VK_NULL_HANDLE, 1, &pi,
                                     nullptr, &out_pipeline) != VK_SUCCESS) {
            throw std::runtime_error(std::string("Failed to create pipeline: ") + spv_path);
        }
        vkDestroyShaderModule(device, module, nullptr);
    };

    load_pipeline("shaders/gs_onesweep_histogram.comp.spv", hist_layout_,
                  hist_pipeline_layout_, hist_pipeline_);
    load_pipeline("shaders/gs_onesweep_scatter.comp.spv", scatter_layout_,
                  scatter_pipeline_layout_, scatter_pipeline_);

    // --- Descriptor pool (4 sets: 2 hist + 2 scatter) ---
    {
        VkDescriptorPoolSize pool_size{};
        pool_size.type = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
        pool_size.descriptorCount = 2 * 3 + 2 * 4;  // 2 hist sets × 3 bindings + 2 scatter sets × 4 bindings

        VkDescriptorPoolCreateInfo pool_info{};
        pool_info.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
        pool_info.maxSets = 4;
        pool_info.poolSizeCount = 1;
        pool_info.pPoolSizes = &pool_size;
        vkCreateDescriptorPool(device, &pool_info, nullptr, &desc_pool_);
    }

    // Allocate descriptor sets
    {
        VkDescriptorSetLayout layouts[] = {hist_layout_, hist_layout_, scatter_layout_, scatter_layout_};
        VkDescriptorSetAllocateInfo alloc_info{};
        alloc_info.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
        alloc_info.descriptorPool = desc_pool_;
        alloc_info.descriptorSetCount = 4;
        alloc_info.pSetLayouts = layouts;
        VkDescriptorSet sets[4];
        vkAllocateDescriptorSets(device, &alloc_info, sets);
        hist_set_a_ = sets[0];
        hist_set_b_ = sets[1];
        scatter_set_ab_ = sets[2];
        scatter_set_ba_ = sets[3];
    }
}

void OnesweepTestRunner::shutdown(GpuTestContext& gpu) {
    auto device = gpu.device();
    if (hist_pipeline_) vkDestroyPipeline(device, hist_pipeline_, nullptr);
    if (scatter_pipeline_) vkDestroyPipeline(device, scatter_pipeline_, nullptr);
    if (hist_pipeline_layout_) vkDestroyPipelineLayout(device, hist_pipeline_layout_, nullptr);
    if (scatter_pipeline_layout_) vkDestroyPipelineLayout(device, scatter_pipeline_layout_, nullptr);
    if (desc_pool_) vkDestroyDescriptorPool(device, desc_pool_, nullptr);
    if (hist_layout_) vkDestroyDescriptorSetLayout(device, hist_layout_, nullptr);
    if (scatter_layout_) vkDestroyDescriptorSetLayout(device, scatter_layout_, nullptr);
}

std::vector<TileSortEntry> OnesweepTestRunner::sort(
    GpuTestContext& gpu,
    const std::vector<TileSortEntry>& input,
    uint32_t capacity)
{
    uint32_t entry_count = static_cast<uint32_t>(input.size());
    if (capacity == 0) {
        capacity = ((entry_count + kEntriesPerWorkgroup - 1) / kEntriesPerWorkgroup) * kEntriesPerWorkgroup;
        if (capacity == 0) capacity = kEntriesPerWorkgroup;
    }
    uint32_t num_workgroups = capacity / kEntriesPerWorkgroup;

    auto alloc = gpu.allocator();
    auto device = gpu.device();

    // --- Allocate buffers ---
    VkDeviceSize sort_buf_size = static_cast<VkDeviceSize>(capacity) * sizeof(TileSortEntry);
    VkDeviceSize status_size = static_cast<VkDeviceSize>(kNumPasses) * 256ull
                               * num_workgroups * sizeof(uint32_t);
    VkDeviceSize args_size = 8 * sizeof(uint32_t);

    Buffer buf_a = Buffer::create_storage_gpu_only(alloc, sort_buf_size);
    Buffer buf_b = Buffer::create_storage_gpu_only(alloc, sort_buf_size);
    Buffer status = Buffer::create_storage_gpu_only(alloc, status_size);
    Buffer args_buf = Buffer::create_storage_gpu_only(alloc, args_size);

    // --- Build indirect args on CPU ---
    uint32_t ranges_wg = (entry_count + 255) / 256;
    if (ranges_wg == 0) ranges_wg = 1;
    uint32_t args[8] = {
        num_workgroups,    // [0] sort dispatch_x
        1,                 // [1] dispatch_y
        1,                 // [2] dispatch_z
        ranges_wg,         // [3] ranges dispatch_x
        0, 0,              // [4-5] unused
        entry_count,       // [6] entry_count
        256 * num_workgroups  // [7] histogram_count
    };

    // --- Prepare input data (pad with sentinels) ---
    std::vector<TileSortEntry> padded(capacity, {0xFFFFFFFF, 0xFFFFFFFF});
    std::memcpy(padded.data(), input.data(), entry_count * sizeof(TileSortEntry));

    // --- Record commands ---
    auto cmd = gpu.begin_commands();

    // Upload input to buf_a
    Buffer staging_a = Buffer::create_staging(alloc, sort_buf_size);
    staging_a.upload(padded.data(), sort_buf_size);
    VkBufferCopy copy_region{0, 0, sort_buf_size};
    vkCmdCopyBuffer(cmd, staging_a.buffer(), buf_a.buffer(), 1, &copy_region);

    // Upload args
    Buffer staging_args = Buffer::create_staging(alloc, args_size);
    staging_args.upload(args, args_size);
    VkBufferCopy args_region{0, 0, args_size};
    vkCmdCopyBuffer(cmd, staging_args.buffer(), args_buf.buffer(), 1, &args_region);

    // Barrier: transfer → compute
    {
        VkMemoryBarrier mb{};
        mb.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
        mb.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
        mb.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
        vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT,
            VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 1, &mb, 0, nullptr, 0, nullptr);
    }

    // Clear status buffer
    vkCmdFillBuffer(cmd, status.buffer(), 0, status_size, 0);
    {
        VkMemoryBarrier mb{};
        mb.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
        mb.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
        mb.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
        vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT,
            VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 1, &mb, 0, nullptr, 0, nullptr);
    }

    // --- Update descriptor sets ---
    {
        VkDescriptorBufferInfo a_info{buf_a.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo b_info{buf_b.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo status_info{status.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo args_info{args_buf.buffer(), 0, VK_WHOLE_SIZE};

        VkWriteDescriptorSet writes[] = {
            // hist_set_a: input=A, status, args
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, hist_set_a_, 0, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &a_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, hist_set_a_, 1, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &status_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, hist_set_a_, 2, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &args_info, nullptr},

            // hist_set_b: input=B, status, args
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, hist_set_b_, 0, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &b_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, hist_set_b_, 1, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &status_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, hist_set_b_, 2, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &args_info, nullptr},

            // scatter_set_ab: input=A, output=B, status, args
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, scatter_set_ab_, 0, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &a_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, scatter_set_ab_, 1, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &b_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, scatter_set_ab_, 2, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &status_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, scatter_set_ab_, 3, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &args_info, nullptr},

            // scatter_set_ba: input=B, output=A, status, args
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, scatter_set_ba_, 0, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &b_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, scatter_set_ba_, 1, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &a_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, scatter_set_ba_, 2, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &status_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, scatter_set_ba_, 3, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &args_info, nullptr},
        };
        vkUpdateDescriptorSets(device, 14, writes, 0, nullptr);
    }

    // --- 4-pass Onesweep dispatch (matching gs_renderer.cpp:2057-2089) ---
    auto insert_barrier = [&]() {
        VkMemoryBarrier barrier{};
        barrier.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
        barrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
        barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
        vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
            VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 1, &barrier, 0, nullptr, 0, nullptr);
    };

    for (uint32_t pass = 0; pass < kNumPasses; pass++) {
        uint32_t push_data[1] = {pass};
        bool read_from_a = (pass % 2 == 0);

        // Histogram + decoupled lookback
        VkDescriptorSet hist_set = read_from_a ? hist_set_a_ : hist_set_b_;
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, hist_pipeline_);
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                hist_pipeline_layout_, 0, 1, &hist_set, 0, nullptr);
        vkCmdPushConstants(cmd, hist_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                           0, 4, push_data);
        vkCmdDispatch(cmd, num_workgroups, 1, 1);

        insert_barrier();

        // Scatter
        VkDescriptorSet scatter_set = read_from_a ? scatter_set_ab_ : scatter_set_ba_;
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, scatter_pipeline_);
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                scatter_pipeline_layout_, 0, 1, &scatter_set, 0, nullptr);
        vkCmdPushConstants(cmd, scatter_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                           0, 4, push_data);
        vkCmdDispatch(cmd, num_workgroups, 1, 1);

        insert_barrier();
    }

    // After 4 passes (even number), result is in buf_a
    // Barrier: compute → transfer
    {
        VkMemoryBarrier mb{};
        mb.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
        mb.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
        mb.dstAccessMask = VK_ACCESS_TRANSFER_READ_BIT;
        vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
            VK_PIPELINE_STAGE_TRANSFER_BIT, 0, 1, &mb, 0, nullptr, 0, nullptr);
    }

    // Readback
    Buffer readback = Buffer::create_readback(alloc, sort_buf_size);
    VkBufferCopy rb_region{0, 0, sort_buf_size};
    vkCmdCopyBuffer(cmd, buf_a.buffer(), readback.buffer(), 1, &rb_region);

    gpu.submit_and_wait();

    // Copy result to vector
    std::vector<TileSortEntry> result(entry_count);
    std::memcpy(result.data(), readback.mapped(), entry_count * sizeof(TileSortEntry));

    // Cleanup
    buf_a.destroy(alloc);
    buf_b.destroy(alloc);
    status.destroy(alloc);
    args_buf.destroy(alloc);
    staging_a.destroy(alloc);
    staging_args.destroy(alloc);
    readback.destroy(alloc);

    return result;
}

}  // namespace gseurat
```

- [ ] **Step 3: Commit**

```bash
git add tests/onesweep_test_runner.hpp tests/onesweep_test_runner.cpp
git commit -m "feat(tests): add OnesweepTestRunner for GPU radix sort validation"
```

---

### Task 4: Write GPU Test Cases

**Files:**
- Create: `tests/test_onesweep_gpu.cpp`

- [ ] **Step 1: Create `tests/test_onesweep_gpu.cpp`**

```cpp
#include "gpu_test_context.hpp"
#include "onesweep_test_runner.hpp"

#include <algorithm>
#include <cassert>
#include <cstdio>
#include <cstdlib>
#include <numeric>
#include <random>
#include <vector>

using namespace gseurat;

static void test_basic_sort() {
    std::printf("test_basic_sort: ");

    GpuTestContext gpu;
    gpu.init();
    OnesweepTestRunner runner;
    runner.init(gpu);

    // Generate 100,000 random entries
    constexpr uint32_t N = 100000;
    std::mt19937 rng(42);
    std::vector<TileSortEntry> input(N);
    for (uint32_t i = 0; i < N; i++) {
        input[i].key = rng();
        input[i].index = i;
    }

    auto result = runner.sort(gpu, input);

    assert(result.size() == N);
    bool sorted = std::is_sorted(result.begin(), result.end(),
        [](const TileSortEntry& a, const TileSortEntry& b) { return a.key < b.key; });
    assert(sorted);

    runner.shutdown(gpu);
    gpu.shutdown();

    std::printf("PASS (%u entries sorted)\n", N);
}

static void test_stable_sort() {
    std::printf("test_stable_sort: ");

    GpuTestContext gpu;
    gpu.init();
    OnesweepTestRunner runner;
    runner.init(gpu);

    // 10,000 entries with only 100 unique keys (many duplicates)
    constexpr uint32_t N = 10000;
    std::mt19937 rng(123);
    std::vector<TileSortEntry> input(N);
    for (uint32_t i = 0; i < N; i++) {
        input[i].key = rng() % 100;  // only 100 unique keys
        input[i].index = i;          // unique sequential index
    }

    auto result = runner.sort(gpu, input);

    // Verify sorted by key
    assert(result.size() == N);
    bool sorted = std::is_sorted(result.begin(), result.end(),
        [](const TileSortEntry& a, const TileSortEntry& b) { return a.key < b.key; });
    assert(sorted);

    // Verify stability: for entries with the same key, original indices must be in order
    for (uint32_t i = 1; i < N; i++) {
        if (result[i].key == result[i - 1].key) {
            assert(result[i].index > result[i - 1].index);
        }
    }

    runner.shutdown(gpu);
    gpu.shutdown();

    std::printf("PASS (%u entries, stable order verified)\n", N);
}

static void test_low_workgroup_count() {
    std::printf("test_low_workgroup_count: ");

    GpuTestContext gpu;
    gpu.init();
    OnesweepTestRunner runner;
    runner.init(gpu);

    // Exactly 50 workgroups × 2048 entries = 102,400
    // This catches AMD decoupled-lookback coherency bugs at specific workgroup counts
    constexpr uint32_t N = 50 * 2048;
    std::mt19937 rng(999);
    std::vector<TileSortEntry> input(N);
    for (uint32_t i = 0; i < N; i++) {
        input[i].key = rng();
        input[i].index = i;
    }

    auto result = runner.sort(gpu, input, N);  // capacity = N exactly

    assert(result.size() == N);
    bool sorted = std::is_sorted(result.begin(), result.end(),
        [](const TileSortEntry& a, const TileSortEntry& b) { return a.key < b.key; });
    assert(sorted);

    runner.shutdown(gpu);
    gpu.shutdown();

    std::printf("PASS (50 workgroups, %u entries)\n", N);
}

static void test_single_workgroup() {
    std::printf("test_single_workgroup: ");

    GpuTestContext gpu;
    gpu.init();
    OnesweepTestRunner runner;
    runner.init(gpu);

    // Exactly 2048 entries = 1 workgroup (edge case: no lookback predecessors)
    constexpr uint32_t N = 2048;
    std::mt19937 rng(7);
    std::vector<TileSortEntry> input(N);
    for (uint32_t i = 0; i < N; i++) {
        input[i].key = rng();
        input[i].index = i;
    }

    auto result = runner.sort(gpu, input, N);

    assert(result.size() == N);
    bool sorted = std::is_sorted(result.begin(), result.end(),
        [](const TileSortEntry& a, const TileSortEntry& b) { return a.key < b.key; });
    assert(sorted);

    runner.shutdown(gpu);
    gpu.shutdown();

    std::printf("PASS (1 workgroup, %u entries)\n", N);
}

static void test_sentinel_fill() {
    std::printf("test_sentinel_fill: ");

    GpuTestContext gpu;
    gpu.init();
    OnesweepTestRunner runner;
    runner.init(gpu);

    // 1000 real entries in a 4096-capacity buffer (2 workgroups)
    constexpr uint32_t N = 1000;
    constexpr uint32_t CAPACITY = 4096;
    std::mt19937 rng(55);
    std::vector<TileSortEntry> input(N);
    for (uint32_t i = 0; i < N; i++) {
        input[i].key = rng() % 0xFFFFFFFE;  // keys < sentinel
        input[i].index = i;
    }

    auto result = runner.sort(gpu, input, CAPACITY);

    // Result has N entries (trimmed by sort() to entry_count)
    assert(result.size() == N);
    bool sorted = std::is_sorted(result.begin(), result.end(),
        [](const TileSortEntry& a, const TileSortEntry& b) { return a.key < b.key; });
    assert(sorted);

    // All returned entries should have keys < sentinel
    for (const auto& e : result) {
        assert(e.key < 0xFFFFFFFF);
    }

    runner.shutdown(gpu);
    gpu.shutdown();

    std::printf("PASS (%u real entries, %u capacity)\n", N, CAPACITY);
}

int main() {
    std::printf("=== Onesweep GPU Tests ===\n");

    test_basic_sort();
    test_stable_sort();
    test_low_workgroup_count();
    test_single_workgroup();
    test_sentinel_fill();

    std::printf("\nAll GPU tests passed!\n");
    return 0;
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/test_onesweep_gpu.cpp
git commit -m "feat(tests): add 5 Onesweep GPU test cases"
```

---

### Task 5: CMake Integration

**Files:**
- Modify: `CMakeLists.txt` (after existing test registrations, around line 387)

- [ ] **Step 1: Add `add_gseurat_gpu_test` function and register test**

After the existing `add_gseurat_test` calls (around line 387), add:

```cmake
# --- GPU Tests (require actual GPU, link engine sources directly) ----------

function(add_gseurat_gpu_test NAME)
    add_executable(${NAME}
        tests/${NAME}.cpp
        tests/gpu_test_context.cpp
        tests/onesweep_test_runner.cpp
        src/engine/vk_context.cpp
        src/engine/buffer.cpp
        src/engine/pipeline.cpp
        ${ARGN}
    )
    target_include_directories(${NAME} PRIVATE
        ${PROJECT_SOURCE_DIR}/include
        ${PROJECT_SOURCE_DIR}/tests
    )
    target_compile_definitions(${NAME} PRIVATE GLM_FORCE_DEPTH_ZERO_TO_ONE)
    target_link_libraries(${NAME} PRIVATE
        Vulkan::Vulkan
        glm::glm
        GPUOpen::VulkanMemoryAllocator
        glfw
    )
    add_dependencies(${NAME} compile_shaders)
    add_test(NAME ${NAME} COMMAND ${NAME}
             WORKING_DIRECTORY ${PROJECT_SOURCE_DIR})
    set_tests_properties(${NAME} PROPERTIES LABELS "gpu")
endfunction()

add_gseurat_gpu_test(test_onesweep_gpu)
```

Note: Links `glfw` because `vk_context.hpp` includes `<GLFW/glfw3.h>` (header dependency only — no GLFW functions called in headless mode). The `add_dependencies(${NAME} compile_shaders)` ensures SPIR-V is compiled before tests run.

- [ ] **Step 2: Verify `compile_shaders` target exists**

Run: `grep -n "compile_shaders" CMakeLists.txt | head -5`

If the target exists, proceed. If not, the shaders are compiled differently — check and adjust the dependency.

- [ ] **Step 3: Build**

Run: `cmake --build --preset macos-debug 2>&1 | tail -10`
Expected: Build succeeds, `test_onesweep_gpu` executable created.

- [ ] **Step 4: Run the test**

Run: `./build/macos-debug/test_onesweep_gpu`
Expected output:
```
=== Onesweep GPU Tests ===
[vk_context] GPU: Apple M5 (vendor 0x106B) [Apple — TBDR] [headless]
[vk_context] Subgroup size: 32, supported stages: 0x32, supported ops: 0x6ff
test_basic_sort: PASS (100000 entries sorted)
test_stable_sort: PASS (10000 entries, stable order verified)
test_low_workgroup_count: PASS (50 workgroups, 102400 entries)
test_single_workgroup: PASS (1 workgroup, 2048 entries)
test_sentinel_fill: PASS (1000 real entries, 4096 capacity)

All GPU tests passed!
```

- [ ] **Step 5: Run via CTest**

Run: `cd build/macos-debug && ctest -L gpu -V`
Expected: 1 test found, passes.

Also verify GPU tests are excluded by default label filtering:
Run: `cd build/macos-debug && ctest --label-exclude gpu --test-dir . 2>&1 | tail -3`
Expected: `test_onesweep_gpu` not in the list.

- [ ] **Step 6: Commit**

```bash
git add CMakeLists.txt
git commit -m "feat(build): add GPU test infrastructure with LABELS gpu for CI flexibility"
```
