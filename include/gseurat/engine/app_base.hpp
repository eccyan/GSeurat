#pragma once

#include "gseurat/engine/async_loader.hpp"
#include "gseurat/engine/audio_system.hpp"
#ifndef _WIN32
#include "gseurat/engine/control_server.hpp"
#endif
#include "gseurat/engine/collision_gen.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/day_night_system.hpp"
#include "gseurat/engine/dialog.hpp"
#include "gseurat/engine/direction.hpp"
#include "gseurat/engine/ecs/default_components.hpp"
#include "gseurat/engine/ecs/ecs.hpp"
#include "gseurat/engine/feature_flags.hpp"
#include "gseurat/engine/font_atlas.hpp"
#include "gseurat/engine/game_state.hpp"
#include "gseurat/engine/input_manager.hpp"
#include "gseurat/engine/locale_manager.hpp"
#include "gseurat/engine/minimap.hpp"
#include "gseurat/engine/particle.hpp"
#include "gseurat/engine/renderer.hpp"
#include "gseurat/engine/resource_manager.hpp"
#include "gseurat/engine/save_system.hpp"
#include "gseurat/engine/gs_parallax_camera.hpp"
#include "gseurat/engine/scene_loader.hpp"
#include "gseurat/engine/staging_uploader.hpp"
#include "gseurat/engine/scene.hpp"
#include "gseurat/engine/screen_effects.hpp"
#include "gseurat/engine/weather_system.hpp"
#include "gseurat/engine/text_renderer.hpp"
#include "gseurat/engine/types.hpp"
#include "gseurat/engine/ui/ui_context.hpp"

#include <chrono>
#include <cstdint>
#include <functional>
#include <vector>

namespace gseurat {

class AppBase {
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

    // Game state
    enum class GameMode  { Explore, Dialog };
    GameMode game_mode() const { return game_mode_; }
    void set_game_mode(GameMode m) { game_mode_ = m; }
    DialogState& dialog_state() { return dialog_state_; }
    const std::vector<DialogScript>& npc_dialogs() const { return npc_dialogs_; }

    // Per-frame draw lists (populated by states, consumed by render)
    std::vector<SpriteDrawInfo>& overlay_sprites() { return overlay_sprites_; }
    std::vector<SpriteDrawInfo>& ui_sprites() { return ui_sprites_; }
    std::vector<SpriteDrawInfo>& entity_sprites() { return entity_sprites_; }

    // Game flags (used by save system and scripts)
    std::unordered_map<std::string, bool>& game_flags() { return game_flags_; }
    float play_time() const { return play_time_; }

    // Save/load helpers (virtual — game overrides)
    virtual SaveData build_save_data() const;
    virtual void apply_save_data(const SaveData& data);

    // Public methods used by states (virtual — game overrides)
    virtual void init_scene(const std::string& scene_path);
    virtual void clear_scene();

    // Shared GS scene loading: PLY + placed objects + lights + emitters + animations + VFX
    struct GsSceneOptions {
        bool add_default_light;
        bool set_god_rays;
    };
    void load_gs_scene(const SceneData& scene_data, const GsSceneOptions& opts = {false, false});
    virtual void update_game(float dt);
    virtual void update_audio(float dt);

    // Scene transition support
    const std::string& current_scene_path() const { return current_scene_path_; }
    void set_current_scene_path(const std::string& path) { current_scene_path_ = path; }
    bool is_transitioning() const { return transitioning_; }
    void set_transitioning(bool t) { transitioning_ = t; }

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

    // Screen effects accessor
    ScreenEffects& screen_effects() { return screen_effects_; }

    // GS parallax accessors
    void set_gs_parallax_active(bool active) { gs_parallax_active_ = active; }
    GsParallaxCamera& gs_parallax_camera() { return gs_parallax_camera_; }

    // Async loading accessors
    AsyncLoader& async_loader() { return async_loader_; }
    StagingUploader& staging_uploader() { return staging_uploader_; }

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
    std::vector<SpriteDrawInfo> entity_sprites_;
    std::vector<SpriteDrawInfo> outline_sprites_;
    std::vector<SpriteDrawInfo> shadow_sprites_;
    std::vector<SpriteDrawInfo> reflection_sprites_;

    // UI context
    ui::UIContext ui_ctx_;

    // Dialog & i18n
    GameMode game_mode_ = GameMode::Explore;
    LocaleManager locale_;
    FontAtlas font_atlas_;
    TextRenderer text_renderer_;
    DialogState dialog_state_;
    std::vector<DialogScript> npc_dialogs_;

    // Gaussian splatting collision grid (when using GS scenes instead of tilemap)
    CollisionGrid collision_grid_;

    // Parallax camera for shadow-box GS effect
    GsParallaxCamera gs_parallax_camera_;
    bool gs_parallax_active_ = false;
    uint32_t gs_frame_counter_ = 0;
    uint32_t gs_render_interval_ = 4;
    glm::vec2 gs_last_compute_offset_{0.0f};

    // Scene transition
    std::string current_scene_path_ = "assets/scenes/test_scene.json";
    std::vector<PortalData> portals_;
    bool transitioning_ = false;

    // Scene data storage for round-trip serialization (kept in sync with ECS)
    std::vector<NpcData> scene_npc_data_;
    std::vector<PointLight> static_lights_;

    // Particles & Weather
    ParticleSystem particles_;
    size_t torch_emitter_ids_[4]{};
    WeatherSystem weather_system_;
    DayNightSystem day_night_system_;

    // Screen effects
    ScreenEffects screen_effects_;

    // Minimap
    Minimap minimap_;
    std::vector<SpriteDrawInfo> minimap_sprites_;

    // Audio
    AudioSystem audio_;
    float footstep_timer_ = 0.0f;
    bool was_moving_ = false;

    // Save system
    SaveSystem save_system_;
    std::unordered_map<std::string, bool> game_flags_;
    float play_time_ = 0.0f;

    // Control server (bridge integration)
#ifndef _WIN32
    ControlServer control_server_;
#endif
    virtual void dispatch_command(const nlohmann::json& cmd, nlohmann::json& response);
    void poll_control_server();

    // GS scene AABB offset (voxel→world coordinate transform)
    glm::vec2 gs_aabb_offset_{0.0f};

    // Step mode / control
    bool step_mode_ = false;
    int pending_steps_ = 0;
    uint64_t tick_ = 0;
    static constexpr float kFixedDt = 1.0f / 60.0f;
    std::string screenshot_response_path_;

    // Per-frame draw lists built in update_game, consumed by draw_scene
    std::vector<SpriteDrawInfo> overlay_sprites_;
    std::vector<SpriteDrawInfo> ui_sprites_;

    // Async asset loading
    AsyncLoader async_loader_;
    StagingUploader staging_uploader_;
};

}  // namespace gseurat
