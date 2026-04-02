#!/usr/bin/env python3
"""Convert OBJ mesh to Gaussian PLY via surface sampling.

Each triangle face is sampled with random barycentric points,
inheriting color from material/object name heuristics or vertex colors.

Usage:
    python scripts/mesh_to_ply.py input.obj output.ply [--density 500] [--scale 1.0]
"""

import argparse
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ply_utils import write_ply


# Rigify DEF bones -> simplified bone indices
BONE_MAP = {
    "spine": 1, "spine.001": 1, "spine.002": 1, "spine.003": 1,
    "spine.004": 2, "spine.005": 2, "spine.006": 2,  # head/neck
    "shoulder.L": 3, "upper_arm.L": 3, "upper_arm.L.001": 3,
    "forearm.L": 3, "forearm.L.001": 3, "hand.L": 3,
    "shoulder.R": 4, "upper_arm.R": 4, "upper_arm.R.001": 4,
    "forearm.R": 4, "forearm.R.001": 4, "hand.R": 4,
    "pelvis.L": 5, "thigh.L": 5, "thigh.L.001": 5,
    "shin.L": 5, "shin.L.001": 5, "foot.L": 5, "toe.L": 5,
    "pelvis.R": 6, "thigh.R": 6, "thigh.R.001": 6,
    "shin.R": 6, "shin.R.001": 6, "foot.R": 6, "toe.R": 6,
}


def get_bone_index(group_name):
    """Map a group name to bone index. Returns 1 (torso) as default."""
    # Strip DEF- prefix
    name = group_name
    if name.startswith("DEF-"):
        name = name[4:]
    # Check finger/thumb -> map to hand
    if name.startswith("f_") or name.startswith("thumb") or name.startswith("palm"):
        if ".L" in name:
            return 3
        elif ".R" in name:
            return 4
    # Face bones -> head
    for face_part in ["jaw", "chin", "lip", "lid", "brow", "cheek",
                       "nose", "ear", "forehead", "temple", "tongue"]:
        if name.startswith(face_part):
            return 2
    # Check BONE_MAP
    if name in BONE_MAP:
        return BONE_MAP[name]
    return 1  # default: torso


def parse_mtl(mtl_path):
    """Parse MTL file, return dict of material_name -> (r, g, b) diffuse color."""
    materials = {}
    current = None
    with open(mtl_path) as f:
        for line in f:
            line = line.strip()
            if line.startswith("newmtl "):
                current = line[7:]
            elif line.startswith("Kd ") and current:
                parts = line.split()
                materials[current] = (float(parts[1]), float(parts[2]), float(parts[3]))
    return materials


def parse_obj(path):
    """Parse OBJ file into objects with vertices, normals, and faces.

    Handles both 'o' (object) and 'g' (group) lines as group boundaries.
    Tracks 'mtllib' and 'usemtl' for material assignment.

    Returns:
        (vertices, normals, objects, mtllib_path)
        where mtllib_path is the filename from mtllib directive (or None).
    """
    vertices = []
    normals = []
    texcoords = []
    objects = []
    current_obj = {"name": "default", "faces": [], "material": None}
    current_material = None
    mtllib_path = None

    with open(path) as f:
        for line in f:
            line = line.strip()
            if line.startswith("o ") or line.startswith("g "):
                if current_obj["faces"]:
                    objects.append(current_obj)
                name = line[2:]
                current_obj = {"name": name, "faces": [], "material": current_material}
            elif line.startswith("mtllib "):
                mtllib_path = line[7:].strip()
            elif line.startswith("vt "):
                parts = line.split()
                texcoords.append((float(parts[1]), float(parts[2])))
            elif line.startswith("v "):
                parts = line.split()
                vertices.append((float(parts[1]), float(parts[2]), float(parts[3])))
            elif line.startswith("vn "):
                parts = line.split()
                normals.append((float(parts[1]), float(parts[2]), float(parts[3])))
            elif line.startswith("usemtl "):
                current_material = line[7:]
                # Update current object's material if it has no faces yet
                if not current_obj["faces"]:
                    current_obj["material"] = current_material
            elif line.startswith("f "):
                parts = line.split()[1:]
                face_verts = []
                face_uvs = []
                for p in parts:
                    # Format: v, v/vt, v/vt/vn, v//vn
                    indices = p.split("/")
                    face_verts.append(int(indices[0]) - 1)
                    if len(indices) > 1 and indices[1]:
                        face_uvs.append(int(indices[1]) - 1)
                current_obj["faces"].append((face_verts, face_uvs))

    if current_obj["faces"]:
        objects.append(current_obj)

    return vertices, normals, texcoords, objects, mtllib_path


def triangle_area(v0, v1, v2):
    """Compute area of a triangle from 3 vertices."""
    e1 = (v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2])
    e2 = (v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2])
    cross = (
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
    )
    return 0.5 * math.sqrt(cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2)


def random_barycentric():
    """Random point in triangle via barycentric coordinates."""
    u = random.random()
    v = random.random()
    if u + v > 1.0:
        u = 1.0 - u
        v = 1.0 - v
    return u, v


