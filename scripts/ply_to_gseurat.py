#!/usr/bin/env python3
"""Convert a binary little-endian PLY file to GSeurat's pre-baked .gsvx format.

The output is a flat binary file whose payload is byte-identical to an array of
GpuGaussian structs (4 x vec4 = 64 bytes each), ready for zero-copy upload to a
Vulkan SSBO.

Usage:
    python3 scripts/ply_to_gseurat.py input.ply [-o output.gsvx]
"""

from __future__ import annotations

import argparse
import struct
import sys
from pathlib import Path

import numpy as np

# GSVX payload is little-endian float32 (matches x86/ARM native order).
# Explicitly assert to fail loudly on any hypothetical big-endian host.
if sys.byteorder != "little":
    sys.exit("Error: GSVX cooker requires a little-endian host.")

try:
    from plyfile import PlyData
except ImportError:
    sys.exit("Error: 'plyfile' package required.  Install with:  pip install plyfile")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

GSVX_MAGIC = b"GSVX"
GSVX_VERSION = 2
HEADER_SIZE = 64
GAUSSIAN_SIZE = 64
SH_C0 = 0.28209479177387814  # 1 / (2 * sqrt(pi))

# ---------------------------------------------------------------------------
# PLY field resolution
# ---------------------------------------------------------------------------

def _resolve(vertex_data: np.ndarray, *candidates: str) -> np.ndarray | None:
    """Return the first matching field from *candidates*, or None."""
    for name in candidates:
        if name in vertex_data.dtype.names:
            return vertex_data[name].astype(np.float32)
    return None


def _require(vertex_data: np.ndarray, label: str, *candidates: str) -> np.ndarray:
    arr = _resolve(vertex_data, *candidates)
    if arr is None:
        raise ValueError(f"PLY is missing required field '{label}' "
                         f"(tried: {', '.join(candidates)})")
    return arr

# ---------------------------------------------------------------------------
# Core conversion
# ---------------------------------------------------------------------------

