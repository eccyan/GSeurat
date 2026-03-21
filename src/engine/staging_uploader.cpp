#include "vulkan_game/engine/staging_uploader.hpp"

#include <cstring>
#include <stdexcept>

namespace vulkan_game {

void StagingUploader::init(VkDevice device, VmaAllocator allocator,
                           VkCommandPool cmd_pool, VkQueue queue,
                           TextureReadyCallback callback) {
    device_ = device;
    allocator_ = allocator;
    cmd_pool_ = cmd_pool;
    queue_ = queue;
    callback_ = std::move(callback);

    // Create fences (signaled initially so first retire_in_flight is a no-op)
    VkFenceCreateInfo fence_info{};
    fence_info.sType = VK_STRUCTURE_TYPE_FENCE_CREATE_INFO;
    fence_info.flags = VK_FENCE_CREATE_SIGNALED_BIT;

    for (uint32_t i = 0; i < kSlots; ++i) {
        if (vkCreateFence(device_, &fence_info, nullptr, &fences_[i]) != VK_SUCCESS) {
            throw std::runtime_error("Failed to create staging uploader fence");
        }
    }
}

void StagingUploader::shutdown() {
    if (!device_) return;

    // Wait for any in-flight work
    for (uint32_t i = 0; i < kSlots; ++i) {
        if (fences_[i]) {
            vkWaitForFences(device_, 1, &fences_[i], VK_TRUE, UINT64_MAX);

            // Retire in-flight textures for this slot
            for (auto& ift : in_flight_textures_[i]) {
                ift.staging_buffer.destroy(allocator_);
                if (callback_) callback_(ift.cache_key, std::move(ift.texture));
            }
            in_flight_textures_[i].clear();

            vkDestroyFence(device_, fences_[i], nullptr);
            fences_[i] = VK_NULL_HANDLE;
        }
    }
    in_flight_count_ = 0;
    device_ = VK_NULL_HANDLE;
}

void StagingUploader::enqueue_texture(StagedTexture tex) {
    pending_.push_back(std::move(tex));
}

VkDeviceSize StagingUploader::pending_bytes() const {
    VkDeviceSize total = 0;
    for (const auto& st : pending_) {
        total += st.byte_size();
    }
    return total;
}

uint32_t StagingUploader::flush(VkDeviceSize budget_bytes) {
    // Retire textures from the slot we're about to reuse
    retire_in_flight();

    if (pending_.empty()) {
        // Still advance slot so alternating flushes retire both slots
        current_slot_ = (current_slot_ + 1) % kSlots;
        return 0;
    }

    // Reset the fence for this slot
    vkResetFences(device_, 1, &fences_[current_slot_]);

    // Begin a command buffer for all uploads in this batch
    VkCommandBuffer cmd = begin_one_shot();

    uint32_t uploaded = 0;
    VkDeviceSize bytes_used = 0;
    auto& in_flight = in_flight_textures_[current_slot_];

    while (!pending_.empty()) {
        auto& front = pending_.front();
        VkDeviceSize tex_bytes = front.byte_size();

        // Budget check: always allow at least one texture per flush
        if (uploaded > 0 && bytes_used + tex_bytes > budget_bytes) break;

        StagedTexture st = std::move(front);
        pending_.pop_front();

        // Create staging buffer and upload pixels
        Buffer staging = Buffer::create_staging(allocator_, tex_bytes);
        staging.upload(st.pixels.data(), tex_bytes);

        // Create the VkImage
        VkImageCreateInfo image_info{};
        image_info.sType = VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO;
        image_info.imageType = VK_IMAGE_TYPE_2D;
        image_info.format = st.format;
        image_info.extent = {st.width, st.height, 1};
        image_info.mipLevels = 1;
        image_info.arrayLayers = 1;
        image_info.samples = VK_SAMPLE_COUNT_1_BIT;
        image_info.tiling = VK_IMAGE_TILING_OPTIMAL;
        image_info.usage = VK_IMAGE_USAGE_TRANSFER_DST_BIT | VK_IMAGE_USAGE_SAMPLED_BIT;

        VmaAllocationCreateInfo alloc_info{};
        alloc_info.usage = VMA_MEMORY_USAGE_GPU_ONLY;

        VkImage image;
        VmaAllocation allocation;
        if (vmaCreateImage(allocator_, &image_info, &alloc_info,
                           &image, &allocation, nullptr) != VK_SUCCESS) {
            staging.destroy(allocator_);
            continue;  // skip this texture
        }

        // Transition to transfer dst
        VkImageMemoryBarrier barrier{};
        barrier.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
        barrier.oldLayout = VK_IMAGE_LAYOUT_UNDEFINED;
        barrier.newLayout = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL;
        barrier.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        barrier.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        barrier.image = image;
        barrier.subresourceRange.aspectMask = VK_IMAGE_ASPECT_COLOR_BIT;
        barrier.subresourceRange.levelCount = 1;
        barrier.subresourceRange.layerCount = 1;
        barrier.srcAccessMask = 0;
        barrier.dstAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;

        vkCmdPipelineBarrier(cmd,
                             VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT,
                             VK_PIPELINE_STAGE_TRANSFER_BIT,
                             0, 0, nullptr, 0, nullptr, 1, &barrier);

        // Copy buffer to image
        VkBufferImageCopy region{};
        region.imageSubresource.aspectMask = VK_IMAGE_ASPECT_COLOR_BIT;
        region.imageSubresource.layerCount = 1;
        region.imageExtent = {st.width, st.height, 1};

        vkCmdCopyBufferToImage(cmd, staging.buffer(), image,
                               VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, 1, &region);

        // Transition to shader read
        barrier.oldLayout = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL;
        barrier.newLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
        barrier.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
        barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;

        vkCmdPipelineBarrier(cmd,
                             VK_PIPELINE_STAGE_TRANSFER_BIT,
                             VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT,
                             0, 0, nullptr, 0, nullptr, 1, &barrier);

        // Create image view and sampler → Texture object
        Texture tex = Texture::create_from_image(device_, image, allocation,
                                                  st.format, st.filter, st.address_mode);

        in_flight.push_back(InFlightTexture{
            std::move(st.cache_key), std::move(tex), std::move(staging)});

        bytes_used += tex_bytes;
        ++uploaded;
    }

    // Submit the batch
    end_and_submit(cmd, fences_[current_slot_]);
    in_flight_count_ = static_cast<uint32_t>(in_flight.size());

    // Advance to next slot for next flush
    current_slot_ = (current_slot_ + 1) % kSlots;

    return uploaded;
}

void StagingUploader::retire_in_flight() {
    // Check if the current slot's fence is done (from a previous flush)
    auto& in_flight = in_flight_textures_[current_slot_];
    if (in_flight.empty()) return;

    // Wait for this slot's previous work to complete
    vkWaitForFences(device_, 1, &fences_[current_slot_], VK_TRUE, UINT64_MAX);

    // Deliver completed textures and free staging buffers
    for (auto& ift : in_flight) {
        ift.staging_buffer.destroy(allocator_);
        if (callback_) callback_(ift.cache_key, std::move(ift.texture));
    }
    in_flight.clear();
    in_flight_count_ = 0;
}

VkCommandBuffer StagingUploader::begin_one_shot() {
    VkCommandBufferAllocateInfo alloc_info{};
    alloc_info.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO;
    alloc_info.commandPool = cmd_pool_;
    alloc_info.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
    alloc_info.commandBufferCount = 1;

    VkCommandBuffer cmd;
    vkAllocateCommandBuffers(device_, &alloc_info, &cmd);

    VkCommandBufferBeginInfo begin_info{};
    begin_info.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
    begin_info.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
    vkBeginCommandBuffer(cmd, &begin_info);

    return cmd;
}

void StagingUploader::end_and_submit(VkCommandBuffer cmd, VkFence fence) {
    vkEndCommandBuffer(cmd);

    VkSubmitInfo submit{};
    submit.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
    submit.commandBufferCount = 1;
    submit.pCommandBuffers = &cmd;

    vkQueueSubmit(queue_, 1, &submit, fence);
}

}  // namespace vulkan_game
