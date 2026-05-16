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


def entry(ply_bytes: bytes, gsvx_bytes: bytes) -> dict:
    return {
        "ply_sha256": hashlib.sha256(ply_bytes).hexdigest(),
        "gsvx_sha256": hashlib.sha256(gsvx_bytes).hexdigest(),
    }


# ---------------------------------------------------------------------------
# Validator passes when manifest + .gsvx + .ply all match
# ---------------------------------------------------------------------------
print("\nvalidate — happy path")
with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)
    ply_bytes = b"binary ply payload"
    gsvx_bytes = b"GSVX..."
    assets, manifest_path = make_layout(tmp, [("a.ply", ply_bytes, gsvx_bytes)])
    manifest_path.write_text(json.dumps({
        "version": 2,
        "entries": {"a.ply": entry(ply_bytes, gsvx_bytes)},
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
        "version": 2,
        "entries": {"b.ply": entry(ply_bytes, b"unused")},
    }))
    errors = validator.validate(assets, manifest_path)
    check(any("b.gsvx" in e for e in errors),
          f"flags missing .gsvx sibling (got {errors})")


# ---------------------------------------------------------------------------
# .ply hash mismatch is an error
# ---------------------------------------------------------------------------
print("\nvalidate — .ply hash mismatch")
with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)
    ply_bytes = b"current bytes"
    gsvx_bytes = b"GSVX..."
    assets, manifest_path = make_layout(tmp, [("c.ply", ply_bytes, gsvx_bytes)])
    # Record wrong ply_sha256; gsvx_sha256 is correct.
    manifest_path.write_text(json.dumps({
        "version": 2,
        "entries": {"c.ply": {
            "ply_sha256": "0" * 64,
            "gsvx_sha256": hashlib.sha256(gsvx_bytes).hexdigest(),
        }},
    }))
    errors = validator.validate(assets, manifest_path)
    check(any("c.ply" in e and ".ply hash" in e for e in errors),
          f"flags .ply hash mismatch (got {errors})")


# ---------------------------------------------------------------------------
# .gsvx hash mismatch is an error (Codex P2#2 — revert/edit/corruption)
# ---------------------------------------------------------------------------
print("\nvalidate — .gsvx hash mismatch")
with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)
    ply_bytes = b"unchanged ply"
    gsvx_bytes = b"baked output"
    assets, manifest_path = make_layout(tmp, [("e.ply", ply_bytes, gsvx_bytes)])
    # Record correct ply_sha256 but a stale (different) gsvx_sha256 — simulates a
    # .gsvx that was reverted/edited/corrupted while the .ply stayed fixed.
    manifest_path.write_text(json.dumps({
        "version": 2,
        "entries": {"e.ply": {
            "ply_sha256": hashlib.sha256(ply_bytes).hexdigest(),
            "gsvx_sha256": "f" * 64,
        }},
    }))
    errors = validator.validate(assets, manifest_path)
    check(any("e.ply" in e and ".gsvx hash" in e for e in errors),
          f"flags .gsvx hash mismatch (got {errors})")


# ---------------------------------------------------------------------------
# Manifest missing an entry for a real .ply is an error
# ---------------------------------------------------------------------------
print("\nvalidate — manifest missing entry")
with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)
    ply_bytes = b"orphan ply"
    assets, manifest_path = make_layout(tmp, [("d.ply", ply_bytes, b"GSVX...")])
    manifest_path.write_text(json.dumps({"version": 2, "entries": {}}))
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
