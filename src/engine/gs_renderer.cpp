#include "gseurat/engine/gs_renderer.hpp"
#include "gseurat/engine/debug.hpp"
#include "gseurat/engine/gs_renderer/gs_renderer_internal.hpp"
#include "gseurat/engine/log.hpp"
#include "gseurat/engine/pipeline.hpp"
#include "gseurat/engine/render_state.hpp"
#include "gseurat/engine/scoped_timer.hpp"

#include <cassert>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <stdexcept>
#include <string>
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
    // Phase 3.5: per-frame — every slot must be populated so the descriptor
    // writes for both tile_*_sets_[f] slots have a valid buffer handle.
    {
        static constexpr uint32_t kMaxTiles = 256 * 144;  // supports up to 4096×2304
        for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
            resources_->tile_ranges_ssbos[f] = Buffer::create_storage_gpu_only(allocator_,
                static_cast<VkDeviceSize>(kMaxTiles) * 2 * sizeof(uint32_t));
            // GPU-only: zeroed by vkCmdFillBuffer at dispatch time
            // Tiny dummy tile sort buffer (8 bytes) — just for descriptor binding validity
            resources_->tile_sort_as[f] = Buffer::create_storage_gpu_only(allocator_, 8);
            resources_->tile_sort_count_ssbos[f] = Buffer::create_storage_readback(allocator_, sizeof(uint32_t));
            std::memset(resources_->tile_sort_count_ssbos[f].mapped(), 0, sizeof(uint32_t));
            resources_->tile_indirect_args[f] = Buffer::create_storage_indirect(allocator_, 8 * sizeof(uint32_t));
            std::memset(resources_->tile_indirect_args[f].mapped(), 0, 8 * sizeof(uint32_t));
        }
    }

    create_descriptor_resources();
    create_compute_pipelines();

    // Phase 5b: init the post-process system. Must run after
    // create_descriptor_resources() (gs_pool_ live) and before
    // prewarm_pipelines() / update_descriptors() (both read post_'s
    // pipeline / descriptor sets).
    assert(resources_ != nullptr && "set_resources() must run before init()");
    post_.init(device_, pipeline_cache_, gs_pool_, resources_);

    // Phase 5e: init the PBD solver system. Must run after
    // create_descriptor_resources() (gs_pool_ live; PBD set is now allocated
    // inside pbd_.init() from gs_pool_, not in the bulk 4-set allocation).
    pbd_.init(device_, allocator_, pipeline_cache_, gs_pool_, resources_);

    // Phase 5e-2: streaming system captures device + allocator + the
    // resources / sort / tile back-pointers it needs for the heavy
    // mutators (init_streaming, publish_pending_chunks, clear_chunks,
    // poll_transfers). Must run after sort_/tile_ are initialised
    // (create_descriptor_resources above) so the pointers are valid.
    streaming_.init(device_, allocator_, resources_, &sort_, &tile_);

    // Create timestamp query pool for GPU profiling (2 queries: before/after rasterize)
    {
        VkQueryPoolCreateInfo qp_info{};
        qp_info.sType = VK_STRUCTURE_TYPE_QUERY_POOL_CREATE_INFO;
        qp_info.queryType = VK_QUERY_TYPE_TIMESTAMP;
        // Per-frame slots: 6 queries × kMaxFramesInFlight. Frame f writes
        // [f*6, f*6+6) and resets only its own slot before writing, so a
        // non-blocking read of a previous frame's slot is never invalidated
        // by a reset from a different frame.
        qp_info.queryCount = kTimestampPoolSize;
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
    resources_->output_width = width;
    resources_->output_height = height;

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
                   resources_->output_images[i], resources_->output_allocations[i], resources_->output_views[i],
                   "output");
        make_image(VK_FORMAT_R16_SFLOAT, kDepthUsage,
                   resources_->depth_images[i], resources_->depth_allocations[i], resources_->depth_views[i],
                   "depth");
        make_image(VK_FORMAT_R16G16B16A16_SFLOAT, kColorUsage,
                   resources_->processed_images[i], resources_->processed_allocations[i], resources_->processed_views[i],
                   "processed");
    }

    if (resources_->output_sampler == VK_NULL_HANDLE) {
        VkSamplerCreateInfo sampler_info{};
        sampler_info.sType = VK_STRUCTURE_TYPE_SAMPLER_CREATE_INFO;
        sampler_info.magFilter = VK_FILTER_NEAREST;
        sampler_info.minFilter = VK_FILTER_NEAREST;
        sampler_info.addressModeU = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
        sampler_info.addressModeV = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
        sampler_info.addressModeW = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;

        if (vkCreateSampler(device_, &sampler_info, nullptr, &resources_->output_sampler) != VK_SUCCESS) {
            throw std::runtime_error("Failed to create GS output sampler");
        }
    }

    // Post-process UBO buffer (80 bytes)
    if (!resources_->pp_ubo_buffer.buffer()) {
        resources_->pp_ubo_buffer = Buffer::create_uniform(allocator_, sizeof(GsPostProcessUbo));
    }
}

void GsRenderer::create_descriptor_resources() {
    // Descriptor pool — enough for all sets (including post-process + static/dynamic split).
    // Phase 2 bumped capacity to absorb the doubled compute-set count
    // (preprocess, sort, static_preprocess, dynamic_preprocess become per-frame).
    VkDescriptorPoolSize pool_sizes[] = {
        // Phase 3.5: +32 STORAGE_BUFFER for 7 newly-per-frame tile-pipeline
        // sets (tile_scan/tile_indirect/tile_ranges + onesweep hist_a/hist_b/
        // scatter_ab/scatter_ba) × ~3-4 SSBO bindings × 1 extra slot.
        {VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 416},   // many more for split buffers + Phase 2/3 per-frame
        {VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 24},
        {VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 48},
    };

    VkDescriptorPoolCreateInfo pool_info{};
    pool_info.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    pool_info.maxSets = 236;  // expanded for static/dynamic/merge + per-frame compute sets (Phase 3: +10 racing onesweep/merge/tile_bin sets per frame slot; Phase 3.5: +16 for per-frame tile_scan/tile_indirect/tile_ranges + onesweep tile sort sets; per-frame onesweep status fix: +4 for static depth onesweep slot [1])
    pool_info.poolSizeCount = 3;
    pool_info.pPoolSizes = pool_sizes;

    if (vkCreateDescriptorPool(device_, &pool_info, nullptr, &gs_pool_) != VK_SUCCESS) {
        throw std::runtime_error("Failed to create GS descriptor pool");
    }

    // Phase 5c: reset must run BEFORE any descriptor-set allocation from
    // this pool (including sort_'s 26 sets below). Originally placed
    // immediately before the central vkAllocateDescriptorSets call as
    // defense-in-depth for a hypothetical re-entry; now hoisted up so
    // sort_'s allocation isn't invalidated.
    vkResetDescriptorPool(device_, gs_pool_, 0);

    // Phase 5c: GsSortSystem creates its own layouts/pipelines/sets here.
    // Phase 5d: GsTileBinSystem creates its own layouts/pipelines/sets
    // here too, AFTER sort_ (it borrows sort_'s onesweep set layouts for
    // the tile-onesweep descriptor sets).
    assert(resources_ != nullptr && "set_resources() must run before init()");
    sort_.init(device_, pipeline_cache_, gs_pool_, resources_);
    tile_.init(device_, pipeline_cache_, gs_pool_, resources_, &sort_);

    // Phase 5e step 2: preprocess descriptor set layout creation moved into
    // GsSortSystem::init(). The layout, pipeline layout, pipeline, and 4
    // preprocess sets are now allocated inside sort_.init().

    // #397: render_layout_ + render_sets_ deleted — they were owned by the
    // pre-tile-bin full-raster pipeline removed in PR 1c. Post-1c the only
    // active render path is `GsTileBinSystem::dispatch_render`, which owns
    // its own tile_render_layout_ + tile_render_sets_.
    //
    // #397: sort_layout_ + sort_sets_ + sort_pipeline_(_layout_) deleted —
    // the legacy depth-sort pipeline was retired when Onesweep moved into
    // GsSortSystem (Phase 5c). The sets were write-only since.

    // Phase 5b: post-process descriptor set layout moved to GsPostProcessSystem.

    // Phase 5c: merge descriptor set layout moved to GsSortSystem.

    // Phase 5c: onesweep histogram + scatter descriptor set layouts moved to GsSortSystem.
    // Phase 5d: tile_bin / tile_scan / tile_indirect / tile_render / tile_ranges
    // descriptor set layouts now live inside GsTileBinSystem (already created
    // by tile_.init() above).

    // Phase 5e step 1.10: PBD solver set layout moved to GsPbdSystem (pbd_.init()).

    // Allocate all descriptor sets. (Reset was hoisted up to run BEFORE
    // sort_.init() so that sort_'s 26 sets aren't invalidated.)

    // Per-frame intermediate images (`output_image_[i]`, `depth_image_[i]`,
    // `processed_image_[i]`) require per-frame descriptor sets because a
    // single VkDescriptorSet binds to one VkImageView. The render,
    // post_process, and tile_render sets all bind at least one of those
    // images, so we allocate `kMaxFramesInFlight` of each.
    static_assert(kMaxFramesInFlight == 2,
                  "Per-frame descriptor allocation below assumes 2 frames in flight; "
                  "if you change kMaxFramesInFlight, also extend the per-frame slot "
                  "indices for render/post_process/tile_render and the Phase 2/3 "
                  "per-frame compute sets (preprocess/sort/static_preprocess/"
                  "dynamic_preprocess/merge/depth_hist/depth_scatter/dynamic_depth_hist/"
                  "dynamic_depth_scatter) at the end of `layouts`.");

    // Phase 5c: depth-sort + merge slots removed (26 sets owned by GsSortSystem).
    // Phase 5d: tile-bin + tile-onesweep slots removed (18 sets owned by
    // GsTileBinSystem). #397: render/preprocess/sort orphan slots removed.
    // Phase 5e: pbd slot removed (1 set now owned by GsPbdSystem).
    // Phase 5e step 2: static_preprocess/dynamic_preprocess sets moved to
    //   GsSortSystem (allocated in sort_.init() above). kSetCount now 0 —
    //   this bulk allocation is empty; all descriptor sets are subsystem-owned.
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

    // Phase 5e step 2: gs_preprocess.comp.spv pipeline creation moved to
    // GsSortSystem::init(). No pipelines remain in this function except
    // the compose pass (below).
    // #397: legacy gs_sort.comp pipeline retired — Onesweep depth sort
    // (GsSortSystem) is the live path.

    // Phase 5b: post-process pipeline lives in GsPostProcessSystem.

    // Phase 5e step 1.10: PBD solver pipeline moved to GsPbdSystem (pbd_.init()).

    // Phase 5c: merge pipeline owned by GsSortSystem.
    // Phase 5c: onesweep histogram + scatter pipelines owned by GsSortSystem.
    // Phase 5d: tile_bin, tile_count, tile_scan, tile_ranges, tile_prepare_indirect,
    // tile_render pipelines owned by GsTileBinSystem (created by tile_.init()).

    // Phase 4c-vfx: compose pass (own descriptor pool to avoid disturbing
    // the central gs_pool_ slot indexing).
    create_compose_pipeline();
}

