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
