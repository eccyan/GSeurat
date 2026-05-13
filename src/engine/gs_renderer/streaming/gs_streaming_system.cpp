#include "gseurat/engine/gs_renderer/streaming/gs_streaming_system.hpp"

#include <cassert>
#include <cstdio>

namespace gseurat {

GsStreamingSystem::~GsStreamingSystem() {
    shutdown();
}

void GsStreamingSystem::init(VkDevice device, VmaAllocator allocator) {
    assert(device != VK_NULL_HANDLE);
    assert(allocator != VK_NULL_HANDLE);
    device_    = device;
    allocator_ = allocator;
}

void GsStreamingSystem::shutdown() {
    // Idempotent: heavy mutators in GsRenderer (init_streaming /
    // clear_chunks) reset slab_allocator_ + transfer_queue_ when scenes
    // change. Here we simply release whatever remains at renderer
    // teardown time.
    transfer_queue_.reset();
    slab_allocator_.reset();
    active_chunks_.clear();
    pending_loads_.clear();
    pending_publications_.clear();
    deferred_slab_releases_.clear();
    streaming_initialized_ = false;
    device_    = VK_NULL_HANDLE;
    allocator_ = VK_NULL_HANDLE;
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

}  // namespace gseurat
