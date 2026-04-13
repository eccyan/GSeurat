#!/usr/bin/env python3
"""Generate the Underground Dungeon terrain PLY + collision + scene JSON.

The dungeon is an isolated instance accessed via a portal near the house on
Seurat Island. It has stone corridors, rooms with torches and treasure, and
a return portal back to the overworld.

Local coordinate space: 50×50 units. Entrance at (5, 0, 5), exit portal
near (45, 0, 45).
"""

import argparse
import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ply_utils import write_ply

# Dungeon grid dimensions
DUNGEON_SIZE = 50  # 50×50 units
WALL_HEIGHT = 6.0
STEP = 0.5

# Colors
COLOR_STONE_FLOOR = (0.25, 0.22, 0.20)
COLOR_STONE_WALL = (0.30, 0.27, 0.24)
COLOR_STONE_DARK = (0.15, 0.13, 0.12)
COLOR_TORCH_GLOW = (0.9, 0.5, 0.1)
COLOR_CRYSTAL = (0.3, 0.1, 0.8)
COLOR_GOLD = (0.85, 0.7, 0.2)
COLOR_MOSS_DARK = (0.1, 0.18, 0.08)


def lerp_color(c1, c2, t):
    t = max(0.0, min(1.0, t))
    return (
        c1[0] + (c2[0] - c1[0]) * t,
        c1[1] + (c2[1] - c1[1]) * t,
        c1[2] + (c2[2] - c1[2]) * t,
    )


# Room definitions: (x_min, z_min, x_max, z_max, name)
ROOMS = [
    (2, 2, 12, 12, "entrance"),        # Entrance room (spawn at 5,5)
    (18, 2, 32, 16, "main_hall"),       # Main hall
    (36, 2, 48, 14, "armory"),          # Armory
    (18, 22, 32, 36, "treasure"),       # Treasure room
    (36, 28, 48, 48, "exit"),           # Exit room (return portal at 45,45)
    (2, 22, 12, 36, "prison"),          # Prison cells
]

# Corridors: (x_min, z_min, x_max, z_max)
CORRIDORS = [
    (12, 5, 18, 9),      # Entrance → Main Hall
    (32, 5, 36, 9),      # Main Hall → Armory
    (24, 16, 28, 22),    # Main Hall → Treasure
    (32, 30, 36, 34),    # Treasure → Exit (via side)
    (28, 30, 36, 34),    # Treasure → Exit
    (12, 27, 18, 31),    # Prison → Main Hall (via south)
    (18, 36, 22, 42),    # Extension south
    (22, 38, 36, 42),    # Extension east to exit area
    (36, 38, 40, 48),    # Final approach to exit (north)
]


def is_room(x, z):
    """Check if (x, z) is inside a room. Returns room name or None."""
    for rx1, rz1, rx2, rz2, name in ROOMS:
        if rx1 <= x <= rx2 and rz1 <= z <= rz2:
            return name
    return None


def is_corridor(x, z):
    """Check if (x, z) is inside a corridor."""
    for cx1, cz1, cx2, cz2 in CORRIDORS:
        if cx1 <= x <= cx2 and cz1 <= z <= cz2:
            return True
    return False


def is_walkable_area(x, z):
    """Check if position is in a room or corridor."""
    return is_room(x, z) is not None or is_corridor(x, z)


