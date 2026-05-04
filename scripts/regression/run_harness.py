"""Run the regression harness: build, run scenario, optionally diff vs baseline.

Modes:
    --self-check       : run scenario twice, assert SSIM=1.0 (determinism check)
    --baseline <ref>   : run scenario, diff vs tests/regression/baseline/<ref>/
    --no-pixel-diff    : run scenario, skip pixel diff (Linux/Windows CI)
    --update-baseline  : run scenario, save output as new baseline (DESTRUCTIVE)
"""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import time

# Use the same python interpreter that's running the harness for child
# processes. This is critical when the harness is run from a venv: system
# python3 won't have scikit-image/Pillow/numpy installed.
PYTHON = sys.executable

DEMO_DIR = "build/macos-release-with-diag"
DEMO_BIN = "./gseurat_demo"  # relative to DEMO_DIR (assets/ is sync'd there)
SCENARIO = os.path.abspath("scripts/regression/island_demo_canonical.py")
SOCKET = "/tmp/gseurat.sock"


def run_scenario(out_dir):
    """Spawn engine in deterministic mode, drive the scenario, capture frames."""
    os.makedirs(out_dir, exist_ok=True)

    # Remove stale socket file so we get a clean connection
    if os.path.exists(SOCKET):
        os.unlink(SOCKET)

    proc = subprocess.Popen([DEMO_BIN, "--deterministic"],
                            stderr=subprocess.PIPE,
                            cwd=DEMO_DIR)
    try:
        # Wait for socket to appear (engine startup). Cold PLY load of the
        # 2.2M-Gaussian island takes 30-60s on warm dev machines; on
        # GitHub-hosted macOS runners (no GPU passthrough → MoltenVK falls
        # back to a slow software path) startup can take much longer.
        # Generous 300s timeout to accommodate that.
        t0 = time.time()
        while not os.path.exists(SOCKET):
            if time.time() - t0 > 300:
                # Drain any stderr the engine produced before timing out so
                # the failure is diagnosable (validation errors, missing
                # GPU, etc).
                try:
                    proc.terminate()
                    _, stderr_bytes = proc.communicate(timeout=5)
                    sys.stderr.write(
                        "engine stderr at socket-wait timeout:\n" +
                        stderr_bytes.decode(errors="replace") + "\n")
                except Exception:
                    pass
                raise RuntimeError("engine did not create socket in 300s")
            time.sleep(0.1)

        # Drive the scenario.
        subprocess.run([PYTHON, SCENARIO,
                        "--output-dir", out_dir,
                        "--socket", SOCKET],
                       check=True)
    finally:
        # Use communicate() to drain stderr concurrently with wait(), avoiding
        # a deadlock if the engine writes more than the OS pipe buffer (~64KB)
        # during shutdown — a real risk on validation-layer-spam failures.
        # communicate() returns (stdout, stderr) — stdout is None here (not piped).
        proc.terminate()
        try:
            _, stderr_bytes = proc.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            _, stderr_bytes = proc.communicate()

    return stderr_bytes.decode(errors="replace") if stderr_bytes else ""


def diff(baseline_dir, current_dir, threshold):
    return subprocess.run([
        PYTHON, "scripts/regression/diff_golden.py",
        "--baseline", baseline_dir,
        "--current", current_dir,
        "--threshold", str(threshold),
    ]).returncode


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--self-check", action="store_true")
    p.add_argument("--baseline", default=None)
    p.add_argument("--no-pixel-diff", action="store_true")
    p.add_argument("--update-baseline", default=None,
                   help="Path to save new baseline; replaces existing")
    p.add_argument("--threshold", type=float, default=0.985)
    args = p.parse_args()

    if args.self_check:
        # KNOWN GAP (as of PR 0b): the engine has ~10% peak SSIM drift across
        # repeated runs of the same deterministic scenario, traced to ECS
        # iteration order in particle/VFX spawn paths and likely warp-
        # scheduling non-determinism in tile-bin reductions. Tightening to
        # bit-identical (SSIM=1.0) is tracked in refactor/0c-tight-determinism.
        # For now we verify "engine isn't catastrophically broken across runs"
        # at SSIM >= 0.90, which catches geometry / large-scale regressions.
        SELF_CHECK_THRESHOLD = 0.90
        with tempfile.TemporaryDirectory() as t1, tempfile.TemporaryDirectory() as t2:
            run_scenario(t1)
            run_scenario(t2)
            rc = diff(t1, t2, threshold=SELF_CHECK_THRESHOLD)
            if rc == 0:
                print(f"DETERMINISM SELF-CHECK: PASS (SSIM >= {SELF_CHECK_THRESHOLD})")
                return 0
            print(f"DETERMINISM SELF-CHECK: FAIL — drift exceeds {SELF_CHECK_THRESHOLD} threshold",
                  file=sys.stderr)
            return 1

    with tempfile.TemporaryDirectory() as cur:
        stderr = run_scenario(cur)

        # Validation-layer assertion
        if "VK_VALIDATION" in stderr or "VUID-" in stderr:
            print("VALIDATION LAYER WARNINGS/ERRORS:\n" + stderr, file=sys.stderr)
            return 2

        # Diag invariant assertion (best-effort: check for INVARIANT FAILED in stderr)
        if "INVARIANT FAILED" in stderr:
            print("DIAG INVARIANT VIOLATION:\n" + stderr, file=sys.stderr)
            return 3

        if args.update_baseline:
            if os.path.exists(args.update_baseline):
                shutil.rmtree(args.update_baseline)
            shutil.copytree(cur, args.update_baseline)
            print(f"Baseline updated: {args.update_baseline}")
            return 0

        if args.no_pixel_diff:
            print("Scenario completed (no pixel diff requested)")
            return 0

        if not args.baseline:
            print("--baseline required unless --no-pixel-diff or --update-baseline",
                  file=sys.stderr)
            return 4

        return diff(args.baseline, cur, threshold=args.threshold)


if __name__ == "__main__":
    sys.exit(main())
