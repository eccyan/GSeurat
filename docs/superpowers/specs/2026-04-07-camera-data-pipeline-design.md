# Camera Zone Data Pipeline — Phase 3

**Date:** 2026-04-07
**Status:** Draft
**Scope:** Phase 3 of 3 — Offline Python tool that auto-generates camera zone metadata from 3DGS scan trajectory data + PLY point clouds. Bricklayer import integration.

## Problem

Camera zones in Phase 1 (runtime) and Phase 2 (editor) must be authored manually. For scanned 3DGS scenes, the original capture trajectory already encodes "where the camera can safely go" — the scan path represents positions with guaranteed rendering quality. Manually recreating this as volumes and rails is tedious and error-prone. Level designers need an automated starting point derived from the source data.

## Solution

A Python CLI tool (`scripts/camera_pipeline.py`) that reads COLMAP or nerfstudio trajectory data, simplifies the path via rotation-aware Ramer-Douglas-Peucker, generates boundary volumes from the camera hull, and outputs a `camera_zones` JSON block matching the Phase 1 schema. Bricklayer gains an [Import Trajectory] button that reads the pipeline's output.

## Trajectory Ingester

### Common Frame Type

```python
@dataclass
class TrajectoryFrame:
    position: np.ndarray    # [x, y, z] in Y-up world space
    quaternion: np.ndarray  # [w, x, y, z] normalized
    fov_degrees: float      # estimated FOV from focal length
    index: int              # frame ordering
```

### COLMAP Parser (`images.txt`)

File format: pairs of lines. Odd lines contain camera pose data:
```
IMAGE_ID QW QX QY QZ TX TY TZ CAMERA_ID NAME
POINTS2D[] (skip)
```

Parsing:
1. Skip comment lines (`#`).
2. Read odd-numbered non-comment lines.
3. Extract quaternion `[qw, qx, qy, qz]` and translation `[tx, ty, tz]`.
4. COLMAP stores world-to-camera transform. Convert to world position: `world_pos = -R^T * t` where `R = quat_to_matrix(q)`.
5. Coordinate conversion: COLMAP uses right-handed Y-down. Apply `y = -y_colmap` to convert to Y-up.
6. FOV: read from `cameras.txt` if provided alongside. Formula: `fov = 2 * atan(width / (2 * focal_length))`. Default to 50 degrees if unavailable.

### Nerfstudio Parser (`transforms.json`)

File format: JSON with `frames[]` array, each containing `transform_matrix` (4x4 row-major).

Parsing:
1. Read `frames[].transform_matrix` — extract position from column 3 (indices [0][3], [1][3], [2][3]).
2. Extract 3x3 rotation submatrix, convert to quaternion.
3. FOV: compute from `fl_x` and `w` in root: `fov = 2 * atan(w / (2 * fl_x))`. Default to 50 degrees if missing.
4. Coordinate conversion: nerfstudio uses OpenGL convention (Y-up, -Z forward). If `applied_transform` field is present, apply it. Otherwise coordinates are typically already Y-up compatible.

### Auto-Detection

- File extension `.txt` + first non-comment line matches `IMAGE_ID QW ...` pattern → COLMAP
- File extension `.json` + root has `frames` key → nerfstudio
- Else: error with supported format list

## Path Processor

### Step 1: Gaussian Smoothing

Apply 1D Gaussian kernel to remove handheld camera jitter:

- **Positions:** Standard 1D convolution with Gaussian kernel along the frame sequence. `sigma` configurable (default 2.0 frames).
- **Quaternions:** Iterative weighted slerp averaging within the kernel window. For each frame, compute weighted average of neighboring quaternions using the same Gaussian weights.
- Boundary handling: mirror-reflect at trajectory endpoints.

### Step 2: Rotation-Aware RDP Simplification

Ramer-Douglas-Peucker with a combined positional + rotational distance metric:

```python
def trajectory_distance(point, line_start, line_end):
    # Positional: perpendicular distance from point to line segment
    t = project_parameter(point.position, line_start.position, line_end.position)
    t = clamp(t, 0, 1)
    closest = lerp(line_start.position, line_end.position, t)
    pos_dist = np.linalg.norm(point.position - closest)

    # Rotational: angular deviation from interpolated orientation
    expected_quat = slerp(line_start.quaternion, line_end.quaternion, t)
    angle_dist = quaternion_angle(point.quaternion, expected_quat)  # radians

    # Weighted combination
    return pos_dist + rotation_weight * angle_dist
```

