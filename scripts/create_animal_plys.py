#!/usr/bin/env python3
"""Generate dense voxel animal PLY files (~10K gaussians each) for the northern forest.

Each animal is built from shaped volumes filled with small gaussians at
sub-voxel spacing, creating models comparable in density to the existing
slime (10,250) and knight (9,888) characters.
"""

import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))
from ply_utils import write_ply

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
ASSETS = os.path.join(PROJECT_ROOT, "examples", "island_demo", "assets")

# Gaussian spacing and scale
# Target ~10K gaussians per animal: need dense packing over larger volumes
STEP = 0.08        # spacing between gaussian centers
GSCALE = 0.04      # world-space gaussian radius (small, dense)
OPACITY = 0.95
ANIMAL_SCALE = 3.0  # multiply all positions by this to get ~10K at STEP=0.08


def hex_rgb(h: str) -> tuple:
    h = h.lstrip("#")
    return (int(h[0:2], 16) / 255.0, int(h[2:4], 16) / 255.0, int(h[4:6], 16) / 255.0)


def fill_box(cx, cy, cz, hw, hh, hd, color, jitter=0.02):
    """Fill an axis-aligned box with gaussians. Returns list of gaussian dicts."""
    cx, cy, cz = cx*ANIMAL_SCALE, cy*ANIMAL_SCALE, cz*ANIMAL_SCALE
    hw, hh, hd = hw*ANIMAL_SCALE, hh*ANIMAL_SCALE, hd*ANIMAL_SCALE
    gs = []
    x = cx - hw
    while x <= cx + hw:
        y = cy - hh
        while y <= cy + hh:
            z = cz - hd
            while z <= cz + hd:
                gs.append({
                    "pos": (x + random.uniform(-jitter, jitter),
                            y + random.uniform(-jitter, jitter),
                            z + random.uniform(-jitter, jitter)),
                    "color": color,
                    "scale": GSCALE,
                    "opacity": OPACITY,
                })
                z += STEP
            y += STEP
        x += STEP
    return gs


def fill_ellipsoid(cx, cy, cz, rx, ry, rz, color, jitter=0.02):
    """Fill an ellipsoid with gaussians."""
    cx, cy, cz = cx*ANIMAL_SCALE, cy*ANIMAL_SCALE, cz*ANIMAL_SCALE
    rx, ry, rz = rx*ANIMAL_SCALE, ry*ANIMAL_SCALE, rz*ANIMAL_SCALE
    gs = []
    x = cx - rx
    while x <= cx + rx:
        y = cy - ry
        while y <= cy + ry:
            z = cz - rz
            while z <= cz + rz:
                dx = (x - cx) / rx if rx > 0 else 0
                dy = (y - cy) / ry if ry > 0 else 0
                dz = (z - cz) / rz if rz > 0 else 0
                if dx*dx + dy*dy + dz*dz <= 1.0:
                    gs.append({
                        "pos": (x + random.uniform(-jitter, jitter),
                                y + random.uniform(-jitter, jitter),
                                z + random.uniform(-jitter, jitter)),
                        "color": color,
                        "scale": GSCALE,
                        "opacity": OPACITY,
                    })
                z += STEP
            y += STEP
        x += STEP
    return gs


def fill_cylinder(cx, cy, cz, radius, height, color, jitter=0.02):
    """Fill a vertical cylinder with gaussians."""
    cx, cy, cz = cx*ANIMAL_SCALE, cy*ANIMAL_SCALE, cz*ANIMAL_SCALE
    radius, height = radius*ANIMAL_SCALE, height*ANIMAL_SCALE
    gs = []
    x = cx - radius
    while x <= cx + radius:
        z = cz - radius
        while z <= cz + radius:
            dx = x - cx
            dz = z - cz
            if dx*dx + dz*dz <= radius*radius:
                y = cy
                while y <= cy + height:
                    gs.append({
                        "pos": (x + random.uniform(-jitter, jitter),
                                y + random.uniform(-jitter, jitter),
                                z + random.uniform(-jitter, jitter)),
                        "color": color,
                        "scale": GSCALE,
                        "opacity": OPACITY,
                    })
                    y += STEP
            z += STEP
        x += STEP
    return gs


