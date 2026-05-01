#include "gseurat/engine/gs_renderer.hpp"
#include "gseurat/engine/pipeline.hpp"
#include "gseurat/engine/scoped_timer.hpp"

#include <chrono>
#include <cmath>
#include <cstring>
#include <stdexcept>
#include <thread>
#include <algorithm>
#include <optional>

namespace gseurat {

namespace {

// GpuGaussian is defined in gaussian_cloud.hpp (shared with GSVX loader).

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
    glm::vec4 tile_sort_params;  // x = near_z, y = far_z, z = tiles_x, w = tiles_y
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
                      VmaAllocator allocator, VkDescriptorPool pool,
                      VkPipelineCache pipeline_cache) {
    device_ = device;
    allocator_ = allocator;
    pool_ = pool;
    pipeline_cache_ = pipeline_cache;

    create_output_image(320, 240);

    // Create initial tile buffers (zeroed) for valid descriptor bindings.
    // init_streaming() will recreate them at proper size when a scene loads.
    {
        static constexpr uint32_t kMaxTiles = 256 * 144;  // supports up to 4096×2304
        tile_ranges_ssbo_ = Buffer::create_storage_gpu_only(allocator_,
            static_cast<VkDeviceSize>(kMaxTiles) * 2 * sizeof(uint32_t));
        // GPU-only: zeroed by vkCmdFillBuffer at dispatch time
        // Tiny dummy tile sort buffer (8 bytes) — just for descriptor binding validity
        tile_sort_a_ = Buffer::create_storage_gpu_only(allocator_, 8);
        tile_sort_count_ssbo_ = Buffer::create_storage_readback(allocator_, sizeof(uint32_t));
        std::memset(tile_sort_count_ssbo_.mapped(), 0, sizeof(uint32_t));
        tile_indirect_args_ = Buffer::create_storage_indirect(allocator_, 8 * sizeof(uint32_t));
        std::memset(tile_indirect_args_.mapped(), 0, 8 * sizeof(uint32_t));
    }

    create_descriptor_resources();
    create_compute_pipelines();

    // Create timestamp query pool for GPU profiling (2 queries: before/after rasterize)
    {
        VkQueryPoolCreateInfo qp_info{};
        qp_info.sType = VK_STRUCTURE_TYPE_QUERY_POOL_CREATE_INFO;
        qp_info.queryType = VK_QUERY_TYPE_TIMESTAMP;
        qp_info.queryCount = 6;  // depth_sort_begin/end, tile_sort_begin/end, raster_begin/end
        vkCreateQueryPool(device_, &qp_info, nullptr, &timestamp_pool_);

        VkPhysicalDeviceProperties props;
        vkGetPhysicalDeviceProperties(physical_device, &props);
        timestamp_period_ns_ = props.limits.timestampPeriod;
        std::fprintf(stderr, "[gs_renderer] Timestamp period: %.2f ns (query pool created)\n",
                     timestamp_period_ns_);
    }

    initialized_ = true;
}

void GsRenderer::create_output_image(uint32_t width, uint32_t height) {
    output_width_ = width;
    output_height_ = height;

    // Helper that allocates one VkImage + view at a given index using a
    // fixed format/usage. Used to build the per-frame arrays for output,
    // depth, and processed images.
    auto make_image = [&](VkFormat format, VkImageUsageFlags usage,
                          VkImage& out_image, VmaAllocation& out_alloc,
                          VkImageView& out_view, const char* what) {
        VkImageCreateInfo image_info{};
        image_info.sType = VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO;
        image_info.imageType = VK_IMAGE_TYPE_2D;
        image_info.format = format;
        image_info.extent = {width, height, 1};
        image_info.mipLevels = 1;
        image_info.arrayLayers = 1;
        image_info.samples = VK_SAMPLE_COUNT_1_BIT;
        image_info.tiling = VK_IMAGE_TILING_OPTIMAL;
        image_info.usage = usage;

        VmaAllocationCreateInfo alloc_info{};
        alloc_info.usage = VMA_MEMORY_USAGE_GPU_ONLY;

        if (vmaCreateImage(allocator_, &image_info, &alloc_info,
                           &out_image, &out_alloc, nullptr) != VK_SUCCESS) {
            throw std::runtime_error(std::string("Failed to create GS image: ") + what);
        }

        VkImageViewCreateInfo view_info{};
        view_info.sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO;
        view_info.image = out_image;
        view_info.viewType = VK_IMAGE_VIEW_TYPE_2D;
        view_info.format = format;
        view_info.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};

        if (vkCreateImageView(device_, &view_info, nullptr, &out_view) != VK_SUCCESS) {
            throw std::runtime_error(std::string("Failed to create GS image view: ") + what);
        }
    };

    constexpr VkImageUsageFlags kColorUsage =
        VK_IMAGE_USAGE_STORAGE_BIT | VK_IMAGE_USAGE_SAMPLED_BIT |
        VK_IMAGE_USAGE_TRANSFER_DST_BIT;
    constexpr VkImageUsageFlags kDepthUsage =
        VK_IMAGE_USAGE_STORAGE_BIT | VK_IMAGE_USAGE_TRANSFER_DST_BIT;

    for (uint32_t i = 0; i < kMaxFramesInFlight; ++i) {
        make_image(VK_FORMAT_R16G16B16A16_SFLOAT, kColorUsage,
                   output_images_[i], output_allocations_[i], output_views_[i],
                   "output");
        make_image(VK_FORMAT_R16_SFLOAT, kDepthUsage,
                   depth_images_[i], depth_allocations_[i], depth_views_[i],
                   "depth");
        make_image(VK_FORMAT_R16G16B16A16_SFLOAT, kColorUsage,
                   processed_images_[i], processed_allocations_[i], processed_views_[i],
                   "processed");
    }

