// src/engine/random.cpp
#include "gseurat/engine/random.hpp"

#include <chrono>
#include <cstdio>
#include <random>

namespace gs::random {

namespace {
std::mt19937_64 g_rng{0xC0FFEE};
}  // namespace

void seed(std::uint64_t s) noexcept { g_rng.seed(s); }

void seed_from_device() noexcept {
  // std::random_device construction can throw on platforms where no entropy
  // source is available (rare — e.g. MSVC if BCryptGenRandom fails). Catch
  // and fall back to a time-based seed rather than calling std::terminate.
  try {
    std::random_device rd;
    g_rng.seed(static_cast<std::uint64_t>(rd()) ^
               (static_cast<std::uint64_t>(rd()) << 32));
  } catch (...) {
    auto t = std::chrono::steady_clock::now().time_since_epoch().count();
    g_rng.seed(static_cast<std::uint64_t>(t));
    std::fprintf(stderr,
                 "[gs::random] WARNING: random_device unavailable; "
                 "falling back to time-based seed\n");
  }
}

float next_float() noexcept {
  std::uniform_real_distribution<float> dist(0.0f, 1.0f);
  return dist(g_rng);
}

int next_int(int lo, int hi) noexcept {
  std::uniform_int_distribution<int> dist(lo, hi);
  return dist(g_rng);
}

std::uint32_t next_u32() noexcept {
  return static_cast<std::uint32_t>(g_rng());
}

}  // namespace gs::random