void GsRenderer::create_compose_pipeline() {
    // Set layout: src (binding 0, readonly SSBO) + dst (binding 1, RW SSBO).
    VkDescriptorSetLayoutBinding bindings[2] = {
        {0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
        {1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 1, VK_SHADER_STAGE_COMPUTE_BIT, nullptr},
    };
    VkDescriptorSetLayoutCreateInfo set_ci{};
    set_ci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
    set_ci.bindingCount = 2;
    set_ci.pBindings = bindings;
    if (vkCreateDescriptorSetLayout(device_, &set_ci, nullptr, &compose_layout_) != VK_SUCCESS) {
        throw std::runtime_error("Failed to create compose descriptor set layout");
    }

    // Pipeline layout: 8-byte push range { splat_count, dst_offset }.
    VkPushConstantRange push{};
    push.stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
    push.offset = 0;
    push.size = 8;
    VkPipelineLayoutCreateInfo pl_ci{};
    pl_ci.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
    pl_ci.setLayoutCount = 1;
    pl_ci.pSetLayouts = &compose_layout_;
    pl_ci.pushConstantRangeCount = 1;
    pl_ci.pPushConstantRanges = &push;
    if (vkCreatePipelineLayout(device_, &pl_ci, nullptr, &compose_pipeline_layout_) != VK_SUCCESS) {
        throw std::runtime_error("Failed to create compose pipeline layout");
    }

    // Compute pipeline.
    auto module = load_shader_module(device_, "shaders/gs_compose.comp.spv");
    VkPipelineShaderStageCreateInfo stage{};
    stage.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
    stage.module = module;
    stage.pName = "main";

    VkComputePipelineCreateInfo pipe_info{};
    pipe_info.sType = VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO;
    pipe_info.stage = stage;
    pipe_info.layout = compose_pipeline_layout_;
    if (vkCreateComputePipelines(device_, pipeline_cache_, 1, &pipe_info, nullptr,
                                  &compose_pipeline_) != VK_SUCCESS) {
        throw std::runtime_error("Failed to create compose pipeline");
    }
    vkDestroyShaderModule(device_, module, nullptr);

    // Dedicated descriptor pool — 3 × kMaxFramesInFlight sets
    // (vfx + pbd + particles), each with 2 SSBO bindings (src + dst).
    constexpr uint32_t kSetsPerSource = kMaxFramesInFlight;
    constexpr uint32_t kSources = 3;  // vfx + pbd + particles
    VkDescriptorPoolSize pool_sizes[1] = {
        {VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, kSetsPerSource * kSources * 2},
    };
    VkDescriptorPoolCreateInfo pool_ci{};
    pool_ci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    pool_ci.maxSets = kSetsPerSource * kSources;
    pool_ci.poolSizeCount = 1;
    pool_ci.pPoolSizes = pool_sizes;
    if (vkCreateDescriptorPool(device_, &pool_ci, nullptr, &compose_pool_) != VK_SUCCESS) {
        throw std::runtime_error("Failed to create compose descriptor pool");
    }

    std::array<VkDescriptorSetLayout, kMaxFramesInFlight> layouts;
    for (auto& l : layouts) l = compose_layout_;
    VkDescriptorSetAllocateInfo alloc_info{};
    alloc_info.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
    alloc_info.descriptorPool = compose_pool_;
    alloc_info.descriptorSetCount = kMaxFramesInFlight;
    alloc_info.pSetLayouts = layouts.data();
    if (vkAllocateDescriptorSets(device_, &alloc_info, compose_sets_vfx_.data()) != VK_SUCCESS) {
        throw std::runtime_error("Failed to allocate compose (vfx) descriptor sets");
    }
    if (vkAllocateDescriptorSets(device_, &alloc_info, compose_sets_pbd_.data()) != VK_SUCCESS) {
        throw std::runtime_error("Failed to allocate compose (pbd) descriptor sets");
    }
    if (vkAllocateDescriptorSets(device_, &alloc_info, compose_sets_particles_.data()) != VK_SUCCESS) {
        throw std::runtime_error("Failed to allocate compose (particles) descriptor sets");
    }
}

void GsRenderer::update_compose_descriptors() {
    if (!render_state_) return;
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        VkDescriptorBufferInfo vfx_src_info{render_state_->vfx_buffer(FrameIndex{f}), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo pbd_src_info{render_state_->pbd_buffer(FrameIndex{f}), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo part_src_info{render_state_->particles_buffer(FrameIndex{f}), 0, VK_WHOLE_SIZE};
        VkDescriptorBufferInfo dst_info{resources_->dynamic_gaussian_ssbo.buffer(), 0, VK_WHOLE_SIZE};

        VkWriteDescriptorSet writes[6]{};
        writes[0].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
        writes[0].dstSet = compose_sets_vfx_[f];
        writes[0].dstBinding = 0;
        writes[0].descriptorCount = 1;
        writes[0].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
        writes[0].pBufferInfo = &vfx_src_info;

        writes[1].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
        writes[1].dstSet = compose_sets_vfx_[f];
        writes[1].dstBinding = 1;
        writes[1].descriptorCount = 1;
        writes[1].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
        writes[1].pBufferInfo = &dst_info;

        writes[2].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
        writes[2].dstSet = compose_sets_pbd_[f];
        writes[2].dstBinding = 0;
        writes[2].descriptorCount = 1;
        writes[2].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
        writes[2].pBufferInfo = &pbd_src_info;

        writes[3].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
        writes[3].dstSet = compose_sets_pbd_[f];
        writes[3].dstBinding = 1;
        writes[3].descriptorCount = 1;
        writes[3].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
        writes[3].pBufferInfo = &dst_info;

        writes[4].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
        writes[4].dstSet = compose_sets_particles_[f];
        writes[4].dstBinding = 0;
        writes[4].descriptorCount = 1;
        writes[4].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
        writes[4].pBufferInfo = &part_src_info;

        writes[5].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
        writes[5].dstSet = compose_sets_particles_[f];
        writes[5].dstBinding = 1;
        writes[5].descriptorCount = 1;
        writes[5].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
        writes[5].pBufferInfo = &dst_info;

        vkUpdateDescriptorSets(device_, 6, writes, 0, nullptr);
    }
    compose_descriptors_initialised_ = true;
}

void GsRenderer::dispatch_compose_vfx(VkCommandBuffer cmd, FrameIndex frame_idx,
                                       uint32_t vfx_count) {
    if (vfx_count == 0 || !compose_descriptors_initialised_) return;

    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, compose_pipeline_);
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                            compose_pipeline_layout_, 0, 1,
                            &compose_sets_vfx_[to_u32(frame_idx)], 0, nullptr);
    struct PushConstants {
        uint32_t splat_count;
        uint32_t dst_offset;
    } pc{vfx_count, persistent_dyn_count_};
    vkCmdPushConstants(cmd, compose_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                       0, sizeof(pc), &pc);
    constexpr uint32_t kLocalSize = 64;
    const uint32_t groups = (vfx_count + kLocalSize - 1) / kLocalSize;
    vkCmdDispatch(cmd, groups, 1, 1);

    // Compute→compute SSBO write→read barrier so the downstream preprocess
    // pipeline (which reads dynamic_gaussian_ssbo) sees our writes.
    // dispatch_compose_pbd, if it runs next, only writes disjoint slots, but
    // we keep this barrier here so a vfx-only frame remains correct on its
    // own; pbd's barrier handles the second-source case.
    VkMemoryBarrier mb{};
    mb.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
    mb.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
    mb.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
    vkCmdPipelineBarrier(cmd,
                         VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                         VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                         0, 1, &mb, 0, nullptr, 0, nullptr);
}

void GsRenderer::dispatch_compose_pbd(VkCommandBuffer cmd, FrameIndex frame_idx,
                                       uint32_t vfx_count, uint32_t pbd_count) {
    if (pbd_count == 0 || !compose_descriptors_initialised_) return;

    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, compose_pipeline_);
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                            compose_pipeline_layout_, 0, 1,
                            &compose_sets_pbd_[to_u32(frame_idx)], 0, nullptr);
    struct PushConstants {
        uint32_t splat_count;
        uint32_t dst_offset;
    } pc{pbd_count, persistent_dyn_count_ + vfx_count};
    vkCmdPushConstants(cmd, compose_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                       0, sizeof(pc), &pc);
    constexpr uint32_t kLocalSize = 64;
    const uint32_t groups = (pbd_count + kLocalSize - 1) / kLocalSize;
    vkCmdDispatch(cmd, groups, 1, 1);

    VkMemoryBarrier mb{};
    mb.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
    mb.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
    mb.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
    vkCmdPipelineBarrier(cmd,
                         VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                         VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                         0, 1, &mb, 0, nullptr, 0, nullptr);
}

void GsRenderer::dispatch_compose_particles(VkCommandBuffer cmd, FrameIndex frame_idx,
                                             uint32_t prior_offset,
                                             uint32_t particles_count) {
    if (particles_count == 0 || !compose_descriptors_initialised_) return;

    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, compose_pipeline_);
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE,
                            compose_pipeline_layout_, 0, 1,
                            &compose_sets_particles_[to_u32(frame_idx)], 0, nullptr);
    struct PushConstants {
        uint32_t splat_count;
        uint32_t dst_offset;
    } pc{particles_count, persistent_dyn_count_ + prior_offset};
    vkCmdPushConstants(cmd, compose_pipeline_layout_, VK_SHADER_STAGE_COMPUTE_BIT,
                       0, sizeof(pc), &pc);
    constexpr uint32_t kLocalSize = 64;
    const uint32_t groups = (particles_count + kLocalSize - 1) / kLocalSize;
    vkCmdDispatch(cmd, groups, 1, 1);

    VkMemoryBarrier mb{};
    mb.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER;
    mb.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
    mb.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
    vkCmdPipelineBarrier(cmd,
                         VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                         VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                         0, 1, &mb, 0, nullptr, 0, nullptr);
}