    if (output_sampler_ == VK_NULL_HANDLE) {
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
    pool_info.maxSets = 160;  // expanded for static/dynamic/merge + per-frame sets
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

    // Tile binning layout (deterministic count + scatter):
    //   0 projected      1 merged_sort     2 counts (ro)
    //   3 per_splat_tile_count    4 per_splat_tile_offset
    //   5 tile_entries           6 uniforms
    // Count shader uses 0,1,2,3,6. Scatter uses 0,1,2,4,5,6.
    {
        VkDescriptorSetLayoutBinding bindings[] = {
            {0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {2, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {3, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {5, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {6, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        };
        VkDescriptorSetLayoutCreateInfo ci{};
        ci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        ci.bindingCount = 7;
        ci.pBindings = bindings;
        vkCreateDescriptorSetLayout(device_, &ci, nullptr, &tile_bin_layout_);
    }

    // Tile scan layout: per_splat_tile_count(0), per_splat_tile_offset(1),
    //                   scan_block_sums(2), tile_sort_count(3)
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
        vkCreateDescriptorSetLayout(device_, &ci, nullptr, &tile_scan_layout_);
    }

    // Onesweep histogram layout: { input(0), status(1), indirect_args(2) }
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
        vkCreateDescriptorSetLayout(device_, &ci, nullptr, &onesweep_hist_layout_);
    }

    // Onesweep scatter layout: { input(0), output(1), status(2), indirect_args(3) }
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
        vkCreateDescriptorSetLayout(device_, &ci, nullptr, &onesweep_scatter_layout_);
    }

    // Tile indirect dispatch layout: { tile_sort_count(0), indirect_args(1) }
    {
        VkDescriptorSetLayoutBinding bindings[] = {
            {0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        };
        VkDescriptorSetLayoutCreateInfo ci{};
        ci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        ci.bindingCount = 2;
        ci.pBindings = bindings;
        vkCreateDescriptorSetLayout(device_, &ci, nullptr, &tile_indirect_layout_);
    }

    // Tile render layout: { projected(0), tile_entries(1), uniforms(2), output_image(3), tile_ranges(4), depth_image(5) }
    {
        VkDescriptorSetLayoutBinding bindings[] = {
            {0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {2, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {3, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {4, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
            {5, VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        };
        VkDescriptorSetLayoutCreateInfo ci{};
        ci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        ci.bindingCount = 6;
        ci.pBindings = bindings;
        vkCreateDescriptorSetLayout(device_, &ci, nullptr, &tile_render_layout_);
    }

    // Tile range detection layout: { sorted_entries(0), tile_ranges(1), tile_count(2) }
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
        vkCreateDescriptorSetLayout(device_, &ci, nullptr, &tile_ranges_layout_);
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

    // Per-frame intermediate images (`output_image_[i]`, `depth_image_[i]`,
    // `processed_image_[i]`) require per-frame descriptor sets because a
    // single VkDescriptorSet binds to one VkImageView. The render,
    // post_process, and tile_render sets all bind at least one of those
    // images, so we allocate `kMaxFramesInFlight` of each.
    static_assert(kMaxFramesInFlight == 2,
                  "Per-frame descriptor allocation below assumes 2 frames in flight; "
                  "if you change kMaxFramesInFlight, also extend the per-frame slot "
                  "indices for render/post_process/tile_render at the end of `layouts`.");

    VkDescriptorSetLayout layouts[] = {
        preprocess_layout_, sort_layout_, render_layout_,   // 0-2: legacy (render_sets_[0])
        post_process_layout_,                               // 3: post-process (post_process_sets_[0])
        preprocess_layout_, preprocess_layout_,             // 4-5: static + dynamic preprocess
        merge_layout_,                                      // 6: merge
        render_layout_,                                     // 7: merged render
        pbd_layout_,                                        // 8: PBD solver
        // Tile binning sets
        tile_bin_layout_,                                   // 9: tile bin (count + scatter)
        tile_ranges_layout_,                                // 10: tile range detection
        tile_indirect_layout_,                              // 11: indirect dispatch prep
        tile_render_layout_,                                // 12: tile render (tile_render_sets_[0])
        onesweep_hist_layout_, onesweep_hist_layout_,       // 13-14: tile onesweep histogram A, B
        onesweep_scatter_layout_, onesweep_scatter_layout_, // 15-16: tile onesweep scatter A→B, B→A
        // Depth sort Onesweep sets (reusing onesweep layouts)
        onesweep_hist_layout_, onesweep_hist_layout_,       // 17-18: legacy depth hist A, B
        onesweep_scatter_layout_, onesweep_scatter_layout_, // 19-20: legacy depth scatter AB, BA
        onesweep_hist_layout_, onesweep_hist_layout_,       // 21-22: static depth hist A, B
        onesweep_scatter_layout_, onesweep_scatter_layout_, // 23-24: static depth scatter AB, BA
        onesweep_hist_layout_, onesweep_hist_layout_,       // 25-26: dynamic depth hist A, B
        onesweep_scatter_layout_, onesweep_scatter_layout_, // 27-28: dynamic depth scatter AB, BA
        tile_scan_layout_,                                  // 29: deterministic tile-bin scan
        // Per-frame [1] copies for sets that bind per-frame images:
        render_layout_,                                     // 30: render_sets_[1]
        post_process_layout_,                               // 31: post_process_sets_[1]
        tile_render_layout_,                                // 32: tile_render_sets_[1]
    };
    constexpr uint32_t kSetCount = 33;
    VkDescriptorSet sets[kSetCount];
    VkDescriptorSetAllocateInfo alloc_info{};
    alloc_info.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
    alloc_info.descriptorPool = gs_pool_;
    alloc_info.descriptorSetCount = kSetCount;
    alloc_info.pSetLayouts = layouts;
    vkAllocateDescriptorSets(device_, &alloc_info, sets);

    // Legacy sets
    preprocess_set_ = sets[0];
    sort_set_ = sets[1];
    render_sets_[0] = sets[2];
    render_sets_[1] = sets[30];
    post_process_sets_[0] = sets[3];
    post_process_sets_[1] = sets[31];
    // Static/dynamic preprocess
    static_preprocess_set_ = sets[4];
    dynamic_preprocess_set_ = sets[5];
    merge_set_ = sets[6];
    // sets[7] is the merged render set (render_layout_)
    pbd_set_ = sets[8];
    // Tile binning
    tile_bin_set_ = sets[9];
    tile_ranges_set_ = sets[10];
    tile_indirect_set_ = sets[11];
    tile_render_sets_[0] = sets[12];
    tile_render_sets_[1] = sets[32];
    onesweep_hist_set_a_ = sets[13];
    onesweep_hist_set_b_ = sets[14];
    onesweep_scatter_set_ab_ = sets[15];
    onesweep_scatter_set_ba_ = sets[16];
    // Depth sort Onesweep (legacy)
    depth_hist_set_a_ = sets[17];
    depth_hist_set_b_ = sets[18];
    depth_scatter_set_ab_ = sets[19];
    depth_scatter_set_ba_ = sets[20];
    // Depth sort Onesweep (static)
    static_depth_hist_set_a_ = sets[21];
    static_depth_hist_set_b_ = sets[22];
    static_depth_scatter_set_ab_ = sets[23];
    static_depth_scatter_set_ba_ = sets[24];
    // Depth sort Onesweep (dynamic)
    dynamic_depth_hist_set_a_ = sets[25];
    dynamic_depth_hist_set_b_ = sets[26];
    dynamic_depth_scatter_set_ab_ = sets[27];
    dynamic_depth_scatter_set_ba_ = sets[28];
    // Deterministic tile-bin scan
    tile_scan_set_ = sets[29];
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

        if (vkCreateComputePipelines(device_, pipeline_cache_, 1, &pi,
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

    // Tile binning scatter (push: max_entries = 4 bytes). Builds the
    // pipeline layout that the count pipeline below reuses — the count
    // shader has no push constant but accepts a 4-byte range without
    // touching it (Vulkan permits an unused push range to dangle).
    create_pipeline("shaders/gs_tile_bin.comp.spv", tile_bin_layout_, 4,
                    tile_bin_pipeline_layout_, tile_bin_pipeline_);

    // Tile-bin count pass — reuses tile_bin_layout_ + push range.
    {
        auto module = load_shader_module(device_, "shaders/gs_tile_count.comp.spv");
        VkPipelineShaderStageCreateInfo stage{};
        stage.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
        stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
        stage.module = module;
        stage.pName = "main";

        VkComputePipelineCreateInfo pipe_info{};
        pipe_info.sType = VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO;
        pipe_info.stage = stage;
        pipe_info.layout = tile_bin_pipeline_layout_;
        if (vkCreateComputePipelines(device_, pipeline_cache_, 1, &pipe_info, nullptr,
                                      &tile_count_pipeline_) != VK_SUCCESS) {
            throw std::runtime_error("Failed to create tile_count pipeline");
        }
        vkDestroyShaderModule(device_, module, nullptr);
    }

    // Tile-bin scan (push: { pass, num_elements, num_blocks } = 12 bytes).
    create_pipeline("shaders/gs_tile_scan.comp.spv", tile_scan_layout_, 12,
                    tile_scan_pipeline_layout_, tile_scan_pipeline_);

    // Tile range detection pipeline (push: num_tiles + max_entries = 8 bytes)
    create_pipeline("shaders/gs_tile_ranges.comp.spv", tile_ranges_layout_, 8,
                    tile_ranges_pipeline_layout_, tile_ranges_pipeline_);

    // Indirect dispatch preparation (push: max_entries = 4 bytes)
    create_pipeline("shaders/gs_tile_prepare_indirect.comp.spv", tile_indirect_layout_, 4,
                    tile_indirect_pipeline_layout_, tile_indirect_pipeline_);

    // Onesweep histogram pipeline (push: pass = 4 bytes)
    create_pipeline("shaders/gs_onesweep_histogram.comp.spv", onesweep_hist_layout_, 4,
                    onesweep_hist_pipeline_layout_, onesweep_hist_pipeline_);

    // Onesweep scatter pipeline (push: pass = 4 bytes)
    create_pipeline("shaders/gs_onesweep_scatter.comp.spv", onesweep_scatter_layout_, 4,
                    onesweep_scatter_pipeline_layout_, onesweep_scatter_pipeline_);

    // Tile render pipeline (separate from render — uses tile_entries + tile_ranges)
    create_pipeline("shaders/gs_tile_render.comp.spv", tile_render_layout_, 0,
                    tile_render_pipeline_layout_, tile_render_pipeline_);
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

    // Compute sort params (aligned to Onesweep ENTRIES_PER_WG = 2048)
    auto compute_sort_params = [](uint32_t max_count, uint32_t& sort_size, uint32_t& num_wg) {
        sort_size = ((max_count + 2047) / 2048) * 2048;
        if (sort_size < max_count) sort_size = max_count;
        num_wg = sort_size / 2048;
        if (num_wg == 0) num_wg = 1;
        sort_size = num_wg * 2048;
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

    // Destroy ALL old buffers (legacy + split)
    gaussian_ssbo_.destroy(allocator_);
    projected_ssbo_.destroy(allocator_);
    sort_keys_ssbo_.destroy(allocator_);
    sort_b_ssbo_.destroy(allocator_);
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
    merged_sort_ssbo_.destroy(allocator_);
    counts_ssbo_.destroy(allocator_);
    page_table_ssbo_.destroy(allocator_);
    chunk_table_ssbo_.destroy(allocator_);
    tile_sort_a_.destroy(allocator_);
    tile_sort_b_.destroy(allocator_);
    tile_sort_count_ssbo_.destroy(allocator_);
    tile_ranges_ssbo_.destroy(allocator_);
    pp_ubo_buffer_.destroy(allocator_);
    depth_onesweep_status_.destroy(allocator_);
    depth_sort_params_.destroy(allocator_);
    static_depth_params_.destroy(allocator_);
    dynamic_depth_params_.destroy(allocator_);

    // Create split buffers at full budget size
    static_gaussian_ssbo_ = Buffer::create_storage(allocator_, static_gauss_size);
    dynamic_gaussian_ssbo_ = Buffer::create_storage(allocator_, dynamic_gauss_size);
    projected_ssbo_ = Buffer::create_storage(allocator_, projected_buf_size);
    static_sort_a_ = Buffer::create_storage(allocator_, static_sort_buf_size);
    static_sort_b_ = Buffer::create_storage(allocator_, static_sort_buf_size);
    dynamic_sort_a_ = Buffer::create_storage(allocator_, dynamic_sort_buf_size);
    dynamic_sort_b_ = Buffer::create_storage(allocator_, dynamic_sort_buf_size);
    merged_sort_ssbo_ = Buffer::create_storage(allocator_, merged_sort_buf_size);
    counts_ssbo_ = Buffer::create_storage_readback(allocator_, 3 * sizeof(uint32_t));
    uniform_buffer_ = Buffer::create_uniform(allocator_, sizeof(GsUniforms));
    visible_count_ssbo_ = Buffer::create_storage_readback(allocator_, sizeof(uint32_t));

    // Legacy buffers (same sizes as static counterparts for backward compat)
    gaussian_ssbo_ = Buffer::create_storage(allocator_,
        static_cast<VkDeviceSize>(max_gaussian_count_) * sizeof(GpuGaussian));
    sort_keys_ssbo_ = Buffer::create_storage(allocator_, static_sort_buf_size);
    sort_b_ssbo_ = Buffer::create_storage(allocator_, static_sort_buf_size);

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

    // ── Tile binning buffers ──
    // Capacity: visible Gaussians × avg tile overlap. Cap at 1M entries (16MB per buffer).
    {
        uint32_t visible_upper = static_sort_size_ + dynamic_sort_size_;
        tile_sort_capacity_ = std::min(visible_upper * 4, 1u << 21);  // cap at 2M (16MB per buffer)
        // Align to 1024 (workgroup size for radix sort)
        tile_sort_size_ = ((tile_sort_capacity_ + 2047) / 2048) * 2048;
        tile_sort_workgroups_ = tile_sort_size_ / 2048;
        if (tile_sort_workgroups_ == 0) tile_sort_workgroups_ = 1;
        tile_sort_size_ = tile_sort_workgroups_ * 2048;

        VkDeviceSize entry_buf_size = static_cast<VkDeviceSize>(tile_sort_size_) * 8;  // 8 bytes/entry
        // Allocate tile_ranges for max possible resolution (output_width_ may not
        // reflect final size at allocation time). Generous upper bound.
        static constexpr uint32_t kMaxTiles = 256 * 144;  // supports up to 4096×2304
        VkDeviceSize ranges_buf_size = static_cast<VkDeviceSize>(kMaxTiles) * 2 * sizeof(uint32_t);

        // Deterministic tile-bin (Fix B) intermediate SSBOs. Sized to the
        // visible-splat upper bound rounded up to a 256-thread workgroup —
        // gs_tile_count.comp dispatches at this granularity, and the scan
        // shader expects num_elements to match.
        scan_dispatch_size_ = ((visible_upper + 255u) / 256u) * 256u;
        if (scan_dispatch_size_ == 0) scan_dispatch_size_ = 256u;
        scan_num_blocks_ = scan_dispatch_size_ / 256u;
        VkDeviceSize per_splat_buf_size =
            static_cast<VkDeviceSize>(scan_dispatch_size_) * sizeof(uint32_t);
        VkDeviceSize block_sums_buf_size =
            static_cast<VkDeviceSize>(scan_num_blocks_) * sizeof(uint32_t);

        tile_sort_a_.destroy(allocator_);
        tile_sort_b_.destroy(allocator_);
        tile_sort_count_ssbo_.destroy(allocator_);
        tile_ranges_ssbo_.destroy(allocator_);
        tile_indirect_args_.destroy(allocator_);
        per_splat_tile_count_ssbo_.destroy(allocator_);
        per_splat_tile_offset_ssbo_.destroy(allocator_);
        scan_block_sums_ssbo_.destroy(allocator_);
        determinism_readback_.destroy(allocator_);

        tile_sort_a_ = Buffer::create_storage_gpu_only(allocator_, entry_buf_size);
        tile_sort_b_ = Buffer::create_storage_gpu_only(allocator_, entry_buf_size);
        tile_sort_count_ssbo_ = Buffer::create_storage_readback(allocator_, sizeof(uint32_t));
        tile_ranges_ssbo_ = Buffer::create_storage_gpu_only(allocator_, ranges_buf_size);
        tile_indirect_args_ = Buffer::create_storage_indirect(allocator_, 8 * sizeof(uint32_t));
        per_splat_tile_count_ssbo_ =
            Buffer::create_storage_gpu_only(allocator_, per_splat_buf_size);
        per_splat_tile_offset_ssbo_ =
            Buffer::create_storage_gpu_only(allocator_, per_splat_buf_size);
        scan_block_sums_ssbo_ =
            Buffer::create_storage_gpu_only(allocator_, block_sums_buf_size);
        determinism_readback_ = Buffer::create_readback(allocator_, entry_buf_size);
        determinism_readback_size_ = entry_buf_size;

        std::fprintf(stderr, "GS: Tile sort -- capacity=%u entries (%u workgroups), "
                     "output=%ux%u, buf=%.1f MB; scan=%u elems / %u blocks\n",
                     tile_sort_size_, tile_sort_workgroups_,
                     output_width_, output_height_,
                     static_cast<float>(entry_buf_size * 2) / (1024.0f * 1024.0f),
                     scan_dispatch_size_, scan_num_blocks_);

        // Onesweep status buffer: 4 passes × 256 digits × max_workgroups
        onesweep_status_.destroy(allocator_);
        onesweep_max_wg_ = (tile_sort_capacity_ + 2047) / 2048;
        if (onesweep_max_wg_ == 0) onesweep_max_wg_ = 1;
        VkDeviceSize status_size = 4ull * 256ull * onesweep_max_wg_ * sizeof(uint32_t);
        onesweep_status_ = Buffer::create_storage_gpu_only(allocator_, status_size);
    }

    // ── Depth sort Onesweep buffers ──
    {
        // Status buffer: num_sort_passes × 256 digits × max_wg (shared across static/dynamic/legacy)
        depth_onesweep_max_wg_ = std::max({static_sort_workgroups_, dynamic_sort_workgroups_, num_sort_workgroups_});
        VkDeviceSize depth_status_size = static_cast<VkDeviceSize>(num_sort_passes_) * 256ull
                                         * depth_onesweep_max_wg_ * sizeof(uint32_t);
        depth_onesweep_status_ = Buffer::create_storage_gpu_only(allocator_, depth_status_size);

        // Params buffers (IndirectArgs layout: {wg_x, 1, 1, 0, 0, 0, entry_count, 0})
        auto fill_sort_params = [&](Buffer& buf, uint32_t wg_count, uint32_t entry_count) {
            buf = Buffer::create_storage(allocator_, 8 * sizeof(uint32_t));
            auto* p = static_cast<uint32_t*>(buf.mapped());
            p[0] = wg_count; p[1] = 1; p[2] = 1;
            p[3] = 0; p[4] = 0; p[5] = 0;
            p[6] = entry_count; p[7] = 0;
        };
        fill_sort_params(static_depth_params_, static_sort_workgroups_, static_sort_size_);
        fill_sort_params(dynamic_depth_params_, dynamic_sort_workgroups_, dynamic_sort_size_);
        fill_sort_params(depth_sort_params_, num_sort_workgroups_, sort_size_);

        std::fprintf(stderr, "GS: Depth sort Onesweep -- static=%u wg, dynamic=%u wg, status=%.1f KB\n",
                     static_sort_workgroups_, dynamic_sort_workgroups_,
                     static_cast<float>(depth_status_size) / 1024.0f);
    }

    // Page table: one uint32 per slab, initialized to 0xFFFFFFFF (invalid).
    // host_dst variant: reads happen on the GPU every frame; updates from
    // chunk-load completions are recorded as vkCmdUpdateBuffer onto the
    // current frame's cmd buffer with a TRANSFER_WRITE -> SHADER_READ barrier
    // so they don't tear under in-flight GPU reads.
    page_table_ssbo_ = Buffer::create_storage_host_dst(allocator_,
        static_cast<VkDeviceSize>(config.total_slabs()) * sizeof(uint32_t));
    std::memset(page_table_ssbo_.mapped(), 0xFF,
                config.total_slabs() * sizeof(uint32_t));

    // Chunk table: 256 entries x 16 bytes each, zeroed. Same host_dst
    // rationale as page_table.
    chunk_table_ssbo_ = Buffer::create_storage_host_dst(allocator_, 256 * 16);
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

    // Release old scene data — return slabs to allocator, reset tracking state.
    // Without this, loading a second scene appends to active_chunks_ and old
    // Gaussian data persists in GPU buffers (visual corruption + VRAM leak).
    for (auto& chunk : active_chunks_) {
        slab_allocator_->release(chunk.handle);
    }
    active_chunks_.clear();
    static_count_ = 0;
    total_active_splats_ = 0;

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
    // Verify the chunk actually exists before queuing — caller may
    // double-unload during world-streamer churn. We don't mutate
    // active_chunks_ here; publish_pending_chunks does the actual
    // removal (and the page_table/chunk_table writes) inside the
    // current frame's command buffer so the GPU-side metadata update
    // is properly ordered against in-flight reads.
    auto it = std::find_if(active_chunks_.begin(), active_chunks_.end(),
        [chunk_id](const ChunkState& c) { return c.handle.chunk_id == chunk_id; });
    if (it == active_chunks_.end()) return;

    PendingChunkPublication p;
    p.op = PendingChunkPublication::Op::Unload;
    p.unload_chunk_id = chunk_id;
    pending_publications_.push_back(std::move(p));
}

void GsRenderer::clear_chunks(VkCommandBuffer drain_cmd) {
    if (!streaming_initialized_ || !initialized_) return;

    // Wait for any in-flight transfers so we don't release slabs the GPU
    // is still writing to. Scene transitions are heavy operations
    // already; this matches the pre-streaming `load_cloud` behaviour.
    vkDeviceWaitIdle(device_);

    // Drain any completion callbacks queued by transfers that finished
    // during waitIdle. The dedicated transfer-family path needs a real
    // command buffer to record acquire barriers; with VK_NULL_HANDLE
    // poll_completions defers callbacks to the next frame, where they
    // would later fire against a freshly-loaded scene's slab indices
    // and corrupt state. Caller (Renderer::init_gs) provides
    // `drain_cmd`; for the single-queue (Apple/fallback) path
    // VK_NULL_HANDLE is also accepted because no acquire barriers
    // need recording.
    if (transfer_queue_) transfer_queue_->poll_completions(drain_cmd);

    // poll_completions above can fire transfer-completion callbacks that
    // enqueue new PendingChunkPublication entries referencing OLD-scene
    // slabs. If we don't drain them here, the next poll_transfers (after
    // the new scene has loaded) would publish stale page_table /
    // chunk_table writes for slabs the new scene never owned —
    // ghost-chunk metadata leaking across scene boundary. Same hazard
    // for deferred_slab_releases_: those handles' frame counters would
    // tick past after we wipe everything, releasing slabs that belong
    // to a freshly-checked-out new chunk.
    //
    // GPU is idle (vkDeviceWaitIdle above) so direct slab releases here
    // are safe.
    for (auto& p : pending_publications_) {
        // Op::Load owns slab handles not yet in active_chunks_ — release
        // them directly, otherwise they leak from the allocator.
        // Op::Unload's handle is empty: the actual chunk handle is still
        // in active_chunks_, released by the loop further down.
        if (p.op == PendingChunkPublication::Op::Load) {
            slab_allocator_->release(p.handle);
        }
    }
    pending_publications_.clear();

    for (auto& dr : deferred_slab_releases_) {
        slab_allocator_->release(dr.handle);
    }
    deferred_slab_releases_.clear();

    // Anything still in `pending_loads_` had its `submit_with_handle`
    // runs partially completed (or not at all) — those slab handles
    // own slabs we never published into `active_chunks_`. Release
    // them manually so the allocator can reuse those indices.
    for (auto& job : pending_loads_) {
        slab_allocator_->release(job.slab_handle);
    }
    pending_loads_.clear();

    for (auto& chunk : active_chunks_) slab_allocator_->release(chunk.handle);
    active_chunks_.clear();
    static_count_ = 0;
    total_active_splats_ = 0;
    gaussian_count_ = 0;
    dynamic_count_ = 0;
    sort_done_once_ = false;
    static_dirty_ = true;

    // Zero the dynamic SSBO so a future over-count of `dynamic_count_`
    // can't surface old-scene gaussians as ghost geometry. memset (not
    // vkCmdFillBuffer) because Buffer::create_storage omits TRANSFER_DST_BIT;
    // the buffer is HOST_VISIBLE+MAPPED, and `vkDeviceWaitIdle` above
    // guarantees the GPU is idle here.
    if (dynamic_gaussian_ssbo_.mapped() && max_dynamic_count_ > 0) {
        std::memset(dynamic_gaussian_ssbo_.mapped(), 0,
                    static_cast<size_t>(max_dynamic_count_) * sizeof(GpuGaussian));
    }

    // Reset the static depth-sort tail. The previous scene's last frame
    // left valid keys at indices [0, old_static_count_) in static_sort_a_/b_;
    // those entries survive `static_count_ = 0` because the depth-sort
    // shader only writes keys for [0, current_static_count_) each frame.
    // Without this reset, the next frame whose rebuild path skips
    // `update_static_gaussians` (e.g. the rebuild block runs but
    // `gs_static_buffer_.empty()`, or the count==0 early return fires)
    // will sort the stale keys to the front and the rasterizer will
    // dereference their indices into `static_gaussian_ssbo_` — which
    // still holds the previous scene's data at those offsets — producing
    // ghost geometry at the previous scene's world coordinates (the
    // "green splats from the overworld visible when zoomed out in the
    // dungeon" symptom). Same fix shape as 139f055b's chunk-Unload
    // rebuild flag, applied to the portal/scene-clear path.
    auto fill_sort_sentinel = [](Buffer& buf, uint32_t sort_size) {
        if (!buf.mapped() || sort_size == 0) return;
        auto* sort = static_cast<SortEntry*>(buf.mapped());
        for (uint32_t i = 0; i < sort_size; ++i) {
            sort[i].key   = 0xFFFFFFFFu;
            sort[i].index = 0;
        }
    };
    fill_sort_sentinel(static_sort_a_, static_sort_size_);
    fill_sort_sentinel(static_sort_b_, static_sort_size_);
    // Defense in depth: force the next camera-dirty frame's `need_rebuild`
    // gate to fire even if no other dirty signal is pending, so
    // `update_static_gaussians` re-runs `init_sort_buf` against the
    // freshly-loaded scene's count.
    static_sort_needs_reinit_ = true;

    // Invalidate the slab-indirection metadata. `publish_pending_chunks`'s
    // Unload path writes 0xFFFFFFFF sentinels to `page_table_ssbo_` for
    // each released slab + clears the chunk-table row, but `clear_chunks`
    // releases slabs by calling `slab_allocator_->release(...)` directly
    // and bypasses that path entirely. The stale entries survive: when
    // the new scene loads a smaller chunk set than the previous (e.g.
    // dungeon takes 1 slab where overworld used 25), only the reused
    // slabs' page-table entries get overwritten — the rest still point
    // at offsets in `static_gaussian_ssbo_` containing previous-scene
    // geometry data (the streaming path never zeroes the unused tail).
    // Anything in the rendering pipeline that walks the page/chunk
    // tables fetches that stale data.
    //
    // Both buffers were created HOST_VISIBLE+TRANSFER_DST and are
    // host-mapped (see init at line 851/858, which uses the same memset
    // pattern). vkDeviceWaitIdle above guarantees the GPU is idle, so
    // direct host writes are safe.
    if (page_table_ssbo_.mapped()) {
        std::memset(page_table_ssbo_.mapped(), 0xFF,
                    static_cast<size_t>(streaming_config_.total_slabs()) * sizeof(uint32_t));
    }
    if (chunk_table_ssbo_.mapped()) {
        std::memset(chunk_table_ssbo_.mapped(), 0, 256 * 16);
    }

    // Reset the visibility counts so the first post-portal frame doesn't
    // start by reading {static_visible, dynamic_visible, merged_visible}
    // values left over from the previous scene's last frame.
    if (counts_ssbo_.mapped()) {
        auto* counts = static_cast<uint32_t*>(counts_ssbo_.mapped());
        counts[0] = 0;
        counts[1] = 0;
        counts[2] = 0;
    }

    // Zero the static splat data itself. The previous scene's last
    // `update_static_gaussians` wrote the consolidated view to
    // `static_gaussian_ssbo_[0, old_count)`. Streaming-path uploads also
    // wrote individual chunks at slab offsets, leaving previous-scene
    // geometry data scattered across the buffer up to `max_static_count_`.
    // After the new scene loads, `update_static_gaussians` overwrites
    // `[0, new_count)` and the new chunk's streaming write overwrites its
    // slab — but every offset in `[new_count, max)` and every unused slab
    // still holds previous-scene geometry data. If anything in the
    // rendering pipeline reads those offsets (a path more subtle than
    // either the consolidated sort buffer or the slab-indirection
    // metadata, both of which we already invalidated above), the result
    // is ghost geometry at the previous scene's world coordinates.
    //
    // Buffer is HOST_VISIBLE+MAPPED (Buffer::create_storage). vkDeviceWaitIdle
    // above guarantees GPU is idle, so direct host writes are safe.
    // ~max_static_count_ × 64 bytes — at 11M splats that's ~700 MB of
    // memory bandwidth, ~3-5 ms on Apple Silicon's unified memory.
    // Acceptable for the one-time portal cost, eliminates the entire
    // class of stale-static-data ghost rendering.
    if (static_gaussian_ssbo_.mapped() && max_static_count_ > 0) {
        std::memset(static_gaussian_ssbo_.mapped(), 0,
                    static_cast<size_t>(max_static_count_) * sizeof(GpuGaussian));
    }
}

std::vector<GsRenderer::ChunkInventoryEntry> GsRenderer::chunk_inventory() const {
    std::vector<ChunkInventoryEntry> out;
    out.reserve(active_chunks_.size());
    for (const auto& c : active_chunks_) {
        const char* st = "active";
        switch (c.status) {
            case ChunkState::Status::LOADING:   st = "loading"; break;
            case ChunkState::Status::ACTIVE:    st = "active"; break;
            case ChunkState::Status::UNLOADING: st = "unloading"; break;
        }
        out.push_back({
            .status_str        = st,
            .page_table_offset = c.page_table_offset,
            .splat_count       = c.splat_count,
            .slab_count        = static_cast<uint32_t>(c.handle.slab_indices.size()),
        });
    }
    return out;
}

void GsRenderer::create_transfer_queue(VkQueue transfer_q, uint32_t transfer_family,
                                        uint32_t graphics_family, bool dedicated) {
    if (!streaming_initialized_) return;
    // Sized for double-buffered slab uploads plus headroom for in-flight
    // chunks before they retire on the fence — multi-batch concurrency now
    // matters because the queue accepts arbitrary destination buffers.
    const uint64_t staging_size = streaming_config_.slab_bytes() * 4;
    transfer_queue_ = std::make_unique<TransferQueue>(
        device_, allocator_,
        transfer_q, transfer_family, graphics_family,
        dedicated, staging_size,
        streaming_config_.transfer_budget_mb_per_frame);
}

std::vector<TransferQueue::Handle> GsRenderer::load_cloud_async(GaussianCloud cloud) {
    if (!streaming_initialized_ || !transfer_queue_) {
        // No streaming infra: fall through to the synchronous path. Returning
        // an empty handle list lets EngineLoadingMonitor advance on its
        // min-duration timer alone (since `tick` already treats Unknown
        // handles as resolved).
        load_cloud(cloud);
        return {};
    }
    if (cloud.empty()) return {};

    // Append-only semantics. The new chunk is checked out from the slab
    // allocator and pushed onto `active_chunks_` by the final completion
    // callback — existing chunks are *not* released. Callers that need
    // "replace previous scene" must explicitly clear before this call
    // (the initial demo load arrives on an empty `active_chunks_`
    // straight out of `init_streaming`, so this matches the documented
    // contract for both code paths). The synchronous `load_cloud` is
    // still the right tool when a true scene replacement is needed —
    // it does the `vkDeviceWaitIdle` + chunk release in one shot.
    //
    // Multiple concurrent loads queue up on `pending_loads_` instead of
    // being rejected — WorldStreamer marks each chunk `LOADING` once
    // and never retries, so a rejected request would stick forever.
    const uint32_t sps = streaming_config_.slab_size_splats;
    const uint32_t splat_count = cloud.count();
    const uint32_t slabs_needed = (splat_count + sps - 1) / sps;

    PendingLoadJob job;
    job.slab_handle = slab_allocator_->checkout(slabs_needed);
    job.splat_count = splat_count;
    job.slabs_needed = slabs_needed;
    job.slab_size_splats = sps;
    job.handles.reserve(slabs_needed);
    for (uint32_t s = 0; s < slabs_needed; ++s) {
        job.handles.push_back(transfer_queue_->reserve_handle());
    }
    job.cloud = std::move(cloud);

    std::vector<TransferQueue::Handle> handles_for_caller = job.handles;
    pending_loads_.push_back(std::move(job));
    return handles_for_caller;
}

void GsRenderer::poll_transfers(VkCommandBuffer frame_cmd) {
    if (!transfer_queue_) return;
    // Diagnostic: full poll path covers slab-upload submits, completion
    // callback drains, deferred slab releases, and the metadata publish.
    // If the beachball is in any of those paths, this fires.
    ScopedStallTimer _t_poll{"GsRenderer::poll_transfers"};

    // Drain queued slab uploads as long as the staging ring has space.
    // We process the front job's slabs, then advance to the next job
    // when a job is fully submitted. The ring naturally throttles
    // multi-job uploads — when a slab can't fit, we break and resume
    // next frame. Each job's completion callback writes its chunk to
    // `active_chunks_`, so multiple chunks can be in flight via the
    // GPU fence without conflict.
    const VkBuffer dest = static_gaussian_ssbo_.buffer();
    while (!pending_loads_.empty()) {
        auto& job = pending_loads_.front();

        // Submit any remaining slabs from this job.
        bool ring_full = false;
        while (job.next_slab < job.slabs_needed) {
            const uint32_t s = job.next_slab;
            const uint32_t physical_slab = job.slab_handle.slab_indices[s];
            const uint32_t src_start = s * job.slab_size_splats;
            const uint32_t src_end   = std::min(src_start + job.slab_size_splats, job.splat_count);
            const uint32_t count     = src_end - src_start;
            const uint64_t copy_size = static_cast<uint64_t>(count) * sizeof(GpuGaussian);

            auto res = transfer_queue_->reserve_staging(copy_size);
            if (!res) { ring_full = true; break; }

            const auto& gaussians = job.cloud.gaussians();
            auto* dst = reinterpret_cast<GpuGaussian*>(res->host_ptr);
            for (uint32_t i = 0; i < count; ++i) {
                const auto& g = gaussians[src_start + i];
                float bone_as_float;
                uint32_t bone_idx = g.bone_index;
                std::memcpy(&bone_as_float, &bone_idx, sizeof(float));
                dst[i].pos_opacity = glm::vec4(g.position, g.opacity);
                dst[i].scale_pad   = glm::vec4(g.scale, bone_as_float);
                dst[i].rot         = glm::vec4(g.rotation.x, g.rotation.y, g.rotation.z, g.rotation.w);
                dst[i].color_pad   = glm::vec4(g.color, g.emission);
            }

            const uint64_t dest_offset =
                static_cast<uint64_t>(physical_slab) * job.slab_size_splats * sizeof(GpuGaussian);
            transfer_queue_->submit_with_handle(job.handles[s], *res, dest, dest_offset);
            ++job.next_slab;
        }

        if (job.next_slab < job.slabs_needed) {
            // Couldn't finish this job (ring full); break out so we
            // try again next frame. Don't advance to the next job —
            // each job's completion callback expects to fire AFTER
            // the previous job's completion has already mutated
            // `active_chunks_` and `static_count_`, so we serialise
            // job completions in order.
            (void)ring_full;
            break;
        }

        // Front job is fully submitted. Queue the completion marker —
        // exactly once per job. The fence-retire callback only enqueues a
        // PendingChunkPublication; the actual page_table / chunk_table
        // writes happen later on the current frame's command buffer in
        // publish_pending_chunks(). That serialises the metadata update
        // through the GPU command stream so it can't tear under in-flight
        // shader reads.
        if (!job.completion_enqueued) {
            job.completion_enqueued = true;
            auto handle      = std::move(job.slab_handle);
            const uint32_t splat_count  = job.splat_count;
            const uint32_t slabs_needed = job.slabs_needed;
            const uint32_t sps_local    = job.slab_size_splats;

            transfer_queue_->enqueue_completion(
                [this, handle = std::move(handle), splat_count, slabs_needed, sps_local]() mutable {
                    PendingChunkPublication p;
                    p.op = PendingChunkPublication::Op::Load;
                    p.handle = std::move(handle);
                    p.splat_count = splat_count;
                    p.slabs_needed = slabs_needed;
                    p.slab_size_splats = sps_local;
                    pending_publications_.push_back(std::move(p));
                });
        }

        // Done queuing this job — drop it from the deque. The completion
        // lambda has already moved the slab handle into its own capture.
        pending_loads_.pop_front();
    }

    transfer_queue_->poll_completions(frame_cmd);
    publish_pending_chunks(frame_cmd);
}

void GsRenderer::publish_pending_chunks(VkCommandBuffer cmd) {
    // Step 1: tick the deferred-release queue *before* doing anything that
    // might check out new slabs. Slabs whose hold-time has expired are
    // returned to the allocator now so they're available for incoming load
    // publications below. Slabs queued THIS call (from an Unload op below)
    // start their countdown on the next poll_transfers tick.
    if (!deferred_slab_releases_.empty()) {
        auto it = deferred_slab_releases_.begin();
        while (it != deferred_slab_releases_.end()) {
            if (it->frames_remaining == 0) {
                slab_allocator_->release(it->handle);
                it = deferred_slab_releases_.erase(it);
            } else {
                --it->frames_remaining;
                ++it;
            }
        }
    }

    if (pending_publications_.empty()) return;
    if (cmd == VK_NULL_HANDLE) return;

    bool any_published = false;
    bool chunk_table_needs_full_rebuild = false;

    while (!pending_publications_.empty()) {
        PendingChunkPublication p = std::move(pending_publications_.front());
        pending_publications_.pop_front();

        if (p.op == PendingChunkPublication::Op::Load) {
            // === LOAD ===
            // Page table offset for this chunk = sum of slab counts of all
            // already-active chunks. Computed sequentially as we publish.
            uint32_t page_table_offset = 0;
            for (const auto& chunk : active_chunks_) {
                page_table_offset += static_cast<uint32_t>(chunk.handle.slab_indices.size());
            }

            // page_table entries: one uint32 (the physical slab index) per
            // slab owned by this chunk. vkCmdUpdateBuffer is bounded to
            // 65536 bytes; a typical chunk has <=100 slabs (400 bytes).
            if (!p.handle.slab_indices.empty()) {
                const VkDeviceSize pt_offset_bytes =
                    static_cast<VkDeviceSize>(page_table_offset) * sizeof(uint32_t);
                const VkDeviceSize pt_size_bytes =
                    static_cast<VkDeviceSize>(p.handle.slab_indices.size()) * sizeof(uint32_t);
                if (pt_size_bytes <= 65536) {
                    vkCmdUpdateBuffer(cmd, page_table_ssbo_.buffer(),
                                      pt_offset_bytes, pt_size_bytes,
                                      p.handle.slab_indices.data());
                } else {
                    std::fprintf(stderr,
                        "[gs_renderer] publish: page_table update %llu bytes "
                        "exceeds vkCmdUpdateBuffer 65536-byte limit; chunk has "
                        "%zu slabs\n",
                        static_cast<unsigned long long>(pt_size_bytes),
                        p.handle.slab_indices.size());
                }
            }

            // chunk_table entry: 16 bytes at index `chunk_idx * 16`. If a
            // sibling Unload publication runs after this one, that Unload
            // path rewrites the full table (chunk indices shift), so this
            // single-entry write may be overwritten — that's the correct
            // outcome. Either way, the recorded vkCmdUpdateBuffers run in
            // recorded order on the GPU, so the final state matches CPU
            // active_chunks_.
            const uint32_t chunk_idx = static_cast<uint32_t>(active_chunks_.size());
            const uint32_t last_slab_splats =
                p.splat_count - (p.slabs_needed - 1) * p.slab_size_splats;
            const uint32_t entry[4] = {page_table_offset, p.slabs_needed,
                                        last_slab_splats, p.splat_count};
            vkCmdUpdateBuffer(cmd, chunk_table_ssbo_.buffer(),
                              static_cast<VkDeviceSize>(chunk_idx) * 16,
                              sizeof(entry), entry);

            ChunkState cs;
            cs.status = ChunkState::Status::ACTIVE;
            cs.handle = std::move(p.handle);
            cs.page_table_offset = page_table_offset;
            cs.splat_count = p.splat_count;
            active_chunks_.push_back(std::move(cs));

            std::fprintf(stderr,
                "GS: Async load complete — %u splats in %u slabs (total active: %u)\n",
                p.splat_count, p.slabs_needed,
                [this]() { uint32_t s = 0; for (auto& c : active_chunks_) s += c.splat_count; return s; }());

        } else {
            // === UNLOAD ===
            auto it = std::find_if(active_chunks_.begin(), active_chunks_.end(),
                [&](const ChunkState& c) { return c.handle.chunk_id == p.unload_chunk_id; });
            if (it == active_chunks_.end()) {
                // The chunk was already gone (double-unload races, or a
                // clear_chunks ran between unload_cloud() and publish).
                // Nothing to write; nothing to release.
                continue;
            }

            // Step 1: invalidate this chunk's page_table entries. Write
            // 0xFFFFFFFF (the configured sentinel) for every slab the chunk
            // owned at `it->page_table_offset`. The GPU dispatches recorded
            // later in this same cmd buffer (post-barrier) read these
            // sentinel entries and skip the slot. The PRIOR frame, which
            // saw the old entries, has already retired (we waited on its
            // fence) — so no in-flight read of the old slabs persists past
            // this cmd buffer's submission.
            const uint32_t nslabs = static_cast<uint32_t>(it->handle.slab_indices.size());
            if (nslabs > 0) {
                std::vector<uint32_t> sentinel(nslabs, 0xFFFFFFFFu);
                const VkDeviceSize pt_offset_bytes =
                    static_cast<VkDeviceSize>(it->page_table_offset) * sizeof(uint32_t);
                const VkDeviceSize pt_size_bytes =
                    static_cast<VkDeviceSize>(nslabs) * sizeof(uint32_t);
                if (pt_size_bytes <= 65536) {
                    vkCmdUpdateBuffer(cmd, page_table_ssbo_.buffer(),
                                      pt_offset_bytes, pt_size_bytes, sentinel.data());
                } else {
                    std::fprintf(stderr,
                        "[gs_renderer] publish: unload page_table sentinel %llu bytes "
                        "exceeds vkCmdUpdateBuffer 65536-byte limit\n",
                        static_cast<unsigned long long>(pt_size_bytes));
                }
            }

            // Step 2: hand the slab handle to the deferred-release queue.
            // It survives at least kMaxFramesInFlight ticks of poll_transfers
            // before the allocator gets it back, so a concurrent Load
            // publication can't claim these physical slabs and overwrite
            // them while the prior frame's GPU read is still in flight.
            DeferredSlabRelease dr;
            dr.handle = std::move(it->handle);
            dr.frames_remaining = kMaxFramesInFlight + 1;
            deferred_slab_releases_.push_back(std::move(dr));

            // Step 3: erase from active_chunks_. Other chunks' indices
            // shift, so chunk_table needs a full rewrite below.
            active_chunks_.erase(it);
            chunk_table_needs_full_rebuild = true;

            // Step 4: flag the static sort buffers as needing a sentinel-
            // tail reinit. This unload shrinks static_count_, so entries
            // [new_count, old_count) in static_sort_a_/b_ now hold stale
            // REAL depth keys from the prior frame's sort. Without a
            // reinit they'd participate in the next preprocess+sort+merge
            // as legitimate elements (their keys aren't 0xFFFFFFFF
            // sentinels), corrupting the merged-sort output. We can't
            // safely host-write to the sort buffer here (race vs the
            // in-flight prior frame's GPU read), so we defer: the flag
            // is picked up by Renderer::draw_scene's need_rebuild gate
            // on the next camera-dirty frame, and update_static_gaussians
            // re-runs init_sort_buf to restore the sentinel-tail invariant.
            static_sort_needs_reinit_ = true;
        }

        any_published = true;
    }

    // If any unload happened, chunk indices in active_chunks_ shifted, so
    // the chunk_table on the GPU now references stale data. Rewrite the
    // valid prefix and zero the tail. 256 entries × 16 B = 4 KiB — fits
    // vkCmdUpdateBuffer's 65536-byte limit easily.
    if (chunk_table_needs_full_rebuild) {
        std::array<uint32_t, 256 * 4> ct_data{};  // zero-initialised
        const uint32_t sps = streaming_config_.slab_size_splats;
        for (size_t i = 0; i < active_chunks_.size(); ++i) {
            const auto& c = active_chunks_[i];
            const uint32_t cn = static_cast<uint32_t>(c.handle.slab_indices.size());
            const uint32_t last_slab_splats = c.splat_count - (cn - 1) * sps;
            ct_data[i * 4 + 0] = c.page_table_offset;
            ct_data[i * 4 + 1] = cn;
            ct_data[i * 4 + 2] = last_slab_splats;
            ct_data[i * 4 + 3] = c.splat_count;
        }
        vkCmdUpdateBuffer(cmd, chunk_table_ssbo_.buffer(), 0,
                          static_cast<VkDeviceSize>(ct_data.size()) * sizeof(uint32_t),
                          ct_data.data());
    }

    if (any_published) {
        // Recompute counts on the CPU side in the same step so the next
        // frame's render() sees a consistent {static_count_, page_table,
        // chunk_table} triple. The GPU reads the new metadata only after
        // the barrier below, so a graphics dispatch recorded *later* in
        // this same cmd buffer will see fresh data.
        static_count_ = 0;
        for (const auto& c : active_chunks_) static_count_ += c.splat_count;
        total_active_splats_ = static_count_;
        gaussian_count_ = static_count_;
        static_dirty_ = true;

        // Note: we deliberately do NOT reinitialise static_sort_a_ /
        // static_sort_b_ here. The depth sort regenerates keys for
        // [0, static_count_) every frame, and entries beyond
        // static_count_ retain their 0xFFFFFFFF sentinel keys from the
        // original sort buffer init (in load_cloud_legacy / load_cloud).

        // Single barrier covering both metadata buffers: TRANSFER_WRITE
        // (vkCmdUpdateBuffer's effective stage) -> SHADER_READ. Without
        // this, subsequent compute dispatches in the same cmd buffer
        // could read the metadata with the writes still in flight.
        VkBufferMemoryBarrier barriers[2]{};
        barriers[0].sType = VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER;
        barriers[0].srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
        barriers[0].dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
        barriers[0].srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        barriers[0].dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        barriers[0].buffer = page_table_ssbo_.buffer();
        barriers[0].offset = 0;
        barriers[0].size = VK_WHOLE_SIZE;
        barriers[1] = barriers[0];
        barriers[1].buffer = chunk_table_ssbo_.buffer();

        vkCmdPipelineBarrier(cmd,
            VK_PIPELINE_STAGE_TRANSFER_BIT,
            VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
            0, 0, nullptr, 2, barriers, 0, nullptr);
    }
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

    // Helper: compute sort size (aligned to Onesweep ENTRIES_PER_WG = 2048)
    auto compute_sort_params = [](uint32_t max_count, uint32_t& sort_size, uint32_t& num_wg) {
        sort_size = ((max_count + 2047) / 2048) * 2048;
        if (sort_size < max_count) sort_size = max_count;
        num_wg = sort_size / 2048;
        if (num_wg == 0) num_wg = 1;
        sort_size = num_wg * 2048;
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

    // Destroy ALL old buffers (legacy + split)
    gaussian_ssbo_.destroy(allocator_);
    projected_ssbo_.destroy(allocator_);
    sort_keys_ssbo_.destroy(allocator_);
    sort_b_ssbo_.destroy(allocator_);
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
    merged_sort_ssbo_ = Buffer::create_storage(allocator_, merged_sort_buf_size);
    counts_ssbo_ = Buffer::create_storage_readback(allocator_, 3 * sizeof(uint32_t));  // {static_visible, dynamic_visible, merged_visible}
    uniform_buffer_ = Buffer::create_uniform(allocator_, sizeof(GsUniforms));
    visible_count_ssbo_ = Buffer::create_storage_readback(allocator_, sizeof(uint32_t));

    // Legacy gaussian_ssbo_ aliases static for backward compat
    gaussian_ssbo_ = Buffer::create_storage(allocator_,
        static_cast<VkDeviceSize>(max_gaussian_count_) * sizeof(GpuGaussian));
    sort_keys_ssbo_ = Buffer::create_storage(allocator_, static_sort_buf_size);
    sort_b_ssbo_ = Buffer::create_storage(allocator_, static_sort_buf_size);

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
    page_table_ssbo_ = Buffer::create_storage_host_dst(allocator_, sizeof(uint32_t));
    {
        auto* pt = static_cast<uint32_t*>(page_table_ssbo_.mapped());
        pt[0] = 0xFFFFFFFF;
    }

    // ── Tile binning buffers (same logic as init_streaming) ──
    {
        uint32_t visible_upper = static_sort_size_ + dynamic_sort_size_;
        tile_sort_capacity_ = std::min(visible_upper * 4, 1u << 21);  // cap at 2M (16MB per buffer)
        tile_sort_size_ = ((tile_sort_capacity_ + 2047) / 2048) * 2048;
        tile_sort_workgroups_ = tile_sort_size_ / 2048;
        if (tile_sort_workgroups_ == 0) tile_sort_workgroups_ = 1;
        tile_sort_size_ = tile_sort_workgroups_ * 2048;

        VkDeviceSize entry_buf_size = static_cast<VkDeviceSize>(tile_sort_size_) * 8;  // 8 bytes/entry
        // Allocate tile_ranges for max possible resolution (output_width_ may not
        // reflect final size at allocation time). Generous upper bound.
        static constexpr uint32_t kMaxTiles = 256 * 144;  // supports up to 4096×2304
        VkDeviceSize ranges_buf_size = static_cast<VkDeviceSize>(kMaxTiles) * 2 * sizeof(uint32_t);

        // Deterministic tile-bin (Fix B) intermediate SSBOs.
        scan_dispatch_size_ = ((visible_upper + 255u) / 256u) * 256u;
        if (scan_dispatch_size_ == 0) scan_dispatch_size_ = 256u;
        scan_num_blocks_ = scan_dispatch_size_ / 256u;
        VkDeviceSize per_splat_buf_size =
            static_cast<VkDeviceSize>(scan_dispatch_size_) * sizeof(uint32_t);
        VkDeviceSize block_sums_buf_size =
            static_cast<VkDeviceSize>(scan_num_blocks_) * sizeof(uint32_t);

        tile_sort_a_.destroy(allocator_);
        tile_sort_b_.destroy(allocator_);
        tile_sort_count_ssbo_.destroy(allocator_);
        tile_ranges_ssbo_.destroy(allocator_);
        tile_indirect_args_.destroy(allocator_);
        per_splat_tile_count_ssbo_.destroy(allocator_);
        per_splat_tile_offset_ssbo_.destroy(allocator_);
        scan_block_sums_ssbo_.destroy(allocator_);
        determinism_readback_.destroy(allocator_);

        tile_sort_a_ = Buffer::create_storage_gpu_only(allocator_, entry_buf_size);
        tile_sort_b_ = Buffer::create_storage_gpu_only(allocator_, entry_buf_size);
        tile_sort_count_ssbo_ = Buffer::create_storage_readback(allocator_, sizeof(uint32_t));
        tile_ranges_ssbo_ = Buffer::create_storage_gpu_only(allocator_, ranges_buf_size);
        tile_indirect_args_ = Buffer::create_storage_indirect(allocator_, 8 * sizeof(uint32_t));
        std::memset(tile_indirect_args_.mapped(), 0, 8 * sizeof(uint32_t));
        per_splat_tile_count_ssbo_ =
            Buffer::create_storage_gpu_only(allocator_, per_splat_buf_size);
        per_splat_tile_offset_ssbo_ =
            Buffer::create_storage_gpu_only(allocator_, per_splat_buf_size);
        scan_block_sums_ssbo_ =
            Buffer::create_storage_gpu_only(allocator_, block_sums_buf_size);
        determinism_readback_ = Buffer::create_readback(allocator_, entry_buf_size);
        determinism_readback_size_ = entry_buf_size;

        std::fprintf(stderr, "GS: Tile sort -- capacity=%u entries (%u workgroups), "
                     "output=%ux%u, buf=%.1f MB; scan=%u elems / %u blocks\n",
                     tile_sort_size_, tile_sort_workgroups_,
                     output_width_, output_height_,
                     static_cast<float>(entry_buf_size * 2) / (1024.0f * 1024.0f),
                     scan_dispatch_size_, scan_num_blocks_);

        // Onesweep status buffer: 4 passes × 256 digits × max_workgroups
        onesweep_status_.destroy(allocator_);
        onesweep_max_wg_ = (tile_sort_capacity_ + 2047) / 2048;
        if (onesweep_max_wg_ == 0) onesweep_max_wg_ = 1;
        VkDeviceSize status_size = 4ull * 256ull * onesweep_max_wg_ * sizeof(uint32_t);
        onesweep_status_ = Buffer::create_storage_gpu_only(allocator_, status_size);
    }

    // ── Depth sort Onesweep buffers ──
    {
        depth_onesweep_status_.destroy(allocator_);
        depth_sort_params_.destroy(allocator_);
        static_depth_params_.destroy(allocator_);
        dynamic_depth_params_.destroy(allocator_);

        depth_onesweep_max_wg_ = std::max({static_sort_workgroups_, dynamic_sort_workgroups_, num_sort_workgroups_});
        VkDeviceSize depth_status_size = static_cast<VkDeviceSize>(num_sort_passes_) * 256ull
                                         * depth_onesweep_max_wg_ * sizeof(uint32_t);
        depth_onesweep_status_ = Buffer::create_storage_gpu_only(allocator_, depth_status_size);

        auto fill_sort_params = [&](Buffer& buf, uint32_t wg_count, uint32_t entry_count) {
            buf = Buffer::create_storage(allocator_, 8 * sizeof(uint32_t));
            auto* p = static_cast<uint32_t*>(buf.mapped());
            p[0] = wg_count; p[1] = 1; p[2] = 1;
            p[3] = 0; p[4] = 0; p[5] = 0;
            p[6] = entry_count; p[7] = 0;
        };
        fill_sort_params(static_depth_params_, static_sort_workgroups_, static_sort_size_);
        fill_sort_params(dynamic_depth_params_, dynamic_sort_workgroups_, dynamic_sort_size_);
        fill_sort_params(depth_sort_params_, num_sort_workgroups_, sort_size_);
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
    // Sentinel tail just rewritten — unblock the rebuild-skip fast path.
    static_sort_needs_reinit_ = false;
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

    // Recalculate sort sizes (aligned to Onesweep ENTRIES_PER_WG = 2048)
    sort_size_ = ((max_gaussian_count_ + 2047) / 2048) * 2048;
    if (sort_size_ < max_gaussian_count_) sort_size_ = max_gaussian_count_;
    num_sort_workgroups_ = sort_size_ / 2048;
    if (num_sort_workgroups_ == 0) num_sort_workgroups_ = 1;
    sort_size_ = num_sort_workgroups_ * 2048;

    VkDeviceSize gaussian_buf_size = static_cast<VkDeviceSize>(max_gaussian_count_) * sizeof(GpuGaussian);
    VkDeviceSize projected_buf_size = static_cast<VkDeviceSize>(max_gaussian_count_) * sizeof(ProjectedSplat);
    VkDeviceSize sort_buf_size = static_cast<VkDeviceSize>(sort_size_) * sizeof(SortEntry);

    // Reallocate legacy GPU buffers
    gaussian_ssbo_.destroy(allocator_);
    sort_keys_ssbo_.destroy(allocator_);
    sort_b_ssbo_.destroy(allocator_);
    // Only reallocate projected if split buffers aren't managing it
    if (!static_gaussian_ssbo_.buffer()) {
        projected_ssbo_.destroy(allocator_);
        projected_ssbo_ = Buffer::create_storage(allocator_, projected_buf_size);
    }

    gaussian_ssbo_ = Buffer::create_storage(allocator_, gaussian_buf_size);
    sort_keys_ssbo_ = Buffer::create_storage(allocator_, sort_buf_size);
    sort_b_ssbo_ = Buffer::create_storage(allocator_, sort_buf_size);

    // Update depth sort params buffer
    depth_sort_params_.destroy(allocator_);
    depth_sort_params_ = Buffer::create_storage(allocator_, 8 * sizeof(uint32_t));
    {
        auto* p = static_cast<uint32_t*>(depth_sort_params_.mapped());
        p[0] = num_sort_workgroups_; p[1] = 1; p[2] = 1;
        p[3] = 0; p[4] = 0; p[5] = 0;
        p[6] = sort_size_; p[7] = 0;
    }
    // Resize depth status buffer if needed
    if (num_sort_workgroups_ > depth_onesweep_max_wg_) {
        depth_onesweep_max_wg_ = num_sort_workgroups_;
        depth_onesweep_status_.destroy(allocator_);
        VkDeviceSize depth_status_size = static_cast<VkDeviceSize>(num_sort_passes_) * 256ull
                                         * depth_onesweep_max_wg_ * sizeof(uint32_t);
        depth_onesweep_status_ = Buffer::create_storage_gpu_only(allocator_, depth_status_size);
    }

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
    // Per-frame: each render_sets_[i] binds output_views_[i] / depth_views_[i].
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        VkDescriptorBufferInfo projected_info{projected_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo sort_info{sort_keys_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo uniform_info{uniform_buffer_.buffer(), 0, sizeof(GsUniforms)};
        VkDescriptorImageInfo image_info{VK_NULL_HANDLE, output_views_[f], VK_IMAGE_LAYOUT_GENERAL};
        VkDescriptorBufferInfo visible_count_info{visible_count_ssbo_.buffer(), 0, sizeof(uint32_t)};
        VkDescriptorImageInfo depth_img_info{VK_NULL_HANDLE, depth_views_[f], VK_IMAGE_LAYOUT_GENERAL};

        VkDescriptorSet set = render_sets_[f];
        VkWriteDescriptorSet writes[] = {
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 0, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &projected_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 1, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &sort_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 2, 0, 1,
             VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, nullptr, &uniform_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 3, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, &image_info, nullptr, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 4, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &visible_count_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 5, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, &depth_img_info, nullptr, nullptr},
        };
        vkUpdateDescriptorSets(device_, 6, writes, 0, nullptr);
    }

    // Post-process set: input_image(0), depth_image(1), processed_image(2), pp_ubo(3)
    // Per-frame: each post_process_sets_[i] binds frame i's output, depth, processed views.
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        VkDescriptorImageInfo input_info{VK_NULL_HANDLE, output_views_[f], VK_IMAGE_LAYOUT_GENERAL};
        VkDescriptorImageInfo depth_info{VK_NULL_HANDLE, depth_views_[f], VK_IMAGE_LAYOUT_GENERAL};
        VkDescriptorImageInfo proc_info{VK_NULL_HANDLE, processed_views_[f], VK_IMAGE_LAYOUT_GENERAL};
        VkDescriptorBufferInfo ubo_info{pp_ubo_buffer_.buffer(), 0, sizeof(GsPostProcessUbo)};

        VkDescriptorSet set = post_process_sets_[f];
        VkWriteDescriptorSet writes[] = {
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 0, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, &input_info, nullptr, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 1, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, &depth_info, nullptr, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 2, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, &proc_info, nullptr, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 3, 0, 1,
             VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, nullptr, &ubo_info, nullptr},
        };
        vkUpdateDescriptorSets(device_, 4, writes, 0, nullptr);
    }

    // Depth Onesweep descriptor sets (legacy path) — same layout as tile Onesweep
    if (depth_onesweep_status_.buffer() && depth_sort_params_.buffer()) {
        auto write_depth_onesweep_sets = [&](
            VkDescriptorSet hist_a, VkDescriptorSet hist_b,
            VkDescriptorSet scatter_ab, VkDescriptorSet scatter_ba,
            VkBuffer sort_a, VkBuffer sort_b,
            VkBuffer status_buf, VkBuffer params_buf) {
            // Histogram A: input(0), status(1), params(2)
            {
                VkDescriptorBufferInfo in_info{sort_a, 0, VK_WHOLE_SIZE};
                VkDescriptorBufferInfo st_info{status_buf, 0, VK_WHOLE_SIZE};
                VkDescriptorBufferInfo pm_info{params_buf, 0, VK_WHOLE_SIZE};
                VkWriteDescriptorSet writes[] = {
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, hist_a, 0, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &in_info, nullptr},
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, hist_a, 1, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &st_info, nullptr},
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, hist_a, 2, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &pm_info, nullptr},
                };
                vkUpdateDescriptorSets(device_, 3, writes, 0, nullptr);
            }
            // Histogram B
            {
                VkDescriptorBufferInfo in_info{sort_b, 0, VK_WHOLE_SIZE};
                VkDescriptorBufferInfo st_info{status_buf, 0, VK_WHOLE_SIZE};
                VkDescriptorBufferInfo pm_info{params_buf, 0, VK_WHOLE_SIZE};
                VkWriteDescriptorSet writes[] = {
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, hist_b, 0, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &in_info, nullptr},
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, hist_b, 1, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &st_info, nullptr},
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, hist_b, 2, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &pm_info, nullptr},
                };
                vkUpdateDescriptorSets(device_, 3, writes, 0, nullptr);
            }
            // Scatter A→B: input(0), output(1), status(2), params(3)
            {
                VkDescriptorBufferInfo in_info{sort_a, 0, VK_WHOLE_SIZE};
                VkDescriptorBufferInfo out_info{sort_b, 0, VK_WHOLE_SIZE};
                VkDescriptorBufferInfo st_info{status_buf, 0, VK_WHOLE_SIZE};
                VkDescriptorBufferInfo pm_info{params_buf, 0, VK_WHOLE_SIZE};
                VkWriteDescriptorSet writes[] = {
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, scatter_ab, 0, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &in_info, nullptr},
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, scatter_ab, 1, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &out_info, nullptr},
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, scatter_ab, 2, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &st_info, nullptr},
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, scatter_ab, 3, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &pm_info, nullptr},
                };
                vkUpdateDescriptorSets(device_, 4, writes, 0, nullptr);
            }
            // Scatter B→A
            {
                VkDescriptorBufferInfo in_info{sort_b, 0, VK_WHOLE_SIZE};
                VkDescriptorBufferInfo out_info{sort_a, 0, VK_WHOLE_SIZE};
                VkDescriptorBufferInfo st_info{status_buf, 0, VK_WHOLE_SIZE};
                VkDescriptorBufferInfo pm_info{params_buf, 0, VK_WHOLE_SIZE};
                VkWriteDescriptorSet writes[] = {
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, scatter_ba, 0, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &in_info, nullptr},
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, scatter_ba, 1, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &out_info, nullptr},
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, scatter_ba, 2, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &st_info, nullptr},
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, scatter_ba, 3, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &pm_info, nullptr},
                };
                vkUpdateDescriptorSets(device_, 4, writes, 0, nullptr);
            }
        };

        // Legacy depth sort sets
        write_depth_onesweep_sets(
            depth_hist_set_a_, depth_hist_set_b_,
            depth_scatter_set_ab_, depth_scatter_set_ba_,
            sort_keys_ssbo_.buffer(), sort_b_ssbo_.buffer(),
            depth_onesweep_status_.buffer(), depth_sort_params_.buffer());
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

    // Static/dynamic depth Onesweep descriptor sets (reuse lambda from above if available)
    if (depth_onesweep_status_.buffer() && static_depth_params_.buffer()) {
        auto write_depth_onesweep_sets = [&](
            VkDescriptorSet hist_a, VkDescriptorSet hist_b,
            VkDescriptorSet scatter_ab, VkDescriptorSet scatter_ba,
            VkBuffer sort_a, VkBuffer sort_b,
            VkBuffer status_buf, VkBuffer params_buf) {
            VkDescriptorBufferInfo st_info{status_buf, 0, VK_WHOLE_SIZE};
            VkDescriptorBufferInfo pm_info{params_buf, 0, VK_WHOLE_SIZE};
            // Histogram A
            { VkDescriptorBufferInfo in_info{sort_a, 0, VK_WHOLE_SIZE};
              VkWriteDescriptorSet w[] = {
                  {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, hist_a, 0, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &in_info, nullptr},
                  {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, hist_a, 1, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &st_info, nullptr},
                  {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, hist_a, 2, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &pm_info, nullptr},
              }; vkUpdateDescriptorSets(device_, 3, w, 0, nullptr); }
            // Histogram B
            { VkDescriptorBufferInfo in_info{sort_b, 0, VK_WHOLE_SIZE};
              VkWriteDescriptorSet w[] = {
                  {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, hist_b, 0, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &in_info, nullptr},
                  {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, hist_b, 1, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &st_info, nullptr},
                  {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, hist_b, 2, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &pm_info, nullptr},
              }; vkUpdateDescriptorSets(device_, 3, w, 0, nullptr); }
            // Scatter A→B
            { VkDescriptorBufferInfo in_info{sort_a, 0, VK_WHOLE_SIZE}; VkDescriptorBufferInfo out_info{sort_b, 0, VK_WHOLE_SIZE};
              VkWriteDescriptorSet w[] = {
                  {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, scatter_ab, 0, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &in_info, nullptr},
                  {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, scatter_ab, 1, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &out_info, nullptr},
                  {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, scatter_ab, 2, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &st_info, nullptr},
                  {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, scatter_ab, 3, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &pm_info, nullptr},
              }; vkUpdateDescriptorSets(device_, 4, w, 0, nullptr); }
            // Scatter B→A
            { VkDescriptorBufferInfo in_info{sort_b, 0, VK_WHOLE_SIZE}; VkDescriptorBufferInfo out_info{sort_a, 0, VK_WHOLE_SIZE};
              VkWriteDescriptorSet w[] = {
                  {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, scatter_ba, 0, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &in_info, nullptr},
                  {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, scatter_ba, 1, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &out_info, nullptr},
                  {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, scatter_ba, 2, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &st_info, nullptr},
                  {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, scatter_ba, 3, 0, 1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &pm_info, nullptr},
              }; vkUpdateDescriptorSets(device_, 4, w, 0, nullptr); }
        };

        // Static depth sort
        write_depth_onesweep_sets(
            static_depth_hist_set_a_, static_depth_hist_set_b_,
            static_depth_scatter_set_ab_, static_depth_scatter_set_ba_,
            static_sort_a_.buffer(), static_sort_b_.buffer(),
            depth_onesweep_status_.buffer(), static_depth_params_.buffer());
        // Dynamic depth sort
        write_depth_onesweep_sets(
            dynamic_depth_hist_set_a_, dynamic_depth_hist_set_b_,
            dynamic_depth_scatter_set_ab_, dynamic_depth_scatter_set_ba_,
            dynamic_sort_a_.buffer(), dynamic_sort_b_.buffer(),
            depth_onesweep_status_.buffer(), dynamic_depth_params_.buffer());
    }

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

    // Render set (uses merged_sort and counts) — per-frame.
    // Re-binds render_sets_[i] to point at the merged_sort buffer and
    // counts_ssbo, replacing the legacy bindings written above. Each
    // frame's set still references its frame-i image views.
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        VkDescriptorBufferInfo projected_info{projected_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo merged_info{merged_sort_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo uniform_info{uniform_buffer_.buffer(), 0, sizeof(GsUniforms)};
        VkDescriptorImageInfo image_info{VK_NULL_HANDLE, output_views_[f], VK_IMAGE_LAYOUT_GENERAL};
        VkDescriptorBufferInfo counts_info{counts_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
        VkDescriptorImageInfo depth_img_info{VK_NULL_HANDLE, depth_views_[f], VK_IMAGE_LAYOUT_GENERAL};

        VkDescriptorSet set = render_sets_[f];
        VkWriteDescriptorSet writes[] = {
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 0, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &projected_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 1, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &merged_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 2, 0, 1,
             VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, nullptr, &uniform_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 3, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, &image_info, nullptr, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 4, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &counts_info, nullptr},
            {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 5, 0, 1,
             VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, &depth_img_info, nullptr, nullptr},
        };
        vkUpdateDescriptorSets(device_, 6, writes, 0, nullptr);
    }

    // ── Tile binning descriptor sets ──
    if (tile_sort_a_.buffer()) {
        // Tile bin set (count + scatter share this layout):
        //   0 projected  1 merged_sort  2 counts (ro)
        //   3 per_splat_count (count writes here)
        //   4 per_splat_offset (scatter reads here)
        //   5 tile_entries (scatter writes here)
        //   6 uniforms
        {
            VkDescriptorBufferInfo projected_info{projected_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
            VkDescriptorBufferInfo merged_info{merged_sort_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
            VkDescriptorBufferInfo counts_info{counts_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
            VkDescriptorBufferInfo per_splat_count_info{per_splat_tile_count_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
            VkDescriptorBufferInfo per_splat_offset_info{per_splat_tile_offset_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
            VkDescriptorBufferInfo tile_entries_info{tile_sort_a_.buffer(), 0, VK_WHOLE_SIZE};
            VkDescriptorBufferInfo uniform_info{uniform_buffer_.buffer(), 0, sizeof(GsUniforms)};

            VkWriteDescriptorSet writes[] = {
                {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, tile_bin_set_, 0, 0, 1,
                 VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &projected_info, nullptr},
                {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, tile_bin_set_, 1, 0, 1,
                 VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &merged_info, nullptr},
                {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, tile_bin_set_, 2, 0, 1,
                 VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &counts_info, nullptr},
                {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, tile_bin_set_, 3, 0, 1,
                 VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &per_splat_count_info, nullptr},
                {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, tile_bin_set_, 4, 0, 1,
                 VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &per_splat_offset_info, nullptr},
                {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, tile_bin_set_, 5, 0, 1,
                 VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &tile_entries_info, nullptr},
                {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, tile_bin_set_, 6, 0, 1,
                 VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, nullptr, &uniform_info, nullptr},
            };
            vkUpdateDescriptorSets(device_, 7, writes, 0, nullptr);
        }

        // Tile scan set: per_splat_count(0), per_splat_offset(1),
        //                scan_block_sums(2), tile_sort_count(3)
        {
            VkDescriptorBufferInfo count_info{per_splat_tile_count_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
            VkDescriptorBufferInfo offset_info{per_splat_tile_offset_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
            VkDescriptorBufferInfo block_sums_info{scan_block_sums_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
            VkDescriptorBufferInfo total_info{tile_sort_count_ssbo_.buffer(), 0, sizeof(uint32_t)};
            VkWriteDescriptorSet writes[] = {
                {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, tile_scan_set_, 0, 0, 1,
                 VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &count_info, nullptr},
                {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, tile_scan_set_, 1, 0, 1,
                 VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &offset_info, nullptr},
                {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, tile_scan_set_, 2, 0, 1,
                 VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &block_sums_info, nullptr},
                {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, tile_scan_set_, 3, 0, 1,
                 VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &total_info, nullptr},
            };
            vkUpdateDescriptorSets(device_, 4, writes, 0, nullptr);
        }

        // Tile range detection set: sorted_entries(0), tile_ranges(1), tile_count(2)
        {
            VkDescriptorBufferInfo sorted_info{tile_sort_a_.buffer(), 0, VK_WHOLE_SIZE};
            VkDescriptorBufferInfo ranges_info{tile_ranges_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
            VkDescriptorBufferInfo count_info{tile_sort_count_ssbo_.buffer(), 0, sizeof(uint32_t)};

            VkWriteDescriptorSet writes[] = {
                {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, tile_ranges_set_, 0, 0, 1,
                 VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &sorted_info, nullptr},
                {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, tile_ranges_set_, 1, 0, 1,
                 VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &ranges_info, nullptr},
                {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, tile_ranges_set_, 2, 0, 1,
                 VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &count_info, nullptr},
            };
            vkUpdateDescriptorSets(device_, 3, writes, 0, nullptr);
        }

        // Tile indirect set: tile_sort_count(0), indirect_args(1)
        {
            VkDescriptorBufferInfo count_info{tile_sort_count_ssbo_.buffer(), 0, sizeof(uint32_t)};
            VkDescriptorBufferInfo args_info{tile_indirect_args_.buffer(), 0, VK_WHOLE_SIZE};
            VkWriteDescriptorSet writes[] = {
                {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, tile_indirect_set_, 0, 0, 1,
                 VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &count_info, nullptr},
                {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, tile_indirect_set_, 1, 0, 1,
                 VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &args_info, nullptr},
            };
            vkUpdateDescriptorSets(device_, 2, writes, 0, nullptr);
        }

        // Onesweep histogram descriptor sets (read-only input + status + args)
        if (onesweep_status_.buffer()) {
            {
                VkDescriptorBufferInfo in_info{tile_sort_a_.buffer(), 0, VK_WHOLE_SIZE};
                VkDescriptorBufferInfo status_info{onesweep_status_.buffer(), 0, VK_WHOLE_SIZE};
                VkDescriptorBufferInfo args_info{tile_indirect_args_.buffer(), 0, VK_WHOLE_SIZE};
                VkWriteDescriptorSet writes[] = {
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, onesweep_hist_set_a_, 0, 0, 1,
                     VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &in_info, nullptr},
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, onesweep_hist_set_a_, 1, 0, 1,
                     VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &status_info, nullptr},
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, onesweep_hist_set_a_, 2, 0, 1,
                     VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &args_info, nullptr},
                };
                vkUpdateDescriptorSets(device_, 3, writes, 0, nullptr);
            }
            {
                VkDescriptorBufferInfo in_info{tile_sort_b_.buffer(), 0, VK_WHOLE_SIZE};
                VkDescriptorBufferInfo status_info{onesweep_status_.buffer(), 0, VK_WHOLE_SIZE};
                VkDescriptorBufferInfo args_info{tile_indirect_args_.buffer(), 0, VK_WHOLE_SIZE};
                VkWriteDescriptorSet writes[] = {
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, onesweep_hist_set_b_, 0, 0, 1,
                     VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &in_info, nullptr},
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, onesweep_hist_set_b_, 1, 0, 1,
                     VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &status_info, nullptr},
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, onesweep_hist_set_b_, 2, 0, 1,
                     VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &args_info, nullptr},
                };
                vkUpdateDescriptorSets(device_, 3, writes, 0, nullptr);
            }
            // Onesweep scatter descriptor sets (input + output + status + args)
            {
                VkDescriptorBufferInfo in_info{tile_sort_a_.buffer(), 0, VK_WHOLE_SIZE};
                VkDescriptorBufferInfo out_info{tile_sort_b_.buffer(), 0, VK_WHOLE_SIZE};
                VkDescriptorBufferInfo status_info{onesweep_status_.buffer(), 0, VK_WHOLE_SIZE};
                VkDescriptorBufferInfo args_info{tile_indirect_args_.buffer(), 0, VK_WHOLE_SIZE};
                VkWriteDescriptorSet writes[] = {
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, onesweep_scatter_set_ab_, 0, 0, 1,
                     VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &in_info, nullptr},
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, onesweep_scatter_set_ab_, 1, 0, 1,
                     VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &out_info, nullptr},
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, onesweep_scatter_set_ab_, 2, 0, 1,
                     VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &status_info, nullptr},
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, onesweep_scatter_set_ab_, 3, 0, 1,
                     VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &args_info, nullptr},
                };
                vkUpdateDescriptorSets(device_, 4, writes, 0, nullptr);
            }
            {
                VkDescriptorBufferInfo in_info{tile_sort_b_.buffer(), 0, VK_WHOLE_SIZE};
                VkDescriptorBufferInfo out_info{tile_sort_a_.buffer(), 0, VK_WHOLE_SIZE};
                VkDescriptorBufferInfo status_info{onesweep_status_.buffer(), 0, VK_WHOLE_SIZE};
                VkDescriptorBufferInfo args_info{tile_indirect_args_.buffer(), 0, VK_WHOLE_SIZE};
                VkWriteDescriptorSet writes[] = {
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, onesweep_scatter_set_ba_, 0, 0, 1,
                     VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &in_info, nullptr},
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, onesweep_scatter_set_ba_, 1, 0, 1,
                     VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &out_info, nullptr},
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, onesweep_scatter_set_ba_, 2, 0, 1,
                     VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &status_info, nullptr},
                    {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, onesweep_scatter_set_ba_, 3, 0, 1,
                     VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &args_info, nullptr},
                };
                vkUpdateDescriptorSets(device_, 4, writes, 0, nullptr);
            }
        }

        // Tile render set: projected(0), tile_entries(1), uniforms(2), output_image(3), tile_ranges(4), depth_image(5)
        // Per-frame: each tile_render_sets_[i] binds frame i's output and depth views.
        for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
            VkDescriptorBufferInfo projected_info{projected_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
            VkDescriptorBufferInfo tile_entries_info{tile_sort_a_.buffer(), 0, VK_WHOLE_SIZE};
            VkDescriptorBufferInfo uniform_info{uniform_buffer_.buffer(), 0, sizeof(GsUniforms)};
            VkDescriptorImageInfo image_info{VK_NULL_HANDLE, output_views_[f], VK_IMAGE_LAYOUT_GENERAL};
            VkDescriptorBufferInfo tile_ranges_info{tile_ranges_ssbo_.buffer(), 0, VK_WHOLE_SIZE};
            VkDescriptorImageInfo depth_img_info{VK_NULL_HANDLE, depth_views_[f], VK_IMAGE_LAYOUT_GENERAL};

            VkDescriptorSet set = tile_render_sets_[f];
            VkWriteDescriptorSet writes[] = {
                {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 0, 0, 1,
                 VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &projected_info, nullptr},
                {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 1, 0, 1,
                 VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &tile_entries_info, nullptr},
                {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 2, 0, 1,
                 VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, nullptr, &uniform_info, nullptr},
                {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 3, 0, 1,
                 VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, &image_info, nullptr, nullptr},
                {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 4, 0, 1,
                 VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, nullptr, &tile_ranges_info, nullptr},
                {VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET, nullptr, set, 5, 0, 1,
                 VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, &depth_img_info, nullptr, nullptr},
            };
            vkUpdateDescriptorSets(device_, 6, writes, 0, nullptr);
        }
    }
}

