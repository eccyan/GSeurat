#include "vulkan_game/engine/gs_renderer.hpp"
#include "vulkan_game/engine/pipeline.hpp"

#include <cmath>
#include <cstring>
#include <stdexcept>
#include <algorithm>

namespace vulkan_game {

namespace {

// GPU-side Gaussian struct (matches gs_preprocess.comp input)
struct GpuGaussian {
    glm::vec4 pos_opacity;    // xyz = position, w = opacity
    glm::vec4 scale_pad;      // xyz = scale, w = unused
    glm::vec4 rot;            // xyzw = quaternion
    glm::vec4 color_pad;      // rgb = color, w = unused
};  // 64 bytes, aligned

// Projected 2D splat (output of preprocess, input to render)
struct ProjectedSplat {
    glm::vec2 center;         // screen-space center
    float depth;              // view-space depth for sorting
    float radius;             // bounding circle radius in pixels
    glm::vec4 conic_opacity;  // conic matrix (a, b, c) + opacity
    glm::vec4 color;          // rgb + alpha
};  // 48 bytes

// Uniform data for compute shaders
struct GsUniforms {
    glm::mat4 view;
    glm::mat4 proj;
    glm::uvec4 params;       // x = width, y = height, z = gaussian_count, w = sort_size
};

// Sort key: depth (upper 32 bits for sort) packed with index
struct SortEntry {
    uint32_t key;   // depth as uint (for bitonic sort)
    uint32_t index; // original Gaussian index
};

}  // namespace

void GsRenderer::init(VkDevice device, VmaAllocator allocator, VkDescriptorPool pool) {
    device_ = device;
    allocator_ = allocator;
    pool_ = pool;

    create_output_image(320, 240);
    create_descriptor_resources();
    create_compute_pipelines();
    initialized_ = true;
}

void GsRenderer::create_output_image(uint32_t width, uint32_t height) {
    output_width_ = width;
    output_height_ = height;

    // Create storage image
    VkImageCreateInfo image_info{};
    image_info.sType = VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO;
    image_info.imageType = VK_IMAGE_TYPE_2D;
    image_info.format = VK_FORMAT_R16G16B16A16_SFLOAT;
    image_info.extent = {width, height, 1};
    image_info.mipLevels = 1;
    image_info.arrayLayers = 1;
    image_info.samples = VK_SAMPLE_COUNT_1_BIT;
    image_info.tiling = VK_IMAGE_TILING_OPTIMAL;
    image_info.usage = VK_IMAGE_USAGE_STORAGE_BIT | VK_IMAGE_USAGE_SAMPLED_BIT;

    VmaAllocationCreateInfo alloc_info{};
    alloc_info.usage = VMA_MEMORY_USAGE_GPU_ONLY;

    if (vmaCreateImage(allocator_, &image_info, &alloc_info,
                       &output_image_, &output_allocation_, nullptr) != VK_SUCCESS) {
        throw std::runtime_error("Failed to create GS output image");
    }

    VkImageViewCreateInfo view_info{};
    view_info.sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO;
    view_info.image = output_image_;
    view_info.viewType = VK_IMAGE_VIEW_TYPE_2D;
    view_info.format = VK_FORMAT_R16G16B16A16_SFLOAT;
    view_info.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};

    if (vkCreateImageView(device_, &view_info, nullptr, &output_view_) != VK_SUCCESS) {
        throw std::runtime_error("Failed to create GS output image view");
    }

    // Create NEAREST sampler for pixel-art upscale
    VkSamplerCreateInfo sampler_info{};
    sampler_info.sType = VK_STRUCTURE_TYPE_SAMPLER_CREATE_INFO;
    sampler_info.magFilter = VK_FILTER_NEAREST;
    sampler_info.minFilter = VK_FILTER_NEAREST;
    sampler_info.addressModeU = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
    sampler_info.addressModeV = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
    sampler_info.addressModeW = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;

    if (vkCreateSampler(device_, &sampler_info, nullptr, &output_sampler_) != VK_SUCCESS) {
        throw std::runtime_error("Failed to create GS output sampler");
    }
}

