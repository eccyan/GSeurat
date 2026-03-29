#!/usr/bin/env python3
"""
Convert OBJ mesh to Gaussian Splatting-compatible PLY point cloud.

Samples points on mesh faces (weighted by area) and generates
a PLY file with SH DC color coefficients compatible with the
GSeurat engine PLY loader.

Supports texture mapping: reads MTL file for map_Kd texture path,
samples texture color at each point's UV coordinate.

Usage: python3 scripts/obj_to_ply.py input.obj output.ply [--points N] [--color R G B]
"""

import struct
import sys
import random
import math
from pathlib import Path


def load_obj(path: str):
    """Load OBJ file, return vertices, tex_coords, faces (with UV indices), and MTL path."""
    vertices = []
    tex_coords = []
    faces = []       # list of ((vi0, vi1, vi2), (ti0, ti1, ti2) or None)
    mtl_file = None

    with open(path, 'r') as f:
        for line in f:
            line = line.strip()
            if line.startswith('mtllib '):
                mtl_file = line[7:].strip()
            elif line.startswith('v '):
                parts = line.split()
                vertices.append((float(parts[1]), float(parts[2]), float(parts[3])))
            elif line.startswith('vt '):
                parts = line.split()
                tex_coords.append((float(parts[1]), float(parts[2])))
            elif line.startswith('f '):
                parts = line.split()[1:]
                v_idx = []
                t_idx = []
                has_uv = False
                for p in parts:
                    components = p.split('/')
                    v_idx.append(int(components[0]) - 1)
                    if len(components) > 1 and components[1]:
                        t_idx.append(int(components[1]) - 1)
                        has_uv = True
                    else:
                        t_idx.append(-1)
                # Triangulate
                for i in range(1, len(v_idx) - 1):
                    vi = (v_idx[0], v_idx[i], v_idx[i + 1])
                    ti = (t_idx[0], t_idx[i], t_idx[i + 1]) if has_uv else None
                    faces.append((vi, ti))

    return vertices, tex_coords, faces, mtl_file


def load_mtl(mtl_path: str):
    """Load MTL file, return dict of material name → {Kd, map_Kd}."""
    materials = {}
    current = None
    with open(mtl_path, 'r') as f:
        for line in f:
            line = line.strip()
            if line.startswith('newmtl '):
                current = line[7:].strip()
                materials[current] = {'Kd': (0.8, 0.8, 0.8), 'map_Kd': None}
            elif line.startswith('Kd ') and current:
                parts = line.split()
                materials[current]['Kd'] = (float(parts[1]), float(parts[2]), float(parts[3]))
            elif line.startswith('map_Kd ') and current:
                materials[current]['map_Kd'] = line[7:].strip()
    return materials


def load_texture(tex_path: str):
    """Load texture image, return (width, height, pixels) where pixels[y][x] = (r,g,b) in [0,1]."""
    try:
        from PIL import Image
        img = Image.open(tex_path).convert('RGB')
        w, h = img.size
        pixels = []
        for y in range(h):
            row = []
            for x in range(w):
                r, g, b = img.getpixel((x, y))
                row.append((r / 255.0, g / 255.0, b / 255.0))
            pixels.append(row)
        return w, h, pixels
    except ImportError:
        print("WARNING: PIL/Pillow not available, install with: pip3 install Pillow")
        return None, None, None


def sample_texture(tex_w, tex_h, tex_pixels, u, v):
    """Sample texture color at UV coordinate."""
    # Wrap UV to [0,1]
    u = u % 1.0
    v = v % 1.0
    # Flip V (OBJ UV origin is bottom-left, image origin is top-left)
    v = 1.0 - v
    x = int(u * (tex_w - 1))
    y = int(v * (tex_h - 1))
    x = max(0, min(x, tex_w - 1))
    y = max(0, min(y, tex_h - 1))
    return tex_pixels[y][x]


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