void GsRenderer::resize_output(uint32_t width, uint32_t height) {
    if (width == output_width_ && height == output_height_) return;

    // Sampler is resolution-independent — keep it across resizes.
    for (uint32_t i = 0; i < kMaxFramesInFlight; ++i) {
        if (output_views_[i]) {
            vkDestroyImageView(device_, output_views_[i], nullptr);
            output_views_[i] = VK_NULL_HANDLE;
        }
        if (output_images_[i]) {
            vmaDestroyImage(allocator_, output_images_[i], output_allocations_[i]);
            output_images_[i] = VK_NULL_HANDLE;
            output_allocations_[i] = VK_NULL_HANDLE;
        }
        if (depth_views_[i]) {
            vkDestroyImageView(device_, depth_views_[i], nullptr);
            depth_views_[i] = VK_NULL_HANDLE;
        }
        if (depth_images_[i]) {
            vmaDestroyImage(allocator_, depth_images_[i], depth_allocations_[i]);
            depth_images_[i] = VK_NULL_HANDLE;
            depth_allocations_[i] = VK_NULL_HANDLE;
        }
        if (processed_views_[i]) {
            vkDestroyImageView(device_, processed_views_[i], nullptr);
            processed_views_[i] = VK_NULL_HANDLE;
        }
        if (processed_images_[i]) {
            vmaDestroyImage(allocator_, processed_images_[i], processed_allocations_[i]);
            processed_images_[i] = VK_NULL_HANDLE;
            processed_allocations_[i] = VK_NULL_HANDLE;
        }
    }

    create_output_image(width, height);

    if (gaussian_count_ > 0) {
        update_descriptors();
    }
}

