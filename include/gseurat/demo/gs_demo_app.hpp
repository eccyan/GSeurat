#pragma once

#include "gseurat/engine/app_base.hpp"
#include <string>

namespace gseurat {

class GsDemoApp : public AppBase {
public:
    void parse_args(int argc, char* argv[]);
    void run() override;

protected:
    void init_game_content() override;
    void init_scene(const std::string& scene_path) override;
    void clear_scene() override;

private:
    static void generate_particle_atlas();
    static void generate_shadow_texture();
    static void generate_flat_normal_texture();
    std::string scene_path_ = "assets/scenes/gs_demo.json";
};

}  // namespace gseurat