// Pre-warm every compute pipeline created above by submitting a separate
// `vkCmdDispatch(1,1,1)` per pipeline, each in its own command buffer with
// a `vkQueueWaitIdle` between submissions. The first attempt at this in
// PR #409 recorded all 13 dispatches into one command buffer; on MoltenVK
// that triggered parallel `MTLComputePipelineState` compilation across all
// shaders and crashed WindowServer on a Mac at modest free-memory levels
// (panic kernel, #410 reverted it).
//
// Per-pipeline serialization forces Metal to compile one PSO per `WaitIdle`
// boundary, dropping peak compile-time memory ~13×. Total prewarm time
// grows from a few seconds (old parallel design) to ~30-60s on a cold
// cache, but it is bounded and predictable instead of system-fatal.
//
// SECOND HAZARD — the macOS WindowServer watchdog (bug_type 409). Even
// serialized, ~13 cold PSO compiles back-to-back monopolize the Metal
// driver and starve WindowServer past its 40 s "no checkin" threshold,
// which kills the user session. The submission loop below sleeps briefly
// after each `WaitIdle` so the kernel can schedule WindowServer's GPU work
// between compiles. Total added latency is small relative to compile time
// and bounded by `entries.size() × kYieldMs`.
//
// All resources are tracked at function scope so the cleanup lambda below
// can destroy whatever was actually created on ANY exit path — including
// the catch handler. Soft-fail: prewarm is an optimization, so any error
// logs and returns; the engine continues with cold caches.
void GsRenderer::prewarm_pipelines(VkQueue queue, VkCommandPool cmd_pool,
                                   std::function<void()> pump_events) {
    using clock = std::chrono::steady_clock;
    auto t_begin = clock::now();

    Buffer dummy_ssbo;
    Buffer dummy_ubo;
    VkImage     color_img    = VK_NULL_HANDLE;
    VmaAllocation color_alloc = VK_NULL_HANDLE;
    VkImageView color_view   = VK_NULL_HANDLE;
    VkImage     depth_img    = VK_NULL_HANDLE;
    VmaAllocation depth_alloc = VK_NULL_HANDLE;
    VkImageView depth_view   = VK_NULL_HANDLE;
    VkDescriptorPool prewarm_pool = VK_NULL_HANDLE;
    size_t pipeline_count = 0;

    auto cleanup = [&]() {
        if (prewarm_pool != VK_NULL_HANDLE)
            vkDestroyDescriptorPool(device_, prewarm_pool, nullptr);
        if (dummy_ssbo.buffer() != VK_NULL_HANDLE) dummy_ssbo.destroy(allocator_);
        if (dummy_ubo.buffer()  != VK_NULL_HANDLE) dummy_ubo.destroy(allocator_);
        if (color_view != VK_NULL_HANDLE) vkDestroyImageView(device_, color_view, nullptr);
        if (color_img  != VK_NULL_HANDLE) vmaDestroyImage(allocator_, color_img, color_alloc);
        if (depth_view != VK_NULL_HANDLE) vkDestroyImageView(device_, depth_view, nullptr);
        if (depth_img  != VK_NULL_HANDLE) vmaDestroyImage(allocator_, depth_img, depth_alloc);
    };

    try {
        // ── 1. Dummy buffers ──────────────────────────────────────────────
        constexpr VkDeviceSize kDummySsboSize = 4096;
        constexpr VkDeviceSize kDummyUboSize = sizeof(GsUniforms);
        dummy_ssbo = Buffer::create_storage_gpu_only(allocator_, kDummySsboSize);
        dummy_ubo  = Buffer::create_uniform(allocator_, kDummyUboSize);
        std::memset(dummy_ubo.mapped(), 0, kDummyUboSize);

        // ── 2. Dummy storage images ───────────────────────────────────────
        auto make_dummy_image = [&](VkFormat format, VkImage& out_image,
                                    VmaAllocation& out_alloc, VkImageView& out_view) {
            VkImageCreateInfo ic{};
            ic.sType = VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO;
            ic.imageType = VK_IMAGE_TYPE_2D;
            ic.format = format;
            ic.extent = {1, 1, 1};
            ic.mipLevels = 1;
            ic.arrayLayers = 1;
            ic.samples = VK_SAMPLE_COUNT_1_BIT;
            ic.tiling = VK_IMAGE_TILING_OPTIMAL;
            ic.usage = VK_IMAGE_USAGE_STORAGE_BIT;
            VmaAllocationCreateInfo ai{};
            ai.usage = VMA_MEMORY_USAGE_GPU_ONLY;
            if (vmaCreateImage(allocator_, &ic, &ai, &out_image, &out_alloc, nullptr) != VK_SUCCESS) {
                throw std::runtime_error("[prewarm] Failed to create dummy storage image");
            }
            VkImageViewCreateInfo vi{};
            vi.sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO;
            vi.image = out_image;
            vi.viewType = VK_IMAGE_VIEW_TYPE_2D;
            vi.format = format;
            vi.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
            if (vkCreateImageView(device_, &vi, nullptr, &out_view) != VK_SUCCESS) {
                throw std::runtime_error("[prewarm] Failed to create dummy image view");
            }
        };
        make_dummy_image(VK_FORMAT_R16G16B16A16_SFLOAT, color_img, color_alloc, color_view);
        make_dummy_image(VK_FORMAT_R16_SFLOAT,           depth_img, depth_alloc, depth_view);

        // ── 3. One-shot pre-pass: image transitions + SSBO zero-fill ──────
        // Combined into a single short-lived cmd buffer so the actual prewarm
        // loop below can submit one cmd-buffer-per-pipeline cleanly.
        {
            VkCommandBuffer pre_cmd = VK_NULL_HANDLE;
            VkCommandBufferAllocateInfo cba{};
            cba.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO;
            cba.commandPool = cmd_pool;
            cba.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
            cba.commandBufferCount = 1;
            if (vkAllocateCommandBuffers(device_, &cba, &pre_cmd) != VK_SUCCESS) {
                throw std::runtime_error("[prewarm] Failed to allocate pre-pass cmd buffer");
            }

            VkCommandBufferBeginInfo cbb{};
            cbb.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
            cbb.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
            if (vkBeginCommandBuffer(pre_cmd, &cbb) != VK_SUCCESS) {
                vkFreeCommandBuffers(device_, cmd_pool, 1, &pre_cmd);
                throw std::runtime_error("[prewarm] vkBeginCommandBuffer (pre) failed");
            }

            // Image transitions: UNDEFINED → GENERAL.
            VkImageMemoryBarrier img_barriers[2]{};
            for (int i = 0; i < 2; ++i) {
                img_barriers[i].sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
                img_barriers[i].oldLayout = VK_IMAGE_LAYOUT_UNDEFINED;
                img_barriers[i].newLayout = VK_IMAGE_LAYOUT_GENERAL;
                img_barriers[i].srcAccessMask = 0;
                img_barriers[i].dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
                img_barriers[i].srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
                img_barriers[i].dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
                img_barriers[i].subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
            }
            img_barriers[0].image = color_img;
            img_barriers[1].image = depth_img;

            vkCmdPipelineBarrier(pre_cmd,
                VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT,
                VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                0, 0, nullptr, 0, nullptr, 2, img_barriers);

            // Zero the dummy SSBO. Several shaders read control/count values
            // before deciding how much work to do; uninitialized GPU-only
            // allocations contain recycled VRAM and a 1×1 dispatch could
            // OOB-read/write off bogus counts (Codex P1 from #409).
            vkCmdFillBuffer(pre_cmd, dummy_ssbo.buffer(), 0, VK_WHOLE_SIZE, 0);
            VkBufferMemoryBarrier fill_barrier{};
            fill_barrier.sType = VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER;
            fill_barrier.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
            fill_barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
            fill_barrier.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
            fill_barrier.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
            fill_barrier.buffer = dummy_ssbo.buffer();
            fill_barrier.offset = 0;
            fill_barrier.size = VK_WHOLE_SIZE;
            vkCmdPipelineBarrier(pre_cmd,
                VK_PIPELINE_STAGE_TRANSFER_BIT,
                VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                0, 0, nullptr, 1, &fill_barrier, 0, nullptr);

            if (vkEndCommandBuffer(pre_cmd) != VK_SUCCESS) {
                vkFreeCommandBuffers(device_, cmd_pool, 1, &pre_cmd);
                throw std::runtime_error("[prewarm] vkEndCommandBuffer (pre) failed");
            }
            VkSubmitInfo sub{};
            sub.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
            sub.commandBufferCount = 1;
            sub.pCommandBuffers = &pre_cmd;
            if (vkQueueSubmit(queue, 1, &sub, VK_NULL_HANDLE) != VK_SUCCESS) {
                vkFreeCommandBuffers(device_, cmd_pool, 1, &pre_cmd);
                throw std::runtime_error("[prewarm] vkQueueSubmit (pre) failed");
            }
            vkQueueWaitIdle(queue);
            vkFreeCommandBuffers(device_, cmd_pool, 1, &pre_cmd);
        }

        // ── 4. Transient descriptor pool ──────────────────────────────────
        VkDescriptorPoolSize pool_sizes[] = {
            {VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 128},
            {VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 32},
            {VK_DESCRIPTOR_TYPE_STORAGE_IMAGE,  16},
        };
        VkDescriptorPoolCreateInfo dpc{};
        dpc.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
        dpc.maxSets = 32;
        dpc.poolSizeCount = 3;
        dpc.pPoolSizes = pool_sizes;
        if (vkCreateDescriptorPool(device_, &dpc, nullptr, &prewarm_pool) != VK_SUCCESS) {
            throw std::runtime_error("[prewarm] Failed to create descriptor pool");
        }

        // ── 5. Pipeline entries (mirrors create_compute_pipelines layout) ─
        struct PipelineEntry {
            const char* name;
            VkPipeline pipeline;
            VkPipelineLayout layout;
            VkDescriptorSetLayout set_layout;
            struct ImageBinding {
                uint32_t binding;
                VkImageView view;
            };
            std::array<ImageBinding, 3> image_bindings{};
            uint32_t image_binding_count = 0;
            std::array<uint32_t, 2> uniform_bindings{};
            uint32_t uniform_binding_count = 0;
            std::array<uint32_t, 8> storage_bindings{};
            uint32_t storage_binding_count = 0;
            uint32_t push_size = 0;
        };

        std::vector<PipelineEntry> entries;
        entries.reserve(13);
        auto add_entry = [&](const char* name, VkPipeline p, VkPipelineLayout pl,
                             VkDescriptorSetLayout sl, uint32_t push_size,
                             std::initializer_list<uint32_t> ssbo_bindings,
                             std::initializer_list<uint32_t> ubo_bindings,
                             std::initializer_list<std::pair<uint32_t, VkImageView>> img_bindings) {
            PipelineEntry e{};
            e.name = name;
            e.pipeline = p;
            e.layout = pl;
            e.set_layout = sl;
            e.push_size = push_size;
            for (auto b : ssbo_bindings) e.storage_bindings[e.storage_binding_count++] = b;
            for (auto b : ubo_bindings)  e.uniform_bindings[e.uniform_binding_count++] = b;
            for (const auto& ib : img_bindings) {
                e.image_bindings[e.image_binding_count++] = {ib.first, ib.second};
            }
            entries.push_back(e);
        };

        // Phase 5e step 2: gs_preprocess pipeline now owned by GsSortSystem.
        {
            auto sort_entries = sort_.prewarm_entries();
            // sort_entries[3] is the preprocess pipeline.
            add_entry("gs_preprocess",
                      sort_entries[3].pipeline,
                      sort_entries[3].pipeline_layout,
                      sort_entries[3].set_layout,
                      sizeof(GsPreprocessPush),
                      {0,1,2,4,5,6,8}, {3}, {});
        }
        // #397: gs_sort prewarm entry retired with the legacy sort pipeline.
        // Phase 5b: post-process pipeline owned by GsPostProcessSystem.
        {
            auto info = post_.prewarm_info();
            add_entry("gs_post_process", info.pipeline, info.pipeline_layout,
                      info.set_layout, 0,
                      {}, {3},
                      {{0u, color_view}, {1u, depth_view}, {2u, color_view}});
        }
        // Phase 5e step 1.10: PBD pipeline owned by GsPbdSystem.
        {
            auto pbd_pe = pbd_.prewarm_entry();
            add_entry("pbd_solver", pbd_pe.pipeline, pbd_pe.pipeline_layout, pbd_pe.set_layout,
                      sizeof(uint32_t),
                      {0,1,2}, {3}, {});
        }
        // Phase 5c: merge pipeline owned by GsSortSystem.
        {
            auto entries = sort_.prewarm_entries();
            // entries[2] is the merge pipeline.
            add_entry("gs_merge", entries[2].pipeline, entries[2].pipeline_layout,
                      entries[2].set_layout, 0, {0,1,2,3}, {}, {});
        }
        // Phase 5c: onesweep histogram + scatter pipelines owned by GsSortSystem.
        {
            auto entries = sort_.prewarm_entries();
            add_entry("gs_onesweep_histogram", entries[0].pipeline,
                      entries[0].pipeline_layout, entries[0].set_layout, 4,
                      {0,1,2}, {}, {});
            add_entry("gs_onesweep_scatter", entries[1].pipeline,
                      entries[1].pipeline_layout, entries[1].set_layout, 4,
                      {0,1,2,3}, {}, {});
        }
        // Phase 5d: tile pipelines owned by GsTileBinSystem.
        {
            auto tile_entries = tile_.prewarm_entries();
            // [0] gs_tile_bin, [1] gs_tile_count, [2] gs_tile_scan,
            // [3] gs_tile_ranges, [4] gs_tile_prepare_indirect, [5] gs_tile_render
            add_entry(tile_entries[0].name, tile_entries[0].pipeline,
                      tile_entries[0].pipeline_layout, tile_entries[0].set_layout,
                      tile_entries[0].push_size, {0,1,2,3,4,5}, {6}, {});
            add_entry(tile_entries[1].name, tile_entries[1].pipeline,
                      tile_entries[1].pipeline_layout, tile_entries[1].set_layout,
                      tile_entries[1].push_size, {0,1,2,3,4,5}, {6}, {});
            add_entry(tile_entries[2].name, tile_entries[2].pipeline,
                      tile_entries[2].pipeline_layout, tile_entries[2].set_layout,
                      tile_entries[2].push_size, {0,1,2,3}, {}, {});
            add_entry(tile_entries[3].name, tile_entries[3].pipeline,
                      tile_entries[3].pipeline_layout, tile_entries[3].set_layout,
                      tile_entries[3].push_size, {0,1,2}, {}, {});
            add_entry(tile_entries[4].name, tile_entries[4].pipeline,
                      tile_entries[4].pipeline_layout, tile_entries[4].set_layout,
                      tile_entries[4].push_size, {0,1}, {}, {});
            add_entry(tile_entries[5].name, tile_entries[5].pipeline,
                      tile_entries[5].pipeline_layout, tile_entries[5].set_layout,
                      tile_entries[5].push_size, {0,1,4}, {2},
                      {{3u, color_view}, {5u, depth_view}});
        }

        // Allocate one descriptor set per entry.
        std::vector<VkDescriptorSetLayout> set_layouts;
        set_layouts.reserve(entries.size());
        for (const auto& e : entries) set_layouts.push_back(e.set_layout);

        std::vector<VkDescriptorSet> sets(entries.size(), VK_NULL_HANDLE);
        VkDescriptorSetAllocateInfo dai{};
        dai.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
        dai.descriptorPool = prewarm_pool;
        dai.descriptorSetCount = static_cast<uint32_t>(set_layouts.size());
        dai.pSetLayouts = set_layouts.data();
        if (vkAllocateDescriptorSets(device_, &dai, sets.data()) != VK_SUCCESS) {
            throw std::runtime_error("[prewarm] Failed to allocate descriptor sets");
        }

        // Write valid bindings for each set.
        {
            std::vector<VkDescriptorBufferInfo> ssbo_infos;
            std::vector<VkDescriptorBufferInfo> ubo_infos;
            std::vector<VkDescriptorImageInfo>  img_infos;
            ssbo_infos.reserve(128);
            ubo_infos.reserve(32);
            img_infos.reserve(32);

            std::vector<VkWriteDescriptorSet> writes;
            writes.reserve(128);

            for (size_t i = 0; i < entries.size(); ++i) {
                const auto& e = entries[i];
                VkDescriptorSet set = sets[i];
                for (uint32_t bi = 0; bi < e.storage_binding_count; ++bi) {
                    ssbo_infos.push_back({dummy_ssbo.buffer(), 0, VK_WHOLE_SIZE});
                    VkWriteDescriptorSet w{};
                    w.sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
                    w.dstSet = set;
                    w.dstBinding = e.storage_bindings[bi];
                    w.descriptorCount = 1;
                    w.descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
                    w.pBufferInfo = &ssbo_infos.back();
                    writes.push_back(w);
                }
                for (uint32_t bi = 0; bi < e.uniform_binding_count; ++bi) {
                    ubo_infos.push_back({dummy_ubo.buffer(), 0, VK_WHOLE_SIZE});
                    VkWriteDescriptorSet w{};
                    w.sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
                    w.dstSet = set;
                    w.dstBinding = e.uniform_bindings[bi];
                    w.descriptorCount = 1;
                    w.descriptorType = VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER;
                    w.pBufferInfo = &ubo_infos.back();
                    writes.push_back(w);
                }
                for (uint32_t bi = 0; bi < e.image_binding_count; ++bi) {
                    img_infos.push_back({VK_NULL_HANDLE, e.image_bindings[bi].view,
                                         VK_IMAGE_LAYOUT_GENERAL});
                    VkWriteDescriptorSet w{};
                    w.sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
                    w.dstSet = set;
                    w.dstBinding = e.image_bindings[bi].binding;
                    w.descriptorCount = 1;
                    w.descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_IMAGE;
                    w.pImageInfo = &img_infos.back();
                    writes.push_back(w);
                }
            }
            vkUpdateDescriptorSets(device_, static_cast<uint32_t>(writes.size()),
                                   writes.data(), 0, nullptr);
        }

        // ── 6. Per-pipeline submission loop ───────────────────────────────
        // KEY DIFFERENCE FROM #409: each pipeline gets its OWN command
        // buffer, submitted alone and `vkQueueWaitIdle`'d before moving on.
        // The wait pins us to a single in-flight Metal compile at a time,
        // so peak compile-memory pressure is 1 PSO not 13.
        //
        // ALSO: yield to the OS between submissions. The crash log behind
        // #406's watchdog post-mortem (bug_type 409, "40 seconds since last
        // successful checkin") showed WindowServer killed by the macOS
        // watchdog while MoltenVK held the GPU driver compiling PSOs. Even
        // with per-pipeline serialization, a long enough chain of cold
        // compiles (~13 pipelines × multi-second each) can starve
        // WindowServer past the 40 s threshold. After every `WaitIdle`
        // we sleep briefly so the kernel can schedule WindowServer's GPU
        // work and macOS can refresh its watchdog checkin. Total added
        // latency is bounded (~entries.size() × kYieldMs) and dwarfed by
        // PSO compile time on a cold cache.
        constexpr int kYieldMs = 50;
        uint8_t push_scratch[16] = {0};
        for (size_t i = 0; i < entries.size(); ++i) {
            const auto& e = entries[i];
            auto t_pipeline_begin = clock::now();

            VkCommandBuffer cmd = VK_NULL_HANDLE;
            VkCommandBufferAllocateInfo cba{};
            cba.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO;
            cba.commandPool = cmd_pool;
            cba.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
            cba.commandBufferCount = 1;
            if (vkAllocateCommandBuffers(device_, &cba, &cmd) != VK_SUCCESS) {
                throw std::runtime_error(std::string("[prewarm] alloc cmd failed for ") + e.name);
            }

            VkCommandBufferBeginInfo cbb{};
            cbb.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
            cbb.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
            if (vkBeginCommandBuffer(cmd, &cbb) != VK_SUCCESS) {
                vkFreeCommandBuffers(device_, cmd_pool, 1, &cmd);
                throw std::runtime_error(std::string("[prewarm] begin cmd failed for ") + e.name);
            }

            // SHADER_WRITE -> SHADER_READ memory barrier on the shared dummy
            // SSBO. `vkQueueWaitIdle` between submissions serializes execution
            // (and compile pressure) but does NOT make shader writes from a
            // prior submission visible to subsequent shader reads on the same
            // queue — Vulkan's spec requires an explicit memory dependency
            // (Codex P2 review on PR #411). Without this, dispatches like
            // `gs_onesweep_scatter` could read pre-fill zeros for indirect
            // args (e.g. max_wg=0) instead of `gs_tile_prepare_indirect`'s
            // outputs, in turn potentially OOB-indexing into status buffers.
            // The first iteration's barrier is a no-op (buffer is freshly
            // zeroed), but unconditional issuance keeps the loop simple.
            VkBufferMemoryBarrier ssbo_barrier{};
            ssbo_barrier.sType = VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER;
            ssbo_barrier.srcAccessMask = VK_ACCESS_SHADER_WRITE_BIT;
            ssbo_barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT | VK_ACCESS_SHADER_WRITE_BIT;
            ssbo_barrier.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
            ssbo_barrier.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
            ssbo_barrier.buffer = dummy_ssbo.buffer();
            ssbo_barrier.offset = 0;
            ssbo_barrier.size = VK_WHOLE_SIZE;
            vkCmdPipelineBarrier(cmd,
                VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
                0, 0, nullptr, 1, &ssbo_barrier, 0, nullptr);

            vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, e.pipeline);
            vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_COMPUTE, e.layout,
                                    0, 1, &sets[i], 0, nullptr);
            if (e.push_size > 0) {
                vkCmdPushConstants(cmd, e.layout, VK_SHADER_STAGE_COMPUTE_BIT,
                                   0, e.push_size, push_scratch);
            }
            vkCmdDispatch(cmd, 1, 1, 1);

            if (vkEndCommandBuffer(cmd) != VK_SUCCESS) {
                vkFreeCommandBuffers(device_, cmd_pool, 1, &cmd);
                throw std::runtime_error(std::string("[prewarm] end cmd failed for ") + e.name);
            }

            VkSubmitInfo sub{};
            sub.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
            sub.commandBufferCount = 1;
            sub.pCommandBuffers = &cmd;
            if (vkQueueSubmit(queue, 1, &sub, VK_NULL_HANDLE) != VK_SUCCESS) {
                vkFreeCommandBuffers(device_, cmd_pool, 1, &cmd);
                throw std::runtime_error(std::string("[prewarm] submit failed for ") + e.name);
            }
            vkQueueWaitIdle(queue);
            vkFreeCommandBuffers(device_, cmd_pool, 1, &cmd);

            // Drain queued window events immediately after the WaitIdle stall
            // (which can be multi-second on a cold MoltenVK compile). Without
            // this the demo window appears frozen for the entire prewarm pass
            // — focus changes and expose events sit unprocessed until the
            // main loop resumes polling.
            if (pump_events) pump_events();

            auto pipeline_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                clock::now() - t_pipeline_begin).count();
            std::fprintf(stderr,
                "[prewarm] %zu/%zu %s — %lld ms\n",
                i + 1, entries.size(), e.name,
                static_cast<long long>(pipeline_ms));

            // Yield to the OS so WindowServer can checkin with its watchdog
            // (see comment above the loop), while continuing to drain window
            // events on a sub-tick cadence so the window stays interactive.
            // Skip the yield after the last pipeline — caller is about to
            // return and resume the main loop.
            if (i + 1 < entries.size()) {
                const auto deadline = clock::now() + std::chrono::milliseconds(kYieldMs);
                do {
                    std::this_thread::sleep_for(std::chrono::milliseconds(5));
                    if (pump_events) pump_events();
                } while (clock::now() < deadline);
            }
        }

        pipeline_count = entries.size();
    } catch (const std::exception& e) {
        std::fprintf(stderr,
            "[prewarm] aborted: %s — first run will pay full MoltenVK compile cost\n",
            e.what());
        cleanup();
        return;
    }

    cleanup();
    auto t_end = clock::now();
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(t_end - t_begin).count();
    std::fprintf(stderr, "[prewarm] Compiled %zu pipelines in %lld ms (per-pipeline serialized)\n",
                 pipeline_count, static_cast<long long>(ms));
}


