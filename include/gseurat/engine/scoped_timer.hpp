#pragma once
// ── ScopedTimer ──
// RAII timer that emits a loud `[StallWarn]` log line when the elapsed time
// exceeds a threshold. Intended for hunting main-thread blocks (sync I/O,
// PLY parsing, vkDeviceWaitIdle, etc.) that show up to the user as an OS
// beachball / movement freeze.
//
// Zero cost when the threshold isn't tripped: just two `chrono::now()` calls
// and a subtraction. Enabled at all times — the threshold (default 50ms) is
// the gate, not a compile flag.

#include <chrono>
#include <cstdio>
#include <string_view>

namespace gseurat {

class ScopedStallTimer {
public:
    // Human-facing: uses wall-clock (not gs::SimClock) so stall warnings
    // reflect real elapsed time, even when sim time is frozen for harness runs.
    explicit ScopedStallTimer(std::string_view label,
                              double warn_threshold_ms = 50.0) noexcept
        : label_(label),
          warn_threshold_ms_(warn_threshold_ms),
          start_(std::chrono::steady_clock::now()) {}

    ScopedStallTimer(const ScopedStallTimer&) = delete;
    ScopedStallTimer& operator=(const ScopedStallTimer&) = delete;
    ScopedStallTimer(ScopedStallTimer&&) = delete;
    ScopedStallTimer& operator=(ScopedStallTimer&&) = delete;

    ~ScopedStallTimer() {
        const auto end = std::chrono::steady_clock::now();
        const auto ms  = std::chrono::duration<double, std::milli>(end - start_).count();
        if (ms >= warn_threshold_ms_) {
            std::fprintf(stderr,
                "[StallWarn] %.*s blocked main thread for %.1fms (threshold=%.0fms)\n",
                static_cast<int>(label_.size()), label_.data(),
                ms, warn_threshold_ms_);
        }
    }

private:
    std::string_view label_;
    double warn_threshold_ms_;
    std::chrono::steady_clock::time_point start_;
};

}  // namespace gseurat
