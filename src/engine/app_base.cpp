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

}  // namespace gseurat
