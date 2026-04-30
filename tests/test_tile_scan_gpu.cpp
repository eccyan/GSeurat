// Headless GPU test for gs_tile_scan.comp — the three-dispatch hierarchical
// exclusive prefix-sum that drives Fix B's deterministic tile-bin pipeline.
//
// Why test the scan in isolation: a wrong-by-one scan is the most common
// way to lose entries in the downstream scatter and the easiest bug to
// hide behind a "works on dense scenes, breaks on sparse" symptom. The
// determinism harness in feature/gs-determinism-harness can confirm
// stability but cannot localise scan-vs-scatter bugs. This test runs the
// scan against a CPU reference and asserts bit-for-bit equality.

#include "gpu_test_context.hpp"
#include "gseurat/engine/buffer.hpp"
#include "gseurat/engine/pipeline.hpp"

#include <algorithm>
#include <cassert>
#include <cstdint>
#include <cstdio>
#include <random>
#include <vector>

using namespace gseurat;

namespace {

constexpr uint32_t WG_SIZE = 256u;

struct ScanPush {
    uint32_t pass;
    uint32_t num_elements;
    uint32_t num_blocks;
};

// Three SSBOs + the tile_sort_count single-uint output.
struct ScanResources {
    Buffer in_count;
    Buffer out_offset;
    Buffer block_sums;
    Buffer total_count;
};

class TileScanRunner {
public:
    void init(GpuTestContext& gpu) {
        auto device = gpu.device();

        VkDescriptorSetLayoutBinding bindings[] = {
            {0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        };
        VkDescriptorSetLayoutCreateInfo dsl_info{};
        dsl_info.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        dsl_info.bindingCount = 4;
        dsl_info.pBindings = bindings;
        if (vkCreateDescriptorSetLayout(device, &dsl_info, nullptr, &set_layout_) != VK_SUCCESS) {
            throw std::runtime_error("Failed to create scan descriptor set layout");
        }

        VkPushConstantRange push{};
        push.stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
        push.size = sizeof(ScanPush);

        VkPipelineLayoutCreateInfo pl_info{};
        pl_info.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
        pl_info.setLayoutCount = 1;
        pl_info.pSetLayouts = &set_layout_;
        pl_info.pushConstantRangeCount = 1;
        pl_info.pPushConstantRanges = &push;
        vkCreatePipelineLayout(device, &pl_info, nullptr, &pipeline_layout_);

        auto module = load_shader_module(device, "shaders/gs_tile_scan.comp.spv");
        VkComputePipelineCreateInfo cpi{};
        cpi.sType = VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO;
        cpi.stage.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
        cpi.stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
        cpi.stage.module = module;
        cpi.stage.pName = "main";
        cpi.layout = pipeline_layout_;
        if (vkCreateComputePipelines(device, VK_NULL_HANDLE, 1, &cpi,
                                     nullptr, &pipeline_) != VK_SUCCESS) {
            throw std::runtime_error("Failed to create gs_tile_scan pipeline");
        }
        vkDestroyShaderModule(device, module, nullptr);

        VkDescriptorPoolSize pool_size{};
        pool_size.type = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
        pool_size.descriptorCount = 4;
        VkDescriptorPoolCreateInfo pool_info{};
        pool_info.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
        pool_info.maxSets = 1;
        pool_info.poolSizeCount = 1;
        pool_info.pPoolSizes = &pool_size;
        vkCreateDescriptorPool(device, &pool_info, nullptr, &desc_pool_);

        VkDescriptorSetAllocateInfo alloc_info{};
        alloc_info.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
        alloc_info.descriptorPool = desc_pool_;
        alloc_info.descriptorSetCount = 1;
        alloc_info.pSetLayouts = &set_layout_;
        vkAllocateDescriptorSets(device, &alloc_info, &set_);
    }

    void shutdown(GpuTestContext& gpu) {
        auto device = gpu.device();
        if (pipeline_) vkDestroyPipeline(device, pipeline_, nullptr);
        if (pipeline_layout_) vkDestroyPipelineLayout(device, pipeline_layout_, nullptr);
        if (set_layout_) vkDestroyDescriptorSetLayout(device, set_layout_, nullptr);
        if (desc_pool_) vkDestroyDescriptorPool(device, desc_pool_, nullptr);
    }

    // Run the scan on `input` (length = num_elements). Returns
    // (offsets, total). Caller is expected to have provided a length
    // that is a multiple of WG_SIZE.
    std::pair<std::vector<uint32_t>, uint32_t>
    run(GpuTestContext& gpu, const std::vector<uint32_t>& input) {
        const uint32_t num_elements = static_cast<uint32_t>(input.size());
        assert(num_elements % WG_SIZE == 0 && "num_elements must be a multiple of 256");
        const uint32_t num_blocks = num_elements / WG_SIZE;

        auto device = gpu.device();
        ScanResources r{};

        // Upload input.
        {
            auto cmd = gpu.begin_commands();
            r.in_count = gpu.upload_to_gpu(cmd, input.data(),
                                            num_elements * sizeof(uint32_t));
            std::vector<uint32_t> zeros_offset(num_elements, 0);
            r.out_offset = gpu.upload_to_gpu(cmd, zeros_offset.data(),
                                              num_elements * sizeof(uint32_t));
            std::vector<uint32_t> zeros_blocks(num_blocks, 0);
            r.block_sums = gpu.upload_to_gpu(cmd, zeros_blocks.data(),
                                              num_blocks * sizeof(uint32_t));
            uint32_t zero = 0;
            r.total_count = gpu.upload_to_gpu(cmd, &zero, sizeof(uint32_t));
            gpu.submit_and_wait();
        }

        // Bind once.
        {
            VkDescriptorBufferInfo in_info{r.in_count.buffer(), 0, VK_WHOLE_SIZE};
            VkDescriptorBufferInfo out_info{r.out_offset.buffer(), 0, VK_WHOLE_SIZE};
            VkDescriptorBufferInfo bs_info{r.block_sums.buffer(), 0, VK_WHOLE_SIZE};
            VkDescriptorBufferInfo total_info{r.total_count.buffer(), 0, sizeof(uint32_t)};
            VkWriteDescriptorSet writes[] = {
                {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set_, 0, 0, 1,
                 VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &in_info, nullptr},
                {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set_, 1, 0, 1,
                 VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &out_info, nullptr},
                {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set_, 2, 0, 1,
                 VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &bs_info, nullptr},
                {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set_, 3, 0, 1,
                 VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &total_info, nullptr},
            };
            vkUpdateDescriptorSets(device, 4, writes, 0, nullptr);
        }

        // Three-dispatch run.
        auto cmd = gpu.begin_commands();
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, pipeline_);
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                 pipeline_layout_, 0, 1, &set_, 0, nullptr);

