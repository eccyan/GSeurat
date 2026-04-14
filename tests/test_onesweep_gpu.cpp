#include "gpu_test_context.hpp"
#include "onesweep_test_runner.hpp"

#include <algorithm>
#include <cassert>
#include <cstdio>
#include <cstdlib>
#include <numeric>
#include <random>
#include <vector>

using namespace gseurat;

static void test_basic_sort() {
    std::printf("test_basic_sort: ");

    GpuTestContext gpu;
    gpu.init();
    OnesweepTestRunner runner;
    runner.init(gpu);

    constexpr uint32_t N = 100000;
    std::mt19937 rng(42);
    std::vector<TileSortEntry> input(N);
    for (uint32_t i = 0; i < N; i++) {
        input[i].key = rng();
        input[i].index = i;
    }

    auto result = runner.sort(gpu, input);

    assert(result.size() == N);
    bool sorted = std::is_sorted(result.begin(), result.end(),
        [](const TileSortEntry& a, const TileSortEntry& b) { return a.key < b.key; });
    assert(sorted);

    runner.shutdown(gpu);
    gpu.shutdown();

    std::printf("PASS (%u entries sorted)\n", N);
}

static void test_stable_sort() {
    std::printf("test_stable_sort: ");

    GpuTestContext gpu;
    gpu.init();
    OnesweepTestRunner runner;
    runner.init(gpu);

    constexpr uint32_t N = 10000;
    std::mt19937 rng(123);
    std::vector<TileSortEntry> input(N);
    for (uint32_t i = 0; i < N; i++) {
        input[i].key = rng() % 100;
        input[i].index = i;
    }

    auto result = runner.sort(gpu, input);

    assert(result.size() == N);
    bool sorted = std::is_sorted(result.begin(), result.end(),
        [](const TileSortEntry& a, const TileSortEntry& b) { return a.key < b.key; });
    assert(sorted);

    for (uint32_t i = 1; i < N; i++) {
        if (result[i].key == result[i - 1].key) {
            assert(result[i].index > result[i - 1].index);
        }
    }

    runner.shutdown(gpu);
    gpu.shutdown();

    std::printf("PASS (%u entries, stable order verified)\n", N);
}

static void test_low_workgroup_count() {
    std::printf("test_low_workgroup_count: ");

    GpuTestContext gpu;
    gpu.init();
    OnesweepTestRunner runner;
    runner.init(gpu);

    constexpr uint32_t N = 50 * 2048;
    std::mt19937 rng(999);
    std::vector<TileSortEntry> input(N);
    for (uint32_t i = 0; i < N; i++) {
        input[i].key = rng();
        input[i].index = i;
    }

    auto result = runner.sort(gpu, input, N);

    assert(result.size() == N);
    bool sorted = std::is_sorted(result.begin(), result.end(),
        [](const TileSortEntry& a, const TileSortEntry& b) { return a.key < b.key; });
    assert(sorted);

    runner.shutdown(gpu);
    gpu.shutdown();

    std::printf("PASS (50 workgroups, %u entries)\n", N);
}

static void test_single_workgroup() {
    std::printf("test_single_workgroup: ");

    GpuTestContext gpu;
    gpu.init();
    OnesweepTestRunner runner;
    runner.init(gpu);

    constexpr uint32_t N = 2048;
    std::mt19937 rng(7);
    std::vector<TileSortEntry> input(N);
    for (uint32_t i = 0; i < N; i++) {
        input[i].key = rng();
        input[i].index = i;
    }

    auto result = runner.sort(gpu, input, N);

    assert(result.size() == N);
    bool sorted = std::is_sorted(result.begin(), result.end(),
        [](const TileSortEntry& a, const TileSortEntry& b) { return a.key < b.key; });
    assert(sorted);

    runner.shutdown(gpu);
    gpu.shutdown();

    std::printf("PASS (1 workgroup, %u entries)\n", N);
}

static void test_sentinel_fill() {
    std::printf("test_sentinel_fill: ");

    GpuTestContext gpu;
    gpu.init();
    OnesweepTestRunner runner;
    runner.init(gpu);

    constexpr uint32_t N = 1000;
    constexpr uint32_t CAPACITY = 4096;
    std::mt19937 rng(55);
    std::vector<TileSortEntry> input(N);
    for (uint32_t i = 0; i < N; i++) {
        input[i].key = rng() % 0xFFFFFFFE;
        input[i].index = i;
    }

    auto result = runner.sort(gpu, input, CAPACITY);

    assert(result.size() == N);
    bool sorted = std::is_sorted(result.begin(), result.end(),
        [](const TileSortEntry& a, const TileSortEntry& b) { return a.key < b.key; });
    assert(sorted);

    for (const auto& e : result) {
        assert(e.key < 0xFFFFFFFF);
    }

    runner.shutdown(gpu);
    gpu.shutdown();

    std::printf("PASS (%u real entries, %u capacity)\n", N, CAPACITY);
}

int main() {
    std::printf("=== Onesweep GPU Tests ===\n");

    test_basic_sort();
    test_stable_sort();
    test_low_workgroup_count();
    test_single_workgroup();
    test_sentinel_fill();

    std::printf("\nAll GPU tests passed!\n");
    return 0;
}
