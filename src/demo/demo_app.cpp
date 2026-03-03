#include "vulkan_game/demo/demo_app.hpp"
#include "vulkan_game/demo/demo_gameplay_state.hpp"

#include <algorithm>
#include <string>
#include <string_view>

namespace vulkan_game {

void DemoApp::parse_args(int argc, char* argv[]) {
    // Map CLI flag names to pointer-to-member
    auto entries = FeatureFlags::entries();

    for (int i = 1; i < argc; ++i) {
        std::string_view arg(argv[i]);
        if (arg.starts_with("--disable-")) {
            auto feature_name = arg.substr(10);  // after "--disable-"

            // Normalize: lowercase + replace spaces with hyphens
            for (const auto& entry : entries) {
                // Build normalized name from entry: "Parallax BG" -> "parallax-bg"
                std::string normalized;
                for (char c : entry.name) {
                    if (c == ' ') normalized += '-';
                    else normalized += static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
                }
                if (feature_name == normalized) {
                    initial_flags_.*(entry.ptr) = false;
                    break;
                }
            }
        }
    }
}

void DemoApp::run() {
    App app;
    app.feature_flags() = initial_flags_;
    app.set_start_state(std::make_unique<DemoGameplayState>());
    app.run();
}

}  // namespace vulkan_game
