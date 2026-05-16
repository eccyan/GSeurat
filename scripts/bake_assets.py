#!/usr/bin/env python3
"""Bake PLY assets to runtime-ready GSVX format.

Walks examples/island_demo/assets/**/*.ply, runs tools/ply_importer/ply_importer
on each, writes <asset>.gsvx siblings, and updates
examples/island_demo/assets/gsvx_sync_manifest.json with the SHA256 of each
source .ply.

Usage:
    python3 scripts/bake_assets.py [--force] [--build-dir <path>]

Skip-up-to-date: a .ply is re-baked only if the manifest's recorded SHA256
does not match the current source bytes, or the .gsvx is missing, or
--force is passed. mtime is intentionally not consulted — rsync -t, cp -p,
and archive-restore workflows can preserve old mtimes on new content, and
trusting mtime there would silently bless a stale .gsvx.
"""

import argparse
import hashlib
import json
import subprocess
import sys
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


def should_bake(
    gsvx: Path,
    current_hash: str,
    recorded_hash: str | None,
    force: bool,
) -> bool:
    """True if .gsvx must be regenerated.

    Hash-based — does not consult mtime. `current_hash` is the SHA256 of the
    .ply source bytes right now; `recorded_hash` is whatever the manifest had
    on disk for this asset (None if no entry yet). A mismatch (including
    None) means the manifest is out of sync with the source and the .gsvx is
    no longer trustworthy, regardless of mtimes.
    """
    if force:
        return True
    if not gsvx.exists():
        return True
    return recorded_hash != current_hash


def find_ply_importer(roots: list[Path]) -> Path | None:
    """Locate the ply_importer binary under any of the given build roots.

    Each root is a candidate build directory; we look for
    `<root>/tools/ply_importer/ply_importer` (with `.exe` on Windows).
    Returns the first match, or None if none exist.
    """
    name = "ply_importer.exe" if sys.platform == "win32" else "ply_importer"
    for root in roots:
        candidate = Path(root) / "tools" / "ply_importer" / name
        if candidate.exists():
            return candidate
    return None


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
        current_hash = sha256_file(ply)
        recorded_hash = entries.get(rel)
        if should_bake(gsvx, current_hash, recorded_hash, args.force):
            print(f"  bake  {rel}")
            bake_one(importer, ply, gsvx)
            baked += 1
        else:
            skipped += 1
        entries[rel] = current_hash

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
