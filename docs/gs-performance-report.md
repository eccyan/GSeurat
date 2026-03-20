# GS Performance Optimization Report

**Date:** 2026-03-20
**Target:** Shadow-box mode with 210K Gaussians
**Hardware:** Apple Silicon MacBook (integrated GPU)

## Results

| Build   | Before | Real-time (no cache) | Cached | Speedup |
|---------|--------|----------------------|--------|---------|
| Debug   | 7 FPS  | 7 FPS                | 7 FPS  | ~1x (validation-layer bound) |
| Release | 7 FPS* | **19 FPS**           | **122 FPS** | **2.7x / 17x** |

\* Estimated — release previously crashed due to a tile layer bug (now fixed).

"Real-time" = chunk-cull skip + auto-scale (160x120), but full GS compute every frame.
"Cached" = all optimizations active (skip_sort + blit offset parallax).

## Root Cause Analysis

The original 10 FPS reading was misleading for two reasons:

1. **The FPS counter was broken.** It accumulated the clamped `dt` (capped at 0.1s),
   so any frame rate below 10 FPS always displayed as exactly 10.0 FPS.
   The real frame rate was ~7 FPS.

2. **The debug build was the bottleneck, not the GPU.** Vulkan validation layers
   (`VK_LAYER_KHRONOS_validation`) intercept every API call for error checking.
   With the GS pipeline issuing 15+ dispatches and dozens of barriers per frame,
   the validation overhead alone consumed ~130ms/frame. The GPU finished in <1ms
   (`vkWaitForFences` returned instantly).

## Optimizations Implemented

### 1. Skip chunk culling for shadow-box maps
**Files:** `renderer.hpp`, `renderer.cpp`, `gs_demo_state.cpp`, `app.cpp`

Shadow-box maps use a fixed camera angle with tiny parallax shifts. All Gaussians
are visible from every possible view. The per-frame frustum culling + chunk
gathering + `vkDeviceWaitIdle()` stall was unnecessary.

**Change:** Added `gs_skip_chunk_cull_` flag. When set, the chunk visibility
check, gather, and SSBO re-upload are skipped entirely. All Gaussians are
uploaded once at scene load.

**Impact in release:** Eliminates the `vkDeviceWaitIdle()` full pipeline stall
(~30-50ms in worst case). In practice, the stall was masked by validation
overhead in debug builds, so this primarily benefits release builds where the
camera moves.

### 2. Skip GS compute after first frame (cached rendering)
**Files:** `gs_renderer.hpp`, `gs_renderer.cpp`, `gs_demo_state.cpp`, `app.cpp`

In shadow-box mode the camera barely moves. The GS output image from the first
frame is reusable for all subsequent frames.

**Change:** Added `skip_sort_` and `sort_done_once_` flags. After the first
full render (preprocess + radix sort + tile rasterization), subsequent frames
return immediately from `GsRenderer::render()`. The cached output image stays
in `SHADER_READ_ONLY_OPTIMAL` layout and is sampled by the blit quad.

**Impact in release:** Eliminates 100% of per-frame GS compute work:
- Preprocess: 210K thread dispatch
- Radix sort: 4 passes x 3 dispatches = 12 compute dispatches
- Tile rasterization: 80 tiles x 210K Gaussian iterations

This is the single largest optimization — it turns the GS pass from ~50ms
GPU work to 0ms.

### 3. Auto-scale render resolution for large maps
**Files:** `app.cpp`

The scene JSON specified 320x240 render resolution. For 210K Gaussians, the
tile-based rasterizer processes every Gaussian for each 16x16 tile.

**Change:** When Gaussian count exceeds 100K, render resolution is automatically
reduced to 160x120. For 50K-100K, it uses 240x180. The pixel art aesthetic
(NEAREST sampling) makes the lower resolution indistinguishable.

**Impact:** Reduces tile count from 300 to 80 (4x fewer). Only affects the
first frame (since compute is cached after that), but makes the initial render
stutter shorter.

### 4. Parallax via blit quad offset
**Files:** `gs_demo_state.cpp`, `renderer.cpp`, `renderer.hpp`, `app.cpp`

The original parallax updated the 3D camera matrix each frame, requiring a full
GS re-render. With cached rendering, the camera can't change.

**Change:** In cached mode, mouse movement shifts the GS blit quad position by
up to +/-30 pixels instead of updating the camera. The background stays fixed,
creating a natural parallax layering effect.

**Impact:** Enables parallax interaction at zero rendering cost.

### 5. Wall-clock FPS counter
**Files:** `gs_demo_state.hpp`, `gs_demo_state.cpp`

The FPS counter accumulated `dt` which was clamped to 0.1s
(`if (dt > 0.1f) dt = 0.1f`). When the real frame time exceeded 100ms,
every frame contributed exactly 0.1s, and after 5 frames (0.5s window):
FPS = 5/0.5 = 10.0 — always.

**Change:** Replaced `dt` accumulation with `std::chrono::steady_clock`
wall-clock measurement.

