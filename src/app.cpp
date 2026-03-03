#include "vulkan_game/app.hpp"
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
    constexpr int kTiles    = 4;
    constexpr int kWidth    = kTileSize * kTiles;  // 64
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
        }
    }

    std::filesystem::create_directories("assets/textures");
    stbi_write_png("assets/textures/particle_atlas.png", kWidth, kHeight, kChannels,
                   pixels.data(), kWidth * kChannels);
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

void App::run() {
    init_window();
    generate_player_sheet();
    generate_tileset();
    generate_particle_atlas();
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

    renderer_.init(window_);
    renderer_.init_font(font_atlas_);
    renderer_.init_particles();
    audio_.init("assets");
    init_scene();
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
    // Create player entity at origin
    player_entity_ = scene_.create_entity();
    player_entity_->transform.position = {0.0f, 0.0f, 0.0f};
    player_entity_->transform.scale = {1.0f, 1.0f};
    player_entity_->tint = {1.0f, 1.0f, 1.0f, 1.0f};

    // Configure animation state machine: 12-row sheet (3 states x 4 directions)
    player_anim_.configure(Tileset{16, 16, 4, 64, 192});

    const std::array<std::string, 3> state_names = {"idle", "walk", "run"};
    const std::array<std::string, 4> dir_names   = {"down", "left", "right", "up"};
    const std::array<float, 3> frame_durations   = {0.30f, 0.12f, 0.07f};

    for (int state = 0; state < 3; ++state) {
        for (int dir = 0; dir < 4; ++dir) {
            int sheet_row      = state * 4 + dir;
            uint32_t base_tile = static_cast<uint32_t>(sheet_row * 4);
            AnimationClip clip;
            clip.name    = state_names[state] + "_" + dir_names[dir];
            clip.looping = true;
            for (uint32_t f = 0; f < 4; ++f) {
                clip.frames.push_back(AnimationFrame{base_tile + f, frame_durations[state]});
            }
            player_anim_.add_clip(std::move(clip));
        }
    }

    player_anim_.transition_to("idle_down");
    player_entity_->uv_min = player_anim_.current_uv_min();
    player_entity_->uv_max = player_anim_.current_uv_max();

    renderer_.camera().set_follow_target(player_entity_->transform.position);
    renderer_.camera().set_follow_speed(5.0f);

    // NPC animation setup helper
    auto setup_anim = [](AnimationStateMachine& anim) {
        anim.configure(Tileset{16, 16, 4, 64, 192});
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
                anim.add_clip(std::move(clip));
            }
        }
    };

    // NPC dialog scripts (reference locale keys)
    npc_dialogs_.resize(3);
    npc_dialogs_[0].lines = {{"guard_name", "guard_line_1"}, {"guard_name", "guard_line_2"}};
    npc_dialogs_[1].lines = {{"merchant_name", "merchant_line_1"}, {"merchant_name", "merchant_line_2"}};
    npc_dialogs_[2].lines = {{"scholar_name", "scholar_line_1"}, {"scholar_name", "scholar_line_2"}};

    // NPCs
    npcs_.reserve(3);

    // NPC 0: Guard (red), left-right at y=2
    npcs_.emplace_back();
    npcs_.back().entity = scene_.create_entity();
    npcs_.back().entity->transform.position = {-3.0f, 2.0f, 0.0f};
    npcs_.back().entity->transform.scale    = {1.0f, 1.0f};
    npcs_.back().entity->tint               = {1.0f, 0.8f, 0.8f, 1.0f};
    setup_anim(npcs_.back().anim);
    npcs_.back().dir         = Direction::Right;
    npcs_.back().reverse_dir = Direction::Left;
    npcs_.back().interval    = 3.0f;
    npcs_.back().speed       = 2.0f;
    npcs_.back().dialog_index = 0;
    npcs_.back().anim.transition_to("walk_right");
    npcs_.back().entity->uv_min = npcs_.back().anim.current_uv_min();
    npcs_.back().entity->uv_max = npcs_.back().anim.current_uv_max();

    // NPC 1: Merchant (green), up-down at x=4
    npcs_.emplace_back();
    npcs_.back().entity = scene_.create_entity();
    npcs_.back().entity->transform.position = {4.0f, -2.0f, 0.0f};
    npcs_.back().entity->transform.scale    = {1.0f, 1.0f};
    npcs_.back().entity->tint               = {0.8f, 1.0f, 0.8f, 1.0f};
    setup_anim(npcs_.back().anim);
    npcs_.back().dir         = Direction::Up;
    npcs_.back().reverse_dir = Direction::Down;
    npcs_.back().interval    = 2.5f;
    npcs_.back().speed       = 2.0f;
    npcs_.back().dialog_index = 1;
    npcs_.back().anim.transition_to("walk_up");
    npcs_.back().entity->uv_min = npcs_.back().anim.current_uv_min();
    npcs_.back().entity->uv_max = npcs_.back().anim.current_uv_max();

    // NPC 2: Scholar (blue), left-right at y=-4
    npcs_.emplace_back();
    npcs_.back().entity = scene_.create_entity();
    npcs_.back().entity->transform.position = {0.0f, -4.0f, 0.0f};
    npcs_.back().entity->transform.scale    = {1.0f, 1.0f};
    npcs_.back().entity->tint               = {0.8f, 0.8f, 1.0f, 1.0f};
    setup_anim(npcs_.back().anim);
    npcs_.back().dir         = Direction::Left;
    npcs_.back().reverse_dir = Direction::Right;
    npcs_.back().interval    = 3.5f;
    npcs_.back().speed       = 2.0f;
    npcs_.back().dialog_index = 2;
    npcs_.back().anim.transition_to("walk_left");
    npcs_.back().entity->uv_min = npcs_.back().anim.current_uv_min();
    npcs_.back().entity->uv_max = npcs_.back().anim.current_uv_max();

    // Tilemap: 16x16, border walls + 4 interior pillars
    TileLayer layer{};
    layer.tileset   = Tileset{16, 16, 2, 32, 16};
    layer.width     = 16;
    layer.height    = 16;
    layer.tile_size = 1.0f;
    layer.z         = 1.0f;
    layer.tiles.resize(16 * 16, 0);
    layer.solid.resize(16 * 16, false);

    for (uint32_t row = 0; row < 16; ++row) {
        for (uint32_t col = 0; col < 16; ++col) {
            const bool border  = (col == 0 || col == 15 || row == 0 || row == 15);
            const bool pillar  = ((col == 4 || col == 11) && (row == 4 || row == 11));
            const bool is_wall = border || pillar;
            const uint32_t idx = row * 16 + col;
            layer.tiles[idx] = is_wall ? 1 : 0;
            layer.solid[idx] = is_wall;
        }
    }

    scene_.set_tile_layer(std::move(layer));
    scene_.set_ambient_color({0.25f, 0.28f, 0.45f, 1.0f});

    // --- Particle emitters ---

    // Torch embers: warm orange particles rising from 4 pillar positions
    {
        EmitterConfig cfg;
        cfg.spawn_rate           = 8.0f;
        cfg.particle_lifetime_min = 0.8f;
        cfg.particle_lifetime_max = 1.6f;
        cfg.velocity_min         = {-0.3f, 0.5f};
        cfg.velocity_max         = { 0.3f, 1.5f};
        cfg.acceleration         = {0.0f, 0.2f};
        cfg.size_min             = 0.04f;
        cfg.size_max             = 0.10f;
        cfg.size_end_scale       = 0.1f;
        cfg.color_start          = {1.0f, 0.75f, 0.2f, 0.9f};
        cfg.color_end            = {1.0f, 0.3f, 0.0f, 0.0f};
        cfg.tile                 = ParticleTile::SoftGlow;
        cfg.z                    = -0.05f;
        cfg.spawn_offset_min     = {-0.15f, -0.1f};
        cfg.spawn_offset_max     = { 0.15f,  0.1f};

        const glm::vec2 pillar_pos[] = {
            {-3.5f,  3.5f}, { 3.5f,  3.5f},
            {-3.5f, -3.5f}, { 3.5f, -3.5f},
        };
        for (int i = 0; i < 4; ++i) {
            torch_emitter_ids_[i] = particles_.add_emitter(cfg, pillar_pos[i]);
        }
    }

    // Footstep dust: brown-gray puffs at player feet (starts inactive)
    {
        EmitterConfig cfg;
        cfg.spawn_rate           = 12.0f;
        cfg.particle_lifetime_min = 0.3f;
        cfg.particle_lifetime_max = 0.6f;
        cfg.velocity_min         = {-0.5f, -0.1f};
        cfg.velocity_max         = { 0.5f,  0.3f};
        cfg.size_min             = 0.06f;
        cfg.size_max             = 0.12f;
        cfg.size_end_scale       = 1.5f;
        cfg.color_start          = {0.6f, 0.55f, 0.45f, 0.6f};
        cfg.color_end            = {0.5f, 0.48f, 0.40f, 0.0f};
        cfg.tile                 = ParticleTile::SmokePuff;
        cfg.z                    = -0.02f;
        cfg.spawn_offset_min     = {-0.15f, -0.4f};
        cfg.spawn_offset_max     = { 0.15f, -0.3f};

        footstep_emitter_id_ = particles_.add_emitter(cfg, {0.0f, 0.0f});
        particles_.set_emitter_active(footstep_emitter_id_, false);
    }

    // NPC aura sparkles: colored sparkles matching each NPC tint
    {
        const glm::vec4 colors[] = {
            {1.0f, 0.3f, 0.2f, 0.8f},
            {0.2f, 1.0f, 0.3f, 0.8f},
            {0.2f, 0.3f, 1.0f, 0.8f},
        };
        const glm::vec4 end_colors[] = {
            {1.0f, 0.6f, 0.4f, 0.0f},
            {0.4f, 1.0f, 0.6f, 0.0f},
            {0.4f, 0.6f, 1.0f, 0.0f},
        };
        for (int i = 0; i < 3; ++i) {
            EmitterConfig cfg;
            cfg.spawn_rate           = 6.0f;
            cfg.particle_lifetime_min = 0.6f;
            cfg.particle_lifetime_max = 1.2f;
            cfg.velocity_min         = {-0.4f, -0.2f};
            cfg.velocity_max         = { 0.4f,  0.5f};
            cfg.acceleration         = {0.0f, 0.1f};
            cfg.size_min             = 0.03f;
            cfg.size_max             = 0.07f;
            cfg.size_end_scale       = 0.2f;
            cfg.color_start          = colors[i];
            cfg.color_end            = end_colors[i];
            cfg.tile                 = ParticleTile::Spark;
            cfg.z                    = -0.04f;
            cfg.spawn_offset_min     = {-0.4f, -0.3f};
            cfg.spawn_offset_max     = { 0.4f,  0.3f};

            const auto& npc_pos = npcs_[i].entity->transform.position;
            npc_aura_emitter_ids_[i] = particles_.add_emitter(cfg, {npc_pos.x, npc_pos.y});
        }
    }

    // --- Audio: position torch crackle instances at pillar positions ---
    const glm::vec3 torch_audio_pos[] = {
        {-3.5f, 0.0f,  3.5f},
        { 3.5f, 0.0f,  3.5f},
        {-3.5f, 0.0f, -3.5f},
        { 3.5f, 0.0f, -3.5f},
    };
    for (int i = 0; i < 4; ++i) {
        audio_.set_torch_position(static_cast<uint32_t>(i), torch_audio_pos[i]);
    }
}