def generate_floor():
    """Generate the stone floor for all rooms and corridors."""
    rng = random.Random(1111)
    gaussians = []

    x = 0.0
    while x <= DUNGEON_SIZE:
        z = 0.0
        while z <= DUNGEON_SIZE:
            if not is_walkable_area(x, z):
                z += STEP
                continue

            # Floor tile color with variation
            room = is_room(x, z)
            if room == "treasure":
                base = lerp_color(COLOR_STONE_FLOOR, COLOR_GOLD, 0.1)
            elif room == "exit":
                base = lerp_color(COLOR_STONE_FLOOR, COLOR_CRYSTAL, 0.05)
            else:
                base = COLOR_STONE_FLOOR

            noise = rng.uniform(-0.04, 0.04)
            color = tuple(max(0.0, min(1.0, c + noise)) for c in base)

            # Occasional moss patches
            if rng.random() < 0.08:
                color = lerp_color(color, COLOR_MOSS_DARK, rng.uniform(0.3, 0.6))

            gaussians.append({
                "pos": (x, 0.0, z),
                "color": color,
                "scale": 0.5,
                "opacity": 1.0,
            })
            z += STEP
        x += STEP

    return gaussians


def generate_walls():
    """Generate walls around rooms and corridors."""
    rng = random.Random(2222)
    gaussians = []

    # For each grid position, if it's NOT walkable but adjacent to a walkable area, it's a wall
    wall_step = 0.5
    x = 0.0
    while x <= DUNGEON_SIZE:
        z = 0.0
        while z <= DUNGEON_SIZE:
            if is_walkable_area(x, z):
                z += wall_step
                continue

            # Check if adjacent to walkable area
            adjacent = False
            for dx, dz in [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, 1), (-1, 1), (1, -1)]:
                if is_walkable_area(x + dx, z + dz):
                    adjacent = True
                    break

            if not adjacent:
                z += wall_step
                continue

            # Wall column from floor to ceiling
            y = 0.0
            while y <= WALL_HEIGHT:
                noise = rng.uniform(-0.03, 0.03)
                # Darker at bottom, lighter at top
                t = y / WALL_HEIGHT
                base = lerp_color(COLOR_STONE_DARK, COLOR_STONE_WALL, t)
                color = tuple(max(0.0, min(1.0, c + noise)) for c in base)

                gaussians.append({
                    "pos": (x, y, z),
                    "color": color,
                    "scale": 0.45,
                    "opacity": 1.0,
                })
                y += wall_step
            z += wall_step
        x += wall_step

    return gaussians


def generate_ceiling():
    """Generate ceiling over rooms and corridors."""
    rng = random.Random(3333)
    gaussians = []

    x = 0.0
    while x <= DUNGEON_SIZE:
        z = 0.0
        while z <= DUNGEON_SIZE:
            if not is_walkable_area(x, z):
                z += STEP * 2
                continue

            noise = rng.uniform(-0.03, 0.03)
            color = tuple(max(0.0, min(1.0, c + noise)) for c in COLOR_STONE_DARK)

            gaussians.append({
                "pos": (x, WALL_HEIGHT, z),
                "color": color,
                "scale": 0.5,
                "opacity": 1.0,
            })
            z += STEP * 2  # sparser ceiling
        x += STEP * 2

    return gaussians


def generate_torches():
    """Generate wall-mounted torch props."""
    rng = random.Random(4444)
    gaussians = []

    # Torch positions along corridors and rooms
    positions = [
        # Entrance room
        (3, 3), (11, 3), (3, 11), (11, 11),
        # Main Hall
        (19, 3), (31, 3), (19, 15), (31, 15), (25, 9),
        # Corridors
        (15, 7), (34, 7),
        # Treasure room
        (19, 23), (31, 23), (19, 35), (31, 35),
        # Exit room
        (37, 29), (47, 29), (37, 47), (47, 47),
        # Prison
        (3, 23), (11, 23), (3, 35), (11, 35),
    ]

    for tx, tz in positions:
        # Torch bracket (small dark shape on wall)
        ty = 3.5
        for _ in range(5):
            gaussians.append({
                "pos": (tx + rng.uniform(-0.1, 0.1), ty + rng.uniform(-0.2, 0.2),
                        tz + rng.uniform(-0.1, 0.1)),
                "color": (0.15, 0.1, 0.05),
                "scale": 0.15,
                "opacity": 1.0,
            })

        # Flame (warm glow)
        flame_y = ty + 0.4
        for _ in range(12):
            fy = flame_y + rng.uniform(0, 0.5)
            gaussians.append({
                "pos": (tx + rng.uniform(-0.15, 0.15), fy,
                        tz + rng.uniform(-0.15, 0.15)),
                "color": (
                    0.9 + rng.uniform(-0.1, 0.1),
                    0.4 + rng.uniform(-0.1, 0.2),
                    0.05 + rng.uniform(0, 0.1),
                ),
                "scale": 0.12,
                "opacity": 0.8,
            })

    return gaussians, positions


