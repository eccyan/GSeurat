#include "gseurat/staging/staging_app.hpp"
#include "gseurat/staging/staging_state.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/gs_parallax_camera.hpp"
#include "gseurat/engine/scene_loader.hpp"
#include "gseurat/engine/gs_vfx.hpp"

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include <stb_image_write.h>

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

#include <glm/gtc/matrix_transform.hpp>

#include <cstdio>
#include <filesystem>
#include <string_view>

namespace gseurat {

void StagingApp::parse_args(int argc, char* argv[]) {
    for (int i = 1; i < argc; ++i) {
        std::string_view arg(argv[i]);
        if (arg == "--scene" && i + 1 < argc) {
            scene_path_ = argv[++i];
        }
    }
}

void StagingApp::run() {
    command_dispatcher_.register_default_commands();
    init_game_object_system();
    init_game_content();
    scene_objects_.current_scene_path = scene_path_;
    set_start_state(std::make_unique<StagingState>());
    main_loop();
    cleanup();
}

void StagingApp::init_game_content() {
    init_window();

    // Font atlas (ASCII only)
    std::vector<uint32_t> codepoints;
    for (uint32_t cp = 32; cp <= 126; cp++) codepoints.push_back(cp);
    font_atlas_.init("assets/fonts/NotoSans-Regular.ttf", 32.0f, codepoints);
    text_renderer_.init(font_atlas_);

    renderer_.init(window_, resources_);
    renderer_.init_font(font_atlas_, resources_);
    renderer_.init_particles(resources_);
    renderer_.init_shadows(resources_);

    ui_ctx_.init(font_atlas_, text_renderer_);

    // Start with all post-process/effects off — user enables what they want to review.
    // GS pipeline flags (rendering, chunk culling, LOD, adaptive budget) stay on.
    feature_flags_ = FeatureFlags::gs_viewer();
    feature_flags_.particles = true;
    feature_flags_.animation = true;
    feature_flags_.fog = true;
    feature_flags_.apply_platform_defaults(renderer_.context().is_apple_gpu());
}

// ── Scene loading (reuse from DemoApp pattern) ──

void StagingApp::init_scene(const std::string& scene_path) {
    scene_objects_.current_scene_path = scene_path;
    auto scene_data = SceneLoader::load(scene_path);
    scene_objects_.game_objects = scene_data.game_objects;
    scene_objects_.portals = scene_data.portals;
    load_gs_scene(scene_data);
    std::fprintf(stderr, "[Staging] Loaded scene: %s\n", scene_path.c_str());
}

void StagingApp::clear_scene() {
    vkDeviceWaitIdle(renderer_.context().device());
    renderer_.clear_gs_particle_emitters();
    renderer_.clear_gs_animations();
    renderer_.clear_vfx_instances();
    scene_.clear_lights();
    gs_terrain_.terrain_aabb = AABB{};
    gs_terrain_.terrain_aabb.min = glm::vec3(0.0f);
    gs_terrain_.terrain_aabb.max = glm::vec3(0.0f);
    // Don't re-init GS here — init_scene() will do it if needed.
    // For empty viewport on standalone launch, on_enter() handles it.
}

}  // namespace gseurat
