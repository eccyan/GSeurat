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
