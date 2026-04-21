# GSVX v2 Baked AABB Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the GSVX binary format from v1 (32-byte header) to v2 (64-byte header with baked AABB), enabling zero-parse bounds retrieval.

**Architecture:** Grow `GsvxHeader` to 64 bytes embedding `aabb_min[3]` and `aabb_max[3]`. The C++ loader dispatches on version (1 vs 2). The Python cooker writes v2. Backward compat: v2 loader reads v1 files by falling back to position scan.

**Tech Stack:** C++23, Python 3 (numpy), CMake

---

### Task 1: Add `GsvxHeaderV2` struct and update loader to dispatch on version

**Files:**
- Modify: `include/gseurat/engine/gaussian_cloud.hpp:62-70`
- Modify: `src/engine/gaussian_cloud.cpp:370-436`

- [ ] **Step 1: Write failing test — v2 round-trip with baked AABB**

Add to `tests/test_gaussian_cloud.cpp` after the existing Test 13 block (~line 505). First, add a v2 test helper and test:

```cpp
// Helper: write a v2 .gsvx file with baked AABB
static void write_test_gsvx_v2(const std::string& path,
                                const std::vector<gseurat::GpuGaussian>& gaussians,
                                const gseurat::AABB& aabb) {
    std::ofstream out(path, std::ios::binary);

    gseurat::GsvxHeaderV2 header{};
    std::memcpy(header.magic, "GSVX", 4);
    header.version = 2;
    header.count = static_cast<uint32_t>(gaussians.size());
    header.flags = 0;
    header.aabb_min[0] = aabb.min.x;
    header.aabb_min[1] = aabb.min.y;
    header.aabb_min[2] = aabb.min.z;
    header.aabb_max[0] = aabb.max.x;
    header.aabb_max[1] = aabb.max.y;
    header.aabb_max[2] = aabb.max.z;
    std::memset(header.reserved, 0, sizeof(header.reserved));
    out.write(reinterpret_cast<const char*>(&header), sizeof(header));

    if (!gaussians.empty()) {
        out.write(reinterpret_cast<const char*>(gaussians.data()),
                  static_cast<std::streamsize>(gaussians.size() * sizeof(gseurat::GpuGaussian)));
    }
}
```

Then add the test itself:

```cpp
// ====== Test N: GSVX v2 round-trip with baked AABB ======
{
    // Reuse 5-Gaussian PLY data from Test 10
    const std::string ply_path = tmp_dir + "/test_standard.ply";
    write_test_ply(ply_path, 5);
    auto cloud = GaussianCloud::load_ply(ply_path);

    std::vector<GpuGaussian> data(cloud.count());
    AABB expected_aabb;
    for (uint32_t i = 0; i < cloud.count(); ++i) {
        const auto& g = cloud.gaussians()[i];
        float bone_as_float;
        uint32_t bone_idx = g.bone_index;
        std::memcpy(&bone_as_float, &bone_idx, sizeof(float));
        data[i].pos_opacity = glm::vec4(g.position, g.opacity);
        data[i].scale_pad = glm::vec4(g.scale, bone_as_float);
        data[i].rot = glm::vec4(g.rotation.x, g.rotation.y, g.rotation.z, g.rotation.w);
        data[i].color_pad = glm::vec4(g.color, g.emission);
        expected_aabb.expand(g.position);
    }

    const std::string gsvx_path = tmp_dir + "/test_v2.gsvx";
    write_test_gsvx_v2(gsvx_path, data, expected_aabb);

    auto payload = GaussianCloud::load_gsvx(gsvx_path);
    assert(payload.count == 5 && "v2 GSVX should load 5 Gaussians");
    assert(approx(payload.bounds.min.x, expected_aabb.min.x) && "v2 AABB min.x from header");
    assert(approx(payload.bounds.min.y, expected_aabb.min.y) && "v2 AABB min.y from header");
    assert(approx(payload.bounds.min.z, expected_aabb.min.z) && "v2 AABB min.z from header");
    assert(approx(payload.bounds.max.x, expected_aabb.max.x) && "v2 AABB max.x from header");
    assert(approx(payload.bounds.max.y, expected_aabb.max.y) && "v2 AABB max.y from header");
    assert(approx(payload.bounds.max.z, expected_aabb.max.z) && "v2 AABB max.z from header");

    // Verify Gaussian data still matches
    for (uint32_t i = 0; i < payload.count; ++i) {
        assert(approx(payload.gpu_gaussians[i].pos_opacity.x, data[i].pos_opacity.x));
        assert(approx(payload.gpu_gaussians[i].pos_opacity.w, data[i].pos_opacity.w));
    }

    printf("PASS: Test N - GSVX v2 round-trip with baked AABB\n");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cmake --build --preset macos-debug --target test_gaussian_cloud && ./build/macos-debug/test_gaussian_cloud`
Expected: FAIL — `GsvxHeaderV2` not defined

- [ ] **Step 3: Add `GsvxHeaderV2` struct to header**

In `include/gseurat/engine/gaussian_cloud.hpp`, after the existing `GsvxHeader` struct (line 70):

