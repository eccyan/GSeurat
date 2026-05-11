#include "gseurat/engine/systems/vfx_system.hpp"

#include "gseurat/engine/gs_vfx.hpp"
#include "gseurat/engine/renderer.hpp"

#include <utility>

namespace gseurat::systems {

void VfxSystem::run(ecs::World& world, float /*dt*/) {
    if (renderer_ == nullptr) {
        // Still advance the cursor so a future production-mode wire-up
        // doesn't re-process buffered events. Tests use drain_events()
        // directly and don't go through run().
        (void)drain_events(world);
        return;
    }
    for (const auto& evt : drain_events(world)) {
        auto preset = load_vfx_preset(evt.vfx_file);
        if (preset.elements.empty()) continue;
        VfxInstance inst;
        inst.init(preset, evt.position, evt.loop, evt.rotation_y);
        renderer_->add_vfx_instance(std::move(inst));
    }
}

}  // namespace gseurat::systems
