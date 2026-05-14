cmake_minimum_required(VERSION 3.25)

# ply_importer — standalone offline PLY → GSVX converter.
# Does NOT link gseurat_core; depends only on glm.
# Built when GSEURAT_BUILD_TOOLS is ON (which is ON by default for top-level
# builds, and OFF when included via add_subdirectory as a submodule).

add_executable(ply_importer
    main.cpp
    ply_parse.cpp
)

target_include_directories(ply_importer PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
)

target_compile_features(ply_importer PRIVATE cxx_std_23)

target_compile_definitions(ply_importer PRIVATE
    GLM_FORCE_DEPTH_ZERO_TO_ONE
)

target_link_libraries(ply_importer PRIVATE
    glm::glm
    ply_parse_core
)
