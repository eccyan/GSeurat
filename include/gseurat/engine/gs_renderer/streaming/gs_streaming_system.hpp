#pragma once

#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/slab_allocator.hpp"
#include "gseurat/engine/streaming_config.hpp"
#include "gseurat/engine/transfer_queue.hpp"
#include "gseurat/engine/types.hpp"
#include "gseurat/engine/world_manifest.hpp"

#include <vk_mem_alloc.h>
#include <vulkan/vulkan.h>

#include <array>
#include <cstdint>
#include <deque>
#include <memory>
#include <string>
#include <vector>

namespace gseurat {

struct GsResourceManager;
class GsSortSystem;
class GsTileBinSystem;

// Phase 5e-2: GsStreamingSystem owns the full streaming subsystem —
// data + read-only methods (carried over from 5e-1) + the 7 heavy
// mutators (init_streaming, load_cloud_async, unload_cloud,
// poll_transfers, publish_pending_chunks, clear_chunks,
// diag_streaming_dump) + the cross-cutting sizing/count/dirty-flag
// state previously held on GsRenderer.
//
// GsRenderer holds this by value and keeps thin forwarders for
// ABI stability. The friend declaration that existed in 5e-1 is
// gone: every mutator is now a member function with direct access
// to its own private state.
class GsStreamingSystem {
public:
    // Sized for: persistent dynamics (PBD-tagged trees, characters, NPCs) +
    // transient dynamics (VFX objects, particle emitters, scene animations).
    // The split-tail design (Option A) puts all bone-animated and PBD-tagged
    // splats in resources_->dynamic_gaussian_ssbo so the static depth sort
    // doesn't have to re-run every frame to keep them current. Persistent
    // content sums to ~700-800k splats for the island demo (12 trees ×
    // ~60k tagged + chars + NPCs); transient adds ~200k headroom for
    // chimney_smoke + torches. 1M × 64 B = 64 MB; projected_ssbo_ grows
    // proportionally. M5 unified memory absorbs this trivially.
    static constexpr uint32_t kDynamicHeadroom = 1048576;

    GsStreamingSystem() = default;
    ~GsStreamingSystem();

    GsStreamingSystem(const GsStreamingSystem&) = delete;
    GsStreamingSystem& operator=(const GsStreamingSystem&) = delete;
    GsStreamingSystem(GsStreamingSystem&&) = delete;
    GsStreamingSystem& operator=(GsStreamingSystem&&) = delete;

    // 5e-2: captures all dependencies needed by the migrated heavy
    // mutators. All four pointers must outlive this system (AppBase +
    // GsRenderer own them at the same level).
    void init(VkDevice device, VmaAllocator allocator,
              GsResourceManager* resources,
              GsSortSystem* sort, GsTileBinSystem* tile);

    // Tear down the transfer queue + slab allocator. Idempotent.
    void shutdown();

    // ── Heavy mutators (moved in for 5e-2) ────────────────────────────
    //
    // Allocate the streaming-derived slab/page/chunk table buffers,
    // compute and store the sort sizing scalars, and push them into
    // GsSortSystem/GsTileBinSystem. The renderer's own init_streaming
    // continues to allocate the non-streaming GPU buffers (pbd_*,
    // projected, sort A/B, merged_sort, uniform, etc.) and reads the
    // sizing scalars back via the getters below.
    //
    // `num_sort_passes` is owned by GsRenderer (render config) and
    // passed in so the depth-onesweep sizing matches the dispatch.
    void init_streaming(const StreamingConfig& config, uint32_t num_sort_passes);

    void unload_cloud(uint32_t chunk_id);

    // `drain_cmd` is a transient cmd buffer the caller already started;
    // clear_chunks records any outstanding acquire barriers from
    // completed transfers into it. Caller ends + submits + waits.
    // VK_NULL_HANDLE only legal on single-queue (Apple/fallback) path.
    void clear_chunks(VkCommandBuffer drain_cmd);

    std::vector<TransferQueue::Handle> load_cloud_async(GaussianCloud cloud);

    void poll_transfers(VkCommandBuffer frame_cmd, uint32_t frame_in_flight);

    // ── Lightweight methods (carried over from 5e-1) ──────────────────
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

    // ── Streaming-state getters (carried over from 5e-1) ──────────────
    uint32_t              active_chunk_count()   const { return static_cast<uint32_t>(active_chunks_.size()); }
    uint32_t              total_active_splats()  const { return total_active_splats_; }
    bool                  initialized()          const { return streaming_initialized_; }
    uint32_t              pending_load_count()   const { return static_cast<uint32_t>(pending_loads_.size()); }
    const StreamingConfig& config()              const { return streaming_config_; }
    const WorldManifest&  world_manifest()       const { return world_manifest_; }
    TransferQueue*        transfer_queue()             { return transfer_queue_.get(); }
    const TransferQueue*  transfer_queue()       const { return transfer_queue_.get(); }

