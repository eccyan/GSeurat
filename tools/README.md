# Creative Tooling Ecosystem

External web-based creative tools for the vulkan-game engine. Designers author tilesets, levels, animations, particles, music, and SFX through browser-based editors that communicate with the running engine via WebSocket.

## Architecture

```
[Engine / Vulkan Window]
       |
   Unix Socket (/tmp/vulkan_game.sock)
       |
[Bridge Proxy (Node.js :9100)]  <-->  WebSocket
    |       |       |       |       |       |
 Level   Pixel   Anim   Particle  Audio   SFX
 :5173   :5174   :5175   :5176   :5177   :5178
    |
 HTTP to local AI servers
  - Ollama      (localhost:11434) -- LLM
  - ComfyUI     (localhost:8188) -- Stable Diffusion
  - AudioCraft  (localhost:8001) -- MusicGen / SFX
```

Each tool app connects to the bridge proxy over WebSocket. The bridge relays JSON commands to the engine over the Unix domain socket established by Phase 14's `ControlServer`. AI services are optional and each tool degrades gracefully when they are unavailable.

## Prerequisites

- Node.js 20+
- pnpm 9+
- A running build of `vulkan_game` (see root CMakeLists.txt)

## Quick Start

```bash
# From the project root:
cd tools && pnpm install && pnpm build

# Terminal 1: start the game engine (from project root)
./build/macos-debug/vulkan_game

# Terminal 2: start the bridge proxy
cd tools/apps/bridge && pnpm start

# Terminal 3: start any tool (example: level designer)
cd tools/apps/level-designer && pnpm dev
```

Each tool prints its local URL after startup.

## Monorepo Structure

```
tools/
  packages/          # shared libraries
  apps/              # runnable tool applications
  package.json       # root workspace config
  pnpm-workspace.yaml
  tsconfig.base.json
```

### Packages

| Package | Port | Description |
|---|---|---|
| `packages/engine-client` | — | WebSocket client with typed command/event API for all engine control server messages |
| `packages/asset-types` | — | Shared TypeScript types for scenes, tilesets, animations, particles, audio configs |
| `packages/ai-providers` | — | Unified async interface to Ollama, ComfyUI, and AudioCraft with availability detection |
| `packages/ui-kit` | — | Shared React components: canvas, timeline, color picker, property panel, toolbar |

### Apps

| App | Dev Port | Description |
|---|---|---|
| `apps/bridge` | 9100 / 9101 | Unix socket to WebSocket bridge and REST file API |
| `apps/level-designer` | 5173 | Tile painting, NPC/light/portal placement, live engine sync |
| `apps/pixel-painter` | 5174 | 16x16 pixel art editor for tiles and sprite sheets |
| `apps/keyframe-animator` | 5175 | Animation clip and state machine editor |
| `apps/particle-designer` | 5176 | Visual EmitterConfig editor with canvas simulation |
| `apps/audio-composer` | 5177 | 4-layer interactive music editor and WAV exporter |
| `apps/sfx-designer` | 5178 | Procedural SFX synthesis and waveform editor |

## Shared Packages

**engine-client** wraps the bridge WebSocket and exposes typed async methods such as `getState()`, `move()`, `interact()`, `setTime()`, `screenshot()`, and a subscribe API for engine events (`dialog_started`, `dialog_ended`, etc.).

**asset-types** defines the canonical TypeScript interfaces that mirror the C++ structs: `SceneData`, `TileLayer`, `PortalData`, `EmitterConfig`, `AnimationClip`, `MusicState`, `DayNightKeyframe`, and so on. All tools import from this package to keep serialization consistent with what the engine expects.

**ai-providers** exports three provider classes — `OllamaProvider`, `ComfyUIProvider`, `AudioCraftProvider` — each with a static `isAvailable()` check. Tools call `isAvailable()` before showing AI generation UI so the feature is silently hidden rather than broken when a service is not running.

**ui-kit** contains framework-level React components reused across tools: `PixelCanvas`, `Timeline`, `HSVPicker`, `PropertyPanel`, `Toolbar`, `NodeGraph`, and `WaveformView`.

## Optional AI Services

Tools function fully without any AI backend. AI features appear only when the corresponding service is reachable.

| Service | Default URL | Feature |
|---|---|---|
| Ollama | `localhost:11434` | LLM prompt-to-config for levels, animations, particles |
| ComfyUI | `localhost:8188` | Stable Diffusion pixel art generation in Pixel Painter |
| AudioCraft | `localhost:8001` | MusicGen layer generation and SFX synthesis |

## Development

```bash
# Run all type checks
pnpm typecheck

# Run all unit tests
pnpm test

# Build all packages and apps
pnpm build

# Start all tool dev servers simultaneously
pnpm dev
```
