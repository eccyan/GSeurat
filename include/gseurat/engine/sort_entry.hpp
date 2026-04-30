#pragma once

#include <cstddef>
#include <cstdint>

#ifndef GSEURAT_USE_64BIT_SORT_KEYS
#define GSEURAT_USE_64BIT_SORT_KEYS 0
#endif

namespace gseurat {

#if GSEURAT_USE_64BIT_SORT_KEYS
using SortKeyType = std::uint64_t;

// 64-bit key + index + pad → 16 bytes. Padded to keep `index` at offset 8
// so the GLSL `struct SortEntry { uint64_t key; uint index; }` matches when
// the shaders are flipped to the same toggle. The trailing pad is required
// because GLSL `int64_t/uint64_t` forces 8-byte alignment of the next
// member's struct slot.
struct alignas(8) SortEntry {
    SortKeyType key;
    std::uint32_t index;
    std::uint32_t _pad;
};
inline constexpr std::size_t kSortEntrySize = 16;
#else
using SortKeyType = std::uint32_t;

struct alignas(8) SortEntry {
    SortKeyType key;
    std::uint32_t index;
};
inline constexpr std::size_t kSortEntrySize = 8;
#endif

// Codex P2: keep the assert correct under either toggle so flipping
// GSEURAT_USE_64BIT_SORT_KEYS=1 actually compiles. The 8-byte alignment
// holds in both cases (uint32 key forces 4-byte align, alignas(8) hoists
// it; uint64 key already requires 8).
static_assert(sizeof(SortEntry) == kSortEntrySize,
              "SortEntry size mismatch — check GSEURAT_USE_64BIT_SORT_KEYS toggle");
static_assert(alignof(SortEntry) == 8, "SortEntry must be 8-byte aligned");

}  // namespace gseurat
