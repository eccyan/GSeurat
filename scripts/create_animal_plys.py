#!/usr/bin/env python3
"""Generate voxel animal PLY files for the northern forest scene.

Creates deer, wolf, and firefly models as binary PLY files compatible
with GaussianCloud::load_ply().
"""

import os
import struct
import sys

# Add scripts dir to path for ply_utils
sys.path.insert(0, os.path.dirname(__file__))
from ply_utils import write_ply

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
ASSETS = os.path.join(PROJECT_ROOT, "examples", "island_demo", "assets")


def hex_to_rgb(hex_str: str) -> tuple[float, float, float]:
    """Convert hex color string to (r, g, b) in 0-1 range."""
    h = hex_str.lstrip("#")
    return (int(h[0:2], 16) / 255.0, int(h[2:4], 16) / 255.0, int(h[4:6], 16) / 255.0)


# ---------- Color palettes ----------
BROWN = hex_to_rgb("#8B6914")
BELLY_TAN = hex_to_rgb("#C4A35A")
DARK_HOOF = hex_to_rgb("#3A2A0A")
ANTLER = hex_to_rgb("#5C4A1E")

GRAY = hex_to_rgb("#707070")
DARK_GRAY = hex_to_rgb("#505050")
WHITE_BELLY = hex_to_rgb("#D0D0D0")
YELLOW_EYE = hex_to_rgb("#FFCC00")

GLOW_GREEN = hex_to_rgb("#CCFF00")

VOXEL_SCALE = 0.5


def make_voxel(x: float, y: float, z: float, color: tuple, opacity: float = 1.0) -> dict:
    return {"pos": (x, y, z), "color": color, "scale": VOXEL_SCALE, "opacity": opacity}


def create_deer() -> list[dict]:
    """Create a small deer: ~8 wide x 8 tall x 4 deep voxels.

    Orientation: X = left-right, Y = up, Z = front-back.
    Body centered near origin.
    """
    voxels = []

    # Body: 6 wide (x: -2.5 to 2.5 step 1), 3 tall (y: 3..5), 3 deep (z: -1..1)
    for x in [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5]:
        for y in [3, 4, 5]:
            for z in [-1, 0, 1]:
                color = BELLY_TAN if y == 3 else BROWN
                voxels.append(make_voxel(x, y, z, color))

    # Legs: 4 legs, 3 voxels tall each (y: 0,1,2)
    leg_positions = [(-2, -1), (-2, 1), (2, -1), (2, 1)]  # (x, z)
    for lx, lz in leg_positions:
        for y in [0, 1, 2]:
            color = DARK_HOOF if y == 0 else BROWN
            voxels.append(make_voxel(lx, y, lz, color))

    # Head: 2 wide, 2 tall, 2 deep, at front
    for x in [-0.5, 0.5]:
        for y in [5, 6]:
            for z in [2, 3]:
                voxels.append(make_voxel(x, y, z, BROWN))

    # Antlers: 2-3 voxels each, extending upward from head
    # Left antler
    voxels.append(make_voxel(-1, 7, 2.5, ANTLER))
    voxels.append(make_voxel(-1.5, 8, 2.5, ANTLER))
    voxels.append(make_voxel(-2, 8, 2.5, ANTLER))
    # Right antler
    voxels.append(make_voxel(1, 7, 2.5, ANTLER))
    voxels.append(make_voxel(1.5, 8, 2.5, ANTLER))
    voxels.append(make_voxel(2, 8, 2.5, ANTLER))

    # Tail: 1 voxel behind
    voxels.append(make_voxel(0, 5, -2, BROWN))

    return voxels


