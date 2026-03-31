#!/usr/bin/env python3
"""
Generate the Seurat Island demo scene JSON.

Reads collision grid + prop manifest, outputs the final scene JSON with:
- Static props from the manifest
- Interactive game objects (torches, crystals, chests, fountain, pressure plate)
- Particle emitters matching emitter_index references

Usage:
    python3 scripts/generate_demo_scene.py [options]

Options:
    --terrain-collision PATH  Path to collision grid JSON
                              (default: assets/maps/seurat_island_collision.json)
    --prop-manifest PATH      Path to prop manifest JSON
                              (default: assets/props/island_manifest.json)
    --output PATH             Output scene JSON path
                              (default: assets/scenes/seurat_island.json)
"""

import argparse
import json
import math
import os
import sys


def parse_args():
    parser = argparse.ArgumentParser(description="Generate Seurat Island scene JSON")
    parser.add_argument(
        "--terrain-collision",
        default="assets/maps/seurat_island_collision.json",
        help="Path to collision grid JSON",
    )
    parser.add_argument(
        "--prop-manifest",
        default="assets/props/island_manifest.json",
        help="Path to prop manifest JSON",
    )
    parser.add_argument(
        "--output",
        default="assets/scenes/seurat_island.json",
        help="Output scene JSON path",
    )
    return parser.parse_args()


def lookup_elevation(x, z, collision):
    """Return terrain elevation at world position (x, z)."""
    cell_size = collision["cell_size"]
    width = collision["width"]
    height = collision["height"]
    elevation = collision["elevation"]

    cell_x = int(x / cell_size)
    cell_z = int(z / cell_size)

    # Clamp to grid bounds
    cell_x = max(0, min(width - 1, cell_x))
    cell_z = max(0, min(height - 1, cell_z))

    index = cell_z * width + cell_x
    return elevation[index]


def is_walkable(x, z, collision):
    """Check if world position (x, z) is walkable (not solid)."""
    cell_size = collision["cell_size"]
    width = collision["width"]
    height = collision["height"]

    cell_x = int(x / cell_size)
    cell_z = int(z / cell_size)

    if cell_x < 0 or cell_x >= width or cell_z < 0 or cell_z >= height:
        return False

    index = cell_z * width + cell_x
    return not collision["solid"][index]


def snap_to_walkable(x, z, collision, search_radius=20):
    """Find nearest walkable cell to (x, z), return snapped world position."""
    cell_size = collision["cell_size"]
    width = collision["width"]
    height = collision["height"]

    gx = int(x / cell_size)
    gz = int(z / cell_size)

    best = None
    best_dist = 9999

    r = int(search_radius / cell_size)
    for dx in range(-r, r + 1):
        for dz in range(-r, r + 1):
            cx, cz = gx + dx, gz + dz
            if 0 <= cx < width and 0 <= cz < height:
                idx = cz * width + cx
                if not collision["solid"][idx] and collision["elevation"][idx] > 1.0:
                    d = (dx * dx + dz * dz) ** 0.5
                    if d < best_dist:
                        best_dist = d
                        best = (cx, cz)

    if best:
        wx = (best[0] + 0.5) * cell_size
        wz = (best[1] + 0.5) * cell_size
        return wx, wz
    return x, z  # fallback


def build_static_props(manifest):
    """Convert prop manifest entries to game_objects with empty components."""
    objects = []
    for prop in manifest:
        obj = {
            "id": prop["id"],
            "name": prop["name"],
            "ply_file": prop["ply_file"],
            "position": prop["position"],
            "rotation": prop["rotation"],
            "scale": prop["scale"],
            "components": {},
        }
        objects.append(obj)
    return objects


