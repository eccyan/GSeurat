// Test: character manifest loader
// Build: add_gseurat_test(test_character_manifest src/character/character_manifest.cpp)

#include "gseurat/character/character_manifest.hpp"
#include <cassert>
#include <cmath>
#include <cstdio>

static bool near(float a, float b, float eps = 0.001f) {
    return std::fabs(a - b) < eps;
}

int main() {
    using namespace gseurat;

    // Test 1: Load valid manifest
    {
        auto result = load_character_manifest(
            "assets/characters/warm_robot/warm_robot.manifest.json");
        assert(result.has_value() && "Should load warm_robot manifest");

        auto& data = *result;
        assert(data.name == "warm_robot");
        assert(data.ply_file == "warm_robot.ply");
        assert(near(data.scale, 0.5f));

        // 7 bones
        assert(data.bones.size() == 7);

        // Bone hierarchy
        assert(data.bones[0].id == "torso");
        assert(data.bones[0].parent_index == -1);  // root

        assert(data.bones[1].id == "head");
        assert(data.bones[1].parent_index == 0);   // parent = torso

        assert(data.bones[6].id == "antenna");
        assert(data.bones[6].parent_index == 1);   // parent = head

        // Scaled joints (original * 0.5)
        assert(near(data.bones[0].joint.x, 8.0f));   // 16 * 0.5
        assert(near(data.bones[0].joint.y, 1.5f));   // 3 * 0.5
        assert(near(data.bones[0].joint.z, 8.0f));   // 16 * 0.5

        assert(near(data.bones[1].joint.x, 8.0f));   // 16 * 0.5
        assert(near(data.bones[1].joint.y, 3.5f));   // 7 * 0.5

        // 4 poses
        assert(data.poses.size() == 4);

        // Find the "rest" pose and check rotations
        int rest_idx = data.find_pose("rest");
        assert(rest_idx >= 0);
        auto& rest = data.poses[rest_idx];
        assert(rest.rotations.size() == 7);

        // left_arm in rest: [0, 0, -80]
        int left_arm_idx = data.find_bone("left_arm");
        assert(left_arm_idx == 2);
        assert(near(rest.rotations[left_arm_idx].z, -80.0f));

        // right_arm in rest: [0, 0, 80]
        int right_arm_idx = data.find_bone("right_arm");
        assert(right_arm_idx == 3);
        assert(near(rest.rotations[right_arm_idx].z, 80.0f));

        // "breathe" pose: head [3, 0, 0], bones not listed default to [0,0,0]
        int breathe_idx = data.find_pose("breathe");
        assert(breathe_idx >= 0);
        auto& breathe = data.poses[breathe_idx];
        int head_idx = data.find_bone("head");
        assert(near(breathe.rotations[head_idx].x, 3.0f));
        // left_leg not in breathe -> defaults to 0
        int left_leg_idx = data.find_bone("left_leg");
        assert(near(breathe.rotations[left_leg_idx].x, 0.0f));
        assert(near(breathe.rotations[left_leg_idx].y, 0.0f));
        assert(near(breathe.rotations[left_leg_idx].z, 0.0f));

        // 2 clips
        assert(data.clips.size() == 2);

        // Find idle clip
        int idle_idx = data.find_clip("idle");
        assert(idle_idx >= 0);
        auto& idle = data.clips[idle_idx];
        assert(near(idle.duration, 2.0f));
        assert(idle.looping == true);
        assert(idle.keyframes.size() == 3);
        assert(near(idle.keyframes[0].time, 0.0f));
        assert(idle.keyframes[0].pose_index == rest_idx);
        assert(near(idle.keyframes[1].time, 1.0f));
        assert(idle.keyframes[1].pose_index == breathe_idx);
        assert(near(idle.keyframes[2].time, 2.0f));
        assert(idle.keyframes[2].pose_index == rest_idx);

        // Walk clip
        int walk_idx = data.find_clip("walk");
        assert(walk_idx >= 0);
        auto& walk = data.clips[walk_idx];
        assert(near(walk.duration, 0.6f));
        assert(walk.keyframes.size() == 3);

        printf("PASS: Test 1 - Load valid manifest\n");
    }

    // Test 2: Missing file returns nullopt
    {
        auto result = load_character_manifest("nonexistent/file.json");
        assert(!result.has_value() && "Should return nullopt for missing file");
        printf("PASS: Test 2 - Missing file returns nullopt\n");
    }

    // Test 3: find_bone/find_pose/find_clip helpers
    {
        auto result = load_character_manifest(
            "assets/characters/warm_robot/warm_robot.manifest.json");
        assert(result.has_value());
        auto& data = *result;

        assert(data.find_bone("torso") == 0);
        assert(data.find_bone("antenna") == 6);
        assert(data.find_bone("nonexistent") == -1);

        assert(data.find_pose("rest") >= 0);
        assert(data.find_pose("nonexistent") == -1);

        assert(data.find_clip("idle") >= 0);
        assert(data.find_clip("walk") >= 0);
        assert(data.find_clip("nonexistent") == -1);

        printf("PASS: Test 3 - find helpers\n");
    }

    printf("All character manifest tests passed.\n");
    return 0;
}