# ── Colors ──
BROWN = hex_rgb("#8B6914")
BELLY = hex_rgb("#C4A35A")
HOOF = hex_rgb("#3A2A0A")
ANTLER = hex_rgb("#6B4226")
NOSE = hex_rgb("#2A1A0A")

GRAY = hex_rgb("#707070")
DARK_GRAY = hex_rgb("#505050")
WHITE = hex_rgb("#D0D0D0")
YELLOW_EYE = hex_rgb("#FFCC00")
WOLF_NOSE = hex_rgb("#1A1A1A")

GLOW_GREEN = hex_rgb("#CCFF00")


def create_deer():
    """Create a deer with ~10K gaussians."""
    random.seed(42)
    gs = []

    # Body (ellipsoid) — main torso
    gs += fill_ellipsoid(0, 0.7, 0, 0.7, 0.35, 0.3, BROWN)

    # Belly (slightly lighter underside)
    gs += fill_ellipsoid(0, 0.5, 0, 0.55, 0.15, 0.25, BELLY)

    # Neck (tilted cylinder)
    for i in range(8):
        t = i / 7.0
        nx = 0.55 + t * 0.2
        ny = 0.8 + t * 0.5
        gs += fill_ellipsoid(nx, ny, 0, 0.15 - t*0.03, 0.12, 0.12, BROWN)

    # Head
    gs += fill_ellipsoid(0.85, 1.4, 0, 0.2, 0.18, 0.15, BROWN)
    # Snout
    gs += fill_ellipsoid(1.05, 1.35, 0, 0.1, 0.08, 0.08, BELLY)
    # Nose
    gs += fill_ellipsoid(1.15, 1.37, 0, 0.04, 0.03, 0.04, NOSE)

    # Ears
    gs += fill_ellipsoid(0.75, 1.6, -0.1, 0.06, 0.1, 0.03, BROWN)
    gs += fill_ellipsoid(0.75, 1.6, 0.1, 0.06, 0.1, 0.03, BROWN)

    # Antlers (simple Y-shape)
    for i in range(6):
        t = i / 5.0
        gs += fill_ellipsoid(0.78, 1.65 + t*0.4, -0.08, 0.025, 0.025, 0.02, ANTLER)
        gs += fill_ellipsoid(0.78, 1.65 + t*0.4, 0.08, 0.025, 0.025, 0.02, ANTLER)
    # Antler branches
    for i in range(3):
        t = i / 2.0
        gs += fill_ellipsoid(0.78 - t*0.1, 1.9 + t*0.15, -0.12 - t*0.06, 0.02, 0.02, 0.02, ANTLER)
        gs += fill_ellipsoid(0.78 - t*0.1, 1.9 + t*0.15, 0.12 + t*0.06, 0.02, 0.02, 0.02, ANTLER)

    # Legs (4 cylinders)
    leg_positions = [
        (0.4, 0, -0.2), (0.4, 0, 0.2),   # front
        (-0.4, 0, -0.2), (-0.4, 0, 0.2),  # rear
    ]
    for lx, ly, lz in leg_positions:
        gs += fill_cylinder(lx, ly, lz, 0.06, 0.45, BROWN)
        gs += fill_ellipsoid(lx, ly, lz, 0.07, 0.04, 0.07, HOOF)  # hoof

    # Tail (small)
    gs += fill_ellipsoid(-0.75, 0.85, 0, 0.08, 0.06, 0.05, BELLY)

    print(f"  Deer: {len(gs)} gaussians")
    return gs


