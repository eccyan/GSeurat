#pragma once

#include "gseurat/engine/ecs/world.hpp"

#include <glm/glm.hpp>

#include <string>

namespace gseurat {

/// Abstract host for the transition system. AppBase implements this;
/// tests provide a fake to avoid Vulkan dependencies.
struct ITransitionHost {
    /// Clear all scene state (ECS world, bone registry, etc.) before loading a new scene.
    /// Called by transition_system on FadeOut→Loading, immediately before init_scene().
    virtual void clear_scene() = 0;
    virtual void init_scene(const std::string& path) = 0;
    virtual void set_player_position(const glm::vec3& pos) = 0;
    virtual ~ITransitionHost() = default;
};

/// Advances any entities with both SceneTransition and ScreenFade by dt.
/// On the first Loading tick (right after FadeOut completes), invokes
/// host.clear_scene(), then host.init_scene(), then host.set_player_position().
/// Destroys the transient entity when FadeIn completes.
void transition_system(ecs::World& world, ITransitionHost& host, float dt);

}  // namespace gseurat
