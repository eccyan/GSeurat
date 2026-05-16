# #396 PR-B — Sever the runtime PLY parser link

**Status:** draft (awaiting review)
**Date:** 2026-05-16
**Branch:** `refactor/396-prb-spec` (this doc); implementation branches `refactor/396-prb1-bake`, `refactor/396-prb2-json`, `refactor/396-prb3-delete-parser` follow.
**Companion specs:** [`2026-05-09-396-pra-runtime-gsvx-dual-load-design.md`](2026-05-09-396-pra-runtime-gsvx-dual-load-design.md) (PR-A, landed `a977a4bb`).

## Goal

Remove all PLY parsing code from the engine link (`gseurat_core`). The runtime exclusively loads `.gsvx`. `.ply` remains as the authoring source-of-truth; `.gsvx` becomes the runtime build artifact, committed alongside, kept in sync by a bake script + CI drift check.

This closes the long-stated #396 goal: *"PLY parse code … not linked into `gseurat_core`"* — Phase 1 of the engine rebuild is then 100% done, unblocking Phase 2 (instrumentation).

## Source-vs-compiled model

The split is intentional and analogous to a source-tree / build-output relationship:

- `.ply` is **source** — the authored, human-editable representation. Echidna creates `.ply` from voxel models; PLYs may be hand-edited or imported from external 3DGS pipelines.
- `.gsvx` is **compiled output** — the packed GPU format the runtime consumes directly (4×vec4 per gaussian, no transforms). It is regenerated from `.ply` by `tools/ply_importer/`.

Both are committed. The bake script + CI drift check guarantee they stay in sync.

## Scope (in)

| Item | Lands in |
|---|---|
| `scripts/bake_assets.py` (PLY → GSVX batch bake with skip-up-to-date) | PR-B1 |
| `assets/gsvx_sync_manifest.json` (single root-level PLY-hash manifest) | PR-B1 |
| `scripts/validate_gsvx_in_sync.py` + CI workflow integration | PR-B1 |
| Commit `.gsvx` sibling for every `.ply` under `examples/island_demo/assets/` (57 assets, ~167 MB) | PR-B1 |
| Migrate `*.ply` → `*.gsvx` string values in scene/manifest/vfx JSON | PR-B2 |
| Delete `GaussianCloud::load_ply` + PLY parser namespace from `src/engine/gaussian_cloud.cpp` (~300 lines) | PR-B3 |
| Rename `load_with_gsvx_first` → `load_gsvx`; throw on missing `.gsvx` | PR-B3 |
| Migrate 4 test files (`test_gaussian_cloud`, `test_bridge_reconnect_root`, `test_gs_emission`, `test_ply_path_resolution`) to GSVX fixtures | PR-B3 |
| CMake target to bake test fixture PLYs at test build time | PR-B3 |

## Scope (out — explicitly do not touch)

- **Echidna `lib/plyImport.ts` / `lib/plyExport.ts`** — Echidna keeps authoring `.ply`. Migrating it to author `.gsvx` directly is significant scope creep (would need a TS-side GSVX codec).
- **Bricklayer viewport `.ply` loader** (`VfxRenderer.tsx`) — viewport preview keeps loading `.ply` because `.ply` still exists in the repo. Not in the engine link.
- **Melies `.ply` element list / preview** (`projectIO.ts`, `Preview.tsx`) — same rationale.
- **`tools/scripts/convert-island-demo.ts`** — keeps scanning `.ply` for asset registry. Not in the engine link.
- **`src/tools/ply2heightmap.cpp`** — keeps its inline PLY parser. Offline tool, not part of `gseurat_core`.
- **JSON key/schema rename `ply_file` → `gsvx_file`** — field names stay as `ply_file` with `.gsvx` values. Renaming would cascade through Bricklayer schemas, TS types, and bridge protocol. Tracked as known tech debt, not part of PR-B.

## PR-B1 — Bake script + drift check + committed assets

### `scripts/bake_assets.py`