// Phase 5e-2: orchestrator. The streaming-derivation portion (slab
// allocator, page/chunk tables, sizing scalars, pushes to sort_/tile_)
// lives in GsStreamingSystem::init_streaming(); GsRenderer owns the
// non-streaming buffer destroy/recreate + descriptor refresh.
void GsRenderer::init_streaming(const StreamingConfig& config) {
    if (initialized_) {
        vkDeviceWaitIdle(device_);
    }

    sort_done_once_       = false;
    dynamic_count_        = 0;
    // Phase 5e step 1.10: pbd counts reset via pbd_.clear() (clears both counts + buffers).
    pbd_.clear();

    // Destroy all renderer-owned GPU buffers (streaming-owned page_table
    // and chunk_table are destroyed/recreated inside streaming_.init_streaming).
    resources_->uniform_buffer.destroy(allocator_);
    resources_->pbd_state_ssbo.destroy(allocator_);
    resources_->pbd_params_ssbo.destroy(allocator_);
    resources_->pbd_constraint_ssbo.destroy(allocator_);
    resources_->pbd_uniform_buffer.destroy(allocator_);
    resources_->static_gaussian_ssbo.destroy(allocator_);
    resources_->dynamic_gaussian_ssbo.destroy(allocator_);
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        resources_->static_sort_as[f].destroy(allocator_);
        resources_->static_sort_bs[f].destroy(allocator_);
        resources_->projected_ssbos[f].destroy(allocator_);
        resources_->sort_keys_ssbos[f].destroy(allocator_);
        resources_->sort_b_ssbos[f].destroy(allocator_);
        resources_->visible_count_ssbos[f].destroy(allocator_);
        resources_->dynamic_sort_as[f].destroy(allocator_);
        resources_->dynamic_sort_bs[f].destroy(allocator_);
        resources_->merged_sort_ssbos[f].destroy(allocator_);
        resources_->counts_ssbos[f].destroy(allocator_);
        resources_->tile_sort_as[f].destroy(allocator_);
        resources_->tile_sort_bs[f].destroy(allocator_);
        resources_->tile_sort_count_ssbos[f].destroy(allocator_);
        resources_->tile_ranges_ssbos[f].destroy(allocator_);
        resources_->tile_indirect_args[f].destroy(allocator_);
        resources_->per_splat_tile_count_ssbos[f].destroy(allocator_);
        resources_->per_splat_tile_offset_ssbos[f].destroy(allocator_);
        resources_->scan_block_sums_ssbos[f].destroy(allocator_);
        resources_->onesweep_statuses[f].destroy(allocator_);
        resources_->depth_onesweep_statuses[f].destroy(allocator_);
    }
    resources_->pp_ubo_buffer.destroy(allocator_);
    resources_->depth_sort_params.destroy(allocator_);
    resources_->static_depth_params.destroy(allocator_);
    resources_->dynamic_depth_params.destroy(allocator_);
    resources_->determinism_readback.destroy(allocator_);

    // Streaming derivation: computes sizing scalars, allocates slab + page
    // + chunk tables, pushes sizes into sort_/tile_.
    streaming_.init_streaming(config, num_sort_passes_);

    // Read back sizing for renderer-owned buffer allocation.
    const uint32_t max_static          = streaming_.max_static_count();
    const uint32_t max_dynamic         = streaming_.max_dynamic_count();
    const uint32_t s_sort_size         = streaming_.static_sort_size();
    const uint32_t d_sort_size         = streaming_.dynamic_sort_size();
    const uint32_t s_sort_workgroups   = streaming_.static_sort_workgroups();
    const uint32_t d_sort_workgroups   = streaming_.dynamic_sort_workgroups();
    const uint32_t leg_sort_size       = streaming_.sort_size();
    const uint32_t leg_sort_workgroups = streaming_.num_sort_workgroups();
    const uint32_t depth_onesweep_max  = streaming_.depth_onesweep_max_wg();

    const VkDeviceSize static_gauss_size   = static_cast<VkDeviceSize>(max_static)  * sizeof(GpuGaussian);
    const VkDeviceSize dynamic_gauss_size  = static_cast<VkDeviceSize>(max_dynamic) * sizeof(GpuGaussian);
    const VkDeviceSize projected_buf_size  = static_cast<VkDeviceSize>(max_static + max_dynamic) * sizeof(ProjectedSplat);
    const VkDeviceSize static_sort_buf_sz  = static_cast<VkDeviceSize>(s_sort_size) * sizeof(SortEntry);
    const VkDeviceSize dynamic_sort_buf_sz = static_cast<VkDeviceSize>(d_sort_size) * sizeof(SortEntry);
    const VkDeviceSize merged_sort_buf_sz  = static_cast<VkDeviceSize>(max_static + max_dynamic) * sizeof(SortEntry);

    // static_gaussian_ssbo: destination of vkCmdCopyBuffer in
    // TransferQueue::poll_completions (chunk-streaming uploads), requires
    // TRANSFER_DST_BIT. static/dynamic_sort also need TRANSFER_DST for the
    // vkCmdFillBuffer paths in publish_pending_chunks / render() sentinel
    // fills.
    resources_->static_gaussian_ssbo  = Buffer::create_storage_host_dst(allocator_, static_gauss_size);
    resources_->dynamic_gaussian_ssbo = Buffer::create_storage(allocator_, dynamic_gauss_size);
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        resources_->static_sort_as[f] = Buffer::create_storage_host_dst(allocator_, static_sort_buf_sz);
        resources_->static_sort_bs[f] = Buffer::create_storage_host_dst(allocator_, static_sort_buf_sz);
    }
    resources_->uniform_buffer = Buffer::create_uniform(allocator_, sizeof(GsUniforms));
    resources_->uniform_buffer_size = sizeof(GsUniforms);

    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        resources_->projected_ssbos[f]     = Buffer::create_storage(allocator_, projected_buf_size);
        resources_->sort_keys_ssbos[f]     = Buffer::create_storage(allocator_, static_sort_buf_sz);
        resources_->sort_b_ssbos[f]        = Buffer::create_storage(allocator_, static_sort_buf_sz);
        resources_->visible_count_ssbos[f] = Buffer::create_storage_readback(allocator_, sizeof(uint32_t));
        resources_->dynamic_sort_as[f]     = Buffer::create_storage_host_dst(allocator_, dynamic_sort_buf_sz);
        resources_->dynamic_sort_bs[f]     = Buffer::create_storage_host_dst(allocator_, dynamic_sort_buf_sz);
        resources_->counts_ssbos[f]        = Buffer::create_storage_readback(allocator_, 3 * sizeof(uint32_t));
        resources_->merged_sort_ssbos[f]   = Buffer::create_storage(allocator_, merged_sort_buf_sz);
    }

    // Defense in depth: zero/sentinel-fill all splat-related buffers.
    // VMA does not guarantee zero-init; the bytes carry whatever the
    // previous owner left behind. Buffers are HOST_VISIBLE + MAPPED at
    // this point and no GPU work has been submitted, so memset is race-free.
    std::memset(resources_->static_gaussian_ssbo.mapped(), 0,
                static_cast<size_t>(max_static) * sizeof(GpuGaussian));
    std::memset(resources_->dynamic_gaussian_ssbo.mapped(), 0,
                static_cast<size_t>(max_dynamic) * sizeof(GpuGaussian));
    {
        auto sentinel_fill_sort = [](Buffer& buf, uint32_t entries) {
            auto* p = static_cast<SortEntry*>(buf.mapped());
            for (uint32_t i = 0; i < entries; ++i) {
                p[i].key = 0xFFFFFFFFu;
                p[i].index = 0;
            }
        };
        for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
            sentinel_fill_sort(resources_->static_sort_as[f], s_sort_size);
            sentinel_fill_sort(resources_->static_sort_bs[f], s_sort_size);
            std::memset(resources_->projected_ssbos[f].mapped(), 0,
                        static_cast<size_t>(max_static + max_dynamic)
                            * sizeof(ProjectedSplat));
            sentinel_fill_sort(resources_->dynamic_sort_as[f], d_sort_size);
            sentinel_fill_sort(resources_->dynamic_sort_bs[f], d_sort_size);
            std::memset(resources_->merged_sort_ssbos[f].mapped(), 0,
                        static_cast<size_t>(max_static + max_dynamic)
                            * sizeof(SortEntry));
        }
    }

    // PBD buffers
    resources_->pbd_state_ssbo = Buffer::create_storage(allocator_,
        kMaxPbdElements * sizeof(PbdPhysicsState));
    resources_->pbd_params_ssbo = Buffer::create_storage(allocator_,
        kMaxPbdElements * sizeof(PbdElementParams));
    resources_->pbd_constraint_ssbo = Buffer::create_storage(allocator_,
        kMaxPbdConstraints * sizeof(PbdConstraint));
    {
        auto* states = static_cast<PbdPhysicsState*>(resources_->pbd_state_ssbo.mapped());
        for (uint32_t i = 0; i < kMaxPbdElements; ++i) {
            states[i].position = glm::vec4(0.0f, 0.0f, 0.0f, 0.0f);
            states[i].prev_position = glm::vec4(0.0f, 0.0f, 0.0f, 1.0f);
            states[i].velocity = glm::vec4(0.0f);
            states[i].params = glm::vec4(0.0f);
        }
        std::memset(resources_->pbd_params_ssbo.mapped(), 0,
                    kMaxPbdElements * sizeof(PbdElementParams));
        std::memset(resources_->pbd_constraint_ssbo.mapped(), 0,
                    kMaxPbdConstraints * sizeof(PbdConstraint));
    }
    resources_->pbd_uniform_buffer = Buffer::create_uniform(allocator_, 32);
    resources_->pp_ubo_buffer = Buffer::create_uniform(allocator_, sizeof(GsPostProcessUbo));

    // ── Tile binning buffers ──
    // tile_'s sizing scalars were populated by streaming_.init_streaming()
    // (via tile_->set_sort_sizes()). Pull them back here for buffer sizing.
    {
        const VkDeviceSize entry_buf_size = static_cast<VkDeviceSize>(tile_.tile_sort_size()) * 8;  // 8 bytes/entry
        static constexpr uint32_t kMaxTiles = 256 * 144;  // supports up to 4096×2304
        const VkDeviceSize ranges_buf_size = static_cast<VkDeviceSize>(kMaxTiles) * 2 * sizeof(uint32_t);
        const VkDeviceSize per_splat_buf_size =
            static_cast<VkDeviceSize>(tile_.scan_dispatch_size()) * sizeof(uint32_t);
        const VkDeviceSize block_sums_buf_size =
            static_cast<VkDeviceSize>(tile_.scan_num_blocks()) * sizeof(uint32_t);

        for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
            resources_->tile_sort_as[f] = Buffer::create_storage_gpu_only(allocator_, entry_buf_size);
            resources_->tile_sort_bs[f] = Buffer::create_storage_gpu_only(allocator_, entry_buf_size);
            resources_->tile_sort_count_ssbos[f] = Buffer::create_storage_readback(allocator_, sizeof(uint32_t));
            resources_->tile_ranges_ssbos[f] = Buffer::create_storage_gpu_only(allocator_, ranges_buf_size);
            resources_->tile_indirect_args[f] = Buffer::create_storage_indirect(allocator_, 8 * sizeof(uint32_t));
            resources_->per_splat_tile_count_ssbos[f] =
                Buffer::create_storage_gpu_only(allocator_, per_splat_buf_size);
            resources_->per_splat_tile_offset_ssbos[f] =
                Buffer::create_storage_gpu_only(allocator_, per_splat_buf_size);
            resources_->scan_block_sums_ssbos[f] =
                Buffer::create_storage_gpu_only(allocator_, block_sums_buf_size);
        }
        resources_->determinism_readback = Buffer::create_readback(allocator_, entry_buf_size);
        resources_->determinism_readback_size = entry_buf_size;

        std::fprintf(stderr, "GS: Tile sort -- capacity=%u entries (%u workgroups), "
                     "output=%ux%u, buf=%.1f MB; scan=%u elems / %u blocks\n",
                     tile_.tile_sort_size(), tile_.tile_sort_workgroups(),
                     resources_->output_width, resources_->output_height,
                     static_cast<float>(entry_buf_size * 2) / (1024.0f * 1024.0f),
                     tile_.scan_dispatch_size(), tile_.scan_num_blocks());

        // Onesweep status buffer: 4 passes × 256 digits × max_workgroups.
        const VkDeviceSize status_size = 4ull * 256ull * tile_.onesweep_max_wg() * sizeof(uint32_t);
        for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
            resources_->onesweep_statuses[f] = Buffer::create_storage_gpu_only(allocator_, status_size);
        }
    }

    // ── Depth sort Onesweep status + params buffers ──
    {
        const VkDeviceSize depth_status_size = static_cast<VkDeviceSize>(num_sort_passes_) * 256ull
                                                * depth_onesweep_max * sizeof(uint32_t);
        for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
            resources_->depth_onesweep_statuses[f] = Buffer::create_storage_gpu_only(allocator_, depth_status_size);
        }

        // Params buffers (IndirectArgs layout: {wg_x, 1, 1, 0, 0, 0, entry_count, 0})
        auto fill_sort_params = [&](Buffer& buf, uint32_t wg_count, uint32_t entry_count) {
            buf = Buffer::create_storage(allocator_, 8 * sizeof(uint32_t));
            auto* p = static_cast<uint32_t*>(buf.mapped());
            p[0] = wg_count; p[1] = 1; p[2] = 1;
            p[3] = 0; p[4] = 0; p[5] = 0;
            p[6] = entry_count; p[7] = 0;
        };
        fill_sort_params(resources_->static_depth_params,  s_sort_workgroups,   s_sort_size);
        fill_sort_params(resources_->dynamic_depth_params, d_sort_workgroups,   d_sort_size);
        fill_sort_params(resources_->depth_sort_params,    leg_sort_workgroups, leg_sort_size);

        std::fprintf(stderr, "GS: Depth sort Onesweep -- static=%u wg, dynamic=%u wg, status=%.1f KB\n",
                     s_sort_workgroups, d_sort_workgroups,
                     static_cast<float>(depth_status_size) / 1024.0f);
    }

    // Zero the counts buffer across every per-frame slot.
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        if (resources_->counts_ssbos[f].mapped()) {
            auto* counts = static_cast<uint32_t*>(resources_->counts_ssbos[f].mapped());
            counts[0] = 0;
            counts[1] = 0;
            counts[2] = 0;
        }
    }

    initialized_ = true;

    update_descriptors();
    // Phase 4c-vfx-1: init_streaming() is the first point where
    // resources_->dynamic_gaussian_ssbo is created. set_render_state() may
    // run before init_streaming; its update_compose_descriptors() call is
    // gated out by the missing dst buffer. Retry here.
    if (render_state_ && compose_pipeline_ != VK_NULL_HANDLE) {
        update_compose_descriptors();
    }
}


