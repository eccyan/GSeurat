#include "gseurat/demo/demo_loading_overlay.hpp"

#include "gseurat/engine/app_base.hpp"
#include "gseurat/engine/engine_state.hpp"
#include "gseurat/engine/ui/ui_context.hpp"

#include <algorithm>
#include <cmath>
#include <string>

namespace gseurat {

namespace {

// Reference resolution. UI batches are rendered against an orthographic
// projection sized to (1280, 720) — same convention used by the existing
// HUD code in island_demo_state.cpp.
constexpr float kScreenW = 1280.0f;
constexpr float kScreenH = 720.0f;

// SNES palette — deep night-blue base, gold trim. Matches the Chrono Trigger
// title-screen mood the demo is going for.
constexpr glm::vec4 kBackdrop{0.04f, 0.05f, 0.12f, 1.0f};
constexpr glm::vec4 kBarFrame{0.92f, 0.78f, 0.32f, 1.0f};   // gold
constexpr glm::vec4 kBarSlot{0.02f, 0.02f, 0.05f, 1.0f};    // near-black inside
constexpr glm::vec4 kBarFill{0.55f, 0.85f, 1.0f, 1.0f};     // ice-blue
constexpr glm::vec4 kTextMain{0.95f, 0.95f, 0.85f, 1.0f};   // off-white
constexpr glm::vec4 kTextDim{0.55f, 0.55f, 0.45f, 1.0f};

// Compute the [0..1] progress through the Loading or Warming phase.
float phase_progress(const EngineLoadingMonitor& m) {
    switch (m.state()) {
        case EngineState::Loading: {
            const float min_dur = m.min_loading_duration();
            if (min_dur <= 0.0f) return 1.0f;
            return std::min(m.loading_elapsed() / min_dur, 1.0f);
        }
        case EngineState::Warming: {
            const float total = static_cast<float>(m.warmup_frames());
            if (total <= 0.0f) return 1.0f;
            const float remaining = static_cast<float>(m.warmup_frames_remaining());
            return std::clamp(1.0f - remaining / total, 0.0f, 1.0f);
        }
        case EngineState::Playing:
            return 1.0f;
    }
    return 1.0f;
}

}  // namespace

void DemoLoadingOverlay::draw(AppBase& app, float dt) {
    anim_time_ += dt;

    const auto& monitor = app.loading_monitor();
    auto& ui = app.ui_ctx();

    // ── 1. Solid backdrop covering the full viewport. The renderer's GS
    //      compute pipelines are already gated off in Loading; the alpha=1
    //      backdrop hides anything else (terrain shadow pass, etc.) that
    //      may have briefly drawn to the screen on early frames. ────────
    ui.panel(kScreenW * 0.5f, kScreenH * 0.5f, kScreenW, kScreenH, kBackdrop);

    // ── 2. Title text — "LOADING" or "WARMING UP". Centered around 60%
    //      vertical so there's headroom for the progress bar below. ────
    const char* label = monitor.state() == EngineState::Warming
                          ? "WARMING UP"
                          : "LOADING";
    constexpr float title_scale = 1.4f;
    const std::string title{label};
    // Approximate width using existing TextRenderer::measure_text would be
    // ideal, but UIContext::label takes an unmeasured x — we eyeball the
    // centre by subtracting a fixed glyph width estimate. Good enough for
    // the chunky pixel feel; exact centring isn't needed for this aesthetic.
    const float title_x = kScreenW * 0.5f - static_cast<float>(title.size()) * 12.0f;
    const float title_y = kScreenH * 0.62f;
    ui.label(title, title_x, title_y, title_scale, kTextMain);

    // ── 3. Animated trailing dots (3 cycles per second). Each dot is a
    //      separate label so we can blink them independently without ever
    //      changing the title's rendered length. ──────────────────────
    const float dot_phase = anim_time_ * 3.0f;
    constexpr float dot_scale = 1.4f;
    const float dots_x = title_x + static_cast<float>(title.size()) * 24.0f;
    for (int i = 0; i < 3; ++i) {
        const float local = dot_phase - static_cast<float>(i) * 0.33f;
        const float pulse = 0.5f + 0.5f * std::sin(local * 3.14159f * 2.0f);
        glm::vec4 c = kTextMain;
        c.a = 0.3f + 0.7f * pulse;
        ui.label(".", dots_x + static_cast<float>(i) * 22.0f, title_y, dot_scale, c);
    }

    // ── 4. Blocky progress bar. Two sprites give the SNES inset look:
    //      gold outer frame, then a near-black slot, then the ice-blue
    //      fill clipped to the current phase progress. Pixel-aligned;
    //      the renderer's UI sampler already uses NEAREST so edges are
    //      crisp. ────────────────────────────────────────────────────
    constexpr float bar_w  = 640.0f;
    constexpr float bar_h  = 36.0f;
    constexpr float bar_pad = 4.0f;       // frame thickness
    const float bar_cx = kScreenW * 0.5f;
    const float bar_cy = kScreenH * 0.32f;

    // Gold outer frame
    ui.panel(bar_cx, bar_cy, bar_w, bar_h, kBarFrame);
    // Inner slot
    ui.panel(bar_cx, bar_cy, bar_w - bar_pad * 2.0f, bar_h - bar_pad * 2.0f, kBarSlot);
    // Fill — left-aligned, so derive its centre from progress
    const float fill_max_w = bar_w - bar_pad * 2.0f - 2.0f;
    const float progress = phase_progress(monitor);
    const float fill_w = std::max(0.0f, fill_max_w * progress);
    if (fill_w > 0.0f) {
        const float fill_left = bar_cx - fill_max_w * 0.5f;
        const float fill_cx = fill_left + fill_w * 0.5f;
        ui.panel(fill_cx, bar_cy, fill_w, bar_h - bar_pad * 2.0f - 2.0f, kBarFill);
    }

    // ── 5. Hint line under the bar — kept short to read like an SNES
    //      footnote. ─────────────────────────────────────────────────
    const float hint_y = bar_cy - bar_h * 0.5f - 28.0f;
    constexpr float hint_scale = 0.5f;
    const char* hint = monitor.state() == EngineState::Warming
                         ? "PREPARING SCENE"
                         : "STREAMING ASSETS";
    const std::string hint_str{hint};
    const float hint_x = kScreenW * 0.5f - static_cast<float>(hint_str.size()) * 4.5f;
    ui.label(hint_str, hint_x, hint_y, hint_scale, kTextDim);
}

}  // namespace gseurat
