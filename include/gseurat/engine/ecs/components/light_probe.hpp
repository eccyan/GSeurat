#pragma once
#include <glm/glm.hpp>
#include <nlohmann/json.hpp>

namespace gseurat {

struct LightProbe {
    glm::vec3 color{0.5f};
};

inline LightProbe light_probe_from_json(const nlohmann::json& j) {
    LightProbe lp;
    if (j.contains("color") && j["color"].is_array()) {
        auto& c = j["color"];
        lp.color = glm::vec3(c[0].get<float>(), c[1].get<float>(), c[2].get<float>());
    }
    return lp;
}

inline nlohmann::json light_probe_to_json(const LightProbe& lp) {
    return {{"color", {lp.color.x, lp.color.y, lp.color.z}}};
}

}  // namespace gseurat
