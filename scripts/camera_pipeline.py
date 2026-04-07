#!/usr/bin/env python3
"""Camera trajectory pipeline for GSeurat.

Parses COLMAP and Nerfstudio camera data, provides math utilities for
quaternion interpolation and trajectory processing.

No external dependencies — stdlib + math only.
"""

import math
import json
import os
import sys
import argparse
import uuid
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
# 8. Gaussian smoothing
# ---------------------------------------------------------------------------

def _gaussian_kernel(sigma, radius=None):
    """Build a normalized 1D Gaussian kernel."""
    if radius is None:
        radius = int(math.ceil(sigma * 3))
    kernel = [math.exp(-0.5 * (i / sigma) ** 2) for i in range(-radius, radius + 1)]
    total = sum(kernel)
    return [k / total for k in kernel]


def smooth_trajectory(frames, sigma=2.0):
    """Apply Gaussian smoothing to positions and orientations.

    Mirror-reflects at boundaries. Preserves frame count.

    Args:
        frames: List of TrajectoryFrame.
        sigma: Gaussian sigma (in frame units).

    Returns:
        New list of TrajectoryFrame with smoothed positions and quaternions.
    """
    n = len(frames)
    if n == 0:
        return []
    if n == 1:
        return [TrajectoryFrame(
            position=list(frames[0].position),
            quaternion=list(frames[0].quaternion),
            fov_degrees=frames[0].fov_degrees,
            index=frames[0].index,
        )]

    kernel = _gaussian_kernel(sigma)
    radius = len(kernel) // 2

    def mirror_index(i, length):
        """Mirror-reflect index i into [0, length)."""
        if i < 0:
            i = -i
        if i >= length:
            i = 2 * length - 2 - i
        # Clamp for edge case (very small n)
        return max(0, min(length - 1, i))

    result = []
    for fi in range(n):
        # Weighted average position
        pos = [0.0, 0.0, 0.0]
        for ki, w in enumerate(kernel):
            src_i = mirror_index(fi + ki - radius, n)
            src_pos = frames[src_i].position
            pos[0] += w * src_pos[0]
            pos[1] += w * src_pos[1]
            pos[2] += w * src_pos[2]

        # Weighted average of quaternions (ensure hemisphere consistency)
        # Use first frame in window as reference hemisphere
        ref_q = None
        qsum = [0.0, 0.0, 0.0, 0.0]
        for ki, w in enumerate(kernel):
            src_i = mirror_index(fi + ki - radius, n)
            q = list(frames[src_i].quaternion)
            if ref_q is None:
                ref_q = q
            # Ensure same hemisphere as reference
            dot = sum(ref_q[c] * q[c] for c in range(4))
            if dot < 0.0:
                q = [-c for c in q]
            qsum[0] += w * q[0]
            qsum[1] += w * q[1]
            qsum[2] += w * q[2]
            qsum[3] += w * q[3]

        q_smooth = quat_normalize(qsum)

        result.append(TrajectoryFrame(
            position=pos,
            quaternion=q_smooth,
            fov_degrees=frames[fi].fov_degrees,
            index=frames[fi].index,
        ))

    return result


# ---------------------------------------------------------------------------
# 9. Rotation-aware RDP simplification
# ---------------------------------------------------------------------------

def _point_to_segment_param(p, a, b):
    """Project point p onto segment ab, return t in [0, 1]."""
    ab = vec3_sub(b, a)
    ap = vec3_sub(p, a)
    len_sq = vec3_dot(ab, ab)
    if len_sq < 1e-12:
        return 0.0
    t = vec3_dot(ap, ab) / len_sq
    return max(0.0, min(1.0, t))


def _trajectory_distance(point, start, end, rotation_weight):
    """Combined position + rotation deviation of point from segment start→end."""
    t = _point_to_segment_param(point.position, start.position, end.position)
    closest = vec3_lerp(start.position, end.position, t)
    pos_dist = vec3_norm(vec3_sub(point.position, closest))
    expected_q = slerp(start.quaternion, end.quaternion, t)
    angle_dist = quat_angle(point.quaternion, expected_q)
    return pos_dist + rotation_weight * angle_dist


def _rdp_recursive(frames, epsilon, rotation_weight, start, end, result_indices):
    """Standard RDP recursion using combined distance metric."""
    if end - start <= 1:
        return

    max_dist = 0.0
    max_idx = start + 1

    for i in range(start + 1, end):
        dist = _trajectory_distance(frames[i], frames[start], frames[end],
                                    rotation_weight)
        if dist > max_dist:
            max_dist = dist
            max_idx = i

    if max_dist > epsilon:
        result_indices.add(max_idx)
        _rdp_recursive(frames, epsilon, rotation_weight, start, max_idx, result_indices)
        _rdp_recursive(frames, epsilon, rotation_weight, max_idx, end, result_indices)


