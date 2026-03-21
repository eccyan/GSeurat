# Tests

## C++ Integration Tests

### test_gaussian_cloud

Tests the 3D Gaussian Splatting PLY loader, scene format parser, and collision generation.

**Build:**
```bash
c++ -std=c++23 -I include \
    -I build/macos-debug/_deps/json-src/include \
    -I build/macos-debug/_deps/glm-src \
    -I build/macos-debug/_deps/stb-src \
    -I build/macos-debug/_deps/vma-src/include \
    $(pkg-config --cflags vulkan 2>/dev/null || echo "-I$VULKAN_SDK/include") \
    tests/test_gaussian_cloud.cpp \
    src/engine/gaussian_cloud.cpp \
    src/engine/collision_gen.cpp \
    src/engine/scene_loader.cpp \
    src/engine/tilemap.cpp \
    -o build/test_gaussian_cloud
```

**Run:**
```bash
./build/test_gaussian_cloud
```

**Tests (9):**
| # | Test | What it verifies |
|---|------|------------------|
| 1 | Load standard 3DGS PLY | 10-vertex binary PLY with f_dc SH colors, sigmoid opacity, exp scale |
| 2 | Load nerfstudio-style PLY | `scaling_0`/`rotation_0` naming, `uchar red/green/blue` direct RGB |
| 3 | Missing PLY throws | `std::runtime_error` for non-existent file |
| 4 | Empty PLY | 0-vertex file returns empty cloud |
| 5 | SceneLoader gaussian_splat | JSON parsing of `gaussian_splat` block (ply_file, camera, dimensions) |
| 6 | SceneLoader collision grid | JSON parsing of `collision` block (width, height, cell_size, solid array) |
| 7 | SceneLoader round-trip | `to_json` → `from_json` preserves all GS + collision data |
| 8 | Collision from depth | `generate_collision_from_depth()` with variance threshold |
| 9 | Backwards compatibility | Plain scene without `gaussian_splat` loads with `nullopt` |

### test_feature_flags

Tests the FeatureFlags struct: defaults, gs_viewer() profile, GS category entries.

**Build:**
```bash
c++ -std=c++23 -I include \
    tests/test_feature_flags.cpp \
    -o build/test_feature_flags
```

**Run:**
```bash
./build/test_feature_flags
```

**Tests (8):**
| # | Test | What it verifies |
|---|------|------------------|
| 1 | Default flags all true | All 32 flags true via entries() iteration |
| 2 | gs_viewer() profile | Non-GS flags false, gs_rendering/chunk_culling/lod/adaptive true, gs_parallax false |
| 3 | Entry count | `entries().size() == 32` |
| 4 | Pointer-to-member round-trip | `flags.*entry.ptr` reads/writes correctly |
| 5 | GS category entries | Exactly 5 entries with category "3DGS" |
| 6 | Individual flag toggle | Set one GS flag false, verify others unaffected |
| 7 | Tilemap flags default true | `tilemap_rendering` and `tilemap_collision` default true |
| 8 | gs_viewer() tilemap false | GS viewer profile has both tilemap flags false |

### test_screenshot

Tests ScreenshotCapture state machine and BGRA→RGBA pixel swizzle.

**Build:**
```bash
c++ -std=c++23 -I include \
    -I build/macos-debug/_deps/glm-src \
    -I build/macos-debug/_deps/stb-src \
    -I build/macos-debug/_deps/vma-src/include \
    $(pkg-config --cflags vulkan 2>/dev/null || echo "-I$VULKAN_SDK/include") \
    tests/test_screenshot.cpp src/engine/screenshot.cpp \
    -o build/test_screenshot
```

**Run:**
```bash
./build/test_screenshot
```

**Tests (5):**
| # | Test | What it verifies |
|---|------|------------------|
| 1 | Initial state not pending | `has_pending() == false` after construction |
| 2 | Request sets pending | After `request("out.png")`, `has_pending() == true` |
| 3 | Initial write_ok false | `write_ok() == false` before any capture |
| 4 | BGRA→RGBA swizzle 4 pixels | 4-pixel input with known BGRA values produces correct RGBA, alpha forced to 255 |
| 5 | Swizzle single pixel | 1-pixel buffer swizzles correctly |

### test_tilemap

Tests TileAnimator, resolve_tilemap_collision, and TileLayer::generate_draw_infos.

**Build:**
```bash
c++ -std=c++23 -I include \
    -I build/macos-debug/_deps/glm-src \
    -I build/macos-debug/_deps/stb-src \
    -I build/macos-debug/_deps/vma-src/include \
    $(pkg-config --cflags vulkan 2>/dev/null || echo "-I$VULKAN_SDK/include") \
    tests/test_tilemap.cpp src/engine/tilemap.cpp \
    -o build/test_tilemap
```

**Run:**
```bash
./build/test_tilemap
```

**Tests (12):**
| # | Test | What it verifies |
|---|------|------------------|
| 1 | resolve without animation | `resolve(id)` returns same id when no definition matches |
| 2 | add_definition + resolve | After adding def (base=5, frames=[10,11,12]), `resolve(5)` → 10 |
| 3 | update advances frame | After `update(frame_duration)`, `resolve(5)` → 11 |
| 4 | update wraps around | After cycling all frames, wraps to frame 0 |
| 5 | reset clears state | After `reset()`, `resolve(5)` → 5 (no definition) |
| 6 | empty solid vector | Returns position unchanged |
| 7 | no overlap | Far-away position returns unchanged |
| 8 | push out minimum axis | Overlapping solid tile pushes out on smaller overlap axis |
| 9 | two adjacent solids | Both collisions resolved correctly |
| 10 | skip tiles | 0xFFFF tiles produce no draw info |
| 11 | position calculation | 2×2 grid positions are centered correctly |
| 12 | animator integration | Animated tile changes UV coordinates |

