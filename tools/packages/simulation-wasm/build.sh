#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$SCRIPT_DIR/../.."
SRC_DIR="$ROOT_DIR/.."

# Find GLM include path
GLM_DIR=""
for d in "$SRC_DIR/build/macos-debug/_deps/glm-src" \
         "$SRC_DIR/build/macos-release/_deps/glm-src" \
         "/opt/homebrew/include"; do
    if [ -d "$d/glm" ]; then
        GLM_DIR="$d"
        break
    fi
done

if [ -z "$GLM_DIR" ]; then
    echo "ERROR: GLM not found. Run 'cmake --build --preset macos-debug' first to fetch GLM."
    exit 1
fi

echo "Building WASM simulation module..."
echo "  GLM: $GLM_DIR"
echo "  Source: $SRC_DIR/src/engine/"

mkdir -p "$SCRIPT_DIR/dist"

em++ -std=c++23 \
    -I"$SRC_DIR/include" \
    -I"$GLM_DIR" \
    -O2 \
    -s WASM=1 \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s MODULARIZE=1 \
    -s EXPORT_ES6=1 \
    -s EXPORTED_RUNTIME_METHODS='["UTF8ToString"]' \
    --bind \
    "$SCRIPT_DIR/bindings.cpp" \
    "$SRC_DIR/src/engine/gs_particle.cpp" \
    "$SRC_DIR/src/engine/gs_animator.cpp" \
    -o "$SCRIPT_DIR/dist/simulation.mjs"

echo "Built: dist/simulation.mjs + dist/simulation.wasm"
echo "Size: $(du -h "$SCRIPT_DIR/dist/simulation.wasm" | cut -f1)"
