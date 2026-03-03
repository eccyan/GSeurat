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

FetchContent_Declare(
    json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG        v3.11.3
)
set(JSON_BuildTests OFF CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(json)

FetchContent_Declare(
    miniaudio
    GIT_REPOSITORY https://github.com/mackron/miniaudio.git
    GIT_TAG        0.11.21
    CONFIGURE_COMMAND ""
    BUILD_COMMAND ""
)
FetchContent_MakeAvailable(miniaudio)

# --- Download font if not present -------------------------------------------

set(FONT_DIR "${PROJECT_SOURCE_DIR}/assets/fonts")
set(FONT_FILE "${FONT_DIR}/NotoSans-Regular.ttf")
if(NOT EXISTS "${FONT_FILE}")
    file(MAKE_DIRECTORY "${FONT_DIR}")
    message(STATUS "Downloading NotoSans-Regular.ttf ...")
    file(DOWNLOAD
        "https://github.com/notofonts/latin-greek-cyrillic/releases/download/NotoSans-v2.014/NotoSans-v2.014.zip"
        "${CMAKE_BINARY_DIR}/NotoSans.zip"
        STATUS DOWNLOAD_STATUS
    )
    list(GET DOWNLOAD_STATUS 0 STATUS_CODE)
    if(STATUS_CODE EQUAL 0)
        file(ARCHIVE_EXTRACT INPUT "${CMAKE_BINARY_DIR}/NotoSans.zip"
             DESTINATION "${CMAKE_BINARY_DIR}/NotoSans_tmp")
        file(GLOB_RECURSE NOTO_TTF "${CMAKE_BINARY_DIR}/NotoSans_tmp/**/NotoSans-Regular.ttf")
        if(NOTO_TTF)
            list(GET NOTO_TTF 0 NOTO_TTF_PATH)
            file(COPY "${NOTO_TTF_PATH}" DESTINATION "${FONT_DIR}")
        else()
            message(WARNING "Could not find NotoSans-Regular.ttf in downloaded archive")
        endif()
    else()
        message(WARNING "Failed to download NotoSans font (status ${STATUS_CODE}). "
                        "Place a TTF font at ${FONT_FILE} manually.")
    endif()
endif()

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
    src/engine/animation.cpp
    src/engine/animation_state_machine.cpp
    src/engine/particle.cpp
    src/engine/audio_system.cpp
    src/engine/font_atlas.cpp
    src/engine/text_renderer.cpp
    src/engine/locale_manager.cpp
    src/engine/control_server.cpp
    src/engine/resource_manager.cpp
    src/engine/game_state.cpp
    src/engine/scene_loader.cpp
    src/engine/ui/ui_context.cpp
    src/engine/save_system.cpp
    src/game/systems.cpp
    src/game/title_state.cpp
    src/game/gameplay_state.cpp
    src/game/pause_state.cpp
)

target_include_directories(vulkan_game PRIVATE
    ${PROJECT_SOURCE_DIR}/include
    ${stb_SOURCE_DIR}
    ${miniaudio_SOURCE_DIR}
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
        nlohmann_json::nlohmann_json
)

if(APPLE)
    target_link_libraries(vulkan_game PRIVATE
        "-framework CoreAudio"
        "-framework AudioToolbox"
        "-framework CoreFoundation"
    )
endif()

add_dependencies(vulkan_game shaders)

# --- Copy assets to build directory -----------------------------------------

add_custom_command(TARGET vulkan_game POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_directory
        ${PROJECT_SOURCE_DIR}/assets
        $<TARGET_FILE_DIR:vulkan_game>/assets
    COMMENT "Copying assets to build directory"
)
