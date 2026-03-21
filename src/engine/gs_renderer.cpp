#include "gseurat/engine/gs_renderer.hpp"
#include "gseurat/engine/pipeline.hpp"

#include <cmath>
#include <cstring>
#include <stdexcept>
#include <algorithm>

namespace gseurat {

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

// Uniform data for compute shaders (256 bytes, aligned)
struct GsUniforms {
    glm::mat4 view;
    glm::mat4 proj;
    glm::uvec4 params;       // x = width, y = height, z = gaussian_count, w = sort_size
    glm::vec4 shadow_box;    // x = margin, y = cone_cos, z = num_sort_passes, w = scale_multiplier
    glm::vec4 cone_dir;      // xyz = cone direction, w = unused
    glm::vec4 cam_pos;       // xyz = camera position, w = unused
    glm::vec4 effect_flags;  // x = toon_bands, y = light_mode, z = touch_active, w = time
    glm::vec4 light_params;  // xyz = light_dir, w = intensity
    glm::vec4 touch_point;   // xyz = world_pos, w = radius
    glm::vec4 effect_params; // x = water_y, y = fire_y_min, z = fire_y_max, w = strength
    glm::vec4 effect_params2; // x = pulse_t, y = xray_depth, z = swirl_t, w = unused
};

// Sort key: depth packed with index
struct SortEntry {
    uint32_t key;   // depth as uint
    uint32_t index; // original Gaussian index
};

void insert_compute_barrier(VkCommandBuffer cmd) {
    VkMemoryBarrier barrier{};
    barrier.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
    barrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
    barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
    vkCmdPipelineBarrier(cmd,
        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
        VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
        0, 1, &barrier, 0, nullptr, 0, nullptr);
}

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
    // Descriptor pool — enough for all sets
    VkDescriptorPoolSize pool_sizes[] = {
        {VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 30},
        {VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 2},
        {VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 3},
    };

    VkDescriptorPoolCreateInfo pool_info{};
    pool_info.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    pool_info.maxSets = 10;
    pool_info.poolSizeCount = 3;
    pool_info.pPoolSizes = pool_sizes;

    if (vkCreateDescriptorPool(device_, &pool_info, nullptr, &gs_pool_) != VK_SUCCESS) {
        throw std::runtime_error("Failed to create GS descriptor pool");
    }

