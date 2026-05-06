#include "gseurat/engine/gs_scene_loader.hpp"
#include "gseurat/engine/scene_load_context.hpp"
#include "gseurat/engine/gs_terrain_state.hpp"
#include "gseurat/engine/scene_object_state.hpp"
#include "gseurat/engine/coordinate.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/gs_vfx.hpp"
#include "gseurat/engine/pbd_types.hpp"
#include "gseurat/engine/renderer.hpp"
#include "gseurat/engine/resource_manager.hpp"
#include "gseurat/engine/scene.hpp"
#include "gseurat/engine/feature_flags.hpp"
#include "gseurat/engine/ecs/ecs.hpp"
#include "gseurat/engine/ecs/default_components.hpp"
#include "gseurat/engine/component_registry.hpp"
#include "gseurat/engine/trigger_components.hpp"
#include "gseurat/engine/ecs/components/player_controller.hpp"
#include "gseurat/engine/project_root.hpp"

#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/quaternion.hpp>

#include <algorithm>
#include <cstdio>
#include <fstream>

namespace gseurat {

// CPU-only parse phase. Touches no Vulkan / ECS / GPU resources, so it can be
// invoked from a worker thread. Returns a `ParsedScene` that the main thread
// then consumes via `finalize_on_main`.
ParsedScene GsSceneLoader::parse(const SceneData& scene_data) {
    ParsedScene parsed;

    // Load terrain PLY if present
    if (scene_data.gaussian_splat) {
        const auto& gs = *scene_data.gaussian_splat;
        std::fprintf(stderr, "[GS] (parse) Terrain PLY: '%s' (project_root='%s')\n",
                     gs.ply_file.c_str(), get_project_root().c_str());
        try {
            parsed.cloud = GaussianCloud::load_ply(gs.ply_file);
            parsed.has_terrain = !parsed.cloud.empty();
        } catch (const std::runtime_error& e) {
            std::fprintf(stderr, "[GS] Warning: %s\n", e.what());
        }
        parsed.gs_scale_multiplier = gs.scale_multiplier;
    }

    // Compute terrain AABB (grid-to-world coordinate mapping)
    parsed.terrain_aabb.min = glm::vec3(0.0f);
    parsed.terrain_aabb.max = glm::vec3(0.0f);
    if (parsed.has_terrain) {
        parsed.terrain_aabb = parsed.cloud.bounds();
    }

    parsed.snapped_objects = scene_data.game_objects;
    parsed.world_positions.reserve(parsed.snapped_objects.size());
    for (const auto& go : parsed.snapped_objects) {
        parsed.world_positions.push_back(coord::to_world(go.position, parsed.terrain_aabb));
    }

    // Pre-scan: allocate bone slots for BoneAnimated game objects.
    parsed.bone_slot_counter = 8;  // reserve 0-7 for player
    for (size_t i = 0; i < parsed.snapped_objects.size(); ++i) {
        const auto& go = parsed.snapped_objects[i];
        if (go.components.is_null() || !go.components.contains("BoneAnimated")) continue;
        const auto& ba_json = go.components["BoneAnimated"];
        std::string manifest_path = ba_json.value("manifest", std::string{});
        if (manifest_path.empty()) continue;

        uint32_t bone_count = 0;
        {
            std::ifstream mf(manifest_path);
            if (!mf.is_open()) {
                std::fprintf(stderr, "[GS] BoneAnimated: failed to open manifest '%s'\n",
                             manifest_path.c_str());
                continue;
            }
            auto mj = nlohmann::json::parse(mf, nullptr, false);
            if (mj.is_discarded() || !mj.contains("bones") || !mj["bones"].is_array()) {
                std::fprintf(stderr, "[GS] BoneAnimated: invalid manifest '%s'\n",
                             manifest_path.c_str());
                continue;
            }
            bone_count = static_cast<uint32_t>(mj["bones"].size());
        }
        if (parsed.bone_slot_counter + bone_count > 32) {
            std::fprintf(stderr, "[GS] BoneAnimated: bone budget exceeded for '%s' (need %u, have %u)\n",
                         go.id.c_str(), bone_count, 32 - parsed.bone_slot_counter);
            continue;
        }

        GsTerrainState::BoneAllocation alloc;
        alloc.manifest_path = manifest_path;
        alloc.default_clip = ba_json.value("default_clip", std::string{"idle"});
        alloc.first_bone_index = parsed.bone_slot_counter;
        alloc.bone_count = bone_count;
        alloc.char_scale = go.scale;
        alloc.gs_scale_multiplier = parsed.gs_scale_multiplier;
        alloc.world_pos = parsed.world_positions[i].vec();
        alloc.game_object_index = i;
        parsed.bone_allocations.push_back(alloc);
        parsed.bone_slot_counter += bone_count;

        std::fprintf(stderr, "[GS] BoneAnimated '%s': bones %u-%u (count=%u)\n",
                     go.id.c_str(), alloc.first_bone_index,
                     alloc.first_bone_index + bone_count - 1, bone_count);
    }

    // Merge all game objects with PLY visuals into the parsed cloud.
    {
        auto merged = parsed.cloud.gaussians();
        uint32_t merged_count = 0;
        for (size_t i = 0; i < parsed.snapped_objects.size(); ++i) {
            const auto& go = parsed.snapped_objects[i];
            if (go.ply_file.empty()) continue;
            try {
                auto placed_cloud = GaussianCloud::load_ply(go.ply_file);
                if (placed_cloud.empty()) continue;
                glm::vec3 local_min(1e9f);
                glm::vec3 local_max(-1e9f);
                for (const auto& g : placed_cloud.gaussians()) {
                    local_min = glm::min(local_min, g.position);
                    local_max = glm::max(local_max, g.position);
                }
                glm::vec3 local_center = (local_min + local_max) * 0.5f;
                local_center.y = local_min.y;
                float local_min_y = local_min.y;
                float local_max_y = local_max.y;
                glm::vec3 adjusted_pos = parsed.world_positions[i].vec();
                auto transform = glm::translate(glm::mat4(1.0f), adjusted_pos);
                transform = glm::rotate(transform, glm::radians(go.rotation.x), {1,0,0});
                transform = glm::rotate(transform, glm::radians(go.rotation.y), {0,1,0});
                transform = glm::rotate(transform, glm::radians(go.rotation.z), {0,0,1});
                transform = glm::scale(transform, glm::vec3(go.scale));
                transform = glm::translate(transform, -local_center);
                auto rot_q = glm::quat(glm::radians(go.rotation));

                uint32_t pbd_idx = 0;
                float sway_threshold_frac = 0.7f;
                if (go.pbd && parsed.pbd_anchors.size() < kMaxPbdElements) {
                    pbd_idx = 32 + static_cast<uint32_t>(parsed.pbd_anchors.size());
                    parsed.pbd_anchors.push_back(adjusted_pos);
                    parsed.pbd_configs.push_back(*go.pbd);
                    sway_threshold_frac = go.pbd->sway_threshold;
                }
                float sway_threshold = local_min_y + (local_max_y - local_min_y) * sway_threshold_frac;

                uint32_t ba_first_bone = 0;
                bool has_bone_anim = false;
                for (const auto& alloc : parsed.bone_allocations) {
                    if (alloc.game_object_index == i) {
                        ba_first_bone = alloc.first_bone_index;
                        has_bone_anim = true;
                        break;
                    }
                }

                auto placed_gs = placed_cloud.gaussians();
                uint32_t tagged_count = 0;
                for (auto& g : placed_gs) {
                    float local_y = g.position.y;
                    g.position = glm::vec3(transform * glm::vec4(g.position, 1.0f));
                    g.scale *= go.scale;
                    g.rotation = rot_q * g.rotation;
                    if (pbd_idx > 0 && local_y > sway_threshold) {
                        g.bone_index = pbd_idx;
                        tagged_count++;
                    }
                    if (has_bone_anim) {
                        g.bone_index = ba_first_bone + g.bone_index;
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
            parsed.cloud = GaussianCloud::from_gaussians(std::move(merged));
        }
        if (!parsed.pbd_anchors.empty()) {
            std::fprintf(stderr, "[GS] PBD: %zu objects configured (idx 32-%u)\n",
                         parsed.pbd_anchors.size(),
                         31 + static_cast<uint32_t>(parsed.pbd_anchors.size()));
        }
    }

    // Cloud bounds for camera centering.
    if (!parsed.cloud.empty()) {
        auto bounds = parsed.cloud.bounds();
        parsed.cloud_center = (bounds.min + bounds.max) * 0.5f;
        parsed.cloud_extent = glm::length(bounds.max - bounds.min) * 0.5f;
    }

    return parsed;
}

void GsSceneLoader::finalize_on_main(SceneLoadContext& ctx, const SceneData& scene_data,
                                     ParsedScene&& parsed, const GsSceneOptions& opts) {

    ctx.renderer.clear_gs_particle_emitters();
    ctx.renderer.clear_gs_animations();
    ctx.renderer.clear_vfx_instances();

    ctx.scene.clear_lights();
    ctx.scene.set_ambient_color(scene_data.ambient_color);
    for (const auto& pl : scene_data.static_lights) {
        ctx.scene.add_light(pl);
    }

    ctx.scene.set_fog_density(scene_data.weather.fog_density);
    ctx.scene.set_fog_color(scene_data.weather.fog_color);

    if (parsed.has_terrain) {
        ctx.renderer.gs_renderer().set_scale_multiplier(parsed.gs_scale_multiplier);
    }

    ctx.terrain.terrain_aabb = parsed.terrain_aabb;
    ctx.scene_objects.game_objects = parsed.snapped_objects;
    ctx.terrain.bone_allocations = parsed.bone_allocations;
    ctx.terrain.bone_slot_counter = parsed.bone_slot_counter;
    ctx.terrain.pbd_anchors = parsed.pbd_anchors;
    ctx.terrain.pbd_configs = parsed.pbd_configs;

    GaussianCloud cloud = std::move(parsed.cloud);
    const bool has_terrain = parsed.has_terrain;
    const auto& world_positions = parsed.world_positions;
    const auto& snapped_objects = ctx.scene_objects.game_objects;

    {
            // Create ECS entities for game objects with components
            for (size_t i = 0; i < snapped_objects.size(); ++i) {
                const auto& go = snapped_objects[i];
                if (go.components.empty() || go.components.is_null()) continue;
                auto entity = ctx.world.create();
                ctx.world.add<ecs::Transform>(entity, {world_positions[i], {go.scale, go.scale}});
                for (auto& [name, data] : go.components.items()) {
                    ctx.components.attach(ctx.world, entity, name, data);
                }
            }

            // Auto-attach PlayerTag to entities with PlayerController
            ctx.world.view<PlayerController, ecs::Transform>().each(
                [&](ecs::Entity e, PlayerController&, ecs::Transform&) {
                    if (!ctx.world.has<PlayerTag>(e)) {
                        ctx.world.add<PlayerTag>(e);
                    }
                });

        // Init GS renderer if we have any Gaussians (terrain and/or game objects)
        if (!cloud.empty()) {
            // Render resolution -- use terrain config if available, else defaults
            uint32_t gs_w = 320, gs_h = 240;
            if (scene_data.gaussian_splat) {
                gs_w = scene_data.gaussian_splat->render_width;
                gs_h = scene_data.gaussian_splat->render_height;
            }
            if (cloud.count() > 100000 && gs_w >= 320) { gs_w = 160; gs_h = 120; }
            else if (cloud.count() > 50000 && gs_w >= 320) { gs_w = 240; gs_h = 180; }

            ctx.renderer.init_gs(cloud, gs_w, gs_h);

            // Upload PBD elements AFTER init_gs (init_streaming resets pbd_count_)
            if (!ctx.terrain.pbd_anchors.empty() && ctx.terrain.pbd_anchors.size() == ctx.terrain.pbd_configs.size()) {
                uint32_t count = static_cast<uint32_t>(ctx.terrain.pbd_anchors.size());
                std::vector<PbdPhysicsState> states(count);
                std::vector<PbdElementParams> params(count);
                for (uint32_t i = 0; i < count; ++i) {
                    const auto& cfg = ctx.terrain.pbd_configs[i];
                    float inv_mass = (cfg.mode == "physics" && cfg.pinned) ? 0.0f : 1.0f;
                    states[i].position = glm::vec4(ctx.terrain.pbd_anchors[i], inv_mass);
                    states[i].prev_position = glm::vec4(0.0f, 0.0f, 0.0f, 1.0f);
                    states[i].velocity = glm::vec4(0.0f);
                    states[i].params = glm::vec4(cfg.sway_threshold, 0.0f, 0.0f, 0.0f);
                    params[i].gravity = glm::vec4(cfg.gravity, cfg.damping);
                    params[i].wind = glm::vec4(cfg.wind_direction, cfg.wind_strength);
                    params[i].dynamics = glm::vec4(cfg.wind_frequency, cfg.ground_y, cfg.bounce, 0.0f);
                }
                ctx.renderer.gs_renderer().upload_pbd_elements(states.data(), params.data(), count);
                std::fprintf(stderr, "[GS] PBD upload: %u elements, wind=(%.2f,%.2f,%.2f) str=%.2f freq=%.2f\n",
                             count, params[0].wind.x, params[0].wind.y, params[0].wind.z,
                             params[0].wind.w, params[0].dynamics.x);
            }

            // Store cloud bounds for camera centering
            auto cloud_aabb = cloud.bounds();
            ctx.terrain.cloud_center = (cloud_aabb.min + cloud_aabb.max) * 0.5f;
            ctx.terrain.cloud_extent = glm::length(cloud_aabb.max - cloud_aabb.min) * 0.5f;

            // Camera -- use terrain config if available, else fit to cloud bounds
            if (scene_data.gaussian_splat) {
                const auto& gs = *scene_data.gaussian_splat;
                float aspect = static_cast<float>(gs_w) / static_cast<float>(gs_h);
                auto gs_view = glm::lookAt(gs.camera_position, gs.camera_target, glm::vec3(0, 1, 0));
                auto gs_proj = glm::perspective(glm::radians(gs.camera_fov), aspect, 0.1f, 1000.0f);
                gs_proj[1][1] *= -1.0f;
                ctx.renderer.set_gs_camera(gs_view, gs_proj);
                ctx.renderer.set_gs_background_colors(gs.ground_color, gs.sky_color);
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
                ctx.renderer.set_gs_camera(gs_view, gs_proj);
            }

            // Transform lights Grid→World via coord::to_world()
            std::vector<PointLight> gs_lights;
            for (const auto& pl : scene_data.static_lights) {
                PointLight t = pl;
                // Internal layout after parse: {json_x, json_z, json_y, radius}
                // Reconstruct original JSON [x, y, z] order for conversion:
                glm::vec3 grid_pos(t.position_and_radius.x,   // json_x
                                   t.position_and_radius.z,   // json_y (height)
                                   t.position_and_radius.y);  // json_z
                auto world = coord::to_world(coord::GridPos(grid_pos), ctx.terrain.terrain_aabb);
                // Re-swizzle back to internal layout: {world_x, world_z, world_y, radius}
                t.position_and_radius.x = world.vec().x;
                t.position_and_radius.y = world.vec().z;  // internal slot 1 = world Z
                t.position_and_radius.z = world.vec().y;  // internal slot 2 = world Y (height)
                gs_lights.push_back(t);
            }

            if (opts.add_default_light && gs_lights.empty()) {
                PointLight test_light;
                auto center = ctx.terrain.terrain_aabb.center();
                float r = std::max({ctx.terrain.terrain_aabb.max.x - ctx.terrain.terrain_aabb.min.x,
                                    ctx.terrain.terrain_aabb.max.y - ctx.terrain.terrain_aabb.min.y,
                                    ctx.terrain.terrain_aabb.max.z - ctx.terrain.terrain_aabb.min.z}) * 0.5f;
                test_light.position_and_radius = glm::vec4(center.x, center.z, center.y, r);
                test_light.color = glm::vec4(0.2f, 1.0f, 0.3f, 5.0f);
                gs_lights.push_back(test_light);
            }

            if (!gs_lights.empty()) {
                ctx.renderer.gs_renderer().set_light_mode(2);
                ctx.renderer.gs_renderer().set_point_lights(gs_lights);
                ctx.renderer.set_gs_static_lights(gs_lights);
                if (opts.set_god_rays) ctx.renderer.set_god_rays_intensity(1.0f);
            }

            // Emitters (grid->world)
            for (const auto& em : scene_data.gs_particle_emitters) {
                auto config = em.config;
                auto world_pos = coord::to_world(coord::GridPos(config.position), ctx.terrain.terrain_aabb);
                config.position = world_pos.vec();
                ctx.renderer.add_gs_particle_emitter(config);
            }

            // Animations (grid->world)
            for (const auto& anim : scene_data.gs_animations) {
                auto region = anim.region;
                auto world_center = coord::to_world(coord::GridPos(region.center), ctx.terrain.terrain_aabb);
                region.center = world_center.vec();
                std::optional<Renderer::ReformConfig> reform;
                if (anim.reform) reform = Renderer::ReformConfig{anim.reform->lifetime};
                ctx.renderer.add_gs_animation(anim.effect, region, anim.lifetime, anim.loop, anim.params, reform);
            }

            // Terrain-specific features (background, parallax)
            if (scene_data.gaussian_splat) {
                const auto& gs = *scene_data.gaussian_splat;
                if (!gs.background_image.empty()) {
                    auto bg_tex = ctx.resources.load_texture(gs.background_image);
                    ctx.renderer.set_gs_background(bg_tex);
                }
                if (ctx.feature_flags.gs_parallax && gs.parallax) {
                    ctx.terrain.parallax_camera.configure(
                        gs.camera_position, gs.camera_target,
                        gs.camera_fov, gs_w, gs_h, *gs.parallax);
                    ctx.terrain.parallax_active = true;
                    ctx.terrain.frame_counter = 0;
                    ctx.renderer.gs_renderer().set_skip_sort(false);
                    auto cam_fwd = glm::normalize(gs.camera_target - gs.camera_position);
                    ctx.renderer.gs_renderer().set_shadow_box_params(cam_fwd, 0.0f, gs.camera_position, 32.0f);
                } else {
                    ctx.terrain.parallax_active = false;
                    ctx.renderer.gs_renderer().clear_shadow_box_params();
                }
                std::fprintf(stderr, "[GS] Loaded %u Gaussians (terrain: %s, game objects: %zu)\n",
                             cloud.count(), has_terrain ? gs.ply_file.c_str() : "none",
                             scene_data.game_objects.size());
            } else {
                ctx.terrain.parallax_active = false;
                ctx.renderer.gs_renderer().clear_shadow_box_params();
                std::fprintf(stderr, "[GS] Loaded %u Gaussians from %zu game objects\n",
                             cloud.count(), scene_data.game_objects.size());
            }
        }
    }

    // VFX instances (load even without gaussian_splat). The "do we already
    // have a GS context?" check uses the local `cloud` (the merged
    // terrain + game-object cloud the block above worked with) rather
    // than `renderer.has_gs_cloud()`, which now returns false during
    // async upload drain — the cloud is committed but `gaussian_count_`
    // only flips to non-zero after the final completion callback fires.
    if (!scene_data.vfx_instances.empty()) {
        if (cloud.empty()) {
            // Minimal GS renderer for VFX-only scenes
            std::vector<Gaussian> dummy(1);
            dummy[0].opacity = 0.0f;
            dummy[0].scale = glm::vec3(0.001f);
            auto vfx_cloud = GaussianCloud::from_gaussians(std::move(dummy));
            ctx.renderer.init_gs(vfx_cloud, 320, 240);
            auto view = glm::lookAt(glm::vec3(0, 50, 100), glm::vec3(0), glm::vec3(0, 1, 0));
            auto proj = glm::perspective(glm::radians(45.0f), 320.0f / 240.0f, 0.1f, 1000.0f);
            proj[1][1] *= -1.0f;
            ctx.renderer.set_gs_camera(view, proj);
        }
        for (const auto& vi : scene_data.vfx_instances) {
            if (vi.trigger != "auto") continue;
            auto preset = load_vfx_preset(vi.vfx_file);
            if (preset.elements.empty()) continue;
            // Override preset spline control points with per-instance points
            if (!vi.spline_points.empty()) {
                for (auto& el : preset.elements) {
                    if (el.emitter_config.spline &&
                        el.emitter_config.spline->mode != SplineMode::None) {
                        el.emitter_config.spline->path.control_points = vi.spline_points;
                    }
                }
            }
            VfxInstance inst;
            auto world_pos = coord::to_world(vi.position, ctx.terrain.terrain_aabb);
            inst.init(preset, world_pos.vec(), vi.loop, vi.rotation_y);
            ctx.renderer.add_vfx_instance(std::move(inst));
        }
    }
}

// Synchronous wrapper: parse on the calling thread (blocks until PLY load
// completes) and immediately finalize on the same thread. Used by callers
// that don't need the async / loading-overlay path.
void GsSceneLoader::load(SceneLoadContext& ctx, const SceneData& scene_data,
                          const GsSceneOptions& opts) {
    ParsedScene parsed = parse(scene_data);
    finalize_on_main(ctx, scene_data, std::move(parsed), opts);
}

}  // namespace gseurat