```
Usage: python3 scripts/bake_assets.py [--force] [--build-dir <path>]

  Walks examples/island_demo/assets/**/*.ply, runs tools/ply_importer/ply_importer
  on each, writes <asset>.gsvx as a sibling, and updates assets/gsvx_sync_manifest.json
  with the SHA256 of the source .ply.

  Skip-up-to-date: bake only if .ply mtime > .gsvx mtime, or .gsvx is missing,
  or --force.

  Locates ply_importer in:
    - <build-dir>/tools/ply_importer/ply_importer  (if --build-dir given)
    - build/macos-release/tools/ply_importer/ply_importer
    - build/macos-release-with-diag/tools/ply_importer/ply_importer
    - build/macos-debug/tools/ply_importer/ply_importer
  Fails fast with a "run cmake --build --preset macos-release" instruction if missing.
```

### `assets/gsvx_sync_manifest.json`

Single file at `examples/island_demo/assets/gsvx_sync_manifest.json`. Keys are repo-relative `.ply` paths; values are SHA256 hex digests of the .ply bytes at bake time. Example:

```json
{
  "version": 1,
  "entries": {
    "characters/snes_hero/snes_hero.ply": "a3f2...",
    "maps/dungeon.ply": "9c41...",
    "props/island_tree_1.ply": "0d8e..."
  }
}
```

The bake script reads this on start (or creates if missing), updates entries it bakes, writes it back sorted by key. One file, no per-asset clutter.

### `scripts/validate_gsvx_in_sync.py`

For every `.ply` under `examples/island_demo/assets/`:
1. Assert a sibling `.gsvx` exists.
2. Assert `gsvx_sync_manifest.json` has an entry for the .ply.
3. Assert SHA256 of the .ply bytes matches the manifest entry.

Fails with a clear "run scripts/bake_assets.py" instruction on mismatch.

CI integration: `.github/workflows/build_test.yml` adds a step after build:

```yaml
- name: Validate .gsvx assets are in sync with .ply sources
  run: python3 scripts/validate_gsvx_in_sync.py
```

### No engine changes in PR-B1

`load_with_gsvx_first` already prefers `.gsvx` if a sibling exists (PR-A behavior). Once the .gsvx files land, runtime silently switches to baked artifacts. PLY fallback stays wired. Smoke test: run the demo — pixel-identical to before, but no PLY parses on the hot path.

## PR-B2 — JSON path migration

Replace `*.ply` → `*.gsvx` in path-string values across:

- `examples/island_demo/assets/scenes/*.bricklayer`
- `examples/island_demo/assets/scenes/*.json`
- `examples/island_demo/assets/characters/*/manifest.json` (any PLY references)
- `examples/island_demo/assets/vfx/**/*.json`
- `examples/island_demo/assets/scenes/world.json` (chunk manifest)

JSON keys remain `ply_file` (tech debt — value type now mismatches key name).

After PR-B2, runtime resolves to `.gsvx` directly. The PLY-fallback branch of `load_with_gsvx_first` becomes unreachable on the demo path.

Verification:
- `git grep '\.ply"' examples/island_demo/assets/ -- '*.json' '*.bricklayer'` must return zero matches.
- Run the demo — still pixel-identical.

## PR-B3 — Parser deletion + test migration

### Engine deletions

- `src/engine/gaussian_cloud.cpp`:
  - Delete unnamed-namespace PLY helpers: `type_size`, `read_float`, `PlyProperty` (~70 lines).
  - Delete `GaussianCloud::load_ply` (~230 lines).
- `include/gseurat/engine/gaussian_cloud.hpp`:
  - Delete `load_ply` static method declaration.
- Rename `load_with_gsvx_first` → `load_gsvx`. Drop the PLY-fallback branch; on missing `.gsvx`, throw with message:
  ```
  GaussianCloud::load_gsvx: '<path>' not found. If you edited the .ply source, run scripts/bake_assets.py to regenerate.
  ```
- Update all 11 call sites (already migrated by PR-A) from `load_with_gsvx_first` → `load_gsvx`.

### Test fixture strategy

Split test responsibilities:

