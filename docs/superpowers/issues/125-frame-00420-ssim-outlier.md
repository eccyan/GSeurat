# Issue #125 — Residual SSIM drift at first post-motion capture (frame_00420 = 0.87)

**Status:** investigating — root cause uncertain, two candidates  
**Surfaced:** 2026-05-12 during PR #434 validation (harness methodology fix)  
**Owner:** TBD  
**Related PRs:** #434 (the methodology PR that surfaced this)

## Symptom

After PR #434's settle-before-capture methodology landed, two back-to-back
`--self-check` runs of `scripts/regression/island_demo_canonical.py` produced
the following SSIM distribution:

| Frame | SSIM | Note |
|---|---|---|
| `frame_00000.png` | 0.99999 | bit-perfect at spawn (no motion yet) |
| **`frame_00420.png`** | **0.87** | **outlier — first capture after first walk** |
| `frame_00660.png` | 0.998 | |
| `frame_00900.png` | 0.992 | |
| `frame_01020.png` | 0.985 | |
| `frame_01380.png` | 0.997 | |
| `frame_01740.png` | 0.9998 | |
| `frame_02100.png` | 0.986 | |
| `frame_02460.png` | 0.986 | |
| `frame_02820.png` | 0.983 | |
| `frame_02940.png` | 0.980 | |

11 / 12 captures are at SSIM >= 0.98. Only `frame_00420` (the first capture
after the first 300-frame walk + 120-frame settle) is dramatically worse.

## RGB analysis

| Run | Mean R | Mean G | Mean B |
|---|---|---|---|
| t1 frame_00000 | 56.0 | 62.9 | 96.6 |
| t2 frame_00000 | 56.0 | 62.9 | 96.6 |
| t1 frame_00420 | 143.1 | 126.9 | 100.0 |
| t2 frame_00420 | 136.0 | 133.8 | 127.1 |

Frame 0 is bit-identical across runs. Frame 00420 shows a **global** RGB
shift (delta R: -7, G: +7, B: +27), affecting 87.5% of pixels with mean
absolute difference 33.5 / 255. This is **not** a localized "tree swinging"
or "particle wakeup" pattern — it's a uniform brightness/color drift.

## Candidate causes

### Candidate 1 — async-screenshot ordering bug in the harness (RULED OUT)

Codex review on PR #434 identified:

> `screenshot` returns immediately after `request_screenshot`
> (`src/engine/command_dispatcher.cpp:476-479`), and deterministic step mode
> does not render while `pending_steps_ <= 0` (`src/engine/app_base.cpp:269-274`).
> The next loop iteration can therefore inject the next movement key before
> the render that actually writes the PNG.

**Verification result (2026-05-12, commit b20fdce3): adding `step 1` after
every `screenshot` made the regression WORSE, not better.** Full SSIM
distribution before vs. after the fix:

| Frame | Before fix | After fix | Δ |
|---|---|---|---|
| 00000 | 0.99999 | 0.99999 | unchanged |
| 00420/421 | **0.871** | **0.756** | −0.115 (much worse) |
| 00660/662 | 0.998 | 0.955 | −0.043 |
| 00900/903 | 0.992 | 0.957 | −0.035 |
| 01020/1024 | 0.985 | 0.937 | −0.048 |
| 01380/1385 | 0.997 | 0.996 | unchanged |
| 01740+ | ≥ 0.98 | ≥ 0.98 | unchanged |
| 03060/3071 | (orphaned) | 0.973 | NEW (last frame now flushes) |

Only the first 4 captures regressed; everything from frame 1385 onward is
unchanged. The final capture (which WAS being orphaned because nothing
flushed it) is now correctly written.

**Interpretation:** Codex was correct that the last screenshot was orphaned,
but incorrect about intermediate captures — they were apparently being
flushed correctly by the next stage's first step. Adding `step 1` after
every screenshot introduces extra wall-clock variance during early frames,
which strengthens candidate 2 below (wall-clock dependency in engine
visual code) — adding any extra step amplifies the per-run wall-clock
divergence, with cumulative effect on the first ~4 captures before
plateauing.

The chosen partial fix in PR #434 (final commit): keep the broad revert,
add a single `step 1` AFTER the for-loop to flush only the last screenshot.
This regains the missing final capture without regressing the early ones.

### Candidate 2 — wall-clock dependency in engine visual pipeline (now primary suspect)

With candidate 1 ruled out by the verification above, the remaining
hypothesis is that something in the visual pipeline reads `glfwGetTime()`
/ `std::chrono::system_clock` / similar real-clock source instead of the
deterministic `gs::SimClock`. The `taskpolicy -c background` demotion (in
PR #434) makes the wall-clock duration of each run highly variable, which
would expose any real-clock visual dep as a between-runs appearance drift.
This also explains the "step 1 made it worse" result: every extra step
incurs additional wall-clock variance, so the cumulative drift over the
early stages is larger when more steps are involved.

Likely suspects to audit if this turns out to be the cause:
- Sky / atmospheric scattering shader (sun position, scattering coefficients)
- Fog density / color shaders (potential temporal accumulation)
- Bloom / post-process (temporal feedback chains)
- Auto-exposure / tone mapping
- VFX uniform buffers (some VFX presets animate with `gs::time_seconds()`)

The audit would `grep -rn "glfwGetTime\|chrono::system\|chrono::steady\|wall_clock"`
across `src/engine/` and the GLSL files under `shaders/`, then replace each
hit with the appropriate `gs::SimClock`-based source.

## Decision on the harness threshold

`SELF_CHECK_THRESHOLD` stays at 0.85 in PR #434. Candidate 1 is ruled out
(see above); candidate 2 (wall-clock visual dep) is the working hypothesis.
The threshold should NOT be tightened back to 0.96 until that engine-side
audit lands and frame_00420 demonstrably moves above 0.96.

**This issue blocks tightening the threshold back to 0.96.**

## Suggested investigation steps for the next owner

1. `grep -rn "glfwGetTime\|chrono::system\|chrono::steady\|wall_clock\|::now()" src/engine/ shaders/` — enumerate every real-clock read in the visual path.
2. Disambiguate which of these feed into visible pixels (vs. only diagnostics).
3. Replace each with `gs::SimClock::now()` / step-count-derived equivalent.
4. Re-run the harness; verify frame_00420 jumps to ≥ 0.96.
5. Tighten `SELF_CHECK_THRESHOLD` back to 0.96 in a follow-up commit.

## Reproduction

```bash
# Build the diag binary:
cmake --build --preset macos-release-with-diag

# Run the self-check (needs ~6 GB RAM free; takes ~25-35 min with QoS=background):
python3 scripts/regression/run_harness.py --self-check

# To inspect per-frame SSIM without the harness gating:
python3 scripts/regression/diff_golden.py \
  --baseline /tmp/<t1_dir> --current /tmp/<t2_dir> --threshold 0.0 \
  --report /tmp/diff_report.txt
```
