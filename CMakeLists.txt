cmake_minimum_required(VERSION 3.25)
project(gseurat VERSION 0.1.0 LANGUAGES C CXX)

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

FetchContent_Declare(
    imgui
    GIT_REPOSITORY https://github.com/ocornut/imgui.git
    GIT_TAG        v1.91.8
    CONFIGURE_COMMAND ""
    BUILD_COMMAND ""
)
FetchContent_MakeAvailable(imgui)

# Build Dear ImGui as a static library with Vulkan + GLFW backends
add_library(imgui_lib STATIC
    ${imgui_SOURCE_DIR}/imgui.cpp
    ${imgui_SOURCE_DIR}/imgui_demo.cpp
    ${imgui_SOURCE_DIR}/imgui_draw.cpp
    ${imgui_SOURCE_DIR}/imgui_tables.cpp
    ${imgui_SOURCE_DIR}/imgui_widgets.cpp
    ${imgui_SOURCE_DIR}/backends/imgui_impl_glfw.cpp
    ${imgui_SOURCE_DIR}/backends/imgui_impl_vulkan.cpp
)
target_include_directories(imgui_lib PUBLIC
    ${imgui_SOURCE_DIR}
    ${imgui_SOURCE_DIR}/backends
)
target_link_libraries(imgui_lib PUBLIC Vulkan::Vulkan glfw)

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

# --- Core OBJECT library (shared by main + demo) ---------------------------

add_library(gseurat_core OBJECT
    src/engine/app_base.cpp
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
    src/engine/screenshot.cpp
    src/engine/camera.cpp
    src/engine/sprite_batch.cpp
    src/engine/input_manager.cpp
    src/engine/scene.cpp
    src/engine/tilemap.cpp
    src/engine/pathfinder.cpp
    src/engine/parallax_layer.cpp
    src/engine/animation.cpp
    src/engine/character_data.cpp
    src/engine/animation_state_machine.cpp
    src/engine/particle.cpp
    src/engine/audio_system.cpp
    src/engine/font_atlas.cpp
    src/engine/text_renderer.cpp
    src/engine/locale_manager.cpp
    src/engine/minimap.cpp
    src/engine/post_process.cpp
    src/engine/resource_manager.cpp
    src/engine/game_state.cpp
    src/engine/scene_loader.cpp
    src/engine/screen_effects.cpp
    src/engine/day_night_system.cpp
    src/engine/weather_system.cpp
    src/engine/ui/ui_context.cpp
    src/engine/gaussian_cloud.cpp
    src/engine/gs_renderer.cpp
    src/engine/gs_chunk_grid.cpp
    src/engine/gs_parallax_camera.cpp
    src/engine/collision_gen.cpp
    src/engine/save_system.cpp
    src/engine/async_loader.cpp
    src/engine/staging_uploader.cpp
    src/engine/gs_chunk_streamer.cpp
    src/engine/gs_particle.cpp
    src/engine/gs_animator.cpp
    src/engine/gs_vfx.cpp
    src/engine/gs_spline.cpp
)

if(NOT WIN32)
    target_sources(gseurat_core PRIVATE src/engine/control_server.cpp)
endif()

target_include_directories(gseurat_core PUBLIC
    ${PROJECT_SOURCE_DIR}/include
    ${stb_SOURCE_DIR}
    ${miniaudio_SOURCE_DIR}
)

target_compile_definitions(gseurat_core PUBLIC
    GLM_FORCE_DEPTH_ZERO_TO_ONE
)

target_link_libraries(gseurat_core
    PUBLIC
        Vulkan::Vulkan
        glfw
        glm::glm
        GPUOpen::VulkanMemoryAllocator
        nlohmann_json::nlohmann_json
)

if(APPLE)
    target_link_libraries(gseurat_core PUBLIC
        "-framework CoreAudio"
        "-framework AudioToolbox"
        "-framework CoreFoundation"
    )
endif()

# --- Demo executable --------------------------------------------------------

add_executable(gseurat_demo
    src/demo_main.cpp
    src/demo/demo_app.cpp
    src/demo/gs_demo_state.cpp
)
target_compile_definitions(gseurat_demo PRIVATE VG_BUILD_PROFILE=1)
target_link_libraries(gseurat_demo PRIVATE gseurat_core)
add_dependencies(gseurat_demo shaders)

# --- Staging executable (ImGui-based rendering review tool) -----------------

