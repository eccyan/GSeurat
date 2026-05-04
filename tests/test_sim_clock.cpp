// tests/test_sim_clock.cpp
#include "gseurat/engine/sim_clock.hpp"
#include <cassert>
#include <cmath>
#include <cstdio>

int main() {
  // Deterministic mode: tick advances by exactly fixed_dt
  gs::SimClock::init(true);
  assert(gs::SimClock::is_deterministic());
  assert(gs::SimClock::now_seconds() == 0.0);

  gs::SimClock::tick();
  // 1/60 = 0.01666..., compare with epsilon
  const double dt = gs::SimClock::fixed_dt();
  const double t1 = gs::SimClock::now_seconds();
  assert(std::fabs(t1 - dt) < 1e-9);

  for (int i = 0; i < 59; ++i) gs::SimClock::tick();
  const double t60 = gs::SimClock::now_seconds();
  assert(std::fabs(t60 - 1.0) < 1e-6);  // 60 ticks = 1.0s

  // Non-deterministic mode: tick is a no-op; now_seconds returns wall-clock
  gs::SimClock::init(false);
  assert(!gs::SimClock::is_deterministic());
  const double w0 = gs::SimClock::now_seconds();
  gs::SimClock::tick();
  const double w1 = gs::SimClock::now_seconds();
  assert(w1 >= w0);  // wall-clock monotonic
  // Don't assert on tick being no-op precisely — wall-clock advances regardless.

  std::printf("test_sim_clock: OK\n");
  return 0;
}
