#include "gseurat/demo/demo_app.hpp"
#include "gseurat/demo/gs_demo_state.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/gs_parallax_camera.hpp"
#include "gseurat/engine/scene_loader.hpp"

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include <stb_image_write.h>

#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/quaternion.hpp>

#include <cmath>
#include <cstdio>
#include <filesystem>
#include <string_view>
#include <vector>

namespace gseurat {

void DemoApp::parse_args(int argc, char* argv[]) {
    for (int i = 1; i < argc; ++i) {
        std::string_view arg(argv[i]);
        if (arg == "--scene" && i + 1 < argc) {
            scene_path_ = argv[++i];
        }
    }
}

void DemoApp::run() {
    set_current_scene_path(scene_path_);
    init_game_content();
    state_stack_.push(std::make_unique<GsDemoState>(), *this);
    main_loop();
    cleanup();
}

void DemoApp::init_game_content() {
    init_window();

    // Only generate textures needed for GS rendering
    generate_particle_atlas();
    generate_shadow_texture();
    generate_flat_normal_texture();

    // Font atlas with ASCII only (no locale needed for GS demo)
    std::vector<uint32_t> codepoints;
    for (uint32_t cp = 32; cp <= 126; cp++) codepoints.push_back(cp);
    font_atlas_.init("assets/fonts/NotoSans-Regular.ttf", 32.0f, codepoints);
    text_renderer_.init(font_atlas_);

    renderer_.init(window_, resources_);
    renderer_.init_font(font_atlas_, resources_);
    renderer_.init_particles(resources_);
    renderer_.init_shadows(resources_);

    ui_ctx_.init(font_atlas_, text_renderer_);
    audio_.init("assets");
}

void DemoApp::init_scene(const std::string& scene_path) {
    current_scene_path_ = scene_path;
    auto scene_data = SceneLoader::load(scene_path);

    // Populate scene lights for the glow overlay
    scene_.clear_lights();
    scene_.set_ambient_color(scene_data.ambient_color);
    for (const auto& pl : scene_data.static_lights) {
        scene_.add_light(pl);
    }
    if (!scene_data.static_lights.empty()) {
        std::fprintf(stderr, "Loaded %zu static lights\n", scene_data.static_lights.size());
    }

    // Only load GS data — no player, NPCs, tilemap, weather
    if (scene_data.gaussian_splat) {
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

            // Merge static placed objects into the main cloud
            if (!scene_data.placed_objects.empty()) {
                auto merged = cloud.gaussians();  // mutable copy
                uint32_t merged_count = 0;
                for (const auto& obj : scene_data.placed_objects) {
                    if (!obj.is_static) continue;
                    try {
                        auto placed_cloud = GaussianCloud::load_ply(obj.ply_file);
                        if (placed_cloud.empty()) continue;

                        // Build transform matrix from position, rotation (euler degrees), scale
                        glm::mat4 transform = glm::translate(glm::mat4(1.0f), obj.position);
                        transform = glm::rotate(transform, glm::radians(obj.rotation.x), {1,0,0});
                        transform = glm::rotate(transform, glm::radians(obj.rotation.y), {0,1,0});
                        transform = glm::rotate(transform, glm::radians(obj.rotation.z), {0,0,1});
                        transform = glm::scale(transform, glm::vec3(obj.scale));

                        glm::quat rot_q = glm::quat(glm::radians(obj.rotation));
                        auto placed_gaussians = placed_cloud.gaussians();  // copy
                        for (auto& g : placed_gaussians) {
                            g.position = glm::vec3(transform * glm::vec4(g.position, 1.0f));
                            g.scale *= obj.scale;
                            g.rotation = rot_q * g.rotation;
                        }

                        merged.insert(merged.end(), placed_gaussians.begin(), placed_gaussians.end());
                        merged_count++;
                        std::fprintf(stderr, "GS: Merged %u Gaussians from placed object '%s' (%s)\n",
                                     placed_cloud.count(), obj.id.c_str(), obj.ply_file.c_str());
                    } catch (const std::runtime_error& e) {
                        std::fprintf(stderr, "Warning: Failed to load placed object '%s': %s\n",
                                     obj.id.c_str(), e.what());
                    }
                }
                if (merged_count > 0) {
                    cloud = GaussianCloud::from_gaussians(std::move(merged));
                    std::fprintf(stderr, "GS: Merged %u static objects, total %u Gaussians\n",
                                 merged_count, cloud.count());
                }
            }

            std::fprintf(stderr, "GS: AABB min=(%.1f,%.1f,%.1f) max=(%.1f,%.1f,%.1f)\n",
                         cloud.bounds().min.x, cloud.bounds().min.y, cloud.bounds().min.z,
                         cloud.bounds().max.x, cloud.bounds().max.y, cloud.bounds().max.z);
            std::fprintf(stderr, "GS: Camera pos=(%.1f,%.1f,%.1f) target=(%.1f,%.1f,%.1f) fov=%.1f\n",
                         gs.camera_position.x, gs.camera_position.y, gs.camera_position.z,
                         gs.camera_target.x, gs.camera_target.y, gs.camera_target.z,
                         gs.camera_fov);

            // Auto-scale render resolution for large Gaussian counts
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

            // Add a test light at the camera target to verify glow rendering
            {
                PointLight test_light;
                test_light.position_and_radius = {gs.camera_target.x, gs.camera_target.z,
                                                   gs.camera_target.y + 3.0f, 10.0f};
                test_light.color = {1.0f, 0.8f, 0.4f, 3.0f};  // warm orange, high intensity
                scene_.add_light(test_light);
                std::fprintf(stderr, "Test light at camera target (%.1f, %.1f, %.1f)\n",
                             gs.camera_target.x, gs.camera_target.y + 3.0f, gs.camera_target.z);
            }

            // Set up 3D perspective camera for GS rendering
            float aspect = static_cast<float>(gs_w) / static_cast<float>(gs_h);
            auto gs_view = glm::lookAt(gs.camera_position, gs.camera_target, glm::vec3(0, 1, 0));
            auto gs_proj = glm::perspective(glm::radians(gs.camera_fov), aspect, 0.1f, 1000.0f);
            gs_proj[1][1] *= -1.0f;  // Vulkan Y-flip
            renderer_.set_gs_camera(gs_view, gs_proj);
        }

        // Load background image if specified
        if (!gs.background_image.empty()) {
            auto bg_tex = resources_.load_texture(gs.background_image);
            renderer_.set_gs_background(bg_tex);
            std::fprintf(stderr, "GS: Background loaded: %s\n", gs.background_image.c_str());
        }

        // Configure parallax camera if parallax config present
        if (feature_flags_.gs_parallax && gs.parallax) {
            gs_parallax_camera_.configure(
                gs.camera_position, gs.camera_target,
                gs.camera_fov, renderer_.gs_renderer().output_width(), renderer_.gs_renderer().output_height(),
                *gs.parallax);
            gs_parallax_active_ = true;
            gs_frame_counter_ = 0;  // first frame does full compute

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
}

void DemoApp::clear_scene() {
    // GS demo has no ECS entities to clear
}

void DemoApp::generate_particle_atlas() {
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
                float h_falloff = std::max(0.0f, 1.0f - ax / 1.5f);
                float v_alpha = fy;
                float val = h_falloff * v_alpha;
                val = std::max(0.0f, std::min(1.0f, val));
                set_pixel(4 * kTileSize + px, py, static_cast<uint8_t>(val * 255.0f));
            }

            // Tile 5: Snowflake (cross/star pattern, soft edges)
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

}  // namespace gseurat
