#!/usr/bin/env python3
"""Tests for camera_pipeline.py — math utilities and parsers.

Run with:
    python3 scripts/test_camera_pipeline.py
"""

import math
import os
import sys

# Allow running from project root or scripts/ directory
_script_dir = os.path.dirname(os.path.abspath(__file__))
if _script_dir not in sys.path:
    sys.path.insert(0, _script_dir)

from camera_pipeline import (
    vec3_sub, vec3_add, vec3_scale, vec3_dot, vec3_norm,
    vec3_normalize, vec3_lerp, vec3_cross,
    quat_multiply, quat_conjugate, quat_normalize, quat_angle,
    slerp, quat_to_matrix, matrix_to_quat,
    TrajectoryFrame, parse_colmap, parse_nerfstudio,
    detect_format, load_trajectory,
)

# ---------------------------------------------------------------------------
# Test harness
# ---------------------------------------------------------------------------

passed = 0
failed = 0


def check(cond, msg):
    global passed, failed
    if cond:
        passed += 1
        print(f"  PASS  {msg}")
    else:
        failed += 1
        print(f"  FAIL  {msg}")


def approx_eq(a, b, tol=1e-5):
    return abs(a - b) < tol


def vec_approx_eq(a, b, tol=1e-5):
    return all(abs(a[i] - b[i]) < tol for i in range(len(a)))


def section(title):
    print(f"\n--- {title} ---")


# ---------------------------------------------------------------------------
# Vec3 math
# ---------------------------------------------------------------------------
section("Vec3 math")

check(vec_approx_eq(vec3_sub([3,2,1],[1,1,1]), [2,1,0]), "vec3_sub")
check(vec_approx_eq(vec3_add([1,2,3],[4,5,6]), [5,7,9]), "vec3_add")
check(vec_approx_eq(vec3_scale([1,2,3], 2.0), [2,4,6]), "vec3_scale")
check(approx_eq(vec3_dot([1,0,0],[0,1,0]), 0.0), "vec3_dot orthogonal")
check(approx_eq(vec3_dot([1,0,0],[1,0,0]), 1.0), "vec3_dot parallel")
check(approx_eq(vec3_norm([3,4,0]), 5.0), "vec3_norm")
check(vec_approx_eq(vec3_normalize([3,0,0]), [1,0,0]), "vec3_normalize")
check(vec_approx_eq(vec3_lerp([0,0,0],[2,4,6], 0.5), [1,2,3]), "vec3_lerp midpoint")
check(vec_approx_eq(vec3_cross([1,0,0],[0,1,0]), [0,0,1]), "vec3_cross x×y=z")
check(vec_approx_eq(vec3_cross([0,1,0],[1,0,0]), [0,0,-1]), "vec3_cross y×x=-z")

# ---------------------------------------------------------------------------
# Quaternion math: identity
# ---------------------------------------------------------------------------
section("Quaternion math — identity")

identity = [1.0, 0.0, 0.0, 0.0]
q90y = quat_normalize([math.cos(math.pi/4), 0, math.sin(math.pi/4), 0])

check(vec_approx_eq(quat_multiply(identity, identity), identity), "identity * identity = identity")
check(vec_approx_eq(quat_conjugate(identity), identity), "conjugate of identity = identity")
check(approx_eq(quat_angle(identity, identity), 0.0), "angle(identity, identity) = 0")

# ---------------------------------------------------------------------------
# Quaternion math: round-trip matrix
# ---------------------------------------------------------------------------
section("Quaternion math — round-trip matrix conversion")

def test_roundtrip(q, label):
    qn = quat_normalize(q)
    m = quat_to_matrix(qn)
    qback = matrix_to_quat(m)
    # Accept both q and -q (double cover)
    ok = vec_approx_eq(qback, qn, tol=1e-5) or vec_approx_eq(qback, [-c for c in qn], tol=1e-5)
    check(ok, f"round-trip {label}")

test_roundtrip(identity, "identity")
test_roundtrip(q90y, "90° yaw")
# 45° pitch
q45p = quat_normalize([math.cos(math.pi/8), math.sin(math.pi/8), 0, 0])
test_roundtrip(q45p, "45° pitch")
# 90° roll
q90r = quat_normalize([math.cos(math.pi/4), 0, 0, math.sin(math.pi/4)])
test_roundtrip(q90r, "90° roll")
# Arbitrary quaternion
q_arb = quat_normalize([0.5, 0.5, 0.3, 0.7])
test_roundtrip(q_arb, "arbitrary")

# ---------------------------------------------------------------------------
# Quaternion math: angle
# ---------------------------------------------------------------------------
section("Quaternion math — angle")

check(approx_eq(quat_angle(identity, q90y), math.pi/2, tol=1e-4), "angle identity→90°yaw = π/2")
check(approx_eq(quat_angle(q90y, q90y), 0.0, tol=1e-5), "angle self = 0")

# Double-cover: q and -q should give angle 0
neg_identity = [-1.0, 0.0, 0.0, 0.0]
check(approx_eq(quat_angle(identity, neg_identity), 0.0, tol=1e-5), "double-cover: angle(q,-q)=0")

# ---------------------------------------------------------------------------
# Quaternion math: slerp
# ---------------------------------------------------------------------------
section("Quaternion math — slerp")

check(vec_approx_eq(slerp(identity, q90y, 0.0), identity, tol=1e-5), "slerp t=0 → a")
mid = slerp(identity, q90y, 1.0)
check(vec_approx_eq(mid, q90y, tol=1e-5), "slerp t=1 → b")

