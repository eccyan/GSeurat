# Phase 2: Room-based Loading & Vulkan Streaming Architecture

## Goal

Replace GsRenderer's destroy-and-recreate memory model with a streaming-ready architecture: pre-allocated VRAM managed by a slab allocator with GPU page table indirection, async background uploads via a dedicated transfer queue (with fallback), and Bricklayer Instance/Portal support to drive room-based loading.

## Requirements

### R1: Fixed-Size Slab Allocator with GPU Page Table
### R2: Async Background Transfer Queue
### R3: Instances (Rooms) & Portal Extension in Bricklayer

---

## R1: Fixed-Size Slab Allocator with GPU Page Table

### Overview

At startup, `GsRenderer` allocates one massive static SSBO sized to a configurable budget (default 10M splats × 64 bytes = 640 MB). This SSBO is logically divided into fixed-size slabs of 100K splats each. A `SlabAllocator` free-list manager tracks which slabs are in use.

Slabs are **non-contiguous** — a checkout may return scattered slab indices (e.g., `{2, 7, 15}`). A GPU-side page table SSBO maps logical splat indices to physical slab locations, eliminating external fragmentation entirely.

### New Files

- `include/gseurat/engine/slab_allocator.hpp` — Free-list manager (header-only or with .cpp)
- `src/engine/slab_allocator.cpp` — Implementation + unit tests

### SlabAllocator Interface

```cpp
class SlabAllocator {
public:
    SlabAllocator(uint32_t total_slabs, uint32_t splats_per_slab);

    struct SlabHandle {
        uint32_t chunk_id;
        std::vector<uint32_t> slab_indices;  // non-contiguous physical slab IDs
    };

    // Checkout N slabs from the free list. Returns scattered indices.
    // Throws if not enough slabs available.
    SlabHandle checkout(uint32_t slab_count);

    // Return slabs to the free list.
    void release(const SlabHandle& handle);

    // Number of free slabs remaining.
    uint32_t available() const;

    uint32_t splats_per_slab() const;
    uint32_t total_slabs() const;
};
```

### GPU Resources

- **`page_table_ssbo_`** — `uint32_t[]` array, one entry per logical slab index across all active chunks. Maps `logical_slab_index → physical_slab_index`. Updated only on load/unload (not per-frame).

- **`chunk_table_ssbo_`** — Small buffer describing active chunks: `{ slab_offset_in_page_table, slab_count, splats_in_last_slab }` per chunk. Lets the preprocess shader know which page table range belongs to which chunk.

### Preprocess Shader Change (`gs_preprocess.comp`)

```glsl
// Indirection through page table (replaces direct indexing)
uint logical_idx = gl_GlobalInvocationID.x;
uint slab_logical = logical_idx / SPLATS_PER_SLAB;
uint offset_in_slab = logical_idx % SPLATS_PER_SLAB;
uint physical_slab = page_table[slab_logical];
uint physical_idx = physical_slab * SPLATS_PER_SLAB + offset_in_slab;
Gaussian g = gaussians[physical_idx];
```

Cost: one integer divide, one modulo, one table lookup, one multiply-add per invocation — negligible.

### Changes to GsRenderer

- **`init_streaming(config)`** (new) — Called once at startup. Allocates the main SSBO, page table SSBO, chunk table SSBO, sort buffers, projected SSBO, and merge SSBO all to budget size. Creates the `SlabAllocator`.

- **`load_cloud()`** — No longer destroys/recreates buffers. Calls `slab_allocator_.checkout(N)` to get scattered slabs, writes Gaussian data into each slab's physical offset in the mapped SSBO, updates page table entries for this chunk.

- **`unload_cloud(handle)`** (new) — Calls `slab_allocator_.release(handle)`, invalidates page table entries, decrements active splat count.

- Sort buffers, projected SSBO, merge SSBO are pre-allocated to the max budget size at init. They do not grow or shrink.

### Configuration

Read from `engine_config.json` at project root:

```json
{
  "streaming": {
    "gpu_budget_splats": 10000000,
    "slab_size_splats": 100000
  }
}
```

Default: 10M splats (100 slabs × 100K splats/slab = 640 MB at 64 bytes/splat).

---

## R2: Async Background Transfer Queue

### Overview

PLY parsing happens on a background `std::thread`. Parsed data is staged into a host-visible ring buffer, then copied to physical slab offsets in the main SSBO. Two paths: dedicated transfer queue (true async) or time-sliced copies on the graphics queue (fallback for MoltenVK/single-queue GPUs).

