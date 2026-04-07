# Camera Zone Data Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Python CLI tool that auto-generates camera zone metadata (volumes, rails) from COLMAP/nerfstudio trajectory data, plus a Bricklayer import button for the output.

**Architecture:** Single Python script (`scripts/camera_pipeline.py`) with modular functions: trajectory parsing (COLMAP + nerfstudio), Gaussian smoothing, rotation-aware RDP simplification, volume/rail generation. No external dependencies beyond Python stdlib + math. Bricklayer gains an [Import] button that reads the JSON output and bulk-adds camera entities.

**Tech Stack:** Python 3.10+ (stdlib only — math, struct, json, argparse), TypeScript/React (Bricklayer import)

**Spec:** `docs/superpowers/specs/2026-04-07-camera-data-pipeline-design.md`

---

### File Structure

| File | Purpose |
|------|---------|
| `scripts/camera_pipeline.py` | CLI tool: parsers, smoothing, RDP, volume gen, JSON output |
| `scripts/test_camera_pipeline.py` | Unit tests for all pipeline components |
| `tests/test_data/colmap_sample/images.txt` | COLMAP test fixture (10 frames) |
| `tests/test_data/colmap_sample/cameras.txt` | COLMAP camera params fixture |
| `tests/test_data/nerfstudio_sample/transforms.json` | Nerfstudio test fixture (10 frames) |
| `tools/apps/bricklayer/src/panels/ProjectTree.tsx` | Add [Import] button to Camera section (modify) |
| `tools/apps/bricklayer/src/store/useSceneStore.ts` | Add `importCameraZonesJson` action (modify) |

---

### Task 1: Test Fixtures — COLMAP and Nerfstudio Sample Data

**Files:**
- Create: `tests/test_data/colmap_sample/images.txt`
- Create: `tests/test_data/colmap_sample/cameras.txt`
- Create: `tests/test_data/nerfstudio_sample/transforms.json`

- [ ] **Step 1: Create COLMAP images.txt fixture**

Create `tests/test_data/colmap_sample/images.txt` with 10 camera frames along a straight path (Z axis), slight yaw rotation:

```
# Image list with two lines of data per image:
#   IMAGE_ID, QW, QX, QY, QZ, TX, TY, TZ, CAMERA_ID, NAME
#   POINTS2D[] as (X, Y, POINT3D_ID)
1 1.0 0.0 0.0 0.0 0.0 0.0 0.0 1 frame_001.jpg

2 0.9988 0.0 0.0489 0.0 0.0 0.0 -1.0 1 frame_002.jpg

3 0.9951 0.0 0.0998 0.0 0.0 0.0 -2.0 1 frame_003.jpg

4 0.9877 0.0 0.1564 0.0 0.0 0.0 -3.0 1 frame_004.jpg

5 0.9808 0.0 0.1951 0.0 0.0 0.0 -4.0 1 frame_005.jpg

6 0.9808 0.0 0.1951 0.0 0.0 0.0 -5.0 1 frame_006.jpg

7 0.9877 0.0 0.1564 0.0 0.0 0.0 -6.0 1 frame_007.jpg

8 0.9951 0.0 0.0998 0.0 0.0 0.0 -7.0 1 frame_008.jpg

9 0.9988 0.0 0.0489 0.0 0.0 0.0 -8.0 1 frame_009.jpg

10 1.0 0.0 0.0 0.0 0.0 0.0 -9.0 1 frame_010.jpg

```

Note: COLMAP format uses alternating lines — pose line then points line (empty here). Quaternion is w-first `[qw, qx, qy, qz]`. Translation is camera-to-world `[tx, ty, tz]`.

- [ ] **Step 2: Create COLMAP cameras.txt fixture**

Create `tests/test_data/colmap_sample/cameras.txt`:

```
# Camera list with one line of data per camera:
#   CAMERA_ID, MODEL, WIDTH, HEIGHT, PARAMS[]
1 PINHOLE 1920 1080 960.0 960.0 960.0 540.0
```

This is a pinhole camera with focal length 960px at 1920x1080. FOV = 2*atan(1920/(2*960)) = 2*atan(1) = 90 degrees.

- [ ] **Step 3: Create nerfstudio transforms.json fixture**

Create `tests/test_data/nerfstudio_sample/transforms.json`:

```json
{
  "fl_x": 960.0,
  "fl_y": 960.0,
  "cx": 960.0,
  "cy": 540.0,
  "w": 1920,
  "h": 1080,
  "camera_model": "OPENCV",
  "frames": [
    {"file_path": "images/frame_001.jpg", "transform_matrix": [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]},
    {"file_path": "images/frame_002.jpg", "transform_matrix": [[0.995,0,0.0998,1],[0,1,0,0],[-0.0998,0,0.995,0],[0,0,0,1]]},
    {"file_path": "images/frame_003.jpg", "transform_matrix": [[0.980,0,0.1987,2],[0,1,0,0],[-0.1987,0,0.980,0],[0,0,0,1]]},
    {"file_path": "images/frame_004.jpg", "transform_matrix": [[0.955,0,0.2955,3],[0,1,0,0],[-0.2955,0,0.955,0],[0,0,0,1]]},
    {"file_path": "images/frame_005.jpg", "transform_matrix": [[0.921,0,0.3894,4],[0,1,0,0],[-0.3894,0,0.921,0],[0,0,0,1]]},
    {"file_path": "images/frame_006.jpg", "transform_matrix": [[0.921,0,0.3894,5],[0,1,0,0],[-0.3894,0,0.921,0],[0,0,0,1]]},
    {"file_path": "images/frame_007.jpg", "transform_matrix": [[0.955,0,0.2955,6],[0,1,0,0],[-0.2955,0,0.955,0],[0,0,0,1]]},
    {"file_path": "images/frame_008.jpg", "transform_matrix": [[0.980,0,0.1987,7],[0,1,0,0],[-0.1987,0,0.980,0],[0,0,0,1]]},
    {"file_path": "images/frame_009.jpg", "transform_matrix": [[0.995,0,0.0998,8],[0,1,0,0],[-0.0998,0,0.995,0],[0,0,0,1]]},
    {"file_path": "images/frame_010.jpg", "transform_matrix": [[1,0,0,9],[0,1,0,0],[0,0,1,0],[0,0,0,1]]}
  ]
}
```

- [ ] **Step 4: Commit**

