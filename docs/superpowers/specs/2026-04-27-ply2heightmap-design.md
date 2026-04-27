# ply2heightmap — PLY Point Cloud to 16-bit Heightmap Converter

## Goal

Provide an offline CLI tool that converts GSeurat's Gaussian-splat PLY files (vertex-only point clouds) into 16-bit grayscale PNG heightmaps, ready to drop into `HeightfieldComponent` for KCC collision.

## Context

- GSeurat's PLY files are **point clouds** (`element vertex` only, no `element face`). Triangle rasterization is not applicable.
- Each vertex is a Gaussian splat with `position`, `scale` (3-axis, world-space after `exp()`), and `rotation` (quaternion).
- The existing `GaussianCloud::load_ply()` parser handles all PLY format variants used in the project.
- `HeightfieldComponent` expects a 16-bit grayscale PNG where pixel 0 maps to `min_height` and pixel 65535 maps to `max_height`.
- `stb_image_write` is already available in the build.

## CLI Interface

```
ply2heightmap <input.ply> <output.png> [options]

Options:
  --ppu <float>          Pixels per world-unit. Default: 2.0
  --padding <float>      Extra world-units around AABB. Default: 1.0
  --min-opacity <float>  Skip splats below this opacity. Default: 0.1
  --z-up                 Interpret Z as height (for Blender exports). Default: Y-up.
```

### Stdout Output

```
Loaded 87687 splats from map.ply (filtered 2340 below opacity 0.1)
AABB: (-128.0, -5.0, -64.0) -> (128.0, 45.0, 64.0)
Grid: 512x256, cell_size=0.500, ppu=2.0
Height range: -5.000 -> 45.000
Wrote: map_heightmap.png

# HeightfieldComponent values:
  "width": 256.0
  "length": 128.0
  "min_height": -5.000
  "max_height": 45.000
```

Errors go to stderr. Structured output goes to stdout so it can be piped.

## Architecture

### Rasterization: AABB Splatting

Each Gaussian splat has a 3D oriented ellipsoid defined by its scale and rotation. Rather than computing the exact 2D covariance or performing OBB scanline rasterization, we project each splat's oriented bounding box down to an axis-aligned bounding box in the XZ plane and fill covered cells with the maximum Y value.

This is conservative (overestimates footprint by ~40% for diagonal splats) which is desirable for collision — it guarantees a watertight surface with no holes.

#### Grid Setup

```
ppu = pixels_per_unit (e.g., 2.0)
aabb = cloud.bounds(), padded by --padding on all sides
width_px  = ceil((aabb.max.x - aabb.min.x) * ppu)
height_px = ceil((aabb.max.z - aabb.min.z) * ppu)
cell_size = 1.0 / ppu  (uniform — square cells guaranteed)
```

Grid buffer: `std::vector<float>` of size `width_px * height_px`, initialized to `-FLT_MAX` (sentinel for "no data").

#### Per-Splat Loop

```
For each Gaussian g where g.opacity >= min_opacity:

  1. Rotate scale axes by quaternion:
     ax = g.rotation * vec3(g.scale.x, 0, 0)
     ay = g.rotation * vec3(0, g.scale.y, 0)
     az = g.rotation * vec3(0, 0, g.scale.z)

  2. AABB half-extents (sum of absolute components per axis):
     half_x = |ax.x| + |ay.x| + |az.x|
     half_y = |ax.y| + |ay.y| + |az.y|
     half_z = |ax.z| + |ay.z| + |az.z|

  3. Splat top Y (conservative — top of the ellipsoid, not center):
     top_y = g.position.y + half_y

  4. Map to grid cells:
     x_min = floor((g.position.x - half_x - aabb.min.x) * ppu)
     x_max = floor((g.position.x + half_x - aabb.min.x) * ppu)
     z_min = floor((g.position.z - half_z - aabb.min.z) * ppu)
     z_max = floor((g.position.z + half_z - aabb.min.z) * ppu)
     Clamp all to [0, dimension - 1].

  5. Fill:
     for z in [z_min, z_max]:
       for x in [x_min, x_max]:
         grid[z * width_px + x] = max(grid[z * width_px + x], top_y)
```

### Post-Processing

#### Gap Fill (Double-Buffered Dilation)

After the splat pass, cells still at `-FLT_MAX` have no coverage. One pass of 3x3 max-neighbor dilation fills isolated single-pixel gaps.

**Critical:** Dilation must be double-buffered. Read from `grid`, write to `dilated_grid`. In-place mutation causes a "streak" bug where a single valid pixel propagates across the entire grid due to iteration-order dependency.

Cells still at `-FLT_MAX` after dilation are clamped to `min_height`.

#### Normalization to uint16

```
min_height = min of all filled cells
max_height = max of all filled cells

// Flat-world guard: prevent divide-by-zero when all splats are at the same Y
if (max_height - min_height < 1e-5f) {
    max_height = min_height + 1.0f;
}

For each cell:
  if cell == -FLT_MAX: sample = 0  (maps to min_height)
  else: sample = lround((cell - min_height) / (max_height - min_height) * 65535.0f)
```

`std::lround()` prevents truncation artifacts (65534.999 → 65535, not 65534).

## Build Integration

```cmake
if(GSEURAT_BUILD_EXAMPLES)
    add_executable(ply2heightmap src/tools/ply2heightmap.cpp
        src/engine/gaussian_cloud.cpp)
    target_include_directories(ply2heightmap PRIVATE
        ${PROJECT_SOURCE_DIR}/include  ${stb_SOURCE_DIR})
    target_link_libraries(ply2heightmap PRIVATE glm::glm nlohmann_json::nlohmann_json)
endif()
```

Gated behind `GSEURAT_BUILD_EXAMPLES` — developer tool, not core library. Reuses `gaussian_cloud.cpp` for PLY parsing (no external PLY library needed).

## File Structure

```
src/tools/ply2heightmap.cpp     — CLI entry point + rasterizer functions
tests/test_ply2heightmap.cpp    — headless unit tests
```

Rasterizer logic lives as free functions in the source file. Tests compile the source directly via `add_gseurat_test` (same pattern as existing collision tests).

## Error Handling

| Condition | Behavior |
|-----------|----------|
| Missing/unreadable PLY | stderr error, exit 1 |
| Zero splats after opacity filter | stderr warning, exit 1 |
| Output directory doesn't exist | stderr error, exit 1 |
| Flat world (all same Y) | Guard: set range to 1.0, continue |
| Corrupt PLY (bad header) | Caught by `load_ply()` exception, exit 1 |

## Testing

`test_ply2heightmap` — headless CI test that exercises the rasterizer functions directly (not via CLI):

1. **Flat plane:** Generate splats at Y=5.0 across a grid. Assert all cells approximately 5.0.
2. **Gap fill:** Leave one cell uncovered. Assert dilation fills it from neighbors.
3. **Flat-world guard:** All splats at identical Y. Assert no NaN in output, valid uint16 values.
4. **Opacity filter:** Mix high and low opacity splats. Assert low-opacity splats are excluded.
5. **AABB footprint:** Single large splat with known scale. Assert correct number of cells covered.

## Non-Goals

- Interactive/real-time heightmap editing (future Bricklayer feature)
- Triangle mesh rasterization (PLY files have no face data)
- Multi-channel output (normal maps, AO, etc.)
- GPU acceleration
