#!/usr/bin/env python3
"""Generate a test PLY and scene JSON demonstrating emissive Gaussians.

Creates a small voxel scene with:
- A ground plane (non-emissive, gray)
- Glowing pillars (emissive, colored)
- A point light to show contact shadows
"""

import struct
import json
import os

def write_ply(path, gaussians):
    """Write a binary PLY with emission property."""
    with open(path, 'wb') as f:
        header = (
            "ply\n"
            "format binary_little_endian 1.0\n"
            f"element vertex {len(gaussians)}\n"
            "property float x\n"
            "property float y\n"
            "property float z\n"
            "property float scale_0\n"
            "property float scale_1\n"
            "property float scale_2\n"
            "property float rot_0\n"
            "property float rot_1\n"
            "property float rot_2\n"
            "property float rot_3\n"
            "property float f_dc_0\n"
            "property float f_dc_1\n"
            "property float f_dc_2\n"
            "property float opacity\n"
            "property float emission\n"
            "end_header\n"
        )
        f.write(header.encode('ascii'))

        import math
        SH_C0 = 0.28209479177387814

        for g in gaussians:
            x, y, z = g['pos']
            sx, sy, sz = [math.log(s) for s in g.get('scale', [0.5, 0.5, 0.5])]
            r, gc, b = g.get('color', [0.5, 0.5, 0.5])
            # Convert linear RGB to SH DC
            dc0 = (r - 0.5) / SH_C0
            dc1 = (gc - 0.5) / SH_C0
            dc2 = (b - 0.5) / SH_C0
            opacity = g.get('opacity', 0.95)
            # Logit encode opacity
            op = max(1e-6, min(1 - 1e-6, opacity))
            logit_op = math.log(op / (1 - op))
            emission = g.get('emission', 0.0)

            f.write(struct.pack('<15f',
                x, y, z,
                sx, sy, sz,
                1.0, 0.0, 0.0, 0.0,  # quaternion (identity)
                dc0, dc1, dc2,
                logit_op,
                emission,
            ))

    print(f"Wrote {len(gaussians)} Gaussians to {path}")


def main():
    gaussians = []

    # Ground plane: 32x32 grid of non-emissive gray voxels
    for x in range(0, 32):
        for z in range(0, 32):
            gaussians.append({
                'pos': [x * 2.0, 0.0, z * 2.0],
                'scale': [1.0, 0.2, 1.0],
                'color': [0.35, 0.35, 0.35],
                'opacity': 0.95,
                'emission': 0.0,
            })

    # Tall pillars (non-emissive, for shadow casting)
    for px, pz in [(10, 10), (20, 20), (30, 10), (10, 30)]:
        for y in range(1, 8):
            gaussians.append({
                'pos': [px * 2.0, y * 2.0, pz * 2.0],
                'scale': [1.0, 1.0, 1.0],
                'color': [0.5, 0.45, 0.4],
                'opacity': 0.95,
                'emission': 0.0,
            })

    # Emissive pillars - glowing neon colors!
    emissive_configs = [
        # (x, z, color, emission_strength)
        (16, 16, [1.0, 0.2, 0.2], 3.0),    # Red glow
        (24, 16, [0.2, 1.0, 0.3], 3.0),    # Green glow
        (16, 24, [0.3, 0.4, 1.0], 3.0),    # Blue glow
        (24, 24, [1.0, 0.8, 0.2], 4.0),    # Golden glow (brighter)
        (20, 12, [1.0, 0.3, 0.8], 2.0),    # Pink glow
        (20, 28, [0.2, 0.9, 0.9], 2.0),    # Cyan glow
    ]

    for px, pz, color, em in emissive_configs:
        for y in range(1, 5):
            gaussians.append({
                'pos': [px * 2.0, y * 2.0, pz * 2.0],
                'scale': [0.8, 0.8, 0.8],
                'color': color,
                'opacity': 0.9,
                'emission': em,
            })

    # Write PLY
    ply_path = os.path.join(os.path.dirname(__file__), '..', 'assets', 'maps', 'emissive_test.ply')
    ply_path = os.path.abspath(ply_path)
    write_ply(ply_path, gaussians)

    # Write scene JSON
    scene = {
        "ambient_color": [0.15, 0.15, 0.2, 1],  # Dark ambient for dramatic lighting
        "static_lights": [
            {
                "position": [32, 32],
                "radius": 80,
                "height": 20,
                "color": [1.0, 0.95, 0.8],
                "intensity": 3
            },
            {
                "position": [20, 50],
                "radius": 60,
                "height": 15,
                "color": [0.6, 0.7, 1.0],
                "intensity": 2
            }
        ],
        "player_position": [0, 0, 0],
        "player_tint": [1, 1, 1, 1],
        "player_facing": "down",
        "torch_emitter": {"spawn_rate":0,"particle_lifetime_min":0.5,"particle_lifetime_max":1.5,"velocity_min":[-0.5,-0.5],"velocity_max":[0.5,0.5],"acceleration":[0,0],"size_min":1,"size_max":2,"size_end_scale":0.5,"color_start":[1,1,1,1],"color_end":[1,1,1,0],"tile":"","z":0,"spawn_offset_min":[0,0],"spawn_offset_max":[0,0]},
        "footstep_emitter": {"spawn_rate":0,"particle_lifetime_min":0.5,"particle_lifetime_max":1.5,"velocity_min":[-0.5,-0.5],"velocity_max":[0.5,0.5],"acceleration":[0,0],"size_min":1,"size_max":2,"size_end_scale":0.5,"color_start":[1,1,1,1],"color_end":[1,1,1,0],"tile":"","z":0,"spawn_offset_min":[0,0],"spawn_offset_max":[0,0]},
        "npc_aura_emitter": {"spawn_rate":0,"particle_lifetime_min":0.5,"particle_lifetime_max":1.5,"velocity_min":[-0.5,-0.5],"velocity_max":[0.5,0.5],"acceleration":[0,0],"size_min":1,"size_max":2,"size_end_scale":0.5,"color_start":[1,1,1,1],"color_end":[1,1,1,0],"tile":"","z":0,"spawn_offset_min":[0,0],"spawn_offset_max":[0,0]},
        "gaussian_splat": {
            "ply_file": "assets/maps/emissive_test.ply",
            "camera": {
                "position": [32, 40, 80],
                "target": [32, 4, 32],
                "fov": 45
            },
            "render_width": 320,
            "render_height": 240,
            "scale_multiplier": 1,
            "background_image": "",
            "parallax": {
                "azimuth_range": 15,
                "elevation_min": -5,
                "elevation_max": 5,
                "distance_range": 2,
                "parallax_strength": 1
            }
        }
    }

    scene_path = os.path.join(os.path.dirname(__file__), '..', 'assets', 'scenes', 'emissive_test.json')
    scene_path = os.path.abspath(scene_path)
    with open(scene_path, 'w') as f:
        json.dump(scene, f, indent=2)
    print(f"Wrote scene to {scene_path}")

    print(f"\nTo run: cd build/macos-release && ./gseurat_demo --scene assets/scenes/emissive_test.json")
    print("Press L twice for point light mode to see shadows + emissive bloom")


if __name__ == '__main__':
    main()
