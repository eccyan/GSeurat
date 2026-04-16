# GSVX Binary Format Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace runtime PLY parsing with a pre-baked binary format (.gsvx) that loads via zero-copy bulk read directly into Vulkan SSBOs.

**Architecture:** A Python offline cooker reads PLY files, applies all math transforms (exp, sigmoid, SH→RGB), and writes a flat binary matching the existing `GpuGaussian` struct (4×vec4 = 64 bytes). The C++ loader validates a 32-byte header and bulk-reads the payload into a `std::vector<GpuGaussian>`, skipping all per-element parsing.

**Tech Stack:** Python 3 (numpy, plyfile), C++23, CMake, Vulkan (VMA)

**Spec:** `docs/superpowers/specs/2026-04-16-gsvx-binary-format-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `include/gseurat/engine/gaussian_cloud.hpp` | Modify | Add `GpuGaussian`, `GsvxHeader`, `GsvxPayload`, `load_gsvx()` |
| `src/engine/gaussian_cloud.cpp` | Modify | Implement `load_gsvx()` |
| `src/engine/gs_renderer.cpp` | Modify | Remove local `GpuGaussian` definition, use shared header |
| `tests/test_gaussian_cloud.cpp` | Modify | Add GSVX round-trip and validation tests |
| `CMakeLists.txt` | No change | Test already links `gaussian_cloud.cpp` |
| `scripts/ply_to_gseurat.py` | Create | Python PLY→GSVX cooker |

---

### Task 1: Promote `GpuGaussian` to the shared header

**Files:**
- Modify: `include/gseurat/engine/gaussian_cloud.hpp`
- Modify: `src/engine/gs_renderer.cpp` (lines 14–19)

The `GpuGaussian` struct is currently defined in an anonymous namespace inside `gs_renderer.cpp`. We need it in the header so both the loader and renderer can share it.

- [ ] **Step 1: Add `GpuGaussian` and `GsvxHeader` to gaussian_cloud.hpp**

Add after the `AABB` struct (line 33), before `class GaussianCloud`:

```cpp
/// GPU-side Gaussian struct (matches gs_preprocess.comp GpuGaussian).
/// 4 × vec4 = 64 bytes, std430-compatible.
struct alignas(16) GpuGaussian {
    glm::vec4 pos_opacity;  // xyz = position, w = opacity
    glm::vec4 scale_pad;    // xyz = scale, w = float_bits(bone_index)
    glm::vec4 rot;          // xyzw = quaternion (x, y, z, w)
    glm::vec4 color_pad;    // rgb = color, w = emission
};
static_assert(sizeof(GpuGaussian) == 64, "GpuGaussian must be 64 bytes for GPU std430");
static_assert(alignof(GpuGaussian) == 16, "GpuGaussian must be 16-byte aligned");

/// GSVX binary file header (32 bytes).
struct GsvxHeader {
    char     magic[4];     // "GSVX"
    uint32_t version;      // Format version (currently 1)
    uint32_t count;        // Number of Gaussians in payload
    uint32_t flags;        // Reserved (must be 0)
    uint8_t  reserved[16]; // Padding to 32 bytes
};
static_assert(sizeof(GsvxHeader) == 32, "GsvxHeader must be 32 bytes");
```

Also add `#include <cstdint>` to the includes at the top of the file.

- [ ] **Step 2: Remove the local GpuGaussian from gs_renderer.cpp**

In `src/engine/gs_renderer.cpp`, replace lines 13–19:

```cpp
// GPU-side Gaussian struct (matches gs_preprocess.comp input)
struct GpuGaussian {
    glm::vec4 pos_opacity;    // xyz = position, w = opacity
    glm::vec4 scale_pad;      // xyz = scale, w = unused
    glm::vec4 rot;            // xyzw = quaternion
    glm::vec4 color_pad;      // rgb = color, w = emission intensity
};  // 64 bytes, aligned
```

with a comment noting the struct is now in the shared header:

