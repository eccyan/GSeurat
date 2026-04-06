// Test: coordinate type system — Position<Space> construction, access, arithmetic, type safety.
// Run: ctest -R test_coordinate

#include "gseurat/engine/coordinate.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/collision_gen.hpp"

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
        check(sizeof(gseurat::coord::CellPos) == sizeof(glm::vec3),
              "sizeof(CellPos) == sizeof(glm::vec3)");
        check(sizeof(gseurat::coord::LocalPos) == sizeof(glm::vec3),
              "sizeof(LocalPos) == sizeof(glm::vec3)");
        check(sizeof(gseurat::coord::CameraPos) == sizeof(glm::vec3),
              "sizeof(CameraPos) == sizeof(glm::vec3)");
        check(sizeof(gseurat::coord::ScreenPos) == sizeof(glm::vec3),
              "sizeof(ScreenPos) == sizeof(glm::vec3)");
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

    // ── 7. Grid → World conversion ──
    std::printf("\n--- Grid to World ---\n\n");
    {
        gseurat::AABB terrain_aabb;
        terrain_aabb.min = glm::vec3(-128.0f, -70.0f, 0.0f);
        terrain_aabb.max = glm::vec3(127.0f, 70.0f, 127.0f);

        gseurat::coord::GridPos grid(50.0f, 50.0f, 64.0f);
        auto world = gseurat::coord::to_world(grid, terrain_aabb);

        check(approx(world.x(), -78.0f), "grid→world X: 50 + (-128) = -78");
        check(approx(world.y(), -20.0f), "grid→world Y: 50 + (-70) = -20");
        check(approx(world.z(), 64.0f),  "grid→world Z: 64 + 0 = 64");
    }

    // ── 8. World → Grid conversion ──
    std::printf("\n--- World to Grid ---\n\n");
    {
        gseurat::AABB terrain_aabb;
        terrain_aabb.min = glm::vec3(-128.0f, -70.0f, 0.0f);
        terrain_aabb.max = glm::vec3(127.0f, 70.0f, 127.0f);

        gseurat::coord::WorldPos world(-78.0f, -20.0f, 64.0f);
        auto grid = gseurat::coord::to_grid(world, terrain_aabb);

        check(approx(grid.x(), 50.0f), "world→grid X: -78 - (-128) = 50");
        check(approx(grid.y(), 50.0f), "world→grid Y: -20 - (-70) = 50");
        check(approx(grid.z(), 64.0f), "world→grid Z: 64 - 0 = 64");
    }

    // ── 9. Grid→World→Grid round-trip ──
    std::printf("\n--- Grid round-trip ---\n\n");
    {
        gseurat::AABB aabb;
        aabb.min = glm::vec3(-50.0f, -25.0f, -10.0f);
        aabb.max = glm::vec3(50.0f, 25.0f, 10.0f);

        gseurat::coord::GridPos orig(33.3f, 12.7f, 5.5f);
        auto world = gseurat::coord::to_world(orig, aabb);
        auto back = gseurat::coord::to_grid(world, aabb);

        check(approx(back.x(), orig.x()), "round-trip X preserved");
        check(approx(back.y(), orig.y()), "round-trip Y preserved");
        check(approx(back.z(), orig.z()), "round-trip Z preserved");
    }

    // ── 10. Cell → World conversion ──
    std::printf("\n--- Cell to World ---\n\n");
    {
        gseurat::CollisionGrid grid;
        grid.width = 256;
        grid.height = 128;
        grid.cell_size = 1.0f;
        grid.elevation.resize(256 * 128, 5.0f);

        gseurat::AABB aabb;
        aabb.min = glm::vec3(-128.0f, 0.0f, 0.0f);
        aabb.max = glm::vec3(127.0f, 10.0f, 127.0f);

        gseurat::coord::CellPos cell(10.0f, 0.0f, 20.0f);
        auto world = gseurat::coord::to_world(cell, grid, aabb);

        check(approx(world.x(), -118.0f), "cell→world X: 10*1 + (-128)");
        check(approx(world.y(), 5.0f),    "cell→world Y: elevation");
        check(approx(world.z(), 20.0f),   "cell→world Z: 20*1 + 0");
    }

    // ── 11. World → Cell conversion ──
    std::printf("\n--- World to Cell ---\n\n");
    {
        gseurat::CollisionGrid grid;
        grid.width = 256;
        grid.height = 128;
        grid.cell_size = 2.0f;

        gseurat::AABB aabb;
        aabb.min = glm::vec3(-100.0f, 0.0f, -50.0f);
        aabb.max = glm::vec3(100.0f, 10.0f, 50.0f);

        gseurat::coord::WorldPos world(-90.0f, 5.0f, -40.0f);
        auto cell = gseurat::coord::to_cell(world, grid, aabb);

        check(approx(cell.x(), 5.0f), "world→cell gx: (-90-(-100))/2 = 5");
        check(approx(cell.z(), 5.0f), "world→cell gz: (-40-(-50))/2 = 5");
    }

    // ── 12. Cell round-trip ──
    std::printf("\n--- Cell round-trip ---\n\n");
    {
        gseurat::CollisionGrid grid;
        grid.width = 100;
        grid.height = 100;
        grid.cell_size = 1.0f;
        grid.elevation.resize(10000, 3.0f);

        gseurat::AABB aabb;
        aabb.min = glm::vec3(-50.0f, 0.0f, -50.0f);
        aabb.max = glm::vec3(50.0f, 10.0f, 50.0f);

        gseurat::coord::CellPos orig(25.0f, 0.0f, 30.0f);
        auto world = gseurat::coord::to_world(orig, grid, aabb);
        auto back = gseurat::coord::to_cell(world, grid, aabb);

        check(approx(back.x(), orig.x()), "cell round-trip gx preserved");
        check(approx(back.z(), orig.z()), "cell round-trip gz preserved");
    }

    // ── 13. Zero AABB (no terrain) ──
    std::printf("\n--- Zero AABB ---\n\n");
    {
        gseurat::AABB aabb;
        aabb.min = glm::vec3(0.0f);
        aabb.max = glm::vec3(0.0f);

        gseurat::coord::GridPos grid(10.0f, 5.0f, 20.0f);
        auto world = gseurat::coord::to_world(grid, aabb);

        check(approx(world.x(), 10.0f), "zero AABB: grid→world X unchanged");
        check(approx(world.y(), 5.0f),  "zero AABB: grid→world Y unchanged");
        check(approx(world.z(), 20.0f), "zero AABB: grid→world Z unchanged");
    }

    std::printf("\n=== Results: %d passed, %d failed ===\n", passed, failed);
    return failed > 0 ? 1 : 0;
}