def create_wolf() -> list[dict]:
    """Create a wolf/fox: ~8 wide x 6 tall x 4 deep voxels.

    Orientation: X = left-right, Y = up, Z = front-back.
    """
    voxels = []

    # Body: 6 wide (x: -2.5 to 2.5), 2 tall (y: 3..4), 3 deep (z: -1..1)
    for x in [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5]:
        for y in [3, 4]:
            for z in [-1, 0, 1]:
                if y == 4:
                    color = DARK_GRAY  # darker back
                elif y == 3 and z == 1:
                    color = WHITE_BELLY  # white belly on underside-front
                else:
                    color = GRAY
                voxels.append(make_voxel(x, y, z, color))

    # Legs: 4 legs, 3 voxels tall (y: 0,1,2)
    leg_positions = [(-2, -1), (-2, 1), (2, -1), (2, 1)]
    for lx, lz in leg_positions:
        for y in [0, 1, 2]:
            voxels.append(make_voxel(lx, y, lz, GRAY))

    # Head: pointed, 2 wide, 2 tall, 3 deep (front)
    for x in [-0.5, 0.5]:
        for y in [4, 5]:
            for z in [2, 3]:
                voxels.append(make_voxel(x, y, z, GRAY))
    # Snout point
    voxels.append(make_voxel(0, 4, 4, DARK_GRAY))

    # Eyes: yellow on sides of head
    voxels.append(make_voxel(-1, 5, 3, YELLOW_EYE))
    voxels.append(make_voxel(1, 5, 3, YELLOW_EYE))

    # Ears: pointed
    voxels.append(make_voxel(-0.5, 6, 2.5, DARK_GRAY))
    voxels.append(make_voxel(0.5, 6, 2.5, DARK_GRAY))

    # Tail: 3 voxels extending back
    for i in range(3):
        voxels.append(make_voxel(0, 4 + i * 0.3, -2 - i, GRAY))

    return voxels


def create_firefly() -> list[dict]:
    """Create a tiny firefly: 2x2x1 voxels."""
    voxels = []
    for x in [0, 1]:
        for y in [0, 1]:
            voxels.append(make_voxel(x, y, 0, GLOW_GREEN, opacity=0.95))
    return voxels


def verify_ply(path: str) -> bool:
    """Verify a PLY file can be parsed: header + data size match."""
    with open(path, "rb") as f:
        header_bytes = b""
        vertex_count = 0
        prop_count = 0
        while True:
            line = f.readline()
            if not line:
                print(f"  ERROR: unexpected EOF in header of {path}")
                return False
            header_bytes += line
            text = line.decode("ascii", errors="replace").strip()
            if text.startswith("element vertex"):
                vertex_count = int(text.split()[-1])
            if text.startswith("property"):
                prop_count += 1
            if text == "end_header":
                break

        # Calculate expected data size (all float properties = 4 bytes each)
        bytes_per_vertex = prop_count * 4  # all float props
        expected = vertex_count * bytes_per_vertex
        remaining = f.read()
        actual = len(remaining)

        if actual != expected:
            print(f"  ERROR: {path}: expected {expected} bytes ({vertex_count} verts x {bytes_per_vertex}), got {actual}")
            return False

        print(f"  OK: {path}: {vertex_count} vertices, {actual} bytes data")
        return True


def main():
    # Output paths
    deer_dir = os.path.join(ASSETS, "characters", "deer")
    wolf_dir = os.path.join(ASSETS, "characters", "wolf")
    props_dir = os.path.join(ASSETS, "props")

    os.makedirs(deer_dir, exist_ok=True)
    os.makedirs(wolf_dir, exist_ok=True)
    os.makedirs(props_dir, exist_ok=True)

    deer_path = os.path.join(deer_dir, "deer.ply")
    wolf_path = os.path.join(wolf_dir, "wolf.ply")
    firefly_path = os.path.join(props_dir, "firefly.ply")

    # Generate
    deer_voxels = create_deer()
    wolf_voxels = create_wolf()
    firefly_voxels = create_firefly()

    deer_count = write_ply(deer_path, deer_voxels)
    print(f"Deer: {deer_count} gaussians -> {deer_path}")

    wolf_count = write_ply(wolf_path, wolf_voxels)
    print(f"Wolf: {wolf_count} gaussians -> {wolf_path}")

    firefly_count = write_ply(firefly_path, firefly_voxels)
    print(f"Firefly: {firefly_count} gaussians -> {firefly_path}")

    # Verify
    print("\nVerification:")
    all_ok = True
    for p in [deer_path, wolf_path, firefly_path]:
        if not verify_ply(p):
            all_ok = False

    if not all_ok:
        print("\nERROR: Some PLY files failed verification!")
        sys.exit(1)
    else:
        print("\nAll PLY files verified successfully.")


if __name__ == "__main__":
    main()
