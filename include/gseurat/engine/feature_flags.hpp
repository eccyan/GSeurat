#pragma once

#include <array>
#include <cstdint>
#include <string_view>

namespace gseurat {

// Build profile — set per-target via CMake (VG_BUILD_PROFILE)
enum class BuildProfile : uint8_t { Full = 0, GsViewer = 1 };

#ifndef VG_BUILD_PROFILE
#define VG_BUILD_PROFILE 0
#endif
inline constexpr BuildProfile kBuildProfile = static_cast<BuildProfile>(VG_BUILD_PROFILE);
inline constexpr bool kIsGsViewer = (kBuildProfile == BuildProfile::GsViewer);

struct FeatureFlags {
    // Rendering
    bool parallax_backgrounds = true;
    bool point_lights = true;
    bool bloom = true;
    bool depth_of_field = true;
    bool vignette = true;
    bool tone_mapping = true;
    bool fog = true;
    bool normal_mapping = true;

    // Effects
    bool particles = true;
    bool weather = true;
    bool blob_shadows = true;
    bool animated_tiles = true;
    bool tilemap_rendering = true;   // Tilemap draw pass in renderer
    bool tilemap_collision = true;   // Player-tilemap AABB collision resolution
    bool water_reflections = true;
    bool y_sort_depth = true;
    bool sprite_outlines = true;
    bool camera_shake = true;
    bool screen_effects = true;
    bool minimap = true;
    bool day_night_cycle = true;

    // Gameplay
    bool npc_patrol = true;
    bool animation = true;
    bool npc_lights = true;

    // Gameplay (cont.)
    bool scene_transitions = true;

    // Audio
    bool music = true;
    bool sfx = true;

    // 3D Gaussian Splatting
    bool gs_rendering = true;       // Master toggle: GS compute dispatch + composite blit
    bool gs_chunk_culling = true;   // Frustum-based spatial chunk culling
    bool gs_lod = true;             // Distance-based LOD budget decimation
    bool gs_adaptive_budget = true; // Auto-tuning LOD budget to target FPS
    bool gs_parallax = true;        // Shadow-box parallax camera

    struct Entry {
        std::string_view name;
        std::string_view phase;
        std::string_view category;
        bool FeatureFlags::* ptr;
    };

    // GS viewer: GS subsystem enabled (except parallax), everything else off
    static constexpr FeatureFlags gs_viewer() {
        return FeatureFlags{
            false, false, false, false, false, false, false, false,  // Rendering (8)
            false, false, false, false, false, false, false, false,  // Effects 1-8
            false, false, false, false, false,                       // Effects 9-13
            false, false, false, false,                              // Gameplay (4)
            false, false,                                            // Audio (2)
            true, true, true, true, false
        };
    }

    static constexpr std::array<Entry, 32> entries() {
        return {{
            {"Parallax BG",    "24",  "RENDERING", &FeatureFlags::parallax_backgrounds},
            {"Point Lights",   "11",  "RENDERING", &FeatureFlags::point_lights},
            {"Bloom",          "22",  "RENDERING", &FeatureFlags::bloom},
            {"Depth of Field", "23",  "RENDERING", &FeatureFlags::depth_of_field},
            {"Vignette",       "22",  "RENDERING", &FeatureFlags::vignette},
            {"Tone Mapping",   "22",  "RENDERING", &FeatureFlags::tone_mapping},
            {"Fog",            "25",  "RENDERING", &FeatureFlags::fog},
            {"Normal Maps",    "35",  "RENDERING", &FeatureFlags::normal_mapping},
            {"Particles",      "12",  "EFFECTS",   &FeatureFlags::particles},
            {"Weather",        "25",  "EFFECTS",   &FeatureFlags::weather},
            {"Blob Shadows",   "28",  "EFFECTS",   &FeatureFlags::blob_shadows},
            {"Animated Tiles", "29",  "EFFECTS",   &FeatureFlags::animated_tiles},
            {"Tilemap Render", "3",   "EFFECTS",   &FeatureFlags::tilemap_rendering},
            {"Tilemap Collsn", "3",   "EFFECTS",   &FeatureFlags::tilemap_collision},
            {"Water Reflect.", "30",  "EFFECTS",   &FeatureFlags::water_reflections},
            {"Y-Sort Depth",  "33",  "EFFECTS",   &FeatureFlags::y_sort_depth},
            {"Sprite Outlines","34",  "EFFECTS",   &FeatureFlags::sprite_outlines},
            {"Camera Shake",   "36",  "EFFECTS",   &FeatureFlags::camera_shake},
            {"Screen FX",      "36",  "EFFECTS",   &FeatureFlags::screen_effects},
            {"Minimap",        "37",  "EFFECTS",   &FeatureFlags::minimap},
            {"Day/Night",      "38",  "EFFECTS",   &FeatureFlags::day_night_cycle},
            {"NPC Patrol",     "8",   "GAMEPLAY",  &FeatureFlags::npc_patrol},
            {"Animation",      "4-6", "GAMEPLAY",  &FeatureFlags::animation},
            {"NPC Lights",     "11",  "GAMEPLAY",  &FeatureFlags::npc_lights},
            {"Scene Trans.",   "27",  "GAMEPLAY",  &FeatureFlags::scene_transitions},
            {"Music",          "13",  "AUDIO",     &FeatureFlags::music},
            {"SFX",            "13",  "AUDIO",     &FeatureFlags::sfx},
            {"GS Rendering",   "GS1", "3DGS",     &FeatureFlags::gs_rendering},
            {"GS Chunk Cull",  "GS9", "3DGS",     &FeatureFlags::gs_chunk_culling},
            {"GS LOD",         "GS10","3DGS",      &FeatureFlags::gs_lod},
            {"GS Budget",      "GS10","3DGS",      &FeatureFlags::gs_adaptive_budget},
            {"GS Parallax",    "GS9", "3DGS",     &FeatureFlags::gs_parallax},
        }};
    }
};

}  // namespace gseurat
