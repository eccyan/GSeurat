#include "gseurat/demo/demo_app.hpp"
#include "gseurat/demo/demo_gameplay_state.hpp"
#include "gseurat/engine/ecs/default_components.hpp"
#include "gseurat/game/components.hpp"
#include "gseurat/game/states/transition_state.hpp"
#include "gseurat/game/systems.hpp"
#include "gseurat/engine/pathfinder.hpp"
#include "gseurat/engine/character_data.hpp"
#include "gseurat/engine/scene_loader.hpp"
#include "gseurat/engine/tilemap.hpp"

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include <stb_image_write.h>

#include <glm/gtc/matrix_transform.hpp>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <set>
#include <string>
#include <string_view>

namespace gseurat {

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

// ---------------------------------------------------------------------------
// parse_args
// ---------------------------------------------------------------------------

void DemoApp::parse_args(int argc, char* argv[]) {
    auto entries = FeatureFlags::entries();

    for (int i = 1; i < argc; ++i) {
        std::string_view arg(argv[i]);
        if (arg.starts_with("--disable-")) {
            auto feature_name = arg.substr(10);

            for (const auto& entry : entries) {
                std::string normalized;
                for (char c : entry.name) {
                    if (c == ' ') normalized += '-';
                    else normalized += static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
                }
                if (feature_name == normalized) {
                    initial_flags_.*(entry.ptr) = false;
                    break;
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

void DemoApp::run() {
    init_game_content();
    feature_flags_ = initial_flags_;
    state_stack_.push(std::make_unique<DemoGameplayState>(), *this);
    main_loop();
    cleanup();
}

// ---------------------------------------------------------------------------
// Asset generators
// ---------------------------------------------------------------------------

void DemoApp::generate_player_sheet() {
    constexpr int kFrameW   = 16;
    constexpr int kFrameH   = 16;
    constexpr int kFrames   = 4;
    constexpr int kRows     = 12;
    constexpr int kWidth    = kFrameW * kFrames;
    constexpr int kHeight   = kFrameH * kRows;
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

void DemoApp::generate_tileset() {
    constexpr int kTileW    = 16;
    constexpr int kTileH    = 16;
    constexpr int kCols     = 8;
    constexpr int kRows     = 3;
    constexpr int kWidth    = kTileW * kCols;
    constexpr int kHeight   = kTileH * kRows;
    constexpr int kChannels = 4;

    const uint8_t tile_colors[10][4] = {
        {200, 185, 145, 255},
        { 70,  60,  55, 255},
        { 40,  90, 180, 255},
        { 55, 110, 200, 255},
        { 70, 130, 210, 255},
        {200,  60,  20, 255},
        {240, 100,  20, 255},
        {255, 160,  40, 255},
        { 60,  50,  45, 255},
        { 80,  65,  40, 255},
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

    for (int t = 0; t < 10; ++t) {
        fill_tile(t, tile_colors[t]);
    }

    // Wave-like brightness variation for water tiles (2-4)
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

    // Flow pattern for lava tiles (5-7)
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

    // Ember glow for wall torch tiles (8-9)
    {
        for (int frame = 0; frame < 2; ++frame) {
            int tile_id = 8 + frame;
            int col = tile_id % kCols;
            int row = tile_id / kCols;
            float ember_intensity = frame == 0 ? 0.4f : 0.9f;
            for (int py = 0; py < kTileH; ++py) {
                for (int px = 0; px < kTileW; ++px) {
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

void DemoApp::generate_particle_atlas() {
    constexpr int kTileSize = 16;
    constexpr int kTiles    = 6;
    constexpr int kWidth    = kTileSize * kTiles;
    constexpr int kHeight   = kTileSize;
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

            // Tile 0: Circle
            set_pixel(px, py, dist <= kRadius ? 255 : 0);

            // Tile 1: Soft Glow
            {
                float norm = dist / kRadius;
                float val = std::exp(-norm * norm * 3.0f);
                val = std::max(0.0f, std::min(1.0f, val));
                set_pixel(kTileSize + px, py, static_cast<uint8_t>(val * 255.0f));
            }

            // Tile 2: Spark
            {
                float adx = std::abs(dx);
                float ady = std::abs(dy);
                float manhattan = adx + ady;
                float val = 1.0f - manhattan / kRadius;
                val = std::max(0.0f, std::min(1.0f, val));
                val *= val;
                set_pixel(2 * kTileSize + px, py, static_cast<uint8_t>(val * 255.0f));
            }

            // Tile 3: Smoke Puff
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

            // Tile 4: Raindrop
            {
                float ax = std::abs(dx);
                float fy = static_cast<float>(py) / static_cast<float>(kTileSize - 1);
                float h_falloff = std::max(0.0f, 1.0f - ax / 1.5f);
                float v_alpha = fy;
                float val = h_falloff * v_alpha;
                val = std::max(0.0f, std::min(1.0f, val));
                set_pixel(4 * kTileSize + px, py, static_cast<uint8_t>(val * 255.0f));
            }

            // Tile 5: Snowflake
            {
                float adx = std::abs(dx);
                float ady = std::abs(dy);
                float cross = std::max(0.0f, 1.0f - std::min(adx, ady) / 2.0f);
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

void DemoApp::generate_background_textures() {
    std::filesystem::create_directories("assets/textures");
    constexpr int kChannels = 4;

    // Sky gradient
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

    // Distant mountains
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

    // Mid-ground trees
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
    uint16_t audio_fmt = 1;
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

void DemoApp::generate_shadow_texture() {
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

void DemoApp::generate_flat_normal_texture() {
    std::filesystem::create_directories("assets/textures");
    uint8_t pixels[4] = {128, 128, 255, 255};
    stbi_write_png("assets/textures/flat_normal.png", 1, 1, 4, pixels, 4);
}

void DemoApp::generate_tileset_normal() {
    constexpr int kTileW = 16;
    constexpr int kTileH = 16;
    constexpr int kCols = 8;
    constexpr int kRows = 3;
    constexpr int kWidth = kCols * kTileW;
    constexpr int kHeight = kRows * kTileH;
    constexpr int kChannels = 4;
    constexpr float kPi = 3.14159265358979323846f;

    std::vector<float> heightmap(kWidth * kHeight, 0.0f);
    std::vector<uint8_t> pixels(kWidth * kHeight * kChannels, 0);

    auto tile_origin = [&](int tile_id) -> std::pair<int, int> {
        int col = tile_id % kCols;
        int row = tile_id / kCols;
        return {col * kTileW, row * kTileH};
    };

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

    // Tile 0: floor
    fill_tile_height(0, [&](int lx, int ly) {
        float fx = static_cast<float>(lx);
        float fy = static_cast<float>(ly);
        return std::sin(fx * 1.5f) * std::sin(fy * 1.7f) * 1.5f;
    });

    // Tile 1: wall
    fill_tile_height(1, [&](int lx, int ly) {
        float h = 3.0f;
        if (ly % 4 == 0) h = 0.0f;
        int brick_offset = (ly / 4) % 2 == 0 ? 0 : 8;
        if ((lx + brick_offset) % 8 == 0) h = 0.0f;
        return h;
    });

    // Tiles 2-4: water
    for (int t = 2; t <= 4; ++t) {
        float phase = static_cast<float>(t - 2) * 2.0f * kPi / 3.0f;
        fill_tile_height(t, [&](int lx, int ly) {
            float fx = static_cast<float>(lx);
            float fy = static_cast<float>(ly);
            return (std::sin(fx * 0.8f + phase) + std::sin(fy * 0.6f + phase * 0.7f)) * 2.0f;
        });
    }

    // Tiles 5-7: lava
    for (int t = 5; t <= 7; ++t) {
        float phase = static_cast<float>(t - 5) * 2.0f * kPi / 3.0f;
        fill_tile_height(t, [&](int lx, int ly) {
            float fx = static_cast<float>(lx);
            float fy = static_cast<float>(ly);
            return (std::sin(fx * 1.2f + phase) * std::cos(fy * 0.9f + phase * 1.3f)
                    + std::sin((fx + fy) * 0.7f + phase)) * 2.5f;
        });
    }

    // Tiles 8-9: torch
    for (int t = 8; t <= 9; ++t) {
        fill_tile_height(t, [&](int lx, int ly) {
            float h = 2.0f;
            float cx = static_cast<float>(lx) - 7.5f;
            float cy = static_cast<float>(ly) - 7.5f;
            float r2 = (cx * cx + cy * cy) / (7.0f * 7.0f);
            if (r2 < 1.0f) h += (1.0f - r2) * 2.5f;
            return h;
        });
    }

    // Convert heightmap to normal map
    for (int gy = 0; gy < kHeight; ++gy) {
        for (int gx = 0; gx < kWidth; ++gx) {
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

            float nx = -dhdx;
            float ny = -dhdy;
            float nz = 1.0f;
            float len = std::sqrt(nx * nx + ny * ny + nz * nz);
            nx /= len;
            ny /= len;
            nz /= len;

            int idx = (gy * kWidth + gx) * kChannels;
            pixels[idx + 0] = static_cast<uint8_t>(std::clamp((nx * 0.5f + 0.5f) * 255.0f, 0.0f, 255.0f));
            pixels[idx + 1] = static_cast<uint8_t>(std::clamp((ny * 0.5f + 0.5f) * 255.0f, 0.0f, 255.0f));
            pixels[idx + 2] = static_cast<uint8_t>(std::clamp((nz * 0.5f + 0.5f) * 255.0f, 0.0f, 255.0f));
            pixels[idx + 3] = 255;
        }
    }

    // Fill unused tiles with flat normal
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

void DemoApp::generate_player_normal() {
    constexpr int kFrameW = 16;
    constexpr int kFrameH = 16;
    constexpr int kFrames = 4;
    constexpr int kRows = 12;
    constexpr int kWidth = kFrameW * kFrames;
    constexpr int kHeight = kFrameH * kRows;
    constexpr int kChannels = 4;

    std::vector<uint8_t> pixels(kWidth * kHeight * kChannels, 0);

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

                    float strength = 1.0f;
                    float nx = -strength * (-2.0f * cx / (7.0f)) * (r2 < 1.0f ? 1.0f : 0.0f);
                    float ny = -strength * (-2.0f * cy / (7.0f)) * (r2 < 1.0f ? 1.0f : 0.0f);
                    float nz = 1.0f;
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

void DemoApp::generate_audio_assets() {
    std::filesystem::create_directories("assets/audio");

    constexpr uint32_t kRate = 44100;
    constexpr float kPi = 3.14159265358979323846f;

    bool has_external_music = std::filesystem::exists("assets/audio/music_bass.wav")
        && std::filesystem::file_size("assets/audio/music_bass.wav") > 500000;

    // 1. music_bass.wav
    if (!has_external_music) {
        uint32_t len = kRate * 4;
        std::vector<int16_t> samples(len);
        for (uint32_t i = 0; i < len; ++i) {
            float t = static_cast<float>(i) / kRate;
            float c2 = std::sin(2.0f * kPi * 65.41f * t);
            float g2 = std::sin(2.0f * kPi * 98.00f * t);
            float mix = (c2 + g2 * 0.7f) * 0.4f;
            float tremolo = 1.0f - 0.15f * std::sin(2.0f * kPi * 0.5f * t);
            float env = 1.0f;
            float fade_dur = 0.05f * kRate;
            if (i < static_cast<uint32_t>(fade_dur)) env = static_cast<float>(i) / fade_dur;
            if (i > len - static_cast<uint32_t>(fade_dur)) env = static_cast<float>(len - i) / fade_dur;
            samples[i] = static_cast<int16_t>(mix * tremolo * env * 20000.0f);
        }
        write_wav("assets/audio/music_bass.wav", samples, kRate);
    }

    // 2. music_harmony.wav
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

    // 3. music_melody.wav
    if (!has_external_music) {
        uint32_t len = kRate * 4;
        std::vector<int16_t> samples(len);
        const float notes[] = {261.63f, 293.66f, 329.63f, 392.00f, 440.00f,
                                392.00f, 329.63f, 293.66f};
        const float note_dur = 0.5f;
        for (uint32_t i = 0; i < len; ++i) {
            float t = static_cast<float>(i) / kRate;
            int note_idx = static_cast<int>(t / note_dur) % 8;
            float note_t = std::fmod(t, note_dur);
            float freq = notes[note_idx];
            float val = std::sin(2.0f * kPi * freq * t) * 0.35f;
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

    // 4. music_percussion.wav
    if (!has_external_music) {
        uint32_t len = kRate * 2;
        std::vector<int16_t> samples(len);
        const float beat_dur = 0.5f;
        uint32_t rng = 0xDEADBEEF;
        for (uint32_t i = 0; i < len; ++i) {
            float t = static_cast<float>(i) / kRate;
            float beat_t = std::fmod(t, beat_dur);
            float val = 0.0f;

            if (beat_t < 0.08f) {
                float kick_env = std::exp(-beat_t * 50.0f);
                val += std::sin(2.0f * kPi * 60.0f * beat_t) * kick_env * 0.5f;
            }

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

    // 5. torch_crackle.wav
    {
        uint32_t len = kRate * 2;
        std::vector<int16_t> samples(len);
        uint32_t rng = 0xCAFEBABE;
        for (uint32_t i = 0; i < len; ++i) {
            rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5;
            float noise = static_cast<float>(static_cast<int32_t>(rng)) / 2147483648.0f;
            float t = static_cast<float>(i) / kRate;
            float burst = std::abs(std::sin(t * 25.0f)) * std::abs(std::sin(t * 37.0f));
            burst = burst * burst * burst;
            float env = 1.0f;
            float fade_dur_f = 0.02f * kRate;
            if (i < static_cast<uint32_t>(fade_dur_f)) env = static_cast<float>(i) / fade_dur_f;
            if (i > len - static_cast<uint32_t>(fade_dur_f)) env = static_cast<float>(len - i) / fade_dur_f;
            samples[i] = static_cast<int16_t>(noise * burst * env * 15000.0f);
        }
        write_wav("assets/audio/torch_crackle.wav", samples, kRate);
    }

    // 6. footstep.wav
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

    // 7. dialog_open.wav
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

    // 8. dialog_close.wav
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

    // 9. dialog_blip.wav
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

// ---------------------------------------------------------------------------
// init_game_content
// ---------------------------------------------------------------------------

void DemoApp::init_game_content() {
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

    // Initialize Wren scripting
    wren_vm_.init(this);
    register_wren_bindings(wren_vm_);
    wren_vm_.load_module("engine", "assets/scripts/engine.wren");
    script_system_.init(this, &wren_vm_);
}

// ---------------------------------------------------------------------------
// init_scene + helpers
// ---------------------------------------------------------------------------

void DemoApp::init_scene(const std::string& scene_path) {
    current_scene_path_ = scene_path;
    auto scene_data = SceneLoader::load(scene_path);

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

    init_player(scene_data, setup_anim);
    init_npcs(scene_data, setup_anim);
    init_gs(scene_data);
    init_environment(scene_data);
    init_weather_and_systems(scene_data);

    portals_ = std::move(scene_data.portals);
    scene_npc_data_ = scene_data.npcs;
    static_lights_ = scene_data.static_lights;
}

void DemoApp::init_player(const SceneData& scene_data,
                      const std::function<void(ecs::Animation&, const std::string&)>& setup_anim) {
    size_t footstep_eid = particles_.add_emitter(scene_data.footstep_emitter, {0.0f, 0.0f});
    particles_.set_emitter_active(footstep_eid, false);

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

    renderer_.camera().set_follow_target(world_.get<ecs::Transform>(player_id_).position);
    renderer_.camera().set_follow_speed(5.0f);
}

void DemoApp::init_npcs(const SceneData& scene_data,
                    const std::function<void(ecs::Animation&, const std::string&)>& setup_anim) {
    npc_dialogs_.resize(scene_data.npcs.size());
    for (size_t i = 0; i < scene_data.npcs.size(); i++) {
        npc_dialogs_[i] = scene_data.npcs[i].dialog;
    }

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

        if (!npc_data.script_module.empty()) {
            wren_vm_.load_module(npc_data.script_module,
                "assets/scripts/" + npc_data.script_module + ".wren");
            world_.add<ecs::ScriptRef>(npc, ecs::ScriptRef{
                npc_data.script_module, npc_data.script_class});
        }

        npc_ids_.push_back(npc);
    }
}

void DemoApp::init_gs(const SceneData& scene_data) {
    if (!scene_data.gaussian_splat) return;

    const auto& gs = *scene_data.gaussian_splat;
    GaussianCloud cloud;
    try {
        cloud = GaussianCloud::load_ply(gs.ply_file);
    } catch (const std::runtime_error& e) {
        std::fprintf(stderr, "Warning: %s (skipping GS rendering)\n", e.what());
    }
    if (!cloud.empty()) {
        renderer_.gs_renderer().set_scale_multiplier(gs.scale_multiplier);
        std::fprintf(stderr, "GS: Loaded %u Gaussians from %s\n",
                     cloud.count(), gs.ply_file.c_str());
        std::fprintf(stderr, "GS: AABB min=(%.1f,%.1f,%.1f) max=(%.1f,%.1f,%.1f)\n",
                     cloud.bounds().min.x, cloud.bounds().min.y, cloud.bounds().min.z,
                     cloud.bounds().max.x, cloud.bounds().max.y, cloud.bounds().max.z);
        std::fprintf(stderr, "GS: Camera pos=(%.1f,%.1f,%.1f) target=(%.1f,%.1f,%.1f) fov=%.1f\n",
                     gs.camera_position.x, gs.camera_position.y, gs.camera_position.z,
                     gs.camera_target.x, gs.camera_target.y, gs.camera_target.z,
                     gs.camera_fov);

        uint32_t gs_w = gs.render_width;
        uint32_t gs_h = gs.render_height;
        if (cloud.count() > 100000 && gs_w >= 320) {
            gs_w = 160;
            gs_h = 120;
            std::fprintf(stderr, "GS: Auto-scaled render to %ux%u for %u Gaussians\n",
                         gs_w, gs_h, cloud.count());
        } else if (cloud.count() > 50000 && gs_w >= 320) {
            gs_w = 240;
            gs_h = 180;
            std::fprintf(stderr, "GS: Auto-scaled render to %ux%u for %u Gaussians\n",
                         gs_w, gs_h, cloud.count());
        }

        renderer_.init_gs(cloud, gs_w, gs_h);

        float aspect = static_cast<float>(gs_w) / static_cast<float>(gs_h);
        auto gs_view = glm::lookAt(gs.camera_position, gs.camera_target, glm::vec3(0, 1, 0));
        auto gs_proj = glm::perspective(glm::radians(gs.camera_fov), aspect, 0.1f, 1000.0f);
        gs_proj[1][1] *= -1.0f;
        renderer_.set_gs_camera(gs_view, gs_proj);
    }

    if (!gs.background_image.empty()) {
        auto bg_tex = resources_.load_texture(gs.background_image);
        renderer_.set_gs_background(bg_tex);
        std::fprintf(stderr, "GS: Background loaded: %s\n", gs.background_image.c_str());
    }

    if (feature_flags_.gs_parallax && gs.parallax) {
        gs_parallax_camera_.configure(
            gs.camera_position, gs.camera_target,
            gs.camera_fov, renderer_.gs_renderer().output_width(), renderer_.gs_renderer().output_height(),
            *gs.parallax);
        gs_parallax_active_ = true;
        gs_frame_counter_ = 0;

        renderer_.set_gs_skip_chunk_cull(true);
        renderer_.gs_renderer().set_skip_sort(false);

        glm::vec3 cam_fwd = glm::normalize(gs.camera_target - gs.camera_position);
        renderer_.gs_renderer().set_shadow_box_params(
            cam_fwd, 0.0f, gs.camera_position, 32.0f);

        std::fprintf(stderr, "GS: Parallax camera enabled (strength=%.2f)\n",
                     gs.parallax->parallax_strength);
    } else {
        gs_parallax_active_ = false;
        renderer_.set_gs_skip_chunk_cull(false);
        renderer_.gs_renderer().clear_shadow_box_params();
    }
}

void DemoApp::init_environment(SceneData& scene_data) {
    if (scene_data.collision) {
        collision_grid_ = *scene_data.collision;
    }

    scene_.set_tile_layer(std::move(scene_data.tilemap));
    scene_.set_ambient_color(scene_data.ambient_color);

    if (!scene_data.tile_animations.empty()) {
        TileAnimator animator;
        for (auto& def : scene_data.tile_animations) {
            animator.add_definition(std::move(def));
        }
        scene_.set_tile_animator(std::move(animator));
    }

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

    for (size_t i = 0; i < scene_data.torch_positions.size() && i < 4; ++i) {
        torch_emitter_ids_[i] = particles_.add_emitter(
            scene_data.torch_emitter, scene_data.torch_positions[i]);
    }
}

void DemoApp::init_weather_and_systems(const SceneData& scene_data) {
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

    day_night_system_.init(scene_data.day_night);

    for (size_t i = 0; i < scene_data.torch_audio_positions.size() && i < 4; ++i) {
        audio_.set_torch_position(static_cast<uint32_t>(i), scene_data.torch_audio_positions[i]);
    }

    if (scene_data.minimap_config) {
        minimap_.set_config(*scene_data.minimap_config);
    }
}

// ---------------------------------------------------------------------------
// clear_scene
// ---------------------------------------------------------------------------

void DemoApp::clear_scene() {
    world_.clear();
    player_id_ = ecs::kNullEntity;
    npc_ids_.clear();
    npc_dialogs_.clear();
    entity_sprites_.clear();
    shadow_sprites_.clear();
    reflection_sprites_.clear();

    particles_.clear();
    weather_system_.reset();
    day_night_system_.reset();
    for (auto& id : torch_emitter_ids_) id = 0;

    collision_grid_ = {};
    gs_parallax_active_ = false;
    gs_frame_counter_ = 0;
    gs_last_compute_offset_ = glm::vec2(0.0f);
    renderer_.set_gs_skip_chunk_cull(false);

    scene_.clear_lights();
    scene_.set_fog_density(0.0f);
    scene_.set_background_layers({});
    scene_.set_tile_animator({});

    portals_.clear();

    scene_npc_data_.clear();
    static_lights_.clear();

    game_mode_ = GameMode::Explore;
    dialog_state_ = {};
}

// ---------------------------------------------------------------------------
// check_portals
// ---------------------------------------------------------------------------

void DemoApp::check_portals() {
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

// ---------------------------------------------------------------------------
// update_game + sub-methods
// ---------------------------------------------------------------------------

void DemoApp::update_game(float dt) {
    if (transitioning_) return;

    if (game_mode_ == GameMode::Dialog) {
        update_dialog_mode(dt);
    } else if (player_id_.valid()) {
        update_explore_mode(dt);
    }

    update_shared_systems(dt);
}

void DemoApp::update_dialog_mode(float dt) {
    if (input_.was_key_pressed(GLFW_KEY_E) || input_.was_key_pressed(GLFW_KEY_SPACE)) {
        if (!dialog_state_.advance()) {
            game_mode_ = GameMode::Explore;
            audio_.play(SoundId::DialogClose);
        } else {
            audio_.play(SoundId::DialogBlip);
        }
    }

    ecs::systems::animation_update(world_, dt);

    if (dialog_state_.active) {
        const auto& line = dialog_state_.current();
        const auto& speaker = locale_.get(line.speaker_key);
        const auto& text = locale_.get(line.text_key);
        const auto& prompt = locale_.get("prompt_continue");

        ui_ctx_.panel(640.0f, 610.0f, 1200.0f, 180.0f, {0.05f, 0.05f, 0.12f, 0.88f});
        ui_ctx_.label(speaker, 60.0f, 535.0f, 0.8f, {1.0f, 0.85f, 0.2f, 1.0f});
        ui_ctx_.label(prompt, 1180.0f, 680.0f, 0.5f, {0.7f, 0.7f, 0.7f, 1.0f});

        const auto& dl = ui_ctx_.draw_list();
        ui_sprites_.insert(ui_sprites_.end(), dl.begin(), dl.end());

        auto text_sprites = text_renderer_.render_wrapped(
            text, 60.0f, 580.0f, 0.0f, 0.6f, {1.0f, 1.0f, 1.0f, 1.0f}, 1160.0f, true);
        ui_sprites_.insert(ui_sprites_.end(), text_sprites.begin(), text_sprites.end());
    }
}

void DemoApp::update_explore_mode(float dt) {
    auto move_result = ecs::systems::player_movement(world_, input_, dt);

    if (feature_flags_.tilemap_collision && scene_.tile_layer().has_value()) {
        ecs::systems::player_collision(world_, *scene_.tile_layer());
    }

    if (feature_flags_.scene_transitions) {
        check_portals();
        if (transitioning_) return;
    }

    auto& player_pos = world_.get<ecs::Transform>(player_id_).position;
    renderer_.camera().set_follow_target(player_pos);

    if (feature_flags_.gs_parallax && gs_parallax_active_ && renderer_.has_gs_cloud()) {
        auto& grid = renderer_.gs_chunk_grid();
        if (!grid.empty()) {
            auto aabb = grid.cloud_bounds();
            glm::vec2 map_center = {
                (aabb.min.x + aabb.max.x) * 0.5f,
                (aabb.min.y + aabb.max.y) * 0.5f
            };
            glm::vec2 map_half = {
                std::max((aabb.max.x - aabb.min.x) * 0.5f, 1.0f),
                std::max((aabb.max.y - aabb.min.y) * 0.5f, 1.0f)
            };
            glm::vec2 player_xy = {player_pos.x, player_pos.y};
            glm::vec2 player_offset = (player_xy - map_center) / map_half;
            player_offset = glm::clamp(player_offset, glm::vec2(-1.0f), glm::vec2(1.0f));
            gs_parallax_camera_.update(player_offset, dt);

            bool is_compute_frame = (gs_frame_counter_ % gs_render_interval_) == 0;
            gs_frame_counter_++;

            if (is_compute_frame) {
                renderer_.gs_renderer().set_skip_sort(false);
                renderer_.set_gs_camera(gs_parallax_camera_.view(), gs_parallax_camera_.proj());
                renderer_.set_gs_blit_offset(0.0f, 0.0f);
                gs_last_compute_offset_ = player_offset;
            } else {
                renderer_.gs_renderer().set_skip_sort(true);
                glm::vec2 delta = player_offset - gs_last_compute_offset_;
                constexpr float kParallaxPixels = 30.0f;
                renderer_.set_gs_blit_offset(
                    delta.x * kParallaxPixels,
                    -delta.y * kParallaxPixels);
            }
        }
    }

    auto& player_facing = world_.get<ecs::Facing>(player_id_);
    const char* dir_str = direction_suffix(player_facing.dir);

    const std::string state_prefix = move_result.sprinting ? "run"
                                   : move_result.moving    ? "walk"
                                                           : "idle";
    auto& player_anim = world_.get<ecs::Animation>(player_id_);
    player_anim.state_machine.transition_to(state_prefix + "_" + dir_str);

    if (feature_flags_.npc_patrol && scene_.tile_layer().has_value()) {
        ecs::systems::npc_patrol(world_, *scene_.tile_layer(), dt);
        ecs::systems::npc_pathfind(world_, *scene_.tile_layer(), dt);
    }

    script_system_.update(dt);
    script_system_.check_hot_reload();

    if (feature_flags_.animation) {
        ecs::systems::animation_update(world_, dt);
    }

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

    if (nearest_npc >= 0) {
        const auto& npc_pos = world_.get<ecs::Transform>(npc_ids_[nearest_npc]).position;
        auto prompt_sprites = text_renderer_.render_text(
            locale_.get("prompt_interact"),
            npc_pos.x - 0.2f, npc_pos.y + 0.7f, -0.1f,
            0.02f, {1.0f, 0.9f, 0.2f, 1.0f});
        overlay_sprites_.insert(overlay_sprites_.end(),
                                prompt_sprites.begin(), prompt_sprites.end());

        if (input_.was_key_pressed(GLFW_KEY_E)) {
            const auto& dialog_ref = world_.get<ecs::DialogRef>(npc_ids_[nearest_npc]);
            size_t di = dialog_ref.dialog_index;
            if (di < npc_dialogs_.size()) {
                dialog_state_.start(npc_dialogs_[di]);
                game_mode_ = GameMode::Dialog;
                audio_.play(SoundId::DialogOpen);
                player_anim.state_machine.transition_to(std::string("idle_") + dir_str);
            }
        }
    }
}

void DemoApp::update_shared_systems(float dt) {
    if (feature_flags_.animated_tiles && scene_.tile_animator()) {
        scene_.tile_animator()->update(dt);
    }

    if (feature_flags_.day_night_cycle && day_night_system_.active()) {
        day_night_system_.update(dt, scene_,
            (feature_flags_.weather && weather_system_.active()) ? &weather_system_ : nullptr);
    }

    if (feature_flags_.weather && weather_system_.active()) {
        const auto& cam = renderer_.camera();
        weather_system_.update(dt, scene_, {cam.target().x, cam.target().y});
    }

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

// ---------------------------------------------------------------------------
// update_audio
// ---------------------------------------------------------------------------

void DemoApp::update_audio(float dt) {
    audio_.set_music_muted(!feature_flags_.music);
    audio_.set_sfx_muted(!feature_flags_.sfx);

    const auto& cam = renderer_.camera();
    glm::vec3 cam_pos = cam.position();
    glm::vec3 cam_target = cam.target();
    glm::vec3 forward = glm::normalize(cam_target - cam_pos);
    audio_.set_listener(cam_pos, forward, {0.0f, 1.0f, 0.0f});

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

    const bool moving = input_.is_key_down(GLFW_KEY_W) || input_.is_key_down(GLFW_KEY_A) ||
                        input_.is_key_down(GLFW_KEY_S) || input_.is_key_down(GLFW_KEY_D);
    const bool sprinting = moving && input_.is_key_down(GLFW_KEY_LEFT_SHIFT);
    float current_speed = sprinting ? 8.0f : (moving ? 4.0f : 0.0f);
    audio_.set_player_speed(std::clamp(current_speed / 8.0f, 0.0f, 1.0f));

    if (game_mode_ == GameMode::Dialog) {
        audio_.set_music_state(MusicState::Dialog);
    } else if (proximity > 0.3f) {
        audio_.set_music_state(MusicState::NearNPC);
    } else {
        audio_.set_music_state(MusicState::Explore);
    }

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

}  // namespace gseurat
