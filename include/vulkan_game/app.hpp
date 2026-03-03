#pragma once

#include "vulkan_game/engine/audio_system.hpp"
#include "vulkan_game/engine/control_server.hpp"
#include "vulkan_game/engine/dialog.hpp"
#include "vulkan_game/engine/direction.hpp"
#include "vulkan_game/engine/ecs/default_components.hpp"
#include "vulkan_game/engine/ecs/ecs.hpp"
#include "vulkan_game/engine/font_atlas.hpp"
#include "vulkan_game/engine/game_state.hpp"
#include "vulkan_game/engine/input_manager.hpp"
#include "vulkan_game/engine/locale_manager.hpp"
#include "vulkan_game/engine/particle.hpp"
#include "vulkan_game/engine/renderer.hpp"
#include "vulkan_game/engine/resource_manager.hpp"
#include "vulkan_game/engine/save_system.hpp"
#include "vulkan_game/engine/scene.hpp"
#include "vulkan_game/engine/text_renderer.hpp"
#include "vulkan_game/engine/types.hpp"
#include "vulkan_game/engine/ui/ui_context.hpp"
#include "vulkan_game/game/components.hpp"
#include "vulkan_game/game/systems.hpp"

#include <chrono>
#include <cstdint>
#include <vector>

namespace vulkan_game {

class App {
public:
    void run();

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
    ControlServer& control_server() { return control_server_; }
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

    // Save/load helpers
    SaveData build_save_data() const;
    void apply_save_data(const SaveData& data);

    // Public methods used by states
    void init_scene();
    void update_game(float dt);
    void update_audio(float dt);

    // Audio state
    float& footstep_timer() { return footstep_timer_; }
    bool& was_moving() { return was_moving_; }

    // Step mode
    bool step_mode() const { return step_mode_; }
    uint64_t tick() const { return tick_; }

    // Torch emitters
    size_t (&torch_emitter_ids())[4] { return torch_emitter_ids_; }

private:
    void init_window();
    void main_loop();
    void cleanup();
    void process_commands();
    nlohmann::json build_state_json() const;
    nlohmann::json build_map_json() const;
    void emit_event(const std::string& event, const nlohmann::json& data = {});
    static void generate_player_sheet();
    static void generate_tileset();
    static void generate_particle_atlas();
    static void generate_audio_assets();

    GLFWwindow* window_ = nullptr;
    ResourceManager resources_;
    Renderer renderer_;
    InputManager input_;
    Scene scene_;
    std::chrono::steady_clock::time_point last_update_time_;

    // Game state stack
    GameStateStack state_stack_;

    // ECS
    ecs::World world_;
    ecs::Entity player_id_ = ecs::kNullEntity;
    std::vector<ecs::Entity> npc_ids_;
    std::vector<SpriteDrawInfo> entity_sprites_;

    // UI context
    ui::UIContext ui_ctx_;

    // Dialog & i18n
    GameMode game_mode_ = GameMode::Explore;
    LocaleManager locale_;
    FontAtlas font_atlas_;
    TextRenderer text_renderer_;
    DialogState dialog_state_;
    std::vector<DialogScript> npc_dialogs_;

    // Particles
    ParticleSystem particles_;
    size_t torch_emitter_ids_[4]{};

    // Audio
    AudioSystem audio_;
    float footstep_timer_ = 0.0f;
    bool was_moving_ = false;

    // Save system
    SaveSystem save_system_;
    std::unordered_map<std::string, bool> game_flags_;
    float play_time_ = 0.0f;

    // Control server
    ControlServer control_server_;
    bool step_mode_ = false;
    int pending_steps_ = 0;
    uint64_t tick_ = 0;
    static constexpr float kFixedDt = 1.0f / 60.0f;

    // Per-frame draw lists built in update_game, consumed by draw_scene
    std::vector<SpriteDrawInfo> overlay_sprites_;
    std::vector<SpriteDrawInfo> ui_sprites_;
};

}  // namespace vulkan_game
