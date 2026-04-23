#!/usr/bin/env python3
"""Migrate CollisionGrid data to primitive Box colliders.

Converts solid[] cells to Box collider game objects using greedy rectangle
merging. Optionally migrates nav_zone[] to NavZoneVolume trigger boxes and
light_probe[] to LightProbe point entities.

Usage:
    python3 scripts/migrate_collision_grid.py <scene.json> [options]

Options:
    --output <path>         Write to separate file (default: overwrite input)
    --remove-grid           Remove the "collision" field after migration
    --skip-nav-zones        Don't migrate nav_zone data
    --skip-light-probes     Don't migrate light_probe data
    --probe-block-size N    Downsample probes to NxN blocks (default: 4)
    --dry-run               Print statistics without modifying files
"""

import argparse
import json
import sys
from pathlib import Path


def greedy_merge(grid_width, grid_height, cell_predicate):
    """Merge adjacent cells into rectangles using greedy expansion.

    cell_predicate(x, z) returns True if the cell should be included.
    Returns list of (x, z, width, height) tuples in grid coordinates.
    """
    visited = [[False] * grid_width for _ in range(grid_height)]
    rectangles = []

    for z in range(grid_height):
        for x in range(grid_width):
            if visited[z][x] or not cell_predicate(x, z):
                continue

            # Expand right
            w = 1
            while (x + w < grid_width and
                   not visited[z][x + w] and
                   cell_predicate(x + w, z)):
                w += 1

            # Expand down
            h = 1
            while z + h < grid_height:
                row_ok = True
                for dx in range(w):
                    if visited[z + h][x + dx] or not cell_predicate(x + dx, z + h):
                        row_ok = False
                        break
                if not row_ok:
                    break
                h += 1

            # Mark visited
            for dz in range(h):
                for dx in range(w):
                    visited[z + dz][x + dx] = True

            rectangles.append((x, z, w, h))

    return rectangles


def migrate_solid_cells(collision, cell_size):
    """Convert solid cells to Box collider game objects.

    CRITICAL: Only merges cells with matching elevation to preserve
    terrain topology (stairs, steps, slopes).
    """
    width = collision['width']
    height = collision['height']
    solid = collision.get('solid', [])
    elevation = collision.get('elevation', [])

    if not solid:
        return []

    game_objects = []
    counter = 1

    # Group cells by elevation value (rounded to avoid float comparison issues)
    def get_elevation(x, z):
        idx = z * width + x
        if idx < len(elevation):
            return round(elevation[idx], 4)
        return 0.0

    # Find all unique elevations for solid cells
    elevation_groups = {}
    for z in range(height):
        for x in range(width):
            idx = z * width + x
            if idx < len(solid) and solid[idx]:
                elev = get_elevation(x, z)
                if elev not in elevation_groups:
                    elevation_groups[elev] = True

    # For each elevation, run greedy merge
    visited_global = [[False] * width for _ in range(height)]

    for elev in sorted(elevation_groups.keys()):
        def predicate(x, z, _elev=elev):
            if visited_global[z][x]:
                return False
            idx = z * width + x
            if idx >= len(solid) or not solid[idx]:
                return False
            return get_elevation(x, z) == _elev

        rects = greedy_merge(width, height, predicate)

        for (rx, rz, rw, rh) in rects:
            # Mark globally visited
            for dz in range(rh):
                for dx in range(rw):
                    visited_global[rz + dz][rx + dx] = True

            # Compute box position (center of rectangle, in grid coords)
            cx = (rx + rw / 2.0) * cell_size
            cz = (rz + rh / 2.0) * cell_size
            cy = elev - 0.25  # Top of box aligns with grid elevation

            # Half extents
            hex_ = (rw * cell_size) / 2.0
            hez = (rh * cell_size) / 2.0
            hey = 0.25  # 0.5 units thick floor slab

            game_objects.append({
                'id': f'migrated_floor_{counter:03d}',
                'name': 'Floor (migrated)',
                'position': [round(cx, 4), round(cy, 4), round(cz, 4)],
                'components': {
                    'ColliderComponent': {
                        'shape': {
                            'type': 'box',
                            'half_extents': [round(hex_, 4), round(hey, 4), round(hez, 4)]
                        },
                        'is_trigger': False
                    }
                }
            })
            counter += 1

    return game_objects


