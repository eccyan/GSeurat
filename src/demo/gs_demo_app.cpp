#include "vulkan_game/demo/gs_demo_app.hpp"
#include "vulkan_game/demo/gs_demo_state.hpp"
#include "vulkan_game/app.hpp"

#include <string_view>

namespace vulkan_game {

void GsDemoApp::parse_args(int argc, char* argv[]) {
    for (int i = 1; i < argc; ++i) {
        std::string_view arg(argv[i]);
        if (arg == "--scene" && i + 1 < argc) {
            scene_path_ = argv[++i];
        }
    }
}

void GsDemoApp::run() {
    App app;
    app.set_current_scene_path(scene_path_);
    app.set_start_state(std::make_unique<GsDemoState>());
    app.run();
}

}  // namespace vulkan_game
