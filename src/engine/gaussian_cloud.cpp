#include "gseurat/engine/gaussian_cloud.hpp"

#include "gseurat/engine/project_root.hpp"

#include <algorithm>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <stdexcept>
#include <system_error>

namespace gseurat {

// PLY I/O (`gseurat::ply::load` / `gseurat::ply::write`) lives in
// gaussian_cloud_ply.cpp — offline-only, NOT linked into gseurat_core.
// The runtime path is `GaussianCloud::load_baked`, which requires a
// .gsvx file produced by scripts/bake_assets.py (PR-B1) and referenced
// directly from scene/manifest/vfx JSON (PR-B2).

GaussianCloud GaussianCloud::from_gaussians(std::vector<Gaussian> gaussians) {
    GaussianCloud cloud;
    cloud.gaussians_ = std::move(gaussians);
    for (auto& g : cloud.gaussians_) {
        g.importance = g.opacity * std::max({g.scale.x, g.scale.y, g.scale.z});
        cloud.bounds_.expand(g.position);
    }
    return cloud;
}

GsvxPayload GaussianCloud::load_gsvx(const std::string& path) {
    auto resolved = resolve_asset_path(path);
    std::ifstream file(resolved, std::ios::binary);
    if (!file) {
        throw std::runtime_error("Cannot open GSVX file: " + resolved.string());
    }

    // Get file size for validation
    file.seekg(0, std::ios::end);
    const auto file_size = file.tellg();
    file.seekg(0, std::ios::beg);

    // Read first 8 bytes to determine version
    char magic[4]{};
    uint32_t version = 0;
    file.read(magic, 4);
    file.read(reinterpret_cast<char*>(&version), 4);
    if (!file || std::memcmp(magic, "GSVX", 4) != 0) {
        throw std::runtime_error("Invalid GSVX magic number: " + resolved.string());
    }

    uint32_t count = 0;
    uint32_t flags = 0;
    size_t header_size = 0;
    AABB baked_aabb;
    bool has_baked_aabb = false;

    if (version == 1) {
        header_size = sizeof(GsvxHeader);
        if (file_size < static_cast<std::streamoff>(header_size)) {
            throw std::runtime_error("GSVX file smaller than v1 header: " + resolved.string());
        }
        file.read(reinterpret_cast<char*>(&count), 4);
        file.read(reinterpret_cast<char*>(&flags), 4);
        // Skip remaining 16 reserved bytes
        file.seekg(static_cast<std::streamoff>(header_size), std::ios::beg);
    } else if (version == 2) {
        header_size = sizeof(GsvxHeaderV2);
        if (file_size < static_cast<std::streamoff>(header_size)) {
            throw std::runtime_error("GSVX file smaller than v2 header: " + resolved.string());
        }
        // Re-read as full v2 header
        file.seekg(0, std::ios::beg);
        GsvxHeaderV2 h2{};
        file.read(reinterpret_cast<char*>(&h2), sizeof(h2));
        if (!file) {
            throw std::runtime_error("Failed to read GSVX v2 header: " + resolved.string());
        }
        count = h2.count;
        flags = h2.flags;
        baked_aabb.min = glm::vec3(h2.aabb_min[0], h2.aabb_min[1], h2.aabb_min[2]);
        baked_aabb.max = glm::vec3(h2.aabb_max[0], h2.aabb_max[1], h2.aabb_max[2]);
        has_baked_aabb = true;
    } else {
        throw std::runtime_error("Unsupported GSVX version " +
                                 std::to_string(version) + ": " + resolved.string());
    }

    if (flags != 0) {
        throw std::runtime_error("GSVX reserved flags must be 0, got " +
                                 std::to_string(flags) + ": " + resolved.string());
    }

    // Validate file size matches header + payload
    const auto expected_size = static_cast<std::streamoff>(header_size) +
                                static_cast<std::streamoff>(count) *
                                static_cast<std::streamoff>(sizeof(GpuGaussian));
    if (file_size != expected_size) {
        throw std::runtime_error("GSVX file size " + std::to_string(file_size) +
                                 " does not match header count " +
                                 std::to_string(count) + " (expected " +
                                 std::to_string(expected_size) + " bytes): " +
                                 resolved.string());
    }

    GsvxPayload payload;
    payload.count = count;

    if (payload.count == 0) {
        if (has_baked_aabb) {
            payload.bounds = baked_aabb;
        }
        return payload;
    }

    // Bulk-read payload directly into vector (zero per-element parsing)
    payload.gpu_gaussians.resize(payload.count);
    const auto payload_bytes = static_cast<std::streamsize>(
        static_cast<size_t>(payload.count) * sizeof(GpuGaussian));
    file.read(reinterpret_cast<char*>(payload.gpu_gaussians.data()), payload_bytes);
    if (!file) {
        throw std::runtime_error("Failed to read GSVX payload (" +
                                 std::to_string(payload.count) + " gaussians): " +
                                 resolved.string());
    }

    if (has_baked_aabb) {
        // v2: use header AABB (skip position scan)
        payload.bounds = baked_aabb;
    } else {
        // v1: compute AABB from pre-baked positions
        for (const auto& g : payload.gpu_gaussians) {
            payload.bounds.expand(glm::vec3(g.pos_opacity));
        }
    }

    return payload;
}

namespace {

// Convert a baked GpuGaussian buffer back into the CPU Gaussian form.
// `coords` is applied symmetrically with the PLY parser
// (negate position.y, flip rotation.x and rotation.z when kVulkanYDown).
// `importance` is left default — `from_gaussians` recomputes it.
std::vector<Gaussian> unpack_gpu_gaussians(const std::vector<GpuGaussian>& gpu,
                                          CoordinateSystem coords) {
    std::vector<Gaussian> out(gpu.size());
    for (size_t i = 0; i < gpu.size(); ++i) {
        const GpuGaussian& g = gpu[i];
        Gaussian& dst = out[i];

        dst.position = glm::vec3(g.pos_opacity);
        dst.opacity  = g.pos_opacity.w;
        dst.scale    = glm::vec3(g.scale_pad);

        // bone_index: ply_importer stores it via memcpy from uint32 → float
        // (lossless bit pattern). Reverse with the same trick.
        uint32_t bone_idx = 0;
        const float bone_as_float = g.scale_pad.w;
        std::memcpy(&bone_idx, &bone_as_float, sizeof(uint32_t));
        dst.bone_index = bone_idx;

        // GpuGaussian stores quaternion as xyzw; glm::quat ctor is wxyz.
        dst.rotation = glm::quat(g.rot.w, g.rot.x, g.rot.y, g.rot.z);

        dst.color    = glm::vec3(g.color_pad);
        dst.emission = g.color_pad.w;

        if (coords == CoordinateSystem::kVulkanYDown) {
            dst.position.y = -dst.position.y;
            dst.rotation.x = -dst.rotation.x;
            dst.rotation.z = -dst.rotation.z;
        }
    }
    return out;
}

}  // namespace

GaussianCloud GaussianCloud::load_baked(const std::string& asset_path,
                                        CoordinateSystem coords) {
    // Accept either a `.ply` or `.gsvx` path and resolve to the baked
    // `.gsvx` sibling. PR-B2 migrated JSON scene/manifest/vfx paths to
    // `.gsvx`, but two callers still legitimately pass `.ply`: the
    // hard-coded player loader in `island_demo_state.cpp` (predates the
    // JSON migration) and the wrapper tests in `tests/test_gaussian_cloud.cpp`
    // that exercise sibling resolution. The rewrite is a no-op when the
    // input already has `.gsvx`, so this stays safe for the migrated path.
    std::filesystem::path gsvx_candidate(asset_path);
    gsvx_candidate.replace_extension(".gsvx");
    const std::string gsvx_path = gsvx_candidate.string();

    // The runtime engine does not link the PLY parser. The baked `.gsvx`
    // must exist — a missing or invalid file is a build/asset-pipeline
    // error, not a runtime fallback case.
    auto resolved = resolve_asset_path(gsvx_path);
    std::error_code ec;
    if (!std::filesystem::is_regular_file(resolved, ec)) {
        throw std::runtime_error(
            "GaussianCloud::load_baked: missing .gsvx for '" + asset_path +
            "' (expected at '" + resolved.string() + "'). Run " +
            "scripts/bake_assets.py to regenerate, or verify the scene/manifest "
            "JSON path is correct.");
    }
    GsvxPayload payload = load_gsvx(gsvx_path);
    return GaussianCloud::from_gaussians(
        unpack_gpu_gaussians(payload.gpu_gaussians, coords));
}

}  // namespace gseurat
