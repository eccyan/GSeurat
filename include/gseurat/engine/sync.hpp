#pragma once

#include "gseurat/engine/types.hpp"

#include <vulkan/vulkan.h>

#include <array>
#include <vector>

namespace gseurat {

struct FrameSync {
    VkFence in_flight = VK_NULL_HANDLE;
};

class SyncObjects {
public:
    void init(VkDevice device, uint32_t swapchain_image_count);
    void shutdown(VkDevice device);

    const FrameSync& frame(uint32_t index) const { return frames_[index]; }
    VkSemaphore acquire_semaphore(uint32_t index) const { return acquire_semaphores_[index]; }
    uint32_t acquire_semaphore_count() const {
        return static_cast<uint32_t>(acquire_semaphores_.size());
    }
    // One render_finished semaphore per swapchain image avoids reuse conflicts
    VkSemaphore render_finished_semaphore(uint32_t image_index) const {
        return render_finished_semaphores_[image_index];
    }

private:
    std::array<FrameSync, kMaxFramesInFlight> frames_{};
    std::vector<VkSemaphore> acquire_semaphores_;
    std::vector<VkSemaphore> render_finished_semaphores_;
};

}  // namespace gseurat
