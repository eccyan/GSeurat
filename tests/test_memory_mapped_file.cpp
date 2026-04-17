#include "gseurat/platform/memory_mapped_file.hpp"
#include <cstdio>

using gseurat::platform::MemoryMappedFile;

static int passed = 0, failed = 0;
static void check(bool c, const char* m) {
    if (c) { std::printf("  PASS: %s\n", m); ++passed; }
    else   { std::printf("  FAIL: %s\n", m); ++failed; }
}

int main() {
    std::printf("\n=== MemoryMappedFile Tests ===\n\n");

    const char* path = "../../tests/test_data/audio/dc_unity.wav";

    // --- Default state ---
    { MemoryMappedFile f; check(!f.is_valid(), "default: not valid"); }

    // --- Open valid file ---
    {
        MemoryMappedFile f;
        check(f.open(path), "open returns true");
        check(f.is_valid(), "after open: valid");
        check(f.size() > 0, "size > 0");
        auto d = f.data();
        check(d[0]=='R' && d[1]=='I' && d[2]=='F' && d[3]=='F', "data starts with RIFF");
    }

    // --- Invalid path ---
    {
        MemoryMappedFile f;
        check(!f.open("nonexistent_file.xyz"), "invalid path returns false");
        check(!f.is_valid(), "invalid: not valid");
    }

    // --- Move constructor ---
    {
        MemoryMappedFile a;
        a.open(path);
        size_t sz = a.size();
        MemoryMappedFile b = std::move(a);
        check(!a.is_valid(), "moved-from: not valid");
        check(b.is_valid(), "moved-to: valid");
        check(b.size() == sz, "moved-to: same size");
    }

    // --- Move assignment ---
    {
        MemoryMappedFile a, b;
        a.open(path);
        size_t sz = a.size();
        b = std::move(a);
        check(!a.is_valid(), "move-assign from: not valid");
        check(b.is_valid(), "move-assign to: valid");
        check(b.size() == sz, "move-assign to: same size");
    }

    // --- Close + reopen ---
    {
        MemoryMappedFile f;
        f.open(path);
        f.close();
        check(!f.is_valid(), "after close: not valid");
        check(f.open(path), "reopen succeeds");
        check(f.is_valid(), "after reopen: valid");
    }

    std::printf("\n=== %d passed, %d failed ===\n", passed, failed);
    return failed == 0 ? 0 : 1;
}
