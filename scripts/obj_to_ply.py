#!/usr/bin/env python3
"""
Convert OBJ mesh to Gaussian Splatting-compatible PLY point cloud.

Samples points on mesh faces (weighted by area) and generates
a PLY file with SH DC color coefficients compatible with the
GSeurat engine PLY loader.

Usage: python3 scripts/obj_to_ply.py input.obj output.ply [--points N] [--color R G B]
"""

import struct
import sys
import random
import math
from pathlib import Path


def load_obj(path: str):
    """Load OBJ file, return vertices and face indices."""
    vertices = []
    faces = []
    tex_coords = []

    with open(path, 'r') as f:
        for line in f:
            line = line.strip()
            if line.startswith('v '):
                parts = line.split()
                vertices.append((float(parts[1]), float(parts[2]), float(parts[3])))
            elif line.startswith('vt '):
                parts = line.split()
                tex_coords.append((float(parts[1]), float(parts[2])))
            elif line.startswith('f '):
                parts = line.split()[1:]
                # Parse face indices (OBJ is 1-based, may have v/vt/vn format)
                idx = []
                for p in parts:
                    vi = int(p.split('/')[0]) - 1
                    idx.append(vi)
                # Triangulate if more than 3 vertices
                for i in range(1, len(idx) - 1):
                    faces.append((idx[0], idx[i], idx[i + 1]))

    return vertices, faces


def triangle_area(v0, v1, v2):
    """Calculate area of a triangle."""
    e1 = (v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2])
    e2 = (v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2])
    cross = (
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
    )
    return 0.5 * math.sqrt(cross[0]**2 + cross[1]**2 + cross[2]**2)


def sample_triangle(v0, v1, v2):
    """Sample a random point on a triangle."""
    r1 = random.random()
    r2 = random.random()
    if r1 + r2 > 1:
        r1, r2 = 1 - r1, 1 - r2
    r3 = 1 - r1 - r2
    return (
        v0[0] * r1 + v1[0] * r2 + v2[0] * r3,
        v0[1] * r1 + v1[1] * r2 + v2[1] * r3,
        v0[2] * r1 + v1[2] * r2 + v2[2] * r3,
    )


def sample_mesh(vertices, faces, num_points, color):
    """Sample points on mesh surface, weighted by triangle area."""
    # Calculate cumulative area for weighted sampling
    areas = []
    for f in faces:
        a = triangle_area(vertices[f[0]], vertices[f[1]], vertices[f[2]])
        areas.append(a)

    total_area = sum(areas)
    if total_area == 0:
        print("WARNING: mesh has zero surface area")
        return []

    cum_area = []
    running = 0
    for a in areas:
        running += a / total_area
        cum_area.append(running)

    # Sample points
    points = []
    for _ in range(num_points):
        r = random.random()
        # Binary search for face
        lo, hi = 0, len(cum_area) - 1
        while lo < hi:
            mid = (lo + hi) // 2
            if cum_area[mid] < r:
                lo = mid + 1
            else:
                hi = mid
        fi = lo
        f = faces[fi]
        p = sample_triangle(vertices[f[0]], vertices[f[1]], vertices[f[2]])
        points.append(p)

    return points


def rgb_to_sh_dc(r, g, b):
    """Convert RGB [0,1] to SH DC coefficients (inverse of 0.5 + 0.2820948 * sh)."""
    inv = 1.0 / 0.2820948
    return ((r - 0.5) * inv, (g - 0.5) * inv, (b - 0.5) * inv)


def write_ply(path, points, color):
    """Write points as a GSeurat-compatible binary PLY."""
    sh_r, sh_g, sh_b = rgb_to_sh_dc(color[0], color[1], color[2])
    # Pre-sigmoid opacity (sigmoid(5) ≈ 0.993)
    opacity = 5.0
    # log(scale) — small splats
    log_scale = math.log(0.005)

    num_props = 14  # x,y,z + 3 SH DC + opacity + 3 scale + 4 rotation

    header = f"""ply
format binary_little_endian 1.0
element vertex {len(points)}
property float x
property float y
property float z
property float f_dc_0
property float f_dc_1
property float f_dc_2
property float opacity
property float scale_0
property float scale_1
property float scale_2
property float rot_0
property float rot_1
property float rot_2
property float rot_3
end_header
"""

    with open(path, 'wb') as f:
        f.write(header.encode('ascii'))
        for p in points:
            # Add small random jitter to SH DC for color variation
            jr = sh_r + random.gauss(0, 0.3)
            jg = sh_g + random.gauss(0, 0.3)
            jb = sh_b + random.gauss(0, 0.3)
            # Small random scale variation
            ls = log_scale + random.gauss(0, 0.2)
            f.write(struct.pack('<fff', p[0], p[1], p[2]))  # position
            f.write(struct.pack('<fff', jr, jg, jb))  # SH DC
            f.write(struct.pack('<f', opacity))  # opacity
            f.write(struct.pack('<fff', ls, ls, ls))  # scale
            f.write(struct.pack('<ffff', 1.0, 0.0, 0.0, 0.0))  # rotation (identity)


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Convert OBJ mesh to Gaussian PLY point cloud')
    parser.add_argument('input', help='Input OBJ file')
    parser.add_argument('output', help='Output PLY file')
    parser.add_argument('--points', type=int, default=50000, help='Number of sample points (default: 50000)')
    parser.add_argument('--color', type=float, nargs=3, default=[0.6, 0.7, 0.8],
                        help='RGB color [0-1] (default: 0.6 0.7 0.8)')
    parser.add_argument('--scale', type=float, default=1.0, help='Scale multiplier for the model')
    args = parser.parse_args()

    print(f"Loading {args.input}...")
    vertices, faces = load_obj(args.input)
    print(f"  {len(vertices)} vertices, {len(faces)} triangles")

    if args.scale != 1.0:
        vertices = [(v[0] * args.scale, v[1] * args.scale, v[2] * args.scale) for v in vertices]
        print(f"  Scaled by {args.scale}x")

    print(f"Sampling {args.points} points...")
    points = sample_mesh(vertices, faces, args.points, args.color)

    print(f"Writing {args.output}...")
    write_ply(args.output, points, args.color)
    print(f"  {len(points)} Gaussians, color=({args.color[0]:.2f}, {args.color[1]:.2f}, {args.color[2]:.2f})")
    print("Done.")


if __name__ == '__main__':
    main()
