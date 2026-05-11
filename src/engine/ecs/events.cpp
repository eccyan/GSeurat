#include "gseurat/engine/ecs/events.hpp"

namespace gseurat::ecs {

EventQueueBase::~EventQueueBase() = default;

void EventRegistry::rotate_all() noexcept {
    for (auto& [type_idx, queue] : queues_) {
        queue->rotate();
    }
}

}  // namespace gseurat::ecs