```cpp
// GpuGaussian is defined in gaussian_cloud.hpp (shared with GSVX loader).
```

Verify that `gs_renderer.cpp` already includes `gaussian_cloud.hpp` (it should, since it uses `GaussianCloud`).

- [ ] **Step 3: Build to verify no regressions**

Run: `cmake --build build/macos-debug --target test_gaussian_cloud 2>&1 | tail -5`
Expected: Build succeeds.

Run: `cmake --build build/macos-debug --target gseurat_core 2>&1 | tail -5`
Expected: Build succeeds (renderer still compiles).

- [ ] **Step 4: Commit**

```bash
git add include/gseurat/engine/gaussian_cloud.hpp src/engine/gs_renderer.cpp
git commit -m "refactor: promote GpuGaussian to shared header for GSVX loader"
```

---

### Task 2: Implement `load_gsvx()` in the C++ engine

**Files:**
- Modify: `include/gseurat/engine/gaussian_cloud.hpp`
- Modify: `src/engine/gaussian_cloud.cpp`

- [ ] **Step 1: Add `GsvxPayload` and `load_gsvx()` declaration to the header**

Add after the `GsvxHeader` static_assert, before `class GaussianCloud`:

```cpp
/// Pre-baked GPU-ready Gaussian data loaded from a .gsvx file.
struct GsvxPayload {
    std::vector<GpuGaussian> gpu_gaussians;
    AABB bounds;
    uint32_t count = 0;
};
```

Add to `class GaussianCloud` public section (after `load_ply`):

```cpp
    /// Load a pre-baked .gsvx binary file (zero-copy GPU format).
    static GsvxPayload load_gsvx(const std::string& path);
```

- [ ] **Step 2: Implement `load_gsvx()` in gaussian_cloud.cpp**

Add at the end of the file, before the closing `}  // namespace gseurat`:

```cpp
GsvxPayload GaussianCloud::load_gsvx(const std::string& path) {
    auto resolved = resolve_asset_path(path);
    std::ifstream file(resolved, std::ios::binary);
    if (!file.is_open()) {
        throw std::runtime_error("Failed to open GSVX file: " + resolved.string());
    }

    // Read and validate header
    GsvxHeader header{};
    file.read(reinterpret_cast<char*>(&header), sizeof(GsvxHeader));
    if (!file) {
        throw std::runtime_error("Failed to read GSVX header: " + resolved.string());
    }

    if (std::memcmp(header.magic, "GSVX", 4) != 0) {
        throw std::runtime_error("Invalid GSVX magic number: " + resolved.string());
    }
    if (header.version != 1) {
        throw std::runtime_error("Unsupported GSVX version " +
                                 std::to_string(header.version) + ": " + resolved.string());
    }

    GsvxPayload payload;
    payload.count = header.count;

    if (payload.count == 0) {
        return payload;
    }

    // Bulk-read payload directly into vector (zero per-element parsing)
    payload.gpu_gaussians.resize(payload.count);
    const auto payload_bytes = static_cast<std::streamsize>(
        static_cast<size_t>(payload.count) * sizeof(GpuGaussian));
    file.read(reinterpret_cast<char*>(payload.gpu_gaussians.data()), payload_bytes);
    if (!file) {
        throw std::runtime_error("Failed to read GSVX payload (" +
                                 std::to_string(payload.count) + " gaussians): " +
                                 resolved.string());
    }

    // Compute AABB from pre-baked positions (trivial scan, no math)
    for (const auto& g : payload.gpu_gaussians) {
        payload.bounds.expand(glm::vec3(g.pos_opacity));
    }

    return payload;
}
```

- [ ] **Step 3: Build**

Run: `cmake --build build/macos-debug --target test_gaussian_cloud 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add include/gseurat/engine/gaussian_cloud.hpp src/engine/gaussian_cloud.cpp
git commit -m "feat: implement GSVX zero-copy loader in gaussian_cloud"
```

---

