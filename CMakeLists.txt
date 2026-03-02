cmake_minimum_required(VERSION 3.25)
project(vulkan_game VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# --- Dependencies -----------------------------------------------------------

find_package(Vulkan REQUIRED)

include(FetchContent)

FetchContent_Declare(
    glfw
    GIT_REPOSITORY https://github.com/glfw/glfw.git
    GIT_TAG        3.4
)
set(GLFW_BUILD_DOCS OFF CACHE BOOL "" FORCE)
set(GLFW_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(GLFW_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(glfw)

FetchContent_Declare(
    glm
    GIT_REPOSITORY https://github.com/g-truc/glm.git
    GIT_TAG        1.0.1
)
FetchContent_MakeAvailable(glm)

FetchContent_Declare(
    vma
    GIT_REPOSITORY https://github.com/GPUOpen-LibrariesAndSDKs/VulkanMemoryAllocator.git
    GIT_TAG        v3.1.0
)
FetchContent_MakeAvailable(vma)

FetchContent_Declare(
    stb
    GIT_REPOSITORY https://github.com/nothings/stb.git
    GIT_TAG        master
    CONFIGURE_COMMAND ""
    BUILD_COMMAND ""
)
FetchContent_MakeAvailable(stb)

# --- Shaders ----------------------------------------------------------------

add_subdirectory(shaders)

# --- Main executable --------------------------------------------------------

add_executable(vulkan_game
    src/main.cpp
    src/app.cpp
    src/engine/vk_context.cpp
    src/engine/swapchain.cpp
    src/engine/render_pass.cpp
    src/engine/pipeline.cpp
    src/engine/command_pool.cpp
    src/engine/sync.cpp
    src/engine/buffer.cpp
    src/engine/texture.cpp
    src/engine/descriptor.cpp
    src/engine/renderer.cpp
    src/engine/camera.cpp
    src/engine/sprite_batch.cpp
    src/engine/input_manager.cpp
    src/engine/scene.cpp
    src/engine/tilemap.cpp
)

target_include_directories(vulkan_game PRIVATE
    ${PROJECT_SOURCE_DIR}/include
    ${stb_SOURCE_DIR}
)

target_compile_definitions(vulkan_game PRIVATE
    GLM_FORCE_DEPTH_ZERO_TO_ONE
)

target_link_libraries(vulkan_game
    PRIVATE
        Vulkan::Vulkan
        glfw
        glm::glm
        GPUOpen::VulkanMemoryAllocator
)

add_dependencies(vulkan_game shaders)

# --- Copy assets to build directory -----------------------------------------

add_custom_command(TARGET vulkan_game POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_directory
        ${PROJECT_SOURCE_DIR}/assets
        $<TARGET_FILE_DIR:vulkan_game>/assets
    COMMENT "Copying assets to build directory"
)
