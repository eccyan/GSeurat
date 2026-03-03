#include "vulkan_game/engine/ecs/systems.hpp"
#include "vulkan_game/engine/ecs/components.hpp"
#include "vulkan_game/engine/ecs/ecs.hpp"
#include "vulkan_game/engine/direction.hpp"
#include "vulkan_game/engine/sprite_batch.hpp"

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

#include <string>

namespace vulkan_game::ecs::systems {

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
            if (w) tf.position.y += speed * dt;
            if (s) tf.position.y -= speed * dt;
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
                case Direction::Down:  tf.position.y -= patrol.speed * dt; break;
                case Direction::Left:  tf.position.x -= patrol.speed * dt; break;
                case Direction::Right: tf.position.x += patrol.speed * dt; break;
                case Direction::Up:    tf.position.y += patrol.speed * dt; break;
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

void lighting_rebuild(World& world, Scene& scene) {
    scene.clear_lights();

    // Static pillar torches
    const glm::vec4 warm_color{1.0f, 0.85f, 0.5f, 1.2f};
    const float pillar_radius = 4.0f;
    scene.add_light(PointLight{{-3.5f,  3.5f, 0.0f, pillar_radius}, warm_color});
    scene.add_light(PointLight{{ 3.5f,  3.5f, 0.0f, pillar_radius}, warm_color});
    scene.add_light(PointLight{{-3.5f, -3.5f, 0.0f, pillar_radius}, warm_color});
    scene.add_light(PointLight{{ 3.5f, -3.5f, 0.0f, pillar_radius}, warm_color});

    // Dynamic NPC lights
    world.view<Transform, DynamicLight>().each(
        [&](Entity, Transform& tf, DynamicLight& light) {
            scene.add_light(PointLight{
                {tf.position.x, tf.position.y, 0.0f, light.radius},
                light.color});
        });
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

void sprite_collect(World& world, std::vector<SpriteDrawInfo>& out) {
    out.clear();
    world.view<Transform, Sprite>().each(
        [&](Entity, Transform& tf, Sprite& sprite) {
            SpriteDrawInfo info{};
            info.position = tf.position;
            info.size = tf.scale;
            info.color = sprite.tint;
            info.uv_min = sprite.uv_min;
            info.uv_max = sprite.uv_max;
            out.push_back(info);
        });
}

}  // namespace vulkan_game::ecs::systems