### Task 3: Add C++ tests for GSVX loading

**Files:**
- Modify: `tests/test_gaussian_cloud.cpp`

- [ ] **Step 1: Add a helper to write a GSVX file from known data**

Add after the existing `write_test_scene_json` helper (around line 171), before the `approx` helper:

```cpp
// Helper: write a .gsvx file with known GpuGaussian data
static void write_test_gsvx(const std::string& path,
                             const std::vector<gseurat::GpuGaussian>& gaussians) {
    std::ofstream out(path, std::ios::binary);

    // Header
    gseurat::GsvxHeader header{};
    std::memcpy(header.magic, "GSVX", 4);
    header.version = 1;
    header.count = static_cast<uint32_t>(gaussians.size());
    header.flags = 0;
    std::memset(header.reserved, 0, sizeof(header.reserved));
    out.write(reinterpret_cast<const char*>(&header), sizeof(header));

    // Payload
    if (!gaussians.empty()) {
        out.write(reinterpret_cast<const char*>(gaussians.data()),
                  static_cast<std::streamsize>(gaussians.size() * sizeof(gseurat::GpuGaussian)));
    }
}
```

- [ ] **Step 2: Add Test — GSVX round-trip matches PLY→GpuGaussian conversion**

Add after the last existing test (before the `fs::remove_all` cleanup):

```cpp
    // ====== Test 10: GSVX load matches PLY→GpuGaussian conversion ======
    {
        // Load PLY and manually convert to GpuGaussian (same as gs_renderer.cpp)
        const std::string ply_path = tmp_dir + "/test_standard.ply";
        write_test_ply(ply_path, 5);
        auto cloud = GaussianCloud::load_ply(ply_path);

        std::vector<GpuGaussian> expected(cloud.count());
        for (uint32_t i = 0; i < cloud.count(); ++i) {
            const auto& g = cloud.gaussians()[i];
            float bone_as_float;
            uint32_t bone_idx = g.bone_index;
            std::memcpy(&bone_as_float, &bone_idx, sizeof(float));
            expected[i].pos_opacity = glm::vec4(g.position, g.opacity);
            expected[i].scale_pad = glm::vec4(g.scale, bone_as_float);
            expected[i].rot = glm::vec4(g.rotation.x, g.rotation.y, g.rotation.z, g.rotation.w);
            expected[i].color_pad = glm::vec4(g.color, g.emission);
        }

        // Write as GSVX and reload
        const std::string gsvx_path = tmp_dir + "/test_roundtrip.gsvx";
        write_test_gsvx(gsvx_path, expected);

        auto payload = GaussianCloud::load_gsvx(gsvx_path);
        assert(payload.count == 5 && "GSVX should load 5 Gaussians");

        for (uint32_t i = 0; i < payload.count; ++i) {
            const auto& got = payload.gpu_gaussians[i];
            const auto& exp = expected[i];
            assert(approx(got.pos_opacity.x, exp.pos_opacity.x) && "pos_opacity.x mismatch");
            assert(approx(got.pos_opacity.y, exp.pos_opacity.y) && "pos_opacity.y mismatch");
            assert(approx(got.pos_opacity.z, exp.pos_opacity.z) && "pos_opacity.z mismatch");
            assert(approx(got.pos_opacity.w, exp.pos_opacity.w) && "pos_opacity.w mismatch");
            assert(approx(got.scale_pad.x, exp.scale_pad.x) && "scale_pad.x mismatch");
            assert(approx(got.rot.x, exp.rot.x) && "rot.x mismatch");
            assert(approx(got.rot.w, exp.rot.w) && "rot.w mismatch");
            assert(approx(got.color_pad.x, exp.color_pad.x) && "color_pad.x mismatch");
            assert(approx(got.color_pad.w, exp.color_pad.w) && "color_pad.w (emission) mismatch");
        }

        // Verify AABB
        assert(approx(payload.bounds.min.x, 0.0f) && "GSVX AABB min.x");
        assert(approx(payload.bounds.max.x, 4.0f) && "GSVX AABB max.x");

        printf("PASS: Test 10 - GSVX round-trip matches PLY→GpuGaussian\n");
    }
```