def guess_color(obj_name, material_name=None):
    """Guess color from object/material name heuristics."""
    name = (obj_name or "").lower()
    mat = (material_name or "").lower()
    combined = name + " " + mat

    # Trunk / wood
    if any(k in combined for k in ["trunk", "cube", "wood", "bark", "log", "stem"]):
        return (0.45, 0.28, 0.14)
    # Leaf / canopy / foliage
    if any(k in combined for k in ["leaf", "canopy", "foliag", "sphere", "ico"]):
        return None  # random green variation
    # Rock / stone
    if any(k in combined for k in ["rock", "stone", "boulder"]):
        return (0.45, 0.42, 0.40)
    # Roof
    if any(k in combined for k in ["roof"]):
        return (0.65, 0.25, 0.15)
    # Wall
    if any(k in combined for k in ["wall", "house", "building"]):
        return (0.85, 0.80, 0.72)
    # Crystal
    if any(k in combined for k in ["crystal", "gem"]):
        return (0.3, 0.5, 0.9)
    # Metal / torch
    if any(k in combined for k in ["metal", "torch", "iron"]):
        return (0.35, 0.33, 0.30)
    # Default
    return (0.6, 0.6, 0.6)


def sample_mesh(vertices, objects, density, scale, gaussian_scale=None,
                mtl_colors=None, assign_bones=False, texcoords=None,
                tex_images=None):
    """Surface-sample the mesh to generate Gaussians.

    Args:
        vertices: list of (x,y,z) tuples
        objects: list of {"name", "faces", "material"} dicts
                 faces are (vert_indices, uv_indices) tuples
        density: target Gaussians per square unit of surface area
        scale: scale multiplier for the output
        gaussian_scale: override Gaussian splat scale (auto if None)
        mtl_colors: dict of material_name -> (r, g, b) from MTL file
        assign_bones: if True, assign bone indices from group names
        texcoords: list of (u, v) tuples from OBJ
        tex_images: dict of material_name -> PIL.Image (base color textures)
    """
    gaussians = []
    rng = random.Random(42)

    # Compute total surface area for reporting
    total_area = 0
    for obj in objects:
        for face_verts, face_uvs in obj["faces"]:
            if len(face_verts) < 3:
                continue
            v0 = vertices[face_verts[0]]
            for i in range(1, len(face_verts) - 1):
                v1 = vertices[face_verts[i]]
                v2 = vertices[face_verts[i + 1]]
                total_area += triangle_area(v0, v1, v2)

    # Auto gaussian scale based on density
    if gaussian_scale is None:
        gaussian_scale = max(0.05, 0.5 / math.sqrt(density))

    def sample_texture(img, uv_u, uv_v):
        """Sample a PIL image at UV coordinates, return (r, g, b) in 0-1."""
        w, h = img.size
        px = int(uv_u % 1.0 * w) % w
        py = int((1.0 - uv_v % 1.0) * h) % h  # OBJ V is flipped
        pixel = img.getpixel((px, py))
        return (pixel[0] / 255.0, pixel[1] / 255.0, pixel[2] / 255.0)

    for obj in objects:
        # Determine color source: texture > MTL > heuristics
        mat_name = obj.get("material")
        tex_img = tex_images.get(mat_name) if tex_images and mat_name else None
        mtl_color = None
        if mtl_colors and mat_name and mat_name in mtl_colors:
            mtl_color = mtl_colors[mat_name]

        if tex_img is None and mtl_color is not None:
            base_color = mtl_color
        elif tex_img is None:
            base_color = guess_color(obj["name"], mat_name)
        else:
            base_color = None  # will sample texture per-Gaussian

        # Bone index for this group
        bone_idx = get_bone_index(obj["name"]) if assign_bones else 0

        for face_verts, face_uvs in obj["faces"]:
            if len(face_verts) < 3:
                continue

            v0 = vertices[face_verts[0]]
            has_uvs = tex_img is not None and texcoords and len(face_uvs) == len(face_verts)
            if has_uvs:
                uv0 = texcoords[face_uvs[0]]

            # Triangulate (fan from first vertex)
            for i in range(1, len(face_verts) - 1):
                v1 = vertices[face_verts[i]]
                v2 = vertices[face_verts[i + 1]]

                if has_uvs:
                    uv1 = texcoords[face_uvs[i]]
                    uv2 = texcoords[face_uvs[i + 1]]

                area = triangle_area(v0, v1, v2)
                expected = area * density * scale * scale
                if expected < 1.0:
                    # Probabilistic sampling for tiny triangles
                    num_samples = 1 if rng.random() < expected else 0
                else:
                    num_samples = int(expected)

                for _ in range(num_samples):
                    u, v = random_barycentric()
                    w = 1.0 - u - v

                    px = (v0[0] * w + v1[0] * u + v2[0] * v) * scale
                    py = (v0[1] * w + v1[1] * u + v2[1] * v) * scale
                    pz = (v0[2] * w + v1[2] * u + v2[2] * v) * scale

                    # Color: texture > base > foliage fallback
                    if has_uvs:
                        su = uv0[0] * w + uv1[0] * u + uv2[0] * v
                        sv = uv0[1] * w + uv1[1] * u + uv2[1] * v
                        color = sample_texture(tex_img, su, sv)
                        # Add slight noise
                        color = tuple(
                            max(0.0, min(1.0, c + rng.uniform(-0.02, 0.02)))
                            for c in color
                        )
                    elif base_color is None:
                        color = (
                            0.15 + rng.random() * 0.20,
                            0.40 + rng.random() * 0.25,
                            0.08 + rng.random() * 0.12,
                        )
                    else:
                        # Add slight noise
                        color = tuple(
                            max(0.0, min(1.0, c + rng.uniform(-0.05, 0.05)))
                            for c in base_color
                        )

                    g = {
                        "pos": (px, py, pz),
                        "color": color,
                        "scale": gaussian_scale * scale,
                        "opacity": 1.0,
                    }
                    if assign_bones:
                        g["bone"] = bone_idx
                    gaussians.append(g)

    return gaussians, total_area