// Helper: reinitialize a dynamic sort buffer with sentinels for inactive
// slots and identity indices for the active range [0..valid_count).
static void init_dynamic_sort_buf(Buffer& buf, uint32_t sort_size, uint32_t valid_count) {
    std::vector<SortEntry> staging_sort(sort_size);
    for (uint32_t i = 0; i < sort_size; ++i) {
        staging_sort[i].key = 0xFFFFFFFF;
        staging_sort[i].index = i < valid_count ? i : 0;
    }
    std::memcpy(buf.mapped(), staging_sort.data(), sort_size * sizeof(SortEntry));
}

// encode_gaussian moved to include/gseurat/engine/gaussian_cloud.hpp so
// VfxSystem can call it directly when packing splats into RenderState's
// persistent-mapped vfx_buffer.

void GsRenderer::set_persistent_dynamics(const Gaussian* data, uint32_t count) {
    if (count > streaming_.max_dynamic_count()) {
        std::fprintf(stderr,
            "[gs_renderer] set_persistent_dynamics: count=%u exceeds max_dynamic_count=%u; truncating\n",
            count, streaming_.max_dynamic_count());
        count = streaming_.max_dynamic_count();
    }
    persistent_dyn_count_ = count;
    dynamic_count_ = count;  // transient reset; next update_dynamic_gaussians extends it

    if (count > 0) {
        std::vector<GpuGaussian> staging(count);
        for (uint32_t i = 0; i < count; ++i) {
            encode_gaussian(data[i], staging[i]);
        }
        std::memcpy(resources_->dynamic_gaussian_ssbo.mapped(), staging.data(),
                    count * sizeof(GpuGaussian));
    }

    // Reinitialize dynamic sort buffers for the active range [0..count).
    // Phase 3: write every per-frame slot. The next render will fill the
    // active slot via vkCmdFillBuffer, but other slots inherit this init
    // until their first frame uses them.
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        init_dynamic_sort_buf(resources_->dynamic_sort_as[f], streaming_.dynamic_sort_size(), count);
        init_dynamic_sort_buf(resources_->dynamic_sort_bs[f], streaming_.dynamic_sort_size(), count);
    }

    std::fprintf(stderr,
        "[gs_renderer] persistent dynamics uploaded: %u splats (chars+NPCs+PBD-trees)\n",
        count);
}

