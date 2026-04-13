#!/usr/bin/env python3
"""Generate the Northern Forest terrain PLY + collision + scene JSON.

The forest is a dense pine forest north of Seurat Island, connected via a
walkable land bridge. Chunk grid [0, 0, -1] in world.json.

World coordinates: the island center is (192, y, 192) with land extending
to roughly Z=50 at the north shore. The forest terrain covers X: 60-330,
Z: -170 to 50, with a connecting ridge at Z=0-50 that blends with the
island's northern coast.
"""

import argparse
import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ply_utils import write_ply

# Forest world bounds
FOREST_X_MIN = 60.0
FOREST_X_MAX = 330.0
FOREST_Z_MIN = -170.0
FOREST_Z_MAX = 60.0  # extend south to overlap with island's north shore
HEIGHT_SCALE = 4.0
STEP = 0.8

# Collision grid covers the forest area
COLLISION_X_MIN = 0.0
COLLISION_Z_MIN = -192.0
COLLISION_WIDTH = 192   # cells
COLLISION_HEIGHT = 192  # cells
COLLISION_CELL_SIZE = 1.0  # 192 cells × 1.0 = 192 units (matches chunk AABB Z span)

# Colors — deep forest palette
COLOR_EARTH = (0.18, 0.12, 0.06)    # dark forest floor
COLOR_MOSS = (0.08, 0.30, 0.05)     # mossy areas
COLOR_LEAVES = (0.12, 0.22, 0.04)   # leaf litter
COLOR_PATH = (0.35, 0.28, 0.18)     # dirt path
COLOR_ROCK = (0.35, 0.33, 0.30)     # stone
COLOR_WATER = (0.08, 0.15, 0.30)    # stream water


def lerp_color(c1, c2, t):
    t = max(0.0, min(1.0, t))
    return (
        c1[0] + (c2[0] - c1[0]) * t,
        c1[1] + (c2[1] - c1[1]) * t,
        c1[2] + (c2[2] - c1[2]) * t,
    )


def forest_height(x, z):
    """Rolling forest floor with gentle hills and valleys."""
    # Base terrain — gentle rolling hills
    h = 2.0 + 1.5 * math.sin(x * 0.04) * math.cos(z * 0.035)
    h += 0.8 * math.sin(x * 0.08 + z * 0.06)
    h += 0.4 * math.sin(x * 0.15 - z * 0.12)

    # Southern edge (connecting to island): ramp down toward Z=60 to match island elevation
    if z > 10:
        t = (z - 10.0) / 50.0  # 0 at Z=10, 1 at Z=60
        t = min(1.0, t)
        # Blend toward island's north shore height (~0.5)
        island_h = 0.5
        h = h * (1.0 - t) + island_h * t

    # Northern edge: ramp down to sea level
    if z < FOREST_Z_MIN + 30:
        t = (z - FOREST_Z_MIN) / 30.0  # 0 at edge, 1 at 30 units in
        t = max(0.0, min(1.0, t))
        h *= t

    # Eastern/western edges: taper off
    center_x = (FOREST_X_MIN + FOREST_X_MAX) / 2.0
    half_w = (FOREST_X_MAX - FOREST_X_MIN) / 2.0
    dx = abs(x - center_x) / half_w
    if dx > 0.8:
        edge_t = (dx - 0.8) / 0.2
        h *= max(0.0, 1.0 - edge_t)

    return max(0.0, h)


def is_on_path(x, z):
    """Winding path through the forest."""
    # Main path: sinusoidal from south to north
    path_x = 192.0 + 30.0 * math.sin(z * 0.02)
    return abs(x - path_x) < 3.0


def is_stream(x, z):
    """A small stream running east-west through the forest."""
    stream_z = -80.0 + 8.0 * math.sin(x * 0.03)
    return abs(z - stream_z) < 2.5


def is_clearing(x, z):
    """A natural clearing in the deep forest."""
    # Clearing at approximately (200, -100)
    cx, cz = 200.0, -100.0
    dist = math.sqrt((x - cx) ** 2 + (z - cz) ** 2)
    return dist < 15.0


def forest_floor_color(x, z, rng):
    """Determine ground color based on features."""
    if is_on_path(x, z):
        return lerp_color(COLOR_PATH, COLOR_EARTH, rng.uniform(0, 0.3))
    if is_stream(x, z):
        return COLOR_WATER
    if is_clearing(x, z):
        return lerp_color(COLOR_MOSS, COLOR_LEAVES, rng.uniform(0, 0.5))

    # Default forest floor — mix of earth, moss, leaves
    r = rng.random()
    if r < 0.3:
        return lerp_color(COLOR_EARTH, COLOR_MOSS, rng.uniform(0.2, 0.8))
    elif r < 0.6:
        return lerp_color(COLOR_MOSS, COLOR_LEAVES, rng.uniform(0.2, 0.8))
    else:
        return lerp_color(COLOR_LEAVES, COLOR_EARTH, rng.uniform(0.2, 0.8))


