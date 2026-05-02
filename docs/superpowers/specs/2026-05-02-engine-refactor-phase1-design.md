# Engine Refactor — Phase 1 Design

**Date:** 2026-05-02
**Author:** eccyan + Claude (brainstorming session)
**Branch:** `feature/refactor-phase1-design`
**Status:** Draft, awaiting review
**Supersedes:** None
**Predecessor:** PR #388 (streaming-strict-mode merged 2026-05-02)

---

## 1. Context & Motivation

The streaming-strict ghost-debugging saga (PRs #385–#388) eliminated four ghost-rendering bugs over two weeks of intense investigation. The root causes were not individual bugs but **structural**:

- **Single God Class (`gs_renderer.cpp`)** at **4,687 LOC** with **214 private fields** dispatching **14 GPU passes**, where streaming and legacy paths competed to mutate the same `static_count_` field on alternating frames.
- **Tight ECS-Renderer coupling at the `AppBase` level** — the renderer reaches into `gs_animator_`, `vfx_instances_`, `gs_pending_dynamics_`, `gs_particle_emitters_`, and `gs_scene_animations_` every frame, while `CommandDispatcher` mutates `vfx_instances_mutable()` directly. Systems do not communicate via components or events; they share AppBase members and call each other directly.
- **No GPU traceability** — zero `vkCmdBeginDebugUtilsLabelEXT` usage. RenderDoc traces show numbered dispatches with no semantic context. Every diagnostic has been hand-coded ad-hoc (`GS_DIAG_STREAMING` env var, scattered `std::fprintf` debugging).
- **No structured cost-aware diagnostic mode** — heavy invariant checks (`static_count_ == sum(active_chunks_.splats)`) ship in release builds (or are stripped from debug builds, with no middle ground), and there is no "release with diagnostics" build profile for catching optimization-dependent timing bugs.

This design proposes a **5-phase, 15–17-PR refactor** to address all three concerns. The end state is a renderer that consumes a typed `RenderState` and emits GPU commands, an ECS layer that communicates exclusively through components and events, and a tiered diagnostic system that costs nothing in release while providing deep traceability in debug and "release with diagnostics" builds.

**Two prior attempts in this area were reverted because regressions were not detected until manual playtesting.** This design treats regression safety as a **prerequisite**, not an outcome: Phase 0b builds an automated golden-frame harness via Game Director **before any refactor work begins**.

---

## 2. Goals & Non-Goals

### In scope (Phase 1)

1. **Purge legacy runtime code** — remove `load_cloud_legacy`, `update_static_gaussians` gather, `gs_chunk_grid_` runtime culling, legacy `add_vfx_instance` insertion, and (if confirmed superseded) `render_pipeline_`. Extract reusable PLY parsing to an offline utility decoupled from the runtime renderer.
2. **System-centric decomposition of `GsRenderer`** — split into `GsResourceManager`, `GsStreamingSystem`, `GsSortSystem`, `GsTileBinSystem`, `GsPostProcessSystem`. `GsRenderer` becomes an ~80-line orchestrator.
3. **Pure renderer contract** — renderer reads from a typed `RenderState` and a `Camera`. It does not query ECS, does not own animation/PBD logic, does not know about VFX semantics.
4. **ECS data-flow contract** — `RenderState` (persistent-mapped, per-frame-in-flight) is populated by ECS systems through small typed writer APIs. Components stay POD.
5. **Event bus** — typed frame-buffered queues (Bevy `Events<T>` model) with 2-frame retention. CommandDispatcher and scene-loader switch from direct renderer mutation to event emission.
6. **Diagnostic tier system** — three-tier model (always-on / compile-time / runtime env-var), with `gs::dbg::ScopedLabel` (RAII Vulkan Debug Utils), `GS_DBG_INVARIANT` (compile-time-gated heavy checks), and an `enum class Diag` registry for env-var toggles.
7. **`GSEURAT_DEBUG_FORCE` CMake option** — third build profile (release with diagnostics) for catching optimization-dependent bugs.
8. **Regression safety harness** — Game Director golden-frame scenario covering the canonical island_demo walk; SSIM diff against `main` baseline; validation-layer-clean assertion; per-pass GPU timing budget.

### Out of scope (deferred to Phase 2 or later)

- **Frame graph / render graph framework.** Considered as Question 2 option (C); rejected as over-engineering at current scale. The system-centric split provides most of the benefit. Revisit if pass count grows beyond ~20 or if explicit transient-resource aliasing becomes a memory pressure point.
- **GPU-side region tagging compute pass** for `gs_scene_animations_`. Currently soft-disabled in streaming-strict mode (PR #388). Restoring this is non-trivial and depends on the `RenderState` contract being in place; targeted for Phase 2.
- **VFX-object dirty-flag** to avoid 50ms `StallWarn` from per-frame 200K-splat memcpy. Will benefit from Phase 1's writer APIs (the writer can naturally track dirty ranges) but the actual optimization is a Phase 2 concern.
- **Multi-threaded SystemScheduler.** Current scheduler is sequential. Event bus design is compatible with future parallelism but Phase 1 keeps strict serial execution.
- **Dynamic per-frame-in-flight count.** Hard-coded `kMaxFramesInFlight = 2` per locked decision. Revisit only if a specific need (e.g., HDR display chain) emerges.
- **Renderer plug-in API for parent projects** (e.g., a hypothetical "Bricklayer-as-renderer-host" use case). The system-centric split makes future extraction easier, but this is not a Phase 1 deliverable.

---

## 3. Architectural Principles

The three user-stated pillars, with the locked-in design decisions:

| Pillar | Locked decision |
|---|---|
| **High cohesion, low coupling** | System-centric split (Q2 option B). Each system owns its passes + pipelines + descriptor sets. Inter-system communication via events or RenderState only. |
| **Graphics traceability** | `vk::raii`-friendly `gs::dbg::ScopedLabel` RAII type wraps `vkCmdBeginDebugUtilsLabelEXT` / `End`. Object names via `vkSetDebugUtilsObjectNameEXT`. Two-level label hierarchy: outer per-system, inner per-dispatch. |
| **Performance-safe debug modes** | Three tiers: always-on (`NDEBUG`-gated, existing), compile-time (`GSEURAT_DEBUG_BUILD`, new), runtime env-var (`gs::dbg::Diag`, extends existing `GS_DIAG_STREAMING`). Macros only where expression-unevaluation matters; `constexpr` + RAII elsewhere. |

### Foundational invariants the design enforces

1. **Renderer is pure data-flow.** `GsRenderer::render(cmd, render_state, camera, frame_idx)` is the entire surface area. No ECS query, no game state read, no event subscription.
2. **Vulkan headers are confined.** `vulkan.h` is included by `gs_renderer/*`, `render_state.{hpp,cpp}`, and `gs::dbg` only. ECS components and systems compile without Vulkan headers.
3. **Per-frame-in-flight is centralized.** Only `RenderState` indexes by `frame_idx`. Individual systems and components are unaware of frame multiplicity.
4. **Events are pure data.** `events.send(T)` has no observable side effects; consumers poll explicitly.
5. **Streaming is the only path.** Legacy code is deleted, not gated. Every code path that exists at runtime is reachable in streaming-strict mode.

---

## 4. Current State Snapshot (baseline measurements)

Captured for regression and ROI tracking. All numbers from `main` at commit `5fc4c6a9` (post-#388 merge).

### `gs_renderer.cpp` size and seams

- **LOC:** 3,919 (cpp) + 768 (hpp) = **4,687 total**
- **Private field count:** ~214 (header lines 389–766)
- **GPU passes dispatched:** 14
  - Sort group: `onesweep_hist_pipeline_`, `onesweep_scatter_pipeline_`
  - Tile-bin group: `tile_count_pipeline_`, `tile_scan_pipeline_`, `tile_indirect_pipeline_`, `tile_bin_pipeline_`, `tile_ranges_pipeline_`, `tile_render_pipeline_`
  - Other: `render_pipeline_` (legacy full rasterize, deletion candidate), `preprocess_pipeline_`, `merge_pipeline_`, `pbd_pipeline_`, `post_process_pipeline_`

### Major method line ranges (for refactor cross-reference)

| Function | Lines | Phase |
|---|---|---|
| `init_streaming` | 631–934 | survives |
| `load_cloud` (legacy entry point) | 935–1043 | **Phase 1a delete** |
| `unload_cloud`, `clear_chunks`, `chunk_inventory` | 1044–1273 | survives (chunk lifecycle) |
| `poll_transfers` + `diag_streaming_dump` | 1332–1547 | survives |
| `publish_pending_chunks` | 1548–1813 | survives, moves to `GsStreamingSystem` |
| `load_cloud_legacy` | 1814–2079 | **Phase 1a delete** |
| `update_static_gaussians` (legacy gather/stomp) | 2080–2117 | **Phase 1b delete** |
| `update_dynamic_gaussians` | 2118–2153 | survives, refactored against `RenderState` |
| `ensure_capacity` (legacy growth) | 2154–2228 | **Phase 1b delete** |
| `dispatch_depth_onesweep` | 2952–3003 | moves to `GsSortSystem` |
| `dispatch_tile_sort` | 3004–3243 | moves to `GsTileBinSystem` |
| `render` (main per-frame, ~460 LOC) | 3244–3705 | becomes ~80-line orchestrator |

### ECS coupling pain points

| Today | File:Line | Phase 4 fix |
|---|---|---|
| AppBase reads `gs_animator_`, drives `update_dynamic_gaussians` | `src/engine/renderer.cpp:1106–1434` | 4b: `BoneAnimationSystem → bones_writer()` |
| `CommandDispatcher` mutates `vfx_instances_mutable()` | `src/engine/command_dispatcher.cpp` | 4a: emit `VfxSpawnEvent` |
| Scene loader calls `renderer.upload_pbd_elements()` | `src/engine/gs_scene_loader.cpp:289` | 4d: emit `PbdElementsLoadedEvent` |
| `kMaxFramesInFlight` indexing scattered through renderer | many | centralized in `RenderState` |

### Existing diagnostic infrastructure (preserve and extend)

- **Validation layers:** `VK_LAYER_KHRONOS_validation` enabled in `vk_context.cpp:113–141` under `#ifndef NDEBUG`. Keep as-is.
- **Debug dump registry:** `include/gseurat/engine/debug_dump.hpp` (231 LOC, concept-based, on-demand JSON export). Each new system in Phase 5 implements `DebugDumpable` and registers with `app.debug_dump_registry().register_module(&dumper)`.
- **`GS_DIAG_STREAMING` env var:** `gs_renderer.cpp:1435–1447`. Migrates to `gs::dbg::Diag::StreamingState` registry in Phase 2.
- **Vulkan Debug Utils:** **not currently used.** Phase 2 introduces.

---

## 5. Target Architecture

### 5.1 The new renderer surface

```cpp
// include/gseurat/engine/gs_renderer.hpp (post-Phase 5)
class GsRenderer {
public:
  GsRenderer(VkContext&, GsResourceManager&);
  void render(VkCommandBuffer cmd,
              const RenderState& state,
              const Camera& camera,
              FrameIndex frame_idx) noexcept;
private:
  // Owns the systems; ~80 LOC of orchestration in render().
  GsStreamingSystem    streaming_;
  GsSortSystem         sort_;
  GsTileBinSystem      tile_bin_;
  GsPostProcessSystem  post_;
};
```

`render()` body is a sequence of `GS_LABEL`-bracketed system calls:

```cpp
void GsRenderer::render(VkCommandBuffer cmd, const RenderState& s,
                        const Camera& cam, FrameIndex idx) noexcept {
  GS_LABEL(cmd, "GsRenderer::frame");
  streaming_.process_pending(cmd, s, idx);   // GS_LABEL inside: "Streaming"
  sort_.dispatch(cmd, s, cam, idx);          // GS_LABEL inside: "Sort"
  tile_bin_.dispatch(cmd, s, cam, idx);      // GS_LABEL inside: "TileBin"
  post_.dispatch(cmd, s, idx);               // GS_LABEL inside: "PostProcess"
}
```

### 5.2 `RenderState` (the contract)

`RenderState` is the single object through which ECS systems push data to the renderer. It owns persistent-mapped Vulkan buffers (double-buffered per frame-in-flight) and exposes typed writer APIs.

```cpp
// include/gseurat/engine/render_state.hpp
namespace gs {

inline constexpr uint32_t kMaxFramesInFlight = 2;  // compile-time constant

class RenderState {
public:
  RenderState(VkContext&, GsResourceManager&);

  // === Writers — called from ECS systems during update() ===
  // All writers take frame_idx ∈ [0, kMaxFramesInFlight).
  BonesWriter        bones_writer(FrameIndex);
  VfxWriter          vfx_writer(FrameIndex);
  PbdWriter          pbd_writer(FrameIndex);
  ParticlesWriter    particles_writer(FrameIndex);
  PointLightsWriter  point_lights_writer(FrameIndex);

  // === Renderer-side read access — const, called from GsRenderer::render() ===
  VkBuffer bones_buffer(FrameIndex) const noexcept;
  VkBuffer vfx_splats_buffer(FrameIndex) const noexcept;
  VkBuffer pbd_elements_buffer(FrameIndex) const noexcept;
  // ... etc

  // === Lifecycle ===
  void begin_frame(FrameIndex);  // resets dirty ranges
  void end_frame(FrameIndex);    // flushes mapped writes if non-coherent

private:
  std::array<PerFrameData, kMaxFramesInFlight> per_frame_;
};

// Writer example — typed, slot-indexed, dirty-range-tracking
class BonesWriter {
public:
  void write(uint32_t slot, const glm::mat4& transform) noexcept;
  size_t capacity() const noexcept;
  // No commit() — RenderState::end_frame() handles flushing.
};

}  // namespace gs
```

**Ownership:** `RenderState` is owned by `AppBase`. Passed by mutable reference to `SystemScheduler::update()` (via `World` resource), passed by const reference to `GsRenderer::render()`.

**Per-frame-in-flight discipline:** Only `RenderState` indexes by `frame_idx`. ECS systems request a writer for the current frame and write through it. Renderer reads buffers for the same frame index. Synchronization with the GPU (waiting on the previous frame's fence before reusing slot N) is handled inside `RenderState::begin_frame()` via the existing in-flight fence already in `VkContext`.

**Migration shape:** Today, ~200K splats × 64B = ~12 MB of dynamic data. RenderState's persistent-mapped buffers replace per-frame staging+memcpy with direct mapped writes. Writers track dirty ranges so `end_frame()` can issue a minimal `vkFlushMappedMemoryRanges` (only required for non-coherent memory; on Apple Silicon's unified memory it's a no-op).

### 5.3 Event Bus

Bevy `Events<T>` model: per-event-type typed queues with 2-frame retention.

```cpp
// include/gseurat/engine/ecs/events.hpp
namespace gs::ecs {

inline constexpr uint32_t kEventRetentionFrames = 2;

template <typename T>
class EventQueue {
public:
  void send(T evt) noexcept;
  std::span<const T> read(EventCursor& cursor) const noexcept;
  size_t pending_count() const noexcept;  // for debug dump
  void rotate() noexcept;                 // called by EventCleanupStage at end-of-frame
private:
  std::array<std::vector<T>, kEventRetentionFrames> buffers_;
  uint8_t write_idx_;
};

// Per-consumer cursor — tracks last seen event across rotates.
// Implementation detail (per-buffer index vs monotonic event-id counter)
// finalized during writing-plans; both are workable.
struct EventCursor {
  size_t last_read_per_buffer[kEventRetentionFrames] = {0, 0};
};

// World provides typed access:
template <typename T> EventQueue<T>& World::events() noexcept;

}  // namespace gs::ecs
```

**Scheduler integration:** A new `EventCleanupStage` runs as the final stage of `SystemScheduler::update()`, calling `rotate()` on every registered event queue. Events sent in frame N are visible to consumers in frame N (current buffer) and frame N+1 (previous buffer).

**Phase 4 migration map:**

| Phase | Producer site | Event type | Consumer |
|---|---|---|---|
| 4a | `CommandDispatcher::handle_vfx_spawn()` | `VfxSpawnEvent { preset, position, rotation }` | `VfxSystem` |
| 4d | `gs_scene_loader.cpp:289` | `PbdElementsLoadedEvent { elements, constraints }` | `PbdSystem` |
| 4d | scene loader, point-light load | `PointLightsLoadedEvent { lights }` | `LightingSystem` |
| 4e | particle emitter trigger | `ParticleEmitterEvent { emitter_id, ... }` | `ParticleSystem` |

### 5.4 Diagnostic tier system

Three tiers, each with a different cost profile:

| Tier | Mechanism | Examples | Release cost |
|---|---|---|---|
| **A: Always-on** | `assert()`, validation layers gated by `NDEBUG` | Pre/post-conditions; layer warnings | 0 (existing pattern) |
| **B: Compile-time** | `GSEURAT_DEBUG_BUILD` macro + `gs::dbg::kEnabled` constexpr | `GS_LABEL`, `GS_DBG_INVARIANT`, `set_object_name` | 0 (becomes `((void)0)`) |
| **C: Runtime env-var** | `gs::dbg::Diag` enum + `enabled()` lookup | Per-frame streaming dump, GPU timing print, chunk inventory | Single `bool` load on hot paths |

#### Header sketch

```cpp
// include/gseurat/engine/debug.hpp
namespace gs::dbg {

inline constexpr bool kEnabled = GSEURAT_DEBUG_BUILD;  // CMake-defined: 1 in Debug, 0 in Release

// === Tier B: RAII Vulkan Debug Utils ===
class ScopedLabel {
  VkCommandBuffer cmd_;
public:
  ScopedLabel(VkCommandBuffer cmd, const char* name,
              glm::vec4 color = {0.5f, 0.5f, 0.5f, 1.0f}) noexcept;
  ~ScopedLabel() noexcept;
  ScopedLabel(const ScopedLabel&) = delete;
  ScopedLabel& operator=(const ScopedLabel&) = delete;
};

void set_object_name(VkDevice, VkObjectType, uint64_t handle, const char* name) noexcept;

// === Tier C: env-var diag registry ===
enum class Diag : uint16_t {
  StreamingState,    // GS_DIAG_STREAMING
  GpuTiming,         // GS_DIAG_GPU_TIMING
  ChunkInventory,    // GS_DIAG_CHUNKS
  RenderStateSlots,  // GS_DIAG_RENDERSTATE
  EventQueueSizes,   // GS_DIAG_EVENTS
};

bool enabled(Diag) noexcept;   // O(1) lookup; populated once at startup from getenv

// === Tier B: invariant — argument unevaluated when disabled ===
void invariant_failed(const char* expr, const char* msg, const char* file, int line) noexcept;

}  // namespace gs::dbg

#if GSEURAT_DEBUG_BUILD
  #define GS_DBG_INVARIANT(cond, msg) \
    do { if (!(cond)) ::gs::dbg::invariant_failed(#cond, msg, __FILE__, __LINE__); } while (0)
  #define GS_LABEL(cmd, name) \
    ::gs::dbg::ScopedLabel _gs_dbg_label_##__LINE__((cmd), (name))
#else
  #define GS_DBG_INVARIANT(cond, msg) ((void)0)
  #define GS_LABEL(cmd, name) ((void)0)
#endif
```

#### CMake integration

```cmake
# CMakeLists.txt additions
option(GSEURAT_DEBUG_FORCE "Force debug instrumentation in Release builds" OFF)

target_compile_definitions(gseurat_core PRIVATE
    GSEURAT_DEBUG_BUILD=$<OR:$<CONFIG:Debug>,$<BOOL:${GSEURAT_DEBUG_FORCE}>>
)
```

This gives a third build profile via a new preset:
```json
{
  "name": "macos-release-with-diag",
  "inherits": "macos-release",
  "cacheVariables": { "GSEURAT_DEBUG_FORCE": "ON" }
}
```

### 5.5 System decomposition (post-Phase 5)

```
include/gseurat/engine/gs_renderer/
├── gs_renderer.hpp              orchestrator (~150 LOC header + ~80 LOC body)
├── render_state.hpp             RenderState + writers
├── gs_resources.hpp             GsResourceManager — passive struct of buffer/image handles
├── streaming/
│   ├── gs_streaming_system.hpp  chunk lifecycle, transfer queue, page table, publish
│   └── gs_streaming_system.cpp  (~700 LOC, lifted intact from current renderer)
├── sort/
│   └── gs_sort_system.{hpp,cpp} onesweep histogram + scatter, merge (~400 LOC)
├── tile_bin/
│   └── gs_tile_bin_system.{hpp,cpp}  6-pass tile-bin chain (~600 LOC)
└── post/
    └── gs_post_process_system.{hpp,cpp}  fog, tone, DOF (~300 LOC)

include/gseurat/engine/debug.hpp     gs::dbg:: header
src/engine/debug.cpp                  ScopedLabel + Diag registry impl

include/gseurat/engine/ecs/events.hpp EventQueue<T> + World::events<T>()
src/engine/ecs/event_cleanup_stage.cpp Scheduler integration
```

`GsResourceManager` is a passive struct (per Q2 sub-decision) — pure data, no behavior:

```cpp
// include/gseurat/engine/gs_renderer/gs_resources.hpp
struct GsResourceManager {
  // Output images, per frame in flight
  std::array<vk::raii::Image, kMaxFramesInFlight> output_image;
  std::array<vk::raii::Image, kMaxFramesInFlight> depth_image;
  std::array<vk::raii::Image, kMaxFramesInFlight> processed_image;

  // Splat SSBOs
  vk::raii::Buffer static_gaussian_ssbo;
  vk::raii::Buffer projected_ssbo;
  vk::raii::Buffer merged_sort_ssbo;
  vk::raii::Buffer static_sort_a;
  vk::raii::Buffer static_sort_b;
  // ... ~30 buffers total

  // No methods. Systems hold references and call vk APIs directly.
};
```

---

## 6. Rollout

Strict serial execution. One PR merged green before the next begins. Each PR passes the regression-safety gate (§7).

### Phase 0: Pre-flight (foundation)

| PR | Branch | Description | Risk | Touches |
|---|---|---|---|---|
| 0a | `refactor/0a-debug-header` | `gs::dbg::` header + CMake `GSEURAT_DEBUG_FORCE` + new `release-with-diag` preset. No callers yet. | Low | new files only |
| 0b | `refactor/0b-golden-frames` | Game Director regression harness (§7). | Low | `scripts/`, `tests/` only |

### Phase 1: Deletion

| PR | Branch | Description | Risk |
|---|---|---|---|
| 1a | `refactor/1a-purge-ply-legacy` | Delete `load_cloud_legacy` (lines 1814–2079). Move PLY parse code to new `tools/ply_importer/` (offline utility, not linked into `gseurat_core`). | Medium |
| 1b | `refactor/1b-purge-streaming-legacy` | Delete `update_static_gaussians` gather (2080–2117), `ensure_capacity` legacy growth (2154–2228), `gs_chunk_grid_` runtime culling in `renderer.cpp`, legacy branch of `add_vfx_instance`. | High |
| 1c | `refactor/1c-purge-fullras` | **Conditional.** Verify `tile_render_pipeline_` covers all `render_pipeline_` use cases under streaming-strict. If yes, delete. If no, document why and skip. | Medium |

**Phase 1 verification:** Pixel-identical golden-frame match against pre-deletion `main`. If pixel drift > SSIM threshold, deletion was incomplete or incorrect.

### Phase 2: Instrumentation

| PR | Branch | Description | Risk |
|---|---|---|---|
| 2 | `refactor/2-debug-utils` | Add `GS_LABEL` to every dispatch site in current (post-deletion) renderer. Add `GS_DBG_INVARIANT` for the `static_count_ == sum(active_chunks_)` invariant and ~5 other known invariants. Migrate `GS_DIAG_STREAMING` getenv to `gs::dbg::Diag` registry. | Low |

**Phase 2 verification:** RenderDoc capture of golden-frame scenario; verify label hierarchy is sensible. Validation layer clean.

### Phase 3: Infrastructure

| PR | Branch | Description | Risk |
|---|---|---|---|
| 3a | `refactor/3a-event-bus` | `EventQueue<T>` template + `World::events<T>()` accessor + `EventCleanupStage` registered with `SystemScheduler`. **No callers migrated yet.** | Low |
| 3b | `refactor/3b-render-state` | `RenderState` passive struct with persistent-mapped buffers and writer APIs. AppBase constructs and owns it. **Renderer signature does not change yet** — RenderState is built but unused. Validates the buffer creation/mapping path. | Medium |

### Phase 4: Caller migration

| PR | Branch | Description | Risk |
|---|---|---|---|
| 4a | `refactor/4a-cmd-events` | `CommandDispatcher` emits `VfxSpawnEvent` instead of `vfx_instances_mutable()`. New `VfxSystem` consumes events. | Medium |
| 4b | `refactor/4b-bones-writer` | `BoneAnimationSystem` writes via `RenderState::bones_writer()`. Renderer's `update_dynamic_gaussians` reads from RenderState. | Medium |
| 4c | `refactor/4c-vfx-pbd-writers` | `VfxSystem` writes via `vfx_writer()`; PBD via `pbd_writer()`. Removes `gs_animator_`/`vfx_instances_` from AppBase. | Medium |
| 4d | `refactor/4d-scene-loader-events` | Scene loader emits `PbdElementsLoadedEvent`, `PointLightsLoadedEvent`. Removes direct `upload_pbd_elements`/`set_point_lights` calls. | Medium |
| 4e | `refactor/4e-misc-writers` | Particle systems, point lights — final cleanup of AppBase shared state. | Low |

**Phase 4 verification (per PR):** AppBase no longer references the migrated subsystem's data directly. Renderer signature progressively narrowed. Golden-frame match.

### Phase 5: Renderer system extraction

| PR | Branch | Description | Risk |
|---|---|---|---|
| 5a | `refactor/5a-resource-mgr` | Lift `GsResourceManager` (passive struct) out of `GsRenderer`. Pass by reference to all dispatch methods. | High |
| 5b | `refactor/5b-post-process` | Extract `GsPostProcessSystem` (single pass, lowest coupling — go first to establish patterns). | Medium |
| 5c | `refactor/5c-sort-system` | Extract `GsSortSystem` (3 passes, well-bounded). | High |
| 5d | `refactor/5d-tile-bin-system` | Extract `GsTileBinSystem` (6-pass chain). | High |
| 5e | `refactor/5e-streaming-system` | Extract `GsStreamingSystem`. `GsRenderer::render()` becomes ~80 LOC orchestrator. | Highest |

**Phase 5 verification:** End of phase, `GsRenderer::render()` is < 100 LOC and contains no `vkCmdDispatch` or `vkCmdDraw` calls — all GPU work delegated to systems.

---

## 7. Regression Safety Harness (Phase 0b deep-dive)

The single most important deliverable. Without this, the refactor will regress something subtle and we won't notice until weeks later.

### Components

1. **Canonical 60-second walkthrough scenario.** Defined in `scripts/regression/island_demo_canonical.py` — a Game Director script that:
   - Boots fresh (no save state)
   - Spawns at island start
   - Walks to portal A (forest entrance)
   - Triggers portal transition
   - Walks 30 seconds through forest
   - Returns through portal
   - Lingers 5 seconds at start (post-portal "flashback" detection window)
2. **Frame capture cadence.** 12 golden frames at fixed timestamps (t=0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55s). Captured via `screenshot` command into `tests/regression/golden/<commit>/`.
3. **SSIM diff harness.** `scripts/regression/diff_golden.py` — compares current run against `main` baseline. Threshold: SSIM ≥ 0.985 per frame (allows minor floating-point drift, catches geometry/color regressions). Threshold tunable via `--ssim-threshold`.
4. **Validation-layer assertion.** Run scenario with `release-with-diag` build; assert zero validation warnings/errors on stderr.
5. **Diag invariant assertion.** Run with `GS_DIAG_STREAMING=1`; assert `static_count == sum(active_chunks_.splats)` invariant holds for entire 60s.
6. **GPU timing budget.** Capture per-pass timing via `VK_EXT_calibrated_timestamps` at t=10, 30, 50s. Compare against baseline; fail if any pass regresses > 5% (configurable).

### CI integration

```yaml
# .github/workflows/regression.yml
- name: Build release-with-diag
  run: cmake --build --preset macos-release-with-diag
- name: Run regression harness
  run: python3 scripts/regression/run_harness.py --baseline main --threshold 0.985
- name: Upload diff artifacts on failure
  if: failure()
  uses: actions/upload-artifact@v4
  with:
    path: tests/regression/diff/
```

### Baseline establishment

Phase 0b's PR captures golden frames against `main` at `5fc4c6a9` (post-#388). Every subsequent PR diffs against this baseline. The baseline is updated only when intentional visual changes ship (separate from refactor PRs).

### What the harness catches

- Geometric regressions (splats in wrong position, missing chunks, ghost geometry)
- Color/shading regressions (wrong descriptor binding, uninitialized buffer, post-process pipeline mis-wired)
- Streaming corruption (chunk publish race, sort-tail leak, page-table desync) — **these are the bugs that motivated this refactor**
- Validation layer regressions (descriptor type mismatch, barrier omission, layout transition error)
- Performance regressions (per-pass timing drift, indirect-dispatch correctness)

### What the harness does NOT catch

- Audio regressions (separate harness, out of scope here)
- Save/load regressions (separate harness)
- UI regressions in Bricklayer/Echidna (different test suites)
- Bugs that only manifest after > 60s of play (we accept this; 60s catches the streaming ghost class of bugs)

---

## 8. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Phase 1b deletion misses a live caller** | Medium | High | Phase 0b harness catches visual regression. Granular PR (1a/1b/1c) limits blast radius. Code review checklist: grep for every removed symbol before merge. |
| **`render_pipeline_` removal in 1c breaks an edge case** (e.g., low-end GPU fallback) | Medium | Medium | 1c is **conditional**. If audit reveals any caller, skip the PR and document. |
| **Persistent-mapped buffer race in `RenderState`** (system writes while GPU reads previous frame's data) | Medium | High | `RenderState::begin_frame()` waits on the previous frame's fence before allowing writes. `GS_DBG_INVARIANT` checks slot < capacity in writer. RenderDoc trace + golden-frame harness catches data races visually. |
| **Event cursor desync** (consumer reads stale events after rotate) | Low | Medium | Cursor is consumer-owned and tracks per-buffer last-read index. Unit test: send 1000 events, consume in chunks, verify no duplicate / no skip. |
| **Phase 5d (TileBinSystem) is too coupled to extract cleanly** | Medium | High | The 6-pass chain is intentionally kept as one system (Q2 decision). Extraction is mechanical (lift class, no logic change). If during execution the coupling is worse than expected, fall back to leaving TileBin as the largest remaining system in `GsRenderer`. |
| **`GSEURAT_DEBUG_FORCE` build profile breaks Release optimizations** | Low | Low | Only enables instrumentation; does not change `-O3`. Validate via `release-with-diag` golden-frame timing budget — must match Release within 10%. |
| **Refactor takes longer than 4 weeks** | Medium | Low | Each PR is independently shippable. Phase 1 alone delivers value (cleaner code, smaller renderer) even if Phase 4-5 is paused. No big-bang merges. |
| **Reviewer fatigue on 15+ PRs** | High | Medium | Each PR has a single, narrow purpose. PR descriptions follow a template (purpose, files touched, golden-frame diff link, validation log). Pair-review on highest-risk PRs (1b, 5a, 5e). |

---

## 9. Open Questions / Deferred

1. **Should `GsResourceManager` use `vk::raii` or raw handles?** Recommend `vk::raii::Buffer` / `vk::raii::Image` for RAII cleanup, matching modern Vulkan-Hpp idiom. Verify it compiles cleanly under `-fno-rtti` if applicable.
2. **`EventQueue<T>` allocation strategy.** Default to `std::vector<T>` (allocations per send). For hot-path events (>1k/frame), revisit with a small-buffer-optimized queue. Not a Phase 1 concern.
3. **Naming: `system` vs `subsystem`.** I used `GsStreamingSystem`, `GsSortSystem`, etc. throughout. The ECS layer also has "systems". Naming collision is acceptable because they're in different namespaces (`gs::ecs::*System` vs `gs::*System`), but document the convention in CONTRIBUTING. Alternative: `Pass` (e.g., `GsTileBinPass`) — less accurate since each owns multiple GPU dispatches.
4. **What replaces `gs_scene_animations_` after Phase 1?** Currently soft-disabled in streaming-strict (PR #388). The Phase 2 GPU region-tagging compute pass is out of scope here but should be planned alongside this refactor — it will be cleaner to land against the new `RenderState` contract.
5. **Echidna / Bricklayer integration impact.** The renderer surface narrows to `render(cmd, state, cam, idx)`. Verify Bricklayer's render preview path still works after Phase 5e (it should — Bricklayer constructs its own RenderState).

---

## 10. Glossary

- **`RenderState`** — the typed contract object owned by AppBase, populated by ECS systems via writers, consumed by `GsRenderer::render()`.
- **Writer** — a small typed API on RenderState (e.g., `BonesWriter`) that ECS systems use to push data without touching Vulkan.
- **Frame-in-flight (`FrameIndex`)** — integer ∈ [0, kMaxFramesInFlight). RenderState double-buffers per frame index.
- **Tier B / Tier C** — diagnostic tiers. Tier B is compile-time-gated (`GSEURAT_DEBUG_BUILD`); Tier C is runtime env-var-gated.
- **System** (in this doc, capitalized) — a Phase 5 unit of decomposition (e.g., `GsSortSystem`). Distinct from ECS systems (lower-case "system").
- **Phase X PR Y** — a specific PR in the rollout (e.g., "Phase 4 PR 4b" = `refactor/4b-bones-writer`).

---

## 11. Approval gate

This design is ready for review. Upon approval:

1. Spec is committed to `main` (via separate PR off `feature/refactor-phase1-design`).
2. Implementation transitions to the **writing-plans** skill, which will produce `docs/superpowers/plans/2026-05-XX-engine-refactor-phase1-plan.md` — a step-by-step PR-by-PR plan with checkpoints.
3. Phase 0 begins.
