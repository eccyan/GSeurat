#!/usr/bin/env python3
"""Camera trajectory pipeline for GSeurat.

Parses COLMAP and Nerfstudio camera data, provides math utilities for
quaternion interpolation and trajectory processing.

No external dependencies — stdlib + math only.
"""

import math
import json
import os
from dataclasses import dataclass, field


# ---------------------------------------------------------------------------
# 1. Vector math (plain lists, no numpy)
# ---------------------------------------------------------------------------

def vec3_sub(a, b):
    """Subtract vector b from a: a - b."""
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]


def vec3_add(a, b):
    """Add two 3-vectors."""
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]


def vec3_scale(v, s):
    """Scale a 3-vector by scalar s."""
    return [v[0] * s, v[1] * s, v[2] * s]


def vec3_dot(a, b):
    """Dot product of two 3-vectors."""
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def vec3_norm(v):
    """Euclidean length of a 3-vector."""
    return math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])


def vec3_normalize(v):
    """Return unit vector; returns v unchanged if near-zero length."""
    n = vec3_norm(v)
    if n < 1e-10:
        return list(v)
    return [v[0] / n, v[1] / n, v[2] / n]


def vec3_lerp(a, b, t):
    """Linear interpolation between two 3-vectors."""
    return [a[i] + (b[i] - a[i]) * t for i in range(3)]


def vec3_cross(a, b):
    """Cross product of two 3-vectors."""
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]


# ---------------------------------------------------------------------------
# 2. Quaternion math — convention: [w, x, y, z]
# ---------------------------------------------------------------------------

def quat_multiply(a, b):
    """Hamilton product of two quaternions [w,x,y,z]."""
    aw, ax, ay, az = a
    bw, bx, by, bz = b
    return [
        aw * bw - ax * bx - ay * by - az * bz,
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
    ]


def quat_conjugate(q):
    """Conjugate of quaternion [w,x,y,z] — negates xyz."""
    return [q[0], -q[1], -q[2], -q[3]]


def quat_normalize(q):
    """Return unit quaternion; returns q unchanged if near-zero norm."""
    n = math.sqrt(sum(c * c for c in q))
    if n < 1e-10:
        return list(q)
    return [c / n for c in q]


def quat_angle(a, b):
    """Angle in radians between two quaternions (handles double-cover)."""
    a = quat_normalize(a)
    b = quat_normalize(b)
    d = sum(a[i] * b[i] for i in range(4))
    d = abs(d)  # double-cover: q and -q represent same rotation
    d = min(1.0, d)
    return 2.0 * math.acos(d)


def slerp(a, b, t):
    """Spherical linear interpolation between quaternions a and b at t in [0,1]."""
    a = quat_normalize(a)
    b = quat_normalize(b)

    dot = sum(a[i] * b[i] for i in range(4))

    # Choose shortest path (double-cover)
    if dot < 0.0:
        b = [-c for c in b]
        dot = -dot

    dot = min(1.0, dot)

    # Fall back to linear interpolation if very close
    if dot > 0.9995:
        result = [a[i] + t * (b[i] - a[i]) for i in range(4)]
        return quat_normalize(result)

    theta_0 = math.acos(dot)
    theta = theta_0 * t
    sin_theta = math.sin(theta)
    sin_theta_0 = math.sin(theta_0)

    s0 = math.cos(theta) - dot * sin_theta / sin_theta_0
    s1 = sin_theta / sin_theta_0
    return quat_normalize([s0 * a[i] + s1 * b[i] for i in range(4)])


def quat_to_matrix(q):
    """Convert quaternion [w,x,y,z] to 3x3 row-major rotation matrix."""
    w, x, y, z = quat_normalize(q)
    xx = x * x; yy = y * y; zz = z * z
    xy = x * y; xz = x * z; yz = y * z
    wx = w * x; wy = w * y; wz = w * z
    return [
        [1 - 2*(yy + zz),   2*(xy - wz),     2*(xz + wy)],
        [2*(xy + wz),       1 - 2*(xx + zz),  2*(yz - wx)],
        [2*(xz - wy),       2*(yz + wx),      1 - 2*(xx + yy)],
    ]


