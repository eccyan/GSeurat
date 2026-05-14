#pragma once

// ply_parse_core — shared binary_little_endian PLY parser for offline tools.
//
// Issue #393: prior to this library, the engine-side `gseurat::ply::load`
// (offline-only, in `gaussian_cloud_ply.cpp`) and the standalone
// `tools/ply_importer/ply_parse.cpp` each carried near-identical copies
// of the PLY header parse, the property aliasing tables, the SH→RGB
// transform, the sigmoid-on-opacity, the rotation normalize, the
// scale exp(), and the bone_index uchar fast path.
//
// `ply_parse_core` consolidates the parse into one source of truth.
// Each consumer remains a thin wrapper that converts the
// parser-internal `RawSplat` into its own output struct
// (`gseurat::Gaussian` for engine-side tools/tests; the packed
// `ply_importer::GpuGaussian` for the standalone CLI).
//
// Dependency contract: glm + stdlib ONLY. This library MUST NOT depend
// on `gseurat_core`; otherwise the runtime engine would transitively
// pull in PLY parsing code and the offline/runtime decoupling that
// Phase 1a ratified (PR #392) would regress.

#include <glm/glm.hpp>
#include <glm/gtc/quaternion.hpp>

#include <cstdint>
#include <string>
#include <vector>

namespace ply_parse_core {

/// Coordinate handedness convention. Many .ply files in the wild encode
/// Y-up; engines that target Vulkan (Y-down) need a flip on both position
/// and rotation when consuming.
enum class CoordinateSystem {
    kYUp,
    kVulkanYDown,
};

/// One row of parsed Gaussian splat data. Every field is post-processed:
/// scale is already `exp()`'d, rotation is normalized, color is already
/// SH-DC→RGB-converted and clamped, opacity is already sigmoid'd. The
/// consumer chooses its own downstream layout (per-field `Gaussian` for
/// the engine, packed `GpuGaussian` for the GSVX baker).
struct RawSplat {
    glm::vec3 position;
    glm::vec3 scale;
    glm::quat rotation;
    glm::vec3 color;
    float opacity;
    uint32_t bone_index;
    float emission;
};

struct RawPlyCloud {
    std::vector<RawSplat> splats;
    glm::vec3 bounds_min{0.0f};
    glm::vec3 bounds_max{0.0f};
};

/// Parse a binary_little_endian PLY file. Throws `std::runtime_error` on
/// any header / data / type-decoding failure.
///
/// `path` is taken as-is — the caller is responsible for any
/// project-relative resolution (the engine side wraps with
/// `resolve_asset_path`; the CLI tool takes the user's argv path
/// verbatim).
RawPlyCloud parse(const std::string& path,
                  CoordinateSystem coords = CoordinateSystem::kYUp);

}  // namespace ply_parse_core