void GsRenderer::init_output_layouts(VkCommandBuffer cmd) {
    // The renderer's main fragment pass samples `processed_view_` every
    // frame. While the engine sits in EngineState::Loading the GS compute
    // path is gated off, so the image would otherwise stay in UNDEFINED
    // until the first Warming frame and produce a layout-mismatch
    // validation error. Clear it to black up front and leave it in
    // SHADER_READ_ONLY_OPTIMAL — the GS compute path will reset oldLayout
    // to UNDEFINED → GENERAL (Vulkan's "discard previous contents") on
    // its first dispatch, so this seed transition is invisible afterwards.
    //
    // `output_image_` and `depth_image_` are not sampled by fragment
    // shaders (output_image_ is read by the post-process compute via
    // GENERAL; depth_image_ is storage-only), so they don't need to be
    // pre-transitioned for the sample-during-Loading path.

    auto barrier_for = [](VkImage image, VkImageLayout old_layout, VkImageLayout new_layout,
                          VkAccessFlags src_access, VkAccessFlags dst_access) {
        VkImageMemoryBarrier b{};
        b.sType                       = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
        b.srcAccessMask               = src_access;
        b.dstAccessMask               = dst_access;
        b.oldLayout                   = old_layout;
        b.newLayout                   = new_layout;
        b.srcQueueFamilyIndex         = VK_QUEUE_FAMILY_IGNORED;
        b.dstQueueFamilyIndex         = VK_QUEUE_FAMILY_IGNORED;
        b.image                       = image;
        b.subresourceRange            = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
        return b;
    };

    VkClearColorValue clear{};
    clear.float32[0] = clear.float32[1] = clear.float32[2] = 0.0f;
    clear.float32[3] = 1.0f;
    VkImageSubresourceRange range{VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};

    std::array<VkImageMemoryBarrier, kMaxFramesInFlight> to_dst{};
    std::array<VkImageMemoryBarrier, kMaxFramesInFlight> to_shader{};
    for (uint32_t i = 0; i < kMaxFramesInFlight; ++i) {
        to_dst[i] = barrier_for(processed_images_[i],
            VK_IMAGE_LAYOUT_UNDEFINED, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,
            0, VK_ACCESS_TRANSFER_WRITE_BIT);
        to_shader[i] = barrier_for(processed_images_[i],
            VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,
            VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL,
            VK_ACCESS_TRANSFER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT);
    }

    // 1. UNDEFINED → TRANSFER_DST_OPTIMAL (all frames).
    vkCmdPipelineBarrier(cmd,
        VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT,
        VK_PIPELINE_STAGE_TRANSFER_BIT,
        0, 0, nullptr, 0, nullptr,
        kMaxFramesInFlight, to_dst.data());

    // 2. Clear each per-frame processed image to opaque black.
    for (uint32_t i = 0; i < kMaxFramesInFlight; ++i) {
        vkCmdClearColorImage(cmd, processed_images_[i],
            VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, &clear, 1, &range);
    }

    // 3. TRANSFER_DST → SHADER_READ_ONLY_OPTIMAL (all frames).
    vkCmdPipelineBarrier(cmd,
        VK_PIPELINE_STAGE_TRANSFER_BIT,
        VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT,
        0, 0, nullptr, 0, nullptr,
        kMaxFramesInFlight, to_shader.data());
}