def main():
    parser = argparse.ArgumentParser(description="Convert OBJ mesh to Gaussian PLY")
    parser.add_argument("input", help="Input OBJ file")
    parser.add_argument("output", help="Output PLY file")
    parser.add_argument("--density", type=float, default=500,
                        help="Gaussians per square unit of surface (default: 500)")
    parser.add_argument("--scale", type=float, default=1.0,
                        help="Scale multiplier (default: 1.0)")
    parser.add_argument("--gs-scale", type=float, default=None,
                        help="Override Gaussian splat scale (auto if not set)")
    parser.add_argument("--info", action="store_true",
                        help="Print mesh info and exit without converting")
    parser.add_argument("--bones", action="store_true",
                        help="Assign bone indices from group names (DEF-* mapping)")
    parser.add_argument("--mtl", type=str, default=None,
                        help="Override MTL file path (auto-detected from mtllib if not set)")
    args = parser.parse_args()

    print(f"Loading: {args.input}")
    vertices, normals, texcoords, objects, mtllib_name = parse_obj(args.input)

    print(f"  Vertices: {len(vertices)}")
    if texcoords:
        print(f"  Texcoords: {len(texcoords)}")
    print(f"  Objects/Groups: {len(objects)}")
    for obj in objects:
        mat_info = f" [mtl: {obj['material']}]" if obj.get("material") else ""
        print(f"    '{obj['name']}': {len(obj['faces'])} faces{mat_info}")

    # Load MTL colors
    mtl_colors = None
    mtl_path = args.mtl
    if mtl_path is None and mtllib_name:
        # Resolve relative to the OBJ file directory
        obj_dir = os.path.dirname(os.path.abspath(args.input))
        mtl_path = os.path.join(obj_dir, mtllib_name)
    if mtl_path and os.path.isfile(mtl_path):
        mtl_colors = parse_mtl(mtl_path)
        print(f"  MTL file: {mtl_path} ({len(mtl_colors)} materials)")
        for name, color in mtl_colors.items():
            print(f"    '{name}': Kd ({color[0]:.3f}, {color[1]:.3f}, {color[2]:.3f})")
    elif mtl_path:
        print(f"  MTL file not found: {mtl_path}")

    if args.info:
        return

    # Load base color textures if available
    tex_images = {}
    if texcoords:
        try:
            from PIL import Image
            obj_dir = os.path.dirname(os.path.abspath(args.input))
            for mat_name in (mtl_colors or {}):
                tex_path = os.path.join(obj_dir, f"{mat_name}_Base_Color.png")
                if os.path.isfile(tex_path):
                    tex_images[mat_name] = Image.open(tex_path).convert("RGB")
                    print(f"  Texture: {mat_name} -> {tex_path} ({tex_images[mat_name].size})")
        except ImportError:
            print("  (PIL not available — using MTL/heuristic colors)")

    print(f"\nSampling at density={args.density}, scale={args.scale}...")
    gaussians, total_area = sample_mesh(
        vertices, objects, args.density, args.scale, args.gs_scale,
        mtl_colors=mtl_colors, assign_bones=args.bones,
        texcoords=texcoords, tex_images=tex_images if tex_images else None,
    )

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    count = write_ply(args.output, gaussians)

    ply_size_kb = os.path.getsize(args.output) / 1024
    print(f"\nOutput: {args.output}")
    print(f"  Gaussians: {count:,}")
    print(f"  Surface area: {total_area:.2f} sq units (scaled: {total_area * args.scale**2:.2f})")
    print(f"  File size: {ply_size_kb:.1f} KB")

    if args.bones:
        # Report bone distribution
        bone_counts = {}
        for g in gaussians:
            b = g.get("bone", 0)
            bone_counts[b] = bone_counts.get(b, 0) + 1
        print(f"  Bone assignment:")
        bone_names = {0: "none", 1: "torso", 2: "head", 3: "arm.L",
                      4: "arm.R", 5: "leg.L", 6: "leg.R"}
        for b in sorted(bone_counts):
            label = bone_names.get(b, f"bone_{b}")
            print(f"    {label} ({b}): {bone_counts[b]:,}")


if __name__ == "__main__":
    main()
