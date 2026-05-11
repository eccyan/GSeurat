#include "gseurat/engine/systems/vfx_system.hpp"

#include "gseurat/engine/gs_vfx.hpp"
#include "gseurat/engine/renderer.hpp"

#include <cstdio>
#include <exception>
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
        // load_vfx_preset can throw on malformed JSON. Before Phase 4a
        // this load ran inside CommandDispatcher's try/catch and a bad
        // asset returned a command error; now it lives here, so we
        // catch and log to keep a malformed live update from killing
        // the main loop (per Codex P2 on PR #431).
        try {
            auto preset = load_vfx_preset(evt.vfx_file);
            if (preset.elements.empty()) continue;
            VfxInstance inst;
            inst.init(preset, evt.position, evt.loop, evt.rotation_y);
            renderer_->add_vfx_instance(std::move(inst));
        } catch (const std::exception& e) {
            std::fprintf(stderr,
                "[VfxSystem] failed to spawn '%s': %s\n",
                evt.vfx_file.c_str(), e.what());
        }
    }
}

}  // namespace gseurat::systems
