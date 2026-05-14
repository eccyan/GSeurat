#include "gseurat/demo/island_demo_state.hpp"
#include "gseurat/demo/demo_app.hpp"
#include "gseurat/engine/ecs/components/portal_target.hpp"
#include "gseurat/engine/ecs/components/scene_transition.hpp"
#include "gseurat/engine/ecs/components/screen_fade.hpp"
#include "gseurat/engine/shutdown_auditor.hpp"
#include "gseurat/character/character_manifest.hpp"
#include "gseurat/character/bone_animation_player.hpp"
#include "gseurat/character/bone_animation_state_machine.hpp"
#include "gseurat/engine/app_base.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/gs_scene_loader.hpp"
#include "gseurat/engine/scoped_timer.hpp"
#include "gseurat/demo/island_components.hpp"
#include "gseurat/engine/trigger_components.hpp"
#include "gseurat/engine/collision/intersect.hpp"
#include "gseurat/engine/scene_loader.hpp"
#include "gseurat/engine/world_manifest.hpp"
#include "gseurat/engine/project_root.hpp"
#include <nlohmann/json.hpp>
#include "gseurat/engine/gs_particle.hpp"
#include "gseurat/engine/gs_animator.hpp"
#include "gseurat/engine/gs_vfx.hpp"
#include "gseurat/engine/pbd_events.hpp"
#include "gseurat/engine/pbd_types.hpp"
#include "gseurat/engine/bone_animation_registry.hpp"
#include "gseurat/engine/bone_animation_system.hpp"
#include "gseurat/engine/debug_draw.hpp"
#include "gseurat/engine/debug_dump_collision.hpp"
#ifdef GSEURAT_DEV_MODE
#include <imgui.h>
#endif
#include "gseurat/engine/bone_animated_component.hpp"

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/quaternion.hpp>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <string>
#include <unordered_map>

namespace {
// Deterministic offset from index — no frame-to-frame jitter
glm::vec3 det_offset(uint32_t seed, float radius) {
    auto h = [](uint32_t n) -> float {
        n = (n << 13u) ^ n;
        n = n * (n * n * 15731u + 789221u) + 1376312589u;
        return static_cast<float>(n & 0x7fffffffu) / static_cast<float>(0x7fffffff) * 2.0f - 1.0f;
    };
    return glm::vec3(h(seed), h(seed * 7u + 3u), h(seed * 13u + 17u)) * radius;
}
}  // namespace

