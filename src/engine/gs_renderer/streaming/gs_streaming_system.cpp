#include "gseurat/engine/gs_renderer/streaming/gs_streaming_system.hpp"

#include "gseurat/engine/buffer.hpp"
#include "gseurat/engine/debug.hpp"
#include "gseurat/engine/gs_renderer/gs_resources.hpp"
#include "gseurat/engine/gs_renderer/sort/gs_sort_system.hpp"
#include "gseurat/engine/gs_renderer/tile_bin/gs_tile_bin_system.hpp"
#include "gseurat/engine/scoped_timer.hpp"

#include <glm/glm.hpp>

#include <algorithm>
#include <array>
#include <cassert>
#include <cstdio>
#include <cstring>

namespace gseurat {

namespace {

// Matches the anonymous-namespace definition in gs_renderer.cpp. ProjectedSplat
// is the preprocess output; we size projected_ssbos[] from it inside
// init_streaming when the renderer's orchestrator asks for the sizes.
struct ProjectedSplat {
    glm::vec2 center;
    float depth;
    float radius;
    glm::vec4 conic_opacity;
    glm::vec4 color;
};

// Matches the anonymous-namespace definition in gs_renderer.cpp.
struct SortEntry {
    uint32_t key;
    uint32_t index;
};

}  // namespace

GsStreamingSystem::~GsStreamingSystem() {
    shutdown();
}

void GsStreamingSystem::init(VkDevice device, VmaAllocator allocator,
                              GsResourceManager* resources,
                              GsSortSystem* sort, GsTileBinSystem* tile) {
    assert(device != VK_NULL_HANDLE);
    assert(allocator != VK_NULL_HANDLE);
    assert(resources != nullptr);
    assert(sort != nullptr);
    assert(tile != nullptr);
    device_    = device;
    allocator_ = allocator;
    resources_ = resources;
    sort_      = sort;
    tile_      = tile;
}

void GsStreamingSystem::shutdown() {
    // The async loader no longer spins up worker threads — reserve+submit
    // run synchronously on the main thread now. We still call
    // `request_cancel` to be tidy: any pending callbacks queued in the
    // transfer queue should observe the shutdown flag and bail.
    if (transfer_queue_) {
        transfer_queue_->request_cancel();
        transfer_queue_->shutdown();
        transfer_queue_.reset();
    }
    slab_allocator_.reset();
    active_chunks_.clear();
    pending_loads_.clear();
    pending_publications_.clear();
    deferred_slab_releases_.clear();
    streaming_initialized_ = false;
    device_    = VK_NULL_HANDLE;
    allocator_ = VK_NULL_HANDLE;
    resources_ = nullptr;
    sort_      = nullptr;
    tile_      = nullptr;
}

void GsStreamingSystem::load_world(const WorldManifest& manifest) {
    world_manifest_ = manifest;
    std::fprintf(stderr, "[GsStreamingSystem] World loaded: %zu chunks, cell_size=(%.0f,%.0f,%.0f)\n",
        manifest.chunks.size(),
        manifest.grid_cell_size.x, manifest.grid_cell_size.y, manifest.grid_cell_size.z);
}

void GsStreamingSystem::create_transfer_queue(VkQueue transfer_q, uint32_t transfer_family,
                                                uint32_t graphics_family, bool dedicated) {
    if (!streaming_initialized_) return;
    // Sized for double-buffered slab uploads plus headroom for in-flight
    // chunks before they retire on the fence — multi-batch concurrency
    // now matters because the queue accepts arbitrary destination
    // buffers.
    const uint64_t staging_size = streaming_config_.slab_bytes() * 4;
    transfer_queue_ = std::make_unique<TransferQueue>(
        device_, allocator_,
        transfer_q, transfer_family, graphics_family,
        dedicated, staging_size,
        streaming_config_.transfer_budget_mb_per_frame);
}

std::vector<GsStreamingSystem::ChunkInventoryEntry> GsStreamingSystem::chunk_inventory() const {
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

void GsStreamingSystem::init_streaming(const StreamingConfig& config, uint32_t num_sort_passes) {
    streaming_config_ = config;
    slab_allocator_ = std::make_unique<SlabAllocator>(config.total_slabs(), config.slab_size_splats);

    static_dirty_frames_remaining_ = kMaxFramesInFlight;

    // Sizing scalars (Q3: derived from streaming config).
    max_static_count_  = config.gpu_budget_splats;
    max_dynamic_count_ = kDynamicHeadroom;
    static_count_      = 0;
    gaussian_count_    = 0;
    max_gaussian_count_ = max_static_count_ + max_dynamic_count_;

    auto compute_sort_params = [](uint32_t max_count, uint32_t& sort_size, uint32_t& num_wg) {
        sort_size = ((max_count + 2047) / 2048) * 2048;
        if (sort_size < max_count) sort_size = max_count;
        num_wg = sort_size / 2048;
        if (num_wg == 0) num_wg = 1;
        sort_size = num_wg * 2048;
    };
    compute_sort_params(max_static_count_,  static_sort_size_,  static_sort_workgroups_);
    compute_sort_params(max_dynamic_count_, dynamic_sort_size_, dynamic_sort_workgroups_);
    sort_size_           = static_sort_size_;
    num_sort_workgroups_ = static_sort_workgroups_;
    depth_onesweep_max_wg_ =
        std::max({static_sort_workgroups_, dynamic_sort_workgroups_, num_sort_workgroups_});

    // Push sizes into peer subsystems. They size their own onesweep
    // status / per-tile / scan buffers off these scalars at write time.
    sort_->set_sort_sizes(static_sort_size_, static_sort_workgroups_,
                          dynamic_sort_size_, dynamic_sort_workgroups_,
                          sort_size_, num_sort_workgroups_,
                          num_sort_passes, depth_onesweep_max_wg_);
    tile_->set_sort_sizes(static_sort_size_, dynamic_sort_size_);

    // Page table: one uint32 per slab, initialized to 0xFFFFFFFF (invalid).
    // host_dst variant: reads happen on the GPU every frame; updates from
    // chunk-load completions are recorded as vkCmdUpdateBuffer onto the
    // current frame's cmd buffer with a TRANSFER_WRITE -> SHADER_READ barrier
    // so they don't tear under in-flight GPU reads.
    resources_->page_table_ssbo.destroy(allocator_);
    resources_->page_table_ssbo = Buffer::create_storage_host_dst(allocator_,
        static_cast<VkDeviceSize>(config.total_slabs()) * sizeof(uint32_t));
    std::memset(resources_->page_table_ssbo.mapped(), 0xFF,
                config.total_slabs() * sizeof(uint32_t));

    // Chunk table: 256 entries x 16 bytes each, zeroed. Same host_dst
    // rationale as page_table.
    resources_->chunk_table_ssbo.destroy(allocator_);
    resources_->chunk_table_ssbo = Buffer::create_storage_host_dst(allocator_, 256 * 16);
    std::memset(resources_->chunk_table_ssbo.mapped(), 0, 256 * 16);

    active_chunks_.clear();
    total_active_splats_   = 0;
    streaming_initialized_ = true;

    std::fprintf(stderr, "GS: Streaming initialized — budget=%u splats, %u slabs of %u\n",
                 config.gpu_budget_splats, config.total_slabs(), config.slab_size_splats);
}

void GsStreamingSystem::unload_cloud(uint32_t chunk_id) {
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

void GsStreamingSystem::clear_chunks(VkCommandBuffer drain_cmd) {
    if (!streaming_initialized_) return;

    // Wait for any in-flight transfers so we don't release slabs the GPU
    // is still writing to. Scene transitions are heavy operations.
    vkDeviceWaitIdle(device_);

    // Drain any completion callbacks queued by transfers that finished
    // during waitIdle. The dedicated transfer-family path needs a real
    // command buffer to record acquire barriers; with VK_NULL_HANDLE
    // poll_completions defers callbacks to the next frame, where they
    // would later fire against a freshly-loaded scene's slab indices
    // and corrupt state.
    if (transfer_queue_) transfer_queue_->poll_completions(drain_cmd);

    // poll_completions above can fire transfer-completion callbacks that
    // enqueue new PendingChunkPublication entries referencing OLD-scene
    // slabs. If we don't drain them here, the next poll_transfers (after
    // the new scene has loaded) would publish stale page_table /
    // chunk_table writes for slabs the new scene never owned —
    // ghost-chunk metadata leaking across scene boundary. Same hazard
    // for deferred_slab_releases_.
    //
    // GPU is idle (vkDeviceWaitIdle above) so direct slab releases here
    // are safe.
    for (auto& p : pending_publications_) {
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
    // own slabs we never published into `active_chunks_`. Release them
    // manually so the allocator can reuse those indices.
    for (auto& job : pending_loads_) {
        slab_allocator_->release(job.slab_handle);
    }
    pending_loads_.clear();

    for (auto& chunk : active_chunks_) slab_allocator_->release(chunk.handle);
    active_chunks_.clear();
    static_count_         = 0;
    total_active_splats_  = 0;
    gaussian_count_       = 0;
    static_dirty_frames_remaining_ = kMaxFramesInFlight;

    // Zero the dynamic SSBO so a future over-count of dynamic_count_
    // can't surface old-scene gaussians as ghost geometry. memset (not
    // vkCmdFillBuffer) because Buffer::create_storage omits TRANSFER_DST_BIT;
    // the buffer is HOST_VISIBLE+MAPPED, and `vkDeviceWaitIdle` above
    // guarantees the GPU is idle here.
    if (resources_->dynamic_gaussian_ssbo.mapped() && max_dynamic_count_ > 0) {
        std::memset(resources_->dynamic_gaussian_ssbo.mapped(), 0,
                    static_cast<size_t>(max_dynamic_count_) * sizeof(GpuGaussian));
    }

    // Reset the static depth-sort tail. The previous scene's last frame
    // left valid keys at indices [0, old_static_count_) in static_sort_a_/b_;
    // those entries survive `static_count_ = 0` because the depth-sort
    // shader only writes keys for [0, current_static_count_) each frame.
    // Without this reset, stale keys sort to the front and the rasterizer
    // will dereference their indices into resources_->static_gaussian_ssbo —
    // which still holds the previous scene's data at those offsets —
    // producing ghost geometry at the previous scene's world coordinates.
    auto fill_sort_sentinel = [](Buffer& buf, uint32_t sort_size) {
        if (!buf.mapped() || sort_size == 0) return;
        auto* sort = static_cast<SortEntry*>(buf.mapped());
        for (uint32_t i = 0; i < sort_size; ++i) {
            sort[i].key   = 0xFFFFFFFFu;
            sort[i].index = 0;
        }
    };
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        fill_sort_sentinel(resources_->static_sort_as[f], static_sort_size_);
        fill_sort_sentinel(resources_->static_sort_bs[f], static_sort_size_);
    }

    // Invalidate the slab-indirection metadata. publish_pending_chunks's
    // Unload path writes 0xFFFFFFFF sentinels to resources_->page_table_ssbo
    // for each released slab + clears the chunk-table row, but clear_chunks
    // releases slabs by calling slab_allocator_->release(...) directly and
    // bypasses that path entirely. Anything in the rendering pipeline that
    // walks the page/chunk tables after a smaller-scene reload would
    // otherwise fetch stale data.
    //
    // Both buffers were created HOST_VISIBLE+TRANSFER_DST and are
    // host-mapped. vkDeviceWaitIdle above guarantees the GPU is idle,
    // so direct host writes are safe.
    if (resources_->page_table_ssbo.mapped()) {
        std::memset(resources_->page_table_ssbo.mapped(), 0xFF,
                    static_cast<size_t>(streaming_config_.total_slabs()) * sizeof(uint32_t));
    }
    if (resources_->chunk_table_ssbo.mapped()) {
        std::memset(resources_->chunk_table_ssbo.mapped(), 0, 256 * 16);
    }

    // Reset the visibility counts so the first post-portal frame doesn't
    // start by reading {static_visible, dynamic_visible, merged_visible}
    // values left over from the previous scene's last frame.
    for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
        if (resources_->counts_ssbos[f].mapped()) {
            auto* counts = static_cast<uint32_t*>(resources_->counts_ssbos[f].mapped());
            counts[0] = 0;
            counts[1] = 0;
            counts[2] = 0;
        }
    }

    // Zero the static splat data itself.
    if (resources_->static_gaussian_ssbo.mapped() && max_static_count_ > 0) {
        std::memset(resources_->static_gaussian_ssbo.mapped(), 0,
                    static_cast<size_t>(max_static_count_) * sizeof(GpuGaussian));
    }

    // Zero projected_ssbo_. Preprocess writes
    // projected_ssbo_[projected_offset, +static_count_) each frame the
    // static path is dirty, but the tail beyond that range keeps the
    // previous scene's last-frame projections — including the overworld
    // trees' PBD-transformed positions at far world coords.
    const size_t total_projected =
        static_cast<size_t>(max_static_count_ + max_dynamic_count_);
    if (total_projected > 0) {
        for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
            if (resources_->projected_ssbos[f].mapped()) {
                std::memset(resources_->projected_ssbos[f].mapped(), 0,
                            total_projected * sizeof(ProjectedSplat));
            }
        }
    }

    // Reset the merged_sort tail to zero across all per-frame slots so the
    // first post-portal frame's merge sees a clean output buffer.
    const size_t merged_total =
        static_cast<size_t>(max_static_count_ + max_dynamic_count_);
    if (merged_total > 0) {
        for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
            if (resources_->merged_sort_ssbos[f].mapped()) {
                std::memset(resources_->merged_sort_ssbos[f].mapped(), 0,
                            merged_total * sizeof(SortEntry));
            }
        }
    }

