#include "gseurat/engine/ecs/components/collider_component.hpp"
#include "gseurat/engine/ecs/components/kinematic_body.hpp"

#include <cstdio>
#include <cmath>

using namespace gseurat;

static int passed = 0;
static int failed = 0;

static void check(bool cond, const char* msg) {
    if (cond) { std::printf("  PASS: %s\n", msg); passed++; }
    else      { std::printf("  FAIL: %s\n", msg); failed++; }
}

static bool approx(float a, float b, float eps = 0.001f) {
    return std::abs(a - b) < eps;
}

int main() {
    std::printf("=== test_collider_json ===\n");

    // ── Test 1: Box round-trip ─────────────────────────────────────
    {
        nlohmann::json j = {
            {"shape", {{"type", "box"}, {"half_extents", {2.0f, 0.5f, 3.0f}}}},
            {"offset", {1.0f, 2.0f, 3.0f}}
        };
        ColliderComponent c = collider_from_json(j);
        nlohmann::json out = collider_to_json(c);

        check(std::holds_alternative<BoxData>(c.shape), "box round-trip: shape is BoxData");
        const auto& box = std::get<BoxData>(c.shape);
        check(approx(box.half_extents.x, 2.0f) &&
              approx(box.half_extents.y, 0.5f) &&
              approx(box.half_extents.z, 3.0f), "box round-trip: half_extents match");
        check(approx(c.offset.x, 1.0f) &&
              approx(c.offset.y, 2.0f) &&
              approx(c.offset.z, 3.0f), "box round-trip: offset matches");
        check(out["shape"]["type"] == "box", "box round-trip: serialized type is box");
        check(approx(out["shape"]["half_extents"][0].get<float>(), 2.0f) &&
              approx(out["shape"]["half_extents"][1].get<float>(), 0.5f) &&
              approx(out["shape"]["half_extents"][2].get<float>(), 3.0f),
              "box round-trip: serialized half_extents match");
    }

    // ── Test 2: Sphere round-trip ──────────────────────────────────
    {
        nlohmann::json j = {
            {"shape", {{"type", "sphere"}, {"radius", 1.5f}}}
        };
        ColliderComponent c = collider_from_json(j);
        nlohmann::json out = collider_to_json(c);

        check(std::holds_alternative<SphereData>(c.shape), "sphere round-trip: shape is SphereData");
        check(approx(std::get<SphereData>(c.shape).radius, 1.5f), "sphere round-trip: radius = 1.5");
        check(out["shape"]["type"] == "sphere", "sphere round-trip: serialized type is sphere");
        check(approx(out["shape"]["radius"].get<float>(), 1.5f), "sphere round-trip: serialized radius = 1.5");
    }

    // ── Test 3: Capsule round-trip ─────────────────────────────────
    {
        nlohmann::json j = {
            {"shape", {{"type", "capsule"}, {"radius", 0.4f}, {"half_height", 0.8f}}}
        };
        ColliderComponent c = collider_from_json(j);
        nlohmann::json out = collider_to_json(c);

        check(std::holds_alternative<CapsuleData>(c.shape), "capsule round-trip: shape is CapsuleData");
        const auto& cap = std::get<CapsuleData>(c.shape);
        check(approx(cap.radius, 0.4f), "capsule round-trip: radius = 0.4");
        check(approx(cap.half_height, 0.8f), "capsule round-trip: half_height = 0.8");
        check(out["shape"]["type"] == "capsule", "capsule round-trip: serialized type is capsule");
        check(approx(out["shape"]["radius"].get<float>(), 0.4f) &&
              approx(out["shape"]["half_height"].get<float>(), 0.8f),
              "capsule round-trip: serialized fields match");
    }

    // ── Test 4: Unknown shape type falls back to sphere ────────────
    {
        nlohmann::json j = {
            {"shape", {{"type", "cylinder"}}}
        };
        ColliderComponent c = collider_from_json(j);

        check(std::holds_alternative<SphereData>(c.shape), "unknown shape: falls back to SphereData");
        check(approx(std::get<SphereData>(c.shape).radius, 0.5f), "unknown shape: default radius = 0.5");
    }

    // ── Test 5: Missing fields use defaults ────────────────────────
    {
        nlohmann::json j = nlohmann::json::object();
        ColliderComponent c = collider_from_json(j);

        check(std::holds_alternative<SphereData>(c.shape), "empty json: default shape is SphereData");
        check(approx(c.offset.x, 0.0f) &&
              approx(c.offset.y, 0.0f) &&
              approx(c.offset.z, 0.0f), "empty json: default offset is zero");
        check(approx(c.local_rotation.w, 1.0f) &&
              approx(c.local_rotation.x, 0.0f) &&
              approx(c.local_rotation.y, 0.0f) &&
              approx(c.local_rotation.z, 0.0f), "empty json: default local_rotation is identity");
        check(c.collision_mask == 0xFFFFFFFF, "empty json: default collision_mask = 0xFFFFFFFF");
        check(c.is_trigger == false, "empty json: default is_trigger = false");
        check(c.is_dynamic == false, "empty json: default is_dynamic = false");
    }

    // ── Test 6: is_trigger and is_dynamic ─────────────────────────
    {
        nlohmann::json j = {{"is_trigger", true}, {"is_dynamic", true}};
        ColliderComponent c = collider_from_json(j);

        check(c.is_trigger == true, "flags: is_trigger = true");
        check(c.is_dynamic == true, "flags: is_dynamic = true");
    }

    // ── Test 7: collision_mask ─────────────────────────────────────
    {
        nlohmann::json j = {{"collision_mask", 255u}};
        ColliderComponent c = collider_from_json(j);

        check(c.collision_mask == 255u, "collision_mask: parsed as 255");
    }

    // ── Test 8: KinematicBody derived computation ──────────────────
    {
        nlohmann::json j = {{"desired_jump_height", 3.0f}, {"time_to_apex", 0.5f}};
        KinematicBody kb = kinematic_body_from_json(j);

        // derived_gravity = 2 * 3.0 / (0.5 * 0.5) = 24.0
        // derived_jump_velocity = 2 * 3.0 / 0.5 = 12.0
        check(approx(kb.derived_gravity, 24.0f), "kinematic derived: gravity = 24.0");
        check(approx(kb.derived_jump_velocity, 12.0f), "kinematic derived: jump_velocity = 12.0");
    }

    // ── Test 9: KinematicBody round-trip preserves designer params ─
    {
        nlohmann::json j = {
            {"gravity_scale", 0.8f},
            {"desired_jump_height", 3.0f},
            {"time_to_apex", 0.5f}
        };
        KinematicBody kb1 = kinematic_body_from_json(j);
        nlohmann::json out = kinematic_body_to_json(kb1);
        KinematicBody kb2 = kinematic_body_from_json(out);

        check(approx(kb2.gravity_scale, 0.8f), "kinematic round-trip: gravity_scale matches");
        check(approx(kb2.desired_jump_height, 3.0f), "kinematic round-trip: desired_jump_height matches");
        check(approx(kb2.time_to_apex, 0.5f), "kinematic round-trip: time_to_apex matches");
        check(approx(kb2.derived_gravity, 24.0f), "kinematic round-trip: derived_gravity matches");
        check(approx(kb2.derived_jump_velocity, 12.0f), "kinematic round-trip: derived_jump_velocity matches");
    }

    // ── Test 10: KinematicBody defaults ───────────────────────────
    {
        nlohmann::json j = nlohmann::json::object();
        KinematicBody kb = kinematic_body_from_json(j);

        check(approx(kb.gravity_scale, 1.0f), "kinematic defaults: gravity_scale = 1.0");
        check(approx(kb.desired_jump_height, 2.0f), "kinematic defaults: desired_jump_height = 2.0");
        check(approx(kb.time_to_apex, 0.4f), "kinematic defaults: time_to_apex = 0.4");
        // derived_gravity = 2*2 / (0.4*0.4) = 4 / 0.16 = 25.0
        check(approx(kb.derived_gravity, 25.0f), "kinematic defaults: derived_gravity = 25.0");
        // derived_jump_velocity = 2*2 / 0.4 = 10.0
        check(approx(kb.derived_jump_velocity, 10.0f), "kinematic defaults: derived_jump_velocity = 10.0");
    }

    // ── Test 11: Runtime fields NOT serialized ─────────────────────
    {
        KinematicBody kb;
        kb.velocity = glm::vec3(1.0f, 2.0f, 3.0f);
        kb.grounded = true;
        kb.recompute_derived();
        nlohmann::json out = kinematic_body_to_json(kb);

        check(!out.contains("velocity"), "runtime fields: velocity not serialized");
        check(!out.contains("grounded"), "runtime fields: grounded not serialized");
        check(!out.contains("derived_gravity"), "runtime fields: derived_gravity not serialized");
        check(!out.contains("derived_jump_velocity"), "runtime fields: derived_jump_velocity not serialized");
    }

    std::printf("\n=== Results: %d passed, %d failed ===\n", passed, failed);
    return (failed == 0) ? 0 : 1;
}