def rdp_simplify(frames, epsilon=2.5, rotation_weight=2.0, min_points=4):
    """Simplify trajectory using rotation-aware Ramer-Douglas-Peucker.

    After RDP, pads to min_points by splitting the largest remaining gaps.

    Args:
        frames: List of TrajectoryFrame.
        epsilon: Distance threshold for RDP.
        rotation_weight: Weight applied to rotation deviation (radians → meters).
        min_points: Minimum points to retain.

    Returns:
        Simplified list of TrajectoryFrame.
    """
    n = len(frames)
    if n <= min_points:
        return list(frames)

    # Always keep first and last
    result_indices = {0, n - 1}
    _rdp_recursive(frames, epsilon, rotation_weight, 0, n - 1, result_indices)

    # Pad to min_points by splitting largest gaps
    while len(result_indices) < min_points:
        sorted_idx = sorted(result_indices)
        # Find gap with largest position span
        best_gap_size = -1.0
        best_mid = None
        for i in range(len(sorted_idx) - 1):
            a = sorted_idx[i]
            b = sorted_idx[i + 1]
            if b - a <= 1:
                continue
            mid = (a + b) // 2
            gap_size = vec3_norm(vec3_sub(frames[b].position, frames[a].position))
            if gap_size > best_gap_size:
                best_gap_size = gap_size
                best_mid = mid
        if best_mid is None:
            break
        result_indices.add(best_mid)

    return [frames[i] for i in sorted(result_indices)]


# ---------------------------------------------------------------------------
# 10. Volume generator
# ---------------------------------------------------------------------------

def _quat_to_pitch_yaw(q):
    """Extract pitch and yaw (radians) from a quaternion.

    Forward vector is -Z column of the rotation matrix.
    pitch = asin(forward.y), yaw = atan2(forward.x, forward.z)
    """
    m = quat_to_matrix(q)
    # Forward = -Z column = [-m[0][2], -m[1][2], -m[2][2]]
    fx = -m[0][2]
    fy = -m[1][2]
    fz = -m[2][2]

    pitch = math.asin(max(-1.0, min(1.0, fy)))
    yaw = math.atan2(fx, fz)
    return pitch, yaw


def generate_volume(frames, margin=1.0, camera_mode="free_look"):
    """Compute AABB camera volume from trajectory frames.

    Args:
        frames: List of TrajectoryFrame.
        margin: Padding added to each side of the AABB.
        camera_mode: Mode string embedded in params.

    Returns:
        Dict with id, shape (type/center/half_extents), and params.
    """
    if not frames:
        return {}

    xs = [f.position[0] for f in frames]
    ys = [f.position[1] for f in frames]
    zs = [f.position[2] for f in frames]

    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    min_z, max_z = min(zs), max(zs)

    center = [
        (min_x + max_x) * 0.5,
        (min_y + max_y) * 0.5,
        (min_z + max_z) * 0.5,
    ]
    half_extents = [
        (max_x - min_x) * 0.5 + margin,
        (max_y - min_y) * 0.5 + margin,
        (max_z - min_z) * 0.5 + margin,
    ]

    # Derive pitch/yaw limits from frame orientations
    pitches = []
    yaws = []
    for f in frames:
        p, y = _quat_to_pitch_yaw(f.quaternion)
        pitches.append(p)
        yaws.append(y)

    pitch_min = math.degrees(min(pitches)) - 5.0
    pitch_max = math.degrees(max(pitches)) + 5.0

    yaw_min_raw = math.degrees(min(yaws))
    yaw_max_raw = math.degrees(max(yaws))
    yaw_range = yaw_max_raw - yaw_min_raw

    unrestricted_yaw = yaw_range > 350.0

    fov = frames[0].fov_degrees if frames else 50.0

    params = {
        "mode": camera_mode,
        "fov": fov,
        "pitch_min": pitch_min,
        "pitch_max": pitch_max,
    }
    if unrestricted_yaw:
        params["yaw_unrestricted"] = True
    else:
        params["yaw_min"] = yaw_min_raw - 10.0
        params["yaw_max"] = yaw_max_raw + 10.0

    return {
        "id": str(uuid.uuid4()),
        "shape": {
            "type": "aabb",
            "center": center,
            "half_extents": half_extents,
        },
        "params": params,
    }


# ---------------------------------------------------------------------------
# 11. Rail generator
# ---------------------------------------------------------------------------

def generate_rail(frames, look_distance=5.0):
    """Generate a camera rail from trajectory frames.

    Args:
        frames: List of TrajectoryFrame.
        look_distance: How far ahead of each control point the target sits.

    Returns:
        Dict with id, control_points, target_points.
    """
    control_points = []
    target_points = []

    for f in frames:
        control_points.append(list(f.position))

        # Forward vector = -Z column of rotation matrix
        m = quat_to_matrix(f.quaternion)
        forward = [-m[0][2], -m[1][2], -m[2][2]]
        target = vec3_add(f.position, vec3_scale(forward, look_distance))
        target_points.append(target)

    return {
        "id": str(uuid.uuid4()),
        "control_points": control_points,
        "target_points": target_points,
    }