add_executable(gseurat_staging
    src/staging_main.cpp
    src/staging/staging_app.cpp
    src/staging/staging_state.cpp
)
target_link_libraries(gseurat_staging PRIVATE gseurat_core imgui_lib)
add_dependencies(gseurat_staging shaders)

add_custom_command(TARGET gseurat_staging POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_directory
        ${PROJECT_SOURCE_DIR}/assets
        $<TARGET_FILE_DIR:gseurat_staging>/assets
    COMMENT "Copying assets to staging build directory"
)

# --- Copy assets to build directory -----------------------------------------

add_custom_command(TARGET gseurat_demo POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_directory
        ${PROJECT_SOURCE_DIR}/assets
        $<TARGET_FILE_DIR:gseurat_demo>/assets
    COMMENT "Copying assets to demo build directory"
)

# --- Tests ------------------------------------------------------------------

enable_testing()

# Helper: define a standalone test (no gseurat_core link — avoids duplicate symbols)
function(add_gseurat_test NAME)
    add_executable(${NAME} tests/${NAME}.cpp ${ARGN})
    target_include_directories(${NAME} PRIVATE
        ${PROJECT_SOURCE_DIR}/include
        ${stb_SOURCE_DIR}
        ${miniaudio_SOURCE_DIR}
    )
    target_compile_definitions(${NAME} PRIVATE GLM_FORCE_DEPTH_ZERO_TO_ONE)
    target_link_libraries(${NAME} PRIVATE
        Vulkan::Vulkan
        glm::glm
        GPUOpen::VulkanMemoryAllocator
        nlohmann_json::nlohmann_json
    )
    add_test(NAME ${NAME} COMMAND ${NAME}
             WORKING_DIRECTORY ${PROJECT_SOURCE_DIR})
endfunction()

add_gseurat_test(test_feature_flags)
add_gseurat_test(test_async_loader     src/engine/async_loader.cpp)
add_gseurat_test(test_character_data   src/engine/character_data.cpp)
add_gseurat_test(test_gaussian_cloud   src/engine/gaussian_cloud.cpp src/engine/collision_gen.cpp
                                       src/engine/scene_loader.cpp src/engine/tilemap.cpp
                                       src/engine/gs_particle.cpp src/engine/gs_spline.cpp)
add_gseurat_test(test_gs_chunk_grid    src/engine/gs_chunk_grid.cpp src/engine/gaussian_cloud.cpp)
add_gseurat_test(test_gs_chunk_streamer src/engine/gs_chunk_streamer.cpp src/engine/gaussian_cloud.cpp
                                        src/engine/gs_chunk_grid.cpp src/engine/async_loader.cpp)
add_gseurat_test(test_gs_parallax_camera src/engine/gs_parallax_camera.cpp)
add_gseurat_test(test_screenshot       src/engine/screenshot.cpp)
add_gseurat_test(test_staging_uploader src/engine/staging_uploader.cpp)
add_gseurat_test(test_tilemap          src/engine/tilemap.cpp)
add_gseurat_test(test_gs_point_lights)
add_gseurat_test(test_gs_emission     src/engine/gaussian_cloud.cpp)
add_gseurat_test(test_gs_particle    src/engine/gs_particle.cpp src/engine/gs_animator.cpp
                                      src/engine/gaussian_cloud.cpp src/engine/scene_loader.cpp
                                      src/engine/gs_spline.cpp)
add_gseurat_test(test_scene_loading  src/engine/scene_loader.cpp src/engine/tilemap.cpp
                                      src/engine/gs_particle.cpp src/engine/gs_animator.cpp
                                      src/engine/gaussian_cloud.cpp src/engine/gs_vfx.cpp
                                      src/engine/gs_spline.cpp)
add_gseurat_test(test_incremental_sync src/engine/scene_loader.cpp src/engine/tilemap.cpp
                                        src/engine/gaussian_cloud.cpp src/engine/gs_particle.cpp
                                        src/engine/gs_animator.cpp src/engine/gs_spline.cpp)
add_gseurat_test(test_vfx_scene_buffer src/engine/gaussian_cloud.cpp)
add_gseurat_test(test_vfx_lights_rotation src/engine/gs_vfx.cpp src/engine/gs_particle.cpp
                                           src/engine/gs_animator.cpp src/engine/gaussian_cloud.cpp
                                           src/engine/scene_loader.cpp src/engine/tilemap.cpp
                                           src/engine/gs_spline.cpp)
add_gseurat_test(test_gs_spline src/engine/gs_spline.cpp)
add_gseurat_test(test_gs_post_process)
