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

    // Effects
    bool particles = true;
    bool weather = true;

    // Gameplay
    bool npc_patrol = true;
    bool animation = true;
    bool npc_lights = true;

    // Audio
    bool music = true;
    bool sfx = true;

    struct Entry {
        std::string_view name;
        std::string_view phase;
        std::string_view category;
        bool FeatureFlags::* ptr;
    };

    static constexpr std::array<Entry, 14> entries() {
        return {{
            {"Parallax BG",    "24",  "RENDERING", &FeatureFlags::parallax_backgrounds},
            {"Point Lights",   "11",  "RENDERING", &FeatureFlags::point_lights},
            {"Bloom",          "22",  "RENDERING", &FeatureFlags::bloom},
            {"Depth of Field", "23",  "RENDERING", &FeatureFlags::depth_of_field},
            {"Vignette",       "22",  "RENDERING", &FeatureFlags::vignette},
            {"Tone Mapping",   "22",  "RENDERING", &FeatureFlags::tone_mapping},
            {"Fog",            "25",  "RENDERING", &FeatureFlags::fog},
            {"Particles",      "12",  "EFFECTS",   &FeatureFlags::particles},
            {"Weather",        "25",  "EFFECTS",   &FeatureFlags::weather},
            {"NPC Patrol",     "8",   "GAMEPLAY",  &FeatureFlags::npc_patrol},
            {"Animation",      "4-6", "GAMEPLAY",  &FeatureFlags::animation},
            {"NPC Lights",     "11",  "GAMEPLAY",  &FeatureFlags::npc_lights},
            {"Music",          "13",  "AUDIO",     &FeatureFlags::music},
            {"SFX",            "13",  "AUDIO",     &FeatureFlags::sfx},
        }};
    }
};

}  // namespace vulkan_game