def create_wolf():
    """Create a wolf with ~10K gaussians."""
    random.seed(123)
    gs = []

    # Body (ellipsoid)
    gs += fill_ellipsoid(0, 0.5, 0, 0.65, 0.28, 0.25, GRAY)

    # Dark back stripe
    gs += fill_ellipsoid(0, 0.75, 0, 0.55, 0.1, 0.2, DARK_GRAY)

    # White belly
    gs += fill_ellipsoid(0, 0.35, 0, 0.5, 0.1, 0.2, WHITE)

    # Neck
    for i in range(6):
        t = i / 5.0
        nx = 0.5 + t * 0.15
        ny = 0.55 + t * 0.3
        gs += fill_ellipsoid(nx, ny, 0, 0.14 - t*0.02, 0.12, 0.12, GRAY)

    # Head (more pointed than deer)
    gs += fill_ellipsoid(0.75, 0.9, 0, 0.22, 0.16, 0.14, GRAY)
    # Snout (long, pointed)
    gs += fill_ellipsoid(0.95, 0.85, 0, 0.15, 0.08, 0.08, GRAY)
    gs += fill_ellipsoid(1.1, 0.84, 0, 0.05, 0.04, 0.05, WOLF_NOSE)

    # Ears (pointed, upright)
    gs += fill_ellipsoid(0.68, 1.1, -0.08, 0.04, 0.1, 0.025, DARK_GRAY)
    gs += fill_ellipsoid(0.68, 1.1, 0.08, 0.04, 0.1, 0.025, DARK_GRAY)

    # Eyes
    gs += fill_ellipsoid(0.88, 0.95, -0.1, 0.025, 0.02, 0.015, YELLOW_EYE)
    gs += fill_ellipsoid(0.88, 0.95, 0.1, 0.025, 0.02, 0.015, YELLOW_EYE)

    # Legs (4)
    leg_positions = [
        (0.35, 0, -0.18), (0.35, 0, 0.18),
        (-0.35, 0, -0.18), (-0.35, 0, 0.18),
    ]
    for lx, ly, lz in leg_positions:
        gs += fill_cylinder(lx, ly, lz, 0.06, 0.35, GRAY)
        gs += fill_ellipsoid(lx, ly, lz, 0.07, 0.03, 0.06, DARK_GRAY)  # paw

    # Bushy tail
    for i in range(8):
        t = i / 7.0
        tx = -0.7 - t * 0.3
        ty = 0.6 + t * 0.2 - t*t*0.15
        gs += fill_ellipsoid(tx, ty, 0, 0.08 - t*0.02, 0.06, 0.07 - t*0.02, GRAY)
    # White tail tip
    gs += fill_ellipsoid(-1.05, 0.72, 0, 0.05, 0.04, 0.04, WHITE)

    print(f"  Wolf: {len(gs)} gaussians")
    return gs


def create_firefly():
    """Create a firefly with ~500 gaussians (small glowing insect)."""
    random.seed(456)
    gs = []

    # Glowing abdomen
    gs += fill_ellipsoid(0, 0, 0, 0.08, 0.05, 0.05, GLOW_GREEN)
    # Body
    gs += fill_ellipsoid(-0.08, 0.02, 0, 0.06, 0.04, 0.04, hex_rgb("#333300"))
    # Wings (thin)
    gs += fill_ellipsoid(-0.03, 0.06, -0.06, 0.05, 0.01, 0.04, hex_rgb("#AAFFAA"))
    gs += fill_ellipsoid(-0.03, 0.06, 0.06, 0.05, 0.01, 0.04, hex_rgb("#AAFFAA"))

    print(f"  Firefly: {len(gs)} gaussians")
    return gs


def main():
    print("Generating animal PLY files...")

    # Deer
    deer_dir = os.path.join(ASSETS, "characters", "deer")
    os.makedirs(deer_dir, exist_ok=True)
    deer_path = os.path.join(deer_dir, "deer.ply")
    write_ply(deer_path, create_deer())
    print(f"  -> {deer_path}")

    # Wolf
    wolf_dir = os.path.join(ASSETS, "characters", "wolf")
    os.makedirs(wolf_dir, exist_ok=True)
    wolf_path = os.path.join(wolf_dir, "wolf.ply")
    write_ply(wolf_path, create_wolf())
    print(f"  -> {wolf_path}")

    # Firefly
    firefly_path = os.path.join(ASSETS, "props", "firefly.ply")
    write_ply(firefly_path, create_firefly())
    print(f"  -> {firefly_path}")

    print("Done!")


if __name__ == "__main__":
    main()
