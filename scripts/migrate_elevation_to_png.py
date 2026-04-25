#!/usr/bin/env python3
"""Migrate collision.elevation[] arrays from scene JSON files to 16-bit PNG heightmaps.

Usage:
    python3 scripts/migrate_elevation_to_png.py examples/island_demo/assets/scenes/*.json
    python3 scripts/migrate_elevation_to_png.py --dry-run examples/island_demo/assets/scenes/*.json
"""

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def migrate_scene(scene_path: str, output_dir: str, dry_run: bool = False) -> bool:
    """Migrate a single scene file. Returns True if modified."""
    with open(scene_path, "r") as f:
        data = json.load(f)

    collision = data.get("collision")
    if not collision:
        return False

    elevation = collision.get("elevation")
    if not elevation or len(elevation) == 0:
        print(f"  SKIP {scene_path}: no elevation data")
        return False

    width = collision["width"]
    height = collision["height"]
    cell_size = collision.get("cell_size", 1.0)

    if len(elevation) != width * height:
        print(f"  ERROR {scene_path}: elevation array length {len(elevation)} "
              f"!= {width}x{height}={width * height}")
        return False

    elev = np.array(elevation, dtype=np.float32).reshape(height, width)
    min_elev = float(elev.min())
    max_elev = float(elev.max())

    height_range = max_elev - min_elev
    if height_range < 1e-6:
        pixels = np.zeros((height, width), dtype=np.uint16)
    else:
        normalized = (elev - min_elev) / height_range
        pixels = np.round(normalized * 65535.0).astype(np.uint16)

    scene_name = Path(scene_path).stem
    png_name = f"{scene_name}_heightmap.png"
    png_dir = os.path.join(output_dir, "terrain")
    png_path = os.path.join(png_dir, png_name)
    relative_png = f"assets/terrain/{png_name}"

    print(f"  {scene_path}:")
    print(f"    Grid: {width}x{height}, cell_size={cell_size}")
    print(f"    Height range: [{min_elev:.2f}, {max_elev:.2f}]")
    print(f"    Output: {png_path}")

    if dry_run:
        print("    (dry run — no files written)")
        return False

    os.makedirs(png_dir, exist_ok=True)
    img = Image.fromarray(pixels, mode="I;16")
    img.save(png_path)

    terrain_go = {
        "name": "terrain_heightfield",
        "components": {
            "Transform": {"position": [0, 0, 0]},
            "HeightfieldComponent": {
                "image_path": relative_png,
                "width": float(width * cell_size),
                "length": float(height * cell_size),
                "min_height": min_elev,
                "max_height": max_elev
            }
        }
    }

    if "game_objects" not in data:
        data["game_objects"] = []
    data["game_objects"].append(terrain_go)

    del collision["elevation"]

    with open(scene_path, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")

    print(f"    Injected HeightfieldComponent, stripped elevation array")
    return True


def main():
    parser = argparse.ArgumentParser(description="Migrate elevation arrays to PNG heightmaps")
    parser.add_argument("files", nargs="+", help="Scene JSON files to migrate")
    parser.add_argument("--output-dir", default="examples/island_demo/assets",
                        help="Base asset directory for PNG output")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print what would be done without writing files")
    args = parser.parse_args()

    migrated = 0
    for path in args.files:
        if migrate_scene(path, args.output_dir, args.dry_run):
            migrated += 1

    print(f"\nMigrated {migrated}/{len(args.files)} files")


if __name__ == "__main__":
    main()
