#!/usr/bin/env python3
"""Generate procedural 3DGS PLY files for the KCC courtyard objects.

Outputs valid binary_little_endian PLY files with positions, SH DC color,
opacity (logit-encoded), scale (log-encoded), and rotation quaternion.

The generated Gaussians are tightly packed to fill each primitive shape,
ensuring visual bounds match collider dimensions exactly.

Usage:
    python3 scripts/generate_courtyard_plys.py

Output:
    examples/island_demo/assets/props/kcc_stone_box.ply
    examples/island_demo/assets/props/kcc_mossy_sphere.ply
    examples/island_demo/assets/props/kcc_stone_capsule.ply
"""

import math
import struct
import os
import random

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SH_C0 = 0.28209479177387814  # 1 / (2 * sqrt(pi))

# Gaussian density: approximate splats per unit length along each axis
DENSITY = 6.0

# Output directory
OUT_DIR = os.path.join(
    os.path.dirname(__file__), "..", "examples", "island_demo", "assets", "props"
)


# ---------------------------------------------------------------------------
# Encoding helpers (inverse of engine load transforms)
# ---------------------------------------------------------------------------

def logit(p: float) -> float:
    """Inverse sigmoid: logit(p) = log(p / (1 - p))."""
    p = max(1e-6, min(1.0 - 1e-6, p))
    return math.log(p / (1.0 - p))


def encode_color(r: float, g: float, b: float) -> tuple[float, float, float]:
    """Linear RGB [0,1] -> SH DC coefficients for PLY storage."""
    return ((r - 0.5) / SH_C0, (g - 0.5) / SH_C0, (b - 0.5) / SH_C0)


def encode_scale(sx: float, sy: float, sz: float) -> tuple[float, float, float]:
    """Positive scale -> log-encoded scale for PLY storage."""
    return (math.log(max(sx, 1e-6)), math.log(max(sy, 1e-6)), math.log(max(sz, 1e-6)))


# ---------------------------------------------------------------------------
# PLY writer
# ---------------------------------------------------------------------------

def write_ply(path: str, gaussians: list[dict]) -> None:
    """Write a list of Gaussian dicts to a binary_little_endian PLY file.

    Each dict: {x, y, z, r, g, b, opacity, sx, sy, sz, qw, qx, qy, qz}
    where r/g/b are linear [0,1], opacity is [0,1], scale is positive world units.
    """
    header = (
        "ply\n"
        "format binary_little_endian 1.0\n"
        f"element vertex {len(gaussians)}\n"
        "property float x\n"
        "property float y\n"
        "property float z\n"
        "property float f_dc_0\n"
        "property float f_dc_1\n"
        "property float f_dc_2\n"
        "property float opacity\n"
        "property float scale_0\n"
        "property float scale_1\n"
        "property float scale_2\n"
        "property float rot_0\n"
        "property float rot_1\n"
        "property float rot_2\n"
        "property float rot_3\n"
        "end_header\n"
    )
    with open(path, "wb") as f:
        f.write(header.encode("ascii"))
        for g in gaussians:
            dc0, dc1, dc2 = encode_color(g["r"], g["g"], g["b"])
            s0, s1, s2 = encode_scale(g["sx"], g["sy"], g["sz"])
            op = logit(g["opacity"])
            f.write(struct.pack(
                "<14f",
                g["x"], g["y"], g["z"],
                dc0, dc1, dc2,
                op,
                s0, s1, s2,
                g["qw"], g["qx"], g["qy"], g["qz"],
            ))
    print(f"  wrote {path} ({len(gaussians)} splats, {os.path.getsize(path)} bytes)")


# ---------------------------------------------------------------------------
# Color palettes (linear RGB)
# ---------------------------------------------------------------------------

def stone_color() -> tuple[float, float, float]:
    """Random grey stone with slight warm variation."""
    base = random.uniform(0.30, 0.45)
    return (base + random.uniform(-0.03, 0.03),
            base + random.uniform(-0.02, 0.02),
            base + random.uniform(-0.04, 0.01))


def moss_color() -> tuple[float, float, float]:
    """Mossy green-grey for boulders."""
    if random.random() < 0.6:
        # Mossy green
        return (random.uniform(0.15, 0.25),
                random.uniform(0.30, 0.45),
                random.uniform(0.10, 0.18))
    else:
        # Grey stone patches
        base = random.uniform(0.30, 0.40)
        return (base, base + random.uniform(-0.02, 0.02), base - 0.02)


