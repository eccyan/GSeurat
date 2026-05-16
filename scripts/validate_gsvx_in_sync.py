#!/usr/bin/env python3
"""Verify every committed .ply / .gsvx pair matches the manifest.

Reads examples/island_demo/assets/gsvx_sync_manifest.json (schema v2) and
confirms, for every .ply under that tree:
  1. A sibling .gsvx exists.
  2. The manifest has an entry for the .ply (keyed by repo-relative path).
  3. SHA256 of the .ply matches `recorded.ply_sha256`.
  4. SHA256 of the .gsvx matches `recorded.gsvx_sha256`.

Step 4 closes the hole where a .gsvx is modified, reverted, or corrupted
without changing the .ply — the engine would happily load that stale
baked file, and a .ply-only check would not catch it.

Exit 0 if everything is consistent, exit 1 otherwise with a clear
description of each mismatch.

Usage:
    python3 scripts/validate_gsvx_in_sync.py
"""

import hashlib
import json
import sys
from pathlib import Path


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def validate(assets_root: Path, manifest_path: Path) -> list[str]:
    """Return a list of human-readable error strings — empty list means OK."""
    errors: list[str] = []

    if not manifest_path.exists():
        return [f"manifest not found: {manifest_path}"]

    with manifest_path.open("r", encoding="utf-8") as f:
        manifest = json.load(f)
    entries = manifest.get("entries", {})

    for ply in sorted(assets_root.rglob("*.ply")):
        rel = ply.relative_to(assets_root).as_posix()
        gsvx = ply.with_suffix(".gsvx")
        if not gsvx.exists():
            errors.append(
                f"{rel}: missing sibling {gsvx.name}. "
                "Run: python3 scripts/bake_assets.py"
            )
            continue
        recorded = entries.get(rel)
        if recorded is None:
            errors.append(
                f"{rel}: no manifest entry. "
                "Run: python3 scripts/bake_assets.py"
            )
            continue
        recorded_ply = recorded.get("ply_sha256")
        recorded_gsvx = recorded.get("gsvx_sha256")
        actual_ply = _sha256_file(ply)
        if actual_ply != recorded_ply:
            errors.append(
                f"{rel}: .ply hash mismatch "
                f"(manifest={(recorded_ply or '<missing>')[:16]}... "
                f"actual={actual_ply[:16]}...). "
                "Run: python3 scripts/bake_assets.py"
            )
            continue
        actual_gsvx = _sha256_file(gsvx)
        if actual_gsvx != recorded_gsvx:
            errors.append(
                f"{rel}: .gsvx hash mismatch "
                f"(manifest={(recorded_gsvx or '<missing>')[:16]}... "
                f"actual={actual_gsvx[:16]}...). "
                "Run: python3 scripts/bake_assets.py"
            )
    return errors


def main(argv: list[str] | None = None) -> int:
    repo_root = Path(__file__).resolve().parent.parent
    assets_root = repo_root / "examples" / "island_demo" / "assets"
    manifest_path = assets_root / "gsvx_sync_manifest.json"

    errors = validate(assets_root, manifest_path)
    if errors:
        sys.stderr.write("validate_gsvx_in_sync: drift detected\n")
        for e in errors:
            sys.stderr.write(f"  {e}\n")
        return 1
    print(f"validate_gsvx_in_sync: OK ({len(list(assets_root.rglob('*.ply')))} .ply files in sync)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
