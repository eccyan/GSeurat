#!/usr/bin/env python3
"""Test the ply_to_gseurat cooker writes valid v2 GSVX files."""

import struct
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from ply_to_gseurat import ply_to_gsvx


def make_test_ply(path: Path, count: int = 3) -> None:
    """Write a minimal binary PLY with `count` Gaussians."""
    with open(path, "wb") as f:
        header = (
            "ply\n"
            "format binary_little_endian 1.0\n"
            f"element vertex {count}\n"
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
        f.write(header.encode("ascii"))
        for i in range(count):
            pos = (float(i), float(i * 2), float(i * 3))
            f_dc = (0.0, 0.0, 0.0)
            opacity = 0.0
            scale = (0.0, 0.0, 0.0)
            rot = (1.0, 0.0, 0.0, 0.0)
            f.write(struct.pack("<14f", *pos, *f_dc, opacity, *scale, *rot))


def test_v2_header():
    with tempfile.TemporaryDirectory() as tmp:
        ply_path = Path(tmp) / "test.ply"
        make_test_ply(ply_path, count=3)

        data = ply_to_gsvx(ply_path)

        # Header should be 64 bytes
        assert len(data) == 64 + 3 * 64, f"Expected {64 + 3*64} bytes, got {len(data)}"

        # Parse header
        magic, version, count, flags = struct.unpack_from("<4sIII", data, 0)
        assert magic == b"GSVX"
        assert version == 2, f"Expected version 2, got {version}"
        assert count == 3
        assert flags == 0

        # Parse AABB
        aabb_min = struct.unpack_from("<3f", data, 16)
        aabb_max = struct.unpack_from("<3f", data, 28)

        # Positions are (0,0,0), (1,2,3), (2,4,6)
        assert abs(aabb_min[0] - 0.0) < 0.01, f"aabb_min.x = {aabb_min[0]}"
        assert abs(aabb_min[1] - 0.0) < 0.01, f"aabb_min.y = {aabb_min[1]}"
        assert abs(aabb_min[2] - 0.0) < 0.01, f"aabb_min.z = {aabb_min[2]}"
        assert abs(aabb_max[0] - 2.0) < 0.01, f"aabb_max.x = {aabb_max[0]}"
        assert abs(aabb_max[1] - 4.0) < 0.01, f"aabb_max.y = {aabb_max[1]}"
        assert abs(aabb_max[2] - 6.0) < 0.01, f"aabb_max.z = {aabb_max[2]}"

        # Reserved bytes should be zero
        reserved = data[40:64]
        assert all(b == 0 for b in reserved), "Reserved bytes must be zero"

    print("PASS: test_v2_header")


if __name__ == "__main__":
    test_v2_header()
