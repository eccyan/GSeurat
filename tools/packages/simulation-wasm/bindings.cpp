/**
 * Emscripten Embind bindings for GSeurat particle + animation simulation.
 *
 * Exposes GaussianParticleEmitter, GaussianAnimator, easing functions,
 * and preset resolver to JavaScript via WebAssembly.
 */

#include <emscripten/bind.h>
#include <emscripten/val.h>
#include "gseurat/engine/gs_particle.hpp"
#include "gseurat/engine/gs_animator.hpp"
#include <vector>

using namespace emscripten;
using namespace gseurat;

// ── Helper: gather particle data as flat Float32Arrays ──

static std::vector<Gaussian> s_gather_buf;

val gatherParticlePositions(GaussianParticleEmitter& emitter) {
    s_gather_buf.clear();
    emitter.gather(s_gather_buf);
    if (s_gather_buf.empty()) return val::null();

    val result = val::object();
    // Positions: [x0,y0,z0, x1,y1,z1, ...]
    size_t count = s_gather_buf.size();
    val positions = val::global("Float32Array").new_(count * 3);
    val colors = val::global("Float32Array").new_(count * 3);
    val scales = val::global("Float32Array").new_(count);
    val opacities = val::global("Float32Array").new_(count);

    for (size_t i = 0; i < count; ++i) {
        const auto& g = s_gather_buf[i];
        positions.call<void>("set", val::array(std::vector<float>{g.position.x, g.position.y, g.position.z}), i * 3);
        colors.call<void>("set", val::array(std::vector<float>{g.color.x, g.color.y, g.color.z}), i * 3);
        scales.set(i, (g.scale.x + g.scale.y + g.scale.z) / 3.0f);
        opacities.set(i, g.opacity);
    }

    result.set("positions", positions);
    result.set("colors", colors);
    result.set("scales", scales);
    result.set("opacities", opacities);
    result.set("count", (int)count);
    return result;
}

// ── Helper: create emitter config from JS object ──

GsEmitterConfig configFromJs(val jsConfig) {
    GsEmitterConfig cfg;
    if (jsConfig.hasOwnProperty("spawn_rate")) cfg.spawn_rate = jsConfig["spawn_rate"].as<float>();
    if (jsConfig.hasOwnProperty("lifetime_min")) cfg.lifetime_min = jsConfig["lifetime_min"].as<float>();
    if (jsConfig.hasOwnProperty("lifetime_max")) cfg.lifetime_max = jsConfig["lifetime_max"].as<float>();
    if (jsConfig.hasOwnProperty("emission")) cfg.emission = jsConfig["emission"].as<float>();
    if (jsConfig.hasOwnProperty("opacity_start")) cfg.opacity_start = jsConfig["opacity_start"].as<float>();
    if (jsConfig.hasOwnProperty("opacity_end")) cfg.opacity_end = jsConfig["opacity_end"].as<float>();
    if (jsConfig.hasOwnProperty("scale_end_factor")) cfg.scale_end_factor = jsConfig["scale_end_factor"].as<float>();
    if (jsConfig.hasOwnProperty("burst_duration")) cfg.burst_duration = jsConfig["burst_duration"].as<float>();
    // vec3 fields
    auto readVec3 = [&](const char* key) -> glm::vec3 {
        val v = jsConfig[key];
        return {v[0].as<float>(), v[1].as<float>(), v[2].as<float>()};
    };
    if (jsConfig.hasOwnProperty("position")) cfg.position = readVec3("position");
    if (jsConfig.hasOwnProperty("velocity_min")) cfg.velocity_min = readVec3("velocity_min");
    if (jsConfig.hasOwnProperty("velocity_max")) cfg.velocity_max = readVec3("velocity_max");
    if (jsConfig.hasOwnProperty("acceleration")) cfg.acceleration = readVec3("acceleration");
    if (jsConfig.hasOwnProperty("color_start")) cfg.color_start = readVec3("color_start");
    if (jsConfig.hasOwnProperty("color_end")) cfg.color_end = readVec3("color_end");
    if (jsConfig.hasOwnProperty("scale_min")) cfg.scale_min = readVec3("scale_min");
    if (jsConfig.hasOwnProperty("scale_max")) cfg.scale_max = readVec3("scale_max");
    if (jsConfig.hasOwnProperty("spawn_offset_min")) cfg.spawn_offset_min = readVec3("spawn_offset_min");
    if (jsConfig.hasOwnProperty("spawn_offset_max")) cfg.spawn_offset_max = readVec3("spawn_offset_max");
    return cfg;
}

