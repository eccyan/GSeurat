#include "vulkan_game/game/systems.hpp"
#include "vulkan_game/engine/ecs/default_components.hpp"
#include "vulkan_game/engine/ecs/ecs.hpp"
#include "vulkan_game/engine/direction.hpp"
#include "vulkan_game/engine/pathfinder.hpp"
#include "vulkan_game/engine/sprite_batch.hpp"
#include "vulkan_game/game/components.hpp"

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

#include <string>

namespace vulkan_game::ecs::systems {

constexpr float kYSortScale = 0.01f;

PlayerMoveResult player_movement(World& world, InputManager& input, float dt) {
    PlayerMoveResult result;

    const bool w = input.is_key_down(GLFW_KEY_W);
    const bool a = input.is_key_down(GLFW_KEY_A);
    const bool s = input.is_key_down(GLFW_KEY_S);
    const bool d = input.is_key_down(GLFW_KEY_D);
    result.moving = w || a || s || d;
    result.sprinting = result.moving && input.is_key_down(GLFW_KEY_LEFT_SHIFT);

    const float speed = result.sprinting ? 8.0f : 4.0f;

    world.view<Transform, PlayerTag, Facing>().each(
        [&](Entity, Transform& tf, PlayerTag&, Facing& facing) {
            if (w) tf.position.y -= speed * dt;
            if (s) tf.position.y += speed * dt;
            if (a) tf.position.x -= speed * dt;
            if (d) tf.position.x += speed * dt;

            if (result.moving) {
                if (d)      facing.dir = Direction::Right;
                else if (a) facing.dir = Direction::Left;
                else if (w) facing.dir = Direction::Up;
                else        facing.dir = Direction::Down;
            }
        });

    return result;
}

void player_collision(World& world, const TileLayer& layer) {
    world.view<Transform, PlayerTag>().each(
        [&](Entity, Transform& tf, PlayerTag&) {
            const glm::vec2 resolved = resolve_tilemap_collision(
                {tf.position.x, tf.position.y}, 0.4f, layer);
            tf.position.x = resolved.x;
            tf.position.y = resolved.y;
        });
}

void npc_patrol(World& world, const TileLayer& layer, float dt) {
    world.view<Transform, NpcPatrol, Facing, Animation>().each(
        [&](Entity, Transform& tf, NpcPatrol& patrol, Facing& facing, Animation& anim) {
            const float prev_x = tf.position.x;
            const float prev_y = tf.position.y;

            switch (patrol.dir) {
                case Direction::Down:  tf.position.y += patrol.speed * dt; break;
                case Direction::Left:  tf.position.x -= patrol.speed * dt; break;
                case Direction::Right: tf.position.x += patrol.speed * dt; break;
                case Direction::Up:    tf.position.y -= patrol.speed * dt; break;
            }

            const glm::vec2 resolved = resolve_tilemap_collision(
                {tf.position.x, tf.position.y}, 0.4f, layer);
            tf.position.x = resolved.x;
            tf.position.y = resolved.y;

            const float ddx = tf.position.x - prev_x;
            const float ddy = tf.position.y - prev_y;
            const bool blocked = (ddx * ddx + ddy * ddy) < (0.001f * 0.001f);

            patrol.timer += dt;
            if (blocked || patrol.timer >= patrol.interval) {
                std::swap(patrol.dir, patrol.reverse_dir);
                patrol.timer = 0.0f;
            }

            facing.dir = patrol.dir;

            const std::string clip = std::string("walk_") + direction_suffix(patrol.dir);
            anim.state_machine.transition_to(clip);
        });
}

void animation_update(World& world, float dt) {
    world.view<Animation, Sprite>().each(
        [&](Entity, Animation& anim, Sprite& sprite) {
            anim.state_machine.update(dt);
            sprite.uv_min = anim.state_machine.current_uv_min();
            sprite.uv_max = anim.state_machine.current_uv_max();
        });
}

void lighting_rebuild(World& world, Scene& scene, bool include_npc_lights, float torch_intensity_mul) {
    scene.clear_lights();

    // Static pillar torches (z=3.0 light height above sprite plane)
    glm::vec4 warm_color{1.0f, 0.85f, 0.5f, 1.2f * torch_intensity_mul};
    const float pillar_radius = 4.0f;
    scene.add_light(PointLight{{-3.5f,  3.5f, 3.0f, pillar_radius}, warm_color});
    scene.add_light(PointLight{{ 3.5f,  3.5f, 3.0f, pillar_radius}, warm_color});
    scene.add_light(PointLight{{-3.5f, -3.5f, 3.0f, pillar_radius}, warm_color});
    scene.add_light(PointLight{{ 3.5f, -3.5f, 3.0f, pillar_radius}, warm_color});

    // Dynamic NPC lights (z=2.0 light height)
    if (include_npc_lights) {
        world.view<Transform, DynamicLight>().each(
            [&](Entity, Transform& tf, DynamicLight& light) {
                scene.add_light(PointLight{
                    {tf.position.x, tf.position.y, 2.0f, light.radius},
                    light.color});
            });
    }
}

void particle_sync(World& world, ParticleSystem& particles, bool footstep_active) {
    // Sync footstep emitter
    world.view<Transform, PlayerTag, FootstepEmitterRef>().each(
        [&](Entity, Transform& tf, PlayerTag&, FootstepEmitterRef& ref) {
            particles.set_emitter_active(ref.emitter_id, footstep_active);
            particles.set_emitter_position(ref.emitter_id,
                                           {tf.position.x, tf.position.y});
        });

    // Sync NPC aura emitters
    world.view<Transform, ParticleEmitterRef>().each(
        [&](Entity, Transform& tf, ParticleEmitterRef& ref) {
            particles.set_emitter_position(ref.emitter_id,
                                           {tf.position.x, tf.position.y});
        });
}

void sprite_collect(World& world, std::vector<SpriteDrawInfo>& out, bool y_sort) {
    out.clear();
    world.view<Transform, Sprite>().each(
        [&](Entity, Transform& tf, Sprite& sprite) {
            SpriteDrawInfo info{};
            info.position = tf.position;
            if (y_sort) {
                info.position.z = -tf.position.y * kYSortScale;
            }
            info.size = tf.scale;
            info.color = sprite.tint;
            info.uv_min = sprite.uv_min;
            info.uv_max = sprite.uv_max;
            out.push_back(info);
        });
}

void shadow_collect(World& world, std::vector<SpriteDrawInfo>& out, bool y_sort) {
    out.clear();
    world.view<Transform, Sprite>().each(
        [&](Entity, Transform& tf, Sprite&) {
            SpriteDrawInfo info{};
            float z = y_sort ? 0.5f + (-tf.position.y * kYSortScale) : 0.5f;
            info.position = {tf.position.x, tf.position.y - 0.35f, z};
            info.size = {tf.scale.x * 1.2f, tf.scale.y * 0.3f};
            info.color = {0.0f, 0.0f, 0.0f, 0.35f};
            info.uv_min = {0.0f, 0.0f};
            info.uv_max = {1.0f, 1.0f};
            out.push_back(info);
        });
}

void reflection_collect(World& world, const TileLayer& layer, std::vector<SpriteDrawInfo>& out, bool y_sort) {
    out.clear();

    // Build list of water tile center positions (base tile ID 2)
    constexpr uint16_t kWaterBaseTile = 2;
    std::vector<glm::vec2> water_positions;
    for (uint32_t row = 0; row < layer.height; ++row) {
        for (uint32_t col = 0; col < layer.width; ++col) {
            uint16_t tile_id = layer.tiles[row * layer.width + col];
            if (tile_id == kWaterBaseTile) {
                float x = (static_cast<float>(col) + 0.5f) * layer.tile_size
                          - static_cast<float>(layer.width) * layer.tile_size * 0.5f;
                float y = (static_cast<float>(row) + 0.5f) * layer.tile_size
                          - static_cast<float>(layer.height) * layer.tile_size * 0.5f;
                water_positions.push_back({x, y});
            }
        }
    }

    if (water_positions.empty()) return;

    constexpr float kMaxDist = 1.5f;
    constexpr float kMaxDistSq = kMaxDist * kMaxDist;

    world.view<Transform, Sprite>().each(
        [&](Entity, Transform& tf, Sprite& sprite) {
            // Find nearest water tile
            float best_dist_sq = kMaxDistSq;
            glm::vec2 best_water{0.0f, 0.0f};
            bool found = false;

            for (const auto& wp : water_positions) {
                float dx = tf.position.x - wp.x;
                float dy = tf.position.y - wp.y;
                float dist_sq = dx * dx + dy * dy;
                if (dist_sq < best_dist_sq) {
                    best_dist_sq = dist_sq;
                    best_water = wp;
                    found = true;
                }
            }

            if (!found) return;

            SpriteDrawInfo info{};
            // Y-mirror across water surface
            float z = y_sort ? 0.9f + (-tf.position.y * kYSortScale) : 0.9f;
            info.position = {tf.position.x, 2.0f * best_water.y - tf.position.y, z};
            info.size = tf.scale;
            // Flip UV vertically
            info.uv_min = {sprite.uv_min.x, sprite.uv_max.y};
            info.uv_max = {sprite.uv_max.x, sprite.uv_min.y};
            // Blue wash, semi-transparent
            info.color = sprite.tint * glm::vec4{0.4f, 0.6f, 0.9f, 0.35f};
            out.push_back(info);
        });
}

void outline_collect(World& world, std::vector<SpriteDrawInfo>& out, float outline_expand, bool y_sort) {
    out.clear();
    world.view<Transform, Sprite>().each(
        [&](Entity, Transform& tf, Sprite& sprite) {
            SpriteDrawInfo info{};
            float z = y_sort ? -tf.position.y * kYSortScale : 0.0f;
            info.position = {tf.position.x, tf.position.y, z + 0.001f};  // slightly behind entity
            info.size = {tf.scale.x + outline_expand, tf.scale.y + outline_expand};

            // Expand UVs proportionally to cover extra texels at edges
            glm::vec2 uv_range = sprite.uv_max - sprite.uv_min;
            float expand_u = (outline_expand / tf.scale.x) * uv_range.x * 0.5f;
            float expand_v = (outline_expand / tf.scale.y) * uv_range.y * 0.5f;
            info.uv_min = {sprite.uv_min.x - expand_u, sprite.uv_min.y - expand_v};
            info.uv_max = {sprite.uv_max.x + expand_u, sprite.uv_max.y + expand_v};

            // Pack original UV bounds into color for shader clamping
            info.color = {sprite.uv_min.x, sprite.uv_min.y, sprite.uv_max.x, sprite.uv_max.y};
            out.push_back(info);
        });
}

void npc_pathfind(World& world, const TileLayer& layer, float dt) {
    world.view<Transform, NpcWaypoints, Facing, Animation>().each(
        [&](Entity, Transform& tf, NpcWaypoints& wp, Facing& facing, Animation& anim) {
            if (wp.waypoints.empty()) return;

            // Recompute path if needed
            if (wp.needs_repath) {
                glm::vec2 pos{tf.position.x, tf.position.y};
                wp.path = Pathfinder::find_path(layer, pos, wp.waypoints[wp.current_target]);
                wp.path_index = 0;
                wp.needs_repath = false;
            }

            // Arrived at end of path (or no path)
            if (wp.path.empty() || wp.path_index >= static_cast<uint32_t>(wp.path.size())) {
                wp.pause_timer -= dt;
                if (wp.pause_timer <= 0.0f) {
                    wp.current_target = (wp.current_target + 1) %
                        static_cast<uint32_t>(wp.waypoints.size());
                    wp.needs_repath = true;
                    wp.pause_timer = wp.pause_duration;
                }

                // Play idle animation while paused
                const std::string clip = std::string("idle_") + direction_suffix(facing.dir);
                anim.state_machine.transition_to(clip);
                return;
            }

            // Move toward current path waypoint
            glm::vec2 target = wp.path[wp.path_index];
            float dx = target.x - tf.position.x;
            float dy = target.y - tf.position.y;
            float dist = std::sqrt(dx * dx + dy * dy);

            if (dist < 0.15f) {
                wp.path_index++;
                return;
            }

            float move = wp.speed * dt;
            if (move > dist) move = dist;
            tf.position.x += (dx / dist) * move;
            tf.position.y += (dy / dist) * move;

            // Collision
            const glm::vec2 resolved = resolve_tilemap_collision(
                {tf.position.x, tf.position.y}, 0.4f, layer);
            tf.position.x = resolved.x;
            tf.position.y = resolved.y;

            // Update facing based on dominant axis
            if (std::abs(dx) >= std::abs(dy)) {
                facing.dir = dx > 0.0f ? Direction::Right : Direction::Left;
            } else {
                facing.dir = dy > 0.0f ? Direction::Down : Direction::Up;
            }

            const std::string clip = std::string("walk_") + direction_suffix(facing.dir);
            anim.state_machine.transition_to(clip);
        });
}

}  // namespace vulkan_game::ecs::systems
