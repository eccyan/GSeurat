# #396 PR-A — Runtime GSVX dual-load (PLY fallback)

**Status:** draft (awaiting review)
**Date:** 2026-05-09
**Branch:** `refactor/396-pra-gsvx-dual-load`
**Companion plan:** PR-B (asset bake + `load_ply` deletion) — not part of this spec.

## Goal

Plumb a "try `.gsvx` first, fall back to `.ply`" load path through every runtime call site, without changing on-disk assets or scene JSON. Behavior on `main` (no `.gsvx` files present) must remain pixel-identical to today; behavior with `.gsvx` files dropped in alongside the `.ply`s must produce a Gaussian buffer that is field-equivalent to the PLY parse (within float epsilon).

This unblocks PR-B, which bakes the assets, retargets scene/chunk JSON to `.gsvx` paths, and deletes `GaussianCloud::load_ply` from the engine link — finally closing the design doc's stated PR 1a goal: *"PLY parse code … not linked into `gseurat_core`"*.

## Non-goals (PR-B)

- Asset baking (`tools/ply_importer` batch-CLI + CMake `bake_assets` target).
- Migrating scene JSON / chunk manifests from `.ply` paths to `.gsvx` paths.
- Deleting `GaussianCloud::load_ply` and the PLY-parse code from `gseurat_core`.
- Any GPU upload-path optimization (e.g. zero-copy GSVX → upload bypassing the Gaussian unpack).

## API

```cpp
// include/gseurat/engine/gaussian_cloud.hpp
class GaussianCloud {
public:
    // ... existing methods unchanged ...

    /// Load a Gaussian cloud, preferring a baked `.gsvx` sibling when present.
    ///
    /// Resolution: given `<path>.ply`, look for `<path>.gsvx` next to it via
    /// the same `resolve_asset_path` lookup. If present and parses cleanly,
    /// load it via `load_gsvx` and unpack `GpuGaussian` → `Gaussian`. On
    /// any failure (file missing, header invalid, count==0, read error)
    /// fall through to `load_ply(path, coords)`.
    ///
    /// `coords` is applied symmetrically on both paths: the PLY path
    /// negates Y / flips qx,qz inside `load_ply`, and the GSVX unpack
    /// applies the same transform on `pos_opacity.xyz` / `rot.xyz`.
    /// No runtime caller uses `kVulkanYDown` today, but symmetry
    /// future-proofs the wrapper against PR-B's `load_ply` deletion.
    ///
    /// Returns a `GaussianCloud` whose contents — `gaussians()` field-by-field,
    /// `bounds()`, and `count()` — are equivalent to the PLY parse within
    /// float epsilon. The unpack recomputes `importance` from the GSVX
    /// fields (`opacity * max(scale)`) so it is not dependent on the
    /// importer carrying the field through.
    static GaussianCloud load_with_gsvx_first(
        const std::string& ply_path,
        CoordinateSystem coords = CoordinateSystem::kYUp);
};
```

`load_ply` and `load_gsvx` remain unchanged and public. PR-B will delete `load_ply`; for now both stay for fallback.

## Behavior contract

### Path resolution

