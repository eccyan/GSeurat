#pragma once

#include "gseurat/engine/transfer_queue.hpp"

#include <cstdint>
#include <functional>
#include <vector>

namespace gseurat {

// Engine-level lifecycle state, orthogonal to gameplay states (Title, InGame…).
// Drives whether engine subsystems are running, paused, or warming up — not
// what the player is interacting with.
enum class EngineState : std::uint8_t {
    Loading,   // assets streaming — gameplay paused, GS compute paused, UI overlay drawn
    Warming,   // assets uploaded, dispatching GPU pipelines to flush driver state, gameplay still paused
    Playing,   // normal frame — everything active
};

// Monitors a batch of in-flight transfer handles, transitioning the engine
// through Loading → Warming → Playing as they complete and a configurable
// number of warm-up frames elapse.
//
// The monitor is decoupled from `TransferQueue`: callers supply a
// `StatusProvider` callback when ticking, so any async-load primitive that
// can answer "is this handle done?" works (transfer queues, texture
// uploaders, audio streamers, etc.).
//
// Default state is `Playing` — apps that never call `begin_load(...)` see no
// behavioural change, preserving backward compatibility with the existing
// `gseurat_demo`, headless tests, and CI flows.
class EngineLoadingMonitor {
public:
    using StatusProvider = std::function<TransferQueue::Status(TransferQueue::Handle)>;

    static constexpr std::uint32_t kDefaultWarmupFrames = 4;
    static constexpr std::uint32_t kMaxWarmupFrames     = 16;

    EngineLoadingMonitor() = default;

    // Configure how many warm-up frames run between the last handle reaching
    // Complete and the transition to Playing. Clamped to [1, kMaxWarmupFrames].
    void set_warmup_frames(std::uint32_t n) noexcept;
    std::uint32_t warmup_frames() const noexcept { return warmup_frames_total_; }

    // Enforce a minimum wall-clock duration in the Loading state, even if all
    // tracked handles resolve immediately (or the handle list is empty).
    // Useful for retro-style loading screens where the underlying load is
    // sub-frame but the UI should breathe — fast loads otherwise produce a
    // single-frame flicker. 0.0f (default) keeps the original behaviour.
    void set_min_loading_duration(float seconds) noexcept;
    float min_loading_duration() const noexcept { return min_loading_seconds_; }

    // Begin a Loading phase tracking the given handles. State flips to
    // Loading immediately. Subsequent `tick()` calls drive the transition:
    //   - all handles Complete AND min duration elapsed → Warming
    //   - empty handle list AND min duration elapsed    → Warming on tick
    void begin_load(std::vector<TransferQueue::Handle> handles);

    // Per-frame: poll handle statuses, advance Loading→Warming→Playing,
    // and accumulate the Loading-state timer for `set_min_loading_duration`.
    // `provider` may be nullptr-equivalent (an empty `std::function`) — that
    // is treated as "no progress this tick" so the early boot path before
    // the transfer queue exists is harmless. `dt` is seconds since last
    // tick; only used while in Loading to enforce the min display duration.
    void tick(const StatusProvider& provider, float dt = 0.0f);

    EngineState   state()                    const noexcept { return state_; }
    std::uint32_t pending_handles()          const noexcept { return static_cast<std::uint32_t>(tracked_.size()); }
    std::uint32_t warmup_frames_remaining()  const noexcept { return warmup_remaining_; }
    float         loading_elapsed()          const noexcept { return loading_elapsed_; }

    // Frame-policy helpers — what callers (AppBase, Renderer) actually use.
    bool should_run_gameplay()       const noexcept { return state_ == EngineState::Playing; }
    bool should_dispatch_gpu_work()  const noexcept { return state_ != EngineState::Loading; }
    bool should_overlay_loading_ui() const noexcept { return state_ != EngineState::Playing; }

private:
    // Walk `tracked_` once, removing handles that have reached Complete.
    // Returns true when no handles remain pending.
    bool reap_completed(const StatusProvider& provider);

    EngineState                          state_ = EngineState::Playing;
    std::vector<TransferQueue::Handle>   tracked_;
    std::uint32_t                        warmup_frames_total_ = kDefaultWarmupFrames;
    std::uint32_t                        warmup_remaining_    = 0;
    float                                min_loading_seconds_ = 0.0f;
    float                                loading_elapsed_     = 0.0f;
};

}  // namespace gseurat
