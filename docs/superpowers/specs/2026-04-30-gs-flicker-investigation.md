# GS Renderer Flicker Investigation

**Date:** 2026-04-30
**Context:** Severe per-frame flicker is visible in the demo even on release builds. This document inventories root causes from a static read of the shader + CPU pipeline, ranks them by impact, and proposes a debugging system to confirm hypotheses and measure fixes.

## TL;DR

There is no single bug. Three independent mechanisms compound to produce the flicker:

| # | Mechanism | Where | Severity |
|---|-----------|-------|----------|
| 1 | Coarse 16-bit depth quantization spreads ties across many splats | `gs_preprocess.comp:560`, `gs_tile_bin.comp:98` | **High** |
| 2 | Tile-bin uses a global `atomicAdd` for entry placement → non-deterministic input order to the radix sort | `gs_tile_bin.comp:104` | **High** |
| 3 | Adaptive LOD re-gathers Gaussians every frame whenever animations / particles / VFX are active | `renderer.cpp:982-992` + `gs_chunk_grid_.gather_lod` | **Medium** |

A fourth contributor — PBD wind-sway changing depth keys per frame — is the *intended* effect. It only flickers when stacked on top of (1) and (2).

The Onesweep radix sort itself is correctly stable within a workgroup batch. The flicker is **not** a sort bug — it is **non-deterministic input order** for the sort, combined with key collisions that prevent the sort from disambiguating.

## Detail

### 1. Depth quantization is too coarse

`gs_preprocess.comp:558-560`:
```glsl
// Camera range [0.1, 1000] → ~0.015 unit resolution, sufficient for 320×240 pixel art
float depth_norm = clamp(splat.depth / 1000.0, 0.0, 1.0);
sort_entries[idx].key = min(uint(depth_norm * 65535.0), 0xFFFEu);
```

The 1000-unit normalization range is the camera's far plane. Real scenes use a *much* smaller depth range — the seurat_island camera typically sees splats in [5, 80] view-space depth. That puts every splat into roughly 80/1000 × 65535 ≈ **5 200 buckets**. With 2.4 M visible Gaussians (per smoke-test logs) inside a fraction of those buckets, **every bucket has hundreds of tied splats on average**.

The same coarse 16-bit quantization is repeated in `gs_tile_bin.comp:98`, this time over the configured `[near_z, far_z]` of the tile pipeline. That range is tighter so it's slightly better, but the same tie problem remains.

**Why this causes flicker:** front-to-back compositing in `gs_tile_render.comp` accumulates colors weighted by `(1 - alpha_accum)`. If splat A and splat B share a quantized depth bucket but render at different colors, swapping their order swaps the contribution they make to the pixel. The final color is **order-dependent** for tied keys.

### 2. Tile-bin atomic placement is non-deterministic

`gs_tile_bin.comp:104`:
```glsl
uint offset = atomicAdd(tile_sort_count, 1);
if (offset < max_entries) {
    tile_entries[offset].key = sort_key;
    tile_entries[offset].index = idx;
}
```

Every workgroup races to bump a single global counter. The position a splat lands at in the entry buffer depends on which thread reaches the atomic first — a function of GPU scheduling, dispatch order, and warp/wave timing. **Two runs of the same scene on the same camera frame will produce different entry buffer orderings.**

The downstream Onesweep scatter (`gs_onesweep_scatter.comp:127-138`) is documented as "stable rank within batch" and is correctly stable. But stability preserves the *input* order — if the input is non-deterministic, the output is too. For splats with tied (tile, depth_q) keys, the radix sort can't break the tie on its own, so the per-frame atomic order leaks straight through to the renderer.

### 3. LOD churn

`renderer.cpp:982-992`:
```cpp
if (gs_animator_.has_active_groups() || !gs_scene_animations_.empty()) {
    gs_static_force_dirty_ = true;
    camera_dirty = true;
}
if (!gs_pending_dynamics_.empty() || !gs_particle_emitters_.empty() || !vfx_instances_.empty()) {
    camera_dirty = true;
}
```

