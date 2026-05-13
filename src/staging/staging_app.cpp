#include "gseurat/staging/staging_app.hpp"
#include "gseurat/staging/staging_state.hpp"
#include "gseurat/engine/audio/audio_engine.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/gs_parallax_camera.hpp"
#include "gseurat/engine/project_root.hpp"
#include "gseurat/engine/light_events.hpp"
#include "gseurat/engine/pbd_events.hpp"
#include "gseurat/engine/scene_loader.hpp"
#include "gseurat/engine/gs_vfx.hpp"
#include "gseurat/engine/vfx_events.hpp"

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

    // Create audio engine so Weaver's "Open in Staging" can play music.
    auto engine_r = audio::AudioEngine::create(
        {.sample_rate = 44100, .buffer_frames = 1024, .max_active_groups = 8,
         .max_oneshot_voices = 32},
        audio::AudioEngine::Mode::Realtime);
    if (engine_r) {
        audio_engine_ = std::move(engine_r.value());
        std::fprintf(stderr, "[Staging] Audio engine initialized\n");
    }

    init_game_content();
    scene_objects_.current_scene_path = scene_path_;
    state_stack_.push(std::make_unique<StagingState>(), *this);
    main_loop();
    cleanup();
}

void StagingApp::init_game_content() {
    init_window();

    // Font atlas (ASCII only)
    std::vector<uint32_t> codepoints;
    for (uint32_t cp = 32; cp <= 126; cp++) codepoints.push_back(cp);
    font_atlas_.init(resolve_asset_path("assets/fonts/NotoSans-Regular.ttf").string(), 32.0f, codepoints);
    text_renderer_.init(font_atlas_);

    renderer_.init(window_, resources_);
    // Phase 4b: see Demo equivalent — RenderState must be live before
    // any state push triggers init_streaming.
    init_render_state();
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
    load_gs_scene(scene_data);
    std::fprintf(stderr, "[Staging] Loaded scene: %s\n", scene_path.c_str());
}

void StagingApp::clear_scene() {
    vkDeviceWaitIdle(renderer_.context().device());
    if (particle_system_) {
        particle_system_->clear_emitters();
    }
    renderer_.clear_gs_animations();
    if (vfx_system_) {
        vfx_system_->clear_instances();
    }
    // Phase 4a: drop pending VfxSpawnEvents that an earlier
    // update_scene_data command queued in the same poll cycle.
    // Otherwise they'd survive the scene swap and resurrect the
    // prior scene's VFX on top of the freshly loaded one
    // (Codex P2 on PR #431). AppBase::clear_scene takes the
    // bigger world_.clear() hammer; Staging's lighter teardown
    // surgically drops just this queue.
    world_.events<VfxSpawnEvent>().clear();
    // Phase 4d-1: same hazard for PbdElementsLoadedEvents queued by an
    // in-progress scene load before this clear runs. Drop them so the
    // next scene's PBD config doesn't get clobbered by stale state.
    world_.events<PbdElementsLoadedEvent>().clear();
    // Phase 4d-2: same for PointLightsLoadedEvents.
    world_.events<PointLightsLoadedEvent>().clear();
    scene_.clear_lights();
    gs_terrain_.terrain_aabb = AABB{};
    gs_terrain_.terrain_aabb.min = glm::vec3(0.0f);
    gs_terrain_.terrain_aabb.max = glm::vec3(0.0f);
    // Don't re-init GS here — init_scene() will do it if needed.
    // For empty viewport on standalone launch, on_enter() handles it.
}

}  // namespace gseurat