```bash
git add tests/test_data/colmap_sample/ tests/test_data/nerfstudio_sample/
git commit -m "test: add COLMAP and nerfstudio sample trajectory fixtures"
```

---

### Task 2: Core Math Utilities and TrajectoryFrame

**Files:**
- Create: `scripts/camera_pipeline.py`
- Create: `scripts/test_camera_pipeline.py`

- [ ] **Step 1: Write tests for quaternion math utilities**

Create `scripts/test_camera_pipeline.py`:

```python
#!/usr/bin/env python3
"""Tests for camera_pipeline.py"""

import math
import sys
import os

# Add scripts dir to path
sys.path.insert(0, os.path.dirname(__file__))
from camera_pipeline import (
    TrajectoryFrame, quat_to_matrix, matrix_to_quat, quat_multiply,
    quat_conjugate, quat_angle, slerp, vec3_norm, vec3_dot,
)

passed = 0
failed = 0

def check(cond, msg):
    global passed, failed
    if cond:
        print(f"  PASS: {msg}")
        passed += 1
    else:
        print(f"  FAIL: {msg}")
        failed += 1

def near(a, b, eps=0.01):
    return abs(a - b) < eps

def near_vec(a, b, eps=0.01):
    return all(abs(ai - bi) < eps for ai, bi in zip(a, b))


print("=== Quaternion Math ===")

# Identity quaternion → identity matrix
m = quat_to_matrix([1, 0, 0, 0])
check(near_vec(m[0], [1, 0, 0]), "identity quat → row 0 = [1,0,0]")
check(near_vec(m[1], [0, 1, 0]), "identity quat → row 1 = [0,1,0]")
check(near_vec(m[2], [0, 0, 1]), "identity quat → row 2 = [0,0,1]")

# Matrix → quaternion round-trip
q_orig = [0.707, 0, 0.707, 0]  # 90° around Y
m2 = quat_to_matrix(q_orig)
q_back = matrix_to_quat(m2)
check(near(quat_angle(q_orig, q_back), 0.0, 0.05), "quat→matrix→quat round-trip")

# Quaternion angle
check(near(quat_angle([1,0,0,0], [1,0,0,0]), 0.0), "angle between identical quats = 0")
q90 = [math.cos(math.pi/4), 0, math.sin(math.pi/4), 0]  # 90° around Y
check(near(quat_angle([1,0,0,0], q90), math.pi/2, 0.05), "angle for 90° rotation ≈ π/2")

# Slerp
q_mid = slerp([1,0,0,0], q90, 0.5)
check(near(quat_angle([1,0,0,0], q_mid), math.pi/4, 0.05), "slerp(0, 90°, 0.5) ≈ 45°")
check(near_vec(slerp([1,0,0,0], q90, 0.0), [1,0,0,0], 0.01), "slerp t=0 = start")
check(near_vec(slerp([1,0,0,0], q90, 1.0), q90, 0.05), "slerp t=1 = end")

print(f"\n=== Results: {passed} passed, {failed} failed ===")
sys.exit(1 if failed > 0 else 0)
```

- [ ] **Step 2: Create camera_pipeline.py with math utilities**

Create `scripts/camera_pipeline.py`:

```python
#!/usr/bin/env python3
"""Camera zone data pipeline — generates camera_zones JSON from scan trajectory data.

Supports COLMAP (images.txt) and nerfstudio (transforms.json) formats.
"""

import argparse
import json
import math
import os
import struct
import sys
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

# ── Vector / Quaternion Math (no numpy dependency) ──

def vec3_sub(a, b):
    return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]

def vec3_add(a, b):
    return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]

def vec3_scale(v, s):
    return [v[0]*s, v[1]*s, v[2]*s]

def vec3_dot(a, b):
    return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]

def vec3_norm(v):
    return math.sqrt(vec3_dot(v, v))

def vec3_normalize(v):
    n = vec3_norm(v)
    return [v[0]/n, v[1]/n, v[2]/n] if n > 1e-12 else [0, 0, 0]

def vec3_lerp(a, b, t):
    return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t]

def vec3_cross(a, b):
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]

# Quaternions: [w, x, y, z] convention throughout

def quat_multiply(a, b):
    """Hamilton product: a * b. Convention: [w, x, y, z]."""
    return [
        a[0]*b[0] - a[1]*b[1] - a[2]*b[2] - a[3]*b[3],
        a[0]*b[1] + a[1]*b[0] + a[2]*b[3] - a[3]*b[2],
        a[0]*b[2] - a[1]*b[3] + a[2]*b[0] + a[3]*b[1],
        a[0]*b[3] + a[1]*b[2] - a[2]*b[1] + a[3]*b[0],
    ]

def quat_conjugate(q):
    return [q[0], -q[1], -q[2], -q[3]]

def quat_normalize(q):
    n = math.sqrt(sum(c*c for c in q))
    return [c/n for c in q] if n > 1e-12 else [1, 0, 0, 0]

def quat_angle(a, b):
    """Angle in radians between two quaternions."""
    dot = sum(ai*bi for ai, bi in zip(a, b))
    dot = max(-1.0, min(1.0, abs(dot)))  # abs handles double-cover
    return 2.0 * math.acos(dot)

def slerp(a, b, t):
    """Spherical linear interpolation between quaternions."""
    dot = sum(ai*bi for ai, bi in zip(a, b))
    if dot < 0:
        b = [-c for c in b]
        dot = -dot
    dot = min(dot, 1.0)
    if dot > 0.9995:
        # Linear interpolation for nearly identical quaternions
        result = [ai + (bi - ai) * t for ai, bi in zip(a, b)]
        return quat_normalize(result)
    theta = math.acos(dot)
    sin_theta = math.sin(theta)
    wa = math.sin((1 - t) * theta) / sin_theta
    wb = math.sin(t * theta) / sin_theta
    return quat_normalize([wa*ai + wb*bi for ai, bi in zip(a, b)])

def quat_to_matrix(q):
    """Convert quaternion [w,x,y,z] to 3x3 rotation matrix (row-major lists)."""
    w, x, y, z = q
    return [
        [1-2*(y*y+z*z), 2*(x*y-w*z),   2*(x*z+w*y)],
        [2*(x*y+w*z),   1-2*(x*x+z*z), 2*(y*z-w*x)],
        [2*(x*z-w*y),   2*(y*z+w*x),   1-2*(x*x+y*y)],
    ]

def matrix_to_quat(m):
    """Convert 3x3 rotation matrix to quaternion [w,x,y,z]."""
    trace = m[0][0] + m[1][1] + m[2][2]
    if trace > 0:
        s = 0.5 / math.sqrt(trace + 1.0)
        return quat_normalize([0.25/s, (m[2][1]-m[1][2])*s, (m[0][2]-m[2][0])*s, (m[1][0]-m[0][1])*s])
    elif m[0][0] > m[1][1] and m[0][0] > m[2][2]:
        s = 2.0 * math.sqrt(1.0 + m[0][0] - m[1][1] - m[2][2])
        return quat_normalize([(m[2][1]-m[1][2])/s, 0.25*s, (m[0][1]+m[1][0])/s, (m[0][2]+m[2][0])/s])
    elif m[1][1] > m[2][2]:
        s = 2.0 * math.sqrt(1.0 + m[1][1] - m[0][0] - m[2][2])
        return quat_normalize([(m[0][2]-m[2][0])/s, (m[0][1]+m[1][0])/s, 0.25*s, (m[1][2]+m[2][1])/s])
    else:
        s = 2.0 * math.sqrt(1.0 + m[2][2] - m[0][0] - m[1][1])
        return quat_normalize([(m[1][0]-m[0][1])/s, (m[0][2]+m[2][0])/s, (m[1][2]+m[2][1])/s, 0.25*s])


# ── Trajectory Frame ──

@dataclass
class TrajectoryFrame:
    position: list      # [x, y, z] Y-up world space
    quaternion: list     # [w, x, y, z]
    fov_degrees: float = 50.0
    index: int = 0
```