// ── Helper: resolve preset by name ──

val resolvePresetJs(const std::string& name) {
    auto cfg = gs_resolve_preset(name);
    if (!cfg) return val::null();
    val obj = val::object();
    obj.set("spawn_rate", cfg->spawn_rate);
    obj.set("lifetime_min", cfg->lifetime_min);
    obj.set("lifetime_max", cfg->lifetime_max);
    obj.set("emission", cfg->emission);
    obj.set("opacity_start", cfg->opacity_start);
    obj.set("opacity_end", cfg->opacity_end);
    obj.set("scale_end_factor", cfg->scale_end_factor);
    obj.set("burst_duration", cfg->burst_duration);
    auto toArr = [](const glm::vec3& v) { return val::array(std::vector<float>{v.x, v.y, v.z}); };
    obj.set("position", toArr(cfg->position));
    obj.set("velocity_min", toArr(cfg->velocity_min));
    obj.set("velocity_max", toArr(cfg->velocity_max));
    obj.set("acceleration", toArr(cfg->acceleration));
    obj.set("color_start", toArr(cfg->color_start));
    obj.set("color_end", toArr(cfg->color_end));
    obj.set("scale_min", toArr(cfg->scale_min));
    obj.set("scale_max", toArr(cfg->scale_max));
    obj.set("spawn_offset_min", toArr(cfg->spawn_offset_min));
    obj.set("spawn_offset_max", toArr(cfg->spawn_offset_max));
    return obj;
}

// ── Emitter wrapper (simplified API for JS) ──

class EmitterWrapper {
public:
    void configure(val config) { emitter_.configure(configFromJs(config)); }
    void configurePreset(const std::string& name) {
        auto cfg = gs_resolve_preset(name);
        if (cfg) emitter_.configure(*cfg);
    }
    void setPosition(float x, float y, float z) { emitter_.set_position({x, y, z}); }
    void setActive(bool active) { emitter_.set_active(active); }
    void update(float dt) { emitter_.update(dt); }
    int aliveCount() { return static_cast<int>(emitter_.alive_count()); }
    void clear() { emitter_.clear(); }
    bool active() { return emitter_.active(); }

    val gather() { return gatherParticlePositions(emitter_); }

private:
    GaussianParticleEmitter emitter_;
};

// ── Animator wrapper ──

class AnimatorWrapper {
public:
    // Load scene points from JS Float32Arrays (positions + colors)
    void loadScene(val jsPositions, val jsColors, int count) {
        scene_.clear();
        scene_.resize(count);
        initial_avg_scale_ = 0.01f;  // default scale assigned below
        for (int i = 0; i < count; ++i) {
            scene_[i].position = {
                jsPositions[i * 3].as<float>(),
                jsPositions[i * 3 + 1].as<float>(),
                jsPositions[i * 3 + 2].as<float>()
            };
            scene_[i].color = {
                jsColors[i * 3].as<float>(),
                jsColors[i * 3 + 1].as<float>(),
                jsColors[i * 3 + 2].as<float>()
            };
            scene_[i].opacity = 1.0f;
            scene_[i].scale = {0.01f, 0.01f, 0.01f};
            scene_[i].rotation = {1, 0, 0, 0};
        }
        original_ = scene_;  // save original state

        // Pre-allocate JS output buffers (reused every getSceneData call)
        js_positions_ = val::global("Float32Array").new_(count * 3);
        js_colors_ = val::global("Float32Array").new_(count * 4);
        js_scales_ = val::global("Float32Array").new_(count);
    }