def matrix_to_quat(m):
    """Convert 3x3 row-major rotation matrix to quaternion [w,x,y,z].

    Handles all 4 Shepperd cases for numerical stability.
    """
    m00, m01, m02 = m[0]
    m10, m11, m12 = m[1]
    m20, m21, m22 = m[2]

    trace = m00 + m11 + m22

    if trace > 0.0:
        s = 0.5 / math.sqrt(trace + 1.0)
        w = 0.25 / s
        x = (m21 - m12) * s
        y = (m02 - m20) * s
        z = (m10 - m01) * s
    elif m00 > m11 and m00 > m22:
        s = 2.0 * math.sqrt(1.0 + m00 - m11 - m22)
        w = (m21 - m12) / s
        x = 0.25 * s
        y = (m01 + m10) / s
        z = (m02 + m20) / s
    elif m11 > m22:
        s = 2.0 * math.sqrt(1.0 + m11 - m00 - m22)
        w = (m02 - m20) / s
        x = (m01 + m10) / s
        y = 0.25 * s
        z = (m12 + m21) / s
    else:
        s = 2.0 * math.sqrt(1.0 + m22 - m00 - m11)
        w = (m10 - m01) / s
        x = (m02 + m20) / s
        y = (m12 + m21) / s
        z = 0.25 * s

    return quat_normalize([w, x, y, z])


# ---------------------------------------------------------------------------
# 3. TrajectoryFrame dataclass
# ---------------------------------------------------------------------------

@dataclass
class TrajectoryFrame:
    """A single camera pose in world space."""
    position: list      # [x, y, z]
    quaternion: list    # [w, x, y, z] camera-to-world orientation
    fov_degrees: float = 50.0
    index: int = 0


# ---------------------------------------------------------------------------
# 4. COLMAP parser
# ---------------------------------------------------------------------------

def _mat3_transpose(m):
    """Transpose a 3x3 row-major matrix."""
    return [
        [m[0][0], m[1][0], m[2][0]],
        [m[0][1], m[1][1], m[2][1]],
        [m[0][2], m[1][2], m[2][2]],
    ]


def _mat3_vec3_mul(m, v):
    """Multiply 3x3 matrix by 3-vector."""
    return [
        m[0][0]*v[0] + m[0][1]*v[1] + m[0][2]*v[2],
        m[1][0]*v[0] + m[1][1]*v[1] + m[1][2]*v[2],
        m[2][0]*v[0] + m[2][1]*v[1] + m[2][2]*v[2],
    ]


def parse_colmap(images_path):
    """Parse COLMAP images.txt and associated cameras.txt.

    COLMAP stores world-to-camera transform: q_wc, t_wc
    Converts to camera world position and camera-to-world orientation.

    Y-flip applied for Y-up coordinate convention.

    Args:
        images_path: Path to images.txt file.

    Returns:
        List of TrajectoryFrame sorted by image id.
    """
    images_dir = os.path.dirname(images_path)
    cameras_path = os.path.join(images_dir, "cameras.txt")

    # Parse cameras.txt for FOV
    fov_map = {}  # camera_id -> fov_degrees
    if os.path.exists(cameras_path):
        with open(cameras_path, "r") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                parts = line.split()
                if len(parts) < 5:
                    continue
                cam_id = int(parts[0])
                model = parts[1]
                width = float(parts[2])
                if model == "PINHOLE" and len(parts) >= 5:
                    focal = float(parts[4])  # fx
                    fov_rad = 2.0 * math.atan(width / (2.0 * focal))
                    fov_map[cam_id] = math.degrees(fov_rad)
                elif model in ("SIMPLE_PINHOLE", "SIMPLE_RADIAL", "RADIAL") and len(parts) >= 5:
                    focal = float(parts[4])  # f
                    fov_rad = 2.0 * math.atan(width / (2.0 * focal))
                    fov_map[cam_id] = math.degrees(fov_rad)

    frames = []
    with open(images_path, "r") as f:
        lines = [line.rstrip("\n") for line in f]

    # Collect non-comment lines; pose lines are every other non-comment line
    data_lines = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("#"):
            continue
        data_lines.append(stripped)

    i = 0
    frame_index = 0
    while i < len(data_lines):
        pose_line = data_lines[i]
        i += 1
        # Skip empty points line (even if empty string, still advance)
        if i < len(data_lines):
            i += 1  # skip points line

        if not pose_line:
            continue

        parts = pose_line.split()
        if len(parts) < 9:
            continue

        image_id = int(parts[0])
        qw = float(parts[1])
        qx = float(parts[2])
        qy = float(parts[3])
        qz = float(parts[4])
        tx = float(parts[5])
        ty = float(parts[6])
        tz = float(parts[7])
        cam_id = int(parts[8])

        # q_wc is world-to-camera quaternion
        # Camera-to-world quaternion: conjugate
        q_cw = quat_conjugate([qw, qx, qy, qz])

        # World-to-camera rotation matrix from q_wc
        R_wc = quat_to_matrix([qw, qx, qy, qz])

        # World position: p = -R_wc^T * t = -R_cw * t
        R_cw = _mat3_transpose(R_wc)
        t = [tx, ty, tz]
        pos = _mat3_vec3_mul(R_cw, t)
        pos = [-pos[0], -pos[1], -pos[2]]  # negate

        # Y-flip for Y-up convention
        pos[1] = -pos[1]
        q_cw[2] = -q_cw[2]  # flip Y component of quaternion

        fov = fov_map.get(cam_id, 50.0)

        frames.append(TrajectoryFrame(
            position=pos,
            quaternion=quat_normalize(q_cw),
            fov_degrees=fov,
            index=frame_index,
        ))
        frame_index += 1

    # Sort by original image_id order (already sequential but be safe)
    return frames


