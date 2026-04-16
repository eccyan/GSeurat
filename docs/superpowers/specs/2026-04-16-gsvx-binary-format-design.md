# GSVX Binary Asset Format and Zero-Copy Loader

## Problem

Runtime PLY loading is a CPU bottleneck:

1. **Text header parsing**: Every PLY load parses ASCII property declarations, string-matching property names to offsets.
2. **Per-element math**: `exp(scale)`, `sigmoid(opacity)`, `SH_C0 * f_dc + 0.5` computed for every Gaussian on every load.
3. **Per-element repacking**: The CPU-side `Gaussian` (68 bytes) is converted element-by-element into `GpuGaussian` (64 bytes, 4×vec4) before upload — this loop is duplicated ~7 times in `gs_renderer.cpp`.

For a 200K-splat scene, this means 200K iterations of float math + struct repacking on every cold load, plus string parsing overhead.

## Solution

A two-stage pipeline:

1. **Offline cooker** (`scripts/ply_to_gseurat.py`): Reads PLY, pre-bakes all transforms, writes a `.gsvx` binary where the payload is byte-identical to an array of `GpuGaussian`.
2. **Zero-copy loader** (C++23): Validates a 32-byte header, then bulk-reads the payload directly into a VMA-mapped SSBO — no per-element parsing, no math, no repacking.

## Binary Format Specification

### Header (32 bytes)

```
Offset  Size  Type      Field         Description
─────── ───── ───────── ───────────── ────────────────────────────────────────
0       4     char[4]   magic         "GSVX" (0x47 0x53 0x56 0x58)
4       4     uint32_le version       Format version (1)
8       4     uint32_le count         Number of Gaussians
12      4     uint32_le flags         Reserved (must be 0)
16      16    uint8[16] reserved      Zero-filled; ensures payload at offset 32
```

The header is exactly 32 bytes. Payload begins at offset 32, which is 16-byte aligned.

### Per-Gaussian Payload (64 bytes, matches `GpuGaussian`)

```
Offset  Size  GLSL Type  C++ Field      Contents (pre-baked)
─────── ───── ────────── ────────────── ─────────────────────────────────────
0       16    vec4       pos_opacity    position.xyz, sigmoid(raw_opacity)
16      16    vec4       scale_pad      exp(raw_scale).xyz, float_bits(bone_index)
32      16    vec4       rot            quaternion (x, y, z, w)
48      16    vec4       color_pad      (SH_C0 * f_dc + 0.5).rgb, emission
```

Total per-Gaussian: 64 bytes (4 × `vec4`).  
Total file size: `32 + count × 64` bytes.

This layout is byte-identical to the `GpuGaussian` struct in both `gs_preprocess.comp` (GLSL) and `gs_renderer.cpp` (C++).

### Pre-baked Transforms (applied at cook time)

| Field | Raw PLY Value | Baked Value |
|-------|---------------|-------------|
| scale | `log(scale)` | `exp(log_scale)` = linear scale |
| opacity | `logit(opacity)` | `1 / (1 + exp(-logit))` = linear opacity |
| color | SH DC coefficients `f_dc` | `0.28209479177387814 * f_dc + 0.5` = linear RGB |
| bone_index | `uint8` | `uint32` stored as float bit-pattern via `struct.pack('I', idx)` |
| quaternion | `(w, x, y, z)` in PLY | `(x, y, z, w)` in payload (matches shader convention) |

### Byte Order

