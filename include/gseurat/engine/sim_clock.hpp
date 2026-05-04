// include/gseurat/engine/sim_clock.hpp
#pragma once

#include <cstdint>

namespace gs {

class SimClock {
 public:
  // Initialize. If deterministic=true, time advances strictly via tick(dt);
  // wall-clock methods return simulated time. If false, all methods return
  // wall-clock time and tick() is a no-op.
  static void init(bool deterministic) noexcept;

  // Advance simulated time by exactly fixed_dt seconds.
  // No-op in non-deterministic mode.
  static void tick() noexcept;

  // Current time in seconds since init.
  static double now_seconds() noexcept;

  // Current time in milliseconds (integer truncation).
  static std::uint64_t now_ms() noexcept;

  // Fixed delta-time per tick (deterministic mode only).
  // Always returns 1.0/60.0 regardless of mode (callers should use this
  // instead of measuring real elapsed time).
  static constexpr double fixed_dt() noexcept { return 1.0 / 60.0; }

  static bool is_deterministic() noexcept;
};

}  // namespace gs
