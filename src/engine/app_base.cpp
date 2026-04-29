#include "gseurat/engine/app_base.hpp"
#include "gseurat/engine/debug_dump_eyes.hpp"
#include "gseurat/engine/debug_dump_ears.hpp"
#include "gseurat/engine/debug_dump_renderer.hpp"
#include "gseurat/engine/debug_dump_assets.hpp"
#include "gseurat/engine/project_root.hpp"
#include "gseurat/engine/gs_scene_loader.hpp"
#include "gseurat/engine/scene_load_context.hpp"
#include "gseurat/engine/trigger_components.hpp"
#include "gseurat/engine/trigger_systems.hpp"
#include "gseurat/engine/bone_animated_component.hpp"
#include "gseurat/engine/bone_animation_system.hpp"
#include "gseurat/engine/gs_renderer.hpp"
#include "gseurat/engine/coordinate.hpp"
#include "gseurat/engine/ecs/default_components.hpp"
#include "gseurat/engine/ecs/components/portal_target.hpp"
#include "gseurat/engine/ecs/components/scene_transition.hpp"
#include "gseurat/engine/ecs/components/screen_fade.hpp"
#include "gseurat/engine/ecs/components/player_controller.hpp"
#include "gseurat/engine/ecs/components/player_jump.hpp"
#include "gseurat/engine/ecs/components/collider_component.hpp"
#include "gseurat/engine/ecs/components/kinematic_body.hpp"
#include "gseurat/engine/ecs/components/nav_zone_volume.hpp"
#include "gseurat/engine/ecs/components/light_probe.hpp"
#include "gseurat/engine/ecs/components/heightfield_component.hpp"
#include "gseurat/engine/collision/heightfield_loader.hpp"
#include "gseurat/engine/systems/portal_trigger_handler.hpp"

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

#include <chrono>
#include <cstdio>
#include <optional>