void GsRenderer::dispatch_depth_onesweep(
    VkCommandBuffer cmd, uint32_t sort_size, uint32_t num_workgroups,
    VkDescriptorSet hist_a, VkDescriptorSet hist_b,
    VkDescriptorSet scatter_ab, VkDescriptorSet scatter_ba)
{
    // Clear shared status buffer before sort
    VkDeviceSize status_clear_size = static_cast<VkDeviceSize>(num_sort_passes_) * 256ull
                                     * depth_onesweep_max_wg_ * sizeof(uint32_t);
    vkCmdFillBuffer(cmd, depth_onesweep_status_.buffer(), 0, status_clear_size, 0);
    {
        VkMemoryBarrier sb{};
        sb.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
        sb.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
        sb.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
        vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT,
            VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 1, &sb, 0, nullptr, 0, nullptr);
    }

    // 2-dispatch Onesweep: num_sort_passes_ passes × 2 dispatches each
    for (uint32_t pass = 0; pass < num_sort_passes_; pass++) {
        uint32_t push_data[1] = {pass};
        bool read_from_a = (pass % 2 == 0);

        // Dispatch 1: histogram + decoupled lookback
        {
            VkDescriptorSet hist_set = read_from_a ? hist_a : hist_b;
            vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, onesweep_hist_pipeline_);
            vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                    onesweep_hist_pipeline_layout_, 0, 1, &hist_set, 0, nullptr);
            vkCmdPushConstants(cmd, onesweep_hist_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                               0, 4, push_data);
            vkCmdDispatch(cmd, num_workgroups, 1, 1);
        }

        insert_compute_barrier(cmd);

        // Dispatch 2: read status buffer, compute prefix, scatter
        {
            VkDescriptorSet scatter_set = read_from_a ? scatter_ab : scatter_ba;
            vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, onesweep_scatter_pipeline_);
            vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                    onesweep_scatter_pipeline_layout_, 0, 1, &scatter_set, 0, nullptr);
            vkCmdPushConstants(cmd, onesweep_scatter_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                               0, 4, push_data);
            vkCmdDispatch(cmd, num_workgroups, 1, 1);
        }

        insert_compute_barrier(cmd);
    }
    // After even number of passes, sorted result is in buffer A
}