# ---------------------------------------------------------------------------
# 12. JSON output
# ---------------------------------------------------------------------------

def generate_camera_zones_json(frames, margin=1.0, camera_mode="free_look",
                                do_volume=True, do_rail=True, look_distance=5.0):
    """Build a camera_zones JSON block from trajectory frames.

    Args:
        frames: List of TrajectoryFrame.
        margin: AABB margin for volumes.
        camera_mode: Camera mode string.
        do_volume: Include volumes block.
        do_rail: Include rails block.
        look_distance: Look-ahead distance for rail targets.

    Returns:
        Dict with "camera_zones" key containing default_params, volumes, rails.
    """
    fov = frames[0].fov_degrees if frames else 50.0

    default_params = {
        "mode": camera_mode,
        "fov": fov,
    }

    volumes = []
    if do_volume and frames:
        vol = generate_volume(frames, margin=margin, camera_mode=camera_mode)
        if vol:
            volumes.append(vol)

    rails = []
    if do_rail and frames:
        rail = generate_rail(frames, look_distance=look_distance)
        if rail:
            rails.append(rail)

    return {
        "camera_zones": {
            "default_params": default_params,
            "volumes": volumes,
            "rails": rails,
        }
    }


# ---------------------------------------------------------------------------
# 13. CLI main()
# ---------------------------------------------------------------------------

def main():
    """CLI entry point for the camera trajectory pipeline."""
    parser = argparse.ArgumentParser(
        description="Camera trajectory pipeline — smooth, simplify, and export zones.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--input", "-i", required=True,
                        help="Path to images.txt (COLMAP) or transforms.json (Nerfstudio).")
    parser.add_argument("--output", "-o", default=None,
                        help="Output JSON path. Defaults to <input>.camera_zones.json")
    parser.add_argument("--smoothing-sigma", type=float, default=2.0,
                        help="Gaussian smoothing sigma (0 = no smoothing).")
    parser.add_argument("--strength", type=float, default=2.5,
                        help="RDP epsilon threshold.")
    parser.add_argument("--rotation-weight", type=float, default=2.0,
                        help="RDP rotation weight (radians to meters scaling).")
    parser.add_argument("--margin", type=float, default=1.0,
                        help="AABB margin for volume generation.")
    parser.add_argument("--fov", type=float, default=None,
                        help="Override FOV (degrees). Uses parsed value by default.")
    parser.add_argument("--look-distance", type=float, default=5.0,
                        help="Rail look-ahead distance.")
    parser.add_argument("--camera-mode", default="free_look",
                        help="Camera mode string embedded in zone params.")
    parser.add_argument("--no-rail", action="store_true",
                        help="Skip rail generation.")
    parser.add_argument("--no-volume", action="store_true",
                        help="Skip volume generation.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print stats and JSON to stdout; do not write file.")

    args = parser.parse_args()

    # Load
    print(f"Loading: {args.input}", file=sys.stderr)
    frames = load_trajectory(args.input)
    print(f"  Loaded {len(frames)} frames", file=sys.stderr)

    # Smooth
    if args.smoothing_sigma > 0.0 and len(frames) > 1:
        frames = smooth_trajectory(frames, sigma=args.smoothing_sigma)
        print(f"  Smoothed with sigma={args.smoothing_sigma} → {len(frames)} frames",
              file=sys.stderr)

    # RDP simplify
    before = len(frames)
    frames = rdp_simplify(frames, epsilon=args.strength,
                          rotation_weight=args.rotation_weight)
    print(f"  RDP simplify: {before} → {len(frames)} frames "
          f"(epsilon={args.strength}, rot_weight={args.rotation_weight})",
          file=sys.stderr)

    # Override FOV if requested
    if args.fov is not None:
        for f in frames:
            f.fov_degrees = args.fov

    # Generate zones JSON
    result = generate_camera_zones_json(
        frames,
        margin=args.margin,
        camera_mode=args.camera_mode,
        do_volume=not args.no_volume,
        do_rail=not args.no_rail,
        look_distance=args.look_distance,
    )

    zones = result["camera_zones"]
    print(f"  Generated {len(zones['volumes'])} volume(s), "
          f"{len(zones['rails'])} rail(s)", file=sys.stderr)

    json_str = json.dumps(result, indent=2)

    if args.dry_run:
        print(json_str)
    else:
        out_path = args.output
        if out_path is None:
            out_path = args.input + ".camera_zones.json"
        with open(out_path, "w") as f:
            f.write(json_str)
            f.write("\n")
        print(f"  Written to: {out_path}", file=sys.stderr)


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    main()
