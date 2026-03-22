#!/usr/bin/env python3
"""Generate a rolling hills terrain PLY for GSeurat 3DGS engine testing."""

import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ply_utils import write_ply


def lerp_color(c1, c2, t):
    """Linearly interpolate between two RGB tuples."""
    t = max(0.0, min(1.0, t))
    return (
        c1[0] + (c2[0] - c1[0]) * t,
        c1[1] + (c2[1] - c1[1]) * t,
        c1[2] + (c2[2] - c1[2]) * t,
    )


def height_at(x, z, height_scale):
    """Compute terrain height from overlapping sine waves."""
    return height_scale * (
        math.sin(x * 0.15) * math.cos(z * 0.12)
        + 0.3 * math.sin(x * 0.3 + z * 0.2)
    )


def color_by_height(y, y_min, y_max):
    """Map height to color: green (low) -> brown (mid) -> white (top)."""
    if y_max == y_min:
        t = 0.5
    else:
        t = (y - y_min) / (y_max - y_min)

    green = (0.2, 0.5, 0.1)
    brown = (0.5, 0.35, 0.15)
    white = (0.9, 0.9, 0.85)

    if t < 0.5:
        return lerp_color(green, brown, t * 2.0)
    else:
        return lerp_color(brown, white, (t - 0.5) * 2.0)


def generate_terrain(width, depth, height_scale, density):
    """Generate terrain Gaussians."""
    gaussians = []

    # Determine step size based on density
    step = 1.0 if density <= 1.0 else 0.5

    # First pass: compute height range for coloring
    y_min = float("inf")
    y_max = float("-inf")
    x = 0.0
    while x < width:
        z = 0.0
        while z < depth:
            y = height_at(x, z, height_scale)
            y_min = min(y_min, y)
            y_max = max(y_max, y)
            z += step
        x += step

    # Second pass: generate Gaussians
    x = 0.0
    while x < width:
        z = 0.0
        while z < depth:
            y = height_at(x, z, height_scale)
            color = color_by_height(y, y_min, y_max)
            gaussians.append({
                "pos": (x, y, z),
                "color": color,
                "scale": 0.5,
                "opacity": 1.0,
            })
            z += step
        x += step

    return gaussians, y_min, y_max


def main():
    parser = argparse.ArgumentParser(description="Generate rolling hills terrain PLY")
    parser.add_argument("--width", type=int, default=64, help="Terrain width in units")
    parser.add_argument("--depth", type=int, default=64, help="Terrain depth in units")
    parser.add_argument("--height-scale", type=float, default=10.0, help="Height multiplier")
    parser.add_argument("--density", type=float, default=1.0,
                        help="Gaussian density (>1 adds intermediate positions)")
    parser.add_argument("--output", type=str, default="assets/maps/test_terrain.ply",
                        help="Output PLY file path")
    args = parser.parse_args()

    gaussians, y_min, y_max = generate_terrain(
        args.width, args.depth, args.height_scale, args.density
    )

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    count = write_ply(args.output, gaussians)

    print(f"Terrain generated: {args.output}")
    print(f"  Grid: {args.width} x {args.depth}")
    print(f"  Height range: [{y_min:.2f}, {y_max:.2f}]")
    print(f"  Gaussian count: {count}")
    print(f"  Density: {args.density}")


if __name__ == "__main__":
    main()
