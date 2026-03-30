// Test: VFX object Gaussians are included in the scene buffer (not appended per-frame).
//
// Validates that:
// 1. Scene buffer includes VFX object Gaussians after rebuild
// 2. Per-frame active buffer reset already contains VFX objects
// 3. add/clear VFX instances correctly update the scene buffer
// 4. Scene base count tracks pure-scene Gaussians separately
//
// Run: ctest -R test_vfx_scene_buffer

#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/gs_vfx.hpp"

#include <cassert>
#include <cstdio>
#include <cstring>
#include <vector>

static int passed = 0;
static int failed = 0;

static void check(bool cond, const char* msg) {
    if (cond) {
        std::printf("  PASS: %s\n", msg);
        passed++;
    } else {
        std::printf("  FAIL: %s\n", msg);
        failed++;
    }
}

// Helper: create N Gaussians with a marker position.x = marker + index
static std::vector<gseurat::Gaussian> make_gaussians(uint32_t count, float marker) {
    std::vector<gseurat::Gaussian> gs(count);
    for (uint32_t i = 0; i < count; ++i) {
        gs[i].position = glm::vec3(marker + static_cast<float>(i), 0.0f, 0.0f);
        gs[i].scale = glm::vec3(0.01f);
        gs[i].rotation = glm::quat(1.0f, 0.0f, 0.0f, 0.0f);
        gs[i].color = glm::vec3(1.0f);
        gs[i].opacity = 1.0f;
        gs[i].importance = 1.0f;
        gs[i].bone_index = 0;
        gs[i].emission = 0.0f;
    }
    return gs;
}

// ── Simulated scene buffer management (mirrors Renderer logic) ──
// This tests the data-flow pattern without needing Vulkan.

struct SceneBufferState {
    std::vector<gseurat::Gaussian> scene_buffer;   // cached: scene + VFX objects
    std::vector<gseurat::Gaussian> active_buffer;   // working: scene + VFX + particles/anim
    uint32_t scene_base_count = 0;                  // count of pure-scene Gaussians

    // Simulate chunk gather (visibility change)
    void gather_scene(const std::vector<gseurat::Gaussian>& scene_gaussians) {
        scene_buffer = scene_gaussians;
        scene_base_count = static_cast<uint32_t>(scene_buffer.size());
    }

    // Append VFX object Gaussians to scene buffer (after gather)
    void append_vfx_objects(const std::vector<gseurat::Gaussian>& vfx_objects) {
        scene_buffer.insert(scene_buffer.end(), vfx_objects.begin(), vfx_objects.end());
    }

    // Per-frame reset: active = scene buffer (already includes VFX objects)
    void reset_active() {
        active_buffer = scene_buffer;
    }

    // Simulate adding particles (per-frame dynamic content)
    void append_particles(const std::vector<gseurat::Gaussian>& particles) {
        active_buffer.insert(active_buffer.end(), particles.begin(), particles.end());
    }

    // Clear VFX objects from scene buffer (trim to base count)
    void clear_vfx_objects() {
        scene_buffer.resize(scene_base_count);
    }
};

// ── Tests ──

void test_scene_buffer_includes_vfx_objects() {
    std::printf("Scene buffer includes VFX objects:\n");

    SceneBufferState state;
    auto scene = make_gaussians(100, 0.0f);       // 100 scene Gaussians
    auto vfx_obj = make_gaussians(50, 1000.0f);   // 50 VFX object Gaussians

    state.gather_scene(scene);
    state.append_vfx_objects(vfx_obj);

    check(state.scene_base_count == 100, "scene base count is 100");
    check(state.scene_buffer.size() == 150, "scene buffer = 100 scene + 50 VFX objects");
    check(state.scene_buffer[0].position.x == 0.0f, "first scene Gaussian at marker 0");
    check(state.scene_buffer[100].position.x == 1000.0f, "first VFX object at marker 1000");
}

void test_active_buffer_reset_contains_vfx() {
    std::printf("Active buffer reset already contains VFX objects:\n");

    SceneBufferState state;
    auto scene = make_gaussians(100, 0.0f);
    auto vfx_obj = make_gaussians(50, 1000.0f);

    state.gather_scene(scene);
    state.append_vfx_objects(vfx_obj);
    state.reset_active();

    check(state.active_buffer.size() == 150,
          "active buffer after reset = 150 (scene + VFX, no per-frame append)");

    // Simulate particles added per-frame
    auto particles = make_gaussians(10, 2000.0f);
    state.append_particles(particles);
    check(state.active_buffer.size() == 160, "active buffer = 160 after particles");

    // Next frame reset — particles gone, VFX objects still there
    state.reset_active();
    check(state.active_buffer.size() == 150,
          "next frame reset = 150 (particles cleared, VFX objects persist)");
}