Whenever the scene has running animations, particles, or VFX (which is every frame in the demo), `camera_dirty = true`. That triggers `gs_chunk_grid_.gather_lod` to re-pick which Gaussians fall inside `gs_gaussian_budget_`. The selection is distance-based; splats hovering exactly at the budget boundary will pop in and out as the budget micro-adjusts (the adaptive-budget loop, `renderer.cpp:946-963`, smooths FPS but the budget value still drifts until `gs_budget_locked_` flips).

Effect: a different *set* of Gaussians enters the preprocess/sort/render pipeline each frame, on top of the existing ordering instability from (1) and (2).

### 4. PBD-driven depth changes (intended)

`gs_preprocess.comp:182-196` rotates PBD-tagged Gaussians every frame using the solver-written quaternion. Position changes → view-space depth changes → quantized key changes. This is the intended wind-sway effect, not a bug. It only contributes to flicker when stacked on top of (1) — every wind-sway frame churns hundreds of splats across bucket boundaries simultaneously.

### 5. Visible-count atomic (likely benign)

`gs_preprocess.comp:564`:
```glsl
atomicAdd(counts[counts_index], 1u);
```

This atomic counts visible splats but doesn't determine any output position, so its non-determinism doesn't visually leak. Listed for completeness — if a future change uses this counter to seed a write offset, it would join the flicker family.

## Proposed fixes (ranked by leverage / cost)

### Fix A — Add a global tiebreak to the sort key (high leverage, low cost)

Pack the splat index into the lower bits of the sort key so equal depths sort by a stable, deterministic value. Two options:

- **Cheap:** keep the 32-bit key, use 8 bits of `idx` as the tiebreaker (`(tile_id << 24) | (depth_q_8bit << 8) | (idx & 0xFF)`). Loses 8 bits of depth resolution but gains determinism. *Insufficient for scenes with >256 ties per tile.*
- **Right:** widen sort keys to 64-bit (`(tile_id << 48) | (depth_q << 16) | idx_low16`). Onesweep grows to 8 passes (vs 4) — roughly 2× sort cost. Eliminates the entire flicker family in (1) and (2).

### Fix B — Replace the global atomic with a deterministic prefix-sum (high leverage, medium cost)

Two-pass tile-bin:
1. Count each splat's tile-overlap count into `per_splat_tile_count[]`.
2. Exclusive prefix sum over `per_splat_tile_count` → deterministic `write_offset` for each splat.
3. Each splat writes its entries at the precomputed offsets.

This removes the `atomicAdd` ordering dependency entirely. Combined with (A) it's belt-and-suspenders.

### Fix C — Hysteresis on the LOD budget threshold (medium leverage, low cost)

`gs_chunk_grid_.gather_lod` is selecting Gaussians per frame against a budget that micro-jitters. Add a deadband — keep last-frame's selection unless the budget changes by >5% or a chunk visibility flips. Bonus: the existing `gs_prev_visible_` check at `renderer.cpp:1001` already does this for chunks; extend to per-Gaussian selection.

### Fix D — Increase depth precision (alternative to A)

Use full 32-bit float depth bits as the sort key (positive IEEE-754 floats sort lexicographically as uint32). No quantization, ~2 billion unique depth values. The `(tile_id, depth)` packing then needs 64 bits anyway, so this overlaps with Fix A's "right" path.

## Debugging system to validate fixes

Right now we can't easily measure flicker — it's "looks bad" by eyeball. A debugging harness should let us:
- Confirm a candidate fix actually eliminates the per-frame variance
- Catch regressions when adding new effects (PBD modes, VFX, etc.)
- Distinguish *sort instability* from *legitimate per-frame change* (PBD, animations, camera motion)

### Proposed: GS frame-determinism harness

**Mode 1 — Frame replay (CPU-side state determinism check)**

Add a Game Director command that:
1. Pauses simulation (`loading_monitor` → `Loading` or a new `Paused` state).
2. Holds camera + bone state + PBD state frozen.
3. Submits N consecutive frames with identical inputs.
4. After each frame, reads back `merged_sort_ssbo` (or `tile_entries`) and hashes its contents.

