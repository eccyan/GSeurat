#!/usr/bin/env python3
"""Generate an island-shaped terrain PLY + collision grid JSON for the Seurat Island demo.

The island uses an island mask (high center, edges drop to sea level) multiplied over
rolling hills base noise, producing a naturally shaped island with varied elevation.
"""

import argparse
import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ply_utils import write_ply

# Island parameters
GRID_SIZE = 192         # cells in X and Z
CELL_SIZE = 2.0         # world units per cell
ISLAND_RADIUS = 170.0   # radius for the island mask falloff
HEIGHT_SCALE = 6.0      # flatter for more walkable area
STEP = 0.3              # maximum density — seamless ground surface

# Height thresholds for coloring
COLOR_MID_THRESHOLD = 3.0
COLOR_PEAK_THRESHOLD = 6.5

# Colors — saturated for SNES-like vibrancy
COLOR_GREEN = (0.15, 0.58, 0.08)   # low ground / vivid grass
COLOR_BROWN = (0.55, 0.35, 0.12)   # mid elevation / warm earth
COLOR_GRAY  = (0.65, 0.60, 0.55)   # peaks / warm stone


def lerp_color(c1, c2, t):
    """Linearly interpolate between two RGB tuples."""
    t = max(0.0, min(1.0, t))
    return (
        c1[0] + (c2[0] - c1[0]) * t,
        c1[1] + (c2[1] - c1[1]) * t,
        c1[2] + (c2[2] - c1[2]) * t,
    )


def base_hills(x, z):
    """Rolling hill variation — always positive (no underwater valleys)."""
    # Base dome: always 0.5+ so island is continuous
    hills = 0.5 + 0.3 * math.sin(x * 0.08) * math.cos(z * 0.06)
    hills += 0.15 * math.sin(x * 0.15 + z * 0.1)
    hills += 0.05 * math.sin(x * 0.25 - z * 0.2)
    return hills


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

    _terrain_rng = random.Random(42)

    gaussians = []

    x = 0.0
    while x <= world_size:
        z = 0.0
        while z <= world_size:
            y = height_at(x, z, cx, cz, height_scale, island_radius)
            color = color_by_height(y)
            noise = _terrain_rng.uniform(-0.08, 0.08)
            color = (
                max(0.0, min(1.0, color[0] + noise + _terrain_rng.uniform(-0.03, 0.03))),
                max(0.0, min(1.0, color[1] + noise + _terrain_rng.uniform(-0.03, 0.03))),
                max(0.0, min(1.0, color[2] + noise * 0.5)),
            )
            gaussians.append({
                "pos": (x, y, z),
                "color": color,
                "scale": 0.35,
                "opacity": 1.0,
            })
            z += step
        x += step

    # Volumetric water: 3 stacked layers with varying color/opacity for depth
    water_layers = [
        {"y": -0.5, "color": (0.05, 0.12, 0.35), "opacity": 0.9, "scale": 1.5, "step": 2.5},   # deep
        {"y": -0.1, "color": (0.12, 0.25, 0.50), "opacity": 0.7, "scale": 1.3, "step": 2.5},   # mid
        {"y":  0.2, "color": (0.20, 0.40, 0.55), "opacity": 0.5, "scale": 1.1, "step": 3.0},   # surface
    ]
    # Shore shallows: greenish tint near coastline
    shore_layer = {"y": 0.1, "color": (0.15, 0.40, 0.35), "opacity": 0.4, "scale": 0.8, "step": 2.0}

    for layer in water_layers:
        wx = 0.0
        while wx <= world_size:
            wz = 0.0
            while wz <= world_size:
                terrain_y = height_at(wx, wz, cx, cz, height_scale, island_radius)
                if terrain_y < 0.5:
                    gaussians.append({
                        "pos": (wx, layer["y"], wz),
                        "color": layer["color"],
                        "scale": layer["scale"],
                        "opacity": layer["opacity"],
                    })
                wz += layer["step"]
            wx += layer["step"]

    # Shore shallows (only near coastline: terrain between 0.0 and 2.0)
    wx = 0.0
    while wx <= world_size:
        wz = 0.0
        while wz <= world_size:
            terrain_y = height_at(wx, wz, cx, cz, height_scale, island_radius)
            if 0.0 < terrain_y < 2.0:
                gaussians.append({
                    "pos": (wx, shore_layer["y"], wz),
                    "color": shore_layer["color"],
                    "scale": shore_layer["scale"],
                    "opacity": shore_layer["opacity"],
                })
            wz += shore_layer["step"]
        wx += shore_layer["step"]

    # Specular highlights on water surface (sparse bright spots)
    import random as _rng
    _rng.seed(777)
    spec_count = 0
    sx = 0.0
    while sx <= world_size:
        sz = 0.0
        while sz <= world_size:
            terrain_y = height_at(sx, sz, cx, cz, height_scale, island_radius)
            if terrain_y < 0.3 and _rng.random() < 0.15:
                gaussians.append({
                    "pos": (sx + _rng.uniform(-1, 1), 0.3 + _rng.uniform(0, 0.2), sz + _rng.uniform(-1, 1)),
                    "color": (0.8, 0.85, 0.95),
                    "scale": 0.4,
                    "opacity": 0.6,
                    "emission": 1.5,
                })
                spec_count += 1
            sz += 5.0
        sx += 5.0

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
            # Use low threshold (0.2) so more coastal area is walkable
            solid.append(y < 0.3)  # water/low shore is solid — keeps player on the island

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
