#pragma once

#include <functional>
#include <string>

struct GLFWwindow;

namespace gseurat {

struct GsTerrainState;
struct SceneObjectState;
class Renderer;
class Scene;
namespace ecs { class World; }
class ComponentRegistry;
class InputManager;
class DebugDumpRegistry;
class ControlServer;
struct FeatureFlags;
class CameraZoneSystem;
class CollisionSystem;
struct CommandContext {
    const GsTerrainState& terrain;
    SceneObjectState& scene_objects;
    Renderer& renderer;
    Scene& scene;
    ecs::World& world;
    ComponentRegistry& components;
    InputManager& input;
    FeatureFlags& feature_flags;
    GLFWwindow*& window;

    DebugDumpRegistry& debug_dump_registry;

    std::function<void(const std::string&)> reload_music;  // optional: reload music_config.json

    std::function<void(const std::string&)> init_scene;
    std::function<void()> clear_scene;
    std::function<void(const std::string&)> load_character;  // optional: for staging animation preview

    ControlServer* control_server = nullptr;
    bool camera_sync_override = false;
    std::string camera_sync_source;  // source of last sync_camera command for echo suppression
    CameraZoneSystem* camera_zone_system = nullptr;
    CollisionSystem* collision_system = nullptr;
};

}  // namespace gseurat