void GsRenderer::create_descriptor_resources() {
    // Create dedicated descriptor pool for GS compute
    VkDescriptorPoolSize pool_sizes[] = {
        {VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 12},
        {VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 2},
        {VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 3},
    };

    VkDescriptorPoolCreateInfo pool_info{};
    pool_info.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    pool_info.maxSets = 3;
    pool_info.poolSizeCount = 3;
    pool_info.pPoolSizes = pool_sizes;

    if (vkCreateDescriptorPool(device_, &pool_info, nullptr, &gs_pool_) != VK_SUCCESS) {
        throw std::runtime_error("Failed to create GS descriptor pool");
    }

    // Preprocess layout: set 0 = { gaussians SSBO, projected SSBO, sort_keys SSBO, uniforms UBO }
    {
        VkDescriptorSetLayoutBinding bindings[] = {
            {0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {3, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        };
        VkDescriptorSetLayoutCreateInfo layout_info{};
        layout_info.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        layout_info.bindingCount = 4;
        layout_info.pBindings = bindings;
        vkCreateDescriptorSetLayout(device_, &layout_info, nullptr, &preprocess_layout_);
    }

    // Sort layout: { sort_keys SSBO, uniforms UBO }
    {
        VkDescriptorSetLayoutBinding bindings[] = {
            {0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {1, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        };
        VkDescriptorSetLayoutCreateInfo layout_info{};
        layout_info.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        layout_info.bindingCount = 2;
        layout_info.pBindings = bindings;
        vkCreateDescriptorSetLayout(device_, &layout_info, nullptr, &sort_layout_);
    }

    // Render layout: { projected SSBO, sort_keys SSBO, uniforms UBO, output image }
    {
        VkDescriptorSetLayoutBinding bindings[] = {
            {0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {2, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {3, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        };
        VkDescriptorSetLayoutCreateInfo layout_info{};
        layout_info.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        layout_info.bindingCount = 4;
        layout_info.pBindings = bindings;
        vkCreateDescriptorSetLayout(device_, &layout_info, nullptr, &render_layout_);
    }

    // Allocate descriptor sets
    VkDescriptorSetLayout layouts[] = {preprocess_layout_, sort_layout_, render_layout_};
    VkDescriptorSet sets[3];
    VkDescriptorSetAllocateInfo alloc_info{};
    alloc_info.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
    alloc_info.descriptorPool = gs_pool_;
    alloc_info.descriptorSetCount = 3;
    alloc_info.pSetLayouts = layouts;
    vkAllocateDescriptorSets(device_, &alloc_info, sets);
    preprocess_set_ = sets[0];
    sort_set_ = sets[1];
    render_set_ = sets[2];
}

void GsRenderer::create_compute_pipelines() {
    // Preprocess pipeline
    {
        auto module = load_shader_module(device_, "shaders/gs_preprocess.comp.spv");
        VkPipelineLayoutCreateInfo layout_info{};
        layout_info.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
        layout_info.setLayoutCount = 1;
        layout_info.pSetLayouts = &preprocess_layout_;
        vkCreatePipelineLayout(device_, &layout_info, nullptr, &preprocess_pipeline_layout_);

        VkComputePipelineCreateInfo pipeline_info{};
        pipeline_info.sType = VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO;
        pipeline_info.stage.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
        pipeline_info.stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
        pipeline_info.stage.module = module;
        pipeline_info.stage.pName = "main";
        pipeline_info.layout = preprocess_pipeline_layout_;

        if (vkCreateComputePipelines(device_, VK_NULL_HANDLE, 1, &pipeline_info,
                                     nullptr, &preprocess_pipeline_) != VK_SUCCESS) {
            throw std::runtime_error("Failed to create GS preprocess pipeline");
        }
        vkDestroyShaderModule(device_, module, nullptr);
    }

    // Sort pipeline
    {
        auto module = load_shader_module(device_, "shaders/gs_sort.comp.spv");
        VkPushConstantRange push_range{};
        push_range.stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
        push_range.offset = 0;
        push_range.size = 8;  // sort step params (k, j)

        VkPipelineLayoutCreateInfo layout_info{};
        layout_info.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
        layout_info.setLayoutCount = 1;
        layout_info.pSetLayouts = &sort_layout_;
        layout_info.pushConstantRangeCount = 1;
        layout_info.pPushConstantRanges = &push_range;
        vkCreatePipelineLayout(device_, &layout_info, nullptr, &sort_pipeline_layout_);

        VkComputePipelineCreateInfo pipeline_info{};
        pipeline_info.sType = VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO;
        pipeline_info.stage.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
        pipeline_info.stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
        pipeline_info.stage.module = module;
        pipeline_info.stage.pName = "main";
        pipeline_info.layout = sort_pipeline_layout_;

        if (vkCreateComputePipelines(device_, VK_NULL_HANDLE, 1, &pipeline_info,
                                     nullptr, &sort_pipeline_) != VK_SUCCESS) {
            throw std::runtime_error("Failed to create GS sort pipeline");
        }
        vkDestroyShaderModule(device_, module, nullptr);
    }

    // Render pipeline
    {
        auto module = load_shader_module(device_, "shaders/gs_render.comp.spv");
        VkPipelineLayoutCreateInfo layout_info{};
        layout_info.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
        layout_info.setLayoutCount = 1;
        layout_info.pSetLayouts = &render_layout_;
        vkCreatePipelineLayout(device_, &layout_info, nullptr, &render_pipeline_layout_);

        VkComputePipelineCreateInfo pipeline_info{};
        pipeline_info.sType = VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO;
        pipeline_info.stage.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
        pipeline_info.stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
        pipeline_info.stage.module = module;
        pipeline_info.stage.pName = "main";
        pipeline_info.layout = render_pipeline_layout_;

        if (vkCreateComputePipelines(device_, VK_NULL_HANDLE, 1, &pipeline_info,
                                     nullptr, &render_pipeline_) != VK_SUCCESS) {
            throw std::runtime_error("Failed to create GS render pipeline");
        }
        vkDestroyShaderModule(device_, module, nullptr);
    }
}

void GsRenderer::load_cloud(const GaussianCloud& cloud) {
    if (cloud.empty()) return;

    gaussian_count_ = cloud.count();

    // Round up to next power of 2 for bitonic sort
    uint32_t sort_size = 1;
    while (sort_size < gaussian_count_) sort_size <<= 1;

    VkDeviceSize gaussian_buf_size = static_cast<VkDeviceSize>(gaussian_count_) * sizeof(GpuGaussian);
    VkDeviceSize projected_buf_size = static_cast<VkDeviceSize>(gaussian_count_) * sizeof(ProjectedSplat);
    VkDeviceSize sort_buf_size = static_cast<VkDeviceSize>(sort_size) * sizeof(SortEntry);

    // Destroy existing buffers
    gaussian_ssbo_.destroy(allocator_);
    projected_ssbo_.destroy(allocator_);
    sort_keys_ssbo_.destroy(allocator_);
    uniform_buffer_.destroy(allocator_);

    // Create GPU storage buffers (host-visible for upload)
    gaussian_ssbo_ = Buffer::create_storage(allocator_, gaussian_buf_size);
    projected_ssbo_ = Buffer::create_storage(allocator_, projected_buf_size);
    sort_keys_ssbo_ = Buffer::create_storage(allocator_, sort_buf_size);
    uniform_buffer_ = Buffer::create_uniform(allocator_, sizeof(GsUniforms));

    // Upload Gaussian data
    {
        auto* gpu_data = static_cast<GpuGaussian*>(gaussian_ssbo_.mapped());
        for (uint32_t i = 0; i < gaussian_count_; ++i) {
            const auto& g = cloud.gaussians()[i];
            gpu_data[i].pos_opacity = glm::vec4(g.position, g.opacity);
            gpu_data[i].scale_pad = glm::vec4(g.scale, 0.0f);
            gpu_data[i].rot = glm::vec4(g.rotation.x, g.rotation.y, g.rotation.z, g.rotation.w);
            gpu_data[i].color_pad = glm::vec4(g.color, 1.0f);
        }
    }

    // Initialize sort keys to max depth (for padding elements beyond gaussian_count)
    {
        auto* sort = static_cast<SortEntry*>(sort_keys_ssbo_.mapped());
        for (uint32_t i = 0; i < sort_size; ++i) {
            sort[i].key = 0xFFFFFFFF;  // max depth = sorted to end
            sort[i].index = i < gaussian_count_ ? i : 0;
        }
    }

    update_descriptors();
}

void GsRenderer::update_descriptors() {
    // Preprocess set: gaussians(0), projected(1), sort_keys(2), uniforms(3)
    {
        VkDescriptorBufferInfo gaussian_info{gaussian_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo projected_info{projected_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo sort_info{sort_keys_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo uniform_info{uniform_buffer_.buffer(), 0, sizeof(GsUniforms)};

        VkWriteDescriptorSet writes[] = {
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, preprocess_set_, 0, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &gaussian_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, preprocess_set_, 1, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &projected_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, preprocess_set_, 2, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &sort_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, preprocess_set_, 3, 0, 1,
             VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, nullptr, &uniform_info, nullptr},
        };
        vkUpdateDescriptorSets(device_, 4, writes, 0, nullptr);
    }

    // Sort set: sort_keys(0), uniforms(1)
    {
        VkDescriptorBufferInfo sort_info{sort_keys_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo uniform_info{uniform_buffer_.buffer(), 0, sizeof(GsUniforms)};

        VkWriteDescriptorSet writes[] = {
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, sort_set_, 0, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &sort_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, sort_set_, 1, 0, 1,
             VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, nullptr, &uniform_info, nullptr},
        };
        vkUpdateDescriptorSets(device_, 2, writes, 0, nullptr);
    }

    // Render set: projected(0), sort_keys(1), uniforms(2), output_image(3)
    {
        VkDescriptorBufferInfo projected_info{projected_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo sort_info{sort_keys_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo uniform_info{uniform_buffer_.buffer(), 0, sizeof(GsUniforms)};
        VkDescriptorImageInfo image_info{VK_NULL_HANDLE, output_view_, VK_IMAGE_LAYOUT_GENERAL};

        VkWriteDescriptorSet writes[] = {
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, render_set_, 0, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &projected_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, render_set_, 1, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &sort_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, render_set_, 2, 0, 1,
             VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, nullptr, &uniform_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, render_set_, 3, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, &image_info, nullptr, nullptr},
        };
        vkUpdateDescriptorSets(device_, 4, writes, 0, nullptr);
    }
}

void GsRenderer::render(VkCommandBuffer cmd, const glm::mat4& view, const glm::mat4& proj,
                         uint32_t width, uint32_t height) {
    if (gaussian_count_ == 0) return;

    // Round up to next power of 2 for bitonic sort
    uint32_t sort_size = 1;
    while (sort_size < gaussian_count_) sort_size <<= 1;

    // Update uniforms
    GsUniforms uniforms{};
    uniforms.view = view;
    uniforms.proj = proj;
    uniforms.params = glm::uvec4(width, height, gaussian_count_, sort_size);
    std::memcpy(uniform_buffer_.mapped(), &uniforms, sizeof(uniforms));

    // Transition output image to GENERAL layout for compute write
    {
        VkImageMemoryBarrier barrier{};
        barrier.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
        barrier.srcAccessMask = 0;
        barrier.dstAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
        barrier.oldLayout = VK_IMAGE_LAYOUT_UNDEFINED;
        barrier.newLayout = VK_IMAGE_LAYOUT_GENERAL;
        barrier.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        barrier.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        barrier.image = output_image_;
        barrier.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};

        vkCmdPipelineBarrier(cmd,
            VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT,
            VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
            0, 0, nullptr, 0, nullptr, 1, &barrier);
    }

    // Pass 1: Preprocess — project Gaussians to 2D, frustum cull, compute covariance
    {
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, preprocess_pipeline_);
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                preprocess_pipeline_layout_, 0, 1, &preprocess_set_, 0, nullptr);
        vkCmdDispatch(cmd, (gaussian_count_ + 255) / 256, 1, 1);
    }

    // Barrier: preprocess writes → sort reads
    {
        VkMemoryBarrier barrier{};
        barrier.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
        barrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
        barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
        vkCmdPipelineBarrier(cmd,
            VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
            VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
            0, 1, &barrier, 0, nullptr, 0, nullptr);
    }

    // Pass 2: Bitonic sort by depth
    {
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, sort_pipeline_);
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                sort_pipeline_layout_, 0, 1, &sort_set_, 0, nullptr);

        // Bitonic sort: outer loop k = 2,4,8,...,sort_size; inner loop j = k/2,...,1
        for (uint32_t k = 2; k <= sort_size; k <<= 1) {
            for (uint32_t j = k >> 1; j > 0; j >>= 1) {
                uint32_t push_data[2] = {k, j};
                vkCmdPushConstants(cmd, sort_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                                   0, 8, push_data);
                vkCmdDispatch(cmd, (sort_size + 255) / 256, 1, 1);

                // Barrier between sort passes
                VkMemoryBarrier barrier{};
                barrier.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
                barrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
                barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
                vkCmdPipelineBarrier(cmd,
                    VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                    VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                    0, 1, &barrier, 0, nullptr, 0, nullptr);
            }
        }
    }

    // Barrier: sort writes → render reads
    {
        VkMemoryBarrier barrier{};
        barrier.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
        barrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
        barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
        vkCmdPipelineBarrier(cmd,
            VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
            VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
            0, 1, &barrier, 0, nullptr, 0, nullptr);
    }

    // Pass 3: Tile-based rasterization (16x16 tiles)
    {
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, render_pipeline_);
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                render_pipeline_layout_, 0, 1, &render_set_, 0, nullptr);
        uint32_t tiles_x = (width + 15) / 16;
        uint32_t tiles_y = (height + 15) / 16;
        vkCmdDispatch(cmd, tiles_x, tiles_y, 1);
    }

    // Transition output image from GENERAL → SHADER_READ_ONLY for fragment sampling
    {
        VkImageMemoryBarrier barrier{};
        barrier.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
        barrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
        barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
        barrier.oldLayout = VK_IMAGE_LAYOUT_GENERAL;
        barrier.newLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
        barrier.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        barrier.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        barrier.image = output_image_;
        barrier.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};

        vkCmdPipelineBarrier(cmd,
            VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
            VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT,
            0, 0, nullptr, 0, nullptr, 1, &barrier);
    }
}

void GsRenderer::shutdown(VmaAllocator allocator) {
    if (!initialized_) return;

    gaussian_ssbo_.destroy(allocator);
    projected_ssbo_.destroy(allocator);
    sort_keys_ssbo_.destroy(allocator);
    uniform_buffer_.destroy(allocator);

    if (output_sampler_) vkDestroySampler(device_, output_sampler_, nullptr);
    if (output_view_) vkDestroyImageView(device_, output_view_, nullptr);
    if (output_image_) vmaDestroyImage(allocator, output_image_, output_allocation_);

    if (preprocess_pipeline_) vkDestroyPipeline(device_, preprocess_pipeline_, nullptr);
    if (sort_pipeline_) vkDestroyPipeline(device_, sort_pipeline_, nullptr);
    if (render_pipeline_) vkDestroyPipeline(device_, render_pipeline_, nullptr);

    if (preprocess_pipeline_layout_) vkDestroyPipelineLayout(device_, preprocess_pipeline_layout_, nullptr);
    if (sort_pipeline_layout_) vkDestroyPipelineLayout(device_, sort_pipeline_layout_, nullptr);
    if (render_pipeline_layout_) vkDestroyPipelineLayout(device_, render_pipeline_layout_, nullptr);

    if (preprocess_layout_) vkDestroyDescriptorSetLayout(device_, preprocess_layout_, nullptr);
    if (sort_layout_) vkDestroyDescriptorSetLayout(device_, sort_layout_, nullptr);
    if (render_layout_) vkDestroyDescriptorSetLayout(device_, render_layout_, nullptr);

    if (gs_pool_) vkDestroyDescriptorPool(device_, gs_pool_, nullptr);

    initialized_ = false;
}

}  // namespace vulkan_game
