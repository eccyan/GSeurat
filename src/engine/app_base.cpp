#include "gseurat/engine/app_base.hpp"
#include "gseurat/engine/gs_scene_loader.hpp"
#include "gseurat/engine/scene_load_context.hpp"
#include "gseurat/engine/trigger_components.hpp"
#include "gseurat/engine/trigger_systems.hpp"
#include "gseurat/demo/island_components.hpp"
#include "gseurat/engine/bone_animated_component.hpp"
#include "gseurat/engine/bone_animation_system.hpp"

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

#include <chrono>

namespace gseurat {

void AppBase::set_start_state(std::unique_ptr<GameState> state) {
    custom_start_state_ = std::move(state);
}

void AppBase::run() {
    command_dispatcher_.register_default_commands();
    init_game_object_system();
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
    control_server_.start();

    while (!glfwWindowShouldClose(window_)) {
        glfwPollEvents();

        // Poll control server for bridge commands
        poll_control_server();

        // Poll async loader and process GPU uploads (before game logic)
        resources_.process_async_results(async_loader_, staging_uploader_);
        staging_uploader_.flush();

        // Clear draw lists at frame start (states will rebuild them)
        draw_lists_.overlay.clear();
        draw_lists_.ui.clear();

        input_.update();

        auto now = std::chrono::steady_clock::now();
        float dt = std::chrono::duration<float>(now - last_update_time_).count();
        last_update_time_ = now;

        if (dt > 0.1f) dt = 0.1f;

        debug_metrics_.update(dt);

        state_stack_.update(*this, dt);
        gameplay_.play_time += dt;
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
        if (!draw_lists_.ui.empty()) {
            ui_batches.push_back(ui::UIDrawBatch{draw_lists_.ui, std::nullopt});
        }
        const auto& ctx_batches = ui_ctx_.draw_batches();
        for (const auto& b : ctx_batches) {
            if (!b.sprites.empty()) ui_batches.push_back(b);
        }
        if (feature_flags_.minimap && !draw_lists_.minimap.empty()) {
            ui_batches.push_back(ui::UIDrawBatch{draw_lists_.minimap, std::nullopt});
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

        renderer_.draw_scene(scene_, draw_lists_.entity, draw_lists_.outline, draw_lists_.reflection,
                             draw_lists_.shadow, particle_sprites, draw_lists_.overlay, ui_batches,
                             feature_flags_);
    }
}

void AppBase::cleanup() {
    while (!state_stack_.empty()) {
        state_stack_.pop(*this);
    }
    control_server_.stop();
    async_loader_.shutdown();
    staging_uploader_.shutdown();
    audio_.shutdown();
    resources_.shutdown();
    renderer_.shutdown();
    glfwDestroyWindow(window_);
    glfwTerminate();
}

// Virtual no-op stubs
void AppBase::init_scene(const std::string& /*scene_path*/) {}
void AppBase::clear_scene() {
    bone_anim_registry_.clear();
}
void AppBase::update_game(float dt) { system_scheduler_.run_all(world_, dt); }
void AppBase::update_audio(float /*dt*/) {}
SaveData AppBase::build_save_data() const { return {}; }
void AppBase::apply_save_data(const SaveData& /*data*/) {}

void AppBase::init_game_object_system() {
    component_registry_.register_component<ecs::Facing>("Facing",
        [](const nlohmann::json& j) -> ecs::Facing {
            ecs::Facing f;
            if (j.contains("direction")) {
                std::string dir = j["direction"].get<std::string>();
                if (dir == "up") f.dir = Direction::Up;
                else if (dir == "down") f.dir = Direction::Down;
                else if (dir == "left") f.dir = Direction::Left;
                else if (dir == "right") f.dir = Direction::Right;
            }
            return f;
        },
        [](const ecs::Facing& f) -> nlohmann::json {
            std::string dir = "down";
            switch (f.dir) {
                case Direction::Up: dir = "up"; break;
                case Direction::Down: dir = "down"; break;
                case Direction::Left: dir = "left"; break;
                case Direction::Right: dir = "right"; break;
            }
            return {{"direction", dir}};
        });

    component_registry_.register_component<PlayerController>("PlayerController",
        [](const nlohmann::json& j) -> PlayerController {
            PlayerController c;
            if (j.contains("speed")) c.speed = j["speed"].get<float>();
            if (j.contains("acceleration")) c.acceleration = j["acceleration"].get<float>();
            return c;
        },
        [](const PlayerController& c) -> nlohmann::json {
            return {{"speed", c.speed}, {"acceleration", c.acceleration}};
        });

    component_registry_.register_component<ProximityTrigger>("ProximityTrigger",
        [](const nlohmann::json& j) -> ProximityTrigger {
            ProximityTrigger c;
            if (j.contains("radius")) c.radius = j["radius"].get<float>();
            if (j.contains("one_shot")) c.one_shot = j["one_shot"].get<bool>();
            return c;
        },
        [](const ProximityTrigger& c) -> nlohmann::json {
            return {{"radius", c.radius}, {"one_shot", c.one_shot}};
        });

    component_registry_.register_component<EmitterToggle>("EmitterToggle",
        [](const nlohmann::json& j) -> EmitterToggle {
            EmitterToggle c;
            if (j.contains("emitter_index")) c.emitter_index = j["emitter_index"].get<uint32_t>();
            return c;
        },
        [](const EmitterToggle& c) -> nlohmann::json {
            return {{"emitter_index", c.emitter_index}};
        });

    component_registry_.register_component<LightToggle>("LightToggle",
        [](const nlohmann::json& j) -> LightToggle {
            LightToggle c;
            if (j.contains("color_r")) c.color_r = j["color_r"].get<float>();
            if (j.contains("color_g")) c.color_g = j["color_g"].get<float>();
            if (j.contains("color_b")) c.color_b = j["color_b"].get<float>();
            if (j.contains("radius")) c.radius = j["radius"].get<float>();
            if (j.contains("intensity")) c.intensity = j["intensity"].get<float>();
            return c;
        },
        [](const LightToggle& c) -> nlohmann::json {
            return {
                {"color_r", c.color_r}, {"color_g", c.color_g}, {"color_b", c.color_b},
                {"radius", c.radius}, {"intensity", c.intensity}
            };
        });

    component_registry_.register_component<EmissiveToggle>("EmissiveToggle",
        [](const nlohmann::json& j) -> EmissiveToggle {
            EmissiveToggle c;
            if (j.contains("emission")) c.emission = j["emission"].get<float>();
            if (j.contains("color_r")) c.color_r = j["color_r"].get<float>();
            if (j.contains("color_g")) c.color_g = j["color_g"].get<float>();
            if (j.contains("color_b")) c.color_b = j["color_b"].get<float>();
            if (j.contains("effect_radius")) c.effect_radius = j["effect_radius"].get<float>();
            return c;
        },
        [](const EmissiveToggle& c) -> nlohmann::json {
            return {
                {"emission", c.emission},
                {"color_r", c.color_r}, {"color_g", c.color_g}, {"color_b", c.color_b},
                {"effect_radius", c.effect_radius}
            };
        });

    component_registry_.register_component<BurstEffect>("BurstEffect",
        [](const nlohmann::json& j) -> BurstEffect {
            BurstEffect c;
            if (j.contains("emitter_index")) c.emitter_index = j["emitter_index"].get<uint32_t>();
            return c;
        },
        [](const BurstEffect& c) -> nlohmann::json {
            return {{"emitter_index", c.emitter_index}};
        });

    component_registry_.register_component<ScatterEffect>("ScatterEffect",
        [](const nlohmann::json& j) -> ScatterEffect {
            ScatterEffect c;
            if (j.contains("radius")) c.radius = j["radius"].get<float>();
            if (j.contains("lifetime")) c.lifetime = j["lifetime"].get<float>();
            return c;
        },
        [](const ScatterEffect& c) -> nlohmann::json {
            return {{"radius", c.radius}, {"lifetime", c.lifetime}};
        });

    component_registry_.register_component<LinkedTrigger>("LinkedTrigger",
        [](const nlohmann::json& j) -> LinkedTrigger {
            LinkedTrigger c;
            if (j.contains("target_entity")) c.target_entity = j["target_entity"].get<uint32_t>();
            return c;
        },
        [](const LinkedTrigger& c) -> nlohmann::json {
            return {{"target_entity", c.target_entity}};
        });

    component_registry_.register_component<AnimationTrigger>("AnimationTrigger",
        [](const nlohmann::json& j) -> AnimationTrigger {
            AnimationTrigger c;
            if (j.contains("effect_name")) {
                auto name = j["effect_name"].get<std::string>();
                std::strncpy(c.effect_name, name.c_str(), sizeof(c.effect_name) - 1);
                c.effect_name[sizeof(c.effect_name) - 1] = '\0';
            }
            if (j.contains("anim_radius")) c.anim_radius = j["anim_radius"].get<float>();
            if (j.contains("lifetime")) c.lifetime = j["lifetime"].get<float>();
            if (j.contains("loop")) c.loop = j["loop"].get<bool>();
            return c;
        },
        [](const AnimationTrigger& c) -> nlohmann::json {
            return {{"effect_name", std::string(c.effect_name)},
                    {"anim_radius", c.anim_radius},
                    {"lifetime", c.lifetime},
                    {"loop", c.loop}};
        });

    component_registry_.register_component<DiscoveryZone>("DiscoveryZone",
        [](const nlohmann::json& j) -> DiscoveryZone {
            DiscoveryZone c;
            if (j.contains("color_r")) c.color_r = j["color_r"].get<float>();
            if (j.contains("color_g")) c.color_g = j["color_g"].get<float>();
            if (j.contains("color_b")) c.color_b = j["color_b"].get<float>();
            if (j.contains("burst_height")) c.burst_height = j["burst_height"].get<float>();
            return c;
        },
        [](const DiscoveryZone& c) -> nlohmann::json {
            return {{"color_r", c.color_r}, {"color_g", c.color_g},
                    {"color_b", c.color_b}, {"burst_height", c.burst_height}};
        });

    component_registry_.register_component<VfxTrigger>("VfxTrigger",
        [](const nlohmann::json& j) -> VfxTrigger {
            VfxTrigger c;
            if (j.contains("vfx_path")) {
                auto path = j["vfx_path"].get<std::string>();
                std::strncpy(c.vfx_path, path.c_str(), sizeof(c.vfx_path) - 1);
                c.vfx_path[sizeof(c.vfx_path) - 1] = '\0';
            }
            return c;
        },
        [](const VfxTrigger& c) -> nlohmann::json {
            return {{"vfx_path", std::string(c.vfx_path)}};
        });

    component_registry_.register_component<NpcWalker>("NpcWalker",
        [](const nlohmann::json& j) -> NpcWalker {
            NpcWalker c;
            if (j.contains("patrol_radius")) c.patrol_radius = j["patrol_radius"].get<float>();
            if (j.contains("speed")) c.speed = j["speed"].get<float>();
            if (j.contains("pause_duration")) c.pause_duration = j["pause_duration"].get<float>();
            return c;
        },
        [](const NpcWalker& c) -> nlohmann::json {
            return {{"patrol_radius", c.patrol_radius},
                    {"speed", c.speed},
                    {"pause_duration", c.pause_duration}};
        });

    component_registry_.register_component<BoneAnimatedTag>("BoneAnimated",
        [](const nlohmann::json& j) -> BoneAnimatedTag {
            BoneAnimatedTag c;
            // registry_id is assigned by scene loader, not from JSON
            (void)j;
            return c;
        },
        [](const BoneAnimatedTag& c) -> nlohmann::json {
            return {{"registry_id", c.registry_id}};
        });

    component_registry_.register_component<PlayerTag>("PlayerTag",
        [](const nlohmann::json&) -> PlayerTag { return {}; },
        [](const PlayerTag&) -> nlohmann::json { return {}; });

    // Register engine-level systems
    system_scheduler_.add_system({"bone_animation",
        [this](ecs::World& w, float dt) {
            bone_animation_system(w, dt, bone_anim_registry_);
        }, {}, {}});

    system_scheduler_.add_system({"proximity_trigger",
        [](ecs::World& w, float dt) {
            proximity_trigger_system(w, dt);
        }, {}, {}});

    system_scheduler_.add_system({"linked_trigger",
        [](ecs::World& w, float dt) {
            linked_trigger_system(w, dt);
        }, {}, {}});

    system_scheduler_.add_system({"emissive_toggle",
        [](ecs::World& w, float dt) {
            emissive_toggle_system(w, dt);
        }, {}, {}});

    system_scheduler_.add_system({"npc_walker",
        [this](ecs::World& w, float dt) {
            npc_walker_system(w, dt, bone_anim_registry_);
        }, {}, {}});
}

// ── Command context builder ──

CommandContext AppBase::build_command_context() {
    return CommandContext{
        .terrain = gs_terrain_,
        .scene_objects = scene_objects_,
        .renderer = renderer_,
        .scene = scene_,
        .world = world_,
        .components = component_registry_,
        .input = input_,
        .feature_flags = feature_flags_,
        .window = window_,
        .init_scene = [this](const std::string& path) { init_scene(path); },
        .clear_scene = [this]() { clear_scene(); },
        .load_character = [this](const std::string& path) { pending_character_path = path; },
    };
}

// ── Shared GS scene loading ──

void AppBase::load_gs_scene(const SceneData& scene_data, const GsSceneOptions& opts) {
    SceneLoadContext ctx{
        gs_terrain_, scene_objects_, renderer_, scene_,
        world_, component_registry_, resources_, feature_flags_
    };
    GsSceneLoader loader;
    loader.load(ctx, scene_data, opts);

    // Populate bone animation registry from allocations created by the scene loader
    populate_bone_animation_registry(bone_anim_registry_, world_, gs_terrain_);
}

// ── Control Server ──

void AppBase::poll_control_server() {
    auto commands = control_server_.poll();
    for (auto& cmd : commands) {
        nlohmann::json response;
        command_dispatcher_.dispatch(cmd, response);
        if (!response.is_null()) {
            // Preserve bridge correlation ID
            if (cmd.contains("_bridge_id")) {
                response["_bridge_id"] = cmd["_bridge_id"];
            }
            control_server_.send(response);
        }
    }
}

}  // namespace gseurat