# Midpoint of 0→90° should be 45°
q45y_expected = quat_normalize([math.cos(math.pi/8), 0, math.sin(math.pi/8), 0])
q45y_slerp = slerp(identity, q90y, 0.5)
check(approx_eq(quat_angle(q45y_slerp, q45y_expected), 0.0, tol=1e-4), "slerp midpoint 0→90°=45°")

# Slerp should return unit quaternion
check(approx_eq(math.sqrt(sum(c*c for c in q45y_slerp)), 1.0, tol=1e-5), "slerp result is unit quat")

# ---------------------------------------------------------------------------
# COLMAP parser
# ---------------------------------------------------------------------------
section("COLMAP parser")

_project_root = os.path.dirname(_script_dir)
colmap_images = os.path.join(_project_root, "tests/test_data/colmap_sample/images.txt")
colmap_cameras = os.path.join(_project_root, "tests/test_data/colmap_sample/cameras.txt")

frames_colmap = parse_colmap(colmap_images)

check(len(frames_colmap) == 10, f"COLMAP frame count = 10 (got {len(frames_colmap)})")

# FOV: 2*atan(1920/(2*960)) = 2*atan(1) = 2*(π/4) = 90°
expected_fov = 90.0
if frames_colmap:
    check(approx_eq(frames_colmap[0].fov_degrees, expected_fov, tol=0.1),
          f"COLMAP FOV = 90° (got {frames_colmap[0].fov_degrees:.2f}°)")

# Frame 0 should be near origin (z=0, x=0, y=0 before Y-flip → y stays 0)
if frames_colmap:
    f0 = frames_colmap[0]
    check(approx_eq(f0.position[0], 0.0, tol=1e-4), "COLMAP frame0 x≈0")
    check(approx_eq(f0.position[1], 0.0, tol=1e-4), "COLMAP frame0 y≈0")
    check(approx_eq(f0.position[2], 0.0, tol=1e-4), "COLMAP frame0 z≈0")

# Frames should have increasing Z-ish motion (camera moves along Z axis in world)
if len(frames_colmap) >= 5:
    # The camera positions should differ across frames
    pos_diffs = [
        vec3_norm(vec3_sub(frames_colmap[i+1].position, frames_colmap[i].position))
        for i in range(len(frames_colmap)-1)
    ]
    check(all(d > 0.01 for d in pos_diffs), "COLMAP frames have distinct positions")

# All frames have valid unit quaternions
quat_norms = [math.sqrt(sum(c*c for c in f.quaternion)) for f in frames_colmap]
check(all(approx_eq(n, 1.0, tol=1e-4) for n in quat_norms), "COLMAP all quaternions are unit")

# Indices are sequential
check(
    [f.index for f in frames_colmap] == list(range(10)),
    "COLMAP frame indices are sequential 0-9"
)

# ---------------------------------------------------------------------------
# Nerfstudio parser
# ---------------------------------------------------------------------------
section("Nerfstudio parser")

ns_transforms = os.path.join(_project_root, "tests/test_data/nerfstudio_sample/transforms.json")

frames_ns = parse_nerfstudio(ns_transforms)

check(len(frames_ns) == 10, f"Nerfstudio frame count = 10 (got {len(frames_ns)})")

# FOV: 2*atan(1920/(2*960)) = 90°
if frames_ns:
    check(approx_eq(frames_ns[0].fov_degrees, 90.0, tol=0.1),
          f"Nerfstudio FOV = 90° (got {frames_ns[0].fov_degrees:.2f}°)")

# Positions should move along X axis: frame i has x=i
if frames_ns:
    x_positions = [f.position[0] for f in frames_ns]
    check(vec_approx_eq(x_positions, [float(i) for i in range(10)], tol=1e-4),
          "Nerfstudio positions move along X axis (x=0..9)")

# Y and Z should be ~0 for all frames
if frames_ns:
    check(all(approx_eq(f.position[1], 0.0, tol=1e-4) for f in frames_ns),
          "Nerfstudio all frames y≈0")
    check(all(approx_eq(f.position[2], 0.0, tol=1e-4) for f in frames_ns),
          "Nerfstudio all frames z≈0")

# Identity rotation → quaternion should be near identity
if frames_ns:
    check(
        approx_eq(quat_angle(frames_ns[0].quaternion, [1,0,0,0]), 0.0, tol=1e-4),
        "Nerfstudio identity matrix → identity quaternion"
    )

# All unit quaternions
ns_quat_norms = [math.sqrt(sum(c*c for c in f.quaternion)) for f in frames_ns]
check(all(approx_eq(n, 1.0, tol=1e-4) for n in ns_quat_norms), "Nerfstudio all quaternions are unit")

# Indices are sequential
check(
    [f.index for f in frames_ns] == list(range(10)),
    "Nerfstudio frame indices are sequential 0-9"
)

# ---------------------------------------------------------------------------
# Format detection
# ---------------------------------------------------------------------------
section("Format detection")

check(detect_format(ns_transforms) == "nerfstudio",
      "detect_format transforms.json → nerfstudio")
check(detect_format(colmap_images) == "colmap",
      "detect_format images.txt → colmap")
check(detect_format("/nonexistent/file.xyz") == "unknown",
      "detect_format unknown extension → unknown")

# load_trajectory auto-dispatch
frames_auto_ns = load_trajectory(ns_transforms)
check(len(frames_auto_ns) == 10, "load_trajectory(nerfstudio) returns 10 frames")

frames_auto_colmap = load_trajectory(colmap_images)
check(len(frames_auto_colmap) == 10, "load_trajectory(colmap) returns 10 frames")

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
total = passed + failed
print(f"\n{'='*40}")
print(f"Results: {passed}/{total} passed", end="")
if failed > 0:
    print(f"  ({failed} FAILED)")
else:
    print("  ALL PASS")
print('='*40)

sys.exit(0 if failed == 0 else 1)
