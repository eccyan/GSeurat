#include "gseurat/engine/render_state.hpp"

#include "gseurat/engine/vk_context.hpp"

namespace gseurat {

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
    const VkDeviceSize light_bytes =
        static_cast<VkDeviceSize>(cfg_.max_point_lights) * sizeof(PointLight);

    for (auto& f : per_frame_) {
        f.bones = Buffer::create_storage(alloc, bones_bytes);
        f.vfx = Buffer::create_storage(alloc, vfx_bytes);
        f.pbd = Buffer::create_storage(alloc, pbd_bytes);
        f.particles = Buffer::create_storage(alloc, part_bytes);
        f.point_lights = Buffer::create_storage(alloc, light_bytes);
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
        f.point_lights.destroy(alloc);
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

PointLightsWriter RenderState::point_lights_writer(FrameIndex f) noexcept {
    auto& pf = per_frame_[to_u32(f) % kMaxFramesInFlight];
    return PointLightsWriter{static_cast<PointLight*>(pf.point_lights.mapped()),
                             cfg_.max_point_lights, &pf.lights_dirty};
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
VkBuffer RenderState::point_lights_buffer(FrameIndex f) const noexcept {
    return per_frame_[to_u32(f) % kMaxFramesInFlight].point_lights.buffer();
}

void RenderState::begin_frame(FrameIndex f) noexcept {
    auto& pf = per_frame_[to_u32(f) % kMaxFramesInFlight];
    pf.bones_dirty.clear();
    pf.vfx_dirty.clear();
    pf.pbd_dirty.clear();
    pf.particles_dirty.clear();
    pf.lights_dirty.clear();
}

void RenderState::end_frame(FrameIndex /*f*/) noexcept {
    // Buffers are HOST_ACCESS_SEQUENTIAL_WRITE + MAPPED via VMA's
    // create_storage. On coherent memory (Apple Silicon's unified
    // memory, most discrete GPUs' HOST_VISIBLE | HOST_COHERENT) writes
    // are visible to the GPU without an explicit flush — no work to do.
    //
    // If a future target exposes non-coherent host memory, this is
    // where vkFlushMappedMemoryRanges over the dirty ranges would go.
}

}  // namespace gseurat
