# #396 PR-B1 — Bake script + manifest + CI drift check (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the first PR in the #396 PR-B series: a `bake_assets.py` script that converts `.ply` source assets to runtime-ready `.gsvx`, a single root-level `gsvx_sync_manifest.json` recording source hashes, a `validate_gsvx_in_sync.py` checker wired into CI, and the 57 baked `.gsvx` files committed to the repo. No engine code changes in this PR.

**Architecture:** Two Python scripts in `scripts/`. `bake_assets.py` walks `examples/island_demo/assets/**/*.ply`, runs the pre-existing `tools/ply_importer/ply_importer` C++ binary on each, writes `<asset>.gsvx` siblings, and updates a single `examples/island_demo/assets/gsvx_sync_manifest.json` keyed by repo-relative PLY paths → SHA256 hex of the source bytes. `validate_gsvx_in_sync.py` reads the manifest and verifies every committed `.ply` has a matching `.gsvx` and an unchanged hash. The CI `validate-data` job grows one step to invoke the validator. Both scripts follow the stdlib-only, plain-assertion test pattern already used in `scripts/test_camera_pipeline.py`.

**Tech Stack:** Python 3.12 (stdlib only — `hashlib`, `json`, `pathlib`, `subprocess`, `argparse`), bash, GitHub Actions workflow YAML, the existing C++ `ply_importer` binary built via CMake.

**Spec:** [`docs/superpowers/specs/2026-05-16-396-prb-no-runtime-ply-parser-design.md`](../specs/2026-05-16-396-prb-no-runtime-ply-parser-design.md) (commit `a70f22d0` on `refactor/396-prb-spec`).

**Target branch:** `refactor/396-prb1-bake` (worktree already created at `.worktrees/refactor-396-prb1-bake`).

---

## File structure

| Path | Status | Responsibility |
|---|---|---|
| `scripts/bake_assets.py` | create | CLI batch baker: PLY → GSVX with skip-up-to-date + manifest update |
| `scripts/test_bake_assets.py` | create | Unit + integration tests for bake_assets helpers |
| `scripts/validate_gsvx_in_sync.py` | create | CI drift checker: verifies .gsvx + hash for every committed .ply |
| `scripts/test_validate_gsvx_in_sync.py` | create | Unit tests for validator |
| `examples/island_demo/assets/gsvx_sync_manifest.json` | create | Single source-of-truth map: PLY relative path → SHA256 |
| `examples/island_demo/assets/**/*.gsvx` | create (57 files) | Baked runtime artifacts, committed alongside `.ply` |
| `.github/workflows/ci.yml` | modify | Add validator step to `validate-data` job |
| `docs/superpowers/plans/2026-05-16-396-prb1-bake-script-plan.md` | create | This document |

---

## Task 1: Commit this plan document

**Files:**
- Create: `docs/superpowers/plans/2026-05-16-396-prb1-bake-script-plan.md` (this document)

- [ ] **Step 1: Verify worktree is on the right branch**

```bash
cd /Users/eccyan/dev/GSeurat/.worktrees/refactor-396-prb1-bake
git branch --show-current
```

Expected output: `refactor/396-prb1-bake`

- [ ] **Step 2: Commit the plan**

```bash
cd /Users/eccyan/dev/GSeurat/.worktrees/refactor-396-prb1-bake
git add docs/superpowers/plans/2026-05-16-396-prb1-bake-script-plan.md
git commit -m "$(cat <<'EOF'
docs(plans): #396 PR-B1 bake script + drift check

Step-by-step implementation plan for the first PR in the PR-B series.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: a single commit added on `refactor/396-prb1-bake`.

---

## Task 2: `scripts/bake_assets.py` — skeleton + sha256 helper (TDD)

**Files:**
- Create: `scripts/bake_assets.py`
- Create: `scripts/test_bake_assets.py`

- [ ] **Step 1: Create the test file with a failing test for `sha256_file`**

Write to `scripts/test_bake_assets.py`:

```python
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/eccyan/dev/GSeurat/.worktrees/refactor-396-prb1-bake
python3 scripts/test_bake_assets.py
```

Expected: `ModuleNotFoundError: No module named 'bake_assets'`.

- [ ] **Step 3: Write the minimal `bake_assets.py` to make the test pass**

Write to `scripts/bake_assets.py`:

```python
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
from pathlib import Path


