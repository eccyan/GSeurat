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
            // Anything other than Pending/InFlight is "resolved" from the
            // monitor's perspective:
            //   - Complete → as advertised
            //   - Failed   → caller handles the error path; we don't stall
            //   - Unknown  → either the queue aged this handle out of its
            //                ~64-entry recent_status_ window, or the handle
            //                was never tracked. In both cases waiting on
            //                it forever would be wrong (would deadlock the
            //                Loading state machine for large batches).
            const auto s = provider(h);
            return s != TransferQueue::Status::Pending
                && s != TransferQueue::Status::InFlight;
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