void App::update_game(float dt) {
    overlay_sprites_.clear();
    ui_sprites_.clear();

    if (input_.was_key_pressed(GLFW_KEY_ESCAPE)) {
        glfwSetWindowShouldClose(window_, GLFW_TRUE);
        return;
    }

    if (game_mode_ == GameMode::Dialog) {
        // Dialog mode: freeze movement, handle advance
        if (input_.was_key_pressed(GLFW_KEY_E) || input_.was_key_pressed(GLFW_KEY_SPACE)) {
            if (!dialog_state_.advance()) {
                game_mode_ = GameMode::Explore;
                audio_.play(SoundId::DialogClose);
            } else {
                audio_.play(SoundId::DialogBlip);
            }
        }

        // Still update animations (idle) but don't move
        player_anim_.update(dt);
        player_entity_->uv_min = player_anim_.current_uv_min();
        player_entity_->uv_max = player_anim_.current_uv_max();
        for (auto& npc : npcs_) {
            npc.anim.update(dt);
            npc.entity->uv_min = npc.anim.current_uv_min();
            npc.entity->uv_max = npc.anim.current_uv_max();
        }

        // Build dialog UI sprites
        if (dialog_state_.active) {
            const auto& line = dialog_state_.current();
            const auto& speaker = locale_.get(line.speaker_key);
            const auto& text = locale_.get(line.text_key);
            const auto& prompt = locale_.get("prompt_continue");

            // Dialog background box (dark semi-transparent)
            SpriteDrawInfo bg{};
            bg.position = {640.0f, 610.0f, 0.5f};
            bg.size = {1200.0f, 180.0f};
            bg.color = {0.05f, 0.05f, 0.12f, 0.88f};
            const GlyphInfo* space_glyph = font_atlas_.glyph('.');
            if (space_glyph && space_glyph->size.x > 0) {
                glm::vec2 center = (space_glyph->uv_min + space_glyph->uv_max) * 0.5f;
                bg.uv_min = center;
                bg.uv_max = center;
            }
            ui_sprites_.push_back(bg);

            auto name_sprites = text_renderer_.render_text(
                speaker, 60.0f, 535.0f, 0.0f, 0.8f, {1.0f, 0.85f, 0.2f, 1.0f});
            ui_sprites_.insert(ui_sprites_.end(), name_sprites.begin(), name_sprites.end());

            auto text_sprites = text_renderer_.render_wrapped(
                text, 60.0f, 580.0f, 0.0f, 0.6f, {1.0f, 1.0f, 1.0f, 1.0f}, 1160.0f);
            ui_sprites_.insert(ui_sprites_.end(), text_sprites.begin(), text_sprites.end());

            auto prompt_sprites = text_renderer_.render_text(
                prompt, 1180.0f, 680.0f, 0.0f, 0.5f, {0.7f, 0.7f, 0.7f, 1.0f});
            ui_sprites_.insert(ui_sprites_.end(), prompt_sprites.begin(), prompt_sprites.end());
        }
    } else if (player_entity_) {
        // === Explore mode ===
        const bool w = input_.is_key_down(GLFW_KEY_W);
        const bool a = input_.is_key_down(GLFW_KEY_A);
        const bool s = input_.is_key_down(GLFW_KEY_S);
        const bool d = input_.is_key_down(GLFW_KEY_D);
        const bool moving    = w || a || s || d;
        const bool sprinting = moving && input_.is_key_down(GLFW_KEY_LEFT_SHIFT);

        const float speed = sprinting ? 8.0f : 4.0f;

        auto& pos = player_entity_->transform.position;
        if (w) pos.y += speed * dt;
        if (s) pos.y -= speed * dt;
        if (a) pos.x -= speed * dt;
        if (d) pos.x += speed * dt;

        if (scene_.tile_layer().has_value()) {
            const glm::vec2 resolved = resolve_tilemap_collision(
                {pos.x, pos.y}, 0.4f, *scene_.tile_layer());
            pos.x = resolved.x;
            pos.y = resolved.y;
        }

        renderer_.camera().set_follow_target(pos);

        if (moving) {
            if (d)      player_dir_ = Direction::Right;
            else if (a) player_dir_ = Direction::Left;
            else if (w) player_dir_ = Direction::Up;
            else        player_dir_ = Direction::Down;
        }

        const char* dir_suffix = nullptr;
        switch (player_dir_) {
            case Direction::Down:  dir_suffix = "down";  break;
            case Direction::Left:  dir_suffix = "left";  break;
            case Direction::Right: dir_suffix = "right"; break;
            case Direction::Up:    dir_suffix = "up";    break;
        }

        const std::string state_prefix = sprinting ? "run" : moving ? "walk" : "idle";
        player_anim_.transition_to(state_prefix + "_" + dir_suffix);
        player_anim_.update(dt);
        player_entity_->uv_min = player_anim_.current_uv_min();
        player_entity_->uv_max = player_anim_.current_uv_max();

        // Proximity detection: find nearest NPC within interaction range
        constexpr float kInteractRange = 1.5f;
        int nearest_npc = -1;
        float nearest_dist_sq = kInteractRange * kInteractRange;

        for (size_t i = 0; i < npcs_.size(); i++) {
            float dx = npcs_[i].entity->transform.position.x - pos.x;
            float dy = npcs_[i].entity->transform.position.y - pos.y;
            float dist_sq = dx * dx + dy * dy;
            if (dist_sq < nearest_dist_sq) {
                nearest_dist_sq = dist_sq;
                nearest_npc = static_cast<int>(i);
            }
        }

        // Show interaction prompt above nearest NPC
        if (nearest_npc >= 0) {
            const auto& npc_pos = npcs_[nearest_npc].entity->transform.position;
            auto prompt_sprites = text_renderer_.render_text(
                locale_.get("prompt_interact"),
                npc_pos.x - 0.2f, npc_pos.y + 0.7f, -0.1f,
                0.02f, {1.0f, 0.9f, 0.2f, 1.0f});
            overlay_sprites_.insert(overlay_sprites_.end(),
                                    prompt_sprites.begin(), prompt_sprites.end());

            // Interact on E press
            if (input_.was_key_pressed(GLFW_KEY_E)) {
                size_t di = npcs_[nearest_npc].dialog_index;
                if (di < npc_dialogs_.size()) {
                    dialog_state_.start(npc_dialogs_[di]);
                    game_mode_ = GameMode::Dialog;
                    audio_.play(SoundId::DialogOpen);

                    // Transition player to idle
                    player_anim_.transition_to(std::string("idle_") + dir_suffix);
                }
            }
        }
        update_npcs(dt);
    }

    update_particles(dt);
    update_lights();
    update_audio(dt);
}

