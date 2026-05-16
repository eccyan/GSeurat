#!/usr/bin/env python3
"""Tests for validate_gsvx_in_sync.py.

Run with:
    python3 scripts/test_validate_gsvx_in_sync.py
"""

import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path

_script_dir = os.path.dirname(os.path.abspath(__file__))
if _script_dir not in sys.path:
    sys.path.insert(0, _script_dir)

import validate_gsvx_in_sync as validator  # noqa: E402

passed = 0
failed = 0


def check(condition, label):
    global passed, failed
    if condition:
        passed += 1
        print(f"  PASS  {label}")
    else:
        failed += 1
        print(f"  FAIL  {label}")


def make_layout(tmp: Path, pairs: list[tuple[str, bytes, bytes | None]]):
    """Create .ply files (and optional .gsvx siblings) under `tmp`.

    pairs: list of (relative_path, ply_bytes, gsvx_bytes_or_None).
    Returns (assets_root, manifest_path) — manifest is NOT pre-populated.
    """
    assets = tmp / "assets"
    assets.mkdir()
    for rel, ply_bytes, gsvx_bytes in pairs:
        ply = assets / rel
        ply.parent.mkdir(parents=True, exist_ok=True)
        ply.write_bytes(ply_bytes)
        if gsvx_bytes is not None:
            ply.with_suffix(".gsvx").write_bytes(gsvx_bytes)
    return assets, assets / "gsvx_sync_manifest.json"


# ---------------------------------------------------------------------------
# Validator passes when manifest + .gsvx match
# ---------------------------------------------------------------------------
print("\nvalidate — happy path")
with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)
    ply_bytes = b"binary ply payload"
    assets, manifest_path = make_layout(tmp, [("a.ply", ply_bytes, b"GSVX...")])
    manifest_path.write_text(json.dumps({
        "version": 1,
        "entries": {"a.ply": hashlib.sha256(ply_bytes).hexdigest()},
    }))
    errors = validator.validate(assets, manifest_path)
    check(errors == [], f"happy path returns no errors (got {errors})")


# ---------------------------------------------------------------------------
# Missing .gsvx is an error
# ---------------------------------------------------------------------------
print("\nvalidate — missing .gsvx")
with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)
    ply_bytes = b"another ply"
    assets, manifest_path = make_layout(tmp, [("b.ply", ply_bytes, None)])
    manifest_path.write_text(json.dumps({
        "version": 1,
        "entries": {"b.ply": hashlib.sha256(ply_bytes).hexdigest()},
    }))
    errors = validator.validate(assets, manifest_path)
    check(any("b.gsvx" in e for e in errors),
          f"flags missing .gsvx sibling (got {errors})")


# ---------------------------------------------------------------------------
# Hash mismatch is an error
# ---------------------------------------------------------------------------
print("\nvalidate — hash mismatch")
with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)
    ply_bytes = b"current bytes"
    assets, manifest_path = make_layout(tmp, [("c.ply", ply_bytes, b"GSVX...")])
    manifest_path.write_text(json.dumps({
        "version": 1,
        "entries": {"c.ply": "0" * 64},  # wrong hash
    }))
    errors = validator.validate(assets, manifest_path)
    check(any("c.ply" in e and "hash" in e.lower() for e in errors),
          f"flags hash mismatch (got {errors})")


# ---------------------------------------------------------------------------
# Manifest missing an entry for a real .ply is an error
# ---------------------------------------------------------------------------
print("\nvalidate — manifest missing entry")
with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)
    ply_bytes = b"orphan ply"
    assets, manifest_path = make_layout(tmp, [("d.ply", ply_bytes, b"GSVX...")])
    manifest_path.write_text(json.dumps({"version": 1, "entries": {}}))
    errors = validator.validate(assets, manifest_path)
    check(any("d.ply" in e and ("manifest" in e.lower() or "entry" in e.lower())
              for e in errors),
          f"flags missing manifest entry (got {errors})")


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
total = passed + failed
print(f"\n{'='*40}")
print(f"Results: {passed}/{total} passed", end="")
if failed > 0:
    print(f"  ({failed} FAILED)")
else:
    print("  ALL PASS")
print('='*40)

sys.exit(0 if failed == 0 else 1)