### test_gs_chunk_grid

Tests GsChunkGrid: build, visible_chunks frustum culling, gather, gather_lod decimation.

**Build:**
```bash
c++ -std=c++23 -I include \
    -I build/macos-debug/_deps/glm-src \
    -I build/macos-debug/_deps/stb-src \
    tests/test_gs_chunk_grid.cpp \
    src/engine/gs_chunk_grid.cpp \
    src/engine/gaussian_cloud.cpp \
    -o build/test_gs_chunk_grid
```

**Run:**
```bash
./build/test_gs_chunk_grid
```

**Tests (9):**
| # | Test | What it verifies |
|---|------|------------------|
| 1 | Empty cloud | `build()` on empty → `empty() == true` |
| 2 | Single Gaussian | 1 chunk, correct `cloud_bounds()` |
| 3 | Multi-chunk | Gaussians spread across area → multiple chunks |
| 4 | visible_chunks returns results | Known VP matrix returns visible chunks |
| 5 | Frustum culling | Tight camera doesn't see all chunks in large grid |
| 6 | gather count | Output count matches sum of selected chunk counts |
| 7 | gather_lod respects budget | 1000 Gaussians, budget=200 → output ≤ 200 |
| 8 | gather_lod spatial coverage | Stride sampling covers spatial range, not just first N |
| 9 | cloud_bounds accuracy | AABB matches min/max of input positions |

### test_gs_parallax_camera

Tests GsParallaxCamera: configure, update, view/proj matrix properties.

**Build:**
```bash
c++ -std=c++23 -I include \
    -I build/macos-debug/_deps/glm-src \
    -I build/macos-debug/_deps/json-src/include \
    -I build/macos-debug/_deps/stb-src \
    -I build/macos-debug/_deps/vma-src/include \
    $(pkg-config --cflags vulkan 2>/dev/null || echo "-I$VULKAN_SDK/include") \
    tests/test_gs_parallax_camera.cpp \
    src/engine/gs_parallax_camera.cpp \
    src/engine/scene_loader.cpp \
    src/engine/tilemap.cpp \
    -o build/test_gs_parallax_camera
```

**Run:**
```bash
./build/test_gs_parallax_camera
```

**Tests (6):**
| # | Test | What it verifies |
|---|------|------------------|
| 1 | Initial matrices valid | `view()` and `proj()` are not identity/zero after configure |
| 2 | Vulkan Y-flip | `proj()[1][1] < 0` |
| 3 | Zero offset no change | `update({0,0}, 0)` doesn't alter view |
| 4 | Offset shifts camera | `update({1,0}, dt)` changes view matrix |
| 5 | Smoothing converges | Many `update()` calls converge to target |
| 6 | Aspect ratio | Configure 320×240, verify proj encodes 4:3 |

### test_character_data

Tests character animation JSON loading (pre-existing).

**Build:**
```bash
c++ -std=c++23 -I include \
    -I build/macos-debug/_deps/json-src/include \
    -I build/macos-debug/_deps/glm-src \
    -I build/macos-debug/_deps/stb-src \
    tests/test_character_data.cpp \
    src/engine/character_data.cpp \
    src/engine/tilemap.cpp \
    -o build/test_character_data
```

## TypeScript Tool Tests

All tool tests run via the QA test runner which uses headless Chrome + WebSocket to manipulate Zustand stores.

### Map Painter Tests

**Prerequisites:** Start the dev server first:
```bash
cd tools/apps/map-painter && pnpm dev
```

**Run all tests (unit + scenario):**
```bash
cd tools/tests && pnpm test:map-painter
```

**Run scenarios only:**
```bash
cd tools/tests && pnpm test:map-painter:scenario
```

**Unit Tests (19):**
- Store accessibility and default dimensions
- Pixel set/erase on ground layer
- Height brush updates
- Tool, layer, color selection
- Zoom clamping (min=1, max=64)
- Collision toggle and auto-generation from heights
- Undo/redo for pixel operations
- Map resize with data preservation
- Flood fill across connected region
- Preview camera updates
- Layer independence (ground vs walls vs decorations)

**Scenario Tests (3):**

| Scenario | Steps | What it verifies |
|----------|-------|------------------|
| Village map | Init → grass fill → wall border → heights → auto-collision → water feature → camera → undo/redo | Full creative workflow with multi-layer painting |
| Cross-layer undo/redo | Paint across 3 layers + height → undo all → redo all | State isolation between operations |
| Collision refinement | Set all heights → auto-gen (all solid) → manually clear path → verify mixed state | Manual override of auto-generated collision |

### Other Tool Tests

See `tools/tests/package.json` for all available test commands. Each tool requires its dev server running.

```bash
pnpm test                    # All tools
pnpm test --tool <name>      # Single tool
pnpm test --scenario         # Scenarios only
```

| Tool | Dev Port | Test Port |
|------|----------|-----------|
| level-designer | 5173 | 6173 |
| seurat | 5179 | 6179 |
| particle-designer | 5176 | 6176 |
| audio-composer | 5177 | 6177 |
| sfx-designer | 5178 | 6178 |
| map-painter | 5180 | 6180 |