void GsRenderer::update_dynamic_gaussians(const Gaussian* data, uint32_t count,
                                            uint32_t gpu_prefix) {
    // `count` is the CPU-sourced transient portion (particles, scene anims).
    // `gpu_prefix` is the slot count already filled by the GPU compose
    // passes at offset persistent_dyn_count_ — currently vfx_count +
    // pbd_count (4c-vfx + 4c-pbd). Persistent prefix lives in indices
    // [0, persistent_dyn_count_).
    const uint32_t fixed_prefix = persistent_dyn_count_ + gpu_prefix;
    const uint32_t total = fixed_prefix + count;
    if (total > streaming_.max_dynamic_count()) {
        // Cap the CPU portion so total fits; gpu_prefix is GPU-controlled
        // and can't be truncated here.
        count = (streaming_.max_dynamic_count() > fixed_prefix)
            ? streaming_.max_dynamic_count() - fixed_prefix : 0;
    }
    dynamic_count_ = fixed_prefix + count;

    if (count > 0) {
        std::vector<GpuGaussian> staging(count);
        for (uint32_t i = 0; i < count; ++i) {
            encode_gaussian(data[i], staging[i]);
        }
        // Write at offset (persistent_dyn_count_ + gpu_prefix) * sizeof(GpuGaussian)
        auto* dst = static_cast<uint8_t*>(resources_->dynamic_gaussian_ssbo.mapped())
                    + fixed_prefix * sizeof(GpuGaussian);
        std::memcpy(dst, staging.data(), count * sizeof(GpuGaussian));
    }

    // Dynamic sort buffer init is NOT done here. It runs GPU-side in
    // GsRenderer::render via vkCmdFillBuffer, properly synchronized against
    // the in-flight depth-sort dispatch from frame N-1. CPU init here would
    // race with frame N-1's GPU sort, causing intermittent flicker of
    // persistent dynamics (chars/NPCs/PBD-tagged splats).
}


void GsRenderer::set_render_state(RenderState* rs) noexcept {
    if (render_state_ == rs) return;
    render_state_ = rs;
    // Phase 5e step 2: propagate render_state to sort system so its
    // write_descriptors() can bind the bones buffer.
    sort_.set_render_state(rs);
    // Re-bind descriptors so the bones binding picks up RenderState's
    // per-frame buffers. Only re-run if streaming is initialised — pre-init
    // descriptors haven't been written yet, and init_streaming will call
    // update_descriptors itself when it runs.
    if (streaming_.initialized()) {
        update_descriptors();
    }
    // Phase 4c-vfx: bind compose_sets_'s src (vfx_buffer) + dst
    // (dynamic_gaussian_ssbo). Safe to call regardless of streaming
    // state — only depends on render_state_ being non-null and
    // resources_->dynamic_gaussian_ssbo being created (true after init_streaming).
    if (rs && compose_pipeline_ != VK_NULL_HANDLE && resources_->dynamic_gaussian_ssbo.buffer()) {
        update_compose_descriptors();
    }
}

void GsRenderer::update_descriptors() {
    // #397: the central `preprocess_sets_[*]` and `sort_sets_[*]` writes
    // (and the matching `render_sets_[*]` write blocks) all populated
    // descriptor sets that no live pipeline ever bound.
    // Phase 5e step 2: preprocess sets now owned and written by GsSortSystem.
    // All descriptor writes are delegated to subsystem write_descriptors() calls below.

    // Phase 5b: post-process descriptor writes moved to GsPostProcessSystem.
    post_.write_descriptors();


    // Phase 5c: depth-sort + merge descriptor writes moved to GsSortSystem.
    // Phase 5e step 2: static/dynamic preprocess set writes moved to GsSortSystem.
    // sort_.write_descriptors() now handles depth-sort, merge, and preprocess sets.
    sort_.write_descriptors();

    // Phase 5e step 1.8: PBD descriptor writes migrated to pbd_.write_descriptors()
    // — legacy block removed in step 1.10.
    pbd_.write_descriptors();


    // #397: the second render_sets_[*] write-pass (merged_sort re-bind)
    // deleted with the first — both populated dead descriptor sets.

    // ── Phase 5d: tile binning + tile sort + tile render descriptor sets
    //    moved into GsTileBinSystem ─────────────────────────────────────
    tile_.write_descriptors();

}

