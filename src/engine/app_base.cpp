#include "gseurat/engine/app_base.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/gs_vfx.hpp"
#include "gseurat/engine/pbd_types.hpp"
#include "gseurat/demo/island_components.hpp"

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/quaternion.hpp>

#include <chrono>
#include <filesystem>
#include <fstream>

namespace gseurat {

void AppBase::set_start_state(std::unique_ptr<GameState> state) {
    custom_start_state_ = std::move(state);
}

void AppBase::run() {
    register_commands();
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
    audio_.shutdown();
    resources_.shutdown();
    renderer_.shutdown();
    glfwDestroyWindow(window_);
    glfwTerminate();
}

// Virtual no-op stubs
void AppBase::init_scene(const std::string& /*scene_path*/) {}
void AppBase::clear_scene() {}
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
}

// ── Shared GS scene loading ──

void AppBase::load_gs_scene(const SceneData& scene_data, const GsSceneOptions& opts) {

    renderer_.clear_gs_particle_emitters();
    renderer_.clear_gs_animations();
    renderer_.clear_vfx_instances();

    scene_.clear_lights();
    scene_.set_ambient_color(scene_data.ambient_color);
    for (const auto& pl : scene_data.static_lights) {
        scene_.add_light(pl);
    }

    // Apply weather fog to scene (picked up by renderer each frame)
    scene_.set_fog_density(scene_data.weather.fog_density);
    scene_.set_fog_color(scene_data.weather.fog_color);

    // Load terrain PLY if present
    GaussianCloud cloud;
    bool has_terrain = false;
    float gs_scale_multiplier = 1.0f;
    if (scene_data.gaussian_splat) {
        const auto& gs = *scene_data.gaussian_splat;
        try {
            cloud = GaussianCloud::load_ply(gs.ply_file);
            has_terrain = !cloud.empty();
        } catch (const std::runtime_error& e) {
            std::fprintf(stderr, "[GS] Warning: %s\n", e.what());
        }
        gs_scale_multiplier = gs.scale_multiplier;
    }

    {
        if (has_terrain) {
            renderer_.gs_renderer().set_scale_multiplier(gs_scale_multiplier);
        }

        // Compute terrain AABB (grid-to-world coordinate mapping)
        // Bricklayer uses 0-based grid coordinates, but the terrain PLY may have
        // a different origin (e.g., centered at X=0). The AABB provides
        // the context to convert grid coordinates to PLY world coordinates.
        terrain_aabb_ = AABB{};
        terrain_aabb_.min = glm::vec3(0.0f);
        terrain_aabb_.max = glm::vec3(0.0f);
        if (has_terrain) {
            terrain_aabb_ = cloud.bounds();
        }

        // Snap game object positions to terrain elevation (in grid coordinates)
        auto snapped_objects = scene_data.game_objects;
        if (scene_data.collision) {
            const auto& grid = *scene_data.collision;
            if (grid.width > 0 && !grid.elevation.empty()) {
                for (auto& go : snapped_objects) {
                    int gx = static_cast<int>(go.position.x() / grid.cell_size);
                    int gz = static_cast<int>(go.position.z() / grid.cell_size);
                    if (gx >= 0 && gx < static_cast<int>(grid.width) &&
                        gz >= 0 && gz < static_cast<int>(grid.height)) {
                        go.position.vec().y = grid.get_elevation(
                            static_cast<uint32_t>(gx), static_cast<uint32_t>(gz));
                    }
                }
            }
        }

        // Convert grid positions to world positions via coord::to_world()
        scene_game_object_data_ = snapped_objects;

        std::vector<coord::WorldPos> world_positions;
        world_positions.reserve(snapped_objects.size());
        for (const auto& go : snapped_objects) {
            world_positions.push_back(coord::to_world(go.position, terrain_aabb_));
        }

        // Merge all game objects with PLY visuals into the GS cloud
        pbd_anchors_.clear();
        pbd_configs_.clear();
            {
                auto merged = cloud.gaussians();
                uint32_t merged_count = 0;
                for (size_t i = 0; i < snapped_objects.size(); ++i) {
                    const auto& go = snapped_objects[i];
                    if (go.ply_file.empty()) continue;
                    try {
                        auto placed_cloud = GaussianCloud::load_ply(go.ply_file);
                        if (placed_cloud.empty()) continue;
                        // Compute local AABB
                        glm::vec3 local_min(1e9f);
                        glm::vec3 local_max(-1e9f);
                        for (const auto& g : placed_cloud.gaussians()) {
                            local_min = glm::min(local_min, g.position);
                            local_max = glm::max(local_max, g.position);
                        }
                        // Center the model at its XZ centroid, sit bottom on ground
                        glm::vec3 local_center = (local_min + local_max) * 0.5f;
                        local_center.y = local_min.y;  // pivot at bottom, not center Y
                        float local_min_y = local_min.y;
                        float local_max_y = local_max.y;
                        glm::vec3 adjusted_pos = world_positions[i].vec();
                        // Build transform: translate to position, rotate, scale, then center the model
                        auto transform = glm::translate(glm::mat4(1.0f), adjusted_pos);
                        transform = glm::rotate(transform, glm::radians(go.rotation.x), {1,0,0});
                        transform = glm::rotate(transform, glm::radians(go.rotation.y), {0,1,0});
                        transform = glm::rotate(transform, glm::radians(go.rotation.z), {0,0,1});
                        transform = glm::scale(transform, glm::vec3(go.scale));
                        transform = glm::translate(transform, -local_center);  // center model at origin
                        auto rot_q = glm::quat(glm::radians(go.rotation));

                        // Assign PBD index to tree game objects (upper canopy sways)
                        // Assign PBD index from game object config
                        uint32_t pbd_idx = 0;
                        float sway_threshold_frac = 0.7f;
                        if (go.pbd && pbd_anchors_.size() < kMaxPbdElements) {
                            pbd_idx = 32 + static_cast<uint32_t>(pbd_anchors_.size());
                            pbd_anchors_.push_back(adjusted_pos);
                            pbd_configs_.push_back(*go.pbd);
                            sway_threshold_frac = go.pbd->sway_threshold;
                        }
                        float sway_threshold = local_min_y + (local_max_y - local_min_y) * sway_threshold_frac;

                        auto placed_gs = placed_cloud.gaussians();
                        uint32_t tagged_count = 0;
                        for (auto& g : placed_gs) {
                            float local_y = g.position.y;  // before transform
                            g.position = glm::vec3(transform * glm::vec4(g.position, 1.0f));
                            g.scale *= go.scale;
                            g.rotation = rot_q * g.rotation;
                            // Tag canopy Gaussians with PBD index
                            if (pbd_idx > 0 && local_y > sway_threshold) {
                                g.bone_index = pbd_idx;
                                tagged_count++;
                            }
                        }
                        if (pbd_idx > 0) {
                            std::fprintf(stderr, "[GS] PBD '%s': idx=%u, threshold=%.2f (frac=%.2f), "
                                         "model Y=[%.2f,%.2f], tagged=%u/%zu, anchor=(%.1f,%.1f,%.1f)\n",
                                         go.name.c_str(), pbd_idx, sway_threshold, sway_threshold_frac,
                                         local_min_y, local_max_y, tagged_count, placed_gs.size(),
                                         adjusted_pos.x, adjusted_pos.y, adjusted_pos.z);
                        }
                        merged.insert(merged.end(), placed_gs.begin(), placed_gs.end());
                        merged_count++;
                    } catch (const std::runtime_error& e) {
                        std::fprintf(stderr, "[GS] Warning: game object '%s': %s\n",
                                     go.id.c_str(), e.what());
                    }
                }
                if (merged_count > 0) {
                    cloud = GaussianCloud::from_gaussians(std::move(merged));
                }
                if (!pbd_anchors_.empty()) {
                    std::fprintf(stderr, "[GS] PBD: %zu objects configured (idx 32-%u)\n",
                                 pbd_anchors_.size(),
                                 31 + static_cast<uint32_t>(pbd_anchors_.size()));
                }
            }

            // Create ECS entities for game objects with components
            for (size_t i = 0; i < snapped_objects.size(); ++i) {
                const auto& go = snapped_objects[i];
                if (go.components.empty() || go.components.is_null()) continue;
                auto entity = world_.create();
                world_.add<ecs::Transform>(entity, {world_positions[i], {go.scale, go.scale}});
                for (auto& [name, data] : go.components.items()) {
                    component_registry_.attach(world_, entity, name, data);
                }
            }

        // Init GS renderer if we have any Gaussians (terrain and/or game objects)
        if (!cloud.empty()) {
            // Render resolution — use terrain config if available, else defaults
            uint32_t gs_w = 320, gs_h = 240;
            if (scene_data.gaussian_splat) {
                gs_w = scene_data.gaussian_splat->render_width;
                gs_h = scene_data.gaussian_splat->render_height;
            }
            if (cloud.count() > 100000 && gs_w >= 320) { gs_w = 160; gs_h = 120; }
            else if (cloud.count() > 50000 && gs_w >= 320) { gs_w = 240; gs_h = 180; }

            renderer_.init_gs(cloud, gs_w, gs_h);

            // Upload PBD elements AFTER init_gs (load_cloud resets pbd_count_)
            if (!pbd_anchors_.empty() && pbd_anchors_.size() == pbd_configs_.size()) {
                uint32_t count = static_cast<uint32_t>(pbd_anchors_.size());
                std::vector<PbdPhysicsState> states(count);
                std::vector<PbdElementParams> params(count);
                for (uint32_t i = 0; i < count; ++i) {
                    const auto& cfg = pbd_configs_[i];
                    float inv_mass = (cfg.mode == "physics" && cfg.pinned) ? 0.0f : 1.0f;
                    states[i].position = glm::vec4(pbd_anchors_[i], inv_mass);
                    states[i].prev_position = glm::vec4(0.0f, 0.0f, 0.0f, 1.0f);
                    states[i].velocity = glm::vec4(0.0f);
                    states[i].params = glm::vec4(cfg.sway_threshold, 0.0f, 0.0f, 0.0f);
                    params[i].gravity = glm::vec4(cfg.gravity, cfg.damping);
                    params[i].wind = glm::vec4(cfg.wind_direction, cfg.wind_strength);
                    params[i].dynamics = glm::vec4(cfg.wind_frequency, cfg.ground_y, cfg.bounce, 0.0f);
                }
                renderer_.gs_renderer().upload_pbd_elements(states.data(), params.data(), count);
                std::fprintf(stderr, "[GS] PBD upload: %u elements, wind=(%.2f,%.2f,%.2f) str=%.2f freq=%.2f\n",
                             count, params[0].wind.x, params[0].wind.y, params[0].wind.z,
                             params[0].wind.w, params[0].dynamics.x);
            }

            // Store cloud bounds for camera centering
            auto cloud_aabb = cloud.bounds();
            gs_cloud_center_ = (cloud_aabb.min + cloud_aabb.max) * 0.5f;
            gs_cloud_extent_ = glm::length(cloud_aabb.max - cloud_aabb.min) * 0.5f;

            // Camera — use terrain config if available, else fit to cloud bounds
            if (scene_data.gaussian_splat) {
                const auto& gs = *scene_data.gaussian_splat;
                float aspect = static_cast<float>(gs_w) / static_cast<float>(gs_h);
                auto gs_view = glm::lookAt(gs.camera_position, gs.camera_target, glm::vec3(0, 1, 0));
                auto gs_proj = glm::perspective(glm::radians(gs.camera_fov), aspect, 0.1f, 1000.0f);
                gs_proj[1][1] *= -1.0f;
                renderer_.set_gs_camera(gs_view, gs_proj);
                renderer_.set_gs_background_colors(gs.ground_color, gs.sky_color);
            } else {
                // Auto-camera for object-only scenes
                auto aabb = cloud.bounds();
                auto center = aabb.center();
                float extent = glm::length(aabb.max - aabb.min) * 0.5f;
                float dist = std::max(extent * 2.0f, 5.0f);
                glm::vec3 eye = center + glm::vec3(0, dist * 0.5f, dist);
                float aspect = static_cast<float>(gs_w) / static_cast<float>(gs_h);
                auto gs_view = glm::lookAt(eye, center, glm::vec3(0, 1, 0));
                auto gs_proj = glm::perspective(glm::radians(45.0f), aspect, 0.1f, 1000.0f);
                gs_proj[1][1] *= -1.0f;
                renderer_.set_gs_camera(gs_view, gs_proj);
            }

            // Transform lights with AABB offset
            std::vector<PointLight> gs_lights;
            for (const auto& pl : scene_data.static_lights) {
                PointLight t = pl;
                t.position_and_radius.x += terrain_aabb_.min.x;
                t.position_and_radius.z += terrain_aabb_.min.y;
                gs_lights.push_back(t);
            }

            if (opts.add_default_light && gs_lights.empty()) {
                PointLight test_light;
                auto center = terrain_aabb_.center();
                float r = std::max({terrain_aabb_.max.x - terrain_aabb_.min.x,
                                    terrain_aabb_.max.y - terrain_aabb_.min.y,
                                    terrain_aabb_.max.z - terrain_aabb_.min.z}) * 0.5f;
                test_light.position_and_radius = glm::vec4(center.x, center.z, center.y, r);
                test_light.color = glm::vec4(0.2f, 1.0f, 0.3f, 5.0f);
                gs_lights.push_back(test_light);
            }

            if (!gs_lights.empty()) {
                renderer_.gs_renderer().set_light_mode(2);
                renderer_.gs_renderer().set_point_lights(gs_lights);
                renderer_.set_gs_static_lights(gs_lights);
                if (opts.set_god_rays) renderer_.set_god_rays_intensity(1.0f);
            }

            // Emitters (grid→world)
            for (const auto& em : scene_data.gs_particle_emitters) {
                auto config = em.config;
                auto world_pos = coord::to_world(coord::GridPos(config.position), terrain_aabb_);
                config.position = world_pos.vec();
                renderer_.add_gs_particle_emitter(config);
            }

            // Animations (grid→world)
            for (const auto& anim : scene_data.gs_animations) {
                auto region = anim.region;
                auto world_center = coord::to_world(coord::GridPos(region.center), terrain_aabb_);
                region.center = world_center.vec();
                std::optional<Renderer::ReformConfig> reform;
                if (anim.reform) reform = Renderer::ReformConfig{anim.reform->lifetime};
                renderer_.add_gs_animation(anim.effect, region, anim.lifetime, anim.loop, anim.params, reform);
            }

            // Terrain-specific features (background, parallax)
            if (scene_data.gaussian_splat) {
                const auto& gs = *scene_data.gaussian_splat;
                if (!gs.background_image.empty()) {
                    auto bg_tex = resources_.load_texture(gs.background_image);
                    renderer_.set_gs_background(bg_tex);
                }
                if (feature_flags_.gs_parallax && gs.parallax) {
                    gs_parallax_camera_.configure(
                        gs.camera_position, gs.camera_target,
                        gs.camera_fov, gs_w, gs_h, *gs.parallax);
                    set_gs_parallax_active(true);
                    gs_frame_counter_ = 0;
                    renderer_.set_gs_skip_chunk_cull(true);
                    renderer_.gs_renderer().set_skip_sort(false);
                    auto cam_fwd = glm::normalize(gs.camera_target - gs.camera_position);
                    renderer_.gs_renderer().set_shadow_box_params(cam_fwd, 0.0f, gs.camera_position, 32.0f);
                } else {
                    set_gs_parallax_active(false);
                    renderer_.set_gs_skip_chunk_cull(false);
                    renderer_.gs_renderer().clear_shadow_box_params();
                }
                std::fprintf(stderr, "[GS] Loaded %u Gaussians from %s\n", cloud.count(), gs.ply_file.c_str());
            } else {
                set_gs_parallax_active(false);
                renderer_.set_gs_skip_chunk_cull(false);
                renderer_.gs_renderer().clear_shadow_box_params();
                std::fprintf(stderr, "[GS] Loaded %u Gaussians from %zu game objects\n",
                             cloud.count(), scene_data.game_objects.size());
            }
        }
    }

    // VFX instances (load even without gaussian_splat)
    if (!scene_data.vfx_instances.empty()) {
        if (!renderer_.has_gs_cloud()) {
            // Minimal GS renderer for VFX-only scenes
            std::vector<Gaussian> dummy(1);
            dummy[0].opacity = 0.0f;
            dummy[0].scale = glm::vec3(0.001f);
            auto cloud = GaussianCloud::from_gaussians(std::move(dummy));
            renderer_.init_gs(cloud, 320, 240);
            auto view = glm::lookAt(glm::vec3(0, 50, 100), glm::vec3(0), glm::vec3(0, 1, 0));
            auto proj = glm::perspective(glm::radians(45.0f), 320.0f / 240.0f, 0.1f, 1000.0f);
            proj[1][1] *= -1.0f;
            renderer_.set_gs_camera(view, proj);
        }
        for (const auto& vi : scene_data.vfx_instances) {
            if (vi.trigger != "auto") continue;
            auto preset = load_vfx_preset(vi.vfx_file);
            if (preset.elements.empty()) continue;
            VfxInstance inst;
            auto world_pos = coord::to_world(vi.position, terrain_aabb_);
            inst.init(preset, world_pos.vec(), vi.loop, vi.rotation_y);
            renderer_.add_vfx_instance(std::move(inst));
        }
    }
}

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

