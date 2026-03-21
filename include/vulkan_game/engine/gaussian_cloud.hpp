#pragma once

#include <glm/glm.hpp>
#include <glm/gtc/quaternion.hpp>

#include <string>
#include <vector>

namespace vulkan_game {

struct Gaussian {
    glm::vec3 position;   // 12 bytes
    glm::vec3 scale;      // 12 bytes
    glm::quat rotation;   // 16 bytes
    glm::vec3 color;      // 12 bytes (SH DC coefficient → linear RGB)
    float opacity;         // 4 bytes
    float importance;      // 4 bytes (opacity * max_scale, for LOD decimation)
};  // 60 bytes

struct AABB {
    glm::vec3 min{std::numeric_limits<float>::max()};
    glm::vec3 max{std::numeric_limits<float>::lowest()};

    void expand(const glm::vec3& p) {
        min = glm::min(min, p);
        max = glm::max(max, p);
    }

    glm::vec3 center() const { return (min + max) * 0.5f; }
    glm::vec3 extent() const { return max - min; }
};

class GaussianCloud {
public:
    static GaussianCloud load_ply(const std::string& path);
    static GaussianCloud from_gaussians(std::vector<Gaussian> gaussians);

    const std::vector<Gaussian>& gaussians() const { return gaussians_; }
    const AABB& bounds() const { return bounds_; }
    uint32_t count() const { return static_cast<uint32_t>(gaussians_.size()); }
    bool empty() const { return gaussians_.empty(); }

    // Multiply all Gaussian scales by the given factor
    void scale_all(float factor) {
        for (auto& g : gaussians_) {
            g.scale *= factor;
        }
    }

private:
    std::vector<Gaussian> gaussians_;
    AABB bounds_;
};

}  // namespace vulkan_game