def sample_mesh(vertices, tex_coords, faces, num_points, default_color, texture=None):
    """Sample points on mesh surface with colors from texture or default."""
    tex_w, tex_h, tex_pixels = texture if texture else (None, None, None)

    # Calculate cumulative area for weighted sampling
    areas = []
    for vi, ti in faces:
        a = triangle_area(vertices[vi[0]], vertices[vi[1]], vertices[vi[2]])
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
    points = []  # list of (position, color)
    for _ in range(num_points):
        r = random.random()
        lo, hi = 0, len(cum_area) - 1
        while lo < hi:
            mid = (lo + hi) // 2
            if cum_area[mid] < r:
                lo = mid + 1
            else:
                hi = mid
        fi = lo
        vi, ti = faces[fi]

        # Random barycentric coordinates
        r1 = random.random()
        r2 = random.random()
        if r1 + r2 > 1:
            r1, r2 = 1 - r1, 1 - r2
        r3 = 1 - r1 - r2

        # Interpolate position
        v0, v1, v2 = vertices[vi[0]], vertices[vi[1]], vertices[vi[2]]
        pos = (
            v0[0] * r1 + v1[0] * r2 + v2[0] * r3,
            v0[1] * r1 + v1[1] * r2 + v2[1] * r3,
            v0[2] * r1 + v1[2] * r2 + v2[2] * r3,
        )

        # Get color from texture or default
        color = default_color
        if tex_pixels and ti and all(t >= 0 for t in ti):
            t0, t1, t2 = tex_coords[ti[0]], tex_coords[ti[1]], tex_coords[ti[2]]
            u = t0[0] * r1 + t1[0] * r2 + t2[0] * r3
            v = t0[1] * r1 + t1[1] * r2 + t2[1] * r3
            color = sample_texture(tex_w, tex_h, tex_pixels, u, v)

        points.append((pos, color))

    return points


def rgb_to_sh_dc(r, g, b):
    """Convert RGB [0,1] to SH DC coefficients (inverse of 0.5 + 0.2820948 * sh)."""
    inv = 1.0 / 0.2820948
    return ((r - 0.5) * inv, (g - 0.5) * inv, (b - 0.5) * inv)


def write_ply(path, points):
    """Write points as a GSeurat-compatible binary PLY."""
    opacity = 5.0          # pre-sigmoid (sigmoid(5) ≈ 0.993)
    log_scale = math.log(0.005)  # small splats

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
        for pos, color in points:
            sh_r, sh_g, sh_b = rgb_to_sh_dc(color[0], color[1], color[2])
            ls = log_scale + random.gauss(0, 0.1)
            f.write(struct.pack('<fff', pos[0], pos[1], pos[2]))
            f.write(struct.pack('<fff', sh_r, sh_g, sh_b))
            f.write(struct.pack('<f', opacity))
            f.write(struct.pack('<fff', ls, ls, ls))
            f.write(struct.pack('<ffff', 1.0, 0.0, 0.0, 0.0))


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Convert OBJ mesh to Gaussian PLY point cloud')
    parser.add_argument('input', help='Input OBJ file')
    parser.add_argument('output', help='Output PLY file')
    parser.add_argument('--points', type=int, default=50000, help='Number of sample points (default: 50000)')
    parser.add_argument('--color', type=float, nargs=3, default=None,
                        help='Override RGB color [0-1] (default: from texture/MTL)')
    parser.add_argument('--scale', type=float, default=1.0, help='Scale multiplier')
    parser.add_argument('--texture', type=str, default=None, help='Override texture image path')
    args = parser.parse_args()

    print(f"Loading {args.input}...")
    vertices, tex_coords, faces, mtl_file = load_obj(args.input)
    print(f"  {len(vertices)} vertices, {len(tex_coords)} UVs, {len(faces)} triangles")

    if args.scale != 1.0:
        vertices = [(v[0] * args.scale, v[1] * args.scale, v[2] * args.scale) for v in vertices]
        print(f"  Scaled by {args.scale}x")

    # Load texture from --texture flag, MTL, or use default color
    texture = None
    default_color = args.color or (0.6, 0.7, 0.8)
    if args.texture:
        print(f"  Loading texture: {args.texture}...")
        tex = load_texture(args.texture)
        if tex[0]:
            texture = tex
            print(f"  Texture: {tex[0]}x{tex[1]}")
    elif mtl_file and not args.color:
        mtl_path = Path(args.input).parent / mtl_file
        if mtl_path.exists():
            materials = load_mtl(str(mtl_path))
            for name, mat in materials.items():
                if mat['map_Kd']:
                    tex_path = Path(args.input).parent / mat['map_Kd']
                    if tex_path.exists():
                        print(f"  Loading texture: {tex_path.name}...")
                        tex = load_texture(str(tex_path))
                        if tex[0]:
                            texture = tex
                            print(f"  Texture: {tex[0]}x{tex[1]}")
                    else:
                        print(f"  Texture not found: {tex_path}")
                else:
                    default_color = mat['Kd']
                    print(f"  Material '{name}' Kd: {default_color}")

    print(f"Sampling {args.points} points...")
    points = sample_mesh(vertices, tex_coords, faces, args.points, default_color, texture)

    print(f"Writing {args.output}...")
    write_ply(args.output, points)
    print(f"  {len(points)} Gaussians")
    print("Done.")


if __name__ == '__main__':
    main()
