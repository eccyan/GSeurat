#!/usr/bin/env python3
"""Shared utilities for writing binary PLY files compatible with GaussianCloud::load_ply().

PLY format: binary_little_endian, 14 float properties per vertex:
  x, y, z, scale_0, scale_1, scale_2, rot_0, rot_1, rot_2, rot_3,
  f_dc_0, f_dc_1, f_dc_2, opacity
"""

import math
import struct

# SH coefficient C0 = 1 / (2 * sqrt(pi))
SH_C0 = 0.28209479177387814


def rgb_to_sh_dc(r, g, b):
    """Convert linear RGB (0-1) to SH DC coefficients."""
    return (
        (r - 0.5) / SH_C0,
        (g - 0.5) / SH_C0,
        (b - 0.5) / SH_C0,
    )


def logit(alpha):
    """Convert opacity (0-1) to pre-sigmoid logit."""
    alpha = max(1e-6, min(alpha, 1.0 - 1e-6))
    return math.log(alpha / (1.0 - alpha))


def write_ply(path, gaussians):
    """Write binary little-endian PLY file.

    Args:
        path: Output file path.
        gaussians: List of dicts with keys:
            pos: (x, y, z) tuple
            color: (r, g, b) tuple, 0-1 range
            scale: float or (sx, sy, sz) tuple (world-space size)
            opacity: float 0-1
    """
    count = len(gaussians)

    header = (
        "ply\n"
        "format binary_little_endian 1.0\n"
        f"element vertex {count}\n"
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
        "end_header\n"
    )

    with open(path, "wb") as f:
        f.write(header.encode("ascii"))

        for g in gaussians:
            x, y, z = g["pos"]

            # Scale: store as log(scale) since load_ply applies exp()
            s = g.get("scale", 0.5)
            if isinstance(s, (int, float)):
                sx = sy = sz = math.log(max(float(s), 1e-10))
            else:
                sx = math.log(max(float(s[0]), 1e-10))
                sy = math.log(max(float(s[1]), 1e-10))
                sz = math.log(max(float(s[2]), 1e-10))

            # Rotation: identity quaternion (w, x, y, z)
            rw, rx, ry, rz = 1.0, 0.0, 0.0, 0.0

            # Color: convert RGB to SH DC
            r, g_val, b = g["color"]
            dc0, dc1, dc2 = rgb_to_sh_dc(r, g_val, b)

            # Opacity: convert to logit
            op = logit(g.get("opacity", 1.0))

            f.write(struct.pack(
                "<14f",
                x, y, z,
                sx, sy, sz,
                rw, rx, ry, rz,
                dc0, dc1, dc2,
                op,
            ))

    return count