    int sceneCount() { return static_cast<int>(scene_.size()); }

    // Tag a spherical region for animation
    int tagSphere(float cx, float cy, float cz, float radius,
                  int effect, float lifetime) {
        GsAnimRegion region;
        region.shape = GsAnimRegion::Shape::Sphere;
        region.center = {cx, cy, cz};
        region.radius = radius;
        return animator_.tag_region(
            scene_, region,
            static_cast<GsAnimEffect>(effect),
            lifetime);
    }

    // Tag with params
    int tagSphereWithParams(float cx, float cy, float cz, float radius,
                            int effect, float lifetime, val jsParams) {
        GsAnimRegion region;
        region.shape = GsAnimRegion::Shape::Sphere;
        region.center = {cx, cy, cz};
        region.radius = radius;

        GsAnimParams params;
        if (jsParams.hasOwnProperty("rotations")) params.rotations = jsParams["rotations"].as<float>();
        if (jsParams.hasOwnProperty("expansion")) params.expansion = jsParams["expansion"].as<float>();
        if (jsParams.hasOwnProperty("height_rise")) params.height_rise = jsParams["height_rise"].as<float>();
        if (jsParams.hasOwnProperty("opacity_end")) params.opacity_end = jsParams["opacity_end"].as<float>();
        if (jsParams.hasOwnProperty("scale_end")) params.scale_end = jsParams["scale_end"].as<float>();
        if (jsParams.hasOwnProperty("velocity")) params.velocity = jsParams["velocity"].as<float>();
        if (jsParams.hasOwnProperty("noise")) params.noise = jsParams["noise"].as<float>();
        if (jsParams.hasOwnProperty("wave_speed")) params.wave_speed = jsParams["wave_speed"].as<float>();
        if (jsParams.hasOwnProperty("pulse_frequency")) params.pulse_frequency = jsParams["pulse_frequency"].as<float>();
        // Easing params
        auto readEasing = [](val v) -> GsEasing {
            if (v.isNumber()) return static_cast<GsEasing>(v.as<int>());
            return GsEasing::Linear;
        };
        if (jsParams.hasOwnProperty("rotations_easing")) params.rotations_easing = readEasing(jsParams["rotations_easing"]);
        if (jsParams.hasOwnProperty("expansion_easing")) params.expansion_easing = readEasing(jsParams["expansion_easing"]);
        if (jsParams.hasOwnProperty("height_easing")) params.height_easing = readEasing(jsParams["height_easing"]);
        if (jsParams.hasOwnProperty("opacity_easing")) params.opacity_easing = readEasing(jsParams["opacity_easing"]);
        if (jsParams.hasOwnProperty("scale_easing")) params.scale_easing = readEasing(jsParams["scale_easing"]);

        return animator_.tag_region(
            scene_, region,
            static_cast<GsAnimEffect>(effect),
            lifetime, params);
    }

    void update(float dt) {
        animator_.update(dt, scene_);
    }

    bool hasActiveGroups() { return animator_.has_active_groups(); }
    bool hasGroup(int groupId) { return animator_.has_group(static_cast<uint32_t>(groupId)); }

    void resetScene() {
        scene_ = original_;
        animator_.clear(scene_);
    }

