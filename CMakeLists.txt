cmake_minimum_required(VERSION 3.25)
project(gseurat VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# --- Submodule support -------------------------------------------------------
# Detect whether GSeurat is the top-level project or included as a subdirectory.

if(CMAKE_SOURCE_DIR STREQUAL CMAKE_CURRENT_SOURCE_DIR)
    set(GSEURAT_IS_TOP_LEVEL ON)
else()
    set(GSEURAT_IS_TOP_LEVEL OFF)
endif()

option(GSEURAT_BUILD_EXAMPLES "Build demo and staging executables" ${GSEURAT_IS_TOP_LEVEL})
option(GSEURAT_BUILD_TESTS    "Build unit and GPU tests"           ${GSEURAT_IS_TOP_LEVEL})
option(GSEURAT_BUILD_TOOLS    "Include tooling support"            ${GSEURAT_IS_TOP_LEVEL})
option(GSEURAT_SHARED_LIBS    "Build GSeurat core as a shared library" OFF)

# Game-specific assets live under examples/island_demo/.
# When building standalone, sync_assets copies them into the build directory
# so runtime paths ("assets/...", "world.json") resolve unchanged.
set(GSEURAT_EXAMPLE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/examples/island_demo")

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

set(FONT_DIR "${GSEURAT_EXAMPLE_DIR}/assets/fonts")
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

# --- Core engine library -----------------------------------------------------

if(GSEURAT_SHARED_LIBS)
    set(_gseurat_lib_type SHARED)
else()
    set(_gseurat_lib_type STATIC)
endif()

add_library(gseurat_core ${_gseurat_lib_type}
    src/engine/app_base.cpp
    src/engine/command_dispatcher.cpp
    src/engine/vk_context.cpp
    src/engine/swapchain.cpp
    src/engine/render_pass.cpp
    src/engine/pipeline.cpp
    src/engine/command_pool.cpp
    src/engine/sync.cpp
    src/engine/buffer.cpp
    src/engine/texture.cpp
    src/engine/descriptor.cpp
    src/engine/procedural_textures.cpp
    src/engine/renderer.cpp
    src/engine/screenshot.cpp
    src/engine/camera.cpp
    src/engine/sprite_batch.cpp
    src/engine/input_manager.cpp
    src/engine/scene.cpp
    src/engine/tilemap.cpp
    src/engine/transfer_queue.cpp
    src/engine/pathfinder.cpp
    src/engine/parallax_layer.cpp
    src/engine/animation.cpp
    src/engine/character_data.cpp
    src/engine/animation_state_machine.cpp
    src/engine/particle.cpp
    # src/engine/audio/ — interactive music engine
    src/engine/audio/memory_audio_source.cpp
    src/engine/audio/mmap_audio_source.cpp
    src/engine/audio/audio_engine.cpp
    src/engine/audio/mixer.cpp
    src/engine/audio/metadata_loader.cpp
    src/engine/audio/backend/miniaudio_device.cpp
    src/engine/audio/state_variable_filter.cpp
    src/engine/audio/streaming_audio_source.cpp
    src/engine/audio/audio_stream_manager.cpp
    src/engine/platform/memory_mapped_file.cpp
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
    src/engine/gs_scene_loader.cpp
    src/engine/collision_gen.cpp
    src/engine/save_system.cpp
    src/engine/slab_allocator.cpp
    src/engine/async_loader.cpp
    src/engine/staging_uploader.cpp
    src/engine/gs_chunk_streamer.cpp
    src/engine/gs_particle.cpp
    src/engine/gs_animator.cpp
    src/engine/gs_vfx.cpp
    src/engine/gs_spline.cpp
    src/engine/camera_zone_system.cpp
    src/engine/coordinate.cpp
    src/engine/component_registry.cpp
    src/engine/system_scheduler.cpp
    src/character/character_manifest.cpp
    src/character/bone_animation_player.cpp
    src/character/bone_animation_state_machine.cpp
    src/staging/visual_state.cpp
    src/engine/project_root.cpp
    src/engine/world_manifest.cpp
    src/engine/world_streamer.cpp
    src/engine/bone_animation_system.cpp
    src/engine/debug_draw.cpp
    src/engine/trigger_systems.cpp
    src/engine/systems/transition_system.cpp
    src/engine/systems/portal_trigger_handler.cpp
    src/engine/systems/audio_zone_system.cpp
)


if(WIN32)
    target_sources(gseurat_core PRIVATE src/engine/control_server_win32.cpp)
else()
    target_sources(gseurat_core PRIVATE src/engine/control_server.cpp)
endif()

target_include_directories(gseurat_core PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<INSTALL_INTERFACE:include>
    ${stb_SOURCE_DIR}
    ${miniaudio_SOURCE_DIR}
)

target_compile_features(gseurat_core PUBLIC cxx_std_23)

target_compile_definitions(gseurat_core PUBLIC
    GLM_FORCE_DEPTH_ZERO_TO_ONE
)

if(GSEURAT_SHARED_LIBS)
    target_compile_definitions(gseurat_core PUBLIC GSEURAT_ENGINE_BUILD_SHARED)
endif()

# MSVC: enable C++ exceptions and standard-conforming preprocessor
if(MSVC)
    target_compile_options(gseurat_core PUBLIC /EHsc /permissive-)
    # Disable iterator debugging — avoids proxy corruption crashes from
    # memcpy-based ECS or other raw memory operations on containers.
    target_compile_definitions(gseurat_core PUBLIC _ITERATOR_DEBUG_LEVEL=0)

    # Release optimizations: whole-program optimization + link-time code generation
    target_compile_options(gseurat_core PUBLIC
        $<$<CONFIG:Release>:/GL /fp:fast>
    )
    target_link_options(gseurat_core PUBLIC
        $<$<CONFIG:Release>:/LTCG>
    )
endif()

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

# Namespaced alias for parent projects: target_link_libraries(app PRIVATE GSeurat::Engine)
add_library(GSeurat::Engine ALIAS gseurat_core)

# --- Developer overlay (ImGui) -----------------------------------------------

option(GSEURAT_DEV_MODE "Enable ImGui developer overlay" ON)

if(GSEURAT_DEV_MODE)
    target_link_libraries(gseurat_core PUBLIC imgui_lib)
    target_compile_definitions(gseurat_core PUBLIC GSEURAT_DEV_MODE)
    target_sources(gseurat_core PRIVATE
        src/engine/dev_overlay.cpp
        src/engine/dev_panels.cpp
    )
endif()

# --- Examples (demo + staging) ----------------------------------------------

if(GSEURAT_BUILD_EXAMPLES)

add_executable(gseurat_demo
    src/demo_main.cpp
    src/demo/demo_app.cpp
    src/demo/gs_demo_state.cpp
    src/demo/island_demo_state.cpp
)
target_compile_definitions(gseurat_demo PRIVATE VG_BUILD_PROFILE=1)
target_link_libraries(gseurat_demo PRIVATE gseurat_core)
add_dependencies(gseurat_demo shaders sync_assets)

add_executable(gseurat_staging
    src/staging_main.cpp
    src/staging/staging_app.cpp
    src/staging/staging_state.cpp
    src/staging/camera_review_state.cpp
)
target_link_libraries(gseurat_staging PRIVATE gseurat_core)
add_dependencies(gseurat_staging shaders sync_assets)

# Copy example assets to build directory so runtime paths resolve unchanged.
add_custom_target(sync_assets ALL
    COMMAND ${CMAKE_COMMAND} -E copy_directory
        ${GSEURAT_EXAMPLE_DIR}/assets
        ${CMAKE_CURRENT_BINARY_DIR}/assets
    COMMAND ${CMAKE_COMMAND} -E copy_directory
        ${CMAKE_CURRENT_BINARY_DIR}/shaders
        ${PROJECT_SOURCE_DIR}/shaders
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        ${GSEURAT_EXAMPLE_DIR}/world.json
        ${CMAKE_CURRENT_BINARY_DIR}/world.json
    COMMENT "Syncing assets and shaders to build directory"
    DEPENDS shaders
)

endif() # GSEURAT_BUILD_EXAMPLES

# --- Tests ------------------------------------------------------------------

if(GSEURAT_BUILD_TESTS)

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
             WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR})
