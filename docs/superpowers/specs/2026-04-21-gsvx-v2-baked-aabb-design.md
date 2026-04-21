# GSVX v2 Header with Baked AABB (Zero-Parse Bounds)

## Problem

GSVX v1 stores a 32-byte header with magic, version, count, and flags. The AABB is computed at load time by scanning all Gaussian positions — an O(n) pass over `pos_opacity.xyz`. For a 200K-splat scene this is fast (~0.3ms) but non-zero, and it prevents true zero-parse loading where bounds are available immediately after reading the header.

Level designers switching between scenes in Bricklayer/Staging benefit from instant bounds for camera fitting and grid-to-world coordinate setup, without waiting for the full payload to load.

## Solution

Extend the GSVX header from 32 to 64 bytes, embedding the pre-computed AABB. Bump version to 2. The v1 loader already rejects unknown versions, so this is a safe breaking change within the format.

## Binary Format Specification (v2)

### Header (64 bytes)

```
Offset  Size  Type        Field       Description
──────  ────  ──────────  ──────────  ─────────────────────────────
0       4     char[4]     magic       "GSVX" (0x47 0x53 0x56 0x58)
4       4     uint32_le   version     2
8       4     uint32_le   count       Number of Gaussians in payload
12      4     uint32_le   flags       Reserved (must be 0)
16      12    float[3]    aabb_min    Bounding box minimum (x, y, z)
28      12    float[3]    aabb_max    Bounding box maximum (x, y, z)
40      24    uint8[24]   reserved    Zero-filled padding to 64 bytes
```

Payload begins at offset 64 (16-byte aligned). Per-Gaussian layout is unchanged from v1 (64 bytes per `GpuGaussian`).

Total file size: `64 + count * 64` bytes.

### Design Rationale

- **64-byte header**: Power-of-2 alignment is optimal for CPU cache lines and GPU memory-mapped uploads. The 24 bytes of reserved padding provide runway for future fields (SH degree, importance range, compression metadata) without another version bump.
- **AABB in header**: Eliminates the O(n) position scan. Bounds are available after reading the first 64 bytes — before the payload is even touched.
- **Version bump to 2**: v1 loader rejects v2 files on version check (already implemented). v2 loader can still load v1 files by falling back to the position scan.

## Component Changes

### 1. C++ Header Struct (`gaussian_cloud.hpp`)

```cpp
struct GsvxHeaderV2 {
    char     magic[4];     // "GSVX"
    uint32_t version;      // 2
    uint32_t count;        // Gaussian count
    uint32_t flags;        // Reserved (0)
    float    aabb_min[3];  // Bounding box min
    float    aabb_max[3];  // Bounding box max
    uint8_t  reserved[24]; // Zero padding
};
static_assert(sizeof(GsvxHeaderV2) == 64);
```

The existing `GsvxHeader` (32 bytes) is kept for v1 backward-compat reading. `load_gsvx()` reads the first 4+4 bytes (magic + version), then dispatches to v1 or v2 parsing.

### 2. C++ Loader (`gaussian_cloud.cpp`)

`load_gsvx()` changes:
- Read magic + version first (8 bytes)
- If version == 1: read remaining 24 bytes of v1 header, load payload at offset 32, compute AABB via position scan (existing behavior)
- If version == 2: read full 64-byte header, extract AABB directly, load payload at offset 64, skip position scan
- If version > 2: return error

### 3. Python Cooker (`scripts/ply_to_gseurat.py`)

- Compute AABB during the vectorized transform pass (free — already iterating positions for `pos_opacity`)
- Write 64-byte header with version=2 and AABB fields
- Payload offset moves from 32 to 64

### 4. GsvxPayload

No change — `GsvxPayload` already contains `AABB bounds`. The only difference is where it comes from (header vs. scan).

## Backward Compatibility

| Scenario | Behavior |
|----------|----------|
| v2 loader reads v1 file | Falls back to position scan for AABB |
| v1 loader reads v2 file | Rejects on version check (existing guard) |
| v2 cooker output | Always writes v2 format |

## Testing

1. **Round-trip test**: PLY -> cook (v2) -> load -> verify AABB matches position scan result within float epsilon
2. **Header validation**: Corrupt aabb_min/max values -> verify loader detects inconsistency (optional, AABB is trusted)
3. **v1 fallback**: Load a v1 .gsvx file with v2 loader -> verify AABB is computed via scan
4. **File size check**: Verify `file_size == 64 + count * 64`
5. **Visual test**: Load same scene via v1 and v2 paths in Staging -> camera fit should be identical

## Files Changed

| File | Change |
|------|--------|
| `include/gseurat/engine/gaussian_cloud.hpp` | Add `GsvxHeaderV2` struct |
| `src/engine/gaussian_cloud.cpp` | Version-dispatch in `load_gsvx()`, v2 AABB extraction |
| `scripts/ply_to_gseurat.py` | Write 64-byte v2 header with AABB |
| `tests/test_gaussian_cloud.cpp` | v2 round-trip, v1 fallback, header validation tests |