    // Get current scene positions/colors — writes into pre-allocated Float32Arrays
    val getSceneData() {
        if (scene_.empty()) return val::null();
        size_t count = scene_.size();
        float inv_scale = (initial_avg_scale_ > 0.0f) ? 1.0f / initial_avg_scale_ : 1.0f;

        for (size_t i = 0; i < count; ++i) {
            const auto& g = scene_[i];
            js_positions_.set(i * 3,     g.position.x);
            js_positions_.set(i * 3 + 1, g.position.y);
            js_positions_.set(i * 3 + 2, g.position.z);
            float opacity = g.opacity < 0.0f ? 0.0f : (g.opacity > 1.0f ? 1.0f : g.opacity);
            js_colors_.set(i * 4,     g.color.x);
            js_colors_.set(i * 4 + 1, g.color.y);
            js_colors_.set(i * 4 + 2, g.color.z);
            js_colors_.set(i * 4 + 3, opacity);
            // Pre-normalize: return ratio (1.0 = original size) instead of raw avg scale
            float avg_scale = (g.scale.x + g.scale.y + g.scale.z) / 3.0f;
            js_scales_.set(i, avg_scale * inv_scale);
        }

        val result = val::object();
        result.set("positions", js_positions_);
        result.set("colors", js_colors_);
        result.set("scales", js_scales_);
        result.set("count", static_cast<int>(count));
        return result;
    }

private:
    std::vector<Gaussian> scene_;
    std::vector<Gaussian> original_;
    GaussianAnimator animator_;
    float initial_avg_scale_ = 0.01f;
    // Pre-allocated JS output buffers (avoid per-frame allocation)
    val js_positions_ = val::undefined();
    val js_colors_ = val::undefined();
    val js_scales_ = val::undefined();
};

// ── Easing wrapper ──

float easingJs(float t, int easing) {
    return apply_easing(t, static_cast<GsEasing>(easing));
}

// ── Bindings ──

EMSCRIPTEN_BINDINGS(gseurat_simulation) {
    // Emitter
    class_<EmitterWrapper>("ParticleEmitter")
        .constructor()
        .function("configure", &EmitterWrapper::configure)
        .function("configurePreset", &EmitterWrapper::configurePreset)
        .function("setPosition", &EmitterWrapper::setPosition)
        .function("setActive", &EmitterWrapper::setActive)
        .function("update", &EmitterWrapper::update)
        .function("aliveCount", &EmitterWrapper::aliveCount)
        .function("clear", &EmitterWrapper::clear)
        .function("active", &EmitterWrapper::active)
        .function("gather", &EmitterWrapper::gather);

    // Animator
    class_<AnimatorWrapper>("Animator")
        .constructor()
        .function("loadScene", &AnimatorWrapper::loadScene)
        .function("sceneCount", &AnimatorWrapper::sceneCount)
        .function("tagSphere", &AnimatorWrapper::tagSphere)
        .function("tagSphereWithParams", &AnimatorWrapper::tagSphereWithParams)
        .function("update", &AnimatorWrapper::update)
        .function("hasActiveGroups", &AnimatorWrapper::hasActiveGroups)
        .function("hasGroup", &AnimatorWrapper::hasGroup)
        .function("resetScene", &AnimatorWrapper::resetScene)
        .function("getSceneData", &AnimatorWrapper::getSceneData);

    // Animation effect enum constants
    constant("EFFECT_DETACH", 0);
    constant("EFFECT_FLOAT", 1);
    constant("EFFECT_ORBIT", 2);
    constant("EFFECT_DISSOLVE", 3);
    constant("EFFECT_REFORM", 4);
    constant("EFFECT_PULSE", 5);
    constant("EFFECT_VORTEX", 6);
    constant("EFFECT_WAVE", 7);
    constant("EFFECT_SCATTER", 8);

    // Preset resolver
    function("resolvePreset", &resolvePresetJs);

    // Easing
    function("applyEasing", &easingJs);

    // Easing enum values (as constants)
    constant("EASING_LINEAR", 0);
    constant("EASING_IN_QUAD", 1);
    constant("EASING_OUT_QUAD", 2);
    constant("EASING_IN_OUT_QUAD", 3);
    constant("EASING_IN_CUBIC", 4);
    constant("EASING_OUT_CUBIC", 5);
    constant("EASING_IN_OUT_CUBIC", 6);
    constant("EASING_IN_BOUNCE", 28);
    constant("EASING_OUT_BOUNCE", 29);
    constant("EASING_IN_OUT_BOUNCE", 30);
}
