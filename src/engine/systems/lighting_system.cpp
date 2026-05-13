#include "gseurat/engine/systems/lighting_system.hpp"

#include "gseurat/engine/gs_renderer.hpp"
#include "gseurat/engine/renderer.hpp"
#include "gseurat/engine/systems/vfx_system.hpp"

namespace gseurat::systems {

void LightingSystem::run(ecs::World& world, float /*dt*/) {
    auto& queue = world.events<PointLightsLoadedEvent>();
    queue.read(load_cursor_).for_each([this](const PointLightsLoadedEvent& evt) {
        static_lights_ = evt.lights;
        if (evt.lights.empty() && renderer_) {
            // Mirror command_dispatcher's update_scene_data path: when
            // a scene declares no lights, the prior implementation
            // explicitly turned off light_mode rather than leaving
            // stale lights bound.
            renderer_->gs_renderer().set_light_mode(0);
        }
    });
}

void LightingSystem::update_per_frame() {
    if (renderer_ == nullptr) return;
    auto all = static_lights_;
    if (vfx_system_ != nullptr) {
        vfx_system_->collect_active_lights(all, 8);
    }
    if (all.empty()) {
        // Preserve historical behavior: when the merge yields no
        // lights this frame, don't touch the renderer's GPU light
        // state. The mode-reset case is handled in run() on event.
        return;
    }
    auto& gs = renderer_->gs_renderer();
    if (gs.light_mode() < 2) {
        gs.set_light_mode(2);
    }
    gs.set_point_lights(all);
}

}  // namespace gseurat::systems
