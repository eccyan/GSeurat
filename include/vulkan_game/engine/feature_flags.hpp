#pragma once

#include <array>
#include <string_view>

namespace vulkan_game {

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
    bool water_reflections = true;
    bool y_sort_depth = true;
    bool sprite_outlines = true;

    // Gameplay
    bool npc_patrol = true;
    bool animation = true;
    bool npc_lights = true;

    // Gameplay (cont.)
    bool scene_transitions = true;

    // Audio
    bool music = true;
    bool sfx = true;

    struct Entry {
        std::string_view name;
        std::string_view phase;
        std::string_view category;
        bool FeatureFlags::* ptr;
    };

    static constexpr std::array<Entry, 21> entries() {
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
            {"Water Reflect.", "30",  "EFFECTS",   &FeatureFlags::water_reflections},
            {"Y-Sort Depth",  "33",  "EFFECTS",   &FeatureFlags::y_sort_depth},
            {"Sprite Outlines","34",  "EFFECTS",   &FeatureFlags::sprite_outlines},
            {"NPC Patrol",     "8",   "GAMEPLAY",  &FeatureFlags::npc_patrol},
            {"Animation",      "4-6", "GAMEPLAY",  &FeatureFlags::animation},
            {"NPC Lights",     "11",  "GAMEPLAY",  &FeatureFlags::npc_lights},
            {"Scene Trans.",   "27",  "GAMEPLAY",  &FeatureFlags::scene_transitions},
            {"Music",          "13",  "AUDIO",     &FeatureFlags::music},
            {"SFX",            "13",  "AUDIO",     &FeatureFlags::sfx},
        }};
    }
};

}  // namespace vulkan_game
