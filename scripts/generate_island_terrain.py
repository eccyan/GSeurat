#!/usr/bin/env python3
"""Generate an island-shaped terrain PLY + collision grid JSON for the Seurat Island demo.

The island uses an island mask (high center, edges drop to sea level) multiplied over
rolling hills base noise, producing a naturally shaped island with varied elevation.
"""

import argparse
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ply_utils import write_ply

# Island parameters
GRID_SIZE = 64          # cells in X and Z
CELL_SIZE = 2.0         # world units per cell
ISLAND_RADIUS = 55.0    # radius for the island mask falloff
HEIGHT_SCALE = 14.0     # max height before masking (~14-18 world units)
STEP = 1.0              # Gaussian placement step (density)

# Height thresholds for coloring
COLOR_MID_THRESHOLD = 5.0
COLOR_PEAK_THRESHOLD = 12.0

# Colors
COLOR_GREEN = (0.20, 0.52, 0.12)   # low ground / grass
COLOR_BROWN = (0.48, 0.34, 0.16)   # mid elevation / dirt/rock
COLOR_GRAY  = (0.60, 0.58, 0.58)   # peaks / rocky


def lerp_color(c1, c2, t):
    """Linearly interpolate between two RGB tuples."""
    t = max(0.0, min(1.0, t))
    return (
        c1[0] + (c2[0] - c1[0]) * t,
        c1[1] + (c2[1] - c1[1]) * t,
        c1[2] + (c2[2] - c1[2]) * t,
    )


def base_hills(x, z):
    """Overlapping sine waves giving rolling hill variation."""
    return math.sin(x * 0.15) * math.cos(z * 0.12) + 0.3 * math.sin(x * 0.3 + z * 0.2)


def island_mask(x, z, cx, cz, radius):
    """Smooth radial mask: 1.0 at center, 0.0 at edges.

    Uses a squared falloff: max(0, 1 - (dist/radius)^2)
    """
    dist = math.sqrt((x - cx) ** 2 + (z - cz) ** 2)
    return max(0.0, 1.0 - (dist / radius) ** 2)


def height_at(x, z, cx, cz, height_scale, radius):
    """Compute island terrain height at world position (x, z)."""
    hills = base_hills(x, z)
    mask = island_mask(x, z, cx, cz, radius)
    return height_scale * hills * mask


def color_by_height(y):
    """Map height to color: green (low) -> brown (mid) -> gray (peaks)."""
    if y < COLOR_MID_THRESHOLD:
        t = max(0.0, y / COLOR_MID_THRESHOLD)
        return lerp_color(COLOR_GREEN, COLOR_BROWN, t)
    elif y < COLOR_PEAK_THRESHOLD:
        t = (y - COLOR_MID_THRESHOLD) / (COLOR_PEAK_THRESHOLD - COLOR_MID_THRESHOLD)
        return lerp_color(COLOR_BROWN, COLOR_GRAY, t)
    else:
        return COLOR_GRAY


def generate_island(grid_size, cell_size, height_scale, island_radius, step):
    """Generate island terrain Gaussians.

    The island is centered at (world_size/2, 0, world_size/2) so it sits
    around (64, y, 64) for a 64x64 grid with cell_size=2.
    """
    world_size = grid_size * cell_size  # 128 world units
    cx = world_size / 2.0              # 64.0
    cz = world_size / 2.0              # 64.0

    gaussians = []

    x = 0.0
    while x <= world_size:
        z = 0.0
        while z <= world_size:
            y = height_at(x, z, cx, cz, height_scale, island_radius)
            color = color_by_height(y)
            gaussians.append({
                "pos": (x, y, z),
                "color": color,
                "scale": 0.5,
                "opacity": 1.0,
            })
            z += step
        x += step

    return gaussians, cx, cz


