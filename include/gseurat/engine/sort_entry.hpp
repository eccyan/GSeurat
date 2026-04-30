#pragma once

#include <cstdint>

#ifndef GSEURAT_USE_64BIT_SORT_KEYS
#define GSEURAT_USE_64BIT_SORT_KEYS 0
#endif

namespace gseurat {

#if GSEURAT_USE_64BIT_SORT_KEYS
using SortKeyType = std::uint64_t;

struct alignas(8) SortEntry {
    SortKeyType key;
    std::uint32_t index;
    std::uint32_t _pad;
};
#else
using SortKeyType = std::uint32_t;

struct alignas(8) SortEntry {
    SortKeyType key;
    std::uint32_t index;
};
#endif

static_assert(sizeof(SortEntry) == 8, "SortEntry must be exactly 8 bytes to match GLSL layout");
static_assert(alignof(SortEntry) == 8, "SortEntry must be 8-byte aligned");

}  // namespace gseurat
