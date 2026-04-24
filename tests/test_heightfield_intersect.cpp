#include "gseurat/engine/collision/intersect.hpp"
#include "gseurat/engine/ecs/components/heightfield_component.hpp"

#include <cstdio>
#include <cmath>
#include <vector>

using namespace gseurat;

static int passed = 0;
static int failed = 0;

static void check(bool cond, const char* msg) {
    if (cond) { std::printf("  PASS: %s\n", msg); passed++; }
    else      { std::printf("  FAIL: %s\n", msg); failed++; }
}

static bool approx(float a, float b, float eps = 0.01f) {
    return std::abs(a - b) < eps;
}

static bool vec_approx(const glm::vec3& a, const glm::vec3& b, float eps = 0.01f) {
    return approx(a.x, b.x, eps) && approx(a.y, b.y, eps) && approx(a.z, b.z, eps);
}

// Pair holder so HeightfieldData outlives HeightfieldInstance.
struct HfPair {
    HeightfieldData data;
    HeightfieldInstance inst;
};

static HfPair make_flat_pair(float elevation, float world_w = 10.0f,
                              float world_l = 10.0f, uint32_t res = 4) {
    float max_h = 50.0f;
    uint16_t sample = static_cast<uint16_t>((elevation / max_h) * 65535.0f);

    HfPair p;
    p.data.img_width  = res;
    p.data.img_height = res;
    p.data.samples.assign(static_cast<size_t>(res) * res, sample);

    p.inst.origin     = glm::vec3(0.0f);
    p.inst.width      = world_w;
    p.inst.length     = world_l;
    p.inst.min_height = 0.0f;
    p.inst.max_height = max_h;
    p.inst.collision_mask = 0xFFFFFFFF;
    p.inst.data       = &p.data;
    p.inst.world_aabb.min = glm::vec3(0.0f, 0.0f, 0.0f);
    p.inst.world_aabb.max = glm::vec3(world_w, max_h, world_l);
    return p;
}

static HfPair make_slope_pair(float h_low, float h_high, float world_w = 10.0f,
                               float world_l = 10.0f, uint32_t res = 4) {
    float max_h = 50.0f;
    HfPair p;
    p.data.img_width  = res;
    p.data.img_height = res;
    p.data.samples.resize(static_cast<size_t>(res) * res);

    for (uint32_t z = 0; z < res; ++z) {
        for (uint32_t x = 0; x < res; ++x) {
            float t = static_cast<float>(x) / static_cast<float>(res - 1);
            float h = h_low + t * (h_high - h_low);
            p.data.samples[z * res + x] =
                static_cast<uint16_t>((h / max_h) * 65535.0f);
        }
    }

    p.inst.origin     = glm::vec3(0.0f);
    p.inst.width      = world_w;
    p.inst.length     = world_l;
    p.inst.min_height = 0.0f;
    p.inst.max_height = max_h;
    p.inst.collision_mask = 0xFFFFFFFF;
    p.inst.data       = &p.data;
    p.inst.world_aabb.min = glm::vec3(0.0f, 0.0f, 0.0f);
    p.inst.world_aabb.max = glm::vec3(world_w, max_h, world_l);
    return p;
}

