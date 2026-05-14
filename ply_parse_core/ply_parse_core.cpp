#include "ply_parse_core.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <fstream>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <unordered_map>

namespace ply_parse_core {

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
        // uchar is conventionally normalized [0,255] → [0,1] (color channels)
        uint8_t v;
        std::memcpy(&v, data + prop.offset, 1);
        return static_cast<float>(v) / 255.0f;
    }
    // Integer scalar types are returned as raw values (no normalization).
    // The engine's bone_index column is the only known int-typed field; if
    // future PLY columns need different semantics, decode them at the call
    // site rather than baking a policy in here.
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

RawPlyCloud parse(const std::string& path, CoordinateSystem coords) {
    std::ifstream file(path, std::ios::binary);
    if (!file.is_open()) {
        throw std::runtime_error("Failed to open PLY file: " + path);
    }

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
            PlyProperty prop;
            iss >> prop.type >> prop.name;
            prop.size = type_size(prop.type);
            if (prop.size == 0) {
                throw std::runtime_error("Unknown PLY property type: " + prop.type);
            }
            prop.offset = vertex_stride;
            vertex_stride += prop.size;
            properties.push_back(std::move(prop));
        } else if (token == "end_header") {
            break;
        }
    }

    if (!binary_little_endian) {
        throw std::runtime_error("Only binary_little_endian PLY supported: " + path);
    }
    if (vertex_count == 0) {
        // Empty PLY is valid — caller gets an empty RawPlyCloud back.
        return RawPlyCloud{};
    }
    if (vertex_stride == 0) {
        throw std::runtime_error("PLY file declares vertices but no property layout: " + path);
    }

    // Build property index for fast aliased lookup
    std::unordered_map<std::string, const PlyProperty*> prop_map;
    for (const auto& p : properties) prop_map[p.name] = &p;

    auto find_prop = [&](std::initializer_list<const char*> names) -> const PlyProperty* {
        for (const char* n : names) {
            auto it = prop_map.find(n);
            if (it != prop_map.end()) return it->second;
        }
        return nullptr;
    };

    auto* px = find_prop({"x"});
    auto* py = find_prop({"y"});
    auto* pz = find_prop({"z"});

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
    const bool use_sh = (prop_map.count("f_dc_0") > 0);

    auto* op = find_prop({"opacity"});
    auto* bi = find_prop({"bone_index"});
    auto* em = find_prop({"emission"});

    if (!px || !py || !pz) {
        throw std::runtime_error("PLY file missing position properties (x, y, z): " + path);
    }

    std::vector<char> vertex_data(static_cast<size_t>(vertex_count) * vertex_stride);
    file.read(vertex_data.data(), static_cast<std::streamsize>(vertex_data.size()));
    if (!file) {
        throw std::runtime_error("Failed to read vertex data from PLY file: " + path);
    }

    RawPlyCloud cloud;
    cloud.splats.resize(vertex_count);
    cloud.bounds_min = glm::vec3( std::numeric_limits<float>::max());
    cloud.bounds_max = glm::vec3(-std::numeric_limits<float>::max());

    for (uint32_t i = 0; i < vertex_count; ++i) {
        const char* row = vertex_data.data() + static_cast<size_t>(i) * vertex_stride;
        RawSplat& s = cloud.splats[i];

        s.position.x = read_float(row, *px);
        s.position.y = read_float(row, *py);
        s.position.z = read_float(row, *pz);

        if (coords == CoordinateSystem::kVulkanYDown) {
            s.position.y = -s.position.y;
        }

        // Scale: stored as log(scale) in standard 3DGS → apply exp().
        // Per-axis fallback so PLYs that omit individual scale columns
        // (e.g. isotropic exporters that only emit `scale_0`) preserve
        // whatever components are present rather than collapsing the
        // whole splat to the all-axes default — Codex P2 on PR #453.
        s.scale.x = sx ? std::exp(read_float(row, *sx)) : 0.01f;
        s.scale.y = sy ? std::exp(read_float(row, *sy)) : 0.01f;
        s.scale.z = sz ? std::exp(read_float(row, *sz)) : 0.01f;

        // Rotation quaternion, stored as w,x,y,z in PLY → normalize.
        if (rw && rx && ry && rz) {
            s.rotation = glm::normalize(glm::quat(
                read_float(row, *rw),
                read_float(row, *rx),
                read_float(row, *ry),
                read_float(row, *rz)
            ));
        } else {
            s.rotation = glm::quat(1.0f, 0.0f, 0.0f, 0.0f);
        }

        // Y-flip: mirror the rotation around the XZ plane by negating qx and qz.
        if (coords == CoordinateSystem::kVulkanYDown) {
            s.rotation.x = -s.rotation.x;
            s.rotation.z = -s.rotation.z;
        }

        if (cr && cg && cb) {
            if (use_sh) {
                // SH DC → linear RGB: color = SH_C0 * f_dc + 0.5
                s.color.r = kSH_C0 * read_float(row, *cr) + 0.5f;
                s.color.g = kSH_C0 * read_float(row, *cg) + 0.5f;
                s.color.b = kSH_C0 * read_float(row, *cb) + 0.5f;
            } else {
                s.color.r = read_float(row, *cr);
                s.color.g = read_float(row, *cg);
                s.color.b = read_float(row, *cb);
            }
            s.color = glm::clamp(s.color, glm::vec3(0.0f), glm::vec3(1.0f));
        } else {
            s.color = glm::vec3(1.0f);
        }

        // Opacity: stored as logit(opacity) → apply sigmoid()
        if (op) {
            float raw = read_float(row, *op);
            s.opacity = 1.0f / (1.0f + std::exp(-raw));
        } else {
            s.opacity = 1.0f;
        }

        // Bone index (uchar fast path matches both legacy parsers' behavior).
        if (bi) {
            if (bi->type == "uchar" || bi->type == "uint8") {
                uint8_t v;
                std::memcpy(&v, row + bi->offset, 1);
                s.bone_index = static_cast<uint32_t>(v);
            } else {
                s.bone_index = static_cast<uint32_t>(read_float(row, *bi));
            }
        } else {
            s.bone_index = 0;
        }

        s.emission = em ? read_float(row, *em) : 0.0f;

        cloud.bounds_min = glm::min(cloud.bounds_min, s.position);
        cloud.bounds_max = glm::max(cloud.bounds_max, s.position);
    }

    return cloud;
}

}  // namespace ply_parse_core
