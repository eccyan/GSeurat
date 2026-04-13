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
    glm::vec4 color_pad;      // rgb = color, w = emission intensity
};  // 64 bytes, aligned

// Projected 2D splat (output of preprocess, input to render)
struct ProjectedSplat {
    glm::vec2 center;         // screen-space center
    float depth;              // view-space depth for sorting
    float radius;             // bounding circle radius in pixels
    glm::vec4 conic_opacity;  // conic matrix (a, b, c) + opacity
    glm::vec4 color;          // rgb + alpha
};  // 48 bytes

inline constexpr uint32_t kMaxGsPointLights = 8;

// Uniform data for compute shaders
// NOTE: point light arrays are flat (all positions, then all colors) to match
// the GLSL std140 layout in gs_render.comp / gs_preprocess.comp.
struct GsUniforms {
    glm::mat4 view;
    glm::mat4 proj;
    glm::mat4 inv_view;      // precomputed inverse(view) — avoids per-pixel inverse() in shader
    glm::mat4 inv_proj;      // precomputed inverse(proj)
    glm::uvec4 params;       // x = width, y = height, z = gaussian_count, w = sort_size
    glm::vec4 shadow_box;    // x = margin, y = cone_cos, z = num_sort_passes, w = scale_multiplier
    glm::vec4 cone_dir;      // xyz = cone direction, w = unused
    glm::vec4 cam_pos;       // xyz = camera position, w = unused
    glm::vec4 effect_flags;  // x = toon_bands, y = light_mode, z = touch_active, w = time
    glm::vec4 light_params;  // xyz = light_dir, w = intensity
    glm::vec4 touch_point;   // xyz = world_pos, w = radius
    glm::vec4 effect_params; // x = water_y, y = fire_y_min, z = fire_y_max, w = strength
    glm::vec4 effect_params2; // x = pulse_t, y = xray_depth, z = swirl_t, w = burn_t
    glm::vec4 point_light_params; // x = count, yzw = unused
    glm::vec4 actor_rotation; // xyzw = quaternion for root motion world rotation
    glm::vec4 pl_pos_rad[kMaxGsPointLights];   // per-light: xy = world XZ, z = height (Y), w = radius
    glm::vec4 pl_color[kMaxGsPointLights];      // per-light: rgb = color, a = intensity
    glm::vec4 pl_dir_cone[kMaxGsPointLights];   // per-light: xyz = direction, w = cos(cone_half_angle)
    glm::vec4 pl_area[kMaxGsPointLights];       // per-light: xy = area size (0=point), zw = normal XZ
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

void GsRenderer::init(VkDevice device, VkPhysicalDevice physical_device,
                      VmaAllocator allocator, VkDescriptorPool pool) {
    device_ = device;
    allocator_ = allocator;
    pool_ = pool;

    create_output_image(320, 240);
    create_descriptor_resources();
    create_compute_pipelines();

    // Create timestamp query pool for GPU profiling (2 queries: before/after rasterize)
    {
        VkQueryPoolCreateInfo qp_info{};
        qp_info.sType = VK_STRUCTURE_TYPE_QUERY_POOL_CREATE_INFO;
        qp_info.queryType = VK_QUERY_TYPE_TIMESTAMP;
        qp_info.queryCount = 2;
        vkCreateQueryPool(device_, &qp_info, nullptr, &timestamp_pool_);

        VkPhysicalDeviceProperties props;
        vkGetPhysicalDeviceProperties(physical_device, &props);
        timestamp_period_ns_ = props.limits.timestampPeriod;
        std::printf("[gs_renderer] Timestamp period: %.2f ns (query pool created)\n",
                    timestamp_period_ns_);
    }

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
    image_info.usage = VK_IMAGE_USAGE_STORAGE_BIT | VK_IMAGE_USAGE_SAMPLED_BIT | VK_IMAGE_USAGE_TRANSFER_DST_BIT;

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

    // Depth storage image (R16F, per-pixel view-space depth)
    {
        VkImageCreateInfo depth_info{};
        depth_info.sType = VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO;
        depth_info.imageType = VK_IMAGE_TYPE_2D;
        depth_info.format = VK_FORMAT_R16_SFLOAT;
        depth_info.extent = {width, height, 1};
        depth_info.mipLevels = 1;
        depth_info.arrayLayers = 1;
        depth_info.samples = VK_SAMPLE_COUNT_1_BIT;
        depth_info.tiling = VK_IMAGE_TILING_OPTIMAL;
        depth_info.usage = VK_IMAGE_USAGE_STORAGE_BIT | VK_IMAGE_USAGE_TRANSFER_DST_BIT;

        VmaAllocationCreateInfo depth_alloc{};
        depth_alloc.usage = VMA_MEMORY_USAGE_GPU_ONLY;

        if (vmaCreateImage(allocator_, &depth_info, &depth_alloc,
                           &depth_image_, &depth_allocation_, nullptr) != VK_SUCCESS) {
            throw std::runtime_error("Failed to create GS depth image");
        }

        VkImageViewCreateInfo dv_info{};
        dv_info.sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO;
        dv_info.image = depth_image_;
        dv_info.viewType = VK_IMAGE_VIEW_TYPE_2D;
        dv_info.format = VK_FORMAT_R16_SFLOAT;
        dv_info.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};

        if (vkCreateImageView(device_, &dv_info, nullptr, &depth_view_) != VK_SUCCESS) {
            throw std::runtime_error("Failed to create GS depth image view");
        }
    }

    // Post-processed output image (RGBA16F, same dimensions)
    {
        VkImageCreateInfo proc_info{};
        proc_info.sType = VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO;
        proc_info.imageType = VK_IMAGE_TYPE_2D;
        proc_info.format = VK_FORMAT_R16G16B16A16_SFLOAT;
        proc_info.extent = {width, height, 1};
        proc_info.mipLevels = 1;
        proc_info.arrayLayers = 1;
        proc_info.samples = VK_SAMPLE_COUNT_1_BIT;
        proc_info.tiling = VK_IMAGE_TILING_OPTIMAL;
        proc_info.usage = VK_IMAGE_USAGE_STORAGE_BIT | VK_IMAGE_USAGE_SAMPLED_BIT;

        VmaAllocationCreateInfo proc_alloc{};
        proc_alloc.usage = VMA_MEMORY_USAGE_GPU_ONLY;

        if (vmaCreateImage(allocator_, &proc_info, &proc_alloc,
                           &processed_image_, &processed_allocation_, nullptr) != VK_SUCCESS) {
            throw std::runtime_error("Failed to create GS processed image");
        }

        VkImageViewCreateInfo pv_info{};
        pv_info.sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO;
        pv_info.image = processed_image_;
        pv_info.viewType = VK_IMAGE_VIEW_TYPE_2D;
        pv_info.format = VK_FORMAT_R16G16B16A16_SFLOAT;
        pv_info.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};

        if (vkCreateImageView(device_, &pv_info, nullptr, &processed_view_) != VK_SUCCESS) {
            throw std::runtime_error("Failed to create GS processed image view");
        }
    }

    // Post-process UBO buffer (80 bytes)
    if (!pp_ubo_buffer_.buffer()) {
        pp_ubo_buffer_ = Buffer::create_uniform(allocator_, sizeof(GsPostProcessUbo));
    }
}

