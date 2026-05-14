// #393 follow-up: cross-wrapper round-trip drift detector.
//
// `ply_parse_core` (#453) eliminated the duplicated PLY header walk +
// per-row decoding shared between the engine-side parser and the
// standalone GSVX baker. But the two consumers each still hand-write
// a per-field copy: `gseurat::ply::load` produces `Gaussian` (per-field
// 68 B struct, plus a derived `importance` field), while
// `ply_importer::parse_ply` packs into `GpuGaussian` (4×vec4, std430,
// 64 B). If a future tweak to either wrapper drifts (e.g. changing
// which field goes in `.w` of a packed vec4), this test catches it.
//
// Approach:
// - Build a tiny in-memory fixture .ply with known values for every
//   field (position, scale, rotation, color/SH, opacity, bone_index,
//   emission).
// - Parse through both wrappers.
// - Unpack each `GpuGaussian` back into its 7 fields and assert
//   field-by-field equality with the engine's `Gaussian` (within
//   float epsilon).
// - Assert the engine's derived `importance` field matches
//   `opacity * max(scale)`.

#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/gaussian_cloud_ply.hpp"
#include "ply_parse.hpp"  // tools/ply_importer/ply_parse.hpp via target_include

#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

namespace {

// Fixture splat values. Picked so the post-parse derived values are
// either round numbers or known irrationals — avoids fixture rot from
// papering over a drift.
struct Fixture {
    float pos_x, pos_y, pos_z;
    float scale_log_0, scale_log_1, scale_log_2;  // PLY stores log(scale)
    float rot_w, rot_x, rot_y, rot_z;
    float dc_r, dc_g, dc_b;                       // PLY stores SH DC (will be SH_C0*x+0.5)
    float opacity_logit;                          // PLY stores logit(opacity)
    uint8_t bone_index;
    float emission;
};

constexpr float kSH_C0 = 0.28209479177387814f;

const std::vector<Fixture> fixtures = {
    // 0: origin, identity rot, mid-gray color, opacity=0.5 (logit=0), no bone
    {0.0f, 0.0f, 0.0f,
     /*scale_log*/ -0.6931472f, -0.6931472f, -0.6931472f,  // log(0.5)
     /*rot*/        1.0f, 0.0f, 0.0f, 0.0f,
     /*dc*/         0.0f, 0.0f, 0.0f,                       // SH_C0*0+0.5 = 0.5
     /*op_logit*/   0.0f,                                   // sigmoid(0)=0.5
     /*bone*/       0,
     /*emission*/   0.0f},

    // 1: +X axis, 90° rotation around Y, red, opacity high
    {1.0f, 0.0f, 0.0f,
     -1.2039728f, -1.2039728f, -1.2039728f,                 // log(0.3)
     0.70710677f, 0.0f, 0.70710677f, 0.0f,                  // 90° about Y
     1.0f, -1.0f, -1.0f,                                    // SH → ≈0.782/0.218/0.218 clamped
     2.0f,                                                  // sigmoid(2) ≈ 0.881
     5,
     0.5f},

    // 2: -Y axis, non-uniform scale, color clamping (negative SH dc)
    {0.0f, -1.0f, 0.0f,
     -2.3025851f, -1.6094379f, -0.5108256f,                 // log(0.1), log(0.2), log(0.6)
     0.0f, 1.0f, 0.0f, 0.0f,                                // 180° about X
     -10.0f, -10.0f, 5.0f,                                  // r/g clamped to 0, b ≈ 1.91 clamped to 1
     -3.0f,                                                 // sigmoid(-3) ≈ 0.047
     17,
     1.0f},

    // 3: small irrational position, near-identity quat
    {0.123456f, 0.789012f, -0.345678f,
     -3.4011974f, -3.4011974f, -3.4011974f,                 // log(0.0333...)
     0.99619472f, 0.087155744f, 0.0f, 0.0f,                 // ~10° about X
     -0.5f, 0.5f, 1.5f,                                     // SH → 0.359/0.641/0.923 (none clamp)
     1.5f,                                                  // sigmoid(1.5) ≈ 0.818
     255,                                                   // max uchar
     3.14159f},

    // 4: -Z axis, scale that exercises max-of-three for importance
    {-2.0f, 0.5f, -3.0f,
     -0.9162907f, -2.302585f, -1.6094379f,                  // log(0.4), log(0.1), log(0.2)
     0.5f, 0.5f, 0.5f, 0.5f,                                // pre-normalized identity-ish
     0.7f, -0.3f, 0.2f,                                     // mixed within-range
     -1.0f,                                                 // sigmoid(-1) ≈ 0.269
     42,
     0.0f},
};

// Write the fixtures to a binary_little_endian PLY using the same
// column conventions the parsers accept (f_dc_*, opacity logit, log
// scale, w-first quaternion, uchar bone_index).
void write_fixture_ply(const std::string& path) {
    std::ofstream f(path, std::ios::binary);
    if (!f.is_open()) {
        std::fprintf(stderr, "Failed to open fixture path for write: %s\n", path.c_str());
        std::exit(1);
    }
    f << "ply\n";
    f << "format binary_little_endian 1.0\n";
    f << "element vertex " << fixtures.size() << "\n";
    f << "property float x\n"
      << "property float y\n"
      << "property float z\n"
      << "property float scale_0\n"
      << "property float scale_1\n"
      << "property float scale_2\n"
      << "property float rot_0\n"
      << "property float rot_1\n"
      << "property float rot_2\n"
      << "property float rot_3\n"
      << "property float f_dc_0\n"
      << "property float f_dc_1\n"
      << "property float f_dc_2\n"
      << "property float opacity\n"
      << "property uchar bone_index\n"
      << "property float emission\n";
    f << "end_header\n";

    auto wf = [&](float v) { f.write(reinterpret_cast<const char*>(&v), 4); };
    for (const auto& fx : fixtures) {
        wf(fx.pos_x); wf(fx.pos_y); wf(fx.pos_z);
        wf(fx.scale_log_0); wf(fx.scale_log_1); wf(fx.scale_log_2);
        wf(fx.rot_w); wf(fx.rot_x); wf(fx.rot_y); wf(fx.rot_z);
        wf(fx.dc_r); wf(fx.dc_g); wf(fx.dc_b);
        wf(fx.opacity_logit);
        f.write(reinterpret_cast<const char*>(&fx.bone_index), 1);
        wf(fx.emission);
    }
}

// Float comparison: 1e-5 absolute tolerance handles SH/sigmoid roundoff.
bool approx_eq(float a, float b, float eps = 1e-5f) {
    return std::fabs(a - b) <= eps;
}

bool approx_eq_v3(const glm::vec3& a, const glm::vec3& b, float eps = 1e-5f) {
    return approx_eq(a.x, b.x, eps) && approx_eq(a.y, b.y, eps) && approx_eq(a.z, b.z, eps);
}

}  // namespace

