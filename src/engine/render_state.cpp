#include "gseurat/engine/render_state.hpp"

#include "gseurat/engine/vk_context.hpp"

namespace gseurat {

namespace {

// Flush the byte range covered by `dr` for a HOST_VISIBLE allocation.
// vmaFlushAllocation is a no-op when the allocation's memory type is
// HOST_COHERENT, so this is safe to call unconditionally and correct
// on platforms where VMA selects non-coherent host memory.
void flush_dirty(VmaAllocator alloc, VmaAllocation a,
                 const DirtyRange& dr, std::size_t stride) noexcept {
    if (dr.empty() || a == VK_NULL_HANDLE || alloc == VK_NULL_HANDLE) return;
    const VkDeviceSize offset = static_cast<VkDeviceSize>(dr.first) * stride;
    const VkDeviceSize size =
        static_cast<VkDeviceSize>(dr.last - dr.first + 1) * stride;
    // Return value ignored: failure is a device-lost-class event and will
    // surface through other code paths; we don't have a return channel here.
    (void)vmaFlushAllocation(alloc, a, offset, size);
}

}  // namespace


RenderState::RenderState(VkContext& ctx, const RenderStateConfig& cfg)
    : ctx_(ctx), cfg_(cfg) {
    VmaAllocator alloc = ctx_.allocator();
    const VkDeviceSize bones_bytes =
        static_cast<VkDeviceSize>(cfg_.max_bone_transforms) * sizeof(glm::mat4);
    const VkDeviceSize vfx_bytes =
        static_cast<VkDeviceSize>(cfg_.max_vfx_splats) * cfg_.splat_stride;
    const VkDeviceSize pbd_bytes =
        static_cast<VkDeviceSize>(cfg_.max_pbd_splats) * cfg_.splat_stride;
    const VkDeviceSize part_bytes =
        static_cast<VkDeviceSize>(cfg_.max_particles) * cfg_.splat_stride;

    for (auto& f : per_frame_) {
        f.bones = Buffer::create_storage(alloc, bones_bytes);
        f.vfx = Buffer::create_storage(alloc, vfx_bytes);
        f.pbd = Buffer::create_storage(alloc, pbd_bytes);
        f.particles = Buffer::create_storage(alloc, part_bytes);
    }
}

RenderState::~RenderState() {
    VmaAllocator alloc = ctx_.allocator();
    if (alloc == VK_NULL_HANDLE) return;  // VkContext already torn down
    for (auto& f : per_frame_) {
        f.bones.destroy(alloc);
        f.vfx.destroy(alloc);
        f.pbd.destroy(alloc);
        f.particles.destroy(alloc);
    }
}

BonesWriter RenderState::bones_writer(FrameIndex f) noexcept {
    auto& pf = per_frame_[to_u32(f) % kMaxFramesInFlight];
    return BonesWriter{static_cast<glm::mat4*>(pf.bones.mapped()),
                       cfg_.max_bone_transforms, &pf.bones_dirty};
}

VfxWriter RenderState::vfx_writer(FrameIndex f) noexcept {
    auto& pf = per_frame_[to_u32(f) % kMaxFramesInFlight];
    return VfxWriter{static_cast<std::byte*>(pf.vfx.mapped()),
                     cfg_.max_vfx_splats, cfg_.splat_stride, &pf.vfx_dirty};
}

PbdWriter RenderState::pbd_writer(FrameIndex f) noexcept {
    auto& pf = per_frame_[to_u32(f) % kMaxFramesInFlight];
    return PbdWriter{static_cast<std::byte*>(pf.pbd.mapped()),
                     cfg_.max_pbd_splats, cfg_.splat_stride, &pf.pbd_dirty};
}

ParticlesWriter RenderState::particles_writer(FrameIndex f) noexcept {
    auto& pf = per_frame_[to_u32(f) % kMaxFramesInFlight];
    return ParticlesWriter{static_cast<std::byte*>(pf.particles.mapped()),
                           cfg_.max_particles, cfg_.splat_stride,
                           &pf.particles_dirty};
}

VkBuffer RenderState::bones_buffer(FrameIndex f) const noexcept {
    return per_frame_[to_u32(f) % kMaxFramesInFlight].bones.buffer();
}
VkBuffer RenderState::vfx_buffer(FrameIndex f) const noexcept {
    return per_frame_[to_u32(f) % kMaxFramesInFlight].vfx.buffer();
}
VkBuffer RenderState::pbd_buffer(FrameIndex f) const noexcept {
    return per_frame_[to_u32(f) % kMaxFramesInFlight].pbd.buffer();
}
VkBuffer RenderState::particles_buffer(FrameIndex f) const noexcept {
    return per_frame_[to_u32(f) % kMaxFramesInFlight].particles.buffer();
}

void RenderState::begin_frame(FrameIndex f) noexcept {
    auto& pf = per_frame_[to_u32(f) % kMaxFramesInFlight];
    pf.bones_dirty.clear();
    pf.vfx_dirty.clear();
    pf.pbd_dirty.clear();
    pf.particles_dirty.clear();
}

void RenderState::end_frame(FrameIndex f) noexcept {
    // Buffers are HOST_ACCESS_SEQUENTIAL_WRITE + MAPPED via VMA's
    // create_storage. VMA may select either HOST_COHERENT or
    // non-coherent memory depending on the platform; vmaFlushAllocation
    // is a no-op in the coherent case (Apple Silicon's unified memory,
    // typical discrete-GPU HOST_VISIBLE | HOST_COHERENT) and issues the
    // required vkFlushMappedMemoryRanges otherwise. Calling it
    // unconditionally is correct everywhere.
    //
    // DirtyRange state is preserved here; begin_frame() clears it when
    // this slot is reused in a future frame.
    auto& pf = per_frame_[to_u32(f) % kMaxFramesInFlight];
    VmaAllocator alloc = ctx_.allocator();
    flush_dirty(alloc, pf.bones.allocation(),     pf.bones_dirty,     sizeof(glm::mat4));
    flush_dirty(alloc, pf.vfx.allocation(),       pf.vfx_dirty,       cfg_.splat_stride);
    flush_dirty(alloc, pf.pbd.allocation(),       pf.pbd_dirty,       cfg_.splat_stride);
    flush_dirty(alloc, pf.particles.allocation(), pf.particles_dirty, cfg_.splat_stride);
}

}  // namespace gseurat
