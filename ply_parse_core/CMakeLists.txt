# ply_parse_core — shared PLY parser for offline tools.
#
# #393: deduplicates the parse between `src/engine/gaussian_cloud_ply.cpp`
# (engine-side offline/test helper) and `tools/ply_importer/ply_parse.cpp`
# (standalone .gsvx baker). Depends ONLY on glm + stdlib; must NOT take a
# dependency on gseurat_core so the standalone CLI remains decoupled and
# the runtime engine stays PLY-parser-free.

add_library(ply_parse_core STATIC
    ply_parse_core.cpp
)

target_include_directories(ply_parse_core PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}
)

target_compile_features(ply_parse_core PRIVATE cxx_std_23)

# glm is header-only; pulled in by the consumer side as well, but make the
# dep explicit so a stand-alone build of this lib works without the parent
# project's transitive includes.
target_link_libraries(ply_parse_core PUBLIC glm)
