#pragma once

#include "gseurat/engine/async_loader.hpp"
#include "gseurat/engine/audio_system.hpp"
#include "gseurat/engine/component_registry.hpp"
#include "gseurat/engine/system_scheduler.hpp"
#include "gseurat/engine/control_server.hpp"
#include "gseurat/engine/collision_gen.hpp"
#include "gseurat/engine/command_context.hpp"
#include "gseurat/engine/command_dispatcher.hpp"
#include "gseurat/engine/dev_overlay.hpp"
#include "gseurat/engine/coordinate.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/gs_scene_loader.hpp"
#include "gseurat/engine/day_night_system.hpp"
#include "gseurat/engine/dialog.hpp"
#include "gseurat/engine/direction.hpp"
#include "gseurat/engine/draw_lists.hpp"
#include "gseurat/engine/ecs/default_components.hpp"
#include "gseurat/engine/ecs/ecs.hpp"
#include "gseurat/engine/feature_flags.hpp"
#include "gseurat/engine/gs_scene_loader.hpp"
#include "gseurat/engine/font_atlas.hpp"
#include "gseurat/engine/game_state.hpp"
#include "gseurat/engine/gameplay_state.hpp"
#include "gseurat/engine/gs_terrain_state.hpp"
#include "gseurat/engine/bone_animation_registry.hpp"
#include "gseurat/engine/input_manager.hpp"
#include "gseurat/engine/locale_manager.hpp"
#include "gseurat/engine/minimap.hpp"
#include "gseurat/engine/particle.hpp"
#include "gseurat/engine/renderer.hpp"
#include "gseurat/engine/resource_manager.hpp"
#include "gseurat/engine/save_system.hpp"
#include "gseurat/engine/gs_parallax_camera.hpp"
#include "gseurat/engine/scene_loader.hpp"
#include "gseurat/engine/scene_object_state.hpp"
#include "gseurat/engine/staging_uploader.hpp"
#include "gseurat/engine/scene.hpp"
#include "gseurat/engine/screen_effects.hpp"
#include "gseurat/engine/systems/transition_system.hpp"
#include "gseurat/engine/weather_system.hpp"
#include "gseurat/engine/text_renderer.hpp"
#include "gseurat/engine/types.hpp"
#include "gseurat/engine/ui/ui_context.hpp"

#include <chrono>
#include <cstdint>
#include <functional>
#include <vector>

namespace gseurat {

struct DebugMetrics {
    float fps = 0.0f;
    float frame_times[300]{};
    int frame_time_idx = 0;
    int frame_count = 0;
    float timer = 0.0f;
    static constexpr float kUpdateInterval = 0.5f;

    void update(float dt) {
        frame_count++;
        timer += dt;
        if (timer >= kUpdateInterval) {
            fps = static_cast<float>(frame_count) / timer;
            frame_count = 0;
            timer = 0.0f;
        }
        frame_times[frame_time_idx] = dt * 1000.0f;
        frame_time_idx = (frame_time_idx + 1) % 300;
    }
};

class AppBase : public ITransitionHost {
public:
    virtual ~AppBase() = default;

    virtual void run();

    // Subsystem accessors (used by GameStates)
    InputManager& input() { return input_; }
    Renderer& renderer() { return renderer_; }
    ResourceManager& resources() { return resources_; }
    Scene& scene() { return scene_; }
    ecs::World& world() { return world_; }
    AudioSystem& audio() { return audio_; }
    SaveSystem& save_system() { return save_system_; }
    ParticleSystem& particles() { return particles_; }
    LocaleManager& locale() { return locale_; }
    FontAtlas& font_atlas() { return font_atlas_; }
    TextRenderer& text_renderer() { return text_renderer_; }
    ui::UIContext& ui_ctx() { return ui_ctx_; }
    GameStateStack& state_stack() { return state_stack_; }
    GLFWwindow* window() { return window_; }

    // ECS entity accessors
    ecs::Entity player_id() const { return player_id_; }
    const std::vector<ecs::Entity>& npc_ids() const { return npc_ids_; }

    // State object accessors
    GsTerrainState& gs_terrain() { return gs_terrain_; }
    const GsTerrainState& gs_terrain() const { return gs_terrain_; }
    SceneObjectState& scene_objects() { return scene_objects_; }
    const SceneObjectState& scene_objects() const { return scene_objects_; }
    DrawLists& draw_lists() { return draw_lists_; }
    const DrawLists& draw_lists() const { return draw_lists_; }
    BoneAnimationRegistry& bone_animation_registry() { return bone_anim_registry_; }
    [[nodiscard]] const BoneAnimationRegistry& bone_animation_registry() const { return bone_anim_registry_; }
    GameplayState& gameplay() { return gameplay_; }
    const GameplayState& gameplay() const { return gameplay_; }

    // Save/load helpers (virtual — game overrides)
    virtual SaveData build_save_data() const;
    virtual void apply_save_data(const SaveData& data);

