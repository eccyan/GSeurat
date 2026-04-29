#pragma once

namespace gseurat {

class AppBase;

// 16-bit SNES-style loading screen overlay used by the demo while the engine
// is in Loading or Warming. Drawn over whatever the active GameState built —
// solid navy backdrop, blocky progress bar, "LOADING..."/"WARMING UP..."
// label. Pixel-aligned rectangles + text via existing `UIContext` infra.
//
// Stateless from the caller's point of view — DemoApp just calls `draw()`
// each frame the engine asks for an overlay. Animation phase is derived
// from a simple internal accumulator so blinking dots don't depend on
// engine state.
class DemoLoadingOverlay {
public:
    void draw(AppBase& app, float dt);

private:
    float anim_time_ = 0.0f;
};

}  // namespace gseurat
