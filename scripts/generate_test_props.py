#!/usr/bin/env python3
"""Generate prop PLY files (tree, rock, house) for GSeurat 3DGS engine testing."""

import argparse
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ply_utils import write_ply


def generate_tree(seed=42):
    """Generate a tree: brown trunk cylinder + green canopy sphere."""
    rng = random.Random(seed)
    gaussians = []

    # Trunk: cylinder, radius 0.5, height 3-6, center at origin
    trunk_height = 5.0
    trunk_radius = 0.5
    trunk_color = (0.4, 0.25, 0.1)

    for y_i in range(int(trunk_height * 4)):  # 4 Gaussians per unit height
        y = y_i * 0.25
        for angle_i in range(8):
            angle = angle_i * math.pi / 4.0
            r = trunk_radius * (0.8 + rng.random() * 0.4)
            x = r * math.cos(angle)
            z = r * math.sin(angle)
            gaussians.append({
                "pos": (x, y, z),
                "color": trunk_color,
                "scale": 0.3,
                "opacity": 1.0,
            })

    # Canopy: sphere of green Gaussians, radius 2.5, center at (0, 6, 0)
    canopy_center_y = 6.0
    canopy_radius = 2.5

    for _ in range(250):
        # Random point in sphere using rejection sampling
        while True:
            dx = rng.uniform(-1, 1)
            dy = rng.uniform(-1, 1)
            dz = rng.uniform(-1, 1)
            if dx * dx + dy * dy + dz * dz <= 1.0:
                break
        x = dx * canopy_radius
        y = canopy_center_y + dy * canopy_radius
        z = dz * canopy_radius

        color = (
            0.2 + rng.random() * 0.15,
            0.5 + rng.random() * 0.2,
            0.1 + rng.random() * 0.1,
        )
        gaussians.append({
            "pos": (x, y, z),
            "color": color,
            "scale": 0.4,
            "opacity": 1.0,
        })

    return gaussians


def generate_rock(seed=123):
    """Generate an irregular ellipsoid rock."""
    rng = random.Random(seed)
    gaussians = []

    radius_x = 1.5
    radius_y = 1.0
    radius_z = 1.3

    for _ in range(150):
        # Random point in ellipsoid using rejection sampling
        while True:
            dx = rng.uniform(-1, 1)
            dy = rng.uniform(-1, 1)
            dz = rng.uniform(-1, 1)
            if dx * dx + dy * dy + dz * dz <= 1.0:
                break

        # Apply ellipsoid radii + random displacement for irregularity
        x = dx * radius_x + rng.uniform(-0.15, 0.15)
        y = dy * radius_y + rng.uniform(-0.15, 0.15)
        z = dz * radius_z + rng.uniform(-0.15, 0.15)

        # Gray with slight variation
        base = 0.4 + rng.random() * 0.1
        color = (base, base, base - 0.05 + rng.random() * 0.1)
        color = tuple(max(0.0, min(1.0, c)) for c in color)

        gaussians.append({
            "pos": (x, y, z),
            "color": color,
            "scale": 0.35,
            "opacity": 1.0,
        })

    return gaussians


def generate_house(seed=456):
    """Generate a simple house: box walls + triangular roof + door + windows."""
    rng = random.Random(seed)
    gaussians = []

    # Dimensions: 6 wide (x), 5 deep (z), 4 tall (y) walls
    w, d, h = 6.0, 5.0, 4.0
    wall_color = (0.85, 0.8, 0.7)
    roof_color = (0.6, 0.25, 0.15)
    door_color = (0.3, 0.2, 0.15)
    window_color = (0.5, 0.55, 0.7)
    spacing = 0.5

    # Helper to check if a position is a door or window
    def is_door(x, y):
        """Door on front face: centered, 1.5 wide, 2.5 tall."""
        return abs(x - w / 2) < 0.75 and y < 2.5

    def is_window(x, y, face):
        """Windows on front and side faces."""
        if face == "front":
            # Two windows flanking the door
            return (1.0 < y < 2.5) and (abs(x - 1.5) < 0.5 or abs(x - 4.5) < 0.5)
        elif face == "side":
            return (1.0 < y < 2.5) and abs(x - w / 2) < 0.75
        return False

    # Front wall (z = 0)
    x = 0.0
    while x <= w:
        y = 0.0
        while y <= h:
            if is_door(x, y):
                color = door_color
            elif is_window(x, y, "front"):
                color = window_color
            else:
                color = wall_color
            gaussians.append({"pos": (x, y, 0.0), "color": color, "scale": 0.35, "opacity": 1.0})
            y += spacing
        x += spacing

    # Back wall (z = d)
    x = 0.0
    while x <= w:
        y = 0.0
        while y <= h:
            gaussians.append({"pos": (x, y, d), "color": wall_color, "scale": 0.35, "opacity": 1.0})
            y += spacing
        x += spacing

    # Left wall (x = 0)
    z = spacing
    while z < d:
        y = 0.0
        while y <= h:
            if is_window(z, y, "side"):
                color = window_color
            else:
                color = wall_color
            gaussians.append({"pos": (0.0, y, z), "color": color, "scale": 0.35, "opacity": 1.0})
            y += spacing
        z += spacing

    # Right wall (x = w)
    z = spacing
    while z < d:
        y = 0.0
        while y <= h:
            if is_window(z, y, "side"):
                color = window_color
            else:
                color = wall_color
            gaussians.append({"pos": (w, y, z), "color": color, "scale": 0.35, "opacity": 1.0})
            y += spacing
        z += spacing

    # Roof: triangular prism, peak at y = h + 2, ridge along z axis
    roof_peak = h + 2.0
    x = 0.0
    while x <= w:
        z = -0.3
        while z <= d + 0.3:
            # Two slopes: left and right of center
            center_x = w / 2.0
            dist = abs(x - center_x)
            slope_height = h + (1.0 - dist / (w / 2.0)) * 2.0

            if dist <= w / 2.0:
                noise_y = rng.uniform(-0.05, 0.05)
                gaussians.append({
                    "pos": (x, slope_height + noise_y, z),
                    "color": roof_color,
                    "scale": 0.35,
                    "opacity": 1.0,
                })
            z += spacing
        x += spacing

    return gaussians


def main():
    parser = argparse.ArgumentParser(description="Generate prop PLY files")
    parser.add_argument("--output-dir", type=str, default="assets/props",
                        help="Output directory for prop PLY files")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)

    props = [
        ("tree.ply", generate_tree, "Tree"),
        ("rock.ply", generate_rock, "Rock"),
        ("house.ply", generate_house, "House"),
    ]

    for filename, generator, name in props:
        path = os.path.join(args.output_dir, filename)
        gaussians = generator()
        count = write_ply(path, gaussians)
        print(f"{name}: {path} ({count} Gaussians)")

    print(f"\nAll props written to {args.output_dir}/")


if __name__ == "__main__":
    main()