- [ ] **Step 3: Run tests**

Run: `cd /Users/eccyan/dev/GSeurat && python3 scripts/test_camera_pipeline.py`

Expected: All quaternion math tests PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/camera_pipeline.py scripts/test_camera_pipeline.py
git commit -m "feat(pipeline): add quaternion math utilities and TrajectoryFrame"
```

---

### Task 3: COLMAP and Nerfstudio Parsers

**Files:**
- Modify: `scripts/camera_pipeline.py` (add parsers)
- Modify: `scripts/test_camera_pipeline.py` (add parser tests)

- [ ] **Step 1: Add parser tests**

Append to `scripts/test_camera_pipeline.py`, before the results section:

```python
from camera_pipeline import parse_colmap, parse_nerfstudio, detect_format

print("\n=== COLMAP Parser ===")
colmap_path = os.path.join(os.path.dirname(__file__), "..", "tests", "test_data", "colmap_sample", "images.txt")
frames = parse_colmap(colmap_path)
check(len(frames) == 10, f"COLMAP: loaded 10 frames (got {len(frames)})")
check(near(frames[0].fov_degrees, 90.0, 5.0), f"COLMAP: FOV ≈ 90° (got {frames[0].fov_degrees:.1f}°)")
# Frame 1 has identity rotation, translation [0,0,0] → position at origin
check(near_vec(frames[0].position, [0, 0, 0], 0.1), f"COLMAP: frame 0 at origin")
# Frame 10 has translation [0,0,-9] → world pos = -R^T * t
check(frames[9].position[2] > 5.0, f"COLMAP: frame 9 moved forward (z={frames[9].position[2]:.1f})")

print("\n=== Nerfstudio Parser ===")
ns_path = os.path.join(os.path.dirname(__file__), "..", "tests", "test_data", "nerfstudio_sample", "transforms.json")
ns_frames = parse_nerfstudio(ns_path)
check(len(ns_frames) == 10, f"Nerfstudio: loaded 10 frames (got {len(ns_frames)})")
check(near(ns_frames[0].fov_degrees, 90.0, 5.0), f"Nerfstudio: FOV ≈ 90° (got {ns_frames[0].fov_degrees:.1f}°)")
check(near_vec(ns_frames[0].position, [0, 0, 0], 0.1), "Nerfstudio: frame 0 at origin")
check(near(ns_frames[9].position[0], 9.0, 0.5), f"Nerfstudio: frame 9 at x≈9 (got {ns_frames[9].position[0]:.1f})")

print("\n=== Format Detection ===")
check(detect_format(colmap_path) == "colmap", "detect COLMAP from images.txt")
check(detect_format(ns_path) == "nerfstudio", "detect nerfstudio from transforms.json")
```

- [ ] **Step 2: Implement parsers**

Add to `scripts/camera_pipeline.py`:

```python
# ── COLMAP Parser ──

def _parse_colmap_cameras(cameras_path):
    """Parse cameras.txt for FOV. Returns {camera_id: fov_degrees}."""
    fovs = {}
    if not os.path.exists(cameras_path):
        return fovs
    with open(cameras_path, "r") as f:
        for line in f:
            line = line.strip()
            if line.startswith("#") or not line:
                continue
            parts = line.split()
            cam_id = int(parts[0])
            model = parts[1]
            width = float(parts[2])
            if model in ("PINHOLE", "SIMPLE_PINHOLE"):
                focal = float(parts[4])
                fov = 2.0 * math.atan(width / (2.0 * focal))
                fovs[cam_id] = math.degrees(fov)
            elif model == "OPENCV":
                focal = float(parts[4])
                fov = 2.0 * math.atan(width / (2.0 * focal))
                fovs[cam_id] = math.degrees(fov)
    return fovs


def parse_colmap(images_path):
    """Parse COLMAP images.txt → List[TrajectoryFrame]."""
    cameras_dir = os.path.dirname(images_path)
    cameras_path = os.path.join(cameras_dir, "cameras.txt")
    fov_map = _parse_colmap_cameras(cameras_path)
    default_fov = 50.0

    frames = []
    with open(images_path, "r") as f:
        lines = [l.strip() for l in f if l.strip() and not l.strip().startswith("#")]

    # Every other line is a pose line (odd indices 0, 2, 4, ...)
    for i in range(0, len(lines), 2):
        parts = lines[i].split()
        if len(parts) < 10:
            continue
        qw, qx, qy, qz = float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4])
        tx, ty, tz = float(parts[5]), float(parts[6]), float(parts[7])
        cam_id = int(parts[8])

        # COLMAP: world-to-camera rotation + translation
        # World position = -R^T * t
        q = quat_normalize([qw, qx, qy, qz])
        R = quat_to_matrix(q)
        # R^T * t
        rt = [
            R[0][0]*tx + R[1][0]*ty + R[2][0]*tz,
            R[0][1]*tx + R[1][1]*ty + R[2][1]*tz,
            R[0][2]*tx + R[1][2]*ty + R[2][2]*tz,
        ]
        world_pos = [-rt[0], -rt[1], -rt[2]]

        # Coordinate conversion: COLMAP Y-down → Y-up
        world_pos[1] = -world_pos[1]
        # Also flip quaternion Y component for Y-up
        q_world = quat_conjugate(q)  # camera-to-world rotation
        q_world[2] = -q_world[2]     # flip Y axis

        fov = fov_map.get(cam_id, default_fov)

        frames.append(TrajectoryFrame(
            position=world_pos,
            quaternion=quat_normalize(q_world),
            fov_degrees=fov,
            index=len(frames),
        ))

    return frames