namespace gseurat {

void AppBase::set_start_state(std::unique_ptr<GameState> state) {
    custom_start_state_ = std::move(state);
}

void AppBase::run() {
    command_dispatcher_.register_default_commands();
    init_game_object_system();

    // Construct the interactive music audio engine (realtime output via miniaudio).
    // Music loading is wired via AudioZone scene data in Milestone 5.
    auto engine_r = audio::AudioEngine::create(
        {.sample_rate = 44100, .buffer_frames = 1024, .max_active_groups = 8},
        audio::AudioEngine::Mode::Realtime);
    if (engine_r) {
        audio_engine_ = std::move(engine_r.value());
    }

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

    // Initialize developer overlay (ImGui — no-op when GSEURAT_DEV_MODE is off)
    dev_overlay_.init(window_, renderer_);

    // Register debug dump modules (zero cost until explicitly triggered)
    DevOverlayDumper overlay_dumper{dev_overlay_};
    debug_dump_registry_.register_module(&overlay_dumper);

    std::optional<AudioEngineDumper> audio_dumper;
    if (audio_engine_) {
        audio_dumper.emplace([this]() -> AudioEngineDumper::Snapshot {
            auto ds = audio_engine_->build_debug_snapshot();

            AudioEngineDumper::Snapshot snap;
            snap.master_volume      = ds.master_volume;
            snap.sample_rate        = ds.sample_rate;
            snap.max_polyphony      = ds.max_polyphony;
            snap.active_voice_count = ds.active_voice_count;
            snap.active_group_count = ds.active_group_count;
            snap.dropped_commands   = ds.dropped_commands;

            static constexpr const char* kStatusNames[] = {
                "Idle", "Playing", "CrossfadingOut", "AwaitingTransition"
            };

            for (const auto& g : ds.groups) {
                AudioEngineDumper::TrackGroupSnapshot tg;
                tg.group_id     = g.group_id;
                tg.status       = (g.status < 4) ? kStatusNames[g.status] : "Unknown";
                tg.play_cursor  = g.play_cursor;
                tg.group_volume = g.group_volume;

                for (const auto& s : g.stems) {
                    AudioEngineDumper::StemSnapshot ss;
                    ss.index     = static_cast<uint32_t>(&s - &g.stems[0]);
                    ss.asset_ref = s.source_path;
                    ss.volume    = s.volume;
                    tg.stems.push_back(std::move(ss));
                }
                snap.track_groups.push_back(std::move(tg));
            }
            return snap;
        });
        debug_dump_registry_.register_module(&*audio_dumper);
    }

    // Register renderer stats dumper (Store domain)
    RendererStatsDumper renderer_dumper([this]() -> RendererStatsDumper::Snapshot {
        RendererStatsDumper::Snapshot snap;
        auto& gs = renderer_.gs_renderer();
        auto& metrics = debug_metrics_;

        snap.total_gaussians   = gs.gaussian_count();
        snap.visible_gaussians = gs.visible_count();
        snap.static_gaussians  = gs.static_count();
        snap.dynamic_gaussians = gs.dynamic_count();
        snap.max_capacity      = gs.max_gaussian_count();
        snap.gaussian_budget   = renderer_.gs_gaussian_budget();
        snap.culled_gaussians  = (snap.total_gaussians > snap.visible_gaussians)
                                  ? snap.total_gaussians - snap.visible_gaussians : 0;
        snap.cull_ratio        = snap.total_gaussians > 0
                                  ? static_cast<float>(snap.culled_gaussians) / static_cast<float>(snap.total_gaussians) : 0.0f;
        snap.total_chunks      = renderer_.gs_chunk_grid().chunk_count();
        snap.visible_chunks    = renderer_.gs_visible_chunk_count();
        snap.tile_binning_enabled = gs.tile_binning();
        snap.output_width      = gs.output_width();
        snap.output_height     = gs.output_height();
        snap.depth_sort_ms     = gs.depth_sort_ms_avg();
        snap.tile_sort_ms      = gs.tile_sort_ms_avg();
        snap.rasterize_ms      = gs.rasterize_ms_avg();
        snap.gpu_total_ms      = snap.depth_sort_ms + snap.tile_sort_ms + snap.rasterize_ms;
        snap.fps               = metrics.fps;
        snap.frame_time_ms     = metrics.fps > 0.0f ? 1000.0f / metrics.fps : 0.0f;
        snap.pbd_count         = gs.pbd_count();
        snap.pbd_constraints   = gs.pbd_constraint_count();
        snap.streaming_initialized = gs.streaming_initialized();
        snap.streaming_active_chunks = gs.active_chunk_count();
        snap.streaming_active_splats = gs.total_active_splats();
        snap.max_render_distance = renderer_.gs_max_render_distance();

        if (!gs.has_cloud()) snap.warnings.push_back("no_cloud_loaded");
        if (snap.cull_ratio > 0.95f) snap.warnings.push_back("high_cull_ratio");
        return snap;
    });
    debug_dump_registry_.register_module(&renderer_dumper);

    // Register asset cache dumper (Store domain)
    AssetCacheDumper asset_dumper([this]() -> AssetCacheDumper::Snapshot {
        AssetCacheDumper::Snapshot snap;

        // Count live textures (Texture class doesn't store dimensions)
        uint32_t tex_count = 0;
        resources_.texture_cache().for_each_live([&](const std::string&, const Texture&) {
            ++tex_count;
        });
        snap.live_texture_count = tex_count;

        // Staging uploader
        snap.staging_pending_bytes = staging_uploader_.pending_bytes();
        snap.staging_pending_count = staging_uploader_.pending_count();

        if (tex_count == 0) snap.warnings.push_back("no_textures_loaded");
        return snap;
    });
    debug_dump_registry_.register_module(&asset_dumper);

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

        // Drive the engine lifecycle state machine. The status provider
        // closes over the GS streamer's transfer queue when one exists; if
        // no streaming is active, the empty `std::function` makes `tick()`
        // a safe no-op (only the Warming countdown advances).
        // GsRenderer doesn't yet expose its TransferQueue handle, so for
        // now we drive the monitor with an empty provider — only callers
        // that explicitly `begin_load({})` (skip-load fast path) advance
        // the state machine. Real handle tracking arrives once streaming
        // is wired into engine startup in a follow-up.
        loading_monitor_.tick({});

        // F1 → toggle developer overlay
        if (input_.was_key_pressed(GLFW_KEY_F1)) {
            dev_overlay_.toggle();
        }
        // F12 → debug dump to console
        if (input_.was_key_pressed(GLFW_KEY_F12)) {
            auto dump = debug_dump_registry_.collect_all("staging");
            std::fprintf(stderr, "[DebugDump] %s\n", dump.dump(2).c_str());
        }
        dev_overlay_.begin_frame();

        // Gameplay updates (KCC, AI, PBD integration, animations) only run
        // in EngineState::Playing. During Loading and Warming the world is
        // intentionally frozen so the player doesn't see physics tick or
        // characters move during the loading screen.
        if (loading_monitor_.should_run_gameplay()) {
            state_stack_.update(*this, dt);
        }

        // Broadcast camera state to subscribed clients (throttled to 30 Hz)
        camera_broadcast_timer_ += dt;
        if (camera_broadcast_timer_ >= kCameraBroadcastInterval &&
            control_server_.has_client() &&
            control_server_.is_event_subscribed("camera_sync")) {
            camera_broadcast_timer_ = 0.0f;
            auto pos = renderer_.camera().position();
            auto tgt = renderer_.camera().target();
            auto& src = command_dispatcher_.context().camera_sync_source;
            control_server_.broadcast(nlohmann::json{
                {"event", "camera_sync"},
                {"source", src.empty() ? "engine" : src},
                {"position", {pos.x, pos.y, pos.z}},
                {"target", {tgt.x, tgt.y, tgt.z}}
            });
            // Clear source after broadcast so it isn't lost between
            // throttled intervals when sync_camera arrives mid-cycle.
            src.clear();
        }

        // Reset camera sync override at frame end
        command_dispatcher_.context().camera_sync_override = false;

        // Bone transforms only stream up while gameplay is running; otherwise
        // they freeze at their last value, matching the suspended world state.
        if (loading_monitor_.should_run_gameplay()) {
            upload_bone_transforms();
            gameplay_.play_time += dt;
        }
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

        // Developer overlay (after states have drawn their content)
        if (dev_overlay_.visible()) {
            dev_overlay_.draw(*this);
        }
        dev_overlay_.end_frame();

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

        // Push ScreenFade (if any) to the overlay slot. At most one entity
        // exists per the concurrency invariant in portal_trigger_handler.
        {
            auto& pp = renderer_.post_process_params();
            // Default: no overlay
            pp.overlay_r = 1.0f;
            pp.overlay_g = 1.0f;
            pp.overlay_b = 1.0f;
            pp.overlay_alpha = 0.0f;
            pp.overlay_effect_type = 0;
            world_.view<ScreenFade>().each(
                [&](ecs::Entity, ScreenFade& fade) {
                    pp.overlay_r = fade.transition_color.r;
                    pp.overlay_g = fade.transition_color.g;
                    pp.overlay_b = fade.transition_color.b;
                    pp.overlay_alpha = fade.alpha;
                    pp.overlay_effect_type = static_cast<uint32_t>(fade.effect_type);
                });
        }

        // GS compute pipelines (preprocess / sort / merge / render / pbd /
        // tile_render / post_process) are gated on the engine state. Loading
        // skips them entirely; Warming dispatches them to flush driver state
        // against freshly-uploaded buffers; Playing is the steady state.
        const bool dispatch_gpu_compute = loading_monitor_.should_dispatch_gpu_work();
        renderer_.draw_scene(scene_, draw_lists_.entity, draw_lists_.outline, draw_lists_.reflection,
                             draw_lists_.shadow, particle_sprites, draw_lists_.overlay, ui_batches,
                             draw_lists_.debug_colliders, feature_flags_, dispatch_gpu_compute);
    }
}

