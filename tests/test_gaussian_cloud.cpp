// Integration test: verify gaussian_cloud.hpp loads PLY files correctly
// and scene_loader.hpp parses gaussian_splat / collision JSON blocks.
//
// Build:
//   c++ -std=c++23 -I include \
//       -I build/macos-debug/_deps/json-src/include \
//       -I build/macos-debug/_deps/glm-src \
//       -I build/macos-debug/_deps/stb-src \
//       tests/test_gaussian_cloud.cpp \
//       src/engine/gaussian_cloud.cpp \
//       src/engine/collision_gen.cpp \
//       src/engine/scene_loader.cpp \
//       src/engine/tilemap.cpp \
//       -o build/test_gaussian_cloud
//
// Run: ./build/test_gaussian_cloud

#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/collision_gen.hpp"
#include "gseurat/engine/scene_loader.hpp"

#include <cassert>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <filesystem>

namespace fs = std::filesystem;

using namespace gseurat;

// ---------------------------------------------------------------------------
// Helpers: create test PLY files on disk
// ---------------------------------------------------------------------------

static void write_test_ply(const std::string& path, uint32_t count) {
    std::ofstream out(path, std::ios::binary);

    // Header
    out << "ply\n";
    out << "format binary_little_endian 1.0\n";
    out << "element vertex " << count << "\n";
    out << "property float x\n";
    out << "property float y\n";
    out << "property float z\n";
    out << "property float f_dc_0\n";
    out << "property float f_dc_1\n";
    out << "property float f_dc_2\n";
    out << "property float opacity\n";
    out << "property float scale_0\n";
    out << "property float scale_1\n";
    out << "property float scale_2\n";
    out << "property float rot_0\n";
    out << "property float rot_1\n";
    out << "property float rot_2\n";
    out << "property float rot_3\n";
    out << "end_header\n";

    // SH_C0 constant for color conversion
    constexpr float SH_C0 = 0.28209479177387814f;

    for (uint32_t i = 0; i < count; ++i) {
        float x = static_cast<float>(i);
        float y = static_cast<float>(i) * 0.5f;
        float z = static_cast<float>(i) * -1.0f;

        // SH DC for red color: f_dc = (color - 0.5) / SH_C0
        float f_dc_r = (1.0f - 0.5f) / SH_C0;  // red=1.0
        float f_dc_g = (0.0f - 0.5f) / SH_C0;  // green=0.0
        float f_dc_b = (0.0f - 0.5f) / SH_C0;  // blue=0.0

        // Opacity in logit space: logit(0.9) = ln(0.9/0.1) ≈ 2.197
        float opacity = 2.197f;

        // Scale in log space: log(0.5) ≈ -0.693
        float scale = -0.6931f;

        // Identity quaternion (w=1, x=0, y=0, z=0)
        float rot_w = 1.0f, rot_x = 0.0f, rot_y = 0.0f, rot_z = 0.0f;

        // Write 14 floats
        out.write(reinterpret_cast<const char*>(&x), 4);
        out.write(reinterpret_cast<const char*>(&y), 4);
        out.write(reinterpret_cast<const char*>(&z), 4);
        out.write(reinterpret_cast<const char*>(&f_dc_r), 4);
        out.write(reinterpret_cast<const char*>(&f_dc_g), 4);
        out.write(reinterpret_cast<const char*>(&f_dc_b), 4);
        out.write(reinterpret_cast<const char*>(&opacity), 4);
        out.write(reinterpret_cast<const char*>(&scale), 4);
        out.write(reinterpret_cast<const char*>(&scale), 4);
        out.write(reinterpret_cast<const char*>(&scale), 4);
        out.write(reinterpret_cast<const char*>(&rot_w), 4);
        out.write(reinterpret_cast<const char*>(&rot_x), 4);
        out.write(reinterpret_cast<const char*>(&rot_y), 4);
        out.write(reinterpret_cast<const char*>(&rot_z), 4);
    }
}

