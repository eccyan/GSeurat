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

    printf("All bone animation player tests passed.\n");
    return 0;
}
