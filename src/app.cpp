#include "vulkan_game/app.hpp"
#include "vulkan_game/engine/ecs/default_components.hpp"
#include "vulkan_game/game/components.hpp"
#include "vulkan_game/game/states/title_state.hpp"
#include "vulkan_game/game/systems.hpp"
#include "vulkan_game/engine/scene_loader.hpp"
#include "vulkan_game/engine/tilemap.hpp"

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include <stb_image_write.h>

#include <cmath>
#include <cstring>
#include <filesystem>
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
    constexpr int kTiles    = 2;
    constexpr int kWidth    = kTileW * kTiles;  // 32
    constexpr int kHeight   = kTileH;           // 16
    constexpr int kChannels = 4;

    const uint8_t tile_colors[kTiles][4] = {
        {200, 185, 145, 255},
        { 70,  60,  55, 255},
    };

    std::vector<uint8_t> pixels(kWidth * kHeight * kChannels);

    for (int tile = 0; tile < kTiles; ++tile) {
        for (int py = 0; py < kTileH; ++py) {
            for (int px_local = 0; px_local < kTileW; ++px_local) {
                int px  = tile * kTileW + px_local;
                int idx = (py * kWidth + px) * kChannels;
                pixels[idx + 0] = tile_colors[tile][0];
                pixels[idx + 1] = tile_colors[tile][1];
                pixels[idx + 2] = tile_colors[tile][2];
                pixels[idx + 3] = tile_colors[tile][3];
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

void App::generate_audio_assets() {
    std::filesystem::create_directories("assets/audio");

    constexpr uint32_t kRate = 44100;
    constexpr float kPi = 3.14159265358979323846f;

    // 1. music_bass.wav — 4.0s low sine chord C2+G2 with tremolo
    {
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
    {
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
    {
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
    {
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

void App::init_scene() {
    auto scene_data = SceneLoader::load("assets/scenes/test_scene.json");

    // Animation setup helper (shared by player and NPCs)
    auto setup_anim = [](ecs::Animation& anim_comp) {
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
        setup_anim(player_anim);
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
        setup_anim(npc_anim);
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
        world_.add<ecs::NpcPatrol>(npc, ecs::NpcPatrol{
            npc_data.facing, npc_data.reverse_facing, 0.0f,
            npc_data.patrol_interval, npc_data.patrol_speed});
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

    // Tilemap from scene data
    scene_.set_tile_layer(std::move(scene_data.tilemap));
    scene_.set_ambient_color(scene_data.ambient_color);

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

    // Audio: position torch crackle instances
    for (size_t i = 0; i < scene_data.torch_audio_positions.size() && i < 4; ++i) {
        audio_.set_torch_position(static_cast<uint32_t>(i), scene_data.torch_audio_positions[i]);
    }
}

void App::update_game(float dt) {
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

        auto& player_pos = world_.get<ecs::Transform>(player_id_).position;
        renderer_.camera().set_follow_target(player_pos);

        auto& player_facing = world_.get<ecs::Facing>(player_id_);
        const char* dir_str = direction_suffix(player_facing.dir);

        const std::string state_prefix = move_result.sprinting ? "run"
                                       : move_result.moving    ? "walk"
                                                               : "idle";
        auto& player_anim = world_.get<ecs::Animation>(player_id_);
        player_anim.state_machine.transition_to(state_prefix + "_" + dir_str);

        // NPC patrol
        if (feature_flags_.npc_patrol && scene_.tile_layer().has_value()) {
            ecs::systems::npc_patrol(world_, *scene_.tile_layer(), dt);
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
    ecs::systems::lighting_rebuild(world_, scene_, feature_flags_.npc_lights);
    ecs::systems::sprite_collect(world_, entity_sprites_);
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
            ui_ctx_.begin_frame(ui_input);
        }

        // Let states build their draw lists
        state_stack_.build_draw_lists(*this);

        // Always render
        std::vector<SpriteDrawInfo> particle_sprites;
        particles_.generate_draw_infos(particle_sprites);
        renderer_.draw_scene(scene_, entity_sprites_, particle_sprites, overlay_sprites_, ui_sprites_,
                             feature_flags_);
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
    return data;
}

void App::apply_save_data(const SaveData& data) {
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
}

void App::emit_event(const std::string& event, const nlohmann::json& data) {
    if (!control_server_.has_client()) return;
    nlohmann::json msg;
    msg["type"] = "event";
    msg["event"] = event;
    msg["tick"] = tick_;
    if (!data.is_null()) {
        msg["data"] = data;
    }
    control_server_.send(msg);
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
