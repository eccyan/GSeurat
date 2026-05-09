#include "gseurat/engine/gaussian_cloud.hpp"

#include "gseurat/engine/project_root.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <system_error>
#include <unordered_map>

namespace gseurat {

namespace {

// SH coefficient C0 for converting DC spherical harmonic to RGB
constexpr float kSH_C0 = 0.28209479177387814f;  // 1 / (2 * sqrt(pi))

struct PlyProperty {
    std::string name;
    std::string type;
    size_t offset = 0;
    size_t size = 0;
};

size_t type_size(const std::string& type) {
    if (type == "float" || type == "float32") return 4;
    if (type == "double" || type == "float64") return 8;
    if (type == "uchar" || type == "uint8") return 1;
    if (type == "char" || type == "int8") return 1;
    if (type == "int" || type == "int32") return 4;
    if (type == "uint" || type == "uint32") return 4;
    if (type == "short" || type == "int16") return 2;
    if (type == "ushort" || type == "uint16") return 2;
    return 0;
}

float read_float(const char* data, const PlyProperty& prop) {
    if (prop.type == "float" || prop.type == "float32") {
        float v;
        std::memcpy(&v, data + prop.offset, 4);
        return v;
    }
    if (prop.type == "double" || prop.type == "float64") {
        double v;
        std::memcpy(&v, data + prop.offset, 8);
        return static_cast<float>(v);
    }
    if (prop.type == "uchar" || prop.type == "uint8") {
        // uchar is conventionally normalized [0,255] → [0,1] (color channels).
        uint8_t v;
        std::memcpy(&v, data + prop.offset, 1);
        return static_cast<float>(v) / 255.0f;
    }
    // Integer scalar types are returned as raw values (no normalization).
    // bone_index is the only known int-typed column today; if future PLY
    // columns need different semantics, decode them at the call site.
    if (prop.type == "int" || prop.type == "int32") {
        int32_t v;
        std::memcpy(&v, data + prop.offset, 4);
        return static_cast<float>(v);
    }
    if (prop.type == "uint" || prop.type == "uint32") {
        uint32_t v;
        std::memcpy(&v, data + prop.offset, 4);
        return static_cast<float>(v);
    }
    if (prop.type == "short" || prop.type == "int16") {
        int16_t v;
        std::memcpy(&v, data + prop.offset, 2);
        return static_cast<float>(v);
    }
    if (prop.type == "ushort" || prop.type == "uint16") {
        uint16_t v;
        std::memcpy(&v, data + prop.offset, 2);
        return static_cast<float>(v);
    }
    if (prop.type == "char" || prop.type == "int8") {
        int8_t v;
        std::memcpy(&v, data + prop.offset, 1);
        return static_cast<float>(v);
    }
    throw std::runtime_error("Unsupported PLY property type: " + prop.type);
}

}  // namespace

GaussianCloud GaussianCloud::load_ply(const std::string& path,
                                      CoordinateSystem coords) {
    auto resolved = resolve_asset_path(path);
    std::ifstream file(resolved, std::ios::binary);
    if (!file.is_open()) {
        throw std::runtime_error("Failed to open PLY file: " + resolved.string());
    }

    // Parse header
    std::string line;
    std::getline(file, line);
    if (line.find("ply") == std::string::npos) {
        throw std::runtime_error("Not a PLY file: " + path);
    }

    bool binary_little_endian = false;
    uint32_t vertex_count = 0;
    std::vector<PlyProperty> properties;
    size_t vertex_stride = 0;
    // Track the element currently being declared so non-vertex elements
    // (e.g. `face`, `edge`) don't leak their `property` lines into the
    // vertex layout. Without this, vertex_stride and per-property offsets
    // are corrupted whenever the PLY contains anything beyond `vertex`.
    std::string current_element;

    while (std::getline(file, line)) {
        // Strip trailing \r for Windows line endings
        if (!line.empty() && line.back() == '\r') line.pop_back();

        std::istringstream iss(line);
        std::string token;
        iss >> token;

        if (token == "format") {
            std::string fmt;
            iss >> fmt;
            binary_little_endian = (fmt == "binary_little_endian");
        } else if (token == "element") {
            uint32_t count;
            iss >> current_element >> count;
            if (current_element == "vertex") {
                vertex_count = count;
            }
        } else if (token == "property" && current_element == "vertex") {
            std::string type, name;
            iss >> type >> name;
            // List properties are variable-length per row, which would
            // invalidate the fixed vertex_stride model. 3DGS PLYs don't
            // use list-typed vertex columns; refuse the file rather than
            // produce silently-misaligned output.
            if (type == "list") {
                throw std::runtime_error(
                    "Vertex list properties are unsupported (column: " + name + ")");
            }

            PlyProperty prop;
            prop.name = name;
            prop.type = type;
            prop.offset = vertex_stride;
            prop.size = type_size(type);
            // type_size returns 0 for any unknown PLY scalar type. Recording
            // a zero-stride property would leave subsequent column offsets
            // pointing into the wrong byte ranges, silently corrupting reads.
            // Fail fast instead.
            if (prop.size == 0) {
                throw std::runtime_error(
                    "Unsupported PLY property type '" + type + "' (column: " + name + ")");
            }
            vertex_stride += prop.size;
            properties.push_back(std::move(prop));
        } else if (token == "end_header") {
            break;
        }
    }

    if (vertex_count == 0) {
        return {};
    }

    if (!binary_little_endian) {
        throw std::runtime_error("Only binary_little_endian PLY files are supported");
    }

    // Build property lookup
    std::unordered_map<std::string, const PlyProperty*> prop_map;
    for (const auto& p : properties) {
        prop_map[p.name] = &p;
    }

    // Common PLY column name variants
    auto find_prop = [&](const std::initializer_list<const char*>& names) -> const PlyProperty* {
        for (const char* n : names) {
            auto it = prop_map.find(n);
            if (it != prop_map.end()) return it->second;
        }
        return nullptr;
    };

    // Position
    auto* px = find_prop({"x"});
    auto* py = find_prop({"y"});
    auto* pz = find_prop({"z"});

    // Scale (gsplat: scale_0/1/2, nerfstudio: scaling_0/1/2, original: scale_0/1/2)
    auto* sx = find_prop({"scale_0", "scaling_0"});
    auto* sy = find_prop({"scale_1", "scaling_1"});
    auto* sz = find_prop({"scale_2", "scaling_2"});

    // Rotation quaternion (w, x, y, z ordering in PLY)
    auto* rw = find_prop({"rot_0", "rotation_0"});
    auto* rx = find_prop({"rot_1", "rotation_1"});
    auto* ry = find_prop({"rot_2", "rotation_2"});
    auto* rz = find_prop({"rot_3", "rotation_3"});

    // Color: SH DC coefficients (f_dc_0/1/2) or direct RGB (red/green/blue)
    auto* cr = find_prop({"f_dc_0", "red"});
    auto* cg = find_prop({"f_dc_1", "green"});
    auto* cb = find_prop({"f_dc_2", "blue"});
    bool use_sh = (prop_map.count("f_dc_0") > 0);

    // Opacity
    auto* op = find_prop({"opacity"});

    // Bone index (character skeletal posing)
    auto* bi = find_prop({"bone_index"});

    // Emissive intensity
    auto* em = find_prop({"emission"});

    if (!px || !py || !pz) {
        throw std::runtime_error("PLY file missing position properties (x, y, z)");
    }

    // Read binary vertex data
    std::vector<char> vertex_data(static_cast<size_t>(vertex_count) * vertex_stride);
    file.read(vertex_data.data(), static_cast<std::streamsize>(vertex_data.size()));
    if (!file) {
        throw std::runtime_error("Failed to read vertex data from PLY file");
    }

    GaussianCloud cloud;
    cloud.gaussians_.resize(vertex_count);

    for (uint32_t i = 0; i < vertex_count; ++i) {
        const char* row = vertex_data.data() + static_cast<size_t>(i) * vertex_stride;
        Gaussian& g = cloud.gaussians_[i];

        // Position
        g.position.x = read_float(row, *px);
        g.position.y = read_float(row, *py);
        g.position.z = read_float(row, *pz);

        if (coords == CoordinateSystem::kVulkanYDown) {
            g.position.y = -g.position.y;
        }

        // Scale: stored as log(scale) in standard 3DGS → apply exp()
        if (sx && sy && sz) {
            g.scale.x = std::exp(read_float(row, *sx));
            g.scale.y = std::exp(read_float(row, *sy));
            g.scale.z = std::exp(read_float(row, *sz));
        } else {
            g.scale = glm::vec3(0.01f);
        }

        // Rotation quaternion (normalized)
        if (rw && rx && ry && rz) {
            g.rotation = glm::normalize(glm::quat(
                read_float(row, *rw),
                read_float(row, *rx),
                read_float(row, *ry),
                read_float(row, *rz)
            ));
        } else {
            g.rotation = glm::quat(1.0f, 0.0f, 0.0f, 0.0f);
        }

        // Y-flip: mirror the rotation around the XZ plane by negating qx and qz
        if (coords == CoordinateSystem::kVulkanYDown) {
            g.rotation.x = -g.rotation.x;
            g.rotation.z = -g.rotation.z;
        }

        // Color
        if (cr && cg && cb) {
            if (use_sh) {
                // SH DC → linear RGB: color = SH_C0 * f_dc + 0.5
                g.color.r = kSH_C0 * read_float(row, *cr) + 0.5f;
                g.color.g = kSH_C0 * read_float(row, *cg) + 0.5f;
                g.color.b = kSH_C0 * read_float(row, *cb) + 0.5f;
            } else {
                g.color.r = read_float(row, *cr);
                g.color.g = read_float(row, *cg);
                g.color.b = read_float(row, *cb);
            }
            g.color = glm::clamp(g.color, glm::vec3(0.0f), glm::vec3(1.0f));
        } else {
            g.color = glm::vec3(1.0f);
        }

        // Opacity: stored as logit(opacity) → apply sigmoid()
        if (op) {
            float raw = read_float(row, *op);
            g.opacity = 1.0f / (1.0f + std::exp(-raw));
        } else {
            g.opacity = 1.0f;
        }

        // Importance for LOD: large, opaque Gaussians are most important
        g.importance = g.opacity * std::max({g.scale.x, g.scale.y, g.scale.z});

        // Bone index
        if (bi) {
            if (bi->type == "uchar" || bi->type == "uint8") {
                uint8_t v;
                std::memcpy(&v, row + bi->offset, 1);
                g.bone_index = static_cast<uint32_t>(v);
            } else {
                g.bone_index = static_cast<uint32_t>(read_float(row, *bi));
            }
        } else {
            g.bone_index = 0;
        }

        // Emission
        g.emission = em ? read_float(row, *em) : 0.0f;

        cloud.bounds_.expand(g.position);
    }

    return cloud;
}

GaussianCloud GaussianCloud::from_gaussians(std::vector<Gaussian> gaussians) {
    GaussianCloud cloud;
    cloud.gaussians_ = std::move(gaussians);
    for (auto& g : cloud.gaussians_) {
        g.importance = g.opacity * std::max({g.scale.x, g.scale.y, g.scale.z});
        cloud.bounds_.expand(g.position);
    }
    return cloud;
}

void GaussianCloud::write_ply(const std::string& path,
                              const std::vector<Gaussian>& gaussians,
                              CoordinateSystem coords) {
    std::ofstream file(path, std::ios::binary);
    if (!file.is_open()) {
        throw std::runtime_error("Failed to open PLY file for writing: " + path);
    }

    // Write header
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

    // Write binary vertex data
    // load_ply applies: exp(scale), sigmoid(opacity), SH_C0*f_dc+0.5 for color
    // So we write the inverse: log(scale), logit(opacity), (color-0.5)/SH_C0
    constexpr float kSH_C0 = 0.28209479177387814f;

    for (const auto& g : gaussians) {
        // Position (negate Y when writing for Y-down consumers)
        float x = g.position.x;
        float y = (coords == CoordinateSystem::kVulkanYDown) ? -g.position.y : g.position.y;
        float z = g.position.z;
        file.write(reinterpret_cast<const char*>(&x), 4);
        file.write(reinterpret_cast<const char*>(&y), 4);
        file.write(reinterpret_cast<const char*>(&z), 4);

        // Scale: write log(scale) since load_ply applies exp()
        float s0 = std::log(std::max(g.scale.x, 1e-10f));
        float s1 = std::log(std::max(g.scale.y, 1e-10f));
        float s2 = std::log(std::max(g.scale.z, 1e-10f));
        file.write(reinterpret_cast<const char*>(&s0), 4);
        file.write(reinterpret_cast<const char*>(&s1), 4);
        file.write(reinterpret_cast<const char*>(&s2), 4);

        // Rotation quaternion (stored directly, w first)
        // Mirror around XZ plane for Y-down: negate qx and qz
        float rw = g.rotation.w;
        float rx = (coords == CoordinateSystem::kVulkanYDown) ? -g.rotation.x : g.rotation.x;
        float ry = g.rotation.y;
        float rz = (coords == CoordinateSystem::kVulkanYDown) ? -g.rotation.z : g.rotation.z;
        file.write(reinterpret_cast<const char*>(&rw), 4);
        file.write(reinterpret_cast<const char*>(&rx), 4);
        file.write(reinterpret_cast<const char*>(&ry), 4);
        file.write(reinterpret_cast<const char*>(&rz), 4);

        // Color: write (color - 0.5) / SH_C0 since load_ply applies SH_C0*f_dc+0.5
        float dc0 = (g.color.r - 0.5f) / kSH_C0;
        float dc1 = (g.color.g - 0.5f) / kSH_C0;
        float dc2 = (g.color.b - 0.5f) / kSH_C0;
        file.write(reinterpret_cast<const char*>(&dc0), 4);
        file.write(reinterpret_cast<const char*>(&dc1), 4);
        file.write(reinterpret_cast<const char*>(&dc2), 4);

        // Opacity: write logit(opacity) since load_ply applies sigmoid()
        float op_clamped = std::clamp(g.opacity, 1e-6f, 1.0f - 1e-6f);
        float logit = std::log(op_clamped / (1.0f - op_clamped));
        file.write(reinterpret_cast<const char*>(&logit), 4);

        // Emission (stored directly)
        float em = g.emission;
        file.write(reinterpret_cast<const char*>(&em), 4);
    }
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

// Convert a baked GpuGaussian buffer back into the CPU Gaussian form that
// load_ply produces. `coords` is applied symmetrically with load_ply
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

GaussianCloud GaussianCloud::load_with_gsvx_first(const std::string& ply_path,
                                                   CoordinateSystem coords) {
    std::filesystem::path gsvx_candidate(ply_path);
    gsvx_candidate.replace_extension(".gsvx");
    const std::string gsvx_path_str = gsvx_candidate.string();

    // Probe for the sibling. We resolve through the same asset-root logic
    // load_gsvx will use so the existence check matches what the load
    // attempt would see.
    auto resolved = resolve_asset_path(gsvx_path_str);
    std::error_code ec;
    if (std::filesystem::is_regular_file(resolved, ec)) {
        try {
            GsvxPayload payload = load_gsvx(gsvx_path_str);
            return GaussianCloud::from_gaussians(
                unpack_gpu_gaussians(payload.gpu_gaussians, coords));
        } catch (const std::exception& e) {
            // Sibling exists but won't parse — log once per failure (worker
            // threads share stderr; expected to be rare and is useful PR-B
            // signal) and fall through to PLY.
            std::fprintf(stderr,
                "[gaussian_cloud] sibling .gsvx failed to load (%s); "
                "falling back to PLY: %s\n",
                e.what(), ply_path.c_str());
        }
    }

    return load_ply(ply_path, coords);
}

}  // namespace gseurat