def migrate_nav_zones(collision, cell_size):
    """Convert nav_zone[] to NavZoneVolume trigger boxes."""
    width = collision['width']
    height = collision['height']
    nav_zones = collision.get('nav_zone', [])

    if not nav_zones:
        return []

    game_objects = []

    # Find unique non-zero zone IDs
    zone_ids = set()
    for z_val in nav_zones:
        if z_val > 0:
            zone_ids.add(z_val)

    for zone_id in sorted(zone_ids):
        counter = 1

        def predicate(x, z, _zone_id=zone_id):
            idx = z * width + x
            return idx < len(nav_zones) and nav_zones[idx] == _zone_id

        rects = greedy_merge(width, height, predicate)

        for (rx, rz, rw, rh) in rects:
            cx = (rx + rw / 2.0) * cell_size
            cz = (rz + rh / 2.0) * cell_size
            cy = 1.0  # Center of trigger volume

            hex_ = (rw * cell_size) / 2.0
            hez = (rh * cell_size) / 2.0
            hey = 2.0  # Tall enough for walking entities

            game_objects.append({
                'id': f'migrated_navzone_{zone_id}_{counter:03d}',
                'name': f'NavZone {zone_id} (migrated)',
                'position': [round(cx, 4), round(cy, 4), round(cz, 4)],
                'components': {
                    'ColliderComponent': {
                        'shape': {
                            'type': 'box',
                            'half_extents': [round(hex_, 4), round(hey, 4), round(hez, 4)]
                        },
                        'is_trigger': True
                    },
                    'NavZoneVolume': {
                        'zone_id': zone_id
                    }
                }
            })
            counter += 1

    return game_objects


def migrate_light_probes(collision, cell_size, block_size=4):
    """Convert light_probe[] to LightProbe point entities with downsampling."""
    width = collision['width']
    height = collision['height']
    probes = collision.get('light_probe', [])

    if not probes:
        return []

    game_objects = []
    counter = 1
    default_color = [0.5, 0.5, 0.5]

    # Downsample: average colors in block_size x block_size blocks
    for bz in range(0, height, block_size):
        for bx in range(0, width, block_size):
            r_sum, g_sum, b_sum = 0.0, 0.0, 0.0
            count = 0
            has_non_default = False

            for dz in range(min(block_size, height - bz)):
                for dx in range(min(block_size, width - bx)):
                    idx = (bz + dz) * width + (bx + dx)
                    pi = idx * 3
                    if pi + 2 < len(probes):
                        r, g, b = probes[pi], probes[pi + 1], probes[pi + 2]
                        r_sum += r
                        g_sum += g
                        b_sum += b
                        count += 1
                        if abs(r - 0.5) > 0.01 or abs(g - 0.5) > 0.01 or abs(b - 0.5) > 0.01:
                            has_non_default = True

            if count == 0 or not has_non_default:
                continue

            avg_r = r_sum / count
            avg_g = g_sum / count
            avg_b = b_sum / count

            cx = (bx + min(block_size, width - bx) / 2.0) * cell_size
            cz = (bz + min(block_size, height - bz) / 2.0) * cell_size

            game_objects.append({
                'id': f'migrated_probe_{counter:03d}',
                'name': 'LightProbe (migrated)',
                'position': [round(cx, 4), 0.0, round(cz, 4)],
                'components': {
                    'LightProbe': {
                        'color': [round(avg_r, 4), round(avg_g, 4), round(avg_b, 4)]
                    }
                }
            })
            counter += 1

    return game_objects


def main():
    parser = argparse.ArgumentParser(description='Migrate CollisionGrid to primitive colliders')
    parser.add_argument('scene', help='Path to scene JSON file')
    parser.add_argument('--output', help='Output path (default: overwrite input)')
    parser.add_argument('--remove-grid', action='store_true', help='Remove collision field after migration')
    parser.add_argument('--skip-nav-zones', action='store_true')
    parser.add_argument('--skip-light-probes', action='store_true')
    parser.add_argument('--probe-block-size', type=int, default=4)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    scene_path = Path(args.scene)
    with open(scene_path, 'r') as f:
        scene = json.load(f)

    collision = scene.get('collision')
    if not collision:
        print('No collision field found in scene. Nothing to migrate.')
        return

    cell_size = collision.get('cell_size', 1.0)

    # Migrate
    floor_objects = migrate_solid_cells(collision, cell_size)
    nav_objects = [] if args.skip_nav_zones else migrate_nav_zones(collision, cell_size)
    probe_objects = [] if args.skip_light_probes else migrate_light_probes(collision, cell_size, args.probe_block_size)

    total = len(floor_objects) + len(nav_objects) + len(probe_objects)

    print(f'Migration results:')
    print(f'  Floor colliders: {len(floor_objects)}')
    print(f'  Nav zone volumes: {len(nav_objects)}')
    print(f'  Light probes: {len(probe_objects)}')
    print(f'  Total entities: {total}')

    if args.dry_run:
        print('(dry run — no files modified)')
        return

    # Append to game_objects
    if 'game_objects' not in scene:
        scene['game_objects'] = []
    scene['game_objects'].extend(floor_objects)
    scene['game_objects'].extend(nav_objects)
    scene['game_objects'].extend(probe_objects)

    if args.remove_grid:
        del scene['collision']
        print('  Removed collision field.')

    output_path = Path(args.output) if args.output else scene_path
    with open(output_path, 'w') as f:
        json.dump(scene, f, indent=2)

    print(f'  Written to: {output_path}')


if __name__ == '__main__':
    main()