# ── Nerfstudio Parser ──

def parse_nerfstudio(transforms_path):
    """Parse nerfstudio transforms.json → List[TrajectoryFrame]."""
    with open(transforms_path, "r") as f:
        data = json.load(f)

    # FOV from focal length
    fov = 50.0
    if "fl_x" in data and "w" in data:
        fov = math.degrees(2.0 * math.atan(data["w"] / (2.0 * data["fl_x"])))

    frames = []
    for i, frame in enumerate(data.get("frames", [])):
        mat = frame.get("transform_matrix")
        if not mat or len(mat) < 3:
            continue

        # Extract position from column 3
        pos = [mat[0][3], mat[1][3], mat[2][3]]

        # Extract 3x3 rotation and convert to quaternion
        rot = [mat[0][:3], mat[1][:3], mat[2][:3]]
        q = matrix_to_quat(rot)

        frames.append(TrajectoryFrame(
            position=pos,
            quaternion=q,
            fov_degrees=fov,
            index=i,
        ))

    return frames


# ── Format Detection ──

def detect_format(path):
    """Auto-detect trajectory file format. Returns 'colmap', 'nerfstudio', or None."""
    ext = os.path.splitext(path)[1].lower()
    if ext == ".json":
        try:
            with open(path, "r") as f:
                data = json.load(f)
            if "frames" in data:
                return "nerfstudio"
        except (json.JSONDecodeError, KeyError):
            pass
    elif ext == ".txt":
        with open(path, "r") as f:
            for line in f:
                line = line.strip()
                if line.startswith("#"):
                    continue
                # COLMAP images.txt: first data line has 10+ fields
                if len(line.split()) >= 10:
                    return "colmap"
                break
    return None


def load_trajectory(path):
    """Load trajectory from auto-detected format."""
    fmt = detect_format(path)
    if fmt == "colmap":
        return parse_colmap(path), fmt
    elif fmt == "nerfstudio":
        return parse_nerfstudio(path), fmt
    else:
        raise ValueError(f"Unknown trajectory format: {path}")
```

- [ ] **Step 3: Run tests**

Run: `cd /Users/eccyan/dev/GSeurat && python3 scripts/test_camera_pipeline.py`

Expected: All parser tests PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/camera_pipeline.py scripts/test_camera_pipeline.py
git commit -m "feat(pipeline): add COLMAP and nerfstudio trajectory parsers"
```

---

### Task 4: Gaussian Smoothing and RDP Simplification

**Files:**
- Modify: `scripts/camera_pipeline.py` (add smoothing + RDP)
- Modify: `scripts/test_camera_pipeline.py` (add tests)

- [ ] **Step 1: Add smoothing and RDP tests**

Append to `scripts/test_camera_pipeline.py`:

```python
from camera_pipeline import smooth_trajectory, rdp_simplify

print("\n=== Gaussian Smoothing ===")
# Create jittery trajectory: straight line with noise
jittery = []
for i in range(50):
    noise = 0.5 * math.sin(i * 7.3)  # deterministic "jitter"
    jittery.append(TrajectoryFrame(
        position=[float(i), 1.0 + noise, 0.0],
        quaternion=[1, 0, 0, 0],
        index=i,
    ))
smoothed = smooth_trajectory(jittery, sigma=3.0)
check(len(smoothed) == len(jittery), "smoothing preserves frame count")
# Smoothed middle frame should have less Y deviation than original
orig_dev = abs(jittery[25].position[1] - 1.0)
smooth_dev = abs(smoothed[25].position[1] - 1.0)
check(smooth_dev < orig_dev, f"smoothing reduces Y jitter ({orig_dev:.3f} → {smooth_dev:.3f})")

print("\n=== RDP Simplification ===")
# Straight line: should simplify to just endpoints
straight = [TrajectoryFrame(position=[float(i), 0, 0], quaternion=[1,0,0,0], index=i) for i in range(20)]
simplified = rdp_simplify(straight, epsilon=0.5, rotation_weight=2.0)
check(len(simplified) <= 4, f"straight line → ≤4 points (got {len(simplified)})")

# L-shaped path: should keep the corner
corner = []
for i in range(10):
    corner.append(TrajectoryFrame(position=[float(i), 0, 0], quaternion=[1,0,0,0], index=i))
for i in range(10):
    corner.append(TrajectoryFrame(position=[9.0, 0, float(i+1)], quaternion=[1,0,0,0], index=10+i))
simplified_corner = rdp_simplify(corner, epsilon=0.5, rotation_weight=2.0)
check(len(simplified_corner) >= 3, f"L-shape keeps corner (got {len(simplified_corner)} points)")

# Rotation change: stationary camera with rotation should retain points
rotating = []
for i in range(20):
    angle = (i / 19.0) * math.pi  # 0 to 180 degrees
    q = [math.cos(angle/2), 0, math.sin(angle/2), 0]
    rotating.append(TrajectoryFrame(position=[0, 0, 0], quaternion=q, index=i))
simplified_rot = rdp_simplify(rotating, epsilon=0.5, rotation_weight=2.0)
check(len(simplified_rot) >= 4, f"rotating-in-place retains points (got {len(simplified_rot)})")
```

- [ ] **Step 2: Implement smoothing and RDP**

Add to `scripts/camera_pipeline.py`:

```python
# ── Gaussian Smoothing ──

def _gaussian_kernel(sigma, radius=None):
    """Generate 1D Gaussian kernel weights."""
    if radius is None:
        radius = int(math.ceil(sigma * 3))
    kernel = []
    for i in range(-radius, radius + 1):
        kernel.append(math.exp(-0.5 * (i / sigma) ** 2))
    total = sum(kernel)
    return [k / total for k in kernel]


def smooth_trajectory(frames, sigma=2.0):
    """Apply Gaussian smoothing to trajectory positions and quaternions."""
    if sigma <= 0 or len(frames) < 3:
        return frames

    n = len(frames)
    kernel = _gaussian_kernel(sigma)
    radius = len(kernel) // 2

    smoothed = []
    for i in range(n):
        # Weighted average of positions
        pos = [0.0, 0.0, 0.0]
        quat_accum = list(frames[i].quaternion)  # start from center
        total_w = 0.0

        for k, w in enumerate(kernel):
            j = i + (k - radius)
            # Mirror-reflect at boundaries
            j = max(0, min(n - 1, j))
            if j < 0:
                j = -j
            if j >= n:
                j = 2 * (n - 1) - j

            pos[0] += frames[j].position[0] * w
            pos[1] += frames[j].position[1] * w
            pos[2] += frames[j].position[2] * w
            total_w += w

        pos = [p / total_w for p in pos]

        # Quaternion smoothing: iterative weighted slerp toward weighted mean
        # Simple approach: weighted average then normalize
        q_sum = [0.0, 0.0, 0.0, 0.0]
        ref_q = frames[i].quaternion
        for k, w in enumerate(kernel):
            j = max(0, min(n - 1, i + (k - radius)))
            q = list(frames[j].quaternion)
            # Ensure consistent hemisphere
            if sum(a * b for a, b in zip(q, ref_q)) < 0:
                q = [-c for c in q]
            q_sum = [q_sum[c] + q[c] * w for c in range(4)]
        q_avg = quat_normalize(q_sum)

        smoothed.append(TrajectoryFrame(
            position=pos,
            quaternion=q_avg,
            fov_degrees=frames[i].fov_degrees,
            index=frames[i].index,
        ))

    return smoothed


# ── Rotation-Aware RDP Simplification ──

def _point_to_segment_param(p, a, b):
    """Project point p onto line segment ab. Returns parameter t in [0,1]."""
    ab = vec3_sub(b, a)
    ap = vec3_sub(p, a)
    ab_len2 = vec3_dot(ab, ab)
    if ab_len2 < 1e-12:
        return 0.0
    t = vec3_dot(ap, ab) / ab_len2
    return max(0.0, min(1.0, t))


def _trajectory_distance(point, start, end, rotation_weight):
    """Combined positional + rotational distance for RDP."""
    t = _point_to_segment_param(point.position, start.position, end.position)
    closest = vec3_lerp(start.position, end.position, t)
    pos_dist = vec3_norm(vec3_sub(point.position, closest))

    expected_q = slerp(start.quaternion, end.quaternion, t)
    angle_dist = quat_angle(point.quaternion, expected_q)

    return pos_dist + rotation_weight * angle_dist


def _rdp_recursive(frames, epsilon, rotation_weight, start, end, result_indices):
    """Recursive RDP with rotation-aware distance metric."""
    if end - start < 2:
        return

    max_dist = 0.0
    max_idx = start

    for i in range(start + 1, end):
        d = _trajectory_distance(frames[i], frames[start], frames[end], rotation_weight)
        if d > max_dist:
            max_dist = d
            max_idx = i

    if max_dist > epsilon:
        result_indices.add(max_idx)
        _rdp_recursive(frames, epsilon, rotation_weight, start, max_idx, result_indices)
        _rdp_recursive(frames, epsilon, rotation_weight, max_idx, end, result_indices)


def rdp_simplify(frames, epsilon=2.5, rotation_weight=2.0, min_points=4):
    """Simplify trajectory using rotation-aware Ramer-Douglas-Peucker.

    Args:
        frames: List of TrajectoryFrame
        epsilon: Distance tolerance (meters + weighted radians)
        rotation_weight: Radians-to-meters conversion factor
        min_points: Minimum output points

    Returns:
        Simplified List[TrajectoryFrame]
    """
    if len(frames) <= min_points:
        return list(frames)

    # Always keep first and last
    result_indices = {0, len(frames) - 1}
    _rdp_recursive(frames, epsilon, rotation_weight, 0, len(frames) - 1, result_indices)

    # Ensure minimum point count by adding evenly spaced points
    sorted_indices = sorted(result_indices)
    while len(sorted_indices) < min_points and len(sorted_indices) < len(frames):
        # Find largest gap and split it
        max_gap = 0
        max_gap_idx = 0
        for i in range(len(sorted_indices) - 1):
            gap = sorted_indices[i + 1] - sorted_indices[i]
            if gap > max_gap:
                max_gap = gap
                max_gap_idx = i
        mid = (sorted_indices[max_gap_idx] + sorted_indices[max_gap_idx + 1]) // 2
        if mid not in result_indices:
            result_indices.add(mid)
        sorted_indices = sorted(result_indices)

    return [frames[i] for i in sorted(result_indices)]
```

- [ ] **Step 3: Run tests**

Run: `cd /Users/eccyan/dev/GSeurat && python3 scripts/test_camera_pipeline.py`

Expected: All smoothing + RDP tests PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/camera_pipeline.py scripts/test_camera_pipeline.py
git commit -m "feat(pipeline): add Gaussian smoothing and rotation-aware RDP simplification"
```

---

### Task 5: Volume Generator and JSON Output

**Files:**
- Modify: `scripts/camera_pipeline.py` (add volume gen + JSON output + CLI)
- Modify: `scripts/test_camera_pipeline.py` (add tests)

- [ ] **Step 1: Add volume generation and output tests**

Append to `scripts/test_camera_pipeline.py`:

```python
from camera_pipeline import generate_volume, generate_rail, generate_camera_zones_json

print("\n=== Volume Generator ===")
# Frames along X axis from 0 to 10
vol_frames = [TrajectoryFrame(position=[float(i), 1.0, 2.0], quaternion=[1,0,0,0], index=i) for i in range(11)]
vol = generate_volume(vol_frames, margin=1.0)
check(near(vol["shape"]["center"][0], 5.0, 0.5), f"volume center X ≈ 5 (got {vol['shape']['center'][0]:.1f})")
check(near(vol["shape"]["half_extents"][0], 6.0, 0.5), f"volume half_extent X ≈ 6 (5+1 margin) (got {vol['shape']['half_extents'][0]:.1f})")
check(vol["shape"]["type"] == "aabb", "volume shape is AABB")
check("pitch_min" in vol["params"], "volume has pitch_min param")
check("pitch_max" in vol["params"], "volume has pitch_max param")