def generate_forest_terrain():
    """Generate the forest floor Gaussians."""
    rng = random.Random(7777)
    gaussians = []

    x = FOREST_X_MIN
    while x <= FOREST_X_MAX:
        z = FOREST_Z_MIN
        while z <= FOREST_Z_MAX:
            y = forest_height(x, z)
            if y < 0.1:
                z += STEP
                continue

            color = forest_floor_color(x, z, rng)
            noise = rng.uniform(-0.04, 0.04)
            color = tuple(max(0.0, min(1.0, c + noise)) for c in color)

            opacity = 1.0
            if is_stream(x, z):
                opacity = 0.7
                y -= 0.3  # stream is slightly below ground

            gaussians.append({
                "pos": (x, y, z),
                "color": color,
                "scale": 0.8,
                "opacity": opacity,
            })
            z += STEP
        x += STEP

    return gaussians


def generate_pine_tree(cx, cy, cz, seed, scale=1.0):
    """Generate a tall pine tree at the given position."""
    rng = random.Random(seed)
    gaussians = []

    # Trunk
    trunk_h = 8.0 * scale
    trunk_r = 0.4 * scale
    trunk_color = (0.25, 0.15, 0.06)

    for yi in range(int(trunk_h * 3)):
        y = cy + yi / 3.0
        for ai in range(6):
            angle = ai * math.pi / 3.0 + rng.uniform(-0.1, 0.1)
            r = trunk_r * (0.9 + rng.random() * 0.2)
            gaussians.append({
                "pos": (cx + r * math.cos(angle), y, cz + r * math.sin(angle)),
                "color": trunk_color,
                "scale": 0.25 * scale,
                "opacity": 1.0,
            })

    # Conical canopy — layered rings getting smaller toward top
    canopy_base = cy + trunk_h * 0.4
    canopy_top = cy + trunk_h + 4.0 * scale
    layers = 8
    for layer in range(layers):
        layer_y = canopy_base + (canopy_top - canopy_base) * (layer / layers)
        layer_r = (2.5 * scale) * (1.0 - layer / layers) * 0.9
        count = max(8, int(layer_r * 12))
        for _ in range(count):
            while True:
                dx = rng.uniform(-1, 1)
                dz = rng.uniform(-1, 1)
                if dx * dx + dz * dz <= 1.0:
                    break
            px = cx + dx * layer_r
            pz = cz + dz * layer_r
            py = layer_y + rng.uniform(-0.3, 0.3) * scale
            color = (
                0.05 + rng.random() * 0.08,
                0.18 + rng.random() * 0.15,
                0.02 + rng.random() * 0.04,
            )
            gaussians.append({
                "pos": (px, py, pz),
                "color": color,
                "scale": 0.35 * scale,
                "opacity": 1.0,
            })

    return gaussians


def generate_forest_trees():
    """Place pine trees throughout the forest, avoiding paths, stream, and clearing."""
    rng = random.Random(8888)
    gaussians = []

    # Dense tree placement
    tree_id = 0
    x = FOREST_X_MIN + 10
    while x < FOREST_X_MAX - 10:
        z = FOREST_Z_MIN + 20
        while z < FOREST_Z_MAX - 10:
            # Skip paths, stream, clearing
            if is_on_path(x, z) or is_stream(x, z) or is_clearing(x, z):
                z += 8.0
                continue

            # Random jitter and skip for natural distribution
            if rng.random() > 0.35:
                z += 8.0
                continue

            jx = x + rng.uniform(-3, 3)
            jz = z + rng.uniform(-3, 3)
            y = forest_height(jx, jz)
            if y < 0.5:
                z += 8.0
                continue

            scale = rng.uniform(0.8, 1.5)
            gaussians.extend(generate_pine_tree(jx, y, jz, seed=9000 + tree_id, scale=scale))
            tree_id += 1
            z += 8.0
        x += 10.0

    return gaussians, tree_id