def sha256_file(path: Path) -> str:
    """Return hex SHA256 of the bytes of `path`."""
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
python3 scripts/test_bake_assets.py
```

Expected: `Results: 1/1 passed  ALL PASS`.

- [ ] **Step 5: Commit**

```bash
git add scripts/bake_assets.py scripts/test_bake_assets.py
git commit -m "$(cat <<'EOF'
scripts(bake): skeleton + sha256_file helper (#396 PR-B1)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `bake_assets.py` — manifest load/save (TDD)

**Files:**
- Modify: `scripts/bake_assets.py`
- Modify: `scripts/test_bake_assets.py`

- [ ] **Step 1: Append failing tests for manifest load/save**

Append to `scripts/test_bake_assets.py` *before* the Summary block:

```python
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
```

- [ ] **Step 2: Run the test to verify the new cases fail**

```bash
python3 scripts/test_bake_assets.py
```

Expected: existing `sha256_file` PASS plus new tests FAIL with `AttributeError: module 'bake_assets' has no attribute 'load_manifest'`.

- [ ] **Step 3: Implement `load_manifest` and `save_manifest`**

Append to `scripts/bake_assets.py`:

```python
import json


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
```

Also add `import json` at the top of `bake_assets.py` (next to `import hashlib`).

- [ ] **Step 4: Run the tests to verify all pass**

```bash
python3 scripts/test_bake_assets.py
```

Expected: `Results: 5/5 passed  ALL PASS`.

- [ ] **Step 5: Commit**

```bash
git add scripts/bake_assets.py scripts/test_bake_assets.py
git commit -m "$(cat <<'EOF'
scripts(bake): manifest load/save helpers (#396 PR-B1)

Manifest entries are sorted by key on write so the committed file
produces stable diffs across contributors.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `bake_assets.py` — skip-up-to-date + locator (TDD)

**Files:**
- Modify: `scripts/bake_assets.py`
- Modify: `scripts/test_bake_assets.py`

- [ ] **Step 1: Append failing tests for `should_bake` and `find_ply_importer`**

Append to `scripts/test_bake_assets.py` *before* the Summary block:

```python
# ---------------------------------------------------------------------------
# should_bake
# ---------------------------------------------------------------------------
print("\nshould_bake")

with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)
    ply = tmp / "a.ply"
    gsvx = tmp / "a.gsvx"
    ply.write_bytes(b"hello")

    check(bake_assets.should_bake(ply, gsvx, force=False) is True,
          "bake when .gsvx is missing")

    gsvx.write_bytes(b"GSVX")
    # ensure .gsvx is older than .ply
    os.utime(gsvx, (0, 0))
    check(bake_assets.should_bake(ply, gsvx, force=False) is True,
          "bake when .ply is newer than .gsvx")

    # touch gsvx so it's newer
    now = ply.stat().st_mtime + 10
    os.utime(gsvx, (now, now))
    check(bake_assets.should_bake(ply, gsvx, force=False) is False,
          "skip when .gsvx is newer than .ply")

    check(bake_assets.should_bake(ply, gsvx, force=True) is True,
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
```

- [ ] **Step 2: Run the test to verify the new cases fail**

```bash
python3 scripts/test_bake_assets.py
```

Expected: existing tests PASS, new tests FAIL with `AttributeError`.

- [ ] **Step 3: Implement `should_bake` and `find_ply_importer`**

Append to `scripts/bake_assets.py`:

```python
def should_bake(ply: Path, gsvx: Path, force: bool) -> bool:
    """True if .gsvx must be regenerated."""
    if force:
        return True
    if not gsvx.exists():
        return True
    return ply.stat().st_mtime > gsvx.stat().st_mtime


def find_ply_importer(roots: list[Path]) -> Path | None:
    """Locate the ply_importer binary under any of the given build roots.

    Each root is a candidate build directory; we look for
    `<root>/tools/ply_importer/ply_importer` (with `.exe` on Windows).
    Returns the first match, or None if none exist.
    """
    import sys as _sys
    name = "ply_importer.exe" if _sys.platform == "win32" else "ply_importer"
    for root in roots:
        candidate = Path(root) / "tools" / "ply_importer" / name
        if candidate.exists():
            return candidate
    return None
```

- [ ] **Step 4: Run the tests to verify all pass**

```bash
python3 scripts/test_bake_assets.py
```

Expected: `Results: 10/10 passed  ALL PASS`.

- [ ] **Step 5: Commit**

```bash
git add scripts/bake_assets.py scripts/test_bake_assets.py
git commit -m "$(cat <<'EOF'
scripts(bake): should_bake + find_ply_importer helpers (#396 PR-B1)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `bake_assets.py` — bake_one integration + main orchestrator

**Files:**
- Modify: `scripts/bake_assets.py`
- Modify: `scripts/test_bake_assets.py`

- [ ] **Step 1: Build ply_importer (required for the integration test)**

```bash
cd /Users/eccyan/dev/GSeurat/.worktrees/refactor-396-prb1-bake
cmake --preset macos-release 2>&1 | tail -3
cmake --build --preset macos-release --target ply_importer 2>&1 | tail -3
ls build/macos-release/tools/ply_importer/ply_importer
```

Expected: the binary exists.

- [ ] **Step 2: Append a failing integration test for `bake_one`**

Append to `scripts/test_bake_assets.py` *before* the Summary block:

```python
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
```

- [ ] **Step 3: Run the test to verify the new case fails**

```bash
python3 scripts/test_bake_assets.py
```

Expected: existing tests PASS, new test FAIL with `AttributeError: module 'bake_assets' has no attribute 'bake_one'`.

- [ ] **Step 4: Implement `bake_one` and the `main` orchestrator + CLI**

Append to `scripts/bake_assets.py`:

```python
import argparse
import subprocess
import sys


def bake_one(importer: Path, ply: Path, gsvx: Path) -> None:
    """Invoke ply_importer on `ply`, writing `gsvx`.

    Raises CalledProcessError if the importer fails. Output is captured
    so callers can decide what to surface.
    """
    gsvx.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [str(importer), str(ply), str(gsvx)],
        check=True,
        capture_output=True,
        text=True,
    )


# Repo-relative root holding all bakeable assets and the manifest.
ASSETS_ROOT_REL = "examples/island_demo/assets"
MANIFEST_NAME = "gsvx_sync_manifest.json"

DEFAULT_BUILD_DIRS = [
    "build/macos-release",
    "build/macos-release-with-diag",
    "build/macos-debug",
    "build/linux-release",
    "build/windows-release",
]


def find_repo_root(start: Path) -> Path:
    """Walk up from `start` looking for a `.git` directory."""
    for candidate in [start, *start.parents]:
        if (candidate / ".git").exists():
            return candidate
    raise RuntimeError(f"could not find repository root from {start}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--force",
        action="store_true",
        help="re-bake every .ply, ignoring skip-up-to-date logic",
    )
    parser.add_argument(
        "--build-dir",
        type=Path,
        action="append",
        default=None,
        help="extra build directory to search for ply_importer "
             "(may be given multiple times)",
    )
    args = parser.parse_args(argv)

    repo_root = find_repo_root(Path(__file__).resolve().parent)
    assets_root = repo_root / ASSETS_ROOT_REL
    manifest_path = assets_root / MANIFEST_NAME

    candidate_dirs = []
    if args.build_dir:
        candidate_dirs.extend(args.build_dir)
    candidate_dirs.extend(repo_root / d for d in DEFAULT_BUILD_DIRS)

    importer = find_ply_importer(candidate_dirs)
    if importer is None:
        sys.stderr.write(
            "bake_assets: could not find ply_importer. "
            "Build it first:\n"
            "    cmake --preset macos-release\n"
            "    cmake --build --preset macos-release --target ply_importer\n"
        )
        return 2

    manifest = load_manifest(manifest_path)
    entries = manifest.setdefault("entries", {})

    plys = sorted(assets_root.rglob("*.ply"))
    baked = 0
    skipped = 0

    for ply in plys:
        rel = ply.relative_to(assets_root).as_posix()
        gsvx = ply.with_suffix(".gsvx")
        if should_bake(ply, gsvx, args.force):
            print(f"  bake  {rel}")
            bake_one(importer, ply, gsvx)
            entries[rel] = sha256_file(ply)
            baked += 1
        else:
            # Keep manifest in sync even when we skip the bake — the .ply
            # could have been touched without content change in a previous
            # session that we want to record.
            entries[rel] = sha256_file(ply)
            skipped += 1

    # Drop manifest entries for .ply files that no longer exist.
    live = {ply.relative_to(assets_root).as_posix() for ply in plys}
    stale = [k for k in entries if k not in live]
    for k in stale:
        del entries[k]

    save_manifest(manifest_path, manifest)
    print(f"\nbaked={baked}  skipped={skipped}  total={len(plys)}  "
          f"pruned_stale={len(stale)}")
    print(f"manifest: {manifest_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 5: Run the tests**

```bash
python3 scripts/test_bake_assets.py
```

Expected: `Results: 13/13 passed  ALL PASS` (or 12 PASS + 1 SKIP if importer not present).

- [ ] **Step 6: Smoke-test the CLI on a single asset (dry-ish run)**

```bash
# Confirm the script wires up end-to-end. This will actually write .gsvx
# files but only for already-up-to-date paths — should report all skipped
# until a real bake run.
python3 scripts/bake_assets.py --build-dir build/macos-release 2>&1 | tail -5
```

Expected: a summary line like `baked=N  skipped=...` and a manifest written. (We will not commit the resulting files yet — Task 6 does the canonical bake on a clean tree.)

- [ ] **Step 7: Reset the side effects so the canonical bake commit is clean**

```bash
git status -- examples/island_demo/assets/ | head
git checkout -- examples/island_demo/assets/  # discard the smoke-test outputs
git status -- examples/island_demo/assets/    # must be clean now
```

- [ ] **Step 8: Commit**

```bash
git add scripts/bake_assets.py scripts/test_bake_assets.py
git commit -m "$(cat <<'EOF'
scripts(bake): bake_one + main orchestrator (#396 PR-B1)

bake_assets.py is now a working CLI that walks every .ply under
examples/island_demo/assets/, runs ply_importer, writes .gsvx siblings,
and updates examples/island_demo/assets/gsvx_sync_manifest.json with
source SHA256 hashes. Skip-up-to-date by mtime; --force overrides.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Run the canonical bake and commit the artifacts

**Files:**
- Create: `examples/island_demo/assets/**/*.gsvx` (57 files)
- Create: `examples/island_demo/assets/gsvx_sync_manifest.json`

- [ ] **Step 1: Confirm working tree is clean and ply_importer is built**

```bash
cd /Users/eccyan/dev/GSeurat/.worktrees/refactor-396-prb1-bake
git status
ls build/macos-release/tools/ply_importer/ply_importer
```

Expected: clean tree, importer binary present.

- [ ] **Step 2: Run the bake**

```bash
python3 scripts/bake_assets.py 2>&1 | tail -10
```

Expected: a `baked=57  skipped=0  total=57` summary (or close — total matches `find examples/island_demo/assets -name '*.ply' | wc -l`).

- [ ] **Step 3: Sanity check the artifacts**

```bash
COUNT_PLY=$(find examples/island_demo/assets -name "*.ply" | wc -l | tr -d ' ')
COUNT_GSVX=$(find examples/island_demo/assets -name "*.gsvx" | wc -l | tr -d ' ')
echo "PLY=$COUNT_PLY  GSVX=$COUNT_GSVX"
test "$COUNT_PLY" = "$COUNT_GSVX" && echo "OK: counts match"
```

Expected: counts match and "OK: counts match" prints.

- [ ] **Step 4: Spot-check the manifest**

```bash
python3 -c "import json; m = json.load(open('examples/island_demo/assets/gsvx_sync_manifest.json')); print('version:', m['version']); print('entries:', len(m['entries'])); print('first 3:', list(m['entries'].items())[:3])"
```

Expected: version 1, entries count matches the .ply count, and the first three entries show sorted relative paths with 64-char hex hashes.

- [ ] **Step 5: Stage and commit**

Stage explicitly by extension to avoid grabbing anything unexpected:

```bash
find examples/island_demo/assets -name "*.gsvx" -print0 | xargs -0 git add
git add examples/island_demo/assets/gsvx_sync_manifest.json
git status | head -20
```

Then commit:

```bash
git commit -m "$(cat <<'EOF'
assets(island_demo): bake .gsvx siblings for every .ply (#396 PR-B1)

Generated by scripts/bake_assets.py from the .ply sources at HEAD. The
runtime engine (post-PR-A) prefers .gsvx siblings when present; this
commit silently switches the demo to the baked artifacts without touching
any engine code or scene JSON. .ply sources remain authoritative; the
companion manifest records SHA256(.ply) so CI can flag drift.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Confirm repo size delta is in the expected range**

```bash
du -sh examples/island_demo/assets/
find examples/island_demo/assets -name "*.gsvx" -exec stat -f %z {} + | awk '{s+=$1} END {printf "Total .gsvx: %d bytes (%.1f MB) across %d files\n", s, s/1048576, NR}'
```

Expected: `.gsvx` total ≈ 167 MB across 57 files (matches the spec's projection).

---

## Task 7: `scripts/validate_gsvx_in_sync.py` — TDD

**Files:**
- Create: `scripts/validate_gsvx_in_sync.py`
- Create: `scripts/test_validate_gsvx_in_sync.py`

- [ ] **Step 1: Write the failing test file**

Write to `scripts/test_validate_gsvx_in_sync.py`:

```python
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
python3 scripts/test_validate_gsvx_in_sync.py
```

Expected: `ModuleNotFoundError: No module named 'validate_gsvx_in_sync'`.

- [ ] **Step 3: Implement `validate_gsvx_in_sync.py`**

Write to `scripts/validate_gsvx_in_sync.py`:

```python
#!/usr/bin/env python3
"""Verify every committed .ply has a matching .gsvx and recorded hash.

Reads examples/island_demo/assets/gsvx_sync_manifest.json and confirms,
for every .ply under that tree:
  1. A sibling .gsvx exists.
  2. The manifest has an entry for the .ply (keyed by repo-relative path).
  3. SHA256 of the .ply matches the manifest entry.

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
        actual = _sha256_file(ply)
        if actual != recorded:
            errors.append(
                f"{rel}: hash mismatch "
                f"(manifest={recorded[:16]}... actual={actual[:16]}...). "
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
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
python3 scripts/test_validate_gsvx_in_sync.py
```

Expected: `Results: 4/4 passed  ALL PASS`.

- [ ] **Step 5: Run the validator on the real tree to confirm in-sync**

```bash
python3 scripts/validate_gsvx_in_sync.py
```

Expected: `validate_gsvx_in_sync: OK (57 .ply files in sync)` (count may differ).

- [ ] **Step 6: Commit**

```bash
git add scripts/validate_gsvx_in_sync.py scripts/test_validate_gsvx_in_sync.py
git commit -m "$(cat <<'EOF'
scripts(validate): gsvx-in-sync CI drift check (#396 PR-B1)

Verifies every committed .ply has a sibling .gsvx and a matching SHA256
recorded in assets/gsvx_sync_manifest.json. Designed to wire into the
existing CI validate-data job; each error line carries the exact
remediation command (`scripts/bake_assets.py`).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Wire the validator into CI

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Read the current `validate-data` job**

```bash
sed -n '/validate-data:/,/test-tools:/p' .github/workflows/ci.yml
```

Expected: shows the validate-data job ending with a `Validate bricklayer sync` step, then `test-tools:` job header.

- [ ] **Step 2: Add the GSVX sync step**

Edit `.github/workflows/ci.yml`. Find the block:

```yaml
      - name: Validate bricklayer sync
        run: python3 scripts/validate_bricklayer_sync.py
```

Append a sibling step immediately after, at the same indentation:

```yaml
      - name: Validate gsvx sync
        run: python3 scripts/validate_gsvx_in_sync.py
```

- [ ] **Step 3: Verify the YAML is syntactically valid**

```bash
python3 -c "import yaml, sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('ci.yml: valid YAML')"
```

Expected: `ci.yml: valid YAML` (or install `pyyaml` first with `pip install pyyaml` if needed).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
ci(validate-data): run validate_gsvx_in_sync.py (#396 PR-B1)

Fails the PR if a committed .ply has no sibling .gsvx, no manifest
entry, or a hash mismatch — i.e. someone edited a .ply without
re-running scripts/bake_assets.py.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Demo smoke verification

**Files:** (no code changes)

- [ ] **Step 1: Build the engine**

```bash
cd /Users/eccyan/dev/GSeurat/.worktrees/refactor-396-prb1-bake
cmake --build --preset macos-release 2>&1 | tail -5
```

Expected: build succeeds.

- [ ] **Step 2: Run the demo briefly via Game Director (per project memory, NEVER auto-run the regression harness)**

Per `feedback_demo_smoke_run.md`: single smoke per code change. If a sample output exists at `/Users/eccyan/tmp/gseurat_demo_phase5.txt` and the demo hangs, fall back to inspecting that.

```bash
# Pure smoke — boots the demo, captures a startup screenshot, exits.
# If a Game Director smoke recipe exists in scripts/, prefer that.
ls scripts/game_director.py >/dev/null && echo "Game Director available."
```

Then run the smallest viable smoke (the engine boots a scene and frames render). Pick whichever of these the project has wired up:

- `python3 scripts/game_director.py smoke` (if such a subcommand exists)
- Or: launch the demo manually for a few seconds, confirm the title scene renders, then quit.

Capture *what* the smoke is and the result in a one-line note so the PR description can reference it. **Do NOT run the regression harness** — `feedback_harness_crushes_mac.md`.

- [ ] **Step 3: Confirm the engine read .gsvx, not .ply**

If the engine has a one-line log at PLY-fallback entry (PR-A added one via `fprintf` on corrupt GSVX), grep the demo's stderr from the smoke for `falling back` — must be absent. Otherwise, do a build-tree symbol check:

```bash
# Manual sanity: with .gsvx siblings present, load_with_gsvx_first short-circuits.
# A coarse runtime probe: list the demo binary's open files during boot.
# (Optional — only if the smoke didn't already convince you.)
```

- [ ] **Step 4: No commit — this is verification, not change**

---

## Task 10: Final sanity + push

- [ ] **Step 1: Confirm the branch state**

```bash
git log --oneline main..HEAD
```

Expected (commit order may vary by step ordering):

```
<hash>  ci(validate-data): run validate_gsvx_in_sync.py (#396 PR-B1)
<hash>  scripts(validate): gsvx-in-sync CI drift check (#396 PR-B1)
<hash>  assets(island_demo): bake .gsvx siblings for every .ply (#396 PR-B1)
<hash>  scripts(bake): bake_one + main orchestrator (#396 PR-B1)
<hash>  scripts(bake): should_bake + find_ply_importer helpers (#396 PR-B1)
<hash>  scripts(bake): manifest load/save helpers (#396 PR-B1)
<hash>  scripts(bake): skeleton + sha256_file helper (#396 PR-B1)
<hash>  docs(plans): #396 PR-B1 bake script + drift check
```

- [ ] **Step 2: Run the full test suite for the new scripts**

```bash
python3 scripts/test_bake_assets.py
python3 scripts/test_validate_gsvx_in_sync.py
python3 scripts/validate_gsvx_in_sync.py
```

Expected: all three exit 0.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin refactor/396-prb1-bake
gh pr create --title "refactor(assets): #396 PR-B1 — bake .gsvx + CI drift check" --body "$(cat <<'EOF'
## Summary
- Adds `scripts/bake_assets.py` (PLY → GSVX batch baker with skip-up-to-date) and `scripts/validate_gsvx_in_sync.py` (CI drift check).
- Commits a baked `.gsvx` sibling for every `.ply` under `examples/island_demo/assets/` (57 files, ~167 MB), plus a single root manifest `examples/island_demo/assets/gsvx_sync_manifest.json` recording the source SHA256 of each `.ply`.
- Wires the validator into the `validate-data` CI job.
- No engine code touched. `GaussianCloud::load_with_gsvx_first` (landed by PR-A) now silently switches to the baked artifacts on every load.

## Spec / plan
- Spec: `docs/superpowers/specs/2026-05-16-396-prb-no-runtime-ply-parser-design.md`
- Plan: `docs/superpowers/plans/2026-05-16-396-prb1-bake-script-plan.md`

## Test plan
- [ ] `python3 scripts/test_bake_assets.py` — PASS
- [ ] `python3 scripts/test_validate_gsvx_in_sync.py` — PASS
- [ ] `python3 scripts/validate_gsvx_in_sync.py` — OK
- [ ] Demo smoke — boots and renders pixel-identical to pre-PR baseline
- [ ] CI green on Linux/macOS/Windows build matrix
- [ ] CI `validate-data` job runs the new step and passes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: a PR URL is printed.

---

## Self-review checklist (run before declaring PR-B1 done)

- [ ] All Python tests pass: `python3 scripts/test_bake_assets.py && python3 scripts/test_validate_gsvx_in_sync.py`.
- [ ] Validator exits 0 on the committed tree: `python3 scripts/validate_gsvx_in_sync.py`.
- [ ] Counts match: `find examples/island_demo/assets -name "*.ply" | wc -l` == `find examples/island_demo/assets -name "*.gsvx" | wc -l`.
- [ ] Manifest is sorted by key (open `examples/island_demo/assets/gsvx_sync_manifest.json` and verify).
- [ ] CI workflow YAML is valid: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`.
- [ ] No engine code modified: `git diff main...HEAD -- src/ include/ tests/ tools/ | wc -l` returns 0.
- [ ] Demo boots and renders pixel-identical.
- [ ] PR body links to spec + plan.