    static_dirty_frames_remaining_ = kMaxFramesInFlight;

    GS_DBG_INVARIANT(active_chunks_.empty() && static_count_ == 0,
                     "clear_chunks: active_chunks_ must be empty and static_count_ zeroed post-clear");
}

std::vector<TransferQueue::Handle> GsStreamingSystem::load_cloud_async(GaussianCloud cloud) {
    if (!streaming_initialized_ || !transfer_queue_) {
        // Streaming-strict mode: init_streaming + create_transfer_queue must
        // both be called before load_cloud_async.
        std::fprintf(stderr,
            "GS ERROR: load_cloud_async called before streaming was initialized "
            "(streaming_initialized_=%d, transfer_queue_=%s). "
            "Call init_streaming() and create_transfer_queue() first.\n",
            static_cast<int>(streaming_initialized_),
            transfer_queue_ ? "ok" : "null");
        return {};
    }
    if (cloud.empty()) return {};

    // Append-only semantics. The new chunk is checked out from the slab
    // allocator and pushed onto active_chunks_ by the final completion
    // callback — existing chunks are *not* released. Callers that need
    // "replace previous scene" must explicitly call clear_chunks() before
    // this.
    //
    // Multiple concurrent loads queue up on pending_loads_ instead of
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

void GsStreamingSystem::poll_transfers(VkCommandBuffer frame_cmd, uint32_t frame_in_flight) {
    if (!transfer_queue_) return;
    // Diagnostic: full poll path covers slab-upload submits, completion
    // callback drains, deferred slab releases, and the metadata publish.
    // If the beachball is in any of those paths, this fires.
    ScopedStallTimer _t_poll{"GsStreamingSystem::poll_transfers"};

    // Drain queued slab uploads as long as the staging ring has space.
    // We process the front job's slabs, then advance to the next job
    // when a job is fully submitted. The ring naturally throttles
    // multi-job uploads — when a slab can't fit, we break and resume
    // next frame. Each job's completion callback writes its chunk to
    // active_chunks_, so multiple chunks can be in flight via the
    // GPU fence without conflict.
    const VkBuffer dest = resources_->static_gaussian_ssbo.buffer();
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
            // active_chunks_ and static_count_, so we serialise
            // job completions in order.
            (void)ring_full;
            break;
        }

        // Front job is fully submitted. Queue the completion marker —
        // exactly once per job.
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

        pending_loads_.pop_front();
    }

    transfer_queue_->poll_completions(frame_cmd);
    publish_pending_chunks(frame_cmd, frame_in_flight);

    // ── DIAG: streaming-state dump (PR #387 ghost investigation) ──
    // Opt-in via env var GS_DIAG_STREAMING=1. Prints to stderr each
    // frame for the first 5 frames, then every 60 frames (~1s @ 60fps)
    // thereafter.
    {
        static const bool diag_enabled = ::gs::dbg::enabled(::gs::dbg::Diag::StreamingState);
        if (diag_enabled && streaming_initialized_) {
            static uint64_t diag_frame = 0;
            ++diag_frame;
            const bool dump_now = (diag_frame <= 5) || (diag_frame % 60 == 0);
            if (dump_now) {
                diag_streaming_dump(diag_frame);
            }
        }
    }
}

