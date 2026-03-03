#pragma once

#include "vulkan_game/app.hpp"
#include "vulkan_game/engine/feature_flags.hpp"

#include <vector>
#include <string>

namespace vulkan_game {

class DemoApp {
public:
    void parse_args(int argc, char* argv[]);
    void run();

private:
    FeatureFlags initial_flags_;
};

}  // namespace vulkan_game
