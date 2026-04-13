# Phase 2: TBDR-Optimized Tile Binning Sort — Design Spec

**Goal:** Reduce the tile binning radix sort from 38 pipeline barriers / 27 dispatches per frame to <10 barriers, making tile binning viable on Apple Silicon TBDR GPUs.

**Context:** Tile binning provides 3× rasterize speedup on AMD (2.1ms → 0.7ms) but costs ~18ms on Apple Silicon due to TBDR barrier overhead. Phase 1 (this branch) disables tile binning on Apple GPUs as a quick fix. Phase 2 re-enables it with a barrier-efficient sort.

---

## Current Barrier Analysis

### 8-Pass Radix Sort (dispatch_tile_sort)

| Phase | Dispatches | Barriers | Purpose |
|-------|-----------|----------|---------|
| Fill sentinels | 0 | 1 | vkCmdFillBuffer + TRANSFER→COMPUTE |
| Tile binning | 1 | 1 | Assign Gaussians to tiles |
| Prepare indirect | 1 | 1 | Write indirect dispatch args |
| Radix pass ×8 | 3 × 8 = 24 | 4 × 8 = 32 | histogram clear + histogram + scan + scatter |
| Tile ranges | 1 | 2+1 | Fill + boundary detect |
| **Total** | **27** | **38** |

### Why TBDR Is Slow

Apple Silicon uses Tile-Based Deferred Rendering. Each `vkCmdPipelineBarrier` with COMPUTE→COMPUTE dependency forces an L2 cache flush and tile memory writeback. The 8-pass radix sort fires 32 of these barriers just for sorting, plus 6 more for setup/teardown. On immediate-mode GPUs (AMD/NVIDIA), these barriers are near-free cache coherency ops.

### Why Apple Subgroup Size Matters

Apple GPU subgroup size = 32. The current radix sort uses workgroup-local shared memory but not subgroup operations. Subgroup shuffle/add can eliminate intermediate shared memory barriers within a workgroup.

---

## Proposed Approaches

### Approach A: Fused 2-Pass Radix Sort (Recommended)

**Core idea:** Sort by 16-bit key chunks instead of 8-bit. Two passes (one for key_lo, one for key_hi) with fused histogram+scatter.

**Barrier reduction:**
- Current: 4 barriers × 8 passes = 32 sort barriers
- Proposed: 4 barriers × 2 passes = 8 sort barriers
- Total with setup: ~12 barriers (vs 38)

**How it works:**
1. **Fused histogram+prefix sum:** Use `subgroupAdd` to compute partial histograms within subgroups, then shared memory reduction across subgroups. Eliminates the separate scan dispatch.
2. **16-bit radix digit:** Process 16 bits per pass instead of 8. Requires 65536-bin histogram (256KB per workgroup) — too large for shared memory. Alternative: two-level (8+8) within a single dispatch using subgroup coordination.
3. **Decoupled lookback:** Use the Onesweep algorithm (Adinets & Merrill, 2022) — single-pass radix sort with decoupled lookback for inter-workgroup prefix sum. Requires atomicAdd for status flags but eliminates global scan dispatch entirely.

**Implementation sketch:**
```
Pass 1 (key_lo): fused_histogram_scatter.comp → 1 dispatch + 1 barrier
Pass 2 (key_hi): fused_histogram_scatter.comp → 1 dispatch + 1 barrier
```

Each fused pass:
- Workgroup loads 1024 entries (4 per thread, 256 threads)
- Local histogram via shared memory (256 bins × workgroup)
- Subgroup-level prefix sum via `subgroupExclusiveAdd`
- Inter-workgroup prefix sum via decoupled lookback (atomicAdd on global status buffer)
- Scatter to output

**Pros:** Minimal barriers, proven algorithm, works with Apple's subgroup size 32
**Cons:** Complex implementation, requires careful shared memory layout, atomicAdd contention

### Approach B: Hybrid Bitonic Sort

**Core idea:** For small tile entry counts (<32K), use bitonic merge sort instead of radix. Bitonic sort has O(log²N) passes but each pass is a single dispatch with 1 barrier.

**Barrier reduction:**
- For N=32K: log₂(32K) = 15 passes, each with ~15 sub-passes = ~225 comparisons. But using shared memory, each dispatch handles multiple sub-passes.
- Practical: ~6-8 dispatches + barriers for 32K entries

**Implementation:** Extend existing `gs_sort.comp` (bitonic) to handle TileSortEntry's 64-bit key.

**Pros:** Simple extension of existing code, predictable performance
**Cons:** O(N log²N) vs O(N) for radix — poor for large entry counts (>100K). Only viable as fallback for small scenes.

### Approach C: Per-Tile Local Sort (No Global Sort)

**Core idea:** Skip global sort entirely. Each tile collects its Gaussians via tile_bin, then sorts locally in the tile_render shader using shared memory insertion sort or bitonic sort.

**Barrier reduction:**
- Eliminates all 32 sort barriers
- Total: ~4 barriers (fill + bin + ranges + render)

**How it works:**
- `tile_bin.comp` writes per-tile Gaussian lists (unsorted)
- `tile_render.comp` loads its tile's Gaussians into shared memory, sorts by depth locally, then rasterizes

**Pros:** Dramatic barrier reduction, simple conceptually
**Cons:** Shared memory limited (~32KB). With 16-byte entries, max ~2048 per tile. Heavy tiles (dense foliage) may exceed this. Requires fallback for overflow tiles.

---

## Recommendation

**Approach A (Fused 2-Pass Radix)** for the general case, with **Approach C (Per-Tile Local Sort)** as an optimization for tiles with <2048 entries (which is the common case at 160×120 output resolution).

### Implementation Order

1. **A-only first:** Implement fused 2-pass radix sort, measure on both Apple Silicon and AMD
2. **If A alone is sufficient (<3ms on Apple):** Ship it
3. **If still slow:** Add C as a fast path for small tiles, fall back to A for overflow tiles

### Key Metrics

| Metric | Current (Apple) | Target |
|--------|----------------|--------|
| Tile sort barriers | 38 | <10 |
| Tile sort dispatches | 27 | <6 |
| Rasterize frame time | ~18ms | <3ms |

---

## References

- Onesweep: "Onesweep: A Faster Least Significant Digit Radix Sort for GPUs" (Adinets & Merrill, 2022)
- Apple GPU architecture: Metal Best Practices Guide — "Minimize Compute Barriers"
- Vulkan subgroup operations: VK_KHR_shader_subgroup (Apple supports vote, arithmetic, ballot)