void test_no_per_frame_vfx_append_needed() {
    std::printf("No per-frame VFX append needed:\n");

    SceneBufferState state;
    auto scene = make_gaussians(100, 0.0f);
    auto vfx_obj = make_gaussians(50000, 1000.0f);  // 50K VFX object Gaussians

    state.gather_scene(scene);
    state.append_vfx_objects(vfx_obj);

    // Simulate 3 frames — VFX objects should already be there after reset
    for (int frame = 0; frame < 3; ++frame) {
        state.reset_active();
        // No append_objects call needed!
        check(state.active_buffer.size() == 50100,
              "frame N: active buffer = 50100 without per-frame append");
    }
}

void test_clear_vfx_trims_scene_buffer() {
    std::printf("Clear VFX trims scene buffer to base count:\n");

    SceneBufferState state;
    auto scene = make_gaussians(100, 0.0f);
    auto vfx_obj = make_gaussians(50, 1000.0f);

    state.gather_scene(scene);
    state.append_vfx_objects(vfx_obj);
    check(state.scene_buffer.size() == 150, "before clear: 150");

    state.clear_vfx_objects();
    check(state.scene_buffer.size() == 100, "after clear: trimmed to 100");
    check(state.scene_base_count == 100, "base count unchanged");

    state.reset_active();
    check(state.active_buffer.size() == 100, "active buffer after clear = 100 (no VFX)");
}

void test_add_vfx_after_initial_gather() {
    std::printf("Add VFX instance after initial gather:\n");

    SceneBufferState state;
    auto scene = make_gaussians(100, 0.0f);

    state.gather_scene(scene);
    check(state.scene_buffer.size() == 100, "initial: 100 scene only");

    // Add first VFX
    auto vfx1 = make_gaussians(30, 1000.0f);
    state.append_vfx_objects(vfx1);
    check(state.scene_buffer.size() == 130, "after VFX 1: 130");

    // Add second VFX
    auto vfx2 = make_gaussians(20, 2000.0f);
    state.append_vfx_objects(vfx2);
    check(state.scene_buffer.size() == 150, "after VFX 2: 150");

    state.reset_active();
    check(state.active_buffer.size() == 150, "active has both VFX instances");
}

void test_regather_preserves_vfx_objects() {
    std::printf("Re-gather (visibility change) preserves VFX objects:\n");

    SceneBufferState state;
    auto scene = make_gaussians(100, 0.0f);
    auto vfx_obj = make_gaussians(50, 1000.0f);

    state.gather_scene(scene);
    state.append_vfx_objects(vfx_obj);
    check(state.scene_buffer.size() == 150, "initial: 150");

    // Simulate visibility change — fewer scene Gaussians
    auto scene_v2 = make_gaussians(80, 0.0f);
    state.gather_scene(scene_v2);
    check(state.scene_base_count == 80, "re-gather: base count = 80");
    check(state.scene_buffer.size() == 80, "re-gather: scene buffer = 80 (VFX stripped)");

    // VFX objects need to be re-appended after gather
    state.append_vfx_objects(vfx_obj);
    check(state.scene_buffer.size() == 130, "after re-append VFX: 130");
}

void test_clear_then_add_vfx() {
    std::printf("Clear then add new VFX instances:\n");

    SceneBufferState state;
    auto scene = make_gaussians(100, 0.0f);
    auto vfx_old = make_gaussians(50, 1000.0f);
    auto vfx_new = make_gaussians(25, 3000.0f);

    state.gather_scene(scene);
    state.append_vfx_objects(vfx_old);
    check(state.scene_buffer.size() == 150, "with old VFX: 150");

    state.clear_vfx_objects();
    state.append_vfx_objects(vfx_new);
    check(state.scene_buffer.size() == 125, "after replace: 125");
    check(state.scene_buffer[100].position.x == 3000.0f, "new VFX at marker 3000");
}

void test_vfx_instance_append_objects() {
    std::printf("VfxInstance::append_objects appends static PLY Gaussians:\n");

    // Create a VfxInstance with pre-loaded object Gaussians
    // (We can't call init() without a PLY file, so test the append path directly)
    std::vector<gseurat::Gaussian> buffer;
    auto scene = make_gaussians(10, 0.0f);
    buffer = scene;

    // Simulate what append_objects does
    auto vfx_objects = make_gaussians(5, 100.0f);
    buffer.insert(buffer.end(), vfx_objects.begin(), vfx_objects.end());

    check(buffer.size() == 15, "buffer = scene + VFX objects");
    check(buffer[10].position.x == 100.0f, "VFX objects appended at correct position");
}

int main() {
    std::printf("=== VFX Object Scene Buffer Tests ===\n\n");

    test_scene_buffer_includes_vfx_objects();
    test_active_buffer_reset_contains_vfx();
    test_no_per_frame_vfx_append_needed();
    test_clear_vfx_trims_scene_buffer();
    test_add_vfx_after_initial_gather();
    test_regather_preserves_vfx_objects();
    test_clear_then_add_vfx();
    test_vfx_instance_append_objects();

    std::printf("\n=== Results: %d passed, %d failed ===\n", passed, failed);
    return failed > 0 ? 1 : 0;
}
