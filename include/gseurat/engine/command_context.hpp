#pragma once

#include <atomic>
#include <cstdint>
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

    // Step-mode: set by the "step" command; main loop consumes one per frame.
    // Non-null only when AppBase wires it up (demo/gameplay path). Atomic so
    // the field is safe if socket I/O is ever moved off the main thread.
    std::atomic<int>* pending_steps = nullptr;

    // Deferred response state for synchronous "step N". The step command
    // captures the current reply target and N here, returns a sentinel that
    // suppresses immediate response, and the main loop sends the response
    // after pending_steps reaches 0. Cleared (target = -1) when no step is
    // in flight.
    struct DeferredStepResponse {
        std::int64_t reply_target = -1;  // ControlServer::ReplyTarget; -1 = none
        int frames_total = 0;
    };
    DeferredStepResponse* deferred_step_response = nullptr;
};

}  // namespace gseurat
