#pragma once

#include <atomic>
#include <chrono>
#include <cstdint>
#include <functional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

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
namespace systems { class VfxSystem; class ParticleSystem; }
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

    // Synchronously drain pending VfxSpawnEvents so they land in
    // renderer.vfx_instances_ immediately. Used by commands that read
    // vfx_instances_ in the same poll cycle as a preceding
    // update_scene_data (e.g. update_vfx_positions), where the normal
    // main-loop drain would happen too late and the position update
    // would silently no-op against an empty vector. Phase 4a wiring;
    // may be null when no VfxSystem is registered.
    std::function<void()> drain_pending_vfx_spawns;

    ControlServer* control_server = nullptr;
    bool camera_sync_override = false;
    std::string camera_sync_source;  // source of last sync_camera command for echo suppression
    CameraZoneSystem* camera_zone_system = nullptr;
    CollisionSystem* collision_system = nullptr;

    // Phase 4c-vfx-2: VFX commands talk to VfxSystem, not Renderer.
    // Null only in test harnesses without an AppBase.
    systems::VfxSystem* vfx_system = nullptr;
    // Phase 4e: emitter add/clear and emitter-count reads go through
    // ParticleSystem. Same nullable contract.
    systems::ParticleSystem* particle_system = nullptr;

    // Step-mode: set by the "step" command; main loop consumes one per frame.
    // Non-null only when AppBase wires it up (demo/gameplay path). Atomic so
    // the field is safe if socket I/O is ever moved off the main thread.
    std::atomic<int>* pending_steps = nullptr;

    // Deferred response state for synchronous "step N". The step command
    // captures the current reply target and N here, returns a sentinel that
    // suppresses immediate response, and the main loop sends the response
    // after pending_steps reaches 0. Cleared (target = -1) when no step is
    // in flight.
    //
    // bridge_id replays the request's _bridge_id correlation key through to
    // the completion response. Bridge clients treat unkeyed responses as
    // unsolicited broadcasts, so without this, deferred step completions
    // would be misrouted when multiple clients share a connection.
    struct DeferredStepResponse {
        std::int64_t reply_target = -1;  // ControlServer::ReplyTarget; -1 = none
        int frames_total = 0;
        nlohmann::json bridge_id = nullptr;  // null => no _bridge_id was set

        // Per-frame wall-clock duration (ms) for each stepped frame. Filled in
        // by the main loop as each step frame completes. Sent to the harness
        // alongside frames_completed so single-frame spikes (e.g. chunk-load
        // stalls) are not smeared by the existing 60-frame averager.
        //
        // First entry is measured from `last_step_frame_end` (set to "now" at
        // step-command issue time), not from the previous unrelated frame —
        // pre-step idle may be unbounded.
        std::vector<double> per_frame_ms;
        std::chrono::high_resolution_clock::time_point last_step_frame_end{};
    };
    DeferredStepResponse* deferred_step_response = nullptr;
};

}  // namespace gseurat
