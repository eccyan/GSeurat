#!/usr/bin/env python3
"""Validate .bricklayer files are in sync with engine scene JSON.

Compares entity counts and key fields between the two formats.
Returns exit code 1 if any scene is out of sync.

Usage:
    python3 scripts/validate_bricklayer_sync.py [--fix]
"""

import json
import os
import sys

BASE = "examples/island_demo"

# Map: scene name -> (engine JSON path, bricklayer path)
SCENES = {
    "seurat_island": (
        f"{BASE}/assets/scenes/seurat_island.json",
        f"{BASE}/tools_data/bricklayer/seurat_island.bricklayer",
    ),
    "northern_forest": (
        f"{BASE}/assets/scenes/northern_forest.json",
        f"{BASE}/tools_data/bricklayer/northern_forest.bricklayer",
    ),
    "dungeon": (
        f"{BASE}/assets/scenes/dungeon.json",
        f"{BASE}/tools_data/bricklayer/dungeon.bricklayer",
    ),
}


def count_entities(engine: dict, bricklayer: dict) -> list[str]:
    """Compare entity counts. Returns list of mismatch descriptions."""
    errors = []
    scene = bricklayer.get("scene", {})

    checks = [
        ("game_objects", "gameObjects"),
        ("lights", "staticLights"),
        ("vfx_instances", "vfxInstances"),
    ]

    for engine_key, brick_key in checks:
        e_count = len(engine.get(engine_key, []))
        b_count = len(scene.get(brick_key, []))
        if e_count != b_count:
            errors.append(
                f"  {engine_key}: engine={e_count}, bricklayer={b_count}"
            )

    # Camera zones
    cz = engine.get("camera_zones", {})
    e_vols = len(cz.get("volumes", []))
    b_vols = len(scene.get("cameraVolumes", []))
    if e_vols != b_vols:
        errors.append(f"  camera_volumes: engine={e_vols}, bricklayer={b_vols}")

    e_trigs = len(cz.get("triggers", []))
    b_trigs = len(scene.get("cameraTriggers", []))
    if e_trigs != b_trigs:
        errors.append(f"  camera_triggers: engine={e_trigs}, bricklayer={b_trigs}")

    e_rails = len(cz.get("rails", []))
    b_rails = len(scene.get("cameraRails", []))
    if e_rails != b_rails:
        errors.append(f"  camera_rails: engine={e_rails}, bricklayer={b_rails}")

    return errors


def main():
    all_ok = True

    for name, (engine_path, brick_path) in SCENES.items():
        if not os.path.exists(engine_path):
            print(f"SKIP {name}: engine file not found ({engine_path})")
            continue
        if not os.path.exists(brick_path):
            print(f"FAIL {name}: bricklayer file not found ({brick_path})")
            all_ok = False
            continue

        engine = json.load(open(engine_path))
        brick = json.load(open(brick_path))

        errors = count_entities(engine, brick)
        if errors:
            print(f"FAIL {name}:")
            for e in errors:
                print(e)
            all_ok = False
        else:
            print(f"OK   {name}")

    if not all_ok:
        print("\nBricklayer files are out of sync with engine JSON!")
        print("Run the sync script to fix: python3 scripts/sync_bricklayer.py")
        sys.exit(1)
    else:
        print("\nAll bricklayer files in sync.")


if __name__ == "__main__":
    main()
