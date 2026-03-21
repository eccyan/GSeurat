// Unit test: Tilemap — TileAnimator, resolve_tilemap_collision, generate_draw_infos
//
// Build:
//   c++ -std=c++23 -I include \
//       -I build/macos-debug/_deps/glm-src \
//       -I build/macos-debug/_deps/stb-src \
//       -I build/macos-debug/_deps/vma-src/include \
//       $(pkg-config --cflags vulkan 2>/dev/null || echo "-I$VULKAN_SDK/include") \
//       tests/test_tilemap.cpp src/engine/tilemap.cpp \
//       -o build/test_tilemap
//
// Run: ./build/test_tilemap

#include "vulkan_game/engine/tilemap.hpp"

#include <cassert>
#include <cmath>
#include <cstdio>

using namespace vulkan_game;

// ──── Group A: TileAnimator ────

void test_resolve_without_animation() {
    TileAnimator animator;
    assert(animator.resolve(42) == 42);
    std::printf("PASS: resolve without animation\n");
}

void test_add_definition_and_resolve() {
    TileAnimator animator;
    animator.add_definition({5, {10, 11, 12}, 0.2f});
    assert(animator.resolve(5) == 10);
    // Non-animated tile unchanged
    assert(animator.resolve(99) == 99);
    std::printf("PASS: add_definition + resolve\n");
}

void test_update_advances_frame() {
    TileAnimator animator;
    animator.add_definition({5, {10, 11, 12}, 0.2f});
    animator.update(0.2f);
    assert(animator.resolve(5) == 11);
    std::printf("PASS: update advances frame\n");
}

void test_update_wraps_around() {
    TileAnimator animator;
    animator.add_definition({5, {10, 11, 12}, 0.2f});
    animator.update(0.2f); // frame 1
    animator.update(0.2f); // frame 2
    animator.update(0.2f); // frame 0 (wrap)
    assert(animator.resolve(5) == 10);
    std::printf("PASS: update wraps around\n");
}

void test_reset_clears_state() {
    TileAnimator animator;
    animator.add_definition({5, {10, 11, 12}, 0.2f});
    assert(animator.resolve(5) == 10);
    animator.reset();
    assert(animator.resolve(5) == 5);
    std::printf("PASS: reset clears state\n");
}

// ──── Group B: resolve_tilemap_collision ────

static TileLayer make_test_layer(uint32_t w, uint32_t h, float tile_size,
                                  std::vector<bool> solid_vec) {
    TileLayer layer;
    layer.tileset = {16, 16, 4, 64, 64};
    layer.width = w;
    layer.height = h;
    layer.tile_size = 1.0f;
    layer.z = 0.0f;
    layer.tiles.resize(w * h, 0);
    layer.solid = std::move(solid_vec);
    layer.tile_size = tile_size;
    return layer;
}

void test_empty_solid_vector() {
    TileLayer layer = make_test_layer(4, 4, 1.0f, {});
    glm::vec2 pos{0.0f, 0.0f};
    auto result = resolve_tilemap_collision(pos, 0.25f, layer);
    assert(result.x == pos.x && result.y == pos.y);
    std::printf("PASS: empty solid vector\n");
}

void test_no_overlap() {
    // 2x2 grid centered at origin, tile_size=1. Tile centers at ±0.25.
    // Solid tile at (0,0) → center (-0.5, 0.5)
    std::vector<bool> solid = {true, false, false, false};
    TileLayer layer = make_test_layer(2, 2, 1.0f, solid);
    // Position far away from any solid tile
    glm::vec2 pos{10.0f, 10.0f};
    auto result = resolve_tilemap_collision(pos, 0.25f, layer);
    assert(result.x == pos.x && result.y == pos.y);
    std::printf("PASS: no overlap\n");
}

void test_push_out_minimum_axis() {
    // 3x3 grid, tile_size=1. Grid spans [-1.5, 1.5].
    // Center tile (1,1) is solid → tile center (0, 0).
    std::vector<bool> solid(9, false);
    solid[4] = true; // row=1, col=1
    TileLayer layer = make_test_layer(3, 3, 1.0f, solid);

    // Place entity slightly overlapping the center tile from the right.
    // half_extent=0.25, tile_half=0.5, sum_half=0.75
    // At x=0.6: dx=0.6, overlap_x = 0.75 - 0.6 = 0.15
    // At y=0.0: dy=0, overlap_y = 0.75 - 0 = 0.75
    // overlap_x < overlap_y → push on x → x = 0.6 + 0.15 = 0.75
    glm::vec2 pos{0.6f, 0.0f};
    auto result = resolve_tilemap_collision(pos, 0.25f, layer);
    assert(std::abs(result.x - 0.75f) < 1e-5f);
    assert(std::abs(result.y - 0.0f) < 1e-5f);
    std::printf("PASS: push out minimum axis\n");
}

