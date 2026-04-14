#include "onesweep_test_runner.hpp"
#include "gseurat/engine/pipeline.hpp"

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <stdexcept>

namespace gseurat {

void OnesweepTestRunner::init(GpuTestContext& gpu) {
    auto device = gpu.device();

    // Histogram layout: { input(0), status(1), indirect_args(2) }
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

    // Scatter layout: { input(0), output(1), status(2), indirect_args(3) }
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

    // Pipelines — uses load_shader_module from gseurat/engine/pipeline.hpp
    auto load_pipeline = [&](const char* spv_path,
                              VkDescriptorSetLayout layout,
                              VkPipelineLayout& out_layout,
                              VkPipeline& out_pipeline) {
        auto module = load_shader_module(device, spv_path);

        VkPushConstantRange push_range{};
        push_range.stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
        push_range.size = sizeof(uint32_t);

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

    // Descriptor pool (4 sets: 2 hist × 3 bindings + 2 scatter × 4 bindings = 14 descriptors)
    {
        VkDescriptorPoolSize pool_size{};
        pool_size.type = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
        pool_size.descriptorCount = 2 * 3 + 2 * 4;

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

    // Allocate buffers
    VkDeviceSize sort_buf_size = static_cast<VkDeviceSize>(capacity) * sizeof(TileSortEntry);
    VkDeviceSize status_size = static_cast<VkDeviceSize>(kNumPasses) * 256ull
                               * num_workgroups * sizeof(uint32_t);
    VkDeviceSize args_size = 8 * sizeof(uint32_t);

    Buffer buf_a = Buffer::create_storage_gpu_only(alloc, sort_buf_size);
    Buffer buf_b = Buffer::create_storage_gpu_only(alloc, sort_buf_size);
    Buffer status = Buffer::create_storage_gpu_only(alloc, status_size);
    Buffer args_buf = Buffer::create_storage_gpu_only(alloc, args_size);

    // Build indirect args on CPU
    uint32_t ranges_wg = (entry_count + 255) / 256;
    if (ranges_wg == 0) ranges_wg = 1;
    uint32_t args[8] = {
        num_workgroups, 1, 1,  // sort dispatch
        ranges_wg,             // ranges dispatch_x
        0, 0,                  // unused
        entry_count,           // entry_count
        256 * num_workgroups   // histogram_count
    };

    // Prepare padded input (sentinels for unused slots)
    std::vector<TileSortEntry> padded(capacity, {0xFFFFFFFF, 0xFFFFFFFF});
    std::memcpy(padded.data(), input.data(), entry_count * sizeof(TileSortEntry));

    // Record commands
    auto cmd = gpu.begin_commands();

    // Upload input to buf_a via staging
    Buffer staging_a = Buffer::create_staging(alloc, sort_buf_size);
    staging_a.upload(padded.data(), sort_buf_size);
    VkBufferCopy copy_region{0, 0, sort_buf_size};
    vkCmdCopyBuffer(cmd, staging_a.buffer(), buf_a.buffer(), 1, &copy_region);

    // Upload args via staging
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

    // Update descriptor sets
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

    // 4-pass Onesweep (matching gs_renderer.cpp:2057-2089)
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

        VkDescriptorSet hist_set = read_from_a ? hist_set_a_ : hist_set_b_;
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, hist_pipeline_);
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                hist_pipeline_layout_, 0, 1, &hist_set, 0, nullptr);
        vkCmdPushConstants(cmd, hist_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT, 0, 4, push_data);
        vkCmdDispatch(cmd, num_workgroups, 1, 1);

        insert_barrier();

        VkDescriptorSet scatter_set = read_from_a ? scatter_set_ab_ : scatter_set_ba_;
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, scatter_pipeline_);
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                scatter_pipeline_layout_, 0, 1, &scatter_set, 0, nullptr);
        vkCmdPushConstants(cmd, scatter_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT, 0, 4, push_data);
        vkCmdDispatch(cmd, num_workgroups, 1, 1);

        insert_barrier();
    }

    // Barrier: compute → transfer for readback
    {
        VkMemoryBarrier mb{};
        mb.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
        mb.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
        mb.dstAccessMask = VK_ACCESS_TRANSFER_READ_BIT;
        vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
            VK_PIPELINE_STAGE_TRANSFER_BIT, 0, 1, &mb, 0, nullptr, 0, nullptr);
    }

    // Readback from buf_a (4 even passes → result in A)
    Buffer readback = Buffer::create_readback(alloc, sort_buf_size);
    VkBufferCopy rb_region{0, 0, sort_buf_size};
    vkCmdCopyBuffer(cmd, buf_a.buffer(), readback.buffer(), 1, &rb_region);

    gpu.submit_and_wait();

    // Copy to result vector
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