If the hash changes across N frames despite frozen inputs → confirms order-instability flicker (Fix A/B candidates).
If the hash is stable but pixels still flicker → look elsewhere (post-process, floating-point reductions).

**Mode 2 — Per-pixel variance overlay**

A debug fragment shader that accumulates `min/max/variance` of pixel colors over N consecutive frozen frames into a separate framebuffer, then visualizes the variance as a heatmap overlay. Renders red where pixels change despite static input. Reveals exactly which screen regions are unstable — typically tile boundaries and dense-overlap zones.

**Mode 3 — Sort tie histogram**

A compute shader pass that scans the merged sort buffer and counts unique keys vs total entries. Output: percentage of ties + tie cluster size distribution. Lets us measure how much of the visible scene shares depth keys before / after a precision change.

**Mode 4 — DebugDump integration**

Hook into the existing self-reporting `DebugDumpRegistry` (referenced in `CLAUDE.md`). Emit a `gs_renderer` JSON dump containing:
- `sort_tie_pct` (from Mode 3)
- `lod_budget`, `lod_visible_count`, `lod_churn_per_frame` (count of new vs dropped Gaussians frame-over-frame)
- `tile_entries_total`, `tile_entries_per_tile_max` (load-balance proxy)
- `flicker_variance_score` (Mode 2 reduced to a single number)

Triggered via `F12` or `{"command": "debug_dump", "domain": "gs_renderer"}` over the bridge.

### Implementation order

1. **Mode 1 (replay hash)** first — minimal code, conclusive yes/no on order-instability. Confirms whether Fix A/B is the right tree.
2. **Mode 3 (tie histogram)** — gives us a number to optimize against. Shows whether moving from 16-bit to 32-bit depth (Fix D) or adding `idx` tiebreak (Fix A) actually reduces ties.
3. **Mode 2 (variance overlay)** — visual confirmation, useful for the demo polish phase.
4. **Mode 4 (DebugDump JSON)** — wire into existing tooling so future regressions are catchable from CI / scenario_runner.

### CI gate

Once Mode 1 lands, add a scenario_runner test:
- Load seurat_island, freeze input, render 60 frames, verify hash stability across last 30.
- Fails CI if a future change reintroduces order-instability flicker.

## Out of scope for this investigation

- The ground-truth reference is "the same scene rendered with stable, full-precision sort keys." That requires Fix A+D to actually exist before Mode 1 has anything to compare against. Both can live in the same prototype branch.
- Fixing flicker introduced by post-processing (bloom, DoF) — those are deterministic given a stable input frame, so this report ignores them.
- Texture-coordinate jitter (TAA) is not currently in the pipeline, so it's not contributing.

## References

- Memory: `feedback_gpu_shader_debugging.md` — "stable sort, AMD TDR, descriptor validation, sentinel fill"
- `project_demo_followups.md` — this issue is already memo'd as a follow-up
- `gs_preprocess.comp:558-560` — depth quantization
- `gs_tile_bin.comp:98-110` — tile-bin atomic + key packing (pre-Fix-B; line numbers refer to the version that existed when this report was written, before commit `d7ba0288`)
- `gs_onesweep_scatter.comp:127-138` — sort stability scope
- `renderer.cpp:946-1014` — adaptive budget + LOD gather

---

## Resolution (2026-04-30)

The investigation's primary hypothesis — that the `atomicAdd` in `gs_tile_bin.comp:104` was the dominant flicker source — has been **confirmed and resolved**. Two PRs landed on `main` the same day this investigation was written:

### Diagnostic: PR #380 — Mode 1 frame-replay harness

