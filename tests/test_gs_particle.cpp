// Unit test: Gaussian particle emitter and animator
//
// Tests particle spawn/update/gather lifecycle, animator tag/update,
// and budget constraints.

#include "gseurat/engine/gs_particle.hpp"
#include "gseurat/engine/gs_animator.hpp"
#include "gseurat/engine/scene_loader.hpp"

#include <cassert>
#include <cmath>
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

    // --- Test: gs_resolve_preset known/unknown ---
    {
        auto dust = gs_resolve_preset("dust_puff");
        assert(dust.has_value());
        assert(dust->spawn_rate == 120.0f);

        auto spark = gs_resolve_preset("spark_shower");
        assert(spark.has_value());
        assert(spark->emission == 0.8f);

        auto magic = gs_resolve_preset("magic_spiral");
        assert(magic.has_value());

        auto fire = gs_resolve_preset("fire");
        assert(fire.has_value());
        assert(fire->emission == 1.5f);

        auto smoke = gs_resolve_preset("smoke");
        assert(smoke.has_value());

        auto rain = gs_resolve_preset("rain");
        assert(rain.has_value());
        assert(rain->spawn_rate == 200.0f);

        auto snow = gs_resolve_preset("snow");
        assert(snow.has_value());

        auto leaves = gs_resolve_preset("leaves");
        assert(leaves.has_value());

        auto fireflies = gs_resolve_preset("fireflies");
        assert(fireflies.has_value());
        assert(fireflies->emission == 1.0f);

        auto steam = gs_resolve_preset("steam");
        assert(steam.has_value());

        auto mist = gs_resolve_preset("waterfall_mist");
        assert(mist.has_value());

        auto unknown = gs_resolve_preset("nonexistent");
        assert(!unknown.has_value());

        std::printf("PASS: gs_resolve_preset known/unknown (11 presets)\n");
    }

    // --- Test: Scene JSON round-trip for gs_particle_emitters ---
    {
        SceneData data;
        GsEmitterData em1;
        em1.preset = "spark_shower";
        em1.config = *gs_resolve_preset("spark_shower");
        em1.config.position = glm::vec3(10.0f, 5.0f, -3.0f);
        em1.config.burst_duration = 0.0f;  // scene emitters default to continuous
        data.gs_particle_emitters.push_back(em1);

        GsEmitterData em2;
        em2.preset = "";
        em2.config.spawn_rate = 25.0f;
        em2.config.position = glm::vec3(1.0f, 2.0f, 3.0f);
        em2.config.color_start = glm::vec3(0.5f, 0.5f, 1.0f);
        em2.config.emission = 1.5f;
        data.gs_particle_emitters.push_back(em2);

        auto j = SceneLoader::to_json(data);
        auto round_tripped = SceneLoader::from_json(j);

        assert(round_tripped.gs_particle_emitters.size() == 2);

        const auto& rt1 = round_tripped.gs_particle_emitters[0];
        assert(rt1.preset == "spark_shower");
        assert(std::fabs(rt1.config.position.x - 10.0f) < 0.01f);
        assert(std::fabs(rt1.config.emission - 0.8f) < 0.01f);

        const auto& rt2 = round_tripped.gs_particle_emitters[1];
        assert(rt2.preset.empty());
        assert(std::fabs(rt2.config.spawn_rate - 25.0f) < 0.01f);
        assert(std::fabs(rt2.config.emission - 1.5f) < 0.01f);
        assert(std::fabs(rt2.config.position.y - 2.0f) < 0.01f);

        // First emitter: preset spark_shower has burst_duration=0.5, but scene loading
        // defaults to 0 (continuous) when burst_duration is absent from JSON.
        // After to_json (which omits burst_duration when 0), round-trip restores to 0.
        // But em1 was created with burst_duration=0 (scene default), so to_json omits it,
        // and from_json defaults to 0 again.
        assert(rt1.config.burst_duration == 0.0f);
        // Second emitter: no burst_duration set, defaults to 0
        assert(rt2.config.burst_duration == 0.0f);

        std::printf("PASS: Scene JSON round-trip for gs_particle_emitters\n");
    }

    // --- Test: Scene JSON round-trip for gs_animations ---
    {
        SceneData data;
        GsAnimationData anim1;
        anim1.effect = "orbit";
        anim1.region.shape = GsAnimRegion::Shape::Sphere;
        anim1.region.center = glm::vec3(10.0f, 5.0f, 20.0f);
        anim1.region.radius = 8.0f;
        anim1.lifetime = 4.0f;
        anim1.loop = true;
        data.gs_animations.push_back(anim1);

        GsAnimationData anim2;
        anim2.effect = "dissolve";
        anim2.region.shape = GsAnimRegion::Shape::Box;
        anim2.region.center = glm::vec3(1.0f, 2.0f, 3.0f);
        anim2.region.half_extents = glm::vec3(2.0f, 3.0f, 4.0f);
        anim2.lifetime = 5.0f;
        anim2.loop = false;
        data.gs_animations.push_back(anim2);

        auto j = SceneLoader::to_json(data);
        auto rt = SceneLoader::from_json(j);

        assert(rt.gs_animations.size() == 2);

        const auto& r1 = rt.gs_animations[0];
        assert(r1.effect == "orbit");
        assert(r1.region.shape == GsAnimRegion::Shape::Sphere);
        assert(std::fabs(r1.region.center.x - 10.0f) < 0.01f);
        assert(std::fabs(r1.region.radius - 8.0f) < 0.01f);
        assert(std::fabs(r1.lifetime - 4.0f) < 0.01f);
        assert(r1.loop == true);

        const auto& r2 = rt.gs_animations[1];
        assert(r2.effect == "dissolve");
        assert(r2.region.shape == GsAnimRegion::Shape::Box);
        assert(std::fabs(r2.region.half_extents.z - 4.0f) < 0.01f);
        assert(r2.loop == false);

        std::printf("PASS: Scene JSON round-trip for gs_animations\n");
    }

    std::printf("\nAll GS particle/animator tests passed.\n");
    return 0;
}
