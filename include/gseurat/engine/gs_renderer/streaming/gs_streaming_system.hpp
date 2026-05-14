#pragma once

#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/slab_allocator.hpp"
#include "gseurat/engine/streaming_config.hpp"
#include "gseurat/engine/transfer_queue.hpp"
#include "gseurat/engine/world_manifest.hpp"

#include <vk_mem_alloc.h>
#include <vulkan/vulkan.h>

#include <cstdint>
#include <deque>
#include <memory>
#include <string>
#include <vector>

namespace gseurat {

class GsRenderer;  // friend for 5e-1 interim access

// Phase 5e-1: streaming state + lightweight methods extracted from
// GsRenderer. Owns the slab allocator, active-chunk inventory,
// transfer queue, and pending-load / pending-publication queues.
//
// 5e-1 is the data move: state + 4 nested structs + the small
// methods (load_world, chunk_inventory, create_transfer_queue) +
// getters are owned here. The heavy mutators (init_streaming,
// load_cloud_async, poll_transfers, publish_pending_chunks,
// unload_cloud, clear_chunks, diag_streaming_dump) STAY in
// GsRenderer for now and reach into this system's state via the
// `friend class GsRenderer;` declaration below. 5e-2 will move
// those bodies into the system and remove the friend.
//
// Lifetime: by-value member of GsRenderer; same lifetime as the
// renderer. Built lazily via init(device, allocator) before the
// first init_streaming() call.
class GsStreamingSystem {
public:
    GsStreamingSystem() = default;
    ~GsStreamingSystem();

    GsStreamingSystem(const GsStreamingSystem&) = delete;
    GsStreamingSystem& operator=(const GsStreamingSystem&) = delete;
    GsStreamingSystem(GsStreamingSystem&&) = delete;
    GsStreamingSystem& operator=(GsStreamingSystem&&) = delete;

    // Capture device + allocator handles used by lightweight methods
    // (create_transfer_queue). Heavy mutators in GsRenderer pass these
    // explicitly, so this init is intentionally minimal.
    void init(VkDevice device, VmaAllocator allocator);

    // Tear down the transfer queue + slab allocator. Idempotent.
    void shutdown();

    // ── Lightweight methods (moved here in 5e-1) ──────────────────────
    void load_world(const WorldManifest& manifest);
    void create_transfer_queue(VkQueue transfer_q, uint32_t transfer_family,
                                uint32_t graphics_family, bool dedicated);

    struct ChunkInventoryEntry {
        std::string status_str;
        uint32_t    page_table_offset;
        uint32_t    splat_count;
        uint32_t    slab_count;
    };
    std::vector<ChunkInventoryEntry> chunk_inventory() const;

    // ── Read-only state access ────────────────────────────────────────
    uint32_t              active_chunk_count()   const { return static_cast<uint32_t>(active_chunks_.size()); }
    uint32_t              total_active_splats()  const { return total_active_splats_; }
    bool                  initialized()          const { return streaming_initialized_; }
    uint32_t              pending_load_count()   const { return static_cast<uint32_t>(pending_loads_.size()); }
    const StreamingConfig& config()              const { return streaming_config_; }
    const WorldManifest&  world_manifest()       const { return world_manifest_; }
    TransferQueue*        transfer_queue()             { return transfer_queue_.get(); }
    const TransferQueue*  transfer_queue()       const { return transfer_queue_.get(); }

private:
    // 5e-2 will remove this friend declaration once all heavy mutators
    // (init_streaming, load_cloud_async, poll_transfers,
    // publish_pending_chunks, unload_cloud, clear_chunks,
    // diag_streaming_dump) move into the system.
    friend class GsRenderer;

    VkDevice     device_    = VK_NULL_HANDLE;
    VmaAllocator allocator_ = VK_NULL_HANDLE;

    // ── Streaming state (moved from GsRenderer) ───────────────────────
    StreamingConfig                streaming_config_;
    std::unique_ptr<SlabAllocator> slab_allocator_;

    struct ChunkState {
        enum class Status { LOADING, ACTIVE, UNLOADING };
        Status                       status;
        SlabAllocator::SlabHandle    handle;
        uint32_t                     page_table_offset;
        uint32_t                     splat_count;
    };
    std::vector<ChunkState> active_chunks_;
    uint32_t                total_active_splats_  = 0;
    bool                    streaming_initialized_ = false;

    // Async transfer queue. Reservations and submits run on the main
    // thread; poll_transfers (per-frame) retires fences and fires
    // per-batch completion callbacks that publish uploaded chunks to
    // the renderer.
    std::unique_ptr<TransferQueue> transfer_queue_;

    // Queued async cloud uploads. load_cloud_async pushes to the back;
    // poll_transfers drains the front job's slabs as the staging ring
    // frees space, and pops once a job's slabs are all submitted (the
    // per-job completion callback then fires later when the GPU fence
    // retires).
    struct PendingLoadJob {
        GaussianCloud                       cloud;
        SlabAllocator::SlabHandle           slab_handle;
        std::vector<TransferQueue::Handle>  handles;  // one per slab
        uint32_t                            splat_count        = 0;
        uint32_t                            slabs_needed       = 0;
        uint32_t                            slab_size_splats   = 0;
        uint32_t                            next_slab          = 0;
        bool                                completion_enqueued = false;
    };
    std::deque<PendingLoadJob> pending_loads_;

    // Chunks whose metadata mutation (page_table, chunk_table) has been
    // requested but not yet published on the GPU. Both load completions
    // and unload requests enqueue here; the actual SSBO writes happen
    // in publish_pending_chunks() recorded onto the current frame's
    // command buffer with TRANSFER_WRITE -> SHADER_READ barriers.
    struct PendingChunkPublication {
        enum class Op { Load, Unload };
        Op                          op                = Op::Load;
        SlabAllocator::SlabHandle   handle;
        uint32_t                    splat_count       = 0;
        uint32_t                    slabs_needed      = 0;
        uint32_t                    slab_size_splats  = 0;
        uint32_t                    unload_chunk_id   = 0;
    };
    std::deque<PendingChunkPublication> pending_publications_;

    // Slabs released by an unload have to outlive any in-flight frame
    // that was reading them via the OLD page_table. Hold for at least
    // kMaxFramesInFlight ticks of poll_transfers (+1 for slack), then
    // release.
    struct DeferredSlabRelease {
        SlabAllocator::SlabHandle handle;
        uint32_t                  frames_remaining = 0;
    };
    std::deque<DeferredSlabRelease> deferred_slab_releases_;

    // World manifest (Phase 3 streaming)
    WorldManifest world_manifest_;
};

}  // namespace gseurat