def pillar_color() -> tuple[float, float, float]:
    """Weathered stone for pillars — lighter grey with occasional moss."""
    if random.random() < 0.15:
        return moss_color()
    base = random.uniform(0.35, 0.50)
    return (base + random.uniform(-0.02, 0.02),
            base + random.uniform(-0.01, 0.02),
            base + random.uniform(-0.03, 0.01))


# ---------------------------------------------------------------------------
# Shape generators
#
# All shapes are centered at the origin in local space.
# The engine applies game object position/rotation/scale at load time.
# Collider offsets shift the collision shape; the visual mesh stays at origin.
# For the courtyard objects, collider offset.y raises the collision box so its
# base sits on the ground plane — we match this by generating visuals in the
# same Y range (0 to 2*half_extent_y for walls, 0 to 2*radius for boulders).
# ---------------------------------------------------------------------------

def generate_box(half_x: float, half_y: float, half_z: float,
                 color_fn, splat_scale: float = 0.08) -> list[dict]:
    """Fill a box [-hx,hx] x [0, 2*hy] x [-hz,hz] with Gaussians.

    Y range starts at 0 (ground) to match collider offset.y = half_y.
    """
    gaussians = []
    nx = max(2, int(2 * half_x * DENSITY))
    ny = max(2, int(2 * half_y * DENSITY))
    nz = max(2, int(2 * half_z * DENSITY))
    for ix in range(nx):
        for iy in range(ny):
            for iz in range(nz):
                # Only place on surface (within 1 layer of boundary)
                on_surface = (
                    ix == 0 or ix == nx - 1 or
                    iy == 0 or iy == ny - 1 or
                    iz == 0 or iz == nz - 1
                )
                if not on_surface:
                    continue
                x = -half_x + (ix + 0.5) * (2 * half_x / nx)
                y = (iy + 0.5) * (2 * half_y / ny)
                z = -half_z + (iz + 0.5) * (2 * half_z / nz)
                # Jitter for natural look
                x += random.uniform(-0.02, 0.02)
                y += random.uniform(-0.02, 0.02)
                z += random.uniform(-0.02, 0.02)
                r, g, b = color_fn()
                gaussians.append({
                    "x": x, "y": y, "z": z,
                    "r": r, "g": g, "b": b,
                    "opacity": random.uniform(0.85, 0.95),
                    "sx": splat_scale, "sy": splat_scale, "sz": splat_scale,
                    "qw": 1.0, "qx": 0.0, "qy": 0.0, "qz": 0.0,
                })
    return gaussians


def generate_sphere(radius: float, color_fn,
                    splat_scale: float = 0.08) -> list[dict]:
    """Fill a sphere of given radius centered at (0, radius, 0).

    Y center = radius so the sphere sits on the ground plane, matching
    collider offset.y = radius.
    """
    gaussians = []
    # Use Fibonacci sphere for even distribution on surface
    n_points = max(50, int(4 * math.pi * radius * radius * DENSITY * DENSITY))
    golden_ratio = (1 + math.sqrt(5)) / 2
    for i in range(n_points):
        theta = 2 * math.pi * i / golden_ratio
        phi = math.acos(1 - 2 * (i + 0.5) / n_points)
        x = radius * math.sin(phi) * math.cos(theta)
        y = radius * math.cos(phi) + radius  # shift up so base at y=0
        z = radius * math.sin(phi) * math.sin(theta)
        # Jitter
        jit = radius * 0.03
        x += random.uniform(-jit, jit)
        y += random.uniform(-jit, jit)
        z += random.uniform(-jit, jit)
        r, g, b = color_fn()
        # Slightly larger splats for rounder appearance
        s = splat_scale * random.uniform(0.9, 1.3)
        gaussians.append({
            "x": x, "y": y, "z": z,
            "r": r, "g": g, "b": b,
            "opacity": random.uniform(0.85, 0.95),
            "sx": s, "sy": s, "sz": s,
            "qw": 1.0, "qx": 0.0, "qy": 0.0, "qz": 0.0,
        })
    return gaussians


