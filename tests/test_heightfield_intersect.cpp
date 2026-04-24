#include "gseurat/engine/collision/intersect.hpp"
#include "gseurat/engine/ecs/components/heightfield_component.hpp"

#include <cstdio>
#include <cmath>
#include <vector>

using namespace gseurat;

static int passed = 0;
static int failed = 0;

static void check(bool cond, const char* msg) {
    if (cond) { std::printf("  PASS: %s\n", msg); passed++; }
    else      { std::printf("  FAIL: %s\n", msg); failed++; }
}

static bool approx(float a, float b, float eps = 0.01f) {
    return std::abs(a - b) < eps;
}

static bool vec_approx(const glm::vec3& a, const glm::vec3& b, float eps = 0.01f) {
    return approx(a.x, b.x, eps) && approx(a.y, b.y, eps) && approx(a.z, b.z, eps);
}

int main() {
    std::printf("=== test_heightfield_intersect ===\n");

    // Tests will be added in subsequent tasks (Tasks 2-5).

    std::printf("\n%d passed, %d failed\n", passed, failed);
    return failed > 0 ? 1 : 0;
}