- **Engine-side tests** (`tests/test_gaussian_cloud.cpp`, `test_bridge_reconnect_root.cpp`, `test_gs_emission.cpp`, `test_ply_path_resolution.cpp`): exercise the GSVX load path only.
- **PLY-format coverage** (the PLY round-trip cases that today live in `test_gaussian_cloud.cpp`): move into `tests/test_ply_round_trip.cpp` (the cross-wrapper drift detector landed by #454). That test already links `ply_parse_core` directly without going through `gseurat_core`, so it survives PR-B3 unchanged and grows to cover the cases removed from the engine-side tests.

Fixture provisioning: a new CMake target `bake_test_fixtures` runs `ply_importer` on a small set of fixture PLYs (kept under `tests/fixtures/*.ply`) at test build time, writing `.gsvx` siblings to the build dir. Tests load from the build dir.

### Symbol verification

After build:
```bash
nm build/macos-release/src/demo/gseurat_demo | grep -i "load_ply"   # must be empty
nm build/macos-release/src/demo/gseurat_demo | grep -i "PlyProperty" # must be empty
```

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Bake script generates `.gsvx` that diverges from on-the-fly PLY parse | The #454 cross-wrapper drift detector (`tests/test_ply_round_trip.cpp`) currently cross-checks ply_importer vs. the engine PLY parser. Once `load_ply` is deleted in PR-B3 it cross-checks ply_importer's parse against `load_gsvx` (PLY → ply_importer → GSVX bytes → `load_gsvx` → field equality), which is exactly the bake-correctness invariant we need. No new test needed. |
| Repo size jump (~167 MB) bothers contributors | One-time cost. Could move to git-LFS later (separate concern). Document the size delta in PR-B1's PR body. |
| CI drift check produces false positives if a .ply is touched (e.g., line-ending normalization) without semantic change | Hash is over file bytes, not gaussians — any byte change requires re-bake. This is correct behavior; contributors get a clear error message pointing at `bake_assets.py`. |
| `bake_assets.py` requires a built `ply_importer` on every contributor machine | The script fails fast with a build instruction. Document in `CONTRIBUTING.md` or equivalent that `cmake --build --preset macos-release` must run before editing PLYs. |
| Demo runs require pre-baked .gsvx files; fresh clones might lack them | Files are committed. Fresh clone has them. CI verifies presence. Only authoring-flow (editing a .ply locally) requires running bake. |

## Verification per PR

### PR-B1 acceptance
- `pnpm build` for tools (no engine change).
- `cmake --build --preset macos-release --target ply_importer`.
- Run `python3 scripts/bake_assets.py` — all 57 `.gsvx` written, manifest updated.
- Run `python3 scripts/validate_gsvx_in_sync.py` — exit 0.
- Run the demo — pixel-identical to pre-PR baseline.
- `nm` on demo binary — `load_ply` symbol still present (deletion is B3).

### PR-B2 acceptance
- `git grep '\.ply"' examples/island_demo/assets/ -- '*.json' '*.bricklayer'` returns zero matches.
- Run the demo — pixel-identical.
- `load_with_gsvx_first` PLY-fallback branch verified unreachable on the demo path (could log once on entry if hit; CI demo smoke would catch).

### PR-B3 acceptance
- `cmake --build --preset macos-release` succeeds.
- `ctest --preset macos-release` — all green.
- `nm build/macos-release/src/demo/gseurat_demo | grep -i "load_ply"` — empty.
- `nm build/macos-release/src/demo/gseurat_demo | grep -i "PlyProperty"` — empty.
- Demo runs.
- `git grep load_ply src/engine/ include/gseurat/engine/` — zero matches.

## Memory hygiene (post-merge)

Update `~/.claude/projects/-Users-eccyan-dev-GSeurat/memory/project_396_engine_refactor.md`:
- Move PR-B from "still pending" to "landed".
- Mark Phase 1 as 100% DONE.
- Point Phase 2 (instrumentation, `GS_LABEL` per dispatch, `GS_DBG_INVARIANT` migration) as next-session entry.

Add a note that the JSON field-name `ply_file` is now technically misleading (values are `.gsvx`); a rename PR is tracked as separate tech debt.
