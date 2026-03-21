#pragma once

#include "gseurat/engine/types.hpp"

#include <vulkan/vulkan.h>

#include <array>

namespace gseurat {

class CommandPool {
public:
    void init(VkDevice device, uint32_t queue_family);
    void shutdown(VkDevice device);

    VkCommandBuffer command_buffer(uint32_t frame_index) const {
        return command_buffers_[frame_index];
    }

    VkCommandPool pool() const { return pool_; }

    VkCommandBuffer begin_single_time(VkDevice device) const;
    void end_single_time(VkDevice device, VkQueue queue, VkCommandBuffer cmd) const;

private:
    VkCommandPool pool_ = VK_NULL_HANDLE;
    std::array<VkCommandBuffer, kMaxFramesInFlight> command_buffers_{};
};

}  // namespace gseurat
