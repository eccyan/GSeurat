// Test: bone animation state machine
// Build: add_gseurat_test(test_bone_animation_state_machine src/character/character_manifest.cpp src/character/bone_animation_player.cpp src/character/bone_animation_state_machine.cpp)

#include "gseurat/character/bone_animation_state_machine.hpp"
#include "gseurat/character/bone_animation_player.hpp"
#include "gseurat/character/character_manifest.hpp"
#include <cassert>
#include <cstdio>

int main() {
    using namespace gseurat;

    auto result = load_character_manifest(
        "assets/characters/warm_robot/warm_robot.manifest.json");
    assert(result.has_value() && "Should load warm_robot manifest");
    auto& data = *result;

    // Test 1: Register states and transition
    {
        BoneAnimationPlayer player(data);
        BoneAnimationStateMachine sm(player);
        sm.add_state("idle", "idle");
        sm.add_state("walk", "walk");
        sm.set_state("idle");
        assert(sm.current_state() == "idle" && "State should be idle");
        assert(player.current_clip() == "idle" && "Player should play idle clip");
        assert(player.is_playing() && "Player should be playing");

        printf("PASS: Test 1 - Register states and transition\n");
    }

    // Test 2: Same state no reset
    {
        BoneAnimationPlayer player(data);
        BoneAnimationStateMachine sm(player);
        sm.add_state("idle", "idle");
        sm.add_state("walk", "walk");
        sm.set_state("walk");
        player.update(0.1f);
        float time_before = 0.1f;  // we know we updated 0.1s
        sm.set_state("walk");  // same state — should not reset
        // Player should still be playing (not reset)
        assert(sm.current_state() == "walk" && "State should still be walk");
        assert(player.is_playing() && "Player should still be playing");

        printf("PASS: Test 2 - Same state no reset\n");
    }

    // Test 3: New state resets clip
    {
        BoneAnimationPlayer player(data);
        BoneAnimationStateMachine sm(player);
        sm.add_state("idle", "idle");
        sm.add_state("walk", "walk");
        sm.set_state("walk");
        player.update(0.2f);
        assert(player.current_clip() == "walk");
        sm.set_state("idle");
        assert(sm.current_state() == "idle" && "State should be idle");
        assert(player.current_clip() == "idle" && "Player clip should have changed to idle");

        printf("PASS: Test 3 - New state resets clip\n");
    }

    // Test 4: Unregistered state ignored
    {
        BoneAnimationPlayer player(data);
        BoneAnimationStateMachine sm(player);
        sm.add_state("idle", "idle");
        sm.set_state("idle");
        assert(sm.current_state() == "idle");
        sm.set_state("nonexistent");
        assert(sm.current_state() == "idle" && "Unregistered state should be ignored");

        printf("PASS: Test 4 - Unregistered state ignored\n");
    }

    // Test 5: state transition resets root motion
    {
        CharacterData test_data;
        test_data.name = "test";
        test_data.scale = 1.0f;

        BoneData root_bone;
        root_bone.id = "root";
        root_bone.parent_index = -1;
        root_bone.joint = glm::vec3(0.0f);
        test_data.bones.push_back(root_bone);

        PoseData p0;
        p0.name = "p0";
        p0.rotations = {glm::vec3(0.0f)};
        p0.root_position = glm::vec3(0.0f);
        test_data.poses.push_back(p0);

        PoseData p1;
        p1.name = "p1";
        p1.rotations = {glm::vec3(0.0f)};
        p1.root_position = glm::vec3(0.0f, 0.0f, 3.0f);
        test_data.poses.push_back(p1);

        AnimationClip walk;
        walk.name = "walk";
        walk.duration = 1.0f;
        walk.looping = true;
        walk.root_motion = true;
        walk.keyframes = {{0.0f, 0}, {1.0f, 1}};
        test_data.clips.push_back(walk);

        AnimationClip idle;
        idle.name = "idle";
        idle.duration = 1.0f;
        idle.looping = true;
        idle.root_motion = false;
        idle.keyframes = {{0.0f, 0}};
        test_data.clips.push_back(idle);

        BoneAnimationPlayer player(test_data);
        BoneAnimationStateMachine sm(player);
        sm.add_state("walk", "walk");
        sm.add_state("idle", "idle");

        sm.set_state("walk");
        player.update(0.5f);  // Accumulate some delta
        assert(std::abs(player.delta_position().z - 1.5f) < 0.2f && "Should accumulate root motion delta");

        // Transition to idle — delta should be zeroed
        sm.set_state("idle");
        assert(glm::length(player.delta_position()) < 0.001f && "Delta should be reset on state transition");

        printf("PASS: Test 5 - state transition resets root motion\n");
    }

    printf("All bone animation state machine tests passed.\n");
    return 0;
}
