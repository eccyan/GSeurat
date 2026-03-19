#pragma once

#include <string>

namespace vulkan_game {

class GsDemoApp {
public:
    void parse_args(int argc, char* argv[]);
    void run();

private:
    std::string scene_path_ = "assets/scenes/gs_demo.json";
};

}  // namespace vulkan_game
