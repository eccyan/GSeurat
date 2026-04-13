# Onesweep Tile Sort — Performance Report

**Date:** 2026-04-14
**PRs:** #241 (4-pass optimization), #247 (2-dispatch Onesweep), #248 (GPU profiling)
**Branch:** `perf/onesweep-2dispatch` (merged to main)

## Summary

Replaced the 4-pass radix sort (histogram + scan + scatter per pass = 12 dispatches, ~16 sort barriers) with a 2-dispatch Onesweep radix sort using decoupled lookback (histogram+lookback + scatter per pass = 8 dispatches, ~9 sort barriers).

**Result: 5x sort speedup on AMD, scaling with visible Gaussian count.**

## Architecture

### 2-dispatch Onesweep (per radix pass)

1. **`gs_onesweep_histogram.comp`** (Dispatch 1)
   - Each workgroup loads 2048 entries, builds a 256-bin local histogram
   - Decoupled lookback: publish LOCAL status, spin-read predecessors, publish INCLUSIVE status
   - Inclusive prefix for workgroup W, digit D = total count of digit D in workgroups [0..W]
   - All results stored in a coherent status buffer partitioned by pass

2. **`gs_onesweep_scatter.comp`** (Dispatch 2)
   - Dispatch boundary = implicit global barrier (no spin-wait needed)
   - Reads inclusive prefix of last workgroup → global total per digit
   - Computes exclusive prefix sum (thread 0, serial over 256 bins)
   - Reads inclusive prefix of (wg_id - 1) → per-workgroup aggregate
   - Stable scatter with intra-workgroup ranking

### Why not single-dispatch?

The original fused approach (PR #241) attempted all three phases in one dispatch but hit two fundamental issues:
1. **Missing cross-digit global prefix** — per-digit lookback only gives within-digit offsets, but scatter needs the global exclusive prefix (where each digit's section starts in output), which requires all workgroups to finish
2. **AMD TDR deadlock** — spin-wait global barrier deadlocked because AMD RX 6600M can't run all ~256 workgroups concurrently

The 2-dispatch split solves both: the dispatch boundary provides the needed global synchronization for free.

### Dispatch/barrier comparison

| | Original (8-pass) | PR #241 (4-pass) | Onesweep (2-dispatch) |
|---|---|---|---|
| Sort dispatches | 24 | 12 | 8 |
| Sort barriers | ~32 | ~16 | ~9 |
| Total barriers (incl. overhead) | ~38 | ~21 | ~14 |
| Scales with visible count | No | No | Yes |

## Benchmark Results

### Windows — AMD RX 6600M (release build)

**Scene:** Seurat Island overworld, 2.4M Gaussians, 524K tile sort capacity

#### Tile Sort Time (GPU, avg 60 frames)

| View Distance | Old 4-pass Sort | 2-dispatch Onesweep | Speedup |
|---------------|-----------------|---------------------|---------|
| Close-up | 5.1 ms | 1.0 ms | **5.1x** |
| Medium | 4.7 ms | 0.9 ms | **5.2x** |
| Far (few visible) | 4.9 ms | 0.4 ms | **11x** |

#### Total Pipeline (Sort + Rasterize)

| View Distance | Old Sort | Onesweep | Saved |
|---------------|----------|----------|-------|
| Close-up | 10.7 ms | 6.2 ms | **4.5 ms** |
| Medium | 8.5 ms | 5.5 ms | **3.0 ms** |
| Far | 5.3 ms | 0.7 ms | **4.6 ms** |

#### Key Observation

The old sort takes **~4.9 ms constant** regardless of how many Gaussians are visible because it dispatches a fixed number of workgroups over the full 524K-entry buffer. The Onesweep uses **indirect dispatch** so workgroup count scales with actual tile entries written by the binning pass.

### macOS — Apple M5 (debug build)

Tile binning is disabled on Apple Silicon by default (TBDR barrier overhead). Sort is a no-op (0.002 ms). Rasterize: 1.6 - 2.1 ms.

No performance change between old sort and Onesweep on macOS since the sort path is skipped entirely.

## GPU Timestamp Profiling

Added 4-query timestamp pool to measure sort and rasterize independently:

| Query | Pipeline Stage | Location |
|-------|---------------|----------|
| 0 | sort_begin | Before `dispatch_tile_sort()` |
| 1 | sort_end | After `dispatch_tile_sort()` |
| 2 | raster_begin | Before tile rasterize dispatch |
| 3 | raster_end | After tile rasterize dispatch |

Output (stderr, every 60 frames):
```
[gs_renderer] Sort: 0.925 ms  Rasterize: 4.958 ms  Total: 5.883 ms (avg 60 frames)
```

## Files Changed

| File | Change |
|------|--------|
| `shaders/gs_onesweep_histogram.comp` | New — dispatch 1 (histogram + decoupled lookback) |
| `shaders/gs_onesweep_scatter.comp` | New — dispatch 2 (prefix sum + stable scatter) |
| `shaders/gs_onesweep.comp` | Deleted — replaced by 2-dispatch approach |
| `include/gseurat/engine/gs_renderer.hpp` | Split pipeline/layout into histogram + scatter |
| `src/engine/gs_renderer.cpp` | 2-dispatch loop, 4-query profiling, descriptor sets |
| `shaders/CMakeLists.txt` | Updated shader list |