endfunction()

add_gseurat_test(test_feature_flags)
add_gseurat_test(test_tile_sort_key)
add_gseurat_test(test_onesweep_logic)
add_gseurat_test(test_async_loader     src/engine/async_loader.cpp)
add_gseurat_test(test_character_data   src/engine/character_data.cpp)
add_gseurat_test(test_gaussian_cloud   src/engine/gaussian_cloud.cpp src/engine/collision_gen.cpp
                                       src/engine/scene_loader.cpp src/engine/tilemap.cpp
                                       src/engine/gs_particle.cpp src/engine/gs_spline.cpp
                                       src/engine/project_root.cpp)
add_gseurat_test(test_transition_system  src/engine/systems/transition_system.cpp
                                          src/engine/systems/portal_trigger_handler.cpp)
add_gseurat_test(test_gs_chunk_grid    src/engine/gs_chunk_grid.cpp src/engine/gaussian_cloud.cpp
                                       src/engine/project_root.cpp)
add_gseurat_test(test_gs_chunk_streamer src/engine/gs_chunk_streamer.cpp src/engine/gaussian_cloud.cpp
                                        src/engine/gs_chunk_grid.cpp src/engine/async_loader.cpp
                                        src/engine/project_root.cpp)
add_gseurat_test(test_gs_parallax_camera src/engine/gs_parallax_camera.cpp)
add_gseurat_test(test_screenshot       src/engine/screenshot.cpp)
add_gseurat_test(test_staging_uploader src/engine/staging_uploader.cpp)
add_gseurat_test(test_tilemap          src/engine/tilemap.cpp)
add_gseurat_test(test_gs_point_lights)
add_gseurat_test(test_gs_emission     src/engine/gaussian_cloud.cpp
                                       src/engine/project_root.cpp)
