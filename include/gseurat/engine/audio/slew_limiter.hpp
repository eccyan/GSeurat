#pragma once
// Per-frame linear slew-rate limiter. Audio-thread-safe: wait-free, noexcept, no alloc.

#include <cstdint>

namespace gseurat::audio {

class SlewLimiter {
    float    current_        = 1.0f;
    float    target_         = 1.0f;
    float    step_           = 0.0f;    // delta per frame; 0 = snapped to target
    uint64_t frames_left_    = 0;       // remaining frames in ramp; 0 = settled

public:
    // fade_frames == 0 means snap on the next tick().
    void set_target(float target, uint64_t fade_frames) noexcept {
        target_      = target;
        frames_left_ = fade_frames;
        step_        = (fade_frames == 0)
                         ? 0.0f
                         : (target - current_) / static_cast<float>(fade_frames);
    }

    // Advance one frame; returns the current value.
    float tick() noexcept {
        if (frames_left_ == 0) { current_ = target_; return current_; }
        --frames_left_;
        if (frames_left_ == 0) {
            // Last frame: snap exactly to avoid float accumulation drift.
            current_ = target_;
            step_    = 0.0f;
        } else {
            current_ += step_;
        }
        return current_;
    }

    float current() const noexcept { return current_; }
    bool  settled() const noexcept { return frames_left_ == 0; }

    // For engine init / tests only — snap immediately without a tick.
    void force(float v) noexcept { current_ = target_ = v; step_ = 0.0f; frames_left_ = 0; }
};

}  // namespace gseurat::audio
