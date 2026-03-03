#pragma once

#include "vulkan_game/engine/animation_state_machine.hpp"
#include "vulkan_game/engine/audio_system.hpp"
#include "vulkan_game/engine/dialog.hpp"
#include "vulkan_game/engine/font_atlas.hpp"
#include "vulkan_game/engine/input_manager.hpp"
#include "vulkan_game/engine/locale_manager.hpp"
#include "vulkan_game/engine/particle.hpp"
#include "vulkan_game/engine/renderer.hpp"
#include "vulkan_game/engine/scene.hpp"
#include "vulkan_game/engine/text_renderer.hpp"
#include "vulkan_game/engine/types.hpp"

#include <chrono>

namespace vulkan_game {

class App {
public:
    void run();

private:
    void init_window();
    void init_scene();
    void update_game(float dt);
    void update_npcs(float dt);
    void update_lights();
    void update_particles(float dt);
    void update_audio(float dt);
    void main_loop();
    void cleanup();
    static void generate_player_sheet();
    static void generate_tileset();
    static void generate_particle_atlas();
    static void generate_audio_assets();

    enum class Direction { Down, Left, Right, Up };
    enum class GameMode  { Explore, Dialog };

    struct NpcAgent {
        Entity* entity       = nullptr;
        AnimationStateMachine anim;
        Direction dir        = Direction::Right;
        Direction reverse_dir = Direction::Left;
        float timer          = 0.0f;
        float interval       = 2.0f;
        float speed          = 1.5f;
        size_t dialog_index  = 0;
    };

    GLFWwindow* window_ = nullptr;
    Renderer renderer_;
    InputManager input_;
    Scene scene_;
    Entity* player_entity_ = nullptr;
    AnimationStateMachine player_anim_;
    Direction player_dir_ = Direction::Down;
    std::vector<NpcAgent> npcs_;
    std::chrono::steady_clock::time_point last_update_time_;

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
    size_t footstep_emitter_id_ = 0;
    size_t npc_aura_emitter_ids_[3]{};

    // Phase 13: Audio
    AudioSystem audio_;
    float footstep_timer_ = 0.0f;
    bool was_moving_ = false;

    // Per-frame draw lists built in update_game, consumed by draw_scene
    std::vector<SpriteDrawInfo> overlay_sprites_;
    std::vector<SpriteDrawInfo> ui_sprites_;
};

}  // namespace vulkan_game