void AppBase::cleanup() {
    dev_overlay_.shutdown(renderer_);
    while (!state_stack_.empty()) {
        state_stack_.pop(*this);
    }
    control_server_.stop();
    async_loader_.shutdown();
    staging_uploader_.shutdown();
    audio_engine_.reset();
    resources_.shutdown();
    renderer_.shutdown();
    glfwDestroyWindow(window_);
    glfwTerminate();
}

// Virtual no-op stubs
void AppBase::init_scene(const std::string& /*scene_path*/) {}

void AppBase::clear_scene() {
    world_.clear();
    bone_anim_registry_.clear();
    gs_terrain_.reset();
}

// ITransitionHost default: clear, load, then move PlayerTag (if any) into place.
// Game apps that need additional scene-recovery work should override this.
void AppBase::transition_scene(const std::string& target_scene,
                               const glm::vec3& target_position) {
    clear_scene();
    init_scene(target_scene);
    world_.view<PlayerTag, ecs::Transform>().each(
        [&](ecs::Entity, PlayerTag&, ecs::Transform& t) {
            t.position = coord::WorldPos(target_position);
        });
}
void AppBase::update_game(float dt) { system_scheduler_.run_all(world_, dt); }

void AppBase::upload_bone_transforms() {
    if (bone_anim_registry_.entries().empty()) return;

    glm::mat4 bones[32];
    bones[0] = glm::mat4(1.0f);  // identity — hook can override

    if (bone_pre_upload_hook_) {
        bone_pre_upload_hook_(bones, 32);
    }

    uint32_t highest = gather_bone_animation_transforms(
        bone_anim_registry_, bones, 32);
    uint32_t total = std::max(highest, gs_terrain_.bone_slot_counter);
    renderer_.gs_renderer().upload_bone_transforms(
        bones, static_cast<int>(total));
}
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

    component_registry_.register_component<LinkedTrigger>("LinkedTrigger",
        [](const nlohmann::json& j) -> LinkedTrigger {
            LinkedTrigger c;
            if (j.contains("target_entity")) c.target_entity = j["target_entity"].get<uint32_t>();
            return c;
        },
        [](const LinkedTrigger& c) -> nlohmann::json {
            return {{"target_entity", c.target_entity}};
        });

    component_registry_.register_component<PortalTarget>("PortalTarget",
        [](const nlohmann::json& j) -> PortalTarget {
            PortalTarget c;
            if (j.contains("target_scene")) c.target_scene = j["target_scene"].get<std::string>();
            if (j.contains("target_position")) c.target_position = SceneLoader::parse_vec3(j["target_position"]);
            if (j.contains("transition_color")) c.transition_color = SceneLoader::parse_vec3(j["transition_color"]);
            if (j.contains("transition_duration")) c.transition_duration = j["transition_duration"].get<float>();
            if (j.contains("effect_type")) c.effect_type = j["effect_type"].get<int>();
            if (j.contains("require_interact")) c.require_interact = j["require_interact"].get<bool>();
            return c;
        },
        [](const PortalTarget& c) -> nlohmann::json {
            return {
                {"target_scene", c.target_scene},
                {"target_position", {c.target_position.x, c.target_position.y, c.target_position.z}},
                {"transition_color", {c.transition_color.x, c.transition_color.y, c.transition_color.z}},
                {"transition_duration", c.transition_duration},
                {"effect_type", c.effect_type},
                {"require_interact", c.require_interact}
            };
        });

    // ScreenFade is generic — designers can author it for ambient tints, damage flashes,
    // cutscene fades, etc. (Portal transitions also use it via portal_trigger_handler.)
    component_registry_.register_component<ScreenFade>("ScreenFade",
        [](const nlohmann::json& j) -> ScreenFade {
            ScreenFade c;
            if (j.contains("transition_color")) c.transition_color = SceneLoader::parse_vec3(j["transition_color"]);
            if (j.contains("alpha")) c.alpha = j["alpha"].get<float>();
            if (j.contains("effect_type")) c.effect_type = j["effect_type"].get<int>();
            return c;
        },
        [](const ScreenFade& c) -> nlohmann::json {
            return {
                {"transition_color", {c.transition_color.x, c.transition_color.y, c.transition_color.z}},
                {"alpha", c.alpha},
                {"effect_type", c.effect_type}
            };
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

    component_registry_.register_component<PlayerJump>("PlayerJump",
        [](const nlohmann::json& j) -> PlayerJump {
            PlayerJump c;
            if (j.contains("height")) c.height = j["height"].get<float>();
            if (j.contains("duration")) c.duration = j["duration"].get<float>();
            return c;
        },
        [](const PlayerJump& c) -> nlohmann::json {
            return {{"height", c.height}, {"duration", c.duration}};
        });

    component_registry_.register_component<ColliderComponent>("ColliderComponent",
        [](const nlohmann::json& j) -> ColliderComponent {
            return collider_from_json(j);
        },
        [](const ColliderComponent& c) -> nlohmann::json {
            return collider_to_json(c);
        });

    component_registry_.register_component<KinematicBody>("KinematicBody",
        [](const nlohmann::json& j) -> KinematicBody {
            return kinematic_body_from_json(j);
        },
        [](const KinematicBody& kb) -> nlohmann::json {
            return kinematic_body_to_json(kb);
        });

    component_registry_.register_component<NavZoneVolume>("NavZoneVolume",
        [](const nlohmann::json& j) -> NavZoneVolume { return nav_zone_volume_from_json(j); },
        [](const NavZoneVolume& v) -> nlohmann::json { return nav_zone_volume_to_json(v); });

    component_registry_.register_component<HeightfieldComponent>("HeightfieldComponent",
        [](const nlohmann::json& j) -> HeightfieldComponent {
            auto hf = heightfield_from_json(j);
            if (!hf.image_path.empty()) {
                try {
                    hf.data = load_heightfield(hf.image_path);
                } catch (const std::exception& e) {
                    std::fprintf(stderr, "[Heightfield] Failed to load %s: %s\n",
                                 hf.image_path.c_str(), e.what());
                }
            }
            return hf;
        },
        [](const HeightfieldComponent& h) -> nlohmann::json {
            return heightfield_to_json(h);
        });

    component_registry_.register_component<LightProbe>("LightProbe",
        [](const nlohmann::json& j) -> LightProbe { return light_probe_from_json(j); },
        [](const LightProbe& lp) -> nlohmann::json { return light_probe_to_json(lp); });

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

    system_scheduler_.add_system({"portal_trigger_handler",
        [this](ecs::World& w, float) {
            portal_trigger_handler(w, input_.was_key_pressed(GLFW_KEY_E));
        },
        /* reads */ {}, /* writes */ {}});

    system_scheduler_.add_system({"transition_system",
        [this](ecs::World& w, float dt) { transition_system(w, *this, dt); },
        /* reads */ {}, /* writes */ {}});
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
        .debug_dump_registry = debug_dump_registry_,
        .reload_music = [this](const std::string& path) {
            if (audio_engine_) {
                // Resolve path relative to project root (not cwd)
                auto resolved = resolve_asset_path(path).string();
                std::fprintf(stderr, "[audio] Loading music config: %s\n", resolved.c_str());
                auto r = audio_engine_->load_track_group(resolved);
                if (r) {
                    const uint32_t first_id = r.value();
                    std::fprintf(stderr, "[audio] Reloaded music config (first group id=%u) — playing\n", first_id);
                    audio_engine_->play_group(first_id);
                } else {
                    std::fprintf(stderr, "[audio] Failed to reload music config: %s\n", resolved.c_str());
                }
            }
        },
        .init_scene = [this](const std::string& path) { init_scene(path); },
        .clear_scene = [this]() { clear_scene(); },
        .load_character = [this](const std::string& path) { pending_character_path = path; },
        .control_server = &control_server_,
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