def generate_treasure():
    """Generate treasure piles in the treasure room."""
    rng = random.Random(5555)
    gaussians = []

    # Gold pile centers
    piles = [(22, 26), (28, 26), (25, 32), (22, 32), (28, 32)]

    for px, pz in piles:
        # Pile of gold coins/gems
        for _ in range(40):
            dx = rng.uniform(-1.0, 1.0)
            dz = rng.uniform(-1.0, 1.0)
            dy = rng.uniform(0, 0.8) * max(0, 1.0 - (dx * dx + dz * dz))

            if rng.random() < 0.7:
                color = lerp_color(COLOR_GOLD, (0.95, 0.8, 0.3), rng.uniform(0, 0.4))
            else:
                # Gems: red, blue, green
                gem = rng.choice([
                    (0.8, 0.1, 0.15),
                    (0.15, 0.2, 0.85),
                    (0.1, 0.75, 0.2),
                ])
                color = gem

            gaussians.append({
                "pos": (px + dx, dy, pz + dz),
                "color": color,
                "scale": 0.15,
                "opacity": 1.0,
            })

    return gaussians


def generate_exit_portal_visual():
    """Generate a glowing archway for the return portal."""
    rng = random.Random(6666)
    gaussians = []

    # Portal arch at (45, 0, 42)
    cx, cz = 45.0, 42.0
    arch_height = 4.0
    arch_width = 2.5

    # Archway stones
    for angle_deg in range(0, 181, 5):
        angle = math.radians(angle_deg)
        ax = cx + arch_width * math.cos(angle)
        ay = arch_height * math.sin(angle)
        for depth in range(3):
            dz = cz + (depth - 1) * 0.4
            gaussians.append({
                "pos": (ax, ay, dz),
                "color": (0.35, 0.3, 0.4),
                "scale": 0.35,
                "opacity": 1.0,
            })

    # Glowing portal surface inside the arch
    for _ in range(80):
        while True:
            dx = rng.uniform(-1, 1)
            dy = rng.uniform(0, 1)
            if dx * dx + dy * dy <= 1.0:
                break
        gaussians.append({
            "pos": (cx + dx * arch_width * 0.8, dy * arch_height * 0.9, cz),
            "color": (
                0.2 + rng.random() * 0.2,
                0.4 + rng.random() * 0.3,
                0.8 + rng.random() * 0.2,
            ),
            "scale": 0.3,
            "opacity": 0.6,
        })

    return gaussians


def generate_prison_details():
    """Generate iron bars and chains in the prison room."""
    rng = random.Random(7777)
    gaussians = []

    # Iron bar cells — vertical bars across prison sub-rooms
    bar_positions_x = [7.0]
    for bx in bar_positions_x:
        for bz_start, bz_end in [(24, 29), (30, 35)]:
            z = float(bz_start)
            while z <= bz_end:
                # Vertical bar
                y = 0.0
                while y <= WALL_HEIGHT:
                    gaussians.append({
                        "pos": (bx, y, z),
                        "color": (0.2, 0.18, 0.16),
                        "scale": 0.1,
                        "opacity": 1.0,
                    })
                    y += 0.3
                z += 1.5  # bar spacing

    # Chains hanging from ceiling
    chain_positions = [(4, 26), (10, 33), (5, 31)]
    for chx, chz in chain_positions:
        y = WALL_HEIGHT
        while y > 2.0:
            gaussians.append({
                "pos": (chx + rng.uniform(-0.05, 0.05), y,
                        chz + rng.uniform(-0.05, 0.05)),
                "color": (0.22, 0.2, 0.18),
                "scale": 0.08,
                "opacity": 1.0,
            })
            y -= 0.25

    return gaussians