void test_two_adjacent_solids() {
    // 3x3 grid, two adjacent solid tiles at (1,0) and (1,1)
    // tile centers: (1,0)→(-1.0, 0.0), (1,1)→(0.0, 0.0)
    std::vector<bool> solid(9, false);
    solid[3] = true; // row=1, col=0
    solid[4] = true; // row=1, col=1
    TileLayer layer = make_test_layer(3, 3, 1.0f, solid);

    // Entity at (-0.4, 0.0) overlaps both tiles, should be pushed out
    glm::vec2 pos{-0.4f, 0.0f};
    auto result = resolve_tilemap_collision(pos, 0.25f, layer);
    // Should be pushed clear of both solids
    // After resolving with tile at (-1,0): dx=0.6, overlap_x=0.15 → push right to -0.25
    // After resolving with tile at (0,0): dx=-0.25, overlap_x=0.5 → dy=0, overlap_y=0.75
    // overlap_x < overlap_y → push left to -0.75
    assert(std::abs(result.x - (-0.75f)) < 1e-5f);
    std::printf("PASS: two adjacent solids\n");
}

// ──── Group C: TileLayer::generate_draw_infos ────

void test_skip_tiles() {
    TileLayer layer;
    layer.tileset = {16, 16, 4, 64, 64};
    layer.width = 2;
    layer.height = 2;
    layer.tile_size = 1.0f;
    layer.z = 0.0f;
    layer.tiles = {0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF};

    auto infos = layer.generate_draw_infos();
    assert(infos.empty());
    std::printf("PASS: skip tiles (0xFFFF)\n");
}

void test_position_calculation() {
    TileLayer layer;
    layer.tileset = {16, 16, 4, 64, 64};
    layer.width = 2;
    layer.height = 2;
    layer.tile_size = 1.0f;
    layer.z = 5.0f;
    layer.tiles = {0, 1, 2, 3};

    auto infos = layer.generate_draw_infos();
    assert(infos.size() == 4);

    // half_w = 1.0, half_h = 1.0
    // (0,0) → x = 0.5*1 - 1 = -0.5, y = -0.5*1 + 1 = 0.5
    assert(std::abs(infos[0].position.x - (-0.5f)) < 1e-5f);
    assert(std::abs(infos[0].position.y - 0.5f) < 1e-5f);
    assert(std::abs(infos[0].position.z - 5.0f) < 1e-5f);

    // (0,1) → x = 1.5*1 - 1 = 0.5, y = 0.5
    assert(std::abs(infos[1].position.x - 0.5f) < 1e-5f);
    assert(std::abs(infos[1].position.y - 0.5f) < 1e-5f);

    // (1,0) → x = -0.5, y = -1.5 + 1 = -0.5
    assert(std::abs(infos[2].position.x - (-0.5f)) < 1e-5f);
    assert(std::abs(infos[2].position.y - (-0.5f)) < 1e-5f);

    // (1,1) → x = 0.5, y = -0.5
    assert(std::abs(infos[3].position.x - 0.5f) < 1e-5f);
    assert(std::abs(infos[3].position.y - (-0.5f)) < 1e-5f);

    std::printf("PASS: position calculation\n");
}

void test_animator_integration() {
    TileLayer layer;
    layer.tileset = {16, 16, 4, 64, 64};
    layer.width = 1;
    layer.height = 1;
    layer.tile_size = 1.0f;
    layer.z = 0.0f;
    layer.tiles = {5};

    // Without animator: tile 5
    auto infos_no_anim = layer.generate_draw_infos();
    assert(infos_no_anim.size() == 1);
    glm::vec2 uv_no_anim = infos_no_anim[0].uv_min;

    // With animator: tile 5 → tile 8 (different column/row → different UV)
    TileAnimator animator;
    animator.add_definition({5, {8, 9, 10}, 0.2f});
    auto infos_anim = layer.generate_draw_infos(&animator);
    assert(infos_anim.size() == 1);
    glm::vec2 uv_anim = infos_anim[0].uv_min;

    // tile 5: col=1, row=1 → uv_min = (16/64, 16/64) = (0.25, 0.25)
    // tile 8: col=0, row=2 → uv_min = (0/64, 32/64) = (0.0, 0.5)
    assert(std::abs(uv_no_anim.x - 0.25f) < 1e-5f);
    assert(std::abs(uv_no_anim.y - 0.25f) < 1e-5f);
    assert(std::abs(uv_anim.x - 0.0f) < 1e-5f);
    assert(std::abs(uv_anim.y - 0.5f) < 1e-5f);

    std::printf("PASS: animator integration\n");
}

int main() {
    // Group A: TileAnimator
    test_resolve_without_animation();
    test_add_definition_and_resolve();
    test_update_advances_frame();
    test_update_wraps_around();
    test_reset_clears_state();

    // Group B: resolve_tilemap_collision
    test_empty_solid_vector();
    test_no_overlap();
    test_push_out_minimum_axis();
    test_two_adjacent_solids();

    // Group C: generate_draw_infos
    test_skip_tiles();
    test_position_calculation();
    test_animator_integration();

    std::printf("\nAll tilemap tests passed.\n");
    return 0;
}
