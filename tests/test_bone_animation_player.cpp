// Test: bone animation player
// Build: add_gseurat_test(test_bone_animation_player src/character/character_manifest.cpp src/character/bone_animation_player.cpp)

#include "gseurat/character/bone_animation_player.hpp"
#include "gseurat/character/character_manifest.hpp"
#include <cassert>
#include <cmath>
#include <cstdio>

static bool near(float a, float b, float eps = 0.001f) {
    return std::fabs(a - b) < eps;
}

static bool is_identity(const glm::mat4& m, float eps = 0.001f) {
    glm::mat4 id(1.0f);
    for (int c = 0; c < 4; ++c)
        for (int r = 0; r < 4; ++r)
            if (std::fabs(m[c][r] - id[c][r]) > eps) return false;
    return true;
}

int main() {
    using namespace gseurat;

    auto result = load_character_manifest(
        "assets/characters/warm_robot/warm_robot.manifest.json");
    assert(result.has_value() && "Should load warm_robot manifest");
    auto& data = *result;

    // Test 1: Play walk clip — verify is_playing(), current_clip(), transforms non-identity at t=0
    {
        BoneAnimationPlayer player(data);
        player.play("walk");
        assert(player.is_playing());
        assert(player.current_clip() == "walk");

        // walk_1 pose has non-zero rotations, so transforms should be non-identity
        const auto& transforms = player.bone_transforms();
        // torso has rotation [5,0,0] in walk_1
        assert(!is_identity(transforms[0]) && "Torso should have non-identity transform at walk_1");

        printf("PASS: Test 1 - Play walk clip\n");
    }

    // Test 2: Midpoint interpolation — update(0.15f) on walk (halfway between kf0=0.0 and kf1=0.3)
    {
        BoneAnimationPlayer player(data);
        player.play("walk");
        player.update(0.15f);
        assert(player.is_playing());

        const auto& transforms = player.bone_transforms();
        // Torso should still have a non-identity transform (interpolated)
        assert(!is_identity(transforms[0]) && "Torso should be non-identity at midpoint");

        printf("PASS: Test 2 - Midpoint interpolation\n");
    }

    // Test 3: Looping — update(0.7f) on walk (duration=0.6), verify still playing
    {
        BoneAnimationPlayer player(data);
        player.play("walk");
        player.update(0.7f);
        assert(player.is_playing() && "Walk clip should still be playing after loop");

        printf("PASS: Test 3 - Looping\n");
    }

    // Test 4: Idle clip — play idle, update, verify playing
    {
        BoneAnimationPlayer player(data);
        player.play("idle");
        assert(player.is_playing());
        assert(player.current_clip() == "idle");
        player.update(0.5f);
        assert(player.is_playing());

        printf("PASS: Test 4 - Idle clip\n");
    }

    // Test 5: Non-existent clip — play("nonexistent"), verify !is_playing()
    {
        BoneAnimationPlayer player(data);
        player.play("nonexistent");
        assert(!player.is_playing() && "Non-existent clip should not play");

        printf("PASS: Test 5 - Non-existent clip\n");
    }

    // Test 6: FK chain — antenna (bone 6, parent=head=1) gets non-identity from parent chain
    {
        BoneAnimationPlayer player(data);
        player.play("idle");
        player.update(0.5f);  // Partway into idle, head has rotation [~1.5, 0, 0]

        const auto& transforms = player.bone_transforms();
        int antenna_idx = data.find_bone("antenna");
        assert(antenna_idx == 6);

        // The antenna itself has [0,0,0] in rest but head (parent) has rotation,
        // so antenna should get a non-identity transform from the FK chain
        // At t=0.5 in idle (between rest@0.0 and breathe@1.0), head rotation is ~[1.5,0,0]
        assert(!is_identity(transforms[antenna_idx]) &&
               "Antenna should inherit parent (head) transform via FK chain");

        printf("PASS: Test 6 - FK chain\n");
    }

    // Test 7: Root motion delta extraction
    {
        // Create CharacterData with 1 root bone, 2 poses, looping walk clip with root_motion=true
        CharacterData rm_data;
        rm_data.name = "rm_test";
        rm_data.bones.push_back(BoneData{"root", -1, glm::vec3(0.0f)});

        // Pose 0: z=0, no rotation
        PoseData p0;
        p0.name = "start";
        p0.rotations.push_back(glm::vec3(0.0f));
        p0.root_position = glm::vec3(0.0f, 0.0f, 0.0f);
        rm_data.poses.push_back(p0);

        // Pose 1: z=2, 30deg Y rotation
        PoseData p1;
        p1.name = "mid";
        p1.rotations.push_back(glm::vec3(0.0f, 30.0f, 0.0f));
        p1.root_position = glm::vec3(0.0f, 0.0f, 2.0f);
        rm_data.poses.push_back(p1);

        AnimationClip clip;
        clip.name = "walk";
        clip.duration = 1.0f;
        clip.looping = true;
        clip.root_motion = true;
        clip.keyframes.push_back(AnimKeyframe{0.0f, 0});
        clip.keyframes.push_back(AnimKeyframe{0.5f, 1});
        clip.keyframes.push_back(AnimKeyframe{1.0f, 0});
        rm_data.clips.push_back(clip);

        BoneAnimationPlayer player(rm_data);
        player.play("walk");

        // After play(), delta should be zero
        assert(near(player.delta_position().x, 0.0f));
        assert(near(player.delta_position().y, 0.0f));
        assert(near(player.delta_position().z, 0.0f));

        // Update 0.25s (halfway to mid pose) — should move ~1.0 in z
        player.update(0.25f);
        assert(near(player.delta_position().z, 1.0f, 0.01f) && "Delta z should be ~1.0 at t=0.25");

        // Root bone transform should be identity (stripped)
        assert(is_identity(player.bone_transforms()[0]) && "Root bone should be identity when strip_root");

        // Update another 0.25s — should move another ~1.0 in z
        player.update(0.25f);
        assert(near(player.delta_position().z, 1.0f, 0.01f) && "Delta z should be ~1.0 at t=0.5");

        // Delta rotation should be non-zero (we went from ~15deg to 30deg Y)
        glm::quat dr = player.delta_rotation();
        float angle = 2.0f * std::acos(std::min(std::fabs(dr.w), 1.0f));
        assert(angle > 0.01f && "Delta rotation should have non-zero angle");

        printf("PASS: Test 7 - Root motion delta extraction\n");
    }

    // Test 8: Root motion loop wraparound
    {
        CharacterData rm_data;
        rm_data.name = "loop_test";
        rm_data.bones.push_back(BoneData{"root", -1, glm::vec3(0.0f)});

        // Pose 0: z=0
        PoseData p0;
        p0.name = "start";
        p0.rotations.push_back(glm::vec3(0.0f));
        p0.root_position = glm::vec3(0.0f, 0.0f, 0.0f);
        rm_data.poses.push_back(p0);

        // Pose 1: z=3
        PoseData p1;
        p1.name = "end";
        p1.rotations.push_back(glm::vec3(0.0f));
        p1.root_position = glm::vec3(0.0f, 0.0f, 3.0f);
        rm_data.poses.push_back(p1);

        AnimationClip clip;
        clip.name = "walk";
        clip.duration = 1.0f;
        clip.looping = true;
        clip.root_motion = true;
        clip.keyframes.push_back(AnimKeyframe{0.0f, 0});
        clip.keyframes.push_back(AnimKeyframe{1.0f, 1});
        rm_data.clips.push_back(clip);

        BoneAnimationPlayer player(rm_data);
        player.play("walk");

        // Update 0.8s — delta.z should be ~2.4 (0.8 * 3.0)
        player.update(0.8f);
        assert(near(player.delta_position().z, 2.4f, 0.05f) && "Delta z should be ~2.4 at t=0.8");

        // Update 0.4s — wraps from 0.8 to 1.2 → 0.2 after loop
        // Delta should be POSITIVE: (3.0 - 2.4) + (0.6 - 0.0) = 0.6 + 0.6 = 1.2
        player.update(0.4f);
        assert(player.delta_position().z > 0.0f && "Delta z must be POSITIVE after loop wrap");
        assert(near(player.delta_position().z, 1.2f, 0.05f) && "Delta z should be ~1.2 after loop wrap");

        printf("PASS: Test 8 - Root motion loop wraparound\n");
    }

    // Test 9: Reset root motion
    {
        CharacterData rm_data;
        rm_data.name = "reset_test";
        rm_data.bones.push_back(BoneData{"root", -1, glm::vec3(0.0f)});

        PoseData p0;
        p0.name = "start";
        p0.rotations.push_back(glm::vec3(0.0f));
        p0.root_position = glm::vec3(0.0f, 0.0f, 0.0f);
        rm_data.poses.push_back(p0);

        PoseData p1;
        p1.name = "end";
        p1.rotations.push_back(glm::vec3(0.0f));
        p1.root_position = glm::vec3(0.0f, 0.0f, 3.0f);
        rm_data.poses.push_back(p1);

        AnimationClip clip;
        clip.name = "walk";
        clip.duration = 1.0f;
        clip.looping = true;
        clip.root_motion = true;
        clip.keyframes.push_back(AnimKeyframe{0.0f, 0});
        clip.keyframes.push_back(AnimKeyframe{1.0f, 1});
        rm_data.clips.push_back(clip);

        BoneAnimationPlayer player(rm_data);
        player.play("walk");
        player.update(0.5f);

        // Delta should be non-zero
        assert(!near(player.delta_position().z, 0.0f, 0.001f) && "Delta should be non-zero before reset");

        // Reset
        player.reset_root_motion();
        assert(near(player.delta_position().z, 0.0f) && "Delta should be zero after reset");
        assert(near(player.delta_position().x, 0.0f) && "Delta x should be zero after reset");

        printf("PASS: Test 9 - Reset root motion\n");
    }

    printf("All bone animation player tests passed.\n");
    return 0;
}