def generate_collision_grid():
    """Generate collision grid for the dungeon."""
    cell_size = 1.0
    width = DUNGEON_SIZE
    height = DUNGEON_SIZE

    solid = []
    elevation = []

    for gz in range(height):
        for gx in range(width):
            wx = gx + 0.5
            wz = gz + 0.5
            walkable = is_walkable_area(wx, wz)
            solid.append(not walkable)
            elevation.append(0.0 if walkable else -1.0)

    return {
        "width": width,
        "height": height,
        "cell_size": cell_size,
        "solid": solid,
        "elevation": elevation,
    }


def build_scene(collision, torch_positions):
    """Build the scene JSON for the dungeon."""

    game_objects = []

    # Torches with light components
    for i, (tx, tz) in enumerate(torch_positions):
        game_objects.append({
            "id": f"dungeon_torch_{i + 1}",
            "name": "Dungeon Torch",
            "position": [tx, 3.5, tz],
            "rotation": [0, 0, 0],
            "scale": 1.0,
            "components": {
                "ProximityTrigger": {"radius": 999},
                "EmitterToggle": {"emitter_index": i},
                "LightToggle": {
                    "color_r": 1.0,
                    "color_g": 0.5,
                    "color_b": 0.1,
                    "radius": 12,
                    "intensity": 2.5,
                },
            },
        })

    # Treasure chests in treasure room
    chest_positions = [(22, 28), (28, 28), (25, 34)]
    for i, (cx, cz) in enumerate(chest_positions):
        game_objects.append({
            "id": f"dungeon_chest_{i + 1}",
            "name": "Treasure Chest",
            "position": [cx, 0, cz],
            "rotation": [0, 0, 0],
            "scale": 1.0,
            "components": {
                "ProximityTrigger": {"radius": 3, "one_shot": True},
                "BurstEffect": {"emitter_index": len(torch_positions) + i},
                "ScatterEffect": {"radius": 1.0, "lifetime": 2.0},
            },
        })

    # Glowing crystals in prison
    crystal_positions = [(5, 25), (9, 33)]
    for i, (cx, cz) in enumerate(crystal_positions):
        game_objects.append({
            "id": f"dungeon_crystal_{i + 1}",
            "name": "Prison Crystal",
            "position": [cx, 1.0, cz],
            "rotation": [0, 0, 0],
            "scale": 1.0,
            "components": {
                "ProximityTrigger": {"radius": 6},
                "EmissiveToggle": {
                    "emission": 6.0,
                    "color_r": 0.3,
                    "color_g": 0.1,
                    "color_b": 0.8,
                    "effect_radius": 8.0,
                },
            },
        })

    # Exit portal marker (visual hint)
    game_objects.append({
        "id": "exit_portal_glow",
        "name": "Portal Archway",
        "position": [45, 2, 42],
        "rotation": [0, 0, 0],
        "scale": 1.0,
        "components": {
            "ProximityTrigger": {"radius": 999},
            "EmissiveToggle": {
                "emission": 8.0,
                "color_r": 0.3,
                "color_g": 0.5,
                "color_b": 1.0,
                "effect_radius": 10.0,
            },
        },
    })

    # NPC: skeleton guard in armory
    game_objects.append({
        "id": "skeleton_guard",
        "name": "Skeleton",
        "position": [42, 0, 8],
        "rotation": [0, 0, 0],
        "scale": 1.0,
        "components": {
            "NpcWalker": {"wander_radius": 5, "speed": 1.0},
        },
    })

    # Particle emitters: torch fires + chest bursts
    emitters = []
    for tx, tz in torch_positions:
        emitters.append({
            "preset": "bonfire",
            "position": [tx, 3.8, tz],
        })

    for cx, cz in chest_positions:
        emitters.append({
            "preset": "sparkle",
            "position": [cx, 0.5, cz],
            "spawn_rate": 0,
        })

    scene = {
        "version": 2,
        "gaussian_splat": {
            "ply_file": "assets/maps/dungeon.ply",
            "camera": {
                "position": [25, 20, 40],
                "target": [25, 0, 25],
                "fov": 45,
            },
            "render_width": 1280,
            "render_height": 720,
            "scale_multiplier": 1.0,
            "ground_color": [0.1, 0.08, 0.06],
            "sky_color": [0.05, 0.04, 0.03],
        },
        "collision": collision,
        "ambient_color": [0.15, 0.12, 0.10, 1.0],
        "lights": [
            {
                "position": [7, 4, 7],
                "color": [1.0, 0.6, 0.2],
                "radius": 20,
                "intensity": 2.0,
            },
            {
                "position": [25, 4, 9],
                "color": [1.0, 0.6, 0.2],
                "radius": 25,
                "intensity": 2.0,
            },
            {
                "position": [25, 4, 29],
                "color": [1.0, 0.5, 0.15],
                "radius": 25,
                "intensity": 2.0,
            },
            {
                "position": [42, 4, 38],
                "color": [0.5, 0.6, 1.0],
                "radius": 25,
                "intensity": 2.5,
            },
        ],
        "player": {
            "position": [5, 0, 5],
            "facing": "down",
        },
        "game_objects": game_objects,
        "particle_emitters": emitters,
    }

    return scene


