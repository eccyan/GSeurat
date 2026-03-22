#!/usr/bin/env python3
"""Generate a complete scene JSON with terrain, placed props, collision, and nav zones."""

import argparse
import json
import math
import os
import struct
import sys


def parse_ply_positions(path):
    """Read position (x, y, z) from a binary little-endian PLY file.

    Returns list of (x, y, z) tuples.
    """
    positions = []

    with open(path, "rb") as f:
        # Parse ASCII header
        vertex_count = 0
        properties = []
        vertex_stride = 0

        while True:
            line = f.readline().decode("ascii").strip()
            if line.startswith("format"):
                if "binary_little_endian" not in line:
                    raise ValueError(f"Unsupported PLY format: {line}")
            elif line.startswith("element vertex"):
                vertex_count = int(line.split()[-1])
            elif line.startswith("property"):
                parts = line.split()
                ptype = parts[1]
                pname = parts[2]
                size = {"float": 4, "float32": 4, "double": 8,
                        "uchar": 1, "uint8": 1, "int": 4, "int32": 4}.get(ptype, 0)
                properties.append((pname, ptype, vertex_stride, size))
                vertex_stride += size
            elif line == "end_header":
                break

        # Find x, y, z property offsets
        prop_map = {name: (offset, size) for name, ptype, offset, size in properties}
        x_off = prop_map["x"][0]
        y_off = prop_map["y"][0]
        z_off = prop_map["z"][0]

        # Read binary data
        for _ in range(vertex_count):
            data = f.read(vertex_stride)
            x = struct.unpack_from("<f", data, x_off)[0]
            y = struct.unpack_from("<f", data, y_off)[0]
            z = struct.unpack_from("<f", data, z_off)[0]
            positions.append((x, y, z))

    return positions


def build_elevation_grid(positions, width, depth, cell_size):
    """Build per-cell max elevation from terrain Gaussian positions."""
    cols = int(width / cell_size)
    rows = int(depth / cell_size)
    elevation = [0.0] * (cols * rows)

    for x, y, z in positions:
        ci = int(x / cell_size)
        ri = int(z / cell_size)
        if 0 <= ci < cols and 0 <= ri < rows:
            idx = ri * cols + ci
            elevation[idx] = max(elevation[idx], y)

    return elevation, cols, rows


def build_solid_grid(positions, elevation, cols, rows, cell_size):
    """Determine solid cells: no Gaussians present or steep slope."""
    # Count Gaussians per cell
    counts = [0] * (cols * rows)
    for x, _, z in positions:
        ci = int(x / cell_size)
        ri = int(z / cell_size)
        if 0 <= ci < cols and 0 <= ri < rows:
            counts[ri * cols + ci] += 1

    solid = []
    for ri in range(rows):
        for ci in range(cols):
            idx = ri * cols + ci
            if counts[idx] == 0:
                solid.append(idx)
                continue
            # Check slope: compare with neighbors
            h = elevation[idx]
            for dri, dci in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                nri, nci = ri + dri, ci + dci
                if 0 <= nri < rows and 0 <= nci < cols:
                    nh = elevation[nri * cols + nci]
                    if abs(nh - h) > 3.0:  # Steep slope threshold
                        solid.append(idx)
                        break

    return sorted(set(solid))


def build_nav_zones(cols, rows, cell_size, placed_objects):
    """Assign nav zones: 0=default, 1=town (near house), 2=forest (near trees)."""
    zones = [0] * (cols * rows)

    for obj in placed_objects:
        ox, _, oz = obj["position"]
        is_house = "house" in obj["ply_file"]
        is_tree = "tree" in obj["ply_file"]

        if not (is_house or is_tree):
            continue

        radius = 8.0 if is_house else 5.0
        zone_id = 1 if is_house else 2

        for ri in range(rows):
            for ci in range(cols):
                cx = (ci + 0.5) * cell_size
                cz = (ri + 0.5) * cell_size
                dist = math.sqrt((cx - ox) ** 2 + (cz - oz) ** 2)
                if dist <= radius:
                    idx = ri * cols + ci
                    # Town zone takes priority over forest
                    if zones[idx] == 0 or (zone_id == 1 and zones[idx] == 2):
                        zones[idx] = zone_id

    return zones