Implemented Mode 1 from the [Debugging system](#debugging-system-to-validate-fixes) section:
- `start_determinism_test` / `get_determinism_test_result` commands over the existing control-server bridge.
- After the in-flight fence, FNV-1a-hashes the live entries of the post-Onesweep `tile_sort_a_` readback. Hash drift across N replayed frames with frozen inputs proves order-instability.
- The freeze covers the camera, animator, PBD step, LOD/chunk gather, and (added in late commits on the harness branch) the entire ECS scheduler tick + dynamic Gaussian buffer rebuild + PBD solver dispatch — necessary because PBD uses a hardcoded `1/60s` step that bypasses the engine `dt = 0` freeze.
- Hardening: `vmaInvalidateAllocation` on both readback buffers (Codex P1.1), clamp `live_count` to `tile_sort_capacity_` (Codex P1.3), 64-bit `SortEntry` toggle assert (Codex P2.2), skip frame on no readback emitted (Codex P2.4).
- 32-bit `SortEntry` retained; `GSEURAT_USE_64BIT_SORT_KEYS` toggle scaffolded for the future Fix-A path.

CLI: `python3 scripts/game_director.py determinism_test [frames] [timeout]`.

### Cure: PR #381 — Fix B (deterministic prefix-sum tile-bin)

Replaced the global `atomicAdd` with a 3-pass count → exclusive-scan → scatter pipeline:
- `shaders/gs_tile_count.comp` (new): per-splat tile-overlap count, identical projection/culling math to the scatter for the count↔scatter invariant.
- `shaders/gs_tile_scan.comp` (new): 3-dispatch hierarchical exclusive scan (local 256-element Hillis–Steele, single-WG chunked block-sum scan, add-base) with `memoryBarrierBuffer()` at workgroup exit on Apple-TBDR.
- `shaders/gs_tile_bin.comp` (rewritten): scatter reads precomputed offsets, drops the atomic.
- New SSBOs sized to the visible-splat upper bound: `per_splat_tile_count_ssbo_`, `per_splat_tile_offset_ssbo_`, `scan_block_sums_ssbo_`.
- `tests/test_tile_scan_gpu.cpp`: 8 cases (zero/one block, multi-block, chunk-boundary, multi-chunk, 262K-element dense random) verified against a CPU reference exclusive scan.
- 32-bit sort keys retained — Fix A intentionally **not** piggybacked so the harness can isolate Fix B's effect.

### Verdict on `seurat_island`

| Configuration | `determinism_test 10` |
|---|---|
| `main` before #380/#381 (atomic single-pass tile-bin) | **UNSTABLE 10/10**, `live_entry_count` drifting 332K–342K |
| Harness only (atomic still present) | **UNSTABLE 10/10**, `live_entry_count` rock-stable at 341 844 |
| Fix B + harness (current `main`) | **STABLE 1/10**, `live_entry_count = 1 716 536` constant |

The harness sits on `main` as a regression catcher — any future change that reintroduces ordering non-determinism into the GS pipeline will flip the verdict back to UNSTABLE.

### What's left — Fix A as deferred technical debt

The other root cause from this investigation — coarse 16-bit depth quantization producing tied keys for hundreds of overlapping splats — is **still present**. It no longer flickers visibly because the now-deterministic compositing order means the user sees one consistent (if slightly wrong-by-an-epsilon) ordering each frame. Tracked in `~/.claude/projects/-Users-eccyan-dev-GSeurat/memory/project_demo_followups.md` as "[Open / Low Priority] GS Flicker (Depth Quantization)". When prioritising it later: flip `GSEURAT_USE_64BIT_SORT_KEYS=1`, refactor the 8 GLSL shaders' `struct SortEntry` to a shared `shaders/include/sort_entry.glsl` (deferred from PR #380), expect ~2× sort cost from 4→8 Onesweep passes, and re-run the harness for confirmation.

### PR references

- PR #380: <https://github.com/eccyan/GSeurat/pull/380>
- PR #381: <https://github.com/eccyan/GSeurat/pull/381>
- Merge commits on `main`: `a80cd8ce` (#380), `1b0d3287` (#381)

### See also

A separate GS-rendering pathology — **post-portal ghost geometry** (overworld content rendering inside the dungeon at original world coordinates) — was investigated and resolved on 2026-05-01. Different mechanism (stale `projected_ssbo_` tail across scene clear, not per-frame sort non-determinism), tracked in `2026-05-01-post-portal-flashback-investigation.md`. PR #385 + #386.