def main():
    parser = argparse.ArgumentParser(description="Generate Underground Dungeon terrain + scene")
    parser.add_argument("--output-ply", default="assets/maps/dungeon.ply")
    parser.add_argument("--output-scene", default="assets/scenes/dungeon.json")
    args = parser.parse_args()

    print("Generating Underground Dungeon...")

    floor = generate_floor()
    print(f"  Floor: {len(floor)} Gaussians")

    walls = generate_walls()
    print(f"  Walls: {len(walls)} Gaussians")

    ceiling = generate_ceiling()
    print(f"  Ceiling: {len(ceiling)} Gaussians")

    torches_gs, torch_positions = generate_torches()
    print(f"  Torches: {len(torches_gs)} Gaussians ({len(torch_positions)} torches)")

    treasure = generate_treasure()
    print(f"  Treasure: {len(treasure)} Gaussians")

    portal = generate_exit_portal_visual()
    print(f"  Exit portal: {len(portal)} Gaussians")

    prison = generate_prison_details()
    print(f"  Prison: {len(prison)} Gaussians")

    all_gaussians = floor + walls + ceiling + torches_gs + treasure + portal + prison
    print(f"  Total: {len(all_gaussians)} Gaussians")

    # Write PLY
    ply_path = os.path.abspath(args.output_ply)
    os.makedirs(os.path.dirname(ply_path), exist_ok=True)
    count = write_ply(ply_path, all_gaussians)
    ply_kb = os.path.getsize(ply_path) / 1024
    print(f"\nPLY: {ply_path} ({count} Gaussians, {ply_kb:.1f} KB)")

    # Collision
    collision = generate_collision_grid()
    walkable = sum(1 for s in collision["solid"] if not s)
    print(f"Collision: {DUNGEON_SIZE}x{DUNGEON_SIZE}, walkable={walkable}")

    # Scene
    scene = build_scene(collision, torch_positions)
    scene_path = os.path.abspath(args.output_scene)
    os.makedirs(os.path.dirname(scene_path), exist_ok=True)
    with open(scene_path, "w") as f:
        json.dump(scene, f, indent=2)
    print(f"Scene: {scene_path}")


if __name__ == "__main__":
    main()