Input: `<path>.ply` (relative or absolute, as the call site already passes today). The probe first calls `resolve_asset_path` on `<path with .ply replaced by .gsvx>` — same lookup the engine uses elsewhere — and tests `std::filesystem::is_regular_file`. If true, attempts `load_gsvx`. If `load_gsvx` throws or returns `count == 0`, logs once via `std::fprintf(stderr, ...)` (so a corrupt `.gsvx` doesn't silently regress to PLY without trace) and falls through to `load_ply(path, coords)`.

If the probe fails (no sibling `.gsvx`), goes straight to `load_ply` with no log line — that's the steady state during PR-A.

### GpuGaussian → Gaussian unpack (the load_gsvx branch)

Per-field semantics, mirroring `gaussian_cloud.cpp:232-316` (the `load_ply` body):

| Gaussian field | Source in GpuGaussian | Notes |
|---|---|---|
| `position` | `pos_opacity.xyz` | direct copy |
| `opacity` | `pos_opacity.w` | already post-sigmoid in GSVX |
| `scale` | `scale_pad.xyz` | already post-exp in GSVX |
| `rotation` | `glm::quat(rot.w, rot.x, rot.y, rot.z)` | GpuGaussian stores xyzw; glm::quat ctor is wxyz. Already normalized in GSVX. |
| `color` | `color_pad.rgb` | already SH-converted and clamped to [0,1] in GSVX |
| `opacity` | (above) | (listed once) |
| `bone_index` | `std::bit_cast<uint32_t>(scale_pad.w)` | reverses ply_importer's `memcpy(&bone_as_float, &bone_index, 4)` |
| `emission` | `color_pad.w` | direct |
| `importance` | recomputed: `opacity * max({scale.x, scale.y, scale.z})` | matches `gaussian_cloud.cpp:298` and `:326` |

Bounds: expanded per-Gaussian during the unpack loop, identical to `load_ply`'s loop. (We do **not** trust the GSVX header AABB for the runtime-side bounds — the PLY path computes bounds inline, so we do too, to avoid a second source of divergence.)

### Equivalence claim

Given a PLY file `P` and its bake `G` produced by `tools/ply_importer P G`, the assertion is:

```
load_ply(P, kYUp).gaussians()[i] ≈ load_with_gsvx_first(P, kYUp).gaussians()[i]   for all i
```

within `~1e-6` per-component (FP32 round-trip through the GpuGaussian pack/unpack).

**Why bit-equivalence isn't possible:** the importer writes packed `vec4`s to disk in IEEE-754 binary32, so a `float→float` round-trip should be exact — but glm constructors and `glm::normalize` may produce different bit patterns from raw arithmetic. We accept "within float epsilon" not "bit-equal" for the parity test.

## Migration

12 runtime call sites on clean `origin/main`, all currently passing default `coords`:

| File | Line | Replacement |
|---|---|---|
| `src/engine/gs_scene_loader.cpp` | 41 | `GaussianCloud::load_ply(gs.ply_file)` → `GaussianCloud::load_with_gsvx_first(gs.ply_file)` |
| `src/engine/gs_scene_loader.cpp` | 118 | `GaussianCloud::load_ply(go.ply_file)` → `GaussianCloud::load_with_gsvx_first(go.ply_file)` |
| `src/engine/gs_chunk_streamer.cpp` | 88 | `return GaussianCloud::load_ply(path);` → `return GaussianCloud::load_with_gsvx_first(path);` |
| `src/engine/gs_vfx.cpp` | 155 | `GaussianCloud::load_ply(ply_path)` → `GaussianCloud::load_with_gsvx_first(ply_path)` |
| `src/demo/island_demo_state.cpp` | 438 | `on_enter` chunk merge — replace |
| `src/demo/island_demo_state.cpp` | 463 | `on_enter` NPC merge — replace |
| `src/demo/island_demo_state.cpp` | 555 | `on_enter` character merge — replace |
| `src/demo/island_demo_state.cpp` | 2369 | `perform_portal_transition` chunk merge — replace |
| `src/demo/island_demo_state.cpp` | 2389 | `perform_portal_transition` NPC merge — replace |
| `src/demo/island_demo_state.cpp` | 2475 | `perform_portal_transition` character merge — replace |
| `src/demo/island_demo_state.cpp` | 2623 | `enqueue_async_chunk_load` worker (latent bug — see below) — replace mechanically |
| `src/staging/staging_state.cpp` | 598 | staging chunk (latent bug — see below) — replace mechanically |

**Latent bugs preserved by mechanical migration:** two of the call sites (`island_demo_state.cpp:2623` and `staging_state.cpp:598`) call the static `load_ply` *through an instance* — `c.load_ply(path)` rather than `c = GaussianCloud::load_ply(path)`. The static method's return value is discarded, leaving the local `GaussianCloud` instance empty. Both are pre-existing on `main`. PR-A preserves this shape (`c.load_with_gsvx_first(path)`) so we don't introduce a behavior change. A follow-up cleanup PR can fix both with `c = GaussianCloud::load_with_gsvx_first(path);`.

The `src/tools/ply2heightmap.cpp:362` call is **not** migrated — it's an offline tool that takes user-supplied PLY paths and is not part of `gseurat_core` runtime. Stays on `load_ply`.

`src/engine/renderer.cpp:283` is a comment reference; left alone (the comment will become accurate again once PR-B deletes `load_ply`).

**Count amended (8 → 11):** the original 8-site count was based on a grep against the dirty `main` worktree, which had a local -234-line deletion block hiding the `perform_portal_transition` mirror of the §A merge. On clean `origin/main` those lines are live and must be migrated for symmetry with `on_enter`.

## Validation

Three gates, in order:

1. **Parity unit test** — `tests/engine/gaussian_cloud_dual_load_test.cpp`. Bake a small fixture (`tests/fixtures/tiny.ply` with ~16 Gaussians covering all field permutations: SH and direct-RGB color, bone_index uchar and uint32, emission present and absent) through `ply_importer` once into the test fixture dir. The test loads via `load_ply` and `load_with_gsvx_first`, asserts per-Gaussian field equality within `1e-6`, asserts `bounds()` and `count()` match. Adds a CMake target `tiny_ply_fixture` that depends on `ply_importer` so the fixture is regenerated on PLY changes.
2. **Dual-path smoke test** — manual: bake one demo asset (`snes_hero.ply` is small, ~30k Gaussians) to a sibling `.gsvx`, run the demo, verify visually that it loads from GSVX (the wrapper logs "loaded from .gsvx" once when picking that path) and renders identically. Delete the `.gsvx` after. **Asset-free PR.**
3. **Golden-frame regression** — with no `.gsvx` files present (i.e. every call falls through to PLY), run `scripts/regression/island_demo_canonical.py` against `main`. Pixel-equal expected since the fallback path is byte-for-byte the same as today's behavior. **Per memory `feedback_harness_crushes_mac.md`: do not run unattended; run only on user request.**

## Risks and open questions

**Quaternion ctor argument order** — `glm::quat(w, x, y, z)` is wxyz; `GpuGaussian.rot` stores xyzw. Easy to get wrong. The unpack must read `rot.w` first into the ctor. The parity test guards this.

**`load_gsvx` does not currently include AABB-from-header validation.** Looking at the existing implementation may show it just reads the data block. Need to confirm `load_gsvx` returns the full `count` of Gaussians and not a truncated read on partial files. Out-of-scope for this spec but worth a one-line sanity check in the wrapper.

**`is_regular_file` race.** Between probe and `load_gsvx`, a malicious or concurrent process could swap the file. We don't care — the fallback is robust to any error from `load_gsvx`.

**Logging volume.** Chunk streaming may load many `.gsvx`/`.ply` files per minute. The "loaded from .gsvx" trace line is one per file at parse time, on the worker thread — acceptable noise, useful for PR-B verification. PR-B will quiet it once the path is exclusive.

**Importance recompute differs from PLY load by FP order-of-operations.** `gaussian_cloud.cpp:298` does `opacity * std::max({...})`. Our unpack does the same. Should be bit-equal.

**Staging app.** Staging links `gseurat_core` and would inherit the new method. The migration line at `staging_state.cpp:598` is mechanical; one of the 8.

## Out-of-scope cleanups

The dirty `main`-worktree state (`island_demo_state.cpp` -234 LOC, `world.json` audio_groups, `regression/island_demo_canonical.py` step_responses telemetry) is unrelated; the user is triaging it separately. PR-A starts from clean `origin/main`.

## Self-review

- ✅ No placeholders / TBDs
- ✅ Migration table is exact (file:line)
- ✅ Equivalence claim is precise (within float epsilon, not bit-equal)
- ✅ Validation gates are concrete and ordered
- ✅ Out-of-scope items are explicit (PR-B, ply2heightmap, staging-only fields if any)
- ✅ Single, well-bounded change — the wrapper + 8 mechanical replacements