def generate_collision_grid(grid_size, cell_size, cx, cz, height_scale, island_radius):
    """Generate collision grid data for the island.

    Returns a dict matching the CollisionGridData JSON format:
      - solid: bool per cell (true for sea / no terrain, i.e. height < 0.5)
      - elevation: float per cell Y height sampled at cell center
    """
    solid = []
    elevation = []

    for gi in range(grid_size):
        for gj in range(grid_size):
            # Sample at cell center
            x = (gi + 0.5) * cell_size
            z = (gj + 0.5) * cell_size
            y = height_at(x, z, cx, cz, height_scale, island_radius)

            elevation.append(round(y, 4))
            # Cells with negligible height are sea — treat as solid (impassable water)
            solid.append(y < 0.5)

    return {
        "width": grid_size,
        "height": grid_size,
        "cell_size": cell_size,
        "solid": solid,
        "elevation": elevation,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Generate island-shaped terrain PLY + collision grid JSON"
    )
    parser.add_argument(
        "--output",
        type=str,
        default="assets/maps/seurat_island.ply",
        help="Output PLY file path (default: assets/maps/seurat_island.ply)",
    )
    parser.add_argument(
        "--collision",
        type=str,
        default="assets/maps/seurat_island_collision.json",
        help="Output collision JSON path (default: assets/maps/seurat_island_collision.json)",
    )
    args = parser.parse_args()

    print("Generating Seurat Island terrain…")
    print(f"  Grid: {GRID_SIZE}x{GRID_SIZE} cells, cell_size={CELL_SIZE}")
    print(f"  World size: {GRID_SIZE * CELL_SIZE:.1f} x {GRID_SIZE * CELL_SIZE:.1f} units")
    print(f"  Island radius: {ISLAND_RADIUS} units")
    print(f"  Height scale: {HEIGHT_SCALE}")

    gaussians, cx, cz = generate_island(
        GRID_SIZE, CELL_SIZE, HEIGHT_SCALE, ISLAND_RADIUS, STEP
    )

    # Height stats
    heights = [g["pos"][1] for g in gaussians]
    y_min = min(heights)
    y_max = max(heights)
    above_water = sum(1 for h in heights if h >= 0.5)

    # Write PLY
    ply_path = os.path.abspath(args.output)
    os.makedirs(os.path.dirname(ply_path), exist_ok=True)
    count = write_ply(ply_path, gaussians)

    ply_size_kb = os.path.getsize(ply_path) / 1024
    print(f"\nPLY written: {ply_path}")
    print(f"  Gaussians total:       {count:,}")
    print(f"  Above water (h>=0.5):  {above_water:,}")
    print(f"  Height range: [{y_min:.2f}, {y_max:.2f}]")
    print(f"  File size: {ply_size_kb:.1f} KB")

    # Write collision grid
    collision = generate_collision_grid(
        GRID_SIZE, CELL_SIZE, cx, cz, HEIGHT_SCALE, ISLAND_RADIUS
    )

    col_path = os.path.abspath(args.collision)
    os.makedirs(os.path.dirname(col_path), exist_ok=True)
    with open(col_path, "w") as f:
        json.dump(collision, f, separators=(",", ":"))

    col_size_kb = os.path.getsize(col_path) / 1024
    solid_count = sum(collision["solid"])
    print(f"\nCollision grid written: {col_path}")
    print(f"  Cells: {collision['width']}x{collision['height']} = {GRID_SIZE * GRID_SIZE}")
    print(f"  Solid (sea) cells: {solid_count}")
    print(f"  Walkable cells:    {GRID_SIZE * GRID_SIZE - solid_count}")
    print(f"  File size: {col_size_kb:.1f} KB")

    # Verify keys
    required_keys = {"width", "height", "cell_size", "solid", "elevation"}
    missing = required_keys - set(collision.keys())
    if missing:
        print(f"\nWARNING: Collision JSON missing keys: {missing}")
    else:
        print(f"\nAll required collision JSON keys present: {sorted(required_keys)}")


if __name__ == "__main__":
    main()
