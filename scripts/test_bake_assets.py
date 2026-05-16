#!/usr/bin/env python3
"""Tests for bake_assets.py.

Run with:
    python3 scripts/test_bake_assets.py
"""

import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

_script_dir = os.path.dirname(os.path.abspath(__file__))
if _script_dir not in sys.path:
    sys.path.insert(0, _script_dir)

import bake_assets  # noqa: E402

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


# ---------------------------------------------------------------------------
# sha256_file
# ---------------------------------------------------------------------------
print("\nsha256_file")
with tempfile.NamedTemporaryFile(delete=False) as f:
    f.write(b"hello world")
    tmp_path = Path(f.name)
try:
    expected = hashlib.sha256(b"hello world").hexdigest()
    got = bake_assets.sha256_file(tmp_path)
    check(got == expected, f"hashes 'hello world' bytes (got {got[:16]}...)")
finally:
    tmp_path.unlink()

# ---------------------------------------------------------------------------
# load_manifest / save_manifest
# ---------------------------------------------------------------------------
print("\nload_manifest / save_manifest")

V2_EMPTY = {"version": 2, "entries": {}}

# load_manifest returns an empty v2 schema when the file is missing
with tempfile.TemporaryDirectory() as tmp:
    missing = Path(tmp) / "nope.json"
    m = bake_assets.load_manifest(missing)
    check(m == V2_EMPTY, "missing manifest → empty v2 schema")

# load_manifest parses an existing v2 file
with tempfile.TemporaryDirectory() as tmp:
    path = Path(tmp) / "manifest.json"
    path.write_text(json.dumps({
        "version": 2,
        "entries": {"a.ply": {"ply_sha256": "abc", "gsvx_sha256": "def"}},
    }))
    m = bake_assets.load_manifest(path)
    check(m["entries"]["a.ply"]["ply_sha256"] == "abc",
          "load_manifest parses existing v2 entry (ply_sha256)")
    check(m["entries"]["a.ply"]["gsvx_sha256"] == "def",
          "load_manifest parses existing v2 entry (gsvx_sha256)")

# load_manifest drops entries from incompatible (e.g. v1) schemas, forcing a re-bake
with tempfile.TemporaryDirectory() as tmp:
    path = Path(tmp) / "manifest.json"
    path.write_text(json.dumps({"version": 1, "entries": {"a.ply": "legacy_hash"}}))
    m = bake_assets.load_manifest(path)
    check(m == V2_EMPTY, "load_manifest drops v1 entries (migration to v2)")

# save_manifest writes entries sorted by key, with trailing newline
with tempfile.TemporaryDirectory() as tmp:
    path = Path(tmp) / "manifest.json"
    bake_assets.save_manifest(
        path,
        {"version": 2, "entries": {
            "z.ply": {"ply_sha256": "zp", "gsvx_sha256": "zg"},
            "a.ply": {"ply_sha256": "ap", "gsvx_sha256": "ag"},
        }},
    )
    text = path.read_text()
    a_pos = text.index('"a.ply"')
    z_pos = text.index('"z.ply"')
    check(a_pos < z_pos, "save_manifest sorts entries by key")
    check(text.endswith("\n"), "save_manifest ends with newline")

# ---------------------------------------------------------------------------
# should_bake
# ---------------------------------------------------------------------------
print("\nshould_bake")

with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)
    gsvx_missing = tmp / "missing.gsvx"
    gsvx_present = tmp / "present.gsvx"
    gsvx_present.write_bytes(b"GSVX...")

    PLY_H = "a" * 64   # canonical .ply hash
    GSVX_H = "b" * 64  # canonical .gsvx hash
    GOOD = {"ply_sha256": PLY_H, "gsvx_sha256": GSVX_H}

    # Missing sibling → always bake, regardless of any other state
    check(bake_assets.should_bake(gsvx_missing, PLY_H, None, GOOD, force=False) is True,
          "bake when .gsvx is missing")

    # No recorded entry → bake; we cannot trust an unrecorded .gsvx
    check(bake_assets.should_bake(gsvx_present, PLY_H, GSVX_H, None, force=False) is True,
          "bake when manifest has no entry yet")

    # .ply hash mismatch (Codex P2#1 — source drifted via rsync -t / cp -p)
    check(bake_assets.should_bake(
              gsvx_present, "c" * 64, GSVX_H,
              {"ply_sha256": PLY_H, "gsvx_sha256": GSVX_H},
              force=False) is True,
          "bake when .ply hash mismatches recorded")

    # .gsvx hash mismatch (Codex P2#2 — .gsvx was reverted/edited/corrupted)
    check(bake_assets.should_bake(
              gsvx_present, PLY_H, "d" * 64,
              {"ply_sha256": PLY_H, "gsvx_sha256": GSVX_H},
              force=False) is True,
          "bake when .gsvx hash mismatches recorded")

    # Everything matches → skip
    check(bake_assets.should_bake(gsvx_present, PLY_H, GSVX_H, GOOD, force=False) is False,
          "skip when both hashes match")

    # --force overrides every other branch
    check(bake_assets.should_bake(gsvx_present, PLY_H, GSVX_H, GOOD, force=True) is True,
          "force overrides skip")

# ---------------------------------------------------------------------------
# find_ply_importer
# ---------------------------------------------------------------------------
print("\nfind_ply_importer")

with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)
    # No candidates → None
    check(bake_assets.find_ply_importer([tmp]) is None,
          "returns None when no candidate exists")

    # Drop an executable into a known location and detect it
    target = tmp / "tools" / "ply_importer" / "ply_importer"
    target.parent.mkdir(parents=True)
    target.write_text("#!/bin/sh\nexit 0\n")
    target.chmod(0o755)
    found = bake_assets.find_ply_importer([tmp])
    check(found == target, f"locates importer in candidate root (got {found})")

# ---------------------------------------------------------------------------
# bake_one (integration — requires ply_importer to be built)
# ---------------------------------------------------------------------------
print("\nbake_one")

REPO_ROOT = Path(__file__).resolve().parent.parent
SAMPLE_PLY = REPO_ROOT / "examples" / "island_demo" / "assets" / "props" / "firefly.ply"
IMPORTER_CANDIDATES = [
    REPO_ROOT / "build" / "macos-release",
    REPO_ROOT / "build" / "macos-release-with-diag",
    REPO_ROOT / "build" / "macos-debug",
    REPO_ROOT / "build" / "linux-release",
]
importer = bake_assets.find_ply_importer(IMPORTER_CANDIDATES)

if importer is None or not SAMPLE_PLY.exists():
    print("  SKIP  bake_one (ply_importer not built or fixture missing)")
else:
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "firefly.gsvx"
        bake_assets.bake_one(importer, SAMPLE_PLY, out)
        check(out.exists(), "bake_one writes the output file")
        check(out.stat().st_size > 64,
              f"bake_one output exceeds header size (got {out.stat().st_size} bytes)")
        # First 4 bytes must be the GSVX magic
        magic = out.read_bytes()[:4]
        check(magic == b"GSVX", f"bake_one output begins with GSVX magic (got {magic!r})")

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