        auto barrier = [&]() {
            VkMemoryBarrier mb{};
            mb.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
            mb.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
            mb.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
            vkCmdPipelineBarrier(cmd,
                VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                0, 1, &mb, 0, nullptr, 0, nullptr);
        };

        ScanPush p0{0, num_elements, num_blocks};
        vkCmdPushConstants(cmd, pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                           0, sizeof(ScanPush), &p0);
        vkCmdDispatch(cmd, num_blocks, 1, 1);
        barrier();

        ScanPush p1{1, num_elements, num_blocks};
        vkCmdPushConstants(cmd, pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                           0, sizeof(ScanPush), &p1);
        vkCmdDispatch(cmd, 1, 1, 1);
        barrier();

        ScanPush p2{2, num_elements, num_blocks};
        vkCmdPushConstants(cmd, pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                           0, sizeof(ScanPush), &p2);
        vkCmdDispatch(cmd, num_blocks, 1, 1);

        // Compute-write → transfer-read barrier so the readback copies see
        // the final scan output rather than the buffers' initial uploads.
        {
            VkMemoryBarrier mb{};
            mb.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
            mb.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
            mb.dstAccessMask = VK_ACCESS_TRANSFER_READ_BIT;
            vkCmdPipelineBarrier(cmd,
                VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                VK_PIPELINE_STAGE_TRANSFER_BIT,
                0, 1, &mb, 0, nullptr, 0, nullptr);
        }

        // Readback both the offset buffer and the total.
        Buffer offset_rb = gpu.readback_from_gpu(cmd, r.out_offset,
                                                  num_elements * sizeof(uint32_t));
        Buffer total_rb  = gpu.readback_from_gpu(cmd, r.total_count, sizeof(uint32_t));
        gpu.submit_and_wait();

        std::vector<uint32_t> result(num_elements);
        std::memcpy(result.data(), offset_rb.mapped(),
                    num_elements * sizeof(uint32_t));
        uint32_t total = 0;
        std::memcpy(&total, total_rb.mapped(), sizeof(uint32_t));

        // Cleanup test-local resources (the SSBOs + readback). Keep
        // pipeline alive across runs.
        offset_rb.destroy(gpu.allocator());
        total_rb.destroy(gpu.allocator());
        r.in_count.destroy(gpu.allocator());
        r.out_offset.destroy(gpu.allocator());
        r.block_sums.destroy(gpu.allocator());
        r.total_count.destroy(gpu.allocator());

        return {std::move(result), total};
    }

private:
    VkDescriptorSetLayout set_layout_ = VK_NULL_HANDLE;
    VkPipelineLayout pipeline_layout_ = VK_NULL_HANDLE;
    VkPipeline pipeline_ = VK_NULL_HANDLE;
    VkDescriptorPool desc_pool_ = VK_NULL_HANDLE;
    VkDescriptorSet set_ = VK_NULL_HANDLE;
};

// CPU reference exclusive prefix-sum.
std::pair<std::vector<uint32_t>, uint32_t>
cpu_exclusive_scan(const std::vector<uint32_t>& input) {
    std::vector<uint32_t> out(input.size(), 0);
    uint32_t running = 0;
    for (size_t i = 0; i < input.size(); ++i) {
        out[i] = running;
        running += input[i];
    }
    return {std::move(out), running};
}

