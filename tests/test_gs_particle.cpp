// Unit test: Gaussian particle emitter and animator
//
// Tests particle spawn/update/gather lifecycle, animator tag/update,
// and budget constraints.

#include "gseurat/engine/gs_particle.hpp"
#include "gseurat/engine/gs_animator.hpp"

#include <cassert>
#include <cstdio>
#include <vector>

using namespace gseurat;

int main() {
    // ═══════════════════════════════════════════════
    // 1. GaussianParticleEmitter basics
    // ═══════════════════════════════════════════════

    // 1.1 Default emitter has no alive particles
    {
        GaussianParticleEmitter emitter;
        assert(emitter.alive_count() == 0);
        std::printf("PASS: Default emitter has 0 alive particles\n");
    }

    // 1.2 Configure and spawn particles
    {
        GaussianParticleEmitter emitter;
        auto config = gs_preset_spark_shower();
        config.position = {10.0f, 5.0f, 10.0f};
        emitter.configure(config);
        emitter.set_active(true);

        // Update with enough dt to spawn several particles (60/sec * 0.1s = 6)
        emitter.update(0.1f);
        assert(emitter.alive_count() > 0);
        assert(emitter.alive_count() <= 10);  // roughly 6, with rng variance

        std::printf("PASS: Emitter spawns particles (%u alive)\n", emitter.alive_count());
    }

    // 1.3 Particles die after lifetime
    {
        GaussianParticleEmitter emitter;
        auto config = gs_preset_spark_shower();
        config.spawn_rate = 100.0f;
        config.lifetime_min = 0.1f;
        config.lifetime_max = 0.2f;
        config.position = {0.0f, 0.0f, 0.0f};
        emitter.configure(config);
        emitter.set_active(true);

        emitter.update(0.05f);  // spawn ~5
        uint32_t initial = emitter.alive_count();
        assert(initial > 0);

        emitter.set_active(false);  // stop spawning
        emitter.update(0.5f);  // all should expire (lifetime max 0.2s)
        assert(emitter.alive_count() == 0);

        std::printf("PASS: Particles expire after lifetime (%u → 0)\n", initial);
    }

    // 1.4 gather() produces valid Gaussians
    {
        GaussianParticleEmitter emitter;
        auto config = gs_preset_dust_puff();
        config.spawn_rate = 50.0f;
        config.position = {5.0f, 3.0f, 5.0f};
        emitter.configure(config);
        emitter.set_active(true);
        emitter.update(0.1f);

        std::vector<Gaussian> out;
        uint32_t count = emitter.gather(out);
        assert(count > 0);
        assert(out.size() == count);

        // Verify gathered Gaussians have reasonable values
        for (const auto& g : out) {
            assert(g.opacity >= 0.0f && g.opacity <= 1.0f);
            assert(g.scale.x >= 0.0f);
            assert(g.scale.y >= 0.0f);
            assert(g.scale.z >= 0.0f);
        }

        std::printf("PASS: gather() produces %u valid Gaussians\n", count);
    }

    // 1.5 clear() removes all particles
    {
        GaussianParticleEmitter emitter;
        auto config = gs_preset_spark_shower();
        config.spawn_rate = 100.0f;
        emitter.configure(config);
        emitter.set_active(true);
        emitter.update(0.1f);
        assert(emitter.alive_count() > 0);

        emitter.clear();
        assert(emitter.alive_count() == 0);

        std::printf("PASS: clear() removes all particles\n");
    }

    // 1.6 Presets return valid configs
    {
        auto dust = gs_preset_dust_puff();
        assert(dust.spawn_rate > 0.0f);
        assert(dust.lifetime_min > 0.0f);

        auto spark = gs_preset_spark_shower();
        assert(spark.emission > 0.0f);

        auto magic = gs_preset_magic_spiral();
        assert(magic.color_start != magic.color_end);

        std::printf("PASS: All 3 presets return valid configs\n");
    }

    // ═══════════════════════════════════════════════
    // 2. GaussianAnimator basics
    // ═══════════════════════════════════════════════

    // 2.1 No active groups initially
    {
        GaussianAnimator animator;
        assert(!animator.has_active_groups());
        std::printf("PASS: Animator starts with no active groups\n");
    }

    // 2.2 Tag region captures Gaussians
    {
        std::vector<Gaussian> gaussians(10);
        for (int i = 0; i < 10; i++) {
            gaussians[i].position = glm::vec3(static_cast<float>(i), 0.0f, 0.0f);
            gaussians[i].scale = glm::vec3(1.0f);
            gaussians[i].opacity = 1.0f;
            gaussians[i].color = glm::vec3(0.5f);
        }

        GaussianAnimator animator;
        GsAnimRegion region;
        region.shape = GsAnimRegion::Shape::Sphere;
        region.center = {3.0f, 0.0f, 0.0f};
        region.radius = 2.5f;

        uint32_t id = animator.tag_region(gaussians, region, GsAnimEffect::Detach, 2.0f);
        assert(id > 0);
        assert(animator.has_active_groups());

        std::printf("PASS: tag_region captures Gaussians in sphere (group %u)\n", id);
    }

    // 2.3 Empty region returns 0
    {
        std::vector<Gaussian> gaussians(5);
        for (int i = 0; i < 5; i++) {
            gaussians[i].position = glm::vec3(100.0f);  // far away
        }

        GaussianAnimator animator;
        GsAnimRegion region;
        region.center = {0.0f, 0.0f, 0.0f};
        region.radius = 1.0f;

        uint32_t id = animator.tag_region(gaussians, region, GsAnimEffect::Float, 1.0f);
        assert(id == 0);  // no Gaussians in region

        std::printf("PASS: Empty region returns group id 0\n");
    }

    // 2.4 Detach moves Gaussians away from original position
    {
        std::vector<Gaussian> gaussians(5);
        for (int i = 0; i < 5; i++) {
            gaussians[i].position = glm::vec3(static_cast<float>(i) * 0.5f, 0.0f, 0.0f);
            gaussians[i].scale = glm::vec3(1.0f);
            gaussians[i].opacity = 1.0f;
        }

        GaussianAnimator animator;
        GsAnimRegion region;
        region.center = {1.0f, 0.0f, 0.0f};
        region.radius = 5.0f;

        glm::vec3 orig_pos = gaussians[2].position;
        animator.tag_region(gaussians, region, GsAnimEffect::Detach, 3.0f);

        // Update several times
        for (int i = 0; i < 10; i++) {
            animator.update(0.1f, gaussians);
        }

        // Position should have changed
        float dist = glm::length(gaussians[2].position - orig_pos);
        assert(dist > 0.1f);

        std::printf("PASS: Detach moves Gaussians (dist=%.2f)\n", dist);
    }

    // 2.5 Groups auto-expire
    {
        std::vector<Gaussian> gaussians(3);
        for (int i = 0; i < 3; i++) {
            gaussians[i].position = glm::vec3(0.0f);
            gaussians[i].scale = glm::vec3(1.0f);
            gaussians[i].opacity = 1.0f;
        }

        GaussianAnimator animator;
        GsAnimRegion region;
        region.center = {0.0f, 0.0f, 0.0f};
        region.radius = 10.0f;

        animator.tag_region(gaussians, region, GsAnimEffect::Dissolve, 0.5f);
        assert(animator.has_active_groups());

        // Advance past lifetime
        for (int i = 0; i < 20; i++) {
            animator.update(0.1f, gaussians);
        }
        assert(!animator.has_active_groups());

        std::printf("PASS: Groups auto-expire after lifetime\n");
    }

    // 2.6 Box region works
    {
        std::vector<Gaussian> gaussians(10);
        for (int i = 0; i < 10; i++) {
            gaussians[i].position = glm::vec3(static_cast<float>(i), 0.0f, 0.0f);
            gaussians[i].scale = glm::vec3(1.0f);
            gaussians[i].opacity = 1.0f;
        }

        GaussianAnimator animator;
        GsAnimRegion region;
        region.shape = GsAnimRegion::Shape::Box;
        region.center = {5.0f, 0.0f, 0.0f};
        region.half_extents = {2.0f, 1.0f, 1.0f};

        uint32_t id = animator.tag_region(gaussians, region, GsAnimEffect::Float, 1.0f);
        assert(id > 0);

        std::printf("PASS: Box region tags Gaussians\n");
    }

    std::printf("\nAll GS particle/animator tests passed.\n");
    return 0;
}