def build_interactive_objects(collision):
    """Build hardcoded interactive game objects with elevation-corrected Y positions."""

    def pos(x, z):
        """Snap to nearest walkable cell and set correct elevation."""
        sx, sz = snap_to_walkable(x, z, collision)
        y = lookup_elevation(sx, sz, collision)
        return [sx, y, sz]

    # Torches (4) — near house and on walkable land (256x256 world)
    torch_positions = [
        [134, 0, 122],
        [122, 0, 110],
        [114, 0, 106],
        [106, 0, 118],
    ]
    torches = []
    for i, (tx, _, tz) in enumerate(torch_positions):
        torches.append(
            {
                "id": f"torch_{i + 1}",
                "name": "Torch",
                "position": pos(tx, tz),
                "rotation": [0, 0, 0],
                "scale": 1.0,
                "components": {
                    "ProximityTrigger": {"radius": 12},
                    "EmitterToggle": {"emitter_index": i},
                    "LightToggle": {
                        "color_r": 1,
                        "color_g": 0.6,
                        "color_b": 0.1,
                        "radius": 15,
                        "intensity": 3,
                    },
                },
            }
        )

    # Crystals (3) — on rocky areas
    crystal_positions = [
        [106, 0, 102],
        [162, 0, 150],
        [154, 0, 154],
    ]
    crystals = []
    for i, (cx, _, cz) in enumerate(crystal_positions):
        crystals.append(
            {
                "id": f"crystal_{i + 1}",
                "name": "Crystal",
                "position": pos(cx, cz),
                "rotation": [0, 0, 0],
                "scale": 1.0,
                "components": {
                    "ProximityTrigger": {"radius": 6},
                    "EmissiveToggle": {
                        "emission": 2.0,
                        "color_r": 0.3,
                        "color_g": 0.5,
                        "color_b": 1.0,
                        "effect_radius": 3.0,
                    },
                },
            }
        )

    # Chests (2)
    chest_positions = [
        [110, 0, 110],
        [150, 0, 150],
    ]
    chests = []
    for i, (bx, _, bz) in enumerate(chest_positions):
        chests.append(
            {
                "id": f"chest_{i + 1}",
                "name": "Chest",
                "position": pos(bx, bz),
                "rotation": [0, 0, 0],
                "scale": 1.0,
                "components": {
                    "ProximityTrigger": {"radius": 4, "one_shot": True},
                    "BurstEffect": {"emitter_index": 4 + i},
                    "ScatterEffect": {"radius": 1.5, "lifetime": 2.0},
                },
            }
        )

    # Fountain (1) — near center on walkable land
    fx, fz = 114, 106
    fountain = {
        "id": "fountain",
        "name": "Fountain",
        "position": pos(fx, fz),
        "rotation": [0, 0, 0],
        "scale": 1.0,
        "components": {
            "ProximityTrigger": {"radius": 10},
            "EmitterToggle": {"emitter_index": 6},
        },
    }

    # Pressure plate (1)
    ppx, ppz = 166, 150
    pressure_plate = {
        "id": "pressure_plate",
        "name": "Pressure Plate",
        "position": pos(ppx, ppz),
        "rotation": [0, 0, 0],
        "scale": 1.0,
        "components": {
            "ProximityTrigger": {"radius": 2, "one_shot": True},
            "LinkedTrigger": {"target_id": "crystal_hidden"},
        },
    }

    # Hidden crystal (1)
    hcx, hcz = 170, 150
    crystal_hidden = {
        "id": "crystal_hidden",
        "name": "Hidden Crystal",
        "position": pos(hcx, hcz),
        "rotation": [0, 0, 0],
        "scale": 1.0,
        "components": {
            "EmissiveToggle": {
                "emission": 3.0,
                "color_r": 1.0,
                "color_g": 0.2,
                "color_b": 1.0,
                "effect_radius": 4.0,
            }
        },
    }

    # Glowing lanterns along paths — demonstrate emissive bloom
    lantern_positions = [
        [130, 0, 121],  # near house
        [125, 0, 130],  # path south
        [135, 0, 115],  # path north
        [120, 0, 120],  # junction
    ]
    lanterns = []
    for i, (lx, _, lz) in enumerate(lantern_positions):
        lanterns.append({
            "id": f"lantern_{i + 1}",
            "name": "Lantern",
            "position": pos(lx, lz),
            "rotation": [0, 0, 0],
            "scale": 1.0,
            "components": {
                "ProximityTrigger": {"radius": 999},
                "EmissiveToggle": {
                    "emission": 5.0,
                    "color_r": 1.0,
                    "color_g": 0.7,
                    "color_b": 0.3,
                    "effect_radius": 3.0,
                },
            },
        })

    return torches + crystals + chests + [fountain, pressure_plate, crystal_hidden] + lanterns