- [ ] **Step 3: Add Test — GSVX header validation (bad magic)**

```cpp
    // ====== Test 11: GSVX bad magic number throws ======
    {
        const std::string bad_path = tmp_dir + "/test_bad_magic.gsvx";
        {
            std::ofstream out(bad_path, std::ios::binary);
            GsvxHeader header{};
            std::memcpy(header.magic, "NOPE", 4);
            header.version = 1;
            header.count = 0;
            out.write(reinterpret_cast<const char*>(&header), sizeof(header));
        }

        bool threw = false;
        try {
            GaussianCloud::load_gsvx(bad_path);
        } catch (const std::runtime_error& e) {
            threw = true;
            assert(std::string(e.what()).find("magic") != std::string::npos &&
                   "Error should mention magic");
        }
        assert(threw && "Should throw for bad GSVX magic");
        printf("PASS: Test 11 - GSVX bad magic number throws\n");
    }
```

- [ ] **Step 4: Add Test — GSVX bad version throws**

```cpp
    // ====== Test 12: GSVX unsupported version throws ======
    {
        const std::string bad_path = tmp_dir + "/test_bad_version.gsvx";
        {
            std::ofstream out(bad_path, std::ios::binary);
            GsvxHeader header{};
            std::memcpy(header.magic, "GSVX", 4);
            header.version = 99;
            header.count = 0;
            out.write(reinterpret_cast<const char*>(&header), sizeof(header));
        }

        bool threw = false;
        try {
            GaussianCloud::load_gsvx(bad_path);
        } catch (const std::runtime_error& e) {
            threw = true;
            assert(std::string(e.what()).find("version") != std::string::npos &&
                   "Error should mention version");
        }
        assert(threw && "Should throw for bad GSVX version");
        printf("PASS: Test 12 - GSVX unsupported version throws\n");
    }
```

- [ ] **Step 5: Add Test — GSVX empty file (0 Gaussians)**

```cpp
    // ====== Test 13: GSVX empty file (0 Gaussians) ======
    {
        const std::string empty_path = tmp_dir + "/test_empty.gsvx";
        write_test_gsvx(empty_path, {});

        auto payload = GaussianCloud::load_gsvx(empty_path);
        assert(payload.count == 0 && "Empty GSVX should have 0 Gaussians");
        assert(payload.gpu_gaussians.empty() && "Empty GSVX should have empty vector");
        printf("PASS: Test 13 - GSVX empty file (0 Gaussians)\n");
    }
```

- [ ] **Step 6: Add Test — GSVX missing file throws**

```cpp
    // ====== Test 14: GSVX missing file throws ======
    {
        bool threw = false;
        try {
            GaussianCloud::load_gsvx(tmp_dir + "/nonexistent.gsvx");
        } catch (const std::runtime_error&) {
            threw = true;
        }
        assert(threw && "Should throw for missing GSVX file");
        printf("PASS: Test 14 - GSVX missing file throws\n");
    }
```

- [ ] **Step 7: Build and run tests**

Run: `cmake --build build/macos-debug --target test_gaussian_cloud 2>&1 | tail -5`
Expected: Build succeeds.

Run: `./build/macos-debug/test_gaussian_cloud`
Expected: All 14 tests pass.

- [ ] **Step 8: Commit**

```bash
git add tests/test_gaussian_cloud.cpp
git commit -m "test: add GSVX loader round-trip and validation tests"
```

---

### Task 4: Create the Python PLY→GSVX cooker

**Files:**
- Create: `scripts/ply_to_gseurat.py`

- [ ] **Step 1: Create the Python cooker script**

Create `scripts/ply_to_gseurat.py`:

```python
#!/usr/bin/env python3
"""Convert a binary little-endian PLY file to GSeurat's pre-baked .gsvx format.

The output is a flat binary file whose payload is byte-identical to an array of
GpuGaussian structs (4 × vec4 = 64 bytes each), ready for zero-copy upload to a
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

try:
    from plyfile import PlyData
except ImportError:
    sys.exit("Error: 'plyfile' package required.  Install with:  pip install plyfile")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

GSVX_MAGIC = b"GSVX"
GSVX_VERSION = 1
HEADER_SIZE = 32          # bytes
GAUSSIAN_SIZE = 64        # bytes (4 × vec4)
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

    # --- Position (stored directly) ---
    px = _require(vertex, "x", "x").astype(np.float32)
    py = _require(vertex, "y", "y").astype(np.float32)
    pz = _require(vertex, "z", "z").astype(np.float32)

    # --- Opacity: logit → sigmoid ---
    raw_opacity = _resolve(vertex, "opacity")
    if raw_opacity is not None:
        opacity = (1.0 / (1.0 + np.exp(-raw_opacity))).astype(np.float32)
    else:
        opacity = np.ones(count, dtype=np.float32)

    # --- Scale: log → exp ---
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

    # --- Rotation quaternion ---
    # PLY stores (w, x, y, z) as rot_0..rot_3; shader expects (x, y, z, w)
    rw = _resolve(vertex, "rot_0", "rotation_0")
    rx = _resolve(vertex, "rot_1", "rotation_1")
    ry = _resolve(vertex, "rot_2", "rotation_2")
    rz = _resolve(vertex, "rot_3", "rotation_3")
    if rw is not None and rx is not None and ry is not None and rz is not None:
        # Normalize quaternion
        length = np.sqrt(rw * rw + rx * rx + ry * ry + rz * rz)
        length = np.where(length > 0, length, 1.0)
        rw = (rw / length).astype(np.float32)
        rx = (rx / length).astype(np.float32)
        ry = (ry / length).astype(np.float32)
        rz = (rz / length).astype(np.float32)
    else:
        rx = np.zeros(count, dtype=np.float32)
        ry = np.zeros(count, dtype=np.float32)
        rz = np.zeros(count, dtype=np.float32)
        rw = np.ones(count, dtype=np.float32)

    # --- Color ---
    has_sh = "f_dc_0" in vertex.dtype.names
    if has_sh:
        cr = _resolve(vertex, "f_dc_0")
        cg = _resolve(vertex, "f_dc_1")
        cb = _resolve(vertex, "f_dc_2")
        cr = np.clip(SH_C0 * cr + 0.5, 0.0, 1.0).astype(np.float32)
        cg = np.clip(SH_C0 * cg + 0.5, 0.0, 1.0).astype(np.float32)
        cb = np.clip(SH_C0 * cb + 0.5, 0.0, 1.0).astype(np.float32)
    else:
        cr = _resolve(vertex, "red")
        cg = _resolve(vertex, "green")
        cb = _resolve(vertex, "blue")
        if cr is not None and cg is not None and cb is not None:
            # uchar [0,255] → [0,1] (plyfile returns uint8 for uchar)
            if vertex["red"].dtype == np.uint8:
                cr = cr / 255.0
                cg = cg / 255.0
                cb = cb / 255.0
            cr = cr.astype(np.float32)
            cg = cg.astype(np.float32)
            cb = cb.astype(np.float32)
        else:
            cr = cg = cb = np.ones(count, dtype=np.float32)

    # --- Emission ---
    emission = _resolve(vertex, "emission")
    if emission is None:
        emission = np.zeros(count, dtype=np.float32)

    # --- Pack into structured array matching GpuGaussian ---
    # GpuGaussian: vec4 pos_opacity, vec4 scale_pad, vec4 rot, vec4 color_pad
    # = 16 floats per Gaussian
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

    # --- Build binary ---
    header = struct.pack("<4sIII16s",
                         GSVX_MAGIC,
                         GSVX_VERSION,
                         count,
                         0,           # flags (reserved)
                         b"\x00" * 16)
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
```