void GsRenderer::dispatch_tile_sort(VkCommandBuffer cmd) {
    // Reset the per-frame "did we record a readback?" flag at the start of
    // every dispatch attempt. The harness in Renderer::draw_scene reads
    // this flag after the in-flight fence to decide whether the captured
    // frame represents a real measurement.
    determinism_readback_emitted_ = false;
    if (!tile_binning_enabled_ || !tile_sort_a_.buffer() || tile_sort_capacity_ == 0) return;

    uint32_t width = output_width_;
    uint32_t height = output_height_;
    uint32_t tiles_x = (width + 15) / 16;
    uint32_t tiles_y = (height + 15) / 16;

    // === Phase 0: zero counters and pre-fill tile_sort_a_ with sentinels.
    // Sentinels still matter: the radix sort processes
    // tile_sort_workgroups_ * 2048 entries, but the deterministic count
    // pass only writes [0, total). Slots in [total, tile_sort_size_)
    // need 0xFFFFFFFF keys so the sort routes them to the tail and
    // keeps real entries contiguous at [0, total).
    vkCmdFillBuffer(cmd, tile_sort_count_ssbo_.buffer(), 0, sizeof(uint32_t), 0);
    vkCmdFillBuffer(cmd, tile_sort_a_.buffer(), 0,
                    static_cast<VkDeviceSize>(tile_sort_size_) * 8, 0xFFFFFFFF);
    // per_splat_tile_count_ must be zeroed before the count dispatch so the
    // tail (gid >= visible) reads 0 in the scan; the count shader doesn't
    // touch those slots.
    vkCmdFillBuffer(cmd, per_splat_tile_count_ssbo_.buffer(), 0,
                    static_cast<VkDeviceSize>(scan_dispatch_size_) * sizeof(uint32_t), 0);

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

    uint32_t visible_upper = static_sort_size_ + dynamic_sort_size_;
    uint32_t count_workgroups = scan_num_blocks_;  // (visible_upper + 255) / 256, rounded

    // === Phase 1: Count pass — per-splat tile-overlap count ===
    {
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, tile_count_pipeline_);
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                tile_bin_pipeline_layout_, 0, 1, &tile_bin_set_, 0, nullptr);
        // Push range allocated for the scatter; count shader has no push,
        // but Vulkan permits leaving the range untouched.
        uint32_t push_data[1] = {tile_sort_capacity_};
        vkCmdPushConstants(cmd, tile_bin_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                           0, 4, push_data);
        vkCmdDispatch(cmd, count_workgroups, 1, 1);
    }
    insert_compute_barrier(cmd);

    // === Phase 2: Three-pass exclusive scan ===
    {
        struct ScanPush { uint32_t pass; uint32_t num_elements; uint32_t num_blocks; };
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, tile_scan_pipeline_);
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                tile_scan_pipeline_layout_, 0, 1, &tile_scan_set_, 0, nullptr);

        // Pass 0: per-block local exclusive scan + write block sums.
        ScanPush p0{0u, scan_dispatch_size_, scan_num_blocks_};
        vkCmdPushConstants(cmd, tile_scan_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                           0, sizeof(ScanPush), &p0);
        vkCmdDispatch(cmd, scan_num_blocks_, 1, 1);
        insert_compute_barrier(cmd);

        // Pass 1: single-workgroup scan over scan_block_sums_, writes total.
        ScanPush p1{1u, scan_dispatch_size_, scan_num_blocks_};
        vkCmdPushConstants(cmd, tile_scan_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                           0, sizeof(ScanPush), &p1);
        vkCmdDispatch(cmd, 1u, 1, 1);
        insert_compute_barrier(cmd);

        // Pass 2: add scanned base to per_splat_tile_offset_.
        ScanPush p2{2u, scan_dispatch_size_, scan_num_blocks_};
        vkCmdPushConstants(cmd, tile_scan_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                           0, sizeof(ScanPush), &p2);
        vkCmdDispatch(cmd, scan_num_blocks_, 1, 1);
    }
    insert_compute_barrier(cmd);

    // === Phase 3: Deterministic scatter ===
    {
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, tile_bin_pipeline_);
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                tile_bin_pipeline_layout_, 0, 1, &tile_bin_set_, 0, nullptr);
        uint32_t push_data[1] = {tile_sort_capacity_};
        vkCmdPushConstants(cmd, tile_bin_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                           0, 4, push_data);
        vkCmdDispatch(cmd, count_workgroups, 1, 1);
    }

    insert_compute_barrier(cmd);

    // === Prepare indirect dispatch args from tile_sort_count ===
    {
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, tile_indirect_pipeline_);
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                tile_indirect_pipeline_layout_, 0, 1, &tile_indirect_set_, 0, nullptr);
        vkCmdPushConstants(cmd, tile_indirect_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                           0, 4, &tile_sort_capacity_);
        vkCmdDispatch(cmd, 1, 1, 1);
    }

    // Barrier: indirect args must be written before DispatchIndirect reads them
    {
        VkMemoryBarrier barrier{};
        barrier.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
        barrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
        barrier.dstAccessMask = VK_ACCESS_INDIRECT_COMMAND_READ_BIT | VK_ACCESS_SHADER_READ_BIT;
        vkCmdPipelineBarrier(cmd,
            VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
            VK_PIPELINE_STAGE_DRAW_INDIRECT_BIT | VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
            0, 1, &barrier, 0, nullptr, 0, nullptr);
    }

    // === Onesweep 2-dispatch: clear status buffer once ===
    {
        VkDeviceSize status_size = 4ull * 256ull * onesweep_max_wg_ * sizeof(uint32_t);
        vkCmdFillBuffer(cmd, onesweep_status_.buffer(), 0, status_size, 0);
        {
            VkMemoryBarrier sb{};
            sb.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
            sb.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
            sb.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
            vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT,
                VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT, 0, 1, &sb, 0, nullptr, 0, nullptr);
        }

        // === Onesweep: 4 radix passes × 2 dispatches each ===
        for (uint32_t pass = 0; pass < kTileSortPasses; pass++) {
            uint32_t push_data[1] = {pass};
            bool read_from_a = (pass % 2 == 0);

            // Dispatch 1: histogram + decoupled lookback
            {
                VkDescriptorSet hist_set = read_from_a ? onesweep_hist_set_a_ : onesweep_hist_set_b_;
                vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, onesweep_hist_pipeline_);
                vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                        onesweep_hist_pipeline_layout_, 0, 1, &hist_set, 0, nullptr);
                vkCmdPushConstants(cmd, onesweep_hist_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                                   0, 4, push_data);
                vkCmdDispatchIndirect(cmd, tile_indirect_args_.buffer(), 0);
            }

            insert_compute_barrier(cmd);

            // Dispatch 2: read status buffer, compute prefix, scatter
            {
                VkDescriptorSet scatter_set = read_from_a ? onesweep_scatter_set_ab_ : onesweep_scatter_set_ba_;
                vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, onesweep_scatter_pipeline_);
                vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                        onesweep_scatter_pipeline_layout_, 0, 1, &scatter_set, 0, nullptr);
                vkCmdPushConstants(cmd, onesweep_scatter_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                                   0, 4, push_data);
                vkCmdDispatchIndirect(cmd, tile_indirect_args_.buffer(), 0);
            }

            insert_compute_barrier(cmd);
        }
        // After 4 passes (even count), sorted result is in tile_sort_a_
    }

    // === Frame-determinism readback (Mode 1) ===
    // When the harness is active, copy tile_sort_a_ into a host-visible
    // readback buffer so the CPU can hash the live entry range and detect
    // order-instability across frames with frozen inputs.
    if (determinism_test_active_ && determinism_readback_.buffer() != VK_NULL_HANDLE
        && determinism_readback_size_ > 0) {
        VkBufferMemoryBarrier src_barrier{};
        src_barrier.sType = VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER;
        src_barrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
        src_barrier.dstAccessMask = VK_ACCESS_TRANSFER_READ_BIT;
        src_barrier.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        src_barrier.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        src_barrier.buffer = tile_sort_a_.buffer();
        src_barrier.offset = 0;
        src_barrier.size = determinism_readback_size_;
        vkCmdPipelineBarrier(cmd,
            VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
            VK_PIPELINE_STAGE_TRANSFER_BIT,
            0, 0, nullptr, 1, &src_barrier, 0, nullptr);

        VkBufferCopy region{};
        region.srcOffset = 0;
        region.dstOffset = 0;
        region.size = determinism_readback_size_;
        vkCmdCopyBuffer(cmd, tile_sort_a_.buffer(),
                        determinism_readback_.buffer(), 1, &region);

        VkBufferMemoryBarrier dst_barrier{};
        dst_barrier.sType = VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER;
        dst_barrier.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
        dst_barrier.dstAccessMask = VK_ACCESS_HOST_READ_BIT;
        dst_barrier.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        dst_barrier.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        dst_barrier.buffer = determinism_readback_.buffer();
        dst_barrier.offset = 0;
        dst_barrier.size = determinism_readback_size_;
        vkCmdPipelineBarrier(cmd,
            VK_PIPELINE_STAGE_TRANSFER_BIT,
            VK_PIPELINE_STAGE_HOST_BIT,
            0, 0, nullptr, 1, &dst_barrier, 0, nullptr);
        determinism_readback_emitted_ = true;
    }

    // === Tile range detection ===
    {
        uint32_t num_tiles = tiles_x * tiles_y;
        vkCmdFillBuffer(cmd, tile_ranges_ssbo_.buffer(), 0,
                        static_cast<VkDeviceSize>(num_tiles) * 2 * sizeof(uint32_t), 0);

        VkMemoryBarrier fill_barrier{};
        fill_barrier.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
        fill_barrier.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
        fill_barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
        vkCmdPipelineBarrier(cmd, VK_PIPELINE_STAGE_TRANSFER_BIT,
            VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
            0, 1, &fill_barrier, 0, nullptr, 0, nullptr);
    }

    // Dispatch tile range detection (indirect from args[3..5])
    {
        uint32_t num_tiles = tiles_x * tiles_y;
        uint32_t push_data[2] = {num_tiles, tile_sort_capacity_};
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, tile_ranges_pipeline_);
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                tile_ranges_pipeline_layout_, 0, 1, &tile_ranges_set_, 0, nullptr);
        vkCmdPushConstants(cmd, tile_ranges_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                           0, 8, push_data);
        vkCmdDispatchIndirect(cmd, tile_indirect_args_.buffer(), 3 * sizeof(uint32_t));
    }

    insert_compute_barrier(cmd);
}