# ---------------------------------------------------------------------------
# 5. Nerfstudio parser
# ---------------------------------------------------------------------------

def parse_nerfstudio(transforms_path):
    """Parse Nerfstudio transforms.json.

    Args:
        transforms_path: Path to transforms.json.

    Returns:
        List of TrajectoryFrame in file order.
    """
    with open(transforms_path, "r") as f:
        data = json.load(f)

    fl_x = data.get("fl_x", 960.0)
    w = data.get("w", 1920)
    fov_rad = 2.0 * math.atan(w / (2.0 * fl_x))
    fov_degrees = math.degrees(fov_rad)

    frames = []
    for idx, frame in enumerate(data.get("frames", [])):
        mat = frame["transform_matrix"]  # 4x4 row-major

        # Position from column 3
        pos = [mat[0][3], mat[1][3], mat[2][3]]

        # Rotation from upper-left 3x3
        rot = [mat[i][:3] for i in range(3)]
        q = matrix_to_quat(rot)

        frames.append(TrajectoryFrame(
            position=pos,
            quaternion=q,
            fov_degrees=fov_degrees,
            index=idx,
        ))

    return frames


# ---------------------------------------------------------------------------
# 6. Format detection
# ---------------------------------------------------------------------------

def detect_format(path):
    """Detect camera data format from file path and content.

    Returns:
        "nerfstudio" | "colmap" | "unknown"
    """
    ext = os.path.splitext(path)[1].lower()

    if ext == ".json":
        try:
            with open(path, "r") as f:
                data = json.load(f)
            if "frames" in data:
                return "nerfstudio"
        except (json.JSONDecodeError, OSError):
            pass
        return "unknown"

    if ext == ".txt":
        try:
            with open(path, "r") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    parts = line.split()
                    if len(parts) >= 10:
                        return "colmap"
                    break
        except OSError:
            pass
        return "unknown"

    return "unknown"


# ---------------------------------------------------------------------------
# 7. load_trajectory — auto-detect and parse
# ---------------------------------------------------------------------------

def load_trajectory(path):
    """Auto-detect format and load trajectory frames.

    Args:
        path: Path to images.txt (COLMAP) or transforms.json (Nerfstudio).

    Returns:
        List of TrajectoryFrame.

    Raises:
        ValueError: If format cannot be detected.
    """
    fmt = detect_format(path)
    if fmt == "nerfstudio":
        return parse_nerfstudio(path)
    if fmt == "colmap":
        return parse_colmap(path)
    raise ValueError(f"Cannot detect camera format for: {path}")


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Usage: camera_pipeline.py <images.txt|transforms.json>")
        sys.exit(1)

    path = sys.argv[1]
    trajectory = load_trajectory(path)
    print(f"Loaded {len(trajectory)} frames from {path}")
    for f in trajectory[:3]:
        print(f"  [{f.index}] pos={[f'{v:.3f}' for v in f.position]} "
              f"fov={f.fov_degrees:.1f}°")
    if len(trajectory) > 3:
        print(f"  ...")
