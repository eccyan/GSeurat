// PLY-format I/O for GaussianCloud.
//
// Compiled INTO offline tooling (ply2heightmap, tests) but NOT into
// gseurat_core. The runtime engine consumes pre-baked .gsvx files via
// GaussianCloud::load_gsvx — every bundled .ply has a sibling .gsvx
// produced by the build-time bake_gsvx target (CMakeLists.txt), and
// GaussianCloud::load_with_gsvx_first throws on missing .gsvx rather
// than falling back here.
//
// Splitting load_ply / write_ply off keeps the runtime binary free of
// the text-PLY parser; that's the M1 closure of #396.

#include "gseurat/engine/gaussian_cloud.hpp"

#include "gseurat/engine/project_root.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <fstream>
#include <sstream>
#include <stdexcept>
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
        uint8_t v;
        std::memcpy(&v, data + prop.offset, 1);
        return static_cast<float>(v) / 255.0f;
    }
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

    std::unordered_map<std::string, const PlyProperty*> prop_map;
    for (const auto& p : properties) {
        prop_map[p.name] = &p;
    }

    auto find_prop = [&](const std::initializer_list<const char*>& names) -> const PlyProperty* {
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

    auto* rw = find_prop({"rot_0", "rotation_0"});
    auto* rx = find_prop({"rot_1", "rotation_1"});
    auto* ry = find_prop({"rot_2", "rotation_2"});
    auto* rz = find_prop({"rot_3", "rotation_3"});

    auto* cr = find_prop({"f_dc_0", "red"});
    auto* cg = find_prop({"f_dc_1", "green"});
    auto* cb = find_prop({"f_dc_2", "blue"});
    bool use_sh = (prop_map.count("f_dc_0") > 0);

    auto* op = find_prop({"opacity"});
    auto* bi = find_prop({"bone_index"});
    auto* em = find_prop({"emission"});

    if (!px || !py || !pz) {
        throw std::runtime_error("PLY file missing position properties (x, y, z)");
    }

    std::vector<char> vertex_data(static_cast<size_t>(vertex_count) * vertex_stride);
    file.read(vertex_data.data(), static_cast<std::streamsize>(vertex_data.size()));
    if (!file) {
        throw std::runtime_error("Failed to read vertex data from PLY file");
    }

    GaussianCloud cloud;
    std::vector<Gaussian> gaussians(vertex_count);

    for (uint32_t i = 0; i < vertex_count; ++i) {
        const char* row = vertex_data.data() + static_cast<size_t>(i) * vertex_stride;
        Gaussian& g = gaussians[i];

        g.position.x = read_float(row, *px);
        g.position.y = read_float(row, *py);
        g.position.z = read_float(row, *pz);

        if (coords == CoordinateSystem::kVulkanYDown) {
            g.position.y = -g.position.y;
        }

        if (sx && sy && sz) {
            g.scale.x = std::exp(read_float(row, *sx));
            g.scale.y = std::exp(read_float(row, *sy));
            g.scale.z = std::exp(read_float(row, *sz));
        } else {
            g.scale = glm::vec3(0.01f);
        }

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

        g.importance = g.opacity * std::max({g.scale.x, g.scale.y, g.scale.z});

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

        g.emission = em ? read_float(row, *em) : 0.0f;
    }

    return GaussianCloud::from_gaussians(std::move(gaussians));
}

void GaussianCloud::write_ply(const std::string& path,
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

    // load_ply applies: exp(scale), sigmoid(opacity), SH_C0*f_dc+0.5 for color
    // So we write the inverse: log(scale), logit(opacity), (color-0.5)/SH_C0

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

}  // namespace gseurat
