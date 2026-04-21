# Fix Staging GPU Buffer Clear on Scene Switch

## Problem

When Staging loads a new scene while streaming mode is active, old Gaussian data persists in GPU buffers. The `load_cloud()` method in `gs_renderer.cpp` appends new chunk state to `active_chunks_` without clearing old chunks, causing:

1. **Visual corruption**: Old scene's Gaussians render alongside new scene's data
2. **VRAM leak**: Physical slabs from old chunks are never returned to the slab allocator
3. **Incorrect counts**: `static_count_` sums old + new chunks, inflating sort buffer sizes

The bug does not occur in legacy (non-streaming) mode because `load_cloud_legacy()` destroys and recreates buffers on each load.

## Root Cause

In `gs_renderer.cpp`:

- `init_streaming()` (line 804) properly calls `active_chunks_.clear()`
- `load_cloud()` (line 815) does NOT clear chunks before appending

When Staging switches scenes, it calls `init_gs()` -> `load_cloud()`. Since `streaming_initialized_` is already true, `init_streaming()` is not re-invoked, and `load_cloud()` appends the new scene's chunk on top of the old scene's chunks.

## Fix

Add chunk cleanup at the top of `load_cloud()`, after the GPU idle wait and before slab allocation:

```cpp
void GsRenderer::load_cloud(const GaussianCloud& cloud) {
    if (!streaming_initialized_) {
        load_cloud_legacy(cloud);
        return;
    }
    if (cloud.empty()) return;
    if (initialized_) { vkDeviceWaitIdle(device_); }

    // ── Release old scene data ──
    for (auto& chunk : active_chunks_) {
        slab_allocator_->checkin(std::move(chunk.handle));
    }
    active_chunks_.clear();
    static_count_ = 0;
    total_active_splats_ = 0;
    // ─────────────────────────────

    sort_done_once_ = false;
    static_dirty_ = true;
    // ... rest of method unchanged
```

### Why This Is Safe

1. **GPU idle**: `vkDeviceWaitIdle()` is called before cleanup, ensuring no in-flight commands reference the old slab data
2. **Slab allocator checkin**: Returns physical slabs to the free pool, preventing VRAM accumulation
3. **Page table offset**: Starts at 0 for the new scene because `active_chunks_` is empty when the loop at line 836 executes
4. **Sort buffers**: Reinitialized downstream (lines 905-906) based on the new `static_count_`, so old sort state is overwritten
5. **Chunk table**: Written at `chunk_idx = active_chunks_.size()` (line 874), which is 0 after clear

### Edge Cases

- **Empty cloud after non-empty**: Early return at `if (cloud.empty())` — old chunks remain. This is acceptable because an empty cloud means "no scene loaded" and the old data will be overwritten on next non-empty load. If strict cleanup is desired, add cleanup before the early return.
- **Multiple `load_cloud()` calls in same frame**: Safe — each call clears previous and loads fresh.
- **`unload_cloud()` after fix**: Still works correctly — it finds chunks by `chunk_id` in `active_chunks_` and returns slabs individually.

## Testing

1. **Unit test**: Load cloud A -> load cloud B -> assert `active_chunks_.size() == 1` and `static_count_ == B.count()`
2. **VRAM test**: Load/unload 10 scenes in sequence -> verify slab allocator free count returns to initial value
3. **Visual test (Game Director)**: Load scene A -> screenshot -> load scene B -> screenshot -> verify no artifacts from scene A in scene B screenshot
4. **Snapshot diff**: `game_director.py snapshot save before` -> switch scene -> `game_director.py snapshot diff before` -> only new scene elements present

## Files Changed

| File | Change |
|------|--------|
| `src/engine/gs_renderer.cpp` | Add chunk cleanup in `load_cloud()` before slab allocation |
| `tests/test_gs_renderer.cpp` | Scene-switch test: load A, load B, verify clean state |
