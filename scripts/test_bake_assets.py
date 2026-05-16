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

# load_manifest returns an empty schema when the file is missing
with tempfile.TemporaryDirectory() as tmp:
    missing = Path(tmp) / "nope.json"
    m = bake_assets.load_manifest(missing)
    check(m == {"version": 1, "entries": {}}, "missing manifest → empty schema")

# load_manifest parses an existing file
with tempfile.TemporaryDirectory() as tmp:
    path = Path(tmp) / "manifest.json"
    path.write_text(json.dumps({"version": 1, "entries": {"a.ply": "abc123"}}))
    m = bake_assets.load_manifest(path)
    check(m["entries"]["a.ply"] == "abc123", "load_manifest parses existing entry")

# save_manifest writes entries sorted by key, with trailing newline
with tempfile.TemporaryDirectory() as tmp:
    path = Path(tmp) / "manifest.json"
    bake_assets.save_manifest(
        path,
        {"version": 1, "entries": {"z.ply": "zzz", "a.ply": "aaa"}},
    )
    text = path.read_text()
    a_pos = text.index('"a.ply"')
    z_pos = text.index('"z.ply"')
    check(a_pos < z_pos, "save_manifest sorts entries by key")
    check(text.endswith("\n"), "save_manifest ends with newline")

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