void verify(const char* name, TileScanRunner& runner, GpuTestContext& gpu,
            const std::vector<uint32_t>& input) {
    auto [gpu_out, gpu_total] = runner.run(gpu, input);
    auto [cpu_out, cpu_total] = cpu_exclusive_scan(input);

    bool ok = (gpu_total == cpu_total) && (gpu_out == cpu_out);
    if (!ok) {
        std::fprintf(stderr, "%s: FAIL\n", name);
        std::fprintf(stderr, "  N=%zu  cpu_total=%u  gpu_total=%u\n",
                     input.size(), cpu_total, gpu_total);
        // Find first mismatch
        for (size_t i = 0; i < input.size(); ++i) {
            if (gpu_out[i] != cpu_out[i]) {
                std::fprintf(stderr,
                             "  first mismatch at i=%zu: input=%u cpu=%u gpu=%u\n",
                             i, input[i], cpu_out[i], gpu_out[i]);
                break;
            }
        }
        std::abort();
    }
    std::printf("%s: PASS (N=%zu, total=%u)\n", name, input.size(), gpu_total);
}

void test_all_zeros(TileScanRunner& runner, GpuTestContext& gpu) {
    std::vector<uint32_t> input(WG_SIZE, 0u);
    verify("test_all_zeros", runner, gpu, input);
}

void test_all_ones(TileScanRunner& runner, GpuTestContext& gpu) {
    std::vector<uint32_t> input(WG_SIZE, 1u);
    verify("test_all_ones_single_block", runner, gpu, input);
}

void test_two_blocks(TileScanRunner& runner, GpuTestContext& gpu) {
    // 2 blocks (512 elements) — exercises the inter-block carry path.
    std::vector<uint32_t> input(WG_SIZE * 2u);
    for (size_t i = 0; i < input.size(); ++i) input[i] = static_cast<uint32_t>(i % 5);
    verify("test_two_blocks", runner, gpu, input);
}

void test_boundary_block(TileScanRunner& runner, GpuTestContext& gpu) {
    // Exactly 256 elements — no inter-block carry, exercises the
    // single-block path of pass 1.
    std::vector<uint32_t> input(WG_SIZE);
    for (size_t i = 0; i < input.size(); ++i) input[i] = (i * 7u + 3u) % 11u;
    verify("test_boundary_block", runner, gpu, input);
}

void test_just_over_block(TileScanRunner& runner, GpuTestContext& gpu) {
    // 512 (we round up; 257 isn't a valid input, the C++ allocator pads).
    // Verifies that the first-block-only-partially-used edge case is
    // handled when later blocks are all zeros.
    std::vector<uint32_t> input(WG_SIZE * 2u, 0u);
    for (size_t i = 0; i < 257; ++i) input[i] = 1u;
    verify("test_partial_second_block", runner, gpu, input);
}

void test_dense_random(TileScanRunner& runner, GpuTestContext& gpu) {
    // 1024 blocks ≈ 262 144 elements with random small counts. The mean
    // tile-overlap count for a real scene splat is ~1–4, so 0..7 is a
    // realistic distribution.
    std::mt19937 rng(0xfeed);
    std::vector<uint32_t> input(WG_SIZE * 1024u);
    for (auto& v : input) v = rng() % 8u;
    verify("test_dense_random_262k", runner, gpu, input);
}

void test_chunk_boundary(TileScanRunner& runner, GpuTestContext& gpu) {
    // 256 blocks = exactly one full pass-1 chunk. Verifies the
    // chunk_count==1 path of the block-scan.
    std::vector<uint32_t> input(WG_SIZE * 256u);
    for (size_t i = 0; i < input.size(); ++i) input[i] = (i & 1u) ? 2u : 0u;
    verify("test_chunk_boundary_64k", runner, gpu, input);
}

void test_multi_chunk(TileScanRunner& runner, GpuTestContext& gpu) {
    // 512 blocks → 2 chunks in pass 1. Exercises inter-chunk carry.
    std::vector<uint32_t> input(WG_SIZE * 512u);
    std::mt19937 rng(0xc0ffee);
    for (auto& v : input) v = rng() % 4u;
    verify("test_multi_chunk_131k", runner, gpu, input);
}

}  // namespace

int main() {
    GpuTestContext gpu;
    gpu.init();

    TileScanRunner runner;
    runner.init(gpu);

    test_all_zeros(runner, gpu);
    test_all_ones(runner, gpu);
    test_two_blocks(runner, gpu);
    test_boundary_block(runner, gpu);
    test_just_over_block(runner, gpu);
    test_dense_random(runner, gpu);
    test_chunk_boundary(runner, gpu);
    test_multi_chunk(runner, gpu);

    runner.shutdown(gpu);
    gpu.shutdown();

    std::printf("test_tile_scan_gpu: all checks passed\n");
    return 0;
}
