#include "gseurat/engine/app_base.hpp"

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

#include <chrono>
#include <filesystem>

namespace gseurat {

void AppBase::set_start_state(std::unique_ptr<GameState> state) {
    custom_start_state_ = std::move(state);
}

void AppBase::run() {
    init_game_content();

    if (custom_start_state_) {
        state_stack_.push(std::move(custom_start_state_), *this);
    } else {
        // Subclass should provide a start state via set_start_state or override run()
    }
    main_loop();
    cleanup();
}

void AppBase::init_window() {
    glfwInit();
    glfwWindowHint(GLFW_CLIENT_API, GLFW_NO_API);
    glfwWindowHint(GLFW_RESIZABLE, GLFW_FALSE);

    window_ = glfwCreateWindow(kWindowWidth, kWindowHeight, "GSeurat", nullptr, nullptr);
    input_.set_window(window_);
}

void AppBase::init_game_content() {
    // No-op base implementation. App overrides with full init.
}

void AppBase::main_loop() {
    last_update_time_ = std::chrono::steady_clock::now();

    // Initialize async loading subsystems
    async_loader_.init();
    staging_uploader_.init(
        renderer_.context().device(), renderer_.context().allocator(),
        renderer_.command_pool().pool(), renderer_.context().graphics_queue(),
        [this](const std::string& cache_key, Texture tex) {
            // Insert completed texture into resource cache
            auto sp = std::make_shared<Texture>(std::move(tex));
            resources_.texture_cache().insert(cache_key, std::move(sp));
        });

    // Start control server for bridge integration
#ifndef _WIN32
    control_server_.start();
#endif

    while (!glfwWindowShouldClose(window_)) {
        glfwPollEvents();

        // Poll control server for bridge commands
        poll_control_server();

        // Poll async loader and process GPU uploads (before game logic)
        resources_.process_async_results(async_loader_, staging_uploader_);
        staging_uploader_.flush();

        // Clear draw lists at frame start (states will rebuild them)
        overlay_sprites_.clear();
        ui_sprites_.clear();

        input_.update();

        auto now = std::chrono::steady_clock::now();
        float dt = std::chrono::duration<float>(now - last_update_time_).count();
        last_update_time_ = now;

        if (dt > 0.1f) dt = 0.1f;

        state_stack_.update(*this, dt);
        play_time_ += dt;
        tick_++;

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

        // Build UI batches
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
    }
}

void AppBase::cleanup() {
    while (!state_stack_.empty()) {
        state_stack_.pop(*this);
    }
#ifndef _WIN32
    control_server_.stop();
#endif
    async_loader_.shutdown();
    staging_uploader_.shutdown();
    wren_vm_.shutdown();
    audio_.shutdown();
    resources_.shutdown();
    renderer_.shutdown();
    glfwDestroyWindow(window_);
    glfwTerminate();
}

// Virtual no-op stubs
void AppBase::init_scene(const std::string& /*scene_path*/) {}
void AppBase::clear_scene() {}
void AppBase::update_game(float /*dt*/) {}
void AppBase::update_audio(float /*dt*/) {}
SaveData AppBase::build_save_data() const { return {}; }
void AppBase::apply_save_data(const SaveData& /*data*/) {}

// ── Control Server ──

void AppBase::poll_control_server() {
#ifndef _WIN32
    auto commands = control_server_.poll();
    for (auto& cmd : commands) {
        nlohmann::json response;
        dispatch_command(cmd, response);
        if (!response.is_null()) {
            // Preserve bridge correlation ID
            if (cmd.contains("_bridge_id")) {
                response["_bridge_id"] = cmd["_bridge_id"];
            }
            control_server_.send(response);
        }
    }
#endif
}

void AppBase::dispatch_command(const nlohmann::json& cmd, nlohmann::json& response) {
    const auto cmd_name = cmd.value("cmd", "");

    if (cmd_name == "get_features") {
        response["type"] = "features";
        auto add_feature = [&](const char* name, bool enabled, const char* label) {
            nlohmann::json f;
            f["name"] = name;
            f["enabled"] = enabled;
            f["label"] = label;
            response["features"].push_back(f);
        };
        response["features"] = nlohmann::json::array();
        add_feature("gs_rendering", feature_flags_.gs_rendering, "GS Rendering");
        add_feature("gs_chunk_culling", feature_flags_.gs_chunk_culling, "Chunk Culling");
        add_feature("gs_lod", feature_flags_.gs_lod, "LOD");
        add_feature("gs_adaptive_budget", feature_flags_.gs_adaptive_budget, "Adaptive Budget");
        add_feature("gs_parallax", feature_flags_.gs_parallax, "Parallax");
        add_feature("bloom", feature_flags_.bloom, "Bloom");
        add_feature("depth_of_field", feature_flags_.depth_of_field, "Depth of Field");
        add_feature("vignette", feature_flags_.vignette, "Vignette");
        add_feature("tone_mapping", feature_flags_.tone_mapping, "Tone Mapping");
        add_feature("fog", feature_flags_.fog, "Fog");
        add_feature("point_lights", feature_flags_.point_lights, "Point Lights");
        add_feature("particles", feature_flags_.particles, "Particles");
        add_feature("weather", feature_flags_.weather, "Weather");
        add_feature("screen_effects", feature_flags_.screen_effects, "Screen Effects");
        add_feature("music", feature_flags_.music, "Music");
        add_feature("sfx", feature_flags_.sfx, "SFX");

    } else if (cmd_name == "set_feature") {
        auto name = cmd.value("feature", "");
        bool enabled = cmd.value("enabled", false);
        auto& f = feature_flags_;
        if (name == "gs_rendering") f.gs_rendering = enabled;
        else if (name == "gs_chunk_culling") f.gs_chunk_culling = enabled;
        else if (name == "gs_lod") f.gs_lod = enabled;
        else if (name == "gs_adaptive_budget") f.gs_adaptive_budget = enabled;
        else if (name == "gs_parallax") f.gs_parallax = enabled;
        else if (name == "bloom") f.bloom = enabled;
        else if (name == "depth_of_field") f.depth_of_field = enabled;
        else if (name == "vignette") f.vignette = enabled;
        else if (name == "tone_mapping") f.tone_mapping = enabled;
        else if (name == "fog") f.fog = enabled;
        else if (name == "point_lights") f.point_lights = enabled;
        else if (name == "particles") f.particles = enabled;
        else if (name == "weather") f.weather = enabled;
        else if (name == "screen_effects") f.screen_effects = enabled;
        else if (name == "music") f.music = enabled;
        else if (name == "sfx") f.sfx = enabled;
        response["type"] = "ok";

    } else if (cmd_name == "get_render_params") {
        response["type"] = "render_params";
        auto& pp = renderer_.post_process_params();
        response["params"] = {
            {"bloom_threshold", pp.bloom_threshold},
            {"bloom_soft_knee", pp.bloom_soft_knee},
            {"bloom_intensity", pp.bloom_intensity},
            {"exposure", pp.exposure},
            {"vignette_radius", pp.vignette_radius},
            {"vignette_softness", pp.vignette_softness},
            {"dof_focus_distance", pp.dof_focus_distance},
            {"dof_focus_range", pp.dof_focus_range},
            {"dof_max_blur", pp.dof_max_blur},
            {"fog_density", pp.fog_density},
            {"fog_color_r", pp.fog_color_r},
            {"fog_color_g", pp.fog_color_g},
            {"fog_color_b", pp.fog_color_b},
            {"god_rays_intensity", renderer_.god_rays_intensity()},
            {"scale_multiplier", renderer_.gs_renderer().scale_multiplier()},
            {"toon_bands", renderer_.gs_renderer().toon_bands()},
            {"light_mode", renderer_.gs_renderer().light_mode()},
            {"light_intensity", renderer_.gs_renderer().light_intensity()},
        };

    } else if (cmd_name == "set_render_param") {
        auto name = cmd.value("name", "");
        float value = cmd.value("value", 0.0f);
        auto& pp = renderer_.post_process_params();
        if (name == "bloom_threshold") pp.bloom_threshold = value;
        else if (name == "bloom_soft_knee") pp.bloom_soft_knee = value;
        else if (name == "bloom_intensity") pp.bloom_intensity = value;
        else if (name == "exposure") pp.exposure = value;
        else if (name == "vignette_radius") pp.vignette_radius = value;
        else if (name == "vignette_softness") pp.vignette_softness = value;
        else if (name == "dof_focus_distance") pp.dof_focus_distance = value;
        else if (name == "dof_focus_range") pp.dof_focus_range = value;
        else if (name == "dof_max_blur") pp.dof_max_blur = value;
        else if (name == "fog_density") pp.fog_density = value;
        else if (name == "fog_color_r") pp.fog_color_r = value;
        else if (name == "fog_color_g") pp.fog_color_g = value;
        else if (name == "fog_color_b") pp.fog_color_b = value;
        else if (name == "god_rays_intensity") renderer_.set_god_rays_intensity(value);
        else if (name == "scale_multiplier") renderer_.gs_renderer().set_scale_multiplier(value);
        else if (name == "toon_bands") renderer_.gs_renderer().set_toon_bands(static_cast<int>(value));
        else if (name == "light_mode") renderer_.gs_renderer().set_light_mode(static_cast<int>(value));
        else if (name == "light_intensity") renderer_.gs_renderer().set_light_intensity(value);
        response["type"] = "ok";

    } else if (cmd_name == "get_perf") {
        response["type"] = "perf";
        response["gaussian_count"] = renderer_.gs_renderer().gaussian_count();
        response["visible_count"] = renderer_.gs_renderer().visible_count();
        response["max_capacity"] = renderer_.gs_renderer().max_gaussian_count();

    } else if (cmd_name == "set_ambient") {
        float r = cmd.value("r", 0.0f);
        float g = cmd.value("g", 0.0f);
        float b = cmd.value("b", 0.0f);
        float s = cmd.value("strength", 1.0f);
        scene_.set_ambient_color({r, g, b, s});
        response["type"] = "ok";

    } else if (cmd_name == "get_scene") {
        response["type"] = "scene";
        response["path"] = current_scene_path_;
        auto ac = scene_.ambient_color();
        response["ambient_r"] = ac.r;
        response["ambient_g"] = ac.g;
        response["ambient_b"] = ac.b;
        response["ambient_strength"] = ac.a;
        response["lights"] = nlohmann::json::array();
        for (const auto& l : scene_.lights()) {
            nlohmann::json lj;
            lj["x"] = l.position_and_radius.x;
            lj["y"] = l.position_and_radius.y;
            lj["z"] = l.position_and_radius.z;
            lj["radius"] = l.position_and_radius.w;
            lj["r"] = l.color.r;
            lj["g"] = l.color.g;
            lj["b"] = l.color.b;
            lj["intensity"] = l.color.a;
            response["lights"].push_back(lj);
        }

    } else if (cmd_name == "reload_scene") {
        clear_scene();
        init_scene(current_scene_path_);
        response["type"] = "ok";

    } else if (cmd_name == "open_scene") {
        auto scene = cmd.value("scene", "");
        if (!scene.empty()) {
            clear_scene();
            init_scene(scene);
            current_scene_path_ = scene;
            response["type"] = "ok";
        } else {
            response["type"] = "error";
            response["message"] = "Missing 'scene' parameter";
        }

    } else if (cmd_name == "list_scenes") {
        response["type"] = "scenes";
        response["files"] = nlohmann::json::array();
        if (std::filesystem::exists("assets/scenes")) {
            for (const auto& entry : std::filesystem::directory_iterator("assets/scenes")) {
                if (entry.path().extension() == ".json") {
                    response["files"].push_back(entry.path().string());
                }
            }
        }

    } else if (cmd_name == "screenshot") {
        auto path = cmd.value("path", "staging_screenshot.png");
        renderer_.request_screenshot(path);
        response["type"] = "ok";
        response["path"] = path;

    } else {
        response["type"] = "error";
        response["message"] = "Unknown command: " + cmd_name;
    }
}

}  // namespace gseurat
