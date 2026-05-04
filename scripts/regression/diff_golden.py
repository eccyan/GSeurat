"""SSIM diff between two directories of PNG frames.

Usage:
    python3 scripts/regression/diff_golden.py \
        --baseline tests/regression/baseline/<commit>/ \
        --current tests/regression/current/ \
        --threshold 0.985
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image

# scikit-image required for SSIM. Install via: pip install scikit-image
from skimage.metrics import structural_similarity as ssim


def load_rgb(path):
    img = Image.open(path).convert("RGB")
    return np.asarray(img, dtype=np.float32) / 255.0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--current", required=True)
    parser.add_argument("--threshold", type=float, default=0.985)
    parser.add_argument("--report", default=None)
    args = parser.parse_args()

    baseline_files = sorted(f for f in os.listdir(args.baseline) if f.endswith(".png"))
    current_files = sorted(f for f in os.listdir(args.current) if f.endswith(".png"))

    if baseline_files != current_files:
        print(f"FAIL: file set mismatch.\n  baseline: {baseline_files}\n  current: {current_files}",
              file=sys.stderr)
        return 2

    failures = []
    report_lines = []
    for fname in baseline_files:
        b = load_rgb(os.path.join(args.baseline, fname))
        c = load_rgb(os.path.join(args.current, fname))
        if b.shape != c.shape:
            failures.append((fname, "shape mismatch", b.shape, c.shape))
            continue
        score = ssim(b, c, channel_axis=2, data_range=1.0)
        report_lines.append(f"{fname}: SSIM={score:.6f}")
        if score < args.threshold:
            failures.append((fname, "ssim_low", score, args.threshold))

    if args.report:
        with open(args.report, "w") as fh:
            fh.write("\n".join(report_lines) + "\n")
            if failures:
                fh.write("\nFAILURES:\n")
                for f in failures:
                    fh.write(f"  {f}\n")

    if failures:
        for f in failures:
            print(f"FAIL: {f}", file=sys.stderr)
        return 1

    print("\n".join(report_lines))
    print(f"PASS ({len(baseline_files)} frames >= {args.threshold})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