### New Files

- `include/gseurat/engine/transfer_queue.hpp` — Interface + both path implementations
- `src/engine/transfer_queue.cpp` — Implementation

### Queue Discovery (VkContext changes)

At device creation:

1. Enumerate queue families.
2. Look for a family with `VK_QUEUE_TRANSFER_BIT` but **not** `VK_QUEUE_GRAPHICS_BIT`.
3. If found → request a queue from that family → `DedicatedTransferPath`.
4. If not found → `FallbackTransferPath` (time-sliced on graphics queue).
5. Store: `transfer_queue_`, `transfer_queue_family_`, `has_dedicated_transfer_`.

### TransferQueue Interface

```cpp
class TransferQueue {
public:
    void submit(StagingRegion region, uint64_t dest_offset, uint64_t size,
                std::function<void()> on_complete);
    void poll_completions();  // called once per frame from main loop
    bool is_dedicated() const;
};
```

### Path A — Dedicated Transfer Queue (Fence-Based, Non-Blocking)

- Own `VkCommandPool` + `VkCommandBuffer` on the transfer family.
- `submit()`: record `vkCmdCopyBuffer(staging → main SSBO)`, submit to transfer queue with a **`VkFence`** (no semaphore).
- **Graphics queue never waits** — continues rendering existing active chunks at full frame rate with zero awareness of in-flight transfers.
- `poll_completions()` (called each frame on main thread): calls `vkGetFenceStatus(fence)` — non-blocking check:
  - `VK_NOT_READY` → transfer still in flight, do nothing.
  - `VK_SUCCESS` → transfer complete:
    1. Update `page_table_ssbo_` with the new chunk's slab mappings.
    2. Update `chunk_table_ssbo_` to register the chunk as active.
    3. Increment active splat count so preprocess dispatches the new range.
    4. Reset fence for reuse.
    5. Fire `on_complete` callback.
- New chunk appears on the **very next frame** after fence signals — seamless pop-in.

### Path C — Fallback (Time-Sliced on Graphics Queue)

- Maintains a pending queue: `std::deque<TransferChunk>`.
- Each `TransferChunk` = `{staging_offset, dest_offset, size}`.
- `poll_completions()` pops up to `transfer_budget_mb_per_frame` (default 4 MB) of chunks, records `vkCmdCopyBuffer` calls into the frame's command buffer before the preprocess dispatch.
- Uses a `VkFence` per batch to know when staging memory can be reused.
- Page table updated only after all slabs for a chunk have completed.

### Staging Buffer

- Single host-visible ring buffer (`VMA_MEMORY_USAGE_CPU_TO_GPU`), sized to 2× slab size (double-buffered — write next chunk while previous is in flight).
- Background thread writes parsed Gaussian data into the ring.
- Main thread consumes from the ring via copy commands.

### Background Thread Flow

```
1. std::thread spawned per load request
2. Parse PLY → vector<GpuGaussian>
3. For each slab in the SlabHandle:
   a. Wait for staging ring space
   b. memcpy slab's worth of GpuGaussians into staging buffer
   c. Enqueue TransferChunk {staging_offset, physical_slab_offset, slab_bytes}
4. After all slabs queued → enqueue completion marker
5. Thread exits
```

### Synchronization

- `std::mutex` on the transfer chunk deque (producer = background thread, consumer = main thread).
- Dedicated path: `VkFence` per submission, polled non-blocking via `vkGetFenceStatus`.
- Fallback path: fence per frame-batch; page table updated only after all slabs for a chunk complete.

### Chunk Lifecycle States

```
LOADING   → slabs checked out, transfer in flight, not in page table yet
ACTIVE    → fence signaled, page table updated, rendering
UNLOADING → removed from page table, slabs released back to free list
```

### Configuration

```json
{
  "streaming": {
    "transfer_budget_mb_per_frame": 4
  }
}
```

---

## R3: Instances (Rooms) & Portal Extension

### Overview

Add `InstanceData` to Bricklayer as a named scene reference (metadata, no spatial representation). Extend `PortalData` with `target_instance_id`. Update the properties panel for instance management and portal assignment.

### Type Changes (`tools/apps/bricklayer/src/store/types.ts`)

New type:

```typescript
export interface InstanceData {
  id: string;           // unique key, e.g. "tavern_interior"
  display_name: string; // human label, e.g. "Tavern Interior"
  scene_file: string;   // relative path, e.g. "assets/scenes/tavern.scene.json"
}
```

Portal extension:

```typescript
export interface PortalData {
  // ... existing fields (id, position, size, spawn_position, spawn_facing)
  target_scene: string;          // kept for back-compat with legacy scenes
  target_instance_id?: string;   // NEW — references InstanceData.id
}
```

BricklayerFile scene block gains:

```typescript
instances?: InstanceData[];
```

### Store Changes (`useSceneStore.ts`)

- State: `instances: InstanceData[]`
- Actions: `addInstance()`, `updateInstance(id, patch)`, `removeInstance(id)`
- Portal actions unchanged — `updatePortal` already accepts partial patches.

### UI Changes

1. **EntitiesTab** — New "Instances" section below Portals. Lists instances with name + scene file. "+" button to add, click to select for editing.

2. **InstanceProperties** (new component in `ScenePropertiesPanel.tsx`) — Fields: display name (text input), scene file (text input), delete button. Rendered when `selectedEntity.type === 'instance'`.

3. **PortalProperties** — Add a `target_instance_id` dropdown above the existing `target_scene` field. Dropdown lists all defined instances by `display_name`. Selecting one sets `target_instance_id` and clears `target_scene`. A "None (legacy)" option keeps the old `target_scene` behavior.

### Path Validation

`validateScenePaths()` in `tools/apps/bricklayer/src/lib/sceneExport.ts` must also validate every `instance.scene_file` entry. Each instance's `scene_file` is checked as an asset reference (relative path, no absolute paths, resolves against project root). Broken or absolute paths produce a `ScenePathError` entry.

### Migration

Existing scenes with `target_scene` on portals continue to work. The engine checks `target_instance_id` first; if absent, falls back to `target_scene`. No forced migration needed. `instances` field is optional in `BricklayerFile` — absent means empty array.

### No Viewport Changes

Instances are metadata. Portal markers already render in the viewport and don't change.

---

## Acceptance Criteria

1. **Memory Stability:** Running the Staging engine and dynamically loading/unloading 5 different PLY files results in exactly zero new VMA buffer allocations/destructions after the initial `init_streaming()` call.

2. **Frame Rate Stability:** Triggering a new PLY load over the Bridge does not freeze the Staging engine's render loop. Background thread parses PLY, transfer queue uploads to VRAM, page table update makes chunk appear seamlessly.

3. **Editor Support:** In Bricklayer, users can define Instances (named scene references) and assign a `target_instance_id` to any Portal via the properties panel dropdown.

4. **Path Validation:** `validateScenePaths()` catches broken or absolute `instance.scene_file` paths before export.

5. **Backward Compatibility:** Scenes without `instances` or with `target_scene`-only portals continue to load and work without modification.

---

## File Summary

### New Files (C++)
| File | Purpose |
|------|---------|
| `include/gseurat/engine/slab_allocator.hpp` | Free-list slab manager with non-contiguous allocation |
| `src/engine/slab_allocator.cpp` | Implementation |
| `include/gseurat/engine/transfer_queue.hpp` | Async transfer interface (dedicated + fallback paths) |
| `src/engine/transfer_queue.cpp` | Implementation |

### Modified Files (C++)
| File | Change |
|------|--------|
| `src/engine/vk_context.cpp` | Request dedicated transfer queue family if available |
| `include/gseurat/engine/vk_context.hpp` | Add transfer queue members |
| `src/engine/gs_renderer.cpp` | Replace destroy/recreate with `init_streaming` + slab checkout/release |
| `include/gseurat/engine/gs_renderer.hpp` | Add slab allocator, transfer queue, chunk state members |
| `src/engine/buffer.cpp` | No changes expected (existing `create_storage` reused) |
| `shaders/gs_preprocess.comp` | Add page table indirection lookup |

### Modified Files (TypeScript)
| File | Change |
|------|--------|
| `tools/apps/bricklayer/src/store/types.ts` | Add `InstanceData`, extend `PortalData` |
| `tools/apps/bricklayer/src/store/useSceneStore.ts` | Add `instances` state + actions |
| `tools/apps/bricklayer/src/panels/ScenePropertiesPanel.tsx` | Add `InstanceProperties`, update `PortalProperties` dropdown |
| `tools/apps/bricklayer/src/panels/EntitiesTab.tsx` | Add Instances section |
| `tools/apps/bricklayer/src/lib/sceneExport.ts` | Validate `instance.scene_file` paths |

### Config
| File | Purpose |
|------|--------|
| `engine_config.json` (project root) | `streaming.gpu_budget_splats`, `streaming.slab_size_splats`, `streaming.transfer_budget_mb_per_frame` |
