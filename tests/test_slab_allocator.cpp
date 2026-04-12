#include "gseurat/engine/slab_allocator.hpp"
#include <cassert>
#include <cstdio>
#include <set>

using namespace gseurat;

static int passed = 0;
static int failed = 0;

static void check(bool cond, const char* msg) {
    if (cond) { std::printf("  PASS: %s\n", msg); passed++; }
    else      { std::printf("  FAIL: %s\n", msg); failed++; }
}

int main() {
    std::printf("=== SlabAllocator Tests ===\n\n");

    // Test 1: Construction
    {
        std::printf("Test 1: Construction\n");
        SlabAllocator alloc(10, 100000);
        check(alloc.total_slabs() == 10, "total_slabs == 10");
        check(alloc.splats_per_slab() == 100000, "splats_per_slab == 100000");
        check(alloc.available() == 10, "all 10 slabs available");
    }

    // Test 2: Checkout reduces available count
    {
        std::printf("Test 2: Checkout reduces available\n");
        SlabAllocator alloc(10, 100000);
        auto h = alloc.checkout(3);
        check(h.slab_indices.size() == 3, "got 3 slab indices");
        check(alloc.available() == 7, "7 slabs remaining");
    }

    // Test 3: Slab indices are unique
    {
        std::printf("Test 3: Unique slab indices\n");
        SlabAllocator alloc(10, 100000);
        auto h1 = alloc.checkout(3);
        auto h2 = alloc.checkout(4);
        std::set<uint32_t> all;
        for (auto i : h1.slab_indices) all.insert(i);
        for (auto i : h2.slab_indices) all.insert(i);
        check(all.size() == 7, "all 7 indices unique across two checkouts");
    }

    // Test 4: Chunk IDs are sequential
    {
        std::printf("Test 4: Sequential chunk IDs\n");
        SlabAllocator alloc(10, 100000);
        auto h1 = alloc.checkout(1);
        auto h2 = alloc.checkout(1);
        auto h3 = alloc.checkout(1);
        check(h1.chunk_id == 0, "first chunk_id == 0");
        check(h2.chunk_id == 1, "second chunk_id == 1");
        check(h3.chunk_id == 2, "third chunk_id == 2");
    }

    // Test 5: Release returns slabs to pool
    {
        std::printf("Test 5: Release returns slabs\n");
        SlabAllocator alloc(10, 100000);
        auto h = alloc.checkout(5);
        check(alloc.available() == 5, "5 remaining after checkout");
        alloc.release(h);
        check(alloc.available() == 10, "10 available after release");
    }

    // Test 6: Released slabs can be reused
    {
        std::printf("Test 6: Released slabs reused\n");
        SlabAllocator alloc(4, 100000);
        auto h1 = alloc.checkout(4);
        alloc.release(h1);
        auto h2 = alloc.checkout(4);
        check(h2.slab_indices.size() == 4, "can checkout 4 after releasing 4");
        check(alloc.available() == 0, "0 remaining");
    }

    // Test 7: Checkout more than available throws
    {
        std::printf("Test 7: Over-checkout throws\n");
        SlabAllocator alloc(3, 100000);
        alloc.checkout(2);
        bool threw = false;
        try { alloc.checkout(5); }
        catch (const std::runtime_error&) { threw = true; }
        check(threw, "throws runtime_error when requesting 5 with 1 available");
    }

    // Test 8: Checkout zero slabs
    {
        std::printf("Test 8: Checkout zero\n");
        SlabAllocator alloc(5, 100000);
        auto h = alloc.checkout(0);
        check(h.slab_indices.empty(), "empty handle for 0 checkout");
        check(alloc.available() == 5, "no slabs consumed");
    }

    // Test 9: Non-contiguous reuse after fragmentation
    {
        std::printf("Test 9: Non-contiguous reuse (fragmentation-proof)\n");
        SlabAllocator alloc(10, 100000);
        auto a = alloc.checkout(3);
        auto b = alloc.checkout(2);
        auto c = alloc.checkout(3);
        alloc.release(b);
        check(alloc.available() == 4, "4 available (2 freed + 2 never used)");
        auto d = alloc.checkout(3);
        check(d.slab_indices.size() == 3, "got 3 scattered slabs after fragmentation");
        check(alloc.available() == 1, "1 remaining");
        alloc.release(a);
        alloc.release(c);
        alloc.release(d);
        check(alloc.available() == 10, "all 10 returned");
    }

    // Test 10: Slab indices are within bounds
    {
        std::printf("Test 10: Indices within bounds\n");
        SlabAllocator alloc(100, 50000);
        auto h = alloc.checkout(100);
        bool in_bounds = true;
        for (auto i : h.slab_indices) {
            if (i >= 100) { in_bounds = false; break; }
        }
        check(in_bounds, "all indices < total_slabs");
    }

    std::printf("\n=== Results: %d passed, %d failed ===\n", passed, failed);
    return failed > 0 ? 1 : 0;
}
