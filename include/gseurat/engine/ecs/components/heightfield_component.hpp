#pragma once

#include "gseurat/engine/gaussian_cloud.hpp"  // for AABB

#include <nlohmann/json.hpp>
#include <glm/glm.hpp>

#include <cstdint>
#include <string>
#include <vector>

namespace gseurat {

struct HeightfieldData {
    std::vector<uint16_t> samples;   // Row-major height samples
    uint32_t img_width{0};           // Pixel columns
    uint32_t img_height{0};          // Pixel rows
};

struct HeightfieldComponent {
    std::string image_path;              // 16-bit PNG grayscale (relative to assets/)
    float width{100.0f};                 // World-space X extent
    float length{100.0f};               // World-space Z extent
    float min_height{0.0f};              // World Y at pixel value 0
    float max_height{50.0f};             // World Y at pixel value 65535
    uint32_t collision_mask{0xFFFFFFFF};

    // Loaded at runtime (not serialized)
    HeightfieldData data;
    AABB world_aabb;                     // Computed from transform + extents
};

// ── JSON serialization ────────────────────────────────────────────────
inline HeightfieldComponent heightfield_from_json(const nlohmann::json& j) {
    HeightfieldComponent h;
    h.image_path     = j.value("image_path", std::string{});
    h.width          = j.value("width", 100.0f);
    h.length         = j.value("length", 100.0f);
    h.min_height     = j.value("min_height", 0.0f);
    h.max_height     = j.value("max_height", 50.0f);
    h.collision_mask = j.value("collision_mask", static_cast<uint32_t>(0xFFFFFFFF));
    return h;
}

inline nlohmann::json heightfield_to_json(const HeightfieldComponent& h) {
    return {
        {"image_path",     h.image_path},
        {"width",          h.width},
        {"length",         h.length},
        {"min_height",     h.min_height},
        {"max_height",     h.max_height},
        {"collision_mask", h.collision_mask}
    };
}

}  // namespace gseurat