void GsStreamingSystem::publish_pending_chunks(VkCommandBuffer cmd, uint32_t frame_in_flight) {
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

    // Snapshot the count BEFORE this batch's Unloads shrink it.
    const uint32_t prev_static_count = static_count_;

    bool any_published = false;
    bool chunk_table_needs_full_rebuild = false;

    while (!pending_publications_.empty()) {
        PendingChunkPublication p = std::move(pending_publications_.front());
        pending_publications_.pop_front();

        if (p.op == PendingChunkPublication::Op::Load) {
            // === LOAD ===
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
                    vkCmdUpdateBuffer(cmd, resources_->page_table_ssbo.buffer(),
                                      pt_offset_bytes, pt_size_bytes,
                                      p.handle.slab_indices.data());
                } else {
                    std::fprintf(stderr,
                        "[gs_streaming] publish: page_table update %llu bytes "
                        "exceeds vkCmdUpdateBuffer 65536-byte limit; chunk has "
                        "%zu slabs\n",
                        static_cast<unsigned long long>(pt_size_bytes),
                        p.handle.slab_indices.size());
                }
            }

            // chunk_table entry: 16 bytes at index `chunk_idx * 16`.
            const uint32_t chunk_idx = static_cast<uint32_t>(active_chunks_.size());
            const uint32_t last_slab_splats =
                p.splat_count - (p.slabs_needed - 1) * p.slab_size_splats;
            const uint32_t entry[4] = {page_table_offset, p.slabs_needed,
                                        last_slab_splats, p.splat_count};
            vkCmdUpdateBuffer(cmd, resources_->chunk_table_ssbo.buffer(),
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
                continue;
            }

            // Step 1: invalidate this chunk's page_table entries.
            const uint32_t nslabs = static_cast<uint32_t>(it->handle.slab_indices.size());
            if (nslabs > 0) {
                std::vector<uint32_t> sentinel(nslabs, 0xFFFFFFFFu);
                const VkDeviceSize pt_offset_bytes =
                    static_cast<VkDeviceSize>(it->page_table_offset) * sizeof(uint32_t);
                const VkDeviceSize pt_size_bytes =
                    static_cast<VkDeviceSize>(nslabs) * sizeof(uint32_t);
                if (pt_size_bytes <= 65536) {
                    vkCmdUpdateBuffer(cmd, resources_->page_table_ssbo.buffer(),
                                      pt_offset_bytes, pt_size_bytes, sentinel.data());
                } else {
                    std::fprintf(stderr,
                        "[gs_streaming] publish: unload page_table sentinel %llu bytes "
                        "exceeds vkCmdUpdateBuffer 65536-byte limit\n",
                        static_cast<unsigned long long>(pt_size_bytes));
                }
            }

            // Step 2: hand the slab handle to the deferred-release queue.
            DeferredSlabRelease dr;
            dr.handle = std::move(it->handle);
            dr.frames_remaining = kMaxFramesInFlight + 1;
            deferred_slab_releases_.push_back(std::move(dr));

            // Step 3: erase from active_chunks_. Other chunks' indices
            // shift, so chunk_table needs a full rewrite below.
            active_chunks_.erase(it);
            chunk_table_needs_full_rebuild = true;

            // Step 4: the static_sort tail sentinel-fill happens below in
            // the any_published block when this batch shrunk static_count_.
        }

        any_published = true;
    }

    // If any unload happened, chunk indices in active_chunks_ shifted, so
    // the chunk_table on the GPU now references stale data. Rewrite the
    // valid prefix and zero the tail. 256 entries × 16 B = 4 KiB.
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
        vkCmdUpdateBuffer(cmd, resources_->chunk_table_ssbo.buffer(), 0,
                          static_cast<VkDeviceSize>(ct_data.size()) * sizeof(uint32_t),
                          ct_data.data());
    }

    if (any_published) {
        // Recompute counts on the CPU side in the same step so the next
        // frame's render() sees a consistent {static_count_, page_table,
        // chunk_table} triple.
        static_count_ = 0;
        for (const auto& c : active_chunks_) static_count_ += c.splat_count;
        total_active_splats_ = static_count_;
        gaussian_count_      = static_count_;
        static_dirty_frames_remaining_ = kMaxFramesInFlight;

        // Sentinel-fill the static_sort_a_/b_ delta window when this batch
        // shrunk static_count_. The depth sort each frame writes keys for
        // [0, static_count_), so entries beyond static_count_ would remain
        // valid only if pre-filled with key=0xFFFFFFFF. After an Unload,
        // [new_count, prev_count) holds REAL depth keys from the prior
        // frame's sort — those would otherwise participate in the next
        // global radix sort with valid `index` fields, leak into merge
        // output, and render as ghost splats.
        if (static_count_ < prev_static_count) {
            const VkDeviceSize entry_sz = sizeof(SortEntry);  // 8 bytes
            const VkDeviceSize fill_offset =
                static_cast<VkDeviceSize>(static_count_) * entry_sz;
            const VkDeviceSize fill_size =
                static_cast<VkDeviceSize>(prev_static_count - static_count_) * entry_sz;
            vkCmdFillBuffer(cmd, resources_->static_sort_as[frame_in_flight].buffer(),
                            fill_offset, fill_size, 0xFFFFFFFFu);
            vkCmdFillBuffer(cmd, resources_->static_sort_bs[frame_in_flight].buffer(),
                            fill_offset, fill_size, 0xFFFFFFFFu);
            for (uint32_t f = 0; f < kMaxFramesInFlight; ++f) {
                if (f != frame_in_flight) {
                    static_sort_tail_dirty_per_slot_[f] = true;
                }
            }
        }

        // Single barrier covering both metadata buffers AND the sort-tail
        // fill: TRANSFER_WRITE -> SHADER_READ.
        const bool sort_filled = (static_count_ < prev_static_count);
        VkBufferMemoryBarrier barriers[4]{};
        uint32_t nb = 0;
        auto add = [&](VkBuffer b) {
            barriers[nb].sType = VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER;
            barriers[nb].srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
            barriers[nb].dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
            barriers[nb].srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
            barriers[nb].dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
            barriers[nb].buffer = b;
            barriers[nb].offset = 0;
            barriers[nb].size = VK_WHOLE_SIZE;
            ++nb;
        };
        add(resources_->page_table_ssbo.buffer());
        add(resources_->chunk_table_ssbo.buffer());
        if (sort_filled) {
            add(resources_->static_sort_as[frame_in_flight].buffer());
            add(resources_->static_sort_bs[frame_in_flight].buffer());
        }

        vkCmdPipelineBarrier(cmd,
            VK_PIPELINE_STAGE_TRANSFER_BIT,
            VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
            0, 0, nullptr, nb, barriers, 0, nullptr);
    }

    // PR #387 invariant: CPU-side static_count_ must always equal the sum
    // of splat counts across all active chunks.
    GS_DBG_INVARIANT(
        [&]{ uint32_t s = 0; for (const auto& c : active_chunks_) s += c.splat_count; return s; }() == static_count_,
        "publish_pending_chunks: static_count_ drift vs sum(active_chunks.splat_count)");
}