namespace gseurat {

// ── on_enter ──

void IslandDemoState::on_enter(AppBase& app) {
    if (scene_path_.empty()) scene_path_ = resolve_asset_path("assets/scenes/seurat_island.json").string();
    app.feature_flags() = FeatureFlags::gs_viewer();
    app.feature_flags().apply_platform_defaults(app.renderer().context().is_apple_gpu());

    // Load scene JSON sync (cheap) and set the active scene path. The heavy
    // PLY parse happens in `GsSceneLoader::parse`, kicked on a worker thread
    // immediately so it overlaps the rest of on_enter's main-thread setup
    // work below (audio/camera zones, world manifest, collision grid,
    // character manifest). `parse_future` is consumed just before the §A
    // merge needs the cloud, so the worker has the maximum window to run.
    //
    // The GPU sequencing (init_gs → manual merge → 2nd init_gs) is preserved
    // exactly as in the synchronous `init_scene` path — only the *parse*
    // (PLY I/O) is moved to a worker. `std::launch::async` forces a real
    // worker thread; deferred would silently downgrade to lazy execution
    // and re-introduce the main-thread stall at `future.get()`.
    auto scene_data = SceneLoader::load(scene_path_);
    app.scene_objects().current_scene_path = scene_path_;
    auto parse_future = std::async(std::launch::async, [&scene_data] {
        return GsSceneLoader::parse(scene_data);
    });

    // Collect audio zones from all scenes (populated below during scene loading)
    std::vector<SceneData::AudioZoneRef> scene_audio_zones;

    // Disable app-level parallax — we manage our own camera
    app.gs_terrain().parallax_active = false;

    // Enable rendering features for the demo
    app.feature_flags().bloom = true;
    app.feature_flags().fog = false;
    app.feature_flags().depth_of_field = false;
    app.feature_flags().tone_mapping = true;
    app.feature_flags().vignette = true;
    app.feature_flags().particles = true;
    app.feature_flags().point_lights = true;
    app.feature_flags().gs_lod = true;
    app.feature_flags().animation = true;  // GS animation effects (orbit, wave, etc.)
    app.feature_flags().music = true;
    app.feature_flags().sfx = true;

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
    app.renderer().set_gs_max_render_distance(150.0f);  // cull distant chunks (uses player pos, not camera)
    app.renderer().gs_renderer().set_skip_sort(false);

    // Load world manifest if world.json exists at project root
    {
        auto world_path = resolve_asset_path("world.json");
        if (std::filesystem::exists(world_path)) {
            std::ifstream wf(world_path);
            auto wj = nlohmann::json::parse(wf);
            auto manifest = WorldManifest::from_json(wj);
            app.renderer().gs_renderer().load_world(manifest);
            app.scene_objects().world_manifest = manifest;
            std::fprintf(stderr, "[IslandDemo] Loaded world.json: %zu chunks, %zu streaming volumes\n",
                manifest.chunks.size(), manifest.streaming_volumes.size());

            // Initialize WorldStreamer
            world_streamer_ = std::make_unique<WorldStreamer>();
            world_streamer_->init(manifest);

            // Mark ALL chunks as loaded — we merge them in on_enter below.
            // This prevents load_cloud_async from replacing the merged cloud.
            // Mark them externally-managed too so the streamer's distance
            // check doesn't try to emit load/unload transitions for content
            // we can't actually manage as separate chunks (#399).
            for (const auto& chunk : manifest.chunks) {
                std::string key = std::to_string(chunk.grid.x) + "," +
                                  std::to_string(chunk.grid.y) + "," +
                                  std::to_string(chunk.grid.z);
                world_streamer_->on_chunk_loaded(key, 0);
                world_streamer_->mark_chunk_externally_managed(key);
            }

            std::fprintf(stderr, "[IslandDemo] WorldStreamer initialized: load_radius=%.0f unload_radius=%.0f\n",
                world_streamer_->load_radius(), world_streamer_->unload_radius());
        }

        // Wire the portal handler so the new transition_system can call back into
        // demo-specific recovery work (collision restore, chunk re-merge, etc.).
        if (auto* demo = dynamic_cast<DemoApp*>(&app)) {
            demo->set_portal_handler(
                [this, demo](const std::string& target_scene, const glm::vec3& target_position) {
                    perform_portal_transition(*demo, target_scene, target_position);
                });
        }
    }

    // Load collision grid from scene data (already loaded at top of on_enter).
    if (scene_data.collision) {
        collision_grid_ = *scene_data.collision;
        // Grid origin is (0,0) — scene coordinates match grid coordinates
        grid_origin_ = {0.0f, 0.0f};

        // Mark cells under the house as solid (collision box)
        // House at ~(192, 175), roughly 18×14 voxels at scale 0.8 ≈ 14×11 world units
        float house_x = 192.0f, house_z = 175.0f;
        float house_hw = 8.0f, house_hd = 7.0f;  // half-extents (generous)
        int marked = 0;
        for (float wx = house_x - house_hw; wx <= house_x + house_hw; wx += collision_grid_.cell_size * 0.5f) {
            for (float wz = house_z - house_hd; wz <= house_z + house_hd; wz += collision_grid_.cell_size * 0.5f) {
                float lx = wx - grid_origin_.x;
                float lz = wz - grid_origin_.y;
                int gx = static_cast<int>(lx / collision_grid_.cell_size);
                int gz = static_cast<int>(lz / collision_grid_.cell_size);
                if (gx >= 0 && gx < static_cast<int>(collision_grid_.width) &&
                    gz >= 0 && gz < static_cast<int>(collision_grid_.height)) {
                    collision_grid_.solid[gz * collision_grid_.width + gx] = true;
                    marked++;
                }
            }
        }
        int gx_min = static_cast<int>((house_x - house_hw) / collision_grid_.cell_size);
        int gx_max = static_cast<int>((house_x + house_hw) / collision_grid_.cell_size);
        int gz_min = static_cast<int>((house_z - house_hd) / collision_grid_.cell_size);
        int gz_max = static_cast<int>((house_z + house_hd) / collision_grid_.cell_size);
        std::fprintf(stderr, "[IslandDemo] House collision: grid[%d-%d, %d-%d] (%d cells marked)\n",
                     gx_min, gx_max, gz_min, gz_max, marked);

        // Clear grid cells in the KCC showcase courtyard so primitive colliders
        // are the sole collision source.  Area: X=[185-215], Z=[160-185].
        int courtyard_cleared = 0;
        for (float wx = 185.0f; wx <= 215.0f; wx += collision_grid_.cell_size * 0.5f) {
            for (float wz = 160.0f; wz <= 185.0f; wz += collision_grid_.cell_size * 0.5f) {
                int cgx = static_cast<int>(wx / collision_grid_.cell_size);
                int cgz = static_cast<int>(wz / collision_grid_.cell_size);
                if (cgx >= 0 && cgx < static_cast<int>(collision_grid_.width) &&
                    cgz >= 0 && cgz < static_cast<int>(collision_grid_.height)) {
                    size_t idx = cgz * collision_grid_.width + cgx;
                    if (collision_grid_.solid[idx]) {
                        collision_grid_.solid[idx] = false;
                        courtyard_cleared++;
                    }
                }
            }
        }
        std::fprintf(stderr, "[IslandDemo] KCC courtyard: %d grid cells cleared (X=185-215, Z=160-185)\n",
                     courtyard_cleared);

        // Open a walkable land bridge at the northern shore → Northern Forest
        // Clear solid cells in a path from Z=0 to Z=60, centered at X=192, width ~40
        int bridge_cleared = 0;
        for (float wx = 172.0f; wx <= 212.0f; wx += collision_grid_.cell_size * 0.5f) {
            for (float wz = 0.0f; wz <= 60.0f; wz += collision_grid_.cell_size * 0.5f) {
                int bgx = static_cast<int>(wx / collision_grid_.cell_size);
                int bgz = static_cast<int>(wz / collision_grid_.cell_size);
                if (bgx >= 0 && bgx < static_cast<int>(collision_grid_.width) &&
                    bgz >= 0 && bgz < static_cast<int>(collision_grid_.height)) {
                    size_t idx = bgz * collision_grid_.width + bgx;
                    if (collision_grid_.solid[idx]) {
                        collision_grid_.solid[idx] = false;
                        bridge_cleared++;
                    }
                }
            }
        }
        std::fprintf(stderr, "[IslandDemo] North bridge: %d cells cleared (X=182-202, Z=0-50)\n",
                     bridge_cleared);

        // Load forest collision grid for seamless north transition
        auto forest_scene = SceneLoader::load("assets/scenes/northern_forest.json");
        if (forest_scene.collision) {
            forest_collision_grid_ = *forest_scene.collision;
            // Forest grid covers Z: -192 to 0 (COLLISION_Z_MIN=-192, 192 cells × 1.0)
            forest_grid_origin_ = {0.0f, -192.0f};
            forest_grid_loaded_ = true;
            std::fprintf(stderr, "[IslandDemo] Forest collision loaded: %ux%u (origin Z=%.0f)\n",
                forest_collision_grid_.width, forest_collision_grid_.height, forest_grid_origin_.y);

            // Clear forest-side entrance cells matching the bridge (Z=-20 to 0, same X range)
            int forest_bridge = 0;
            for (float wx = 172.0f; wx <= 212.0f; wx += forest_collision_grid_.cell_size * 0.5f) {
                for (float wz = -20.0f; wz <= 0.0f; wz += forest_collision_grid_.cell_size * 0.5f) {
                    float lx = wx - forest_grid_origin_.x;
                    float lz = wz - forest_grid_origin_.y;
                    int fgx = static_cast<int>(lx / forest_collision_grid_.cell_size);
                    int fgz = static_cast<int>(lz / forest_collision_grid_.cell_size);
                    if (fgx >= 0 && fgx < static_cast<int>(forest_collision_grid_.width) &&
                        fgz >= 0 && fgz < static_cast<int>(forest_collision_grid_.height)) {
                        size_t idx = fgz * forest_collision_grid_.width + fgx;
                        if (forest_collision_grid_.solid[idx]) {
                            forest_collision_grid_.solid[idx] = false;
                            forest_bridge++;
                        }
                    }
                }
            }
            std::fprintf(stderr, "[IslandDemo] Forest entrance: %d cells cleared\n", forest_bridge);
        }

        // Collect audio zones from loaded scenes for later setup
        // Island scene audio zones (collected first)
        for (const auto& az : scene_data.audio_zones) {
            scene_audio_zones.push_back(az);
        }
        for (const auto& az : forest_scene.audio_zones) {
            scene_audio_zones.push_back(az);
        }

        auto dungeon_scene = SceneLoader::load("assets/scenes/dungeon.json");
        for (const auto& az : dungeon_scene.audio_zones) {
            scene_audio_zones.push_back(az);
        }
    }

    // Create collision grid reference entity for NPC system
    {
        auto grid_entity = app.world().create();
        CollisionGridRef ref;
        ref.grid = &collision_grid_;
        ref.origin_x = grid_origin_.x;
        ref.origin_z = grid_origin_.y;
        ref.query_height = [this](float wx, float wz) -> float {
            for (const auto& hf : collision_system_.heightfield_cache()) {
                auto h = sample_height(hf, wx, wz);
                if (h) return *h;
            }
            return 0.0f;
        };
        app.world().add<CollisionGridRef>(grid_entity, ref);
    }

    // Initialize camera zone system if scene has camera_zones
    if (scene_data.camera_zones) {
        camera_zone_system_ = std::make_unique<CameraZoneSystem>();

        auto& cz = *scene_data.camera_zones;

        // Convert string-keyed volumes to entity-ID-keyed volumes
        std::vector<std::pair<int, CameraVolume>> volumes;
        std::unordered_map<std::string, int> zone_id_map;
        int next_zone_id = 0;
        for (auto& [id, vol] : cz.volumes) {
            zone_id_map[id] = next_zone_id;
            volumes.push_back({next_zone_id, vol});
            next_zone_id++;
        }

        // Resolve trigger zone references
        for (size_t i = 0; i < cz.triggers.size(); ++i) {
            auto& [from_id, to_id] = cz.trigger_zone_refs[i];
            if (!from_id.empty() && zone_id_map.count(from_id)) {
                cz.triggers[i].from_zone_entity = zone_id_map[from_id];
            }
            if (zone_id_map.count(to_id)) {
                cz.triggers[i].to_zone_entity = zone_id_map[to_id];
            }
        }

        // Extract rails (drop string IDs)
        std::vector<CameraRail> rails;
        for (auto& [id, rail] : cz.rails) {
            rails.push_back(rail);
        }

        size_t rail_count = rails.size();
        camera_zone_system_->load_from_data(
            std::move(volumes), cz.triggers, std::move(rails), cz.default_params);

        // Wire up camera_zone_system for bridge commands.
        app.command_dispatcher().context().camera_zone_system = camera_zone_system_.get();
        app.command_dispatcher().context().collision_system = &collision_system_;

        std::fprintf(stderr, "[IslandDemo] Camera zone system loaded: %d volumes, %zu triggers, %zu rails\n",
                     next_zone_id, cz.triggers.size(), rail_count);
    }

    // Block on the worker-thread parse, then merge chunks + character INTO
    // the parsed terrain cloud BEFORE running finalize_on_main. Single
    // `init_gs` uploads the full merged cloud as one static chunk — see
    // `docs/superpowers/specs/2026-05-09-upfront-merge-single-init-gs-design.md`
    // for why we don't issue a second `init_gs` (clear_chunks + sort-scratch
    // re-alloc corrupts Radix Sort state) and why we don't append a second
    // chunk via `load_cloud_async` (two pre-render publications expose a
    // synchronization hazard we don't fully understand).
    ParsedScene parsed_scene = parse_future.get();

    // Compute player_pos here so the §A character merge below can place the
    // character splats. `app.renderer().gs_cloud_metadata().bounds` isn't
    // populated yet (init_gs hasn't run); `parsed_scene.terrain_aabb` carries
    // the same value the renderer would surface post-init.
    glm::vec3 player_pos = scene_data.player_position.vec();
    if (glm::length(player_pos) < 0.001f && parsed_scene.has_terrain) {
        player_pos = parsed_scene.terrain_aabb.center();
    }

    // gs_scale_ is needed by the character merge below; mirrors what the
    // original post-init computation set later in this function.
    gs_scale_ = scene_data.gaussian_splat
        ? scene_data.gaussian_splat->scale_multiplier : 1.0f;

    // Collected during §A merge below; uploaded to the dynamic SSBO's
    // persistent prefix after `load_pre_parsed_gs_scene`.
    std::vector<Gaussian> persistent_dynamics_pending;

    // ── §A upfront merge ──
    // Build the full terrain + world-chunks + character gaussian vector
    // on the CPU and replace `parsed_scene.cloud` with it. Mutates
    // `parsed_scene.bone_allocations` + `bone_slot_counter` so that
    // `finalize_on_main` propagates the chunk-NPC bone slots into
    // `gs_terrain`. Chunk-NPC ECS entities are created here too —
    // `finalize_on_main` only touches the main scene's `snapped_objects`,
    // so chunk-scope game_objects need their entities spawned independently.
    if (parsed_scene.has_terrain) {
        std::vector<Gaussian> merged = parsed_scene.cloud.gaussians();

        if (world_streamer_) {
            for (const auto& chunk : world_streamer_->manifest().chunks) {
                if (chunk.grid == glm::ivec3(0, 0, 0)) continue;  // already in terrain cloud
                if (chunk.ply_file.empty()) continue;
                auto resolved = resolve_asset_path(chunk.ply_file);
                auto extra = GaussianCloud::load_with_gsvx_first(resolved.string());
                if (!extra.empty()) {
                    const auto& gs = extra.gaussians();
                    merged.insert(merged.end(), gs.begin(), gs.end());
                    std::fprintf(stderr, "[IslandDemo] Merged chunk [%d,%d,%d]: +%u Gaussians\n",
                        chunk.grid.x, chunk.grid.y, chunk.grid.z, extra.count());

                    // Process game objects from the chunk's scene file
                    if (!chunk.scene_file.empty()) {
                        auto chunk_scene = SceneLoader::load(chunk.scene_file);
                        AABB chunk_aabb = extra.bounds();

                        for (const auto& go : chunk_scene.game_objects) {
                            glm::vec3 world_pos = go.position.vec() + chunk_aabb.min;
                            // Snap Y to terrain via heightfield
                            for (const auto& hf : collision_system_.heightfield_cache()) {
                                auto h = sample_height(hf, world_pos.x, world_pos.z);
                                if (h) { world_pos.y = *h; break; }
                            }

                            // Merge BoneAnimated PLY with bone slot allocation.
                            // Bone slots flow through `parsed_scene` so that
                            // `finalize_on_main` writes them into gs_terrain.
                            if (!go.ply_file.empty() && !go.components.is_null()
                                && go.components.contains("BoneAnimated")) {
                                auto npc_cloud = GaussianCloud::load_with_gsvx_first(go.ply_file);
                                if (!npc_cloud.empty()) {
                                    const auto& ba_json = go.components["BoneAnimated"];
                                    std::string manifest_path = ba_json.value("manifest", std::string{});

                                    uint32_t bone_count = 0;
                                    {
                                        std::ifstream mf(manifest_path);
                                        if (mf.is_open()) {
                                            auto mj = nlohmann::json::parse(mf, nullptr, false);
                                            if (!mj.is_discarded() && mj.contains("bones"))
                                                bone_count = static_cast<uint32_t>(mj["bones"].size());
                                        }
                                    }

                                    uint32_t first_bone = parsed_scene.bone_slot_counter;
                                    if (bone_count > 0 && first_bone + bone_count <= 32) {
                                        parsed_scene.bone_slot_counter += bone_count;

                                        GsTerrainState::BoneAllocation alloc;
                                        alloc.manifest_path = manifest_path;
                                        alloc.default_clip = ba_json.value("default_clip", std::string{"idle"});
                                        alloc.first_bone_index = first_bone;
                                        alloc.bone_count = bone_count;
                                        alloc.char_scale = go.scale;
                                        alloc.gs_scale_multiplier = gs_scale_;
                                        alloc.world_pos = world_pos;
                                        alloc.game_object_index = 9999;  // not from main scene
                                        parsed_scene.bone_allocations.push_back(alloc);

                                        // Use same transform as scene loader: translate, rotate, scale, center
                                        glm::vec3 local_min(1e9f), local_max(-1e9f);
                                        for (const auto& g : npc_cloud.gaussians()) {
                                            local_min = glm::min(local_min, g.position);
                                            local_max = glm::max(local_max, g.position);
                                        }
                                        glm::vec3 local_center = (local_min + local_max) * 0.5f;
                                        local_center.y = local_min.y;

                                        auto xform = glm::translate(glm::mat4(1.0f), world_pos);
                                        xform = glm::rotate(xform, glm::radians(go.rotation.x), {1,0,0});
                                        xform = glm::rotate(xform, glm::radians(go.rotation.y), {0,1,0});
                                        xform = glm::rotate(xform, glm::radians(go.rotation.z), {0,0,1});
                                        xform = glm::scale(xform, glm::vec3(go.scale));
                                        xform = glm::translate(xform, -local_center);
                                        glm::mat3 rot_mat(xform);

                                        for (const auto& g : npc_cloud.gaussians()) {
                                            Gaussian ng = g;
                                            ng.position = glm::vec3(xform * glm::vec4(ng.position, 1.0f));
                                            ng.scale *= go.scale;
                                            ng.bone_index = first_bone + ng.bone_index;
                                            ng.opacity = std::min(1.0f, ng.opacity * 1.3f);
                                            glm::quat rot_q(rot_mat);
                                            glm::quat orig_q(ng.rotation[0], ng.rotation[1], ng.rotation[2], ng.rotation[3]);
                                            glm::quat new_q = rot_q * orig_q;
                                            ng.rotation = {new_q.w, new_q.x, new_q.y, new_q.z};
                                            merged.push_back(ng);
                                        }

                                        std::fprintf(stderr, "[IslandDemo] Chunk NPC '%s': bones %u-%u at (%.1f, %.1f, %.1f)\n",
                                            go.id.c_str(), first_bone, first_bone + bone_count - 1,
                                            world_pos.x, world_pos.y, world_pos.z);
                                    }
                                }
                            }

                            // Create ECS entity for game objects with components.
                            // `finalize_on_main` only touches the main scene's
                            // `snapped_objects`, so chunk-scope entities need
                            // to be spawned here independently.
                            if (!go.components.is_null() && !go.components.empty()) {
                                auto entity = app.world().create();
                                app.world().add<ecs::Transform>(entity,
                                    {coord::WorldPos(world_pos), {go.scale, go.scale}});
                                for (auto& [name, data] : go.components.items()) {
                                    app.component_registry().attach(app.world(), entity, name, data);
                                }
                            }
                        }
                    }
                }
            }
        }

        // Character merge — load snes_hero PLY, transform to player_pos.
        // bone_index is offset by +1 so the shader's bone[0] (terrain sway)
        // is preserved; per-character bone slots start at 1 (the player) and
        // chunk NPCs use slots starting at 8 (set up by parse() / appended above).
        auto char_cloud = GaussianCloud::load_with_gsvx_first("assets/characters/snes_hero/snes_hero.ply");
        if (!char_cloud.empty()) {
            const auto& char_gs = char_cloud.gaussians();
            for (const auto& g : char_gs) {
                Gaussian cg = g;
                glm::vec3 rotated(-cg.position.x, cg.position.y, -cg.position.z);
                glm::vec3 offset = rotated * kCharScale;
                offset.y *= gs_scale_;
                cg.position = player_pos + offset + glm::vec3(0, 2.0f, 0);
                cg.scale *= kCharScale;
                cg.opacity = std::min(1.0f, cg.opacity * 1.3f);
                cg.bone_index = cg.bone_index + 1;
                merged.push_back(cg);
            }
        }

        // Partition by bone_index:
        //   bone_index == 0  → static (terrain + tree trunks + non-animated props)
        //   bone_index >  0  → persistent dynamic (PBD-tagged tree leaves with
        //                       bone_index ≥ 32, plus bone-animated characters
        //                       and NPCs with bone_index in [1, 31]).
        // The dynamic preprocess re-applies bone+PBD transforms every frame, so
        // the static depth sort can stay cached when the camera is stationary.
        // Source: 2026-05-09 Option A architectural fix.
        std::vector<Gaussian> static_only;
        static_only.reserve(merged.size());
        for (const auto& g : merged) {
            if (g.bone_index > 0) {
                persistent_dynamics_pending.push_back(g);
            } else {
                static_only.push_back(g);
            }
        }
        std::fprintf(stderr,
            "[IslandDemo] Partition for split-tail: static=%zu persistent_dyn=%zu (total=%zu)\n",
            static_only.size(), persistent_dynamics_pending.size(), merged.size());
        parsed_scene.cloud = GaussianCloud::from_gaussians(std::move(static_only));
    }

    {
        GsSceneOptions parse_opts;
        parse_opts.add_default_light = true;
        parse_opts.set_god_rays = true;
        app.load_pre_parsed_gs_scene(scene_data, std::move(parsed_scene), parse_opts);
    }

    // Upload persistent dynamics (chars/NPCs/PBD-tagged tree splats) into the
    // dynamic SSBO's prefix region. The transient suffix (VFX, particles)
    // continues to be re-uploaded every frame from Renderer::record_gs_prepass.
    //
    // Called unconditionally — even with count=0 — so the prefix is cleared
    // when entering a scene with no animated content. Without this, a stale
    // persistent_dyn_count_ from the previous scene would shift the offset
    // used by subsequent update_dynamic_gaussians calls and either clip or
    // misplace transient VFX. Codex P2 on #420.
    app.renderer().gs_renderer().set_persistent_dynamics(
        persistent_dynamics_pending.empty() ? nullptr : persistent_dynamics_pending.data(),
        static_cast<uint32_t>(persistent_dynamics_pending.size()));

    // `player_pos` was computed earlier (before the §A merge) using
    // `parsed_scene.terrain_aabb` for the same fallback `gs_cloud_metadata`
    // would have surfaced post-init.

    // Find the player entity created by scene loader (has PlayerController + PlayerTag)
    player_entity_ = ecs::kNullEntity;
    app.world().view<PlayerController, PlayerTag, ecs::Transform>().each(
        [&](ecs::Entity e, PlayerController&, PlayerTag&, ecs::Transform&) {
            player_entity_ = e;
        });

    // Legacy fallback: if no game object has PlayerController, create player manually
    if (!player_entity_.valid()) {
        player_entity_ = app.world().create();
        app.world().add<ecs::Transform>(player_entity_, {coord::WorldPos(player_pos), {1.0f, 1.0f}});
        app.world().add<PlayerController>(player_entity_, {20.0f, 20.0f});
        app.world().add<PlayerJump>(player_entity_);
        app.world().add<PlayerTag>(player_entity_);

        KinematicBody kb;
        kb.desired_jump_height = 2.0f;
        kb.time_to_apex = 0.4f;
        kb.recompute_derived();
        app.world().add<KinematicBody>(player_entity_, kb);

        ColliderComponent cc;
        cc.shape = CapsuleData{0.3f, 0.5f};
        cc.is_dynamic = true;
        app.world().add<ColliderComponent>(player_entity_, cc);
    }

    // Capture base scene lights (before dynamic emissive lights are added)
    // Note: GS renderer gets lights during record_gs_prepass, not at init.
    // Scene lights come from SceneData via AppBase::load_gs_scene → set_gs_static_lights.
    // We need to read from the Renderer's static list, not GsRenderer's current list.
    // For now, start empty — the scene's directional/ambient lights are set separately.
    scene_lights_ = {};
    std::fprintf(stderr, "[IslandDemo] scene_lights_ captured: %zu lights\n", scene_lights_.size());

    // Load character manifest into local variable (ownership moves to registry entry)
    std::unique_ptr<gseurat::CharacterData> player_char_data;
    {
        auto loaded = gseurat::load_character_manifest(
            "assets/characters/snes_hero/snes_hero.manifest.json");
        if (loaded) {
            player_char_data = std::make_unique<gseurat::CharacterData>(std::move(*loaded));
            std::fprintf(stderr, "[IslandDemo] Character manifest loaded: %zu bones, %zu clips\n",
                         player_char_data->bones.size(), player_char_data->clips.size());
        } else {
            std::fprintf(stderr, "[IslandDemo] WARNING: Failed to load character manifest!\n");
        }
    }

    // Spawn player character (procedural humanoid)
    // §A merge + single init_gs already ran above (before
    // `load_pre_parsed_gs_scene`). Here we only do post-init bookkeeping that
    // needs `app.renderer().has_gs_cloud()` to be true: character spawn
    // metadata, bone-animation registry population, player registration.
    if (app.renderer().has_gs_cloud()) {
        character_spawn_pos_ = player_pos;
        character_origin_ = player_pos;
        character_spawned_ = true;

        // Re-populate registry with all bone allocations (main scene + chunks).
        // gs_terrain.bone_allocations was set by `finalize_on_main` from
        // `parsed_scene.bone_allocations`, which the §A merge above appended
        // chunk-NPC entries to before the move.
        populate_bone_animation_registry(app.bone_animation_registry(), app.world(), app.gs_terrain());

        // Register player in BoneAnimationRegistry
        if (player_char_data) {
            gseurat::BoneAnimationEntry player_entry;
            player_entry.manifest_path = "assets/characters/snes_hero/snes_hero.manifest.json";
            player_entry.default_clip = "idle";
            player_entry.first_bone_index = 1;
            uint32_t player_bone_count = static_cast<uint32_t>(player_char_data->bones.size());
            player_entry.bone_count = player_bone_count;
            player_entry.char_scale = kCharScale;
            player_entry.gs_scale_multiplier = gs_scale_;
            player_entry.spawn_pos = player_pos;
            player_entry.current_pos = player_pos;
            player_entry.character_data = std::move(player_char_data);
            player_entry.anim_player = std::make_unique<gseurat::BoneAnimationPlayer>(
                *player_entry.character_data);
            player_entry.anim_sm = std::make_unique<gseurat::BoneAnimationStateMachine>(
                *player_entry.anim_player);
            for (const auto& clip : player_entry.character_data->clips) {
                player_entry.anim_sm->add_state(clip.name, clip.name);
            }
            player_entry.anim_sm->set_state("idle");
            player_entry.initialized = true;
            player_registry_id_ = app.bone_animation_registry().add(
                player_entity_, std::move(player_entry));
            app.world().add<gseurat::BoneAnimatedTag>(player_entity_,
                {player_registry_id_});

            // Set bone 0 override for terrain sway
            app.set_bone_pre_upload_hook([this](BonesWriter& writer) {
                float sway_y = std::sin(env_anim_time_ * 1.0f) * 0.05f;
                float sway_x = std::sin(env_anim_time_ * 0.6f) * 0.02f;
                writer.write(0, glm::translate(glm::mat4(1.0f),
                    glm::vec3(sway_x, sway_y, 0.0f)));
            });
        }
    }

    // Re-upload PBD elements — `init_gs` resets `pbd_count_` to 0, wiping
    // the upload from `finalize_on_main`'s `upload_pbd_elements` call.
    {
        const auto& anchors = app.gs_terrain().pbd_anchors;
        const auto& configs = app.gs_terrain().pbd_configs;
        if (!anchors.empty() && anchors.size() == configs.size()) {
            uint32_t count = static_cast<uint32_t>(anchors.size());
            std::vector<PbdPhysicsState> states(count);
            std::vector<PbdElementParams> params(count);
            for (uint32_t i = 0; i < count; ++i) {
                const auto& cfg = configs[i];
                float inv_mass = (cfg.mode == "physics" && cfg.pinned) ? 0.0f : 1.0f;
                states[i].position = glm::vec4(anchors[i], inv_mass);
                states[i].prev_position = glm::vec4(0.0f, 0.0f, 0.0f, 1.0f);
                states[i].velocity = glm::vec4(0.0f);
                states[i].params = glm::vec4(cfg.sway_threshold, 0.0f, 0.0f, 0.0f);
                params[i].gravity = glm::vec4(cfg.gravity, cfg.damping);
                params[i].wind = glm::vec4(cfg.wind_direction, cfg.wind_strength);
                params[i].dynamics = glm::vec4(cfg.wind_frequency, cfg.ground_y, cfg.bounce, 0.0f);
            }
            // Phase 4d-1: route through PbdElementsLoadedEvent;
            // PbdSystem::run picks this up on the next main_loop tick.
            app.world().events<PbdElementsLoadedEvent>().send(
                PbdElementsLoadedEvent{std::move(states), std::move(params)});
        }
    }

    // Initialize camera centered on player (use header defaults for elevation/distance)
    camera_target_ = player_pos + glm::vec3(0, kCameraYOffset, 0);

    // Load and play the field theme music via the new AudioEngine.
    // Phase 1: programmatic playback on startup. AudioZone spatial triggering
    // will be wired once the ECS integration is fully tested.
    if (auto* ae = app.audio()) {
        auto r = ae->load_track_group("assets/audio/field_theme.music.json");
        if (r) {
            // Add LPF to each music stem for dungeon muffling (must be before play_group)
            for (uint32_t si = 0; si < 4; ++si) {
                ae->add_stem_effect(r.value(), si,
                    audio::AudioEngine::create_svf(44100, 0, 20000.0f, 0.707f));
                ae->bind_effect_param_to_rtpc(r.value(), si, 0,
                    0,  // kParamCutoff
                    kRtpcMusicFilter, 800.0f, 20000.0f);
            }
            ae->set_rtpc(kRtpcMusicFilter, 1.0f);  // start fully open
            ae->play_group(r.value());
            island_music_group_ = r.value();
            active_music_group_ = r.value();
            std::fprintf(stderr, "[IslandDemo] Field theme loaded and playing (group %u)\n", r.value());
        } else {
            std::fprintf(stderr, "[IslandDemo] WARNING: Failed to load field_theme.music.json (error %u)\n",
                         static_cast<uint32_t>(r.error()));
        }

        // Load audio zones from all scenes and build crossfade state
        for (const auto& az : scene_audio_zones) {
            AudioZoneState zs;
            zs.bounds_min = az.center - az.half_extents;
            zs.bounds_max = az.center + az.half_extents;
            zs.crossfade_ms = az.crossfade_ms;
            zs.ambient_volume = az.ambient_volume;
            zs.stem_fade_on_enter = az.stem_fade_on_enter;
            zs.stem_fade_on_exit = az.stem_fade_on_exit;

            if (!az.music_config.empty()) {
                auto gr = ae->load_track_group(az.music_config);
                if (!gr) {
                    std::fprintf(stderr, "[IslandDemo] WARNING: Failed to load audio zone music '%s'\n",
                                 az.music_config.c_str());
                    continue;
                }
                zs.group_id = gr.value();
            }
            // group_id stays 0 for stem-fade-only zones (no music_config)

            audio_zones_.push_back(zs);
            std::fprintf(stderr, "[IslandDemo] Audio zone '%s' loaded (group %u, xfade %.0fms)\n",
                         az.id.c_str(), zs.group_id, az.crossfade_ms);
        }
    }

    // Load SFX
    if (auto* ae = app.audio()) {
        auto load = [&](const char* path) -> uint32_t {
            auto r = ae->load_sfx(path);
            if (!r) {
                std::fprintf(stderr, "[IslandDemo] WARNING: Failed to load SFX %s\n", path);
                return 0;
            }
            return r.value();
        };
        sfx_footstep_     = load("assets/audio/footstep.wav");
        sfx_dialog_open_  = load("assets/audio/dialog_open.wav");
        sfx_dialog_close_ = load("assets/audio/dialog_close.wav");
        sfx_dialog_blip_  = load("assets/audio/dialog_blip.wav");
        sfx_torch_        = load("assets/audio/torch_crackle.wav");
        sfx_loaded_ = true;

        // Set up looping spatial torch crackles from scene data
        for (const auto& pos : scene_data.torch_audio_positions) {
            ae->play_looping_spatial(sfx_torch_, pos.x, pos.y, pos.z, 15.0f, 0.6f);
        }
        std::fprintf(stderr, "[IslandDemo] SFX loaded, %zu torch crackles placed\n",
                     scene_data.torch_audio_positions.size());

        // Note: dialog SFX (dialog_open, dialog_close, dialog_blip) are loaded and ready.
        // They will be triggered when the dialog system is wired up.
    }

    // Initialize collision system — rebuilds cache from any ColliderComponent entities
    collision_system_.rebuild_cache(app.world());

    // If the player has a KinematicBody, compute derived physics values
    if (auto* kb = app.world().try_get<KinematicBody>(player_entity_)) {
        kb->recompute_derived();
    }

    // Register collision system dumper (Store domain)
    static std::optional<CollisionSystemDumper> collision_dumper;
    collision_dumper.emplace([this]() -> CollisionSystemDumper::Snapshot {
        CollisionSystemDumper::Snapshot snap;

        // Count primitives by type
        auto count_shapes = [](const std::vector<ColliderInstance>& cache,
                               uint32_t& boxes, uint32_t& spheres, uint32_t& capsules,
                               uint32_t& triggers, uint32_t& solids) {
            for (const auto& ci : cache) {
                if (std::holds_alternative<BoxData>(ci.shape)) ++boxes;
                else if (std::holds_alternative<SphereData>(ci.shape)) ++spheres;
                else if (std::holds_alternative<CapsuleData>(ci.shape)) ++capsules;
                if (ci.is_trigger) ++triggers; else ++solids;
            }
        };

        count_shapes(collision_system_.static_cache(),
                     snap.box_count, snap.sphere_count, snap.capsule_count,
                     snap.trigger_count, snap.solid_count);
        count_shapes(collision_system_.dynamic_cache(),
                     snap.box_count, snap.sphere_count, snap.capsule_count,
                     snap.trigger_count, snap.solid_count);

        snap.total_static  = static_cast<uint32_t>(collision_system_.static_cache().size());
        snap.total_dynamic = static_cast<uint32_t>(collision_system_.dynamic_cache().size());
        snap.cache_dirty   = collision_system_.is_dirty();

        // BVH stats
        const auto& bvh_nodes = collision_system_.bvh().nodes();
        snap.bvh_empty      = collision_system_.bvh().empty();
        snap.bvh_node_count = static_cast<uint32_t>(bvh_nodes.size());

        // Compute depth and leaf count via traversal
        uint32_t leaf_count = 0;
        uint32_t max_depth = 0;
        if (!snap.bvh_empty) {
            // Iterative depth computation using a stack
            struct StackEntry { uint32_t idx; uint32_t depth; };
            std::vector<StackEntry> stack;
            stack.push_back({0, 1});
            while (!stack.empty()) {
                auto [idx, depth] = stack.back();
                stack.pop_back();
                if (idx >= bvh_nodes.size()) continue;
                const auto& node = bvh_nodes[idx];
                if (node.is_leaf) {
                    ++leaf_count;
                    max_depth = std::max(max_depth, depth);
                } else {
                    stack.push_back({node.left, depth + 1});
                    stack.push_back({node.right, depth + 1});
                }
            }
        }
        snap.bvh_leaf_count = leaf_count;
        snap.bvh_depth      = max_depth;

        // NavZones from collision grid
        snap.grid_width  = collision_grid_.width;
        snap.grid_height = collision_grid_.height;
        std::unordered_set<uint8_t> zones;
        for (uint8_t z : collision_grid_.nav_zone) {
            if (z != 0) zones.insert(z);
        }
        snap.nav_zone_count = static_cast<uint32_t>(zones.size());

        if (snap.cache_dirty) snap.warnings.push_back("cache_needs_rebuild");
        if (snap.bvh_empty && snap.total_static > 0) snap.warnings.push_back("bvh_stale");
        return snap;
    });
    app.debug_dump_registry().register_module(&*collision_dumper);

    // Scene loaded — ready for play
}

void IslandDemoState::on_exit(AppBase& app) {
    ShutdownAuditor::report();

    // Release camera zone system
    app.command_dispatcher().context().camera_zone_system = nullptr;
    app.command_dispatcher().context().collision_system = nullptr;
    camera_zone_system_.reset();

    // Release animation registry references
    app.set_bone_pre_upload_hook(nullptr);
    player_registry_id_ = 0;

    if (character_spawned_) {
        // Phase 4b: clear_bone_transforms removed (see GsDemoState equivalent).
        app.renderer().gs_renderer().clear_pbd();
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

    // Skip keyboard shortcuts when dev overlay has focus
    if (!app.dev_overlay().wants_keyboard()) {
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


        // J → toggle PBD chain demo (CPU-side, rendered as dynamic Gaussians)
        if (app.input().was_key_pressed(GLFW_KEY_J)) {
            if (pbd_chain_active_) {
                pbd_chain_active_ = false;
                std::fprintf(stderr, "[IslandDemo] PBD chain demo OFF\n");
            } else {
                glm::vec3 top = character_origin_ + glm::vec3(3.0f, 8.0f, 0.0f);
                for (int i = 0; i < kPbdNodeCount; ++i) {
                    glm::vec3 p = top - glm::vec3(0.0f, static_cast<float>(i) * 3.0f, 0.0f);
                    pbd_nodes_[i].position = p;
                    pbd_nodes_[i].prev_position = p;
                    pbd_nodes_[i].velocity = glm::vec3(0.0f);
                    pbd_nodes_[i].inv_mass = (i == 0) ? 0.0f : 1.0f;
                }
                pbd_links_[0] = {0, 1, 3.0f, 0.8f};
                pbd_links_[1] = {1, 2, 3.0f, 0.8f};
                pbd_chain_active_ = true;
                std::fprintf(stderr, "[IslandDemo] PBD chain demo ON (CPU, 3 nodes, 2 links)\n");
            }
        }

        // Space → jump (if not already jumping)
        {
            auto* pj = app.world().try_get<PlayerJump>(player_entity_);
            if (pj && app.input().was_key_pressed(GLFW_KEY_SPACE) && !pj->active) {
                pj->active = true;
                pj->timer = 0.0f;
                auto* pe = app.bone_animation_registry().get(player_registry_id_);
                if (pe) pe->requested_clip = "jump";
            }
        }
    }  // end keyboard gating

    // Handle mouse input for camera orbit (skip when dev overlay has mouse focus)
    if (!app.dev_overlay().wants_mouse()) {
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

    // Player movement (skip when dev overlay has keyboard focus)
    if (!app.dev_overlay().wants_keyboard()) {
        update_player(app, dt);
    }

    // Run collision system (KCC processes velocity set by update_player)
    collision_system_.update(app.world(), dt);

    // Audio: update listener position + footstep SFX + audio zone crossfade
    if (auto* ae = app.audio()) {
        ae->set_listener_position(character_origin_.x, character_origin_.y, character_origin_.z);

        // Audio zone crossfade: check if player entered/exited any zone
        if (app.feature_flags().music) {
            uint32_t desired_group = island_music_group_;  // default to island music
            float xfade_ms = 2000.0f;

            for (auto& z : audio_zones_) {
                const bool inside = character_origin_.x >= z.bounds_min.x
                                 && character_origin_.x <= z.bounds_max.x
                                 && character_origin_.z >= z.bounds_min.z
                                 && character_origin_.z <= z.bounds_max.z;

                // Detect enter/exit transitions for stem fades.
                // NOTE: stem fades target already-playing groups (e.g. the field BGM).
                // Zones that combine music_config crossfades with stem fades on the
                // *destination* group would need the fade dispatched after the
                // transition below, since the mixer ignores commands to inactive groups.
                if (inside && !z.player_inside) {
                    for (const auto& a : z.stem_fade_on_enter) {
                        ae->set_stem_volume(a.group_id, a.stem_index, a.target_volume, a.fade_ms);
                    }
                } else if (!inside && z.player_inside) {
                    for (const auto& a : z.stem_fade_on_exit) {
                        ae->set_stem_volume(a.group_id, a.stem_index, a.target_volume, a.fade_ms);
                    }
                }

                if (inside && z.group_id != 0) {
                    desired_group = z.group_id;
                    xfade_ms = z.crossfade_ms;
                }
                z.player_inside = inside;
            }

            if (desired_group != active_music_group_ && desired_group != 0 && active_music_group_ != 0) {
                ae->request_transition(active_music_group_, desired_group, xfade_ms);
                std::fprintf(stderr, "[IslandDemo] Music crossfade: group %u -> %u (%.0fms)\n",
                             active_music_group_, desired_group, xfade_ms);
                active_music_group_ = desired_group;
            }
        }
    }
    if (sfx_loaded_) {
        const bool moving = glm::length(glm::vec2(player_velocity_.x, player_velocity_.z)) > 1.0f;
        const auto* pj_sfx = app.world().try_get<PlayerJump>(player_entity_);
        if (moving && !(pj_sfx && pj_sfx->active)) {
            footstep_timer_ -= dt;
            if (footstep_timer_ <= 0.0f) {
                if (auto* ae = app.audio()) {
                    ae->play_oneshot(sfx_footstep_, 0.5f);
                }
                footstep_timer_ = kFootstepInterval;
            }
        } else {
            footstep_timer_ = 0.0f;
        }
    }

    // Run ECS systems (proximity triggers, linked triggers, emissive toggle, NPC walker, bone animation)
    app.update_game(dt);

    // Effect systems (EmitterToggle, LightToggle)
    update_effects(app, dt);

    // Environment animation (N key toggles)
    if (anim_enabled_) {
        update_environment_animation(app, dt);
    }

    // Drive GS effect time for PBD solver (wind sway needs advancing time)
    app.renderer().gs_renderer().set_effect_time(env_anim_time_);

    // Walk animation always runs (handles character root transform + bone poses)
    update_walk_animation(app, dt);

    // PBD chain physics step + visual gather
    if (pbd_chain_active_) {
        step_pbd_chain(dt);
        gather_pbd_chain(app);
    }

    // Set player position as LOD focus for foveated culling
    app.renderer().set_gs_lod_focus(character_origin_);

    // Camera follow
    update_camera(app, dt);

    // World streaming evaluation. Gated to the overworld: world_streamer_
    // is initialised once (in on_enter) with seurat_island/world.json's
    // manifest, but its update() is purely distance-based — leaving it
    // ticking inside dungeon.json would distance-check the dungeon player
    // against overworld chunk AABBs and trigger load_cloud_async for any
    // chunk that happens to fall within load_radius_, leaking forest
    // content into the dungeon's GS buffer.
    if (world_streamer_ && !disable_world_streaming_) {
        ScopedStallTimer _t_streamer{"world_streamer.update+pending_loads"};
        const uint64_t frame_index = app.tick();
        auto events = world_streamer_->update(character_origin_);

        // Drain any worker-thread-completed PLY parses BEFORE kicking off
        // new ones, so a chunk that finished loading last frame doesn't
        // wait an extra cycle to reach VRAM.
        drain_async_chunk_loads(app);

        // Kick off async PLY loads for newly-pending chunks. Parsing runs
        // on a worker thread; the main thread only enqueues the work and
        // hands the resulting cloud to load_cloud_async on a later frame.
        for (const auto& grid_key : world_streamer_->pending_loads()) {
            for (const auto& chunk : world_streamer_->manifest().chunks) {
                std::string key = std::to_string(chunk.grid.x) + "," +
                                  std::to_string(chunk.grid.y) + "," +
                                  std::to_string(chunk.grid.z);
                if (key == grid_key && !chunk.ply_file.empty()) {
                    auto resolved = resolve_asset_path(chunk.ply_file);
                    std::fprintf(stderr, "[IslandDemo] Chunk [%s] async parse start: %s\n",
                        grid_key.c_str(), chunk.ply_file.c_str());
                    enqueue_async_chunk_load(grid_key, resolved.string(), frame_index);
                    break;
                }
            }
        }

        // Process pending unloads
        for (const auto& grid_key : world_streamer_->pending_unloads()) {
            std::fprintf(stderr, "[IslandDemo] Chunk [%s] Unloaded\n", grid_key.c_str());
#if GSEURAT_DEBUG_BUILD
            std::fprintf(stderr,
                "[streaming] frame=%llu chunk=%s event=evict\n",
                static_cast<unsigned long long>(frame_index), grid_key.c_str());
#endif
        }


        // Log streaming volume events
        for (const auto& ev : events) {
            switch (ev.type) {
                case WorldStreamer::StreamEvent::VOLUME_ENTERED:
                    std::fprintf(stderr, "[IslandDemo] StreamingVolume entered: %s\n", ev.id.c_str());
                    break;
                case WorldStreamer::StreamEvent::VOLUME_EXITED:
                    std::fprintf(stderr, "[IslandDemo] StreamingVolume exited: %s\n", ev.id.c_str());
                    break;
                default:
                    break;
            }
        }
    }
}

// ── Player movement ──

void IslandDemoState::update_player(AppBase& app, float dt) {
    auto& input = app.input();
    auto* transform = app.world().try_get<ecs::Transform>(player_entity_);
    if (!transform) return;

    auto* pc = app.world().try_get<PlayerController>(player_entity_);
    if (!pc) return;
    const float speed = pc->speed;
    const float accel = pc->acceleration;

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
    glm::vec3 target_vel = desired_dir * speed;

    // Smooth acceleration (lerp toward target)
    float blend = std::min(1.0f, accel * dt);
    player_velocity_.x += (target_vel.x - player_velocity_.x) * blend;
    player_velocity_.z += (target_vel.z - player_velocity_.z) * blend;

    // ── Path selection ──────────────────────────────────────────────
    auto* kb = app.world().try_get<KinematicBody>(player_entity_);

    if (kb) {
        // ── New KCC path ────────────────────────────────────────────
        // Set KinematicBody velocity from blended input (XZ only, preserve existing Y)
        kb->velocity.x = player_velocity_.x;
        kb->velocity.z = player_velocity_.z;

        // Jump input
        if (input.is_key_down(GLFW_KEY_SPACE) && kb->grounded) {
            kb->velocity.y = kb->derived_jump_velocity;
            kb->grounded = false;
            // Trigger jump animation if available
            auto* pe = app.bone_animation_registry().get(player_registry_id_);
            if (pe) pe->requested_clip = "jump";
        }

        // Variable jump height — cut velocity on release
        if (!input.is_key_down(GLFW_KEY_SPACE) && kb->velocity.y > 0.0f) {
            kb->velocity.y *= collision_system_.jump_cut_multiplier;
        }

        // KCC handles position update — read back
        character_origin_ = transform->position.vec();
    }

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

    // Sync rotation quaternion from input-driven facing angle
    // (only when no root motion clip is active)
    auto* player_entry = app.bone_animation_registry().get(player_registry_id_);
    bool has_root_motion = false;
    if (player_entry && player_entry->anim_player &&
        player_entry->anim_player->current_clip_index() >= 0) {
        has_root_motion = player_entry->character_data->clips[
            player_entry->anim_player->current_clip_index()].root_motion;
    }
    if (!has_root_motion) {
        character_rotation_ = glm::angleAxis(facing_angle_, glm::vec3(0.0f, 1.0f, 0.0f));
    }
}

// ── Camera follow ──

void IslandDemoState::update_camera(AppBase& app, float dt) {
    auto* transform = app.world().try_get<ecs::Transform>(player_entity_);
    if (!transform) return;

    // When sync_camera override is active, use the renderer's camera directly
    // and skip both the zone system and the orbit fallback.
    if (app.command_dispatcher().context().camera_sync_override) {
        auto pos = app.renderer().camera().position();
        auto tgt = app.renderer().camera().target();
        if (glm::length(pos - tgt) < 0.001f) {
            pos = tgt + glm::vec3(0, 5, -10);
        }
        glm::mat4 view = glm::lookAt(pos, tgt, glm::vec3(0, 1, 0));
        glm::mat4 proj = glm::perspective(
            glm::radians(45.0f), 1280.0f / 720.0f, 0.1f, 1000.0f);
        gizmo_vp_ = proj * view;
        proj[1][1] *= -1.0f;
        app.renderer().set_gs_camera(view, proj);
        return;
    }

    // Camera zone system path — data-driven camera volumes/triggers/rails
    if (camera_zone_system_) {
        CameraZoneSystem::InputState input{};
        // Feed orbit mouse delta from the existing drag handler
        auto& inp = app.input();
        glm::vec2 mouse = inp.mouse_pos();
        if (dragging_) {
            input.mouse_dx = mouse.x - last_mouse_.x;
            input.mouse_dy = mouse.y - last_mouse_.y;
        }
        input.scroll_delta = inp.scroll_y_delta();

        glm::vec3 player_pos = transform->position.vec();
        camera_zone_system_->update(dt, player_pos, player_velocity_, input);

        auto state = camera_zone_system_->current_state();

        // Guard against degenerate lookAt (position == target → NaN)
        if (glm::length(state.position - state.target) < 0.001f) {
            state.position = state.target + glm::vec3(0, 5, -10);
        }

        glm::mat4 view = glm::lookAt(state.position, state.target, state.up);
        glm::mat4 proj = glm::perspective(
            glm::radians(state.fov), 1280.0f / 720.0f, 0.1f, 1000.0f);
        gizmo_vp_ = proj * view;  // cache before Y-flip
        proj[1][1] *= -1.0f;  // Vulkan Y-flip
        app.renderer().set_gs_camera(view, proj);
        return;
    }

    // ── Orbit camera fallback (no camera zones) ──

    // Smooth target follow
    glm::vec3 desired_target = transform->position.vec() + glm::vec3(0, kCameraYOffset, 0);
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
    if (!collision_system_.heightfield_cache().empty()) {
        glm::vec3 mid = (eye + camera_target_) * 0.5f;
        for (const auto& hf : collision_system_.heightfield_cache()) {
            auto h = sample_height(hf, mid.x, mid.z);
            if (h) {
                float terrain_y = *h;
                if (mid.y < terrain_y + 3.0f) {
                    eye.y += (terrain_y + 3.0f - mid.y) * 2.0f;
                }
                break;
            }
        }
    }

    glm::mat4 view = glm::lookAt(eye, camera_target_, glm::vec3(0.0f, 1.0f, 0.0f));
    glm::mat4 proj = glm::perspective(
        glm::radians(60.0f),
        1280.0f / 720.0f,
        0.1f, 1000.0f
    );
    gizmo_vp_ = proj * view;  // cache before Y-flip
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
                auto& emitters = app.particle_system()->emitters();
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
                        t.position.x(), t.position.y(), t.position.z(), lt.color_r, lt.color_g, lt.color_b, lt.radius);
                    PointLight pl{};
                    pl.position_and_radius = glm::vec4(
                        t.position.x(), t.position.y(), t.position.z(), lt.radius);
                    pl.color = glm::vec4(
                        lt.color_r * lt.intensity,
                        lt.color_g * lt.intensity,
                        lt.color_b * lt.intensity, 1.0f);
                    app.scene().add_light(pl);
                } else if (!pt.triggered && lt.active) {
                    lt.active = false;
                    std::fprintf(stderr, "[LightToggle] OFF at (%.1f, %.1f, %.1f)\n",
                        t.position.x(), t.position.y(), t.position.z());
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
                        t.position.x(), t.position.y(), t.position.z(), et.color_r, et.color_g, et.color_b);
                    // Spawn glowing particles rising from the crystal — sized for distance-20 camera
                    GsEmitterConfig cfg;
                    cfg.position = t.position.vec() + glm::vec3(0, 3.0f, 0);
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
                    app.particle_system()->add_emitter(cfg);
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
                        t.position.x(), t.position.y(), t.position.z(), be.emitter_index);
                    auto& emitters = app.particle_system()->emitters();
                    if (be.emitter_index < emitters.size()) {
                        auto& emitter = emitters[be.emitter_index];
                        auto cfg = emitter.config();
                        cfg.position = t.position.vec();
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
                    region.center = t.position.vec();
                    region.radius = at.anim_radius;
                    std::string effect(at.effect_name);
                    std::fprintf(stderr, "[AnimationTrigger] FIRE '%s' at (%.1f, %.1f, %.1f) radius=%.1f lifetime=%.1f\n",
                        at.effect_name, t.position.x(), t.position.y(), t.position.z(), at.anim_radius, at.lifetime);
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
                        vt.vfx_path, t.position.x(), t.position.y(), t.position.z());
                    try {
                        auto preset = load_vfx_preset(path);
                        VfxInstance inst;
                        inst.init(preset, t.position.vec(), true);
                        if (app.vfx_system()) {
                            app.vfx_system()->add_instance(std::move(inst));
                        } else {
                            std::fprintf(stderr,
                                "[VfxTrigger] WARN: vfx_system not initialised\n");
                        }
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
                        t.position.x(), t.position.y(), t.position.z());