    // ── Migrated cross-cutting state getters (5e-2) ───────────────────
    uint32_t static_count()             const { return static_count_; }
    uint32_t gaussian_count()           const { return gaussian_count_; }
    uint32_t max_static_count()         const { return max_static_count_; }
    uint32_t max_dynamic_count()        const { return max_dynamic_count_; }
    uint32_t max_gaussian_count()       const { return max_gaussian_count_; }
    uint32_t static_sort_size()         const { return static_sort_size_; }
    uint32_t static_sort_workgroups()   const { return static_sort_workgroups_; }
    uint32_t dynamic_sort_size()        const { return dynamic_sort_size_; }
    uint32_t dynamic_sort_workgroups()  const { return dynamic_sort_workgroups_; }
    uint32_t sort_size()                const { return sort_size_; }
    uint32_t num_sort_workgroups()      const { return num_sort_workgroups_; }
    uint32_t depth_onesweep_max_wg()    const { return depth_onesweep_max_wg_; }

    // Static-dirty countdown. Each frame slot must run static_preprocess
    // once after a static mutation. Initialised to kMaxFramesInFlight on
    // init/clear/publish.
    bool     static_dirty()             const { return static_dirty_frames_remaining_ > 0; }
    uint32_t static_dirty_frames_remaining() const { return static_dirty_frames_remaining_; }
    void     set_static_dirty(bool d) {
        static_dirty_frames_remaining_ = d ? kMaxFramesInFlight : 0;
    }
    void tick_static_dirty() {
        if (static_dirty_frames_remaining_ > 0) --static_dirty_frames_remaining_;
    }

    // Per-slot deferred sentinel-fill request. publish_pending_chunks
    // sets this for every slot OTHER than the one it's recording on
    // whenever an Unload shrinks static_count_; render() consumes it
    // at the start of its record for that slot (after the in-flight
    // fence wait has made the slot safe to write).
    bool is_static_tail_dirty(uint32_t frame) const { return static_sort_tail_dirty_per_slot_[frame]; }
    void clear_static_tail_dirty(uint32_t frame) { static_sort_tail_dirty_per_slot_[frame] = false; }

private:
    // diag dump invoked from poll_transfers under GS_DIAG_STREAMING=1.
    void diag_streaming_dump(uint64_t frame);

    // Drain pending_publications_ and record metadata writes
    // (page_table, chunk_table) onto `cmd` via vkCmdUpdateBuffer + a
    // TRANSFER_WRITE -> SHADER_READ barrier. Called from poll_transfers
    // immediately after poll_completions enqueues new publications.
    void publish_pending_chunks(VkCommandBuffer cmd, uint32_t frame_in_flight);

    // ── Injected dependencies ────────────────────────────────────────
    VkDevice            device_    = VK_NULL_HANDLE;
    VmaAllocator        allocator_ = VK_NULL_HANDLE;
    GsResourceManager*  resources_ = nullptr;
    GsSortSystem*       sort_      = nullptr;
    GsTileBinSystem*    tile_      = nullptr;

    // ── Streaming state ───────────────────────────────────────────────
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

    // ── Migrated cross-cutting state (5e-2) ──────────────────────────
    // Splat counts: static_count_ is mutated by publish_pending_chunks
    // (and reset by init/clear); gaussian_count_ tracks the legacy
    // single-buffer total used by render() at the uniform write site.
    uint32_t static_count_           = 0;
    uint32_t gaussian_count_         = 0;
    uint32_t max_static_count_       = 0;
    uint32_t max_dynamic_count_      = 0;
    uint32_t max_gaussian_count_     = 0;

    // Sort sizing scalars (Q3). Computed in init_streaming, pushed into
    // sort_/tile_ via their set_sort_sizes(); GsRenderer reads them
    // back via the getters above to size its non-streaming buffers.
    uint32_t static_sort_size_       = 0;
    uint32_t dynamic_sort_size_      = 0;
    uint32_t static_sort_workgroups_ = 0;
    uint32_t dynamic_sort_workgroups_= 0;
    uint32_t sort_size_              = 0;
    uint32_t num_sort_workgroups_    = 0;
    uint32_t depth_onesweep_max_wg_  = 0;

    // Per-frame projected_ssbos require each frame slot to run
    // static_preprocess at least once after a static mutation.
    uint32_t static_dirty_frames_remaining_ = kMaxFramesInFlight;
    // Per-slot deferred sentinel-fill request (Q2).
    std::array<bool, kMaxFramesInFlight> static_sort_tail_dirty_per_slot_{};
};

}  // namespace gseurat
