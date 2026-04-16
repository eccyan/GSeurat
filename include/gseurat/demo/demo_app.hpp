#pragma once

#include "gseurat/engine/app_base.hpp"

#include <functional>
#include <glm/glm.hpp>
#include <string>

namespace gseurat {

class DemoApp : public AppBase {
public:
    void parse_args(int argc, char* argv[]);
    void run() override;

    /// Hook used by the active GameState to perform demo-specific scene-transition
    /// recovery work (collision grid restore, chunk re-merge, character reload, etc.).
    /// Set by IslandDemoState::on_enter; consumed by DemoApp::transition_scene.
    using PortalHandler = std::function<void(const std::string& target_scene,
                                             const glm::vec3& target_position)>;
    void set_portal_handler(PortalHandler h) { portal_handler_ = std::move(h); }

protected:
    void init_game_content() override;
    void init_scene(const std::string& scene_path) override;
    void clear_scene() override;
    /// ITransitionHost override: dispatches to portal_handler_ if set, otherwise
    /// falls back to AppBase's default (clear + init + move PlayerTag).
    void transition_scene(const std::string& target_scene,
                          const glm::vec3& target_position) override;

private:
    static void generate_particle_atlas();
    static void generate_shadow_texture();
    static void generate_flat_normal_texture();
    std::string scene_path_;
    bool scene_path_explicit_ = false;
    bool viewer_mode_ = false;
    PortalHandler portal_handler_;
};

}  // namespace gseurat
