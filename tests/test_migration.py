#!/usr/bin/env python3
"""Unit tests for collision grid migration script."""

import json
import sys
import tempfile
from pathlib import Path

# Add scripts/ to path so we can import the migration module
sys.path.insert(0, str(Path(__file__).parent.parent / 'scripts'))

from migrate_collision_grid import (
    greedy_merge,
    migrate_solid_cells,
    migrate_nav_zones,
    migrate_light_probes,
)

passed = 0
failed = 0


def check(cond, msg):
    global passed, failed
    if cond:
        print(f'  PASS: {msg}')
        passed += 1
    else:
        print(f'  FAIL: {msg}')
        failed += 1


def test_greedy_merge_single_block():
    """4x4 block of solid cells at same elevation → 1 rectangle."""
    def pred(x, z):
        return 0 <= x < 4 and 0 <= z < 4
    rects = greedy_merge(8, 8, pred)
    check(len(rects) == 1, 'single 4x4 block → 1 rectangle')
    check(rects[0] == (0, 0, 4, 4), 'rectangle is (0,0,4,4)')


def test_greedy_merge_two_separated():
    """Two 2x2 blocks → 2 rectangles."""
    def pred(x, z):
        return (0 <= x < 2 and 0 <= z < 2) or (5 <= x < 7 and 5 <= z < 7)
    rects = greedy_merge(8, 8, pred)
    check(len(rects) == 2, 'two separated blocks → 2 rectangles')


def test_elevation_constraint():
    """Adjacent cells with different elevations → separate boxes."""
    collision = {
        'width': 4, 'height': 1, 'cell_size': 1.0,
        'solid': [True, True, True, True],
        'elevation': [0.0, 0.0, 2.0, 2.0],  # Two different elevations
    }
    objects = migrate_solid_cells(collision, 1.0)
    check(len(objects) == 2, 'different elevations → 2 separate boxes')


def test_elevation_same():
    """Adjacent cells with same elevation → merged into 1 box."""
    collision = {
        'width': 4, 'height': 1, 'cell_size': 1.0,
        'solid': [True, True, True, True],
        'elevation': [1.0, 1.0, 1.0, 1.0],
    }
    objects = migrate_solid_cells(collision, 1.0)
    check(len(objects) == 1, 'same elevation → 1 merged box')


def test_box_position_and_extents():
    """Verify position and half_extents of a simple merged box."""
    collision = {
        'width': 4, 'height': 2, 'cell_size': 2.0,
        'solid': [True, True, True, True, True, True, True, True],
        'elevation': [0.0] * 8,
    }
    objects = migrate_solid_cells(collision, 2.0)
    check(len(objects) == 1, '4x2 grid → 1 box')

    obj = objects[0]
    shape = obj['components']['ColliderComponent']['shape']
    check(shape['type'] == 'box', 'shape is box')
    # half_extents.x = (4 * 2.0) / 2 = 4.0
    check(abs(shape['half_extents'][0] - 4.0) < 0.01, 'half_extents.x = 4.0')
    # half_extents.y = 0.25 (floor slab)
    check(abs(shape['half_extents'][1] - 0.25) < 0.01, 'half_extents.y = 0.25')
    # half_extents.z = (2 * 2.0) / 2 = 2.0
    check(abs(shape['half_extents'][2] - 2.0) < 0.01, 'half_extents.z = 2.0')


def test_single_isolated_cell():
    """Single solid cell → 1 box."""
    solid = [False] * 64
    solid[27] = True  # (3, 3) in 8x8
    collision = {
        'width': 8, 'height': 8, 'cell_size': 1.0,
        'solid': solid, 'elevation': [0.0] * 64,
    }
    objects = migrate_solid_cells(collision, 1.0)
    check(len(objects) == 1, 'single cell → 1 box')


def test_nav_zone_migration():
    """Nav zones produce trigger boxes with zone IDs."""
    collision = {
        'width': 4, 'height': 4, 'cell_size': 1.0,
        'solid': [False] * 16,
        'nav_zone': [0,0,3,3, 0,0,3,3, 0,0,0,0, 0,0,0,0],
    }
    objects = migrate_nav_zones(collision, 1.0)
    check(len(objects) == 1, 'one nav zone group → 1 trigger box')
    check(objects[0]['components']['ColliderComponent']['is_trigger'] == True, 'is_trigger = True')
    check(objects[0]['components']['NavZoneVolume']['zone_id'] == 3, 'zone_id = 3')


def test_light_probe_downsampling():
    """4x4 block with non-default probes → 1 entity after downsampling."""
    probes = []
    for _ in range(16):
        probes.extend([0.8, 0.6, 0.4])  # Non-default RGB
    collision = {
        'width': 4, 'height': 4, 'cell_size': 1.0,
        'light_probe': probes,
    }
    objects = migrate_light_probes(collision, 1.0, block_size=4)
    check(len(objects) == 1, '4x4 block with block_size=4 → 1 probe')
    color = objects[0]['components']['LightProbe']['color']
    check(abs(color[0] - 0.8) < 0.01, 'averaged R ≈ 0.8')


def test_dry_run():
    """Dry run doesn't modify files."""
    import subprocess

    scene = {
        'collision': {
            'width': 2, 'height': 2, 'cell_size': 1.0,
            'solid': [True, True, True, True],
            'elevation': [0.0, 0.0, 0.0, 0.0],
        },
        'game_objects': []
    }

    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump(scene, f)
        tmp_path = f.name

    result = subprocess.run(
        [sys.executable, 'scripts/migrate_collision_grid.py', tmp_path, '--dry-run'],
        capture_output=True, text=True,
        cwd=str(Path(__file__).parent.parent)
    )
    check(result.returncode == 0, 'dry-run exits 0')

    with open(tmp_path, 'r') as f:
        after = json.load(f)
    check(len(after.get('game_objects', [])) == 0, 'dry-run: game_objects unchanged')

    Path(tmp_path).unlink()


if __name__ == '__main__':
    print('=== test_migration ===')
    test_greedy_merge_single_block()
    test_greedy_merge_two_separated()
    test_elevation_constraint()
    test_elevation_same()
    test_box_position_and_extents()
    test_single_isolated_cell()
    test_nav_zone_migration()
    test_light_probe_downsampling()
    test_dry_run()
    print(f'\n=== Results: {passed} passed, {failed} failed ===')
    sys.exit(1 if failed > 0 else 0)