```cpp
/// GSVX v2 binary file header (64 bytes, little-endian).
/// Embeds pre-computed AABB for zero-parse bounds retrieval.
struct GsvxHeaderV2 {
    char     magic[4];     // "GSVX"
    uint32_t version;      // 2
    uint32_t count;        // Number of Gaussians in payload
    uint32_t flags;        // Reserved (must be 0)
    float    aabb_min[3];  // Bounding box minimum (x, y, z)
    float    aabb_max[3];  // Bounding box maximum (x, y, z)
    uint8_t  reserved[24]; // Zero-filled padding to 64 bytes
};
static_assert(sizeof(GsvxHeaderV2) == 64, "GsvxHeaderV2 must be 64 bytes");
```

- [ ] **Step 4: Update `load_gsvx()` to handle v1 and v2**

In `src/engine/gaussian_cloud.cpp`, replace the `load_gsvx()` implementation (lines 362-436):

```cpp
GsvxPayload GaussianCloud::load_gsvx(const std::string& path) {
    auto resolved = resolve_asset_path(path);
    std::ifstream file(resolved, std::ios::binary);
    if (!file) {
        throw std::runtime_error("Cannot open GSVX file: " + resolved.string());
    }

    // Get file size for validation
    file.seekg(0, std::ios::end);
    const auto file_size = file.tellg();
    file.seekg(0, std::ios::beg);

    // Read first 8 bytes to determine version
    char magic[4]{};
    uint32_t version = 0;
    file.read(magic, 4);
    file.read(reinterpret_cast<char*>(&version), 4);
    if (!file || std::memcmp(magic, "GSVX", 4) != 0) {
        throw std::runtime_error("Invalid GSVX magic number: " + resolved.string());
    }

    uint32_t count = 0;
    uint32_t flags = 0;
    size_t header_size = 0;
    AABB baked_aabb;
    bool has_baked_aabb = false;

    if (version == 1) {
        header_size = sizeof(GsvxHeader);
        if (file_size < static_cast<std::streamoff>(header_size)) {
            throw std::runtime_error("GSVX file smaller than v1 header: " + resolved.string());
        }
        file.read(reinterpret_cast<char*>(&count), 4);
        file.read(reinterpret_cast<char*>(&flags), 4);
        // Skip remaining 16 reserved bytes
        file.seekg(static_cast<std::streamoff>(header_size), std::ios::beg);
    } else if (version == 2) {
        header_size = sizeof(GsvxHeaderV2);
        if (file_size < static_cast<std::streamoff>(header_size)) {
            throw std::runtime_error("GSVX file smaller than v2 header: " + resolved.string());
        }
        // Re-read as full v2 header
        file.seekg(0, std::ios::beg);
        GsvxHeaderV2 h2{};
        file.read(reinterpret_cast<char*>(&h2), sizeof(h2));
        if (!file) {
            throw std::runtime_error("Failed to read GSVX v2 header: " + resolved.string());
        }
        count = h2.count;
        flags = h2.flags;
        baked_aabb.min = glm::vec3(h2.aabb_min[0], h2.aabb_min[1], h2.aabb_min[2]);
        baked_aabb.max = glm::vec3(h2.aabb_max[0], h2.aabb_max[1], h2.aabb_max[2]);
        has_baked_aabb = true;
    } else {
        throw std::runtime_error("Unsupported GSVX version " +
                                 std::to_string(version) + ": " + resolved.string());
    }

    if (flags != 0) {
        throw std::runtime_error("GSVX reserved flags must be 0, got " +
                                 std::to_string(flags) + ": " + resolved.string());
    }

    // Validate file size matches header + payload
    const auto expected_size = static_cast<std::streamoff>(header_size) +
                                static_cast<std::streamoff>(count) *
                                static_cast<std::streamoff>(sizeof(GpuGaussian));
    if (file_size != expected_size) {
        throw std::runtime_error("GSVX file size " + std::to_string(file_size) +
                                 " does not match header count " +
                                 std::to_string(count) + " (expected " +
                                 std::to_string(expected_size) + " bytes): " +
                                 resolved.string());
    }

    GsvxPayload payload;
    payload.count = count;

    if (payload.count == 0) {
        if (has_baked_aabb) {
            payload.bounds = baked_aabb;
        }
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

    if (has_baked_aabb) {
        // v2: use header AABB (skip position scan)
        payload.bounds = baked_aabb;
    } else {
        // v1: compute AABB from pre-baked positions
        for (const auto& g : payload.gpu_gaussians) {
            payload.bounds.expand(glm::vec3(g.pos_opacity));
        }
    }

    return payload;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cmake --build --preset macos-debug --target test_gaussian_cloud && ./build/macos-debug/test_gaussian_cloud`
Expected: All tests PASS including the new v2 test

- [ ] **Step 6: Write test — v1 file still loads correctly with v2-aware loader**

Add to test file:

```cpp
// ====== Test N+1: v1 GSVX still loads with v2-aware loader ======
{
    const std::string ply_path = tmp_dir + "/test_standard.ply";
    write_test_ply(ply_path, 5);
    auto cloud = GaussianCloud::load_ply(ply_path);

    std::vector<GpuGaussian> data(cloud.count());
    for (uint32_t i = 0; i < cloud.count(); ++i) {
        const auto& g = cloud.gaussians()[i];
        float bone_as_float;
        uint32_t bone_idx = g.bone_index;
        std::memcpy(&bone_as_float, &bone_idx, sizeof(float));
        data[i].pos_opacity = glm::vec4(g.position, g.opacity);
        data[i].scale_pad = glm::vec4(g.scale, bone_as_float);
        data[i].rot = glm::vec4(g.rotation.x, g.rotation.y, g.rotation.z, g.rotation.w);
        data[i].color_pad = glm::vec4(g.color, g.emission);
    }

    const std::string gsvx_path = tmp_dir + "/test_v1_compat.gsvx";
    write_test_gsvx(gsvx_path, data);  // v1 format

    auto payload = GaussianCloud::load_gsvx(gsvx_path);
    assert(payload.count == 5 && "v1 compat: should load 5 Gaussians");
    // v1: AABB computed via position scan
    assert(approx(payload.bounds.min.x, 0.0f) && "v1 compat: AABB min.x from scan");
    assert(approx(payload.bounds.max.x, 4.0f) && "v1 compat: AABB max.x from scan");

    printf("PASS: Test N+1 - v1 GSVX loads with v2-aware loader\n");
}
```

- [ ] **Step 7: Run tests**

Run: `cmake --build --preset macos-debug --target test_gaussian_cloud && ./build/macos-debug/test_gaussian_cloud`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add include/gseurat/engine/gaussian_cloud.hpp src/engine/gaussian_cloud.cpp tests/test_gaussian_cloud.cpp
git commit -m "feat(gsvx): add v2 header with baked AABB for zero-parse bounds"
```

---

### Task 2: Update Python cooker to write v2 format

**Files:**
- Modify: `scripts/ply_to_gseurat.py`

- [ ] **Step 1: Write failing test — Python cooker outputs v2 header**

Create `tests/test_ply_to_gseurat.py`:

```python
#!/usr/bin/env python3
"""Test the ply_to_gseurat cooker writes valid v2 GSVX files."""

import struct
import sys
import tempfile
from pathlib import Path

import numpy as np

# Add scripts/ to path so we can import the cooker
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from ply_to_gseurat import ply_to_gsvx

# We need a real PLY file to test with — create a minimal binary one.
def make_test_ply(path: Path, count: int = 3) -> None:
    """Write a minimal binary PLY with `count` Gaussians."""
    import struct as st
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
            f.write(st.pack("<14f", *pos, *f_dc, opacity, *scale, *rot))


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 tests/test_ply_to_gseurat.py`
Expected: FAIL — header is 32 bytes (v1), assertion on `len(data)` fails

- [ ] **Step 3: Update cooker to write v2 format**

In `scripts/ply_to_gseurat.py`, change the constants and header packing:

Replace lines 36-38:
```python
GSVX_VERSION = 2
HEADER_SIZE = 64
```

Replace the header packing block (lines 178-187):
```python
    # --- Compute AABB from baked positions ---
    aabb_min = (float(px.min()), float(py.min()), float(pz.min()))
    aabb_max = (float(px.max()), float(py.max()), float(pz.max()))

    # --- Build binary (v2: 64-byte header with baked AABB) ---
    header = struct.pack("<4sIII3f3f24s",
                         GSVX_MAGIC,
                         GSVX_VERSION,
                         count,
                         0,               # flags
                         *aabb_min,
                         *aabb_max,
                         b"\x00" * 24)    # reserved
    assert len(header) == HEADER_SIZE
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 tests/test_ply_to_gseurat.py`
Expected: PASS

- [ ] **Step 5: Run C++ tests to verify cross-language compatibility**

Run: `cmake --build --preset macos-debug --target test_gaussian_cloud && ./build/macos-debug/test_gaussian_cloud`
Expected: All PASS (v1 tests still work; v2 C++ loader can read cooker output)

- [ ] **Step 6: Commit**

```bash
git add scripts/ply_to_gseurat.py tests/test_ply_to_gseurat.py
git commit -m "feat(gsvx): update Python cooker to write v2 format with baked AABB"
```

---

### Task 3: Re-cook existing .gsvx assets

**Files:**
- Modify: any existing `.gsvx` files in `examples/island_demo/assets/`

- [ ] **Step 1: Find and re-cook all existing .gsvx files**

```bash
find examples/island_demo/assets -name "*.gsvx" -exec echo "Re-cooking: {}" \;
# For each .gsvx that has a corresponding .ply:
# python3 scripts/ply_to_gseurat.py <ply_path> -o <gsvx_path>
```

- [ ] **Step 2: Verify re-cooked assets load correctly**

Run: `cmake --build --preset macos-debug --target test_gaussian_cloud && ./build/macos-debug/test_gaussian_cloud`
Expected: All PASS

- [ ] **Step 3: Commit re-cooked assets**

```bash
git add examples/island_demo/assets/
git commit -m "chore: re-cook .gsvx assets with v2 format (baked AABB)"
```
