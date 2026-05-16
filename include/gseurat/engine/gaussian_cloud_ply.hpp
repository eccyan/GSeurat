#pragma once

// Offline-only PLY I/O for GaussianCloud.
//
// This header is NOT part of the public `gseurat_core` ABI. The runtime
// engine library does not compile `gaussian_cloud_ply.cpp` and does not
// link these symbols — calling them from a downstream submodule consumer
// would fail at link time.
//
// Only offline tools (e.g. ply2heightmap) and tests include this header
// and add `src/engine/gaussian_cloud_ply.cpp` to their build. The runtime
// path goes through `GaussianCloud::load_baked`, which requires
// a sibling `.gsvx` baked by the `bake_gsvx` CMake target.
//
// Closes Codex P2 on PR #425: header surface now matches link surface.

#include "gseurat/engine/gaussian_cloud.hpp"

#include <string>
#include <vector>

namespace gseurat::ply {

/// Parse a binary_little_endian PLY file. Throws `std::runtime_error` on any
/// parse failure. Offline-only — see header comment.
GaussianCloud load(const std::string& path,
                   CoordinateSystem coords = CoordinateSystem::kYUp);

/// Write Gaussians to a binary_little_endian PLY file. Round-trips through
/// `ply::load` within float epsilon. Offline-only — see header comment.
void write(const std::string& path,
           const std::vector<Gaussian>& gaussians,
           CoordinateSystem coords = CoordinateSystem::kYUp);

}  // namespace gseurat::ply
