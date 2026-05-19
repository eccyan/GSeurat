#pragma once

#include "gseurat/engine/buffer.hpp"
#include "gseurat/engine/types.hpp"

#include <vk_mem_alloc.h>
#include <vulkan/vulkan.h>

#include <array>
#include <cstdint>

namespace gseurat {

// Phase 5a: long-lived GPU resources lifted out of GsRenderer. Pure data
// holder (public fields) with create_*/destroy_* lifecycle methods for the
// few cases where construction can't happen up-front: resize_output and
// init_streaming both rebuild the resources owned here. Pipelines /
// descriptor pools / descriptor set layouts intentionally stay in
// GsRenderer until Phase 5b-5e moves each subsystem out with its pipeline.
//
// Ownership: AppBase owns a unique_ptr<GsResourceManager>; GsRenderer
// holds a non-owning pointer set via set_resources() before init(). The
// manager's lifetime is bound by AppBase (declared after Renderer so it
// destructs first; before VkContext tear-down).
struct GsResourceManager {
    GsResourceManager() = default;
    ~GsResourceManager();

    GsResourceManager(const GsResourceManager&) = delete;
    GsResourceManager& operator=(const GsResourceManager&) = delete;
    GsResourceManager(GsResourceManager&&) = delete;
    GsResourceManager& operator=(GsResourceManager&&) = delete;

    // Vulkan handles captured at first create_* call.
    VkDevice device = VK_NULL_HANDLE;
    VmaAllocator allocator = VK_NULL_HANDLE;

    // ── Per-frame intermediate images ─────────────────────────────────
    // See the prior GsRenderer comment: a single shared VkImage would be
    // raced (compute write of frame N+1 vs composite read of frame N).
    // Indexed by frame_in_flight passed into render().
    std::array<VkImage,        kMaxFramesInFlight> output_images{};
    std::array<VmaAllocation,  kMaxFramesInFlight> output_allocations{};
    std::array<VkImageView,    kMaxFramesInFlight> output_views{};
    VkSampler                                       output_sampler = VK_NULL_HANDLE;
    uint32_t                                        output_width   = 0;
    uint32_t                                        output_height  = 0;

    std::array<VkImage,        kMaxFramesInFlight> depth_images{};
    std::array<VmaAllocation,  kMaxFramesInFlight> depth_allocations{};
    std::array<VkImageView,    kMaxFramesInFlight> depth_views{};

    std::array<VkImage,        kMaxFramesInFlight> processed_images{};
    std::array<VmaAllocation,  kMaxFramesInFlight> processed_allocations{};
    std::array<VkImageView,    kMaxFramesInFlight> processed_views{};

    // ── Splat buffers (static/dynamic split) ──────────────────────────
    Buffer       uniform_buffer;
    VkDeviceSize uniform_buffer_size = 0;  // sizeof(GsUniforms) — stored here so subsystems don't need a back-include into gs_renderer.cpp
    Buffer static_gaussian_ssbo;
    Buffer dynamic_gaussian_ssbo;

    // Per-frame racing SSBOs — see the prior renderer comments for race
    // rationale. Frame N writes slot [N % kMaxFramesInFlight].
    std::array<Buffer, kMaxFramesInFlight> projected_ssbos{};
    std::array<Buffer, kMaxFramesInFlight> sort_keys_ssbos{};
    std::array<Buffer, kMaxFramesInFlight> sort_b_ssbos{};
    std::array<Buffer, kMaxFramesInFlight> visible_count_ssbos{};

    std::array<Buffer, kMaxFramesInFlight> static_sort_as{};
    std::array<Buffer, kMaxFramesInFlight> static_sort_bs{};
    std::array<Buffer, kMaxFramesInFlight> dynamic_sort_as{};
    std::array<Buffer, kMaxFramesInFlight> dynamic_sort_bs{};
    std::array<Buffer, kMaxFramesInFlight> merged_sort_ssbos{};
    std::array<Buffer, kMaxFramesInFlight> counts_ssbos{};

    // ── PBD solver buffers ────────────────────────────────────────────
    Buffer pbd_state_ssbo;
    Buffer pbd_params_ssbo;
    Buffer pbd_constraint_ssbo;
    Buffer pbd_uniform_buffer;

    // ── Streaming (page table + chunk metadata) ───────────────────────
    Buffer page_table_ssbo;
    Buffer chunk_table_ssbo;

    // ── Onesweep sort status (per-frame for cross-frame race fix) ─────
    std::array<Buffer, kMaxFramesInFlight> onesweep_statuses{};
    std::array<Buffer, kMaxFramesInFlight> depth_onesweep_statuses{};
    Buffer depth_sort_params;
    Buffer static_depth_params;
    Buffer dynamic_depth_params;

    // ── Tile sort buffers (per-frame in Phase 3.5) ────────────────────
    std::array<Buffer, kMaxFramesInFlight> tile_sort_as{};
    std::array<Buffer, kMaxFramesInFlight> tile_sort_bs{};
    std::array<Buffer, kMaxFramesInFlight> tile_sort_count_ssbos{};
    std::array<Buffer, kMaxFramesInFlight> tile_ranges_ssbos{};
    std::array<Buffer, kMaxFramesInFlight> tile_indirect_args{};

    // Deterministic tile-bin (Fix B) intermediate SSBOs.
    std::array<Buffer, kMaxFramesInFlight> per_splat_tile_count_ssbos{};
    std::array<Buffer, kMaxFramesInFlight> per_splat_tile_offset_ssbos{};
    std::array<Buffer, kMaxFramesInFlight> scan_block_sums_ssbos{};

    // Frame-determinism harness host-visible readback.
    Buffer       determinism_readback;
    VkDeviceSize determinism_readback_size = 0;

    // ── Post-process UBO ──────────────────────────────────────────────
    Buffer pp_ubo_buffer;

    // ── Lifecycle methods ─────────────────────────────────────────────
    // Each method captures device + allocator on first call (asserts they
    // match on subsequent calls). Idempotent destroy ops use the captured
    // handles; create ops are called at init / resize / scene-load time.

    // Initialize captured Vulkan handles. Must be called before any
    // resource is allocated into the fields above. Idempotent on
    // matching device/allocator pairs.
    void initialize(VkDevice device, VmaAllocator allocator);

    // Targeted destroy helpers — used by resize_output (which destroys
    // images then recreates them) and by shutdown(). All idempotent.
    void destroy_output_views_and_images();
    void destroy_streaming_buffers();
    void destroy_tile_bin_buffers();

    // Tear down everything. Safe to call multiple times; idempotent.
    // Called explicitly from AppBase::cleanup() to control ordering
    // against VkContext tear-down; the destructor is a fallback.
    void shutdown();
};

}  // namespace gseurat
