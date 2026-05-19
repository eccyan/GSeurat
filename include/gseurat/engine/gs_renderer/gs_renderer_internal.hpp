#pragma once

// Internal helpers shared between GsRenderer and its 5a-5e subsystems
// (GsSortSystem, GsTileBinSystem, GsPbdSystem, GsPostProcessSystem,
// GsStreamingSystem). Implementation detail of the GS renderer subsystem;
// not part of any public API.

#include <vulkan/vulkan.h>

namespace gseurat {

// Compute → compute full memory barrier (SHADER_WRITE → SHADER_READ|SHADER_WRITE).
// Phase 5e promotion (#396): consolidated from byte-identical anonymous-namespace
// copies in gs_renderer.cpp, gs_sort_system.cpp, and gs_tile_bin_system.cpp.
inline void insert_compute_barrier(VkCommandBuffer cmd) {
    VkMemoryBarrier b{};
    b.sType         = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
    b.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
    b.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
    vkCmdPipelineBarrier(cmd,
                         VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                         VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                         0, 1, &b, 0, nullptr, 0, nullptr);
}

}  // namespace gseurat
