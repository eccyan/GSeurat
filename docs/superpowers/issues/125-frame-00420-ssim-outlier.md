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

### Candidate 1 — async-screenshot ordering bug in the harness (most likely)

Codex review on PR #434 identified:

> `screenshot` returns immediately after `request_screenshot`
> (`src/engine/command_dispatcher.cpp:476-479`), and deterministic step mode
> does not render while `pending_steps_ <= 0` (`src/engine/app_base.cpp:269-274`).
> The next loop iteration can therefore inject the next movement key before
> the render that actually writes the PNG.

If this is the cause, `frame_00420` is being captured during the FIRST frame
of the next walk stage, not at the settled stationary state. The RGB shift
would reflect the player+camera moving (different occlusion, different lit
surfaces) on that one mid-walk frame.

**Verification:** PR #434 adds a `step 1` after every `screenshot` to flush
the queued render before the next `inject_key`. If after that fix
`frame_00420` jumps from 0.87 to >= 0.96, this candidate is confirmed and
this issue can be closed.

### Candidate 2 — wall-clock dependency in engine visual pipeline (fallback)

If candidate 1 is NOT the cause, the next hypothesis is that something in
the visual pipeline reads `glfwGetTime()` / `std::chrono::system_clock` /
similar real-clock source instead of the deterministic `gs::SimClock`. The
`taskpolicy -c background` demotion (also in PR #434) makes the wall-clock
duration of each run highly variable, which would expose any real-clock
visual dep as a between-runs appearance drift.

Likely suspects to audit if this turns out to be the cause:
- Sky / atmospheric scattering shader (sun position, scattering coefficients)
- Fog density / color shaders (potential temporal accumulation)
- Bloom / post-process (temporal feedback chains)
- Auto-exposure / tone mapping
- VFX uniform buffers (some VFX presets animate with `gs::time_seconds()`)

The audit would `grep -rn "glfwGetTime\|chrono::system\|chrono::steady\|wall_clock"`
across `src/engine/` and the GLSL files under `shaders/`, then replace each
hit with the appropriate `gs::SimClock`-based source.

## Decision on the harness threshold (interim)

`SELF_CHECK_THRESHOLD` is dropped from 0.96 to 0.85 in PR #434 as a stopgap.
Once candidate 1 is verified (by re-running `--self-check` with the
screenshot-flush fix), the threshold should tighten back to **0.96** (or
whatever the genuine noise floor turns out to be). If candidate 1 is NOT
the cause and we have to investigate candidate 2, the threshold stays at
0.85 until the engine audit lands.

**This issue blocks tightening the threshold back to 0.96.**

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
