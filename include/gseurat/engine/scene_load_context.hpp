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
namespace systems { class VfxSystem; }

struct SceneLoadContext {
    GsTerrainState& terrain;
    SceneObjectState& scene_objects;
    Renderer& renderer;
    Scene& scene;
    ecs::World& world;
    ComponentRegistry& components;
    ResourceManager& resources;
    const FeatureFlags& feature_flags;
    // Phase 4c-vfx-2: VFX spawn target. Null is tolerated (scene load
    // without VfxSystem skips VFX instances rather than crashing).
    systems::VfxSystem* vfx_system = nullptr;
};

}  // namespace gseurat
