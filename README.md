# GSeurat

A high-performance C++23 / Vulkan engine utilizing **3D Gaussian Splatting**, optimized for a pixel-art aesthetic. Named after **3DGS + [Georges Seurat](https://en.wikipedia.org/wiki/Georges_Seurat)**, the pointillist painter — because Gaussian splats are the modern equivalent of painted dots.

GSeurat is designed to be embedded in external game projects as a **Git submodule**, while remaining fully buildable as a standalone project with demonstration apps and creative tooling.

## Features

- **3D Gaussian Splatting** — GPU compute pipeline for rendering `.ply` / `.gsvx` point clouds with tile-based rasterization, dynamic point light support
- **GPU PBD solver** — Position Based Dynamics compute shader with Verlet integration, iterative distance constraints, and ground collision. Dual-mode: wind-only (backward-compatible foliage sway) and full physics (dangling chains, pendulums)
- **Voxel character pipeline** — MagicaVoxel import, rigid-body-part posing, GPU bone skinning in compute shader, root motion (animation-driven world movement)
- **Sprite overlay** — Sprite-based entities over GS backgrounds with bloom, depth-of-field, and tone mapping
- **Game Object System** — Unified entity model with component composition. Developers define C++ component structs + JSON schemas; level designers compose objects in Bricklayer
- **Component Registry** — Type-erased component registration with JSON attach/serialize. SystemScheduler with read/write dependency declarations (parallel-ready)
- **3D Collision System** — Primitive colliders (Box, Sphere, Capsule) with static BVH broadphase, capsule sweep queries, heightfield terrain colliders (16-bit PNG), and a Kinematic Character Controller with depenetration recovery, continuous gravity, and wall sliding
- **Camera Pipeline** — 5-mode camera system (free_look, rail_follow, cinematic_rail, fixed_point, side_scroll) with zone priority resolution, smooth blending, spline paths, easing curves, and cinematic playback modes
- **Entity Component System** — Header-only ECS with archetype storage, typed views, and system functions
- **[Scene transitions](docs/scene-transitions.md)** — Transient-entity state machine (`SceneOut → Loading → SceneIn`) fully decoupled from presentation. Portals are authored in Bricklayer via `ProximityTrigger + PortalTarget`; the post-process shader supports solid fade, left-to-right wipe, and iris wipe effects
- **Async asset streaming** — Slab allocator + GPU page table, async transfer queue, `world.json` spatial partitioning with fixed uniform chunk grid, StreamingVolumes for preload hints, GPU frustum culling
- **GS Particle system** — WASM-compiled C++ simulation for preview in web tools, spline path support (emitter path + particle path modes)
- **[Audio engine](docs/audio-engine.md)** — Lock-free interactive music with stem-based vertical remixing, sample-accurate looping, marker-aligned crossfade transitions, RTPC parameter binding, per-stem DSP effect chain (SVF LPF/HPF/BPF), oneshot SFX with spatial distance attenuation, Ogg Vorbis streaming via background decode thread, `.gsaudio` mmap format, format auto-detection (WAV/GSAU/OggS)
- **Day/night cycle** — Ambient color interpolation with weather system
- **Save system** — JSON-based save/load with game flags
- **AI debugging** — Unix socket control server for deterministic step-mode testing
- **Live camera sync** — Bidirectional camera sync between Bricklayer and Staging via WebSocket bridge with echo suppression
- **Creative tooling** — Web-based editors: Bricklayer (map/scene), Melies (VFX), Echidna (characters), plus legacy tile-based tools

## Project Structure

```
GSeurat/
├── include/gseurat/           # Public C++ headers
│   ├── engine/                #   Core engine (renderer, GS, Vulkan, ECS, streaming)
│   │   ├── audio/             #   Audio engine (AudioEngine, IAudioSource, DSP effects)
│   │   └── collision/         #   3D collision (primitives, BVH, intersect, debug wireframe)
│   ├── platform/              #   Platform abstractions (MemoryMappedFile)
│   ├── character/             #   Bone animation, character manifests
│   ├── demo/                  #   Demo application headers
│   └── staging/               #   Staging review tool headers
├── src/
│   ├── engine/                # Core engine implementation (game-agnostic)
│   │   └── audio/             #   Audio engine (mixer, sources, metadata, DSP, backend)
│   ├── character/             # Character animation system
│   ├── demo/                  # Island demo application
│   └── staging/               # ImGui-based staging review tool
├── shaders/                   # GLSL compute/vertex/fragment shaders (core engine)
├── schemas/                   # JSON schemas (scene, world, components)
├── examples/
│   └── island_demo/           # Demonstration project
│       ├── assets/            #   Game assets (maps, props, scenes, audio, VFX)
│       └── world.json         #   World manifest (chunks, portals, streaming volumes)
├── tests/                     # C++ unit and GPU tests
├── scripts/                   # Python utilities (Game Director, asset generation)
├── src/tools/                 # Offline CLI utilities (ply2heightmap)
├── tools/                     # TypeScript/React monorepo (pnpm)
│   ├── apps/                  #   Web apps (Bricklayer, Echidna, Melies, Bridge)
│   └── packages/              #   Shared packages (engine-client, asset-types, ui-kit)
├── docs/                      # Design specs, plans, performance reports
├── CMakeLists.txt             # Build configuration
├── CMakePresets.json           # Build presets (macos/linux/windows, debug/release)
└── CLAUDE.md                  # AI assistant instructions
```

**Key directories:**
- **`src/engine/`** — Pure engine core. Game-agnostic; no hardcoded asset paths or game-specific logic.
- **`examples/island_demo/`** — Self-contained demo with all game-specific assets and `world.json`. Not included when GSeurat is used as a submodule.
- **`tools/`** — Web-based creative tooling connected to the engine via a WebSocket bridge proxy.

## Usage: As a Subrepository

GSeurat is designed to be embedded in external game projects via `add_subdirectory()`. When included this way, it automatically:
- Builds as a **static library** (`STATIC`) to avoid DLL boundary and memory-heap issues across platforms
- **Skips** building demo apps, staging tools, and tests to speed up compilation
- Exposes the `GSeurat::Engine` namespaced target for linking

### Quick Start

Add GSeurat as a Git submodule:

```bash
git submodule add https://github.com/eccyan/GSeurat.git engine/GSeurat
git submodule update --init --recursive
```

In your project's `CMakeLists.txt`:

```cmake
cmake_minimum_required(VERSION 3.25)
project(MyGame LANGUAGES C CXX)

# Add GSeurat engine
add_subdirectory(engine/GSeurat)

# Link your game against the engine
add_executable(MyGame src/main.cpp)
target_link_libraries(MyGame PRIVATE GSeurat::Engine)
```

That's it. GSeurat transitively provides Vulkan, GLM, GLFW, VMA, nlohmann/json, miniaudio, and C++23 standard compliance.

### Asset Path Resolution

The engine uses relative paths (`"assets/..."`) resolved against the working directory. Your game project is responsible for providing assets at those paths. Use `gseurat::set_project_root()` to set a base path for asset resolution:

```cpp
#include "gseurat/engine/project_root.hpp"

int main() {
    gseurat::set_project_root("/path/to/my/game");
    // Engine will resolve "assets/maps/level1.ply"
    // as "/path/to/my/game/assets/maps/level1.ply"
}
```

## Usage: Standalone Development

For developing the engine itself or running the demo/staging apps, build from the repository root.

### Prerequisites

- CMake 3.25+
- Ninja
- Vulkan SDK 1.3+
- A Vulkan-capable GPU and driver

**macOS:**
```bash
brew install vulkan-headers vulkan-loader molten-vk
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt install vulkan-tools libvulkan-dev vulkan-validationlayers-dev spirv-tools glslc
```

**Linux (Fedora):**
```bash
sudo dnf install vulkan-headers vulkan-loader-devel vulkan-tools \
    vulkan-validation-layers-devel mesa-vulkan-drivers glslc
```

**Windows:**
Install the [Vulkan SDK](https://vulkan.lunarg.com/sdk/home) and Visual Studio 2022 (C++ workload).

### Building

```bash
# Configure
cmake --preset <platform>-debug    # linux-debug, macos-debug, windows-debug
cmake --preset <platform>-release  # linux-release, macos-release, windows-release

# Build
cmake --build --preset <platform>-debug
cmake --build --preset <platform>-release
```

**Windows** — open the x64 Native Tools Command Prompt for VS 2022:

```cmd
cmake --preset windows-debug -DCMAKE_GENERATOR_PLATFORM= -DCMAKE_C_COMPILER=cl.exe -DCMAKE_CXX_COMPILER=cl.exe
cmake --build --preset windows-debug --target gseurat_demo
build\windows-debug\gseurat_demo.exe
```

### CMake Options

| Option | Default (standalone) | Default (subdirectory) | Description |
|--------|---------------------|----------------------|-------------|
| `GSEURAT_BUILD_EXAMPLES` | `ON` | `OFF` | Build demo and staging executables |
| `GSEURAT_BUILD_TESTS` | `ON` | `OFF` | Build unit and GPU test suites |
| `GSEURAT_BUILD_TOOLS` | `ON` | `OFF` | Include tooling support |
| `GSEURAT_SHARED_LIBS` | `OFF` | `OFF` | Build as shared library instead of static |
| `GSEURAT_DEV_MODE` | `ON` | `ON` | Enable ImGui developer overlay |

Override any option at configure time:

```bash
cmake --preset macos-release -DGSEURAT_BUILD_TESTS=OFF -DGSEURAT_SHARED_LIBS=ON
```

### Running the Demo

One demo executable and one staging tool are produced:

| Executable | Description |
|---|---|
| `gseurat_demo` | Island demo with visual effects, scene layers, and chunk streaming |
| `gseurat_staging` | ImGui-based rendering review with live scene preview and gizmos |
| `ply2heightmap` | Convert Gaussian-splat PLY point clouds to 16-bit heightmap PNGs |

```bash
# Run with default island scene
./build/macos-release/gseurat_demo

# Run with a custom scene
./build/macos-release/gseurat_demo --scene examples/island_demo/assets/scenes/my_scene.json

# Generate a heightmap from a PLY point cloud
./build/macos-release/ply2heightmap assets/maps/map.ply terrain_heightmap.png --ppu 2.0
```

## Architecture

### Renderer Flow

```
Offscreen HDR (RGBA16F) -> Bloom -> DoF -> Composite (tone mapping + vignette)
```

Draw order: GS compute -> GS blit -> backgrounds -> tilemap -> reflections -> shadows -> outlines -> entities -> particles -> overlay. UI is rendered in the composite pass (unprocessed).

### 3D Gaussian Splatting

```
PLY file -> GaussianCloud -> GsRenderer (compute) -> Storage Image -> Fullscreen Blit
```

Compute passes before the main render pass:

0. **PBD Solver** (optional) — GPU-driven Position Based Dynamics physics solver: Verlet integration, distance constraint projection, ground collision. Writes position + rotation deltas
1. **Preprocess** — project 3D Gaussians to 2D, frustum cull, compute 2D covariance (reads PBD + bone transforms)
2. **Tile Binning** — assign projected Gaussians to overlapping 16x16 tiles with sort keys
3. **Tile Sort** — Onesweep radix sort (decoupled lookback) or fallback 4-pass radix sort
4. **Tile Rasterizer** — per-tile front-to-back alpha blending into HDR storage image

Output is sampled with nearest-neighbor filtering for stylized upscale.

**GSVX Binary Format:**

`.gsvx` is GSeurat's native pre-baked binary format for Gaussian Splatting data. Unlike raw `.ply` files, GSVX stores GPU-ready `GpuGaussian` structs that can be uploaded directly to the GPU with zero parsing overhead.

| Field | V1 (32 B) | V2 (64 B) |
|-------|-----------|-----------|
| Magic | `GSVX` | `GSVX` |
| Version | 1 | 2 |
| Count | Gaussian count | Gaussian count |
| Flags | Reserved | Reserved |
| AABB min/max | — (computed at load) | Baked float[3]+float[3] |
| Reserved | — | 24 bytes padding |
| Payload | `GpuGaussian[]` | `GpuGaussian[]` |

V2 embeds the axis-aligned bounding box directly in the header, enabling zero-parse bounds retrieval for frustum culling and streaming decisions. The Python cooker (`scripts/ply_to_gseurat.py`) converts `.ply` files to GSVX v2. The engine loads both v1 and v2 transparently.

**Tile Sort — Onesweep Radix Sort:**

The tile sort uses a 2-dispatch Onesweep algorithm with decoupled lookback for cross-workgroup prefix sums. Each 8-bit radix pass is split into two dispatches:

1. `gs_onesweep_histogram.comp` — builds per-workgroup histogram, then uses decoupled lookback (spin-read with `LOCAL`/`INCLUSIVE` flags) to compute per-digit inclusive prefix across all workgroups. Results are published to a coherent status buffer.
2. `gs_onesweep_scatter.comp` — reads the status buffer (no spinning required — dispatch boundary guarantees all writes are visible), derives global exclusive prefix and per-workgroup aggregates, then performs a stable scatter with intra-workgroup ranking.

4 passes (32-bit key, 8 bits per pass) = 8 sort dispatches + ~9 barriers. A fallback 4-pass radix sort (histogram + scan + scatter = 12 dispatches, ~16 barriers) is available via `use_onesweep_` toggle.

**Benchmark (AMD RX 6600M, release, 2.4M splat overworld, 524K tile entries):**

| | Old 4-pass Sort | 2-dispatch Onesweep | Speedup |
|---|---|---|---|
| Sort (close-up) | 5.1 ms | 1.0 ms | **5x** |
| Sort (medium) | 4.7 ms | 0.9 ms | **5x** |
| Sort (far) | 4.9 ms | 0.4 ms | **11x** |
| Total pipeline (close-up) | 10.7 ms | 6.2 ms | **1.7x** |

**Performance optimizations:**
- **Onesweep tile sort** — 5x faster tile sort via decoupled lookback, scales with visible count
- Render early termination on first culled Gaussian (sorted order)
- Visible count via atomic counter (preprocess SSBO)
- Spatial chunk grid (`GsChunkGrid`) with frustum culling
- Clip-space `frustum_visible()` pre-pass — culled splats get `0xFFFF` sort key, reducing radix sort by 50-75%
- CPU-side LOD decimation with adaptive budget (converge-and-lock targeting 30 FPS)
- Hybrid re-render: full compute every Nth frame, cached blit with 2D offset between
- Async chunk streaming (`GsChunkStreamer`) for open-world scale maps
- **GPU timestamp profiling** — sort and rasterize times reported separately every 60 frames

### Game Object System

Everything in the scene is a **Game Object** — a unified entity with position, rotation, scale, optional PLY visual, and zero or more **components** from a schema catalog.

- **Component schemas** (`examples/island_demo/assets/components/*.schema.json`) define data shapes — Bricklayer auto-generates property editors from them
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

### Scene Transitions

Portals and cross-scene transitions are driven by a **transient-entity state machine** on the existing ECS. When a `ProximityTrigger + PortalTarget` pair fires, `portal_trigger_handler` spawns an entity with `SceneTransition + ScreenFade` components. `transition_system` advances `SceneOut → Loading → SceneIn`, issues a single atomic `host.transition_scene()` call under a fully-opaque overlay, and destroys the entity on completion.

PLY parsing for the destination scene runs on a worker thread (`std::async`) via `AppBase::begin_async_load_gs_scene`; the main thread keeps rendering the loading overlay while `tick_async_load_gs_scene` non-blockingly polls the future, then performs the GPU/ECS finalize. `ITransitionHost::is_async_loading()` lets the state machine pin the SceneIn fade at alpha=1.0 until the load completes, so the fade-in only starts once the new scene is fully ready.

Visuals are decoupled from the state machine — the post-process compute shader branches on `effect_type` to select between solid fade, left-to-right wipe, and iris wipe (aspect-corrected circle). Adding a new effect is a single-file shader change plus a schema bump.

See [docs/scene-transitions.md](docs/scene-transitions.md) for the full architecture, components, effects reference, authoring workflow, and extension guide.

### Async Asset Streaming

Two-tier streaming architecture for open-world support:

**Tier 1 — Slab Allocator + GPU Page Table:**
All GPU memory for Gaussians is allocated once at startup as a configurable budget (default 10M splats / 640 MB). Fixed-size slabs (100K splats each) are managed by a free-list allocator with non-contiguous allocation — zero external fragmentation by construction. A GPU-side page table SSBO maps logical splat indices to physical slab offsets; the preprocess shader resolves indices via `resolve_physical_index()`.

**Tier 2 — Transfer Queue:**
Dedicated Vulkan transfer queue (falls back to time-sliced graphics queue on MoltenVK). Background threads parse PLY files and stage data to a double-buffered ring buffer. `VkFence`-based polling drives completion on the main thread — the graphics queue never stalls.

```
Main Thread                     Worker Thread (std::thread)
-----------------               ----------------------------
load_cloud_async() ---------->  Parse PLY -> GpuGaussian
poll_transfers()                Stage to ring buffer
  vkGetFenceStatus <-- fence -- vkCmdCopyBuffer to slab
  page table update             enqueue completion marker
  chunk appears next frame
```

| Component | Description |
|---|---|
| `SlabAllocator` | Non-contiguous slab checkout/release with double-free protection |
| `TransferQueue` | Dedicated/fallback transfer paths with staging ring buffer |
| `GsChunkStreamer` | Distance-based chunk streaming with hysteresis and memory budget |

**Tier 3 — World Manifest (`world.json`):**
Spatial partitioning for vast open-world maps. A `world.json` file defines a fixed uniform grid of chunks, each referencing a PLY file and optional per-chunk scene JSON. The engine derives AABBs from grid position for O(1) camera-to-chunk lookups.

**Chunks vs Instances:** Chunks are spatial PLY tiles in a global coordinate system — loaded/unloaded by camera distance, rendered simultaneously. Instances are isolated rooms in their own local coordinate system — entered via Portals. StreamingVolumes are trigger zones that hint the async transfer queue to preload targets before the player reaches them.

### 3D Collision System

Primitive collider system backed by a static BVH, replacing the legacy 2D CollisionGrid for character physics.

**Collider types:**
- `BoxData` — axis-aligned box with half-extents
- `SphereData` — sphere with radius
- `CapsuleData` — capsule with radius + half-height (oriented along Y axis)
- `HeightfieldComponent` — 16-bit PNG grayscale terrain with bilinear sampling and triangle-based sweep

**Architecture:** Hybrid ECS + cached CollisionWorld. `ColliderComponent` is an ECS component for serialization and inspector support. `CollisionSystem` maintains packed `ColliderInstance` caches (static and dynamic), a `HeightfieldInstance` cache, and rebuilds a static BVH for broadphase acceleration.

**Queries:**
- `sweep()` — capsule sweep against static geometry and heightfields (continuous collision detection for KCC)
- `overlap_aabb()` — broadphase AABB overlap query
- `raycast()` — ray intersection with distance-sorted results

**Kinematic Character Controller (KCC):** 7-step per-frame pipeline: depenetration → gravity → horizontal sweep → wall slide → vertical sweep → ground probe → write-back. The depenetration step resolves capsule-terrain overlap on spawn/teleport (prevents the "stuck player" bug when authored Y coordinates don't account for capsule dimensions). Configurable ground angle threshold, skin width, and slide iterations.

**Heightmap pipeline:** The `ply2heightmap` CLI converts Gaussian-splat PLY point clouds to 16-bit heightmaps via AABB splatting — each splat's oriented bounding box is projected onto an XZ grid with conservative max-Y fill. Output PNGs plug directly into `HeightfieldComponent`.

### Camera Pipeline

5-mode camera system with spatial zone resolution, virtual camera evaluation, smooth blending, and constraint clamping.

**Camera modes:**
| Mode | Description |
|------|-------------|
| `free_look` | Default orbit camera with mouse-driven azimuth/elevation |
| `rail_follow` | Position-projected nearest-t on a Catmull-Rom spline |
| `cinematic_rail` | Time-driven spline playback with easing and playback modes |
| `fixed_point` | Static camera at a fixed world position |
| `side_scroll` | 2D side-view camera |

**Cinematic rail** supports four playback modes (`once`, `loop`, `ping_pong`, `manual`) and three target modes (`player`, `target_path`, `fixed_point`). Easing reuses the 30+ curve `GsEasing` enum. Duration, easing, and `play_on_enter` are configured per CameraVolume in scene JSON.

**Zone priority resolution:** Manual zones (priority > 0) always beat auto zones. Among manual zones, highest priority wins; among auto zones, smallest volume wins. Tie-break by entity ID.

**Pipeline stages:**
1. **ZoneResolver** — pick active CameraVolume from player position (AABB/sphere containment)
2. **VCamEvaluator** — evaluate camera state for the active zone's mode
3. **Blending** — smoothstep blend between old and new camera states on zone transitions
4. **Constraints** — clamp camera within volume bounds

### Audio Engine

Lock-free interactive music engine with per-stem DSP effects and spatial SFX. See [docs/audio-engine.md](docs/audio-engine.md) for the full reference.

```
Game Thread                    Audio Thread              Decode Thread
──────────────                 ──────────────────────     ─────────────────
play_group(id)  ──SPSC queue──>  Mixer::render()          AudioStreamManager
set_rtpc(id,v)  ──atomic bus──>    ├─ drain commands         └─ refill ring
set_listener()  ──atomic xyz──>    ├─ apply RTPC bindings       buffers from
                                   ├─ render TrackGroups        Ogg decoder
                                   │    └─ source → fx → sum
                                   └─ render OneshotVoices
```

**Key components:**
- **TrackGroups** — multi-stem music with sample-accurate looping, marker-aligned transitions, and crossfading
- **RTPC** — game variables mapped to stem volume or DSP effect parameters via atomic bus
- **StateVariableFilter** — TPT/Zavalishin SVF (LPF/HPF/BPF) with block-rate coefficient update
- **OneshotVoice pool** — fire-and-forget SFX with auto-free, spatial distance attenuation for looping ambient sounds
- **Ogg Vorbis streaming** — background decode thread with lock-free ring buffer, seamless looping, hard seek support
- **Format auto-detection** — WAV (`RIFF`), `.gsaudio` (`GSAU`), Ogg Vorbis (`OggS`) — transparent to the mixer

### Voxel Character Pipeline

Characters are authored as voxel body parts, exported as Gaussians with per-splat bone indices, and animated via GPU bone transforms.

```
MagicaVoxel (.vox) -> Echidna (edit parts/joints/poses) -> PLY + manifest JSON
                                                                 |
Engine: PLY load -> bone_index per Gaussian -> preprocess shader -> skeletal skinning
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
- Preprocess shader applies `mat4` per bone or PBD quaternion rotation per element
- Rigid body part animation (action-figure style, no smooth skinning)

**Root Motion:**
- Animation-driven world-space movement — walk cycles, dodge rolls, and lunges move the actor
- Per-pose `root_position` offset + per-clip `root_motion` opt-in flag in character manifests
- `BoneAnimationPlayer` extracts per-frame position/rotation deltas with loop-aware math

## AI Debugging via Control Server

The engine exposes a Unix domain socket at `/tmp/gseurat.sock` (Named Pipes on Windows) for external control. AI agents can send commands, step deterministically, and capture screenshots.

```bash
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
| `sync_camera` | `source`, `position`, `target` | Apply external camera and broadcast to subscribers |
| `subscribe` | `events` | Subscribe to event types (e.g. `["camera_sync"]`) |
| `unsubscribe` | — | Unsubscribe from all events |

</details>

## Creative Tooling

The `tools/` directory contains web-based creative tools connected to the engine via a WebSocket bridge proxy.

```
Engine (Vulkan) <-> Unix Socket <-> Bridge Proxy (ws://localhost:9100) <-> Web Tools
```

| Tool | Port | Description |
|------|------|-------------|
| **Bridge Proxy** | 9100/9101 | Node.js relay between Unix socket and WebSocket clients |
| **Bricklayer** | 5180 | 3DGS map editor: voxel terrain, Game Objects with component composition, PBD physics, emitters, animations, VFX, lights, portals, instances, WORLD mode |
| **Melies** | 5181 | VFX editor: particle emitters, GS animations, spline paths, object layers, light layers |
| **Echidna** | 5179 | Voxel character editor: .vox import, body parts, bone posing, PLY export |
| **Staging** | C++ app | ImGui rendering review: live scene preview, gizmos, bridge auto-sync |

```bash
# Prerequisites: Node.js 18+, pnpm
cd tools && pnpm install

# Start the bridge (requires running engine)
cd tools/apps/bridge && pnpm build && pnpm start

# Start a tool
cd tools/apps/bricklayer && pnpm dev
```

### Live Camera Sync

Bricklayer and Staging support bidirectional camera sync over the WebSocket bridge. When the **Camera Lock** toggle is active in Bricklayer:

- Orbiting in Bricklayer sends camera position/target to Staging at 60 Hz
- Camera movement in Staging broadcasts `camera_sync` events back to Bricklayer at 30 Hz
- Echo suppression via `source` field prevents infinite feedback loops
- The engine's `camera_sync_override` flag temporarily suppresses CameraZoneSystem evaluation during external sync

## Testing

### C++ Engine Tests

All test suites are CMake targets, run via `ctest`:

```bash
cmake --preset <platform>-debug
cmake --build --preset <platform>-debug
ctest --test-dir build/<platform>-debug --output-on-failure
```

### TypeScript Tool Tests

```bash
cd tools && pnpm install
pnpm --filter @gseurat/tests test:echidna-ply-export
```

### CI

GitHub Actions runs three parallel jobs on every push/PR to main:
- **Build** — C++ engine on Linux, Windows, macOS
- **Test (C++)** — Engine test suites via ctest (ubuntu)
- **Test (TypeScript)** — Tool tests via pnpm (ubuntu)

## GS Demo Controls

| Key | Action |
|---|---|
| Mouse drag | Orbit camera |
| Scroll | Zoom |
| WASD | Pan |
| M | Toggle streaming mode |
| P | Toggle shadow box (parallax) mode |
| T/L/F/G/X | Toon / Light / Fire / Water / Touch |
| E/V/H/Y/C/B | Explode / Voxel / Pulse / X-Ray / Swirl / Burn |
| J | Toggle chain demo (PBD) |
| K | Toggle character demo |
| N | Toggle scene layers |

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
