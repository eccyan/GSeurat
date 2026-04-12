# GSeurat

A Vulkan-based 3D Gaussian Splatting engine built with C++23. Named after **3DGS + [Georges Seurat](https://en.wikipedia.org/wiki/Georges_Seurat)**, the pointillist painter — because Gaussian splats are the modern equivalent of painted dots.

## Features

- **3D Gaussian Splatting** — GPU compute pipeline for rendering `.ply` point clouds with tile-based rasterization, dynamic point light support
- **GPU PBD solver** — Position Based Dynamics compute shader with Verlet integration, iterative distance constraints, and ground collision. Dual-mode: wind-only (backward-compatible foliage sway) and full physics (dangling chains, pendulums)
- **Voxel character pipeline** — MagicaVoxel import, rigid-body-part posing, GPU bone skinning in compute shader, root motion (animation-driven world movement)
- **Sprite overlay** — Sprite-based entities over GS backgrounds with bloom, depth-of-field, and tone mapping
- **Game Object System** — Unified entity model with component composition. Developers define C++ component structs + JSON schemas; level designers compose objects in Bricklayer
- **Component Registry** — Type-erased component registration with JSON attach/serialize. SystemScheduler with read/write dependency declarations (parallel-ready)
- **Entity Component System** — Header-only ECS with archetype storage, typed views, and system functions
- **Async asset streaming** — Background thread loading with budget-limited GPU uploads for open-world support
- **GS Particle system** — WASM-compiled C++ simulation for preview in web tools, spline path support (emitter path + particle path modes)
- **Audio** — 4-layer music + spatial SFX via miniaudio
- **Day/night cycle** — Ambient color interpolation with weather system
- **Save system** — JSON-based save/load with game flags
- **AI debugging** — Unix socket control server for deterministic step-mode testing
- **Creative tooling** — Web-based editors: Bricklayer (map/scene), Méliès (VFX), Echidna (characters), plus legacy tile-based tools

## Prerequisites

- CMake 3.25+
- Ninja
- Vulkan SDK 1.3+
- A Vulkan-capable GPU and driver

### macOS

```bash
brew install vulkan-headers vulkan-loader molten-vk
```

Or install the [Vulkan SDK](https://vulkan.lunarg.com/sdk/home).

### Linux

```bash
# Ubuntu/Debian
sudo apt install vulkan-tools libvulkan-dev vulkan-validationlayers-dev spirv-tools glslc

# Fedora
sudo dnf install vulkan-headers vulkan-loader-devel vulkan-tools \
    vulkan-validation-layers-devel mesa-vulkan-drivers glslc
```

### Windows

Install the [Vulkan SDK](https://vulkan.lunarg.com/sdk/home).

## Building

### Linux & macOS

```bash
# Configure
cmake --preset <platform>-debug    # linux-debug, macos-debug
cmake --preset <platform>-release  # linux-release, macos-release

# Build
cmake --build --preset <platform>-debug
cmake --build --preset <platform>-release
```

### Windows

**Prerequisites:**
- Visual Studio 2022 Community or equivalent (C++ workload)
- CMake 3.25+ (installed or in PATH)
- Ninja (installed or available)
- Vulkan SDK 1.4+ (install from [vulkan.lunarg.com](https://vulkan.lunarg.com/sdk/home))

**Build Steps:**

Open the **x64 Native Tools Command Prompt for VS 2022** (search in Windows Start Menu):

```cmd
# Navigate to project
cd C:\path\to\GSeurat

# Configure (generates build\windows-debug or build\windows-release)
cmake --preset windows-debug -DCMAKE_GENERATOR_PLATFORM= -DCMAKE_C_COMPILER=cl.exe -DCMAKE_CXX_COMPILER=cl.exe

# Build
cmake --build --preset windows-debug --target gseurat_demo

# Run
build\windows-debug\gseurat_demo.exe
```

**Notes:**
- The `-DCMAKE_GENERATOR_PLATFORM=` flag ensures x64 architecture (required for Vulkan SDK on Windows)
- Use `windows-release` preset for optimized builds
- Shader files are automatically compiled and deployed to the source `shaders/` directory during build
- First build may take 2-3 minutes; subsequent builds are faster

**Troubleshooting:**
- If you see "The program can't start because vk*.dll is missing", ensure Vulkan SDK is installed and its `bin/` is in PATH
- If CMake fails to find tools, run vcvars explicitly: `"C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"`

---

One demo executable is produced:

| Executable | Description |
|---|---|
| `gseurat_demo` | GS viewer with visual effects, scene layers, and chunk streaming |

The default scene includes procedural terrain with placed objects, collision grid, nav zones, and elevation. Load custom scenes with `--scene`:

```bash
./build/macos-release/gseurat_demo --scene assets/scenes/my_scene.json
```

## Architecture

### Renderer Flow

```
Offscreen HDR (RGBA16F) → Bloom → DoF → Composite (tone mapping + vignette)
```

Draw order: GS compute → GS blit → backgrounds → tilemap → reflections → shadows → outlines → entities → particles → overlay. UI is rendered in the composite pass (unprocessed).

### Game Object System

Everything in the scene is a **Game Object** — a unified entity with position, rotation, scale, optional PLY visual, and zero or more **components** from a schema catalog.

- **Component schemas** (`assets/components/*.schema.json`) define data shapes — Bricklayer auto-generates property editors from them
- **ComponentRegistry** maps string names to type-erased ECS attach/serialize operations
- **SystemScheduler** runs C++ systems each frame with declared read/write dependencies (serial for now, parallel-ready API)
- **Scene JSON** uses `game_objects[]` array with a `components` map per object

```json
{
  "game_objects": [
    {
      "id": "chest_01", "name": "Treasure Chest",
      "position": [10, 0, 5], "rotation": [0, 90, 0], "scale": 1.0,
      "ply_file": "assets/models/chest.ply",
      "components": {
        "Health": { "max_hp": 50 },
        "Interactable": { "prompt": "Open", "radius": 2.0 }
      }
    }
  ]
}
```

### ECS

Header-only (`include/gseurat/engine/ecs/`): archetype-based storage with typed views. Note: archetype storage uses `memcpy` — components must be trivially copyable.

### Async Asset Streaming

Background asset loading for open-world support:

```
Main Thread                     Worker Thread (std::thread)
─────────────                   ────────────────────────────
submit request ──► request_queue_ ──► disk I/O + CPU parsing
poll_results() ◄── completed_    ◄── push result
flush() ──► GPU upload (budget-limited, 4MB/frame)
```

| Component | Description |
|---|---|
| `AsyncLoader` | Thread-safe work queue with single worker thread |
| `StagingUploader` | Double-buffered, budget-limited per-frame GPU texture uploads |
| `GsChunkStreamer` | Distance-based GS chunk streaming with hysteresis and memory budget |

All disk I/O and CPU parsing runs on the worker thread. All Vulkan API calls stay on the main thread.

### 3D Gaussian Splatting

```
PLY file → GaussianCloud → GsRenderer (compute) → Storage Image → Fullscreen Blit
```

Compute passes before the main render pass:

0. **PBD Solver** (optional) — GPU-driven Position Based Dynamics physics solver: Verlet integration, distance constraint projection, ground collision. Writes position + rotation deltas
1. **Preprocess** — project 3D Gaussians to 2D, frustum cull, compute 2D covariance (reads PBD + bone transforms)
2. **Bitonic Sort** — depth-sort projected splats front-to-back
3. **Tile Rasterizer** — 16x16 tile-based splatting into a 320x240 HDR storage image

Output is sampled with nearest-neighbor filtering for stylized upscale.

**Performance optimizations:**
- Render early termination on first culled Gaussian (sorted order)
- Visible count via atomic counter (preprocess SSBO)
- Spatial chunk grid (`GsChunkGrid`) with frustum culling
- CPU-side LOD decimation with adaptive budget (converge-and-lock targeting 30 FPS)
- Hybrid re-render: full compute every Nth frame, cached blit with 2D offset between
- Async chunk streaming (`GsChunkStreamer`) for open-world scale maps

**GS Demo controls:**

| Key | Action |
|---|---|
| Mouse drag | Orbit camera |
| Scroll | Zoom |
| WASD | Pan |
| M | Toggle streaming mode |
| P | Toggle shadow box (parallax) mode |
| T/L/F/G/X | Toon / Light / Fire / Water / Touch |
| E/V/H/Y/C/B | Explode / Voxel / Pulse / X-Ray / Swirl / Burn |
| J | Toggle chain demo (3 PBD elements, 2 distance constraints) |
| K | Toggle character demo (procedural walking humanoid) |
| N | Toggle scene layers (auto-generate heightmap, nav, light probes) |

### Voxel Character Pipeline

Characters are authored as voxel body parts, exported as Gaussians with per-splat bone indices, and animated via GPU bone transforms.

```
MagicaVoxel (.vox) → Echidna (edit parts/joints/poses) → PLY + manifest JSON
                                                                 ↓
Engine: PLY load → bone_index per Gaussian → preprocess shader → skeletal skinning
```

**Authoring** (Echidna — port 5179):
- Import `.vox` files — each MagicaVoxel model maps to a body part
- Assign Part tool: click voxels to assign to body parts, with part highlighting
- Define bone hierarchy (parent/child) with joint pivot positions and gizmo visualization
- Create named poses with per-part euler rotations and live preview
- Export PLY with `bone_index` property + character manifest JSON

**Runtime** (Engine):
- `bone_index` packed into `GpuGaussian.scale_pad.w` (no SSBO size change)
- Index segmentation: 0 = no transform, 1-31 = bone skinning (binding 5), 32-63 = PBD dynamics (binding 6)
- Bone transform SSBO at binding 5 (max 32 bones)
- PBD state SSBO at binding 6 (max 64 elements) — position anchors + rotation quaternions
- PBD API: `upload_pbd_elements()`, `upload_pbd_constraints()`, `clear_pbd()` on `GsRenderer`
- Preprocess shader applies `mat4` per bone or PBD quaternion rotation per element
- Bone 0 = identity (map Gaussians pass through untouched)
- Rigid body part animation (action-figure style, no smooth skinning)

**Root Motion:**
- Animation-driven world-space movement — walk cycles, dodge rolls, and lunges move the actor
- Per-pose `root_position` offset + per-clip `root_motion` opt-in flag in character manifests
- `BoneAnimationPlayer` extracts per-frame position/rotation deltas with loop-aware math
- Root bone transform stripped to identity before FK; game state accumulates deltas into a `character_rotation_` quaternion
- Phase 2: preprocess shader rotates per-Gaussian covariance by actor rotation for correct visual orientation

See [docs/pbd-solver.md](docs/pbd-solver.md) for full PBD architecture and API reference.
See [docs/superpowers/specs/2026-04-07-root-motion-design.md](docs/superpowers/specs/2026-04-07-root-motion-design.md) for root motion system design.

### Scene Composition (Game Objects)

Scenes are composed from separate PLY files — terrain, props, and characters authored independently:

```
Bricklayer (terrain.ply) + Echidna (character.ply) + props (tree.ply, rock.ply)
                          ↓
                   scene.json (game_objects references)
                          ↓
              Engine: merge PLY visuals into cloud, create ECS entities for objects with components
```

- **Game Objects with PLY**: merged into the terrain cloud at load time for rendering
- **Game Objects with components**: also become ECS entities with attached component data
- **Game Objects without PLY or components**: logical-only entities (triggers, zones)

### Scene Layers

The `CollisionGrid` provides gameplay metadata overlaid on the GS terrain:

| Layer | Type | Purpose |
|-------|------|---------|
| `solid` | bool[] | Walkable/blocked per cell |
| `elevation` | float[] | Ground height (Y) per cell — for entity placement |
| `nav_zone` | uint8[] | Named regions (town, forest, etc.) for AI behavior |
| `light_probe` | vec3[] | Ambient color sampled from Gaussians — for entity lighting |

Auto-generated from Gaussian data via `generate_collision_from_gaussians()`, or painted manually in Bricklayer.

### Scene Format

```json
{
  "gaussian_splat": {
    "ply_file": "assets/maps/terrain.ply",
    "camera": { "position": [32, 30, 80], "target": [32, 0, 32], "fov": 45 },
    "render_width": 320, "render_height": 240
  },
  "game_objects": [
    { "id": "tree", "name": "Oak Tree", "ply_file": "assets/props/tree.ply",
      "position": [15, 0, 20], "rotation": [0, 0, 0], "scale": 1.0,
      "pbd": { "mode": "wind_sway", "wind_strength": 0.06 } },
    { "id": "house", "name": "House", "ply_file": "assets/props/house.ply",
      "position": [32, 0, 32], "rotation": [0, 0, 0], "scale": 1.0, "components": {} },
    { "id": "guard", "name": "Town Guard",
      "position": [20, 0, 25], "rotation": [0, 0, 0], "scale": 1.0,
      "components": {
        "Facing": { "direction": "left" },
        "Patrol": { "speed": 2.0, "waypoints": [[20, 0, 25], [30, 0, 25]] }
      }}
  ],
  "collision": {
    "width": 64, "height": 64, "cell_size": 1.0,
    "solid": ["..."], "elevation": ["..."], "nav_zone": ["..."]
  },
  "nav_zone_names": ["default", "town", "forest"],
  "ambient_color": [0.8, 0.85, 0.95, 1.0]
}
```

## AI Debugging via Control Server

The engine exposes a Unix domain socket at `/tmp/gseurat.sock` for external control. AI agents can send commands, step deterministically, and capture screenshots.

```bash
# Connect and control
python3 -c "
import socket, json
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect('/tmp/gseurat.sock')

def send(cmd):
    s.sendall(json.dumps(cmd).encode() + b'\n')
    return json.loads(s.recv(4096).decode())

send({'cmd': 'set_mode', 'mode': 'step'})
send({'cmd': 'move', 'direction': 'right'})
send({'cmd': 'step', 'frames': 30})
send({'cmd': 'screenshot', 'path': '/tmp/debug.png'})
s.close()
"
```

<details>
<summary>Full command reference</summary>

| Command | Payload | Description |
|---------|---------|-------------|
| `get_state` | — | Player/NPC positions, animation, tick count |
| `get_map` | — | Tilemap dimensions, tiles, solid flags |
| `move` | `direction`, `sprint` | Inject movement input |
| `stop` | — | Clear all injected inputs |
| `interact` | — | Press interact key for one frame |
| `set_mode` | `mode`: `"step"/"realtime"` | Switch modes |
| `step` | `frames`: 1-600 | Advance N frames at fixed 1/60s dt |
| `screenshot` | `path` | Capture frame to PNG |
| `get_scene` | — | Full scene JSON |
| `reload_scene` | — | Re-initialize scene from disk |
| `set_tile` | `col`, `row`, `tile_id`, `solid` | Modify a tile |
| `set_tiles` | `tiles` array | Batch tile modification |
| `resize_tilemap` | `width`, `height`, `fill_tile` | Resize tilemap |
| `set_player_position` | `position` | Teleport player |
| `update_npc` | `index`, field overrides | Modify NPC |
| `set_ambient` | `color` | Change ambient lighting |
| `add_light` / `remove_light` / `update_light` | light params | Manage point lights |
| `add_portal` / `remove_portal` | portal params | Manage portals |
| `set_weather` | `type`, `fog_density`, `fog_color` | Change weather |
| `set_day_night` | `enabled`, `cycle_speed`, `time` | Day/night cycle |
| `set_emitter_config` / `add_emitter` / `remove_emitter` / `list_emitters` | emitter params | Manage particles |
| `get_features` / `set_feature` | `name`, `enabled` | Toggle feature flags |
| `set_camera` | `position`, `zoom` | Override camera |

</details>

## Creative Tooling

The `tools/` directory contains web-based creative tools connected to the engine via a WebSocket bridge proxy.

```
Engine (Vulkan) ←→ Unix Socket ←→ Bridge Proxy (ws://localhost:9100) ←→ Web Tools
```

| Tool | Port | Description |
|------|------|-------------|
| **Bridge Proxy** | 9100/9101 | Node.js relay between Unix socket and WebSocket clients |
| **Bricklayer** | 5180 | 3DGS map editor: voxel terrain, Game Objects with component composition, PBD physics configuration, emitters, animations, VFX, lights |
| **Méliès** | 5181 | VFX editor: particle emitters, GS animations, spline paths, object layers, light layers |
| **Echidna** | 5179 | Voxel character editor: .vox import, body parts, bone posing, PLY export |
| **Staging** | C++ app | ImGui rendering review: live scene preview, gizmos for lights/emitters/VFX/game objects, bridge auto-sync |
| Level Designer | 5173 | Tile painting, NPC/light/portal placement (legacy tile-based) |
| Particle Designer | 5176 | Visual EmitterConfig editor with live engine preview |
| Audio Composer | 5177 | 4-layer interactive music editor with MusicGen AI |
| SFX Designer | 5178 | Waveform editor, procedural synthesis, AI SFX generation |

```bash
# Prerequisites: Node.js 18+, pnpm
cd tools && pnpm install

# Start the bridge (requires running engine)
cd tools/apps/bridge && pnpm build && pnpm start

# Start a tool
cd tools/apps/level-designer && pnpm dev
```

## Testing

### C++ Engine Tests

All 27 test suites are CMake targets, run via `ctest`:

```bash
cmake --preset <platform>-debug
cmake --build --preset <platform>-debug
ctest --test-dir build/<platform>-debug --output-on-failure
```

| Test Suite | Tests | What it covers |
|---|---|---|
| `test_async_loader` | 10 | Queue semantics, ordering, cancel, shutdown, reuse |
| `test_staging_uploader` | 6 | Budget enforcement, double-buffer, callbacks |
| `test_gs_chunk_streamer` | 7 | Manifest parsing, state transitions, hysteresis, memory budget |
| `test_gs_chunk_grid` | 9 | Spatial partitioning, frustum culling, LOD decimation |
| `test_feature_flags` | 8 | Flag defaults, GS viewer profile, categories |
| `test_tilemap` | 12 | Tile animation, collision resolution, draw info generation |
| `test_gaussian_cloud` | 9 | PLY loading, scene format parsing, collision generation |
| `test_gs_parallax_camera` | 6 | Camera configuration, Y-flip, smoothing convergence |
| `test_screenshot` | 5 | State machine, BGRA→RGBA swizzle |
| `test_character_data` | 12 | Character animation JSON loading |
| `test_pbd_solver` | 10 | PBD struct layouts (64/48/32 bytes), index segmentation, quaternion math, Verlet integration, distance constraint projection, wind sway |
| `test_gs_point_lights` | 35 | Point, spot, area light evaluation, attenuation, cone falloff |
| `test_gs_emission` | 8 | Emissive Gaussian packing, HDR value validation |
| `test_gs_spline` | 9 | Catmull-Rom spline evaluation, arc-length parameterization |
| `test_gs_particle` | 75 | GS particle emitter lifecycle, spawn regions, spline paths |
| `test_gs_post_process` | 6 | Fog, tone mapping, bloom, DoF, chromatic aberration config |
| `test_incremental_sync` | — | Bridge incremental scene sync protocol |
| `test_vfx_scene_buffer` | 8 | VFX instance buffer layout, emitter/animation/light packing |
| `test_vfx_lights_rotation` | 11 | VFX light rotation transforms, spot/area orientation |
| `test_component_registry` | 11 | Type-erased component registration, JSON attach/serialize |
| `test_system_scheduler` | 6 | System ordering, read/write dependency declarations |
| `test_coordinate` | — | Typed coordinate system conversions (world/screen/grid) |
| `test_island_systems` | 16 | Island demo game object systems integration |
| `test_scene_loading` | — | Full scene JSON loading, game object instantiation |
| `test_character_manifest` | 60 | Character manifest parsing, root motion fields, pose/clip validation |
| `test_bone_animation_player` | 9 | Bone FK, delta extraction, loop wrap-around, root stripping |
| `test_bone_animation_state_machine` | 5 | State transitions, animation blending, root motion reset |

### TypeScript Tool Tests

```bash
cd tools && pnpm install
pnpm --filter @gseurat/tests test:echidna-ply-export
```

| Test Suite | Assertions | What it covers |
|---|---|---|
| `echidna-ply-export` | 37 | PLY export with bone_index, SH color encoding, opacity, surface culling |

### CI

GitHub Actions runs three parallel jobs on every push/PR to main:
- **Build** — C++ engine on Linux, Windows, macOS
- **Test (C++)** — 27 engine test suites via ctest (ubuntu)
- **Test (TypeScript)** — Tool tests via pnpm (ubuntu)

See [tests/README.md](tests/README.md) for detailed build commands and test descriptions.

## Project Structure

```
src/
  engine/         Engine core (renderer, ECS, audio, particles, streaming, etc.)
  demo/           Demo application (GS viewer)
include/
  gseurat/
    engine/       Engine headers
    demo/         Demo app headers
shaders/          GLSL shaders (compiled to SPIR-V at build time)
assets/
  maps/           Terrain PLY files
  props/          Prop PLY files (tree, rock, house)
  scenes/         Scene JSON files
tests/            C++ integration tests (assert-based)
scripts/          Python utilities for test data generation
tools/            Web-based creative tooling ecosystem (TypeScript/React)
  packages/       Shared libraries (engine-client, asset-types, ai-providers, ui-kit)
  apps/           Tool applications (bridge, level-designer, echidna, bricklayer, etc.)
docs/             Performance reports and tool documentation
.devcontainer/    Container development environment
```

### Test Data Generation

Python scripts for generating procedural PLY test assets (no external dependencies):

```bash
# Generate terrain (rolling hills, 64x64 grid)
python3 scripts/generate_test_terrain.py --output assets/maps/test_terrain.ply

# Generate props (tree, rock, house)
python3 scripts/generate_test_props.py --output-dir assets/props

# Generate complete scene (terrain + placed objects + collision grid + nav zones)
python3 scripts/generate_test_scene.py \
  --terrain assets/maps/test_terrain.ply \
  --props-dir assets/props \
  --output assets/scenes/gs_layers_demo.json

# The default gs_demo.json uses the generated test scene.
# Regenerate it after modifying scripts:
cp assets/scenes/gs_layers_demo.json assets/scenes/gs_demo.json

# Run with a custom scene:
./build/macos-release/gseurat_demo --scene path/to/scene.json
```

## Dev Container (Podman + krunkit)

For M-series Macs with GPU remoting via krunkit:

```bash
podman build -t gseurat-dev -f .devcontainer/Dockerfile .
podman run --rm -it --device /dev/dri -v "$PWD":/workspace:Z --workdir /workspace gseurat-dev bash

# Inside the container
cmake --preset linux-debug && cmake --build --preset linux-debug
```

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.
