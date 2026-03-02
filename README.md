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

## Project Structure

```
src/            C++ source files
include/        Public headers
shaders/        GLSL shaders (compiled to SPIR-V at build time)
assets/         Game assets (copied to build directory)
.devcontainer/  Container development environment
```