def ply_to_gsvx(ply_path: Path) -> bytes:
    """Read a PLY file and return the complete .gsvx binary (header + payload)."""

    ply = PlyData.read(str(ply_path))
    vertex = ply["vertex"].data
    count = len(vertex)

    # --- Position ---
    px = _require(vertex, "x", "x").astype(np.float32)
    py = _require(vertex, "y", "y").astype(np.float32)
    pz = _require(vertex, "z", "z").astype(np.float32)

    # --- Opacity: logit -> sigmoid ---
    raw_opacity = _resolve(vertex, "opacity")
    if raw_opacity is not None:
        opacity = (1.0 / (1.0 + np.exp(-raw_opacity))).astype(np.float32)
    else:
        opacity = np.ones(count, dtype=np.float32)

    # --- Scale: log -> exp ---
    sx = _resolve(vertex, "scale_0", "scaling_0")
    sy = _resolve(vertex, "scale_1", "scaling_1")
    sz = _resolve(vertex, "scale_2", "scaling_2")
    if sx is not None and sy is not None and sz is not None:
        sx = np.exp(sx).astype(np.float32)
        sy = np.exp(sy).astype(np.float32)
        sz = np.exp(sz).astype(np.float32)
    else:
        sx = sy = sz = np.full(count, 0.01, dtype=np.float32)

    # --- Bone index (uint32 stored as float bit-pattern) ---
    bi_raw = _resolve(vertex, "bone_index")
    if bi_raw is not None:
        bone_idx = bi_raw.astype(np.uint32)
    else:
        bone_idx = np.zeros(count, dtype=np.uint32)
    bone_as_float = bone_idx.view(np.float32)

    # --- Rotation quaternion: normalize, reorder (w,x,y,z) -> (x,y,z,w) ---
    rw = _resolve(vertex, "rot_0", "rotation_0")
    rx = _resolve(vertex, "rot_1", "rotation_1")
    ry = _resolve(vertex, "rot_2", "rotation_2")
    rz = _resolve(vertex, "rot_3", "rotation_3")
    if rw is not None and rx is not None and ry is not None and rz is not None:
        length = np.sqrt(rw * rw + rx * rx + ry * ry + rz * rz)
        zero_mask = length <= 0
        # Avoid division-by-zero; mask-fill below restores identity
        safe_length = np.where(zero_mask, 1.0, length)
        rw = np.where(zero_mask, 1.0, rw / safe_length).astype(np.float32)
        rx = np.where(zero_mask, 0.0, rx / safe_length).astype(np.float32)
        ry = np.where(zero_mask, 0.0, ry / safe_length).astype(np.float32)
        rz = np.where(zero_mask, 0.0, rz / safe_length).astype(np.float32)
    else:
        rx = np.zeros(count, dtype=np.float32)
        ry = np.zeros(count, dtype=np.float32)
        rz = np.zeros(count, dtype=np.float32)
        rw = np.ones(count, dtype=np.float32)

    # --- Color ---
    has_sh = "f_dc_0" in vertex.dtype.names
    if has_sh:
        cr = _require(vertex, "f_dc_0", "f_dc_0")
        cg = _require(vertex, "f_dc_1", "f_dc_1")
        cb = _require(vertex, "f_dc_2", "f_dc_2")
        cr = np.clip(SH_C0 * cr + 0.5, 0.0, 1.0).astype(np.float32)
        cg = np.clip(SH_C0 * cg + 0.5, 0.0, 1.0).astype(np.float32)
        cb = np.clip(SH_C0 * cb + 0.5, 0.0, 1.0).astype(np.float32)
    else:
        cr = _resolve(vertex, "red")
        cg = _resolve(vertex, "green")
        cb = _resolve(vertex, "blue")
        if cr is not None and cg is not None and cb is not None:
            if vertex["red"].dtype == np.uint8:
                cr = cr / 255.0
                cg = cg / 255.0
                cb = cb / 255.0
            cr = np.clip(cr, 0.0, 1.0).astype(np.float32)
            cg = np.clip(cg, 0.0, 1.0).astype(np.float32)
            cb = np.clip(cb, 0.0, 1.0).astype(np.float32)
        else:
            cr = cg = cb = np.ones(count, dtype=np.float32)

    # --- Emission ---
    emission = _resolve(vertex, "emission")
    if emission is None:
        emission = np.zeros(count, dtype=np.float32)

    # --- Pack into structured array matching GpuGaussian ---
    gpu_dtype = np.dtype([
        ("pos_opacity", np.float32, 4),
        ("scale_pad",   np.float32, 4),
        ("rot",         np.float32, 4),
        ("color_pad",   np.float32, 4),
    ])
    assert gpu_dtype.itemsize == GAUSSIAN_SIZE

    out = np.zeros(count, dtype=gpu_dtype)
    out["pos_opacity"][:, 0] = px
    out["pos_opacity"][:, 1] = py
    out["pos_opacity"][:, 2] = pz
    out["pos_opacity"][:, 3] = opacity
    out["scale_pad"][:, 0] = sx
    out["scale_pad"][:, 1] = sy
    out["scale_pad"][:, 2] = sz
    out["scale_pad"][:, 3] = bone_as_float
    out["rot"][:, 0] = rx   # shader order: x, y, z, w
    out["rot"][:, 1] = ry
    out["rot"][:, 2] = rz
    out["rot"][:, 3] = rw
    out["color_pad"][:, 0] = cr
    out["color_pad"][:, 1] = cg
    out["color_pad"][:, 2] = cb
    out["color_pad"][:, 3] = emission

    # --- Compute AABB from baked positions ---
    aabb_min = (float(px.min()), float(py.min()), float(pz.min()))
    aabb_max = (float(px.max()), float(py.max()), float(pz.max()))

    # --- Build binary (v2: 64-byte header with baked AABB) ---
    header = struct.pack("<4sIII3f3f24s",
                         GSVX_MAGIC,
                         GSVX_VERSION,
                         count,
                         0,               # flags
                         *aabb_min,
                         *aabb_max,
                         b"\x00" * 24)    # reserved
    assert len(header) == HEADER_SIZE

    return header + out.tobytes()

# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Convert a binary PLY file to GSeurat's .gsvx format.")
    parser.add_argument("input", type=Path, help="Input .ply file")
    parser.add_argument("-o", "--output", type=Path, default=None,
                        help="Output .gsvx file (default: same name, .gsvx extension)")
    args = parser.parse_args()

    if not args.input.exists():
        sys.exit(f"Error: input file not found: {args.input}")

    output = args.output or args.input.with_suffix(".gsvx")
    data = ply_to_gsvx(args.input)
    output.write_bytes(data)

    count = struct.unpack_from("<I", data, 8)[0]
    print(f"Wrote {count} Gaussians ({len(data)} bytes) to {output}")


if __name__ == "__main__":
    main()
