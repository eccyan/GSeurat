#include "ply_parse.hpp"

#include "ply_parse_core.hpp"

#include <cstring>

namespace ply_importer {

// #393: the PLY header walk + per-row decoding (kSH_C0, type_size,
// read_float, alias map, log/sigmoid normalisation) moved into
// `ply_parse_core`. This wrapper just packs each post-processed
// `RawSplat` into the 4-vec4 `GpuGaussian` layout the .gsvx baker
// writes to disk.
PlyCloud parse_ply(const std::string& path) {
    auto raw = ply_parse_core::parse(path, ply_parse_core::CoordinateSystem::kYUp);

    PlyCloud cloud;
    cloud.gaussians.resize(raw.splats.size());
    cloud.bounds.min = raw.bounds_min;
    cloud.bounds.max = raw.bounds_max;

    for (size_t i = 0; i < raw.splats.size(); ++i) {
        const auto& s = raw.splats[i];
        GpuGaussian& g = cloud.gaussians[i];

        float bone_as_float;
        std::memcpy(&bone_as_float, &s.bone_index, sizeof(float));

        g.pos_opacity = glm::vec4(s.position, s.opacity);
        g.scale_pad   = glm::vec4(s.scale,    bone_as_float);
        g.rot         = glm::vec4(s.rotation.x, s.rotation.y, s.rotation.z, s.rotation.w);
        g.color_pad   = glm::vec4(s.color,    s.emission);
    }
    return cloud;
}

}  // namespace ply_importer