                    // Celebration burst — upward shower of colored particles
                    GsEmitterConfig cfg;
                    cfg.position = t.position.vec() + glm::vec3(0, 2.0f, 0);
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
                    app.particle_system()->add_emitter(cfg);

                    // Add a bright celebration light
                    PointLight pl{};
                    pl.position_and_radius = glm::vec4(
                        t.position.x(), t.position.y() + 5.0f, t.position.z(), 25.0f);
                    pl.color = glm::vec4(dz.color_r * 2.0f, dz.color_g * 2.0f, dz.color_b * 2.0f, 1.0f);
                    app.scene().add_light(pl);
                }
            });
    }
}

// ── Walk animation ──

void IslandDemoState::update_walk_animation(AppBase& app, float dt) {
    if (!character_spawned_) return;

    auto* pe = app.bone_animation_registry().get(player_registry_id_);
    if (!pe || !pe->anim_player) return;

    // Set requested clip based on movement speed (if not jumping)
    {
        auto* pj_wa = app.world().try_get<PlayerJump>(player_entity_);
        if (!(pj_wa && pj_wa->active)) {
            float spd = glm::length(glm::vec2(player_velocity_.x, player_velocity_.z));
            pe->requested_clip = spd > 0.1f ? "walk" : "idle";
        }
    }

    // Update entry position and facing
    glm::vec3 ground_pos = character_origin_;
    float jump_y_offset = 0.0f;
    {
        auto* pj = app.world().try_get<PlayerJump>(player_entity_);
        if (pj && pj->active) {
            float t = pj->timer / pj->duration;
            jump_y_offset = 4.0f * pj->height * t * (1.0f - t);
            ground_pos.y -= jump_y_offset;
        }
    }
    pe->current_pos = ground_pos;
    pe->facing_angle = facing_angle_;
    pe->y_offset = jump_y_offset;

    // Root motion consumer
    if (pe->anim_player->current_clip_index() >= 0) {
        const auto& current_clip = pe->character_data->clips[
            pe->anim_player->current_clip_index()];
        if (current_clip.root_motion) {
            glm::vec3 world_delta = character_rotation_ * pe->anim_player->delta_position();
            character_origin_ += world_delta;
            character_rotation_ = glm::normalize(
                character_rotation_ * pe->anim_player->delta_rotation());
            glm::vec3 forward = character_rotation_ * glm::vec3(0.0f, 0.0f, -1.0f);
            facing_angle_ = std::atan2(forward.x, -forward.z);
            pe->current_pos = character_origin_;
            pe->facing_angle = facing_angle_;
        }
    }

    // Actor rotation (for GS preprocess shader)
    app.renderer().gs_renderer().set_actor_rotation(character_rotation_);
}

