#pragma once

#include "gseurat/engine/ecs/world.hpp"

#include <glm/glm.hpp>

#include <string>

namespace gseurat {

/// Abstract host for the transition system. AppBase implements this;
/// tests provide a fake to avoid Vulkan dependencies.
///
/// `transition_scene` is invoked atomically from `transition_system` on the
/// SceneOut→Loading boundary, under a fully-opaque overlay. Implementations
/// are responsible for:
///   - clearing all current scene state (ECS world, bone registry, GPU resources)
///   - loading the new scene
///   - placing the player at `target_position`
///   - any host-specific recovery (collision grids, camera state, etc.)
///
/// This is intentionally one method (rather than separate clear/init/set_player)
/// because portal transitions are atomic: you can't move the player to an
/// entity that doesn't exist between clear and load.
struct ITransitionHost {
    virtual void transition_scene(const std::string& target_scene,
                                  const glm::vec3& target_position) = 0;
    virtual ~ITransitionHost() = default;
};

/// Advances any entities with both SceneTransition and ScreenFade by dt.
/// On the first Loading tick (right after SceneOut completes), invokes
/// host.transition_scene(target_scene, target_position).
/// Destroys the transient entity when SceneIn completes.
void transition_system(ecs::World& world, ITransitionHost& host, float dt);

}  // namespace gseurat
