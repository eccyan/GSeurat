// Test: coordinate type system — Position<Space> construction, access, arithmetic, type safety.
// Run: ctest -R test_coordinate

#include "gseurat/engine/coordinate.hpp"

#include <cassert>
#include <cmath>
#include <cstdio>

static int passed = 0;
static int failed = 0;

static void check(bool cond, const char* msg) {
    if (cond) {
        std::printf("  PASS: %s\n", msg);
        passed++;
    } else {
        std::printf("  FAIL: %s\n", msg);
        failed++;
    }
}

static bool approx(float a, float b, float eps = 0.01f) {
    return std::fabs(a - b) < eps;
}

int main() {
    std::printf("\n=== Coordinate Type Tests ===\n\n");

    // ── 1. Construction and access ──
    std::printf("--- Construction and access ---\n\n");
    {
        gseurat::coord::GridPos p(glm::vec3(1.0f, 2.0f, 3.0f));
        check(approx(p.x(), 1.0f), "GridPos x()");
        check(approx(p.y(), 2.0f), "GridPos y()");
        check(approx(p.z(), 3.0f), "GridPos z()");
        check(approx(p.vec().x, 1.0f), "GridPos vec().x");
    }
    {
        gseurat::coord::WorldPos p(5.0f, 6.0f, 7.0f);
        check(approx(p.x(), 5.0f), "WorldPos 3-arg constructor x");
        check(approx(p.y(), 6.0f), "WorldPos 3-arg constructor y");
        check(approx(p.z(), 7.0f), "WorldPos 3-arg constructor z");
    }
    {
        gseurat::coord::GridPos p;
        check(approx(p.x(), 0.0f), "default-constructed GridPos x = 0");
        check(approx(p.y(), 0.0f), "default-constructed GridPos y = 0");
        check(approx(p.z(), 0.0f), "default-constructed GridPos z = 0");
    }

    // ── 2. Same-space arithmetic ──
    std::printf("\n--- Same-space arithmetic ---\n\n");
    {
        gseurat::coord::WorldPos a(1.0f, 2.0f, 3.0f);
        gseurat::coord::WorldPos b(10.0f, 20.0f, 30.0f);
        auto sum = a + b;
        check(approx(sum.x(), 11.0f), "WorldPos + WorldPos x");
        check(approx(sum.y(), 22.0f), "WorldPos + WorldPos y");
        check(approx(sum.z(), 33.0f), "WorldPos + WorldPos z");

        auto diff = b - a;
        check(approx(diff.x(), 9.0f), "WorldPos - WorldPos x");
    }
    {
        gseurat::coord::GridPos p(1.0f, 2.0f, 3.0f);
        gseurat::coord::GridPos d(0.5f, 0.5f, 0.5f);
        p += d;
        check(approx(p.x(), 1.5f), "GridPos += GridPos x");
        p -= d;
        check(approx(p.x(), 1.0f), "GridPos -= GridPos x");
    }

    // ── 3. Equality ──
    std::printf("\n--- Equality ---\n\n");
    {
        gseurat::coord::WorldPos a(1.0f, 2.0f, 3.0f);
        gseurat::coord::WorldPos b(1.0f, 2.0f, 3.0f);
        gseurat::coord::WorldPos c(9.0f, 9.0f, 9.0f);
        check(a == b, "equal positions are ==");
        check(a != c, "different positions are !=");
    }

    // ── 4. Mutable vec() access ──
    std::printf("\n--- Mutable vec() ---\n\n");
    {
        gseurat::coord::WorldPos p(0.0f, 0.0f, 0.0f);
        p.vec().x = 42.0f;
        check(approx(p.x(), 42.0f), "mutable vec() modifies underlying data");
    }

    // ── 5. sizeof matches glm::vec3 ──
    std::printf("\n--- sizeof ---\n\n");
    {
        check(sizeof(gseurat::coord::GridPos) == sizeof(glm::vec3),
              "sizeof(GridPos) == sizeof(glm::vec3)");
        check(sizeof(gseurat::coord::WorldPos) == sizeof(glm::vec3),
              "sizeof(WorldPos) == sizeof(glm::vec3)");
    }

    // ── 6. Trivially copyable (required for ECS archetype memcpy) ──
    std::printf("\n--- Trivially copyable ---\n\n");
    {
        check(std::is_trivially_copyable_v<gseurat::coord::GridPos>,
              "GridPos is trivially copyable");
        check(std::is_trivially_copyable_v<gseurat::coord::WorldPos>,
              "WorldPos is trivially copyable");
        check(std::is_trivially_copyable_v<gseurat::coord::CellPos>,
              "CellPos is trivially copyable");
        check(std::is_trivially_copyable_v<gseurat::coord::LocalPos>,
              "LocalPos is trivially copyable");
        check(std::is_trivially_copyable_v<gseurat::coord::CameraPos>,
              "CameraPos is trivially copyable");
        check(std::is_trivially_copyable_v<gseurat::coord::ScreenPos>,
              "ScreenPos is trivially copyable");
    }

    // ── Cross-space arithmetic is a compile error ──
    // The following would NOT compile (uncomment to verify):
    // gseurat::coord::GridPos g(1,2,3);
    // gseurat::coord::WorldPos w(4,5,6);
    // auto bad = g + w;  // ERROR: no operator+ for Position<Grid> + Position<World>

    std::printf("\n=== Results: %d passed, %d failed ===\n", passed, failed);
    return failed > 0 ? 1 : 0;
}