// ── Environment animation (terrain sway) ──

void IslandDemoState::update_environment_animation(AppBase& /*app*/, float dt) {
    env_anim_time_ += dt;
    // Time accumulation only — the actual terrain sway is applied via bone 0
    // in update_walk_animation, creating visible "movement of the dots" across
    // the entire Gaussian Splatting scene.
}

// ── CPU PBD simulation ──

void IslandDemoState::step_pbd_chain(float dt) {
    // Pin node 0 to follow the player
    pbd_nodes_[0].position = character_origin_ + glm::vec3(3.0f, 8.0f, 0.0f);
    pbd_nodes_[0].prev_position = pbd_nodes_[0].position;

    float ground_y = character_origin_.y - 2.0f;

    // Verlet integration for free nodes
    for (int i = 0; i < kPbdNodeCount; ++i) {
        if (pbd_nodes_[i].inv_mass <= 0.0f) continue;

        glm::vec3 pos = pbd_nodes_[i].position;
        glm::vec3 prev = pbd_nodes_[i].prev_position;
        glm::vec3 vel = (pos - prev) * kPbdDamping;
        glm::vec3 accel(0.0f, kPbdGravity, 0.0f);

        pbd_nodes_[i].prev_position = pos;
        pbd_nodes_[i].position = pos + vel + accel * dt * dt;

        // Ground collision
        if (pbd_nodes_[i].position.y < ground_y) {
            pbd_nodes_[i].position.y = ground_y;
            if (pbd_nodes_[i].prev_position.y > ground_y) {
                pbd_nodes_[i].prev_position.y =
                    ground_y + (pbd_nodes_[i].prev_position.y - ground_y) * 0.3f;
            }
        }
    }

    // Constraint projection
    for (int iter = 0; iter < kPbdIterations; ++iter) {
        for (int li = 0; li < kPbdLinkCount; ++li) {
            const auto& link = pbd_links_[li];
            auto& na = pbd_nodes_[link.a];
            auto& nb = pbd_nodes_[link.b];

            glm::vec3 delta = nb.position - na.position;
            float dist = glm::length(delta);
            if (dist < 1e-6f) continue;

            float error = (dist - link.rest_length) / dist;
            glm::vec3 correction = delta * error * link.stiffness / static_cast<float>(kPbdIterations);

            float w_sum = na.inv_mass + nb.inv_mass;
            if (w_sum < 1e-6f) continue;

            if (na.inv_mass > 0.0f)
                na.position += correction * (na.inv_mass / w_sum);
            if (nb.inv_mass > 0.0f)
                nb.position -= correction * (nb.inv_mass / w_sum);
        }
    }

    // Update velocities
    for (int i = 0; i < kPbdNodeCount; ++i) {
        pbd_nodes_[i].velocity =
            (pbd_nodes_[i].position - pbd_nodes_[i].prev_position) / std::max(dt, 1e-6f);
    }
}

