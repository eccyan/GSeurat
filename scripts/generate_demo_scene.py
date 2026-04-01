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


def build_static_props(manifest, collision):
    """Convert prop manifest entries to game_objects with elevation-corrected Y."""
    objects = []
    for prop in manifest:
        pos = list(prop["position"])
        # Look up terrain elevation at prop XZ and add manifest Y offset
        terrain_y = lookup_elevation(pos[0], pos[2], collision)
        pos[1] = terrain_y + pos[1]  # manifest Y is offset above terrain
        obj = {
            "id": prop["id"],
            "name": prop["name"],
            "ply_file": prop["ply_file"],
            "position": pos,
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

    # Torches (4) — near house and on walkable land (384x384 world)
    torch_positions = [
        [195, 0, 180],
        [185, 0, 172],
        [200, 0, 190],
        [210, 0, 185],
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

    # Crystals (3) — on rocky areas (384x384 world)
    crystal_positions = [
        [155, 0, 145],
        [225, 0, 195],
        [175, 0, 235],
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

    # Chests (2) — (384x384 world)
    chest_positions = [
        [175, 0, 160],
        [215, 0, 210],
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

    # Fountain (1) — near center on walkable land (384x384 world)
    fx, fz = 192, 165
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

    # Pressure plate (1) — (384x384 world)
    ppx, ppz = 230, 200
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

    # Hidden crystal (1) — (384x384 world)
    hcx, hcz = 235, 200
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

    # Glowing lanterns along paths — demonstrate emissive bloom (384x384 world)
    lantern_positions = [
        [190, 0, 178],  # near house
        [188, 0, 185],  # path south
        [196, 0, 170],  # path north
        [200, 0, 180],  # junction
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

    # Torch fire emitters (index 0-3) — match torch game object positions (384x384 world)
    torch_positions = [
        [195, 180],
        [185, 172],
        [200, 190],
        [210, 185],
    ]
    emitters = []
    for i, (tx, tz) in enumerate(torch_positions):
        # "bonfire" preset has large-scale particles visible from isometric camera
        # First 2 torches always lit, last 2 start dark (proximity-triggered)
        e = {"preset": "bonfire", "position": pos(tx, tz)}
        if i >= 2:
            e["spawn_rate"] = 0
        emitters.append(e)

    # Chest spark shower emitters (index 4-5) — (384x384 world)
    chest_positions = [
        [175, 160],
        [215, 210],
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

    # Fountain geyser emitter (index 6) — large-scale mist, always active (384x384 world)
    emitters.append(
        {
            "preset": "geyser",
            "position": pos(192, 165),
        }
    )

    # Fireflies emitters — spread across island for ambient activity (384x384 world)
    firefly_positions = [
        [190, 185],  # near spawn
        [200, 170],  # north of house
        [170, 200],  # south
        [220, 180],  # east
        [160, 160],  # southwest
        [240, 210],  # far east
    ]
    for fx, fz in firefly_positions:
        emitters.append({"preset": "fireflies", "position": pos(fx, fz)})

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
    static_props = build_static_props(manifest, collision)
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
                "position": [192, 40, 260],
                "target": [192, 0, 192],
                "fov": 45,
            },
            "render_width": 1280,
            "render_height": 720,
            "scale_multiplier": 1.0,
        },
        "collision": collision,
        "ambient_color": [0.12, 0.12, 0.18, 1.0],
        "lights": [
            {
                "position": [90, 60, 300],
                "color": [1.0, 0.9, 0.7],
                "radius": 500,
                "intensity": 2.0,
            },
            {
                "position": [300, 40, 90],
                "color": [0.7, 0.55, 0.4],
                "radius": 400,
                "intensity": 0.8,
            },
        ],
        "player": {
            "position": (lambda sx, sz: [sx, lookup_elevation(sx, sz, collision), sz])(*snap_to_walkable(187, 197, collision)),
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
