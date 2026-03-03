#pragma once

#include "vulkan_game/engine/audio_system.hpp"
#include "vulkan_game/engine/control_server.hpp"
#include "vulkan_game/engine/dialog.hpp"
#include "vulkan_game/engine/direction.hpp"
#include "vulkan_game/engine/ecs/ecs.hpp"
#include "vulkan_game/engine/ecs/components.hpp"
#include "vulkan_game/engine/ecs/systems.hpp"
#include "vulkan_game/engine/font_atlas.hpp"
#include "vulkan_game/engine/input_manager.hpp"
#include "vulkan_game/engine/locale_manager.hpp"
#include "vulkan_game/engine/particle.hpp"
#include "vulkan_game/engine/renderer.hpp"
#include "vulkan_game/engine/scene.hpp"
#include "vulkan_game/engine/text_renderer.hpp"
#include "vulkan_game/engine/types.hpp"

#include <chrono>
#include <cstdint>
#include <vector>

namespace vulkan_game {

class App {
public:
    void run();

private:
    void init_window();
    void init_scene();
    void update_game(float dt);
    void update_audio(float dt);
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

    enum class GameMode  { Explore, Dialog };

    GLFWwindow* window_ = nullptr;
    Renderer renderer_;
    InputManager input_;
    Scene scene_;
    std::chrono::steady_clock::time_point last_update_time_;

    // ECS
    ecs::World world_;
    ecs::Entity player_id_ = ecs::kNullEntity;
    std::vector<ecs::Entity> npc_ids_;
    std::vector<SpriteDrawInfo> entity_sprites_;

    // Phase 10: Dialog & i18n
    GameMode game_mode_ = GameMode::Explore;
    LocaleManager locale_;
    FontAtlas font_atlas_;
    TextRenderer text_renderer_;
    DialogState dialog_state_;
    std::vector<DialogScript> npc_dialogs_;

    // Phase 12: Particles
    ParticleSystem particles_;
    size_t torch_emitter_ids_[4]{};

    // Phase 13: Audio
    AudioSystem audio_;
    float footstep_timer_ = 0.0f;
    bool was_moving_ = false;

    // Phase 14: Control server
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