// ── PBD visual gather ──

void IslandDemoState::gather_pbd_chain(AppBase& app) {
    std::vector<Gaussian> buf;
    buf.reserve(120);

    uint32_t seed = 0;

    // --- Orb nodes ---
    for (int ni = 0; ni < kPbdNodeCount; ++ni) {
        const auto& node = pbd_nodes_[ni];
        float speed = glm::length(node.velocity);
        glm::vec3 center = node.position;

        // Core (5 Gaussians)
        for (int i = 0; i < 5; ++i) {
            Gaussian g{};
            g.position = center + det_offset(seed++, 0.1f);
            g.scale = glm::vec3(0.3f);
            g.rotation = glm::quat(1.0f, 0.0f, 0.0f, 0.0f);
            g.color = glm::vec3(1.0f, 0.85f, 0.3f);
            g.opacity = 0.95f;
            g.emission = 3.0f + speed * 0.3f;
            buf.push_back(g);
        }

        // Mid layer (8 Gaussians)
        for (int i = 0; i < 8; ++i) {
            Gaussian g{};
            g.position = center + det_offset(seed++, 0.3f);
            g.scale = glm::vec3(0.5f);
            g.rotation = glm::quat(1.0f, 0.0f, 0.0f, 0.0f);
            g.color = glm::vec3(1.0f, 0.6f, 0.15f);
            g.opacity = 0.7f;
            g.emission = 1.0f;
            buf.push_back(g);
        }

        // Halo (12 Gaussians)
        for (int i = 0; i < 12; ++i) {
            Gaussian g{};
            g.position = center + det_offset(seed++, 0.6f);
            g.scale = glm::vec3(0.9f);
            g.rotation = glm::quat(1.0f, 0.0f, 0.0f, 0.0f);
            g.color = glm::vec3(1.0f, 0.9f, 0.7f);
            g.opacity = 0.25f;
            g.emission = 0.3f;
            buf.push_back(g);
        }
    }

    // --- Rope segments ---
    for (int li = 0; li < kPbdLinkCount; ++li) {
        const auto& link = pbd_links_[li];
        glm::vec3 pa = pbd_nodes_[link.a].position;
        glm::vec3 pb = pbd_nodes_[link.b].position;

        constexpr int kRopeCount = 15;
        for (int i = 0; i < kRopeCount; ++i) {
            float t = static_cast<float>(i + 1) / static_cast<float>(kRopeCount + 1);
            Gaussian g{};
            g.position = glm::mix(pa, pb, t);
            g.scale = glm::vec3(0.15f);
            g.rotation = glm::quat(1.0f, 0.0f, 0.0f, 0.0f);
            g.color = glm::vec3(1.0f, 0.7f, 0.2f);
            g.opacity = 0.6f * (1.0f - 2.0f * std::abs(t - 0.5f));
            g.emission = 0.5f;
            buf.push_back(g);
        }
    }

    if (auto* pbd = app.pbd_system()) {
        pbd->push_splats(buf.data(), buf.size());
    }
}

// ── build_draw_lists (debug HUD) ──

