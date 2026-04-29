#include "gseurat/engine/engine_state.hpp"

#include <algorithm>

namespace gseurat {

void EngineLoadingMonitor::set_warmup_frames(std::uint32_t n) noexcept {
    if (n == 0) n = 1;
    if (n > kMaxWarmupFrames) n = kMaxWarmupFrames;
    warmup_frames_total_ = n;
}

void EngineLoadingMonitor::begin_load(std::vector<TransferQueue::Handle> handles) {
    tracked_           = std::move(handles);
    warmup_remaining_  = 0;
    state_             = EngineState::Loading;
}

bool EngineLoadingMonitor::reap_completed(const StatusProvider& provider) {
    if (!provider) return tracked_.empty();   // no progress; only empty list is "done"

    auto it = std::remove_if(tracked_.begin(), tracked_.end(),
        [&](TransferQueue::Handle h) {
            // Complete → drop. Failed → also drop (caller decides what to do
            // with the side-effect; the loader monitor's job is "did the
            // handle resolve", not "did it succeed"). Pending/InFlight stay.
            const auto s = provider(h);
            return s == TransferQueue::Status::Complete
                || s == TransferQueue::Status::Failed;
        });
    tracked_.erase(it, tracked_.end());
    return tracked_.empty();
}

void EngineLoadingMonitor::tick(const StatusProvider& provider) {
    switch (state_) {
        case EngineState::Loading: {
            if (reap_completed(provider)) {
                // All handles resolved. Begin warm-up.
                state_            = EngineState::Warming;
                warmup_remaining_ = warmup_frames_total_;
            }
            return;
        }
        case EngineState::Warming: {
            if (warmup_remaining_ > 0) {
                --warmup_remaining_;
            }
            if (warmup_remaining_ == 0) {
                state_ = EngineState::Playing;
            }
            return;
        }
        case EngineState::Playing:
            // Steady state. Nothing to advance until begin_load() is called
            // again (e.g. on scene transition).
            return;
    }
}

}  // namespace gseurat