void App::update_particles(float dt) {
    if (player_entity_) {
        const bool moving = input_.is_key_down(GLFW_KEY_W) || input_.is_key_down(GLFW_KEY_A) ||
                            input_.is_key_down(GLFW_KEY_S) || input_.is_key_down(GLFW_KEY_D);
        particles_.set_emitter_active(footstep_emitter_id_,
                                      moving && game_mode_ == GameMode::Explore);
        particles_.set_emitter_position(
            footstep_emitter_id_,
            {player_entity_->transform.position.x, player_entity_->transform.position.y});
    }

    for (size_t i = 0; i < npcs_.size() && i < 3; ++i) {
        const auto& pos = npcs_[i].entity->transform.position;
        particles_.set_emitter_position(npc_aura_emitter_ids_[i], {pos.x, pos.y});
    }

    particles_.update(dt);
}

void App::update_npcs(float dt) {
    static constexpr const char* kDirSuffixes[] = {"down", "left", "right", "up"};

    for (auto& npc : npcs_) {
        auto& pos = npc.entity->transform.position;
        const float prev_x = pos.x;
        const float prev_y = pos.y;

        switch (npc.dir) {
            case Direction::Down:  pos.y -= npc.speed * dt; break;
            case Direction::Left:  pos.x -= npc.speed * dt; break;
            case Direction::Right: pos.x += npc.speed * dt; break;
            case Direction::Up:    pos.y += npc.speed * dt; break;
        }

        if (scene_.tile_layer().has_value()) {
            const glm::vec2 resolved = resolve_tilemap_collision(
                {pos.x, pos.y}, 0.4f, *scene_.tile_layer());
            pos.x = resolved.x;
            pos.y = resolved.y;
        }

        const float ddx = pos.x - prev_x;
        const float ddy = pos.y - prev_y;
        const bool blocked = (ddx * ddx + ddy * ddy) < (0.001f * 0.001f);

        npc.timer += dt;
        if (blocked || npc.timer >= npc.interval) {
            std::swap(npc.dir, npc.reverse_dir);
            npc.timer = 0.0f;
        }

        int dir_idx = 0;
        switch (npc.dir) {
            case Direction::Down:  dir_idx = 0; break;
            case Direction::Left:  dir_idx = 1; break;
            case Direction::Right: dir_idx = 2; break;
            case Direction::Up:    dir_idx = 3; break;
        }

        npc.anim.transition_to(std::string("walk_") + kDirSuffixes[dir_idx]);
        npc.anim.update(dt);
        npc.entity->uv_min = npc.anim.current_uv_min();
        npc.entity->uv_max = npc.anim.current_uv_max();
    }
}

