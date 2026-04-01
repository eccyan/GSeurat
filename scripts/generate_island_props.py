#!/usr/bin/env python3
"""Generate prop PLY files for the Seurat Island demo scene.

Generates individual PLY files for trees, rocks, and a house placed at
specific world positions, plus a manifest JSON for scene placement.
"""

import argparse
import json
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


# Island prop layout (384x384 world, center at 192, 192)
# Trees spread across the larger island
TREE_POSITIONS = [
    [120, 0, 150], [200, 0, 130], [160, 0, 220],
    [220, 0, 180], [140, 0, 100], [250, 0, 160],
    [180, 0, 250], [130, 0, 200], [210, 0, 240],
    [170, 0, 140], [240, 0, 200], [150, 0, 170],
]

# Rocks at slope positions
ROCK_POSITIONS = [
    [150, 0, 110], [230, 0, 170], [130, 0, 210],
    [200, 0, 100], [170, 0, 260], [260, 0, 190],
]

# House near center on flat ground
HOUSE_POSITION = [192, 0, 175]

# Flowers scattered across the island
FLOWER_POSITIONS = [
    [160, 0, 160], [200, 0, 200], [180, 0, 130],
    [220, 0, 150], [140, 0, 180], [190, 0, 230],
    [170, 0, 190], [210, 0, 170],
]

# Crystals at special locations
CRYSTAL_POSITIONS = [
    [155, 0, 145], [225, 0, 195], [175, 0, 235], [195, 0, 120],
]


def main():
    parser = argparse.ArgumentParser(
        description="Generate island prop PLY files for the Seurat Island demo scene."
    )
    parser.add_argument(
        "--output-dir", type=str, default="assets/props",
        help="Output directory for prop PLY files (default: assets/props)"
    )
    parser.add_argument(
        "--manifest", type=str, default="assets/props/island_manifest.json",
        help="Output path for manifest JSON (default: assets/props/island_manifest.json)"
    )
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    os.makedirs(os.path.dirname(os.path.abspath(args.manifest)), exist_ok=True)

    manifest = []
    total_gaussians = 0

    # --- Trees ---
    # Use per-tree seeds so each tree looks distinct.
    tree_seeds = [42, 137, 251, 389, 503, 617, 733, 841, 953, 1061, 1173, 1289]
    # Pre-determined rotation and scale variations per tree (seeded for reproducibility).
    tree_meta_rng = random.Random(1001)
    for i, pos in enumerate(TREE_POSITIONS):
        tree_id = i + 1
        filename = f"island_tree_{tree_id}.ply"
        ply_path = os.path.join(args.output_dir, filename)

        gaussians = generate_tree(seed=tree_seeds[i])
        count = write_ply(ply_path, gaussians)
        total_gaussians += count

        rotation_y = round(tree_meta_rng.uniform(0, 360), 1)
        scale = round(tree_meta_rng.uniform(1.5, 2.5), 2)  # 12-21u tall (2-3x 6.5u character)

        manifest.append({
            "id": f"tree_{tree_id}",
            "name": "Tree",
            "ply_file": f"assets/props/{filename}",
            "position": pos,
            "rotation": [0, rotation_y, 0],
            "scale": scale,
        })
        print(f"Tree {tree_id}: {ply_path} ({count} Gaussians, rot_y={rotation_y}, scale={scale})")

    # --- Rocks ---
    rock_seeds = [123, 217, 344, 461, 578, 692]
    rock_meta_rng = random.Random(2002)
    for i, pos in enumerate(ROCK_POSITIONS):
        rock_id = i + 1
        filename = f"island_rock_{rock_id}.ply"
        ply_path = os.path.join(args.output_dir, filename)

        gaussians = generate_rock(seed=rock_seeds[i])
        count = write_ply(ply_path, gaussians)
        total_gaussians += count

        rotation_y = round(rock_meta_rng.uniform(0, 360), 1)
        scale = round(rock_meta_rng.uniform(1.5, 2.5), 2)  # 2-4u tall (~half character)

        manifest.append({
            "id": f"rock_{rock_id}",
            "name": "Rock",
            "ply_file": f"assets/props/{filename}",
            "position": pos,
            "rotation": [0, rotation_y, 0],
            "scale": scale,
        })
        print(f"Rock {rock_id}: {ply_path} ({count} Gaussians, rot_y={rotation_y}, scale={scale})")

    # --- House ---
    filename = "island_house1.ply"
    ply_path = os.path.join(args.output_dir, filename)

    gaussians = generate_house(seed=456)
    count = write_ply(ply_path, gaussians)
    total_gaussians += count

    manifest.append({
        "id": "house",
        "name": "House",
        "ply_file": f"assets/props/{filename}",
        "position": HOUSE_POSITION,
        "rotation": [0, 0, 0],
        "scale": 2.5,  # house ~10u tall (1.5x character)
    })
    print(f"House: {ply_path} ({count} Gaussians)")

    # --- Flowers ---
    flower_meta_rng = random.Random(3003)
    for i, pos in enumerate(FLOWER_POSITIONS):
        flower_id = i + 1
        rotation_y = round(flower_meta_rng.uniform(0, 360), 1)
        scale = round(flower_meta_rng.uniform(0.1, 0.2), 2)

        manifest.append({
            "id": f"flower_{flower_id}",
            "name": "Flower",
            "ply_file": "assets/props/island_flower1.ply",
            "position": pos,
            "rotation": [0, rotation_y, 0],
            "scale": scale,
        })
        print(f"Flower {flower_id}: island_flower1.ply (rot_y={rotation_y}, scale={scale})")

    # --- Crystals ---
    crystal_meta_rng = random.Random(4004)
    for i, pos in enumerate(CRYSTAL_POSITIONS):
        crystal_id = i + 1
        rotation_y = round(crystal_meta_rng.uniform(0, 360), 1)
        scale = round(crystal_meta_rng.uniform(1.0, 1.8), 2)

        manifest.append({
            "id": f"crystal_{crystal_id}",
            "name": "Crystal",
            "ply_file": "assets/props/island_crystal1.ply",
            "position": pos,
            "rotation": [0, rotation_y, 0],
            "scale": scale,
        })
        print(f"Crystal {crystal_id}: island_crystal1.ply (rot_y={rotation_y}, scale={scale})")

    # --- Manifest ---
    manifest_path = os.path.abspath(args.manifest)
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"\nManifest: {manifest_path} ({len(manifest)} entries)")
    print(f"Total: {len(manifest)} props, {total_gaussians} Gaussians")


if __name__ == "__main__":
    main()
