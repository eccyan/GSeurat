#include "vulkan_game/app.hpp"
#include "vulkan_game/engine/ecs/default_components.hpp"
#include "vulkan_game/game/components.hpp"
#include "vulkan_game/game/states/title_state.hpp"
#include "vulkan_game/game/states/transition_state.hpp"
#include "vulkan_game/game/systems.hpp"
#include "vulkan_game/engine/pathfinder.hpp"
#include "vulkan_game/engine/character_data.hpp"
#include "vulkan_game/engine/scene_loader.hpp"
#include "vulkan_game/engine/tilemap.hpp"

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include <stb_image_write.h>

#include <glm/gtc/matrix_transform.hpp>

#include <cmath>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <set>

namespace vulkan_game {

// Decode all unique codepoints from a UTF-8 string into a set.
static void collect_codepoints(const std::string& text, std::set<uint32_t>& out) {
    size_t i = 0;
    while (i < text.size()) {
        uint8_t c = static_cast<uint8_t>(text[i]);
        uint32_t cp = 0;
        if (c < 0x80) {
            cp = c; i += 1;
        } else if ((c & 0xE0) == 0xC0 && i + 1 < text.size()) {
            cp = (c & 0x1F) << 6;
            cp |= (static_cast<uint8_t>(text[i + 1]) & 0x3F);
            i += 2;
        } else if ((c & 0xF0) == 0xE0 && i + 2 < text.size()) {
            cp = (c & 0x0F) << 12;
            cp |= (static_cast<uint8_t>(text[i + 1]) & 0x3F) << 6;
            cp |= (static_cast<uint8_t>(text[i + 2]) & 0x3F);
            i += 3;
        } else if ((c & 0xF8) == 0xF0 && i + 3 < text.size()) {
            cp = (c & 0x07) << 18;
            cp |= (static_cast<uint8_t>(text[i + 1]) & 0x3F) << 12;
            cp |= (static_cast<uint8_t>(text[i + 2]) & 0x3F) << 6;
            cp |= (static_cast<uint8_t>(text[i + 3]) & 0x3F);
            i += 4;
        } else {
            i += 1; continue;
        }
        out.insert(cp);
    }
}

void App::generate_player_sheet() {
    constexpr int kFrameW   = 16;
    constexpr int kFrameH   = 16;
    constexpr int kFrames   = 4;
    constexpr int kRows     = 12;  // 3 states x 4 directions
    constexpr int kWidth    = kFrameW * kFrames;  // 64
    constexpr int kHeight   = kFrameH * kRows;    // 192
    constexpr int kChannels = 4;

    const uint8_t row_colors[kRows][kFrames][4] = {
        {{170,170,170,255}, {200,200,200,255}, {230,230,230,255}, {200,200,200,255}},
        {{150,155,180,255}, {175,180,205,255}, {200,205,230,255}, {175,180,205,255}},
        {{180,155,150,255}, {205,180,175,255}, {230,205,200,255}, {205,180,175,255}},
        {{150,180,155,255}, {175,205,180,255}, {200,230,205,255}, {175,205,180,255}},
        {{ 80,120,220,255}, {100,140,235,255}, { 60,100,205,255}, {100,140,235,255}},
        {{ 60,190,210,255}, { 80,210,230,255}, { 40,165,185,255}, { 80,210,230,255}},
        {{ 50,175,160,255}, { 70,195,180,255}, { 35,150,140,255}, { 70,195,180,255}},
        {{110, 90,210,255}, {130,110,230,255}, { 90, 70,185,255}, {130,110,230,255}},
        {{230,120, 40,255}, {255,160, 60,255}, {200, 90, 20,255}, {255,160, 60,255}},
        {{240,180, 40,255}, {255,210, 70,255}, {215,155, 20,255}, {255,210, 70,255}},
        {{220, 80, 40,255}, {245,110, 60,255}, {195, 55, 20,255}, {245,110, 60,255}},
        {{190, 40, 40,255}, {215, 65, 65,255}, {165, 20, 20,255}, {215, 65, 65,255}},
    };

    std::vector<uint8_t> pixels(kWidth * kHeight * kChannels);

    for (int sheet_row = 0; sheet_row < kRows; ++sheet_row) {
        for (int frame = 0; frame < kFrames; ++frame) {
            for (int py_local = 0; py_local < kFrameH; ++py_local) {
                int py_abs = sheet_row * kFrameH + py_local;
                for (int px_local = 0; px_local < kFrameW; ++px_local) {
                    int px  = frame * kFrameW + px_local;
                    int idx = (py_abs * kWidth + px) * kChannels;
                    pixels[idx + 0] = row_colors[sheet_row][frame][0];
                    pixels[idx + 1] = row_colors[sheet_row][frame][1];
                    pixels[idx + 2] = row_colors[sheet_row][frame][2];
                    pixels[idx + 3] = row_colors[sheet_row][frame][3];
                }
            }
        }
    }

    std::filesystem::create_directories("assets/textures");
    stbi_write_png("assets/textures/player_sheet.png", kWidth, kHeight, kChannels,
                   pixels.data(), kWidth * kChannels);
}

void App::generate_tileset() {
    constexpr int kTileW    = 16;
    constexpr int kTileH    = 16;
    constexpr int kCols     = 8;
    constexpr int kRows     = 3;
    constexpr int kWidth    = kTileW * kCols;   // 128
    constexpr int kHeight   = kTileH * kRows;   // 48
    constexpr int kChannels = 4;

    // 24 tile slots (8 columns x 3 rows):
    // Row 0: [0] floor, [1] wall, [2-4] water frames, [5-7] lava frames
    // Row 1: [8-9] wall torch frames, [10-15] unused
    // Row 2: unused
    const uint8_t tile_colors[10][4] = {
        {200, 185, 145, 255},  // 0: beige floor
        { 70,  60,  55, 255},  // 1: dark rock wall
        { 40,  90, 180, 255},  // 2: water frame 0 (deep blue)
        { 55, 110, 200, 255},  // 3: water frame 1 (medium blue)
        { 70, 130, 210, 255},  // 4: water frame 2 (light blue)
        {200,  60,  20, 255},  // 5: lava frame 0 (dark red-orange)
        {240, 100,  20, 255},  // 6: lava frame 1 (bright orange)
        {255, 160,  40, 255},  // 7: lava frame 2 (yellow-orange)
        { 60,  50,  45, 255},  // 8: wall torch frame 0 (dark wall + dim ember)
        { 80,  65,  40, 255},  // 9: wall torch frame 1 (dark wall + bright ember)
    };

    std::vector<uint8_t> pixels(kWidth * kHeight * kChannels, 0);

    auto fill_tile = [&](int tile_id, const uint8_t color[4]) {
        int col = tile_id % kCols;
        int row = tile_id / kCols;
        for (int py = 0; py < kTileH; ++py) {
            for (int px = 0; px < kTileW; ++px) {
                int abs_x = col * kTileW + px;
                int abs_y = row * kTileH + py;
                int idx = (abs_y * kWidth + abs_x) * kChannels;
                pixels[idx + 0] = color[0];
                pixels[idx + 1] = color[1];
                pixels[idx + 2] = color[2];
                pixels[idx + 3] = color[3];
            }
        }
    };

    // Fill all 10 defined tiles
    for (int t = 0; t < 10; ++t) {
        fill_tile(t, tile_colors[t]);
    }

    // Add wave-like brightness variation to water tiles (2-4)
    for (int frame = 0; frame < 3; ++frame) {
        int tile_id = 2 + frame;
        int col = tile_id % kCols;
        int row = tile_id / kCols;
        for (int py = 0; py < kTileH; ++py) {
            float wave = 0.85f + 0.15f * std::sin(static_cast<float>(py + frame * 5) * 0.8f);
            for (int px = 0; px < kTileW; ++px) {
                int abs_x = col * kTileW + px;
                int abs_y = row * kTileH + py;
                int idx = (abs_y * kWidth + abs_x) * kChannels;
                pixels[idx + 0] = static_cast<uint8_t>(std::min(255.0f, pixels[idx + 0] * wave));
                pixels[idx + 1] = static_cast<uint8_t>(std::min(255.0f, pixels[idx + 1] * wave));
                pixels[idx + 2] = static_cast<uint8_t>(std::min(255.0f, pixels[idx + 2] * wave));
            }
        }
    }

    // Add flow pattern to lava tiles (5-7)
    for (int frame = 0; frame < 3; ++frame) {
        int tile_id = 5 + frame;
        int col = tile_id % kCols;
        int row = tile_id / kCols;
        for (int py = 0; py < kTileH; ++py) {
            float flow = 0.8f + 0.2f * std::sin(static_cast<float>(py + frame * 4) * 0.6f);
            for (int px = 0; px < kTileW; ++px) {
                int abs_x = col * kTileW + px;
                int abs_y = row * kTileH + py;
                int idx = (abs_y * kWidth + abs_x) * kChannels;
                pixels[idx + 0] = static_cast<uint8_t>(std::min(255.0f, pixels[idx + 0] * flow));
                pixels[idx + 1] = static_cast<uint8_t>(std::min(255.0f, pixels[idx + 1] * flow));
                pixels[idx + 2] = static_cast<uint8_t>(std::min(255.0f, pixels[idx + 2] * flow));
            }
        }
    }

    // Add ember glow to wall torch tiles (8-9)
    {
        for (int frame = 0; frame < 2; ++frame) {
            int tile_id = 8 + frame;
            int col = tile_id % kCols;
            int row = tile_id / kCols;
            float ember_intensity = frame == 0 ? 0.4f : 0.9f;
            for (int py = 0; py < kTileH; ++py) {
                for (int px = 0; px < kTileW; ++px) {
                    // Ember at top-center of tile
                    float dx = static_cast<float>(px) - 7.5f;
                    float dy = static_cast<float>(py) - 3.0f;
                    float dist = std::sqrt(dx * dx + dy * dy);
                    float glow = std::max(0.0f, 1.0f - dist / 5.0f) * ember_intensity;
                    int abs_x = col * kTileW + px;
                    int abs_y = row * kTileH + py;
                    int idx = (abs_y * kWidth + abs_x) * kChannels;
                    pixels[idx + 0] = static_cast<uint8_t>(std::min(255.0f, pixels[idx + 0] + glow * 180.0f));
                    pixels[idx + 1] = static_cast<uint8_t>(std::min(255.0f, pixels[idx + 1] + glow * 100.0f));
                    pixels[idx + 2] = static_cast<uint8_t>(std::min(255.0f, pixels[idx + 2] + glow * 20.0f));
                }
            }
        }
    }

    std::filesystem::create_directories("assets/textures");
    stbi_write_png("assets/textures/tileset.png", kWidth, kHeight, kChannels,
                   pixels.data(), kWidth * kChannels);
}

void App::generate_particle_atlas() {
    constexpr int kTileSize = 16;
    constexpr int kTiles    = 6;
    constexpr int kWidth    = kTileSize * kTiles;  // 96
    constexpr int kHeight   = kTileSize;           // 16
    constexpr int kChannels = 4;
    constexpr float kCenter = 7.5f;
    constexpr float kRadius = 7.0f;

    std::vector<uint8_t> pixels(kWidth * kHeight * kChannels, 0);

    auto set_pixel = [&](int x, int y, uint8_t a) {
        int idx = (y * kWidth + x) * kChannels;
        pixels[idx + 0] = 255;
        pixels[idx + 1] = 255;
        pixels[idx + 2] = 255;
        pixels[idx + 3] = a;
    };

    for (int py = 0; py < kTileSize; ++py) {
        for (int px = 0; px < kTileSize; ++px) {
            float dx = static_cast<float>(px) - kCenter;
            float dy = static_cast<float>(py) - kCenter;
            float dist = std::sqrt(dx * dx + dy * dy);

            // Tile 0: Circle (hard edge)
            set_pixel(px, py, dist <= kRadius ? 255 : 0);

            // Tile 1: Soft Glow (gaussian)
            {
                float norm = dist / kRadius;
                float val = std::exp(-norm * norm * 3.0f);
                val = std::max(0.0f, std::min(1.0f, val));
                set_pixel(kTileSize + px, py, static_cast<uint8_t>(val * 255.0f));
            }

            // Tile 2: Spark (diamond / manhattan distance)
            {
                float adx = std::abs(dx);
                float ady = std::abs(dy);
                float manhattan = adx + ady;
                float val = 1.0f - manhattan / kRadius;
                val = std::max(0.0f, std::min(1.0f, val));
                val *= val;
                set_pixel(2 * kTileSize + px, py, static_cast<uint8_t>(val * 255.0f));
            }

            // Tile 3: Smoke Puff (wavy blob)
            {
                float angle = std::atan2(dy, dx);
                float wave = 1.0f + 0.2f * std::sin(angle * 5.0f)
                                  + 0.1f * std::sin(angle * 3.0f + 1.0f);
                float adj_r = kRadius * 0.85f * wave;
                float norm = dist / adj_r;
                float val = 1.0f - norm;
                val = std::max(0.0f, std::min(1.0f, val));
                val = std::sqrt(val);
                set_pixel(3 * kTileSize + px, py, static_cast<uint8_t>(val * 255.0f));
            }

            // Tile 4: Raindrop (vertical streak, narrow)
            {
                float ax = std::abs(dx);
                float fy = static_cast<float>(py) / static_cast<float>(kTileSize - 1);
                // Narrow horizontal (2px wide center), alpha gradient top-to-bottom
                float h_falloff = std::max(0.0f, 1.0f - ax / 1.5f);
                float v_alpha = fy;  // faint at top, solid at bottom
                float val = h_falloff * v_alpha;
                val = std::max(0.0f, std::min(1.0f, val));
                set_pixel(4 * kTileSize + px, py, static_cast<uint8_t>(val * 255.0f));
            }

            // Tile 5: Snowflake (cross/star pattern, soft edges)
            {
                float adx = std::abs(dx);
                float ady = std::abs(dy);
                // Cross: bright along axes
                float cross = std::max(0.0f, 1.0f - std::min(adx, ady) / 2.0f);
                // Radial falloff
                float radial = std::max(0.0f, 1.0f - dist / kRadius);
                float val = cross * radial;
                val = std::max(0.0f, std::min(1.0f, val));
                set_pixel(5 * kTileSize + px, py, static_cast<uint8_t>(val * 255.0f));
            }
        }
    }

    std::filesystem::create_directories("assets/textures");
    stbi_write_png("assets/textures/particle_atlas.png", kWidth, kHeight, kChannels,
                   pixels.data(), kWidth * kChannels);
}

void App::generate_background_textures() {
    std::filesystem::create_directories("assets/textures");
    constexpr int kChannels = 4;

    // Sky gradient: 128x64, deep indigo at top to warm horizon at bottom
    {
        constexpr int w = 128, h = 64;
        std::vector<uint8_t> px(w * h * kChannels);
        for (int y = 0; y < h; ++y) {
            float t = static_cast<float>(y) / static_cast<float>(h - 1);
            auto r = static_cast<uint8_t>(15 + t * 65);
            auto g = static_cast<uint8_t>(10 + t * 40);
            auto b = static_cast<uint8_t>(50 + t * 40);
            for (int x = 0; x < w; ++x) {
                int idx = (y * w + x) * kChannels;
                px[idx] = r; px[idx+1] = g; px[idx+2] = b; px[idx+3] = 255;
            }
        }
        stbi_write_png("assets/textures/bg_sky.png", w, h, kChannels, px.data(), w * kChannels);
    }

    // Distant mountains: 256x64, dark silhouette on transparent
    {
        constexpr int w = 256, h = 64;
        std::vector<uint8_t> px(w * h * kChannels, 0);
        for (int x = 0; x < w; ++x) {
            float fx = static_cast<float>(x) / static_cast<float>(w);
            float mountain_h = 0.35f + 0.15f * std::sin(fx * 6.2832f * 2.0f)
                             + 0.10f * std::sin(fx * 6.2832f * 5.0f + 1.0f)
                             + 0.05f * std::sin(fx * 6.2832f * 11.0f + 2.5f);
            int peak_y = static_cast<int>((1.0f - mountain_h) * h);
            for (int y = peak_y; y < h; ++y) {
                int idx = (y * w + x) * kChannels;
                px[idx] = 35; px[idx+1] = 30; px[idx+2] = 55; px[idx+3] = 255;
            }
        }
        stbi_write_png("assets/textures/bg_mountains.png", w, h, kChannels, px.data(), w * kChannels);
    }

    // Mid-ground trees: 256x64, tree-like silhouettes, semi-transparent
    {
        constexpr int w = 256, h = 64;
        std::vector<uint8_t> px(w * h * kChannels, 0);
        for (int x = 0; x < w; ++x) {
            float fx = static_cast<float>(x) / static_cast<float>(w);
            float tree_h = 0.55f + 0.12f * std::sin(fx * 6.2832f * 8.0f)
                         + 0.08f * std::sin(fx * 6.2832f * 13.0f + 0.7f)
                         + 0.06f * std::sin(fx * 6.2832f * 21.0f + 3.1f);
            int peak_y = static_cast<int>((1.0f - tree_h) * h);
            for (int y = peak_y; y < h; ++y) {
                int idx = (y * w + x) * kChannels;
                px[idx] = 20; px[idx+1] = 35; px[idx+2] = 30; px[idx+3] = 220;
            }
        }
        stbi_write_png("assets/textures/bg_trees.png", w, h, kChannels, px.data(), w * kChannels);
    }
}

namespace {

void write_wav(const std::string& path, const std::vector<int16_t>& samples, uint32_t sample_rate) {
    uint32_t data_size = static_cast<uint32_t>(samples.size() * sizeof(int16_t));
    uint32_t file_size = 36 + data_size;
    uint16_t channels = 1;
    uint16_t bits_per_sample = 16;
    uint32_t byte_rate = sample_rate * channels * bits_per_sample / 8;
    uint16_t block_align = channels * bits_per_sample / 8;

    auto f = std::fopen(path.c_str(), "wb");
    if (!f) return;

    std::fwrite("RIFF", 1, 4, f);
    std::fwrite(&file_size, 4, 1, f);
    std::fwrite("WAVE", 1, 4, f);
    std::fwrite("fmt ", 1, 4, f);
    uint32_t fmt_size = 16;
    std::fwrite(&fmt_size, 4, 1, f);
    uint16_t audio_fmt = 1;  // PCM
    std::fwrite(&audio_fmt, 2, 1, f);
    std::fwrite(&channels, 2, 1, f);
    std::fwrite(&sample_rate, 4, 1, f);
    std::fwrite(&byte_rate, 4, 1, f);
    std::fwrite(&block_align, 2, 1, f);
    std::fwrite(&bits_per_sample, 2, 1, f);
    std::fwrite("data", 1, 4, f);
    std::fwrite(&data_size, 4, 1, f);
    std::fwrite(samples.data(), sizeof(int16_t), samples.size(), f);
    std::fclose(f);
}

}  // namespace

void App::generate_shadow_texture() {
    constexpr int kSize = 32;
    constexpr int kChannels = 4;
    constexpr float kCenter = 15.5f;
    constexpr float kRadius = 14.0f;

    std::vector<uint8_t> pixels(kSize * kSize * kChannels, 0);

    for (int y = 0; y < kSize; ++y) {
        for (int x = 0; x < kSize; ++x) {
            float dx = static_cast<float>(x) - kCenter;
            float dy = static_cast<float>(y) - kCenter;
            float dist = std::sqrt(dx * dx + dy * dy);
            float norm = dist / kRadius;
            float alpha = std::exp(-norm * norm * 3.0f);
            alpha = std::max(0.0f, std::min(1.0f, alpha));

            int idx = (y * kSize + x) * kChannels;
            pixels[idx + 0] = 255;
            pixels[idx + 1] = 255;
            pixels[idx + 2] = 255;
            pixels[idx + 3] = static_cast<uint8_t>(alpha * 255.0f);
        }
    }

    std::filesystem::create_directories("assets/textures");
    stbi_write_png("assets/textures/shadow_blob.png", kSize, kSize, kChannels,
                   pixels.data(), kSize * kChannels);
}

void App::generate_flat_normal_texture() {
    std::filesystem::create_directories("assets/textures");
    // 1×1 flat normal pointing straight up (Z-facing): (128,128,255,255) in tangent space
    uint8_t pixels[4] = {128, 128, 255, 255};
    stbi_write_png("assets/textures/flat_normal.png", 1, 1, 4, pixels, 4);
}

void App::generate_tileset_normal() {
    // Must match tileset.png: 128×48 (8 cols × 3 rows of 16×16 tiles)
    constexpr int kTileW = 16;
    constexpr int kTileH = 16;
    constexpr int kCols = 8;
    constexpr int kRows = 3;
    constexpr int kWidth = kCols * kTileW;   // 128
    constexpr int kHeight = kRows * kTileH;  // 48
    constexpr int kChannels = 4;
    constexpr float kPi = 3.14159265358979323846f;

    std::vector<float> heightmap(kWidth * kHeight, 0.0f);
    std::vector<uint8_t> pixels(kWidth * kHeight * kChannels, 0);

    // Helper: tile_id → top-left pixel (col, row)
    auto tile_origin = [&](int tile_id) -> std::pair<int, int> {
        int col = tile_id % kCols;
        int row = tile_id / kCols;
        return {col * kTileW, row * kTileH};
    };

    // Generate heightmap per tile
    auto fill_tile_height = [&](int tile_id, auto height_fn) {
        auto [ox, oy] = tile_origin(tile_id);
        for (int ly = 0; ly < kTileH; ++ly) {
            for (int lx = 0; lx < kTileW; ++lx) {
                int gx = ox + lx;
                int gy = oy + ly;
                heightmap[gy * kWidth + gx] = height_fn(lx, ly);
            }
        }
    };

    // Tile 0: floor — subtle stone bumps
    fill_tile_height(0, [&](int lx, int ly) {
        float fx = static_cast<float>(lx);
        float fy = static_cast<float>(ly);
        return std::sin(fx * 1.5f) * std::sin(fy * 1.7f) * 1.5f;
    });

    // Tile 1: wall — brick mortar grooves
    fill_tile_height(1, [&](int lx, int ly) {
        float h = 3.0f;
        // Horizontal mortar lines every 4 pixels
        if (ly % 4 == 0) h = 0.0f;
        // Alternating vertical mortar
        int brick_offset = (ly / 4) % 2 == 0 ? 0 : 8;
        if ((lx + brick_offset) % 8 == 0) h = 0.0f;
        return h;
    });

    // Tiles 2-4: water — sinusoidal waves
    for (int t = 2; t <= 4; ++t) {
        float phase = static_cast<float>(t - 2) * 2.0f * kPi / 3.0f;
        fill_tile_height(t, [&](int lx, int ly) {
            float fx = static_cast<float>(lx);
            float fy = static_cast<float>(ly);
            return (std::sin(fx * 0.8f + phase) + std::sin(fy * 0.6f + phase * 0.7f)) * 2.0f;
        });
    }

    // Tiles 5-7: lava — turbulent flow
    for (int t = 5; t <= 7; ++t) {
        float phase = static_cast<float>(t - 5) * 2.0f * kPi / 3.0f;
        fill_tile_height(t, [&](int lx, int ly) {
            float fx = static_cast<float>(lx);
            float fy = static_cast<float>(ly);
            return (std::sin(fx * 1.2f + phase) * std::cos(fy * 0.9f + phase * 1.3f)
                    + std::sin((fx + fy) * 0.7f + phase)) * 2.5f;
        });
    }

    // Tiles 8-9: torch on wall — wall base + smooth center bump
    for (int t = 8; t <= 9; ++t) {
        fill_tile_height(t, [&](int lx, int ly) {
            // Wall base height
            float h = 2.0f;
            // Smooth center bump (flame area)
            float cx = static_cast<float>(lx) - 7.5f;
            float cy = static_cast<float>(ly) - 7.5f;
            float r2 = (cx * cx + cy * cy) / (7.0f * 7.0f);
            if (r2 < 1.0f) h += (1.0f - r2) * 2.5f;
            return h;
        });
    }

    // Convert heightmap → normal map using central differences
    for (int gy = 0; gy < kHeight; ++gy) {
        for (int gx = 0; gx < kWidth; ++gx) {
            // Determine which tile this pixel is in to clamp sampling
            int tile_col = gx / kTileW;
            int tile_row = gy / kTileH;
            int tile_x0 = tile_col * kTileW;
            int tile_y0 = tile_row * kTileH;

            auto sample_h = [&](int sx, int sy) -> float {
                sx = std::clamp(sx, tile_x0, tile_x0 + kTileW - 1);
                sy = std::clamp(sy, tile_y0, tile_y0 + kTileH - 1);
                return heightmap[sy * kWidth + sx];
            };

            float dhdx = sample_h(gx + 1, gy) - sample_h(gx - 1, gy);
            float dhdy = sample_h(gx, gy + 1) - sample_h(gx, gy - 1);

            // Normal = normalize(-dhdx, -dhdy, 1)
            float nx = -dhdx;
            float ny = -dhdy;
            float nz = 1.0f;
            float len = std::sqrt(nx * nx + ny * ny + nz * nz);
            nx /= len;
            ny /= len;
            nz /= len;

            // Encode to [0,255]: n * 0.5 + 0.5
            int idx = (gy * kWidth + gx) * kChannels;
            pixels[idx + 0] = static_cast<uint8_t>(std::clamp((nx * 0.5f + 0.5f) * 255.0f, 0.0f, 255.0f));
            pixels[idx + 1] = static_cast<uint8_t>(std::clamp((ny * 0.5f + 0.5f) * 255.0f, 0.0f, 255.0f));
            pixels[idx + 2] = static_cast<uint8_t>(std::clamp((nz * 0.5f + 0.5f) * 255.0f, 0.0f, 255.0f));
            pixels[idx + 3] = 255;
        }
    }

    // Fill unused tiles (10-23) with flat normal
    for (int t = 10; t < kCols * kRows; ++t) {
        auto [ox, oy] = tile_origin(t);
        for (int ly = 0; ly < kTileH; ++ly) {
            for (int lx = 0; lx < kTileW; ++lx) {
                int idx = ((oy + ly) * kWidth + (ox + lx)) * kChannels;
                pixels[idx + 0] = 128;
                pixels[idx + 1] = 128;
                pixels[idx + 2] = 255;
                pixels[idx + 3] = 255;
            }
        }
    }

    std::filesystem::create_directories("assets/textures");
    stbi_write_png("assets/textures/tileset_normal.png", kWidth, kHeight, kChannels,
                   pixels.data(), kWidth * kChannels);
}

void App::generate_player_normal() {
    // Must match player_sheet.png: 64×192 (4 frames × 12 rows of 16×16)
    constexpr int kFrameW = 16;
    constexpr int kFrameH = 16;
    constexpr int kFrames = 4;
    constexpr int kRows = 12;
    constexpr int kWidth = kFrameW * kFrames;   // 64
    constexpr int kHeight = kFrameH * kRows;    // 192
    constexpr int kChannels = 4;

    std::vector<uint8_t> pixels(kWidth * kHeight * kChannels, 0);

    // Per 16×16 frame: dome/pillow normal map
    for (int row = 0; row < kRows; ++row) {
        for (int frame = 0; frame < kFrames; ++frame) {
            int ox = frame * kFrameW;
            int oy = row * kFrameH;
            for (int ly = 0; ly < kFrameH; ++ly) {
                for (int lx = 0; lx < kFrameW; ++lx) {
                    float cx = (static_cast<float>(lx) - 7.5f) / 7.0f;
                    float cy = (static_cast<float>(ly) - 7.5f) / 7.0f;
                    float r2 = cx * cx + cy * cy;
                    float height = std::max(0.0f, 1.0f - r2);

                    // Central differences from the dome heightfield
                    float strength = 1.0f;
                    float nx = -strength * (-2.0f * cx / (7.0f)) * (r2 < 1.0f ? 1.0f : 0.0f);
                    float ny = -strength * (-2.0f * cy / (7.0f)) * (r2 < 1.0f ? 1.0f : 0.0f);
                    float nz = 1.0f;
                    // Suppress if outside dome
                    if (r2 >= 1.0f) {
                        nx = 0.0f;
                        ny = 0.0f;
                    }
                    float len = std::sqrt(nx * nx + ny * ny + nz * nz);
                    nx /= len;
                    ny /= len;
                    nz /= len;

                    int gx = ox + lx;
                    int gy = oy + ly;
                    int idx = (gy * kWidth + gx) * kChannels;
                    pixels[idx + 0] = static_cast<uint8_t>(std::clamp((nx * 0.5f + 0.5f) * 255.0f, 0.0f, 255.0f));
                    pixels[idx + 1] = static_cast<uint8_t>(std::clamp((ny * 0.5f + 0.5f) * 255.0f, 0.0f, 255.0f));
                    pixels[idx + 2] = static_cast<uint8_t>(std::clamp((nz * 0.5f + 0.5f) * 255.0f, 0.0f, 255.0f));
                    pixels[idx + 3] = 255;
                    (void)height;
                }
            }
        }
    }

    std::filesystem::create_directories("assets/textures");
    stbi_write_png("assets/textures/player_normal.png", kWidth, kHeight, kChannels,
                   pixels.data(), kWidth * kChannels);
}

void App::generate_audio_assets() {
    std::filesystem::create_directories("assets/audio");

    constexpr uint32_t kRate = 44100;
    constexpr float kPi = 3.14159265358979323846f;

    // Skip music WAV generation if external files already exist (e.g. from Stable Audio)
    bool has_external_music = std::filesystem::exists("assets/audio/music_bass.wav")
        && std::filesystem::file_size("assets/audio/music_bass.wav") > 500000;

    // 1. music_bass.wav — 4.0s low sine chord C2+G2 with tremolo
    if (!has_external_music) {
        uint32_t len = kRate * 4;
        std::vector<int16_t> samples(len);
        for (uint32_t i = 0; i < len; ++i) {
            float t = static_cast<float>(i) / kRate;
            float c2 = std::sin(2.0f * kPi * 65.41f * t);   // C2
            float g2 = std::sin(2.0f * kPi * 98.00f * t);   // G2
            float mix = (c2 + g2 * 0.7f) * 0.4f;
            float tremolo = 1.0f - 0.15f * std::sin(2.0f * kPi * 0.5f * t);
            // Fade in/out for seamless loop
            float env = 1.0f;
            float fade_dur = 0.05f * kRate;
            if (i < static_cast<uint32_t>(fade_dur)) env = static_cast<float>(i) / fade_dur;
            if (i > len - static_cast<uint32_t>(fade_dur)) env = static_cast<float>(len - i) / fade_dur;
            samples[i] = static_cast<int16_t>(mix * tremolo * env * 20000.0f);
        }
        write_wav("assets/audio/music_bass.wav", samples, kRate);
    }

    // 2. music_harmony.wav — 4.0s warm pad C3+E3+G3
    if (!has_external_music) {
        uint32_t len = kRate * 4;
        std::vector<int16_t> samples(len);
        for (uint32_t i = 0; i < len; ++i) {
            float t = static_cast<float>(i) / kRate;
            float c3 = std::sin(2.0f * kPi * 130.81f * t);
            float e3 = std::sin(2.0f * kPi * 164.81f * t + 0.5f);
            float g3 = std::sin(2.0f * kPi * 196.00f * t + 1.0f);
            float mix = (c3 + e3 * 0.8f + g3 * 0.6f) * 0.25f;
            float swell = 0.7f + 0.3f * std::sin(2.0f * kPi * 0.25f * t);
            float env = 1.0f;
            float fade_dur = 0.05f * kRate;
            if (i < static_cast<uint32_t>(fade_dur)) env = static_cast<float>(i) / fade_dur;
            if (i > len - static_cast<uint32_t>(fade_dur)) env = static_cast<float>(len - i) / fade_dur;
            samples[i] = static_cast<int16_t>(mix * swell * env * 20000.0f);
        }
        write_wav("assets/audio/music_harmony.wav", samples, kRate);
    }

    // 3. music_melody.wav — 4.0s pentatonic arpeggio
    if (!has_external_music) {
        uint32_t len = kRate * 4;
        std::vector<int16_t> samples(len);
        const float notes[] = {261.63f, 293.66f, 329.63f, 392.00f, 440.00f,
                                392.00f, 329.63f, 293.66f};  // C4 D4 E4 G4 A4 G4 E4 D4
        const float note_dur = 0.5f;
        for (uint32_t i = 0; i < len; ++i) {
            float t = static_cast<float>(i) / kRate;
            int note_idx = static_cast<int>(t / note_dur) % 8;
            float note_t = std::fmod(t, note_dur);
            float freq = notes[note_idx];
            float val = std::sin(2.0f * kPi * freq * t) * 0.35f;
            // Per-note envelope: attack 0.02s, sustain, release 0.05s
            float note_env = 1.0f;
            if (note_t < 0.02f) note_env = note_t / 0.02f;
            else if (note_t > note_dur - 0.05f) note_env = (note_dur - note_t) / 0.05f;
            float env = 1.0f;
            float fade_dur = 0.05f * kRate;
            if (i < static_cast<uint32_t>(fade_dur)) env = static_cast<float>(i) / fade_dur;
            if (i > len - static_cast<uint32_t>(fade_dur)) env = static_cast<float>(len - i) / fade_dur;
            samples[i] = static_cast<int16_t>(val * note_env * env * 20000.0f);
        }
        write_wav("assets/audio/music_melody.wav", samples, kRate);
    }

    // 4. music_percussion.wav — 2.0s soft kick + hi-hat at 120 BPM
    if (!has_external_music) {
        uint32_t len = kRate * 2;
        std::vector<int16_t> samples(len);
        const float beat_dur = 0.5f;  // 120 BPM
        uint32_t rng = 0xDEADBEEF;
        for (uint32_t i = 0; i < len; ++i) {
            float t = static_cast<float>(i) / kRate;
            float beat_t = std::fmod(t, beat_dur);
            float val = 0.0f;

            // Kick on beat
            if (beat_t < 0.08f) {
                float kick_env = std::exp(-beat_t * 50.0f);
                val += std::sin(2.0f * kPi * 60.0f * beat_t) * kick_env * 0.5f;
            }

            // Hi-hat on off-beat
            float offbeat_t = std::fmod(t + beat_dur * 0.5f, beat_dur);
            if (offbeat_t < 0.03f) {
                float hat_env = std::exp(-offbeat_t * 150.0f);
                rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5;
                float noise = static_cast<float>(static_cast<int32_t>(rng)) / 2147483648.0f;
                val += noise * hat_env * 0.25f;
            }

            float env = 1.0f;
            float fade_dur_f = 0.02f * kRate;
            if (i < static_cast<uint32_t>(fade_dur_f)) env = static_cast<float>(i) / fade_dur_f;
            if (i > len - static_cast<uint32_t>(fade_dur_f)) env = static_cast<float>(len - i) / fade_dur_f;
            samples[i] = static_cast<int16_t>(val * env * 24000.0f);
        }
        write_wav("assets/audio/music_percussion.wav", samples, kRate);
    }

    // 5. torch_crackle.wav — 2.0s random noise bursts
    {
        uint32_t len = kRate * 2;
        std::vector<int16_t> samples(len);
        uint32_t rng = 0xCAFEBABE;
        for (uint32_t i = 0; i < len; ++i) {
            rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5;
            float noise = static_cast<float>(static_cast<int32_t>(rng)) / 2147483648.0f;
            // Random amplitude modulation for crackling effect
            float t = static_cast<float>(i) / kRate;
            float burst = std::abs(std::sin(t * 25.0f)) * std::abs(std::sin(t * 37.0f));
            burst = burst * burst * burst;  // make it spiky
            float env = 1.0f;
            float fade_dur_f = 0.02f * kRate;
            if (i < static_cast<uint32_t>(fade_dur_f)) env = static_cast<float>(i) / fade_dur_f;
            if (i > len - static_cast<uint32_t>(fade_dur_f)) env = static_cast<float>(len - i) / fade_dur_f;
            samples[i] = static_cast<int16_t>(noise * burst * env * 15000.0f);
        }
        write_wav("assets/audio/torch_crackle.wav", samples, kRate);
    }

    // 6. footstep.wav — 0.15s short thud
    {
        uint32_t len = static_cast<uint32_t>(kRate * 0.15f);
        std::vector<int16_t> samples(len);
        uint32_t rng = 0x12345678;
        for (uint32_t i = 0; i < len; ++i) {
            float t = static_cast<float>(i) / kRate;
            rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5;
            float noise = static_cast<float>(static_cast<int32_t>(rng)) / 2147483648.0f;
            float env = std::exp(-t * 30.0f);
            samples[i] = static_cast<int16_t>(noise * env * 18000.0f);
        }
        write_wav("assets/audio/footstep.wav", samples, kRate);
    }

    // 7. dialog_open.wav — 0.2s rising sweep 300→600 Hz
    {
        uint32_t len = static_cast<uint32_t>(kRate * 0.2f);
        std::vector<int16_t> samples(len);
        for (uint32_t i = 0; i < len; ++i) {
            float t = static_cast<float>(i) / kRate;
            float frac = t / 0.2f;
            float freq = 300.0f + 300.0f * frac;
            float val = std::sin(2.0f * kPi * freq * t) * 0.4f;
            float env = 1.0f - frac;
            env = std::sqrt(env);
            samples[i] = static_cast<int16_t>(val * env * 20000.0f);
        }
        write_wav("assets/audio/dialog_open.wav", samples, kRate);
    }

    // 8. dialog_close.wav — 0.2s falling sweep 600→300 Hz
    {
        uint32_t len = static_cast<uint32_t>(kRate * 0.2f);
        std::vector<int16_t> samples(len);
        for (uint32_t i = 0; i < len; ++i) {
            float t = static_cast<float>(i) / kRate;
            float frac = t / 0.2f;
            float freq = 600.0f - 300.0f * frac;
            float val = std::sin(2.0f * kPi * freq * t) * 0.4f;
            float env = 1.0f - frac;
            env = std::sqrt(env);
            samples[i] = static_cast<int16_t>(val * env * 20000.0f);
        }
        write_wav("assets/audio/dialog_close.wav", samples, kRate);
    }

    // 9. dialog_blip.wav — 0.05s square wave blip at 440 Hz
    {
        uint32_t len = static_cast<uint32_t>(kRate * 0.05f);
        std::vector<int16_t> samples(len);
        for (uint32_t i = 0; i < len; ++i) {
            float t = static_cast<float>(i) / kRate;
            float val = std::sin(2.0f * kPi * 440.0f * t) > 0.0f ? 0.3f : -0.3f;
            float env = 1.0f - t / 0.05f;
            samples[i] = static_cast<int16_t>(val * env * 20000.0f);
        }
        write_wav("assets/audio/dialog_blip.wav", samples, kRate);
    }
}

void App::set_start_state(std::unique_ptr<GameState> state) {
    custom_start_state_ = std::move(state);
}

void App::init_subsystems() {
    init_window();
    generate_player_sheet();
    generate_tileset();
    generate_particle_atlas();
    generate_background_textures();
    generate_shadow_texture();
    generate_flat_normal_texture();
    generate_tileset_normal();
    generate_player_normal();
    generate_audio_assets();

    // Load locale and build font atlas from all text
    locale_.load("assets/locales", "en");
    std::set<uint32_t> codepoint_set;
    for (const auto& str : locale_.all_strings()) {
        collect_codepoints(str, codepoint_set);
    }
    // Always include basic ASCII printable range
    for (uint32_t cp = 32; cp <= 126; cp++) {
        codepoint_set.insert(cp);
    }
    std::vector<uint32_t> codepoints(codepoint_set.begin(), codepoint_set.end());
    font_atlas_.init("assets/fonts/NotoSans-Regular.ttf", 32.0f, codepoints);
    text_renderer_.init(font_atlas_);

    renderer_.init(window_, resources_);
    renderer_.init_font(font_atlas_, resources_);
    renderer_.init_particles(resources_);
    renderer_.init_shadows(resources_);

    // Load background textures with REPEAT sampler for parallax tiling
    {
        std::vector<ResourceHandle<Texture>> bg_textures;
        bg_textures.push_back(resources_.load_texture(
            "assets/textures/bg_sky.png", VK_FILTER_LINEAR, VK_SAMPLER_ADDRESS_MODE_REPEAT));
        bg_textures.push_back(resources_.load_texture(
            "assets/textures/bg_mountains.png", VK_FILTER_LINEAR, VK_SAMPLER_ADDRESS_MODE_REPEAT));
        bg_textures.push_back(resources_.load_texture(
            "assets/textures/bg_trees.png", VK_FILTER_LINEAR, VK_SAMPLER_ADDRESS_MODE_REPEAT));
        renderer_.init_backgrounds(bg_textures);
    }

    ui_ctx_.init(font_atlas_, text_renderer_);
    audio_.init("assets");
    control_server_.start();

    // Initialize Wren scripting
    wren_vm_.init(this);
    register_wren_bindings(wren_vm_);
    wren_vm_.load_module("engine", "assets/scripts/engine.wren");
    script_system_.init(this, &wren_vm_);
}

void App::run() {
    init_subsystems();

    if (custom_start_state_) {
        state_stack_.push(std::move(custom_start_state_), *this);
    } else {
        state_stack_.push(std::make_unique<TitleState>(), *this);
    }
    main_loop();
    cleanup();
}

void App::init_window() {
    glfwInit();
    glfwWindowHint(GLFW_CLIENT_API, GLFW_NO_API);
    glfwWindowHint(GLFW_RESIZABLE, GLFW_FALSE);

    window_ = glfwCreateWindow(kWindowWidth, kWindowHeight, "Vulkan Game", nullptr, nullptr);
    input_.set_window(window_);
}

void App::init_scene(const std::string& scene_path) {
    current_scene_path_ = scene_path;
    auto scene_data = SceneLoader::load(scene_path);

    // Animation setup: data-driven from character manifest, or hardcoded fallback
    auto setup_anim = [](ecs::Animation& anim_comp, const std::string& character_id) {
        if (!character_id.empty()) {
            std::string anim_path = "assets/characters/" + character_id + "/animations.json";
            auto char_data = load_character_anims(anim_path);
            if (char_data) {
                anim_comp.state_machine.configure(char_data->tileset);
                for (auto& clip : char_data->clips) {
                    anim_comp.state_machine.add_clip(std::move(clip));
                }
                return;
            }
        }
        // Hardcoded fallback
        anim_comp.state_machine.configure(Tileset{16, 16, 4, 64, 192});
        const std::array<std::string, 3> states    = {"idle", "walk", "run"};
        const std::array<std::string, 4> dirs      = {"down", "left", "right", "up"};
        const std::array<float, 3> durations       = {0.30f, 0.12f, 0.07f};
        for (int s = 0; s < 3; ++s) {
            for (int d = 0; d < 4; ++d) {
                AnimationClip clip;
                clip.name    = states[s] + "_" + dirs[d];
                clip.looping = true;
                uint32_t base = static_cast<uint32_t>((s * 4 + d) * 4);
                for (uint32_t f = 0; f < 4; ++f)
                    clip.frames.push_back(AnimationFrame{base + f, durations[s]});
                anim_comp.state_machine.add_clip(std::move(clip));
            }
        }
    };

    // Footstep emitter from scene data
    size_t footstep_eid = particles_.add_emitter(scene_data.footstep_emitter, {0.0f, 0.0f});
    particles_.set_emitter_active(footstep_eid, false);

    // Create player entity from scene data
    {
        ecs::Animation player_anim;
        setup_anim(player_anim, scene_data.player_character_id);
        std::string initial_clip = "idle_" + std::string(direction_suffix(scene_data.player_facing));
        player_anim.state_machine.transition_to(initial_clip);

        ecs::Sprite sprite;
        sprite.tint = scene_data.player_tint;
        sprite.uv_min = player_anim.state_machine.current_uv_min();
        sprite.uv_max = player_anim.state_machine.current_uv_max();

        player_id_ = world_.create();
        world_.add<ecs::Transform>(player_id_, ecs::Transform{scene_data.player_position, {1.0f, 1.0f}});
        world_.add<ecs::Sprite>(player_id_, sprite);
        world_.add<ecs::PlayerTag>(player_id_);
        world_.add<ecs::Facing>(player_id_, ecs::Facing{scene_data.player_facing});
        world_.add<ecs::Animation>(player_id_, std::move(player_anim));
        world_.add<ecs::FootstepEmitterRef>(player_id_, ecs::FootstepEmitterRef{footstep_eid});
    }

    renderer_.camera().set_follow_target(world_.get<ecs::Transform>(player_id_).position);
    renderer_.camera().set_follow_speed(5.0f);

    // NPC dialog scripts from scene data
    npc_dialogs_.resize(scene_data.npcs.size());
    for (size_t i = 0; i < scene_data.npcs.size(); i++) {
        npc_dialogs_[i] = scene_data.npcs[i].dialog;
    }

    // Create NPC entities from scene data
    npc_ids_.reserve(scene_data.npcs.size());
    for (size_t i = 0; i < scene_data.npcs.size(); ++i) {
        const auto& npc_data = scene_data.npcs[i];

        ecs::Animation npc_anim;
        setup_anim(npc_anim, npc_data.character_id);
        std::string initial_clip = "walk_" + std::string(direction_suffix(npc_data.facing));
        npc_anim.state_machine.transition_to(initial_clip);

        ecs::Sprite sprite;
        sprite.tint = npc_data.tint;
        sprite.uv_min = npc_anim.state_machine.current_uv_min();
        sprite.uv_max = npc_anim.state_machine.current_uv_max();

        // NPC aura emitter: use template with NPC-specific colors
        EmitterConfig aura_cfg = scene_data.npc_aura_emitter;
        aura_cfg.color_start = npc_data.aura_color_start;
        aura_cfg.color_end = npc_data.aura_color_end;
        size_t aura_eid = particles_.add_emitter(aura_cfg, {npc_data.position.x, npc_data.position.y});

        auto npc = world_.create();
        world_.add<ecs::Transform>(npc, ecs::Transform{npc_data.position, {1.0f, 1.0f}});
        world_.add<ecs::Sprite>(npc, sprite);
        world_.add<ecs::Facing>(npc, ecs::Facing{npc_data.facing});
        world_.add<ecs::Animation>(npc, std::move(npc_anim));
        if (!npc_data.waypoints.empty()) {
            ecs::NpcWaypoints waypoints;
            waypoints.waypoints = npc_data.waypoints;
            waypoints.pause_duration = npc_data.waypoint_pause;
            waypoints.speed = npc_data.patrol_speed;
            world_.add<ecs::NpcWaypoints>(npc, std::move(waypoints));
        } else {
            world_.add<ecs::NpcPatrol>(npc, ecs::NpcPatrol{
                npc_data.facing, npc_data.reverse_facing, 0.0f,
                npc_data.patrol_interval, npc_data.patrol_speed});
        }
        world_.add<ecs::DialogRef>(npc, ecs::DialogRef{i});
        world_.add<ecs::DynamicLight>(npc, ecs::DynamicLight{npc_data.light_color, npc_data.light_radius});
        world_.add<ecs::ParticleEmitterRef>(npc, ecs::ParticleEmitterRef{aura_eid});

        // Attach script if specified in scene data
        if (!npc_data.script_module.empty()) {
            wren_vm_.load_module(npc_data.script_module,
                "assets/scripts/" + npc_data.script_module + ".wren");
            world_.add<ecs::ScriptRef>(npc, ecs::ScriptRef{
                npc_data.script_module, npc_data.script_class});
        }

        npc_ids_.push_back(npc);
    }

    // Gaussian splatting from scene data
    if (scene_data.gaussian_splat) {
        const auto& gs = *scene_data.gaussian_splat;
        auto cloud = GaussianCloud::load_ply(gs.ply_file);
        if (!cloud.empty()) {
            renderer_.init_gs(cloud, gs.render_width, gs.render_height);

            // Set up 3D perspective camera for GS rendering
            float aspect = static_cast<float>(gs.render_width) / static_cast<float>(gs.render_height);
            auto gs_view = glm::lookAt(gs.camera_position, gs.camera_target, glm::vec3(0, 1, 0));
            auto gs_proj = glm::perspective(glm::radians(gs.camera_fov), aspect, 0.1f, 100.0f);
            gs_proj[1][1] *= -1.0f;  // Vulkan Y-flip
            renderer_.set_gs_camera(gs_view, gs_proj);
        }
    }

    // Collision grid from scene data (used in place of tilemap collision)
    if (scene_data.collision) {
        collision_grid_ = *scene_data.collision;
    }

    // Tilemap from scene data
    scene_.set_tile_layer(std::move(scene_data.tilemap));
    scene_.set_ambient_color(scene_data.ambient_color);

    // Tile animator from scene data
    if (!scene_data.tile_animations.empty()) {
        TileAnimator animator;
        for (auto& def : scene_data.tile_animations) {
            animator.add_definition(std::move(def));
        }
        scene_.set_tile_animator(std::move(animator));
    }

    // Background parallax layers from scene data
    {
        std::vector<ParallaxLayer> bg_layers;
        for (const auto& layer_data : scene_data.background_layers) {
            ParallaxLayer layer;
            layer.z = layer_data.z;
            layer.parallax_factor = layer_data.parallax_factor;
            layer.quad_width = layer_data.quad_width;
            layer.quad_height = layer_data.quad_height;
            layer.uv_repeat_x = layer_data.uv_repeat_x;
            layer.uv_repeat_y = layer_data.uv_repeat_y;
            layer.tint = layer_data.tint;
            layer.wall = layer_data.wall;
            layer.wall_y_offset = layer_data.wall_y_offset;
            bg_layers.push_back(layer);
        }
        scene_.set_background_layers(std::move(bg_layers));
    }

    // Torch emitters from scene data
    for (size_t i = 0; i < scene_data.torch_positions.size() && i < 4; ++i) {
        torch_emitter_ids_[i] = particles_.add_emitter(
            scene_data.torch_emitter, scene_data.torch_positions[i]);
    }

    // Weather system from scene data
    if (scene_data.weather.enabled) {
        WeatherConfig weather_cfg;
        if (scene_data.weather.type == "rain") {
            weather_cfg.type = WeatherType::Rain;
        } else if (scene_data.weather.type == "snow") {
            weather_cfg.type = WeatherType::Snow;
        }
        weather_cfg.emitter = scene_data.weather.emitter;
        weather_cfg.ambient_override = scene_data.weather.ambient_override;
        weather_cfg.fog_density = scene_data.weather.fog_density;
        weather_cfg.fog_color = scene_data.weather.fog_color;
        weather_cfg.transition_speed = scene_data.weather.transition_speed;
        weather_system_.init(particles_, scene_, weather_cfg);
    }

    // Day/night system from scene data
    day_night_system_.init(scene_data.day_night);

    // Audio: position torch crackle instances
    for (size_t i = 0; i < scene_data.torch_audio_positions.size() && i < 4; ++i) {
        audio_.set_torch_position(static_cast<uint32_t>(i), scene_data.torch_audio_positions[i]);
    }

    // Minimap config
    if (scene_data.minimap_config) {
        minimap_.set_config(*scene_data.minimap_config);
    }

    // Store portals for transition checking
    portals_ = std::move(scene_data.portals);

    // Store scene data for round-trip serialization
    scene_npc_data_ = scene_data.npcs;
    static_lights_ = scene_data.static_lights;
}

void App::clear_scene() {
    // Destroy all ECS entities
    world_.clear();
    player_id_ = ecs::kNullEntity;
    npc_ids_.clear();
    npc_dialogs_.clear();
    entity_sprites_.clear();
    shadow_sprites_.clear();
    reflection_sprites_.clear();

    // Clear particles, weather, and day/night
    particles_.clear();
    weather_system_.reset();
    day_night_system_.reset();
    for (auto& id : torch_emitter_ids_) id = 0;

    // Clear collision grid
    collision_grid_ = {};

    // Reset scene state
    scene_.clear_lights();
    scene_.set_fog_density(0.0f);
    scene_.set_background_layers({});
    scene_.set_tile_animator({});

    // Reset portals
    portals_.clear();

    // Reset scene data storage
    scene_npc_data_.clear();
    static_lights_.clear();

    // Reset dialog/game mode
    game_mode_ = GameMode::Explore;
    dialog_state_ = {};
}

void App::check_portals() {
    if (!player_id_.valid()) return;

    const auto& player_pos = world_.get<ecs::Transform>(player_id_).position;

    for (const auto& portal : portals_) {
        float dx = player_pos.x - portal.position.x;
        float dy = player_pos.y - portal.position.y;
        float hw = portal.size.x * 0.5f;
        float hh = portal.size.y * 0.5f;

        if (std::abs(dx) < hw && std::abs(dy) < hh) {
            state_stack_.push(std::make_unique<TransitionState>(
                portal.target_scene, portal.spawn_position, portal.spawn_facing), *this);
            return;
        }
    }
}

void App::update_game(float dt) {
    if (transitioning_) return;

    if (game_mode_ == GameMode::Dialog) {
        // Dialog mode: freeze movement, handle advance
        if (input_.was_key_pressed(GLFW_KEY_E) || input_.was_key_pressed(GLFW_KEY_SPACE)) {
            if (!dialog_state_.advance()) {
                game_mode_ = GameMode::Explore;
                audio_.play(SoundId::DialogClose);
                emit_event("dialog_ended");
            } else {
                audio_.play(SoundId::DialogBlip);
                emit_event("dialog_advanced", {{"line", dialog_state_.current_line}});
            }
        }

        // Still update animations (idle) but don't move
        ecs::systems::animation_update(world_, dt);

        // Build dialog UI sprites via UIContext
        if (dialog_state_.active) {
            const auto& line = dialog_state_.current();
            const auto& speaker = locale_.get(line.speaker_key);
            const auto& text = locale_.get(line.text_key);
            const auto& prompt = locale_.get("prompt_continue");

            ui_ctx_.panel(640.0f, 610.0f, 1200.0f, 180.0f, {0.05f, 0.05f, 0.12f, 0.88f});
            ui_ctx_.label(speaker, 60.0f, 535.0f, 0.8f, {1.0f, 0.85f, 0.2f, 1.0f});
            ui_ctx_.label(prompt, 1180.0f, 680.0f, 0.5f, {0.7f, 0.7f, 0.7f, 1.0f});

            // Append UIContext draw list to UI sprites
            const auto& dl = ui_ctx_.draw_list();
            ui_sprites_.insert(ui_sprites_.end(), dl.begin(), dl.end());

            // Wrapped text goes directly (UIContext doesn't have render_wrapped)
            auto text_sprites = text_renderer_.render_wrapped(
                text, 60.0f, 580.0f, 0.0f, 0.6f, {1.0f, 1.0f, 1.0f, 1.0f}, 1160.0f, true);
            ui_sprites_.insert(ui_sprites_.end(), text_sprites.begin(), text_sprites.end());
        }
    } else if (player_id_.valid()) {
        // === Explore mode ===
        auto move_result = ecs::systems::player_movement(world_, input_, dt);

        if (scene_.tile_layer().has_value()) {
            ecs::systems::player_collision(world_, *scene_.tile_layer());
        }

        // Check portals for scene transitions
        if (feature_flags_.scene_transitions) {
            check_portals();
            if (transitioning_) return;
        }

        auto& player_pos = world_.get<ecs::Transform>(player_id_).position;
        renderer_.camera().set_follow_target(player_pos);

        auto& player_facing = world_.get<ecs::Facing>(player_id_);
        const char* dir_str = direction_suffix(player_facing.dir);

        const std::string state_prefix = move_result.sprinting ? "run"
                                       : move_result.moving    ? "walk"
                                                               : "idle";
        auto& player_anim = world_.get<ecs::Animation>(player_id_);
        player_anim.state_machine.transition_to(state_prefix + "_" + dir_str);

        // NPC patrol + pathfinding
        if (feature_flags_.npc_patrol && scene_.tile_layer().has_value()) {
            ecs::systems::npc_patrol(world_, *scene_.tile_layer(), dt);
            ecs::systems::npc_pathfind(world_, *scene_.tile_layer(), dt);
        }

        // Wren script system (runs update on entities with ScriptRef)
        script_system_.update(dt);
        script_system_.check_hot_reload();

        // Update all animations
        if (feature_flags_.animation) {
            ecs::systems::animation_update(world_, dt);
        }

        // Proximity detection: find nearest NPC within interaction range
        constexpr float kInteractRange = 1.5f;
        int nearest_npc = -1;
        float nearest_dist_sq = kInteractRange * kInteractRange;

        for (size_t i = 0; i < npc_ids_.size(); i++) {
            const auto& npc_pos = world_.get<ecs::Transform>(npc_ids_[i]).position;
            float dx = npc_pos.x - player_pos.x;
            float dy = npc_pos.y - player_pos.y;
            float dist_sq = dx * dx + dy * dy;
            if (dist_sq < nearest_dist_sq) {
                nearest_dist_sq = dist_sq;
                nearest_npc = static_cast<int>(i);
            }
        }

        // Show interaction prompt above nearest NPC
        if (nearest_npc >= 0) {
            const auto& npc_pos = world_.get<ecs::Transform>(npc_ids_[nearest_npc]).position;
            auto prompt_sprites = text_renderer_.render_text(
                locale_.get("prompt_interact"),
                npc_pos.x - 0.2f, npc_pos.y + 0.7f, -0.1f,
                0.02f, {1.0f, 0.9f, 0.2f, 1.0f});
            overlay_sprites_.insert(overlay_sprites_.end(),
                                    prompt_sprites.begin(), prompt_sprites.end());

            // Interact on E press
            if (input_.was_key_pressed(GLFW_KEY_E)) {
                const auto& dialog_ref = world_.get<ecs::DialogRef>(npc_ids_[nearest_npc]);
                size_t di = dialog_ref.dialog_index;
                if (di < npc_dialogs_.size()) {
                    dialog_state_.start(npc_dialogs_[di]);
                    game_mode_ = GameMode::Dialog;
                    audio_.play(SoundId::DialogOpen);
                    emit_event("dialog_started", {{"npc_index", nearest_npc}});

                    // Transition player to idle
                    player_anim.state_machine.transition_to(std::string("idle_") + dir_str);
                }
            }
        }
    }

    // Animated tiles (runs in both explore and dialog modes so water keeps flowing)
    if (feature_flags_.animated_tiles && scene_.tile_animator()) {
        scene_.tile_animator()->update(dt);
    }

    // Day/night cycle (before weather so weather can lerp from day/night base)
    if (feature_flags_.day_night_cycle && day_night_system_.active()) {
        day_night_system_.update(dt, scene_,
            (feature_flags_.weather && weather_system_.active()) ? &weather_system_ : nullptr);
    }

    // Weather system update (before particles, updates ambient + fog)
    if (feature_flags_.weather && weather_system_.active()) {
        const auto& cam = renderer_.camera();
        weather_system_.update(dt, scene_, {cam.target().x, cam.target().y});
    }

    // ECS systems: particles, lighting, sprite collection
    if (feature_flags_.particles) {
        const bool moving = input_.is_key_down(GLFW_KEY_W) || input_.is_key_down(GLFW_KEY_A) ||
                            input_.is_key_down(GLFW_KEY_S) || input_.is_key_down(GLFW_KEY_D);
        ecs::systems::particle_sync(world_, particles_, moving && game_mode_ == GameMode::Explore);
        particles_.update(dt);
    }
    float torch_mul = (feature_flags_.day_night_cycle && day_night_system_.active())
        ? day_night_system_.torch_intensity() : 1.0f;
    ecs::systems::lighting_rebuild(world_, scene_, feature_flags_.npc_lights, torch_mul);
    screen_effects_.update(dt);
    ecs::systems::sprite_collect(world_, entity_sprites_, feature_flags_.y_sort_depth);
    if (feature_flags_.sprite_outlines) {
        ecs::systems::outline_collect(world_, outline_sprites_, 0.06f, feature_flags_.y_sort_depth);
    } else {
        outline_sprites_.clear();
    }
    if (feature_flags_.blob_shadows) {
        ecs::systems::shadow_collect(world_, shadow_sprites_, feature_flags_.y_sort_depth);
    } else {
        shadow_sprites_.clear();
    }
    if (feature_flags_.water_reflections && scene_.tile_layer().has_value()) {
        ecs::systems::reflection_collect(world_, *scene_.tile_layer(), reflection_sprites_, feature_flags_.y_sort_depth);
    } else {
        reflection_sprites_.clear();
    }

    // Minimap
    if (feature_flags_.minimap && scene_.tile_layer().has_value()) {
        auto* player_tf = world_.try_get<ecs::Transform>(player_id_);
        glm::vec2 player_pos = player_tf ? glm::vec2(player_tf->position.x, player_tf->position.y)
                                         : glm::vec2(0.0f);

        std::vector<std::pair<glm::vec2, glm::vec4>> npc_markers;
        for (auto npc : npc_ids_) {
            auto* tf = world_.try_get<ecs::Transform>(npc);
            auto* spr = world_.try_get<ecs::Sprite>(npc);
            if (tf && spr) {
                npc_markers.push_back({{tf->position.x, tf->position.y}, spr->tint});
            }
        }

        minimap_sprites_.clear();
        minimap_.build_sprites(*scene_.tile_layer(), player_pos, npc_markers, minimap_sprites_);
    } else {
        minimap_sprites_.clear();
    }

    update_audio(dt);
}

void App::update_audio(float dt) {
    // Apply feature flags to audio
    audio_.set_music_muted(!feature_flags_.music);
    audio_.set_sfx_muted(!feature_flags_.sfx);

    // Update listener from camera
    const auto& cam = renderer_.camera();
    glm::vec3 cam_pos = cam.position();
    glm::vec3 cam_target = cam.target();
    glm::vec3 forward = glm::normalize(cam_target - cam_pos);
    audio_.set_listener(cam_pos, forward, {0.0f, 1.0f, 0.0f});

    // Compute NPC proximity (min distance from player to any NPC)
    float min_dist = 100.0f;
    if (player_id_.valid()) {
        const auto& player_pos = world_.get<ecs::Transform>(player_id_).position;
        for (auto npc : npc_ids_) {
            const auto& npc_pos = world_.get<ecs::Transform>(npc).position;
            float dx = npc_pos.x - player_pos.x;
            float dy = npc_pos.y - player_pos.y;
            float dist = std::sqrt(dx * dx + dy * dy);
            if (dist < min_dist) min_dist = dist;
        }
    }
    float proximity = std::clamp(1.0f - min_dist / 8.0f, 0.0f, 1.0f);
    audio_.set_npc_proximity(proximity);

    // Compute player speed
    const bool moving = input_.is_key_down(GLFW_KEY_W) || input_.is_key_down(GLFW_KEY_A) ||
                        input_.is_key_down(GLFW_KEY_S) || input_.is_key_down(GLFW_KEY_D);
    const bool sprinting = moving && input_.is_key_down(GLFW_KEY_LEFT_SHIFT);
    float current_speed = sprinting ? 8.0f : (moving ? 4.0f : 0.0f);
    audio_.set_player_speed(std::clamp(current_speed / 8.0f, 0.0f, 1.0f));

    // Set music state
    if (game_mode_ == GameMode::Dialog) {
        audio_.set_music_state(MusicState::Dialog);
    } else if (proximity > 0.3f) {
        audio_.set_music_state(MusicState::NearNPC);
    } else {
        audio_.set_music_state(MusicState::Explore);
    }

    // Footstep timing
    if (moving && game_mode_ == GameMode::Explore) {
        float interval = sprinting ? 0.25f : 0.45f;
        footstep_timer_ += dt;
        if (footstep_timer_ >= interval) {
            audio_.play(SoundId::Footstep);
            footstep_timer_ -= interval;
        }
        was_moving_ = true;
    } else {
        if (was_moving_) {
            footstep_timer_ = 0.0f;
            was_moving_ = false;
        }
    }

    audio_.update(dt);
}

void App::main_loop() {
    last_update_time_ = std::chrono::steady_clock::now();

    while (!glfwWindowShouldClose(window_)) {
        glfwPollEvents();

        // Handle client disconnect → revert to realtime
        if (!control_server_.has_client() && step_mode_) {
            step_mode_ = false;
            pending_steps_ = 0;
            input_.clear_injections();
        }

        process_commands();

        // Clear draw lists at frame start (states will rebuild them)
        overlay_sprites_.clear();
        ui_sprites_.clear();

        if (step_mode_) {
            // Step mode: only update input + game when there are pending steps.
            bool did_step = pending_steps_ > 0;
            while (pending_steps_ > 0) {
                input_.update();
                state_stack_.update(*this, kFixedDt);
                tick_++;
                pending_steps_--;
            }
            if (did_step) {
                control_server_.send(build_state_json());
            }
        } else {
            // Realtime mode
            input_.update();

            auto now = std::chrono::steady_clock::now();
            float dt = std::chrono::duration<float>(now - last_update_time_).count();
            last_update_time_ = now;

            if (dt > 0.1f) dt = 0.1f;

            state_stack_.update(*this, dt);
            play_time_ += dt;
            tick_++;
        }

        // Feed UI context with input state
        {
            ui::UIInput ui_input;
            ui_input.mouse_pos = input_.mouse_pos();
            ui_input.mouse_down = input_.is_mouse_down(0);
            ui_input.mouse_pressed = input_.was_mouse_pressed(0);
            ui_input.key_up = input_.was_key_pressed(GLFW_KEY_UP) || input_.was_key_pressed(GLFW_KEY_W);
            ui_input.key_down_nav = input_.was_key_pressed(GLFW_KEY_DOWN) || input_.was_key_pressed(GLFW_KEY_S);
            ui_input.key_enter = input_.was_key_pressed(GLFW_KEY_ENTER) || input_.was_key_pressed(GLFW_KEY_SPACE);
            ui_input.key_escape = input_.was_key_pressed(GLFW_KEY_ESCAPE);
            ui_input.scroll_delta = input_.scroll_y_delta();
            ui_ctx_.set_screen_height(720.0f);
            ui_ctx_.begin_frame(ui_input);
        }

        // Let states build their draw lists
        state_stack_.build_draw_lists(*this);

        // Always render
        std::vector<SpriteDrawInfo> particle_sprites;
        particles_.generate_draw_infos(particle_sprites);

        // Build UI batches: flat ui_sprites_ (dialog etc.) + UIContext batches (menus, scroll areas)
        std::vector<ui::UIDrawBatch> ui_batches;
        if (!ui_sprites_.empty()) {
            ui_batches.push_back(ui::UIDrawBatch{ui_sprites_, std::nullopt});
        }
        const auto& ctx_batches = ui_ctx_.draw_batches();
        for (const auto& b : ctx_batches) {
            if (!b.sprites.empty()) ui_batches.push_back(b);
        }
        if (feature_flags_.minimap && !minimap_sprites_.empty()) {
            ui_batches.push_back(ui::UIDrawBatch{minimap_sprites_, std::nullopt});
        }

        // Pass screen effects to renderer
        if (feature_flags_.screen_effects) {
            auto fc = screen_effects_.flash_color() * screen_effects_.flash_alpha();
            renderer_.set_ca_intensity(screen_effects_.ca_intensity());
            renderer_.set_flash_color(fc.r, fc.g, fc.b);
        } else {
            renderer_.set_ca_intensity(0.0f);
            renderer_.set_flash_color(0.0f, 0.0f, 0.0f);
        }

        renderer_.draw_scene(scene_, entity_sprites_, outline_sprites_, reflection_sprites_,
                             shadow_sprites_, particle_sprites, overlay_sprites_, ui_batches,
                             feature_flags_);

        // Send screenshot response after draw completes
        if (!screenshot_response_path_.empty()) {
            if (renderer_.screenshot_write_ok()) {
                control_server_.send({{"type", "screenshot"},
                                      {"path", screenshot_response_path_},
                                      {"width", renderer_.screenshot_width()},
                                      {"height", renderer_.screenshot_height()}});
            } else {
                control_server_.send({{"type", "error"},
                                      {"message", "Failed to write screenshot to: " + screenshot_response_path_}});
            }
            screenshot_response_path_.clear();
        }
    }
}

void App::process_commands() {
    auto commands = control_server_.poll();
    for (const auto& cmd_json : commands) {
        if (!cmd_json.contains("cmd") || !cmd_json["cmd"].is_string()) {
            control_server_.send({{"type", "error"}, {"message", "missing 'cmd' field"}});
            continue;
        }

        const std::string cmd = cmd_json["cmd"];

        if (cmd == "get_state") {
            control_server_.send(build_state_json());
        } else if (cmd == "get_map") {
            control_server_.send(build_map_json());
        } else if (cmd == "move") {
            // Clear previous movement injections
            input_.inject_key(GLFW_KEY_W, false);
            input_.inject_key(GLFW_KEY_A, false);
            input_.inject_key(GLFW_KEY_S, false);
            input_.inject_key(GLFW_KEY_D, false);
            input_.inject_key(GLFW_KEY_LEFT_SHIFT, false);

            if (cmd_json.contains("direction") && cmd_json["direction"].is_string()) {
                const std::string dir = cmd_json["direction"];
                if (dir == "up")         input_.inject_key(GLFW_KEY_W, true);
                else if (dir == "left")  input_.inject_key(GLFW_KEY_A, true);
                else if (dir == "down")  input_.inject_key(GLFW_KEY_S, true);
                else if (dir == "right") input_.inject_key(GLFW_KEY_D, true);
            }

            bool sprint = cmd_json.value("sprint", false);
            input_.inject_key(GLFW_KEY_LEFT_SHIFT, sprint);

            control_server_.send({{"type", "ok"}});
        } else if (cmd == "stop") {
            input_.clear_injections();
            control_server_.send({{"type", "ok"}});
        } else if (cmd == "interact") {
            input_.inject_key_once(GLFW_KEY_E);
            control_server_.send({{"type", "ok"}});
        } else if (cmd == "set_mode") {
            if (cmd_json.contains("mode") && cmd_json["mode"].is_string()) {
                const std::string mode = cmd_json["mode"];
                if (mode == "step") {
                    step_mode_ = true;
                    pending_steps_ = 0;
                    last_update_time_ = std::chrono::steady_clock::now();
                    control_server_.send({{"type", "ok"}});
                } else if (mode == "realtime") {
                    step_mode_ = false;
                    pending_steps_ = 0;
                    last_update_time_ = std::chrono::steady_clock::now();
                    control_server_.send({{"type", "ok"}});
                } else {
                    control_server_.send({{"type", "error"},
                                          {"message", "unknown mode: " + mode}});
                }
            } else {
                control_server_.send({{"type", "error"}, {"message", "missing 'mode' field"}});
            }
        } else if (cmd == "step") {
            if (!step_mode_) {
                control_server_.send({{"type", "error"},
                                      {"message", "not in step mode"}});
            } else {
                int frames = cmd_json.value("frames", 1);
                if (frames < 1) frames = 1;
                if (frames > 600) frames = 600;
                pending_steps_ += frames;
                // State will be sent after steps are consumed in main_loop
            }
        } else if (cmd == "screenshot") {
            if (cmd_json.contains("path") && cmd_json["path"].is_string()) {
                std::string path = cmd_json["path"];
                renderer_.request_screenshot(path);
                screenshot_response_path_ = path;
                // Response sent after draw_scene completes
            } else {
                control_server_.send({{"type", "error"},
                                      {"message", "missing 'path' field"}});
            }
        } else if (cmd == "shake") {
            float amplitude = cmd_json.value("amplitude", 0.5f);
            float frequency = cmd_json.value("frequency", 15.0f);
            float duration = cmd_json.value("duration", 0.4f);
            renderer_.camera().trigger_shake(amplitude, frequency, duration);
            control_server_.send({{"type", "ok"}});
        } else if (cmd == "zoom") {
            float target = cmd_json.value("target", 1.0f);
            renderer_.camera().set_target_zoom(target);
            control_server_.send({{"type", "ok"}});
        } else if (cmd == "flash") {
            float r = 1.0f, g = 1.0f, b = 1.0f;
            if (cmd_json.contains("color") && cmd_json["color"].is_array() &&
                cmd_json["color"].size() >= 3) {
                r = cmd_json["color"][0];
                g = cmd_json["color"][1];
                b = cmd_json["color"][2];
            }
            float duration = cmd_json.value("duration", 0.15f);
            screen_effects_.trigger_flash({r, g, b}, duration);
            control_server_.send({{"type", "ok"}});
        } else if (cmd == "chromatic") {
            float intensity = cmd_json.value("intensity", 0.008f);
            float duration = cmd_json.value("duration", 0.3f);
            screen_effects_.trigger_chromatic_pulse(intensity, duration);
            control_server_.send({{"type", "ok"}});
        } else if (cmd == "set_time") {
            float t = cmd_json.value("time", 0.0f);
            day_night_system_.set_time_of_day(t);
            control_server_.send({{"type", "ok"}, {"time_of_day", day_night_system_.time_of_day()}});
        } else if (cmd == "get_time") {
            control_server_.send({{"type", "time"}, {"time_of_day", day_night_system_.time_of_day()},
                                  {"active", day_night_system_.active()}});

        // === Scene manipulation ===
        } else if (cmd == "get_scene") {
            control_server_.send(build_scene_json());

        } else if (cmd == "load_scene_json") {
            if (cmd_json.contains("scene") && cmd_json["scene"].is_object()) {
                try {
                    clear_scene();
                    auto scene_data = SceneLoader::from_json(cmd_json["scene"]);
                    // Re-init from parsed data (reuse init_scene logic with inline data)
                    // Write to temp file and load, or adapt init_scene
                    // For simplicity, write temp then load
                    std::string tmp_path = "assets/scenes/_temp_inline.json";
                    std::ofstream tmp(tmp_path);
                    tmp << cmd_json["scene"].dump(2);
                    tmp.close();
                    init_scene(tmp_path);
                    std::filesystem::remove(tmp_path);
                    control_server_.send({{"type", "ok"}});
                } catch (const std::exception& e) {
                    control_server_.send({{"type", "error"}, {"message", e.what()}});
                }
            } else {
                control_server_.send({{"type", "error"}, {"message", "missing 'scene' object"}});
            }

        } else if (cmd == "reload_scene") {
            try {
                std::string path = current_scene_path_;
                clear_scene();
                init_scene(path);
                control_server_.send({{"type", "ok"}});
            } catch (const std::exception& e) {
                control_server_.send({{"type", "error"}, {"message", e.what()}});
            }

        // === Tilemap editing ===
        } else if (cmd == "get_tilemap") {
            control_server_.send(build_tilemap_json());

        } else if (cmd == "set_tile") {
            if (scene_.tile_layer().has_value()) {
                auto& layer = const_cast<TileLayer&>(*scene_.tile_layer());
                uint32_t col = cmd_json.value("col", 0u);
                uint32_t row = cmd_json.value("row", 0u);
                uint16_t tile_id = cmd_json.value("tile_id", static_cast<uint16_t>(0));
                bool solid = cmd_json.value("solid", false);
                if (col < layer.width && row < layer.height) {
                    uint32_t idx = row * layer.width + col;
                    layer.tiles[idx] = tile_id;
                    if (idx < layer.solid.size()) layer.solid[idx] = solid;
                    control_server_.send({{"type", "ok"}});
                } else {
                    control_server_.send({{"type", "error"}, {"message", "tile out of bounds"}});
                }
            } else {
                control_server_.send({{"type", "error"}, {"message", "no tilemap"}});
            }

        } else if (cmd == "set_tiles") {
            if (scene_.tile_layer().has_value() && cmd_json.contains("tiles") && cmd_json["tiles"].is_array()) {
                auto& layer = const_cast<TileLayer&>(*scene_.tile_layer());
                for (const auto& t : cmd_json["tiles"]) {
                    uint32_t col = t.value("col", 0u);
                    uint32_t row = t.value("row", 0u);
                    if (col < layer.width && row < layer.height) {
                        uint32_t idx = row * layer.width + col;
                        layer.tiles[idx] = t.value("tile_id", static_cast<uint16_t>(0));
                        if (t.contains("solid") && idx < layer.solid.size()) {
                            layer.solid[idx] = t["solid"].get<bool>();
                        }
                    }
                }
                control_server_.send({{"type", "ok"}});
            } else {
                control_server_.send({{"type", "error"}, {"message", "no tilemap or missing 'tiles' array"}});
            }

        } else if (cmd == "resize_tilemap") {
            if (scene_.tile_layer().has_value()) {
                auto& layer = const_cast<TileLayer&>(*scene_.tile_layer());
                uint32_t new_w = cmd_json.value("width", layer.width);
                uint32_t new_h = cmd_json.value("height", layer.height);
                uint16_t fill = cmd_json.value("fill_tile", static_cast<uint16_t>(0));
                std::vector<uint16_t> new_tiles(new_w * new_h, fill);
                std::vector<bool> new_solid(new_w * new_h, false);
                for (uint32_t r = 0; r < std::min(layer.height, new_h); ++r) {
                    for (uint32_t c = 0; c < std::min(layer.width, new_w); ++c) {
                        new_tiles[r * new_w + c] = layer.tiles[r * layer.width + c];
                        new_solid[r * new_w + c] = layer.solid[r * layer.width + c];
                    }
                }
                layer.width = new_w;
                layer.height = new_h;
                layer.tiles = std::move(new_tiles);
                layer.solid = std::move(new_solid);
                control_server_.send({{"type", "ok"}});
            } else {
                control_server_.send({{"type", "error"}, {"message", "no tilemap"}});
            }

        // === Entity manipulation ===
        } else if (cmd == "set_player_position") {
            if (player_id_.valid() && cmd_json.contains("position") && cmd_json["position"].is_array()) {
                auto& pos = world_.get<ecs::Transform>(player_id_).position;
                pos.x = cmd_json["position"][0].get<float>();
                pos.y = cmd_json["position"][1].get<float>();
                if (cmd_json["position"].size() > 2) pos.z = cmd_json["position"][2].get<float>();
                renderer_.camera().set_follow_target(pos);
                control_server_.send({{"type", "ok"}});
            } else {
                control_server_.send({{"type", "error"}, {"message", "no player or missing position"}});
            }

        } else if (cmd == "update_npc") {
            int index = cmd_json.value("index", -1);
            if (index >= 0 && index < static_cast<int>(npc_ids_.size())) {
                auto eid = npc_ids_[index];
                if (cmd_json.contains("position") && cmd_json["position"].is_array()) {
                    auto& pos = world_.get<ecs::Transform>(eid).position;
                    pos.x = cmd_json["position"][0].get<float>();
                    pos.y = cmd_json["position"][1].get<float>();
                    if (cmd_json["position"].size() > 2) pos.z = cmd_json["position"][2].get<float>();
                    if (index < static_cast<int>(scene_npc_data_.size())) {
                        scene_npc_data_[index].position = pos;
                    }
                }
                if (cmd_json.contains("tint") && cmd_json["tint"].is_array()) {
                    auto& spr = world_.get<ecs::Sprite>(eid);
                    spr.tint = {cmd_json["tint"][0].get<float>(), cmd_json["tint"][1].get<float>(),
                                cmd_json["tint"][2].get<float>(), cmd_json["tint"][3].get<float>()};
                    if (index < static_cast<int>(scene_npc_data_.size())) {
                        scene_npc_data_[index].tint = spr.tint;
                    }
                }
                if (cmd_json.contains("facing") && cmd_json["facing"].is_string()) {
                    Direction dir = Direction::Down;
                    std::string f = cmd_json["facing"];
                    if (f == "up") dir = Direction::Up;
                    else if (f == "left") dir = Direction::Left;
                    else if (f == "right") dir = Direction::Right;
                    world_.get<ecs::Facing>(eid).dir = dir;
                    if (index < static_cast<int>(scene_npc_data_.size())) {
                        scene_npc_data_[index].facing = dir;
                    }
                }
                control_server_.send({{"type", "ok"}});
            } else {
                control_server_.send({{"type", "error"}, {"message", "invalid npc index"}});
            }

        // === Lighting ===
        } else if (cmd == "set_ambient") {
            if (cmd_json.contains("color") && cmd_json["color"].is_array()) {
                auto c = cmd_json["color"];
                glm::vec4 ambient{c[0].get<float>(), c[1].get<float>(), c[2].get<float>(),
                                  c.size() > 3 ? c[3].get<float>() : 1.0f};
                scene_.set_ambient_color(ambient);
                control_server_.send({{"type", "ok"}});
            } else {
                control_server_.send({{"type", "error"}, {"message", "missing 'color' array"}});
            }

        } else if (cmd == "add_light") {
            PointLight pl;
            float x = cmd_json.value("x", 0.0f);
            float y = cmd_json.value("y", 0.0f);
            if (cmd_json.contains("position") && cmd_json["position"].is_array()) {
                x = cmd_json["position"][0].get<float>();
                y = cmd_json["position"][1].get<float>();
            }
            float radius = cmd_json.value("radius", 4.0f);
            float height = cmd_json.value("height", 3.0f);
            float intensity = cmd_json.value("intensity", 1.0f);
            pl.position_and_radius = {x, y, height, radius};
            float r = 1.0f, g = 0.9f, b = 0.6f;
            if (cmd_json.contains("color") && cmd_json["color"].is_array()) {
                r = cmd_json["color"][0].get<float>();
                g = cmd_json["color"][1].get<float>();
                b = cmd_json["color"][2].get<float>();
            }
            pl.color = {r, g, b, intensity};
            static_lights_.push_back(pl);
            control_server_.send({{"type", "ok"}, {"index", static_lights_.size() - 1}});

        } else if (cmd == "remove_light") {
            int index = cmd_json.value("index", -1);
            if (index >= 0 && index < static_cast<int>(static_lights_.size())) {
                static_lights_.erase(static_lights_.begin() + index);
                control_server_.send({{"type", "ok"}});
            } else {
                control_server_.send({{"type", "error"}, {"message", "invalid light index"}});
            }

        } else if (cmd == "update_light") {
            int index = cmd_json.value("index", -1);
            if (index >= 0 && index < static_cast<int>(static_lights_.size())) {
                auto& pl = static_lights_[index];
                if (cmd_json.contains("position") && cmd_json["position"].is_array()) {
                    pl.position_and_radius.x = cmd_json["position"][0].get<float>();
                    pl.position_and_radius.y = cmd_json["position"][1].get<float>();
                }
                if (cmd_json.contains("radius")) pl.position_and_radius.w = cmd_json["radius"].get<float>();
                if (cmd_json.contains("height")) pl.position_and_radius.z = cmd_json["height"].get<float>();
                if (cmd_json.contains("intensity")) pl.color.a = cmd_json["intensity"].get<float>();
                if (cmd_json.contains("color") && cmd_json["color"].is_array()) {
                    pl.color.r = cmd_json["color"][0].get<float>();
                    pl.color.g = cmd_json["color"][1].get<float>();
                    pl.color.b = cmd_json["color"][2].get<float>();
                }
                control_server_.send({{"type", "ok"}});
            } else {
                control_server_.send({{"type", "error"}, {"message", "invalid light index"}});
            }

        // === Portals ===
        } else if (cmd == "add_portal") {
            if (cmd_json.contains("portal") && cmd_json["portal"].is_object()) {
                const auto& p = cmd_json["portal"];
                PortalData portal;
                if (p.contains("position") && p["position"].is_array()) {
                    portal.position = {p["position"][0].get<float>(), p["position"][1].get<float>()};
                }
                if (p.contains("size") && p["size"].is_array()) {
                    portal.size = {p["size"][0].get<float>(), p["size"][1].get<float>()};
                }
                portal.target_scene = p.value("target_scene", "");
                if (p.contains("spawn_position") && p["spawn_position"].is_array()) {
                    portal.spawn_position = {p["spawn_position"][0].get<float>(),
                                             p["spawn_position"][1].get<float>(),
                                             p["spawn_position"].size() > 2 ? p["spawn_position"][2].get<float>() : 0.0f};
                }
                if (p.contains("spawn_facing")) {
                    std::string f = p["spawn_facing"];
                    if (f == "up") portal.spawn_facing = Direction::Up;
                    else if (f == "left") portal.spawn_facing = Direction::Left;
                    else if (f == "right") portal.spawn_facing = Direction::Right;
                    else portal.spawn_facing = Direction::Down;
                }
                portals_.push_back(portal);
                control_server_.send({{"type", "ok"}, {"index", portals_.size() - 1}});
            } else {
                control_server_.send({{"type", "error"}, {"message", "missing 'portal' object"}});
            }

        } else if (cmd == "remove_portal") {
            int index = cmd_json.value("index", -1);
            if (index >= 0 && index < static_cast<int>(portals_.size())) {
                portals_.erase(portals_.begin() + index);
                control_server_.send({{"type", "ok"}});
            } else {
                control_server_.send({{"type", "error"}, {"message", "invalid portal index"}});
            }

        // === Environment ===
        } else if (cmd == "set_weather") {
            if (cmd_json.contains("type") && cmd_json["type"].is_string()) {
                std::string wtype = cmd_json["type"];
                if (wtype == "clear") {
                    weather_system_.reset();
                } else {
                    WeatherConfig weather_cfg;
                    if (wtype == "rain") weather_cfg.type = WeatherType::Rain;
                    else if (wtype == "snow") weather_cfg.type = WeatherType::Snow;
                    if (cmd_json.contains("fog_density")) weather_cfg.fog_density = cmd_json["fog_density"].get<float>();
                    if (cmd_json.contains("fog_color") && cmd_json["fog_color"].is_array()) {
                        weather_cfg.fog_color = {cmd_json["fog_color"][0].get<float>(),
                                                 cmd_json["fog_color"][1].get<float>(),
                                                 cmd_json["fog_color"][2].get<float>()};
                    }
                    if (cmd_json.contains("transition_speed")) {
                        weather_cfg.transition_speed = cmd_json["transition_speed"].get<float>();
                    }
                    weather_system_.init(particles_, scene_, weather_cfg);
                }
                control_server_.send({{"type", "ok"}});
            } else {
                control_server_.send({{"type", "error"}, {"message", "missing 'type' field"}});
            }

        } else if (cmd == "set_day_night") {
            if (cmd_json.contains("enabled")) {
                if (cmd_json["enabled"].get<bool>()) {
                    DayNightConfig dn_cfg;
                    dn_cfg.enabled = true;
                    dn_cfg.cycle_speed = cmd_json.value("cycle_speed", 0.02f);
                    if (cmd_json.contains("time")) {
                        dn_cfg.initial_time = cmd_json["time"].get<float>();
                    }
                    day_night_system_.init(dn_cfg);
                } else {
                    day_night_system_.reset();
                }
                control_server_.send({{"type", "ok"}});
            } else {
                control_server_.send({{"type", "error"}, {"message", "missing 'enabled' field"}});
            }

        // === Particles ===
        } else if (cmd == "list_emitters") {
            nlohmann::json result;
            result["type"] = "emitters";
            nlohmann::json arr = nlohmann::json::array();
            for (size_t i = 0; i < particles_.emitter_count(); ++i) {
                const auto& em = particles_.emitter(i);
                arr.push_back({
                    {"index", i},
                    {"active", em.active},
                    {"position", {em.position.x, em.position.y}},
                    {"spawn_rate", em.config.spawn_rate}
                });
            }
            result["emitters"] = arr;
            control_server_.send(result);

        } else if (cmd == "set_emitter_config") {
            int index = cmd_json.value("emitter_index", -1);
            if (index >= 0 && index < static_cast<int>(particles_.emitter_count()) &&
                cmd_json.contains("config") && cmd_json["config"].is_object()) {
                EmitterConfig cfg = SceneLoader::parse_emitter(cmd_json["config"]);
                particles_.set_emitter_config(static_cast<size_t>(index), cfg);
                control_server_.send({{"type", "ok"}});
            } else {
                control_server_.send({{"type", "error"}, {"message", "invalid emitter index or missing config"}});
            }

        } else if (cmd == "add_emitter") {
            EmitterConfig cfg;
            if (cmd_json.contains("config") && cmd_json["config"].is_object()) {
                cfg = SceneLoader::parse_emitter(cmd_json["config"]);
            }
            glm::vec2 pos{0.0f};
            if (cmd_json.contains("position") && cmd_json["position"].is_array()) {
                pos = {cmd_json["position"][0].get<float>(), cmd_json["position"][1].get<float>()};
            }
            size_t idx = particles_.add_emitter(cfg, pos);
            control_server_.send({{"type", "ok"}, {"index", idx}});

        } else if (cmd == "remove_emitter") {
            int index = cmd_json.value("index", -1);
            if (index >= 0 && index < static_cast<int>(particles_.emitter_count())) {
                particles_.remove_emitter(static_cast<size_t>(index));
                control_server_.send({{"type", "ok"}});
            } else {
                control_server_.send({{"type", "error"}, {"message", "invalid emitter index"}});
            }

        // === Features ===
        } else if (cmd == "get_features") {
            nlohmann::json result;
            result["type"] = "features";
            nlohmann::json flags = nlohmann::json::object();
            for (const auto& entry : FeatureFlags::entries()) {
                flags[std::string(entry.name)] = feature_flags_.*entry.ptr;
            }
            result["flags"] = flags;
            control_server_.send(result);

        } else if (cmd == "set_feature") {
            if (cmd_json.contains("name") && cmd_json["name"].is_string() && cmd_json.contains("enabled")) {
                std::string name = cmd_json["name"];
                bool enabled = cmd_json["enabled"].get<bool>();
                bool found = false;
                for (const auto& entry : FeatureFlags::entries()) {
                    if (entry.name == name) {
                        feature_flags_.*entry.ptr = enabled;
                        found = true;
                        break;
                    }
                }
                if (found) {
                    control_server_.send({{"type", "ok"}});
                } else {
                    control_server_.send({{"type", "error"}, {"message", "unknown feature: " + name}});
                }
            } else {
                control_server_.send({{"type", "error"}, {"message", "missing 'name' or 'enabled' field"}});
            }

        // === Camera ===
        } else if (cmd == "set_camera") {
            if (cmd_json.contains("position") && cmd_json["position"].is_array()) {
                glm::vec3 pos{cmd_json["position"][0].get<float>(),
                              cmd_json["position"][1].get<float>(),
                              cmd_json["position"].size() > 2 ? cmd_json["position"][2].get<float>() : 0.0f};
                renderer_.camera().set_follow_target(pos);
            }
            if (cmd_json.contains("zoom")) {
                renderer_.camera().set_target_zoom(cmd_json["zoom"].get<float>());
            }
            control_server_.send({{"type", "ok"}});

        // === Event subscription ===
        } else if (cmd == "subscribe") {
            if (cmd_json.contains("events") && cmd_json["events"].is_array()) {
                std::vector<std::string> events;
                for (const auto& e : cmd_json["events"]) {
                    if (e.is_string()) events.push_back(e.get<std::string>());
                }
                control_server_.subscribe_events(events);
                control_server_.send({{"type", "ok"}});
            } else {
                control_server_.send({{"type", "error"}, {"message", "missing 'events' array"}});
            }

        } else if (cmd == "unsubscribe") {
            control_server_.unsubscribe_all();
            control_server_.send({{"type", "ok"}});

        } else {
            control_server_.send({{"type", "error"},
                                  {"message", "unknown command: " + cmd}});
        }
    }
}

nlohmann::json App::build_state_json() const {
    nlohmann::json state;
    state["type"] = "state";
    state["tick"] = tick_;

    // Game mode
    state["game_mode"] = (game_mode_ == GameMode::Dialog) ? "dialog" : "explore";

    // Player
    if (player_id_.valid()) {
        const auto& pos = world_.get<ecs::Transform>(player_id_).position;
        const auto& facing = world_.get<ecs::Facing>(player_id_);
        const auto& anim = world_.get<ecs::Animation>(player_id_);
        state["player"] = {
            {"x", pos.x},
            {"y", pos.y},
            {"direction", direction_suffix(facing.dir)},
            {"animation", anim.state_machine.current_state()}
        };
    }

    // NPCs
    nlohmann::json npc_arr = nlohmann::json::array();
    for (size_t i = 0; i < npc_ids_.size(); ++i) {
        const auto& pos = world_.get<ecs::Transform>(npc_ids_[i]).position;
        const auto& facing = world_.get<ecs::Facing>(npc_ids_[i]);
        npc_arr.push_back({
            {"index", i},
            {"x", pos.x},
            {"y", pos.y},
            {"direction", direction_suffix(facing.dir)}
        });
    }
    state["npcs"] = npc_arr;

    // Dialog
    if (game_mode_ == GameMode::Dialog && dialog_state_.active) {
        const auto& line = dialog_state_.current();
        state["dialog"] = {
            {"speaker_key", line.speaker_key},
            {"text_key", line.text_key},
            {"line", dialog_state_.current_line}
        };
    } else {
        state["dialog"] = nullptr;
    }

    // Day/night time of day
    if (day_night_system_.active()) {
        state["time_of_day"] = day_night_system_.time_of_day();
    }

    // Nearest NPC (proximity check)
    if (player_id_.valid() && game_mode_ == GameMode::Explore) {
        constexpr float kInteractRange = 1.5f;
        int nearest = -1;
        float nearest_dist_sq = kInteractRange * kInteractRange;
        const auto& player_pos = world_.get<ecs::Transform>(player_id_).position;
        for (size_t i = 0; i < npc_ids_.size(); i++) {
            const auto& npc_pos = world_.get<ecs::Transform>(npc_ids_[i]).position;
            float dx = npc_pos.x - player_pos.x;
            float dy = npc_pos.y - player_pos.y;
            float dist_sq = dx * dx + dy * dy;
            if (dist_sq < nearest_dist_sq) {
                nearest_dist_sq = dist_sq;
                nearest = static_cast<int>(i);
            }
        }
        if (nearest >= 0) {
            state["nearby_npc"] = {{"index", nearest},
                                   {"distance", std::sqrt(nearest_dist_sq)}};
        } else {
            state["nearby_npc"] = nullptr;
        }
    } else {
        state["nearby_npc"] = nullptr;
    }

    return state;
}

nlohmann::json App::build_map_json() const {
    nlohmann::json map;
    map["type"] = "map";

    if (scene_.tile_layer().has_value()) {
        const auto& layer = *scene_.tile_layer();
        map["width"] = layer.width;
        map["height"] = layer.height;
        map["tile_size"] = layer.tile_size;

        nlohmann::json solid = nlohmann::json::array();
        for (uint32_t row = 0; row < layer.height; ++row) {
            nlohmann::json row_arr = nlohmann::json::array();
            for (uint32_t col = 0; col < layer.width; ++col) {
                uint32_t idx = row * layer.width + col;
                row_arr.push_back(idx < layer.solid.size() && layer.solid[idx]);
            }
            solid.push_back(row_arr);
        }
        map["solid"] = solid;
    }

    return map;
}

SaveData App::build_save_data() const {
    SaveData data;
    if (player_id_.valid()) {
        data.player_position = world_.get<ecs::Transform>(player_id_).position;
        data.player_facing = world_.get<ecs::Facing>(player_id_).dir;
    }
    for (auto npc : npc_ids_) {
        NpcSaveData nsd;
        nsd.position = world_.get<ecs::Transform>(npc).position;
        nsd.facing = world_.get<ecs::Facing>(npc).dir;
        const auto& patrol = world_.get<ecs::NpcPatrol>(npc);
        nsd.patrol_dir = patrol.dir;
        nsd.patrol_timer = patrol.timer;
        data.npcs.push_back(nsd);
    }
    data.game_flags = game_flags_;
    data.play_time = play_time_;
    data.scene_path = current_scene_path_;
    data.time_of_day = day_night_system_.time_of_day();
    return data;
}

void App::apply_save_data(const SaveData& data) {
    // If scene differs, clear and reload
    if (data.scene_path != current_scene_path_ && !data.scene_path.empty()) {
        clear_scene();
        init_scene(data.scene_path);
    }

    if (player_id_.valid()) {
        world_.get<ecs::Transform>(player_id_).position = data.player_position;
        world_.get<ecs::Facing>(player_id_).dir = data.player_facing;
        auto& anim = world_.get<ecs::Animation>(player_id_);
        anim.state_machine.transition_to("idle_" + std::string(direction_suffix(data.player_facing)));
        renderer_.camera().set_follow_target(data.player_position);
    }
    for (size_t i = 0; i < data.npcs.size() && i < npc_ids_.size(); i++) {
        const auto& nsd = data.npcs[i];
        world_.get<ecs::Transform>(npc_ids_[i]).position = nsd.position;
        world_.get<ecs::Facing>(npc_ids_[i]).dir = nsd.facing;
        auto& patrol = world_.get<ecs::NpcPatrol>(npc_ids_[i]);
        patrol.dir = nsd.patrol_dir;
        patrol.timer = nsd.patrol_timer;
        auto& anim = world_.get<ecs::Animation>(npc_ids_[i]);
        anim.state_machine.transition_to("walk_" + std::string(direction_suffix(nsd.facing)));
    }
    game_flags_ = data.game_flags;
    play_time_ = data.play_time;
    day_night_system_.set_time_of_day(data.time_of_day);
}

void App::emit_event(const std::string& event, const nlohmann::json& data) {
    if (!control_server_.has_client()) return;
    if (!control_server_.is_event_subscribed(event)) return;
    nlohmann::json msg;
    msg["type"] = "event";
    msg["event"] = event;
    msg["tick"] = tick_;
    if (!data.is_null()) {
        msg["data"] = data;
    }
    control_server_.send(msg);
}

nlohmann::json App::build_scene_json() const {
    // Reconstruct SceneData from current live state + stored metadata
    SceneData data;

    // Tilemap from live scene
    if (scene_.tile_layer().has_value()) {
        data.tilemap = *scene_.tile_layer();
    }
    if (scene_.tile_animator()) {
        // Can't easily extract animations back; use stored data if available
    }

    data.ambient_color = scene_.ambient_color();
    data.static_lights = static_lights_;

    // Player from ECS
    if (player_id_.valid()) {
        data.player_position = world_.get<ecs::Transform>(player_id_).position;
        data.player_tint = world_.get<ecs::Sprite>(player_id_).tint;
        data.player_facing = world_.get<ecs::Facing>(player_id_).dir;
    }

    // NPCs from stored data + live ECS positions
    data.npcs = scene_npc_data_;
    for (size_t i = 0; i < npc_ids_.size() && i < data.npcs.size(); ++i) {
        data.npcs[i].position = world_.get<ecs::Transform>(npc_ids_[i]).position;
        data.npcs[i].facing = world_.get<ecs::Facing>(npc_ids_[i]).dir;
    }

    // Background layers from stored data
    for (const auto& layer : scene_.background_layers()) {
        ParallaxLayerData pld;
        pld.z = layer.z;
        pld.parallax_factor = layer.parallax_factor;
        pld.quad_width = layer.quad_width;
        pld.quad_height = layer.quad_height;
        pld.uv_repeat_x = layer.uv_repeat_x;
        pld.uv_repeat_y = layer.uv_repeat_y;
        pld.tint = layer.tint;
        pld.wall = layer.wall;
        pld.wall_y_offset = layer.wall_y_offset;
        data.background_layers.push_back(pld);
    }

    // Portals
    data.portals = portals_;

    // Day/night
    if (day_night_system_.active()) {
        data.day_night.enabled = true;
        data.day_night.initial_time = day_night_system_.time_of_day();
    }

    nlohmann::json result = SceneLoader::to_json(data);
    result["type"] = "scene";
    return result;
}

nlohmann::json App::build_tilemap_json() const {
    nlohmann::json result;
    result["type"] = "tilemap";

    if (scene_.tile_layer().has_value()) {
        const auto& layer = *scene_.tile_layer();
        result["width"] = layer.width;
        result["height"] = layer.height;
        result["tile_size"] = layer.tile_size;

        nlohmann::json tiles = nlohmann::json::array();
        for (auto t : layer.tiles) tiles.push_back(t);
        result["tiles"] = tiles;

        nlohmann::json solid = nlohmann::json::array();
        for (size_t i = 0; i < layer.solid.size(); ++i) {
            solid.push_back(layer.solid[i] ? true : false);
        }
        result["solid"] = solid;
    }

    return result;
}

void App::cleanup() {
    while (!state_stack_.empty()) {
        state_stack_.pop(*this);
    }
    wren_vm_.shutdown();
    control_server_.stop();
    audio_.shutdown();
    renderer_.shutdown();
    resources_.shutdown();
    glfwDestroyWindow(window_);
    glfwTerminate();
}

}  // namespace vulkan_game
