# GSeurat

A Vulkan-based 3D Gaussian Splatting engine built with C++23. Named after **3DGS + [Georges Seurat](https://en.wikipedia.org/wiki/Georges_Seurat)**, the pointillist painter — because Gaussian splats are the modern equivalent of painted dots.

## Features

- **3D Gaussian Splatting** — GPU compute pipeline for rendering `.ply` point clouds with tile-based rasterization
- **Sprite overlay** — Sprite-based entities over GS backgrounds with bloom, depth-of-field, and tone mapping
- **Entity Component System** — Header-only ECS with archetype storage, typed views, and system functions
- **Async asset streaming** — Background thread loading with budget-limited GPU uploads for open-world support
- **Particle system** — Configurable emitters with ring-buffer pool (600 particles)
- **Audio** — 4-layer music + spatial SFX via miniaudio
- **Scripting** — Wren 0.4.0 VM for NPC behavior and game logic
- **Day/night cycle** — Ambient color interpolation with weather system
- **Save system** — JSON-based save/load with game flags
- **AI debugging** — Unix socket control server for deterministic step-mode testing
- **Creative tooling** — 6 web-based tools for content authoring (level design, particles, audio, maps)

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

```bash
# Configure
cmake --preset <platform>-debug    # linux-debug, macos-debug, windows-debug
cmake --preset <platform>-release  # linux-release, macos-release, windows-release

# Build
cmake --build --preset <platform>-debug
cmake --build --preset <platform>-release
```

Two demo executables are produced:

| Executable | Description |
|---|---|
| `gseurat_demo` | Full engine demo with gameplay, NPCs, dialog, particles |
| `gseurat_gs_demo` | GS viewer with visual effects, LOD, and chunk streaming |

## Architecture

### Renderer Flow

```
Offscreen HDR (RGBA16F) → Bloom → DoF → Composite (tone mapping + vignette)
```

Draw order: GS compute → GS blit → backgrounds → tilemap → reflections → shadows → outlines → entities → particles → overlay. UI is rendered in the composite pass (unprocessed).

### ECS

Header-only (`include/gseurat/engine/ecs/`): archetype-based storage with typed views.

**Components:** Transform, Sprite, PlayerTag, Facing, Animation, NpcPatrol, NpcWaypoints, DialogRef, DynamicLight, ParticleEmitterRef, FootstepEmitterRef, ScriptRef

**Systems:** player_movement, player_collision, npc_patrol, npc_pathfind, animation_update, lighting_rebuild, particle_sync, sprite_collect, shadow_collect, reflection_collect, outline_collect

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

Three compute passes before the main render pass:

1. **Preprocess** — project 3D Gaussians to 2D, frustum cull, compute 2D covariance
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

### Scene Format

```json
{
  "gaussian_splat": {
    "ply_file": "maps/map.ply",
    "camera": { "position": [0, 5, 10], "target": [0, 0, 0], "fov": 60 },
    "render_width": 320,
    "render_height": 240,
    "parallax": { "azimuth_range": 0.15, "parallax_strength": 1.0 }
  },
  "collision": { "width": 16, "height": 16, "cell_size": 1.0, "solid": [0,1,...] },
  "ambient_color": [0.25, 0.28, 0.45, 1.0],
  "player_position": [3.0, 2.0, 0.0],
  "npcs": [{ "name": "guard", "position": [5, 3, 0], "dialog": {...} }],
  "portals": [{ "position": [0, 7], "target_scene": "dungeon.json" }]
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
| **Level Designer** | 5173 | Tile painting, NPC/light/portal placement, AI level generation |
| **Particle Designer** | 5176 | Visual EmitterConfig editor with live engine preview |
| **Audio Composer** | 5177 | 4-layer interactive music editor with MusicGen AI |
| **SFX Designer** | 5178 | Waveform editor, procedural synthesis, AI SFX generation |
| **Bricklayer** | 5180 | 3D voxel map editor with depth estimation and PLY export |

```bash
# Prerequisites: Node.js 18+, pnpm
cd tools && pnpm install

# Start the bridge (requires running engine)
cd tools/apps/bridge && pnpm build && pnpm start

# Start a tool
cd tools/apps/level-designer && pnpm dev
```

## Testing

Tests use `assert`-based validation (no framework). Each test file includes build instructions as comments.

```bash
# Build and run all tests
c++ -std=c++23 -I include tests/test_async_loader.cpp src/engine/async_loader.cpp -o build/test_async_loader
./build/test_async_loader
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

See [tests/README.md](tests/README.md) for detailed build commands and test descriptions.

## Project Structure

```
src/
  engine/         Engine core (renderer, ECS, audio, particles, streaming, etc.)
  game/           Game-specific states and systems
  demo/           Demo applications (gameplay demo, GS viewer)
include/
  gseurat/
    engine/       Engine headers
    game/         Game state headers
    demo/         Demo app headers
shaders/          GLSL shaders (compiled to SPIR-V at build time)
assets/           Game assets (scenes, textures, maps)
tests/            C++ integration tests (assert-based)
tools/            Web-based creative tooling ecosystem (TypeScript/React)
  packages/       Shared libraries (engine-client, asset-types, ai-providers, ui-kit)
  apps/           Tool applications (bridge, level-designer, bricklayer, etc.)
docs/             Performance reports and tool documentation
.devcontainer/    Container development environment
```

## Dev Container (Podman + krunkit)

For M-series Macs with GPU remoting via krunkit:

```bash
podman build -t gseurat-dev -f .devcontainer/Dockerfile .
podman run --rm -it --device /dev/dri -v "$PWD":/workspace:Z --workdir /workspace gseurat-dev bash

# Inside the container
cmake --preset linux-debug && cmake --build --preset linux-debug
```
