#pragma once

// Phase 3b: RenderState contract.
//
// `RenderState` is the typed, persistent-mapped, per-frame-in-flight data
// contract between ECS systems (which produce data via small typed Writer
// APIs) and `GsRenderer::render()` (which consumes raw VkBuffer handles).
//
// Scope of this PR: infrastructure only — owned by AppBase, but no caller
// migrates yet. begin_frame/end_frame exist for future use and are not
// invoked from main_loop in this PR. Phase 4 PRs that wire actual
// producers will hook them up.
//
// Design reference: docs/superpowers/specs/2026-05-02-engine-refactor-phase1-design.md §5.2

#include "gseurat/engine/buffer.hpp"
#include "gseurat/engine/types.hpp"

#include <glm/glm.hpp>

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>
#include <span>

namespace gseurat {

class VkContext;

// Strongly-typed frame index. Constructed from a raw uint32_t and
// implicitly convertible to uint32_t for indexing/comparison.
enum class FrameIndex : uint32_t {};

constexpr uint32_t to_u32(FrameIndex f) noexcept {
    return static_cast<uint32_t>(f);
}

// Inclusive [first, last] tracking — empty when first > last. Touch
// individual slots via mark(); end_frame() consumes and resets.
struct DirtyRange {
    std::size_t first = std::numeric_limits<std::size_t>::max();
    std::size_t last = 0;

    bool empty() const noexcept { return first > last; }

    void mark(std::size_t slot) noexcept {
        if (slot < first) first = slot;
        if (slot > last) last = slot;
    }

    void clear() noexcept {
        first = std::numeric_limits<std::size_t>::max();
        last = 0;
    }
};

// Typed slot-indexed writer. Non-owning view over mapped storage and a
// dirty range. Created on demand by RenderState's *_writer() methods.
template <typename T>
class TypedSlotWriter {
public:
    TypedSlotWriter() = default;
    TypedSlotWriter(T* mapped, uint32_t capacity, DirtyRange* dirty) noexcept
        : mapped_(mapped), capacity_(capacity), dirty_(dirty) {}

    // Out-of-range slots are silently ignored in Release. Phase 4 PRs that
    // migrate callers will add GS_DBG_INVARIANT here for stricter debug
    // diagnostics once concrete capacities are settled.
    void write(uint32_t slot, const T& value) noexcept {
        if (slot >= capacity_ || mapped_ == nullptr) return;
        mapped_[slot] = value;
        if (dirty_) dirty_->mark(slot);
    }

    uint32_t capacity() const noexcept { return capacity_; }
    bool valid() const noexcept { return mapped_ != nullptr; }

private:
    T* mapped_ = nullptr;
    uint32_t capacity_ = 0;
    DirtyRange* dirty_ = nullptr;
};

// Byte-granular writer for fixed-stride splat-style payloads whose
// concrete C++ type is still in flux (will be unified by Phase 4 once
// caller migration finalises the GSVX/Gaussian POD layout).
class BytesSlotWriter {
public:
    BytesSlotWriter() = default;
    BytesSlotWriter(std::byte* mapped, uint32_t capacity, std::size_t stride,
                    DirtyRange* dirty) noexcept
        : mapped_(mapped), capacity_(capacity), stride_(stride), dirty_(dirty) {}

    void write_bytes(uint32_t slot, std::span<const std::byte> payload) noexcept {
        if (slot >= capacity_ || mapped_ == nullptr) return;
        if (payload.size() != stride_) return;
        std::memcpy(mapped_ + static_cast<std::size_t>(slot) * stride_,
                    payload.data(), stride_);
        if (dirty_) dirty_->mark(slot);
    }

    // Convenience for callers holding a raw pointer + size pair.
    void write_at(uint32_t slot, const void* src, std::size_t bytes) noexcept {
        if (slot >= capacity_ || mapped_ == nullptr) return;
        if (bytes != stride_) return;
        std::memcpy(mapped_ + static_cast<std::size_t>(slot) * stride_, src, stride_);
        if (dirty_) dirty_->mark(slot);
    }

    uint32_t capacity() const noexcept { return capacity_; }
    std::size_t stride() const noexcept { return stride_; }
    bool valid() const noexcept { return mapped_ != nullptr; }

private:
    std::byte* mapped_ = nullptr;
    uint32_t capacity_ = 0;
    std::size_t stride_ = 0;
    DirtyRange* dirty_ = nullptr;
};

using BonesWriter = TypedSlotWriter<glm::mat4>;
using PointLightsWriter = TypedSlotWriter<PointLight>;
using VfxWriter = BytesSlotWriter;
using PbdWriter = BytesSlotWriter;
using ParticlesWriter = BytesSlotWriter;

// Defaults match the spec's working-set estimate (~12 MB for VFX splats,
// per frame in flight, doubled). Phase 4 may tune per-app needs.
struct RenderStateConfig {
    uint32_t max_bone_transforms = 1024;
    uint32_t max_vfx_splats = 200'000;
    uint32_t max_pbd_splats = 50'000;
    uint32_t max_particles = 8'192;
    uint32_t max_point_lights = kMaxLights;
    std::size_t splat_stride = 64;  // matches current Gaussian/GSVX layout
};

class RenderState {
public:
    explicit RenderState(VkContext& ctx, const RenderStateConfig& cfg = {});
    ~RenderState();

    RenderState(const RenderState&) = delete;
    RenderState& operator=(const RenderState&) = delete;
    RenderState(RenderState&&) = delete;
    RenderState& operator=(RenderState&&) = delete;

    // === Writers — called from ECS systems during update() ===
    BonesWriter bones_writer(FrameIndex) noexcept;
    VfxWriter vfx_writer(FrameIndex) noexcept;
    PbdWriter pbd_writer(FrameIndex) noexcept;
    ParticlesWriter particles_writer(FrameIndex) noexcept;
    PointLightsWriter point_lights_writer(FrameIndex) noexcept;

    // === Renderer-side read access — const, called from GsRenderer::render() ===
    VkBuffer bones_buffer(FrameIndex) const noexcept;
    VkBuffer vfx_buffer(FrameIndex) const noexcept;
    VkBuffer pbd_buffer(FrameIndex) const noexcept;
    VkBuffer particles_buffer(FrameIndex) const noexcept;
    VkBuffer point_lights_buffer(FrameIndex) const noexcept;

    // === Lifecycle ===
    // begin_frame: resets dirty ranges for the given frame slot.
    // end_frame:   on non-coherent memory, would issue
    //              vkFlushMappedMemoryRanges over the dirty regions. On
    //              Apple Silicon's unified memory it's a no-op.
    void begin_frame(FrameIndex) noexcept;
    void end_frame(FrameIndex) noexcept;

    const RenderStateConfig& config() const noexcept { return cfg_; }

private:
    struct PerFrame {
        Buffer bones;
        Buffer vfx;
        Buffer pbd;
        Buffer particles;
        Buffer point_lights;
        DirtyRange bones_dirty;
        DirtyRange vfx_dirty;
        DirtyRange pbd_dirty;
        DirtyRange particles_dirty;
        DirtyRange lights_dirty;
    };

    VkContext& ctx_;
    RenderStateConfig cfg_;
    std::array<PerFrame, kMaxFramesInFlight> per_frame_{};
};

}  // namespace gseurat
