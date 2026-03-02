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
    constexpr int kRows     = 12;  // 3 states × 4 directions
    constexpr int kWidth    = kFrameW * kFrames;  // 64
    constexpr int kHeight   = kFrameH * kRows;    // 192
    constexpr int kChannels = 4;

    // Row order: idle_down, idle_left, idle_right, idle_up,
    //            walk_down, walk_left, walk_right, walk_up,
    //            run_down,  run_left,  run_right,  run_up
    const uint8_t row_colors[kRows][kFrames][4] = {
        {{170,170,170,255}, {200,200,200,255}, {230,230,230,255}, {200,200,200,255}},  // idle_down
        {{150,155,180,255}, {175,180,205,255}, {200,205,230,255}, {175,180,205,255}},  // idle_left
        {{180,155,150,255}, {205,180,175,255}, {230,205,200,255}, {205,180,175,255}},  // idle_right
        {{150,180,155,255}, {175,205,180,255}, {200,230,205,255}, {175,205,180,255}},  // idle_up
        {{ 80,120,220,255}, {100,140,235,255}, { 60,100,205,255}, {100,140,235,255}},  // walk_down
        {{ 60,190,210,255}, { 80,210,230,255}, { 40,165,185,255}, { 80,210,230,255}},  // walk_left
        {{ 50,175,160,255}, { 70,195,180,255}, { 35,150,140,255}, { 70,195,180,255}},  // walk_right
        {{110, 90,210,255}, {130,110,230,255}, { 90, 70,185,255}, {130,110,230,255}},  // walk_up
        {{230,120, 40,255}, {255,160, 60,255}, {200, 90, 20,255}, {255,160, 60,255}},  // run_down
        {{240,180, 40,255}, {255,210, 70,255}, {215,155, 20,255}, {255,210, 70,255}},  // run_left
        {{220, 80, 40,255}, {245,110, 60,255}, {195, 55, 20,255}, {245,110, 60,255}},  // run_right
        {{190, 40, 40,255}, {215, 65, 65,255}, {165, 20, 20,255}, {215, 65, 65,255}},  // run_up
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

    // Configure animation state machine: 12-row sheet (3 states × 4 directions)
    player_anim_.configure(Tileset{16, 16, 4, 64, 192});

    // Row order: idle_down, idle_left, idle_right, idle_up,
    //            walk_down, walk_left, walk_right, walk_up,
    //            run_down,  run_left,  run_right,  run_up
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

    // Seed to idle_down (default facing direction)
    player_anim_.transition_to("idle_down");

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

        // Direction: only update when moving; horizontal beats vertical on diagonal
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