add_gseurat_test(test_gs_particle    src/engine/gs_particle.cpp src/engine/gs_animator.cpp
                                      src/engine/gaussian_cloud.cpp src/engine/scene_loader.cpp
                                      src/engine/gs_spline.cpp src/engine/project_root.cpp)
add_gseurat_test(test_scene_loading  src/engine/scene_loader.cpp src/engine/tilemap.cpp
                                      src/engine/gs_particle.cpp src/engine/gs_animator.cpp
                                      src/engine/gaussian_cloud.cpp src/engine/gs_vfx.cpp
                                      src/engine/gs_spline.cpp src/engine/coordinate.cpp
                                      src/engine/project_root.cpp)
add_gseurat_test(test_incremental_sync src/engine/scene_loader.cpp src/engine/tilemap.cpp
                                        src/engine/gaussian_cloud.cpp src/engine/gs_particle.cpp
                                        src/engine/gs_animator.cpp src/engine/gs_spline.cpp
                                        src/engine/coordinate.cpp src/engine/project_root.cpp)
add_gseurat_test(test_vfx_scene_buffer src/engine/gaussian_cloud.cpp
                                        src/engine/project_root.cpp)
add_gseurat_test(test_vfx_lights_rotation src/engine/gs_vfx.cpp src/engine/gs_particle.cpp
                                           src/engine/gs_animator.cpp src/engine/gaussian_cloud.cpp
                                           src/engine/scene_loader.cpp src/engine/tilemap.cpp
                                           src/engine/gs_spline.cpp src/engine/project_root.cpp)
