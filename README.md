# Vulkan Game

A Vulkan-based game built with C++23, GLFW, and glm.

## Prerequisites

- CMake 3.25+
- Ninja
- Vulkan SDK 1.3+
- A Vulkan-capable GPU and driver

### macOS

Install the [Vulkan SDK](https://vulkan.lunarg.com/sdk/home) (includes MoltenVK).

### Linux

```bash
# Fedora
sudo dnf install vulkan-headers vulkan-loader-devel vulkan-tools \
    vulkan-validation-layers-devel mesa-vulkan-drivers glslc

# Ubuntu/Debian
sudo apt install vulkan-tools libvulkan-dev vulkan-validationlayers-dev \
    spirv-tools glslc
```

### Windows

Install the [Vulkan SDK](https://vulkan.lunarg.com/sdk/home).

## Building

```bash
# Configure (automatically selects platform preset)
cmake --preset <platform>-debug    # linux-debug, macos-debug, windows-debug
cmake --preset <platform>-release  # linux-release, macos-release, windows-release

# Build
cmake --build --preset <platform>-debug
cmake --build --preset <platform>-release
```

The executable is output to `build/<preset>/vulkan_game`.

## Dev Container (Podman + krunkit)

For M-series Macs with GPU remoting via krunkit:

```bash
# Build the container
podman build -t vulkan-dev -f .devcontainer/Dockerfile .

# Run with GPU access
podman run --rm -it \
    --device /dev/dri \
    -v "$PWD":/workspace:Z \
    --workdir /workspace \
    vulkan-dev bash

# Inside the container
cmake --preset linux-debug
cmake --build --preset linux-debug
```

## AI Debugging via Control Server

The game exposes a Unix domain socket at `/tmp/vulkan_game.sock` for external control. AI agents (Claude Code, etc.) can send commands, step the game deterministically, and capture screenshots to visually inspect rendering — all without human interaction.

### Quick Start

```bash
# 1. Build and launch the game
cmake --build --preset macos-debug
cd build/macos-debug && ./vulkan_game &

# 2. Connect and send commands (Python example)
python3 -c "
import socket, json

s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect('/tmp/vulkan_game.sock')

def send(cmd):
    s.sendall(json.dumps(cmd).encode() + b'\n')
    return json.loads(s.recv(4096).decode())

# Switch to deterministic step mode
print(send({'cmd': 'set_mode', 'mode': 'step'}))

# Move player right for 30 frames (~0.5s)
send({'cmd': 'move', 'direction': 'right'})
print(send({'cmd': 'step', 'frames': 30}))

# Stop and capture a screenshot
send({'cmd': 'stop'})
send({'cmd': 'step', 'frames': 1})
print(send({'cmd': 'screenshot', 'path': '/tmp/debug.png'}))

s.close()
"
```

### Protocol

All communication uses JSON Lines (one JSON object per line) over the Unix socket.

#### Commands

| Command | Payload | Description |
|---------|---------|-------------|
| `get_state` | — | Returns player/NPC positions, facing, animation, dialog state, tick count |
| `get_map` | — | Returns tilemap data (dimensions, tiles, solid flags) |
| `move` | `direction`: `"up"/"down"/"left"/"right"`, `sprint`: bool | Inject movement input |
| `stop` | — | Clear all injected inputs |
| `interact` | — | Press the interact key (E) for one frame |
| `set_mode` | `mode`: `"step"/"realtime"` | Switch between deterministic and real-time modes |
| `step` | `frames`: int (1-600) | Advance N frames at fixed 1/60s dt (step mode only) |
| `screenshot` | `path`: string | Capture current frame to PNG file |

#### Responses

```jsonc
// State (from get_state or after step)
{"type": "state", "tick": 42, "game_mode": "explore",
 "player": {"x": 3.5, "y": 2.0, "direction": "down", "animation": "idle_down"},
 "npcs": [{"index": 0, "x": 5.0, "y": 3.0, "direction": "left"}]}

// Screenshot
{"type": "screenshot", "path": "/tmp/debug.png", "width": 2560, "height": 1440}

// Events (emitted automatically)
{"type": "dialog_started", "speaker_key": "npc_guard", "text_key": "guard_greeting"}
{"type": "dialog_advanced", "line": 1}
{"type": "dialog_ended"}

// Errors
{"type": "error", "message": "not in step mode"}
```

### Debugging Workflow for AI Agents

The recommended loop for AI-driven visual debugging:

1. **Launch** the game in the background
2. **Connect** to `/tmp/vulkan_game.sock`
3. **Switch to step mode** — game pauses, frames advance only on `step` commands
4. **Send commands** (move, interact, step) to reproduce the issue
5. **Capture screenshot** — read the PNG to visually inspect rendering
6. **Inspect state** via `get_state` / `get_map` for numerical verification
7. **Iterate** — make code changes, rebuild, relaunch, repeat

Step mode ensures deterministic reproduction: the same sequence of commands always produces the same game state, regardless of wall-clock timing.

### Notes

- The socket auto-cleans stale files on startup
- Only one client connection at a time
- Client disconnect automatically reverts to real-time mode
- Screenshot dimensions reflect the actual framebuffer (e.g., 2560x1440 on Retina, 1280x720 otherwise)
- Screenshots capture the final composited frame including post-processing (bloom, DoF, vignette, fog)

## Project Structure

```
src/            C++ source files
include/        Public headers
shaders/        GLSL shaders (compiled to SPIR-V at build time)
assets/         Game assets (copied to build directory)
.devcontainer/  Container development environment
```