int main() {
    std::printf("=== test_heightfield_intersect ===\n");

    // ── sample_height tests ──────────────────────────────────────────
    std::printf("\n-- sample_height --\n");

    // Flat plane at elevation 5.0
    {
        auto p = make_flat_pair(5.0f);
        auto h = sample_height(p.inst, 5.0f, 5.0f);
        check(h.has_value(), "flat: center returns value");
        if (h) check(approx(*h, 5.0f), "flat: center elevation ≈ 5.0");
    }

    // Out of bounds returns nullopt
    {
        auto p = make_flat_pair(5.0f);
        check(!sample_height(p.inst, -1.0f, 5.0f).has_value(), "oob: negative X");
        check(!sample_height(p.inst, 5.0f, 11.0f).has_value(), "oob: Z > length");
    }

    // Slope: left=0, right=10 over 10 world units. At x=5 expect h≈5.
    {
        auto p = make_slope_pair(0.0f, 10.0f);
        auto h = sample_height(p.inst, 5.0f, 5.0f);
        check(h.has_value(), "slope: midpoint returns value");
        if (h) check(approx(*h, 5.0f, 0.5f), "slope: midpoint elevation ≈ 5.0");
    }

    // ── heightfield_normal tests ─────────────────────────────────────
    std::printf("\n-- heightfield_normal --\n");

    // Flat plane: normal should be (0,1,0)
    {
        auto p = make_flat_pair(5.0f, 10.0f, 10.0f, 8);
        auto n = heightfield_normal(p.inst, 5.0f, 5.0f);
        check(vec_approx(n, glm::vec3(0.0f, 1.0f, 0.0f)), "flat: normal ≈ (0,1,0)");
    }

    // Slope rising in X: normal should tilt in -X direction
    {
        auto p = make_slope_pair(0.0f, 10.0f, 10.0f, 10.0f, 16);
        auto n = heightfield_normal(p.inst, 5.0f, 5.0f);
        check(n.x < -0.1f, "slope: normal has negative X component");
        check(n.y > 0.5f,  "slope: normal has positive Y component");
        check(approx(n.z, 0.0f, 0.1f), "slope: normal Z ≈ 0");
    }

    // ── ray_vs_heightfield tests ─────────────────────────────────────
    std::printf("\n-- ray_vs_heightfield --\n");

    // Ray straight down onto flat plane at elevation 5
    {
        auto p = make_flat_pair(5.0f);
        auto hit = ray_vs_heightfield(
            glm::vec3(5.0f, 20.0f, 5.0f),
            glm::vec3(0.0f, -1.0f, 0.0f),
            p.inst);
        check(hit.has_value(), "ray_flat: hits terrain");
        if (hit) {
            check(approx(hit->point.y, 5.0f, 0.1f), "ray_flat: hit Y ≈ 5.0");
            check(hit->normal.y > 0.9f, "ray_flat: normal points up");
            check(hit->t > 0.0f, "ray_flat: t > 0");
        }
    }

    // Ray onto 45-degree slope
    {
        auto p = make_slope_pair(0.0f, 10.0f);
        auto hit = ray_vs_heightfield(
            glm::vec3(5.0f, 20.0f, 5.0f),
            glm::vec3(0.0f, -1.0f, 0.0f),
            p.inst);
        check(hit.has_value(), "ray_slope: hits terrain");
        if (hit) {
            check(approx(hit->point.y, 5.0f, 0.5f), "ray_slope: hit Y ≈ 5.0 at midpoint");
        }
    }

    // Ray parallel to terrain (miss)
    {
        auto p = make_flat_pair(5.0f);
        auto hit = ray_vs_heightfield(
            glm::vec3(5.0f, 10.0f, 5.0f),
            glm::vec3(1.0f, 0.0f, 0.0f),
            p.inst);
        check(!hit.has_value(), "ray_miss: horizontal ray misses terrain");
    }

    // Ray from below terrain (backface — should NOT hit)
    {
        auto p = make_flat_pair(5.0f);
        auto hit = ray_vs_heightfield(
            glm::vec3(5.0f, 0.0f, 5.0f),
            glm::vec3(0.0f, 1.0f, 0.0f),
            p.inst);
        check(!hit.has_value(), "ray_backface: ray from below does not hit");
    }

    // Ray outside heightfield XZ bounds (miss)
    {
        auto p = make_flat_pair(5.0f);
        auto hit = ray_vs_heightfield(
            glm::vec3(15.0f, 20.0f, 5.0f),
            glm::vec3(0.0f, -1.0f, 0.0f),
            p.inst);
        check(!hit.has_value(), "ray_oob: ray outside XZ bounds misses");
    }

    std::printf("\n%d passed, %d failed\n", passed, failed);
    return failed > 0 ? 1 : 0;
}
