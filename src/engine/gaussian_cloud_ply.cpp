// PLY-format I/O for GaussianCloud.
//
// Compiled INTO offline tooling (ply2heightmap, tests) but NOT into
// gseurat_core. The runtime engine consumes pre-baked .gsvx files via
// GaussianCloud::load_gsvx — every bundled .ply has a sibling .gsvx
// produced by the build-time bake_gsvx target (CMakeLists.txt), and
// GaussianCloud::load_baked throws on missing .gsvx rather
// than falling back here.
//
// load / write live in `gseurat::ply::` (not on the GaussianCloud class)
// so the public engine header surface matches the engine link surface
// — addresses Codex P2 on PR #425.
//
// #393: the parsing logic was moved into `ply_parse_core` (depends only
// on glm + stdlib). This translation unit is now a thin wrapper that
// converts the parser-internal `RawSplat` rows into `Gaussian` (adding
// the derived `importance` field) and a separate `write()` for the
// PLY emitter the engine-side fixtures rely on.

#include "gseurat/engine/gaussian_cloud_ply.hpp"

#include "gseurat/engine/project_root.hpp"
#include "ply_parse_core.hpp"

#include <algorithm>
#include <cmath>
#include <fstream>
#include <stdexcept>

namespace gseurat::ply {

namespace {

// SH coefficient C0 — needed by `write()` for the SH↔RGB round-trip.
// The parsing-side use lives inside `ply_parse_core`.
constexpr float kSH_C0 = 0.28209479177387814f;  // 1 / (2 * sqrt(pi))

ply_parse_core::CoordinateSystem to_core(CoordinateSystem coords) {
    return (coords == CoordinateSystem::kVulkanYDown)
        ? ply_parse_core::CoordinateSystem::kVulkanYDown
        : ply_parse_core::CoordinateSystem::kYUp;
}

}  // namespace

GaussianCloud load(const std::string& path, CoordinateSystem coords) {
    auto resolved = resolve_asset_path(path).string();
    auto raw = ply_parse_core::parse(resolved, to_core(coords));

    std::vector<Gaussian> gaussians(raw.splats.size());
    for (size_t i = 0; i < raw.splats.size(); ++i) {
        const auto& r = raw.splats[i];
        Gaussian& g = gaussians[i];
        g.position   = r.position;
        g.scale      = r.scale;
        g.rotation   = r.rotation;
        g.color      = r.color;
        g.opacity    = r.opacity;
        g.bone_index = r.bone_index;
        g.emission   = r.emission;
        g.importance = r.opacity * std::max({r.scale.x, r.scale.y, r.scale.z});
    }
    return GaussianCloud::from_gaussians(std::move(gaussians));
}

void write(const std::string& path,
           const std::vector<Gaussian>& gaussians,
           CoordinateSystem coords) {
    std::ofstream file(path, std::ios::binary);
    if (!file.is_open()) {
        throw std::runtime_error("Failed to open PLY file for writing: " + path);
    }

    file << "ply\n";
    file << "format binary_little_endian 1.0\n";
    file << "element vertex " << gaussians.size() << "\n";
    file << "property float x\n";
    file << "property float y\n";
    file << "property float z\n";
    file << "property float scale_0\n";
    file << "property float scale_1\n";
    file << "property float scale_2\n";
    file << "property float rot_0\n";
    file << "property float rot_1\n";
    file << "property float rot_2\n";
    file << "property float rot_3\n";
    file << "property float f_dc_0\n";
    file << "property float f_dc_1\n";
    file << "property float f_dc_2\n";
    file << "property float opacity\n";
    file << "property float emission\n";
    file << "end_header\n";

    // load() (via ply_parse_core) applies: exp(scale), sigmoid(opacity),
    // SH_C0*f_dc+0.5 for color. We write the inverse: log(scale),
    // logit(opacity), (color-0.5)/SH_C0.
    for (const auto& g : gaussians) {
        float x = g.position.x;
        float y = (coords == CoordinateSystem::kVulkanYDown) ? -g.position.y : g.position.y;
        float z = g.position.z;
        file.write(reinterpret_cast<const char*>(&x), 4);
        file.write(reinterpret_cast<const char*>(&y), 4);
        file.write(reinterpret_cast<const char*>(&z), 4);

        float s0 = std::log(std::max(g.scale.x, 1e-10f));
        float s1 = std::log(std::max(g.scale.y, 1e-10f));
        float s2 = std::log(std::max(g.scale.z, 1e-10f));
        file.write(reinterpret_cast<const char*>(&s0), 4);
        file.write(reinterpret_cast<const char*>(&s1), 4);
        file.write(reinterpret_cast<const char*>(&s2), 4);

        float rw = g.rotation.w;
        float rx = (coords == CoordinateSystem::kVulkanYDown) ? -g.rotation.x : g.rotation.x;
        float ry = g.rotation.y;
        float rz = (coords == CoordinateSystem::kVulkanYDown) ? -g.rotation.z : g.rotation.z;
        file.write(reinterpret_cast<const char*>(&rw), 4);
        file.write(reinterpret_cast<const char*>(&rx), 4);
        file.write(reinterpret_cast<const char*>(&ry), 4);
        file.write(reinterpret_cast<const char*>(&rz), 4);

        float dc0 = (g.color.r - 0.5f) / kSH_C0;
        float dc1 = (g.color.g - 0.5f) / kSH_C0;
        float dc2 = (g.color.b - 0.5f) / kSH_C0;
        file.write(reinterpret_cast<const char*>(&dc0), 4);
        file.write(reinterpret_cast<const char*>(&dc1), 4);
        file.write(reinterpret_cast<const char*>(&dc2), 4);

        float op_clamped = std::clamp(g.opacity, 1e-6f, 1.0f - 1e-6f);
        float logit = std::log(op_clamped / (1.0f - op_clamped));
        file.write(reinterpret_cast<const char*>(&logit), 4);

        float em = g.emission;
        file.write(reinterpret_cast<const char*>(&em), 4);
    }
}

}  // namespace gseurat::ply
