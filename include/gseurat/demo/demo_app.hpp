#pragma once

#include "gseurat/engine/app_base.hpp"
#include "gseurat/engine/feature_flags.hpp"
#include "gseurat/engine/scene_loader.hpp"
#include "gseurat/game/components.hpp"
#include <functional>

namespace gseurat {

class DemoApp : public AppBase {
public:
    void parse_args(int argc, char* argv[]);
    void run() override;
protected:
    void init_game_content() override;
    void init_scene(const std::string& scene_path) override;
    void clear_scene() override;
    void update_game(float dt) override;
    void update_audio(float dt) override;
private:
    void init_player(const SceneData& sd,
                     const std::function<void(ecs::Animation&, const std::string&)>& setup_anim);
    void init_npcs(const SceneData& sd,
                   const std::function<void(ecs::Animation&, const std::string&)>& setup_anim);
    void init_gs(const SceneData& sd);
    void init_environment(SceneData& sd);
    void init_weather_and_systems(const SceneData& sd);
    void update_dialog_mode(float dt);
    void update_explore_mode(float dt);
    void update_shared_systems(float dt);
    void check_portals();
    static void generate_player_sheet();
    static void generate_tileset();
    static void generate_particle_atlas();
    static void generate_background_textures();
    static void generate_shadow_texture();
    static void generate_audio_assets();
    static void generate_flat_normal_texture();
    static void generate_tileset_normal();
    static void generate_player_normal();
    FeatureFlags initial_flags_;
};

}  // namespace gseurat
