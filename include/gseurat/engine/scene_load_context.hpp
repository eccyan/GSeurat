#pragma once

namespace gseurat {

struct GsTerrainState;
struct SceneObjectState;
class Renderer;
class Scene;
namespace ecs { class World; }
class ComponentRegistry;
class ResourceManager;
struct FeatureFlags;

struct SceneLoadContext {
    GsTerrainState& terrain;
    SceneObjectState& scene_objects;
    Renderer& renderer;
    Scene& scene;
    ecs::World& world;
    ComponentRegistry& components;
    ResourceManager& resources;
    const FeatureFlags& feature_flags;
};

}  // namespace gseurat
