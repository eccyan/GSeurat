#include "vulkan_game/engine/gaussian_cloud.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <unordered_map>

namespace vulkan_game {

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
    return 0.0f;
}

}  // namespace

GaussianCloud GaussianCloud::load_ply(const std::string& path) {
    std::ifstream file(path, std::ios::binary);
    if (!file.is_open()) {
        throw std::runtime_error("Failed to open PLY file: " + path);
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
            std::string elem_name;
            uint32_t count;
            iss >> elem_name >> count;
            if (elem_name == "vertex") {
                vertex_count = count;
            }
        } else if (token == "property") {
            std::string type, name;
            iss >> type >> name;
            // Skip list properties
            if (type == "list") continue;

            PlyProperty prop;
            prop.name = name;
            prop.type = type;
            prop.offset = vertex_stride;
            prop.size = type_size(type);
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
                              const std::vector<Gaussian>& gaussians) {
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
    file << "end_header\n";

    // Write binary vertex data
    // load_ply applies: exp(scale), sigmoid(opacity), SH_C0*f_dc+0.5 for color
    // So we write the inverse: log(scale), logit(opacity), (color-0.5)/SH_C0
    constexpr float kSH_C0 = 0.28209479177387814f;

    for (const auto& g : gaussians) {
        // Position (stored directly)
        float x = g.position.x, y = g.position.y, z = g.position.z;
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
        float rw = g.rotation.w, rx = g.rotation.x;
        float ry = g.rotation.y, rz = g.rotation.z;
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
    }
}

}  // namespace vulkan_game
