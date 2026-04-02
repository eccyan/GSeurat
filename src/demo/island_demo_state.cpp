#include "gseurat/demo/island_demo_state.hpp"
#include "gseurat/engine/app_base.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/gs_chunk_grid.hpp"
#include "gseurat/demo/island_components.hpp"
#include "gseurat/demo/island_systems.hpp"
#include "gseurat/engine/scene_loader.hpp"
#include "gseurat/engine/gs_particle.hpp"
#include "gseurat/engine/gs_animator.hpp"

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

    // Enable rendering features for the demo
    app.feature_flags().bloom = true;
    app.feature_flags().fog = false;
    app.feature_flags().depth_of_field = false;
    app.feature_flags().tone_mapping = true;
    app.feature_flags().vignette = true;
    app.feature_flags().particles = true;
    app.feature_flags().point_lights = true;
    app.feature_flags().gs_lod = true;

    // Enable GS lighting: directional sun + point lights for interactive effects
    app.renderer().gs_renderer().set_light_mode(2);  // point light mode (includes directional)
    app.renderer().gs_renderer().set_light_dir(glm::normalize(glm::vec3(0.5f, 1.0f, 0.7f)));
    app.renderer().gs_renderer().set_light_intensity(1.2f);  // moderate sun so point lights show
    app.feature_flags().gs_adaptive_budget = true;
    auto& pp = app.renderer().post_process_params();
    pp.fog_density = 0.0f;
    pp.dof_max_blur = 0.0f;
    pp.exposure = 1.0f;
    pp.bloom_threshold = 0.9f;
    pp.bloom_intensity = 0.4f;
    pp.bloom_soft_knee = 0.3f;
    pp.vignette_radius = 0.85f;
    pp.vignette_softness = 0.3f;
    app.renderer().set_gs_skip_chunk_cull(false);
    app.renderer().gs_renderer().set_skip_sort(false);

    // Load collision grid from scene data
    auto scene_data = SceneLoader::load(scene_path_);
    if (scene_data.collision) {
        collision_grid_ = *scene_data.collision;
        // Grid origin is (0,0) — scene coordinates match grid coordinates
        grid_origin_ = {0.0f, 0.0f};
    }

    // Determine player start position
    glm::vec3 player_pos = scene_data.player_position;
    // If player_position is zero, place at map center
    if (glm::length(player_pos) < 0.001f && app.renderer().has_gs_cloud()) {
        auto aabb = app.renderer().gs_chunk_grid().cloud_bounds();
        player_pos = aabb.center();
    }
    // Note: player_pos is in scene/terrain coordinates — no AABB offset needed.
    // The collision grid also uses scene coordinates.

    // Create player entity
    player_entity_ = app.world().create();
    app.world().add<ecs::Transform>(player_entity_, {player_pos, {1.0f, 1.0f}});
    app.world().add<PlayerController>(player_entity_, {kPlayerSpeed, kPlayerAccel});

    // Register island systems in scheduler
    app.system_scheduler().add_system({"proximity_trigger", proximity_trigger_system, {}, {}});
    app.system_scheduler().add_system({"linked_trigger", linked_trigger_system, {}, {}});
    app.system_scheduler().add_system({"emissive_toggle", emissive_toggle_system, {}, {}});

    // Capture base scene lights (before dynamic emissive lights are added)
    // Note: GS renderer gets lights during record_gs_prepass, not at init.
    // Scene lights come from SceneData via AppBase::load_gs_scene → set_gs_static_lights.
    // We need to read from the Renderer's static list, not GsRenderer's current list.
    // For now, start empty — the scene's directional/ambient lights are set separately.
    scene_lights_ = {};
    std::fprintf(stderr, "[IslandDemo] scene_lights_ captured: %zu lights\n", scene_lights_.size());

    // Spawn player character (procedural humanoid)
    if (app.renderer().has_gs_cloud()) {
        const auto& all = app.renderer().gs_chunk_grid().all_gaussians();
        map_gaussians_.assign(all.begin(), all.end());

        std::vector<Gaussian> merged = map_gaussians_;
        uint32_t map_count = static_cast<uint32_t>(merged.size());

        // Load mesh-converted character model
        constexpr float kCharScale = 0.5f;   // ~6.5 units tall — fills 1/4 screen at dist 8
        auto char_cloud = GaussianCloud::load_ply("assets/props/boy_character.ply");
        if (!char_cloud.empty()) {
            // Scale, rotate 180° (face away from camera), and position at spawn
            const auto& char_gs = char_cloud.gaussians();
            for (const auto& g : char_gs) {
                Gaussian cg = g;
                // Rotate 180° around Y: (x,y,z) → (-x, y, -z)
                glm::vec3 rotated(-cg.position.x, cg.position.y, -cg.position.z);
                cg.position = player_pos + rotated * kCharScale + glm::vec3(0, 0.3f, 0);
                cg.scale *= kCharScale;
                merged.push_back(cg);
            }
        }

        uint32_t char_count = static_cast<uint32_t>(merged.size()) - map_count;
        auto cloud = GaussianCloud::from_gaussians(std::move(merged));

        uint32_t gs_w = app.renderer().gs_renderer().output_width();
        uint32_t gs_h = app.renderer().gs_renderer().output_height();
        if (gs_w == 0) { gs_w = 320; gs_h = 240; }
        app.renderer().init_gs(cloud, gs_w, gs_h);

        character_spawn_pos_ = player_pos;
        character_origin_ = player_pos;
        character_spawned_ = true;

        (void)char_count;
    }

    // Initialize camera centered on player (use header defaults for elevation/distance)
    camera_target_ = player_pos + glm::vec3(0, kCameraYOffset, 0);

    // Scene loaded — ready for play
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

    // P → toggle particles/emitters
    if (app.input().was_key_pressed(GLFW_KEY_P)) {
        auto& f = app.feature_flags();
        f.particles = !f.particles;
    }

    // N → toggle terrain sway + walk animation
    if (app.input().was_key_pressed(GLFW_KEY_N)) {
        anim_enabled_ = !anim_enabled_;
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

    // Environment animation (N key toggles)
    if (anim_enabled_) {
        update_environment_animation(app, dt);
    }

    // Walk animation always runs (handles character root transform + bone poses)
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
            bool solid = collision_grid_.is_solid(static_cast<uint32_t>(gx),
                                                   static_cast<uint32_t>(gz));
            (void)debug_frame_; // reserved for future debug use
            if (solid) {
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

    // Gentle camera nudge: sample midpoint of eye-to-target ray.
    // If terrain occludes, nudge camera up just enough to clear.
    if (collision_grid_.width > 0 && !collision_grid_.elevation.empty()) {
        glm::vec3 mid = (eye + camera_target_) * 0.5f;
        float lx = mid.x - grid_origin_.x;
        float lz = mid.z - grid_origin_.y;
        int gx = static_cast<int>(lx / collision_grid_.cell_size);
        int gz = static_cast<int>(lz / collision_grid_.cell_size);
        if (gx >= 0 && gx < static_cast<int>(collision_grid_.width) &&
            gz >= 0 && gz < static_cast<int>(collision_grid_.height)) {
            float terrain_y = collision_grid_.get_elevation(
                static_cast<uint32_t>(gx), static_cast<uint32_t>(gz));
            float mid_y = mid.y;
            if (mid_y < terrain_y + 3.0f) {
                eye.y += (terrain_y + 3.0f - mid_y) * 2.0f;
            }
        }
    }

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
    {
        int count = 0;
        world.view<EmitterToggle, ProximityTrigger>().each(
            [&](ecs::Entity, EmitterToggle& et, ProximityTrigger& pt) {
                count++;
                auto& emitters = app.renderer().gs_particle_emitters();
                if (et.emitter_index >= emitters.size()) return;
                auto& emitter = emitters[et.emitter_index];
                if (pt.triggered && !et.active) {
                    et.active = true;
                    std::fprintf(stderr, "[EmitterToggle] ON emitter_index=%u\n", et.emitter_index);
                    auto cfg = emitter.config();
                    cfg.spawn_rate = 10.0f;
                    emitter.configure(cfg);
                } else if (!pt.triggered && et.active) {
                    et.active = false;
                    std::fprintf(stderr, "[EmitterToggle] OFF emitter_index=%u\n", et.emitter_index);
                    auto cfg = emitter.config();
                    cfg.spawn_rate = 0.0f;
                    emitter.configure(cfg);
                }
            });
        static bool logged = false;
        if (!logged) { std::fprintf(stderr, "[EmitterToggle] %d entities\n", count); logged = true; }
    }

    // LightToggle: toggle scene light based on proximity
    {
        int count = 0;
        world.view<LightToggle, ProximityTrigger, ecs::Transform>().each(
            [&](ecs::Entity, LightToggle& lt, ProximityTrigger& pt, ecs::Transform& t) {
                count++;
                if (pt.triggered && !lt.active) {
                    lt.active = true;
                    std::fprintf(stderr, "[LightToggle] ON at (%.1f, %.1f, %.1f) color=(%.1f,%.1f,%.1f) radius=%.1f\n",
                        t.position.x, t.position.y, t.position.z, lt.color_r, lt.color_g, lt.color_b, lt.radius);
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
                    std::fprintf(stderr, "[LightToggle] OFF at (%.1f, %.1f, %.1f)\n",
                        t.position.x, t.position.y, t.position.z);
                }
            });
        static bool logged = false;
        if (!logged) { std::fprintf(stderr, "[LightToggle] %d entities\n", count); logged = true; }
    }

    // EmissiveToggle: spawn glowing particles around triggered crystals
    {
        int count = 0;
        world.view<EmissiveToggle, ProximityTrigger, ecs::Transform>().each(
            [&](ecs::Entity, EmissiveToggle& et, ProximityTrigger& pt, ecs::Transform& t) {
                count++;
                if (pt.triggered && !et.applied) {
                    et.applied = true;
                    std::fprintf(stderr, "[EmissiveToggle] SPARKLE at (%.1f, %.1f, %.1f) color=(%.1f,%.1f,%.1f)\n",
                        t.position.x, t.position.y, t.position.z, et.color_r, et.color_g, et.color_b);
                    // Spawn glowing particles rising from the crystal
                    GsEmitterConfig cfg;
                    cfg.position = t.position + glm::vec3(0, 2.0f, 0);
                    cfg.spawn_rate = 25.0f;
                    cfg.lifetime_min = 1.5f;
                    cfg.lifetime_max = 3.0f;
                    cfg.velocity_min = {-1.5f, 2.0f, -1.5f};
                    cfg.velocity_max = { 1.5f, 5.0f,  1.5f};
                    cfg.acceleration = {0.0f, 0.5f, 0.0f};  // float upward
                    cfg.color_start = {et.color_r, et.color_g, et.color_b};
                    cfg.color_end = {et.color_r * 0.3f, et.color_g * 0.1f, et.color_b * 0.1f};
                    cfg.scale_min = {0.3f, 0.3f, 0.3f};
                    cfg.scale_max = {0.5f, 0.5f, 0.5f};
                    cfg.scale_end_factor = 0.2f;
                    cfg.opacity_start = 0.95f;
                    cfg.opacity_end = 0.0f;
                    cfg.emission = et.emission;
                    cfg.burst_duration = 0.0f;  // continuous
                    app.renderer().add_gs_particle_emitter(cfg);
                }
                if (!pt.triggered && et.applied) {
                    et.applied = false;
                    // Emitter will die naturally when particles expire
                }
            });
        static bool logged = false;
        if (!logged) { std::fprintf(stderr, "[EmissiveToggle effect] %d entities\n", count); logged = true; }
    }

    // BurstEffect: one-shot particle burst on trigger
    {
        int count = 0;
        world.view<BurstEffect, ProximityTrigger, ecs::Transform>().each(
            [&](ecs::Entity, BurstEffect& be, ProximityTrigger& pt, ecs::Transform& t) {
                count++;
                if (pt.triggered && !be.fired) {
                    be.fired = true;
                    std::fprintf(stderr, "[BurstEffect] FIRED at (%.1f, %.1f, %.1f) emitter_index=%u\n",
                        t.position.x, t.position.y, t.position.z, be.emitter_index);
                    auto& emitters = app.renderer().gs_particle_emitters();
                    if (be.emitter_index < emitters.size()) {
                        auto& emitter = emitters[be.emitter_index];
                        auto cfg = emitter.config();
                        cfg.position = t.position;
                        cfg.spawn_rate = 100.0f;
                        emitter.configure(cfg);
                    }
                }
            });
        static bool logged = false;
        if (!logged) { std::fprintf(stderr, "[BurstEffect] %d entities\n", count); logged = true; }
    }
}

// ── Walk animation ──

void IslandDemoState::update_walk_animation(AppBase& app, float dt) {
    if (!character_spawned_) return;

    float speed = glm::length(glm::vec2(player_velocity_.x, player_velocity_.z));

    // Root transform: translate from spawn to current + rotate to face away from camera
    glm::vec3 root_offset = character_origin_ - character_spawn_pos_;
    glm::mat4 root_translate = glm::translate(glm::mat4(1.0f), root_offset);
    // Rotate character around spawn point Y-axis to match camera azimuth
    // Character was spawned facing -Z (after 180° flip). Camera azimuth=0 looks from +Z.
    // To always show character's back: rotate by azimuth_ around Y at spawn pos.
    glm::vec3 spawn = character_spawn_pos_;
    glm::mat4 root_rotate =
        glm::translate(glm::mat4(1.0f), spawn) *
        glm::rotate(glm::mat4(1.0f), azimuth_, {0, 1, 0}) *
        glm::translate(glm::mat4(1.0f), -spawn);
    glm::mat4 root_xform = root_translate * root_rotate;

    walk_anim_time_ += dt;  // always increment for idle breathing

    float walk_swing = std::sin(walk_anim_time_ * 8.0f) * 0.5f;
    float walk_scale = std::min(speed / kPlayerSpeed, 1.0f);
    walk_swing *= walk_scale;

    // Idle breathing when not walking
    float breathe = std::sin(walk_anim_time_ * 1.5f) * 0.15f * (1.0f - walk_scale);

    glm::mat4 bones[7];
    // Bone 0 = all map Gaussians: gentle wave motion shows "living world"
    float terrain_sway_y = std::sin(env_anim_time_ * 1.0f) * 0.05f;
    float terrain_sway_x = std::sin(env_anim_time_ * 0.6f) * 0.02f;
    bones[0] = glm::translate(glm::mat4(1.0f),
        glm::vec3(terrain_sway_x, terrain_sway_y, 0.0f));

    // All character bones get root translation + local animation
    constexpr float kCharScale = 0.5f;

    // Torso bob = walk bob + idle breathe
    glm::mat4 bob = glm::translate(glm::mat4(1.0f),
        {0, (std::abs(walk_swing) * 0.3f + breathe) * kCharScale, 0});
    bones[1] = root_xform * bob;
    bones[2] = bones[1];  // Head follows torso

    // Pivot rotation around joint (in spawn-space, scaled), then root translate
    // Mesh boy: 8.4 units tall, rotated 180° so pivots use flipped X
    // Shoulder at ~Y=6.5, hip at ~Y=3.5 (in mesh local coords)
    const glm::vec3& sp = character_spawn_pos_;
    // Arm rotation: T-pose arms extend along ±X. Rotate around Z to bring down,
    // then around X for walk swing.
    auto arm_transform = [&](glm::vec3 pivot_local, float arm_down_sign, float swing) {
        glm::vec3 world_pivot = sp + kCharScale * pivot_local;
        auto t = glm::translate(glm::mat4(1.0f), world_pivot);
        // 1) Bring arm down from T-pose: rotate ~80° around Z axis
        auto r_down = glm::rotate(glm::mat4(1.0f), arm_down_sign * 1.4f, {0, 0, 1});
        // 2) Walk swing: rotate around X
        auto r_swing = glm::rotate(glm::mat4(1.0f), swing, {1, 0, 0});
        return root_xform * t * r_swing * r_down * glm::translate(glm::mat4(1.0f), -world_pivot);
    };

    // Leg rotation: just swing around X at hip pivot
    auto leg_transform = [&](glm::vec3 pivot_local, float swing) {
        glm::vec3 world_pivot = sp + kCharScale * pivot_local;
        auto t = glm::translate(glm::mat4(1.0f), world_pivot);
        auto r = glm::rotate(glm::mat4(1.0f), swing, {1, 0, 0});
        return root_xform * t * r * glm::translate(glm::mat4(1.0f), -world_pivot);
    };

    bones[3] = arm_transform({2.0f, 7.5f, 0.0f}, 1.0f, -walk_swing * 0.5f);    // Left arm — higher pivot
    bones[4] = arm_transform({-0.5f, 7.5f, 0.0f}, -1.0f, walk_swing * 0.5f); // Right arm — wider X
    bones[5] = leg_transform({0.5f, 3.5f, 0.0f}, -walk_swing);   // Left leg
    bones[6] = leg_transform({-0.5f, 3.5f, 0.0f}, walk_swing);    // Right leg

    app.renderer().gs_renderer().upload_bone_transforms(bones, 7);
}

// ── Environment animation (terrain sway) ──

void IslandDemoState::update_environment_animation(AppBase& /*app*/, float dt) {
    env_anim_time_ += dt;
    // Time accumulation only — the actual terrain sway is applied via bone 0
    // in update_walk_animation, creating visible "movement of the dots" across
    // the entire Gaussian Splatting scene.
}

// ── build_draw_lists (debug HUD) ──

void IslandDemoState::build_draw_lists(AppBase& app) {
    if (!show_hud_) return;

    auto& ui = app.ui_ctx();

    constexpr float panel_x = 10.0f;
    constexpr float panel_w = 260.0f;
    constexpr float panel_h = 140.0f;
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
    y -= 18.0f;

    // Toggle status
    std::string toggles = std::string("Particles[P]:") + (app.feature_flags().particles ? "ON" : "OFF") +
                           "  Anim[N]:" + (anim_enabled_ ? "ON" : "OFF");
    ui.label(toggles, lx, y, scale, {0.8f, 0.8f, 0.4f, 1.0f});
}

}  // namespace gseurat
