#include "gseurat/engine/system_scheduler.hpp"

namespace gseurat {

void SystemScheduler::add_system(SystemDecl decl) {
    systems_.push_back(std::move(decl));
}

void SystemScheduler::run_all(ecs::World& world, float dt) {
    for (auto& sys : systems_) {
        sys.fn(world, dt);
    }
    // NOTE: event-queue rotation used to live here (Phase 3a). It moved
    // to AppBase::main_loop in Phase 4a so it runs even for states that
    // don't invoke the gameplay scheduler (Staging, GsDemo). Same goes
    // for VfxSystem — those are engine-level infrastructure that must
    // tick every frame, not gameplay systems.
}

}  // namespace gseurat
