#include "gseurat/engine/sort_entry.hpp"
#include "gseurat/engine/sort_hash.hpp"

#include <array>
#include <cassert>
#include <cstdint>
#include <cstdio>
#include <span>
#include <vector>

using namespace gseurat;

namespace {

// FNV-1a 64-bit reference vectors. The golden values come from a clean-room
// reference implementation and have been cross-checked against
// http://www.isthe.com/chongo/tech/comp/fnv/ FNV test vectors.
constexpr std::uint64_t kFnvOffset = 0xcbf29ce484222325ull;

void test_empty_input() {
    constexpr std::uint64_t h = fnv1a_64(nullptr, 0);
    static_assert(h == kFnvOffset, "empty input must be the FNV offset basis");
    assert(h == kFnvOffset);
}

void test_single_byte_zero() {
    const std::uint8_t bytes[] = {0x00};
    // 0xcbf29ce484222325 ^ 0 = 0xcbf29ce484222325
    // 0xcbf29ce484222325 * 0x100000001b3 = 0xaf63bd4c8601b7df (mod 2^64)
    const std::uint64_t expected = 0xaf63bd4c8601b7dfull;
    assert(fnv1a_64(bytes, 1) == expected);
}

void test_known_vector_a() {
    // Hash of the byte 'a'
    const std::uint8_t bytes[] = {'a'};
    const std::uint64_t expected = 0xaf63dc4c8601ec8cull;
    assert(fnv1a_64(bytes, 1) == expected);
}

void test_known_vector_foobar() {
    const char* s = "foobar";
    const std::uint64_t expected = 0x85944171f73967e8ull;
    assert(fnv1a_64(reinterpret_cast<const std::uint8_t*>(s), 6) == expected);
}

void test_struct_layout() {
    static_assert(sizeof(SortEntry) == 8, "SortEntry must be 8 bytes");
    static_assert(alignof(SortEntry) == 8, "SortEntry must be 8-byte aligned");
}

void test_hash_sort_buffer_stability() {
    std::vector<SortEntry> entries;
    entries.reserve(4);
    entries.push_back(SortEntry{static_cast<SortKeyType>(0x12345678u), 0u
#if GSEURAT_USE_64BIT_SORT_KEYS
        , 0u
#endif
    });
    entries.push_back(SortEntry{static_cast<SortKeyType>(0x9abcdef0u), 1u
#if GSEURAT_USE_64BIT_SORT_KEYS
        , 0u
#endif
    });
    entries.push_back(SortEntry{static_cast<SortKeyType>(0xdeadbeefu), 2u
#if GSEURAT_USE_64BIT_SORT_KEYS
        , 0u
#endif
    });
    entries.push_back(SortEntry{static_cast<SortKeyType>(0xfeedfaceu), 3u
#if GSEURAT_USE_64BIT_SORT_KEYS
        , 0u
#endif
    });

    const std::uint64_t h1 = hash_sort_buffer(entries);
    const std::uint64_t h2 = hash_sort_buffer(entries);
    assert(h1 == h2);

    // Permuting two entries must change the hash (FNV-1a is order-sensitive).
    auto permuted = entries;
    std::swap(permuted[0], permuted[1]);
    const std::uint64_t h3 = hash_sort_buffer(permuted);
    assert(h1 != h3);

    // Empty span hashes to the offset basis.
    std::vector<SortEntry> empty;
    assert(hash_sort_buffer(empty) == kFnvOffset);
}

}  // namespace

int main() {
    test_struct_layout();
    test_empty_input();
    test_single_byte_zero();
    test_known_vector_a();
    test_known_vector_foobar();
    test_hash_sort_buffer_stability();
    std::printf("test_sort_hash: all checks passed\n");
    return 0;
}
