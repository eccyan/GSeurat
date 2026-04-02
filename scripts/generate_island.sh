#!/bin/bash
set -e
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPTS_DIR")"
cd "$ROOT_DIR"
echo "Generating island terrain..."
python3 "$SCRIPTS_DIR/generate_island_terrain.py"
echo "Generating island props..."
python3 "$SCRIPTS_DIR/generate_island_props.py"
echo "Generating scene JSON..."
python3 "$SCRIPTS_DIR/generate_demo_scene.py"
echo "Done! Scene: assets/scenes/seurat_island.json"