Parameters:
- `epsilon`: tolerance threshold. Derived from "Simplification Strength" slider: `epsilon = 0.1 + strength * 4.9` (maps 0.0–1.0 to 0.1–5.0 meters).
- `rotation_weight`: default 2.0. 1 radian of unexpected rotation ≈ 2 meters of positional deviation.
- Minimum output: at least 4 control points (Catmull-Rom needs ≥2, but 4 gives better curve shape).

The RDP algorithm:
1. Given a sequence of frames `[start, ..., end]`, find the frame with maximum `trajectory_distance` to the line segment `start → end`.
2. If max distance > epsilon: recursively simplify `[start, ..., max_point]` and `[max_point, ..., end]`.
3. If max distance <= epsilon: discard all intermediate points.
4. Always keep start and end points.

### Output

`List[TrajectoryFrame]` reduced from thousands to ~20-100 control points, preserving both positional shape and rotational intent.

## Volume Generator

### Camera Hull Volume

1. Collect all positions from the simplified trajectory.
2. Compute axis-aligned bounding box: `aabb_min = min(positions)`, `aabb_max = max(positions)`.
3. Expand by configurable margin (default 1.0m per axis).
4. Output as `CameraShape`:
   ```json
   {
     "type": "aabb",
     "center": [(min+max)/2 for each axis],
     "half_extents": [(max-min)/2 + margin for each axis]
   }
   ```

### Pitch/Yaw Limits from Trajectory

Derive view angle constraints from the actual camera orientations in the scan:

1. For each frame, extract pitch (elevation) and yaw (azimuth) from the quaternion's forward vector.
2. Compute pitch range: `[min_pitch, max_pitch]` across all frames.
3. Compute yaw range: `[min_yaw, max_yaw]` with circular wrap-around handling (detect if range crosses ±180°).
4. Add padding: pitch ±5°, yaw ±10°.
5. Clamp pitch to [-89, 89], yaw to [-180, 180].

If the yaw range exceeds 350° (nearly full rotation), set `yaw_min: -180, yaw_max: 180` (unrestricted).

### Target Points Generation

For each control point on the rail, compute a target point (where the camera was looking):

```python
forward = quaternion_to_forward_vector(frame.quaternion)  # -Z in camera space
target = frame.position + forward * look_distance  # default 5.0m ahead
```

This generates the `target_points` array for the rail, enabling `rail_follow` mode with authored look-at targets.

### Point Density Analysis (Stretch Goal)

Optional: load PLY and analyze Gaussian density to detect quality boundaries.

1. Read PLY file — extract only position and opacity (skip SH/rotation for speed).
2. Voxelize into 3D grid (1m cells).
3. Compute weighted density per cell: `sum(opacity)`.
4. Flood-fill from camera positions to find connected high-density region.
5. Compute AABB of the connected region as a tighter "quality boundary."
6. Optionally generate exclusion sub-volumes for low-density pockets within the hull.

This is a stretch goal — the camera hull from trajectory alone covers 90% of use cases.

## CLI Interface

```bash
# Basic usage: COLMAP trajectory → camera_zones JSON
python3 scripts/camera_pipeline.py \
  --input path/to/images.txt \
  --output camera_zones.json

# Nerfstudio with options
python3 scripts/camera_pipeline.py \
  --input path/to/transforms.json \
  --strength 0.5 \
  --margin 1.5 \
  --rotation-weight 2.0 \
  --output camera_zones.json

# With PLY density analysis (stretch goal)
python3 scripts/camera_pipeline.py \
  --input path/to/images.txt \
  --ply path/to/scene.ply \
  --density-analysis \
  --output camera_zones.json

# Dry run: print stats without writing
python3 scripts/camera_pipeline.py \
  --input path/to/images.txt \
  --dry-run
```

### CLI Arguments

| Argument | Default | Description |
|----------|---------|-------------|
| `--input` | required | Path to COLMAP images.txt or nerfstudio transforms.json |
| `--output` | `camera_zones.json` | Output JSON file path |
| `--strength` | `0.5` | Simplification strength (0.0=minimal, 1.0=aggressive) |
| `--margin` | `1.0` | Volume expansion margin (meters) |
| `--rotation-weight` | `2.0` | Rotation sensitivity in RDP metric |
| `--smoothing-sigma` | `2.0` | Gaussian smoothing kernel sigma (frames) |
| `--fov` | auto | Override FOV (degrees). Auto-detected from camera params if available |
| `--look-distance` | `5.0` | Distance for target point generation (meters) |
| `--camera-mode` | `free_look` | Default camera mode for generated volume |
| `--generate-rail` | `true` | Whether to output a camera rail |
| `--generate-volume` | `true` | Whether to output a boundary volume |
| `--ply` | none | Optional PLY file for density analysis |
| `--density-analysis` | `false` | Enable point density analysis (requires --ply) |
| `--dry-run` | `false` | Print statistics without writing output |

