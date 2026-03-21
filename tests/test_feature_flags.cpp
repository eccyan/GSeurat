// Unit test: FeatureFlags — default values, gs_viewer() profile, GS entries
//
// Build:
//   c++ -std=c++23 -I include tests/test_feature_flags.cpp -o build/test_feature_flags
//
// Run: ./build/test_feature_flags

#include "gseurat/engine/feature_flags.hpp"

#include <cassert>
#include <cstdio>
#include <cstring>

using namespace gseurat;

int main() {
    // 1. Default flags all true
    {
        FeatureFlags flags{};
        for (const auto& e : FeatureFlags::entries()) {
            assert((flags.*e.ptr) == true);
        }
        std::printf("PASS: default flags all true\n");
    }

    // 2. gs_viewer() profile
    {
        auto flags = FeatureFlags::gs_viewer();
        // Non-GS flags should all be false
        assert(!flags.parallax_backgrounds);
        assert(!flags.point_lights);
        assert(!flags.bloom);
        assert(!flags.particles);
        assert(!flags.music);
        assert(!flags.sfx);
        assert(!flags.npc_patrol);

        // GS flags: rendering/chunk/lod/budget true, parallax false
        assert(flags.gs_rendering);
        assert(flags.gs_chunk_culling);
        assert(flags.gs_lod);
        assert(flags.gs_adaptive_budget);
        assert(!flags.gs_parallax);
        std::printf("PASS: gs_viewer() profile\n");
    }

    // 3. Entry count == 32
    {
        assert(FeatureFlags::entries().size() == 32);
        std::printf("PASS: entry count == 32\n");
    }

    // 4. Pointer-to-member round-trip
    {
        FeatureFlags flags{};
        for (const auto& e : FeatureFlags::entries()) {
            flags.*e.ptr = false;
            assert((flags.*e.ptr) == false);
            flags.*e.ptr = true;
            assert((flags.*e.ptr) == true);
        }
        std::printf("PASS: pointer-to-member round-trip\n");
    }

    // 5. Exactly 5 entries with category "3DGS"
    {
        int gs_count = 0;
        for (const auto& e : FeatureFlags::entries()) {
            if (e.category == "3DGS") gs_count++;
        }
        assert(gs_count == 5);
        std::printf("PASS: GS category entries == 5\n");
    }

    // 6. Individual flag toggle — set one GS flag false, others unaffected
    {
        FeatureFlags flags{};
        flags.gs_chunk_culling = false;
        assert(flags.gs_rendering == true);
        assert(flags.gs_chunk_culling == false);
        assert(flags.gs_lod == true);
        assert(flags.gs_adaptive_budget == true);
        assert(flags.gs_parallax == true);
        // Non-GS flags still true
        assert(flags.bloom == true);
        assert(flags.music == true);
        std::printf("PASS: individual flag toggle\n");
    }

    // 7. New tilemap flags default true
    {
        FeatureFlags flags{};
        assert(flags.tilemap_rendering == true);
        assert(flags.tilemap_collision == true);
        std::printf("PASS: tilemap flags default true\n");
    }

    // 8. gs_viewer() has tilemap flags false
    {
        auto flags = FeatureFlags::gs_viewer();
        assert(!flags.tilemap_rendering);
        assert(!flags.tilemap_collision);
        std::printf("PASS: gs_viewer() tilemap flags false\n");
    }

    std::printf("\nAll feature_flags tests passed.\n");
    return 0;
}