add_gseurat_test(test_gs_spline src/engine/gs_spline.cpp)
add_gseurat_test(test_gs_post_process)
add_gseurat_test(test_pbd_solver)
add_gseurat_test(test_component_registry src/engine/component_registry.cpp)
add_gseurat_test(test_system_scheduler  src/engine/system_scheduler.cpp)
add_gseurat_test(test_island_systems    src/engine/trigger_systems.cpp
    src/character/character_manifest.cpp
    src/character/bone_animation_player.cpp
    src/character/bone_animation_state_machine.cpp)
add_gseurat_test(test_character_manifest src/character/character_manifest.cpp)
add_gseurat_test(test_bone_animation_player src/character/character_manifest.cpp src/character/bone_animation_player.cpp)
add_gseurat_test(test_bone_animation_state_machine src/character/character_manifest.cpp src/character/bone_animation_player.cpp src/character/bone_animation_state_machine.cpp)
add_gseurat_test(test_coordinate      src/engine/coordinate.cpp)
add_gseurat_test(test_camera_volume)
add_gseurat_test(test_camera_zone_system src/engine/camera_zone_system.cpp
                                          src/engine/gs_spline.cpp)
add_gseurat_test(test_camera_review_state src/staging/camera_review_state.cpp
                                           src/engine/camera_zone_system.cpp
                                           src/engine/gs_spline.cpp
                                           src/engine/input_manager.cpp
                                           src/engine/coordinate.cpp)
target_link_libraries(test_camera_review_state PRIVATE glfw imgui_lib)
add_gseurat_test(test_visual_state  src/staging/visual_state.cpp)
add_gseurat_test(test_project_root  src/engine/project_root.cpp)
add_gseurat_test(test_slab_allocator src/engine/slab_allocator.cpp)
add_gseurat_test(test_world_manifest src/engine/world_manifest.cpp)
add_gseurat_test(test_world_streamer src/engine/world_streamer.cpp src/engine/world_manifest.cpp)
add_gseurat_test(test_audio_command_queue)
add_gseurat_test(test_audio_ring_buffer)
target_include_directories(test_audio_ring_buffer PRIVATE ${PROJECT_SOURCE_DIR}/src/engine/audio)
add_gseurat_test(test_audio_slew_limiter)
add_gseurat_test(test_audio_memory_source
    src/engine/audio/memory_audio_source.cpp)
add_gseurat_test(test_audio_mmap_source
    src/engine/audio/mmap_audio_source.cpp
    src/engine/audio/memory_audio_source.cpp
    src/engine/platform/memory_mapped_file.cpp)
# Common audio engine sources for standalone tests
set(AUDIO_ENGINE_TEST_SOURCES
    src/engine/audio/audio_engine.cpp
    src/engine/audio/memory_audio_source.cpp
    src/engine/audio/mmap_audio_source.cpp
    src/engine/audio/mixer.cpp
    src/engine/audio/metadata_loader.cpp
    src/engine/audio/backend/miniaudio_device.cpp
    src/engine/audio/state_variable_filter.cpp
    src/engine/audio/streaming_audio_source.cpp
    src/engine/audio/audio_stream_manager.cpp
    src/engine/platform/memory_mapped_file.cpp
    src/engine/project_root.cpp)