def generate_forest_rocks():
    """Scatter mossy boulders through the forest."""
    rng = random.Random(5555)
    gaussians = []

    rock_positions = [
        (130, -50), (250, -30), (180, -120), (160, -90),
        (220, -140), (280, -80), (140, -160), (200, -60),
        (170, -30), (240, -110), (300, -45), (110, -130),
    ]

    for rx, rz in rock_positions:
        y = forest_height(rx, rz)
        if y < 0.3:
            continue

        # Irregular boulder
        for _ in range(80):
            while True:
                dx = rng.uniform(-1, 1)
                dy = rng.uniform(-1, 1)
                dz = rng.uniform(-1, 1)
                if dx * dx + dy * dy + dz * dz <= 1.0:
                    break

            rx_scale = rng.uniform(1.2, 2.0)
            ry_scale = rng.uniform(0.8, 1.2)
            rz_scale = rng.uniform(1.0, 1.8)

            px = rx + dx * rx_scale
            py = y + abs(dy) * ry_scale
            pz = rz + dz * rz_scale

            # Mossy rock color — gray with green patches
            if rng.random() < 0.3:
                color = lerp_color(COLOR_MOSS, COLOR_ROCK, rng.uniform(0, 0.5))
            else:
                base = 0.3 + rng.random() * 0.15
                color = (base, base + 0.02, base - 0.02)

            gaussians.append({
                "pos": (px, py, pz),
                "color": color,
                "scale": 0.3,
                "opacity": 1.0,
            })

    return gaussians


def generate_mushrooms():
    """Place clusters of glowing mushrooms in dark spots."""
    rng = random.Random(6666)
    gaussians = []

    positions = [
        (175, -70), (210, -95), (150, -130), (195, -50),
        (230, -120), (170, -160), (250, -70), (190, -140),
    ]

    for mx, mz in positions:
        y = forest_height(mx, mz)
        if y < 0.3:
            continue

        # Cluster of 3-5 mushrooms
        count = rng.randint(3, 5)
        for _ in range(count):
            ox = rng.uniform(-1.5, 1.5)
            oz = rng.uniform(-1.5, 1.5)

            # Stem
            for sy in range(4):
                gaussians.append({
                    "pos": (mx + ox, y + sy * 0.15, mz + oz),
                    "color": (0.8, 0.75, 0.65),
                    "scale": 0.1,
                    "opacity": 1.0,
                })

            # Cap — glowing teal
            cap_y = y + 0.6
            for _ in range(8):
                dx = rng.uniform(-0.3, 0.3)
                dz = rng.uniform(-0.3, 0.3)
                gaussians.append({
                    "pos": (mx + ox + dx, cap_y + rng.uniform(-0.05, 0.1), mz + oz + dz),
                    "color": (0.1, 0.6 + rng.random() * 0.2, 0.5 + rng.random() * 0.15),
                    "scale": 0.15,
                    "opacity": 0.9,
                })

    return gaussians


def generate_fog_particles():
    """Low-lying fog throughout the forest."""
    rng = random.Random(4444)
    gaussians = []

    x = FOREST_X_MIN + 20
    while x < FOREST_X_MAX - 20:
        z = FOREST_Z_MIN + 30
        while z < FOREST_Z_MAX - 15:
            if rng.random() > 0.12:
                z += 10
                continue
            y = forest_height(x, z)
            if y < 0.3:
                z += 10
                continue
            gaussians.append({
                "pos": (x + rng.uniform(-3, 3), y + rng.uniform(0.5, 2.0), z + rng.uniform(-3, 3)),
                "color": (0.7, 0.72, 0.75),
                "scale": 3.0,
                "opacity": 0.12,
            })
            z += 10
        x += 10

    return gaussians


def generate_collision_grid():
    """Generate collision grid for the forest area."""
    solid = []
    elevation = []

    for gz in range(COLLISION_HEIGHT):
        for gx in range(COLLISION_WIDTH):
            wx = COLLISION_X_MIN + (gx + 0.5) * COLLISION_CELL_SIZE
            wz = COLLISION_Z_MIN + (gz + 0.5) * COLLISION_CELL_SIZE
            y = forest_height(wx, wz)
            elevation.append(round(y, 4))
            # Solid if no terrain, in stream, or tree trunk locations
            is_solid = y < 0.3 or is_stream(wx, wz)
            solid.append(is_solid)

    return {
        "width": COLLISION_WIDTH,
        "height": COLLISION_HEIGHT,
        "cell_size": COLLISION_CELL_SIZE,
        "solid": solid,
        "elevation": elevation,
    }