void GsRenderer::create_descriptor_resources() {
    // Descriptor pool — enough for all sets (including post-process + static/dynamic split)
    VkDescriptorPoolSize pool_sizes[] = {
        {VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 256},   // many more for split buffers
        {VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 24},
        {VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 32},
    };

    VkDescriptorPoolCreateInfo pool_info{};
    pool_info.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    pool_info.maxSets = 128;  // expanded for static/dynamic/merge sets
    pool_info.poolSizeCount = 3;
    pool_info.pPoolSizes = pool_sizes;

    if (vkCreateDescriptorPool(device_, &pool_info, nullptr, &gs_pool_) != VK_SUCCESS) {
        throw std::runtime_error("Failed to create GS descriptor pool");
    }

    // Preprocess layout: { gaussians, projected, sort_keys, uniforms, visible_count, bones, pbd_states }
    {
        VkDescriptorSetLayoutBinding bindings[] = {
            {0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {3, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {5, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {6, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},  // PBD
            {8, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},  // Page table
        };
        VkDescriptorSetLayoutCreateInfo ci{};
        ci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        ci.bindingCount = 8;
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

    // Render layout: { projected, sort_keys, uniforms, output_image, visible_count, depth_image }
    {
        VkDescriptorSetLayoutBinding bindings[] = {
            {0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {2, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {3, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {5, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},  // depth
        };
        VkDescriptorSetLayoutCreateInfo ci{};
        ci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        ci.bindingCount = 6;
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

    // Post-process layout: { input_image(readonly), depth_image(readonly), output_image(writeonly), ubo }
    {
        VkDescriptorSetLayoutBinding bindings[] = {
            {0, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},   // input
            {1, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},   // depth
            {2, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},   // output
            {3, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},  // UBO
        };
        VkDescriptorSetLayoutCreateInfo ci{};
        ci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        ci.bindingCount = 4;
        ci.pBindings = bindings;
        vkCreateDescriptorSetLayout(device_, &ci, nullptr, &post_process_layout_);
    }

    // Merge layout: { static_sort(0), dynamic_sort(1), merged_sort(2), counts(3) }
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
        vkCreateDescriptorSetLayout(device_, &ci, nullptr, &merge_layout_);
    }

    // PBD solver layout: { pbd_states (rw), pbd_params (ro), pbd_constraints (ro), pbd_uniforms }
    {
        VkDescriptorSetLayoutBinding bindings[] = {
            {0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {3, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        };
        VkDescriptorSetLayoutCreateInfo ci{};
        ci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        ci.bindingCount = 4;
        ci.pBindings = bindings;
        vkCreateDescriptorSetLayout(device_, &ci, nullptr, &pbd_layout_);
    }

    // Allocate all descriptor sets
    // Reset pool to free previously allocated sets before reallocating
    vkResetDescriptorPool(device_, gs_pool_, 0);

    VkDescriptorSetLayout layouts[] = {
        preprocess_layout_, sort_layout_, render_layout_,
        radix_histogram_layout_, radix_histogram_layout_,  // A and B (legacy)
        radix_scan_layout_,
        radix_scatter_layout_, radix_scatter_layout_,      // AB and BA (legacy)
        post_process_layout_,
        // Static/dynamic split sets
        preprocess_layout_, preprocess_layout_,            // static + dynamic preprocess
        radix_histogram_layout_, radix_histogram_layout_,  // static hist A/B
        radix_scan_layout_,                                // static scan
        radix_scatter_layout_, radix_scatter_layout_,      // static scatter AB/BA
        radix_histogram_layout_, radix_histogram_layout_,  // dynamic hist A/B
        radix_scan_layout_,                                // dynamic scan
        radix_scatter_layout_, radix_scatter_layout_,      // dynamic scatter AB/BA
        merge_layout_,                                     // merge
        render_layout_,                                    // new render with merged sort
        pbd_layout_,                                       // PBD solver
    };
    constexpr uint32_t kSetCount = 24;
    VkDescriptorSet sets[kSetCount];
    VkDescriptorSetAllocateInfo alloc_info{};
    alloc_info.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
    alloc_info.descriptorPool = gs_pool_;
    alloc_info.descriptorSetCount = kSetCount;
    alloc_info.pSetLayouts = layouts;
    vkAllocateDescriptorSets(device_, &alloc_info, sets);

    // Legacy sets (indices 0-8)
    preprocess_set_ = sets[0];
    sort_set_ = sets[1];
    render_set_ = sets[2];
    radix_histogram_set_a_ = sets[3];
    radix_histogram_set_b_ = sets[4];
    radix_scan_set_ = sets[5];
    radix_scatter_set_ab_ = sets[6];
    radix_scatter_set_ba_ = sets[7];
    post_process_set_ = sets[8];

    // Static/dynamic split sets (indices 9+)
    static_preprocess_set_ = sets[9];
    dynamic_preprocess_set_ = sets[10];
    static_histogram_set_a_ = sets[11];
    static_histogram_set_b_ = sets[12];
    static_scan_set_ = sets[13];
    static_scatter_set_ab_ = sets[14];
    static_scatter_set_ba_ = sets[15];
    dynamic_histogram_set_a_ = sets[16];
    dynamic_histogram_set_b_ = sets[17];
    dynamic_scan_set_ = sets[18];
    dynamic_scatter_set_ab_ = sets[19];
    dynamic_scatter_set_ba_ = sets[20];
    merge_set_ = sets[21];
    // sets[22] is the merged render set (render_layout_)
    pbd_set_ = sets[23];
    // Re-use render_set_ for merged rendering (set 2 already has correct layout)
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

    create_pipeline("shaders/gs_preprocess.comp.spv", preprocess_layout_,
                    static_cast<uint32_t>(sizeof(GsPreprocessPush)),
                    preprocess_pipeline_layout_, preprocess_pipeline_);
    create_pipeline("shaders/gs_sort.comp.spv", sort_layout_, 8,
                    sort_pipeline_layout_, sort_pipeline_);
    create_pipeline("shaders/gs_render.comp.spv", render_layout_, 0,
                    render_pipeline_layout_, render_pipeline_);

    // Post-process pipeline (no push constants — dimensions in UBO)
    create_pipeline("shaders/gs_post_process.comp.spv", post_process_layout_, 0,
                    post_process_pipeline_layout_, post_process_pipeline_);

    // PBD solver pipeline (push constant = pbd_count)
    create_pipeline("shaders/pbd_solver.comp.spv", pbd_layout_,
                    static_cast<uint32_t>(sizeof(uint32_t)),
                    pbd_pipeline_layout_, pbd_pipeline_);

    // Merge pipeline (no push constants)
    create_pipeline("shaders/gs_merge.comp.spv", merge_layout_, 0,
                    merge_pipeline_layout_, merge_pipeline_);

    // Radix sort pipelines
    create_pipeline("shaders/gs_radix_histogram.comp.spv", radix_histogram_layout_, 8,
                    radix_histogram_pipeline_layout_, radix_histogram_pipeline_);
    create_pipeline("shaders/gs_radix_scan.comp.spv", radix_scan_layout_, 4,
                    radix_scan_pipeline_layout_, radix_scan_pipeline_);
    create_pipeline("shaders/gs_radix_scatter.comp.spv", radix_scatter_layout_, 8,
                    radix_scatter_pipeline_layout_, radix_scatter_pipeline_);
}

void GsRenderer::init_streaming(const StreamingConfig& config) {
    streaming_config_ = config;
    slab_allocator_ = std::make_unique<SlabAllocator>(config.total_slabs(), config.slab_size_splats);

    // Wait for GPU before destroying existing buffers
    if (initialized_) {
        vkDeviceWaitIdle(device_);
    }

    sort_done_once_ = false;
    static_dirty_ = true;

    // Pre-allocate ALL buffers to full budget size
    max_static_count_ = config.gpu_budget_splats;
    max_dynamic_count_ = kDynamicHeadroom;
    static_count_ = 0;
    dynamic_count_ = 0;
    gaussian_count_ = 0;
    max_gaussian_count_ = max_static_count_ + max_dynamic_count_;

    // Compute sort params
    auto compute_sort_params = [](uint32_t max_count, uint32_t& sort_size, uint32_t& num_wg) {
        sort_size = ((max_count + 1023) / 1024) * 1024;
        if (sort_size < max_count) sort_size = max_count;
        num_wg = sort_size / 1024;
        if (num_wg == 0) num_wg = 1;
        sort_size = num_wg * 1024;
    };

    compute_sort_params(max_static_count_, static_sort_size_, static_sort_workgroups_);
    compute_sort_params(max_dynamic_count_, dynamic_sort_size_, dynamic_sort_workgroups_);
    sort_size_ = static_sort_size_;
    num_sort_workgroups_ = static_sort_workgroups_;

    // Buffer sizes
    VkDeviceSize static_gauss_size = static_cast<VkDeviceSize>(max_static_count_) * sizeof(GpuGaussian);
    VkDeviceSize dynamic_gauss_size = static_cast<VkDeviceSize>(max_dynamic_count_) * sizeof(GpuGaussian);
    VkDeviceSize projected_buf_size = static_cast<VkDeviceSize>(max_static_count_ + max_dynamic_count_) * sizeof(ProjectedSplat);
    VkDeviceSize static_sort_buf_size = static_cast<VkDeviceSize>(static_sort_size_) * sizeof(SortEntry);
    VkDeviceSize dynamic_sort_buf_size = static_cast<VkDeviceSize>(dynamic_sort_size_) * sizeof(SortEntry);
    VkDeviceSize merged_sort_buf_size = static_cast<VkDeviceSize>(max_static_count_ + max_dynamic_count_) * sizeof(SortEntry);
    VkDeviceSize static_hist_size = static_cast<VkDeviceSize>(256) * static_sort_workgroups_ * sizeof(uint32_t);
    VkDeviceSize dynamic_hist_size = static_cast<VkDeviceSize>(256) * dynamic_sort_workgroups_ * sizeof(uint32_t);

    // Destroy ALL old buffers (legacy + split)
    gaussian_ssbo_.destroy(allocator_);
    projected_ssbo_.destroy(allocator_);
    sort_keys_ssbo_.destroy(allocator_);
    sort_b_ssbo_.destroy(allocator_);
    histogram_ssbo_.destroy(allocator_);
    uniform_buffer_.destroy(allocator_);
    visible_count_ssbo_.destroy(allocator_);
    bone_ssbo_.destroy(allocator_);
    pbd_state_ssbo_.destroy(allocator_);
    pbd_params_ssbo_.destroy(allocator_);
    pbd_constraint_ssbo_.destroy(allocator_);
    pbd_uniform_buffer_.destroy(allocator_);
    static_gaussian_ssbo_.destroy(allocator_);
    dynamic_gaussian_ssbo_.destroy(allocator_);
    static_sort_a_.destroy(allocator_);
    static_sort_b_.destroy(allocator_);
    dynamic_sort_a_.destroy(allocator_);
    dynamic_sort_b_.destroy(allocator_);
    static_histogram_ssbo_.destroy(allocator_);
    dynamic_histogram_ssbo_.destroy(allocator_);
    merged_sort_ssbo_.destroy(allocator_);
    counts_ssbo_.destroy(allocator_);
    page_table_ssbo_.destroy(allocator_);
    chunk_table_ssbo_.destroy(allocator_);
    pp_ubo_buffer_.destroy(allocator_);

    // Create split buffers at full budget size
    static_gaussian_ssbo_ = Buffer::create_storage(allocator_, static_gauss_size);
    dynamic_gaussian_ssbo_ = Buffer::create_storage(allocator_, dynamic_gauss_size);
    projected_ssbo_ = Buffer::create_storage(allocator_, projected_buf_size);
    static_sort_a_ = Buffer::create_storage(allocator_, static_sort_buf_size);
    static_sort_b_ = Buffer::create_storage(allocator_, static_sort_buf_size);
    dynamic_sort_a_ = Buffer::create_storage(allocator_, dynamic_sort_buf_size);
    dynamic_sort_b_ = Buffer::create_storage(allocator_, dynamic_sort_buf_size);
    static_histogram_ssbo_ = Buffer::create_storage(allocator_, static_hist_size);
    dynamic_histogram_ssbo_ = Buffer::create_storage(allocator_, dynamic_hist_size);
    merged_sort_ssbo_ = Buffer::create_storage(allocator_, merged_sort_buf_size);
    counts_ssbo_ = Buffer::create_storage_readback(allocator_, 3 * sizeof(uint32_t));
    uniform_buffer_ = Buffer::create_uniform(allocator_, sizeof(GsUniforms));
    visible_count_ssbo_ = Buffer::create_storage_readback(allocator_, sizeof(uint32_t));

    // Legacy buffers (same sizes as static counterparts for backward compat)
    gaussian_ssbo_ = Buffer::create_storage(allocator_,
        static_cast<VkDeviceSize>(max_gaussian_count_) * sizeof(GpuGaussian));
    sort_keys_ssbo_ = Buffer::create_storage(allocator_, static_sort_buf_size);
    sort_b_ssbo_ = Buffer::create_storage(allocator_, static_sort_buf_size);
    histogram_ssbo_ = Buffer::create_storage(allocator_, static_hist_size);

    // Bone transform SSBO
    bone_ssbo_ = Buffer::create_storage(allocator_, kMaxBones * sizeof(glm::mat4));
    bone_count_ = 0;
    {
        auto* bones = static_cast<glm::mat4*>(bone_ssbo_.mapped());
        for (uint32_t i = 0; i < kMaxBones; ++i) bones[i] = glm::mat4(1.0f);
    }

    // PBD buffers
    pbd_state_ssbo_ = Buffer::create_storage(allocator_,
        kMaxPbdElements * sizeof(PbdPhysicsState));
    pbd_params_ssbo_ = Buffer::create_storage(allocator_,
        kMaxPbdElements * sizeof(PbdElementParams));
    pbd_constraint_ssbo_ = Buffer::create_storage(allocator_,
        kMaxPbdConstraints * sizeof(PbdConstraint));
    pbd_count_ = 0;
    pbd_constraint_count_ = 0;
    {
        auto* states = static_cast<PbdPhysicsState*>(pbd_state_ssbo_.mapped());
        for (uint32_t i = 0; i < kMaxPbdElements; ++i) {
            states[i].position = glm::vec4(0.0f, 0.0f, 0.0f, 0.0f);
            states[i].prev_position = glm::vec4(0.0f, 0.0f, 0.0f, 1.0f);
            states[i].velocity = glm::vec4(0.0f);
            states[i].params = glm::vec4(0.0f);
        }
        std::memset(pbd_params_ssbo_.mapped(), 0,
                    kMaxPbdElements * sizeof(PbdElementParams));
        std::memset(pbd_constraint_ssbo_.mapped(), 0,
                    kMaxPbdConstraints * sizeof(PbdConstraint));
    }
    pbd_uniform_buffer_ = Buffer::create_uniform(allocator_, 32);
    pp_ubo_buffer_ = Buffer::create_uniform(allocator_, sizeof(GsPostProcessUbo));

    // Page table: one uint32 per slab, initialized to 0xFFFFFFFF (invalid)
    page_table_ssbo_ = Buffer::create_storage(allocator_,
        static_cast<VkDeviceSize>(config.total_slabs()) * sizeof(uint32_t));
    std::memset(page_table_ssbo_.mapped(), 0xFF,
                config.total_slabs() * sizeof(uint32_t));

    // Chunk table: 256 entries x 16 bytes each, zeroed
    chunk_table_ssbo_ = Buffer::create_storage(allocator_, 256 * 16);
    std::memset(chunk_table_ssbo_.mapped(), 0, 256 * 16);

    // Zero the counts buffer
    {
        auto* counts = static_cast<uint32_t*>(counts_ssbo_.mapped());
        counts[0] = 0;
        counts[1] = 0;
        counts[2] = 0;
    }

    active_chunks_.clear();
    total_active_splats_ = 0;
    streaming_initialized_ = true;
    initialized_ = true;

    update_descriptors();

    std::fprintf(stderr, "GS: Streaming initialized — budget=%u splats, %u slabs of %u\n",
                 config.gpu_budget_splats, config.total_slabs(), config.slab_size_splats);
}

void GsRenderer::load_cloud(const GaussianCloud& cloud) {
    if (!streaming_initialized_) {
        load_cloud_legacy(cloud);
        return;
    }

    if (cloud.empty()) return;

    // Wait for GPU before writing to buffers
    if (initialized_) {
        vkDeviceWaitIdle(device_);
    }

    sort_done_once_ = false;
    static_dirty_ = true;

    uint32_t sps = streaming_config_.slab_size_splats;
    uint32_t slabs_needed = (cloud.count() + sps - 1) / sps;
    auto handle = slab_allocator_->checkout(slabs_needed);

    // Calculate page table offset from existing chunks
    uint32_t page_table_offset = 0;
    for (const auto& chunk : active_chunks_) {
        page_table_offset += static_cast<uint32_t>(chunk.handle.slab_indices.size());
    }

    // Write page table entries
    auto* pt = static_cast<uint32_t*>(page_table_ssbo_.mapped());
    for (uint32_t i = 0; i < slabs_needed; ++i) {
        pt[page_table_offset + i] = handle.slab_indices[i];
    }

    // Write Gaussian data into physical slab locations
    {
        auto* gpu = static_cast<GpuGaussian*>(static_gaussian_ssbo_.mapped());
        for (uint32_t slab_idx = 0; slab_idx < slabs_needed; ++slab_idx) {
            uint32_t phys_slab = handle.slab_indices[slab_idx];
            uint32_t base_src = slab_idx * sps;
            uint32_t base_dst = phys_slab * sps;
            uint32_t count_in_slab = std::min(sps, cloud.count() - base_src);

            std::vector<GpuGaussian> staging(count_in_slab);
            for (uint32_t i = 0; i < count_in_slab; ++i) {
                const auto& g = cloud.gaussians()[base_src + i];
                float bone_as_float;
                uint32_t bone_idx = g.bone_index;
                std::memcpy(&bone_as_float, &bone_idx, sizeof(float));
                staging[i].pos_opacity = glm::vec4(g.position, g.opacity);
                staging[i].scale_pad = glm::vec4(g.scale, bone_as_float);
                staging[i].rot = glm::vec4(g.rotation.x, g.rotation.y, g.rotation.z, g.rotation.w);
                staging[i].color_pad = glm::vec4(g.color, g.emission);
            }
            std::memcpy(gpu + base_dst, staging.data(), count_in_slab * sizeof(GpuGaussian));
        }
    }

    // Write chunk table entry
    {
        auto* ct = static_cast<uint8_t*>(chunk_table_ssbo_.mapped());
        uint32_t chunk_idx = static_cast<uint32_t>(active_chunks_.size());
        uint32_t last_slab_splats = cloud.count() - (slabs_needed - 1) * sps;
        uint32_t entry[4] = {page_table_offset, slabs_needed, last_slab_splats, cloud.count()};
        std::memcpy(ct + chunk_idx * 16, entry, 16);
    }

    // Record chunk state
    ChunkState cs;
    cs.status = ChunkState::Status::ACTIVE;
    cs.handle = std::move(handle);
    cs.page_table_offset = page_table_offset;
    cs.splat_count = cloud.count();
    active_chunks_.push_back(std::move(cs));

    // Recalculate total static count
    static_count_ = 0;
    for (const auto& chunk : active_chunks_) {
        static_count_ += chunk.splat_count;
    }
    total_active_splats_ = static_count_;
    gaussian_count_ = static_count_;

    // Initialize sort buffers with sentinel keys
    auto init_sort_buf = [](Buffer& buf, uint32_t sort_size, uint32_t valid_count) {
        std::vector<SortEntry> staging(sort_size);
        for (uint32_t i = 0; i < sort_size; ++i) {
            staging[i].key = 0xFFFFFFFF;
            staging[i].index = i < valid_count ? i : 0;
        }
        std::memcpy(buf.mapped(), staging.data(), sort_size * sizeof(SortEntry));
    };
    init_sort_buf(static_sort_a_, static_sort_size_, static_count_);
    init_sort_buf(static_sort_b_, static_sort_size_, static_count_);

    static_dirty_ = true;

    std::fprintf(stderr, "GS: Loaded chunk %u — %u splats in %u slabs (total active: %u)\n",
                 active_chunks_.back().handle.chunk_id, cloud.count(), slabs_needed, static_count_);
}

void GsRenderer::unload_cloud(uint32_t chunk_id) {
    if (!streaming_initialized_) return;
    auto it = std::find_if(active_chunks_.begin(), active_chunks_.end(),
        [chunk_id](const ChunkState& c) { return c.handle.chunk_id == chunk_id; });
    if (it == active_chunks_.end()) return;

    // Invalidate page table entries
    auto* pt = static_cast<uint32_t*>(page_table_ssbo_.mapped());
    for (uint32_t i = 0; i < it->handle.slab_indices.size(); ++i) {
        pt[it->page_table_offset + i] = 0xFFFFFFFF;
    }
    slab_allocator_->release(it->handle);
    active_chunks_.erase(it);

    // Rebuild chunk table and recalculate counts
    auto* ct = static_cast<uint8_t*>(chunk_table_ssbo_.mapped());
    uint32_t sps = streaming_config_.slab_size_splats;
    static_count_ = 0;
    for (size_t i = 0; i < active_chunks_.size(); ++i) {
        auto& c = active_chunks_[i];
        uint32_t nslabs = static_cast<uint32_t>(c.handle.slab_indices.size());
        uint32_t last_slab_splats = c.splat_count - (nslabs - 1) * sps;
        uint32_t entry[4] = {c.page_table_offset, nslabs, last_slab_splats, c.splat_count};
        std::memcpy(ct + i * 16, entry, 16);
        static_count_ += c.splat_count;
    }
    std::memset(ct + active_chunks_.size() * 16, 0, (256 - active_chunks_.size()) * 16);
    total_active_splats_ = static_count_;
    gaussian_count_ = static_count_;
    static_dirty_ = true;
}

void GsRenderer::create_transfer_queue(VkQueue transfer_q, uint32_t transfer_family,
                                        bool dedicated, VkQueue graphics_q) {
    if (!streaming_initialized_) return;
    const uint64_t staging_size = streaming_config_.slab_bytes() * 2;  // double-buffered
    transfer_queue_ = std::make_unique<TransferQueue>(
        device_, allocator_,
        transfer_q, transfer_family,
        dedicated, staging_size,
        streaming_config_.transfer_budget_mb_per_frame,
        static_gaussian_ssbo_.buffer());
}

void GsRenderer::load_cloud_async(const std::string& ply_path) {
    if (!streaming_initialized_ || !transfer_queue_) {
        // Fall back to synchronous load
        GaussianCloud cloud;
        cloud.load_ply(ply_path);
        load_cloud(cloud);
        return;
    }

    pending_loads_++;

    load_threads_.emplace_back([this, ply_path]() {
        GaussianCloud cloud;
        cloud.load_ply(ply_path);

        const uint32_t splat_count = cloud.count();
        const uint32_t sps = streaming_config_.slab_size_splats;
        const uint32_t slabs_needed = (splat_count + sps - 1) / sps;

        auto handle = slab_allocator_->checkout(slabs_needed);

        const auto& gaussians = cloud.gaussians();
        auto* staging = static_cast<uint8_t*>(transfer_queue_->staging_mapped());
        const uint64_t slab_bytes = static_cast<uint64_t>(sps) * sizeof(GpuGaussian);

        for (uint32_t s = 0; s < slabs_needed; ++s) {
            const uint32_t physical_slab = handle.slab_indices[s];
            const uint32_t src_start = s * sps;
            const uint32_t src_end = std::min(src_start + sps, splat_count);
            const uint32_t count = src_end - src_start;

            // Write into staging buffer (ring: alternate halves)
            const uint64_t staging_offset = (s % 2) * slab_bytes;
            auto* dst = reinterpret_cast<GpuGaussian*>(staging + staging_offset);
            for (uint32_t i = 0; i < count; ++i) {
                const auto& g = gaussians[src_start + i];
                float bone_as_float;
                uint32_t bone_idx = g.bone_index;
                std::memcpy(&bone_as_float, &bone_idx, sizeof(float));
                dst[i].pos_opacity = glm::vec4(g.position, g.opacity);
                dst[i].scale_pad = glm::vec4(g.scale, bone_as_float);
                dst[i].rot = glm::vec4(g.rotation.x, g.rotation.y, g.rotation.z, g.rotation.w);
                dst[i].color_pad = glm::vec4(g.color, g.emission);
            }

            const uint64_t dest_offset = static_cast<uint64_t>(physical_slab) * sps * sizeof(GpuGaussian);
            const uint64_t copy_size = static_cast<uint64_t>(count) * sizeof(GpuGaussian);
            transfer_queue_->enqueue(staging_offset, dest_offset, copy_size);
        }

        // Completion callback — runs on main thread via poll_completions
        transfer_queue_->enqueue_completion(
            [this, handle = std::move(handle), splat_count, slabs_needed, sps]() mutable {
                uint32_t page_table_offset = 0;
                for (const auto& chunk : active_chunks_) {
                    page_table_offset += static_cast<uint32_t>(chunk.handle.slab_indices.size());
                }

                auto* pt = static_cast<uint32_t*>(page_table_ssbo_.mapped());
                for (uint32_t i = 0; i < slabs_needed; ++i) {
                    pt[page_table_offset + i] = handle.slab_indices[i];
                }

                // Update chunk table
                auto* ct = static_cast<uint8_t*>(chunk_table_ssbo_.mapped());
                uint32_t chunk_idx = static_cast<uint32_t>(active_chunks_.size());
                uint32_t last_slab_splats = splat_count - (slabs_needed - 1) * sps;
                uint32_t entry[4] = {page_table_offset, slabs_needed, last_slab_splats, splat_count};
                std::memcpy(ct + chunk_idx * 16, entry, 16);

                ChunkState cs;
                cs.status = ChunkState::Status::ACTIVE;
                cs.handle = std::move(handle);
                cs.page_table_offset = page_table_offset;
                cs.splat_count = splat_count;
                active_chunks_.push_back(std::move(cs));

                static_count_ = 0;
                for (const auto& c : active_chunks_) static_count_ += c.splat_count;
                total_active_splats_ = static_count_;
                gaussian_count_ = static_count_;
                static_dirty_ = true;

                pending_loads_--;
                std::printf("[gs_renderer] Async load complete: %u splats\n", splat_count);
            });
    });
}

void GsRenderer::poll_transfers(VkCommandBuffer frame_cmd) {
    if (transfer_queue_) transfer_queue_->poll_completions(frame_cmd);
}

void GsRenderer::load_cloud_legacy(const GaussianCloud& cloud) {
    if (cloud.empty()) return;

    // Wait for GPU before destroying existing buffers
    if (initialized_) {
        vkDeviceWaitIdle(device_);
    }

    sort_done_once_ = false;
    static_dirty_ = true;

    // Static/dynamic counts
    static_count_ = cloud.count();
    max_static_count_ = static_count_ + kParticleHeadroom;
    max_dynamic_count_ = kDynamicHeadroom;
    dynamic_count_ = 0;

    // Backward compat: keep legacy members up to date
    gaussian_count_ = static_count_;
    max_gaussian_count_ = max_static_count_ + max_dynamic_count_;

    // Helper: compute sort size (round up to next multiple of 1024)
    auto compute_sort_params = [](uint32_t max_count, uint32_t& sort_size, uint32_t& num_wg) {
        sort_size = ((max_count + 1023) / 1024) * 1024;
        if (sort_size < max_count) sort_size = max_count;
        num_wg = sort_size / 1024;
        if (num_wg == 0) num_wg = 1;
        sort_size = num_wg * 1024;
    };

    compute_sort_params(max_static_count_, static_sort_size_, static_sort_workgroups_);
    compute_sort_params(max_dynamic_count_, dynamic_sort_size_, dynamic_sort_workgroups_);

    // Legacy sort params (use static for backward compat)
    sort_size_ = static_sort_size_;
    num_sort_workgroups_ = static_sort_workgroups_;

    // Buffer sizes
    VkDeviceSize static_gauss_size = static_cast<VkDeviceSize>(max_static_count_) * sizeof(GpuGaussian);
    VkDeviceSize dynamic_gauss_size = static_cast<VkDeviceSize>(max_dynamic_count_) * sizeof(GpuGaussian);
    VkDeviceSize projected_buf_size = static_cast<VkDeviceSize>(max_static_count_ + max_dynamic_count_) * sizeof(ProjectedSplat);
    VkDeviceSize static_sort_buf_size = static_cast<VkDeviceSize>(static_sort_size_) * sizeof(SortEntry);
    VkDeviceSize dynamic_sort_buf_size = static_cast<VkDeviceSize>(dynamic_sort_size_) * sizeof(SortEntry);
    VkDeviceSize merged_sort_buf_size = static_cast<VkDeviceSize>(max_static_count_ + max_dynamic_count_) * sizeof(SortEntry);
    VkDeviceSize static_hist_size = static_cast<VkDeviceSize>(256) * static_sort_workgroups_ * sizeof(uint32_t);
    VkDeviceSize dynamic_hist_size = static_cast<VkDeviceSize>(256) * dynamic_sort_workgroups_ * sizeof(uint32_t);

    // Destroy ALL old buffers (legacy + split)
    gaussian_ssbo_.destroy(allocator_);
    projected_ssbo_.destroy(allocator_);
    sort_keys_ssbo_.destroy(allocator_);
    sort_b_ssbo_.destroy(allocator_);
    histogram_ssbo_.destroy(allocator_);
    uniform_buffer_.destroy(allocator_);
    visible_count_ssbo_.destroy(allocator_);
    bone_ssbo_.destroy(allocator_);
    pbd_state_ssbo_.destroy(allocator_);
    pbd_params_ssbo_.destroy(allocator_);
    pbd_constraint_ssbo_.destroy(allocator_);
    pbd_uniform_buffer_.destroy(allocator_);
    static_gaussian_ssbo_.destroy(allocator_);
    dynamic_gaussian_ssbo_.destroy(allocator_);
    static_sort_a_.destroy(allocator_);
    static_sort_b_.destroy(allocator_);
    dynamic_sort_a_.destroy(allocator_);
    dynamic_sort_b_.destroy(allocator_);
    static_histogram_ssbo_.destroy(allocator_);
    dynamic_histogram_ssbo_.destroy(allocator_);
    merged_sort_ssbo_.destroy(allocator_);
    counts_ssbo_.destroy(allocator_);

    // Create split buffers
    static_gaussian_ssbo_ = Buffer::create_storage(allocator_, static_gauss_size);
    dynamic_gaussian_ssbo_ = Buffer::create_storage(allocator_, dynamic_gauss_size);
    projected_ssbo_ = Buffer::create_storage(allocator_, projected_buf_size);
    static_sort_a_ = Buffer::create_storage(allocator_, static_sort_buf_size);
    static_sort_b_ = Buffer::create_storage(allocator_, static_sort_buf_size);
    dynamic_sort_a_ = Buffer::create_storage(allocator_, dynamic_sort_buf_size);
    dynamic_sort_b_ = Buffer::create_storage(allocator_, dynamic_sort_buf_size);
    static_histogram_ssbo_ = Buffer::create_storage(allocator_, static_hist_size);
    dynamic_histogram_ssbo_ = Buffer::create_storage(allocator_, dynamic_hist_size);
    merged_sort_ssbo_ = Buffer::create_storage(allocator_, merged_sort_buf_size);
    counts_ssbo_ = Buffer::create_storage_readback(allocator_, 3 * sizeof(uint32_t));  // {static_visible, dynamic_visible, merged_visible}
    uniform_buffer_ = Buffer::create_uniform(allocator_, sizeof(GsUniforms));
    visible_count_ssbo_ = Buffer::create_storage_readback(allocator_, sizeof(uint32_t));

    // Legacy gaussian_ssbo_ aliases static for backward compat
    // (update_active_gaussians / update_gaussian_data write to gaussian_ssbo_)
    // We create a separate legacy buffer that's just max_gaussian_count_ in size
    gaussian_ssbo_ = Buffer::create_storage(allocator_,
        static_cast<VkDeviceSize>(max_gaussian_count_) * sizeof(GpuGaussian));
    sort_keys_ssbo_ = Buffer::create_storage(allocator_, static_sort_buf_size);
    sort_b_ssbo_ = Buffer::create_storage(allocator_, static_sort_buf_size);
    histogram_ssbo_ = Buffer::create_storage(allocator_, static_hist_size);

    // Bone transform SSBO (always allocated, zeroed if unused)
    bone_ssbo_ = Buffer::create_storage(allocator_, kMaxBones * sizeof(glm::mat4));
    bone_count_ = 0;
    {
        auto* bones = static_cast<glm::mat4*>(bone_ssbo_.mapped());
        for (uint32_t i = 0; i < kMaxBones; ++i) bones[i] = glm::mat4(1.0f);
    }

    // PBD state, params, and constraint SSBOs (always allocated, zeroed if unused)
    pbd_state_ssbo_ = Buffer::create_storage(allocator_,
        kMaxPbdElements * sizeof(PbdPhysicsState));
    pbd_params_ssbo_ = Buffer::create_storage(allocator_,
        kMaxPbdElements * sizeof(PbdElementParams));
    pbd_constraint_ssbo_ = Buffer::create_storage(allocator_,
        kMaxPbdConstraints * sizeof(PbdConstraint));
    pbd_count_ = 0;
    pbd_constraint_count_ = 0;
    // Zero-initialize all PBD buffers
    {
        auto* states = static_cast<PbdPhysicsState*>(pbd_state_ssbo_.mapped());
        for (uint32_t i = 0; i < kMaxPbdElements; ++i) {
            states[i].position = glm::vec4(0.0f, 0.0f, 0.0f, 0.0f);
            states[i].prev_position = glm::vec4(0.0f, 0.0f, 0.0f, 1.0f);  // identity quaternion (preprocess reads as rotation)
            states[i].velocity = glm::vec4(0.0f);
            states[i].params = glm::vec4(0.0f);
        }
        std::memset(pbd_params_ssbo_.mapped(), 0,
                    kMaxPbdElements * sizeof(PbdElementParams));
        std::memset(pbd_constraint_ssbo_.mapped(), 0,
                    kMaxPbdConstraints * sizeof(PbdConstraint));
    }
    pbd_uniform_buffer_ = Buffer::create_uniform(allocator_, 32);

    // Upload Gaussian data to static buffer via staging to avoid -O3 write-reordering
    {
        std::vector<GpuGaussian> staging(static_count_);
        for (uint32_t i = 0; i < static_count_; ++i) {
            const auto& g = cloud.gaussians()[i];
            float bone_as_float;
            uint32_t bone_idx = g.bone_index;
            std::memcpy(&bone_as_float, &bone_idx, sizeof(float));
            staging[i].pos_opacity = glm::vec4(g.position, g.opacity);
            staging[i].scale_pad = glm::vec4(g.scale, bone_as_float);
            staging[i].rot = glm::vec4(g.rotation.x, g.rotation.y, g.rotation.z, g.rotation.w);
            staging[i].color_pad = glm::vec4(g.color, g.emission);
        }
        std::memcpy(static_gaussian_ssbo_.mapped(), staging.data(), static_count_ * sizeof(GpuGaussian));
        // Also mirror to legacy buffer for backward compat
        if (gaussian_ssbo_.mapped() && gaussian_ssbo_.mapped() != static_gaussian_ssbo_.mapped()) {
            std::memcpy(gaussian_ssbo_.mapped(), staging.data(), static_count_ * sizeof(GpuGaussian));
        }
    }

    // Initialize sort buffers with sentinel keys via staging memcpy
    auto init_sort_buf = [](Buffer& buf, uint32_t sort_size, uint32_t valid_count) {
        std::vector<SortEntry> staging(sort_size);
        for (uint32_t i = 0; i < sort_size; ++i) {
            staging[i].key = 0xFFFFFFFF;
            staging[i].index = i < valid_count ? i : 0;
        }
        std::memcpy(buf.mapped(), staging.data(), sort_size * sizeof(SortEntry));
    };
    init_sort_buf(static_sort_a_, static_sort_size_, static_count_);
    init_sort_buf(static_sort_b_, static_sort_size_, static_count_);
    init_sort_buf(dynamic_sort_a_, dynamic_sort_size_, 0);
    init_sort_buf(dynamic_sort_b_, dynamic_sort_size_, 0);

    // Legacy sort buffers
    init_sort_buf(sort_keys_ssbo_, static_sort_size_, static_count_);
    init_sort_buf(sort_b_ssbo_, static_sort_size_, static_count_);

    // Zero the counts buffer {0, 0, 0}
    {
        auto* counts = static_cast<uint32_t*>(counts_ssbo_.mapped());
        counts[0] = 0;
        counts[1] = 0;
        counts[2] = 0;
    }

    // Allocate a dummy page table buffer for binding 8 (legacy path, USE_PAGE_TABLE=0)
    page_table_ssbo_.destroy(allocator_);
    page_table_ssbo_ = Buffer::create_storage(allocator_, sizeof(uint32_t));
    {
        auto* pt = static_cast<uint32_t*>(page_table_ssbo_.mapped());
        pt[0] = 0xFFFFFFFF;
    }

    update_descriptors();
}

void GsRenderer::update_static_gaussians(const Gaussian* data, uint32_t count) {
    if (count == 0 || count > max_static_count_) return;

    static_count_ = count;
    gaussian_count_ = count;  // backward compat
    static_dirty_ = true;
    sort_done_once_ = false;

    // Build GPU data in a local buffer first, then memcpy to mapped memory.
    // This avoids -O3 write-reordering issues with mapped GPU memory.
    std::vector<GpuGaussian> staging(count);
    for (uint32_t i = 0; i < count; ++i) {
        float bone_f;
        uint32_t bi = data[i].bone_index;
        std::memcpy(&bone_f, &bi, sizeof(float));
        staging[i].pos_opacity = glm::vec4(data[i].position, data[i].opacity);
        staging[i].scale_pad = glm::vec4(data[i].scale, bone_f);
        staging[i].rot = glm::vec4(data[i].rotation.x, data[i].rotation.y,
                                    data[i].rotation.z, data[i].rotation.w);
        staging[i].color_pad = glm::vec4(data[i].color, data[i].emission);
    }
    std::memcpy(static_gaussian_ssbo_.mapped(), staging.data(), count * sizeof(GpuGaussian));

    // Reinitialize static sort buffers via memcpy for consistency
    auto init_sort_buf = [](Buffer& buf, uint32_t sort_size, uint32_t valid_count) {
        std::vector<SortEntry> staging_sort(sort_size);
        for (uint32_t i = 0; i < sort_size; ++i) {
            staging_sort[i].key = 0xFFFFFFFF;
            staging_sort[i].index = i < valid_count ? i : 0;
        }
        std::memcpy(buf.mapped(), staging_sort.data(), sort_size * sizeof(SortEntry));
    };
    init_sort_buf(static_sort_a_, static_sort_size_, count);
    init_sort_buf(static_sort_b_, static_sort_size_, count);
}

void GsRenderer::update_dynamic_gaussians(const Gaussian* data, uint32_t count) {
    if (count == 0) {
        dynamic_count_ = 0;
        return;
    }
    if (count > max_dynamic_count_) return;

    dynamic_count_ = count;

    // Build GPU data in local buffer, then memcpy to mapped memory
    std::vector<GpuGaussian> staging(count);
    for (uint32_t i = 0; i < count; ++i) {
        float bone_f;
        uint32_t bi = data[i].bone_index;
        std::memcpy(&bone_f, &bi, sizeof(float));
        staging[i].pos_opacity = glm::vec4(data[i].position, data[i].opacity);
        staging[i].scale_pad = glm::vec4(data[i].scale, bone_f);
        staging[i].rot = glm::vec4(data[i].rotation.x, data[i].rotation.y,
                                    data[i].rotation.z, data[i].rotation.w);
        staging[i].color_pad = glm::vec4(data[i].color, data[i].emission);
    }
    std::memcpy(dynamic_gaussian_ssbo_.mapped(), staging.data(), count * sizeof(GpuGaussian));

    // Reinitialize dynamic sort buffers via memcpy
    auto init_sort_buf = [](Buffer& buf, uint32_t sort_size, uint32_t valid_count) {
        std::vector<SortEntry> staging_sort(sort_size);
        for (uint32_t i = 0; i < sort_size; ++i) {
            staging_sort[i].key = 0xFFFFFFFF;
            staging_sort[i].index = i < valid_count ? i : 0;
        }
        std::memcpy(buf.mapped(), staging_sort.data(), sort_size * sizeof(SortEntry));
    };
    init_sort_buf(dynamic_sort_a_, dynamic_sort_size_, count);
    init_sort_buf(dynamic_sort_b_, dynamic_sort_size_, count);
}

void GsRenderer::ensure_capacity(uint32_t needed_total) {
    // With split architecture, static buffer has kParticleHeadroom and
    // dynamic buffer has kDynamicHeadroom. Warn if over capacity.
    uint32_t total_max = max_static_count_ + max_dynamic_count_;
    if (total_max == 0) total_max = max_gaussian_count_;
    if (needed_total <= total_max) return;

    // Legacy fallback: grow the combined buffer
    uint32_t new_max = needed_total + kParticleHeadroom;

    vkDeviceWaitIdle(device_);

    max_gaussian_count_ = new_max;

    // Recalculate sort sizes
    sort_size_ = ((max_gaussian_count_ + 1023) / 1024) * 1024;
    if (sort_size_ < max_gaussian_count_) sort_size_ = max_gaussian_count_;
    num_sort_workgroups_ = sort_size_ / 1024;
    if (num_sort_workgroups_ == 0) num_sort_workgroups_ = 1;
    sort_size_ = num_sort_workgroups_ * 1024;

    VkDeviceSize gaussian_buf_size = static_cast<VkDeviceSize>(max_gaussian_count_) * sizeof(GpuGaussian);
    VkDeviceSize projected_buf_size = static_cast<VkDeviceSize>(max_gaussian_count_) * sizeof(ProjectedSplat);
    VkDeviceSize sort_buf_size = static_cast<VkDeviceSize>(sort_size_) * sizeof(SortEntry);
    VkDeviceSize histogram_buf_size = static_cast<VkDeviceSize>(256) * num_sort_workgroups_ * sizeof(uint32_t);

    // Reallocate legacy GPU buffers
    gaussian_ssbo_.destroy(allocator_);
    sort_keys_ssbo_.destroy(allocator_);
    sort_b_ssbo_.destroy(allocator_);
    histogram_ssbo_.destroy(allocator_);
    // Only reallocate projected if split buffers aren't managing it
    if (!static_gaussian_ssbo_.buffer()) {
        projected_ssbo_.destroy(allocator_);
        projected_ssbo_ = Buffer::create_storage(allocator_, projected_buf_size);
    }

    gaussian_ssbo_ = Buffer::create_storage(allocator_, gaussian_buf_size);
    sort_keys_ssbo_ = Buffer::create_storage(allocator_, sort_buf_size);
    sort_b_ssbo_ = Buffer::create_storage(allocator_, sort_buf_size);
    histogram_ssbo_ = Buffer::create_storage(allocator_, histogram_buf_size);

    // Reinitialize sort buffers
    auto init_sort_buf = [&](Buffer& buf) {
        auto* sort = static_cast<SortEntry*>(buf.mapped());
        for (uint32_t i = 0; i < sort_size_; ++i) {
            sort[i].key = 0xFFFFFFFF;
            sort[i].index = i < gaussian_count_ ? i : 0;
        }
    };
    init_sort_buf(sort_keys_ssbo_);
    init_sort_buf(sort_b_ssbo_);

    sort_done_once_ = false;
    update_descriptors();

    std::fprintf(stderr, "GS: Grew SSBO capacity to %u (sort_size=%u)\n",
                 max_gaussian_count_, sort_size_);
}

void GsRenderer::update_active_gaussians(const Gaussian* data, uint32_t count) {
    if (count == 0 || count > max_gaussian_count_) return;

    sort_done_once_ = false;
    gaussian_count_ = count;

    // Stage in local buffer, then memcpy to mapped memory (avoids -O3 reordering)
    std::vector<GpuGaussian> staging(count);
    for (uint32_t i = 0; i < count; ++i) {
        float bone_f;
        uint32_t bi = data[i].bone_index;
        std::memcpy(&bone_f, &bi, sizeof(float));
        staging[i].pos_opacity = glm::vec4(data[i].position, data[i].opacity);
        staging[i].scale_pad = glm::vec4(data[i].scale, bone_f);
        staging[i].rot = glm::vec4(data[i].rotation.x, data[i].rotation.y,
                                    data[i].rotation.z, data[i].rotation.w);
        staging[i].color_pad = glm::vec4(data[i].color, data[i].emission);
    }
    std::memcpy(gaussian_ssbo_.mapped(), staging.data(), count * sizeof(GpuGaussian));

    // Reinitialize both sort buffers via staging
    auto init_sort_buf = [&](Buffer& buf) {
        std::vector<SortEntry> staging_sort(sort_size_);
        for (uint32_t i = 0; i < sort_size_; ++i) {
            staging_sort[i].key = 0xFFFFFFFF;
            staging_sort[i].index = i < gaussian_count_ ? i : 0;
        }
        std::memcpy(buf.mapped(), staging_sort.data(), sort_size_ * sizeof(SortEntry));
    };
    init_sort_buf(sort_keys_ssbo_);
    init_sort_buf(sort_b_ssbo_);
}

void GsRenderer::update_gaussian_data(const Gaussian* data, uint32_t count) {
    if (count == 0 || count > max_gaussian_count_) return;

    gaussian_count_ = count;

    // Stage in local buffer, then memcpy to mapped memory (avoids -O3 reordering)
    std::vector<GpuGaussian> staging(count);
    for (uint32_t i = 0; i < count; ++i) {
        float bone_f;
        uint32_t bi = data[i].bone_index;
        std::memcpy(&bone_f, &bi, sizeof(float));
        staging[i].pos_opacity = glm::vec4(data[i].position, data[i].opacity);
        staging[i].scale_pad = glm::vec4(data[i].scale, bone_f);
        staging[i].rot = glm::vec4(data[i].rotation.x, data[i].rotation.y,
                                    data[i].rotation.z, data[i].rotation.w);
        staging[i].color_pad = glm::vec4(data[i].color, data[i].emission);
    }
    std::memcpy(gaussian_ssbo_.mapped(), staging.data(), count * sizeof(GpuGaussian));
    // Sort keys are NOT reset — preprocess shader will recompute depth keys,
    // and the radix sort will re-sort naturally without losing convergence.
}

void GsRenderer::upload_bone_transforms(const glm::mat4* transforms, uint32_t count) {
    if (!bone_ssbo_.mapped() || count == 0) return;
    uint32_t n = std::min(count, kMaxBones);
    auto* dst = static_cast<glm::mat4*>(bone_ssbo_.mapped());
    std::memcpy(dst, transforms, n * sizeof(glm::mat4));
    bone_count_ = n;
    // Force static preprocess to re-run so bone skinning is applied.
    // Without this, Index-Merge skips the preprocess dispatch when camera is static.
    static_dirty_ = true;
}

void GsRenderer::clear_bone_transforms() {
    bone_count_ = 0;
    if (bone_ssbo_.mapped()) {
        auto* dst = static_cast<glm::mat4*>(bone_ssbo_.mapped());
        for (uint32_t i = 0; i < kMaxBones; ++i) dst[i] = glm::mat4(1.0f);
    }
}

void GsRenderer::update_descriptors() {
    // Preprocess set: gaussians(0), projected(1), sort_keys_A(2), uniforms(3), visible_count(4), bones(5), pbd(6), page_table(8)
    {
        VkDescriptorBufferInfo gaussian_info{gaussian_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo projected_info{projected_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo sort_info{sort_keys_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo uniform_info{uniform_buffer_.buffer(), 0, sizeof(GsUniforms)};
        VkDescriptorBufferInfo visible_count_info{visible_count_ssbo_.buffer(), 0, sizeof(uint32_t)};
        VkDescriptorBufferInfo bone_info{bone_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo pbd_info{pbd_state_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo page_table_info{page_table_ssbo_.buffer(), 0, VK_WHOLE_SIZE};

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
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, preprocess_set_, 5, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &bone_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, preprocess_set_, 6, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &pbd_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, preprocess_set_, 8, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &page_table_info, nullptr},
        };
        vkUpdateDescriptorSets(device_, 8, writes, 0, nullptr);
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

    // Render set: projected(0), sort_keys_A(1), uniforms(2), output_image(3), visible_count(4), depth_image(5)
    {
        VkDescriptorBufferInfo projected_info{projected_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo sort_info{sort_keys_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo uniform_info{uniform_buffer_.buffer(), 0, sizeof(GsUniforms)};
        VkDescriptorImageInfo image_info{VK_NULL_HANDLE, output_view_, VK_IMAGE_LAYOUT_GENERAL};
        VkDescriptorBufferInfo visible_count_info{visible_count_ssbo_.buffer(), 0, sizeof(uint32_t)};
        VkDescriptorImageInfo depth_img_info{VK_NULL_HANDLE, depth_view_, VK_IMAGE_LAYOUT_GENERAL};

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
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, render_set_, 5, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, &depth_img_info, nullptr, nullptr},
        };
        vkUpdateDescriptorSets(device_, 6, writes, 0, nullptr);
    }

    // Post-process set: input_image(0), depth_image(1), processed_image(2), pp_ubo(3)
    {
        VkDescriptorImageInfo input_info{VK_NULL_HANDLE, output_view_, VK_IMAGE_LAYOUT_GENERAL};
        VkDescriptorImageInfo depth_info{VK_NULL_HANDLE, depth_view_, VK_IMAGE_LAYOUT_GENERAL};
        VkDescriptorImageInfo proc_info{VK_NULL_HANDLE, processed_view_, VK_IMAGE_LAYOUT_GENERAL};
        VkDescriptorBufferInfo ubo_info{pp_ubo_buffer_.buffer(), 0, sizeof(GsPostProcessUbo)};

        VkWriteDescriptorSet writes[] = {
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, post_process_set_, 0, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, &input_info, nullptr, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, post_process_set_, 1, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, &depth_info, nullptr, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, post_process_set_, 2, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, &proc_info, nullptr, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, post_process_set_, 3, 0, 1,
             VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, nullptr, &ubo_info, nullptr},
        };
        vkUpdateDescriptorSets(device_, 4, writes, 0, nullptr);
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

    // --- Static/dynamic split descriptor sets ---
    // Only write these if the split buffers have been allocated
    if (!static_gaussian_ssbo_.buffer() || !counts_ssbo_.buffer()) return;

    // Static preprocess set: static_gaussian(0), projected(1), static_sort_a(2), uniforms(3), counts[0](4), bones(5), pbd(6), page_table(8)
    {
        VkDescriptorBufferInfo gaussian_info{static_gaussian_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo projected_info{projected_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo sort_info{static_sort_a_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo uniform_info{uniform_buffer_.buffer(), 0, sizeof(GsUniforms)};
        VkDescriptorBufferInfo counts_info{counts_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo bone_info{bone_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo pbd_info{pbd_state_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo page_table_info{page_table_ssbo_.buffer(), 0, VK_WHOLE_SIZE};

        VkWriteDescriptorSet writes[] = {
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, static_preprocess_set_, 0, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &gaussian_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, static_preprocess_set_, 1, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &projected_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, static_preprocess_set_, 2, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &sort_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, static_preprocess_set_, 3, 0, 1,
             VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, nullptr, &uniform_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, static_preprocess_set_, 4, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &counts_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, static_preprocess_set_, 5, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &bone_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, static_preprocess_set_, 6, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &pbd_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, static_preprocess_set_, 8, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &page_table_info, nullptr},
        };
        vkUpdateDescriptorSets(device_, 8, writes, 0, nullptr);
    }

    // Dynamic preprocess set: dynamic_gaussian(0), projected(1), dynamic_sort_a(2), uniforms(3), counts[1](4), bones(5), pbd(6), page_table(8)
    {
        VkDescriptorBufferInfo gaussian_info{dynamic_gaussian_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo projected_info{projected_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo sort_info{dynamic_sort_a_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo uniform_info{uniform_buffer_.buffer(), 0, sizeof(GsUniforms)};
        VkDescriptorBufferInfo counts_info{counts_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo bone_info{bone_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo pbd_info{pbd_state_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo page_table_info{page_table_ssbo_.buffer(), 0, VK_WHOLE_SIZE};

        VkWriteDescriptorSet writes[] = {
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, dynamic_preprocess_set_, 0, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &gaussian_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, dynamic_preprocess_set_, 1, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &projected_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, dynamic_preprocess_set_, 2, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &sort_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, dynamic_preprocess_set_, 3, 0, 1,
             VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, nullptr, &uniform_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, dynamic_preprocess_set_, 4, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &counts_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, dynamic_preprocess_set_, 5, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &bone_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, dynamic_preprocess_set_, 6, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &pbd_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, dynamic_preprocess_set_, 8, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &page_table_info, nullptr},
        };
        vkUpdateDescriptorSets(device_, 8, writes, 0, nullptr);
    }

    // PBD solver descriptor set: pbd_states(0), pbd_params(1), pbd_constraints(2), pbd_uniforms(3)
    {
        VkDescriptorBufferInfo pbd_state_info{pbd_state_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo pbd_params_info{pbd_params_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo pbd_constraint_info{pbd_constraint_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo pbd_ubo_info{pbd_uniform_buffer_.buffer(), 0, 32};
        VkWriteDescriptorSet writes[] = {
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, pbd_set_, 0, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &pbd_state_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, pbd_set_, 1, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &pbd_params_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, pbd_set_, 2, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &pbd_constraint_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, pbd_set_, 3, 0, 1,
             VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, nullptr, &pbd_ubo_info, nullptr},
        };
        vkUpdateDescriptorSets(device_, 4, writes, 0, nullptr);
    }

    // Helper to write radix histogram/scan/scatter sets
    auto write_hist_set = [&](VkDescriptorSet set, VkBuffer input_buf, VkBuffer hist_buf) {
        VkDescriptorBufferInfo in_info{input_buf, 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo hist_info{hist_buf, 0, VK_WHOLE_SIZE};
        VkWriteDescriptorSet writes[] = {
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 0, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &in_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 1, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &hist_info, nullptr},
        };
        vkUpdateDescriptorSets(device_, 2, writes, 0, nullptr);
    };

    auto write_scan_set = [&](VkDescriptorSet set, VkBuffer hist_buf) {
        VkDescriptorBufferInfo hist_info{hist_buf, 0, VK_WHOLE_SIZE};
        VkWriteDescriptorSet writes[] = {
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 0, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &hist_info, nullptr},
        };
        vkUpdateDescriptorSets(device_, 1, writes, 0, nullptr);
    };

    auto write_scatter_set = [&](VkDescriptorSet set, VkBuffer in_buf, VkBuffer out_buf, VkBuffer hist_buf) {
        VkDescriptorBufferInfo in_info{in_buf, 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo out_info{out_buf, 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo hist_info{hist_buf, 0, VK_WHOLE_SIZE};
        VkWriteDescriptorSet writes[] = {
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 0, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &in_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 1, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &out_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 2, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &hist_info, nullptr},
        };
        vkUpdateDescriptorSets(device_, 3, writes, 0, nullptr);
    };

    // Static radix sets
    write_hist_set(static_histogram_set_a_, static_sort_a_.buffer(), static_histogram_ssbo_.buffer());
    write_hist_set(static_histogram_set_b_, static_sort_b_.buffer(), static_histogram_ssbo_.buffer());
    write_scan_set(static_scan_set_, static_histogram_ssbo_.buffer());
    write_scatter_set(static_scatter_set_ab_, static_sort_a_.buffer(), static_sort_b_.buffer(), static_histogram_ssbo_.buffer());
    write_scatter_set(static_scatter_set_ba_, static_sort_b_.buffer(), static_sort_a_.buffer(), static_histogram_ssbo_.buffer());

    // Dynamic radix sets
    write_hist_set(dynamic_histogram_set_a_, dynamic_sort_a_.buffer(), dynamic_histogram_ssbo_.buffer());
    write_hist_set(dynamic_histogram_set_b_, dynamic_sort_b_.buffer(), dynamic_histogram_ssbo_.buffer());
    write_scan_set(dynamic_scan_set_, dynamic_histogram_ssbo_.buffer());
    write_scatter_set(dynamic_scatter_set_ab_, dynamic_sort_a_.buffer(), dynamic_sort_b_.buffer(), dynamic_histogram_ssbo_.buffer());
    write_scatter_set(dynamic_scatter_set_ba_, dynamic_sort_b_.buffer(), dynamic_sort_a_.buffer(), dynamic_histogram_ssbo_.buffer());

    // Merge set: static_sort_a(0), dynamic_sort_a(1), merged_sort(2), counts(3)
    {
        VkDescriptorBufferInfo static_info{static_sort_a_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo dynamic_info{dynamic_sort_a_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo merged_info{merged_sort_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo counts_info{counts_ssbo_.buffer(), 0, VK_WHOLE_SIZE};

        VkWriteDescriptorSet writes[] = {
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, merge_set_, 0, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &static_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, merge_set_, 1, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &dynamic_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, merge_set_, 2, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &merged_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, merge_set_, 3, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &counts_info, nullptr},
        };
        vkUpdateDescriptorSets(device_, 4, writes, 0, nullptr);
    }

    // Render set (updated to use merged_sort and counts instead of legacy sort_keys)
    {
        VkDescriptorBufferInfo projected_info{projected_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo merged_info{merged_sort_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo uniform_info{uniform_buffer_.buffer(), 0, sizeof(GsUniforms)};
        VkDescriptorImageInfo image_info{VK_NULL_HANDLE, output_view_, VK_IMAGE_LAYOUT_GENERAL};
        VkDescriptorBufferInfo counts_info{counts_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorImageInfo depth_img_info{VK_NULL_HANDLE, depth_view_, VK_IMAGE_LAYOUT_GENERAL};

        VkWriteDescriptorSet writes[] = {
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, render_set_, 0, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &projected_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, render_set_, 1, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &merged_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, render_set_, 2, 0, 1,
             VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, nullptr, &uniform_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, render_set_, 3, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, &image_info, nullptr, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, render_set_, 4, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &counts_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, render_set_, 5, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, &depth_img_info, nullptr, nullptr},
        };
        vkUpdateDescriptorSets(device_, 6, writes, 0, nullptr);
    }
}

void GsRenderer::resize_output(uint32_t width, uint32_t height) {
    if (width == output_width_ && height == output_height_) return;

    if (output_sampler_) { vkDestroySampler(device_, output_sampler_, nullptr); output_sampler_ = VK_NULL_HANDLE; }
    if (output_view_) { vkDestroyImageView(device_, output_view_, nullptr); output_view_ = VK_NULL_HANDLE; }
    if (output_image_) { vmaDestroyImage(allocator_, output_image_, output_allocation_); output_image_ = VK_NULL_HANDLE; }
    if (depth_view_) { vkDestroyImageView(device_, depth_view_, nullptr); depth_view_ = VK_NULL_HANDLE; }
    if (depth_image_) { vmaDestroyImage(allocator_, depth_image_, depth_allocation_); depth_image_ = VK_NULL_HANDLE; }
    if (processed_view_) { vkDestroyImageView(device_, processed_view_, nullptr); processed_view_ = VK_NULL_HANDLE; }
    if (processed_image_) { vmaDestroyImage(allocator_, processed_image_, processed_allocation_); processed_image_ = VK_NULL_HANDLE; }

    create_output_image(width, height);

    if (gaussian_count_ > 0) {
        update_descriptors();
    }
}

void GsRenderer::dispatch_radix_sort(
    VkCommandBuffer cmd, uint32_t sort_size, uint32_t num_workgroups,
    VkDescriptorSet hist_a, VkDescriptorSet hist_b,
    VkDescriptorSet scan,
    VkDescriptorSet scatter_ab, VkDescriptorSet scatter_ba)
{
    uint32_t histogram_count = 256 * num_workgroups;
    for (uint32_t digit = 0; digit < num_sort_passes_; ++digit) {
        uint32_t digit_shift = digit * 8;
        bool read_from_a = (digit % 2 == 0);
        uint32_t push_data[2] = {sort_size, digit_shift};

        // Histogram
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, radix_histogram_pipeline_);
        auto hist_set = read_from_a ? hist_a : hist_b;
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                radix_histogram_pipeline_layout_, 0, 1, &hist_set, 0, nullptr);
        vkCmdPushConstants(cmd, radix_histogram_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                           0, 8, push_data);
        vkCmdDispatch(cmd, num_workgroups, 1, 1);

        insert_compute_barrier(cmd);

        // Prefix scan (single workgroup)
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, radix_scan_pipeline_);
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                radix_scan_pipeline_layout_, 0, 1, &scan, 0, nullptr);
        vkCmdPushConstants(cmd, radix_scan_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                           0, 4, &histogram_count);
        vkCmdDispatch(cmd, 1, 1, 1);

        insert_compute_barrier(cmd);

        // Scatter
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, radix_scatter_pipeline_);
        auto scatter_set = read_from_a ? scatter_ab : scatter_ba;
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                radix_scatter_pipeline_layout_, 0, 1, &scatter_set, 0, nullptr);
        vkCmdPushConstants(cmd, radix_scatter_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                           0, 8, push_data);
        vkCmdDispatch(cmd, num_workgroups, 1, 1);

        insert_compute_barrier(cmd);
    }
}

void GsRenderer::render(VkCommandBuffer cmd, const glm::mat4& view, const glm::mat4& proj) {
    if (gaussian_count_ == 0 && static_count_ == 0 && dynamic_count_ == 0) return;

    uint32_t width = output_width_;
    uint32_t height = output_height_;

    // Update uniforms
    GsUniforms uniforms{};
    uniforms.view = view;
    uniforms.proj = proj;
    uniforms.inv_view = glm::inverse(view);
    uniforms.inv_proj = glm::inverse(proj);
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

    uniforms.actor_rotation = glm::vec4(actor_rotation_.x, actor_rotation_.y,
                                        actor_rotation_.z, actor_rotation_.w);

    // Point lights — flat arrays matching shader layout
    uniforms.point_light_params = glm::vec4(static_cast<float>(point_lights_.size()), pixel_art_intensity_, 0, 0);
    for (size_t i = 0; i < point_lights_.size() && i < kMaxGsPointLights; i++) {
        uniforms.pl_pos_rad[i] = point_lights_[i].position_and_radius;
        uniforms.pl_color[i] = point_lights_[i].color;
        uniforms.pl_dir_cone[i] = point_lights_[i].direction_and_cone;
        uniforms.pl_area[i] = point_lights_[i].area_params;
    }

    std::memcpy(uniform_buffer_.mapped(), &uniforms, sizeof(uniforms));

    // Read back GPU timestamps from previous frame's rasterize pass.
    // Non-blocking: if results aren't ready yet, skip this frame's sample.
    if (timestamp_pool_ && timestamps_written_) {
        uint64_t timestamps[2]{};
        VkResult ts_result = vkGetQueryPoolResults(
            device_, timestamp_pool_, 0, 2,
            sizeof(timestamps), timestamps, sizeof(uint64_t),
            VK_QUERY_RESULT_64_BIT);  // no WAIT_BIT — never block on GPU
        if (ts_result == VK_SUCCESS && timestamps[1] > timestamps[0]) {
            float ms = static_cast<float>(timestamps[1] - timestamps[0])
                       * timestamp_period_ns_ / 1e6f;
            rasterize_ms_accum_ += ms;
            ++timestamp_frame_;
            if (timestamp_frame_ % kTimestampAvgFrames == 0) {
                float avg = rasterize_ms_accum_ / static_cast<float>(kTimestampAvgFrames);
                std::printf("[gs_renderer] Rasterize pass: %.3f ms (avg %u frames)\n",
                            avg, kTimestampAvgFrames);
                rasterize_ms_accum_ = 0.0f;
            }
        }
        // VK_NOT_READY means GPU hasn't finished yet — just skip this sample
    }

    // Reset timestamp queries for this frame
    if (timestamp_pool_) {
        vkCmdResetQueryPool(cmd, timestamp_pool_, 0, 2);
        timestamps_written_ = false;  // reset each frame — set again after dispatch
    }

    // In skip-sort mode, skip GS compute but still run post-process
    // (parameters like fade_amount change continuously).
    bool skip_gs_compute = skip_sort_ && sort_done_once_;

    if (!skip_gs_compute) {
        // Transition output + depth images to GENERAL layout for compute write
        VkImageMemoryBarrier barriers[2]{};
        barriers[0].sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
        barriers[0].srcAccessMask = 0;
        barriers[0].dstAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
        barriers[0].oldLayout = VK_IMAGE_LAYOUT_UNDEFINED;
        barriers[0].newLayout = VK_IMAGE_LAYOUT_GENERAL;
        barriers[0].srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        barriers[0].dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        barriers[0].image = output_image_;
        barriers[0].subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};

        barriers[1] = barriers[0];
        barriers[1].image = depth_image_;

        vkCmdPipelineBarrier(cmd,
            VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT,
            VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
            0, 0, nullptr, 0, nullptr, 2, barriers);
    }

    if (!skip_gs_compute) {
        // Clear output + depth images to transparent black (prevents ghost artifacts)
        VkClearColorValue clear_color = {{0.0f, 0.0f, 0.0f, 0.0f}};
        VkImageSubresourceRange range = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
        vkCmdClearColorImage(cmd, output_image_, VK_IMAGE_LAYOUT_GENERAL, &clear_color, 1, &range);
        vkCmdClearColorImage(cmd, depth_image_, VK_IMAGE_LAYOUT_GENERAL, &clear_color, 1, &range);

        // === PBD solver dispatch (before any preprocess) ===
        // PBD-tagged Gaussians live in the static buffer but need re-preprocessing
        // every frame since their positions/rotations change continuously.
        if (pbd_count_ > 0) {
            static_dirty_ = true;
            struct {
                float time;
                float dt;
                uint32_t iterations;
                uint32_t count;
                uint32_t constraint_count;
                uint32_t pad[3];
            } pbd_ubo;
            pbd_ubo.time = time_;
            pbd_ubo.dt = 1.0f / 60.0f;
            pbd_ubo.iterations = kPbdSolverIterations;
            pbd_ubo.count = pbd_count_;
            pbd_ubo.constraint_count = pbd_constraint_count_;
            pbd_ubo.pad[0] = pbd_ubo.pad[1] = pbd_ubo.pad[2] = 0;
            std::memcpy(pbd_uniform_buffer_.mapped(), &pbd_ubo, sizeof(pbd_ubo));

            vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, pbd_pipeline_);
            vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                    pbd_pipeline_layout_, 0, 1, &pbd_set_, 0, nullptr);
            vkCmdPushConstants(cmd, pbd_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                               0, sizeof(uint32_t), &pbd_count_);
            vkCmdDispatch(cmd, (pbd_count_ + 63) / 64, 1, 1);

            // Barrier: PBD write → preprocess read
            VkMemoryBarrier pbd_barrier{};
            pbd_barrier.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
            pbd_barrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
            pbd_barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
            vkCmdPipelineBarrier(cmd,
                VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                0, 1, &pbd_barrier, 0, nullptr, 0, nullptr);
        }

        // Use split pipeline if split buffers are allocated, otherwise legacy path
        bool use_split = static_gaussian_ssbo_.buffer() && counts_ssbo_.buffer();

        if (use_split) {
            // Reset counts that will be written this frame
            // counts[0]=static_visible (reset if static dirty), counts[1]=dynamic_visible (always reset)
            // vkCmdFillBuffer requires offset/size to be multiples of 4 (satisfied)
            if (static_dirty_ && static_count_ > 0) {
                // Reset all 3 counts (static + dynamic + merged)
                vkCmdFillBuffer(cmd, counts_ssbo_.buffer(), 0, 12, 0);
            } else {
                // Reset only dynamic visible count (counts[1]) and merged (counts[2])
                vkCmdFillBuffer(cmd, counts_ssbo_.buffer(), 4, 8, 0);
            }
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

            // === Phase 1: Dynamic preprocess + sort (every frame, if dynamic_count_ > 0) ===
            if (dynamic_count_ > 0) {
                vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, preprocess_pipeline_);
                vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                        preprocess_pipeline_layout_, 0, 1, &dynamic_preprocess_set_, 0, nullptr);
                GsPreprocessPush dyn_push{max_static_count_, dynamic_count_, 1};
                vkCmdPushConstants(cmd, preprocess_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                                   0, sizeof(GsPreprocessPush), &dyn_push);
                vkCmdDispatch(cmd, (dynamic_count_ + 255) / 256, 1, 1);

                insert_compute_barrier(cmd);

                // Sort dynamic
                dispatch_radix_sort(cmd, dynamic_sort_size_, dynamic_sort_workgroups_,
                    dynamic_histogram_set_a_, dynamic_histogram_set_b_,
                    dynamic_scan_set_,
                    dynamic_scatter_set_ab_, dynamic_scatter_set_ba_);
            }

            // === Phase 2: Static preprocess + sort (only when static_dirty_) ===
            if (static_dirty_ && static_count_ > 0) {
                vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, preprocess_pipeline_);
                vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                        preprocess_pipeline_layout_, 0, 1, &static_preprocess_set_, 0, nullptr);
                GsPreprocessPush stat_push{0, static_count_, 0};
                vkCmdPushConstants(cmd, preprocess_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                                   0, sizeof(GsPreprocessPush), &stat_push);
                vkCmdDispatch(cmd, (static_count_ + 255) / 256, 1, 1);

                insert_compute_barrier(cmd);

                // Sort static
                dispatch_radix_sort(cmd, static_sort_size_, static_sort_workgroups_,
                    static_histogram_set_a_, static_histogram_set_b_,
                    static_scan_set_,
                    static_scatter_set_ab_, static_scatter_set_ba_);

                static_dirty_ = false;
            }

            // === Phase 3: Merge (every frame) ===
            // Merge uses actual visible counts from counts SSBO (written by preprocess shaders)
            // Thread 0 computes merged_visible_count = static_count + dynamic_count
            {
                vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, merge_pipeline_);
                vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                        merge_pipeline_layout_, 0, 1, &merge_set_, 0, nullptr);
                // Dispatch enough threads to cover possible visible count
                // Use sort sizes as upper bound (actual count determined by shader from counts SSBO)
                uint32_t total = static_sort_size_ + dynamic_sort_size_;
                vkCmdDispatch(cmd, (total + 255) / 256, 1, 1);
            }

            insert_compute_barrier(cmd);

            // === Phase 4: Tile-based rasterization ===
            {
                vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, render_pipeline_);
                vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                        render_pipeline_layout_, 0, 1, &render_set_, 0, nullptr);
                uint32_t tiles_x = (width + 15) / 16;
                uint32_t tiles_y = (height + 15) / 16;

                if (timestamp_pool_) {
                    vkCmdWriteTimestamp(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                       timestamp_pool_, 0);
                }
                vkCmdDispatch(cmd, tiles_x, tiles_y, 1);
                if (timestamp_pool_) {
                    vkCmdWriteTimestamp(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                       timestamp_pool_, 1);
                    timestamps_written_ = true;
                }
            }
        } else {
            // Legacy single-buffer path (backward compat)
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

            // Preprocess
            vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, preprocess_pipeline_);
            vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                    preprocess_pipeline_layout_, 0, 1, &preprocess_set_, 0, nullptr);
            GsPreprocessPush legacy_push{0, gaussian_count_, 0};
            vkCmdPushConstants(cmd, preprocess_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                               0, sizeof(GsPreprocessPush), &legacy_push);
            vkCmdDispatch(cmd, (gaussian_count_ + 255) / 256, 1, 1);

            insert_compute_barrier(cmd);

            // Radix sort (legacy path)
            dispatch_radix_sort(cmd, sort_size_, num_sort_workgroups_,
                radix_histogram_set_a_, radix_histogram_set_b_,
                radix_scan_set_,
                radix_scatter_set_ab_, radix_scatter_set_ba_);

            // Tile-based rasterization
            vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, render_pipeline_);
            vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                    render_pipeline_layout_, 0, 1, &render_set_, 0, nullptr);
            uint32_t tiles_x = (width + 15) / 16;
            uint32_t tiles_y = (height + 15) / 16;

            if (timestamp_pool_) {
                vkCmdWriteTimestamp(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                   timestamp_pool_, 0);
            }
            vkCmdDispatch(cmd, tiles_x, tiles_y, 1);
            if (timestamp_pool_) {
                vkCmdWriteTimestamp(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                   timestamp_pool_, 1);
                timestamps_written_ = true;
            }
        }

        sort_done_once_ = true;

        // Barrier: tile rasterize → post-process (output+depth readable)
        insert_compute_barrier(cmd);
    }

    // Pass 4: Post-process (always runs — params like fade_amount change every frame)
    {
        // Update post-process UBO
        GsPostProcessUbo pp_ubo{};
        pp_ubo.fog_params = glm::vec4(gs_pp_params_.fog_density,
                                       gs_pp_params_.fog_color_r,
                                       gs_pp_params_.fog_color_g,
                                       gs_pp_params_.fog_color_b);
        pp_ubo.exposure_vignette = glm::vec4(gs_pp_params_.exposure,
                                              gs_pp_params_.vignette_radius,
                                              gs_pp_params_.vignette_softness,
                                              gs_pp_params_.bloom_intensity);
        pp_ubo.bloom_fade = glm::vec4(gs_pp_params_.bloom_threshold,
                                       gs_pp_params_.fade_amount,
                                       gs_pp_params_.flash_r,
                                       gs_pp_params_.flash_g);
        pp_ubo.effects = glm::vec4(gs_pp_params_.flash_b,
                                    gs_pp_params_.ca_intensity,
                                    gs_pp_params_.dof_focus_distance,
                                    gs_pp_params_.dof_focus_range);
        pp_ubo.dimensions = glm::vec4(gs_pp_params_.dof_max_blur,
                                       static_cast<float>(width),
                                       static_cast<float>(height),
                                       gs_pp_params_.far_plane);
        pp_ubo.ground_sky = glm::vec4(gs_pp_params_.ground_color,
                                       gs_pp_params_.horizon_y);
        pp_ubo.sky_enable = glm::vec4(gs_pp_params_.sky_color,
                                       gs_pp_params_.background_enabled ? 1.0f : 0.0f);
        std::memcpy(pp_ubo_buffer_.mapped(), &pp_ubo, sizeof(pp_ubo));

        // Transition processed image to GENERAL for compute write
        {
            VkImageMemoryBarrier barrier{};
            barrier.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
            barrier.srcAccessMask = 0;
            barrier.dstAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
            barrier.oldLayout = VK_IMAGE_LAYOUT_UNDEFINED;
            barrier.newLayout = VK_IMAGE_LAYOUT_GENERAL;
            barrier.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
            barrier.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
            barrier.image = processed_image_;
            barrier.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};

            vkCmdPipelineBarrier(cmd,
                VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT,
                VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                0, 0, nullptr, 0, nullptr, 1, &barrier);
        }

        // Dispatch post-process (same tile grid as render)
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, post_process_pipeline_);
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                post_process_pipeline_layout_, 0, 1, &post_process_set_, 0, nullptr);
        uint32_t tiles_x = (width + 15) / 16;
        uint32_t tiles_y = (height + 15) / 16;
        vkCmdDispatch(cmd, tiles_x, tiles_y, 1);
    }

    // Transition processed image → SHADER_READ_ONLY for fragment sampling (blit)
    {
        VkImageMemoryBarrier barrier{};
        barrier.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
        barrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
        barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
        barrier.oldLayout = VK_IMAGE_LAYOUT_GENERAL;
        barrier.newLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
        barrier.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        barrier.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        barrier.image = processed_image_;
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

void GsRenderer::upload_pbd_elements(const PbdPhysicsState* states,
                                      const PbdElementParams* params,
                                      uint32_t count) {
    if (count == 0) return;
    uint32_t n = std::min(count, kMaxPbdElements);
    if (pbd_state_ssbo_.mapped())
        std::memcpy(pbd_state_ssbo_.mapped(), states, n * sizeof(PbdPhysicsState));
    if (pbd_params_ssbo_.mapped())
        std::memcpy(pbd_params_ssbo_.mapped(), params, n * sizeof(PbdElementParams));
    pbd_count_ = n;
}

void GsRenderer::upload_pbd_constraints(const PbdConstraint* constraints, uint32_t count) {
    if (count == 0) return;
    uint32_t n = std::min(count, kMaxPbdConstraints);
    if (pbd_constraint_ssbo_.mapped())
        std::memcpy(pbd_constraint_ssbo_.mapped(), constraints, n * sizeof(PbdConstraint));
    pbd_constraint_count_ = n;
}

void GsRenderer::clear_pbd() {
    pbd_count_ = 0;
    pbd_constraint_count_ = 0;
    if (pbd_state_ssbo_.mapped()) {
        auto* s = static_cast<PbdPhysicsState*>(pbd_state_ssbo_.mapped());
        for (uint32_t i = 0; i < kMaxPbdElements; ++i) {
            s[i] = PbdPhysicsState{};
            s[i].prev_position = glm::vec4(0.0f, 0.0f, 0.0f, 1.0f);  // identity quat
        }
    }
    if (pbd_params_ssbo_.mapped())
        std::memset(pbd_params_ssbo_.mapped(), 0, kMaxPbdElements * sizeof(PbdElementParams));
    if (pbd_constraint_ssbo_.mapped())
        std::memset(pbd_constraint_ssbo_.mapped(), 0, kMaxPbdConstraints * sizeof(PbdConstraint));
}

void GsRenderer::set_point_lights(const std::vector<PointLight>& lights) {
    point_lights_.assign(lights.begin(),
                         lights.begin() + std::min(lights.size(),
                                                    static_cast<size_t>(kMaxGsPointLights)));
}

void GsRenderer::load_world(const WorldManifest& manifest) {
    world_manifest_ = manifest;
    std::fprintf(stderr, "[GsRenderer] World loaded: %zu chunks, cell_size=(%.0f,%.0f,%.0f)\n",
        manifest.chunks.size(),
        manifest.grid_cell_size.x, manifest.grid_cell_size.y, manifest.grid_cell_size.z);
}

void GsRenderer::shutdown(VmaAllocator allocator) {
    if (!initialized_) return;

    // Join background load threads before destroying resources
    for (auto& t : load_threads_) {
        if (t.joinable()) t.join();
    }
    load_threads_.clear();
    if (transfer_queue_) {
        transfer_queue_->shutdown();
        transfer_queue_.reset();
    }

    // Streaming resources
    page_table_ssbo_.destroy(allocator);
    chunk_table_ssbo_.destroy(allocator);
    slab_allocator_.reset();
    active_chunks_.clear();
    streaming_initialized_ = false;

    // Legacy buffers
    gaussian_ssbo_.destroy(allocator);
    projected_ssbo_.destroy(allocator);
    sort_keys_ssbo_.destroy(allocator);
    sort_b_ssbo_.destroy(allocator);
    histogram_ssbo_.destroy(allocator);
    uniform_buffer_.destroy(allocator);
    visible_count_ssbo_.destroy(allocator);
    bone_ssbo_.destroy(allocator);
    pbd_state_ssbo_.destroy(allocator);
    pbd_params_ssbo_.destroy(allocator);
    pbd_constraint_ssbo_.destroy(allocator);
    pbd_uniform_buffer_.destroy(allocator);

    // Split buffers
    static_gaussian_ssbo_.destroy(allocator);
    dynamic_gaussian_ssbo_.destroy(allocator);
    static_sort_a_.destroy(allocator);
    static_sort_b_.destroy(allocator);
    dynamic_sort_a_.destroy(allocator);
    dynamic_sort_b_.destroy(allocator);
    static_histogram_ssbo_.destroy(allocator);
    dynamic_histogram_ssbo_.destroy(allocator);
    merged_sort_ssbo_.destroy(allocator);
    counts_ssbo_.destroy(allocator);

    pp_ubo_buffer_.destroy(allocator);

    if (output_sampler_) { vkDestroySampler(device_, output_sampler_, nullptr); output_sampler_ = VK_NULL_HANDLE; }
    if (output_view_) { vkDestroyImageView(device_, output_view_, nullptr); output_view_ = VK_NULL_HANDLE; }
    if (output_image_) { vmaDestroyImage(allocator, output_image_, output_allocation_); output_image_ = VK_NULL_HANDLE; }
    if (depth_view_) { vkDestroyImageView(device_, depth_view_, nullptr); depth_view_ = VK_NULL_HANDLE; }
    if (depth_image_) { vmaDestroyImage(allocator, depth_image_, depth_allocation_); depth_image_ = VK_NULL_HANDLE; }
    if (processed_view_) { vkDestroyImageView(device_, processed_view_, nullptr); processed_view_ = VK_NULL_HANDLE; }
    if (processed_image_) { vmaDestroyImage(allocator, processed_image_, processed_allocation_); processed_image_ = VK_NULL_HANDLE; }

    auto destroy_pipeline = [&](VkPipeline& p) { if (p) { vkDestroyPipeline(device_, p, nullptr); p = VK_NULL_HANDLE; } };
    auto destroy_layout = [&](VkPipelineLayout& l) { if (l) { vkDestroyPipelineLayout(device_, l, nullptr); l = VK_NULL_HANDLE; } };
    auto destroy_set_layout = [&](VkDescriptorSetLayout& l) { if (l) { vkDestroyDescriptorSetLayout(device_, l, nullptr); l = VK_NULL_HANDLE; } };

    destroy_pipeline(preprocess_pipeline_);
    destroy_pipeline(sort_pipeline_);
    destroy_pipeline(render_pipeline_);
    destroy_pipeline(post_process_pipeline_);
    destroy_pipeline(merge_pipeline_);
    destroy_pipeline(pbd_pipeline_);
    destroy_pipeline(radix_histogram_pipeline_);
    destroy_pipeline(radix_scan_pipeline_);
    destroy_pipeline(radix_scatter_pipeline_);

    destroy_layout(preprocess_pipeline_layout_);
    destroy_layout(sort_pipeline_layout_);
    destroy_layout(render_pipeline_layout_);
    destroy_layout(post_process_pipeline_layout_);
    destroy_layout(merge_pipeline_layout_);
    destroy_layout(pbd_pipeline_layout_);
    destroy_layout(radix_histogram_pipeline_layout_);
    destroy_layout(radix_scan_pipeline_layout_);
    destroy_layout(radix_scatter_pipeline_layout_);

    destroy_set_layout(preprocess_layout_);
    destroy_set_layout(sort_layout_);
    destroy_set_layout(render_layout_);
    destroy_set_layout(post_process_layout_);
    destroy_set_layout(merge_layout_);
    destroy_set_layout(pbd_layout_);
    destroy_set_layout(radix_histogram_layout_);
    destroy_set_layout(radix_scan_layout_);
    destroy_set_layout(radix_scatter_layout_);

    if (timestamp_pool_) { vkDestroyQueryPool(device_, timestamp_pool_, nullptr); timestamp_pool_ = VK_NULL_HANDLE; }
    if (gs_pool_) vkDestroyDescriptorPool(device_, gs_pool_, nullptr);

    initialized_ = false;
}

}  // namespace gseurat