    // Preprocess layout: { gaussians, projected, sort_keys, uniforms, visible_count }
    {
        VkDescriptorSetLayoutBinding bindings[] = {
            {0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {3, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        };
        VkDescriptorSetLayoutCreateInfo ci{};
        ci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        ci.bindingCount = 5;
        ci.pBindings = bindings;
        vkCreateDescriptorSetLayout(device_, &ci, nullptr, &preprocess_layout_);
    }

    // Sort layout (legacy, kept for compatibility)
    {
        VkDescriptorSetLayoutBinding bindings[] = {
            {0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {1, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        };
        VkDescriptorSetLayoutCreateInfo ci{};
        ci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        ci.bindingCount = 2;
        ci.pBindings = bindings;
        vkCreateDescriptorSetLayout(device_, &ci, nullptr, &sort_layout_);
    }

    // Render layout: { projected, sort_keys, uniforms, output_image, visible_count }
    {
        VkDescriptorSetLayoutBinding bindings[] = {
            {0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {2, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {3, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        };
        VkDescriptorSetLayoutCreateInfo ci{};
        ci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        ci.bindingCount = 5;
        ci.pBindings = bindings;
        vkCreateDescriptorSetLayout(device_, &ci, nullptr, &render_layout_);
    }

    // Radix histogram layout: { input_entries, histogram }
    {
        VkDescriptorSetLayoutBinding bindings[] = {
            {0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        };
        VkDescriptorSetLayoutCreateInfo ci{};
        ci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        ci.bindingCount = 2;
        ci.pBindings = bindings;
        vkCreateDescriptorSetLayout(device_, &ci, nullptr, &radix_histogram_layout_);
    }

    // Radix scan layout: { histogram }
    {
        VkDescriptorSetLayoutBinding bindings[] = {
            {0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        };
        VkDescriptorSetLayoutCreateInfo ci{};
        ci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        ci.bindingCount = 1;
        ci.pBindings = bindings;
        vkCreateDescriptorSetLayout(device_, &ci, nullptr, &radix_scan_layout_);
    }

    // Radix scatter layout: { input, output, histogram }
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
        vkCreateDescriptorSetLayout(device_, &ci, nullptr, &radix_scatter_layout_);
    }

    // Allocate all descriptor sets
    VkDescriptorSetLayout layouts[] = {
        preprocess_layout_, sort_layout_, render_layout_,
        radix_histogram_layout_, radix_histogram_layout_,  // A and B
        radix_scan_layout_,
        radix_scatter_layout_, radix_scatter_layout_,      // AB and BA
    };
    VkDescriptorSet sets[8];
    VkDescriptorSetAllocateInfo alloc_info{};
    alloc_info.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
    alloc_info.descriptorPool = gs_pool_;
    alloc_info.descriptorSetCount = 8;
    alloc_info.pSetLayouts = layouts;
    vkAllocateDescriptorSets(device_, &alloc_info, sets);

    preprocess_set_ = sets[0];
    sort_set_ = sets[1];
    render_set_ = sets[2];
    radix_histogram_set_a_ = sets[3];
    radix_histogram_set_b_ = sets[4];
    radix_scan_set_ = sets[5];
    radix_scatter_set_ab_ = sets[6];
    radix_scatter_set_ba_ = sets[7];
}

void GsRenderer::create_compute_pipelines() {
    // Helper to create a compute pipeline with push constants
    auto create_pipeline = [&](const char* spv_path,
                               VkDescriptorSetLayout layout,
                               uint32_t push_size,
                               VkPipelineLayout& out_layout,
                               VkPipeline& out_pipeline) {
        auto module = load_shader_module(device_, spv_path);

        VkPipelineLayoutCreateInfo layout_info{};
        layout_info.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
        layout_info.setLayoutCount = 1;
        layout_info.pSetLayouts = &layout;

        VkPushConstantRange push_range{};
        if (push_size > 0) {
            push_range.stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
            push_range.size = push_size;
            layout_info.pushConstantRangeCount = 1;
            layout_info.pPushConstantRanges = &push_range;
        }

        vkCreatePipelineLayout(device_, &layout_info, nullptr, &out_layout);

        VkComputePipelineCreateInfo pi{};
        pi.sType = VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO;
        pi.stage.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
        pi.stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
        pi.stage.module = module;
        pi.stage.pName = "main";
        pi.layout = out_layout;

        if (vkCreateComputePipelines(device_, VK_NULL_HANDLE, 1, &pi,
                                     nullptr, &out_pipeline) != VK_SUCCESS) {
            throw std::runtime_error(std::string("Failed to create pipeline: ") + spv_path);
        }
        vkDestroyShaderModule(device_, module, nullptr);
    };

    create_pipeline("shaders/gs_preprocess.comp.spv", preprocess_layout_, 0,
                    preprocess_pipeline_layout_, preprocess_pipeline_);
    create_pipeline("shaders/gs_sort.comp.spv", sort_layout_, 8,
                    sort_pipeline_layout_, sort_pipeline_);
    create_pipeline("shaders/gs_render.comp.spv", render_layout_, 0,
                    render_pipeline_layout_, render_pipeline_);

    // Radix sort pipelines
    create_pipeline("shaders/gs_radix_histogram.comp.spv", radix_histogram_layout_, 8,
                    radix_histogram_pipeline_layout_, radix_histogram_pipeline_);
    create_pipeline("shaders/gs_radix_scan.comp.spv", radix_scan_layout_, 4,
                    radix_scan_pipeline_layout_, radix_scan_pipeline_);
    create_pipeline("shaders/gs_radix_scatter.comp.spv", radix_scatter_layout_, 8,
                    radix_scatter_pipeline_layout_, radix_scatter_pipeline_);
}

void GsRenderer::load_cloud(const GaussianCloud& cloud) {
    if (cloud.empty()) return;

    sort_done_once_ = false;
    gaussian_count_ = cloud.count();
    max_gaussian_count_ = gaussian_count_;

    // Round up to next multiple of 1024 for radix sort workgroups (256 threads × 4 elements)
    sort_size_ = ((gaussian_count_ + 1023) / 1024) * 1024;
    if (sort_size_ < gaussian_count_) sort_size_ = gaussian_count_;  // safety
    num_sort_workgroups_ = sort_size_ / 1024;
    if (num_sort_workgroups_ == 0) num_sort_workgroups_ = 1;
    // Ensure sort_size_ is at least num_sort_workgroups_ * 1024
    sort_size_ = num_sort_workgroups_ * 1024;

    VkDeviceSize gaussian_buf_size = static_cast<VkDeviceSize>(gaussian_count_) * sizeof(GpuGaussian);
    VkDeviceSize projected_buf_size = static_cast<VkDeviceSize>(gaussian_count_) * sizeof(ProjectedSplat);
    VkDeviceSize sort_buf_size = static_cast<VkDeviceSize>(sort_size_) * sizeof(SortEntry);
    VkDeviceSize histogram_buf_size = static_cast<VkDeviceSize>(256) * num_sort_workgroups_ * sizeof(uint32_t);

    // Destroy existing buffers
    gaussian_ssbo_.destroy(allocator_);
    projected_ssbo_.destroy(allocator_);
    sort_keys_ssbo_.destroy(allocator_);
    sort_b_ssbo_.destroy(allocator_);
    histogram_ssbo_.destroy(allocator_);
    uniform_buffer_.destroy(allocator_);
    visible_count_ssbo_.destroy(allocator_);

    // Create GPU storage buffers
    gaussian_ssbo_ = Buffer::create_storage(allocator_, gaussian_buf_size);
    projected_ssbo_ = Buffer::create_storage(allocator_, projected_buf_size);
    sort_keys_ssbo_ = Buffer::create_storage(allocator_, sort_buf_size);
    sort_b_ssbo_ = Buffer::create_storage(allocator_, sort_buf_size);
    histogram_ssbo_ = Buffer::create_storage(allocator_, histogram_buf_size);
    uniform_buffer_ = Buffer::create_uniform(allocator_, sizeof(GsUniforms));
    visible_count_ssbo_ = Buffer::create_storage_readback(allocator_, sizeof(uint32_t));

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

    // Initialize both sort buffers with sentinel keys
    auto init_sort_buf = [&](Buffer& buf) {
        auto* sort = static_cast<SortEntry*>(buf.mapped());
        for (uint32_t i = 0; i < sort_size_; ++i) {
            sort[i].key = 0xFFFFFFFF;
            sort[i].index = i < gaussian_count_ ? i : 0;
        }
    };
    init_sort_buf(sort_keys_ssbo_);
    init_sort_buf(sort_b_ssbo_);

    update_descriptors();
}

void GsRenderer::update_active_gaussians(const Gaussian* data, uint32_t count) {
    if (count == 0 || count > max_gaussian_count_) return;

    sort_done_once_ = false;
    gaussian_count_ = count;

    auto* gpu_data = static_cast<GpuGaussian*>(gaussian_ssbo_.mapped());
    for (uint32_t i = 0; i < count; ++i) {
        gpu_data[i].pos_opacity = glm::vec4(data[i].position, data[i].opacity);
        gpu_data[i].scale_pad = glm::vec4(data[i].scale, 0.0f);
        gpu_data[i].rot = glm::vec4(data[i].rotation.x, data[i].rotation.y,
                                     data[i].rotation.z, data[i].rotation.w);
        gpu_data[i].color_pad = glm::vec4(data[i].color, 1.0f);
    }

    // Reinitialize both sort buffers
    auto init_sort_buf = [&](Buffer& buf) {
        auto* sort = static_cast<SortEntry*>(buf.mapped());
        for (uint32_t i = 0; i < sort_size_; ++i) {
            sort[i].key = 0xFFFFFFFF;
            sort[i].index = i < gaussian_count_ ? i : 0;
        }
    };
    init_sort_buf(sort_keys_ssbo_);
    init_sort_buf(sort_b_ssbo_);
}

void GsRenderer::update_descriptors() {
    // Preprocess set: gaussians(0), projected(1), sort_keys_A(2), uniforms(3), visible_count(4)
    {
        VkDescriptorBufferInfo gaussian_info{gaussian_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo projected_info{projected_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo sort_info{sort_keys_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo uniform_info{uniform_buffer_.buffer(), 0, sizeof(GsUniforms)};
        VkDescriptorBufferInfo visible_count_info{visible_count_ssbo_.buffer(), 0, sizeof(uint32_t)};

        VkWriteDescriptorSet writes[] = {
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, preprocess_set_, 0, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &gaussian_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, preprocess_set_, 1, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &projected_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, preprocess_set_, 2, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &sort_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, preprocess_set_, 3, 0, 1,
             VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, nullptr, &uniform_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, preprocess_set_, 4, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &visible_count_info, nullptr},
        };
        vkUpdateDescriptorSets(device_, 5, writes, 0, nullptr);
    }

    // Legacy sort set
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

    // Render set: projected(0), sort_keys_A(1), uniforms(2), output_image(3), visible_count(4)
    {
        VkDescriptorBufferInfo projected_info{projected_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo sort_info{sort_keys_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo uniform_info{uniform_buffer_.buffer(), 0, sizeof(GsUniforms)};
        VkDescriptorImageInfo image_info{VK_NULL_HANDLE, output_view_, VK_IMAGE_LAYOUT_GENERAL};
        VkDescriptorBufferInfo visible_count_info{visible_count_ssbo_.buffer(), 0, sizeof(uint32_t)};

        VkWriteDescriptorSet writes[] = {
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, render_set_, 0, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &projected_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, render_set_, 1, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &sort_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, render_set_, 2, 0, 1,
             VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, nullptr, &uniform_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, render_set_, 3, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, &image_info, nullptr, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, render_set_, 4, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &visible_count_info, nullptr},
        };
        vkUpdateDescriptorSets(device_, 5, writes, 0, nullptr);
    }

    // Radix histogram set A: reads sort_keys_ssbo_ (A), writes histogram
    {
        VkDescriptorBufferInfo input_info{sort_keys_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo hist_info{histogram_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkWriteDescriptorSet writes[] = {
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, radix_histogram_set_a_, 0, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &input_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, radix_histogram_set_a_, 1, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &hist_info, nullptr},
        };
        vkUpdateDescriptorSets(device_, 2, writes, 0, nullptr);
    }

    // Radix histogram set B: reads sort_b_ssbo_ (B), writes histogram
    {
        VkDescriptorBufferInfo input_info{sort_b_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo hist_info{histogram_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkWriteDescriptorSet writes[] = {
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, radix_histogram_set_b_, 0, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &input_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, radix_histogram_set_b_, 1, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &hist_info, nullptr},
        };
        vkUpdateDescriptorSets(device_, 2, writes, 0, nullptr);
    }

    // Radix scan set: histogram (read/write)
    {
        VkDescriptorBufferInfo hist_info{histogram_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkWriteDescriptorSet writes[] = {
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, radix_scan_set_, 0, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &hist_info, nullptr},
        };
        vkUpdateDescriptorSets(device_, 1, writes, 0, nullptr);
    }

    // Radix scatter AB: reads A, writes B, reads histogram
    {
        VkDescriptorBufferInfo in_info{sort_keys_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo out_info{sort_b_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo hist_info{histogram_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkWriteDescriptorSet writes[] = {
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, radix_scatter_set_ab_, 0, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &in_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, radix_scatter_set_ab_, 1, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &out_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, radix_scatter_set_ab_, 2, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &hist_info, nullptr},
        };
        vkUpdateDescriptorSets(device_, 3, writes, 0, nullptr);
    }

    // Radix scatter BA: reads B, writes A, reads histogram
    {
        VkDescriptorBufferInfo in_info{sort_b_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo out_info{sort_keys_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo hist_info{histogram_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkWriteDescriptorSet writes[] = {
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, radix_scatter_set_ba_, 0, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &in_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, radix_scatter_set_ba_, 1, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &out_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, radix_scatter_set_ba_, 2, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &hist_info, nullptr},
        };
        vkUpdateDescriptorSets(device_, 3, writes, 0, nullptr);
    }
}

void GsRenderer::resize_output(uint32_t width, uint32_t height) {
    if (width == output_width_ && height == output_height_) return;

    if (output_sampler_) { vkDestroySampler(device_, output_sampler_, nullptr); output_sampler_ = VK_NULL_HANDLE; }
    if (output_view_) { vkDestroyImageView(device_, output_view_, nullptr); output_view_ = VK_NULL_HANDLE; }
    if (output_image_) { vmaDestroyImage(allocator_, output_image_, output_allocation_); output_image_ = VK_NULL_HANDLE; }

    create_output_image(width, height);

    if (gaussian_count_ > 0) {
        update_descriptors();
    }
}

void GsRenderer::render(VkCommandBuffer cmd, const glm::mat4& view, const glm::mat4& proj) {
    if (gaussian_count_ == 0) return;

    uint32_t width = output_width_;
    uint32_t height = output_height_;

    // Update uniforms
    GsUniforms uniforms{};
    uniforms.view = view;
    uniforms.proj = proj;
    uniforms.params = glm::uvec4(width, height, gaussian_count_, sort_size_);
    uniforms.shadow_box = glm::vec4(shadow_box_margin_, shadow_box_cone_cos_,
                                     static_cast<float>(num_sort_passes_), scale_multiplier_);
    uniforms.cone_dir = glm::vec4(shadow_box_cone_dir_, explode_t_);
    uniforms.cam_pos = glm::vec4(shadow_box_cam_pos_, voxel_t_);
    uniforms.effect_flags = glm::vec4(
        static_cast<float>(toon_bands_),
        static_cast<float>(light_mode_),
        touch_active_ ? touch_time_ : 0.0f,
        time_);
    uniforms.light_params = glm::vec4(glm::normalize(light_dir_), light_intensity_);
    uniforms.touch_point = glm::vec4(touch_point_, touch_radius_);
    uniforms.effect_params = glm::vec4(water_y_, fire_y_min_, fire_y_max_, effect_strength_);
    uniforms.effect_params2 = glm::vec4(pulse_t_, xray_depth_, swirl_t_, burn_t_);
    std::memcpy(uniform_buffer_.mapped(), &uniforms, sizeof(uniforms));

    // In skip-sort mode, skip the entire compute pipeline after the first
    // render.  The cached output image is reused, and parallax is applied by
    // shifting the blit quad in the composite pass (essentially free).
    // The image is already in SHADER_READ_ONLY_OPTIMAL from the previous frame's
    // transition — no layout change needed, just a memory dependency.
    if (skip_sort_ && sort_done_once_) {
        return;
    }

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

    // Reset visible count to 0 on GPU timeline
    vkCmdFillBuffer(cmd, visible_count_ssbo_.buffer(), 0, sizeof(uint32_t), 0);
    {
        VkMemoryBarrier fill_barrier{};
        fill_barrier.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
        fill_barrier.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
        fill_barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
        vkCmdPipelineBarrier(cmd,
            VK_PIPELINE_STAGE_TRANSFER_BIT,
            VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
            0, 1, &fill_barrier, 0, nullptr, 0, nullptr);
    }

    // Pass 1: Preprocess — project Gaussians to 2D, frustum cull
    {
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, preprocess_pipeline_);
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                preprocess_pipeline_layout_, 0, 1, &preprocess_set_, 0, nullptr);
        vkCmdDispatch(cmd, (gaussian_count_ + 255) / 256, 1, 1);
    }

    // Barrier: preprocess → radix sort
    insert_compute_barrier(cmd);

    // Pass 2: Radix sort (num_sort_passes_ digit passes × 3 dispatches each)
    uint32_t histogram_count = 256 * num_sort_workgroups_;
    for (uint32_t digit = 0; digit < num_sort_passes_; ++digit) {
        uint32_t digit_shift = digit * 8;
        bool read_from_a = (digit % 2 == 0);
        uint32_t push_data[2] = {sort_size_, digit_shift};

        // Histogram
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, radix_histogram_pipeline_);
        auto hist_set = read_from_a ? radix_histogram_set_a_ : radix_histogram_set_b_;
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                radix_histogram_pipeline_layout_, 0, 1, &hist_set, 0, nullptr);
        vkCmdPushConstants(cmd, radix_histogram_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                           0, 8, push_data);
        vkCmdDispatch(cmd, num_sort_workgroups_, 1, 1);

        insert_compute_barrier(cmd);

        // Prefix scan (single workgroup)
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, radix_scan_pipeline_);
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                radix_scan_pipeline_layout_, 0, 1, &radix_scan_set_, 0, nullptr);
        vkCmdPushConstants(cmd, radix_scan_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                           0, 4, &histogram_count);
        vkCmdDispatch(cmd, 1, 1, 1);

        insert_compute_barrier(cmd);

        // Scatter
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, radix_scatter_pipeline_);
        auto scatter_set = read_from_a ? radix_scatter_set_ab_ : radix_scatter_set_ba_;
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                radix_scatter_pipeline_layout_, 0, 1, &scatter_set, 0, nullptr);
        vkCmdPushConstants(cmd, radix_scatter_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                           0, 8, push_data);
        vkCmdDispatch(cmd, num_sort_workgroups_, 1, 1);

        // Barrier before next digit pass (or render)
        insert_compute_barrier(cmd);
    }

    sort_done_once_ = true;

    // After even number of passes, result is back in buffer A (sort_keys_ssbo_)

    // Pass 3: Tile-based rasterization
    {
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, render_pipeline_);
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                render_pipeline_layout_, 0, 1, &render_set_, 0, nullptr);
        uint32_t tiles_x = (width + 15) / 16;
        uint32_t tiles_y = (height + 15) / 16;
        vkCmdDispatch(cmd, tiles_x, tiles_y, 1);
    }

    // Transition output image → SHADER_READ_ONLY for fragment sampling
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

void GsRenderer::set_shadow_box_params(const glm::vec3& cone_dir, float cone_cos,
                                        const glm::vec3& cam_pos, float margin) {
    shadow_box_active_ = true;
    shadow_box_cone_dir_ = cone_dir;
    shadow_box_cone_cos_ = cone_cos;
    shadow_box_cam_pos_ = cam_pos;
    shadow_box_margin_ = margin;
    // 2 sort passes for 16-bit keys — even count so final data lands in buffer A
    num_sort_passes_ = 2;
}

void GsRenderer::clear_shadow_box_params() {
    shadow_box_active_ = false;
    shadow_box_margin_ = 128.0f;
    num_sort_passes_ = 2;
}

void GsRenderer::shutdown(VmaAllocator allocator) {
    if (!initialized_) return;

    gaussian_ssbo_.destroy(allocator);
    projected_ssbo_.destroy(allocator);
    sort_keys_ssbo_.destroy(allocator);
    sort_b_ssbo_.destroy(allocator);
    histogram_ssbo_.destroy(allocator);
    uniform_buffer_.destroy(allocator);
    visible_count_ssbo_.destroy(allocator);

    if (output_sampler_) vkDestroySampler(device_, output_sampler_, nullptr);
    if (output_view_) vkDestroyImageView(device_, output_view_, nullptr);
    if (output_image_) vmaDestroyImage(allocator, output_image_, output_allocation_);

    auto destroy_pipeline = [&](VkPipeline& p) { if (p) { vkDestroyPipeline(device_, p, nullptr); p = VK_NULL_HANDLE; } };
    auto destroy_layout = [&](VkPipelineLayout& l) { if (l) { vkDestroyPipelineLayout(device_, l, nullptr); l = VK_NULL_HANDLE; } };
    auto destroy_set_layout = [&](VkDescriptorSetLayout& l) { if (l) { vkDestroyDescriptorSetLayout(device_, l, nullptr); l = VK_NULL_HANDLE; } };

    destroy_pipeline(preprocess_pipeline_);
    destroy_pipeline(sort_pipeline_);
    destroy_pipeline(render_pipeline_);
    destroy_pipeline(radix_histogram_pipeline_);
    destroy_pipeline(radix_scan_pipeline_);
    destroy_pipeline(radix_scatter_pipeline_);

    destroy_layout(preprocess_pipeline_layout_);
    destroy_layout(sort_pipeline_layout_);
    destroy_layout(render_pipeline_layout_);
    destroy_layout(radix_histogram_pipeline_layout_);
    destroy_layout(radix_scan_pipeline_layout_);
    destroy_layout(radix_scatter_pipeline_layout_);

    destroy_set_layout(preprocess_layout_);
    destroy_set_layout(sort_layout_);
    destroy_set_layout(render_layout_);
    destroy_set_layout(radix_histogram_layout_);
    destroy_set_layout(radix_scan_layout_);
    destroy_set_layout(radix_scatter_layout_);

    if (gs_pool_) vkDestroyDescriptorPool(device_, gs_pool_, nullptr);

    initialized_ = false;
}

}  // namespace gseurat