def build_scene(collision):
    """Build the scene JSON for the Northern Forest."""

    def lookup_elev(x, z):
        gx = int((x - COLLISION_X_MIN) / COLLISION_CELL_SIZE)
        gz = int((z - COLLISION_Z_MIN) / COLLISION_CELL_SIZE)
        gx = max(0, min(COLLISION_WIDTH - 1, gx))
        gz = max(0, min(COLLISION_HEIGHT - 1, gz))
        return collision["elevation"][gz * COLLISION_WIDTH + gx]

    # NPC positions in the clearing
    npc_positions = [
        {"id": "forest_deer_1", "name": "Deer", "pos": [195, -95]},
        {"id": "forest_deer_2", "name": "Deer", "pos": [208, -105]},
        {"id": "forest_wolf", "name": "Wolf", "pos": [180, -130]},
    ]

    game_objects = []

    # Wandering animals
    for npc in npc_positions:
        nx, nz = npc["pos"]
        ny = lookup_elev(nx, nz)
        game_objects.append({
            "id": npc["id"],
            "name": npc["name"],
            "position": [nx, ny, nz],
            "rotation": [0, 0, 0],
            "scale": 1.0,
            "components": {
                "NpcWalker": {"wander_radius": 12, "speed": 1.5},
            },
        })

    # Glowing mushroom game objects (emissive when player approaches)
    mushroom_go_positions = [
        [175, -70], [210, -95], [150, -130], [230, -120],
    ]
    for i, (mx, mz) in enumerate(mushroom_go_positions):
        my = lookup_elev(mx, mz)
        game_objects.append({
            "id": f"forest_mushroom_{i + 1}",
            "name": "Glowing Mushroom",
            "position": [mx, my, mz],
            "rotation": [0, 0, 0],
            "scale": 1.0,
            "components": {
                "ProximityTrigger": {"radius": 8},
                "EmissiveToggle": {
                    "emission": 4.0,
                    "color_r": 0.1,
                    "color_g": 0.7,
                    "color_b": 0.5,
                    "effect_radius": 6.0,
                },
            },
        })

    # Firefly emitters in the clearing
    emitters = [
        {"preset": "fireflies", "position": [200, lookup_elev(200, -100), -100]},
        {"preset": "fireflies", "position": [190, lookup_elev(190, -85), -85]},
        {"preset": "fireflies", "position": [210, lookup_elev(210, -110), -110]},
    ]

    scene = {
        "version": 2,
        "gaussian_splat": {
            "ply_file": "assets/maps/northern_forest.ply",
            "camera": {
                "position": [192, 30, -60],
                "target": [192, 0, -100],
                "fov": 45,
            },
            "render_width": 1280,
            "render_height": 720,
            "scale_multiplier": 0.8,
            "ground_color": [0.15, 0.12, 0.08],
            "sky_color": [0.3, 0.35, 0.38],
        },
        "collision": collision,
        "ambient_color": [0.06, 0.08, 0.1, 1.0],
        "lights": [
            {
                "position": [192, 50, -80],
                "color": [0.6, 0.65, 0.5],
                "radius": 400,
                "intensity": 1.2,
            },
            {
                "position": [250, 30, -120],
                "color": [0.4, 0.5, 0.3],
                "radius": 300,
                "intensity": 0.6,
            },
        ],
        "player": {
            "position": [192, lookup_elev(192, 0), 0],
            "facing": "up",
        },
        "game_objects": game_objects,
        "particle_emitters": emitters,
    }

    return scene


def main():
    parser = argparse.ArgumentParser(description="Generate Northern Forest terrain + scene")
    parser.add_argument("--output-ply", default="assets/maps/northern_forest.ply")
    parser.add_argument("--output-scene", default="assets/scenes/northern_forest.json")
    args = parser.parse_args()

    print("Generating Northern Forest terrain...")

    # Terrain floor
    terrain = generate_forest_terrain()
    print(f"  Floor: {len(terrain)} Gaussians")

    # Trees
    trees, tree_count = generate_forest_trees()
    print(f"  Trees: {tree_count} trees, {len(trees)} Gaussians")

    # Rocks
    rocks = generate_forest_rocks()
    print(f"  Rocks: {len(rocks)} Gaussians")

    # Mushrooms
    mushrooms = generate_mushrooms()
    print(f"  Mushrooms: {len(mushrooms)} Gaussians")

    # Fog
    fog = generate_fog_particles()
    print(f"  Fog: {len(fog)} Gaussians")

    all_gaussians = terrain + trees + rocks + mushrooms + fog
    print(f"  Total: {len(all_gaussians)} Gaussians")

    # Write PLY
    ply_path = os.path.abspath(args.output_ply)
    os.makedirs(os.path.dirname(ply_path), exist_ok=True)
    count = write_ply(ply_path, all_gaussians)
    ply_kb = os.path.getsize(ply_path) / 1024
    print(f"\nPLY: {ply_path} ({count} Gaussians, {ply_kb:.1f} KB)")

    # Generate collision grid
    collision = generate_collision_grid()
    walkable = sum(1 for s in collision["solid"] if not s)
    print(f"Collision: {COLLISION_WIDTH}x{COLLISION_HEIGHT}, walkable={walkable}")

    # Build scene
    scene = build_scene(collision)

    scene_path = os.path.abspath(args.output_scene)
    os.makedirs(os.path.dirname(scene_path), exist_ok=True)
    with open(scene_path, "w") as f:
        json.dump(scene, f, indent=2)
    print(f"Scene: {scene_path}")


if __name__ == "__main__":
    main()