def build_particle_emitters(collision):
    """Build 7 particle emitters matching the emitter_index references."""

    def pos(x, z):
        sx, sz = snap_to_walkable(x, z, collision)
        y = lookup_elevation(sx, sz, collision)
        return [sx, y, sz]

    # Torch fire emitters (index 0-3) — match torch game object positions
    torch_positions = [
        [134, 122],
        [122, 110],
        [114, 106],
        [106, 118],
    ]
    emitters = []
    for i, (tx, tz) in enumerate(torch_positions):
        # First 2 torches always lit, last 2 start dark (proximity-triggered)
        rate = 8.0 if i < 2 else 0
        emitters.append(
            {
                "preset": "fire",
                "position": pos(tx, tz),
                "spawn_rate": rate,
            }
        )

    # Chest spark shower emitters (index 4-5)
    chest_positions = [
        [110, 110],
        [150, 150],
    ]
    for cx, cz in chest_positions:
        emitters.append(
            {
                "preset": "spark_shower",
                "position": pos(cx, cz),
                "spawn_rate": 0,
                "burst_duration": 0.5,
            }
        )

    # Fountain waterfall mist emitter (index 6) — always active
    emitters.append(
        {
            "preset": "waterfall_mist",
            "position": pos(114, 106),
            "spawn_rate": 5.0,
        }
    )

    return emitters


def main():
    args = parse_args()

    # Resolve paths relative to CWD
    collision_path = args.terrain_collision
    manifest_path = args.prop_manifest
    output_path = args.output

    # Load inputs
    if not os.path.exists(collision_path):
        print(f"ERROR: Collision file not found: {collision_path}", file=sys.stderr)
        sys.exit(1)
    if not os.path.exists(manifest_path):
        print(f"ERROR: Prop manifest not found: {manifest_path}", file=sys.stderr)
        sys.exit(1)

    with open(collision_path) as f:
        collision = json.load(f)

    with open(manifest_path) as f:
        manifest = json.load(f)

    # Build game objects: static props + interactive objects
    static_props = build_static_props(manifest)
    interactive_objects = build_interactive_objects(collision)
    game_objects = static_props + interactive_objects

    # Build particle emitters
    particle_emitters = build_particle_emitters(collision)

    # Assemble final scene
    scene = {
        "version": 2,
        "gaussian_splat": {
            "ply_file": "assets/maps/seurat_island.ply",
            "camera": {
                "position": [128, 40, 180],
                "target": [128, 0, 128],
                "fov": 45,
            },
            "render_width": 640,
            "render_height": 480,
            "scale_multiplier": 1.0,
        },
        "collision": collision,
        "ambient_color": [0.08, 0.08, 0.15, 1.0],
        "lights": [
            {
                "position": [60, 60, 200],
                "color": [1.0, 0.85, 0.6],
                "radius": 400,
                "intensity": 3.5,
            },
            {
                "position": [200, 40, 60],
                "color": [0.8, 0.6, 0.4],
                "radius": 300,
                "intensity": 1.5,
            },
        ],
        "player": {
            "position": [125.0, lookup_elevation(125, 121, collision), 121.0],
            "facing": "down",
        },
        "game_objects": game_objects,
        "particle_emitters": particle_emitters,
    }

    # Write output
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(scene, f, indent=2)

    print(f"Generated: {output_path}")
    print(f"  Static props:        {len(static_props)}")
    print(f"  Interactive objects: {len(interactive_objects)}")
    print(f"  Total game_objects:  {len(game_objects)}")
    print(f"  Particle emitters:   {len(particle_emitters)}")


if __name__ == "__main__":
    main()