void GsStreamingSystem::diag_streaming_dump(uint64_t frame) {
    std::fprintf(stderr,
        "[gs_diag] f=%llu static=%u total_active=%u max_static=%u\n",
        static_cast<unsigned long long>(frame),
        static_count_, total_active_splats_, max_static_count_);

    // active_chunks_ — what the engine THINKS is loaded.
    std::fprintf(stderr, "[gs_diag]   active_chunks=%zu\n", active_chunks_.size());
    for (size_t i = 0; i < active_chunks_.size(); ++i) {
        const auto& c = active_chunks_[i];
        std::fprintf(stderr,
            "[gs_diag]     [%zu] chunk_id=%u splats=%u page_offset=%u slabs=%zu\n",
            i, c.handle.chunk_id, c.splat_count, c.page_table_offset,
            c.handle.slab_indices.size());
    }

    // projected_ssbo_ tail scan: what's living BEYOND static_count_.
    if (resources_->projected_ssbos[0].mapped() && static_count_ < max_static_count_) {
        const auto* p = static_cast<const ProjectedSplat*>(resources_->projected_ssbos[0].mapped());
        const uint32_t scan_start = static_count_;
        const uint32_t scan_end =
            std::min<uint32_t>(static_count_ + 2048u, max_static_count_);
        uint32_t non_zero = 0;
        uint32_t real_looking = 0;  // radius>0 AND depth>0
        std::fprintf(stderr,
            "[gs_diag]   projected_ssbo_ tail scan [%u..%u):\n",
            scan_start, scan_end);
        for (uint32_t i = scan_start; i < scan_end; ++i) {
            const auto& s = p[i];
            const bool any_nz =
                s.center.x != 0.0f || s.center.y != 0.0f ||
                s.depth != 0.0f || s.radius != 0.0f ||
                s.color.x != 0.0f || s.color.y != 0.0f ||
                s.color.z != 0.0f || s.color.w != 0.0f;
            if (any_nz) ++non_zero;
            if (s.radius > 0.0f && s.depth > 0.0f) {
                ++real_looking;
                if (real_looking <= 5) {
                    std::fprintf(stderr,
                        "[gs_diag]     tail[%u] center=(%.2f,%.2f) depth=%.2f "
                        "radius=%.2f color=(%.2f,%.2f,%.2f,%.2f)\n",
                        i, s.center.x, s.center.y, s.depth, s.radius,
                        s.color.x, s.color.y, s.color.z, s.color.w);
                }
            }
        }
        std::fprintf(stderr,
            "[gs_diag]     summary: non_zero=%u real_looking=%u (in %u slots)\n",
            non_zero, real_looking, scan_end - scan_start);
    }

    // merged_sort_ssbo_: indices the rasterizer WILL read, bounded by
    // total_active_splats_. If max_idx >= max_static + max_dynamic that's
    // an out-of-bounds index — direct evidence of a bound bug.
    if (resources_->merged_sort_ssbos[0].mapped() && total_active_splats_ > 0) {
        const auto* m = static_cast<const SortEntry*>(resources_->merged_sort_ssbos[0].mapped());
        const uint32_t total_max = max_static_count_ + max_dynamic_count_;
        const uint32_t merge_count = total_active_splats_;
        uint32_t max_idx = 0;
        uint32_t idx_above_count = 0;     // index points beyond static_count_+dynamic_count_
        uint32_t idx_above_capacity = 0;  // index points beyond capacity (real OOB)
        for (uint32_t i = 0; i < merge_count; ++i) {
            const uint32_t idx = m[i].index;
            if (idx > max_idx) max_idx = idx;
            if (idx >= static_count_) ++idx_above_count;
            if (idx >= total_max) ++idx_above_capacity;
        }
        std::fprintf(stderr,
            "[gs_diag]   merged_sort: count=%u max_idx=%u above_static=%u above_capacity=%u\n",
            merge_count, max_idx, idx_above_count, idx_above_capacity);
    }

    // static_sort_a_ tail invariant check: should be all key=0xFFFFFFFF
    // beyond static_count_. Per-frame: inspect slot [0] — both slots hold
    // the same data when invariants hold, so slot [0] is sufficient.
    if (resources_->static_sort_as[0].mapped() && static_count_ < static_sort_size_) {
        const auto* s = static_cast<const SortEntry*>(resources_->static_sort_as[0].mapped());
        const uint32_t scan_end = std::min<uint32_t>(static_count_ + 1024u, static_sort_size_);
        uint32_t non_sentinel = 0;
        uint32_t first_offender = UINT32_MAX;
        for (uint32_t i = static_count_; i < scan_end; ++i) {
            if (s[i].key != 0xFFFFFFFFu) {
                ++non_sentinel;
                if (first_offender == UINT32_MAX) first_offender = i;
            }
        }
        std::fprintf(stderr,
            "[gs_diag]   resources_->static_sort_as[0] tail [%u..%u): non_sentinel=%u first_offender=%s\n",
            static_count_, scan_end, non_sentinel,
            first_offender == UINT32_MAX
                ? "none"
                : (std::string("idx=") + std::to_string(first_offender)).c_str());
    }
    std::fflush(stderr);
}

}  // namespace gseurat
