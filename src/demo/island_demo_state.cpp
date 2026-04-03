#include "gseurat/demo/island_demo_state.hpp"
#include "gseurat/engine/shutdown_auditor.hpp"
#include "gseurat/character/character_manifest.hpp"
#include "gseurat/character/bone_animation_player.hpp"
#include "gseurat/character/bone_animation_state_machine.hpp"
#include "gseurat/engine/app_base.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/gs_chunk_grid.hpp"
#include "gseurat/demo/island_components.hpp"
#include "gseurat/demo/island_systems.hpp"
#include "gseurat/engine/scene_loader.hpp"
#include "gseurat/engine/gs_particle.hpp"
#include "gseurat/engine/gs_animator.hpp"
#include "gseurat/engine/gs_vfx.hpp"

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
    app.renderer().gs_renderer().set_light_intensity(0.7f);  // softer sun, preserves original colors
    app.feature_flags().gs_adaptive_budget = true;
    auto& pp = app.renderer().post_process_params();
    pp.fog_density = 0.008f;       // light atmospheric fog for depth
    pp.fog_color_r = 0.55f;        // warm horizon haze
    pp.fog_color_g = 0.6f;
    pp.fog_color_b = 0.7f;
    pp.dof_max_blur = 0.0f;        // DoF disabled — blurs foreground Gaussians into larger blobs
    pp.exposure = 0.85f;           // slightly lower to prevent character washout
    pp.bloom_threshold = 0.9f;     // catch bright emissive + sun-lit edges
    pp.bloom_intensity = 0.35f;    // slightly more bloom for atmosphere
    pp.bloom_soft_knee = 0.3f;     // smoother bloom falloff
    pp.vignette_radius = 0.75f;    // tighter vignette for cinematic framing
    pp.vignette_softness = 0.4f;   // soft falloff
    pp.ca_intensity = 0.15f;       // subtle chromatic aberration at edges
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

    // Load character manifest (heap-allocated via unique_ptr)
    {
        auto loaded = gseurat::load_character_manifest(
            "assets/characters/snes_hero/snes_hero.manifest.json");
        if (loaded) {
            character_data_ = std::make_unique<gseurat::CharacterData>(std::move(*loaded));
            ShutdownAuditor::record<gseurat::CharacterData>(character_data_.get());
        }
    }

    // Spawn player character (procedural humanoid)
    if (app.renderer().has_gs_cloud()) {
        const auto& all = app.renderer().gs_chunk_grid().all_gaussians();
        map_gaussians_.assign(all.begin(), all.end());

        std::vector<Gaussian> merged = map_gaussians_;
        uint32_t map_count = static_cast<uint32_t>(merged.size());

        // Load mesh-converted character model
        constexpr float kCharScale = 0.45f;  // smaller to match prop proportions
        auto char_cloud = GaussianCloud::load_ply("assets/characters/snes_hero/snes_hero.ply");
        if (!char_cloud.empty()) {
            // Scale, rotate 180° (face away from camera), and position at spawn
            const auto& char_gs = char_cloud.gaussians();
            for (const auto& g : char_gs) {
                Gaussian cg = g;
                // Rotate 180° around Y: (x,y,z) → (-x, y, -z)
                glm::vec3 rotated(-cg.position.x, cg.position.y, -cg.position.z);
                cg.position = player_pos + rotated * kCharScale + glm::vec3(0, 0.8f, 0);
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

        // Initialize data-driven bone animation
        if (character_data_) {
            anim_player_ = std::make_unique<gseurat::BoneAnimationPlayer>(*character_data_);
            anim_sm_ = std::make_unique<gseurat::BoneAnimationStateMachine>(*anim_player_);
            anim_sm_->add_state("idle", "idle");
            anim_sm_->add_state("walk", "walk");
            anim_sm_->set_state("idle");
        }

        (void)char_count;
    }

    // Initialize camera centered on player (use header defaults for elevation/distance)
    camera_target_ = player_pos + glm::vec3(0, kCameraYOffset, 0);

    // Scene loaded — ready for play
}

void IslandDemoState::on_exit(AppBase& app) {
    ShutdownAuditor::report();

    // Release animation objects before state destruction
    anim_sm_.reset();
    anim_player_.reset();

    // Attempt guarded free of CharacterData.
    // Previously this hung in the macOS allocator (ASan clean, not heap
    // corruption). try_free logs before/after so we can identify the exact
    // point of hang if it recurs. If it still hangs, fall back to release().
    if (character_data_) {
        auto* raw = character_data_.release();
        ShutdownAuditor::try_free(raw, "CharacterData");
    }

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

    // Tab → cycle HUD mode: OFF → COMPACT → FULL → OFF
    if (app.input().was_key_pressed(GLFW_KEY_TAB)) {
        hud_mode_ = static_cast<HudMode>(
            (static_cast<int>(hud_mode_) + 1) % 3);
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

    // Set player position as LOD focus for foveated culling
    app.renderer().set_gs_lod_focus(character_origin_);

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

    // Update facing angle from movement direction
    float speed_xz = std::sqrt(player_velocity_.x * player_velocity_.x +
                                player_velocity_.z * player_velocity_.z);
    if (speed_xz > 0.5f) {
        float target_facing = std::atan2(player_velocity_.x, player_velocity_.z);
        // Smooth interpolation toward target facing
        float diff = target_facing - facing_angle_;
        // Wrap to [-pi, pi]
        while (diff > 3.14159f) diff -= 6.28318f;
        while (diff < -3.14159f) diff += 6.28318f;
        facing_angle_ += diff * std::min(1.0f, 10.0f * dt);
    }
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
                    // Spawn glowing particles rising from the crystal — sized for distance-20 camera
                    GsEmitterConfig cfg;
                    cfg.position = t.position + glm::vec3(0, 3.0f, 0);
                    cfg.spawn_rate = 40.0f;        // dense particle cloud
                    cfg.lifetime_min = 2.0f;
                    cfg.lifetime_max = 4.0f;
                    cfg.velocity_min = {-2.5f, 3.0f, -2.5f};
                    cfg.velocity_max = { 2.5f, 7.0f,  2.5f};
                    cfg.acceleration = {0.0f, 1.0f, 0.0f};  // float upward fast
                    cfg.color_start = {et.color_r, et.color_g, et.color_b};
                    cfg.color_end = {et.color_r * 0.5f, et.color_g * 0.2f, et.color_b * 0.2f};
                    cfg.scale_min = {0.6f, 0.6f, 0.6f};     // larger for visibility
                    cfg.scale_max = {1.0f, 1.0f, 1.0f};
                    cfg.scale_end_factor = 0.3f;
                    cfg.opacity_start = 0.9f;
                    cfg.opacity_end = 0.0f;
                    cfg.emission = et.emission * 1.5f;  // extra glow for bloom
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

    // AnimationTrigger: apply GS animation effect to nearby Gaussians on proximity
    {
        int count = 0;
        world.view<AnimationTrigger, ProximityTrigger, ecs::Transform>().each(
            [&](ecs::Entity, AnimationTrigger& at, ProximityTrigger& pt, ecs::Transform& t) {
                count++;
                if (pt.triggered && !at.fired) {
                    at.fired = true;
                    GsAnimRegion region;
                    region.shape = GsAnimRegion::Shape::Sphere;
                    region.center = t.position;
                    region.radius = at.anim_radius;
                    std::string effect(at.effect_name);
                    std::fprintf(stderr, "[AnimationTrigger] FIRE '%s' at (%.1f, %.1f, %.1f) radius=%.1f lifetime=%.1f\n",
                        at.effect_name, t.position.x, t.position.y, t.position.z, at.anim_radius, at.lifetime);
                    app.renderer().add_gs_animation(effect, region, at.lifetime, at.loop);
                }
                // Reset when player leaves (for looping or re-triggerable effects)
                if (!pt.triggered && at.fired && !pt.one_shot) {
                    at.fired = false;
                }
            });
        static bool logged = false;
        if (!logged) { std::fprintf(stderr, "[AnimationTrigger] %d entities\n", count); logged = true; }
    }

    // VfxTrigger: spawn a VFX instance when player approaches
    {
        world.view<VfxTrigger, ProximityTrigger, ecs::Transform>().each(
            [&](ecs::Entity, VfxTrigger& vt, ProximityTrigger& pt, ecs::Transform& t) {
                if (pt.triggered && !vt.fired) {
                    vt.fired = true;
                    std::string path(vt.vfx_path);
                    std::fprintf(stderr, "[VfxTrigger] SPAWN '%s' at (%.1f, %.1f, %.1f)\n",
                        vt.vfx_path, t.position.x, t.position.y, t.position.z);
                    try {
                        auto preset = load_vfx_preset(path);
                        VfxInstance inst;
                        inst.init(preset, t.position, true);
                        app.renderer().add_vfx_instance(std::move(inst));
                    } catch (const std::exception& e) {
                        std::fprintf(stderr, "[VfxTrigger] ERROR: %s\n", e.what());
                    }
                }
                if (!pt.triggered && vt.fired && !pt.one_shot) {
                    vt.fired = false;
                }
            });
    }

    // DiscoveryZone: celebration fireworks burst when player finds a hidden spot
    {
        world.view<DiscoveryZone, ProximityTrigger, ecs::Transform>().each(
            [&](ecs::Entity, DiscoveryZone& dz, ProximityTrigger& pt, ecs::Transform& t) {
                if (pt.triggered && !dz.discovered) {
                    dz.discovered = true;
                    std::fprintf(stderr, "[DiscoveryZone] DISCOVERED at (%.1f, %.1f, %.1f)!\n",
                        t.position.x, t.position.y, t.position.z);

                    // Celebration burst — upward shower of colored particles
                    GsEmitterConfig cfg;
                    cfg.position = t.position + glm::vec3(0, 2.0f, 0);
                    cfg.spawn_rate = 80.0f;
                    cfg.lifetime_min = 1.5f;
                    cfg.lifetime_max = 3.5f;
                    cfg.velocity_min = {-5.0f, 8.0f, -5.0f};
                    cfg.velocity_max = { 5.0f, dz.burst_height + 8.0f, 5.0f};
                    cfg.acceleration = {0.0f, -4.0f, 0.0f};  // gravity arc
                    cfg.color_start = {dz.color_r, dz.color_g, dz.color_b};
                    cfg.color_end = {dz.color_r * 0.3f, dz.color_g * 0.3f, dz.color_b * 0.8f};
                    cfg.scale_min = {0.4f, 0.4f, 0.4f};
                    cfg.scale_max = {0.8f, 0.8f, 0.8f};
                    cfg.scale_end_factor = 0.1f;
                    cfg.opacity_start = 1.0f;
                    cfg.opacity_end = 0.0f;
                    cfg.emission = 8.0f;  // bright glow for bloom
                    cfg.burst_duration = 0.8f;  // short burst, not continuous
                    app.renderer().add_gs_particle_emitter(cfg);

                    // Add a bright celebration light
                    PointLight pl{};
                    pl.position_and_radius = glm::vec4(
                        t.position.x, t.position.y + 5.0f, t.position.z, 25.0f);
                    pl.color = glm::vec4(dz.color_r * 2.0f, dz.color_g * 2.0f, dz.color_b * 2.0f, 1.0f);
                    app.scene().add_light(pl);
                }
            });
    }
}

// ── Walk animation ──

void IslandDemoState::update_walk_animation(AppBase& app, float dt) {
    if (!character_spawned_) return;

    // Root transform: translate + rotate to match camera
    glm::vec3 root_offset = character_origin_ - character_spawn_pos_;
    glm::mat4 root_translate = glm::translate(glm::mat4(1.0f), root_offset);
    glm::vec3 spawn = character_spawn_pos_;
    glm::mat4 root_rotate =
        glm::translate(glm::mat4(1.0f), spawn) *
        glm::rotate(glm::mat4(1.0f), facing_angle_, {0, 1, 0}) *
        glm::translate(glm::mat4(1.0f), -spawn);
    glm::mat4 root_xform = root_translate * root_rotate;

    // Terrain sway (bone 0 — map Gaussians)
    env_anim_time_ += dt;
    float terrain_sway_y = std::sin(env_anim_time_ * 1.0f) * 0.05f;
    float terrain_sway_x = std::sin(env_anim_time_ * 0.6f) * 0.02f;
    glm::mat4 terrain_bone = glm::translate(glm::mat4(1.0f),
        glm::vec3(terrain_sway_x, terrain_sway_y, 0.0f));

    if (anim_player_ && anim_sm_) {
        float speed = glm::length(glm::vec2(player_velocity_.x, player_velocity_.z));
        anim_sm_->set_state(speed > 0.1f ? "walk" : "idle");
        anim_player_->update(dt);

        glm::mat4 bones[32];
        bones[0] = terrain_bone;
        const auto& anim_bones = anim_player_->bone_transforms();
        int bone_count = static_cast<int>(character_data_->bones.size());
        for (int i = 0; i < bone_count && i < 31; ++i) {
            bones[i + 1] = root_xform * anim_bones[i];
        }
        app.renderer().gs_renderer().upload_bone_transforms(bones, bone_count + 1);
    } else {
        glm::mat4 bones[2];
        bones[0] = terrain_bone;
        bones[1] = root_xform;
        app.renderer().gs_renderer().upload_bone_transforms(bones, 2);
    }
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
    if (hud_mode_ == HudMode::kOff) return;

    auto& ui = app.ui_ctx();

    // Helper formatters
    auto f1 = [](float v) {
        char buf[16]; std::snprintf(buf, sizeof(buf), "%.1f", v); return std::string(buf);
    };
    auto f2 = [](float v) {
        char buf[16]; std::snprintf(buf, sizeof(buf), "%.2f", v); return std::string(buf);
    };
    auto on_off = [](bool v) -> const char* { return v ? "ON" : "OFF"; };

    // Colors
    glm::vec4 white{1.0f, 1.0f, 1.0f, 1.0f};
    glm::vec4 cyan{0.4f, 0.8f, 1.0f, 1.0f};
    glm::vec4 yellow{1.0f, 0.9f, 0.4f, 1.0f};
    glm::vec4 dim{0.6f, 0.6f, 0.6f, 1.0f};
    glm::vec4 green{0.2f, 1.0f, 0.3f, 1.0f};
    glm::vec4 red{1.0f, 0.3f, 0.2f, 1.0f};
    glm::vec4 fps_color = fps_ >= 30.0f ? green : red;

    // Shared data
    auto& gs = app.renderer().gs_renderer();
    auto& pp = app.renderer().post_process_params();
    auto& ff = app.feature_flags();
    uint32_t gs_total = gs.gaussian_count();
    uint32_t gs_visible = gs.visible_count();
    size_t emitter_count = app.renderer().gs_particle_emitters().size();

    // Count triggered proximity triggers
    int triggered_count = 0;
    int total_triggers = 0;
    app.world().view<ProximityTrigger>().each(
        [&](ecs::Entity, ProximityTrigger& pt) {
            total_triggers++;
            if (pt.triggered) triggered_count++;
        });

    // Count discovered secrets
    int secrets_found = 0;
    int secrets_total = 0;
    app.world().view<DiscoveryZone>().each(
        [&](ecs::Entity, DiscoveryZone& dz) {
            secrets_total++;
            if (dz.discovered) secrets_found++;
        });

    if (hud_mode_ == HudMode::kCompact) {
        // ── COMPACT: single-line status bar at top ──
        constexpr float bar_x = 0.0f;
        constexpr float bar_w = 1280.0f;
        constexpr float bar_h = 24.0f;
        constexpr float bar_y = 720.0f;
        ui.panel(bar_w * 0.5f, bar_y - bar_h * 0.5f, bar_w, bar_h,
                 {0.0f, 0.0f, 0.0f, 0.5f});

        float x = 10.0f;
        float y = bar_y - bar_h * 0.5f - 2.0f;  // vertically center text in bar
        constexpr float s = 0.38f;

        ui.label(f1(fps_) + " FPS", x, y, s, fps_color);
        x += 75.0f;

        ui.label("GS:" + std::to_string(gs_visible) + "/" + std::to_string(gs_total), x, y, s, white);
        x += 130.0f;

        ui.label("Emitters:" + std::to_string(emitter_count), x, y, s, white);
        x += 100.0f;

        // Triggered objects indicator
        glm::vec4 trig_color = triggered_count > 0 ? green : dim;
        ui.label("Trig:" + std::to_string(triggered_count) + "/" + std::to_string(total_triggers),
                 x, y, s, trig_color);
        x += 80.0f;

        // Secrets counter (gold when all found!)
        if (secrets_total > 0) {
            glm::vec4 sec_color = (secrets_found == secrets_total) ? yellow : dim;
            ui.label("Secrets:" + std::to_string(secrets_found) + "/" + std::to_string(secrets_total),
                     x, y, s, sec_color);
            x += 90.0f;
        }

        auto* t = app.world().try_get<ecs::Transform>(player_entity_);
        if (t) {
            ui.label("(" + f1(t->position.x) + "," + f1(t->position.y) + "," + f1(t->position.z) + ")",
                     x, y, s, dim);
        }

        // Mode hint at far right
        ui.label("[Tab]", bar_w - 50.0f, y, s, dim);
        return;
    }

    // ── FULL: comprehensive engine values (compact panel) ──
    constexpr float panel_x = 6.0f;
    constexpr float panel_w = 250.0f;
    constexpr float panel_h = 420.0f;
    constexpr float panel_top = 720.0f - 36.0f;  // below macOS title bar
    constexpr float panel_cy = panel_top - panel_h * 0.5f;
    ui.panel(panel_x + panel_w * 0.5f, panel_cy, panel_w, panel_h,
             {0.0f, 0.0f, 0.0f, 0.65f});

    float y = panel_top - 16.0f;
    constexpr float lx = panel_x + 8.0f;
    constexpr float vx = panel_x + 125.0f;  // value column
    constexpr float s = 0.35f;
    constexpr float line = 13.0f;
    constexpr float section_gap = 4.0f;

    // Title + FPS
    ui.label("ISLAND DEMO", lx, y, 0.45f, cyan);
    ui.label(f1(fps_) + " FPS", panel_x + panel_w - 65.0f, y, s, fps_color);
    y -= line + section_gap;

    // ── Camera ──
    ui.label("CAMERA", lx, y, s, yellow);
    y -= line;
    auto* transform = app.world().try_get<ecs::Transform>(player_entity_);
    if (transform) {
        ui.label("Position", lx, y, s, dim);
        ui.label(f1(transform->position.x) + ", " + f1(transform->position.y) +
                 ", " + f1(transform->position.z), vx, y, s, white);
        y -= line;
    }
    ui.label("Azimuth", lx, y, s, dim);
    ui.label(f1(glm::degrees(azimuth_)) + "deg", vx, y, s, white);
    y -= line;
    ui.label("Elevation", lx, y, s, dim);
    ui.label(f1(glm::degrees(elevation_)) + "deg", vx, y, s, white);
    y -= line;
    ui.label("Distance", lx, y, s, dim);
    ui.label(f2(distance_), vx, y, s, white);
    y -= line + section_gap;

    // ── Gaussian Splatting ──
    ui.label("GAUSSIANS", lx, y, s, yellow);
    y -= line;
    ui.label("Visible / Total", lx, y, s, dim);
    ui.label(std::to_string(gs_visible) + " / " + std::to_string(gs_total), vx, y, s, white);
    y -= line;
    ui.label("Budget (max)", lx, y, s, dim);
    ui.label(std::to_string(gs.max_gaussian_count()), vx, y, s, white);
    y -= line;
    ui.label("Scale Multiplier", lx, y, s, dim);
    ui.label(f2(gs.scale_multiplier()), vx, y, s, white);
    y -= line;
    ui.label("Emitters", lx, y, s, dim);
    ui.label(std::to_string(emitter_count), vx, y, s, white);
    y -= line + section_gap;

    // ── Lighting ──
    ui.label("LIGHTING", lx, y, s, yellow);
    y -= line;
    const char* light_modes[] = {"Off", "Directional", "Point+Dir"};
    int lm = gs.light_mode();
    ui.label("Mode", lx, y, s, dim);
    ui.label(lm >= 0 && lm <= 2 ? light_modes[lm] : "?", vx, y, s, white);
    y -= line;
    ui.label("Intensity", lx, y, s, dim);
    ui.label(f2(gs.light_intensity()), vx, y, s, white);
    y -= line;
    ui.label("Toon Bands", lx, y, s, dim);
    ui.label(gs.toon_bands() > 0 ? std::to_string(gs.toon_bands()) : "Off", vx, y, s, white);
    y -= line + section_gap;

    // ── Post-Process ──
    ui.label("POST-PROCESS", lx, y, s, yellow);
    y -= line;
    ui.label("Exposure", lx, y, s, dim);
    ui.label(f2(pp.exposure), vx, y, s, white);
    y -= line;
    ui.label("Bloom", lx, y, s, dim);
    ui.label(f2(pp.bloom_intensity) + " thr:" + f2(pp.bloom_threshold), vx, y, s,
             ff.bloom ? white : red);
    y -= line;
    ui.label("Vignette", lx, y, s, dim);
    ui.label("r:" + f2(pp.vignette_radius) + " s:" + f2(pp.vignette_softness), vx, y, s,
             ff.vignette ? white : red);
    y -= line;
    ui.label("DoF", lx, y, s, dim);
    ui.label(pp.dof_max_blur > 0.01f
             ? "f:" + f1(pp.dof_focus_distance) + " r:" + f1(pp.dof_focus_range) + " b:" + f2(pp.dof_max_blur)
             : "Off", vx, y, s, white);
    y -= line;
    ui.label("Fog", lx, y, s, dim);
    ui.label(pp.fog_density > 0.001f ? f2(pp.fog_density) : "Off", vx, y, s, white);
    y -= line;
    ui.label("Chromatic Aberr.", lx, y, s, dim);
    ui.label(pp.ca_intensity > 0.001f ? f2(pp.ca_intensity) : "Off", vx, y, s, white);
    y -= line + section_gap;

    // ── Features ──
    ui.label("FEATURES", lx, y, s, yellow);
    y -= line;
    ui.label("Particles [P]", lx, y, s, dim);
    ui.label(on_off(ff.particles), vx, y, s, ff.particles ? green : red);
    y -= line;
    ui.label("Animation [N]", lx, y, s, dim);
    ui.label(on_off(anim_enabled_), vx, y, s, anim_enabled_ ? green : red);
    y -= line;
    ui.label("LOD", lx, y, s, dim);
    ui.label(on_off(ff.gs_lod), vx, y, s, ff.gs_lod ? green : red);
    y -= line;
    ui.label("Adaptive Budget", lx, y, s, dim);
    ui.label(on_off(ff.gs_adaptive_budget), vx, y, s, ff.gs_adaptive_budget ? green : red);
    y -= line;
    ui.label("Chunk Culling", lx, y, s, dim);
    ui.label(on_off(ff.gs_chunk_culling), vx, y, s, ff.gs_chunk_culling ? green : red);
    y -= line;
    glm::vec4 trig_col = triggered_count > 0 ? green : dim;
    ui.label("Triggers", lx, y, s, dim);
    ui.label(std::to_string(triggered_count) + "/" + std::to_string(total_triggers), vx, y, s, trig_col);
}

}  // namespace gseurat
