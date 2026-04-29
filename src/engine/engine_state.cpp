#include "gseurat/engine/engine_state.hpp"

#include <algorithm>

namespace gseurat {

void EngineLoadingMonitor::set_warmup_frames(std::uint32_t n) noexcept {
    if (n == 0) n = 1;
    if (n > kMaxWarmupFrames) n = kMaxWarmupFrames;
    warmup_frames_total_ = n;
}

void EngineLoadingMonitor::set_min_loading_duration(float seconds) noexcept {
    min_loading_seconds_ = (seconds < 0.0f) ? 0.0f : seconds;
}

void EngineLoadingMonitor::begin_load(std::vector<TransferQueue::Handle> handles) {
    tracked_           = std::move(handles);
    warmup_remaining_  = 0;
    loading_elapsed_   = 0.0f;
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

void EngineLoadingMonitor::tick(const StatusProvider& provider, float dt) {
    switch (state_) {
        case EngineState::Loading: {
            loading_elapsed_ += (dt > 0.0f) ? dt : 0.0f;
            // Both gates must close before advancing: handles resolved AND
            // the minimum on-screen duration elapsed. The latter exists so
            // sub-frame loads still get a visible loading screen.
            const bool handles_done = reap_completed(provider);
            const bool duration_met = loading_elapsed_ >= min_loading_seconds_;
            if (handles_done && duration_met) {
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