def generate_capsule(radius: float, half_height: float, color_fn,
                     splat_scale: float = 0.06) -> list[dict]:
    """Generate a capsule (cylinder + hemisphere caps).

    Total height = 2 * (half_height + radius).
    Centered at (0, half_height + radius, 0) so base sits on ground,
    matching collider offset.y = 2.0 for half_height=1.5, radius=0.5.
    """
    gaussians = []
    total_half = half_height + radius
    center_y = total_half  # so base at y=0, top at y=2*total_half

    # Cylinder body: rings along the shaft
    n_rings = max(4, int(2 * half_height * DENSITY))
    n_around = max(8, int(2 * math.pi * radius * DENSITY))
    for ir in range(n_rings):
        cy = center_y - half_height + (ir + 0.5) * (2 * half_height / n_rings)
        for ia in range(n_around):
            angle = 2 * math.pi * ia / n_around
            cx = radius * math.cos(angle)
            cz = radius * math.sin(angle)
            jit = radius * 0.03
            r, g, b = color_fn()
            gaussians.append({
                "x": cx + random.uniform(-jit, jit),
                "y": cy + random.uniform(-jit, jit),
                "z": cz + random.uniform(-jit, jit),
                "r": r, "g": g, "b": b,
                "opacity": random.uniform(0.85, 0.95),
                "sx": splat_scale, "sy": splat_scale, "sz": splat_scale,
                "qw": 1.0, "qx": 0.0, "qy": 0.0, "qz": 0.0,
            })

    # Hemisphere caps
    n_cap = max(30, int(2 * math.pi * radius * radius * DENSITY * DENSITY))
    golden_ratio = (1 + math.sqrt(5)) / 2
    for cap_sign, cap_y_center in [(-1, center_y - half_height),
                                    (1, center_y + half_height)]:
        for i in range(n_cap):
            theta = 2 * math.pi * i / golden_ratio
            phi = math.acos(1 - (i + 0.5) / n_cap)  # hemisphere: phi in [0, pi/2]
            x = radius * math.sin(phi) * math.cos(theta)
            dy = radius * math.cos(phi) * cap_sign
            z = radius * math.sin(phi) * math.sin(theta)
            jit = radius * 0.03
            r, g, b = color_fn()
            gaussians.append({
                "x": x + random.uniform(-jit, jit),
                "y": cap_y_center + dy + random.uniform(-jit, jit),
                "z": z + random.uniform(-jit, jit),
                "r": r, "g": g, "b": b,
                "opacity": random.uniform(0.85, 0.95),
                "sx": splat_scale, "sy": splat_scale, "sz": splat_scale,
                "qw": 1.0, "qx": 0.0, "qy": 0.0, "qz": 0.0,
            })

    return gaussians


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    random.seed(42)  # Reproducible output
    os.makedirs(OUT_DIR, exist_ok=True)

    print("Generating KCC courtyard PLY assets...")

    # 1. Stone box — used for walls (half_extents [3.0, 2.0, 0.4])
    #    and ramp (half_extents [2.0, 0.5, 3.0])
    #    We generate a unit box and let game object scale handle differences?
    #    No — each object has scale=1.0, so we generate per-shape.

    # Wall box: 6x4x0.8 slab
    wall_splats = generate_box(3.0, 2.0, 0.4, stone_color, splat_scale=0.10)
    write_ply(os.path.join(OUT_DIR, "kcc_stone_wall.ply"), wall_splats)

    # Ramp box: 4x1x6 slab
    ramp_splats = generate_box(2.0, 0.5, 3.0, stone_color, splat_scale=0.10)
    write_ply(os.path.join(OUT_DIR, "kcc_stone_ramp.ply"), ramp_splats)

    # 2. Mossy spheres — three sizes: r=1.2, r=1.0, r=1.5
    for name, radius in [("kcc_boulder_1_2", 1.2),
                          ("kcc_boulder_1_0", 1.0),
                          ("kcc_boulder_1_5", 1.5)]:
        splats = generate_sphere(radius, moss_color, splat_scale=0.10)
        write_ply(os.path.join(OUT_DIR, f"{name}.ply"), splats)

    # 3. Stone capsule — pillars: radius=0.5, half_height=1.5
    pillar_splats = generate_capsule(0.5, 1.5, pillar_color, splat_scale=0.06)
    write_ply(os.path.join(OUT_DIR, "kcc_stone_pillar.ply"), pillar_splats)

    print("\nDone! Generated 6 PLY files in examples/island_demo/assets/props/")


if __name__ == "__main__":
    main()
