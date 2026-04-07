# PBD Chain Visual Demo

**Date:** 2026-04-07
**Status:** Approved

## Problem

The J key PBD chain demo in `IslandDemoState` hijacks the GPU PBD element buffer, replacing the terrain wind-sway elements with 3 chain elements. This breaks tree sway animation and produces no meaningful visual output since no Gaussians are dedicated to the chain.

## Solution

Run a CPU-side PBD simulation in `IslandDemoState` and render the chain as dynamic Gaussians (glowing orbs + rope segments) appended to `gs_dynamic_buffer_` each frame. The GPU PBD pipeline remains untouched — terrain sway continues working.

## CPU PBD Simulation

Stored as member state in `IslandDemoState`:

```cpp
struct PbdNode {
    glm::vec3 position;
    glm::vec3 prev_position;
    float inv_mass;  // 0 = pinned
};

struct PbdLink {
    uint32_t a, b;
    float rest_length;
    float stiffness;
};

std::array<PbdNode, 3> pbd_nodes_;
std::array<PbdLink, 2> pbd_links_;
```

**Simulation step** (called in `update()` when `pbd_chain_active_`):
1. Verlet integration: `vel = (pos - prev) * damping; pos += vel + gravity * dt²`
2. Ground collision: clamp Y to `ground_y`, reflect prev for bounce
3. Constraint projection: 4 iterations of distance constraint solving
4. Velocity update: `vel = (pos - prev) / dt`

Constants: gravity = (0, -9.8, 0), damping = 0.98, ground_y = character_origin_.y - 2.0, 4 solver iterations.

## Visual Generation

A `gather_pbd_chain()` method appends Gaussians to `gs_dynamic_buffer_`:

### Orb Nodes (×3, ~25 Gaussians each)

Three concentric layers per node:

| Layer | Count | Scale | Color (RGB) | Opacity | Emission |
|-------|-------|-------|-------------|---------|----------|
| Core | 5 | 0.3 | (1.0, 0.85, 0.3) | 0.95 | 3.0 + speed×0.3 |
| Mid | 8 | 0.5 | (1.0, 0.6, 0.15) | 0.7 | 1.0 |
| Halo | 12 | 0.9 | (1.0, 0.9, 0.7) | 0.25 | 0.3 |

- Core Gaussians cluster tightly at the node center with small random offsets (±0.1)
- Mid-layer Gaussians spread at radius ~0.3 with random offsets
- Halo Gaussians spread at radius ~0.6, large scale for soft glow
- All positions use deterministic offsets (seeded by index) so they don't jitter frame-to-frame

### Rope Segments (×2, ~15 Gaussians each)

Between each connected pair of nodes:

- 15 Gaussians linearly interpolated: `t = (i + 1) / 16.0` for i in 0..14
- Position: `lerp(node_a.position, node_b.position, t)`
- Scale: (0.15, 0.15, 0.15) — thin dots forming a dotted rope
- Color: (1.0, 0.7, 0.2) amber
- Emission: 0.5
- Opacity: `0.6 * (1.0 - 2.0 * abs(t - 0.5))` — tapers to 0 at endpoints (blends into orbs)

### Total Budget

- 3 orbs × 25 = 75 Gaussians
- 2 ropes × 15 = 30 Gaussians
- **Total: 105 Gaussians/frame** (1.3% of 8192 dynamic headroom)

## Integration

### Toggle (J key)

**ON:**
1. Initialize `pbd_nodes_` at `character_origin_ + (3, 8, 0)`, spaced 3 units apart vertically
2. Node 0 pinned (`inv_mass = 0`), nodes 1-2 free (`inv_mass = 1`)
3. Initialize `pbd_links_` with rest_length = 3.0, stiffness = 0.8
4. Set `pbd_chain_active_ = true`

**OFF:**
1. Set `pbd_chain_active_ = false`
2. No cleanup needed — dynamic buffer is rebuilt each frame

### Frame Update

In `IslandDemoState::update()`, after `update_walk_animation()`:
```
if (pbd_chain_active_) {
    step_pbd_chain(dt);      // advance physics
    pbd_nodes_[0].position = character_origin_ + vec3(3, 8, 0);  // anchor follows player
}
```

### Gather

The dynamic buffer (`gs_dynamic_buffer_`) is cleared and uploaded inside `Renderer::record_gs_compute()`, which runs after `build_draw_lists()`. Game states cannot append during `build_draw_lists` since the buffer gets cleared later.

**Approach:** Add a staging buffer `gs_pending_dynamics_` to `Renderer` with a public `append_dynamic_gaussians(const Gaussian*, uint32_t)` method. Game states call this during `update()`. In `record_gs_compute()`, after gathering particles/VFX, append the pending buffer contents and clear it.

In `IslandDemoState::update()`:
```
if (pbd_chain_active_) {
    gather_pbd_chain(app.renderer());  // calls renderer.append_dynamic_gaussians()
}
```

## Removed

- All calls to `gs_renderer().upload_pbd_elements()` / `upload_pbd_constraints()` / `clear_pbd()` from the J key handler
- No GPU PBD interaction from the chain demo

## Files Changed

| File | Change |
|------|--------|
| `include/gseurat/demo/island_demo_state.hpp` | Add PbdNode/PbdLink structs, pbd_nodes_, pbd_links_ members, step/gather methods |
| `src/demo/island_demo_state.cpp` | Replace J handler, add step_pbd_chain(), gather_pbd_chain() |
| `src/engine/renderer.cpp` | Append `gs_pending_dynamics_` to `gs_dynamic_buffer_` in `record_gs_compute`, then clear it |
| `include/gseurat/engine/renderer.hpp` | Add `gs_pending_dynamics_` vector and `append_dynamic_gaussians()` method |
