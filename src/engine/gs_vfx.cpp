#include <gseurat/engine/gs_vfx.hpp>
#include <gseurat/engine/gaussian_cloud.hpp>
#include <gseurat/engine/project_root.hpp>
#include <nlohmann/json.hpp>
#include <fstream>
#include <iostream>
#include <algorithm>
#include <filesystem>

namespace gseurat {

// ── Parse .vfx.json ──

VfxPreset parse_vfx_preset(const nlohmann::json& j) {
    VfxPreset preset;
    preset.name = j.value("name", "Unnamed VFX");
    preset.duration = j.value("duration", 0.0f);
    preset.category = j.value("category", "");

    // v2 uses "elements", v1 used "layers" — accept both
    const auto& raw = j.contains("elements") ? j["elements"] : j.value("layers", nlohmann::json::array());

    for (const auto& ej : raw) {
        VfxElementData el;
        el.name = ej.value("name", "Unnamed");
        el.type = ej.value("type", "emitter");
        if (ej.contains("position")) {
            el.position = {ej["position"][0].get<float>(),
                           ej["position"][1].get<float>(),
                           ej["position"][2].get<float>()};
        }
        el.start = ej.value("start", 0.0f);
        el.duration = ej.value("duration", 0.0f);
        el.loop = ej.value("loop", false);

        if (el.type == "object") {
            el.ply_file = ej.value("ply_file", "");
            el.scale = ej.value("scale", 1.0f);
        } else if (el.type == "emitter" && ej.contains("emitter")) {
            el.emitter_config = SceneLoader::parse_gs_emitter_config(ej["emitter"]);
            if (ej["emitter"].contains("preset")) {
                el.emitter_preset = ej["emitter"]["preset"].get<std::string>();
            }
        } else if (el.type == "light") {
            if (ej.contains("light")) {
                const auto& lj = ej["light"];
                if (lj.contains("color")) {
                    el.light_color = {lj["color"][0].get<float>(),
                                      lj["color"][1].get<float>(),
                                      lj["color"][2].get<float>()};
                }
                el.light_intensity = lj.value("intensity", 5.0f);
                el.light_radius = lj.value("radius", 10.0f);
            }
        } else if (el.type == "animation" && ej.contains("animation")) {
            auto& anim = el.animation_config;
            const auto& aj = ej["animation"];
            anim.effect = aj.value("effect", "detach");
            anim.lifetime = el.duration > 0.0f ? el.duration : 9999.0f;
            anim.loop = el.loop;
            if (aj.contains("params")) {
                anim.params = SceneLoader::parse_gs_anim_params(aj["params"]);
            }
            // Parse region if present on element
            if (ej.contains("region")) {
                const auto& rj = ej["region"];
                std::string shape = rj.value("shape", "sphere");
                el.region.shape = (shape == "box")
                    ? GsAnimRegion::Shape::Box : GsAnimRegion::Shape::Sphere;
                el.region.radius = rj.value("radius", 5.0f);
                if (rj.contains("half_extents")) {
                    el.region.half_extents = {rj["half_extents"][0].get<float>(),
                                              rj["half_extents"][1].get<float>(),
                                              rj["half_extents"][2].get<float>()};
                }
            }
        }

        preset.elements.push_back(std::move(el));
    }

    // Derive duration if not explicitly set
    if (preset.duration <= 0.0f) {
        for (const auto& el : preset.elements) {
            float end = el.start + el.duration;
            if (end > preset.duration) preset.duration = end;
        }
        if (preset.duration <= 0.0f) preset.duration = 3.0f;  // fallback
    }

    return preset;
}

VfxPreset load_vfx_preset(const std::string& path) {
    std::ifstream ifs(path);
    if (!ifs.is_open()) {
        std::cerr << "[VFX] Failed to open: " << path << "\n";
        return {};
    }
    auto j = nlohmann::json::parse(ifs);
    return parse_vfx_preset(j);
}

// ── VfxInstance ──

// Rotate a vec3 around the Y axis by angle (radians)
static glm::vec3 rotate_y(const glm::vec3& v, float angle_rad) {
    float c = std::cos(angle_rad);
    float s = std::sin(angle_rad);
    return {v.x * c + v.z * s, v.y, -v.x * s + v.z * c};
}

// Cap each VFX object's splat count to keep the dynamic SSBO budget
// reasonable. Authored asset sizes (e.g. torch.ply at 50k splats) target
// showcase rendering, not 20× instancing in one scene. See the long
// comment in VfxInstance::init below for the full rationale — this
// constant is shared between the legacy sync-load path and the
// VfxObjectCache::preload path so both decimate identically.
namespace { constexpr std::size_t kMaxVfxObjectSplats = 2048; }

// Resolve a preset's `ply_file` string to a path on disk. Tries the exact
// path first (so absolute paths and project-relative paths both work),
// then falls back to `assets/vfx/<filename>` exactly as the legacy
// `VfxInstance::init` path did. Returns the empty string if neither
// candidate exists.
static std::string resolve_vfx_ply_path(const std::string& ply_file) {
    if (std::filesystem::exists(ply_file)) {
        return ply_file;
    }
    auto filename = std::filesystem::path(ply_file).filename().string();
    auto alt = resolve_asset_path("assets/vfx/" + filename).string();
    if (std::filesystem::exists(alt)) {
        return alt;
    }
    return {};
}

std::string VfxObjectCache::preload(const std::string& ply_file) {
    std::string resolved = resolve_vfx_ply_path(ply_file);
    if (resolved.empty()) {
        std::fprintf(stderr, "[VFX] preload failed — PLY not found: %s\n", ply_file.c_str());
        return resolved;
    }
    if (entries_.count(resolved)) return resolved;  // idempotent

    auto cloud = GaussianCloud::load_with_gsvx_first(resolved);
    const auto& gs = cloud.gaussians();
    const std::size_t total = gs.size();
    const std::size_t stride = (total > kMaxVfxObjectSplats)
        ? (total + kMaxVfxObjectSplats - 1) / kMaxVfxObjectSplats
        : 1;

    Entry entry;
    entry.source_count = total;
    entry.stride = stride;
    entry.decimated.reserve((total + stride - 1) / stride);
    for (std::size_t i = 0; i < total; i += stride) {
        entry.decimated.push_back(gs[i]);  // raw, no per-instance transform
    }
    std::fprintf(stderr,
        "[VFX] preload '%s' -> %zu/%zu Gaussians (stride=%zu)\n",
        resolved.c_str(), entry.decimated.size(), total, stride);
    entries_.emplace(resolved, std::move(entry));
    return resolved;
}

const VfxObjectCache::Entry* VfxObjectCache::find(const std::string& ply_file) const {
    std::string resolved = resolve_vfx_ply_path(ply_file);
    if (resolved.empty()) return nullptr;
    auto it = entries_.find(resolved);
    return (it == entries_.end()) ? nullptr : &it->second;
}

void VfxInstance::init(const VfxPreset& preset, const glm::vec3& position, bool loop,
                       float rotation_y, const VfxObjectCache* cache) {
    preset_ = preset;
    position_ = position;
    rotation_y_ = rotation_y;
    loop_ = loop;
    elapsed_ = 0.0f;
    finished_ = false;

    // Pre-create states for all elements
    emitter_states_.clear();
    anim_states_.clear();
    light_states_.clear();
    active_lights_.clear();
    object_gaussians_.clear();

    float rot_rad = glm::radians(rotation_y_);

    for (size_t i = 0; i < preset_.elements.size(); ++i) {
        const auto& el = preset_.elements[i];
        glm::vec3 rotated_pos = rotate_y(el.position, rot_rad);

        if (el.type == "emitter") {
            EmitterState es;
            es.element_index = i;
            es.activated = false;
            es.emitter.configure(el.emitter_config);
            es.emitter.set_position(position_ + rotated_pos);
            emitter_states_.push_back(std::move(es));
        } else if (el.type == "animation") {
            AnimState as;
            as.element_index = i;
            as.activated = false;
            anim_states_.push_back(std::move(as));
        } else if (el.type == "object" && !el.ply_file.empty()) {
            // #407: prefer the prefetched cache so spawning a runtime VFX
            // doesn't block on disk I/O. The cache stores already-decimated
            // raw splats; we only apply the per-instance scale/rotate/offset
            // transform here. On miss, fall back to a sync load with a
            // visible warning so the missing prefetch is loud in smoke tests.
            //
            // VFX object decimation (rationale preserved from the legacy
            // inline path): cap each instance's splat count to keep the
            // dynamic SSBO budget reasonable. Reusable assets like torch.ply
            // (~50k splats) are authored for showcase rendering, not for 20×
            // instancing in one scene; the dungeon spawns 23 torches and at
            // 50k each would alone exceed the dynamic budget. Stride sampling
            // preserves spatial distribution; the visual difference for a
            // small mesh viewed at distance is minimal. Sort cost is
            // dominated by `max_dynamic_count_` so this mainly cuts CPU
            // upload bandwidth, projection cost, and overdraw. Authoring fix
            // track (spec §11.2): reduce dungeon torch count or author a
            // smaller torch asset.
            const VfxObjectCache::Entry* entry = cache ? cache->find(el.ply_file) : nullptr;
            if (entry) {
                object_gaussians_.reserve(object_gaussians_.size() + entry->decimated.size());
                for (Gaussian g : entry->decimated) {
                    g.position = rotate_y(g.position * el.scale, rot_rad) + position_ + rotated_pos;
                    object_gaussians_.push_back(g);
                }
            } else {
                // Sync fallback — same shape as the pre-#407 inline path.
                std::string ply_path = resolve_vfx_ply_path(el.ply_file);
                if (!ply_path.empty()) {
                    std::fprintf(stderr,
                        "[VFX] WARN: PLY '%s' not preloaded — main-thread stall\n",
                        el.ply_file.c_str());
                    auto cloud = GaussianCloud::load_with_gsvx_first(ply_path);
                    const auto& gs = cloud.gaussians();
                    const std::size_t total = gs.size();
                    const std::size_t stride = (total > kMaxVfxObjectSplats)
                        ? (total + kMaxVfxObjectSplats - 1) / kMaxVfxObjectSplats
                        : 1;
                    std::size_t taken = 0;
                    for (std::size_t k = 0; k < total; k += stride) {
                        Gaussian g = gs[k];
                        g.position = rotate_y(g.position * el.scale, rot_rad) + position_ + rotated_pos;
                        object_gaussians_.push_back(g);
                        ++taken;
                    }
                    std::fprintf(stderr,
                        "VFX: Object '%s' (fallback) loaded %zu/%zu Gaussians from %s (stride=%zu)\n",
                        el.name.c_str(), taken, total, el.ply_file.c_str(), stride);
                } else {
                    std::fprintf(stderr, "VFX: Object PLY not found: %s\n", el.ply_file.c_str());
                }
            }
        } else if (el.type == "light") {
            LightState ls;
            ls.element_index = i;
            ls.activated = false;
            light_states_.push_back(ls);
        }
    }
}

void VfxInstance::append_objects(std::vector<Gaussian>& out_buffer) {
    if (finished_ || object_gaussians_.empty()) return;
    out_buffer.insert(out_buffer.end(), object_gaussians_.begin(), object_gaussians_.end());
}

void VfxInstance::update(float dt, std::vector<Gaussian>& out_buffer, GaussianAnimator& animator) {
    if (finished_) return;

    elapsed_ += dt;

    // Check for loop/finish
    if (preset_.duration > 0.0f && elapsed_ > preset_.duration) {
        if (loop_) {
            elapsed_ = std::fmod(elapsed_, preset_.duration);
            for (auto& es : emitter_states_) {
                es.activated = false;
                es.emitter.clear();
            }
        } else {
            finished_ = true;
            return;
        }
    }

    // Update each emitter element based on timeline
    for (auto& es : emitter_states_) {
        const auto& el = preset_.elements[es.element_index];
        float el_start = el.start;
        float el_end = el.duration > 0.0f ? el.start + el.duration : preset_.duration;

        // Looping elements: check within their cycle
        bool in_window;
        if (el.loop && el.duration > 0.0f) {
            float cycle_elapsed = std::fmod(elapsed_ - el_start, el.duration);
            in_window = elapsed_ >= el_start && cycle_elapsed >= 0.0f;
        } else {
            in_window = elapsed_ >= el_start && elapsed_ < el_end;
        }

        if (in_window && !es.activated) {
            es.emitter.set_active(true);
            es.activated = true;
        } else if (!in_window && es.activated) {
            es.emitter.set_active(false);
            es.activated = false;
        }

        if (es.activated) {
            es.emitter.update(dt);
            es.emitter.gather(out_buffer);
        }
    }

    // Animation tagging is now handled by tag_animations() on the static buffer.
    // See renderer.cpp camera_dirty block.

    // Activate/deactivate light elements and build active lights list
    active_lights_.clear();
    for (auto& ls : light_states_) {
        const auto& el = preset_.elements[ls.element_index];
        float el_start = el.start;
        bool in_window;
        if (el.loop) {
            in_window = elapsed_ >= el_start;
        } else {
            float el_end = el.duration > 0.0f ? el.start + el.duration : preset_.duration;
            in_window = elapsed_ >= el_start && elapsed_ < el_end;
        }
        ls.activated = in_window;

        if (ls.activated) {
            PointLight pl;
            glm::vec3 world_pos = position_ + rotate_y(el.position, glm::radians(rotation_y_));
            // PointLight uses: x=world_x, y=scene_z, z=height, w=radius
            pl.position_and_radius = glm::vec4(world_pos.x, world_pos.z, world_pos.y, el.light_radius);
            pl.color = glm::vec4(el.light_color, el.light_intensity);
            active_lights_.push_back(pl);
        }
    }
}

void VfxInstance::reset_animations() {
    for (auto& as : anim_states_) {
        as.activated = false;
        as.group_id = 0;
    }
}

void VfxInstance::tag_animations(std::vector<Gaussian>& static_buffer, GaussianAnimator& animator) {
    if (finished_) return;

    for (auto& as : anim_states_) {
        const auto& el = preset_.elements[as.element_index];
        float el_start = el.start;
        bool in_window;
        if (el.loop) {
            in_window = elapsed_ >= el_start;
        } else {
            float el_end = el.duration > 0.0f ? el.start + el.duration : preset_.duration;
            in_window = elapsed_ >= el_start && elapsed_ < el_end;
        }

        // For looping animations: re-tag when previous group has expired
        if (as.activated && el.loop && !animator.has_group(as.group_id)) {
            as.activated = false;
        }

        if (in_window && !as.activated) {
            auto region = el.region;
            region.center += position_ + rotate_y(el.position, glm::radians(rotation_y_));
            auto effect_name = el.animation_config.effect;
            auto effect = GsAnimEffect::Detach;
            if (effect_name == "float") effect = GsAnimEffect::Float;
            else if (effect_name == "orbit") effect = GsAnimEffect::Orbit;
            else if (effect_name == "dissolve") effect = GsAnimEffect::Dissolve;
            else if (effect_name == "reform") effect = GsAnimEffect::Reform;
            else if (effect_name == "pulse") effect = GsAnimEffect::Pulse;
            else if (effect_name == "vortex") effect = GsAnimEffect::Vortex;
            else if (effect_name == "wave") effect = GsAnimEffect::Wave;
            else if (effect_name == "scatter") effect = GsAnimEffect::Scatter;

            float lifetime = el.duration > 0.0f ? el.duration : 9999.0f;
            as.group_id = animator.tag_region(static_buffer, region, effect, lifetime, el.animation_config.params);
            as.activated = true;
        } else if (!in_window && as.activated) {
            as.activated = false;
        }
    }
}

}  // namespace gseurat