print("\n=== Rail Generator ===")
rail = generate_rail(vol_frames, look_distance=5.0)
check(len(rail["control_points"]) == 11, f"rail has 11 control points (got {len(rail['control_points'])})")
check("target_points" in rail, "rail has target_points")
check(len(rail["target_points"]) == 11, f"rail has 11 target points")

print("\n=== JSON Output ===")
output = generate_camera_zones_json(vol_frames, margin=1.0, camera_mode="free_look", generate_volume=True, generate_rail=True, look_distance=5.0)
check("camera_zones" in output, "output has camera_zones key")
cz = output["camera_zones"]
check(len(cz.get("volumes", [])) == 1, "output has 1 volume")
check(len(cz.get("rails", [])) == 1, "output has 1 rail")
# Verify JSON serializable
json_str = json.dumps(output, indent=2)
check(len(json_str) > 100, f"output serializes to JSON ({len(json_str)} chars)")
```

- [ ] **Step 2: Implement volume/rail generation and JSON output**

Add to `scripts/camera_pipeline.py`:

```python
# ── Volume Generator ──

def _quat_to_pitch_yaw(q):
    """Extract pitch (elevation) and yaw (azimuth) from quaternion forward vector."""
    # Forward vector = quaternion rotated -Z
    R = quat_to_matrix(q)
    forward = [-R[0][2], -R[1][2], -R[2][2]]  # -Z column of rotation matrix
    pitch = math.degrees(math.asin(max(-1, min(1, forward[1]))))
    yaw = math.degrees(math.atan2(forward[0], forward[2]))
    return pitch, yaw


def generate_volume(frames, margin=1.0, camera_mode="free_look"):
    """Generate an AABB volume enclosing all camera positions.

    Returns a dict matching the camera_zones.volumes[] schema.
    """
    positions = [f.position for f in frames]

    # AABB
    mins = [min(p[i] for p in positions) for i in range(3)]
    maxs = [max(p[i] for p in positions) for i in range(3)]
    center = [(mins[i] + maxs[i]) / 2.0 for i in range(3)]
    half_extents = [(maxs[i] - mins[i]) / 2.0 + margin for i in range(3)]

    # Pitch/Yaw limits from orientations
    pitches = []
    yaws = []
    for f in frames:
        pitch, yaw = _quat_to_pitch_yaw(f.quaternion)
        pitches.append(pitch)
        yaws.append(yaw)

    pitch_min = min(pitches) - 5.0
    pitch_max = max(pitches) + 5.0
    pitch_min = max(pitch_min, -89.0)
    pitch_max = min(pitch_max, 89.0)

    # Yaw: check if range wraps around ±180
    yaw_range = max(yaws) - min(yaws)
    if yaw_range > 350:
        yaw_min, yaw_max = -180.0, 180.0
    else:
        yaw_min = min(yaws) - 10.0
        yaw_max = max(yaws) + 10.0
        yaw_min = max(yaw_min, -180.0)
        yaw_max = min(yaw_max, 180.0)

    fov = frames[0].fov_degrees if frames else 50.0

    params = {
        "mode": camera_mode,
        "fov": round(fov, 1),
        "pitch_min": round(pitch_min, 1),
        "pitch_max": round(pitch_max, 1),
    }
    if yaw_min > -180 or yaw_max < 180:
        params["yaw_min"] = round(yaw_min, 1)
        params["yaw_max"] = round(yaw_max, 1)

    return {
        "id": "scan_hull",
        "shape": {
            "type": "aabb",
            "center": [round(c, 3) for c in center],
            "half_extents": [round(h, 3) for h in half_extents],
        },
        "params": params,
    }


# ── Rail Generator ──

def generate_rail(frames, look_distance=5.0):
    """Generate a camera rail from simplified trajectory frames.

    Returns a dict matching the camera_zones.rails[] schema.
    """
    control_points = [[round(f.position[i], 3) for i in range(3)] for f in frames]

    # Target points: position + forward * look_distance
    target_points = []
    for f in frames:
        R = quat_to_matrix(f.quaternion)
        forward = [-R[0][2], -R[1][2], -R[2][2]]
        target = vec3_add(f.position, vec3_scale(forward, look_distance))
        target_points.append([round(target[i], 3) for i in range(3)])

    return {
        "id": "scan_path",
        "control_points": control_points,
        "target_points": target_points,
    }


# ── JSON Output ──

def generate_camera_zones_json(frames, margin=1.0, camera_mode="free_look",
                                generate_volume=True, generate_rail=True,
                                look_distance=5.0):
    """Generate complete camera_zones JSON block from trajectory frames."""
    cz = {}

    fov = frames[0].fov_degrees if frames else 50.0
    cz["default_params"] = {
        "mode": camera_mode,
        "fov": round(fov, 1),
    }

    if generate_volume:
        cz["volumes"] = [generate_volume_data(frames, margin, camera_mode)]

    if generate_rail and len(frames) >= 2:
        cz["rails"] = [generate_rail(frames, look_distance)]

    return {"camera_zones": cz}


# Rename to avoid shadowing
generate_volume_data = generate_volume
```

Wait — there's a naming issue. `generate_volume` is both the function and the boolean parameter in `generate_camera_zones_json`. Let me fix:

```python
def generate_camera_zones_json(frames, margin=1.0, camera_mode="free_look",
                                do_volume=True, do_rail=True,
                                look_distance=5.0):
    """Generate complete camera_zones JSON block from trajectory frames."""
    cz = {}

    fov = frames[0].fov_degrees if frames else 50.0
    cz["default_params"] = {
        "mode": camera_mode,
        "fov": round(fov, 1),
    }

    if do_volume:
        cz["volumes"] = [generate_volume(frames, margin, camera_mode)]

    if do_rail and len(frames) >= 2:
        cz["rails"] = [generate_rail(frames, look_distance)]

    return {"camera_zones": cz}
```

Update the test to use `do_volume`/`do_rail` parameter names.

- [ ] **Step 3: Add CLI main function**

Add to the end of `scripts/camera_pipeline.py`:

```python
# ── CLI ──

