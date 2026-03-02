#include "vulkan_game/app.hpp"
#include "vulkan_game/engine/tilemap.hpp"

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include <stb_image_write.h>

#include <filesystem>

namespace vulkan_game {

void App::generate_player_sheet() {
    constexpr int kFrameW = 16;
    constexpr int kFrameH = 16;
    constexpr int kFrames = 4;
    constexpr int kWidth  = kFrameW * kFrames;  // 64
    constexpr int kHeight = kFrameH;             // 16
    constexpr int kChannels = 4;                 // RGBA

    // Frame colors: light-gray, red-tint, green-tint, blue-tint
    const uint8_t frame_colors[kFrames][4] = {
        {200, 200, 200, 255},
        {220,  80,  80, 255},
        { 80, 200,  80, 255},
        { 80,  80, 220, 255},
    };

    std::vector<uint8_t> pixels(kWidth * kHeight * kChannels);

    for (int frame = 0; frame < kFrames; ++frame) {
        for (int row = 0; row < kFrameH; ++row) {
            for (int col = 0; col < kFrameW; ++col) {
                int px = (frame * kFrameW + col);
                int py = row;
                int idx = (py * kWidth + px) * kChannels;
                pixels[idx + 0] = frame_colors[frame][0];
                pixels[idx + 1] = frame_colors[frame][1];
                pixels[idx + 2] = frame_colors[frame][2];
                pixels[idx + 3] = frame_colors[frame][3];
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

    // Configure animation: 4-frame idle clip at 0.25s per frame
    player_anim_.set_sheet(Tileset{16, 16, 4, 64, 16});
    AnimationClip idle_clip;
    idle_clip.name = "idle";
    idle_clip.looping = true;
    for (uint32_t i = 0; i < 4; ++i) {
        idle_clip.frames.push_back(AnimationFrame{i, 0.25f});
    }
    player_anim_.add_clip(std::move(idle_clip));
    player_anim_.play("idle");

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
    constexpr float kMoveSpeed = 4.0f;

    if (player_entity_) {
        auto& pos = player_entity_->transform.position;
        if (input_.is_key_down(GLFW_KEY_W)) pos.y += kMoveSpeed * dt;
        if (input_.is_key_down(GLFW_KEY_S)) pos.y -= kMoveSpeed * dt;
        if (input_.is_key_down(GLFW_KEY_A)) pos.x -= kMoveSpeed * dt;
        if (input_.is_key_down(GLFW_KEY_D)) pos.x += kMoveSpeed * dt;

        renderer_.camera().set_follow_target(pos);

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