void GsRenderer::render(VkCommandBuffer cmd, uint32_t frame_in_flight,
                        const glm::mat4& view, const glm::mat4& proj) {
    if (gaussian_count_ == 0 && static_count_ == 0 && dynamic_count_ == 0) return;
    if (frame_in_flight >= kMaxFramesInFlight) {
        std::fprintf(stderr, "[gs_renderer] render(): frame_in_flight=%u out of range\n",
                     frame_in_flight);
        return;
    }
    const VkImage out_img       = output_images_[frame_in_flight];
    const VkImage depth_img     = depth_images_[frame_in_flight];
    const VkImage processed_img = processed_images_[frame_in_flight];
    VkDescriptorSet render_set       = render_sets_[frame_in_flight];
    VkDescriptorSet post_process_set = post_process_sets_[frame_in_flight];
    VkDescriptorSet tile_render_set  = tile_render_sets_[frame_in_flight];

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

    // Extract near/far from Vulkan [0,1] perspective projection
    float near_z = proj[3][2] / proj[2][2];
    float far_z  = proj[3][2] / (proj[2][2] + 1.0f);
    uint32_t tiles_x = (width + 15) / 16;
    uint32_t tiles_y = (height + 15) / 16;
    uniforms.tile_sort_params = glm::vec4(near_z, far_z,
        static_cast<float>(tiles_x), static_cast<float>(tiles_y));

    std::memcpy(uniform_buffer_.mapped(), &uniforms, sizeof(uniforms));

    // Read back GPU timestamps from previous frame (depth sort + tile sort + rasterize).
    // Non-blocking: if results aren't ready yet, skip this frame's sample.
    if (timestamp_pool_ && timestamps_written_) {
        uint64_t ts[6]{};  // depth_sort_begin/end, tile_sort_begin/end, raster_begin/end
        VkResult ts_result = vkGetQueryPoolResults(
            device_, timestamp_pool_, 0, 6,
            sizeof(ts), ts, sizeof(uint64_t),
            VK_QUERY_RESULT_64_BIT);  // no WAIT_BIT — never block on GPU
        if (ts_result == VK_SUCCESS && ts[5] > ts[4] && ts[3] > ts[2] && ts[1] > ts[0]) {
            float depth_ms = static_cast<float>(ts[1] - ts[0]) * timestamp_period_ns_ / 1e6f;
            float tile_ms  = static_cast<float>(ts[3] - ts[2]) * timestamp_period_ns_ / 1e6f;
            float raster_ms = static_cast<float>(ts[5] - ts[4]) * timestamp_period_ns_ / 1e6f;
            depth_sort_ms_accum_ += depth_ms;
            tile_sort_ms_accum_ += tile_ms;
            rasterize_ms_accum_ += raster_ms;
            ++timestamp_frame_;
            if (timestamp_frame_ % kTimestampAvgFrames == 0) {
                float d_avg = depth_sort_ms_accum_ / static_cast<float>(kTimestampAvgFrames);
                float t_avg = tile_sort_ms_accum_ / static_cast<float>(kTimestampAvgFrames);
                float r_avg = rasterize_ms_accum_ / static_cast<float>(kTimestampAvgFrames);
                std::fprintf(stderr, "[gs_renderer] DepthSort: %.3f ms  TileSort: %.3f ms  Rasterize: %.3f ms  Total: %.3f ms (avg %u frames)\n",
                             d_avg, t_avg, r_avg, d_avg + t_avg + r_avg, kTimestampAvgFrames);
                depth_sort_ms_avg_ = d_avg;
                tile_sort_ms_avg_ = t_avg;
                rasterize_ms_avg_ = r_avg;
                depth_sort_ms_accum_ = 0.0f;
                tile_sort_ms_accum_ = 0.0f;
                rasterize_ms_accum_ = 0.0f;
            }
        }
    }

    // Reset timestamp queries for this frame
    if (timestamp_pool_) {
        vkCmdResetQueryPool(cmd, timestamp_pool_, 0, 6);
        timestamps_written_ = false;
    }

    // In skip-sort mode, skip GS compute but still run post-process
    // (parameters like fade_amount change continuously).
    bool skip_gs_compute = skip_sort_ && sort_done_once_;

    if (!skip_gs_compute) {
        // Transition this frame's output + depth images to GENERAL layout for compute write.
        VkImageMemoryBarrier barriers[2]{};
        barriers[0].sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
        barriers[0].srcAccessMask = 0;
        barriers[0].dstAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
        barriers[0].oldLayout = VK_IMAGE_LAYOUT_UNDEFINED;
        barriers[0].newLayout = VK_IMAGE_LAYOUT_GENERAL;
        barriers[0].srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        barriers[0].dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        barriers[0].image = out_img;
        barriers[0].subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};

        barriers[1] = barriers[0];
        barriers[1].image = depth_img;

        vkCmdPipelineBarrier(cmd,
            VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT,
            VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
            0, 0, nullptr, 0, nullptr, 2, barriers);
    }

    if (!skip_gs_compute) {
        // Clear this frame's output + depth images to transparent black (prevents ghost artifacts)
        VkClearColorValue clear_color = {{0.0f, 0.0f, 0.0f, 0.0f}};
        VkImageSubresourceRange range = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
        vkCmdClearColorImage(cmd, out_img,   VK_IMAGE_LAYOUT_GENERAL, &clear_color, 1, &range);
        vkCmdClearColorImage(cmd, depth_img, VK_IMAGE_LAYOUT_GENERAL, &clear_color, 1, &range);

        // === PBD solver dispatch (before any preprocess) ===
        // PBD-tagged Gaussians live in the static buffer but need re-preprocessing
        // every frame since their positions/rotations change continuously.
        // Determinism harness: PBD uses a hardcoded 1/60s step rather than
        // the engine dt, so the upstream draw_scene `dt = 0` freeze is not
        // enough — the solver would still advance wind-sway each frame and
        // shift the depth-sort key for tagged splats. Skip the dispatch
        // entirely while a Mode-1 test is active so the GPU's pbd_state
        // SSBO retains its pre-test contents.
        if (pbd_count_ > 0 && !determinism_test_active_) {
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

            // === Depth sort timestamp: begin ===
            if (timestamp_pool_) {
                vkCmdWriteTimestamp(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                   timestamp_pool_, 0);  // depth_sort_begin
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

                // Sort dynamic (Onesweep)
                dispatch_depth_onesweep(cmd, dynamic_sort_size_, dynamic_sort_workgroups_,
                    dynamic_depth_hist_set_a_, dynamic_depth_hist_set_b_,
                    dynamic_depth_scatter_set_ab_, dynamic_depth_scatter_set_ba_);
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

                // Sort static (Onesweep)
                dispatch_depth_onesweep(cmd, static_sort_size_, static_sort_workgroups_,
                    static_depth_hist_set_a_, static_depth_hist_set_b_,
                    static_depth_scatter_set_ab_, static_depth_scatter_set_ba_);

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

            // === Depth sort timestamp: end ===
            if (timestamp_pool_) {
                vkCmdWriteTimestamp(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                   timestamp_pool_, 1);  // depth_sort_end
            }

            // === Phase 3.5: Tile binning + tile sort ===
            if (timestamp_pool_) {
                vkCmdWriteTimestamp(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                   timestamp_pool_, 2);  // tile_sort_begin
            }
            dispatch_tile_sort(cmd);
            if (timestamp_pool_) {
                vkCmdWriteTimestamp(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                   timestamp_pool_, 3);  // tile_sort_end
            }

            // === Phase 4: Tile-based rasterization ===
            {
                bool use_tile = (tile_binning_enabled_ && tile_sort_a_.buffer() && tile_sort_capacity_ > 0);
                if (use_tile) {
                    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, tile_render_pipeline_);
                    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                            tile_render_pipeline_layout_, 0, 1, &tile_render_set, 0, nullptr);
                } else {
                    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, render_pipeline_);
                    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                            render_pipeline_layout_, 0, 1, &render_set, 0, nullptr);
                }
                uint32_t tiles_x = (width + 15) / 16;
                uint32_t tiles_y = (height + 15) / 16;

                if (timestamp_pool_) {
                    vkCmdWriteTimestamp(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                       timestamp_pool_, 4);  // raster_begin
                }
                vkCmdDispatch(cmd, tiles_x, tiles_y, 1);
                if (timestamp_pool_) {
                    vkCmdWriteTimestamp(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                       timestamp_pool_, 5);  // raster_end
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

            // Depth sort timestamp: begin
            if (timestamp_pool_) {
                vkCmdWriteTimestamp(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                   timestamp_pool_, 0);  // depth_sort_begin
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

            // Depth sort (legacy path, Onesweep)
            dispatch_depth_onesweep(cmd, sort_size_, num_sort_workgroups_,
                depth_hist_set_a_, depth_hist_set_b_,
                depth_scatter_set_ab_, depth_scatter_set_ba_);

            // Depth sort timestamp: end (also serves as tile_sort_begin/end = same point)
            if (timestamp_pool_) {
                vkCmdWriteTimestamp(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                   timestamp_pool_, 1);  // depth_sort_end
                // No tile sort in legacy path — write same timestamp for tile begin/end
                vkCmdWriteTimestamp(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                   timestamp_pool_, 2);  // tile_sort_begin
                vkCmdWriteTimestamp(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                   timestamp_pool_, 3);  // tile_sort_end
            }

            // Tile-based rasterization (legacy path)
            vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, render_pipeline_);
            vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                    render_pipeline_layout_, 0, 1, &render_set, 0, nullptr);
            uint32_t tiles_x = (width + 15) / 16;
            uint32_t tiles_y = (height + 15) / 16;

            if (timestamp_pool_) {
                vkCmdWriteTimestamp(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                   timestamp_pool_, 4);  // raster_begin
            }
            vkCmdDispatch(cmd, tiles_x, tiles_y, 1);
            if (timestamp_pool_) {
                vkCmdWriteTimestamp(cmd, VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                                   timestamp_pool_, 5);  // raster_end
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
        pp_ubo.overlay = glm::vec4(gs_pp_params_.overlay_r,
                                    gs_pp_params_.overlay_g,
                                    gs_pp_params_.overlay_b,
                                    gs_pp_params_.overlay_alpha);
        pp_ubo.overlay_effect_type = gs_pp_params_.overlay_effect_type;
        pp_ubo._pad0 = pp_ubo._pad1 = pp_ubo._pad2 = 0;
        std::memcpy(pp_ubo_buffer_.mapped(), &pp_ubo, sizeof(pp_ubo));

        // Transition this frame's processed image to GENERAL for compute write
        {
            VkImageMemoryBarrier barrier{};
            barrier.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
            barrier.srcAccessMask = 0;
            barrier.dstAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
            barrier.oldLayout = VK_IMAGE_LAYOUT_UNDEFINED;
            barrier.newLayout = VK_IMAGE_LAYOUT_GENERAL;
            barrier.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
            barrier.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
            barrier.image = processed_img;
            barrier.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};

            vkCmdPipelineBarrier(cmd,
                VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT,
                VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                0, 0, nullptr, 0, nullptr, 1, &barrier);
        }

        // Dispatch post-process (same tile grid as render)
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, post_process_pipeline_);
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                                post_process_pipeline_layout_, 0, 1, &post_process_set, 0, nullptr);
        uint32_t tiles_x = (width + 15) / 16;
        uint32_t tiles_y = (height + 15) / 16;
        vkCmdDispatch(cmd, tiles_x, tiles_y, 1);
    }

    // Transition this frame's processed image → SHADER_READ_ONLY for fragment sampling (blit)
    {
        VkImageMemoryBarrier barrier{};
        barrier.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
        barrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
        barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
        barrier.oldLayout = VK_IMAGE_LAYOUT_GENERAL;
        barrier.newLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
        barrier.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        barrier.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        barrier.image = processed_img;
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

    // The async loader no longer spins up worker threads — reserve+submit
    // run synchronously on the main thread now. We still call
    // `request_cancel` to be tidy: any pending callbacks queued in the
    // transfer queue should observe the shutdown flag and bail.
    if (transfer_queue_) {
        transfer_queue_->request_cancel();
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
    merged_sort_ssbo_.destroy(allocator);
    counts_ssbo_.destroy(allocator);

    // Tile binning buffers
    tile_sort_a_.destroy(allocator);
    tile_sort_b_.destroy(allocator);
    tile_sort_count_ssbo_.destroy(allocator);
    tile_ranges_ssbo_.destroy(allocator);
    tile_indirect_args_.destroy(allocator);
    onesweep_status_.destroy(allocator);
    per_splat_tile_count_ssbo_.destroy(allocator);
    per_splat_tile_offset_ssbo_.destroy(allocator);
    scan_block_sums_ssbo_.destroy(allocator);
    determinism_readback_.destroy(allocator);

    // Depth sort Onesweep buffers
    depth_onesweep_status_.destroy(allocator);
    depth_sort_params_.destroy(allocator);
    static_depth_params_.destroy(allocator);
    dynamic_depth_params_.destroy(allocator);

    pp_ubo_buffer_.destroy(allocator);

    if (output_sampler_) { vkDestroySampler(device_, output_sampler_, nullptr); output_sampler_ = VK_NULL_HANDLE; }
    for (uint32_t i = 0; i < kMaxFramesInFlight; ++i) {
        if (output_views_[i]) {
            vkDestroyImageView(device_, output_views_[i], nullptr);
            output_views_[i] = VK_NULL_HANDLE;
        }
        if (output_images_[i]) {
            vmaDestroyImage(allocator, output_images_[i], output_allocations_[i]);
            output_images_[i] = VK_NULL_HANDLE;
            output_allocations_[i] = VK_NULL_HANDLE;
        }
        if (depth_views_[i]) {
            vkDestroyImageView(device_, depth_views_[i], nullptr);
            depth_views_[i] = VK_NULL_HANDLE;
        }
        if (depth_images_[i]) {
            vmaDestroyImage(allocator, depth_images_[i], depth_allocations_[i]);
            depth_images_[i] = VK_NULL_HANDLE;
            depth_allocations_[i] = VK_NULL_HANDLE;
        }
        if (processed_views_[i]) {
            vkDestroyImageView(device_, processed_views_[i], nullptr);
            processed_views_[i] = VK_NULL_HANDLE;
        }
        if (processed_images_[i]) {
            vmaDestroyImage(allocator, processed_images_[i], processed_allocations_[i]);
            processed_images_[i] = VK_NULL_HANDLE;
            processed_allocations_[i] = VK_NULL_HANDLE;
        }
    }

    auto destroy_pipeline = [&](VkPipeline& p) { if (p) { vkDestroyPipeline(device_, p, nullptr); p = VK_NULL_HANDLE; } };
    auto destroy_layout = [&](VkPipelineLayout& l) { if (l) { vkDestroyPipelineLayout(device_, l, nullptr); l = VK_NULL_HANDLE; } };
    auto destroy_set_layout = [&](VkDescriptorSetLayout& l) { if (l) { vkDestroyDescriptorSetLayout(device_, l, nullptr); l = VK_NULL_HANDLE; } };

    destroy_pipeline(preprocess_pipeline_);
    destroy_pipeline(sort_pipeline_);
    destroy_pipeline(render_pipeline_);
    destroy_pipeline(post_process_pipeline_);
    destroy_pipeline(merge_pipeline_);
    destroy_pipeline(pbd_pipeline_);
    destroy_pipeline(tile_bin_pipeline_);
    destroy_pipeline(tile_count_pipeline_);
    destroy_pipeline(tile_scan_pipeline_);
    destroy_pipeline(tile_ranges_pipeline_);
    destroy_pipeline(tile_indirect_pipeline_);
    destroy_pipeline(tile_render_pipeline_);
    destroy_pipeline(onesweep_hist_pipeline_);
    destroy_pipeline(onesweep_scatter_pipeline_);

    destroy_layout(preprocess_pipeline_layout_);
    destroy_layout(sort_pipeline_layout_);
    destroy_layout(render_pipeline_layout_);
    destroy_layout(post_process_pipeline_layout_);
    destroy_layout(merge_pipeline_layout_);
    destroy_layout(pbd_pipeline_layout_);
    destroy_layout(tile_bin_pipeline_layout_);
    destroy_layout(tile_scan_pipeline_layout_);
    destroy_layout(tile_ranges_pipeline_layout_);
    destroy_layout(tile_indirect_pipeline_layout_);
    destroy_layout(tile_render_pipeline_layout_);
    destroy_layout(onesweep_hist_pipeline_layout_);
    destroy_layout(onesweep_scatter_pipeline_layout_);

    destroy_set_layout(preprocess_layout_);
    destroy_set_layout(sort_layout_);
    destroy_set_layout(render_layout_);
    destroy_set_layout(post_process_layout_);
    destroy_set_layout(merge_layout_);
    destroy_set_layout(pbd_layout_);
    destroy_set_layout(tile_bin_layout_);
    destroy_set_layout(tile_scan_layout_);
    destroy_set_layout(tile_ranges_layout_);
    destroy_set_layout(tile_indirect_layout_);
    destroy_set_layout(tile_render_layout_);
    destroy_set_layout(onesweep_hist_layout_);
    destroy_set_layout(onesweep_scatter_layout_);

    if (timestamp_pool_) { vkDestroyQueryPool(device_, timestamp_pool_, nullptr); timestamp_pool_ = VK_NULL_HANDLE; }
    if (gs_pool_) vkDestroyDescriptorPool(device_, gs_pool_, nullptr);

    initialized_ = false;
}

}  // namespace gseurat
