#include "gseurat/engine/collision/collision_system.hpp"
#include "gseurat/engine/ecs/components/heightfield_component.hpp"

#include <cstdio>
#include <cmath>

using namespace gseurat;

static int passed = 0;
static int failed = 0;

static void check(bool cond, const char* msg) {
    if (cond) { std::printf("  PASS: %s\n", msg); passed++; }
    else      { std::printf("  FAIL: %s\n", msg); failed++; }
}

static bool approx(float a, float b, float eps = 0.1f) {
    return std::abs(a - b) < eps;
}

int main() {
    std::printf("=== test_heightfield_system ===\n");

    ecs::World world;

    // Create heightfield entity — flat terrain at elevation 5.0
    auto terrain_entity = world.create();

    ecs::Transform terrain_transform;
    terrain_transform.position = coord::WorldPos(glm::vec3(0.0f));
    world.add<ecs::Transform>(terrain_entity, terrain_transform);

    HeightfieldComponent hf;
    hf.image_path = "test";
    hf.width = 20.0f;
    hf.length = 20.0f;
    hf.min_height = 0.0f;
    hf.max_height = 50.0f;
    hf.collision_mask = 0xFFFFFFFF;
    hf.data.img_width = 8;
    hf.data.img_height = 8;
    uint16_t flat_sample = static_cast<uint16_t>((5.0f / 50.0f) * 65535.0f);
    hf.data.samples.assign(64, flat_sample);
    hf.world_aabb.min = glm::vec3(0.0f, 0.0f, 0.0f);
    hf.world_aabb.max = glm::vec3(20.0f, 50.0f, 20.0f);
    world.add<HeightfieldComponent>(terrain_entity, hf);

    CollisionSystem cs;
    cs.rebuild_cache(world);

    // Test 1: Raycast down onto heightfield
    {
        auto hit = cs.raycast(
            glm::vec3(10.0f, 20.0f, 10.0f),
            glm::vec3(0.0f, -1.0f, 0.0f),
            100.0f, 0xFFFFFFFF);
        check(hit.has_value(), "raycast: hits heightfield");
        if (hit) {
            check(approx(hit->point.y, 5.0f), "raycast: hit Y ~= 5.0");
        }
    }

    // Test 2: Sweep capsule down onto heightfield
    {
        CapsuleData cap{0.3f, 0.5f};
        auto result = cs.sweep(
            glm::vec3(10.0f, 15.0f, 10.0f),
            glm::quat(1, 0, 0, 0), cap,
            glm::vec3(0.0f, -1.0f, 0.0f), 15.0f,
            0xFFFFFFFF);
        check(result.has_value(), "sweep: hits heightfield");
        if (result) {
            check(result->hit.normal.y > 0.9f, "sweep: normal points up");
        }
    }

    // Test 3: Raycast miss (outside heightfield)
    {
        auto hit = cs.raycast(
            glm::vec3(30.0f, 20.0f, 10.0f),
            glm::vec3(0.0f, -1.0f, 0.0f),
            100.0f, 0xFFFFFFFF);
        check(!hit.has_value(), "raycast_miss: outside heightfield XZ");
    }

    // Test 4: Heightfield + box primitive — sweep hits closest (box is higher)
    {
        auto box_entity = world.create();

        ecs::Transform box_transform;
        box_transform.position = coord::WorldPos(glm::vec3(10.0f, 8.0f, 10.0f));
        world.add<ecs::Transform>(box_entity, box_transform);

        ColliderComponent box_c;
        box_c.shape = BoxData{glm::vec3(2.0f, 0.5f, 2.0f)};
        world.add<ColliderComponent>(box_entity, box_c);

        cs.mark_dirty();
        cs.rebuild_cache(world);

        CapsuleData cap{0.3f, 0.5f};
        auto result = cs.sweep(
            glm::vec3(10.0f, 15.0f, 10.0f),
            glm::quat(1, 0, 0, 0), cap,
            glm::vec3(0.0f, -1.0f, 0.0f), 15.0f,
            0xFFFFFFFF);
        check(result.has_value(), "mixed: sweep hits something");
        if (result) {
            check(result->hit.point.y > 7.0f, "mixed: hits box before terrain");
        }
    }

    std::printf("\n%d passed, %d failed\n", passed, failed);
    return failed > 0 ? 1 : 0;
}