### Output Statistics (printed to stderr)

```
[Pipeline] Input: images.txt (COLMAP)
[Pipeline] Frames loaded: 1847
[Pipeline] After smoothing: 1847 frames (sigma=2.0)
[Pipeline] After RDP (strength=0.5, epsilon=2.55): 47 control points
[Pipeline] Volume: AABB center=(5.2, 1.8, 3.1) extents=(8.5, 3.0, 6.2)
[Pipeline] Pitch range: [-32°, 12°] → limits [-37°, 17°]
[Pipeline] Yaw range: [-145°, 160°] → unrestricted (>350° span)
[Pipeline] FOV: 50° (from cameras.txt)
[Pipeline] Output: camera_zones.json (1 volume, 1 rail with 47 points)
```

## Bricklayer Integration

### Import Button

Add **[Import Trajectory]** button to the Camera section header in ProjectTree.tsx (next to the existing + buttons):

```
◎ Camera (3)           [Import]
  ▢ Volumes (1)        +
  ⚡ Triggers (0)       +
  ⇄ Rails (1)          +
```

### Import Flow

1. Click [Import] → file picker opens (accept `.json` files)
2. Read selected file as JSON
3. Validate: check for `camera_zones` root key with `volumes` and/or `rails` arrays
4. For each volume in the JSON: call `addCameraVolume()` with the parsed data, overriding defaults with the imported params
5. For each rail in the JSON: call `addCameraRail()` with the parsed control points and target points
6. Imported entities appear immediately in the tree and viewport for manual fine-tuning

### Store Action

```typescript
importCameraZonesJson: (json: object) => void;
```

Parses the `camera_zones` block and bulk-adds all volumes, triggers, and rails to the store. Generates new IDs for each entity (doesn't reuse IDs from the JSON to avoid conflicts with existing entities).

## Mathematical Consistency

The pipeline's Catmull-Rom evaluation must match the C++ engine and the Three.js Bricklayer visualization:

- **C++ engine** (`gs_spline.cpp`): standard Catmull-Rom with ghost-point reflection at endpoints.
- **Three.js** (`CameraRailMarkers.tsx`): `THREE.CatmullRomCurve3` with `'catmullrom'` type.
- **Pipeline**: uses the same Catmull-Rom formula. The output is control points — the curve itself is evaluated by the consumer. As long as all three use the same standard Catmull-Rom with uniform parameterization, curves will match.

Since the pipeline only outputs control points (not sampled curves), mathematical consistency is guaranteed — the consumer evaluates the curve using its own Catmull-Rom implementation on the same points.

## Files Changed

| File | Change | New/Modify |
|------|--------|------------|
| `scripts/camera_pipeline.py` | CLI tool: parsers, RDP, volume gen, JSON output | New |
| `scripts/test_camera_pipeline.py` | Unit tests for all pipeline components | New |
| `tests/test_data/colmap_sample/images.txt` | COLMAP test fixture (10 frames) | New |
| `tests/test_data/colmap_sample/cameras.txt` | COLMAP camera params fixture | New |
| `tests/test_data/nerfstudio_sample/transforms.json` | Nerfstudio test fixture (10 frames) | New |
| `tools/apps/bricklayer/src/panels/ProjectTree.tsx` | Add [Import] button to Camera section | Modify |
| `tools/apps/bricklayer/src/store/useSceneStore.ts` | Add `importCameraZonesJson` action | Modify |

## Known Limitations

### Coordinate System Assumptions

The pipeline assumes the source data uses common conventions (COLMAP: Y-down right-handed; nerfstudio: OpenGL Y-up). Non-standard coordinate systems (e.g., custom capture rigs) may require manual axis remapping. A `--axis-swap` flag could be added later if needed.

### Single Volume Output

The MVP generates one AABB volume enclosing the entire trajectory. Multi-room scenes (e.g., a scan that moves through several rooms) would benefit from trajectory segmentation — detecting pauses or direction changes to split into multiple volumes. This is a future enhancement.

### No Automatic Trigger Placement

Triggers between zones require understanding of level layout (doorways, corridors). The pipeline generates volumes and rails only. Trigger placement remains a manual task in the editor.
