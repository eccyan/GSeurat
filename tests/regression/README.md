# Regression Harness

The regression harness runs a canonical 60-second walkthrough of `island_demo` in deterministic mode and compares 12 captured frames against a baseline using SSIM diff.

**Hard requirement:** the engine MUST be built with `--preset macos-release-with-diag` (or another `GSEURAT_DEBUG_FORCE=ON` preset) so validation layers and diagnostic tiers are active. Pixel diff runs on macOS only because floating-point rasterization differs across MoltenVK / Lavapipe / AMD / Intel.

**Python deps:** `scikit-image>=0.19`, `Pillow>=10`, `numpy>=1.24`. Recommended setup: a venv to avoid clobbering system Python.

```bash
python3 -m venv .venv-regression
.venv-regression/bin/pip install "scikit-image>=0.19,<1.0" "Pillow>=10,<12" "numpy>=1.24,<3"
# Then drive the harness via .venv-regression/bin/python (NOT system python3).
```

## Running locally

```bash
# Self-check determinism (run scenario twice, assert SSIM >= 0.90)
.venv-regression/bin/python scripts/regression/run_harness.py --self-check

# Full regression diff vs baseline (catches real visual regressions)
.venv-regression/bin/python scripts/regression/run_harness.py \
    --baseline tests/regression/baseline/main \
    --threshold 0.985
```

## Known gap: drift floor (PR 0b)

The engine has ~10% peak SSIM drift across repeated runs of the same deterministic scenario, traced to:

1. **ECS iteration order** in particle/VFX spawn paths (insertion-ordered components iterate in alloc-address order, which varies across runs).
2. **Warp scheduling non-determinism** in tile-bin / depth-sort reductions on the GPU.
3. **Audio thread interactions** if zone events trigger rendering changes.

Until these are addressed (tracked in `refactor/0c-tight-determinism`):

- **Self-check** uses `SSIM >= 0.90` — verifies the engine isn't catastrophically broken across runs, but tolerates the natural drift floor.
- **Baseline diff** keeps `SSIM >= 0.985` per spec — meaning **CI baseline-diff runs on PR 0b will report failures on drift-affected frames**. This is expected and acceptable for the harness's bring-up phase. Real regressions of >1.5% magnitude still surface; sub-drift-floor regressions are missed (and would have been masked by the drift anyway).

After `refactor/0c-tight-determinism` lands, both thresholds tighten back toward 1.0 / 0.985 respectively.

## When tests fail

1. **SSIM < threshold:** inspect `tests/regression/diff/` for the failing frames. If the change is intentional (e.g., a deliberate visual change), update the baseline.
2. **Determinism self-check fails (>10% drift):** something new in the engine reads wall-clock time or unseeded RNG. Audit recent changes to `src/engine/` and `include/gseurat/engine/` for `std::random_device`, `std::chrono::*::now`, or other entropy sources.
3. **Validation layer warnings:** the harness fails if stderr contains `VK_VALIDATION` or `VUID-` strings. Address the layer warning before merging.

## Updating the baseline

Only update when shipping intentional visual changes:

```bash
python3 scripts/regression/run_harness.py --update-baseline tests/regression/baseline/main
git add tests/regression/baseline/main/
git commit -m "test(regression): update baseline for <reason>"
```

Always commit baseline updates in a separate PR, never alongside refactor/feature changes.

## Adding a frame to the baseline

Edit `scripts/regression/island_demo_canonical.py`: add a frame number to `CAPTURE_FRAMES`. Update the baseline.