add_gseurat_test(test_audio_streaming      ${AUDIO_ENGINE_TEST_SOURCES})
target_include_directories(test_audio_streaming PRIVATE ${PROJECT_SOURCE_DIR}/src/engine/audio)
add_gseurat_test(test_audio_mixer_basic        ${AUDIO_ENGINE_TEST_SOURCES})
target_include_directories(test_audio_mixer_basic PRIVATE ${PROJECT_SOURCE_DIR}/src/engine/audio)
add_gseurat_test(test_audio_mixer_loop         ${AUDIO_ENGINE_TEST_SOURCES})
target_include_directories(test_audio_mixer_loop PRIVATE ${PROJECT_SOURCE_DIR}/src/engine/audio)
add_gseurat_test(test_audio_mixer_crossfade    ${AUDIO_ENGINE_TEST_SOURCES})
target_include_directories(test_audio_mixer_crossfade PRIVATE ${PROJECT_SOURCE_DIR}/src/engine/audio)
add_gseurat_test(test_audio_mixer_marker_xfade ${AUDIO_ENGINE_TEST_SOURCES})
target_include_directories(test_audio_mixer_marker_xfade PRIVATE ${PROJECT_SOURCE_DIR}/src/engine/audio)
add_gseurat_test(test_audio_engine_queue_overflow ${AUDIO_ENGINE_TEST_SOURCES})
target_include_directories(test_audio_engine_queue_overflow PRIVATE ${PROJECT_SOURCE_DIR}/src/engine/audio)
add_gseurat_test(test_audio_mixer_rtpc         ${AUDIO_ENGINE_TEST_SOURCES})
target_include_directories(test_audio_mixer_rtpc PRIVATE ${PROJECT_SOURCE_DIR}/src/engine/audio)
add_gseurat_test(test_audio_metadata_loader
    src/engine/audio/metadata_loader.cpp)
target_include_directories(test_audio_metadata_loader PRIVATE ${PROJECT_SOURCE_DIR}/src/engine/audio)
add_gseurat_test(test_audio_engine_load        ${AUDIO_ENGINE_TEST_SOURCES})
target_include_directories(test_audio_engine_load PRIVATE ${PROJECT_SOURCE_DIR}/src/engine/audio)
add_gseurat_test(test_audio_oneshot         ${AUDIO_ENGINE_TEST_SOURCES})
target_include_directories(test_audio_oneshot PRIVATE ${PROJECT_SOURCE_DIR}/src/engine/audio)
add_gseurat_test(test_audio_spatial         ${AUDIO_ENGINE_TEST_SOURCES})
target_include_directories(test_audio_spatial PRIVATE ${PROJECT_SOURCE_DIR}/src/engine/audio)
add_gseurat_test(test_audio_zone_system
    ${AUDIO_ENGINE_TEST_SOURCES}
    src/engine/systems/audio_zone_system.cpp)
target_include_directories(test_audio_zone_system PRIVATE ${PROJECT_SOURCE_DIR}/src/engine/systems)
add_gseurat_test(test_audio_svf
    src/engine/audio/state_variable_filter.cpp)
target_include_directories(test_audio_svf PRIVATE ${PROJECT_SOURCE_DIR}/src/engine/audio)
add_gseurat_test(test_memory_mapped_file
    src/engine/platform/memory_mapped_file.cpp)
add_gseurat_test(test_audio_effect_chain
    ${AUDIO_ENGINE_TEST_SOURCES})
target_include_directories(test_audio_effect_chain PRIVATE ${PROJECT_SOURCE_DIR}/src/engine/audio)

# --- GPU Tests (require actual GPU, link engine sources directly) ----------

function(add_gseurat_gpu_test NAME)
    add_executable(${NAME}
        tests/${NAME}.cpp
        tests/gpu_test_context.cpp
        tests/onesweep_test_runner.cpp
        src/engine/vk_context.cpp
        src/engine/buffer.cpp
        src/engine/pipeline.cpp
        ${ARGN}
    )
    target_include_directories(${NAME} PRIVATE
        ${PROJECT_SOURCE_DIR}/include
        ${PROJECT_SOURCE_DIR}/tests
    )
    target_compile_definitions(${NAME} PRIVATE GLM_FORCE_DEPTH_ZERO_TO_ONE)
    target_link_libraries(${NAME} PRIVATE
        Vulkan::Vulkan
        glm::glm
        GPUOpen::VulkanMemoryAllocator
        glfw
    )
    add_dependencies(${NAME} shaders)
    add_test(NAME ${NAME} COMMAND ${NAME}
             WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR})
    set_tests_properties(${NAME} PROPERTIES LABELS "gpu")
endfunction()

add_gseurat_gpu_test(test_onesweep_gpu)

endif() # GSEURAT_BUILD_TESTS
