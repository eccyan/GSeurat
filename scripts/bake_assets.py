#!/usr/bin/env python3
"""Bake PLY assets to runtime-ready GSVX format.

Walks examples/island_demo/assets/**/*.ply, runs tools/ply_importer/ply_importer
on each, writes <asset>.gsvx siblings, and updates
examples/island_demo/assets/gsvx_sync_manifest.json with the SHA256 of each
source .ply.

Usage:
    python3 scripts/bake_assets.py [--force] [--build-dir <path>]

Skip-up-to-date: bake only if .ply mtime > .gsvx mtime, or .gsvx is missing,
or --force.
"""

import hashlib
import json
from pathlib import Path


def sha256_file(path: Path) -> str:
    """Return hex SHA256 of the bytes of `path`."""
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def load_manifest(path: Path) -> dict:
    """Load the GSVX sync manifest, or return an empty schema if missing."""
    if not path.exists():
        return {"version": 1, "entries": {}}
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_manifest(path: Path, manifest: dict) -> None:
    """Write manifest with entries sorted by key for stable diffs."""
    out = {
        "version": manifest.get("version", 1),
        "entries": dict(sorted(manifest.get("entries", {}).items())),
    }
    with path.open("w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
        f.write("\n")
