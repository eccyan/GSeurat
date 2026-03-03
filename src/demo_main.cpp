#include "vulkan_game/demo/demo_app.hpp"

#include <cstdlib>
#include <iostream>

int main(int argc, char* argv[]) {
    vulkan_game::DemoApp demo;
    demo.parse_args(argc, argv);

    try {
        demo.run();
    } catch (const std::exception& e) {
        std::cerr << "Fatal error: " << e.what() << '\n';
        return EXIT_FAILURE;
    }

    return EXIT_SUCCESS;
}
