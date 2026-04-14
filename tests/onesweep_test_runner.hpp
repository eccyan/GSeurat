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

    VkDescriptorSet hist_set_a_ = VK_NULL_HANDLE;
    VkDescriptorSet hist_set_b_ = VK_NULL_HANDLE;
    VkDescriptorSet scatter_set_ab_ = VK_NULL_HANDLE;  // input=A, output=B
    VkDescriptorSet scatter_set_ba_ = VK_NULL_HANDLE;  // input=B, output=A
};

}  // namespace gseurat
