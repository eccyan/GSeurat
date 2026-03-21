#pragma once

#include "vulkan_game/engine/app_base.hpp"
#ifndef _WIN32
#include "vulkan_game/engine/control_server.hpp"
#endif
#include "vulkan_game/game/components.hpp"
#include "vulkan_game/game/systems.hpp"

namespace vulkan_game {

class App : public AppBase {
public:
    void run() override;

    // ControlServer accessor
#ifndef _WIN32
    ControlServer& control_server() { return control_server_; }
#endif

    // Override virtual methods from AppBase
    SaveData build_save_data() const override;
    void apply_save_data(const SaveData& data) override;

    void init_scene(const std::string& scene_path) override;
    void clear_scene() override;
    void update_game(float dt) override;
    void update_audio(float dt) override;

protected:
    void init_game_content() override;
    void main_loop() override;
    void cleanup() override;

private:
    // process_commands and handlers (Unix only)
#ifndef _WIN32
    void process_commands();
    void handle_query_cmd(const std::string& cmd, const nlohmann::json& j);
    void handle_input_cmd(const std::string& cmd, const nlohmann::json& j);
    void handle_debug_cmd(const std::string& cmd, const nlohmann::json& j);
    void handle_camera_cmd(const std::string& cmd, const nlohmann::json& j);
    void handle_time_cmd(const std::string& cmd, const nlohmann::json& j);
    void handle_scene_cmd(const std::string& cmd, const nlohmann::json& j);
    void handle_tilemap_cmd(const std::string& cmd, const nlohmann::json& j);
    void handle_entity_cmd(const std::string& cmd, const nlohmann::json& j);
    void handle_lighting_cmd(const std::string& cmd, const nlohmann::json& j);
    void handle_portal_cmd(const std::string& cmd, const nlohmann::json& j);
    void handle_environment_cmd(const std::string& cmd, const nlohmann::json& j);
    void handle_particle_cmd(const std::string& cmd, const nlohmann::json& j);
    void handle_config_cmd(const std::string& cmd, const nlohmann::json& j);
    void handle_event_cmd(const std::string& cmd, const nlohmann::json& j);
#endif

    // init_scene phase methods
    void init_player(const SceneData& sd,
                     const std::function<void(ecs::Animation&, const std::string&)>& setup_anim);
    void init_npcs(const SceneData& sd,
                   const std::function<void(ecs::Animation&, const std::string&)>& setup_anim);
    void init_gs(const SceneData& sd);
    void init_environment(SceneData& sd);
    void init_weather_and_systems(const SceneData& sd);

    // update_game mode methods
    void update_dialog_mode(float dt);
    void update_explore_mode(float dt);
    void update_shared_systems(float dt);

    // JSON builders
    nlohmann::json build_state_json() const;
    nlohmann::json build_map_json() const;
    nlohmann::json build_scene_json() const;
    nlohmann::json build_tilemap_json() const;
#ifndef _WIN32
    void emit_event(const std::string& event, const nlohmann::json& data = {});
#endif

    // Asset generators
    static void generate_player_sheet();
    static void generate_tileset();
    static void generate_particle_atlas();
    static void generate_background_textures();
    static void generate_shadow_texture();
    static void generate_audio_assets();
    static void generate_flat_normal_texture();
    static void generate_tileset_normal();
    static void generate_player_normal();

    void check_portals();

    // Control server
#ifndef _WIN32
    ControlServer control_server_;
#endif
};

}  // namespace vulkan_game
