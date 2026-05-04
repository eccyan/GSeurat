// src/engine/sim_clock.cpp
#include "gseurat/engine/sim_clock.hpp"

#include <chrono>

namespace gs {

namespace {
bool g_deterministic = false;
double g_sim_seconds = 0.0;
std::chrono::steady_clock::time_point g_wall_origin{};
}  // namespace

void SimClock::init(bool deterministic) noexcept {
  g_deterministic = deterministic;
  g_sim_seconds = 0.0;
  g_wall_origin = std::chrono::steady_clock::now();
}

void SimClock::tick() noexcept {
  if (g_deterministic) {
    g_sim_seconds += fixed_dt();
  }
}

double SimClock::now_seconds() noexcept {
  if (g_deterministic) {
    return g_sim_seconds;
  }
  using D = std::chrono::duration<double>;
  return std::chrono::duration_cast<D>(
             std::chrono::steady_clock::now() - g_wall_origin).count();
}

std::uint64_t SimClock::now_ms() noexcept {
  return static_cast<std::uint64_t>(now_seconds() * 1000.0);
}

bool SimClock::is_deterministic() noexcept { return g_deterministic; }

}  // namespace gs
