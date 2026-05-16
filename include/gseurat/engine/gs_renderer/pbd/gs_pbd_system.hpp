#pragma once

#include "gseurat/engine/pbd_types.hpp"
#include "gseurat/engine/types.hpp"  // kMaxFramesInFlight

#include <vk_mem_alloc.h>
#include <vulkan/vulkan.h>

#include <cstdint>

namespace gseurat {

struct GsResourceManager;

// Phase 5e: PBD (Position Based Dynamics) solver extraction. Owns:
//  - pbd_set_layout_, pbd_pipeline_layout_, pbd_pipeline_ (compute)
//  - one shared pbd_set_ (single instance — solver descriptor set is not
//    per-frame; the underlying buffers are stable across frames)
//  - element/state counts (pbd_count_, pbd_constraint_count_)
//  - dispatch body (UBO upload, pipeline+set bind, push constants,
//    vkCmdDispatch, PBD→preprocess pipeline barrier)
//
// Storage buffers (resources_->pbd_state_ssbo, pbd_params_ssbo,
// pbd_constraint_ssbo, pbd_uniform_buffer) remain owned by
// GsResourceManager — this system holds only the pipeline-side state.
//
// Lifetime: by-value member of GsRenderer. init() runs at GsRenderer::init
// time after the shared gs_pool_ exists.
class GsPbdSystem {
public:
    GsPbdSystem() = default;
    ~GsPbdSystem();

    GsPbdSystem(const GsPbdSystem&)            = delete;
    GsPbdSystem& operator=(const GsPbdSystem&) = delete;
    GsPbdSystem(GsPbdSystem&&)                 = delete;
    GsPbdSystem& operator=(GsPbdSystem&&)      = delete;

    // Create set layout, pipeline layout, pipeline, and allocate one
    // descriptor set from `pool`. `allocator` is reserved for API symmetry
    // with other 5e systems (PBD constraint SSBO is pre-allocated by
    // GsRenderer::init_streaming; no runtime resize occurs here).
    void init(VkDevice device, VmaAllocator allocator,
              VkPipelineCache pipeline_cache, VkDescriptorPool pool,
              GsResourceManager* resources);

    // (Re)write the single descriptor set against the current
    // resources_->pbd_state_ssbo / pbd_params_ssbo / pbd_constraint_ssbo /
    // pbd_uniform_buffer. Called from GsRenderer::update_descriptors after
    // buffer (re)creation.
    void write_descriptors();

    // Element-state uploads. Copies `count` entries into the mapped
    // pbd_state_ssbo and pbd_params_ssbo (resources owned by
    // GsResourceManager). Sets pbd_count_ = count.
    void upload_elements(const PbdPhysicsState* states,
                         const PbdElementParams* params,
                         uint32_t count);

    // Constraint upload. Copies constraints into resources_->pbd_constraint_ssbo
    // (pre-allocated at kMaxPbdConstraints capacity). Sets
    // pbd_constraint_count_ = count.
    void upload_constraints(const PbdConstraint* constraints, uint32_t count);

    // Reset counts to zero. Does NOT destroy the buffers; they remain
    // allocated for the next frame's reuse.
    void clear();

    // Per-frame dispatch. Early-exits if `count() == 0` or
    // `determinism_test_active`. On dispatch, emits the PBD UBO upload,
    // pipeline+set bind, push constants (pbd_count_), the workgroup
    // dispatch, and the PBD-write → preprocess-read pipeline barrier as
    // the final operation (so the next system's read of pbd_state_ssbo
    // sees finished writes).
    void dispatch(VkCommandBuffer cmd, uint32_t frame_in_flight,
                  float time, bool determinism_test_active) noexcept;

    // Read-only state accessors (forwarded by GsRenderer for ABI stability)
    uint32_t count()             const { return pbd_count_; }
    uint32_t constraint_count()  const { return pbd_constraint_count_; }

    // Prewarm: 1 pipeline (pbd_solver.comp).
    struct PrewarmEntry {
        VkPipeline             pipeline;
        VkPipelineLayout       pipeline_layout;
        VkDescriptorSetLayout  set_layout;
    };
    PrewarmEntry prewarm_entry() const {
        return {pbd_pipeline_, pbd_pipeline_layout_, pbd_set_layout_};
    }

    // Tear down. Idempotent against null handles.
    void shutdown();

private:
    VkDevice           device_     = VK_NULL_HANDLE;
    VmaAllocator       allocator_  = VK_NULL_HANDLE;
    GsResourceManager* resources_  = nullptr;

    VkDescriptorSetLayout pbd_set_layout_         = VK_NULL_HANDLE;
    VkPipelineLayout      pbd_pipeline_layout_    = VK_NULL_HANDLE;
    VkPipeline            pbd_pipeline_           = VK_NULL_HANDLE;
    VkDescriptorSet       pbd_set_                = VK_NULL_HANDLE;

    uint32_t pbd_count_            = 0;
    uint32_t pbd_constraint_count_ = 0;
};

}  // namespace gseurat