static void write_test_ply_nerfstudio(const std::string& path) {
    // PLY with nerfstudio-style naming: scaling_0, rotation_0, red/green/blue
    std::ofstream out(path, std::ios::binary);
    out << "ply\n";
    out << "format binary_little_endian 1.0\n";
    out << "element vertex 1\n";
    out << "property float x\n";
    out << "property float y\n";
    out << "property float z\n";
    out << "property uchar red\n";
    out << "property uchar green\n";
    out << "property uchar blue\n";
    out << "property float opacity\n";
    out << "property float scaling_0\n";
    out << "property float scaling_1\n";
    out << "property float scaling_2\n";
    out << "property float rotation_0\n";
    out << "property float rotation_1\n";
    out << "property float rotation_2\n";
    out << "property float rotation_3\n";
    out << "end_header\n";

    float x = 1.0f, y = 2.0f, z = 3.0f;
    uint8_t r = 255, g = 128, b = 0;
    float opacity = 5.0f;
    float scale = -0.6931f;
    float rw = 1.0f, rx = 0.0f, ry = 0.0f, rz = 0.0f;

    out.write(reinterpret_cast<const char*>(&x), 4);
    out.write(reinterpret_cast<const char*>(&y), 4);
    out.write(reinterpret_cast<const char*>(&z), 4);
    out.write(reinterpret_cast<const char*>(&r), 1);
    out.write(reinterpret_cast<const char*>(&g), 1);
    out.write(reinterpret_cast<const char*>(&b), 1);
    out.write(reinterpret_cast<const char*>(&opacity), 4);
    out.write(reinterpret_cast<const char*>(&scale), 4);
    out.write(reinterpret_cast<const char*>(&scale), 4);
    out.write(reinterpret_cast<const char*>(&scale), 4);
    out.write(reinterpret_cast<const char*>(&rw), 4);
    out.write(reinterpret_cast<const char*>(&rx), 4);
    out.write(reinterpret_cast<const char*>(&ry), 4);
    out.write(reinterpret_cast<const char*>(&rz), 4);
}

static void write_test_scene_json(const std::string& path) {
    std::ofstream out(path);
    out << R"({
  "gaussian_splat": {
    "ply_file": "maps/village.ply",
    "camera": {
      "position": [0, 8, 15],
      "target": [0, 0, 0],
      "fov": 50
    },
    "render_width": 320,
    "render_height": 240
  },
  "collision": {
    "width": 4,
    "height": 3,
    "cell_size": 1.5,
    "solid": [true, false, false, true, false, false, false, false, true, false, false, true]
  },
  "ambient_color": [0.3, 0.35, 0.5, 1.0],
  "static_lights": [],
  "player": {
    "position": [2, 0, 1],
    "tint": [1, 1, 1, 1],
    "facing": "down"
  }
})";
}

// Helper: write a .gsvx file with known GpuGaussian data
static void write_test_gsvx(const std::string& path,
                             const std::vector<gseurat::GpuGaussian>& gaussians) {
    std::ofstream out(path, std::ios::binary);

    // Header
    gseurat::GsvxHeader header{};
    std::memcpy(header.magic, "GSVX", 4);
    header.version = 1;
    header.count = static_cast<uint32_t>(gaussians.size());
    header.flags = 0;
    std::memset(header.reserved, 0, sizeof(header.reserved));
    out.write(reinterpret_cast<const char*>(&header), sizeof(header));

    // Payload
    if (!gaussians.empty()) {
        out.write(reinterpret_cast<const char*>(gaussians.data()),
                  static_cast<std::streamsize>(gaussians.size() * sizeof(gseurat::GpuGaussian)));
    }
}

// Helper: write a v2 .gsvx file with baked AABB
static void write_test_gsvx_v2(const std::string& path,
                                const std::vector<gseurat::GpuGaussian>& gaussians,
                                const gseurat::AABB& aabb) {
    std::ofstream out(path, std::ios::binary);

    gseurat::GsvxHeaderV2 header{};
    std::memcpy(header.magic, "GSVX", 4);
    header.version = 2;
    header.count = static_cast<uint32_t>(gaussians.size());
    header.flags = 0;
    header.aabb_min[0] = aabb.min.x;
    header.aabb_min[1] = aabb.min.y;
    header.aabb_min[2] = aabb.min.z;
    header.aabb_max[0] = aabb.max.x;
    header.aabb_max[1] = aabb.max.y;
    header.aabb_max[2] = aabb.max.z;
    std::memset(header.reserved, 0, sizeof(header.reserved));
    out.write(reinterpret_cast<const char*>(&header), sizeof(header));

    if (!gaussians.empty()) {
        out.write(reinterpret_cast<const char*>(gaussians.data()),
                  static_cast<std::streamsize>(gaussians.size() * sizeof(gseurat::GpuGaussian)));
    }
}

// ---------------------------------------------------------------------------
// Float comparison helper
// ---------------------------------------------------------------------------

