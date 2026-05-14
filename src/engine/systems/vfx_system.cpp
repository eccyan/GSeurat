#include "gseurat/engine/systems/vfx_system.hpp"

#include "gseurat/engine/gaussian_cloud.hpp"   // encode_gaussian
#include "gseurat/engine/gs_vfx.hpp"
#include "gseurat/engine/renderer.hpp"

#include <cstdio>
#include <exception>
#include <utility>

namespace gseurat::systems {

void VfxSystem::run(ecs::World& world, float /*dt*/) {
    for (const auto& evt : drain_events(world)) {
        // load_vfx_preset can throw on malformed JSON. Catch + log so a
        // malformed live update doesn't kill the main loop (Codex P2 on
        // PR #431 — preserved through ownership migration).
        try {
            auto preset = load_vfx_preset(evt.vfx_file);
            if (preset.elements.empty()) continue;
            VfxInstance inst;
            inst.init(preset, evt.position, evt.loop, evt.rotation_y, &object_cache_);
            vfx_instances_.push_back(std::move(inst));
        } catch (const std::exception& e) {
            std::fprintf(stderr,
                "[VfxSystem] failed to spawn '%s': %s\n",
                evt.vfx_file.c_str(), e.what());
        }
    }
}

void VfxSystem::prefetch_preset_objects(const std::string& vfx_file) {
    try {
        auto preset = load_vfx_preset(vfx_file);
        for (const auto& el : preset.elements) {
            if (el.type == "object" && !el.ply_file.empty()) {
                object_cache_.preload(el.ply_file);
            }
        }
    } catch (const std::exception& e) {
        std::fprintf(stderr,
            "[VfxSystem] prefetch_preset_objects '%s' skipped: %s\n",
            vfx_file.c_str(), e.what());
    }
}

void VfxSystem::clear_instances() {
    vfx_instances_.clear();
    gs_animator_.reset();
    scratch_.clear();
    // Drop the cache too — a new scene may reference different PLYs and
    // we want stale entries garbage-collected. Scene-init prefetch
    // repopulates whatever the next scene needs.
    object_cache_.clear();
}

void VfxSystem::collect_active_lights(std::vector<PointLight>& out, std::size_t cap) const {
    for (const auto& inst : vfx_instances_) {
        for (const auto& vl : inst.active_lights()) {
            if (out.size() >= cap) return;
            out.push_back(vl);
        }
    }
}

uint32_t VfxSystem::update_per_frame(float dt, FrameIndex frame_idx,
                                      const glm::vec3& cull_origin,
                                      float cull_dist_sq,
                                      bool update_animation,
                                      bool update_particles) {
    if (render_state_ == nullptr) return 0;
    if (vfx_instances_.empty()) return 0;

    // Rebuild scratch this frame. Reuse vector's storage to keep
    // allocations stable across frames.
    scratch_.clear();

    // (1) Object splats — append from every (non-distance-culled) instance.
    //     Indices [0, vfx_obj_count) cover objects; emitter particles follow.
    for (auto& inst : vfx_instances_) {
        if (cull_dist_sq > 0.0f) {
            glm::vec3 d = inst.position() - cull_origin;
            if (glm::dot(d, d) > cull_dist_sq) continue;
        }
        inst.append_objects(scratch_);
    }

    // (2) Re-tag animations: animator state derives from the current
    //     scratch contents, so reset before tagging.
    gs_animator_.reset();
    for (auto& inst : vfx_instances_) inst.reset_animations();
    for (auto& inst : vfx_instances_) {
        inst.tag_animations(scratch_, gs_animator_);
    }
    if (update_animation && gs_animator_.has_active_groups()) {
        gs_animator_.update(dt, scratch_);
    }

    // (3) Per-frame timeline / emitter ticks — append active particles.
    if (update_particles || update_animation) {
        for (auto& inst : vfx_instances_) {
            if (cull_dist_sq > 0.0f) {
                glm::vec3 d = inst.position() - cull_origin;
                if (glm::dot(d, d) > cull_dist_sq) continue;
            }
            inst.update(dt, scratch_, gs_animator_);
        }
        std::erase_if(vfx_instances_,
            [](const VfxInstance& i) { return i.is_finished(); });
    }

    // (4) Pack the CPU scratch into RenderState's per-frame vfx_buffer.
    //     vfx_writer is byte-strided (RenderStateConfig::splat_stride = 64,
    //     matching sizeof(GpuGaussian)).
    auto writer = render_state_->vfx_writer(frame_idx);
    const uint32_t cap = writer.capacity();
    const uint32_t count = static_cast<uint32_t>(scratch_.size());
    const uint32_t live = (count > cap) ? cap : count;
    for (uint32_t i = 0; i < live; ++i) {
        GpuGaussian packed{};
        encode_gaussian(scratch_[i], packed);
        writer.write_at(i, &packed, sizeof(GpuGaussian));
    }
    return live;
}

}  // namespace gseurat::systems
