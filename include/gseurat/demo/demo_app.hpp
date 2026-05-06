#pragma once

#include "gseurat/demo/demo_loading_overlay.hpp"
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
    void draw_loading_overlay(float dt) override { loading_overlay_.draw(*this, dt); }

private:
    std::string scene_path_;
    bool scene_path_explicit_ = false;
    bool viewer_mode_ = false;
    bool deterministic_ = false;
    // Opt-in via --prewarm CLI flag. Default OFF: the all-in-one prewarm
    // submitted in #409 caused a kernel panic on macOS due to MoltenVK
    // compiling 13 PSOs in parallel (#410 reverted it). The new design
    // (per-pipeline serialization) is safe but expensive (~30-60s on a
    // cold cache), so the user opts in once to populate the cache and
    // benefits from #408's persistence on subsequent runs.
    bool prewarm_at_startup_ = false;
    PortalHandler portal_handler_;
    DemoLoadingOverlay loading_overlay_;
};

}  // namespace gseurat
