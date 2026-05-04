// ply_importer — offline PLY → GSVX converter
//
// Usage: ply_importer <in.ply> <out.gsvx>
//
// Reads a binary_little_endian PLY file containing 3D Gaussian Splat data,
// converts it to the GSeurat GSVX v2 binary format (GPU-ready, zero-parse),
// and writes the result to disk.
//
// GSVX v2 layout (little-endian):
//   [GsvxHeaderV2: 64 bytes]
//   [GpuGaussian × count: 64 bytes each]
//
// This tool is intentionally standalone — it does NOT link gseurat_core.
// It is gated behind GSEURAT_BUILD_TOOLS in the top-level CMakeLists.txt.

#include "ply_parse.hpp"

#include <cstdint>
#include <cstring>
#include <cstdio>
#include <fstream>
#include <stdexcept>
#include <string>

// GSVX v2 header — must match GsvxHeaderV2 in include/gseurat/engine/gaussian_cloud.hpp
// Validated by static_assert in that header; kept in sync manually.
struct GsvxHeaderV2 {
    char     magic[4];     // "GSVX"
    uint32_t version;      // 2
    uint32_t count;        // Number of Gaussians in payload
    uint32_t flags;        // Reserved (must be 0)
    float    aabb_min[3];  // Bounding box minimum (x, y, z)
    float    aabb_max[3];  // Bounding box maximum (x, y, z)
    uint8_t  reserved[24]; // Zero-filled padding to 64 bytes
};
static_assert(sizeof(GsvxHeaderV2) == 64, "GsvxHeaderV2 must be 64 bytes");

static void write_gsvx(const std::string& out_path, const ply_importer::PlyCloud& cloud) {
    std::ofstream file(out_path, std::ios::binary | std::ios::trunc);
    if (!file.is_open()) {
        throw std::runtime_error("Failed to open output file: " + out_path);
    }

    GsvxHeaderV2 header{};
    header.magic[0] = 'G'; header.magic[1] = 'S';
    header.magic[2] = 'V'; header.magic[3] = 'X';
    header.version  = 2;
    header.count    = static_cast<uint32_t>(cloud.gaussians.size());
    header.flags    = 0;
    header.aabb_min[0] = cloud.bounds.min.x;
    header.aabb_min[1] = cloud.bounds.min.y;
    header.aabb_min[2] = cloud.bounds.min.z;
    header.aabb_max[0] = cloud.bounds.max.x;
    header.aabb_max[1] = cloud.bounds.max.y;
    header.aabb_max[2] = cloud.bounds.max.z;
    // reserved is zero-initialized by value-init above

    file.write(reinterpret_cast<const char*>(&header), sizeof(header));
    if (!cloud.gaussians.empty()) {
        file.write(reinterpret_cast<const char*>(cloud.gaussians.data()),
                   static_cast<std::streamsize>(cloud.gaussians.size()
                       * sizeof(ply_importer::GpuGaussian)));
    }

    if (!file) {
        throw std::runtime_error("Write failed for: " + out_path);
    }
}

int main(int argc, char* argv[]) {
    if (argc != 3) {
        std::fprintf(stderr, "Usage: %s <in.ply> <out.gsvx>\n", argv[0]);
        return 1;
    }

    const std::string in_path  = argv[1];
    const std::string out_path = argv[2];

    try {
        std::fprintf(stderr, "ply_importer: parsing %s ...\n", in_path.c_str());
        auto cloud = ply_importer::parse_ply(in_path);
        std::fprintf(stderr, "ply_importer: parsed %u gaussians, "
                     "AABB [%.3f,%.3f,%.3f]–[%.3f,%.3f,%.3f]\n",
                     static_cast<uint32_t>(cloud.gaussians.size()),
                     cloud.bounds.min.x, cloud.bounds.min.y, cloud.bounds.min.z,
                     cloud.bounds.max.x, cloud.bounds.max.y, cloud.bounds.max.z);

        write_gsvx(out_path, cloud);
        std::fprintf(stderr, "ply_importer: wrote %s (%zu bytes)\n",
                     out_path.c_str(),
                     sizeof(GsvxHeaderV2)
                         + cloud.gaussians.size() * sizeof(ply_importer::GpuGaussian));
        return 0;
    } catch (const std::exception& e) {
        std::fprintf(stderr, "ply_importer error: %s\n", e.what());
        return 1;
    }
}