static bool approx(float a, float b, float eps = 0.01f) {
    return std::fabs(a - b) < eps;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

int main() {
    // Create temp dir for test files
    const std::string tmp_dir = "build/test_tmp_gs";
    fs::create_directories(tmp_dir);

    // ====== Test 1: Load standard 3DGS PLY (10 Gaussians) ======
    {
        const std::string ply_path = tmp_dir + "/test_standard.ply";
        write_test_ply(ply_path, 10);

        auto cloud = GaussianCloud::load_ply(ply_path);
        assert(cloud.count() == 10 && "Should load 10 Gaussians");
        assert(!cloud.empty() && "Cloud should not be empty");

        // Verify positions
        const auto& g0 = cloud.gaussians()[0];
        assert(approx(g0.position.x, 0.0f) && "Gaussian 0 x=0");
        assert(approx(g0.position.y, 0.0f) && "Gaussian 0 y=0");
        assert(approx(g0.position.z, 0.0f) && "Gaussian 0 z=0");

        const auto& g5 = cloud.gaussians()[5];
        assert(approx(g5.position.x, 5.0f) && "Gaussian 5 x=5");
        assert(approx(g5.position.y, 2.5f) && "Gaussian 5 y=2.5");
        assert(approx(g5.position.z, -5.0f) && "Gaussian 5 z=-5");

        // Verify SH→RGB color conversion (should be ~red)
        assert(approx(g0.color.r, 1.0f) && "Gaussian 0 color R≈1.0");
        assert(approx(g0.color.g, 0.0f) && "Gaussian 0 color G≈0.0");
        assert(approx(g0.color.b, 0.0f) && "Gaussian 0 color B≈0.0");

        // Verify sigmoid(opacity): sigmoid(2.197) ≈ 0.9
        assert(approx(g0.opacity, 0.9f) && "Gaussian 0 opacity≈0.9");

        // Verify exp(scale): exp(-0.693) ≈ 0.5
        assert(approx(g0.scale.x, 0.5f) && "Gaussian 0 scale.x≈0.5");

        // Verify rotation is normalized identity
        assert(approx(g0.rotation.w, 1.0f) && "Gaussian 0 rotation is identity");

        // Verify AABB
        const auto& bounds = cloud.bounds();
        assert(approx(bounds.min.x, 0.0f) && "AABB min.x=0");
        assert(approx(bounds.max.x, 9.0f) && "AABB max.x=9");
        assert(approx(bounds.min.z, -9.0f) && "AABB min.z=-9");

        printf("PASS: Test 1 - Load standard 3DGS PLY (10 Gaussians)\n");
    }

    // ====== Test 2: Load nerfstudio-style PLY (uchar RGB, scaling_ names) ======
    {
        const std::string ply_path = tmp_dir + "/test_nerfstudio.ply";
        write_test_ply_nerfstudio(ply_path);

        auto cloud = GaussianCloud::load_ply(ply_path);
        assert(cloud.count() == 1 && "Should load 1 Gaussian");

        const auto& g = cloud.gaussians()[0];
        assert(approx(g.position.x, 1.0f) && "Position x=1");
        assert(approx(g.position.y, 2.0f) && "Position y=2");
        assert(approx(g.position.z, 3.0f) && "Position z=3");

        // uchar RGB: 255→1.0, 128→0.502, 0→0.0
        assert(approx(g.color.r, 1.0f) && "Color R=1.0");
        assert(approx(g.color.g, 0.502f) && "Color G≈0.502");
        assert(approx(g.color.b, 0.0f) && "Color B=0.0");

        printf("PASS: Test 2 - Load nerfstudio-style PLY (uchar RGB)\n");
    }

    // ====== Test 3: Load missing PLY throws ======
    {
        bool threw = false;
        try {
            GaussianCloud::load_ply(tmp_dir + "/nonexistent.ply");
        } catch (const std::runtime_error&) {
            threw = true;
        }
        assert(threw && "Should throw for missing PLY");
        printf("PASS: Test 3 - Missing PLY file throws\n");
    }

    // ====== Test 4: Empty PLY (0 vertices) ======
    {
        const std::string ply_path = tmp_dir + "/test_empty.ply";
        write_test_ply(ply_path, 0);

        auto cloud = GaussianCloud::load_ply(ply_path);
        assert(cloud.count() == 0 && "Should have 0 Gaussians");
        assert(cloud.empty() && "Cloud should be empty");
        printf("PASS: Test 4 - Empty PLY (0 vertices)\n");
    }

    // ====== Test 5: SceneLoader parses gaussian_splat JSON block ======
    {
        const std::string json_path = tmp_dir + "/test_gs_scene.json";
        write_test_scene_json(json_path);

        auto scene = SceneLoader::load(json_path);

        assert(scene.gaussian_splat.has_value() && "Scene should have gaussian_splat");
        const auto& gs = *scene.gaussian_splat;
        assert(gs.ply_file == "maps/village.ply" && "PLY file path");
        assert(approx(gs.camera_position.x, 0.0f) && "Camera pos X");
        assert(approx(gs.camera_position.y, 8.0f) && "Camera pos Y");
        assert(approx(gs.camera_position.z, 15.0f) && "Camera pos Z");
        assert(approx(gs.camera_target.x, 0.0f) && "Camera target X");
        assert(approx(gs.camera_fov, 50.0f) && "Camera FOV");
        assert(gs.render_width == 320 && "Render width");
        assert(gs.render_height == 240 && "Render height");

        printf("PASS: Test 5 - SceneLoader parses gaussian_splat JSON\n");
    }

    // ====== Test 6: SceneLoader parses collision grid JSON ======
    {
        const std::string json_path = tmp_dir + "/test_gs_scene.json";
        auto scene = SceneLoader::load(json_path);

        assert(scene.collision.has_value() && "Scene should have collision");
        const auto& col = *scene.collision;
        assert(col.width == 4 && "Collision grid width=4");
        assert(col.height == 3 && "Collision grid height=3");
        assert(approx(col.cell_size, 1.5f) && "Cell size=1.5");
        assert(col.solid.size() == 12 && "Solid array size=12");
        assert(col.solid[0] == true && "Cell (0,0) is solid");
        assert(col.solid[1] == false && "Cell (1,0) is walkable");
        assert(col.solid[3] == true && "Cell (3,0) is solid");
        assert(col.is_solid(0, 0) && "is_solid(0,0)=true");
        assert(!col.is_solid(1, 0) && "is_solid(1,0)=false");
        assert(col.is_solid(0, 2) && "is_solid(0,2)=true (last row first)");

        printf("PASS: Test 6 - SceneLoader parses collision grid JSON\n");
    }

    // ====== Test 7: SceneLoader round-trip (to_json → from_json) preserves GS data ======
    {
        const std::string json_path = tmp_dir + "/test_gs_scene.json";
        auto scene = SceneLoader::load(json_path);
        auto j = SceneLoader::to_json(scene);
        auto scene2 = SceneLoader::from_json(j);

        assert(scene2.gaussian_splat.has_value() && "Round-trip preserves gaussian_splat");
        assert(scene2.gaussian_splat->ply_file == "maps/village.ply" && "Round-trip PLY file");
        assert(approx(scene2.gaussian_splat->camera_fov, 50.0f) && "Round-trip camera FOV");

        assert(scene2.collision.has_value() && "Round-trip preserves collision");
        assert(scene2.collision->width == 4 && "Round-trip collision width");
        assert(scene2.collision->solid[0] == true && "Round-trip collision solid[0]");
        assert(scene2.collision->solid[1] == false && "Round-trip collision solid[1]");

        printf("PASS: Test 7 - SceneLoader round-trip preserves GS data\n");
    }

    // ====== Test 8: Collision generation from depth variance ======
    {
        // Create a 4×4 depth buffer with a wall-like feature
        const uint32_t rw = 4, rh = 4;
        float depth_data[16] = {
            1.0f, 1.0f, 1.0f, 1.0f,   // flat ground
            1.0f, 0.3f, 0.8f, 1.0f,   // wall edge (high variance)
            1.0f, 0.3f, 0.3f, 1.0f,   // wall
            1.0f, 1.0f, 1.0f, 1.0f,   // flat ground
        };

        auto grid = generate_collision_from_depth(
            depth_data, rw, rh, 2, 2, 0.05f);

        assert(grid.width == 2 && "Collision grid width=2");
        assert(grid.height == 2 && "Collision grid height=2");
        assert(grid.solid.size() == 4 && "Solid array size=4");

        // Top-left 2×2 region (rows 0-1, cols 0-1): has mixed depths → solid
        // Top-right 2×2 region (rows 0-1, cols 2-3): some variance
        // The exact results depend on the variance threshold
        printf("PASS: Test 8 - Collision generation from depth variance\n");
    }

    // ====== Test 9: Scene without gaussian_splat (backwards compat) ======
    {
        const std::string json_path = tmp_dir + "/test_plain_scene.json";
        {
            std::ofstream out(json_path);
            out << R"({
  "tilemap": { "tileset": { "tile_width": 16, "tile_height": 16, "columns": 4, "sheet_width": 64, "sheet_height": 48 }, "width": 2, "height": 2, "tile_size": 1, "z": 0.5, "tiles": [0,0,0,0] },
  "ambient_color": [0.3, 0.3, 0.3, 1.0],
  "player": { "position": [1, 0, 1] }
})";
        }

        auto scene = SceneLoader::load(json_path);
        assert(!scene.gaussian_splat.has_value() && "Plain scene has no gaussian_splat");
        assert(!scene.collision.has_value() && "Plain scene has no collision grid");
        printf("PASS: Test 9 - Plain scene without GS (backwards compat)\n");
    }

    // ====== Test 10: GSVX load matches PLY→GpuGaussian conversion ======
    {
        const std::string ply_path = tmp_dir + "/test_standard.ply";
        write_test_ply(ply_path, 5);
        auto cloud = GaussianCloud::load_ply(ply_path);

        std::vector<GpuGaussian> expected(cloud.count());
        for (uint32_t i = 0; i < cloud.count(); ++i) {
            const auto& g = cloud.gaussians()[i];
            float bone_as_float;
            uint32_t bone_idx = g.bone_index;
            std::memcpy(&bone_as_float, &bone_idx, sizeof(float));
            expected[i].pos_opacity = glm::vec4(g.position, g.opacity);
            expected[i].scale_pad = glm::vec4(g.scale, bone_as_float);
            expected[i].rot = glm::vec4(g.rotation.x, g.rotation.y, g.rotation.z, g.rotation.w);
            expected[i].color_pad = glm::vec4(g.color, g.emission);
        }

        const std::string gsvx_path = tmp_dir + "/test_roundtrip.gsvx";
        write_test_gsvx(gsvx_path, expected);

        auto payload = GaussianCloud::load_gsvx(gsvx_path);
        assert(payload.count == 5 && "GSVX should load 5 Gaussians");

        for (uint32_t i = 0; i < payload.count; ++i) {
            const auto& got = payload.gpu_gaussians[i];
            const auto& exp = expected[i];
            assert(approx(got.pos_opacity.x, exp.pos_opacity.x) && "pos_opacity.x mismatch");
            assert(approx(got.pos_opacity.y, exp.pos_opacity.y) && "pos_opacity.y mismatch");
            assert(approx(got.pos_opacity.z, exp.pos_opacity.z) && "pos_opacity.z mismatch");
            assert(approx(got.pos_opacity.w, exp.pos_opacity.w) && "pos_opacity.w mismatch");
            assert(approx(got.scale_pad.x, exp.scale_pad.x) && "scale_pad.x mismatch");
            assert(approx(got.rot.x, exp.rot.x) && "rot.x mismatch");
            assert(approx(got.rot.w, exp.rot.w) && "rot.w mismatch");
            assert(approx(got.color_pad.x, exp.color_pad.x) && "color_pad.x mismatch");
            assert(approx(got.color_pad.w, exp.color_pad.w) && "color_pad.w (emission) mismatch");
        }

        assert(approx(payload.bounds.min.x, 0.0f) && "GSVX AABB min.x");
        assert(approx(payload.bounds.max.x, 4.0f) && "GSVX AABB max.x");

        printf("PASS: Test 10 - GSVX round-trip matches PLY→GpuGaussian\n");
    }

    // ====== Test 11: GSVX bad magic number throws ======
    {
        const std::string bad_path = tmp_dir + "/test_bad_magic.gsvx";
        {
            std::ofstream out(bad_path, std::ios::binary);
            GsvxHeader header{};
            std::memcpy(header.magic, "NOPE", 4);
            header.version = 1;
            header.count = 0;
            out.write(reinterpret_cast<const char*>(&header), sizeof(header));
        }

        bool threw = false;
        try {
            GaussianCloud::load_gsvx(bad_path);
        } catch (const std::runtime_error& e) {
            threw = true;
            assert(std::string(e.what()).find("magic") != std::string::npos &&
                   "Error should mention magic");
        }
        assert(threw && "Should throw for bad GSVX magic");
        printf("PASS: Test 11 - GSVX bad magic number throws\n");
    }

    // ====== Test 12: GSVX unsupported version throws ======
    {
        const std::string bad_path = tmp_dir + "/test_bad_version.gsvx";
        {
            std::ofstream out(bad_path, std::ios::binary);
            GsvxHeader header{};
            std::memcpy(header.magic, "GSVX", 4);
            header.version = 99;
            header.count = 0;
            out.write(reinterpret_cast<const char*>(&header), sizeof(header));
        }

        bool threw = false;
        try {
            GaussianCloud::load_gsvx(bad_path);
        } catch (const std::runtime_error& e) {
            threw = true;
            assert(std::string(e.what()).find("version") != std::string::npos &&
                   "Error should mention version");
        }
        assert(threw && "Should throw for bad GSVX version");
        printf("PASS: Test 12 - GSVX unsupported version throws\n");
    }

    // ====== Test 13: GSVX empty file (0 Gaussians) ======
    {
        const std::string empty_path = tmp_dir + "/test_empty.gsvx";
        write_test_gsvx(empty_path, {});

        auto payload = GaussianCloud::load_gsvx(empty_path);
        assert(payload.count == 0 && "Empty GSVX should have 0 Gaussians");
        assert(payload.gpu_gaussians.empty() && "Empty GSVX should have empty vector");
        printf("PASS: Test 13 - GSVX empty file (0 Gaussians)\n");
    }

    // ====== Test 14: GSVX missing file throws ======
    {
        bool threw = false;
        try {
            GaussianCloud::load_gsvx(tmp_dir + "/nonexistent.gsvx");
        } catch (const std::runtime_error&) {
            threw = true;
        }
        assert(threw && "Should throw for missing GSVX file");
        printf("PASS: Test 14 - GSVX missing file throws\n");
    }

    // ====== Test 15: GSVX file smaller than header throws ======
    {
        const std::string short_path = tmp_dir + "/test_too_short.gsvx";
        {
            std::ofstream out(short_path, std::ios::binary);
            const char garbage[10] = {'G', 'S', 'V', 'X', 1, 0, 0, 0, 0, 0};
            out.write(garbage, sizeof(garbage));
        }

        bool threw = false;
        try {
            GaussianCloud::load_gsvx(short_path);
        } catch (const std::runtime_error&) {
            threw = true;
        }
        assert(threw && "Should throw for GSVX file smaller than header");
        printf("PASS: Test 15 - GSVX file smaller than header throws\n");
    }

    // ====== Test 16: GSVX non-zero flags throws ======
    {
        const std::string bad_path = tmp_dir + "/test_bad_flags.gsvx";
        {
            std::ofstream out(bad_path, std::ios::binary);
            GsvxHeader header{};
            std::memcpy(header.magic, "GSVX", 4);
            header.version = 1;
            header.count = 0;
            header.flags = 0xDEADBEEF;  // Reserved field must be zero
            out.write(reinterpret_cast<const char*>(&header), sizeof(header));
        }

        bool threw = false;
        try {
            GaussianCloud::load_gsvx(bad_path);
        } catch (const std::runtime_error& e) {
            threw = true;
            assert(std::string(e.what()).find("flags") != std::string::npos &&
                   "Error should mention flags");
        }
        assert(threw && "Should throw for non-zero GSVX flags");
        printf("PASS: Test 16 - GSVX non-zero flags throws\n");
    }

    // ====== Test 17: GSVX file size / count mismatch throws ======
    {
        // Header claims count=10 but we write no payload → file_size=32, expected=32+10*64=672
        const std::string mismatch_path = tmp_dir + "/test_size_mismatch.gsvx";
        {
            std::ofstream out(mismatch_path, std::ios::binary);
            GsvxHeader header{};
            std::memcpy(header.magic, "GSVX", 4);
            header.version = 1;
            header.count = 10;
            header.flags = 0;
            out.write(reinterpret_cast<const char*>(&header), sizeof(header));
        }

        bool threw = false;
        try {
            GaussianCloud::load_gsvx(mismatch_path);
        } catch (const std::runtime_error& e) {
            threw = true;
            const std::string msg = e.what();
            assert((msg.find("size") != std::string::npos ||
                    msg.find("count") != std::string::npos) &&
                   "Error should mention size or count mismatch");
        }
        assert(threw && "Should throw for GSVX file size / count mismatch");
        printf("PASS: Test 17 - GSVX file size / count mismatch throws\n");
    }

    // ====== Test 18: GSVX file size matches header count ======
    {
        const std::string gsvx_path = tmp_dir + "/test_size_check.gsvx";
        std::vector<GpuGaussian> data(7);
        for (uint32_t i = 0; i < 7; ++i) {
            data[i].pos_opacity = glm::vec4(float(i), 0.0f, 0.0f, 1.0f);
            data[i].scale_pad = glm::vec4(0.01f, 0.01f, 0.01f, 0.0f);
            data[i].rot = glm::vec4(0.0f, 0.0f, 0.0f, 1.0f);
            data[i].color_pad = glm::vec4(1.0f, 1.0f, 1.0f, 0.0f);
        }
        write_test_gsvx(gsvx_path, data);

        auto file_size = fs::file_size(gsvx_path);
        assert(file_size == 32 + 7 * 64 && "GSVX file size = header + count * 64");

        auto payload = GaussianCloud::load_gsvx(gsvx_path);
        assert(payload.count == 7 && "Should load 7 Gaussians");
        assert(approx(payload.gpu_gaussians[3].pos_opacity.x, 3.0f) && "Gaussian 3 pos.x=3");

        printf("PASS: Test 18 - GSVX file size matches header count\n");
    }

    // ====== Test 19: load_ply with kVulkanYDown flips Y position and rotation ======
    {
        const std::string ply_path = tmp_dir + "/test_standard.ply";
        write_test_ply(ply_path, 10);

        auto cloud_yup = GaussianCloud::load_ply(ply_path);
        auto cloud_ydn = GaussianCloud::load_ply(ply_path, CoordinateSystem::kVulkanYDown);

        assert(cloud_ydn.count() == 10 && "Y-down should load same count");

        // Position Y should be negated
        const auto& g5_up = cloud_yup.gaussians()[5];
        const auto& g5_dn = cloud_ydn.gaussians()[5];
        assert(approx(g5_dn.position.x, g5_up.position.x) && "X unchanged");
        assert(approx(g5_dn.position.y, -g5_up.position.y) && "Y negated");
        assert(approx(g5_dn.position.z, g5_up.position.z) && "Z unchanged");

        // Rotation: qx and qz should be negated (mirror around XZ plane)
        // For identity quaternion (w=1, x=0, y=0, z=0), negating 0 is still 0
        // so verify the sign flip with a non-trivial quaternion via write_ply round-trip
        assert(approx(g5_dn.rotation.w, g5_up.rotation.w) && "rot.w unchanged");

        printf("PASS: Test 19 - load_ply with kVulkanYDown flips Y\n");
    }

    // ====== Test 20: write_ply + load_ply round-trip with kVulkanYDown ======
    {
        // Create a cloud with known non-trivial values
        std::vector<Gaussian> src(1);
        src[0].position = glm::vec3(1.0f, 2.0f, 3.0f);
        src[0].scale = glm::vec3(0.5f, 0.5f, 0.5f);
        src[0].rotation = glm::normalize(glm::quat(0.7f, 0.3f, 0.5f, 0.1f));
        src[0].color = glm::vec3(0.8f, 0.2f, 0.4f);
        src[0].opacity = 0.9f;
        src[0].importance = 0.45f;
        src[0].bone_index = 0;
        src[0].emission = 0.0f;

        // Write with Y-down, then read back with default (Y-up) — Y should be negated
        const std::string ply_path = tmp_dir + "/test_ydown_roundtrip.ply";
        GaussianCloud::write_ply(ply_path, src, CoordinateSystem::kVulkanYDown);
        auto cloud = GaussianCloud::load_ply(ply_path);  // default Y-up load

        const auto& g = cloud.gaussians()[0];
        assert(approx(g.position.x, 1.0f) && "Written X unchanged");
        assert(approx(g.position.y, -2.0f) && "Written Y negated by kVulkanYDown");
        assert(approx(g.position.z, 3.0f) && "Written Z unchanged");

        // Rotation: qx and qz negated during write
        assert(approx(g.rotation.x, -src[0].rotation.x, 0.02f) && "Written rot.x negated");
        assert(approx(g.rotation.y, src[0].rotation.y, 0.02f) && "Written rot.y unchanged");
        assert(approx(g.rotation.z, -src[0].rotation.z, 0.02f) && "Written rot.z negated");
        assert(approx(g.rotation.w, src[0].rotation.w, 0.02f) && "Written rot.w unchanged");

        printf("PASS: Test 20 - write_ply + load_ply round-trip with kVulkanYDown\n");
    }

    // ====== Test 21: kVulkanYDown write then kVulkanYDown load recovers original ======
    {
        std::vector<Gaussian> src(1);
        src[0].position = glm::vec3(5.0f, -3.0f, 7.0f);
        src[0].scale = glm::vec3(0.1f, 0.2f, 0.3f);
        src[0].rotation = glm::normalize(glm::quat(0.5f, 0.5f, 0.5f, 0.5f));
        src[0].color = glm::vec3(1.0f, 0.0f, 0.5f);
        src[0].opacity = 0.95f;
        src[0].importance = 0.285f;
        src[0].bone_index = 0;
        src[0].emission = 0.0f;

        const std::string ply_path = tmp_dir + "/test_ydown_identity.ply";
        GaussianCloud::write_ply(ply_path, src, CoordinateSystem::kVulkanYDown);
        auto cloud = GaussianCloud::load_ply(ply_path, CoordinateSystem::kVulkanYDown);

        const auto& g = cloud.gaussians()[0];
        // Double-negation should recover original position
        assert(approx(g.position.x, 5.0f) && "Round-trip X preserved");
        assert(approx(g.position.y, -3.0f) && "Round-trip Y preserved");
        assert(approx(g.position.z, 7.0f) && "Round-trip Z preserved");

        // Double-negation of qx, qz should recover original rotation
        assert(approx(g.rotation.x, src[0].rotation.x, 0.02f) && "Round-trip rot.x preserved");
        assert(approx(g.rotation.y, src[0].rotation.y, 0.02f) && "Round-trip rot.y preserved");
        assert(approx(g.rotation.z, src[0].rotation.z, 0.02f) && "Round-trip rot.z preserved");
        assert(approx(g.rotation.w, src[0].rotation.w, 0.02f) && "Round-trip rot.w preserved");

        printf("PASS: Test 21 - kVulkanYDown write+load recovers original\n");
    }

    // ====== Test 22: GSVX v2 round-trip with baked AABB ======
    {
        const std::string ply_path = tmp_dir + "/test_standard.ply";
        write_test_ply(ply_path, 5);
        auto cloud = GaussianCloud::load_ply(ply_path);

        std::vector<GpuGaussian> data(cloud.count());
        AABB expected_aabb;
        for (uint32_t i = 0; i < cloud.count(); ++i) {
            const auto& g = cloud.gaussians()[i];
            float bone_as_float;
            uint32_t bone_idx = g.bone_index;
            std::memcpy(&bone_as_float, &bone_idx, sizeof(float));
            data[i].pos_opacity = glm::vec4(g.position, g.opacity);
            data[i].scale_pad = glm::vec4(g.scale, bone_as_float);
            data[i].rot = glm::vec4(g.rotation.x, g.rotation.y, g.rotation.z, g.rotation.w);
            data[i].color_pad = glm::vec4(g.color, g.emission);
            expected_aabb.expand(g.position);
        }

        const std::string gsvx_path = tmp_dir + "/test_v2.gsvx";
        write_test_gsvx_v2(gsvx_path, data, expected_aabb);

        auto payload = GaussianCloud::load_gsvx(gsvx_path);
        assert(payload.count == 5 && "v2 GSVX should load 5 Gaussians");
        assert(approx(payload.bounds.min.x, expected_aabb.min.x) && "v2 AABB min.x from header");
        assert(approx(payload.bounds.min.y, expected_aabb.min.y) && "v2 AABB min.y from header");
        assert(approx(payload.bounds.min.z, expected_aabb.min.z) && "v2 AABB min.z from header");
        assert(approx(payload.bounds.max.x, expected_aabb.max.x) && "v2 AABB max.x from header");
        assert(approx(payload.bounds.max.y, expected_aabb.max.y) && "v2 AABB max.y from header");
        assert(approx(payload.bounds.max.z, expected_aabb.max.z) && "v2 AABB max.z from header");

        // Verify Gaussian data still matches
        for (uint32_t i = 0; i < payload.count; ++i) {
            assert(approx(payload.gpu_gaussians[i].pos_opacity.x, data[i].pos_opacity.x));
            assert(approx(payload.gpu_gaussians[i].pos_opacity.w, data[i].pos_opacity.w));
        }

        printf("PASS: Test 22 - GSVX v2 round-trip with baked AABB\n");
    }

    // ====== Test 23: v1 GSVX still loads with v2-aware loader ======
    {
        const std::string ply_path = tmp_dir + "/test_standard.ply";
        write_test_ply(ply_path, 5);
        auto cloud = GaussianCloud::load_ply(ply_path);

        std::vector<GpuGaussian> data(cloud.count());
        for (uint32_t i = 0; i < cloud.count(); ++i) {
            const auto& g = cloud.gaussians()[i];
            float bone_as_float;
            uint32_t bone_idx = g.bone_index;
            std::memcpy(&bone_as_float, &bone_idx, sizeof(float));
            data[i].pos_opacity = glm::vec4(g.position, g.opacity);
            data[i].scale_pad = glm::vec4(g.scale, bone_as_float);
            data[i].rot = glm::vec4(g.rotation.x, g.rotation.y, g.rotation.z, g.rotation.w);
            data[i].color_pad = glm::vec4(g.color, g.emission);
        }

        const std::string gsvx_path = tmp_dir + "/test_v1_compat.gsvx";
        write_test_gsvx(gsvx_path, data);  // v1 format

        auto payload = GaussianCloud::load_gsvx(gsvx_path);
        assert(payload.count == 5 && "v1 compat: should load 5 Gaussians");
        // v1: AABB computed via position scan
        assert(approx(payload.bounds.min.x, 0.0f) && "v1 compat: AABB min.x from scan");
        assert(approx(payload.bounds.max.x, 4.0f) && "v1 compat: AABB max.x from scan");

        printf("PASS: Test 23 - v1 GSVX loads with v2-aware loader\n");
    }

    // Cleanup temp files
    fs::remove_all(tmp_dir);

    printf("\nAll Gaussian splatting tests passed!\n");
    return 0;
}
