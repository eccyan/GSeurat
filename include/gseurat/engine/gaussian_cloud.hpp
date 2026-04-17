#pragma once

#include <glm/glm.hpp>
#include <glm/gtc/quaternion.hpp>

#include <cstdint>
#include <string>
#include <vector>

namespace gseurat {

/// Coordinate system convention for PLY import/export.
///
/// GSeurat internally uses a **right-handed, Y-up** coordinate system and
/// applies a Vulkan Y-flip in the projection matrix (`proj[1][1] *= -1`).
///
/// When loading PLY files into an engine that does NOT apply this projection
/// flip (e.g. OpenGL-style renderers, or Vulkan renderers that handle Y
/// differently), pass CoordinateSystem::kVulkanYDown to negate the Y axis
/// on load so that the geometry appears right-side-up.
enum class CoordinateSystem {
    kYUp,         ///< Default. Y points up (matches GSeurat's internal convention).
    kVulkanYDown, ///< Negate Y on load/write for consumers that expect Y-down NDC
                  ///< without a projection-matrix flip.
};

struct Gaussian {
    glm::vec3 position;   // 12 bytes
    glm::vec3 scale;      // 12 bytes
    glm::quat rotation;   // 16 bytes
    glm::vec3 color;      // 12 bytes (SH DC coefficient → linear RGB)
    float opacity;         // 4 bytes
    float importance;      // 4 bytes (opacity * max_scale, for LOD decimation)
    uint32_t bone_index;   // 4 bytes (body part index for skeletal posing, 0 = no bone)
    float emission = 0.0f; // 4 bytes (emissive intensity, 0 = not emissive)
};  // 68 bytes

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

/// GPU-side Gaussian struct (matches gs_preprocess.comp GpuGaussian).
/// 4 × vec4 = 64 bytes, std430-compatible.
struct alignas(16) GpuGaussian {
    glm::vec4 pos_opacity;  // xyz = position, w = opacity
    glm::vec4 scale_pad;    // xyz = scale, w = float_bits(bone_index)
    glm::vec4 rot;          // xyzw = quaternion (x, y, z, w)
    glm::vec4 color_pad;    // rgb = color, w = emission
};
static_assert(sizeof(GpuGaussian) == 64, "GpuGaussian must be 64 bytes for GPU std430");
static_assert(alignof(GpuGaussian) == 16, "GpuGaussian must be 16-byte aligned");

/// GSVX binary file header (32 bytes, little-endian).
struct GsvxHeader {
    char     magic[4];     // "GSVX"
    uint32_t version;      // Format version (currently 1)
    uint32_t count;        // Number of Gaussians in payload
    uint32_t flags;        // Reserved (must be 0)
    uint8_t  reserved[16]; // Padding to 32 bytes
};
static_assert(sizeof(GsvxHeader) == 32, "GsvxHeader must be 32 bytes");

/// Pre-baked GPU-ready Gaussian data loaded from a .gsvx file.
struct GsvxPayload {
    std::vector<GpuGaussian> gpu_gaussians;
    AABB bounds;
    uint32_t count = 0;
};

class GaussianCloud {
public:
    static GaussianCloud load_ply(const std::string& path,
                                   CoordinateSystem coords = CoordinateSystem::kYUp);
    /// Load a pre-baked .gsvx binary file (zero-copy GPU format).
    static GsvxPayload load_gsvx(const std::string& path);
    static GaussianCloud from_gaussians(std::vector<Gaussian> gaussians);

    // Write Gaussians to a binary little-endian PLY file.
    // Data is stored in the same format load_ply() expects (log-scale, logit-opacity, SH DC color).
    static void write_ply(const std::string& path, const std::vector<Gaussian>& gaussians,
                          CoordinateSystem coords = CoordinateSystem::kYUp);

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

}  // namespace gseurat