void IslandDemoState::build_draw_lists(AppBase& app) {
    // Gizmos render independently of HUD mode
    draw_gizmos(app);

    // Build debug collider wireframe draw list
    if (app.feature_flags().debug_colliders) {
        auto& debug_colliders = app.draw_lists().debug_colliders;

        auto build_draw_info = [](const ColliderInstance& inst) -> DebugColliderDrawInfo {
            DebugColliderDrawInfo info;
            info.model = glm::translate(glm::mat4(1.0f), inst.world_position) *
                         glm::mat4_cast(inst.world_rotation);

            // Color scheme: yellow for triggers, green for solid
            if (inst.is_trigger) {
                info.color = glm::vec4(0.9f, 0.9f, 0.2f, 0.5f);
            } else {
                info.color = glm::vec4(0.2f, 0.9f, 0.2f, 0.8f);
            }

            // Shape params
            std::visit([&](const auto& shape) {
                using T = std::decay_t<decltype(shape)>;
                if constexpr (std::is_same_v<T, BoxData>) {
                    info.shape_type = ColliderType::Box;
                    info.half_extents = shape.half_extents;
                } else if constexpr (std::is_same_v<T, SphereData>) {
                    info.shape_type = ColliderType::Sphere;
                    info.radius = shape.radius;
                } else if constexpr (std::is_same_v<T, CapsuleData>) {
                    info.shape_type = ColliderType::Capsule;
                    info.radius = shape.radius;
                    info.half_height = shape.half_height;
                }
            }, inst.shape);

            return info;
        };

        for (const auto& inst : collision_system_.static_cache()) {
            debug_colliders.push_back(build_draw_info(inst));
        }
        for (const auto& inst : collision_system_.dynamic_cache()) {
            auto di = build_draw_info(inst);
            di.color = glm::vec4(0.2f, 0.8f, 0.9f, 0.8f);  // cyan for dynamic
            debug_colliders.push_back(di);
        }
    }

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
    float fps_val = app.debug_metrics().fps;
    glm::vec4 fps_color = fps_val >= 30.0f ? green : red;

    // Shared data
    auto& gs = app.renderer().gs_renderer();
    auto& pp = app.renderer().post_process_params();
    auto& ff = app.feature_flags();
    uint32_t gs_total = gs.gaussian_count();
    uint32_t gs_visible = gs.visible_count();
    size_t emitter_count = app.particle_system()->emitters().size();

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

        ui.label(f1(fps_val) + " FPS", x, y, s, fps_color);
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
            ui.label("(" + f1(t->position.x()) + "," + f1(t->position.y()) + "," + f1(t->position.z()) + ")",
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
    ui.label(f1(fps_val) + " FPS", panel_x + panel_w - 65.0f, y, s, fps_color);
    y -= line + section_gap;

    // ── Camera ──
    ui.label("CAMERA", lx, y, s, yellow);
    y -= line;
    auto* transform = app.world().try_get<ecs::Transform>(player_entity_);
    if (transform) {
        ui.label("Position", lx, y, s, dim);
        ui.label(f1(transform->position.x()) + ", " + f1(transform->position.y()) +
                 ", " + f1(transform->position.z()), vx, y, s, white);
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

// ── Debug gizmos (ImGui foreground draw list, same style as Staging) ──

#ifdef GSEURAT_DEV_MODE
namespace {
void imgui_sphere(ImDrawList* dl, const glm::vec3& center, float radius,
                   const glm::mat4& vp, float sw, float sh, ImU32 col) {
    float cx, cy;
    if (!gseurat::project_to_screen(center, vp, sw, sh, cx, cy)) return;
    glm::vec3 edge = center + glm::vec3(radius, 0.0f, 0.0f);
    float ex, ey, sr = 15.0f;
    if (gseurat::project_to_screen(edge, vp, sw, sh, ex, ey))
        sr = std::clamp(std::abs(ex - cx), 3.0f, 300.0f);
    dl->AddCircle(ImVec2(cx, cy), sr, col, 24, 1.5f);
}
void imgui_box(ImDrawList* dl, const glm::vec3& center, const glm::vec3& half,
                const glm::mat4& vp, float sw, float sh, ImU32 col) {
    glm::vec3 c[8]={
        center+glm::vec3(-half.x,-half.y,-half.z),center+glm::vec3(half.x,-half.y,-half.z),
        center+glm::vec3(half.x,half.y,-half.z),  center+glm::vec3(-half.x,half.y,-half.z),
        center+glm::vec3(-half.x,-half.y,half.z), center+glm::vec3(half.x,-half.y,half.z),
        center+glm::vec3(half.x,half.y,half.z),   center+glm::vec3(-half.x,half.y,half.z),
    };
    ImVec2 p[8]; bool v[8];
    for(int i=0;i<8;i++) v[i]=gseurat::project_to_screen(c[i],vp,sw,sh,p[i].x,p[i].y);
    constexpr int e[12][2]={{0,1},{1,2},{2,3},{3,0},{4,5},{5,6},{6,7},{7,4},{0,4},{1,5},{2,6},{3,7}};
    for(auto& ed:e) if(v[ed[0]]&&v[ed[1]]) dl->AddLine(p[ed[0]],p[ed[1]],col,1.0f);
}
void imgui_region(ImDrawList* dl, const gseurat::GsAnimRegion& r, const glm::vec3& off,
                   const glm::mat4& vp, float sw, float sh, ImU32 col) {
    glm::vec3 center = r.center + off;
    if (r.shape == gseurat::GsAnimRegion::Shape::Box)
        imgui_box(dl, center, r.half_extents, vp, sw, sh, col);
    else
        imgui_sphere(dl, center, r.radius, vp, sw, sh, col);
}
}  // anonymous namespace
#endif

void IslandDemoState::draw_gizmos(AppBase& app) {
#ifdef GSEURAT_DEV_MODE
    if (!app.dev_overlay().visible() || !app.renderer().has_gs_cloud()) return;

    const glm::mat4& vp = gizmo_vp_;
    auto& gs = app.renderer().gs_renderer();
    auto& ov = app.dev_overlay();
    auto& io = ImGui::GetIO();
    float sw = io.DisplaySize.x, sh = io.DisplaySize.y;
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
            imgui_sphere(dl, pos, lights[i].position_and_radius.w, vp, sw, sh, col);
            dl->AddCircleFilled(ImVec2(sx, sy), 4.0f, col);
            char label[32]; std::snprintf(label, sizeof(label), "L%zu", i);
            dl->AddText(ImVec2(sx + 6, sy - 12), col, label);
        }
    }

    // ── Emitter gizmos ──
    if (ov.show_gizmo_emitters) {
        ImU32 col = IM_COL32(236, 72, 153, 200);
        auto& emitters = app.particle_system()->emitters();
        for (size_t i = 0; i < emitters.size(); i++) {
            auto& cfg = emitters[i].config();
            float sx, sy;
            if (!project_to_screen(cfg.position, vp, sw, sh, sx, sy)) continue;
            dl->AddCircleFilled(ImVec2(sx, sy), 5.0f, col);
            imgui_region(dl, cfg.spawn_region, cfg.position, vp, sw, sh, col);
            char label[32]; std::snprintf(label, sizeof(label), "E%zu", i);
            dl->AddText(ImVec2(sx + 8, sy - 10), col, label);
        }
    }

    // ── Animation region gizmos ──
    if (ov.show_gizmo_vfx) {
        ImU32 col = IM_COL32(6, 182, 212, 180);
        const auto& anims = app.renderer().gs_scene_animations();
        for (size_t i = 0; i < anims.size(); i++) {
            float sx, sy;
            if (!project_to_screen(anims[i].region.center, vp, sw, sh, sx, sy)) continue;
            imgui_region(dl, anims[i].region, glm::vec3(0.0f), vp, sw, sh, col);
            dl->AddCircleFilled(ImVec2(sx, sy), 3.0f, col);
            char label[64]; std::snprintf(label, sizeof(label), "Anim:%s", anims[i].effect.c_str());
            dl->AddText(ImVec2(sx + 6, sy - 10), col, label);
        }
    }

    // ── Proximity trigger gizmos ──
    if (ov.show_gizmo_triggers) {
        app.world().view<ProximityTrigger, ecs::Transform>().each(
            [&](ecs::Entity e, ProximityTrigger& pt, ecs::Transform& t) {
                // Highlight portal triggers — orange wireframe + target-scene label.
                auto* portal = app.world().try_get<PortalTarget>(e);
                ImU32 col;
                if (portal) {
                    col = pt.triggered ? IM_COL32(255,200,80,220)   // bright orange when firing
                                       : IM_COL32(255,140,0,180);   // orange otherwise
                } else {
                    col = pt.triggered ? IM_COL32(51,255,76,153)
                                       : IM_COL32(128,128,128,100);
                }
                imgui_sphere(dl, t.position.vec(), pt.radius, vp, sw, sh, col);

                // Project center to screen and label portals so you can find them
                if (portal) {
                    glm::vec4 clip = vp * glm::vec4(t.position.vec(), 1.0f);
                    if (clip.w > 0.0f) {
                        glm::vec3 ndc = glm::vec3(clip) / clip.w;
                        float sx = (ndc.x * 0.5f + 0.5f) * sw;
                        float sy = (1.0f - (ndc.y * 0.5f + 0.5f)) * sh;
                        char buf[256];
                        std::snprintf(buf, sizeof(buf), "PORTAL -> %s\nspawn (%.0f,%.0f,%.0f)  r=%.1f",
                            portal->target_scene.c_str(),
                            portal->target_position.x,
                            portal->target_position.y,
                            portal->target_position.z,
                            pt.radius);
                        // shadow + text for legibility
                        dl->AddText(ImVec2(sx + 7, sy + 1), IM_COL32(0,0,0,200), buf);
                        dl->AddText(ImVec2(sx + 6, sy + 0), IM_COL32(255,200,80,255), buf);
                    }
                }
            });
    }

    // ── Collision grid overlay ──
    if (ov.show_gizmo_collision && collision_grid_.width > 0) {
        draw_collision_grid_overlay(dl, collision_grid_, grid_origin_, vp, sw, sh);
    }
#else
    (void)app;
#endif
}

// Demo-specific scene-transition recovery work. Invoked atomically from
// DemoApp::transition_scene (which is itself called by transition_system on
// the SceneOut→Loading boundary, under a fully-opaque overlay).
//
// Equivalent to the inline block previously at island_demo_state.cpp:695-982,
// driven by WorldStreamer::entered_portal_id(). The new ECS scene-transition
// system replaces that trigger with ProximityTrigger+PortalTarget on Game
// Objects (created in on_enter from world.json portals).
void IslandDemoState::perform_portal_transition(AppBase& app,
                                                const std::string& target_scene,
                                                const glm::vec3& target_position) {
    ScopedStallTimer _t_total{"perform_portal_transition (TOTAL)"};
    std::fprintf(stderr, "[IslandDemo] perform_portal_transition -> '%s' at (%.1f,%.1f,%.1f)\n",
        target_scene.c_str(), target_position.x, target_position.y, target_position.z);

    // Hard-stop the world streamer for the entire transition.
    disable_world_streaming_ = true;

    // Muffle/restore music based on destination
    if (auto* ae = app.audio()) {
        const bool entering_dungeon = target_scene.find("dungeon") != std::string::npos;
        ae->set_rtpc(kRtpcMusicFilter, entering_dungeon ? 0.0f : 1.0f);
    }

    // Cancel anything we have a worker thread parsing right now — its
    // result would be a chunk for the SCENE WE'RE LEAVING, which would
    // otherwise get appended to the new scene's GS buffer once the
    // future resolves. Wait blocks (the parse is on a worker), so this
    // is bounded by the longest-in-flight parse, but typically <100ms.
    {
        ScopedStallTimer _t{"perform_portal_transition: drain in-flight chunk parses"};
        for (auto& p : pending_chunk_parses_) {
            if (p.future.valid()) (void)p.future.wait();
        }
        pending_chunk_parses_.clear();
    }

    // Wait for GPU to finish before destroying resources. Then explicitly
    // drop any active GS chunks so the new scene starts from a clean
    // VRAM state — clear_chunks() is also called inside init_gs() but
    // doing it here too defends against any path where the new scene's
    // init_gs is skipped (e.g. has_gs_cloud false on the new scene).
    {
        ScopedStallTimer _t{"perform_portal_transition: wait_idle + drop_chunks"};
        vkDeviceWaitIdle(app.renderer().context().device());
        app.renderer().drop_all_gs_chunks_now();
    }

    // Transition: clear current scene and load instance
    // Clear ECS world first — old game object entities must not persist
    app.world().clear();
    player_entity_ = ecs::kNullEntity;

    app.clear_scene();

    // The original SceneOut SceneTransition entity was destroyed by the
    // app.world().clear() above. Recreate one immediately in SceneIn state
    // with alpha=1.0 so the very next composited frame is fully covered by
    // an opaque overlay. Without this, the window between Phase A and Phase
    // B (which spans the async PLY parse + GPU upload — typically several
    // frames at hundreds of ms) renders against the stale per-frame
    // `processed_image_` contents, exposing residue from the OLD scene
    // (the user-reported "old initial-frame configuration flashes back"
    // ghost). The transition_system holds the alpha at 1.0 until Phase B
    // completes, then animates it down over kFadeIn seconds.
    {
        constexpr float kFadeIn = 0.4f;
        auto e = app.world().create();
        SceneTransition st;
        st.current_state       = SceneTransition::State::SceneIn;
        st.timer               = 0.0f;
        st.transition_duration = kFadeIn;
        st.target_scene        = target_scene;
        st.target_position     = target_position;
        st.load_dispatched     = true;  // we are past Loading
        app.world().add<SceneTransition>(e, st);

        ScreenFade fade;
        fade.alpha            = 1.0f;
        fade.transition_color = glm::vec3(0.0f, 0.0f, 0.0f);
        fade.effect_type      = 0;
        app.world().add<ScreenFade>(e, fade);
    }

    // Kick PLY parse for the new scene on a worker thread. The worker runs
    // while we do the non-cloud-dependent setup (collision grid, camera
    // zones, audio muffling already done above) on the main thread; we
    // block on the future just before the merge needs the cloud. Same shape
    // as `IslandDemoState::on_enter` (PR #417 Option C) — keeps the engine's
    // synchronous double-`init_gs` GPU sequencing intact, which avoids the
    // M5/MoltenVK GPU-Address-Fault that bit the single-`init_gs` async
    // parse-extension approach.
    app.scene_objects().current_scene_path = target_scene;
    auto target_scene_data = SceneLoader::load(target_scene);
    auto parse_future = std::async(std::launch::async, [&target_scene_data] {
        return GsSceneLoader::parse(target_scene_data);
    });

    // ── Non-cloud-dependent setup (overlapped with worker parse) ──

    // "Returning to overworld" detection: target matches our base scene path.
    const bool is_overworld = (target_scene == scene_path_);

    // Reload collision grid from the new scene (already loaded via
    // `target_scene_data` above — no need to re-read from disk).
    {
        if (target_scene_data.collision) {
            collision_grid_ = *target_scene_data.collision;
            grid_origin_ = {0.0f, 0.0f};
            std::fprintf(stderr, "[IslandDemo] Collision grid updated: %ux%u\n",
                collision_grid_.width, collision_grid_.height);
        }

        // When returning to overworld, restore collision patches
        if (is_overworld) {
            // Re-mark house collision (fresh grid from scene doesn't have it)
            float house_x = 192.0f, house_z = 175.0f;
            float house_hw = 8.0f, house_hd = 7.0f;
            for (float wx = house_x - house_hw; wx <= house_x + house_hw; wx += collision_grid_.cell_size * 0.5f) {
                for (float wz = house_z - house_hd; wz <= house_z + house_hd; wz += collision_grid_.cell_size * 0.5f) {
                    int gx = static_cast<int>(wx / collision_grid_.cell_size);
                    int gz = static_cast<int>(wz / collision_grid_.cell_size);
                    if (gx >= 0 && gx < static_cast<int>(collision_grid_.width) &&
                        gz >= 0 && gz < static_cast<int>(collision_grid_.height)) {
                        collision_grid_.solid[gz * collision_grid_.width + gx] = true;
                    }
                }
            }

            // Re-open north bridge
            int bridge_cleared = 0;
            for (float wx = 172.0f; wx <= 212.0f; wx += collision_grid_.cell_size * 0.5f) {
                for (float wz = 0.0f; wz <= 60.0f; wz += collision_grid_.cell_size * 0.5f) {
                    int bgx = static_cast<int>(wx / collision_grid_.cell_size);
                    int bgz = static_cast<int>(wz / collision_grid_.cell_size);
                    if (bgx >= 0 && bgx < static_cast<int>(collision_grid_.width) &&
                        bgz >= 0 && bgz < static_cast<int>(collision_grid_.height)) {
                        size_t idx = bgz * collision_grid_.width + bgx;
                        if (collision_grid_.solid[idx]) {
                            collision_grid_.solid[idx] = false;
                            bridge_cleared++;
                        }
                    }
                }
            }

            auto forest_scene = SceneLoader::load("assets/scenes/northern_forest.json");
            if (forest_scene.collision) {
                forest_collision_grid_ = *forest_scene.collision;
                forest_grid_origin_ = {0.0f, -192.0f};
                forest_grid_loaded_ = true;
            }
            std::fprintf(stderr, "[IslandDemo] Overworld restored: bridge=%d cells, forest grid=%s\n",
                bridge_cleared, forest_grid_loaded_ ? "OK" : "MISSING");
        }
    }

    // Reset camera zone system — island zones are invalid in instances
    app.command_dispatcher().context().camera_zone_system = nullptr;
    app.command_dispatcher().context().collision_system = nullptr;
    camera_zone_system_.reset();

    // Reset camera target to avoid stale smoothing from old scene
    camera_target_ = target_position + glm::vec3(0, kCameraYOffset, 0);

    // Adjust orbit camera for indoor/outdoor scale
    distance_ = 10.0f;
    elevation_ = 0.4f;

    // Teleport player to spawn position
    glm::vec3 spawn = target_position;
    character_origin_ = spawn;
    character_spawn_pos_ = spawn;

    // ── Block on parse, then merge §B BEFORE running finalize_on_main ──
    // Single `init_gs` uploads the merged cloud (new-scene terrain + chunks
    // + character) as one static chunk — see
    // `docs/superpowers/specs/2026-05-09-upfront-merge-single-init-gs-design.md`
    // for the full rationale (avoids the Radix-Sort-corrupting double init_gs
    // and the two-chunks-pre-render publication hazard).
    ParsedScene parsed_scene = parse_future.get();

    // Fast-path detection: when the new scene authors a "player" game_object
    // pointing at the snes_hero PLY, `GsSceneLoader::parse` already merged
    // the player Gaussians into the scene cloud on the worker thread.
    // Phase B's re-merge is then redundant for non-overworld destinations.
    // Read from `parsed_scene.bone_allocations` (equivalent of post-finalize
    // gs_terrain.bone_allocations).
    bool player_already_merged_fast = false;
    for (const auto& alloc : parsed_scene.bone_allocations) {
        if (alloc.manifest_path.find("snes_hero") != std::string::npos) {
            player_already_merged_fast = true;
            break;
        }
    }
    const bool skip_phase_b_remerge = !is_overworld && player_already_merged_fast
                                      && app.renderer().has_gs_cloud();

    // Collected during §B merge below; uploaded to the dynamic SSBO's
    // persistent prefix after `load_pre_parsed_gs_scene`.
    std::vector<Gaussian> portal_persistent_dynamics;

    // ── §B upfront merge ──
    // Builds the full parsed-terrain + chunks + character cloud on the CPU
    // and replaces parsed_scene.cloud. Mutates parsed_scene.bone_allocations
    // + bone_slot_counter so finalize_on_main propagates them into gs_terrain.
    // ECS entity creation for chunk-scope game_objects happens here —
    // finalize_on_main only touches the main scene's snapped_objects.
    if (!skip_phase_b_remerge && app.renderer().has_gs_cloud()) {
        std::vector<Gaussian> merged = parsed_scene.cloud.gaussians();

        // When returning to overworld, re-merge all world chunks
        if (is_overworld && world_streamer_) {
            for (const auto& chunk : world_streamer_->manifest().chunks) {
                if (chunk.grid == glm::ivec3(0, 0, 0)) continue;
                if (chunk.ply_file.empty()) continue;
                auto resolved = resolve_asset_path(chunk.ply_file);
                auto extra = GaussianCloud::load_with_gsvx_first(resolved.string());
                if (!extra.empty()) {
                    const auto& gs = extra.gaussians();
                    merged.insert(merged.end(), gs.begin(), gs.end());
                    std::fprintf(stderr, "[IslandDemo] Re-merged chunk [%d,%d,%d]: +%u Gaussians\n",
                        chunk.grid.x, chunk.grid.y, chunk.grid.z, extra.count());

                    // Process chunk scene game objects (NPCs)
                    if (!chunk.scene_file.empty()) {
                        auto chunk_scene = SceneLoader::load(chunk.scene_file);
                        AABB chunk_aabb = extra.bounds();
                        for (const auto& go : chunk_scene.game_objects) {
                            glm::vec3 world_pos = go.position.vec() + chunk_aabb.min;
                            // Snap Y to terrain via heightfield
                            for (const auto& hf : collision_system_.heightfield_cache()) {
                                auto h = sample_height(hf, world_pos.x, world_pos.z);
                                if (h) { world_pos.y = *h; break; }
                            }
                            if (!go.ply_file.empty() && !go.components.is_null()
                                && go.components.contains("BoneAnimated")) {
                                auto npc_cloud = GaussianCloud::load_with_gsvx_first(go.ply_file);
                                if (!npc_cloud.empty()) {
                                    const auto& ba_json = go.components["BoneAnimated"];
                                    std::string manifest_path = ba_json.value("manifest", std::string{});
                                    uint32_t bone_count = 0;
                                    { std::ifstream mf(manifest_path);
                                      if (mf.is_open()) {
                                          auto mj = nlohmann::json::parse(mf, nullptr, false);
                                          if (!mj.is_discarded() && mj.contains("bones"))
                                              bone_count = static_cast<uint32_t>(mj["bones"].size());
                                      }
                                    }
                                    uint32_t first_bone = parsed_scene.bone_slot_counter;
                                    if (bone_count > 0 && first_bone + bone_count <= 32) {
                                        parsed_scene.bone_slot_counter += bone_count;
                                        GsTerrainState::BoneAllocation alloc;
                                        alloc.manifest_path = manifest_path;
                                        alloc.default_clip = ba_json.value("default_clip", std::string{"idle"});
                                        alloc.first_bone_index = first_bone;
                                        alloc.bone_count = bone_count;
                                        alloc.char_scale = go.scale;
                                        alloc.gs_scale_multiplier = gs_scale_;
                                        alloc.world_pos = world_pos;
                                        alloc.game_object_index = 9999;
                                        parsed_scene.bone_allocations.push_back(alloc);
                                        glm::vec3 lmin(1e9f), lmax(-1e9f);
                                        for (const auto& g : npc_cloud.gaussians()) {
                                            lmin = glm::min(lmin, g.position);
                                            lmax = glm::max(lmax, g.position);
                                        }
                                        glm::vec3 lctr = (lmin + lmax) * 0.5f;
                                        lctr.y = lmin.y;
                                        auto xf = glm::translate(glm::mat4(1.0f), world_pos);
                                        xf = glm::rotate(xf, glm::radians(go.rotation.x), {1,0,0});
                                        xf = glm::rotate(xf, glm::radians(go.rotation.y), {0,1,0});
                                        xf = glm::rotate(xf, glm::radians(go.rotation.z), {0,0,1});
                                        xf = glm::scale(xf, glm::vec3(go.scale));
                                        xf = glm::translate(xf, -lctr);
                                        glm::mat3 rm(xf);
                                        for (const auto& g : npc_cloud.gaussians()) {
                                            Gaussian ng = g;
                                            ng.position = glm::vec3(xf * glm::vec4(ng.position, 1.0f));
                                            ng.scale *= go.scale;
                                            ng.bone_index = first_bone + ng.bone_index;
                                            ng.opacity = std::min(1.0f, ng.opacity * 1.3f);
                                            glm::quat rq(rm);
                                            glm::quat oq(ng.rotation[0], ng.rotation[1], ng.rotation[2], ng.rotation[3]);
                                            glm::quat nq = rq * oq;
                                            ng.rotation = {nq.w, nq.x, nq.y, nq.z};
                                            merged.push_back(ng);
                                        }
                                    }
                                }
                            }
                            if (!go.components.is_null() && !go.components.empty()) {
                                auto entity = app.world().create();
                                app.world().add<ecs::Transform>(entity,
                                    {coord::WorldPos(world_pos), {go.scale, go.scale}});
                                for (auto& [name, data] : go.components.items())
                                    app.component_registry().attach(app.world(), entity, name, data);
                            }
                        }
                    }
                }
            }
            // Mark chunks as loaded so WorldStreamer::update() doesn't issue
            // a redundant load_cloud_async for them on the next tick (which
            // is append-only and would duplicate every tree/NPC/spawn-PC).
            // Also mark them externally-managed so distance transitions are
            // fully suppressed (#399).
            for (const auto& chunk : world_streamer_->manifest().chunks) {
                std::string key = std::to_string(chunk.grid.x) + "," +
                                  std::to_string(chunk.grid.y) + "," +
                                  std::to_string(chunk.grid.z);
                world_streamer_->on_chunk_loaded(key, 0);
                world_streamer_->mark_chunk_externally_managed(key);
            }
            // Restore overworld camera settings
            distance_ = 20.0f;
            elevation_ = 0.6f;
        }

        // Skip the manual PC PLY merge if the parser already merged the
        // player from a "player" game_object. Adding it again here would
        // duplicate the splats and produce a side-by-side ghost-PC whenever
        // target_position differs from the authored position. Re-checking
        // against parsed_scene.bone_allocations because the chunk loop
        // above may have just appended entries.
        bool player_already_merged = false;
        for (const auto& alloc : parsed_scene.bone_allocations) {
            if (alloc.manifest_path.find("snes_hero") != std::string::npos) {
                player_already_merged = true;
                break;
            }
        }
        if (!player_already_merged) {
            auto char_cloud = GaussianCloud::load_with_gsvx_first(
                "assets/characters/snes_hero/snes_hero.ply");
            if (!char_cloud.empty()) {
                const auto& char_gs = char_cloud.gaussians();
                for (const auto& g : char_gs) {
                    Gaussian cg = g;
                    glm::vec3 rotated(-cg.position.x, cg.position.y, -cg.position.z);
                    glm::vec3 offset = rotated * kCharScale;
                    offset.y *= gs_scale_;
                    cg.position = spawn + offset + glm::vec3(0, 2.0f, 0);
                    cg.scale *= kCharScale;
                    cg.opacity = std::min(1.0f, cg.opacity * 1.3f);
                    cg.bone_index = cg.bone_index + 1;
                    merged.push_back(cg);
                }
            }
        }
        std::fprintf(stderr, "[IslandDemo] Portal re-merge: %u total Gaussians%s\n",
            static_cast<uint32_t>(merged.size()),
            player_already_merged ? " (player from game_object)" : "");

        parsed_scene.cloud = GaussianCloud::from_gaussians(std::move(merged));
    }

    // Split-tail partition (Option A — applies whether §B re-merge ran or
    // skip_phase_b_remerge took the parser-merged path):
    //   bone_index == 0  → static (terrain + tree trunks + non-animated props)
    //   bone_index >  0  → persistent dynamic (PBD-tagged tree leaves +
    //                       bone-animated chars/NPCs)
    {
        const auto& cloud_g = parsed_scene.cloud.gaussians();
        std::vector<Gaussian> static_only;
        static_only.reserve(cloud_g.size());
        for (const auto& g : cloud_g) {
            if (g.bone_index > 0) {
                portal_persistent_dynamics.push_back(g);
            } else {
                static_only.push_back(g);
            }
        }
        std::fprintf(stderr,
            "[IslandDemo] Portal partition: static=%zu persistent_dyn=%zu (total=%zu)\n",
            static_only.size(), portal_persistent_dynamics.size(), cloud_g.size());
        parsed_scene.cloud = GaussianCloud::from_gaussians(std::move(static_only));
    }

    {
        GsSceneOptions portal_opts;
        portal_opts.add_default_light = true;
        portal_opts.set_god_rays = true;
        app.load_pre_parsed_gs_scene(target_scene_data,
                                     std::move(parsed_scene), portal_opts);
    }

    // Upload persistent dynamics. set_persistent_dynamics replaces the entire
    // dynamic prefix; passing count=0 clears any prior scene's prefix so it
    // doesn't render alongside the new one.
    app.renderer().gs_renderer().set_persistent_dynamics(
        portal_persistent_dynamics.empty() ? nullptr : portal_persistent_dynamics.data(),
        static_cast<uint32_t>(portal_persistent_dynamics.size()));

    // The new scene's "player" game_object (when present, e.g. seurat_island)
    // is wired up by `load_pre_parsed_gs_scene` above: PlayerController,
    // PlayerTag, BoneAnimated, KinematicBody, ColliderComponent — and its PLY is
    // merged into the new scene cloud at the *authored* position. Reuse that
    // entity, teleport it to `spawn`, and skip the manual merge below to avoid
    // a second PC entity + a second copy of the splats (which appears as a
    // collision-less ghost at the authored position when target_position
    // differs from the authored one — the dungeon-return spawn does).
    //
    // For scenes without a player game_object (interior instances etc.), fall
    // back to creating one manually — same shape as the on_enter legacy path.
    player_entity_ = ecs::kNullEntity;
    app.world().view<PlayerController, PlayerTag, ecs::Transform>().each(
        [&](ecs::Entity e, PlayerController&, PlayerTag&, ecs::Transform& t) {
            player_entity_ = e;
            t.position = coord::WorldPos(spawn);
        });
    if (!player_entity_.valid()) {
        player_entity_ = app.world().create();
        app.world().add<ecs::Transform>(player_entity_,
            {coord::WorldPos(spawn), {1.0f, 1.0f}});
        app.world().add<PlayerController>(player_entity_, {20.0f, 20.0f});
        app.world().add<PlayerJump>(player_entity_);
        app.world().add<PlayerTag>(player_entity_);

        KinematicBody kb;
        kb.desired_jump_height = 2.0f;
        kb.time_to_apex = 0.4f;
        kb.recompute_derived();
        app.world().add<KinematicBody>(player_entity_, kb);

        ColliderComponent cc;
        cc.shape = CapsuleData{0.3f, 0.5f};
        cc.is_dynamic = true;
        app.world().add<ColliderComponent>(player_entity_, cc);
    }

    // Teleport the load_gs_scene-allocated player bone slot's anchor so the
    // PLY splats follow the entity to `spawn`. Without this, the splats stay
    // at the authored bone-allocation world_pos forever (load_gs_scene only
    // sets it once at scene-load time).
    for (auto& alloc : app.gs_terrain().bone_allocations) {
        if (alloc.manifest_path.find("snes_hero") != std::string::npos) {
            alloc.world_pos = spawn;
        }
    }

    // The §B merge ran upstream of `load_pre_parsed_gs_scene` (above);
    // the chunk re-mark + camera restoration also happened inside that
    // moved block. Nothing more to do for §B here.

    // Arm the engine loading monitor with the slab-upload handles from the
    // single init_gs above so the engine state machine gates GPU compute
    // (`should_dispatch_gpu_work`) until the new scene's uploads have
    // drained. Without this, the next frame after this function returns
    // would dispatch GS compute against in-flight slab buffers — exactly
    // the corruption / page-fault hazard the loading-state gate exists to
    // prevent. `take_pending_load_handles` returns the handles from the
    // most recent `init_gs` (either `load_pre_parsed_gs_scene` above or the
    // §B re-merge call if it ran), so this covers both branches.
    // (`on_enter`'s path is armed by `DemoApp::run` immediately after
    // `state_stack_.push` returns; portal transitions happen mid-frame
    // and have no analogous post-call hook.)
    app.loading_monitor().begin_load(app.renderer().take_pending_load_handles());

    // Re-populate bone animation registry for the new scene. When the new
    // scene has a "player" game_object, this binds the player's bone slot
    // to player_entity_ — no second register needed below (a second add()
    // would create a duplicate entry, animating empty bone slots).
    populate_bone_animation_registry(app.bone_animation_registry(), app.world(), app.gs_terrain());

    // Capture the registry_id populated above (or, fallback path, register
    // the player manually for scenes that don't author a player game_object).
    if (auto* existing = app.bone_animation_registry().get_by_entity(player_entity_)) {
        // populate_bone_animation_registry already wired the player.
        for (const auto& [id, entry] : app.bone_animation_registry().entries()) {
            if (&entry == existing) { player_registry_id_ = id; break; }
        }
        if (!app.world().has<gseurat::BoneAnimatedTag>(player_entity_)) {
            app.world().add<gseurat::BoneAnimatedTag>(player_entity_, {player_registry_id_});
        }
    } else {
        auto loaded = gseurat::load_character_manifest(
            "assets/characters/snes_hero/snes_hero.manifest.json");
        if (loaded) {
            auto pcd = std::make_unique<gseurat::CharacterData>(std::move(*loaded));
            gseurat::BoneAnimationEntry player_entry;
            player_entry.manifest_path = "assets/characters/snes_hero/snes_hero.manifest.json";
            player_entry.default_clip = "idle";
            player_entry.first_bone_index = 1;
            player_entry.bone_count = static_cast<uint32_t>(pcd->bones.size());
            player_entry.char_scale = kCharScale;
            player_entry.gs_scale_multiplier = gs_scale_;
            player_entry.spawn_pos = spawn;
            player_entry.current_pos = spawn;
            player_entry.character_data = std::move(pcd);
            player_entry.anim_player = std::make_unique<gseurat::BoneAnimationPlayer>(
                *player_entry.character_data);
            player_entry.anim_sm = std::make_unique<gseurat::BoneAnimationStateMachine>(
                *player_entry.anim_player);
            for (const auto& clip : player_entry.character_data->clips) {
                player_entry.anim_sm->add_state(clip.name, clip.name);
            }
            player_entry.anim_sm->set_state("idle");
            player_entry.initialized = true;
            player_registry_id_ = app.bone_animation_registry().add(
                player_entity_, std::move(player_entry));
            app.world().add<gseurat::BoneAnimatedTag>(player_entity_,
                {player_registry_id_});
        }
    }

    // Rebuild collision system cache for the new scene
    collision_system_.rebuild_cache(app.world());

    // Re-enable world streaming only when the destination is the overworld
    // AND we've gotten through the merged init_gs + chunk re-mark. For
    // any non-overworld destination (dungeon, instanced interiors) the
    // flag stays TRUE — the dungeon doesn't have streamed chunks, and
    // leaving the streamer dormant means no rogue parses against the
    // dungeon player position.
    if (is_overworld) {
        disable_world_streaming_ = false;
        std::fprintf(stderr, "[IslandDemo] World streaming re-enabled (overworld)\n");
    } else {
        std::fprintf(stderr, "[IslandDemo] World streaming disabled (non-overworld scene)\n");
    }

    // Note: the SceneIn fade entity is created near the top of this
    // function (after `app.world().clear()`), so the very next composited
    // frame is fully covered by an opaque overlay. The transition_system
    // animates it out once we return.

    std::fprintf(stderr, "[IslandDemo] Spawned at (%.1f, %.1f, %.1f)\n",
        spawn.x, spawn.y, spawn.z);
}

// ── Async chunk parsing ───────────────────────────────────────────────
// PLY parsing is hundreds-of-MB-of-mmap-and-vector-fill expensive. Doing
// it on the main thread shows up as a 200-800ms beachball whenever a new
// chunk crosses the streamer's load_radius_. std::async with launch::async
// pushes it onto a worker thread; drain_async_chunk_loads polls the
// future once per frame and only touches the GPU once the parse is done.

void IslandDemoState::enqueue_async_chunk_load(const std::string& grid_key,
                                               const std::string& ply_path,
                                               uint64_t frame_index) {
    // Skip if a parse is already in flight for this key (the streamer will
    // re-emit `pending_loads_` keys until we tell it the chunk is loaded).
    for (const auto& p : pending_chunk_parses_) {
        if (p.grid_key == grid_key) return;
    }
    PendingChunkParse entry;
    entry.grid_key = grid_key;
    entry.future = std::async(std::launch::async, [ply_path]() {
        GaussianCloud c;
        c.load_with_gsvx_first(ply_path);
        return c;
    });
    entry.requested_at = std::chrono::steady_clock::now();
    entry.requested_frame = frame_index;
    pending_chunk_parses_.push_back(std::move(entry));
#if GSEURAT_DEBUG_BUILD
    std::fprintf(stderr,
        "[streaming] frame=%llu chunk=%s event=load_request\n",
        static_cast<unsigned long long>(frame_index), grid_key.c_str());
#else
    (void)frame_index;
#endif
}

void IslandDemoState::drain_async_chunk_loads(AppBase& app) {
    // Sweep ready futures, consume their clouds, and hand them to the
    // existing async-upload pipe. Anything still parsing stays in the
    // queue for next frame.
#if GSEURAT_DEBUG_BUILD
    const uint64_t frame_index = app.tick();
#endif
    for (auto it = pending_chunk_parses_.begin();
         it != pending_chunk_parses_.end(); ) {
        if (it->future.wait_for(std::chrono::seconds(0)) ==
            std::future_status::ready) {
            ScopedStallTimer _t{"chunk_parse_drain+load_cloud_async"};
            GaussianCloud cloud;
            try {
                cloud = it->future.get();
            } catch (const std::exception& e) {
                std::fprintf(stderr,
                    "[IslandDemo] Chunk [%s] async parse FAILED: %s\n",
                    it->grid_key.c_str(), e.what());
#if GSEURAT_DEBUG_BUILD
                double took_ms = std::chrono::duration<double, std::milli>(
                    std::chrono::steady_clock::now() - it->requested_at).count();
                std::fprintf(stderr,
                    "[streaming] frame=%llu chunk=%s event=parse_failed "
                    "requested_frame=%llu took=%.2fms\n",
                    static_cast<unsigned long long>(frame_index),
                    it->grid_key.c_str(),
                    static_cast<unsigned long long>(it->requested_frame),
                    took_ms);
#endif
                it = pending_chunk_parses_.erase(it);
                continue;
            }
            if (!cloud.empty()) {
                app.renderer().gs_renderer().load_cloud_async(std::move(cloud));
                if (world_streamer_) {
                    world_streamer_->on_chunk_loaded(it->grid_key, 0);
                }
                std::fprintf(stderr,
                    "[IslandDemo] Chunk [%s] async parse done, queued for VRAM\n",
                    it->grid_key.c_str());
#if GSEURAT_DEBUG_BUILD
                double took_ms = std::chrono::duration<double, std::milli>(
                    std::chrono::steady_clock::now() - it->requested_at).count();
                std::fprintf(stderr,
                    "[streaming] frame=%llu chunk=%s event=parse_complete "
                    "requested_frame=%llu took=%.2fms\n",
                    static_cast<unsigned long long>(frame_index),
                    it->grid_key.c_str(),
                    static_cast<unsigned long long>(it->requested_frame),
                    took_ms);
#endif
            }
            it = pending_chunk_parses_.erase(it);
        } else {
            ++it;
        }
    }
}

}  // namespace gseurat
