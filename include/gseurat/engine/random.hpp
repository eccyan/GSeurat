// include/gseurat/engine/random.hpp
#pragma once

#include <cstdint>

namespace gs::random {

// Seed once at startup. Determinism mode uses a fixed seed (0xC0FFEE);
// normal mode uses std::random_device.
void seed(std::uint64_t seed) noexcept;
void seed_from_device() noexcept;

// Uniform float in [0, 1).
float next_float() noexcept;

// Uniform int in [lo, hi].
int next_int(int lo, int hi) noexcept;

// Uniform uint in [0, 2^32).
std::uint32_t next_u32() noexcept;

}  // namespace gs::random