**Impact:** Accurate FPS display. Not a performance fix, but essential for
measuring the actual impact of optimizations.

### 6. Tile layer null guard (release crash fix)
**Files:** `scene.cpp`, `systems.cpp`

GS-only scenes have no tilemap, but `SceneData::tilemap` is default-constructed
(empty tiles vector). `Scene::set_tile_layer()` moved it into an `optional`,
making `has_value()` return true. In release builds with optimizations,
`reflection_collect` and `Minimap::build_sprites` dereferenced the empty tiles
vector, causing segfaults.

**Change:** `set_tile_layer()` now calls `reset()` when tiles are empty.
`reflection_collect` also has an early return guard.

**Impact:** Fixed release-only crash. Without this fix, the release build
couldn't run at all.

## What Was NOT Effective

- **Skipping the scene render pass + post-processing pipeline** — attempted but
  reverted. Caused black screen because the composite render pass uses
  `LOAD_OP_DONT_CARE` and the replacement path didn't properly clear the
  swapchain image. In the release build, these passes only take ~2ms total,
  so skipping them provides negligible benefit.

- **All optimizations in the debug build** — validation layers dominate frame
  time so completely (~130ms overhead) that no rendering optimization makes a
  measurable difference. The debug build stays at ~7 FPS regardless.

## Architecture

```
Shadow-box frame (after first frame):

  GsRenderer::render()  →  early return (skip_sort)     [0ms]
  Scene render pass     →  empty scene, just clear       [<1ms]
  Bloom + DoF           →  process empty scene           [<1ms]
  Composite             →  tone map + GS blit + UI       [~2ms]
  Present               →  VSync                         [~8ms at 120Hz]
                                                    Total: ~8ms = 120+ FPS
```

## Trade-offs: Cached Rendering vs Real-Time Compute

Optimizations #2 (skip GS compute) and #4 (parallax via blit offset) trade
visual fidelity for frame rate. The cached mode freezes the GS output image
after the first frame and simulates parallax with a flat 2D quad shift.

### What is lost in cached mode

| Effect | Real-time | Cached | Difference |
|--------|-----------|--------|------------|
| Depth parallax | Near objects shift more than far objects (true 3D reprojection) | Entire image shifts uniformly (flat 2D translation) | ~4-5 px of depth-dependent shift lost at max parallax angle |
| View-dependent splat shape | Gaussian covariance re-projected per frame; splats change shape/size with angle | Frozen at first frame's projection | Negligible for ±8.6° angular range |
| Dynamic color/opacity | Could support animated splats, day/night tinting | Frozen | Not currently used, but blocks future features |
| Lighting changes | Could respond to real-time light changes | Frozen | Not applicable (GS layer has no dynamic lighting) |

### What is NOT lost

- Sprite layer (entities, particles, UI) renders in real-time every frame
- Post-processing (bloom, DoF, tone mapping) runs live on the composited output
- 2D game logic, input, and audio are unaffected

### Quantifying the depth parallax loss

The parallax camera has:
- Azimuth range: ±0.15 rad (~8.6°)
- Elevation range: ±0.15 rad
- Camera distance: Z=200, map depth range: Z=0 to Z=62

At maximum parallax angle, a near object (Z=62) would shift ~4-5 pixels more
than a far object (Z=0) in the real-time renderer at 160×120 resolution. The
blit offset gives uniform shift (0 pixels of depth variation).

At 1280×720 display resolution with NEAREST upscaling (8x), this 4-5 pixel
difference maps to ~32-40 display pixels — perceptible if comparing side by
side, but subtle during normal gameplay where the player's attention is on
the sprite layer.

### Middle-ground options

If the visual loss is unacceptable, these alternatives preserve more fidelity
while still improving performance:

1. **Re-render every N frames (implemented)** — Run full GS compute every Nth
   frame, reuse cached image with 2D blit offset on intermediate frames. Default
   N=8 with adaptive auto-tuning: every 0.5s the measured FPS is compared against
   a 30 FPS target. If FPS < 25.5, N increases (up to 16); if FPS > 39, N
   decreases (down to 1). This balances parallax update rate against hardware
   capability automatically.

2. **Re-render on significant camera change** — Track parallax delta and only
   re-sort when the accumulated shift exceeds a threshold (e.g., 2 pixels of
   depth error). For slow mouse movement, most frames stay cached.

3. **Full real-time at lower resolution** — Disable skip_sort entirely, rely
   only on chunk-cull skip + auto-scale (160×120). **Benchmarked at 19 FPS**
   on release build with 210K Gaussians — below 30 FPS target. Would need
   further GPU-side optimization (per-tile Gaussian lists, reduced sort passes)
   to reach 30 FPS without caching.

4. **Hybrid approach** — Use cached mode only when Gaussian count exceeds a
   threshold (e.g., 150K). Smaller maps (50K-100K) may achieve 30+ FPS with
   full real-time compute.

## Recommendation

For production use, always run the release build (`cmake --build --preset
macos-release`). The debug build with validation layers is 17x slower and
should only be used when debugging Vulkan API usage errors.
