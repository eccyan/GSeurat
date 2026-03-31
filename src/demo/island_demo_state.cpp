#include "gseurat/demo/island_demo_state.hpp"
#include "gseurat/engine/app_base.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/gs_chunk_grid.hpp"
#include "gseurat/engine/island_components.hpp"
#include "gseurat/engine/island_systems.hpp"
#include "gseurat/engine/scene_loader.hpp"

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

#include <glm/gtc/matrix_transform.hpp>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>

namespace gseurat {

// ── on_enter ──

void IslandDemoState::on_enter(AppBase& app) {
    if (scene_path_.empty()) scene_path_ = "assets/scenes/seurat_island.json";
    app.feature_flags() = FeatureFlags::gs_viewer();
    app.init_scene(scene_path_);

    // Disable app-level parallax — we manage our own camera
    app.set_gs_parallax_active(false);
    app.renderer().set_gs_skip_chunk_cull(false);
    app.renderer().gs_renderer().set_skip_sort(false);

    // Load collision grid from scene data
    auto scene_data = SceneLoader::load(scene_path_);
    if (scene_data.collision) {
        collision_grid_ = *scene_data.collision;
        // Grid origin comes from AABB min XZ of the cloud
        if (app.renderer().has_gs_cloud()) {
            auto aabb = app.renderer().gs_chunk_grid().cloud_bounds();
            grid_origin_ = {aabb.min.x, aabb.min.z};
        }
    }

    // Determine player start position
    glm::vec3 player_pos = scene_data.player_position;
    // If player_position is zero, place at map center
    if (glm::length(player_pos) < 0.001f && app.renderer().has_gs_cloud()) {
        auto aabb = app.renderer().gs_chunk_grid().cloud_bounds();
        player_pos = aabb.center();
    }
    // Apply AABB offset (voxel→world coordinate transform)
    player_pos.x += app.gs_aabb_offset().x;
    player_pos.z += app.gs_aabb_offset().y;

    // Create player entity
    player_entity_ = app.world().create();
    app.world().add<ecs::Transform>(player_entity_, {player_pos, {1.0f, 1.0f}});
    app.world().add<PlayerController>(player_entity_, {kPlayerSpeed, kPlayerAccel});

    // Register island systems in scheduler
    app.system_scheduler().add_system({"proximity_trigger", proximity_trigger_system, {}, {}});
    app.system_scheduler().add_system({"linked_trigger", linked_trigger_system, {}, {}});
    app.system_scheduler().add_system({"emissive_toggle", emissive_toggle_system, {}, {}});

    // Spawn player character (procedural humanoid)
    if (app.renderer().has_gs_cloud()) {
        const auto& all = app.renderer().gs_chunk_grid().all_gaussians();
        map_gaussians_.assign(all.begin(), all.end());

        std::vector<Gaussian> merged = map_gaussians_;
        uint32_t map_count = static_cast<uint32_t>(merged.size());

        auto add_box = [&](float cx, float cy, float cz, int w, int h, int d,
                           glm::vec3 color, uint32_t bone) {
            for (int x = 0; x < w; ++x) {
                for (int y = 0; y < h; ++y) {
                    for (int z = 0; z < d; ++z) {
                        Gaussian g{};
                        g.position = player_pos + glm::vec3(
                            cx + x - w / 2.0f, cy + y, cz + z - d / 2.0f);
                        g.scale = glm::vec3(0.5f);
                        g.rotation = glm::quat(1, 0, 0, 0);
                        g.color = color;
                        g.opacity = 1.0f;
                        g.importance = 1.0f;
                        g.bone_index = bone;
                        merged.push_back(g);
                    }
                }
            }
        };

        add_box(0, 4, 0, 4, 6, 2, {0.2f, 0.5f, 0.8f}, 1);    // Torso
        add_box(0, 10, 0, 3, 3, 2, {0.9f, 0.75f, 0.6f}, 2);   // Head
        add_box(-3.5f, 5, 0, 2, 5, 2, {0.2f, 0.5f, 0.8f}, 3); // Left arm
        add_box(3.5f, 5, 0, 2, 5, 2, {0.2f, 0.5f, 0.8f}, 4);  // Right arm
        add_box(-1.0f, 0, 0, 2, 4, 2, {0.3f, 0.3f, 0.5f}, 5); // Left leg
        add_box(1.0f, 0, 0, 2, 4, 2, {0.3f, 0.3f, 0.5f}, 6);  // Right leg

        uint32_t char_count = static_cast<uint32_t>(merged.size()) - map_count;
        auto cloud = GaussianCloud::from_gaussians(std::move(merged));

        uint32_t gs_w = app.renderer().gs_renderer().output_width();
        uint32_t gs_h = app.renderer().gs_renderer().output_height();
        if (gs_w == 0) { gs_w = 320; gs_h = 240; }
        app.renderer().init_gs(cloud, gs_w, gs_h);

        character_origin_ = player_pos;
        character_spawned_ = true;

        std::fprintf(stderr, "[Island] Player character: %u Gaussians at (%.1f, %.1f, %.1f)\n",
                     char_count, player_pos.x, player_pos.y, player_pos.z);
    }

    // Initialize camera centered on player
    camera_target_ = player_pos + glm::vec3(0, kCameraYOffset, 0);
    azimuth_ = 0.0f;
    elevation_ = 0.5f;
    distance_ = 30.0f;

    std::fprintf(stderr, "[Island] IslandDemoState entered, scene: %s\n", scene_path_.c_str());
}

void IslandDemoState::on_exit(AppBase& app) {
    // Clean up bone transforms
    if (character_spawned_) {
        app.renderer().gs_renderer().clear_bone_transforms();
        character_spawned_ = false;
    }
}

// ── update ──

void IslandDemoState::update(AppBase& app, float dt) {
    // Escape → quit
    if (app.input().was_key_pressed(GLFW_KEY_ESCAPE)) {
        glfwSetWindowShouldClose(app.window(), GLFW_TRUE);
        return;
    }

    // Tab → toggle debug HUD
    if (app.input().was_key_pressed(GLFW_KEY_TAB)) {
        show_hud_ = !show_hud_;
    }

    // FPS counter
    {
        auto now = std::chrono::steady_clock::now();
        if (fps_frame_count_ == 0) fps_clock_ = now;
        fps_frame_count_++;
        float elapsed = std::chrono::duration<float>(now - fps_clock_).count();
        if (elapsed >= 0.5f) {
            fps_ = static_cast<float>(fps_frame_count_) / elapsed;
            fps_frame_count_ = 0;
            fps_clock_ = now;
        }
    }

    // Handle mouse input for camera orbit
    {
        auto& input = app.input();
        glm::vec2 mouse = input.mouse_pos();
        if (input.is_mouse_down(0)) {
            if (!dragging_) {
                dragging_ = true;
                last_mouse_ = mouse;
            }
            glm::vec2 delta = mouse - last_mouse_;
            azimuth_ -= delta.x * kOrbitSensitivity;
            elevation_ += delta.y * kOrbitSensitivity;
            elevation_ = std::clamp(elevation_, kMinElevation, kMaxElevation);
            last_mouse_ = mouse;
        } else {
            dragging_ = false;
        }

        // Scroll → zoom
        float scroll = input.scroll_y_delta();
        if (scroll != 0.0f) {
            distance_ -= scroll * kZoomSensitivity;
            distance_ = std::clamp(distance_, kMinDistance, kMaxDistance);
        }
    }

    // Player movement
    update_player(app, dt);

    // Run ECS systems (proximity triggers, linked triggers, emissive toggle)
    app.system_scheduler().run_all(app.world(), dt);

    // Effect systems (EmitterToggle, LightToggle)
    update_effects(app, dt);

    // Walk animation
    update_walk_animation(app, dt);

    // Camera follow
    update_camera(app, dt);
}

// ── Player movement ──

void IslandDemoState::update_player(AppBase& app, float dt) {
    auto& input = app.input();
    auto* transform = app.world().try_get<ecs::Transform>(player_entity_);
    if (!transform) return;

    // Compute desired movement direction relative to camera azimuth
    glm::vec3 forward(-std::sin(azimuth_), 0.0f, -std::cos(azimuth_));
    glm::vec3 right(std::cos(azimuth_), 0.0f, -std::sin(azimuth_));

    glm::vec3 desired_dir{0.0f};
    if (input.is_key_down(GLFW_KEY_W)) desired_dir += forward;
    if (input.is_key_down(GLFW_KEY_S)) desired_dir -= forward;
    if (input.is_key_down(GLFW_KEY_A)) desired_dir -= right;
    if (input.is_key_down(GLFW_KEY_D)) desired_dir += right;

    // Normalize diagonal
    float dir_len = glm::length(desired_dir);
    if (dir_len > 0.001f) {
        desired_dir /= dir_len;
    }

    // Target velocity
    glm::vec3 target_vel = desired_dir * kPlayerSpeed;

    // Smooth acceleration (lerp toward target)
    float blend = std::min(1.0f, kPlayerAccel * dt);
    player_velocity_.x += (target_vel.x - player_velocity_.x) * blend;
    player_velocity_.z += (target_vel.z - player_velocity_.z) * blend;

    // Update position
    transform->position += player_velocity_ * dt;

    // Snap Y to collision grid elevation if available
    if (collision_grid_.width > 0 && collision_grid_.height > 0) {
        float local_x = transform->position.x - grid_origin_.x;
        float local_z = transform->position.z - grid_origin_.y;
        int gx = static_cast<int>(local_x / collision_grid_.cell_size);
        int gz = static_cast<int>(local_z / collision_grid_.cell_size);

        if (gx >= 0 && gx < static_cast<int>(collision_grid_.width) &&
            gz >= 0 && gz < static_cast<int>(collision_grid_.height)) {
            // Check solid — if solid, undo movement
            if (collision_grid_.is_solid(static_cast<uint32_t>(gx),
                                          static_cast<uint32_t>(gz))) {
                transform->position -= player_velocity_ * dt;
            } else {
                // Snap to elevation
                float elev = collision_grid_.get_elevation(
                    static_cast<uint32_t>(gx), static_cast<uint32_t>(gz));
                if (!collision_grid_.elevation.empty()) {
                    transform->position.y = elev;
                }
            }
        }
    }

    // Update character origin for bone transforms
    character_origin_ = transform->position;
}

// ── Camera follow ──

void IslandDemoState::update_camera(AppBase& app, float dt) {
    auto* transform = app.world().try_get<ecs::Transform>(player_entity_);
    if (!transform) return;

    // Smooth target follow
    glm::vec3 desired_target = transform->position + glm::vec3(0, kCameraYOffset, 0);
    float blend = std::min(1.0f, kCameraSmoothing * dt);
    camera_target_ += (desired_target - camera_target_) * blend;

    // Compute eye from spherical coords
    float cos_elev = std::cos(elevation_);
    float sin_elev = std::sin(elevation_);
    float cos_azi = std::cos(azimuth_);
    float sin_azi = std::sin(azimuth_);

    glm::vec3 offset(
        distance_ * cos_elev * sin_azi,
        distance_ * sin_elev,
        distance_ * cos_elev * cos_azi
    );
    glm::vec3 eye = camera_target_ + offset;

    glm::mat4 view = glm::lookAt(eye, camera_target_, glm::vec3(0.0f, 1.0f, 0.0f));
    glm::mat4 proj = glm::perspective(
        glm::radians(60.0f),
        1280.0f / 720.0f,
        0.1f, 1000.0f
    );
    // Vulkan Y-flip
    proj[1][1] *= -1.0f;

    app.renderer().set_gs_camera(view, proj);
}

// ── Effect systems (EmitterToggle, LightToggle) ──

void IslandDemoState::update_effects(AppBase& app, float dt) {
    (void)dt;
    auto& world = app.world();

    // EmitterToggle: toggle emitter spawn_rate based on proximity trigger
    world.view<EmitterToggle, ProximityTrigger>().each(
        [&](ecs::Entity, EmitterToggle& et, ProximityTrigger& pt) {
            auto& emitters = app.renderer().gs_particle_emitters();
            if (et.emitter_index >= emitters.size()) return;
            auto& emitter = emitters[et.emitter_index];
            if (pt.triggered && !et.active) {
                et.active = true;
                // Re-enable: restore original spawn rate from config
                auto cfg = emitter.config();
                cfg.spawn_rate = 10.0f;  // default active rate
                emitter.configure(cfg);
            } else if (!pt.triggered && et.active) {
                et.active = false;
                auto cfg = emitter.config();
                cfg.spawn_rate = 0.0f;
                emitter.configure(cfg);
            }
        });

    // LightToggle: toggle scene light based on proximity
    world.view<LightToggle, ProximityTrigger, ecs::Transform>().each(
        [&](ecs::Entity, LightToggle& lt, ProximityTrigger& pt, ecs::Transform& t) {
            if (pt.triggered && !lt.active) {
                lt.active = true;
                PointLight pl{};
                pl.position_and_radius = glm::vec4(
                    t.position.x, t.position.y, t.position.z, lt.radius);
                pl.color = glm::vec4(
                    lt.color_r * lt.intensity,
                    lt.color_g * lt.intensity,
                    lt.color_b * lt.intensity, 1.0f);
                app.scene().add_light(pl);
            } else if (!pt.triggered && lt.active) {
                lt.active = false;
                // Simple: clear and re-add all non-toggled lights
                // (in production you'd track the light index)
            }
        });

    // BurstEffect: one-shot particle burst on trigger
    world.view<BurstEffect, ProximityTrigger, ecs::Transform>().each(
        [&](ecs::Entity, BurstEffect& be, ProximityTrigger& pt, ecs::Transform& t) {
            if (pt.triggered && !be.fired) {
                be.fired = true;
                auto& emitters = app.renderer().gs_particle_emitters();
                if (be.emitter_index < emitters.size()) {
                    // Temporarily boost spawn rate for a burst
                    auto& emitter = emitters[be.emitter_index];
                    auto cfg = emitter.config();
                    cfg.position = t.position;
                    cfg.spawn_rate = 100.0f;  // burst
                    emitter.configure(cfg);
                }
            }
        });
}

// ── Walk animation ──

void IslandDemoState::update_walk_animation(AppBase& app, float dt) {
    if (!character_spawned_) return;

    float speed = glm::length(glm::vec2(player_velocity_.x, player_velocity_.z));
    const glm::vec3& o = character_origin_;

    if (speed > 0.5f) {
        walk_anim_time_ += dt;
    } else {
        // Lerp back toward zero
        walk_anim_time_ *= std::max(0.0f, 1.0f - dt * 5.0f);
    }

    float swing = std::sin(walk_anim_time_ * 8.0f) * 0.5f;
    // Scale swing by movement speed (0 when stopped)
    float swing_scale = std::min(speed / kPlayerSpeed, 1.0f);
    swing *= swing_scale;

    glm::mat4 bones[7];
    bones[0] = glm::mat4(1.0f);  // map Gaussians (bone 0)

    // Torso bob
    bones[1] = glm::translate(glm::mat4(1.0f), {0, std::abs(swing) * 0.3f, 0});
    // Head follows torso
    bones[2] = bones[1];

    // Pivot rotation: translate to joint, rotate, translate back
    auto pivot_rotate = [&](glm::vec3 pivot_local, float angle) {
        glm::vec3 world_pivot = o + pivot_local;
        auto t = glm::translate(glm::mat4(1.0f), world_pivot);
        auto r = glm::rotate(glm::mat4(1.0f), angle, {1, 0, 0});
        return t * r * glm::translate(glm::mat4(1.0f), -world_pivot);
    };

    bones[3] = pivot_rotate({-3.5f, 9.0f, 0.0f}, swing);    // Left arm
    bones[4] = pivot_rotate({3.5f, 9.0f, 0.0f}, -swing);     // Right arm
    bones[5] = pivot_rotate({-1.0f, 4.0f, 0.0f}, -swing);    // Left leg
    bones[6] = pivot_rotate({1.0f, 4.0f, 0.0f}, swing);      // Right leg

    app.renderer().gs_renderer().upload_bone_transforms(bones, 7);
}

// ── build_draw_lists (debug HUD) ──

void IslandDemoState::build_draw_lists(AppBase& app) {
    if (!show_hud_) return;

    auto& ui = app.ui_ctx();

    constexpr float panel_x = 10.0f;
    constexpr float panel_w = 260.0f;
    constexpr float panel_h = 120.0f;
    constexpr float panel_top = 720.0f - 10.0f;
    constexpr float panel_cy = panel_top - panel_h * 0.5f;

    ui.panel(panel_x + panel_w * 0.5f, panel_cy, panel_w, panel_h,
             {0.0f, 0.0f, 0.0f, 0.6f});

    float y = panel_top - 20.0f;
    constexpr float lx = panel_x + 12.0f;
    constexpr float scale = 0.45f;
    glm::vec4 white{1.0f, 1.0f, 1.0f, 1.0f};
    glm::vec4 title_color{0.4f, 0.8f, 1.0f, 1.0f};

    auto fmt = [](float v) {
        char buf[16];
        std::snprintf(buf, sizeof(buf), "%.1f", v);
        return std::string(buf);
    };

    ui.label("ISLAND DEMO", lx, y, 0.6f, title_color);

    // FPS
    glm::vec4 fps_color = fps_ >= 30.0f ? glm::vec4{0.2f, 1.0f, 0.3f, 1.0f}
                                         : glm::vec4{1.0f, 0.3f, 0.2f, 1.0f};
    ui.label(fmt(fps_) + " FPS", panel_x + panel_w - 80.0f, y, scale, fps_color);
    y -= 22.0f;

    // Player position
    auto* transform = app.world().try_get<ecs::Transform>(player_entity_);
    if (transform) {
        ui.label("Pos: " + fmt(transform->position.x) + ", " +
                 fmt(transform->position.y) + ", " +
                 fmt(transform->position.z), lx, y, scale, white);
        y -= 18.0f;
    }

    // Camera info
    ui.label("Az:" + fmt(glm::degrees(azimuth_)) +
             "  El:" + fmt(glm::degrees(elevation_)) +
             "  Dist:" + fmt(distance_), lx, y, scale, white);
    y -= 18.0f;

    // Gaussians
    uint32_t total = app.renderer().gs_renderer().gaussian_count();
    uint32_t visible = app.renderer().gs_renderer().visible_count();
    ui.label("GS: " + std::to_string(visible) + " / " + std::to_string(total),
             lx, y, scale, white);
}

}  // namespace gseurat
