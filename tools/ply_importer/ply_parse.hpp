#pragma once

// Standalone PLY parser for the ply_importer offline tool.
// Does NOT depend on gseurat_core — uses only glm and the standard library.
//
// Parses binary_little_endian PLY files containing 3D Gaussian Splat data
// (position, scale, rotation, color/SH DC, opacity, bone_index, emission)
// and returns GPU-ready packed structs for writing to .gsvx.

#include <glm/glm.hpp>
#include <glm/gtc/quaternion.hpp>

#include <cstdint>
#include <string>
#include <vector>

namespace ply_importer {

/// GPU-side Gaussian struct matching GSeurat's GpuGaussian.
/// Must stay in sync with include/gseurat/engine/gaussian_cloud.hpp.
/// 4 × vec4 = 64 bytes, std430-compatible.
struct alignas(16) GpuGaussian {
    glm::vec4 pos_opacity;  // xyz = position, w = opacity
    glm::vec4 scale_pad;    // xyz = scale, w = float_bits(bone_index)
    glm::vec4 rot;          // xyzw = quaternion (x, y, z, w)
    glm::vec4 color_pad;    // rgb = color, w = emission
};
static_assert(sizeof(GpuGaussian) == 64);
static_assert(alignof(GpuGaussian) == 16);

/// Axis-aligned bounding box computed during parsing.
struct AABB {
    glm::vec3 min{std::numeric_limits<float>::max()};
    glm::vec3 max{std::numeric_limits<float>::lowest()};

    void expand(const glm::vec3& p) {
        min = glm::min(min, p);
        max = glm::max(max, p);
    }
};

/// Result of parsing a PLY file.
struct PlyCloud {
    std::vector<GpuGaussian> gaussians;
    AABB bounds;
};

/// Parse a binary_little_endian PLY file containing Gaussian splat data.
/// Throws std::runtime_error on any parse failure.
PlyCloud parse_ply(const std::string& path);

}  // namespace ply_importer