void GsRenderer::resize_output(uint32_t width, uint32_t height) {
    if (width == resources_->output_width && height == resources_->output_height) return;

    // Sampler is resolution-independent — keep it across resizes.
    for (uint32_t i = 0; i < kMaxFramesInFlight; ++i) {
        if (resources_->output_views[i]) {
            vkDestroyImageView(device_, resources_->output_views[i], nullptr);
            resources_->output_views[i] = VK_NULL_HANDLE;
        }
        if (resources_->output_images[i]) {
            vmaDestroyImage(allocator_, resources_->output_images[i], resources_->output_allocations[i]);
            resources_->output_images[i] = VK_NULL_HANDLE;
            resources_->output_allocations[i] = VK_NULL_HANDLE;
        }
        if (resources_->depth_views[i]) {
            vkDestroyImageView(device_, resources_->depth_views[i], nullptr);
            resources_->depth_views[i] = VK_NULL_HANDLE;
        }
        if (resources_->depth_images[i]) {
            vmaDestroyImage(allocator_, resources_->depth_images[i], resources_->depth_allocations[i]);
            resources_->depth_images[i] = VK_NULL_HANDLE;
            resources_->depth_allocations[i] = VK_NULL_HANDLE;
        }
        if (resources_->processed_views[i]) {
            vkDestroyImageView(device_, resources_->processed_views[i], nullptr);
            resources_->processed_views[i] = VK_NULL_HANDLE;
        }
        if (resources_->processed_images[i]) {
            vmaDestroyImage(allocator_, resources_->processed_images[i], resources_->processed_allocations[i]);
            resources_->processed_images[i] = VK_NULL_HANDLE;
            resources_->processed_allocations[i] = VK_NULL_HANDLE;
        }
    }

    create_output_image(width, height);

    // Descriptors hold raw VkImageView handles into the just-destroyed
    // resources_->output_views/resources_->depth_views/resources_->processed_views arrays. They must be
    // refreshed against the new views before any GS dispatch, regardless
    // of whether splats have been uploaded yet — streaming_.gaussian_count() > 0
    // gates whether the resulting frame is meaningful, not whether the
    // descriptor handles are valid. (Without this, the first dispatch
    // after a resize-before-load reports VkImageView 0x0 and the slot's
    // post-process writes nothing — the symptom user-visible as alternating
    // blank frames after a cold scene load.)
    //
    // update_descriptors has its own internal guard for the static/dynamic
    // split sets that early-returns when split buffers aren't allocated
    // yet (pre-init_streaming).
    if (streaming_.initialized()) {
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
        to_dst[i] = barrier_for(resources_->processed_images[i],
            VK_IMAGE_LAYOUT_UNDEFINED, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,
            0, VK_ACCESS_TRANSFER_WRITE_BIT);
        to_shader[i] = barrier_for(resources_->processed_images[i],
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
        vkCmdClearColorImage(cmd, resources_->processed_images[i],
            VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, &clear, 1, &range);
    }

    // 3. TRANSFER_DST → SHADER_READ_ONLY_OPTIMAL (all frames).
    vkCmdPipelineBarrier(cmd,
        VK_PIPELINE_STAGE_TRANSFER_BIT,
        VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT,
        0, 0, nullptr, 0, nullptr,
        kMaxFramesInFlight, to_shader.data());
}


void GsRenderer::render(VkCommandBuffer cmd, uint32_t frame_in_flight,
                        const glm::mat4& view, const glm::mat4& proj) {
    if (streaming_.gaussian_count() == 0 && streaming_.static_count() == 0 && dynamic_count_ == 0) return;
    if (frame_in_flight >= kMaxFramesInFlight) {
        std::fprintf(stderr, "[gs_renderer] render(): frame_in_flight=%u out of range\n",
                     frame_in_flight);
        return;
    }
    GS_LABEL(cmd, "GS.Render");
    const VkImage out_img       = resources_->output_images[frame_in_flight];
    const VkImage depth_img     = resources_->depth_images[frame_in_flight];
    const VkImage processed_img = resources_->processed_images[frame_in_flight];
    // Phase 5b: post-process descriptor set now lives in GsPostProcessSystem;
    // post_.dispatch() resolves the per-frame set internally.
    // Phase 5d: tile_render_set now lives in GsTileBinSystem; tile_.dispatch_render() resolves it internally.

    uint32_t width = resources_->output_width;
    uint32_t height = resources_->output_height;

    // Update uniforms
    GsUniforms uniforms{};
    uniforms.view = view;
    uniforms.proj = proj;
    uniforms.inv_view = glm::inverse(view);
    uniforms.inv_proj = glm::inverse(proj);
    uniforms.params = glm::uvec4(width, height, streaming_.gaussian_count(), streaming_.sort_size());
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

    std::memcpy(resources_->uniform_buffer.mapped(), &uniforms, sizeof(uniforms));

    // Read back GPU timestamps from THIS slot's PREVIOUS write (the renderer
    // waits on this slot's in-flight fence before calling render(), so the
    // writes are guaranteed complete by the time we reach here).
    //
    // Non-blocking: a hung GPU dispatch must not wedge the CPU here. If
    // results aren't ready (VK_NOT_READY), drop this measurement; the next
    // re-use of this slot will read its own most-recent writes. WAIT_BIT
    // was removed after a Phase-3.6 attempt deadlocked the entire process
    // (spindump showed the main thread permanently blocked here when the
    // onesweep lookback hung the GPU).
    //
    // Per-slot pool (Codex P2): each frame slot owns 6 consecutive queries
    // starting at slot_offset. The reset below only touches THIS slot's
    // queries, so a previous frame's queries are never invalidated before
    // they're consumed.
    const uint32_t ts_slot_offset = frame_in_flight * kTimestampQueriesPerFrame;
    if (timestamp_pool_ && timestamps_written_per_slot_[frame_in_flight]) {
        uint64_t ts[kTimestampQueriesPerFrame]{};  // depth_sort_begin/end, tile_sort_begin/end, raster_begin/end
#if GSEURAT_DEBUG_BUILD
        const auto t_wait_start = std::chrono::steady_clock::now();
#endif
        VkResult ts_result = vkGetQueryPoolResults(
            device_, timestamp_pool_, ts_slot_offset, kTimestampQueriesPerFrame,
            sizeof(ts), ts, sizeof(uint64_t),
            VK_QUERY_RESULT_64_BIT);
#if GSEURAT_DEBUG_BUILD
        const auto t_wait_end = std::chrono::steady_clock::now();
        const double wait_ms = std::chrono::duration<double, std::milli>(t_wait_end - t_wait_start).count();
        if (wait_ms > 100.0) {
            float prev_depth_ms = (ts_result == VK_SUCCESS && ts[1] > ts[0])
                ? static_cast<float>(ts[1] - ts[0]) * timestamp_period_ns_ / 1e6f : -1.0f;
            float prev_tile_ms = (ts_result == VK_SUCCESS && ts[3] > ts[2])
                ? static_cast<float>(ts[3] - ts[2]) * timestamp_period_ns_ / 1e6f : -1.0f;
            float prev_raster_ms = (ts_result == VK_SUCCESS && ts[5] > ts[4])
                ? static_cast<float>(ts[5] - ts[4]) * timestamp_period_ns_ / 1e6f : -1.0f;
            GS_LOG_FRAME("[gs_render/wd/WAIT_SLOW] wait_ms={:.1f} prev_depth={:.1f}ms prev_tile={:.1f}ms prev_raster={:.1f}ms "
                         "static={} dyn={} total={}",
                         wait_ms, prev_depth_ms, prev_tile_ms, prev_raster_ms,
                         streaming_.static_count(), dynamic_count_, streaming_.gaussian_count());
        }
#endif
        if (ts_result == VK_SUCCESS && ts[5] > ts[4] && ts[3] > ts[2] && ts[1] > ts[0]) {
            float depth_ms = static_cast<float>(ts[1] - ts[0]) * timestamp_period_ns_ / 1e6f;
            float tile_ms  = static_cast<float>(ts[3] - ts[2]) * timestamp_period_ns_ / 1e6f;
            float raster_ms = static_cast<float>(ts[5] - ts[4]) * timestamp_period_ns_ / 1e6f;
            depth_sort_ms_last_ = depth_ms;
            tile_sort_ms_last_ = tile_ms;
            rasterize_ms_last_ = raster_ms;
            depth_sort_ms_accum_ += depth_ms;
            tile_sort_ms_accum_ += tile_ms;
            rasterize_ms_accum_ += raster_ms;
            ++timestamp_frame_;
            if (timestamp_frame_ % kTimestampAvgFrames == 0) {
                float d_avg = depth_sort_ms_accum_ / static_cast<float>(kTimestampAvgFrames);
                float t_avg = tile_sort_ms_accum_ / static_cast<float>(kTimestampAvgFrames);
                float r_avg = rasterize_ms_accum_ / static_cast<float>(kTimestampAvgFrames);
                GS_LOG_FRAME("[gs_renderer] DepthSort: {:.3f} ms  TileSort: {:.3f} ms  Rasterize: {:.3f} ms  Total: {:.3f} ms (avg {} frames)",
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

    // Reset only THIS slot's queries before issuing new writes — other
    // slots' queries remain intact for their owning frames to consume.
    if (timestamp_pool_) {
        vkCmdResetQueryPool(cmd, timestamp_pool_, ts_slot_offset, kTimestampQueriesPerFrame);
        timestamps_written_per_slot_[frame_in_flight] = false;
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
        // Option A (2026-05-11 cross-frame race fix): PBD-tagged gaussians live
        // in the persistent-dynamic prefix alongside bone-animated characters
        // and NPCs. The dynamic preprocess re-applies bone+PBD transforms every
        // frame, so wind sway is visible while the camera is stationary — the
        // static depth sort no longer needs to be re-armed to refresh tree
        // poses. Static cloud retains only terrain + non-animated props
        // (bone_index == 0) and its sort can stay cached until the camera
        // actually moves.
        //
        // Determinism harness: PBD uses a hardcoded 1/60s step rather than
        // the engine dt, so the upstream draw_scene `dt = 0` freeze is not
        // enough — the solver would still advance wind-sway each frame and
        // shift the depth-sort key for tagged splats. Skip the dispatch
        // entirely while a Mode-1 test is active so the GPU's pbd_state
        // SSBO retains its pre-test contents.
        // Phase 5e step 1.9: inline dispatch replaced by pbd_.dispatch().
        pbd_.dispatch(cmd, frame_in_flight, time_, tile_.determinism_test_active());

        // Streaming-strict invariant: split buffers are always allocated
        // post-init. #397: the `if (use_split) { ... }` wrapper that used
        // to guard this whole block was structurally always-true post-1c;
        // the invariant check alone is the right shape.
        GS_DBG_INVARIANT(
            resources_->static_gaussian_ssbo.buffer() && resources_->counts_ssbos[0].buffer(),
            "render: split buffers must be allocated in streaming-strict mode");

        // Phase 5e step 4: entire depth-sort phase delegated to GsSortSystem::dispatch().
        // Internalizes: prepare_buffers, depth_sort timestamps (ts+0, ts+1),
        // dynamic preprocess + sort, static preprocess + sort + tick_static_dirty,
        // merge (always), and the sort→tile cross-system barrier (§5.4).
        sort_.dispatch(cmd, frame_in_flight, dynamic_count_, streaming_,
                       timestamp_pool_, ts_slot_offset);

        // Phase 5e step 5: entire tile phase delegated to GsTileBinSystem::dispatch().
        // Internalizes: tile sort timestamps (ts+2, ts+3), dispatch_sort (6-pass),
        // raster timestamps (ts+4, ts+5), dispatch_render, and tile→post-process barrier.
        tile_.dispatch(cmd, frame_in_flight, width, height,
                       timestamp_pool_, ts_slot_offset);
        sort_done_once_ = true;
        timestamps_written_per_slot_[frame_in_flight] = tile_.emitted_timestamps_this_frame();

    }

    // Pass 4: Post-process (always runs — params like fade_amount change every frame).
    // Phase 5b: dispatch + UBO upload + processed_image UNDEFINED→GENERAL barrier
    // all live inside GsPostProcessSystem now.
    {
        GS_LABEL(cmd, "PostProcess");
        post_.dispatch(cmd, frame_in_flight, width, height);
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
    // Phase 5e step 1.10: pure forwarder to GsPbdSystem.
    pbd_.upload_elements(states, params, count);
}

void GsRenderer::upload_pbd_constraints(const PbdConstraint* constraints, uint32_t count) {
    // Phase 5e step 1.10: pure forwarder to GsPbdSystem.
    pbd_.upload_constraints(constraints, count);
}

void GsRenderer::clear_pbd() {
    // Phase 5e step 1.10: pure forwarder to GsPbdSystem.
    pbd_.clear();
}

void GsRenderer::set_point_lights(const std::vector<PointLight>& lights) {
    point_lights_.assign(lights.begin(),
                         lights.begin() + std::min(lights.size(),
                                                    static_cast<size_t>(kMaxGsPointLights)));
}

void GsRenderer::shutdown(VmaAllocator allocator) {
    if (!initialized_) return;

    // Phase 5b/5c: tear down owned subsystems before the renderer's gs_pool_
    // (their descriptor sets live in there) and before the device handle
    // becomes invalid. All shutdown() calls are idempotent.
    post_.shutdown();
    sort_.shutdown();
    tile_.shutdown();
    // Phase 5e: GsPbdSystem owns its pipeline/layout/set-layout. Must run
    // before gs_pool_ is destroyed (pbd_set_ lives in gs_pool_).
    pbd_.shutdown();
    // Phase 5e-2: GsStreamingSystem owns the full streaming subsystem
    // (transfer queue cancel + shutdown, slab allocator, active chunks,
    // pending deques, streaming_initialized_, sizing scalars, dirty flags).
    // Run streaming_.shutdown() FIRST: TransferQueue::shutdown() calls
    // vkDeviceWaitIdle, which must drain any in-flight preprocess/render
    // command buffers that may still be sampling page_table_ssbo /
    // chunk_table_ssbo before those buffers are destroyed. (Codex P2 on
    // PR #446.) Renderer::shutdown waits idle upstream as well, but
    // matching the prior 5e-1 ordering keeps this entry point safe even
    // if a future caller forgets the upstream wait.
    streaming_.shutdown();
    // The streaming-owned GPU buffers live in GsResourceManager, so they
    // are destroyed here rather than inside streaming_.shutdown().
    resources_->page_table_ssbo.destroy(allocator);
    resources_->chunk_table_ssbo.destroy(allocator);

    resources_->uniform_buffer.destroy(allocator);
    resources_->pbd_state_ssbo.destroy(allocator);
    resources_->pbd_params_ssbo.destroy(allocator);
    resources_->pbd_constraint_ssbo.destroy(allocator);
    resources_->pbd_uniform_buffer.destroy(allocator);

    // Split buffers
    resources_->static_gaussian_ssbo.destroy(allocator);
    resources_->dynamic_gaussian_ssbo.destroy(allocator);
    // Per-frame racing SSBOs (resources_->static_sort_as/bs_ are grouped here now).
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        resources_->static_sort_as[f].destroy(allocator);
        resources_->static_sort_bs[f].destroy(allocator);
        resources_->projected_ssbos[f].destroy(allocator);
        resources_->sort_keys_ssbos[f].destroy(allocator);
        resources_->sort_b_ssbos[f].destroy(allocator);
        resources_->visible_count_ssbos[f].destroy(allocator);
        resources_->dynamic_sort_as[f].destroy(allocator);
        resources_->dynamic_sort_bs[f].destroy(allocator);
        resources_->merged_sort_ssbos[f].destroy(allocator);
        resources_->counts_ssbos[f].destroy(allocator);
    }

    // Tile binning buffers (Phase 3.5: per-frame — destroy every slot).
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        resources_->tile_sort_as[f].destroy(allocator);
        resources_->tile_sort_bs[f].destroy(allocator);
        resources_->tile_sort_count_ssbos[f].destroy(allocator);
        resources_->tile_ranges_ssbos[f].destroy(allocator);
        resources_->tile_indirect_args[f].destroy(allocator);
        resources_->per_splat_tile_count_ssbos[f].destroy(allocator);
        resources_->per_splat_tile_offset_ssbos[f].destroy(allocator);
        resources_->scan_block_sums_ssbos[f].destroy(allocator);
    }
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        resources_->onesweep_statuses[f].destroy(allocator);
    }
    resources_->determinism_readback.destroy(allocator);

    // Depth sort Onesweep buffers — per-frame status, single-instance params.
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        resources_->depth_onesweep_statuses[f].destroy(allocator);
    }
    resources_->depth_sort_params.destroy(allocator);
    resources_->static_depth_params.destroy(allocator);
    resources_->dynamic_depth_params.destroy(allocator);

    resources_->pp_ubo_buffer.destroy(allocator);

    if (resources_->output_sampler) { vkDestroySampler(device_, resources_->output_sampler, nullptr); resources_->output_sampler = VK_NULL_HANDLE; }
    for (uint32_t i = 0; i < kMaxFramesInFlight; ++i) {
        if (resources_->output_views[i]) {
            vkDestroyImageView(device_, resources_->output_views[i], nullptr);
            resources_->output_views[i] = VK_NULL_HANDLE;
        }
        if (resources_->output_images[i]) {
            vmaDestroyImage(allocator, resources_->output_images[i], resources_->output_allocations[i]);
            resources_->output_images[i] = VK_NULL_HANDLE;
            resources_->output_allocations[i] = VK_NULL_HANDLE;
        }
        if (resources_->depth_views[i]) {
            vkDestroyImageView(device_, resources_->depth_views[i], nullptr);
            resources_->depth_views[i] = VK_NULL_HANDLE;
        }
        if (resources_->depth_images[i]) {
            vmaDestroyImage(allocator, resources_->depth_images[i], resources_->depth_allocations[i]);
            resources_->depth_images[i] = VK_NULL_HANDLE;
            resources_->depth_allocations[i] = VK_NULL_HANDLE;
        }
        if (resources_->processed_views[i]) {
            vkDestroyImageView(device_, resources_->processed_views[i], nullptr);
            resources_->processed_views[i] = VK_NULL_HANDLE;
        }
        if (resources_->processed_images[i]) {
            vmaDestroyImage(allocator, resources_->processed_images[i], resources_->processed_allocations[i]);
            resources_->processed_images[i] = VK_NULL_HANDLE;
            resources_->processed_allocations[i] = VK_NULL_HANDLE;
        }
    }

    auto destroy_pipeline = [&](VkPipeline& p) { if (p) { vkDestroyPipeline(device_, p, nullptr); p = VK_NULL_HANDLE; } };
    auto destroy_layout = [&](VkPipelineLayout& l) { if (l) { vkDestroyPipelineLayout(device_, l, nullptr); l = VK_NULL_HANDLE; } };
    auto destroy_set_layout = [&](VkDescriptorSetLayout& l) { if (l) { vkDestroyDescriptorSetLayout(device_, l, nullptr); l = VK_NULL_HANDLE; } };

    // #397: sort_pipeline_ retired with the legacy depth-sort path.
    // Phase 5b: post-process pipeline destroyed by GsPostProcessSystem::shutdown().
    // Phase 5c: merge pipeline destroyed by GsSortSystem::shutdown().
    // Phase 5d: all tile pipelines destroyed by GsTileBinSystem::shutdown().
    // Phase 5e: pbd_pipeline_ destroyed by GsPbdSystem::shutdown() (called above).
    // Phase 5c: onesweep hist + scatter pipelines destroyed by GsSortSystem::shutdown().
    // Phase 5e step 2: preprocess_pipeline_ destroyed by GsSortSystem::shutdown().
    destroy_pipeline(compose_pipeline_);

    destroy_layout(compose_pipeline_layout_);
    // #397: sort_pipeline_layout_ retired with the legacy depth-sort path.
    // Phase 5b: post-process pipeline layout destroyed by GsPostProcessSystem::shutdown().
    // Phase 5c: merge pipeline layout destroyed by GsSortSystem::shutdown().
    // Phase 5d: all tile pipeline layouts destroyed by GsTileBinSystem::shutdown().
    // Phase 5e: pbd_pipeline_layout_ destroyed by GsPbdSystem::shutdown().
    // Phase 5c: onesweep hist + scatter pipeline layouts destroyed by GsSortSystem::shutdown().
    // Phase 5e step 2: preprocess_pipeline_layout_ destroyed by GsSortSystem::shutdown().

    // #397: sort_layout_ retired with the legacy depth-sort path.
    // Phase 5b: post-process set layout destroyed by GsPostProcessSystem::shutdown().
    // Phase 5c: merge descriptor set layout destroyed by GsSortSystem::shutdown().
    // Phase 5d: all tile descriptor set layouts destroyed by GsTileBinSystem::shutdown().
    // Phase 5e: pbd_layout_ (now pbd_set_layout_) destroyed by GsPbdSystem::shutdown().
    // Phase 5c: onesweep hist + scatter descriptor set layouts destroyed by GsSortSystem::shutdown().
    // Phase 5e step 2: preprocess_layout_ destroyed by GsSortSystem::shutdown().
    destroy_set_layout(compose_layout_);

    if (timestamp_pool_) { vkDestroyQueryPool(device_, timestamp_pool_, nullptr); timestamp_pool_ = VK_NULL_HANDLE; }
    if (gs_pool_) vkDestroyDescriptorPool(device_, gs_pool_, nullptr);
    if (compose_pool_) { vkDestroyDescriptorPool(device_, compose_pool_, nullptr); compose_pool_ = VK_NULL_HANDLE; }

    initialized_ = false;
}

}  // namespace gseurat