void App::update_lights() {
    scene_.clear_lights();

    // Static pillar torches (warm orange glow)
    const glm::vec4 warm_color{1.0f, 0.85f, 0.5f, 1.2f};
    const float pillar_radius = 4.0f;
    scene_.add_light(PointLight{{-3.5f,  3.5f, 0.0f, pillar_radius}, warm_color});
    scene_.add_light(PointLight{{ 3.5f,  3.5f, 0.0f, pillar_radius}, warm_color});
    scene_.add_light(PointLight{{-3.5f, -3.5f, 0.0f, pillar_radius}, warm_color});
    scene_.add_light(PointLight{{ 3.5f, -3.5f, 0.0f, pillar_radius}, warm_color});

    // Dynamic NPC lights (matching their tint colors)
    const glm::vec4 npc_colors[] = {
        {1.0f, 0.4f, 0.3f, 0.8f},  // Guard: red
        {0.3f, 1.0f, 0.4f, 0.8f},  // Merchant: green
        {0.3f, 0.4f, 1.0f, 0.8f},  // Scholar: blue
    };
    const float npc_radius = 3.0f;
    for (size_t i = 0; i < npcs_.size() && i < 3; i++) {
        const auto& pos = npcs_[i].entity->transform.position;
        scene_.add_light(PointLight{{pos.x, pos.y, 0.0f, npc_radius}, npc_colors[i]});
    }
}