void AppBase::register_command(std::string name, CommandHandler handler) {
    command_handlers_.emplace(std::move(name), std::move(handler));
}

void AppBase::register_commands() {
    using json = nlohmann::json;
    auto ok = []() -> CommandResult { return json{{"type", "ok"}}; };

    register_command("get_features", [this](const json&) -> CommandResult {
        json response;
        response["type"] = "features";
        response["features"] = json::array();
        auto add = [&](const char* name, bool enabled, const char* label) {
            response["features"].push_back({{"name", name}, {"enabled", enabled}, {"label", label}});
        };
        add("gs_rendering", feature_flags_.gs_rendering, "GS Rendering");
        add("gs_chunk_culling", feature_flags_.gs_chunk_culling, "Chunk Culling");
        add("gs_lod", feature_flags_.gs_lod, "LOD");
        add("gs_adaptive_budget", feature_flags_.gs_adaptive_budget, "Adaptive Budget");
        add("gs_parallax", feature_flags_.gs_parallax, "Parallax");
        add("bloom", feature_flags_.bloom, "Bloom");
        add("depth_of_field", feature_flags_.depth_of_field, "Depth of Field");
        add("vignette", feature_flags_.vignette, "Vignette");
        add("tone_mapping", feature_flags_.tone_mapping, "Tone Mapping");
        add("fog", feature_flags_.fog, "Fog");
        add("point_lights", feature_flags_.point_lights, "Point Lights");
        add("particles", feature_flags_.particles, "Particles");
        add("weather", feature_flags_.weather, "Weather");
        add("screen_effects", feature_flags_.screen_effects, "Screen Effects");
        add("music", feature_flags_.music, "Music");
        add("sfx", feature_flags_.sfx, "SFX");
        return response;
    });

    register_command("set_feature", [this, ok](const json& cmd) -> CommandResult {
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
        return ok();
    });

    register_command("get_render_params", [this](const json&) -> CommandResult {
        auto& pp = renderer_.post_process_params();
        return json{
            {"type", "render_params"},
            {"params", {
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
                {"ground_color_r", renderer_.gs_bg_ground_color().r},
                {"ground_color_g", renderer_.gs_bg_ground_color().g},
                {"ground_color_b", renderer_.gs_bg_ground_color().b},
                {"sky_color_r", renderer_.gs_bg_sky_color().r},
                {"sky_color_g", renderer_.gs_bg_sky_color().g},
                {"sky_color_b", renderer_.gs_bg_sky_color().b},
                {"background_enabled", renderer_.gs_bg_colors_enabled() ? 1.0f : 0.0f},
            }},
        };
    });

    register_command("set_render_param", [this, ok](const json& cmd) -> CommandResult {
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
        else if (name == "ground_color_r") {
            auto c = renderer_.gs_bg_ground_color(); c.r = value;
            renderer_.set_gs_background_colors(c, renderer_.gs_bg_sky_color());
        }
        else if (name == "ground_color_g") {
            auto c = renderer_.gs_bg_ground_color(); c.g = value;
            renderer_.set_gs_background_colors(c, renderer_.gs_bg_sky_color());
        }
        else if (name == "ground_color_b") {
            auto c = renderer_.gs_bg_ground_color(); c.b = value;
            renderer_.set_gs_background_colors(c, renderer_.gs_bg_sky_color());
        }
        else if (name == "sky_color_r") {
            auto c = renderer_.gs_bg_sky_color(); c.r = value;
            renderer_.set_gs_background_colors(renderer_.gs_bg_ground_color(), c);
        }
        else if (name == "sky_color_g") {
            auto c = renderer_.gs_bg_sky_color(); c.g = value;
            renderer_.set_gs_background_colors(renderer_.gs_bg_ground_color(), c);
        }
        else if (name == "sky_color_b") {
            auto c = renderer_.gs_bg_sky_color(); c.b = value;
            renderer_.set_gs_background_colors(renderer_.gs_bg_ground_color(), c);
        }
        return ok();
    });

    register_command("get_perf", [this](const json&) -> CommandResult {
        return json{
            {"type", "perf"},
            {"gaussian_count", renderer_.gs_renderer().gaussian_count()},
            {"visible_count", renderer_.gs_renderer().visible_count()},
            {"max_capacity", renderer_.gs_renderer().max_gaussian_count()},
        };
    });

    register_command("set_ambient", [this, ok](const json& cmd) -> CommandResult {
        float r = cmd.value("r", 0.0f);
        float g = cmd.value("g", 0.0f);
        float b = cmd.value("b", 0.0f);
        float s = cmd.value("strength", 1.0f);
        scene_.set_ambient_color({r, g, b, s});
        return ok();
    });

    register_command("get_scene", [this](const json&) -> CommandResult {
        json response;
        response["type"] = "scene";
        response["path"] = current_scene_path_;
        auto ac = scene_.ambient_color();
        response["ambient_r"] = ac.r;
        response["ambient_g"] = ac.g;
        response["ambient_b"] = ac.b;
        response["ambient_strength"] = ac.a;
        response["lights"] = json::array();
        for (const auto& l : scene_.lights()) {
            response["lights"].push_back({
                {"x", l.position_and_radius.x},
                {"y", l.position_and_radius.y},
                {"z", l.position_and_radius.z},
                {"radius", l.position_and_radius.w},
                {"r", l.color.r},
                {"g", l.color.g},
                {"b", l.color.b},
                {"intensity", l.color.a},
            });
        }
        return response;
    });

    register_command("reload_scene", [this, ok](const json&) -> CommandResult {
        clear_scene();
        init_scene(current_scene_path_);
        return ok();
    });

    register_command("write_temp_file", [](const json& cmd) -> CommandResult {
        auto path = cmd.value("path", "");
        auto content = cmd.value("content", "");
        if (path.empty() || content.empty())
            return std::unexpected(std::string("Missing 'path' or 'content'"));

        auto parent = std::filesystem::path(path).parent_path();
        if (!parent.empty())
            std::filesystem::create_directories(parent);

        std::ofstream ofs(path);
        if (!ofs.is_open())
            return std::unexpected("Failed to write file: " + path);

        ofs << content;
        return json{{"type", "ok"}};
    });

    register_command("load_scene_json", [this](const json& cmd) -> CommandResult {
        auto json_str = cmd.value("json", "");
        if (json_str.empty())
            return std::unexpected(std::string("Missing 'json' parameter"));

        try {
            std::string temp_path = "/tmp/gseurat_live_scene.json";
            std::ofstream ofs(temp_path);
            ofs << json_str;
            ofs.close();
            vkDeviceWaitIdle(renderer_.context().device());
            clear_scene();
            init_scene(temp_path);
            current_scene_path_ = temp_path;
            return json{{"type", "ok"}};
        } catch (const std::exception& e) {
            std::fprintf(stderr, "[load_scene_json] ERROR: %s\n", e.what());
            return std::unexpected(std::string("Failed to load scene: ") + e.what());
        }
    });

    register_command("update_scene_data", [this](const json& cmd) -> CommandResult {
        auto json_str = cmd.value("json", "");
        if (json_str.empty())
            return std::unexpected(std::string("Missing 'json' parameter"));

        try {
            std::string temp_path = "/tmp/gseurat_live_scene.json";
            std::ofstream ofs(temp_path);
            ofs << json_str;
            ofs.close();
            auto scene_data = SceneLoader::load(temp_path);

            // Update ambient + lights
            scene_.clear_lights();
            scene_.set_ambient_color(scene_data.ambient_color);
            for (const auto& pl : scene_data.static_lights) {
                scene_.add_light(pl);
            }

            // Transform lights with AABB offset and push to GS renderer
            std::vector<PointLight> gs_lights;
            for (const auto& pl : scene_data.static_lights) {
                PointLight t = pl;
                t.position_and_radius.x += terrain_aabb_.min.x;
                t.position_and_radius.z += terrain_aabb_.min.y;
                gs_lights.push_back(t);
            }
            if (!gs_lights.empty()) {
                renderer_.gs_renderer().set_light_mode(2);
                renderer_.gs_renderer().set_point_lights(gs_lights);
                renderer_.set_gs_static_lights(gs_lights);
            } else {
                renderer_.gs_renderer().set_light_mode(0);
            }

            // Apply weather fog directly to scene (no WeatherSystem in Staging)
            scene_.set_fog_density(scene_data.weather.fog_density);
            scene_.set_fog_color(scene_data.weather.fog_color);

            // Rebuild emitters
            renderer_.clear_gs_particle_emitters();
            for (const auto& em : scene_data.gs_particle_emitters) {
                auto config = em.config;
                auto world_pos = coord::to_world(coord::GridPos(config.position), terrain_aabb_);
                config.position = world_pos.vec();
                renderer_.add_gs_particle_emitter(config);
            }

            // Rebuild animations
            renderer_.clear_gs_animations();
            for (const auto& anim : scene_data.gs_animations) {
                auto region = anim.region;
                auto world_center = coord::to_world(coord::GridPos(region.center), terrain_aabb_);
                region.center = world_center.vec();
                std::optional<Renderer::ReformConfig> reform;
                if (anim.reform) reform = Renderer::ReformConfig{anim.reform->lifetime};
                renderer_.add_gs_animation(anim.effect, region, anim.lifetime, anim.loop, anim.params, reform);
            }

            // Rebuild VFX instances
            renderer_.clear_vfx_instances();
            for (const auto& vi : scene_data.vfx_instances) {
                if (vi.trigger != "auto") continue;
                auto preset = load_vfx_preset(vi.vfx_file);
                if (preset.elements.empty()) continue;
                VfxInstance inst;
                auto world_pos = coord::to_world(vi.position, terrain_aabb_);
                inst.init(preset, world_pos.vec(), vi.loop, vi.rotation_y);
                renderer_.add_vfx_instance(std::move(inst));
            }

            // Update stored game object data with world positions for gizmo rendering
            scene_game_object_data_ = scene_data.game_objects;

            std::vector<coord::WorldPos> world_positions;
            world_positions.reserve(scene_data.game_objects.size());
            for (const auto& go : scene_data.game_objects) {
                world_positions.push_back(coord::to_world(go.position, terrain_aabb_));
            }

            for (size_t i = 0; i < scene_data.game_objects.size(); ++i) {
                const auto& go = scene_data.game_objects[i];
                if (go.components.empty() || go.components.is_null()) continue;
                auto entity = world_.create();
                world_.add<ecs::Transform>(entity, {world_positions[i], {go.scale, go.scale}});
                for (auto& [name, data] : go.components.items()) {
                    component_registry_.attach(world_, entity, name, data);
                }
            }

            return json{{"type", "ok"}};
        } catch (const std::exception& e) {
            std::fprintf(stderr, "[update_scene_data] ERROR: %s\n", e.what());
            return std::unexpected(std::string("Failed: ") + e.what());
        }
    });

    register_command("update_vfx_positions", [this](const json& cmd) -> CommandResult {
        if (!cmd.contains("vfx_instances"))
            return std::unexpected(std::string("Missing 'vfx_instances' array"));

        auto& vfx = renderer_.vfx_instances_mutable();
        const auto& vi_arr = cmd["vfx_instances"];
        for (size_t i = 0; i < std::min(vfx.size(), vi_arr.size()); i++) {
            if (vi_arr[i].contains("position")) {
                auto pos = vi_arr[i]["position"];
                glm::vec3 new_pos{pos[0].get<float>(), pos[1].get<float>(), pos[2].get<float>()};
                auto world_pos = coord::to_world(coord::GridPos(new_pos), terrain_aabb_);
                new_pos = world_pos.vec();
                auto preset = vfx[i].preset();
                vfx[i].init(preset, new_pos, true);
            }
        }
        return json{{"type", "ok"}};
    });

    register_command("open_scene", [this](const json& cmd) -> CommandResult {
        auto scene = cmd.value("scene", "");
        if (scene.empty())
            return std::unexpected(std::string("Missing 'scene' parameter"));

        clear_scene();
        init_scene(scene);
        current_scene_path_ = scene;
        return json{{"type", "ok"}};
    });

    register_command("list_scenes", [](const json&) -> CommandResult {
        json response;
        response["type"] = "scenes";
        response["files"] = json::array();
        if (std::filesystem::exists("assets/scenes")) {
            for (const auto& entry : std::filesystem::directory_iterator("assets/scenes")) {
                if (entry.path().extension() == ".json") {
                    response["files"].push_back(entry.path().string());
                }
            }
        }
        return response;
    });

    register_command("screenshot", [this](const json& cmd) -> CommandResult {
        auto path = cmd.value("path", "staging_screenshot.png");
        renderer_.request_screenshot(path);
        return json{{"type", "ok"}, {"path", path}};
    });

    register_command("inject_key", [this](const json& cmd) -> CommandResult {
        int key = cmd.value("key", 0);
        bool down = cmd.value("down", true);
        if (key <= 0 || key >= kKeyCount)
            return std::unexpected(std::string("Invalid key code"));
        input_.inject_key(key, down);
        return json{{"type", "ok"}};
    });

    register_command("inject_key_once", [this](const json& cmd) -> CommandResult {
        int key = cmd.value("key", 0);
        if (key <= 0 || key >= kKeyCount)
            return std::unexpected(std::string("Invalid key code"));
        input_.inject_key_once(key);
        return json{{"type", "ok"}};
    });

    register_command("clear_keys", [this](const json&) -> CommandResult {
        input_.clear_injections();
        return json{{"type", "ok"}};
    });

    register_command("get_player_state", [this](const json&) -> CommandResult {
        json response;
        response["type"] = "player_state";
        bool found = false;
        world_.view<ecs::Transform, PlayerController>().each(
            [&](ecs::Entity, ecs::Transform& t, PlayerController&) {
                response["position"] = {t.position.x(), t.position.y(), t.position.z()};
                found = true;
            });
        if (!found)
            response["position"] = nullptr;
        return response;
    });

    register_command("get_triggers", [this](const json&) -> CommandResult {
        json response;
        response["type"] = "triggers";
        auto triggers = json::array();
        world_.view<ProximityTrigger, ecs::Transform>().each(
            [&](ecs::Entity, ProximityTrigger& pt, ecs::Transform& t) {
                triggers.push_back({
                    {"x", t.position.x()},
                    {"y", t.position.y()},
                    {"z", t.position.z()},
                    {"radius", pt.radius},
                    {"triggered", pt.triggered},
                    {"one_shot", pt.one_shot},
                });
            });
        response["triggers"] = triggers;
        response["emitter_count"] = renderer_.gs_particle_emitters().size();
        return response;
    });

    register_command("quit", [this](const json&) -> CommandResult {
        glfwSetWindowShouldClose(window_, GLFW_TRUE);
        return json{{"type", "ok"}, {"message", "Shutting down"}};
    });
}

void AppBase::dispatch_command(const nlohmann::json& cmd, nlohmann::json& response) {
    const auto cmd_name = cmd.value("cmd", "");
    auto it = command_handlers_.find(cmd_name);
    if (it == command_handlers_.end()) {
        response["type"] = "error";
        response["message"] = "Unknown command: " + cmd_name;
        return;
    }

    auto result = it->second(cmd);
    if (result) {
        response = std::move(*result);
    } else {
        response["type"] = "error";
        response["message"] = std::move(result.error());
    }
}

}  // namespace gseurat
