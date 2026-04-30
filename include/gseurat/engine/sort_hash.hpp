#pragma once

#include "gseurat/engine/sort_entry.hpp"

#include <cstddef>
#include <cstdint>
#include <span>

namespace gseurat {

// FNV-1a 64-bit hash. Debug-only — used by the frame-determinism harness to
// detect order-instability in the GS sort pipeline. Constexpr so callers can
// hash compile-time test fixtures.
constexpr std::uint64_t fnv1a_64(const std::uint8_t* bytes, std::size_t len) {
    std::uint64_t hash = 0xcbf29ce484222325ull;
    constexpr std::uint64_t prime = 0x100000001b3ull;
    for (std::size_t i = 0; i < len; ++i) {
        hash ^= static_cast<std::uint64_t>(bytes[i]);
        hash *= prime;
    }
    return hash;
}

constexpr std::uint64_t fnv1a_64(std::span<const std::uint8_t> bytes) {
    return fnv1a_64(bytes.data(), bytes.size());
}

inline std::uint64_t hash_sort_buffer(std::span<const SortEntry> entries) {
    return fnv1a_64(reinterpret_cast<const std::uint8_t*>(entries.data()),
                    entries.size() * sizeof(SortEntry));
}

}  // namespace gseurat
