#pragma once

#include "gseurat/engine/ecs/world.hpp"

#include <glm/glm.hpp>

#include <string>

namespace gseurat {

/// Abstract host for the transition system. AppBase implements this;
/// tests provide a fake to avoid Vulkan dependencies.
struct ITransitionHost {
    virtual void init_scene(const std::string& path) = 0;
    virtual void set_player_position(const glm::vec3& pos) = 0;
    virtual ~ITransitionHost() = default;
};

/// Advances any SceneTransition entities in the world by dt.
/// On FadeOut->Loading, invokes host.init_scene() then host.set_player_position().
/// Destroys the transient entity when FadeIn completes.
void transition_system(ecs::World& world, ITransitionHost& host, float dt);

}  // namespace gseurat
