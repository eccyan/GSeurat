# Onesweep Status Buffer — Cross-Frame Race + Failed Per-Framing Attempt

**Status:** Known residual issue. Tech debt.
**Branch where it was discovered:** `fix/cross-frame-ssbo-race` (commit `354479b0`, reverted at `8251f05c`)
**Severity:** Low — visual symptom is currently absent / hidden by the post-Option-A dynamic tail size, but the race is real on paper and may resurface if the dynamic count grows.

## Summary

The cross-frame race fix on `fix/cross-frame-ssbo-race` converts the GS compute pipeline's per-frame SSBOs and descriptor sets to `std::array<…, kMaxFramesInFlight>`. Two buffers were deferred from Phase 3 and addressed in a follow-up commit (Phase 3.6):

- `onesweep_status_` — tile-sort lookback status buffer
- `depth_onesweep_status_` — depth-sort lookback status buffer

Both are filled (`vkCmdFillBuffer`) at the start of every per-frame compute dispatch (`dispatch_tile_sort`, `dispatch_depth_onesweep`) and read by the same dispatch's lookback radix sort. On paper the race is real:

> With `kMaxFramesInFlight=2`, cmdbuf N+1's `vkCmdFillBuffer` on the same single-instance status buffer can stomp cmdbuf N's still-in-progress lookback state on the GPU. Submission order applies to start-of-batch only — pipeline stages can overlap across batches on the same queue.

Phase 3.6 attempted the obvious fix: per-frame both status buffers and bind slot `[frame_in_flight]` from the relevant dispatches.

**It made things visibly worse.** Reverted at `8251f05c`. This document records what was tried, the regression symptom, and the candidate root causes for a future fix attempt.

## What Phase 3.6 changed (the reverted diff)

`include/gseurat/engine/gs_renderer.hpp` (+37 / -19) and `src/engine/gs_renderer.cpp` (+122 / -52). The mechanical changes:

1. **Buffer field promotion:**
   - `Buffer onesweep_status_` → `std::array<Buffer, kMaxFramesInFlight> onesweep_statuses_`
   - `Buffer depth_onesweep_status_` → `std::array<Buffer, kMaxFramesInFlight> depth_onesweep_statuses_`

2. **Create / destroy / `vkCmdFillBuffer`:** wrapped or routed through `[frame_in_flight]` per the established pattern from Phases 1–3.5.

3. **`dispatch_depth_onesweep` signature change:** added a `uint32_t frame_in_flight` parameter and threaded it through both call sites in `render()` (static depth sort dispatch at the `static_dirty_frames_remaining_ > 0` branch, dynamic depth sort dispatch on the per-frame path).

4. **Static-depth descriptor set promotion:** promoted `static_depth_hist_set_a_/b_` and `static_depth_scatter_set_ab_/ba_` from single `VkDescriptorSet` to `std::array<…, kMaxFramesInFlight>`. The rationale: these sets bind `depth_onesweep_statuses_[f]` (newly per-frame), so the sets themselves must also be per-frame. `static_sort_a_/b_` (the buffers these sets *also* bind) were left single-instance per the existing "GPU-fenced via `static_dirty_`" claim.

5. **Pool capacity bump:** `maxSets` 232 → 236 (+4 for the 4 new per-frame static-depth sets).

6. **`layouts[]` allocation slot extension:** 4 new entries at indices 54–57 for the static-depth `[1]` slots, with `kSetCount` 54 → 58.

7. **Obsolete-comment scrub:** removed the "stays single-instance" comments at the previously-deferred sites in `update_descriptors`.

Build was clean. Vulkan validation layer (`macos-debug` build) reported **zero** `SYNC-HAZARD-*` warnings.

## Observed symptom (the regression)

Visual diagnosis via Game Director consecutive screenshots, 15-shot batch with 0.3 s pacing:

| Branch tip | Screenshot count at full-swapchain resolution (~410 KB, identified by sampling as the engine's "WARMING UP / PREPARING SCENE" loading overlay) |
|---|---|
| Phase 3.5 (`506af492`, post-revert) | 3 / 15 |
| Phase 3.6 (`354479b0`, applied) | 14 / 15 |

That is, with Phase 3.6 applied the engine essentially never reached the **Playing** state of `EngineLoadingMonitor` during the screenshot window — it stayed in **Loading** or **Warming**, with the overlay drawn on top. With Phase 3.6 reverted, the engine reached Playing immediately and stayed there.

The user's Mac WindowServer also crashed mid-test on one of the Phase 3.6 runs (one of two restarts experienced during this branch's validation cycle); we cannot rule out that Phase 3.6's specific GPU pattern is what triggered the WindowServer watchdog, though Phase 3.5 alone has not reproduced that crash.

## Why the simple "race fix" failed — candidate hypotheses

Each of the following is a plausible root cause; none have been confirmed. Listed roughly in order of expected likelihood.

### H1. Static-depth-sort timing-coupling broke when its buffer was per-framed

Before Phase 3.6, the static depth sort wrote to `static_sort_a_/b_` (single instance) using a single-instance `depth_onesweep_status_` to coordinate radix-sort workgroups. The `static_dirty_` flow guaranteed the static sort only fired on dirty events, and the *original* `static_dirty_` was a `bool` that ran the sort *once* per cycle.

After Phase 3 (earlier on this same branch) the flag became `static_dirty_frames_remaining_`, counting down from `kMaxFramesInFlight=2`. That means **the static depth sort runs twice in a row** during a dirty cycle, once per per-frame slot — and those two cmdbufs can execute concurrently on the GPU.

With `depth_onesweep_status_` still single-instance through Phase 3.5, this was the still-racing scenario Phase 3.6 was supposed to fix. But:

- `static_sort_a_/b_` themselves remained single-instance in Phase 3.6 (the implementer's comment claimed they were "GPU-fenced via `static_dirty_`").
- That claim is wrong once the countdown lets two cmdbufs write to `static_sort_a_/b_` in a row.
- So even with `depth_onesweep_statuses_[f]` properly per-frame, the *output* of the static sort (`static_sort_a_/b_`) can still race across the two countdown frames.

Subsequent merge dispatches read `static_sort_a_` for the merged output, then tile-bin reads merged, etc. If the static-sort write races, downstream reads see corrupt data.

This would explain why Phase 3.6 didn't fix the visual issue — but not directly why the engine got stuck in **Loading** / **Warming**. See H2 / H3 for that.

### H2. `LoadingMonitor` arming depends on a status the depth sort indirectly controls

`EngineLoadingMonitor` transitions `Loading → Warming → Playing` based on `TransferQueue::Handle` completion tracked via `begin_load(handles)`. The handles tracked are the slab uploads from `load_cloud_async`. None of them are directly tied to the depth sort or onesweep status buffers.

However, the transition is gated by **`should_dispatch_gpu_work() = state_ != Loading`**, and the *Warming* phase counts down `kMaxWarmupFrames` of actual GPU dispatches. If Phase 3.6 introduced a GPU stall — for example a deadlock inside an onesweep dispatch due to a corrupt status buffer — the warmup-frame counter would stall too. The engine would never reach Playing.

The screenshot evidence is consistent with this: the engine stayed in a state where `should_overlay_loading_ui() == true`, i.e. **`Loading` or `Warming`**, not Playing.

### H3. `depth_onesweep_max_wg_` is computed once and shared across slots

The status-buffer fill size is `num_sort_passes_ × 256 × depth_onesweep_max_wg_ × sizeof(uint32_t)`. Both per-frame slots are sized from the same `depth_onesweep_max_wg_`. If `depth_onesweep_max_wg_` is recomputed when the static or dynamic sort sizes change (which they do mid-load), there could be a window where the per-frame status buffer slot is the wrong size — too small for the active dispatch's workgroup count — producing OOB writes that corrupt VRAM and hang.

Worth checking: when is `depth_onesweep_max_wg_` set, and does it get recomputed after `set_persistent_dynamics` / `update_active_gaussians` (which change dynamic counts)?

### H4. Descriptor-pool sizing was just-barely-sufficient under static + dynamic depth promotion

Phase 3.6's pool bump was modest (+4 `maxSets`, no `STORAGE_BUFFER` increase). The Phase 3.6 implementer noted "STORAGE_BUFFER 416 — plenty of headroom — the new 4 sets need ~12 storage-buffer slots." That's true on paper, but if any pool consumer outside the listed sets (e.g. some on-the-fly per-frame descriptor allocation elsewhere) raised the actual count, allocation could silently fail at runtime and produce broken descriptor sets. `vkAllocateDescriptorSets` would `VK_ERROR_OUT_OF_POOL_MEMORY`; the implementer didn't add a check for that error code on the new allocation path, so a silent failure is possible.

### H5. MoltenVK / Apple TBDR specifics

Stderr shows `[vk_context] No dedicated transfer queue; using graphics queue fallback` and `Apple M5 (vendor 0x106B) [Apple — TBDR]`. The single graphics+compute+transfer queue means every cmdbuf submission goes through one queue. On a TBDR with aggressive tile reordering, the timing characteristics of cross-cmdbuf compute can differ from desktop discrete GPUs in ways the Vulkan validation layer doesn't model. We have no validation-layer signal, no PIX trace, no GPU debug capture to confirm or rule out a MoltenVK-specific scheduling issue.

## What the next attempt should investigate

In rough order of cost-to-investigate vs. payoff:

1. **First check H3:** add an assertion that the per-frame `depth_onesweep_statuses_[f]` buffer size matches the actual dispatch's workgroup count at fill time. If the assertion fires, the size is the issue.

2. **Add a `VkResult` check on the Phase 3.6 pool allocation** to rule out H4.

3. **Promote `static_sort_a_/b_` to per-frame** (`std::array<Buffer, kMaxFramesInFlight>`) as part of any re-attempt, on the theory that the `static_dirty_frames_remaining_=kMaxFramesInFlight` countdown means two cmdbufs really do write to it concurrently (H1). This will require also updating the merge / tile / etc. sets to bind the per-frame static sort slot. Substantial diff.

4. **Add GPU-side serialization** as a fallback diagnostic: wrap the static depth sort dispatch in a `vkCmdPipelineBarrier(ALL_COMMANDS → ALL_COMMANDS)` to force serial execution and see if the hang goes away. If yes, the issue is GPU concurrency; if no, the issue is something else (descriptor staleness, allocation failure, etc.).

5. **Capture a Vulkan GPU dump** (RenderDoc or Xcode Frame Capture). The validation layer is the wrong tool here — it didn't catch the race in the first place. A captured frame would show the actual dispatch order and any descriptor-set staleness.

## What we shipped instead

`fix/cross-frame-ssbo-race` ships the race-fix work *up to Phase 3.5* (commit `506af492`), with Phase 3.6 reverted (`8251f05c`) and Phase 4 (`496cafc9`) cleaning up the now-obsolete static-PBD trade-off comments. The observed visual improvement vs. `origin/main`:

- Pre-branch baseline (every-other-frame blank vignette in steady-state gameplay): **gone**
- Post-Option-A + Phase 3.5 race-fix tip: **near-zero observed blanks during gameplay**. The few "blank" screenshots in the validation batch were the **WARMING UP / PREPARING SCENE** loading overlay at full swapchain resolution, not actual blank GS output.
- Long ≥1 s `vkQueueSubmit` stalls observed in pre-branch watchdog traces: not reproduced post-branch.

The residual `onesweep_status_` / `depth_onesweep_status_` race is real but apparently not visually disruptive at current dynamic-tail sizes (with Option A + dungeon-torch cap, steady-state dynamic count is ~450 k, well under both the 1 MiB `kDynamicHeadroom` and whatever buffer-size threshold makes the race observable).

If a future scene pushes the dynamic count higher, the flicker may re-emerge from this race, and this document is the entry point for fixing it then.
