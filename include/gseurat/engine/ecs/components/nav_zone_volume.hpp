#pragma once
#include <cstdint>
#include <nlohmann/json.hpp>

namespace gseurat {

struct NavZoneVolume {
    uint8_t zone_id{0};
};

inline NavZoneVolume nav_zone_volume_from_json(const nlohmann::json& j) {
    NavZoneVolume v;
    if (j.contains("zone_id")) v.zone_id = j["zone_id"].get<uint8_t>();
    return v;
}

inline nlohmann::json nav_zone_volume_to_json(const NavZoneVolume& v) {
    return {{"zone_id", v.zone_id}};
}

}  // namespace gseurat
