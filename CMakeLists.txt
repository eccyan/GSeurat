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

# --- Shaders ----------------------------------------------------------------

add_subdirectory(shaders)

# --- Main executable --------------------------------------------------------

add_executable(vulkan_game src/main.cpp)

target_include_directories(vulkan_game PRIVATE ${PROJECT_SOURCE_DIR}/include)

target_link_libraries(vulkan_game
    PRIVATE
        Vulkan::Vulkan
        glfw
        glm::glm
)

add_dependencies(vulkan_game shaders)

# --- Copy assets to build directory -----------------------------------------

add_custom_command(TARGET vulkan_game POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_directory
        ${PROJECT_SOURCE_DIR}/assets
        $<TARGET_FILE_DIR:vulkan_game>/assets
    COMMENT "Copying assets to build directory"
)