    // Public methods used by states (virtual — game overrides)
    void init_scene(const std::string& scene_path) override;
    void set_player_position(const glm::vec3& pos) override;
    void clear_scene() override;

    // Shared GS scene loading: PLY + placed objects + lights + emitters + animations + VFX
    void load_gs_scene(const SceneData& scene_data, const GsSceneOptions& opts = {});
    virtual void update_game(float dt);
    void upload_bone_transforms();
    virtual void update_audio(float dt);

    // Audio state
    float& footstep_timer() { return footstep_timer_; }
    bool& was_moving() { return was_moving_; }

    // Step mode
    bool step_mode() const { return step_mode_; }
    uint64_t tick() const { return tick_; }

    // Torch emitters
    size_t (&torch_emitter_ids())[4] { return torch_emitter_ids_; }

    // Feature flags
    FeatureFlags& feature_flags() { return feature_flags_; }
    const FeatureFlags& feature_flags() const { return feature_flags_; }

    // Allow custom start state (e.g. DemoApp skips TitleState)
    void set_start_state(std::unique_ptr<GameState> state);

    // Weather system accessor
    WeatherSystem& weather_system() { return weather_system_; }

    // Day/night system accessor
    DayNightSystem& day_night_system() { return day_night_system_; }

    // Debug metrics accessor
    DebugMetrics& debug_metrics() { return debug_metrics_; }
    const DebugMetrics& debug_metrics() const { return debug_metrics_; }

    // Developer overlay accessor
    DevOverlay& dev_overlay() { return dev_overlay_; }
    const DevOverlay& dev_overlay() const { return dev_overlay_; }

    // Bone pre-upload hook (e.g., terrain sway on bone 0)
    void set_bone_pre_upload_hook(std::function<void(glm::mat4*, uint32_t)> hook) {
        bone_pre_upload_hook_ = std::move(hook);
    }

    // Screen effects accessor
    ScreenEffects& screen_effects() { return screen_effects_; }

    // Async loading accessors
    AsyncLoader& async_loader() { return async_loader_; }
    StagingUploader& staging_uploader() { return staging_uploader_; }

    // Game object system accessors
    ComponentRegistry& component_registry() { return component_registry_; }
    SystemScheduler& system_scheduler() { return system_scheduler_; }

    // Command dispatch
    CommandDispatcher& command_dispatcher() { return command_dispatcher_; }

    // Pending character load (set by load_character command, consumed by StagingState)
    std::string pending_character_path;  // non-empty = load request pending

protected:
    void init_window();
    virtual void init_game_content();
    virtual void main_loop();
    virtual void cleanup();

    GLFWwindow* window_ = nullptr;
    ResourceManager resources_;
    Renderer renderer_;
    InputManager input_;
    Scene scene_;
    std::chrono::steady_clock::time_point last_update_time_;

    // Feature flags
    FeatureFlags feature_flags_;
    std::unique_ptr<GameState> custom_start_state_;

    // Game state stack
    GameStateStack state_stack_;

    // ECS
    ecs::World world_;
    ecs::Entity player_id_ = ecs::kNullEntity;
    std::vector<ecs::Entity> npc_ids_;

    // UI context
    ui::UIContext ui_ctx_;

    // i18n
    LocaleManager locale_;
    FontAtlas font_atlas_;
    TextRenderer text_renderer_;

    // State objects (replacing scattered members)
    GsTerrainState gs_terrain_;
    BoneAnimationRegistry bone_anim_registry_;
    SceneObjectState scene_objects_;
    DrawLists draw_lists_;
    GameplayState gameplay_;

    std::vector<PointLight> static_lights_;

    // Particles & Weather
    ParticleSystem particles_;
    size_t torch_emitter_ids_[4]{};
    WeatherSystem weather_system_;
    DayNightSystem day_night_system_;

    // Screen effects
    ScreenEffects screen_effects_;

    // Debug metrics
    DebugMetrics debug_metrics_;

    // Bone pre-upload hook
    std::function<void(glm::mat4*, uint32_t)> bone_pre_upload_hook_;

    // Developer overlay
    DevOverlay dev_overlay_;

    // Minimap
    Minimap minimap_;

    // Audio
    AudioSystem audio_;
    float footstep_timer_ = 0.0f;
    bool was_moving_ = false;

    // Save system
    SaveSystem save_system_;

    // ── Command dispatch (C++23 Command Pattern) ──
    CommandContext build_command_context();
    CommandDispatcher command_dispatcher_{build_command_context()};
    void poll_control_server();

    // Control server (bridge integration — Unix socket or Windows Named Pipe)
    ControlServer control_server_;

    // Step mode / control
    bool step_mode_ = false;
    int pending_steps_ = 0;
    uint64_t tick_ = 0;
    static constexpr float kFixedDt = 1.0f / 60.0f;
    std::string screenshot_response_path_;

    // Async asset loading
    AsyncLoader async_loader_;
    StagingUploader staging_uploader_;

    // Game object system
    ComponentRegistry component_registry_;
    SystemScheduler system_scheduler_;
    void init_game_object_system();
};

}  // namespace gseurat
