# Post-Portal Flashback Investigation

**Date:** 2026-05-01
**Context:** After the per-frame flicker work (#380/#381, see `2026-04-30-gs-flicker-investigation.md`), one residual GS-rendering pathology remained: walking into the dungeon via portal and zooming the camera out revealed **green tree-shaped splats at overworld world coordinates** (~150–250 X/Z) — geometry that doesn't exist in the dungeon scene. Two reverts in this area earlier in the week made the engineering team cautious about further changes; this investigation traces the leak across every persistent GS buffer and pins it on a single hot consumer.

## TL;DR

`clear_chunks` (gs_renderer.cpp:1007) was thorough about CPU-side state — releasing slabs, draining publications, resetting `static_count_`, zeroing `dynamic_gaussian_ssbo_` — but left several persistent GPU-side buffers untouched. The render pipeline reads each of these somewhere; the merge/tile-bin/rasterize chain only loosely bounds reads by `counts[0]`, so anything past the visible count could pick up the previous scene's contents.

The specific buffer producing the visible tree symptom was **`projected_ssbo_`**, which holds preprocess output (screen-space projections). The preprocess pass writes only `[projected_offset, projected_offset + count)` per dirty frame; the tail beyond keeps the previous scene's last-frame projections. Overworld trees use bone_idx 32–43 → PBD path → final positions scattered across world coords like (351, _, 310). Those entries survived the scene clear and got read out via merge → tile-bin → rasterize.

Three other buffers were leaking adjacent stale state with smaller visible impact; all four are now reset at scene-clear time.

## Symptom

- Trigger: portal from `seurat_island` (overworld) to `dungeon` (50×50 small interior).
- Player spawns at (5, 0, 5). Camera zooms out → overworld geometry visible scattered across the void at world coords matching the previous scene's PBD-tagged trees (12 trees anchored at (119–249, _, 99–249)).
- Persistent across frames; same shapes each portal trip; not a one-frame tear.
- Was **not** the tile-bin atomic flicker resolved by #381 — different mechanism, different visual signature.

## Investigation path

### Step 1 — rule out the cross-queue cache hypothesis (PR #385)

Initial hypothesis (wrong): `TransferQueue` was uploading new chunk splat data to `static_gaussian_ssbo_` without a memory-visibility barrier on the single-family path (Apple Silicon under MoltenVK has `transfer_queue_ == graphics_queue_` per `vk_context.cpp:308`). The cross-family path emits release/acquire barriers; the single-family path emitted nothing.

PR #385 added a `TRANSFER_WRITE → SHADER_READ` `vkCmdPipelineBarrier` on `transfer_cmd_` for the single-family path. This *did* close a real cache-visibility gap (any concurrent reader would have seen torn splat bytes), but the user-reported "ghost" symptom was unchanged. Different bug than this investigation.

### Step 2 — rule out the consolidated-view sort tail (PR #386, commit 1)

Next hypothesis: `static_sort_a_/b_` carried valid depth keys at `[0, old_static_count_)` from the previous scene's last frame. Depth sort regenerates keys for `[0, current_count)` per dirty frame; the tail beyond survived. Indices in those entries pointed to offsets in `static_gaussian_ssbo_` that hadn't been overwritten by the new scene's `update_static_gaussians`.

Commit 1 sentinel-fills `static_sort_a_/b_` (`key=0xFFFFFFFF, index=0`) and sets `static_sort_needs_reinit_ = true` in `clear_chunks`. **User-confirmed reduction of ~95% of the original ghost density** — the scattered overworld terrain splats stopped showing up. But the residual trees (12 distinct PBD-anchored shapes) remained.

### Step 3 — rule out the slab-indirection path (PR #386, commit 2)

`page_table_ssbo_` and `chunk_table_ssbo_` are HOST_VISIBLE+TRANSFER_DST metadata for the streaming path. `publish_pending_chunks`'s Unload branch writes `0xFFFFFFFF` sentinels for released slabs; `clear_chunks` released slabs by calling `slab_allocator_->release(...)` directly, bypassing the publish path entirely. Stale page-table entries pointed at `static_gaussian_ssbo_` slab offsets that contained previous-scene geometry.

Commit 2 invalidates both buffers in `clear_chunks` (page_table → 0xFF, chunk_table → 0). **No visible change** — confirmed the residual trees aren't reaching the rasterizer via the slab-indirection path.

### Step 4 — rule out stale gaussian data (PR #386, commit 3)

Hypothesis: even with sentinels in the sort buffer, some reader could be going beyond `static_count_` into `static_gaussian_ssbo_`'s tail (which still held previous-scene Gaussians up to `max_static_count_`).

Commit 3 zeros the entire `static_gaussian_ssbo_` in `clear_chunks` (~700 MB host write at the demo's 11M-entry capacity, ~3-5 ms on Apple Silicon's unified memory). **No visible change** — eliminated stale gaussian *data* as the source. The trees were coming from somewhere downstream.

### Step 5 — instrument the rebuild buffer

Added a temporary diagnostic in `renderer.cpp`'s rebuild block, printing once per ~64 dirty frames the size, AABB, and PBD-tagged count of `gs_static_buffer_` after `gather() + append_objects()`:

```
[DIAG] gs_static_buffer_: size=1216092
       AABB=[1.0,-1.5,1.0]→[52.2,16.8,49.0]
       pbd_tagged=0  bone_anim_tagged=40308  vfx_inst=23
```

Two facts immediately ruled out the input side:

- **AABB** tight on the dungeon's 50×50 footprint. No Gaussians at overworld coords reach `update_static_gaussians`.
- **`pbd_tagged == 0`**. No Gaussians with `bone_idx ∈ [32,64)`. The PBD path in `gs_preprocess.comp` cannot trigger for any dungeon Gaussian — yet user observation said the visible artefact had the signature of PBD-transformed positions.

Conclusion: the rebuild path correctly delivers only dungeon data to `static_gaussian_ssbo_[0, count)`, and `[count..max)` is zero (commit 3). The leak is **downstream** of `update_static_gaussians`, in some buffer the rebuild path doesn't write.

### Step 6 — find the actual leak

The downstream consumer buffers between preprocess and rasterize are:

| Buffer | Written by | Coverage per write |
|---|---|---|
| `projected_ssbo_` | preprocess shader | `[projected_offset, +count)` only |
| `static_sort_a_/b_` | depth sort | `[0, count)` only (rest sentinels after commit 1) |
| `merged_sort_ssbo_` | merge shader | `[0, total_visible)` only |
| `tile_sort_a_/b_` | tile-bin scatter | `[0, tile_sort_count)` only |
| `tile_ranges_ssbo_` | tile-ranges pass | per-tile (full coverage) |

`projected_ssbo_` is the most likely culprit because:

1. It carries final pre-rasterization data — **screen-space center, depth, conic, color** — already transformed through bone skinning and PBD. Stale entries are tied to specific *world positions* of the previous scene.
2. The preprocess shader runs **only when `static_dirty_ && static_count_ > 0`** (gs_renderer.cpp:3196). On the first post-portal frame `static_count_ = 0` → preprocess skipped → `projected_ssbo_` keeps the entire previous-frame contents.
3. Even after the dungeon's first non-empty rebuild, preprocess writes `[0, dungeon_count)` ≈ 1.2M entries — but the buffer is sized for `max_static + max_dynamic` ≈ 11M entries. The tail `[1.2M, 11M)` keeps overworld projections.
4. Of those overworld projections, the 12 PBD trees (~485K splats per the overworld DIAG sample) had been written to `projected_ssbo_` with **PBD-transformed positions** — final world coords like (351, _, 310), explicitly the symptom signature.

The merge / tile-bin / rasterize chain *should* be bounded by `counts[0]` (static_visible) and never reach the stale tail. But `counts[0]` is reset to 0 only in the `static_dirty_ && static_count_ > 0` branch of the per-frame `vkCmdFillBuffer` (gs_renderer.cpp:3153); when `static_count_ = 0`, only `counts[1..3)` are reset, leaving `counts[0]` at its previous-scene value. (Commit 3 of this PR added a host-side reset of `counts_ssbo_` to `clear_chunks` as belt-and-braces, but the per-frame reset's else-branch behavior is what allows the stale-projection path to leak through.)

### Step 7 — the fix

Commit 4 zeros the entire `projected_ssbo_` in `clear_chunks`. **User-confirmed: trees gone completely** ("WOW!!! It is completelly CLEAN! No trees!!!").

## Resolution

Four resets added to `clear_chunks`, all `std::memset` against HOST_VISIBLE+MAPPED buffers after the existing `vkDeviceWaitIdle`. Combined cost on the demo's 11M-entry capacity: ~1.3 GB of host writes, dominated by the existing portal cost (a few ms on Apple Silicon's unified memory).

| # | Buffer | Fill | Bytes | Why |
|---|---|---|---|---|
| 1 | `static_sort_a_/b_` | `{0xFFFFFFFF, 0}` × `static_sort_size_` | ~88 MB × 2 | Stale valid depth keys at `[0, old_count)` |
| 1b | `static_sort_needs_reinit_` | `true` | flag | Force next rebuild's `need_rebuild` gate |
| 2 | `page_table_ssbo_` | `0xFF` | ~400 B | Slab-indirection sentinels |
| 2b | `chunk_table_ssbo_` | `0` | 4 KB | Chunk-table sentinels |
| 3 | `counts_ssbo_` | `{0,0,0}` | 12 B | Defensive — stale visibility counts |
| 3b | `static_gaussian_ssbo_` | `0` | ~700 MB | Stale gaussian data at `[count, max)` |
| 4 | **`projected_ssbo_`** | `0` | ~530 MB | **Stale PBD-transformed projections — actual root cause** |

Each closes a separate stale-state pathway across the scene transition. The first three are partial fixes / defense-in-depth; commit 4 is the one that eliminates the residual visible symptom.

## Verdict

Cross-checked by user on Apple M5 (MoltenVK, single queue family) with the demo's seurat_island ↔ dungeon portal:

| Configuration | Post-portal ghost geometry |
|---|---|
| `main` before #386 | **Many ghosts** — scattered terrain splats + 12 distinct trees at overworld coords |
| Commit 1 (sort buffer reset) | **~95% reduction** — scattered terrain splats gone, 12 trees still visible |
| Commit 1+2 (page/chunk tables) | Same as commit 1 — slab-indirection path was not the leak |
| Commit 1+2+3 (gaussian buffer zero) | Same as commit 1 — gaussian data was not the leak |
| Commit 1+2+3+4 (projected_ssbo_ zero) | **Clean** — no ghost geometry of any kind |

## Why this wasn't caught earlier

`projected_ssbo_` is invisible from CPU-side reasoning about scene state. The buffer's contents are exclusively GPU-written (preprocess output) and GPU-read (merge/raster input). Standard scene-clear hygiene focuses on inputs (`static_gaussian_ssbo_`, `static_count_`, `active_chunks_`) and metadata (`page_table`, `chunk_table`). The intermediate projection buffer's tail-region staleness is a class of bug that doesn't surface from reading the high-level scene-load code — it only surfaces from tracing each buffer's write coverage against each consumer's read range.

The DIAG-based investigation pattern that pinned this down — print `gs_static_buffer_`'s post-gather AABB and PBD-count, ruling out the input side first — is worth keeping as a tool when GS-pipeline ghost symptoms recur. The `[DIAG]` log was removed before the fix landed, but the formula (size + AABB + bone-tag breakdown of the rebuild buffer) generalizes to any future "renderer is showing data that shouldn't exist" situation.

## What's left

Nothing critical. Possible follow-ups, none load-bearing:

- Tighten the per-frame `vkCmdFillBuffer` reset in `dispatch_compute` (gs_renderer.cpp:3153) to always reset `counts_ssbo_[0]`, not just in the dirty branch. Would make commit 3's host-side reset redundant. Belt-and-braces; not urgent.
- Profile the cumulative ~1.3 GB host write cost on lower-end machines (< Apple M5). If it's noticeable, the fixes can be narrowed (e.g. only zero `[count, max)` after `update_static_gaussians` rather than the full buffer in `clear_chunks`).
- Document the same hygiene pattern for any future per-frame consumer buffer added to the GS pipeline (e.g. if a new pass adds another intermediate). The audit question to ask: "If `static_count_` shrinks or this scene's `update_static_gaussians` doesn't run for one frame, what's left in this buffer's tail?"

## PR references

- PR #385 (cross-queue barrier, adjacent fix on the same Apple-Silicon path): <https://github.com/eccyan/GSeurat/pull/385>
- PR #386 (this investigation's fix, four commits): <https://github.com/eccyan/GSeurat/pull/386>
  - `073ac949` — sentinel-fill `static_sort_a_/b_`
  - `59f80cad` — invalidate page/chunk tables
  - `d6df5881` — zero `static_gaussian_ssbo_`
  - `83facd0e` — **zero `projected_ssbo_`** (root cause)
- Related prior work: `2026-04-30-gs-flicker-investigation.md` (per-frame flicker, resolved by #380/#381)