All multi-byte values are **little-endian** (matches Vulkan on x86/ARM and Python's `<` struct prefix).

## Component Design

### 1. Python Cooker (`scripts/ply_to_gseurat.py`)

```
Input:  path/to/scene.ply
Output: path/to/scene.gsvx

Usage:  python3 scripts/ply_to_gseurat.py input.ply [-o output.gsvx]
```

- Uses `plyfile` to read the PLY binary data into numpy arrays.
- Applies vectorized transforms (numpy `exp`, sigmoid, SH conversion) — no Python loops.
- Packs header via `struct.pack`.
- Writes payload as a single `ndarray.tobytes()` call from a structured numpy array with dtype matching `GpuGaussian`.
- Recomputes quaternion order from PLY `(w,x,y,z)` to shader `(x,y,z,w)`.

### 2. C++ Zero-Copy Loader

**New struct** (in `gaussian_cloud.hpp`):

```cpp
struct GsvxHeader {
    char     magic[4];    // "GSVX"
    uint32_t version;     // 1
    uint32_t count;       // Gaussian count
    uint32_t flags;       // Reserved
    uint8_t  reserved[16];
};
static_assert(sizeof(GsvxHeader) == 32);
```

**`GpuGaussian` promoted** from anonymous namespace in `gs_renderer.cpp` to `gaussian_cloud.hpp`:

```cpp
struct alignas(16) GpuGaussian {
    glm::vec4 pos_opacity;  // xyz=position, w=opacity
    glm::vec4 scale_pad;    // xyz=scale, w=float_bits(bone_index)
    glm::vec4 rot;          // xyzw=quaternion (x,y,z,w)
    glm::vec4 color_pad;    // rgb=color, w=emission
};
static_assert(sizeof(GpuGaussian) == 64);
```

**New method** on `GaussianCloud`:

```cpp
struct GsvxPayload {
    std::vector<GpuGaussian> gpu_gaussians;
    AABB bounds;
    uint32_t count;
};

static GsvxPayload load_gsvx(const std::string& path);
```

Returns pre-baked GPU-ready data. The renderer calls this instead of `load_ply()` + per-element conversion loop.

**Loading flow:**

```
open file → read 32-byte header → validate magic/version
→ allocate vector<GpuGaussian>(count)
→ single fread() of count×64 bytes into vector
→ compute AABB from pos_opacity.xyz (single scan, no math)
→ return GsvxPayload
```

### 3. Renderer Integration

In `gs_renderer.cpp`, the upload path for `.gsvx` files becomes:

```cpp
// Old path (per-element conversion):
for (uint32_t i = 0; i < count; ++i) {
    staging[i].pos_opacity = vec4(g.position, g.opacity);  // ... etc
}
memcpy(ssbo.mapped(), staging.data(), count * sizeof(GpuGaussian));

// New path (zero-copy):
auto payload = GaussianCloud::load_gsvx(path);
memcpy(ssbo.mapped(), payload.gpu_gaussians.data(), payload.count * sizeof(GpuGaussian));
```

The existing `load_ply()` path remains untouched for backward compatibility.

## AABB and Importance

The `.gsvx` format does not store `importance` (used for LOD decimation) since it equals `opacity * max(scale.xyz)` and can be recomputed from the baked values in a single pass if needed. The AABB is computed during the C++ load scan — this is a trivial vec3 min/max accumulation over `pos_opacity.xyz` and adds negligible overhead.

## Testing

1. **Round-trip test**: Load PLY → cook to GSVX → load GSVX → compare `GpuGaussian` arrays against the existing PLY→GpuGaussian conversion path. All values must match within float epsilon.
2. **Header validation**: Corrupt magic/version/count → verify loader returns error.
3. **File size check**: Verify `file_size == 32 + count * 64`.
4. **Visual test**: Load same scene via PLY and GSVX paths in staging → screenshot diff via Game Director.

## Files Changed

| File | Change |
|------|--------|
| `scripts/ply_to_gseurat.py` | New — Python cooker |
| `include/gseurat/engine/gaussian_cloud.hpp` | Add `GsvxHeader`, `GpuGaussian`, `GsvxPayload`, `load_gsvx()` |
| `src/engine/gaussian_cloud.cpp` | Implement `load_gsvx()` |
| `src/engine/gs_renderer.cpp` | Remove duplicate `GpuGaussian` definition, use shared header |
| `tests/gsvx_loader_test.cpp` | Round-trip and validation tests |