void App::update_audio(float dt) {
    // Update listener from camera
    const auto& cam = renderer_.camera();
    glm::vec3 cam_pos = cam.position();
    glm::vec3 cam_target = cam.target();
    glm::vec3 forward = glm::normalize(cam_target - cam_pos);
    audio_.set_listener(cam_pos, forward, {0.0f, 1.0f, 0.0f});

    // Compute NPC proximity (min distance from player to any NPC)
    float min_dist = 100.0f;
    if (player_entity_) {
        for (const auto& npc : npcs_) {
            float dx = npc.entity->transform.position.x - player_entity_->transform.position.x;
            float dy = npc.entity->transform.position.y - player_entity_->transform.position.y;
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

    // Dialog SFX on state transitions
    // (dialog_open/close handled at transition points in update_game)

    audio_.update(dt);
}

void App::main_loop() {
    last_update_time_ = std::chrono::steady_clock::now();

    while (!glfwWindowShouldClose(window_)) {
        glfwPollEvents();
        input_.update();

        auto now = std::chrono::steady_clock::now();
        float dt = std::chrono::duration<float>(now - last_update_time_).count();
        last_update_time_ = now;

        if (dt > 0.1f) dt = 0.1f;

        update_game(dt);

        std::vector<SpriteDrawInfo> particle_sprites;
        particles_.generate_draw_infos(particle_sprites);
        renderer_.draw_scene(scene_, particle_sprites, overlay_sprites_, ui_sprites_);
    }
}

void App::cleanup() {
    audio_.shutdown();
    renderer_.shutdown();
    glfwDestroyWindow(window_);
    glfwTerminate();
}

}  // namespace vulkan_game