def main():
    parser = argparse.ArgumentParser(description="Generate complete GSeurat scene JSON")
    parser.add_argument("--terrain", type=str, default="assets/maps/test_terrain.ply",
                        help="Path to terrain PLY file")
    parser.add_argument("--props-dir", type=str, default="assets/props",
                        help="Directory containing prop PLY files")
    parser.add_argument("--output", type=str, default="assets/scenes/gs_layers_demo.json",
                        help="Output scene JSON path")
    args = parser.parse_args()

    # Parse terrain to get positions and bounds
    print(f"Reading terrain: {args.terrain}")
    positions = parse_ply_positions(args.terrain)
    print(f"  {len(positions)} Gaussians loaded")

    # Compute terrain bounds
    xs = [p[0] for p in positions]
    zs = [p[2] for p in positions]
    width = max(xs) - min(xs) + 1
    depth = max(zs) - min(zs) + 1
    grid_w = int(math.ceil(width))
    grid_d = int(math.ceil(depth))
    cell_size = 1.0

    print(f"  Terrain bounds: {grid_w} x {grid_d}")

    # Build elevation grid
    elevation, cols, rows = build_elevation_grid(positions, grid_w, grid_d, cell_size)

    # Define placed objects
    house_ply = os.path.join(args.props_dir, "house.ply")
    tree_ply = os.path.join(args.props_dir, "tree.ply")
    rock_ply = os.path.join(args.props_dir, "rock.ply")

    # Helper to get elevation at a grid position
    def elevation_at(x, z):
        ci = int(x / cell_size)
        ri = int(z / cell_size)
        if 0 <= ci < cols and 0 <= ri < rows:
            return elevation[ri * cols + ci]
        return 0.0

    placed_objects = [
        {
            "id": "house_1",
            "ply_file": house_ply,
            "position": [32.0, elevation_at(32, 32), 32.0],
            "rotation": [0.0, 0.0, 0.0],
            "scale": 1.0,
            "is_static": True,
        },
        {
            "id": "tree_1",
            "ply_file": tree_ply,
            "position": [20.0, elevation_at(20, 25), 25.0],
            "rotation": [0.0, 0.0, 0.0],
            "scale": 1.0,
            "is_static": True,
        },
        {
            "id": "tree_2",
            "ply_file": tree_ply,
            "position": [18.0, elevation_at(18, 30), 30.0],
            "rotation": [0.0, 45.0, 0.0],
            "scale": 1.2,
            "is_static": True,
        },
        {
            "id": "tree_3",
            "ply_file": tree_ply,
            "position": [22.0, elevation_at(22, 28), 28.0],
            "rotation": [0.0, 90.0, 0.0],
            "scale": 0.9,
            "is_static": True,
        },
        {
            "id": "rock_1",
            "ply_file": rock_ply,
            "position": [40.0, elevation_at(40, 35), 35.0],
            "rotation": [0.0, 0.0, 0.0],
            "scale": 1.0,
            "is_static": True,
        },
        {
            "id": "rock_2",
            "ply_file": rock_ply,
            "position": [45.0, elevation_at(45, 20), 20.0],
            "rotation": [0.0, 30.0, 0.0],
            "scale": 1.5,
            "is_static": True,
        },
        {
            "id": "tree_4",
            "ply_file": tree_ply,
            "position": [50.0, elevation_at(50, 45), 45.0],
            "rotation": [0.0, 180.0, 0.0],
            "scale": 1.1,
            "is_static": True,
        },
    ]

    # Build collision data
    solid = build_solid_grid(positions, elevation, cols, rows, cell_size)
    nav_zones = build_nav_zones(cols, rows, cell_size, placed_objects)

    # Round elevation values for cleaner JSON
    elevation_rounded = [round(e, 2) for e in elevation]

    # Player position at (32, 32) with terrain elevation
    player_y = elevation_at(32, 32)

    # Build scene JSON
    scene = {
        "gaussian_splat": {
            "ply_file": args.terrain,
            "camera": {
                "position": [grid_w / 2.0, 30.0, grid_w + 16.0],
                "target": [grid_w / 2.0, 0.0, grid_d / 2.0],
                "fov": 45,
            },
            "render_width": 320,
            "render_height": 240,
            "scale_multiplier": 1.0,
        },
        "placed_objects": placed_objects,
        "collision": {
            "width": cols,
            "height": rows,
            "cell_size": cell_size,
            "solid": solid,
            "elevation": elevation_rounded,
            "nav_zone": nav_zones,
        },
        "nav_zone_names": ["default", "town", "forest"],
        "ambient_color": [0.8, 0.85, 0.95, 1.0],
        "player": {
            "position": [32.0, round(player_y, 2), 32.0],
            "facing": "down",
        },
    }

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)

    with open(args.output, "w") as f:
        json.dump(scene, f, indent=2)

    print(f"\nScene written: {args.output}")
    print(f"  Collision grid: {cols} x {rows}")
    print(f"  Solid cells: {len(solid)}")
    print(f"  Placed objects: {len(placed_objects)}")
    print(f"  Player position: ({32.0}, {player_y:.2f}, {32.0})")
    print(f"  Nav zones: {sum(1 for z in nav_zones if z == 1)} town, "
          f"{sum(1 for z in nav_zones if z == 2)} forest")


if __name__ == "__main__":
    main()