- [ ] **Step 2: Make the script executable**

Run: `chmod +x scripts/ply_to_gseurat.py`

- [ ] **Step 3: Verify the script runs (help output)**

Run: `python3 scripts/ply_to_gseurat.py --help`
Expected: Prints usage help without errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/ply_to_gseurat.py
git commit -m "feat: add PLY to GSVX asset cooker script"
```

---

### Task 5: End-to-end round-trip test (PLY → GSVX → C++ loader)

**Files:**
- Modify: `tests/test_gaussian_cloud.cpp`

This test writes a PLY on disk, shells out to the Python cooker, then loads the resulting `.gsvx` via the C++ loader and compares against the PLY loader output. Since shelling out to Python from a C++ test adds a dependency, we instead write the GSVX directly using the same transforms the Python cooker applies, which we already tested in Task 3. The true end-to-end validation is a manual step.

- [ ] **Step 1: Add a test that verifies file size matches header**

Add to `tests/test_gaussian_cloud.cpp` before the cleanup:

```cpp
    // ====== Test 15: GSVX file size matches header count ======
    {
        const std::string gsvx_path = tmp_dir + "/test_size_check.gsvx";
        std::vector<GpuGaussian> data(7);
        for (uint32_t i = 0; i < 7; ++i) {
            data[i].pos_opacity = glm::vec4(float(i), 0.0f, 0.0f, 1.0f);
            data[i].scale_pad = glm::vec4(0.01f, 0.01f, 0.01f, 0.0f);
            data[i].rot = glm::vec4(0.0f, 0.0f, 0.0f, 1.0f);
            data[i].color_pad = glm::vec4(1.0f, 1.0f, 1.0f, 0.0f);
        }
        write_test_gsvx(gsvx_path, data);

        // Verify file size = 32 + 7 * 64 = 480
        auto file_size = fs::file_size(gsvx_path);
        assert(file_size == 32 + 7 * 64 && "GSVX file size = header + count * 64");

        auto payload = GaussianCloud::load_gsvx(gsvx_path);
        assert(payload.count == 7 && "Should load 7 Gaussians");
        assert(approx(payload.gpu_gaussians[3].pos_opacity.x, 3.0f) && "Gaussian 3 pos.x=3");

        printf("PASS: Test 15 - GSVX file size matches header count\n");
    }
```

- [ ] **Step 2: Build and run all tests**

Run: `cmake --build build/macos-debug --target test_gaussian_cloud 2>&1 | tail -5`
Expected: Build succeeds.

Run: `./build/macos-debug/test_gaussian_cloud`
Expected: All 15 tests pass, ending with "All Gaussian splatting tests passed!"

- [ ] **Step 3: Commit**

```bash
git add tests/test_gaussian_cloud.cpp
git commit -m "test: add GSVX file size validation test"
```

---

### Task 6: Manual end-to-end verification (Python cooker → C++ loader)

This is a verification-only task — no code changes.

- [ ] **Step 1: Find a test PLY file in the project**

Run: `find examples/ -name "*.ply" -type f | head -3`

- [ ] **Step 2: Cook it with the Python script**

Run: `python3 scripts/ply_to_gseurat.py <path-to-ply> -o /tmp/test_cooked.gsvx`
Expected: Prints "Wrote N Gaussians (M bytes) to /tmp/test_cooked.gsvx"

- [ ] **Step 3: Verify file size**

Run: `python3 -c "import struct, pathlib; d=pathlib.Path('/tmp/test_cooked.gsvx').read_bytes(); h=struct.unpack_from('<4sIII', d); print(f'magic={h[0]}, ver={h[1]}, count={h[2]}, flags={h[3]}, file_size={len(d)}, expected={32+h[2]*64}')"` 
Expected: `file_size` equals `expected`.

- [ ] **Step 4: Verify complete — all done**

Print summary of what was built and tested.
