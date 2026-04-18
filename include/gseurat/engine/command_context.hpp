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
struct FeatureFlags;
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

    std::function<void(const std::string&)> reload_music;  // optional: reload music_config.json

    std::function<void(const std::string&)> init_scene;
    std::function<void()> clear_scene;
    std::function<void(const std::string&)> load_character;  // optional: for staging animation preview
};

}  // namespace gseurat
