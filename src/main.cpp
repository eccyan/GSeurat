#include "vulkan_game/app.hpp"

#include <cstdlib>
#include <iostream>
#include <stdexcept>

int main() {
    vulkan_game::App app;

    try {
        app.run();
    } catch (const std::exception& e) {
        std::cerr << "Fatal error: " << e.what() << '\n';
        return EXIT_FAILURE;
    }

    return EXIT_SUCCESS;
}

namespace vulkan_game {

void App::run() {
    init_window();
    renderer_.init(window_);
    main_loop();
    cleanup();
}

void App::init_window() {
    glfwInit();
    glfwWindowHint(GLFW_CLIENT_API, GLFW_NO_API);
    glfwWindowHint(GLFW_RESIZABLE, GLFW_FALSE);

    window_ = glfwCreateWindow(kWindowWidth, kWindowHeight, "Vulkan Game", nullptr, nullptr);
}

void App::main_loop() {
    while (!glfwWindowShouldClose(window_)) {
        glfwPollEvents();
        renderer_.draw_frame();
    }
}

void App::cleanup() {
    renderer_.shutdown();
    glfwDestroyWindow(window_);
    glfwTerminate();
}

}  // namespace vulkan_game
