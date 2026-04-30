#include "gseurat/staging/staging_state.hpp"
#include "gseurat/staging/visual_state.hpp"
#include "gseurat/engine/app_base.hpp"
#include "gseurat/engine/command_dispatcher.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/post_process.hpp"
#include "gseurat/engine/shutdown_auditor.hpp"
#include "gseurat/engine/world_manifest.hpp"
#include "gseurat/engine/project_root.hpp"
#include "gseurat/engine/coordinate.hpp"
#include "gseurat/engine/collision_gen.hpp"
#include "gseurat/engine/debug_draw.hpp"

#ifdef GSEURAT_DEV_MODE
#include <imgui.h>
#endif

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

#include <glm/gtc/matrix_transform.hpp>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <filesystem>

namespace gseurat {

static const char* camera_mode_name(CameraMode m) {
    switch (m) {
        case CameraMode::free_look:      return "free_look";
        case CameraMode::rail_follow:    return "rail_follow";
        case CameraMode::cinematic_rail: return "cinematic_rail";
        case CameraMode::fixed_point:    return "fixed_point";
        case CameraMode::side_scroll:    return "side_scroll";
    }
    return "unknown";
}

static constexpr float kOrbitSensitivity = 0.01f;
static constexpr float kZoomSensitivity  = 3.0f;
static constexpr float kPanSensitivity   = 0.05f;

void StagingState::on_enter(AppBase& app) {
    // Load scene files list
    scene_files_.clear();
    for (const auto& entry : std::filesystem::directory_iterator(resolve_asset_path("assets/scenes"))) {
        if (entry.path().extension() == ".json") {
            scene_files_.push_back(entry.path().string());
        }
    }
    std::sort(scene_files_.begin(), scene_files_.end());
    scenes_loaded_ = true;

    // Create camera review state
    camera_review_ = std::make_unique<CameraReviewState>();

    // Initialize scene (or start with empty viewport)
    if (!app.scene_objects().current_scene_path.empty()) {
        app.init_scene(app.scene_objects().current_scene_path);
        try {
            last_scene_data_ = SceneLoader::load(app.scene_objects().current_scene_path);
        } catch (...) {
            last_scene_data_.reset();
        }
        // Pre-load zone data for gizmo rendering in orbit mode
        if (last_scene_data_) {
            camera_review_->load_zone_data(*last_scene_data_, app.gs_terrain().terrain_aabb);
        }
    } else {
        // Empty scene: init minimal GS renderer for VFX preview
        std::vector<Gaussian> dummy(1);
        dummy[0].opacity = 0.0f;
        dummy[0].scale = glm::vec3(0.001f);
        auto cloud = GaussianCloud::from_gaussians(std::move(dummy));
        app.renderer().init_gs(cloud, 320, 240);

        float aspect = 320.0f / 240.0f;
        auto view = glm::lookAt(glm::vec3(0, 50, 100), glm::vec3(0, 0, 0), glm::vec3(0, 1, 0));
        auto proj = glm::perspective(glm::radians(45.0f), aspect, 0.1f, 1000.0f);
        proj[1][1] *= -1.0f;
        app.renderer().set_gs_camera(view, proj);
    }
    std::fprintf(stderr, "[Staging] Ready\n");

    // Register staging-specific panels
    app.dev_overlay().register_panel("Scene", [this](AppBase& a) { draw_scene_panel(a); });
    app.dev_overlay().register_panel("Character", [this](AppBase& a) { draw_character_panel(a); });
    app.dev_overlay().register_panel("Camera", [this](AppBase& a) { draw_camera_panel(a); });

    // Auto-show dev overlay in staging
    if (!app.dev_overlay().visible()) {
        app.dev_overlay().toggle();
    }

    // ── Register camera review control-server commands ──
    using json = nlohmann::json;

    app.command_dispatcher().register_command("camera_review",
        [this, &app](const json& cmd) -> CommandResult {
            auto action = cmd.value("action", std::string{});

            if (action == "on") {
                // Always re-read scene file to pick up latest camera_zones
                auto path = app.scene_objects().current_scene_path;
                if (!path.empty()) {
                    try { last_scene_data_ = SceneLoader::load(path); } catch (...) {}
                }
                if (!last_scene_data_ || !last_scene_data_->camera_zones) {
                    return std::unexpected(std::string("no camera_zones in current scene"));
                }
                if (!camera_review_) {
                    camera_review_ = std::make_unique<CameraReviewState>();
                }
                glm::vec3 start = app.renderer().has_gs_cloud()
                    ? app.gs_terrain().cloud_center : glm::vec3(0.0f);
                camera_review_->activate(*last_scene_data_, start, app.gs_terrain().terrain_aabb);
                return json{
                    {"type", "ok"},
                    {"zones", camera_review_->volume_count()},
                    {"triggers", camera_review_->trigger_count()},
                    {"rails", camera_review_->rail_count()}
                };
            }

            if (action == "off") {
                if (camera_review_) {
                    camera_review_->deactivate();
                }
                camera_initialized_ = false;
                return json{{"type", "ok"}};
            }

            if (action == "status") {
                bool active = camera_review_ && camera_review_->is_active();
                json resp = {{"type", "ok"}, {"active", active}};
                if (active) {
                    auto pos = camera_review_->player_position();
                    resp["zone"] = camera_review_->active_zone_name();
                    resp["mode"] = camera_mode_name(camera_review_->active_zone_mode());
                    resp["player"] = {pos.x, pos.y, pos.z};
                    resp["transitioning"] = camera_review_->is_transitioning();
                }
                return resp;
            }

            return std::unexpected(std::string("unknown action: ") + action);
        });

    app.command_dispatcher().register_command("camera_review_teleport",
        [this](const json& cmd) -> CommandResult {
            if (!camera_review_ || !camera_review_->is_active()) {
                return std::unexpected(std::string("camera review not active"));
            }
            float x = cmd.value("x", 0.0f);
            float z = cmd.value("z", 0.0f);
            if (cmd.contains("y")) {
                float y = cmd.value("y", 0.0f);
                camera_review_->teleport(x, y, z);
            } else {
                camera_review_->teleport(x, z);
            }
            auto pos = camera_review_->player_position();
            return json{
                {"type", "ok"},
                {"player", {pos.x, pos.y, pos.z}}
            };
        });

    app.command_dispatcher().register_command("camera_review_walk",
        [this](const json& cmd) -> CommandResult {
            if (!camera_review_ || !camera_review_->is_active()) {
                return std::unexpected(std::string("camera review not active"));
            }
            auto direction = cmd.value("direction", std::string{"forward"});
            float seconds = cmd.value("seconds", 1.0f);
            camera_review_->inject_walk(direction, seconds);
            return json{{"type", "ok"}};
        });

    app.command_dispatcher().register_command("visual_state",
        [this, &app](const json& /*cmd*/) -> CommandResult {
            VisualState vs;

            // Display size
#ifdef GSEURAT_DEV_MODE
            auto& io = ImGui::GetIO();
            float dw = io.DisplaySize.x;
            float dh = io.DisplaySize.y;
#else
            float dw = 1280.0f;
            float dh = 720.0f;
#endif

            // Panels — DevOverlay manages visibility now; report overlay state
            bool overlay_vis = app.dev_overlay().visible();
            auto add_panel = [&](const char* name, bool visible) {
                vs.panels.push_back({name, visible, 0, 0, 0, 0, dw, dh});
            };
            add_panel("Viewport Info", overlay_vis);
            add_panel("Render Settings", overlay_vis);
            add_panel("GS Parameters", overlay_vis);
            add_panel("Feature Toggles", overlay_vis);
            add_panel("Lighting", overlay_vis);
            add_panel("Camera", overlay_vis);
            add_panel("Performance", overlay_vis);
            add_panel("Character", show_character_);

            // Gizmos — always visible (managed by static bools in draw_gizmos)
            auto& sd = last_scene_data_;
            vs.gizmos.push_back({"lights", true,
                sd ? static_cast<int>(sd->static_lights.size()) : 0});
            vs.gizmos.push_back({"emitters", true,
                sd ? static_cast<int>(sd->gs_particle_emitters.size()) : 0});
            vs.gizmos.push_back({"vfx_instances", true,
                sd ? static_cast<int>(sd->vfx_instances.size()) : 0});
            vs.gizmos.push_back({"game_objects", true,
                sd ? static_cast<int>(sd->game_objects.size()) : 0});
            vs.gizmos.push_back({"camera_zones", true,
                sd && sd->camera_zones
                    ? static_cast<int>(sd->camera_zones->volumes.size()) : 0});

            // Scene
            auto& gsr = app.renderer().gs_renderer();
            vs.scene.gaussians_visible = static_cast<int>(gsr.visible_count());
            vs.scene.gaussians_total = static_cast<int>(gsr.gaussian_count());
            vs.scene.game_objects_loaded = sd
                ? static_cast<int>(sd->game_objects.size()) : 0;
            vs.scene.terrain_loaded = sd.has_value();
            vs.scene.character_visible = (character_data_ != nullptr);

            // Features — iterate FeatureFlags::entries() with member pointers
            const auto& ff = app.feature_flags();
            for (const auto& entry : FeatureFlags::entries()) {
                vs.features[std::string(entry.name)] = ff.*entry.ptr;
            }

            // Camera review
            if (camera_review_ && camera_review_->is_active()) {
                vs.camera_review.active = true;
                auto pos = camera_review_->player_position();
                vs.camera_review.player_x = pos.x;
                vs.camera_review.player_y = pos.y;
                vs.camera_review.player_z = pos.z;
                vs.camera_review.active_zone = camera_review_->active_zone_name();
            }

            auto result = vs.to_json();
            result["type"] = "ok";
            return result;
        });
}

void StagingState::on_exit(AppBase& app) {
    // Note: camera review commands registered on app.command_dispatcher() in on_enter()
    // are not unregistered here. This is safe because StagingState is the only state
    // in the staging app and outlives the command dispatcher.

    // Deactivate camera review mode
    if (camera_review_ && camera_review_->is_active()) {
        camera_review_->deactivate();
    }
    camera_review_.reset();

    // Release animation player first (holds reference to character data)
    anim_player_.reset();

    // Intentionally leak CharacterData on exit — macOS allocator crashes when
    // freeing vectors during Vulkan/VMA teardown (known issue, same as IslandDemoState).
    // Process teardown reclaims the memory anyway.
    if (character_data_) {
        ShutdownAuditor::remove(character_data_.get());
        (void)character_data_.release();  // leak — delete crashes on macOS
        std::fprintf(stderr, "[Staging] CharacterData leaked (macOS allocator workaround)\n");
    }

    if (app.renderer().has_gs_cloud()) {
        app.renderer().gs_renderer().clear_bone_transforms();
    }
}

void StagingState::update(AppBase& app, float dt) {
    // Detect scene change from load_scene_json (socket command).
    // Detect scene change. Since load_scene_json always writes to the same temp
    // path, we only detect path changes here. The "Start Review" button and
    // camera_review command re-read the file on demand for same-path reloads.
    const auto& current_path = app.scene_objects().current_scene_path;
    bool scene_changed = (current_path != last_scene_path_);
    if (scene_changed) {
        last_scene_path_ = current_path;
        camera_initialized_ = false;
        // Cache scene data for review mode
        if (!current_path.empty()) {
            try {
                last_scene_data_ = SceneLoader::load(current_path);
            } catch (...) {
                last_scene_data_.reset();
            }
        }
        // Load zone data for gizmo rendering (even when review is not active)
        if (camera_review_ && last_scene_data_) {
            camera_review_->load_zone_data(*last_scene_data_, app.gs_terrain().terrain_aabb);
        }
        // Re-activate review if active
        if (camera_review_ && camera_review_->is_active()) {
            camera_review_->deactivate();
            if (last_scene_data_ && last_scene_data_->camera_zones) {
                auto& cz = *last_scene_data_->camera_zones;
                if (!cz.volumes.empty() || !cz.rails.empty() || !cz.triggers.empty()) {
                    glm::vec3 start = app.renderer().has_gs_cloud()
                        ? app.gs_terrain().cloud_center : glm::vec3(0.0f);
                    camera_review_->activate(*last_scene_data_, start, app.gs_terrain().terrain_aabb);
                }
            }
        }
    }

    // Detect incremental scene updates (update_scene_data from auto-sync).
    // Reload camera zone data so gizmos stay in sync.
    uint32_t cur_version = app.scene_objects().scene_data_version;
    if (cur_version != last_scene_data_version_) {
        last_scene_data_version_ = cur_version;
        // Re-read the temp scene file written by update_scene_data
        try {
            last_scene_data_ = SceneLoader::load("/tmp/gseurat_live_scene.json");
        } catch (...) {}
        if (camera_review_ && last_scene_data_) {
            camera_review_->load_zone_data(*last_scene_data_, app.gs_terrain().terrain_aabb);
            // If review is active, reload zone system too
            if (camera_review_->is_active()) {
                auto pos = camera_review_->player_position();
                camera_review_->activate(*last_scene_data_, pos, app.gs_terrain().terrain_aabb);
            }
        }
    }

    // Check for pending character load from bridge command
    if (!app.pending_character_path.empty()) {
        load_character(app.pending_character_path, app);
        app.pending_character_path.clear();
    }

    // Drive GS effect time for PBD wind sway
    anim_time_ += dt;
    app.renderer().gs_renderer().set_effect_time(anim_time_);

    bool wants_mouse = app.dev_overlay().wants_mouse();
    bool wants_keyboard = app.dev_overlay().wants_keyboard();
    const bool sync_override = app.command_dispatcher().context().camera_sync_override;

    if (camera_review_ && camera_review_->is_active()) {
        // ── Camera Review Mode ──
        auto* window = app.window();
        double mx, my;
        glfwGetCursorPos(window, &mx, &my);

        // Only pass mouse delta when left-dragging (like orbit camera)
        float mouse_dx = 0.0f;
        float mouse_dy = 0.0f;
        if (!wants_mouse &&
            glfwGetMouseButton(window, GLFW_MOUSE_BUTTON_LEFT) == GLFW_PRESS) {
            mouse_dx = static_cast<float>(mx - last_mouse_x_) * kOrbitSensitivity;
            mouse_dy = static_cast<float>(my - last_mouse_y_) * kOrbitSensitivity;
        }
        last_mouse_x_ = mx;
        last_mouse_y_ = my;

        // Only block WASD when user is actively typing in an ImGui text field
#ifdef GSEURAT_DEV_MODE
        bool typing_in_widget = ImGui::IsAnyItemActive() && ImGui::GetIO().WantTextInput;
#else
        bool typing_in_widget = false;
#endif
        camera_review_->set_camera_override(sync_override);
        camera_review_->update(dt, app.input(), wants_mouse, typing_in_widget,
                               mouse_dx, mouse_dy);

        // Build view/proj from CameraState
        if (app.renderer().has_gs_cloud()) {
            // When sync_camera override is active, use the renderer's camera
            // directly (set by the sync_camera command) instead of
            // camera_review_ state, which would overwrite the synced position.
            CameraState cam;
            if (sync_override) {
                cam.position = app.renderer().camera().position();
                cam.target = app.renderer().camera().target();
                cam.up = glm::vec3(0, 1, 0);
                cam.fov = 45.0f;
            } else {
                cam = camera_review_->camera_state();
            }
            auto& gs_renderer = app.renderer().gs_renderer();
            float aspect = static_cast<float>(gs_renderer.output_width()) /
                           static_cast<float>(gs_renderer.output_height());
            auto view = glm::lookAt(cam.position, cam.target, cam.up);
            auto proj = glm::perspective(glm::radians(cam.fov), aspect, 0.1f, 1000.0f);
            proj[1][1] *= -1.0f;  // Vulkan Y-flip

            app.renderer().set_gs_camera(view, proj);

            // Cache VP for gizmo projection (without Vulkan Y-flip)
            auto proj_gizmo = glm::perspective(glm::radians(cam.fov), aspect, 0.1f, 1000.0f);
            gs_vp_ = proj_gizmo * view;
        }

        // R key → reset player
        if (!wants_keyboard && app.input().was_key_pressed(GLFW_KEY_R)) {
            camera_review_->reset_player();
        }

        // Right-click teleport via ground plane raycast (edge-triggered)
        bool right_down = glfwGetMouseButton(app.window(), GLFW_MOUSE_BUTTON_RIGHT) == GLFW_PRESS;
        bool right_pressed = right_down && !right_click_prev_;
        right_click_prev_ = right_down;
        if (!wants_mouse && right_pressed) {
            double tmx, tmy;
            glfwGetCursorPos(app.window(), &tmx, &tmy);
            int win_w, win_h;
            glfwGetWindowSize(app.window(), &win_w, &win_h);
            float ndc_x = (2.0f * static_cast<float>(tmx) / static_cast<float>(win_w)) - 1.0f;
            float ndc_y = 1.0f - (2.0f * static_cast<float>(tmy) / static_cast<float>(win_h));
            glm::mat4 inv_vp = glm::inverse(gs_vp_);
            glm::vec4 near_clip = inv_vp * glm::vec4(ndc_x, ndc_y, 0.0f, 1.0f);
            glm::vec4 far_clip  = inv_vp * glm::vec4(ndc_x, ndc_y, 1.0f, 1.0f);
            glm::vec3 near_pt = glm::vec3(near_clip) / near_clip.w;
            glm::vec3 far_pt  = glm::vec3(far_clip)  / far_clip.w;
            glm::vec3 dir = far_pt - near_pt;
            float ground_y = camera_review_->player_position().y;
            if (std::abs(dir.y) > 0.001f) {
                float t = (ground_y - near_pt.y) / dir.y;
                if (t > 0.0f) {
                    glm::vec3 hit = near_pt + dir * t;
                    camera_review_->teleport(hit.x, hit.z);
                }
            }
        }
    } else {
        // ── Orbit Camera (default) ──

        // When sync_camera override is active in orbit mode, apply the
        // externally synced camera directly instead of computing from
        // azimuth/elevation/distance.
        if (sync_override && app.renderer().has_gs_cloud()) {
            auto pos = app.renderer().camera().position();
            auto tgt = app.renderer().camera().target();

            // Keep orbit state in sync so world streaming, gizmo
            // projection, and other orbit-derived logic use the
            // externally synced camera rather than stale values.
            target_ = tgt;
            glm::vec3 delta = pos - tgt;
            distance_ = glm::length(delta);
            if (distance_ > 0.001f) {
                glm::vec3 dir = delta / distance_;
                azimuth_ = std::atan2(dir.x, dir.z);
                elevation_ = std::asin(std::clamp(dir.y / 1.0f, -1.0f, 1.0f));
            }

            auto& gs_renderer = app.renderer().gs_renderer();
            float aspect = static_cast<float>(gs_renderer.output_width()) /
                           static_cast<float>(gs_renderer.output_height());
            auto view = glm::lookAt(pos, tgt, glm::vec3(0, 1, 0));
            auto proj = glm::perspective(glm::radians(45.0f), aspect, 0.1f, 1000.0f);
            auto proj_gizmo = proj;
            proj[1][1] *= -1.0f;  // Vulkan Y-flip
            app.renderer().set_gs_camera(view, proj);
            gs_vp_ = proj_gizmo * view;
        }

        // Camera orbit — only when ImGui doesn't want the mouse
        if (!wants_mouse && !sync_override) {
            auto* window = app.window();
            double mx, my;
            glfwGetCursorPos(window, &mx, &my);

            if (glfwGetMouseButton(window, GLFW_MOUSE_BUTTON_LEFT) == GLFW_PRESS) {
                if (!dragging_) {
                    dragging_ = true;
                    last_mouse_x_ = mx;
                    last_mouse_y_ = my;
                }
                double dx = mx - last_mouse_x_;
                double dy = my - last_mouse_y_;
                last_mouse_x_ = mx;
                last_mouse_y_ = my;

                if (glfwGetKey(window, GLFW_KEY_LEFT_SHIFT) == GLFW_PRESS) {
                    // Pan
                    float pan_scale = distance_ * kPanSensitivity * 0.01f;
                    float cos_az = std::cos(azimuth_);
                    float sin_az = std::sin(azimuth_);
                    target_.x -= static_cast<float>(dx) * pan_scale * cos_az;
                    target_.z -= static_cast<float>(dx) * pan_scale * sin_az;
                    target_.y += static_cast<float>(dy) * pan_scale;
                } else {
                    // Orbit
                    azimuth_ -= static_cast<float>(dx) * kOrbitSensitivity;
                    elevation_ += static_cast<float>(dy) * kOrbitSensitivity;
                    elevation_ = std::clamp(elevation_, -1.5f, 1.5f);
                }
            } else {
                dragging_ = false;
            }

            // Scroll zoom
            float scroll = app.input().scroll_y_delta();
            if (scroll != 0.0f) {
                distance_ -= scroll * kZoomSensitivity;
                distance_ = std::max(1.0f, distance_);
            }

            // Reset camera
            if (glfwGetKey(window, GLFW_KEY_R) == GLFW_PRESS && !wants_keyboard) {
                azimuth_ = 0.0f;
                elevation_ = 0.3f;
                distance_ = 100.0f;
                target_ = glm::vec3(0.0f);
                camera_initialized_ = false;
            }
        }

        // Initialize camera from scene if not done
        if (!camera_initialized_ && app.renderer().has_gs_cloud()) {
            target_ = app.gs_terrain().cloud_center;
            distance_ = std::max(app.gs_terrain().cloud_extent * 1.5f, 50.0f);
            camera_initialized_ = true;
        }

        // Apply camera (skip when sync override already applied above)
        if (!sync_override && app.renderer().has_gs_cloud()) {
            float cos_el = std::cos(elevation_);
            glm::vec3 eye{
                target_.x + distance_ * cos_el * std::sin(azimuth_),
                target_.y + distance_ * std::sin(elevation_),
                target_.z + distance_ * cos_el * std::cos(azimuth_)
            };
            auto& gs_renderer = app.renderer().gs_renderer();
            float aspect = static_cast<float>(gs_renderer.output_width()) /
                           static_cast<float>(gs_renderer.output_height());
            auto view = glm::lookAt(eye, target_, glm::vec3(0, 1, 0));
            auto proj = glm::perspective(glm::radians(45.0f), aspect, 0.1f, 1000.0f);
            proj[1][1] *= -1.0f;  // Vulkan Y-flip
            app.renderer().set_gs_camera(view, proj);

            // Cache VP for gizmo projection (without Vulkan Y-flip)
            auto proj_gizmo = glm::perspective(glm::radians(45.0f), aspect, 0.1f, 1000.0f);
            gs_vp_ = proj_gizmo * view;
        }
    }

    // Update character animation and upload bone transforms
    if (anim_player_ && anim_playing_) {
        anim_player_->update(dt * anim_speed_);
        app.renderer().gs_renderer().upload_bone_transforms(
            anim_player_->bone_transforms().data(),
            static_cast<uint32_t>(character_data_->bones.size()));
    }

    // ── World streaming evaluation ──
    if (app.scene_objects().world_manifest.has_value() && !world_streamer_) {
        world_streamer_ = std::make_unique<WorldStreamer>();
        world_streamer_->init(*app.scene_objects().world_manifest);
        std::fprintf(stderr, "[Staging] WorldStreamer initialized: load_radius=%.0f unload_radius=%.0f\n",
            world_streamer_->load_radius(), world_streamer_->unload_radius());
    }

    if (world_streamer_) {
        // Derive camera position from current mode
        glm::vec3 cam_pos;
        if (camera_review_ && camera_review_->is_active()) {
            cam_pos = camera_review_->player_position();
        } else {
            float cos_el = std::cos(elevation_);
            cam_pos = glm::vec3{
                target_.x + distance_ * cos_el * std::sin(azimuth_),
                target_.y + distance_ * std::sin(elevation_),
                target_.z + distance_ * cos_el * std::cos(azimuth_)
            };
        }

        auto events = world_streamer_->update(cam_pos);

        // Process pending loads
        for (const auto& grid_key : world_streamer_->pending_loads()) {
            for (const auto& chunk : world_streamer_->manifest().chunks) {
                std::string key = std::to_string(chunk.grid.x) + "," +
                                  std::to_string(chunk.grid.y) + "," +
                                  std::to_string(chunk.grid.z);
                if (key == grid_key && !chunk.ply_file.empty()) {
                    auto resolved = resolve_asset_path(chunk.ply_file);
                    std::fprintf(stderr, "[Staging] Chunk [%s] Loading: %s\n",
                        grid_key.c_str(), chunk.ply_file.c_str());
                    // load_cloud_async now expects an in-memory cloud; PLY
                    // parse runs on the main thread for now (same trade-off
                    // as the IslandDemo WorldStreamer path).
                    GaussianCloud chunk_cloud;
                    chunk_cloud.load_ply(resolved.string());
                    app.renderer().gs_renderer().load_cloud_async(std::move(chunk_cloud));
                    break;
                }
            }
        }

        // Process pending unloads
        for (const auto& grid_key : world_streamer_->pending_unloads()) {
            std::fprintf(stderr, "[Staging] Chunk [%s] Unloaded\n", grid_key.c_str());
        }

        // Log streaming events
        for (const auto& ev : events) {
            switch (ev.type) {
                case WorldStreamer::StreamEvent::VOLUME_ENTERED:
                    std::fprintf(stderr, "[Staging] StreamingVolume entered: %s\n", ev.id.c_str());
                    break;
                case WorldStreamer::StreamEvent::VOLUME_EXITED:
                    std::fprintf(stderr, "[Staging] StreamingVolume exited: %s\n", ev.id.c_str());
                    break;
                default:
                    break;
            }
        }
    }

#ifdef GSEURAT_DEV_MODE
    // Draw gizmos (always, DevOverlay handles panel visibility)
    draw_gizmos(app);
#endif

    // Update screen effects
    app.screen_effects().update(dt);
}

void StagingState::build_draw_lists(AppBase& /*app*/) {
    // No sprite draw lists — ImGui handles everything
}

#ifdef GSEURAT_DEV_MODE

// ── Staging-specific panels ──

void StagingState::draw_scene_panel(AppBase& app) {
    ImGui::SetNextWindowPos(ImVec2(10, 30), ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowSize(ImVec2(250, 150), ImGuiCond_FirstUseEver);
    if (!ImGui::Begin("Scene")) {
        ImGui::End();
        return;
    }
    ImGui::Text("Scene: %s",
        std::filesystem::path(app.scene_objects().current_scene_path).filename().string().c_str());
    if (ImGui::Button("Reload")) {
        app.clear_scene();
        app.init_scene(app.scene_objects().current_scene_path);
        camera_initialized_ = false;
    }
    ImGui::Separator();
    for (const auto& path : scene_files_) {
        auto name = std::filesystem::path(path).filename().string();
        if (ImGui::MenuItem(name.c_str())) {
            app.clear_scene();
            app.init_scene(path);
            camera_initialized_ = false;
        }
    }
    ImGui::End();
}

void StagingState::draw_camera_panel(AppBase& app) {
    ImGui::SetNextWindowPos(ImVec2(270, 240), ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowSize(ImVec2(280, 250), ImGuiCond_FirstUseEver);
    if (!ImGui::Begin("Camera")) {
        ImGui::End();
        return;
    }

    ImGui::DragFloat("Azimuth", &azimuth_, 0.01f);
    ImGui::DragFloat("Elevation", &elevation_, 0.01f, -1.5f, 1.5f);
    ImGui::DragFloat("Distance", &distance_, 1.0f, 1.0f, 1000.0f);
    ImGui::DragFloat3("Target", &target_.x, 0.5f);

    if (ImGui::Button("Reset")) {
        azimuth_ = 0.0f;
        elevation_ = 0.3f;
        distance_ = 100.0f;
        target_ = glm::vec3(0.0f);
    }

    // ── Bookmarks ──
    ImGui::Separator();
    ImGui::Text("Bookmarks");

    if (ImGui::Button("Save Current")) {
        CameraBookmark bm;
        bm.name = "Bookmark " + std::to_string(bookmarks_.size() + 1);
        bm.azimuth = azimuth_;
        bm.elevation = elevation_;
        bm.distance = distance_;
        bm.target = target_;
        bookmarks_.push_back(bm);
    }

    int to_remove = -1;
    for (size_t i = 0; i < bookmarks_.size(); i++) {
        ImGui::PushID(static_cast<int>(i));
        if (ImGui::Button("Go")) {
            azimuth_ = bookmarks_[i].azimuth;
            elevation_ = bookmarks_[i].elevation;
            distance_ = bookmarks_[i].distance;
            target_ = bookmarks_[i].target;
        }
        ImGui::SameLine();
        if (ImGui::Button("X")) {
            to_remove = static_cast<int>(i);
        }
        ImGui::SameLine();
        // Editable name
        char buf[64];
        std::snprintf(buf, sizeof(buf), "%s", bookmarks_[i].name.c_str());
        ImGui::SetNextItemWidth(150);
        if (ImGui::InputText("##name", buf, sizeof(buf))) {
            bookmarks_[i].name = buf;
        }
        ImGui::PopID();
    }
    if (to_remove >= 0) {
        bookmarks_.erase(bookmarks_.begin() + to_remove);
    }

    // ── Camera Review ──
    ImGui::Separator();
    if (ImGui::CollapsingHeader("Camera Review")) {
        if (camera_review_ && camera_review_->is_active()) {
            if (ImGui::Button("Stop Review")) {
                camera_review_->deactivate();
            }
            ImGui::Separator();

            // Quick teleport: buttons for each volume
            auto& volumes = camera_review_->volumes();
            auto& names = camera_review_->zone_names();
            if (!volumes.empty()) {
                ImGui::Text("Go to Volume:");
                for (auto& [id, vol] : volumes) {
                    auto name_it = names.find(id);
                    std::string label = name_it != names.end() ? name_it->second : "volume";
                    // Truncate long auto-generated IDs for display
                    if (label.size() > 20) label = label.substr(0, 20) + "...";
                    ImGui::PushID(id);
                    if (ImGui::Button(label.c_str())) {
                        auto center = std::visit([](const auto& s) { return s.center; }, vol.shape);
                        std::fprintf(stderr, "[CameraReview] Teleport to volume center: (%.1f, %.1f, %.1f)\n",
                                     center.x, center.y, center.z);
                        camera_review_->teleport(center.x, center.y, center.z);
                    }
                    ImGui::PopID();
                    ImGui::SameLine();
                }
                ImGui::NewLine();
                ImGui::Separator();
            }

            // Player position display + manual input
            auto pos = camera_review_->player_position();
            ImGui::Text("Player: (%.1f, %.1f, %.1f)", pos.x, pos.y, pos.z);

            // Active zone info
            auto zone_name = camera_review_->active_zone_name();
            static const char* mode_names[] = {"free_look", "rail_follow", "cinematic_rail", "fixed_point", "side_scroll"};
            int mode_idx = static_cast<int>(camera_review_->active_zone_mode());
            if (mode_idx >= 0 && mode_idx < 5) {
                ImGui::Text("Zone: %s (%s)", zone_name.c_str(), mode_names[mode_idx]);
            } else {
                ImGui::Text("Zone: %s", zone_name.c_str());
            }

            if (camera_review_->is_transitioning()) {
                ImGui::TextColored(ImVec4(1.0f, 0.8f, 0.2f, 1.0f), "Transitioning...");
            }

            ImGui::Separator();

            // Speed slider
            ImGui::DragFloat("Speed##review", &camera_review_->player_speed(), 1.0f, 5.0f, 200.0f);

            // Movement reference dropdown
            static const char* move_ref_names[] = {"Camera Facing", "World Axis"};
            int move_ref = static_cast<int>(camera_review_->move_reference());
            if (ImGui::Combo("Movement##review", &move_ref, move_ref_names, 2)) {
                camera_review_->set_move_reference(
                    static_cast<CameraReviewState::MoveReference>(move_ref));
            }

            if (ImGui::Button("Reset Player##review")) {
                camera_review_->reset_player();
            }
        } else {
            if (ImGui::Button("Start Review")) {
                // Re-read scene file to pick up latest camera_zones from Bricklayer
                auto scene_path = app.scene_objects().current_scene_path;
                if (!scene_path.empty()) {
                    try { last_scene_data_ = SceneLoader::load(scene_path); } catch (...) {}
                }
                if (last_scene_data_ && last_scene_data_->camera_zones) {
                    auto& cz = *last_scene_data_->camera_zones;
                    if (!cz.volumes.empty() || !cz.rails.empty() || !cz.triggers.empty()) {
                        if (!camera_review_) {
                            camera_review_ = std::make_unique<CameraReviewState>();
                        }
                        glm::vec3 start = app.renderer().has_gs_cloud()
                            ? app.gs_terrain().cloud_center : glm::vec3(0.0f);
                        camera_review_->activate(*last_scene_data_, start, app.gs_terrain().terrain_aabb);
                    }
                }
            }
        }
    }

    ImGui::End();
}

void StagingState::draw_character_panel(AppBase& app) {
    ImGui::SetNextWindowPos(ImVec2(10, 500), ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowSize(ImVec2(280, 200), ImGuiCond_FirstUseEver);
    if (!ImGui::Begin("Character Animation", &show_character_)) {
        ImGui::End();
        return;
    }

    if (!character_data_) {
        ImGui::TextColored(ImVec4(0.6f, 0.6f, 0.6f, 1.0f), "No character loaded.");
        ImGui::TextWrapped("Use 'Preview in Staging' from Echidna, or send load_character command.");
        ImGui::End();
        return;
    }

    ImGui::Text("Character: %s", character_data_->name.c_str());
    ImGui::Text("Bones: %zu", character_data_->bones.size());
    ImGui::Separator();

    // Animation clip selection
    if (!character_data_->clips.empty()) {
        ImGui::Text("Animation Clips:");
        for (int i = 0; i < static_cast<int>(character_data_->clips.size()); i++) {
            const auto& clip = character_data_->clips[i];
            bool is_selected = (i == selected_clip_);
            if (ImGui::Selectable(clip.name.c_str(), is_selected)) {
                selected_clip_ = i;
                anim_player_->play(clip.name);
                anim_playing_ = true;
            }
        }

        ImGui::Separator();

        // Playback controls
        if (ImGui::Button(anim_playing_ ? "Pause" : "Play")) {
            anim_playing_ = !anim_playing_;
            if (anim_playing_ && anim_player_ && !anim_player_->is_playing()) {
                if (selected_clip_ >= 0 && selected_clip_ < static_cast<int>(character_data_->clips.size())) {
                    anim_player_->play(character_data_->clips[selected_clip_].name);
                }
            }
        }
        ImGui::SameLine();
        if (ImGui::Button("Stop")) {
            anim_playing_ = false;
            app.renderer().gs_renderer().clear_bone_transforms();
        }
        ImGui::SameLine();
        ImGui::SetNextItemWidth(80);
        ImGui::SliderFloat("Speed", &anim_speed_, 0.25f, 2.0f, "%.2fx");

        // Show current clip info
        if (anim_player_ && anim_player_->is_playing()) {
            ImGui::Text("Playing: %s", anim_player_->current_clip().c_str());
        }
    } else {
        ImGui::TextColored(ImVec4(0.8f, 0.6f, 0.3f, 1.0f), "No animation clips defined.");
    }

    ImGui::End();
}

// ── Gizmos ──

bool StagingState::project_to_screen(const glm::vec3& world_pos, const glm::mat4& vp,
                                      float screen_w, float screen_h,
                                      float& out_x, float& out_y) const {
    glm::vec4 clip = vp * glm::vec4(world_pos, 1.0f);
    if (clip.w <= 0.001f) return false;
    glm::vec3 ndc = glm::vec3(clip) / clip.w;
    out_x = (ndc.x * 0.5f + 0.5f) * screen_w;
    out_y = (1.0f - (ndc.y * 0.5f + 0.5f)) * screen_h;
    return ndc.z >= 0.0f && ndc.z <= 1.0f;
}

// Draw a wireframe sphere (projected as circle from center + edge point)
static void draw_sphere_gizmo(ImDrawList* dl, const glm::vec3& center, float radius,
                               const glm::mat4& vp, float sw, float sh, ImU32 col,
                               bool (*proj_fn)(const glm::vec3&, const glm::mat4&, float, float, float&, float&, const void*),
                               const void* self) {
    float cx, cy;
    if (!proj_fn(center, vp, sw, sh, cx, cy, self)) return;
    glm::vec3 edge = center + glm::vec3(radius, 0.0f, 0.0f);
    float ex, ey;
    float sr = 15.0f;
    if (proj_fn(edge, vp, sw, sh, ex, ey, self)) {
        sr = std::abs(ex - cx);
        sr = std::clamp(sr, 3.0f, 300.0f);
    }
    dl->AddCircle(ImVec2(cx, cy), sr, col, 24, 1.5f);
}

// Draw a wireframe box (8 corners projected, 12 edges)
static void draw_box_gizmo(ImDrawList* dl, const glm::vec3& center, const glm::vec3& half,
                             const glm::mat4& vp, float sw, float sh, ImU32 col,
                             bool (*proj_fn)(const glm::vec3&, const glm::mat4&, float, float, float&, float&, const void*),
                             const void* self) {
    glm::vec3 corners[8] = {
        center + glm::vec3(-half.x, -half.y, -half.z),
        center + glm::vec3( half.x, -half.y, -half.z),
        center + glm::vec3( half.x,  half.y, -half.z),
        center + glm::vec3(-half.x,  half.y, -half.z),
        center + glm::vec3(-half.x, -half.y,  half.z),
        center + glm::vec3( half.x, -half.y,  half.z),
        center + glm::vec3( half.x,  half.y,  half.z),
        center + glm::vec3(-half.x,  half.y,  half.z),
    };
    ImVec2 pts[8];
    bool vis[8];
    for (int i = 0; i < 8; i++) {
        vis[i] = proj_fn(corners[i], vp, sw, sh, pts[i].x, pts[i].y, self);
    }
    constexpr int edges[12][2] = {
        {0,1},{1,2},{2,3},{3,0}, {4,5},{5,6},{6,7},{7,4}, {0,4},{1,5},{2,6},{3,7}
    };
    for (const auto& e : edges) {
        if (vis[e[0]] && vis[e[1]]) {
            dl->AddLine(pts[e[0]], pts[e[1]], col, 1.0f);
        }
    }
}

// Static wrapper for project_to_screen (needed for function pointers)
static bool project_wrapper(const glm::vec3& pos, const glm::mat4& vp,
                             float sw, float sh, float& ox, float& oy, const void* self) {
    return static_cast<const StagingState*>(self)->project_to_screen(pos, vp, sw, sh, ox, oy);
}

// Draw region wireframe (sphere or box)
static void draw_region_gizmo(ImDrawList* dl, const GsAnimRegion& region,
                                const glm::vec3& offset, const glm::mat4& vp,
                                float sw, float sh, ImU32 col, const void* self) {
    glm::vec3 center = region.center + offset;
    if (region.shape == GsAnimRegion::Shape::Box) {
        draw_box_gizmo(dl, center, region.half_extents, vp, sw, sh, col, project_wrapper, self);
    } else {
        draw_sphere_gizmo(dl, center, region.radius, vp, sw, sh, col, project_wrapper, self);
    }
}

void StagingState::draw_gizmos(AppBase& app) {
    if (!app.renderer().has_gs_cloud()) return;

    auto& ov = app.dev_overlay();

    const glm::mat4& vp = gs_vp_;  // computed once in update()
    auto& gs = app.renderer().gs_renderer();

    auto& io = ImGui::GetIO();
    float sw = io.DisplaySize.x;
    float sh = io.DisplaySize.y;

    ImDrawList* dl = ImGui::GetForegroundDrawList();

    // ── Light gizmos ──
    if (ov.show_gizmo_lights) {
        const auto& lights = gs.point_lights();
        for (size_t i = 0; i < lights.size(); i++) {
            glm::vec3 pos(lights[i].position_and_radius.x,
                          lights[i].position_and_radius.z,
                          lights[i].position_and_radius.y);
            float sx, sy;
            if (!project_to_screen(pos, vp, sw, sh, sx, sy)) continue;

            ImU32 col = ImGui::ColorConvertFloat4ToU32(
                ImVec4(lights[i].color.r, lights[i].color.g, lights[i].color.b, 0.8f));

            draw_sphere_gizmo(dl, pos, lights[i].position_and_radius.w,
                              vp, sw, sh, col, project_wrapper, this);
            dl->AddCircleFilled(ImVec2(sx, sy), 4.0f, col);

            char label[32];
            std::snprintf(label, sizeof(label), "L%zu", i);
            dl->AddText(ImVec2(sx + 6, sy - 12), col, label);
        }
    }

    // ── Standalone emitter gizmos (with spawn region) ──
    if (ov.show_gizmo_emitters) {
        ImU32 emitter_col = IM_COL32(236, 72, 153, 200);  // pink
        auto& emitters = app.renderer().gs_particle_emitters();
        for (size_t i = 0; i < emitters.size(); i++) {
            auto& cfg = emitters[i].config();
            float sx, sy;
            if (!project_to_screen(cfg.position, vp, sw, sh, sx, sy)) continue;

            dl->AddCircleFilled(ImVec2(sx, sy), 5.0f, emitter_col);

            // Draw spawn region
            draw_region_gizmo(dl, cfg.spawn_region, cfg.position, vp, sw, sh, emitter_col, this);

            char label[32];
            std::snprintf(label, sizeof(label), "E%zu", i);
            dl->AddText(ImVec2(sx + 8, sy - 10), emitter_col, label);
        }
    }

    // ── Scene animation gizmos (region wireframes) ──
    if (ov.show_gizmo_vfx) {
        ImU32 anim_col = IM_COL32(6, 182, 212, 180);  // cyan
        const auto& anims = app.renderer().gs_scene_animations();
        for (size_t i = 0; i < anims.size(); i++) {
            float sx, sy;
            if (!project_to_screen(anims[i].region.center, vp, sw, sh, sx, sy)) continue;

            draw_region_gizmo(dl, anims[i].region, glm::vec3(0.0f), vp, sw, sh, anim_col, this);
            dl->AddCircleFilled(ImVec2(sx, sy), 3.0f, anim_col);

            char label[64];
            std::snprintf(label, sizeof(label), "Anim:%s", anims[i].effect.c_str());
            dl->AddText(ImVec2(sx + 6, sy - 10), anim_col, label);
        }
    }

    // ── VFX instance gizmos (with element details) ──
    if (ov.show_gizmo_vfx) {
        const auto& vfx = app.renderer().vfx_instances();
        for (size_t i = 0; i < vfx.size(); i++) {
            auto inst_pos = vfx[i].position();
            float sx, sy;
            if (!project_to_screen(inst_pos, vp, sw, sh, sx, sy)) continue;

            ImU32 vfx_col = IM_COL32(100, 200, 255, 220);
            // Diamond for instance origin
            float d = 7.0f;
            dl->AddQuadFilled(
                ImVec2(sx, sy - d), ImVec2(sx + d, sy),
                ImVec2(sx, sy + d), ImVec2(sx - d, sy), vfx_col);

            const char* name = vfx[i].preset().name.c_str();
            dl->AddText(ImVec2(sx + 10, sy - 8), vfx_col, name);

            // Draw each element inside the VFX instance
            for (const auto& el : vfx[i].preset().elements) {
                glm::vec3 el_world = inst_pos + el.position;
                float ex, ey;
                if (!project_to_screen(el_world, vp, sw, sh, ex, ey)) continue;

                if (el.type == "object") {
                    ImU32 obj_col = IM_COL32(170, 170, 170, 180);
                    dl->AddCircle(ImVec2(ex, ey), 4.0f, obj_col, 6, 1.5f);  // hexagon
                    dl->AddText(ImVec2(ex + 6, ey - 8), obj_col, el.name.c_str());

                } else if (el.type == "emitter") {
                    ImU32 em_col = IM_COL32(236, 72, 153, 180);  // pink
                    dl->AddCircleFilled(ImVec2(ex, ey), 3.0f, em_col);
                    // Draw emitter spawn region
                    draw_region_gizmo(dl, el.emitter_config.spawn_region, el_world,
                                      vp, sw, sh, em_col, this);
                    dl->AddText(ImVec2(ex + 6, ey - 8), em_col, el.name.c_str());

                } else if (el.type == "animation") {
                    ImU32 an_col = IM_COL32(6, 182, 212, 180);  // cyan
                    dl->AddCircleFilled(ImVec2(ex, ey), 3.0f, an_col);
                    // Draw animation region
                    draw_region_gizmo(dl, el.region, el_world, vp, sw, sh, an_col, this);
                    char label[64];
                    std::snprintf(label, sizeof(label), "%s [%s]",
                                  el.name.c_str(), el.animation_config.effect.c_str());
                    dl->AddText(ImVec2(ex + 6, ey - 8), an_col, label);

                } else if (el.type == "light") {
                    ImU32 lt_col = IM_COL32(234, 179, 8, 180);  // yellow
                    dl->AddCircleFilled(ImVec2(ex, ey), 4.0f, lt_col);
                    dl->AddText(ImVec2(ex + 6, ey - 8), lt_col, el.name.c_str());
                }
            }
        }
    }

    // ── Game Object gizmos ──
    if (ov.show_gizmo_game_objects) {
        ImU32 go_col = IM_COL32(68, 136, 255, 200);       // blue
        ImU32 go_col_static = IM_COL32(136, 136, 136, 150); // gray for no-component
        const auto& game_objects = app.scene_objects().game_objects;
        auto aabb_off = app.gs_terrain().aabb_offset();
        for (size_t i = 0; i < game_objects.size(); i++) {
            const auto& go = game_objects[i];
            // Game object PLYs are merged at raw world coords (no AABB offset)
            glm::vec3 pos(go.position.x(),
                          go.position.y(),
                          go.position.z());
            float sx, sy;
            if (!project_to_screen(pos, vp, sw, sh, sx, sy)) continue;

            bool has_components = !go.components.empty() && !go.components.is_null();
            ImU32 col = has_components ? go_col : go_col_static;

            // Draw box outline
            draw_box_gizmo(dl, pos, glm::vec3(go.scale * 0.5f),
                           vp, sw, sh, col, project_wrapper, this);
            dl->AddRectFilled(ImVec2(sx - 3, sy - 3), ImVec2(sx + 3, sy + 3), col);

            char label[64];
            std::snprintf(label, sizeof(label), "%s", go.name.c_str());
            dl->AddText(ImVec2(sx + 6, sy - 10), col, label);
        }
    }

    // ── Camera Zone gizmos (visible in both orbit and review modes) ──
    if (ov.show_gizmo_camera_zones && camera_review_ && camera_review_->has_zone_data()) {
        camera_review_->draw_gizmos(vp, sw, sh, dl, project_wrapper, this);
    }

    // ── Collision grid overlay ──
    if (ov.show_gizmo_collision && last_scene_data_ && last_scene_data_->collision.has_value()) {
        auto terrain_aabb = app.gs_terrain().terrain_aabb;
        glm::vec2 origin(terrain_aabb.min.x, terrain_aabb.min.z);
        draw_collision_grid_overlay(dl, *last_scene_data_->collision, origin, vp, sw, sh);
    }

    // ── World manifest gizmos ──
    if (ov.show_gizmo_world && app.scene_objects().world_manifest.has_value()) {
        const auto& wm = *app.scene_objects().world_manifest;

        // Chunk wireframes (green)
        ImU32 chunk_col = IM_COL32(68, 204, 68, 180);
        for (size_t i = 0; i < wm.chunks.size(); i++) {
            auto [aabb_min, aabb_max] = wm.chunk_aabb(i);
            glm::vec3 center = (aabb_min + aabb_max) * 0.5f;
            glm::vec3 half   = (aabb_max - aabb_min) * 0.5f;
            float sx, sy;
            if (!project_to_screen(center, vp, sw, sh, sx, sy)) continue;
            draw_box_gizmo(dl, center, half, vp, sw, sh, chunk_col, project_wrapper, this);
            char label[32];
            std::snprintf(label, sizeof(label), "C%zu", i);
            dl->AddText(ImVec2(sx + 4, sy - 10), chunk_col, label);
        }

        // Streaming volume wireframes (orange)
        ImU32 sv_col = IM_COL32(204, 136, 0, 180);
        for (const auto& sv : wm.streaming_volumes) {
            float sx, sy;
            if (!project_to_screen(sv.position, vp, sw, sh, sx, sy)) continue;
            if (sv.shape == "box") {
                draw_box_gizmo(dl, sv.position, sv.half_extents, vp, sw, sh, sv_col, project_wrapper, this);
            } else {
                draw_sphere_gizmo(dl, sv.position, sv.radius, vp, sw, sh, sv_col, project_wrapper, this);
            }
            dl->AddCircleFilled(ImVec2(sx, sy), 3.0f, sv_col);
            dl->AddText(ImVec2(sx + 6, sy - 8), sv_col, sv.id.c_str());
        }
    }
}

#endif  // GSEURAT_DEV_MODE

void StagingState::load_character(const std::string& manifest_path, AppBase& app) {
    auto data = load_character_manifest(manifest_path);
    if (!data) {
        std::fprintf(stderr, "[Staging] Failed to load character manifest: %s\n", manifest_path.c_str());
        return;
    }
    std::fprintf(stderr, "[Staging] Loaded character '%s' (%zu bones, %zu clips)\n",
        data->name.c_str(), data->bones.size(), data->clips.size());

    // Release old character data before replacing — macOS allocator crashes when
    // freeing CharacterData vectors while VMA is active (same issue as on_exit).
    anim_player_.reset();
    if (character_data_) {
        ShutdownAuditor::remove(character_data_.get());
        (void)character_data_.release();  // leak old — macOS allocator workaround
    }

    character_data_ = std::make_unique<CharacterData>(std::move(*data));
    ShutdownAuditor::record<CharacterData>(character_data_.get());
    anim_player_ = std::make_unique<BoneAnimationPlayer>(*character_data_);
    ShutdownAuditor::record<BoneAnimationPlayer>(anim_player_.get());
    selected_clip_ = 0;

    // Auto-play the first clip
    if (!character_data_->clips.empty()) {
        anim_player_->play(character_data_->clips[0].name);
        anim_playing_ = true;
    } else {
        anim_playing_ = false;
    }

    // Clear bone transforms (identity) until animation starts
    app.renderer().gs_renderer().clear_bone_transforms();
}

}  // namespace gseurat
