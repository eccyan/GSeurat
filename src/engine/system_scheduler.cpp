#include "gseurat/engine/system_scheduler.hpp"

namespace gseurat {

void SystemScheduler::add_system(SystemDecl decl) {
    systems_.push_back(std::move(decl));
}

void SystemScheduler::run_all(ecs::World& world, float dt) {
    for (auto& sys : systems_) {
        sys.fn(world, dt);
    }
}

}  // namespace gseurat