def main():
    parser = argparse.ArgumentParser(
        description="Generate camera_zones JSON from scan trajectory data.")
    parser.add_argument("--input", required=True, help="Path to COLMAP images.txt or nerfstudio transforms.json")
    parser.add_argument("--output", default="camera_zones.json", help="Output JSON file path")
    parser.add_argument("--strength", type=float, default=0.5, help="Simplification strength (0.0-1.0)")
    parser.add_argument("--margin", type=float, default=1.0, help="Volume expansion margin (meters)")
    parser.add_argument("--rotation-weight", type=float, default=2.0, help="Rotation sensitivity in RDP")
    parser.add_argument("--smoothing-sigma", type=float, default=2.0, help="Gaussian smoothing sigma (frames)")
    parser.add_argument("--fov", type=float, default=None, help="Override FOV (degrees)")
    parser.add_argument("--look-distance", type=float, default=5.0, help="Target point distance (meters)")
    parser.add_argument("--camera-mode", default="free_look", help="Camera mode for generated volume")
    parser.add_argument("--no-rail", action="store_true", help="Skip rail generation")
    parser.add_argument("--no-volume", action="store_true", help="Skip volume generation")
    parser.add_argument("--dry-run", action="store_true", help="Print stats without writing output")
    args = parser.parse_args()

    # Load trajectory
    frames, fmt = load_trajectory(args.input)
    print(f"[Pipeline] Input: {os.path.basename(args.input)} ({fmt})", file=sys.stderr)
    print(f"[Pipeline] Frames loaded: {len(frames)}", file=sys.stderr)

    if not frames:
        print("[Pipeline] ERROR: No frames loaded", file=sys.stderr)
        sys.exit(1)

    # Override FOV if specified
    if args.fov is not None:
        for f in frames:
            f.fov_degrees = args.fov

    # Smooth
    frames = smooth_trajectory(frames, sigma=args.smoothing_sigma)
    print(f"[Pipeline] After smoothing: {len(frames)} frames (sigma={args.smoothing_sigma})", file=sys.stderr)

    # Simplify
    epsilon = 0.1 + args.strength * 4.9
    simplified = rdp_simplify(frames, epsilon=epsilon, rotation_weight=args.rotation_weight)
    print(f"[Pipeline] After RDP (strength={args.strength}, epsilon={epsilon:.2f}): {len(simplified)} control points", file=sys.stderr)

    # Generate output
    output = generate_camera_zones_json(
        simplified,
        margin=args.margin,
        camera_mode=args.camera_mode,
        do_volume=not args.no_volume,
        do_rail=not args.no_rail,
        look_distance=args.look_distance,
    )

    # Print stats
    cz = output["camera_zones"]
    if "volumes" in cz:
        v = cz["volumes"][0]
        c = v["shape"]["center"]
        e = v["shape"]["half_extents"]
        print(f"[Pipeline] Volume: AABB center=({c[0]:.1f}, {c[1]:.1f}, {c[2]:.1f}) extents=({e[0]:.1f}, {e[1]:.1f}, {e[2]:.1f})", file=sys.stderr)
        p = v.get("params", {})
        print(f"[Pipeline] Pitch range: [{p.get('pitch_min', '?')}°, {p.get('pitch_max', '?')}°]", file=sys.stderr)
    if "rails" in cz:
        r = cz["rails"][0]
        print(f"[Pipeline] Rail: {len(r['control_points'])} control points, {len(r.get('target_points', []))} target points", file=sys.stderr)

    fov = cz.get("default_params", {}).get("fov", "?")
    print(f"[Pipeline] FOV: {fov}°", file=sys.stderr)

    if args.dry_run:
        print("[Pipeline] Dry run — no output written", file=sys.stderr)
        return

    # Write output
    with open(args.output, "w") as f:
        json.dump(output, f, indent=2)
    print(f"[Pipeline] Output: {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests + CLI dry-run**

Run: `cd /Users/eccyan/dev/GSeurat && python3 scripts/test_camera_pipeline.py`

Expected: All tests PASS.

Run: `python3 scripts/camera_pipeline.py --input tests/test_data/colmap_sample/images.txt --dry-run`

Expected: Statistics printed, no output file.

- [ ] **Step 5: Commit**

```bash
git add scripts/camera_pipeline.py scripts/test_camera_pipeline.py
git commit -m "feat(pipeline): add volume/rail generation and CLI interface"
```

---

### Task 6: End-to-End Test — Full Pipeline

**Files:**
- Modify: `scripts/test_camera_pipeline.py` (add end-to-end test)

- [ ] **Step 1: Add end-to-end test**

Append to `scripts/test_camera_pipeline.py`:

```python
import tempfile

print("\n=== End-to-End: COLMAP → JSON ===")
with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as tmp:
    tmp_path = tmp.name

try:
    # Run full pipeline on COLMAP fixture
    e2e_frames, e2e_fmt = load_trajectory(colmap_path)
    check(e2e_fmt == "colmap", "e2e: detected COLMAP")
    e2e_smoothed = smooth_trajectory(e2e_frames, sigma=1.0)
    e2e_simplified = rdp_simplify(e2e_smoothed, epsilon=1.0, rotation_weight=2.0)
    check(len(e2e_simplified) >= 2, f"e2e: simplified to {len(e2e_simplified)} points")

    e2e_output = generate_camera_zones_json(e2e_simplified, margin=1.0,
                                             do_volume=True, do_rail=True)

    # Write and re-read
    with open(tmp_path, "w") as f:
        json.dump(e2e_output, f, indent=2)
    with open(tmp_path, "r") as f:
        reloaded = json.load(f)

    cz = reloaded["camera_zones"]
    check("volumes" in cz and len(cz["volumes"]) > 0, "e2e: output has volumes")
    check("rails" in cz and len(cz["rails"]) > 0, "e2e: output has rails")
    vol = cz["volumes"][0]
    check(vol["shape"]["type"] == "aabb", "e2e: volume is AABB")
    check("center" in vol["shape"], "e2e: volume has center")
    check("half_extents" in vol["shape"], "e2e: volume has half_extents")
    rail = cz["rails"][0]
    check(len(rail["control_points"]) >= 2, f"e2e: rail has {len(rail['control_points'])} points")
    check(len(rail["target_points"]) >= 2, "e2e: rail has target points")
    check("default_params" in cz, "e2e: output has default_params")
finally:
    os.unlink(tmp_path)

print("\n=== End-to-End: Nerfstudio → JSON ===")
ns_frames2, ns_fmt2 = load_trajectory(ns_path)
check(ns_fmt2 == "nerfstudio", "e2e-ns: detected nerfstudio")
ns_output = generate_camera_zones_json(
    rdp_simplify(smooth_trajectory(ns_frames2, sigma=1.0), epsilon=1.0),
    do_volume=True, do_rail=True)
ns_cz = ns_output["camera_zones"]
check(len(ns_cz.get("volumes", [])) == 1, "e2e-ns: has 1 volume")
check(len(ns_cz.get("rails", [])) == 1, "e2e-ns: has 1 rail")
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/eccyan/dev/GSeurat && python3 scripts/test_camera_pipeline.py`

Expected: All tests PASS including end-to-end.

- [ ] **Step 3: Commit**

```bash
git add scripts/test_camera_pipeline.py
git commit -m "test(pipeline): add end-to-end COLMAP/nerfstudio pipeline tests"
```

---

### Task 7: Bricklayer Import Button

**Files:**
- Modify: `tools/apps/bricklayer/src/store/useSceneStore.ts`
- Modify: `tools/apps/bricklayer/src/panels/ProjectTree.tsx`

- [ ] **Step 1: Add `importCameraZonesJson` action to store**

In `useSceneStore.ts`, add action declaration:

```typescript
  importCameraZonesJson: (data: Record<string, unknown>) => void;
```

Implement (after the camera zone actions):

```typescript
      importCameraZonesJson: (data) => {
        const cz = (data as any).camera_zones;
        if (!cz) return;

        const s = get();
        const newVolumes = [...s.cameraVolumes];
        const newRails = [...s.cameraRails];
        const newTriggers = [...s.cameraTriggers];

        // Import volumes
        if (cz.volumes) {
          for (const v of cz.volumes) {
            newVolumes.push({
              id: genId('camvol'),
              name: v.id || `Imported Volume ${newVolumes.length + 1}`,
              shape: v.shape,
              params: { ...DEFAULT_CAMERA_ZONE_PARAMS, ...v.params },
            });
          }
        }

        // Import rails
        if (cz.rails) {
          for (const r of cz.rails) {
            newRails.push({
              id: genId('camrail'),
              name: r.id || `Imported Rail ${newRails.length + 1}`,
              control_points: r.control_points,
              target_points: r.target_points,
            });
          }
        }

        // Import triggers
        if (cz.triggers) {
          for (const t of cz.triggers) {
            newTriggers.push({
              id: genId('camtrig'),
              shape: t.shape,
              from_zone: t.from_zone,
              to_zone: t.to_zone ?? '',
              blend_override: t.blend_override ?? -1,
            });
          }
        }

        // Update default params if provided
        const newDefaults = cz.default_params
          ? { ...s.cameraDefaultParams, ...cz.default_params }
          : s.cameraDefaultParams;

        set({
          cameraVolumes: newVolumes,
          cameraRails: newRails,
          cameraTriggers: newTriggers,
          cameraDefaultParams: newDefaults,
          isDirty: true,
        });
      },
```

- [ ] **Step 2: Add [Import] button to ProjectTree**

In `ProjectTree.tsx`, add an import handler and button to the Camera section header.

Add store selector:
```typescript
const importCameraZonesJson = useSceneStore((s) => s.importCameraZonesJson);
```

Add handler function inside the component:
```typescript
  const handleImportTrajectory = async () => {
    try {
      const [fileHandle] = await (window as any).showOpenFilePicker({
        types: [{ description: 'Camera Zones JSON', accept: { 'application/json': ['.json'] } }],
      });
      const file = await fileHandle.getFile();
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.camera_zones) {
        alert('Invalid file: missing camera_zones block');
        return;
      }
      importCameraZonesJson(data);
    } catch (e) {
      // User cancelled file picker
    }
  };
```

Add the Import button to the Camera TreeNode's `actions` prop. Replace the Camera TreeNode:

```tsx
          <TreeNode
            icon={icons.camera} label="Camera"
            count={cameraVolumes.length + cameraTriggers.length + cameraRails.length}
            arrow={cameraOpen ? '\u25BE' : '\u25B8'}
            isActive={isActive({ kind: 'scene_category', category: 'camera_zones' as any })}
            onClick={() => { setCameraOpen(!cameraOpen); click({ kind: 'scene_category', category: 'camera_zones' as any }); }}
            actions={
              <button style={addBtnStyle} onClick={(e) => { e.stopPropagation(); handleImportTrajectory(); }}
                title="Import camera zones from pipeline JSON">
                Import
              </button>
            }
            isOpen={cameraOpen}
          >
```

Where `addBtnStyle` matches the existing add button style. Check how `addBtn()` is styled and use the same style object.

- [ ] **Step 3: Build and verify**

Run: `cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter bricklayer build 2>&1 | tail -5`

Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add tools/apps/bricklayer/src/store/useSceneStore.ts \
        tools/apps/bricklayer/src/panels/ProjectTree.tsx
git commit -m "feat(bricklayer): add [Import] button for camera pipeline JSON"
```

---

### Task 8: Integration Test — Full Workflow

**Files:** No new files — verification only.

- [ ] **Step 1: Run Python pipeline on COLMAP fixture**

Run: `cd /Users/eccyan/dev/GSeurat && python3 scripts/camera_pipeline.py --input tests/test_data/colmap_sample/images.txt --output /tmp/test_camera_zones.json`

Expected: Statistics printed, JSON file written.

- [ ] **Step 2: Verify output JSON structure**

Run: `python3 -c "import json; d=json.load(open('/tmp/test_camera_zones.json')); cz=d['camera_zones']; print(f'Volumes: {len(cz.get(\"volumes\",[]))}, Rails: {len(cz.get(\"rails\",[]))}')" `

Expected: `Volumes: 1, Rails: 1`

- [ ] **Step 3: Run Python pipeline on nerfstudio fixture**

Run: `python3 scripts/camera_pipeline.py --input tests/test_data/nerfstudio_sample/transforms.json --output /tmp/test_ns_zones.json --strength 0.3`

Expected: Statistics printed, JSON file written.

- [ ] **Step 4: Run all Python tests**

Run: `python3 scripts/test_camera_pipeline.py`

Expected: All tests PASS.

- [ ] **Step 5: Build Bricklayer**

Run: `cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter bricklayer build`

Expected: Clean build.

- [ ] **Step 6: Run C++ tests (no regressions)**

Run: `cd /Users/eccyan/dev/GSeurat && ctest --test-dir build/macos-debug --output-on-failure 2>&1 | tail -5`

Expected: 28/29 pass (same pre-existing failure).

- [ ] **Step 7: Commit any fixes**

```bash
git add -u
git commit -m "fix(pipeline): integration test fixes"
```
