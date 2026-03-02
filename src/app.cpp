#include "vulkan_game/app.hpp"
#include "vulkan_game/engine/tilemap.hpp"

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include <stb_image_write.h>

#include <filesystem>

namespace vulkan_game {

void App::generate_player_sheet() {
    constexpr int kFrameW   = 16;
    constexpr int kFrameH   = 16;
    constexpr int kFrames   = 4;
    constexpr int kRows     = 3;
    constexpr int kWidth    = kFrameW * kFrames;  // 64
    constexpr int kHeight   = kFrameH * kRows;    // 48
    constexpr int kChannels = 4;                  // RGBA

    // row 0: idle — grayscale brightness pulse
    // row 1: walk — blue tint series
    // row 2: run  — orange tint high-contrast
    const uint8_t row_colors[kRows][kFrames][4] = {
        {{180,180,180,255}, {210,210,210,255}, {240,240,240,255}, {210,210,210,255}},
        {{ 80,120,220,255}, {100,140,230,255}, { 60,100,200,255}, {100,140,230,255}},
        {{230,120, 40,255}, {255,160, 60,255}, {200, 90, 20,255}, {255,160, 60,255}},
    };

    std::vector<uint8_t> pixels(kWidth * kHeight * kChannels);

    for (int sheet_row = 0; sheet_row < kRows; ++sheet_row) {
        for (int frame = 0; frame < kFrames; ++frame) {
            for (int py_local = 0; py_local < kFrameH; ++py_local) {
                int py_abs = sheet_row * kFrameH + py_local;
                for (int px_local = 0; px_local < kFrameW; ++px_local) {
                    int px = frame * kFrameW + px_local;
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

void App::run() {
    init_window();
    generate_player_sheet();
    renderer_.init(window_);
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

    // Configure animation state machine: 3-row sheet (idle/walk/run)
    player_anim_.configure(Tileset{16, 16, 4, 64, 48});

    // idle: tile_ids 0–3 (row 0), 0.30s/frame
    AnimationClip idle_clip;
    idle_clip.name = "idle";
    idle_clip.looping = true;
    for (uint32_t i = 0; i < 4; ++i) idle_clip.frames.push_back(AnimationFrame{i, 0.30f});
    player_anim_.add_clip(std::move(idle_clip));

    // walk: tile_ids 4–7 (row 1), 0.12s/frame
    AnimationClip walk_clip;
    walk_clip.name = "walk";
    walk_clip.looping = true;
    for (uint32_t i = 4; i < 8; ++i) walk_clip.frames.push_back(AnimationFrame{i, 0.12f});
    player_anim_.add_clip(std::move(walk_clip));

    // run: tile_ids 8–11 (row 2), 0.07s/frame
    AnimationClip run_clip;
    run_clip.name = "run";
    run_clip.looping = true;
    for (uint32_t i = 8; i < 12; ++i) run_clip.frames.push_back(AnimationFrame{i, 0.07f});
    player_anim_.add_clip(std::move(run_clip));

    // First transition seeds UV correctly (current_state_ starts as "")
    player_anim_.transition_to("idle");

    // Seed entity UVs immediately
    player_entity_->uv_min = player_anim_.current_uv_min();
    player_entity_->uv_max = player_anim_.current_uv_max();

    // Camera follows player
    renderer_.camera().set_follow_target(player_entity_->transform.position);
    renderer_.camera().set_follow_speed(5.0f);

    // Test tilemap: 8x8 grid, all tile 0, using a 16x16-pixel single-tile sheet
    TileLayer layer{};
    layer.tileset = Tileset{16, 16, 1, 16, 16};
    layer.width = 8;
    layer.height = 8;
    layer.tile_size = 1.0f;
    layer.z = 1.0f;  // behind player at Z=0
    layer.tiles.assign(64, 0);
    scene_.set_tile_layer(std::move(layer));
}

void App::update_game(float dt) {
    if (player_entity_) {
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

        renderer_.camera().set_follow_target(pos);

        const std::string target = sprinting ? "run" : moving ? "walk" : "idle";
        player_anim_.transition_to(target);
        player_anim_.update(dt);
        player_entity_->uv_min = player_anim_.current_uv_min();
        player_entity_->uv_max = player_anim_.current_uv_max();
    }

    if (input_.is_key_down(GLFW_KEY_ESCAPE)) {
        glfwSetWindowShouldClose(window_, GLFW_TRUE);
    }
}

void App::main_loop() {
    last_update_time_ = std::chrono::steady_clock::now();

    while (!glfwWindowShouldClose(window_)) {
        glfwPollEvents();

        auto now = std::chrono::steady_clock::now();
        float dt = std::chrono::duration<float>(now - last_update_time_).count();
        last_update_time_ = now;

        // Clamp to 100 ms to absorb startup hitches
        if (dt > 0.1f) dt = 0.1f;

        update_game(dt);
        renderer_.draw_scene(scene_);
    }
}

void App::cleanup() {
    renderer_.shutdown();
    glfwDestroyWindow(window_);
    glfwTerminate();
}

}  // namespace vulkan_game
