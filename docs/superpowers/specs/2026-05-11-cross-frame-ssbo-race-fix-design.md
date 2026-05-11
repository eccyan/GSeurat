# Cross-Frame Compute SSBO Double-Buffering + Option A Restore + Dungeon Content Fix

**Date:** 2026-05-11
**Status:** Draft — pending user review
**Related:** Postmortem follow-up to PR #420 (`2026-05-09-upfront-merge-single-init-gs-design.md`, §11.1)

## TL;DR

Eliminate the post-merge "every-other-frame blank swapchain image" flicker by **per-frame double-buffering** the compute SSBOs that feed the (already per-frame) `output_images_[f]` slots. With the race fixed, **restore Option A** by moving PBD-tagged and character splats into the dynamic tail, and **content-fix the dungeon** so it stops overflowing the dynamic headroom.

## 1. Postmortem: How the Bug Hid for So Long

The race is **latent, not new.** Recent refactors didn't introduce it; they exposed it:

- **Async PLY parse (PR #417)** and **async portal transition (PR #418)** removed large CPU stalls from main-loop frames, letting the CPU pull ahead of the GPU.
- **Static/dynamic split (PR #420)** removed the per-frame 2.44 M-splat depth sort, shrinking the GPU frame budget enough that frame N+1's CPU recording can now finish and submit *before* frame N's compute has retired on the GPU.
- With `kMaxFramesInFlight=2`, two cmdbufs are in flight on the same `VkQueue`. The single-instance compute SSBOs (`projected_ssbo_`, `sort_keys_ssbo_`, `sort_b_ssbo_`, `visible_count_ssbo_`, `dynamic_sort_a/b_`, `counts_ssbo_`) are written by frame N+1's preprocess while frame N's tile-render is still reading them. Result: roughly half the time, frame N's tile-render reads zeros / sentinels / partially-overwritten projected entries → an empty `output_images_[N%2]` → post-process samples an all-zero input → uniform dark-vignette frame.

**Visual evidence (2026-05-11):** Consecutive Game Director screenshots `s7.png` (uniform dark-purple gradient — vignette over zero) and `s8.png` (fully rendered scene). Alternation is near-1:1 in steady state, with some frames also stalling 100–1000 ms on `vkGetQueryPoolResults(WAIT_BIT)` waiting for the previous frame's depth-sort timestamps.

A **partial mitigation** of this class of bug already lives in tree at `gs_renderer.cpp:3490–3508`: the `dynamic_sort_a/b_` fill was moved from CPU mapped-memory writes (which raced CPU-vs-GPU) to GPU-side `vkCmdFillBuffer` with an in-cmdbuf TRANSFER→COMPUTE barrier. That covered the CPU-write-vs-GPU-read race on those two buffers. The **GPU-write-vs-GPU-read race across submits** on the other shared SSBOs remained.

## 2. Affected Buffers

### Must become `std::array<Buffer, kMaxFramesInFlight>`

| Buffer | Role | Per-frame size (≈) |
|---|---|---|
| `projected_ssbo_` | Frustum-cull output, one ProjectedGaussian per input splat | `max_total_count` × 80 B |
| `sort_keys_ssbo_` | Depth-sort key buffer A (ping-pong) | `max_total_count` × 8 B |
| `sort_b_ssbo_` | Depth-sort key buffer B (ping-pong) | `max_total_count` × 8 B |
| `visible_count_ssbo_` | Atomic counter after frustum cull | 4 B |
| `dynamic_sort_a_` | Dynamic-tail sort buffer A | `dynamic_sort_size_` × 8 B |
| `dynamic_sort_b_` | Dynamic-tail sort buffer B | `dynamic_sort_size_` × 8 B |
| `counts_ssbo_` | Static / dynamic / merged counts | 12 B |
| `depth_onesweep_status_` | Onesweep prefix-sum scratch (if shared cross-frame) | varies |

Re-confirm `dynamic_sort_a/b_` during implementation — the GPU-fill mitigation may make per-framing redundant for those two; if so, document and skip.

### Stay single-instance (read-only or static-after-init)

- `gaussian_ssbo_`, `static_gaussian_ssbo_` — read-only after upload / init_gs
- `static_sort_a_/b_` — written only on `static_dirty_=true` (rare camera-move event); GPU-fenced before swap
- `bone_ssbo_`, `pbd_state_ssbo_`, `pbd_*` — written CPU-side or by PBD compute; confirm safe in Phase 1 by re-reading their access pattern. If a race is found, per-frame them too.

### Descriptor sets that must become per-frame

- `preprocess_set_` → `preprocess_sets_[kMaxFramesInFlight]`
- `sort_set_` (legacy) → `sort_sets_[kMaxFramesInFlight]`
- Depth-onesweep histogram + scatter sets — per-frame variants

`render_sets_[f]` and `post_process_sets_[f]` and the composite `gs_descriptor_sets_[i]` are already per-frame and only need to start binding the per-frame buffers above (no allocation change).

## 3. Memory Budget

`max_total_count ≈ 4 M` (1.7 M static + 0.75 M dynamic + headroom for Option A growth + VFX worst case). Per-frame-slot footprint:

- `projected_ssbo_`: 4 M × 80 B ≈ **320 MB**
- `sort_keys` + `sort_b`: 4 M × 16 B ≈ 64 MB
- `dynamic_sort_a/b_`: 1 M × 16 B ≈ 16 MB
- Counts / visible_count: trivial

Per-slot ≈ **400 MB**. With `kMaxFramesInFlight=2` the duplicate adds ≈ **400 MB** of overhead. **This exceeds the ~200 MB the user initially quoted** — flagging explicitly so the budget is acknowledged before implementation.

If 400 MB is too much, two trim levers exist (both deferred until budget is shown to be a real ceiling):
1. Tighten `projected_ssbo_` sizing to a frustum-cull worst case rather than `max_total_count` (adds overflow risk, needs runtime guard).
2. Split projected layout so only the GPU-private fields are per-frame; immutable per-splat data stays single-instance.

Default for this spec: **accept the ~400 MB overhead.** Implementation re-validates and reports actual VRAM use post-Phase 1.

## 4. Implementation Phases

### Phase 1 — Per-frame storage for racing SSBOs

- Change declarations in `gs_renderer.hpp` from `Buffer X_ssbo_` to `std::array<Buffer, kMaxFramesInFlight> X_ssbos_`.
- Update all create / resize / destroy sites in `gs_renderer.cpp`.
- Where a buffer is currently accessed by a single getter / member, route through `X_ssbos_[frame_in_flight]`.
- **Validation gate:** Vulkan validation layers enabled (`macos-debug`) → run demo for 30 s → no `SYNC-HAZARD-*` warnings.

### Phase 2 — Per-frame descriptor sets for compute

- `preprocess_set_` → `preprocess_sets_[f]`; same layout, each set bound to per-frame buffers at the same shader bindings (no shader change).
- Same treatment for legacy `sort_set_` and the depth-onesweep histogram / scatter sets.
- `update_descriptors()` writes all per-frame sets at once on init / resize / scene change.
- **Validation gate:** descriptor pool capacity audit — `gs_pool_` budget must absorb the new sets; double the `kMaxFramesInFlight`-scaled counts in `create_descriptor_pool` if needed.

### Phase 3 — Wire `frame_in_flight` through dispatch

- `dispatch_gpu_compute`, `dispatch_depth_onesweep`, `dispatch_tile_render` already receive `frame_in_flight` from `Renderer::record_gs_prepass`. Bind per-frame sets and use per-frame buffers throughout.
- Static-tail buffers stay single-instance (`static_sort_a/b_` are GPU-fenced via the existing `static_dirty_` flow).
- **Validation gate:** Take 30 consecutive Game Director screenshots; zero blank frames.

### Phase 4 — Restore Option A (PBD + characters into dynamic tail)

- `IslandDemoState::on_enter` + `perform_portal_transition`: partition the merged cloud so that PBD-tagged (`bone_index ∈ [32, 63]`) **and** character / NPC bone-animated (`bone_index ∈ [1, 31]`) splats feed `set_persistent_dynamics()`. Only terrain + static props (`bone_index == 0`) stay in the static cloud.
- `kDynamicHeadroom` is already 1 MiB after PR #420; expected occupancy with Option A:
  - ~12 PBD trees × ~5 k splats ≈ 60 k
  - 1 PC × ~50 k ≈ 50 k
  - N NPCs × ~50 k (bound by manifest)
  - VFX cap (`kMaxVfxObjectSplats = 2048` × per-frame instances)
  - Comfortable under 1 M for the island scene; dungeon handled by Phase 5.
- Remove the trade-off comment at `gs_renderer.cpp:3411–3429` (the "PBD lives in static, don't dirty per-frame" rationale no longer applies — PBD splats now live in the per-frame dynamic sort which is cheap to re-sort).
- **Validation gate:** PBD wind sway visible while camera is stationary; characters and NPCs render correctly post-merge and post-portal-transition.

### Phase 5 — Dungeon torch content fix

- Identify the dungeon scene's torch VFX (likely under `assets/scenes/` or referenced by a chunk in `world.json`).
- Reduce per-torch particle count and/or torch instance count so the dungeon's total **dynamic** count fits in `kDynamicHeadroom` with headroom for PC + NPCs + PBD trees.
- Cross-check with `gs_vfx.cpp` decimation (`kMaxVfxObjectSplats = 2048`) — the cap should remain a safety net, not a load-bearing limit on content.
- **Validation gate:** Walk into the dungeon; no dynamic-tail overflow warnings in stderr, no flicker, no missing geometry.

## 5. Validation Plan

1. **Flicker regression** — 30 consecutive screenshots, zero blank frames.
2. **Walk tour** — `python3 scripts/game_director.py tour` reaches every POI; visual inspection shows no flicker, no missing dynamics.
3. **Portal transition** — Bridge → dungeon → bridge, twice. Characters render through both transitions; no overflow logs.
4. **VRAM check** — Activity Monitor / Metal HUD before vs after Phase 1. Confirm overhead is in the expected ~400 MB band.
5. **Frame timing** — Watchdog log over 60 s: `[gs_render/wd/WAIT_SLOW]` lines disappear or fall well below the once-per-30-frames cadence we see today (CPU no longer waits because GPU isn't trailing behind anymore).
6. **Determinism harness** — Existing snapshot-diff test still passes.
7. **Validation layers** — `macos-debug` run produces zero `SYNC-HAZARD-*` warnings under steady gameplay.

## 6. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Two prior reverts in this area | Phase-by-phase commits with named validation gates; keep `kMaxFramesInFlight == 2` static_assert. |
| VRAM overhead exceeds quoted ~200 MB | Document actual measurement post-Phase 1; trim only if a real ceiling appears (`projected_ssbo_` sizing levers exist). |
| Descriptor pool exhaustion | Audit and re-size `gs_pool_` in Phase 2. |
| A racing buffer is missed in the per-frame list | Validation-layer SYNC-HAZARD warnings will surface any miss; treat as Phase-1 acceptance criterion. |
| Option A pushes dungeon over `kDynamicHeadroom` | Phase 5 caps content; add a hard assertion / loud stderr log on overflow so future content authoring fails loud rather than silently truncating. |
| Mid-implementation discovery that `bone_ssbo_` or PBD buffers also race | Add to the per-frame list in Phase 1 and re-validate. |

## 7. Out of Scope

- Reworking the static-tail invalidation policy (`static_dirty_`).
- Switching depth sort to a different algorithm.
- The `loading_monitor` → Warming → Playing edge instrumentation.
- The §11.3 watchdog removal (already shipped in PR #420; production builds strip it via `GSEURAT_DEBUG_BUILD`).
- Re-architecting `kMaxFramesInFlight`. Stays 2.

## 8. Acceptance

User reviews and approves this spec. After approval, `writing-plans` produces a phase-by-phase implementation plan; each phase is its own commit on a fresh branch `fix/cross-frame-ssbo-race` off `origin/main`.