int main() {
    namespace fs = std::filesystem;
    fs::path tmp_dir = fs::temp_directory_path() / "gseurat_test_ply_round_trip";
    fs::create_directories(tmp_dir);
    std::string fixture_path = (tmp_dir / "fixture.ply").string();
    write_fixture_ply(fixture_path);

    // ── Engine wrapper path ────────────────────────────────────────────
    gseurat::GaussianCloud engine_cloud = gseurat::ply::load(fixture_path);
    const auto& engine_g = engine_cloud.gaussians();
    assert(engine_g.size() == fixtures.size());

    // ── Tool wrapper path ──────────────────────────────────────────────
    ply_importer::PlyCloud tool_cloud = ply_importer::parse_ply(fixture_path);
    const auto& tool_g = tool_cloud.gaussians;
    assert(tool_g.size() == fixtures.size());

    // ── Field-by-field cross-validation ────────────────────────────────
    for (size_t i = 0; i < fixtures.size(); ++i) {
        const gseurat::Gaussian& eng = engine_g[i];
        const ply_importer::GpuGaussian& tool = tool_g[i];

        // Position: engine = (x,y,z); tool = pos_opacity.xyz
        glm::vec3 tool_pos(tool.pos_opacity.x, tool.pos_opacity.y, tool.pos_opacity.z);
        if (!approx_eq_v3(eng.position, tool_pos)) {
            std::fprintf(stderr, "FAIL splat %zu: position drift — engine=(%.6f,%.6f,%.6f) tool=(%.6f,%.6f,%.6f)\n",
                i, eng.position.x, eng.position.y, eng.position.z,
                tool_pos.x, tool_pos.y, tool_pos.z);
            return 1;
        }

        // Opacity: engine = .opacity; tool = pos_opacity.w
        if (!approx_eq(eng.opacity, tool.pos_opacity.w)) {
            std::fprintf(stderr, "FAIL splat %zu: opacity drift — engine=%.6f tool=%.6f\n",
                i, eng.opacity, tool.pos_opacity.w);
            return 1;
        }

        // Scale: engine = .scale; tool = scale_pad.xyz
        glm::vec3 tool_scale(tool.scale_pad.x, tool.scale_pad.y, tool.scale_pad.z);
        if (!approx_eq_v3(eng.scale, tool_scale)) {
            std::fprintf(stderr, "FAIL splat %zu: scale drift — engine=(%.6f,%.6f,%.6f) tool=(%.6f,%.6f,%.6f)\n",
                i, eng.scale.x, eng.scale.y, eng.scale.z,
                tool_scale.x, tool_scale.y, tool_scale.z);
            return 1;
        }

        // bone_index: engine = .bone_index (uint32); tool = scale_pad.w (uint32 reinterp as float bits)
        uint32_t tool_bone;
        std::memcpy(&tool_bone, &tool.scale_pad.w, sizeof(uint32_t));
        if (eng.bone_index != tool_bone) {
            std::fprintf(stderr, "FAIL splat %zu: bone_index drift — engine=%u tool=%u\n",
                i, eng.bone_index, tool_bone);
            return 1;
        }

        // Rotation: engine = .rotation (glm::quat: w + x,y,z); tool = rot (vec4: x,y,z,w)
        // Per `ply_importer::parse_ply` wrapper: rot = vec4(rotation.x, .y, .z, .w)
        if (!approx_eq(eng.rotation.x, tool.rot.x) ||
            !approx_eq(eng.rotation.y, tool.rot.y) ||
            !approx_eq(eng.rotation.z, tool.rot.z) ||
            !approx_eq(eng.rotation.w, tool.rot.w)) {
            std::fprintf(stderr, "FAIL splat %zu: rotation drift — engine=(w=%.6f,x=%.6f,y=%.6f,z=%.6f) tool=(x=%.6f,y=%.6f,z=%.6f,w=%.6f)\n",
                i, eng.rotation.w, eng.rotation.x, eng.rotation.y, eng.rotation.z,
                tool.rot.x, tool.rot.y, tool.rot.z, tool.rot.w);
            return 1;
        }

        // Color: engine = .color (post-SH→RGB, clamped); tool = color_pad.xyz
        glm::vec3 tool_color(tool.color_pad.x, tool.color_pad.y, tool.color_pad.z);
        if (!approx_eq_v3(eng.color, tool_color)) {
            std::fprintf(stderr, "FAIL splat %zu: color drift — engine=(%.6f,%.6f,%.6f) tool=(%.6f,%.6f,%.6f)\n",
                i, eng.color.r, eng.color.g, eng.color.b,
                tool_color.r, tool_color.g, tool_color.b);
            return 1;
        }

        // Emission: engine = .emission; tool = color_pad.w
        if (!approx_eq(eng.emission, tool.color_pad.w)) {
            std::fprintf(stderr, "FAIL splat %zu: emission drift — engine=%.6f tool=%.6f\n",
                i, eng.emission, tool.color_pad.w);
            return 1;
        }

        // Engine-only derived: importance = opacity * max(scale.xyz)
        float expected_importance = eng.opacity *
            std::max({eng.scale.x, eng.scale.y, eng.scale.z});
        if (!approx_eq(eng.importance, expected_importance)) {
            std::fprintf(stderr, "FAIL splat %zu: importance derivation drift — engine=%.6f expected=%.6f\n",
                i, eng.importance, expected_importance);
            return 1;
        }
    }

    // ── Bounds sanity check (tool tracks AABB; engine doesn't expose
    //    parser-side AABB but its GaussianCloud::bounds() should match) ──
    auto eng_bounds = engine_cloud.bounds();
    if (!approx_eq_v3(eng_bounds.min, tool_cloud.bounds.min) ||
        !approx_eq_v3(eng_bounds.max, tool_cloud.bounds.max)) {
        std::fprintf(stderr, "FAIL: bounds drift — engine min=(%.3f,%.3f,%.3f) max=(%.3f,%.3f,%.3f); "
                             "tool min=(%.3f,%.3f,%.3f) max=(%.3f,%.3f,%.3f)\n",
            eng_bounds.min.x, eng_bounds.min.y, eng_bounds.min.z,
            eng_bounds.max.x, eng_bounds.max.y, eng_bounds.max.z,
            tool_cloud.bounds.min.x, tool_cloud.bounds.min.y, tool_cloud.bounds.min.z,
            tool_cloud.bounds.max.x, tool_cloud.bounds.max.y, tool_cloud.bounds.max.z);
        return 1;
    }

    // Cleanup (ignore errors — temp dir is OS-managed anyway).
    std::error_code ec;
    fs::remove_all(tmp_dir, ec);

    std::printf("PASS: PLY round-trip — %zu splats, engine ↔ tool wrappers agree\n", fixtures.size());
    return 0;
}
