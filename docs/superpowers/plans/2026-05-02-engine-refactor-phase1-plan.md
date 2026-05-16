# Engine Refactor Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the GSeurat Vulkan engine over 17 PRs to (1) purge legacy runtime paths that caused the streaming-strict ghost-debugging saga (PRs #385–#388), (2) split the 4,687 LOC `gs_renderer` God Class into 5 cohesive systems, (3) enforce ECS purity (no Vulkan headers, communicate via components and typed events), and (4) install a tiered diagnostic system with Vulkan Debug Utils labels and a release-with-diagnostics build profile — all gated by an automated golden-frame regression harness running in deterministic mode.

**Architecture:** System-centric decomposition (Resource Manager + Streaming + Sort + TileBin + PostProcess) consumed by an ~80-line `GsRenderer::render()` orchestrator. ECS systems push data into a persistent-mapped `RenderState` (double-buffered per frame-in-flight) via small typed writer APIs. CommandDispatcher and scene loader emit Bevy-style frame-buffered typed events instead of poking renderer state directly. Three diagnostic tiers: always-on (NDEBUG-gated, existing), compile-time (`GSEURAT_DEBUG_BUILD`, new), runtime (`gs::dbg::Diag` env-var registry, extends existing `GS_DIAG_STREAMING`). New `release-with-diag` build profile via `GSEURAT_DEBUG_FORCE` CMake option.

**Tech Stack:** C++23, Vulkan 1.3 (with `VK_EXT_debug_utils` already enabled in Debug builds), VMA, GLFW, GLM, nlohmann/json, miniaudio, MoltenVK on macOS / native Vulkan on Linux+Windows. CMake with presets. Standalone-binary test pattern via `add_gseurat_test()` macro. Game Director regression harness on Python via Unix socket at `/tmp/gseurat.sock`.

**Spec:** `docs/superpowers/specs/2026-05-02-engine-refactor-phase1-design.md` (commit `9ecb35f7`).

---

## Status update (2026-05-17)

Audited against `main` at `9a7ede5f`. The strict-serial 17-PR cadence below did not survive contact with reality — most of the refactor landed organically alongside other work. PR-level task breakdowns in §Phase 1–5 are preserved as historical record; current status is tracked in the matrix below and in the spec doc's matching "Status update" section.

| Phase | Status | Open work |
|---|---|---|
| 0 | ✅ DONE (#390, #391) | — |
| 1 | ✅ DONE (closed via #455–458 on 2026-05-16) | — |
| 2 | ✅ DONE | Legacy non-GS draw labels skipped on purpose (Phase 5e deletion candidates) |
| 3 | ✅ DONE | — |
| 4 | ⚠️ MOSTLY DONE | `VfxWriter` / `PbdWriter` / `ParticlesWriter` / `PointLightsWriter` declared but unused. Wire them so ECS systems push render data into `RenderState` instead of the renderer pulling from AppBase. Only `BonesWriter` has a caller today. |
| 5 | ⚠️ MOSTLY DONE | `gs_renderer.cpp` is 2388 LOC (was 3919). `GsRenderer::render()` at line 1733+ still holds orchestration logic — not yet ~80 LOC. Phase 5e final extraction outstanding; blocked on Phase 4 writer wiring landing first. |

**Next:** Close the Phase 4 writer gap (small, focused PRs per writer), then Phase 5e.

---

## How to use this plan

This plan covers 17 PRs across 5 phases plus pre-flight Phase 0. **Strict serial execution** — each PR merges green before the next begins. Per-phase detail level:

| Phase | Detail level | Why |
|---|---|---|
| **Phase 0** | Full bite-sized step-by-step | Immediately actionable; foundation for everything else |
| **Phases 1–5** | PR-level breakdown (files, key changes, validation gate, commit message) | Codebase will shift during Phase 0 execution; over-specifying now creates rot |

When each later phase is about to begin, write a detailed sub-plan for its PRs using the same writing-plans skill, referencing this plan's PR-level breakdown as the spec input.

**Branch hygiene rules** (apply to every PR in this plan):
1. Each PR lives on its own branch named `refactor/<N>-<topic>` (e.g., `refactor/0a-debug-header`).
2. Each PR uses its own worktree at `.worktrees/refactor-<N>-<topic>` — never switch branches in the main checkout.
3. Branch is created from `main` (latest), not from a previous refactor branch.
4. Commits never go to `main` directly. PR-and-merge workflow only.
5. All PRs follow the **per-PR validation gate** below before merge.

**Per-PR validation gate** (template applied to every PR):

```
1. Build: cmake --build --preset macos-debug              ✓ green
2. Build: cmake --build --preset macos-release-with-diag  ✓ green   (after PR 0a lands)
3. Validation layers: zero warnings/errors in regression scenario   (after PR 0b lands)
4. Regression harness: SSIM ≥ 0.985 vs baseline                     (after PR 0b lands)
5. Determinism self-check: SSIM = 1.000 on repeated runs            (after PR 0b lands)
6. GS_DIAG_STREAMING invariant: static_count == sum(active_chunks)  (after PR 2 lands)
7. GPU timing budget: per-pass ≤ 5% regression vs baseline          (after PR 0b lands)
```

Items 3–7 are PR-0b-conditional: they activate as their dependencies land. Until PR 0b ships, the gate is "build green + manual playtest".

---

# Phase 0 — Foundation

Two PRs, executed serially. PR 0a delivers the diagnostic header; PR 0b delivers Determinism Mode and the regression harness. **No refactor work begins until both are merged.**

## PR 0a: `gs::dbg::` header + CMake

**Branch:** `refactor/0a-debug-header`
**Worktree:** `.worktrees/refactor-0a-debug-header`
**Risk:** Low
**Dependencies:** none

### File structure for PR 0a

| Action | Path | Purpose |
|---|---|---|
| Create | `include/gseurat/engine/debug.hpp` | Public `gs::dbg` API: `kEnabled` constexpr, `ScopedLabel` RAII class, `set_object_name`, `Diag` enum, `enabled(Diag)`, `invariant_failed`, `GS_LABEL` and `GS_DBG_INVARIANT` macros |
| Create | `src/engine/debug.cpp` | Implementation: load `vkCmd{Begin,End}DebugUtilsLabelEXT` and `vkSetDebugUtilsObjectNameEXT` function pointers; populate `Diag` registry from `getenv` once at startup; `invariant_failed` aborts with formatted message |
| Modify | `src/engine/vk_context.cpp:125-142` | After `setup_debug_messenger`, call `gs::dbg::init_function_pointers(instance_)` and `gs::dbg::init_diag_registry()` |
| Modify | `include/gseurat/engine/vk_context.hpp` | Expose `instance_` getter if not present (needed for `gs::dbg::set_object_name`) |
| Modify | `CMakeLists.txt` | Add `option(GSEURAT_DEBUG_FORCE ...)`; set `target_compile_definitions(gseurat_core PRIVATE GSEURAT_DEBUG_BUILD=...)` |
| Modify | `CMakePresets.json` | Add `macos-release-with-diag` preset inheriting from `base`, `CMAKE_BUILD_TYPE=Release`, `GSEURAT_DEBUG_FORCE=ON` |
| Create | `tests/test_debug.cpp` | Standalone-binary test (per `add_gseurat_test()` pattern): verify `Diag::enabled` reflects env vars; verify `GS_DBG_INVARIANT` no-ops in release |
| Modify | `CMakeLists.txt:371-387` | Add `add_gseurat_test(debug)` |

### Tasks

- [ ] **Task 1: Create branch and worktree**

```bash
cd /Users/eccyan/dev/GSeurat
git fetch origin
git worktree add .worktrees/refactor-0a-debug-header -b refactor/0a-debug-header origin/main
cd .worktrees/refactor-0a-debug-header
git status   # should show clean tree on refactor/0a-debug-header
```

- [ ] **Task 2: Create `include/gseurat/engine/debug.hpp` header skeleton**

```cpp
// include/gseurat/engine/debug.hpp
#pragma once

#include <vulkan/vulkan.h>
#include <glm/vec4.hpp>
#include <cstdint>

#ifndef GSEURAT_DEBUG_BUILD
#  define GSEURAT_DEBUG_BUILD 0
#endif

namespace gs::dbg {

inline constexpr bool kEnabled = (GSEURAT_DEBUG_BUILD != 0);

// === Tier B: RAII Vulkan Debug Utils label ===
class ScopedLabel {
 public:
  ScopedLabel(VkCommandBuffer cmd, const char* name,
              glm::vec4 color = {0.5f, 0.5f, 0.5f, 1.0f}) noexcept;
  ~ScopedLabel() noexcept;

  ScopedLabel(const ScopedLabel&) = delete;
  ScopedLabel& operator=(const ScopedLabel&) = delete;
  ScopedLabel(ScopedLabel&&) = delete;
  ScopedLabel& operator=(ScopedLabel&&) = delete;

 private:
  VkCommandBuffer cmd_;
};

// === Tier B: object naming ===
void set_object_name(VkDevice device, VkObjectType type,
                     std::uint64_t handle, const char* name) noexcept;

// === Tier C: env-var diag registry ===
enum class Diag : std::uint16_t {
  StreamingState,    // GS_DIAG_STREAMING
  GpuTiming,         // GS_DIAG_GPU_TIMING
  ChunkInventory,    // GS_DIAG_CHUNKS
  RenderStateSlots,  // GS_DIAG_RENDERSTATE
  EventQueueSizes,   // GS_DIAG_EVENTS
  COUNT_
};

bool enabled(Diag) noexcept;

// === Lifecycle (called from VkContext) ===
void init_function_pointers(VkInstance instance) noexcept;
void init_diag_registry() noexcept;  // populates from getenv once

// === Tier B: invariant — argument unevaluated when disabled ===
[[noreturn]] void invariant_failed(const char* expr, const char* msg,
                                    const char* file, int line) noexcept;

}  // namespace gs::dbg

#if GSEURAT_DEBUG_BUILD
  #define GS_DBG_INVARIANT(cond, msg) \
    do { if (!(cond)) ::gs::dbg::invariant_failed(#cond, msg, __FILE__, __LINE__); } while (0)
  #define GS_LABEL_CONCAT_IMPL(a, b) a##b
  #define GS_LABEL_CONCAT(a, b) GS_LABEL_CONCAT_IMPL(a, b)
  #define GS_LABEL(cmd, name) \
    ::gs::dbg::ScopedLabel GS_LABEL_CONCAT(_gs_dbg_label_, __LINE__)((cmd), (name))
#else
  #define GS_DBG_INVARIANT(cond, msg) ((void)0)
  #define GS_LABEL(cmd, name) ((void)0)
#endif
```

- [ ] **Task 3: Create `src/engine/debug.cpp` implementation**

```cpp
// src/engine/debug.cpp
#include "gseurat/engine/debug.hpp"

#include <array>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace gs::dbg {

namespace {

PFN_vkCmdBeginDebugUtilsLabelEXT  g_begin_label = nullptr;
PFN_vkCmdEndDebugUtilsLabelEXT    g_end_label   = nullptr;
PFN_vkSetDebugUtilsObjectNameEXT  g_set_name    = nullptr;

std::array<bool, static_cast<std::size_t>(Diag::COUNT_)> g_diag_flags{};

constexpr const char* env_var_for(Diag d) noexcept {
  switch (d) {
    case Diag::StreamingState:   return "GS_DIAG_STREAMING";
    case Diag::GpuTiming:        return "GS_DIAG_GPU_TIMING";
    case Diag::ChunkInventory:   return "GS_DIAG_CHUNKS";
    case Diag::RenderStateSlots: return "GS_DIAG_RENDERSTATE";
    case Diag::EventQueueSizes:  return "GS_DIAG_EVENTS";
    case Diag::COUNT_:           break;
  }
  return "";
}

}  // namespace

ScopedLabel::ScopedLabel(VkCommandBuffer cmd, const char* name, glm::vec4 color) noexcept
    : cmd_(cmd) {
  if constexpr (kEnabled) {
    if (g_begin_label) {
      VkDebugUtilsLabelEXT label{};
      label.sType      = VK_STRUCTURE_TYPE_DEBUG_UTILS_LABEL_EXT;
      label.pLabelName = name;
      label.color[0]   = color.r;
      label.color[1]   = color.g;
      label.color[2]   = color.b;
      label.color[3]   = color.a;
      g_begin_label(cmd_, &label);
    }
  }
}

ScopedLabel::~ScopedLabel() noexcept {
  if constexpr (kEnabled) {
    if (g_end_label) g_end_label(cmd_);
  }
}

void set_object_name(VkDevice device, VkObjectType type,
                     std::uint64_t handle, const char* name) noexcept {
  if constexpr (kEnabled) {
    if (g_set_name) {
      VkDebugUtilsObjectNameInfoEXT info{};
      info.sType        = VK_STRUCTURE_TYPE_DEBUG_UTILS_OBJECT_NAME_INFO_EXT;
      info.objectType   = type;
      info.objectHandle = handle;
      info.pObjectName  = name;
      g_set_name(device, &info);
    }
  }
}

bool enabled(Diag d) noexcept {
  const auto idx = static_cast<std::size_t>(d);
  return idx < g_diag_flags.size() && g_diag_flags[idx];
}

void init_function_pointers(VkInstance instance) noexcept {
  if constexpr (kEnabled) {
    g_begin_label = reinterpret_cast<PFN_vkCmdBeginDebugUtilsLabelEXT>(
        vkGetInstanceProcAddr(instance, "vkCmdBeginDebugUtilsLabelEXT"));
    g_end_label = reinterpret_cast<PFN_vkCmdEndDebugUtilsLabelEXT>(
        vkGetInstanceProcAddr(instance, "vkCmdEndDebugUtilsLabelEXT"));
    g_set_name = reinterpret_cast<PFN_vkSetDebugUtilsObjectNameEXT>(
        vkGetInstanceProcAddr(instance, "vkSetDebugUtilsObjectNameEXT"));
  }
}

void init_diag_registry() noexcept {
  for (std::size_t i = 0; i < g_diag_flags.size(); ++i) {
    const char* var = env_var_for(static_cast<Diag>(i));
    if (var[0] == '\0') continue;
    const char* val = std::getenv(var);
    g_diag_flags[i] = (val && val[0] == '1');
  }
}

[[noreturn]] void invariant_failed(const char* expr, const char* msg,
                                    const char* file, int line) noexcept {
  std::fprintf(stderr, "[gs::dbg INVARIANT FAILED] %s\n  expr: %s\n  at: %s:%d\n",
               msg, expr, file, line);
  std::abort();
}

}  // namespace gs::dbg
```

- [ ] **Task 4: Wire into `vk_context.cpp`**

Modify `src/engine/vk_context.cpp`. After `setup_debug_messenger()` returns (end of line 142), add a call to initialize `gs::dbg`:

```cpp
// Add include at top of file:
#include "gseurat/engine/debug.hpp"

// Inside init() or wherever setup_debug_messenger() is called,
// AFTER setup_debug_messenger() returns:
gs::dbg::init_function_pointers(instance_);
gs::dbg::init_diag_registry();
```

Cross-reference: vk_context.cpp:26 already calls `setup_debug_messenger()` after `create_instance()`. Insert the two `gs::dbg::init_*` calls immediately after that call site.

- [ ] **Task 5: Update CMakeLists.txt with `GSEURAT_DEBUG_BUILD` definition and `GSEURAT_DEBUG_FORCE` option**

Locate the `gseurat_core` target definition in `CMakeLists.txt`. Add:

```cmake
option(GSEURAT_DEBUG_FORCE "Force debug instrumentation in Release builds" OFF)

# Apply to gseurat_core target (location: search for `add_library(gseurat_core ...)`)
target_compile_definitions(gseurat_core PRIVATE
    GSEURAT_DEBUG_BUILD=$<IF:$<OR:$<CONFIG:Debug>,$<BOOL:${GSEURAT_DEBUG_FORCE}>>,1,0>
)

# Add debug.cpp to gseurat_core sources
target_sources(gseurat_core PRIVATE src/engine/debug.cpp)
```

Verify `include/gseurat/engine/debug.hpp` is reachable via existing target_include_directories on `gseurat_core`.

- [ ] **Task 6: Add `macos-release-with-diag` preset to `CMakePresets.json`**

Insert after the existing `macos-release` preset (around line 103):

```json
{
  "name": "macos-release-with-diag",
  "inherits": "base",
  "displayName": "macOS Release with Diagnostics",
  "description": "Release build with GPU labels and invariant checks (release-with-diag profile)",
  "cacheVariables": {
    "CMAKE_BUILD_TYPE": "Release",
    "GSEURAT_DEBUG_FORCE": "ON"
  },
  "condition": {
    "type": "equals",
    "lhs": "${hostSystemName}",
    "rhs": "Darwin"
  }
}
```

Add a corresponding `buildPresets` entry below if the file has a `buildPresets` section.

- [ ] **Task 7: Verify all three build profiles compile cleanly**

```bash
cmake --preset macos-debug && cmake --build --preset macos-debug --target gseurat_core
cmake --preset macos-release && cmake --build --preset macos-release --target gseurat_core
cmake --preset macos-release-with-diag && cmake --build --preset macos-release-with-diag --target gseurat_core
```

Expected: all three produce `gseurat_core` static library with no warnings/errors. If `-Wno-unused-function` complaints appear from `kEnabled=false` paths, that's expected and harmless (the `if constexpr` branches dead-code-eliminate).

- [ ] **Task 8: Smoke-test `GS_LABEL` in the running engine**

Insert a single `GS_LABEL` at the top of `GsRenderer::render()` to verify integration. In `src/engine/gs_renderer.cpp` (find `render(` around line 3244):

```cpp
void GsRenderer::render(/* existing args */) {
  GS_LABEL(cmd, "GsRenderer::render (smoke test)");   // ← add this line
  // ... existing body unchanged
}
```

Build with `macos-release-with-diag`, run the demo, capture a frame in RenderDoc. Verify the label appears in the trace. Then **remove the smoke-test line** (PR 2 will add labels comprehensively).

- [ ] **Task 9: Write unit test for `Diag` registry**

Create `tests/test_debug.cpp`:

```cpp
// tests/test_debug.cpp
#include "gseurat/engine/debug.hpp"

#include <cassert>
#include <cstdio>
#include <cstdlib>

int main() {
  // Default: no diag flags set
  gs::dbg::init_diag_registry();
  assert(!gs::dbg::enabled(gs::dbg::Diag::StreamingState));
  assert(!gs::dbg::enabled(gs::dbg::Diag::GpuTiming));

  // Set env var, re-init, verify flag flips
  setenv("GS_DIAG_STREAMING", "1", 1);
  gs::dbg::init_diag_registry();
  assert(gs::dbg::enabled(gs::dbg::Diag::StreamingState));
  assert(!gs::dbg::enabled(gs::dbg::Diag::GpuTiming));

  // "0" should be off, only "1" enables
  setenv("GS_DIAG_STREAMING", "0", 1);
  gs::dbg::init_diag_registry();
  assert(!gs::dbg::enabled(gs::dbg::Diag::StreamingState));

  std::printf("test_debug: OK\n");
  return 0;
}
```

Add to `CMakeLists.txt` (search for `add_gseurat_test(` to find the right location):

```cmake
add_gseurat_test(debug)
```

- [ ] **Task 10: Run the test**

```bash
cmake --build --preset macos-debug --target test_debug
ctest --preset macos-debug -R "^debug$" --output-on-failure
```

Expected: `test_debug: OK` and ctest reports 1/1 passing.

- [ ] **Task 11: Commit**

```bash
git add include/gseurat/engine/debug.hpp \
        src/engine/debug.cpp \
        src/engine/vk_context.cpp \
        CMakeLists.txt \
        CMakePresets.json \
        tests/test_debug.cpp
git commit -m "$(cat <<'EOF'
feat(engine): add gs::dbg diagnostic header (Phase 0a)

Three-tier diagnostic infrastructure:
- Tier B (compile-time, GSEURAT_DEBUG_BUILD): GS_LABEL RAII for Vulkan
  Debug Utils labels, GS_DBG_INVARIANT macro (expression unevaluated
  when disabled), set_object_name helper.
- Tier C (runtime env-var): gs::dbg::Diag enum + enabled() lookup,
  initialized once from getenv at VkContext::init.

CMake: new GSEURAT_DEBUG_FORCE option enables Tier B in Release builds.
New macos-release-with-diag preset inherits from base + CMAKE_BUILD_TYPE
Release + GSEURAT_DEBUG_FORCE=ON. Spec: §5.4.

Test (tests/test_debug.cpp): verifies Diag registry reflects env var
state across re-init.

Closes Phase 0a per docs/superpowers/specs/2026-05-02-engine-refactor-phase1-design.md
EOF
)"
git push -u origin refactor/0a-debug-header
```

- [ ] **Task 12: Open PR**

```bash
gh pr create --title "refactor(engine): add gs::dbg diagnostic header (Phase 0a)" \
  --body "$(cat <<'EOF'
## Summary
Phase 0a of the engine refactor (spec: docs/superpowers/specs/2026-05-02-engine-refactor-phase1-design.md).

Adds three-tier diagnostic infrastructure as foundation for Phase 2 instrumentation. Zero behavioral change to the running engine — `GS_LABEL` and `GS_DBG_INVARIANT` are not yet inserted into any production code path.

## Changes
- New header `include/gseurat/engine/debug.hpp` — `gs::dbg::ScopedLabel` (RAII), `set_object_name`, `Diag` enum + `enabled()` lookup, `GS_LABEL` and `GS_DBG_INVARIANT` macros
- New `src/engine/debug.cpp` — function pointer loading from `vkGetInstanceProcAddr`; env var → flag bitmap at startup
- `vk_context.cpp` calls `gs::dbg::init_function_pointers` + `init_diag_registry` after debug messenger setup
- New CMake option `GSEURAT_DEBUG_FORCE` + new preset `macos-release-with-diag`
- Standalone test `tests/test_debug.cpp`

## Test plan
- [ ] `cmake --build --preset macos-debug` clean
- [ ] `cmake --build --preset macos-release` clean
- [ ] `cmake --build --preset macos-release-with-diag` clean
- [ ] `ctest --preset macos-debug -R "^debug$"` passes
- [ ] Manual: insert temporary GS_LABEL into render(), capture in RenderDoc, verify hierarchy visible

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Task 13: Validation gate**

After PR opens, wait for CI. Required green: build (Debug, Release, Release-with-diag), `test_debug` passing. No regression suite yet (PR 0b adds it).

- [ ] **Task 14: Merge**

```bash
gh pr merge --merge --delete-branch=false
```

(Per project convention from PR #388, branches are not deleted on merge.)

---

## PR 0b: Determinism Mode + golden-frame regression harness

**Branch:** `refactor/0b-golden-frames`
**Worktree:** `.worktrees/refactor-0b-golden-frames`
**Risk:** Medium
**Dependencies:** PR 0a merged

### File structure for PR 0b

| Action | Path | Purpose |
|---|---|---|
| Create | `include/gseurat/engine/sim_clock.hpp` | `gs::SimClock` abstraction — wall-clock or simulated time |
| Create | `src/engine/sim_clock.cpp` | Implementation |
| Create | `include/gseurat/engine/random.hpp` | Seeded RNG facade — single source for all engine randomness |
| Create | `src/engine/random.cpp` | Implementation |
| Modify | `src/engine/trigger_systems.cpp` | Replace `std::random_device`/`std::mt19937` with `gs::random` |
| Modify | `src/engine/camera.cpp` | Replace RNG with `gs::random` |
| Modify | `include/gseurat/engine/scoped_timer.hpp` | Route `steady_clock::now` through `gs::SimClock` (or document why it stays — see Task 7) |
| Modify | `src/engine/save_system.cpp` | Route clock through `gs::SimClock` (or document why it stays) |
| Modify | `src/demo/gs_demo_state.cpp` | Route clock through `gs::SimClock` |
| Modify | `src/engine/app_base.cpp:?` | Tick uses `gs::SimClock::dt()` instead of wall-clock delta |
| Modify | `src/demo/demo_app.cpp:27-37` | Add `--deterministic` CLI flag parsing |
| Modify | `src/demo/demo_app.{hpp,cpp}` | Plumb `deterministic_` bool into `gs::SimClock` and `gs::random::seed()` |
| Create | `scripts/regression/island_demo_canonical.py` | Canonical 60s walkthrough scenario |
| Create | `scripts/regression/run_harness.py` | Build + run + capture + diff orchestrator |
| Create | `scripts/regression/diff_golden.py` | SSIM diff implementation |
| Create | `tests/regression/baseline/.gitkeep` | Directory for baseline frames |
| Create | `tests/regression/README.md` | Documents baseline regeneration procedure |
| Create | `.github/workflows/regression.yml` | CI workflow: macOS pixel diff + Linux/Windows build-only |
| Create | `tests/test_sim_clock.cpp` | Verify deterministic mode produces fixed-step time |
| Create | `tests/test_random.cpp` | Verify same seed produces identical sequences |
| Modify | `CMakeLists.txt` | Add `add_gseurat_test(sim_clock)` and `add_gseurat_test(random)` |

### Tasks

- [ ] **Task 1: Create branch and worktree**

```bash
cd /Users/eccyan/dev/GSeurat
git worktree add .worktrees/refactor-0b-golden-frames -b refactor/0b-golden-frames origin/main
cd .worktrees/refactor-0b-golden-frames
```

- [ ] **Task 2: Define `gs::SimClock` interface (`include/gseurat/engine/sim_clock.hpp`)**

```cpp
// include/gseurat/engine/sim_clock.hpp
#pragma once

#include <cstdint>

namespace gs {

class SimClock {
 public:
  // Initialize. If deterministic=true, time advances strictly via tick(dt);
  // wall-clock methods return simulated time. If false, all methods return
  // wall-clock time and tick() is a no-op.
  static void init(bool deterministic) noexcept;

  // Advance simulated time by exactly fixed_dt seconds.
  // No-op in non-deterministic mode.
  static void tick() noexcept;

  // Current time in seconds since init.
  static double now_seconds() noexcept;

  // Current time in milliseconds (integer truncation).
  static std::uint64_t now_ms() noexcept;

  // Fixed delta-time per tick (deterministic mode only).
  // Always returns 1.0/60.0 regardless of mode (callers should use this
  // instead of measuring real elapsed time).
  static constexpr double fixed_dt() noexcept { return 1.0 / 60.0; }

  static bool is_deterministic() noexcept;
};

}  // namespace gs
```

- [ ] **Task 3: Implement `gs::SimClock` (`src/engine/sim_clock.cpp`)**

```cpp
// src/engine/sim_clock.cpp
#include "gseurat/engine/sim_clock.hpp"

#include <chrono>

namespace gs {

namespace {
bool g_deterministic = false;
double g_sim_seconds = 0.0;
std::chrono::steady_clock::time_point g_wall_origin{};
}  // namespace

void SimClock::init(bool deterministic) noexcept {
  g_deterministic = deterministic;
  g_sim_seconds = 0.0;
  g_wall_origin = std::chrono::steady_clock::now();
}

void SimClock::tick() noexcept {
  if (g_deterministic) {
    g_sim_seconds += fixed_dt();
  }
}

double SimClock::now_seconds() noexcept {
  if (g_deterministic) {
    return g_sim_seconds;
  }
  using D = std::chrono::duration<double>;
  return std::chrono::duration_cast<D>(
             std::chrono::steady_clock::now() - g_wall_origin).count();
}

std::uint64_t SimClock::now_ms() noexcept {
  return static_cast<std::uint64_t>(now_seconds() * 1000.0);
}

bool SimClock::is_deterministic() noexcept { return g_deterministic; }

}  // namespace gs
```

- [ ] **Task 4: Define `gs::random` facade (`include/gseurat/engine/random.hpp`)**

```cpp
// include/gseurat/engine/random.hpp
#pragma once

#include <cstdint>

namespace gs::random {

// Seed once at startup. Determinism mode uses a fixed seed (0xC0FFEE);
// normal mode uses std::random_device.
void seed(std::uint64_t seed) noexcept;
void seed_from_device() noexcept;

// Uniform float in [0, 1).
float next_float() noexcept;

// Uniform int in [lo, hi].
int next_int(int lo, int hi) noexcept;

// Uniform uint in [0, 2^32).
std::uint32_t next_u32() noexcept;

}  // namespace gs::random
```

- [ ] **Task 5: Implement `gs::random` (`src/engine/random.cpp`)**

```cpp
// src/engine/random.cpp
#include "gseurat/engine/random.hpp"

#include <random>

namespace gs::random {

namespace {
std::mt19937_64 g_rng{0xC0FFEE};
}  // namespace

void seed(std::uint64_t s) noexcept { g_rng.seed(s); }

void seed_from_device() noexcept {
  std::random_device rd;
  g_rng.seed(static_cast<std::uint64_t>(rd()) ^
             (static_cast<std::uint64_t>(rd()) << 32));
}

float next_float() noexcept {
  std::uniform_real_distribution<float> dist(0.0f, 1.0f);
  return dist(g_rng);
}

int next_int(int lo, int hi) noexcept {
  std::uniform_int_distribution<int> dist(lo, hi);
  return dist(g_rng);
}

std::uint32_t next_u32() noexcept {
  return static_cast<std::uint32_t>(g_rng());
}

}  // namespace gs::random
```

- [ ] **Task 6: Audit and migrate RNG sites**

Run from worktree root:

```bash
grep -rn "std::random_device\|std::mt19937\|rand()" src/ include/ \
  --include="*.cpp" --include="*.hpp" --include="*.h"
```

Expected sites (from prior survey): `src/engine/trigger_systems.cpp` (2 sites), `src/engine/camera.cpp` (1 site).

For each site:
1. Remove `std::mt19937 rng_(std::random_device{}());` field/local
2. Replace usages: `dist(rng_)` → `gs::random::next_float()` / `gs::random::next_int(...)` etc.
3. Add `#include "gseurat/engine/random.hpp"` to the file

- [ ] **Task 7: Audit and migrate clock sites**

Run from worktree root:

```bash
grep -rn "steady_clock::now\|system_clock::now\|high_resolution_clock::now" \
  src/ include/ --include="*.cpp" --include="*.hpp" --include="*.h"
```

Expected sites: `src/engine/app_base.cpp` (frame-time calculation), `include/gseurat/engine/scoped_timer.hpp` (perf timing — keep wall-clock; ScopedTimer is for human-visible perf reporting, not simulation), `src/engine/save_system.cpp` (timestamp on save — keep wall-clock; user wants real save dates), `src/demo/gs_demo_state.cpp` (likely simulation-affecting — migrate), `include/gseurat/engine/debug_dump.hpp` (timestamp on dump — keep wall-clock).

For each site, **decide**:
- Simulation-affecting (animation phase, particle spawn time, PBD wind, frame dt) → **migrate to `gs::SimClock::now_seconds()` or `fixed_dt()`**
- Human-facing (perf timing, save timestamps, debug dump timestamps) → **keep wall-clock** but document why with a one-line comment

For `app_base.cpp` specifically: the frame loop must use `gs::SimClock::fixed_dt()` for the simulation tick when `is_deterministic()`. If it currently does `dt = clock.delta()`, change to:

```cpp
const double dt = gs::SimClock::is_deterministic() ?
                  gs::SimClock::fixed_dt() :
                  /* existing wall-clock delta */;
gs::SimClock::tick();  // advances sim time in deterministic mode
```

- [ ] **Task 8: Add `--deterministic` CLI flag in `src/demo/demo_app.cpp:27-37`**

Edit `parse_args`:

```cpp
void DemoApp::parse_args(int argc, char* argv[]) {
    for (int i = 1; i < argc; ++i) {
        std::string_view arg(argv[i]);
        if (arg == "--scene" && i + 1 < argc) {
            scene_path_ = argv[++i];
            scene_path_explicit_ = true;
        } else if (arg == "--viewer") {
            viewer_mode_ = true;
        } else if (arg == "--deterministic") {     // new
            deterministic_ = true;                  // new
        }
    }
}
```

Add `bool deterministic_ = false;` to `DemoApp` private members in the corresponding header.

In `DemoApp::run()` or wherever `SimClock::init` belongs, wire it:

```cpp
gs::SimClock::init(deterministic_);
if (deterministic_) {
    gs::random::seed(0xC0FFEE);
} else {
    gs::random::seed_from_device();
}
```

- [ ] **Task 9: Disable vsync in deterministic mode**

Locate the swapchain present mode selection (search for `VK_PRESENT_MODE_FIFO_KHR` in `src/engine/`). When `gs::SimClock::is_deterministic()` is true at swapchain creation, prefer `VK_PRESENT_MODE_IMMEDIATE_KHR` if available, otherwise fallback to whatever non-vsync mode the device supports.

- [ ] **Task 10: Write `gs::SimClock` and `gs::random` tests**

Create `tests/test_sim_clock.cpp`:

```cpp
// tests/test_sim_clock.cpp
#include "gseurat/engine/sim_clock.hpp"
#include <cassert>
#include <cmath>
#include <cstdio>

int main() {
  // Deterministic mode: tick advances by exactly fixed_dt
  gs::SimClock::init(true);
  assert(gs::SimClock::is_deterministic());
  assert(gs::SimClock::now_seconds() == 0.0);

  gs::SimClock::tick();
  // 1/60 = 0.01666..., compare with epsilon
  const double dt = gs::SimClock::fixed_dt();
  const double t1 = gs::SimClock::now_seconds();
  assert(std::fabs(t1 - dt) < 1e-9);

  for (int i = 0; i < 59; ++i) gs::SimClock::tick();
  const double t60 = gs::SimClock::now_seconds();
  assert(std::fabs(t60 - 1.0) < 1e-6);  // 60 ticks = 1.0s

  // Non-deterministic mode: tick is a no-op; now_seconds returns wall-clock
  gs::SimClock::init(false);
  assert(!gs::SimClock::is_deterministic());
  const double w0 = gs::SimClock::now_seconds();
  gs::SimClock::tick();
  const double w1 = gs::SimClock::now_seconds();
  assert(w1 >= w0);  // wall-clock monotonic
  // Don't assert on tick being no-op precisely — wall-clock advances regardless.

  std::printf("test_sim_clock: OK\n");
  return 0;
}
```

Create `tests/test_random.cpp`:

```cpp
// tests/test_random.cpp
#include "gseurat/engine/random.hpp"
#include <cassert>
#include <cstdio>
#include <vector>

int main() {
  // Same seed → identical sequence
  gs::random::seed(42);
  std::vector<float> a;
  for (int i = 0; i < 100; ++i) a.push_back(gs::random::next_float());

  gs::random::seed(42);
  std::vector<float> b;
  for (int i = 0; i < 100; ++i) b.push_back(gs::random::next_float());

  for (size_t i = 0; i < a.size(); ++i) {
    assert(a[i] == b[i]);  // bit-exact
  }

  // Different seed → different sequence (statistically)
  gs::random::seed(43);
  std::vector<float> c;
  for (int i = 0; i < 100; ++i) c.push_back(gs::random::next_float());
  bool any_differ = false;
  for (size_t i = 0; i < a.size(); ++i) {
    if (a[i] != c[i]) { any_differ = true; break; }
  }
  assert(any_differ);

  std::printf("test_random: OK\n");
  return 0;
}
```

Add to `CMakeLists.txt` near other `add_gseurat_test()` calls:

```cmake
add_gseurat_test(sim_clock)
add_gseurat_test(random)
```

- [ ] **Task 11: Run determinism tests**

```bash
cmake --build --preset macos-debug --target test_sim_clock test_random
ctest --preset macos-debug -R "^(sim_clock|random)$" --output-on-failure
```

Expected: both pass.

- [ ] **Task 12: Manual determinism verification — pixel-identical playback**

Build the demo and run twice with the same flags, capturing one frame each:

```bash
cmake --build --preset macos-release-with-diag --target gseurat_demo

./build/macos-release-with-diag/gseurat_demo --deterministic &
DEMO_PID=$!
sleep 5
python3 scripts/game_director.py screenshot --output /tmp/det_run1.png
kill $DEMO_PID

./build/macos-release-with-diag/gseurat_demo --deterministic &
DEMO_PID=$!
sleep 5
python3 scripts/game_director.py screenshot --output /tmp/det_run2.png
kill $DEMO_PID

# Compare — should be byte-identical
diff /tmp/det_run1.png /tmp/det_run2.png
```

Expected: `diff` produces no output (files are byte-identical). If they differ, determinism is incomplete — track down the source by re-running the audit with verbose grep and bisecting which subsystem changes between runs. Common culprits:
- A `std::random_device` site missed in the audit
- A `std::chrono` site reading wall-clock during simulation
- An audio thread executing before/after first frame at different times
- A texture-streaming or shader-cache cold/warm path

Do not proceed until this passes. **Determinism is a hard prerequisite for the rest of Phase 0b.**

- [ ] **Task 13: Write the canonical 60s scenario script (`scripts/regression/island_demo_canonical.py`)**

```python
"""Canonical 60-second island_demo walkthrough for regression diffing.

Run via: python3 scripts/regression/run_harness.py
Standalone: python3 scripts/regression/island_demo_canonical.py --output-dir <dir>

The engine MUST be running with --deterministic. Frame-aligned input dispatch
ensures the same scenario produces bit-identical pixels across runs.
"""
import argparse
import os
import socket
import sys
import time

SOCKET_PATH = "/tmp/gseurat.sock"

# Frames at which to capture screenshots (60Hz simulation, 60s total).
CAPTURE_FRAMES = [0, 300, 600, 900, 1200, 1500, 1800, 2100, 2400, 2700, 3000, 3300]

# Frame-aligned input timeline: (frame_number, action_string).
INPUT_TIMELINE = [
    (1,    "key_down W"),       # start walking forward
    (300,  "goto portal_a"),    # teleport to portal entrance (5s in)
    (360,  "key_up W"),
    (361,  "key_down W"),       # walk through portal
    (420,  "key_up W"),
    (1200, "goto forest_mid"),  # 20s in: forest checkpoint
    (1201, "key_down W"),
    (1800, "key_up W"),         # 30s: stop in forest
    (1801, "goto portal_a"),    # 30s+1f: trigger return portal
    (2400, "key_down S"),       # 40s: walk backward at start
    (2700, "key_up S"),         # 45s: stop
    # 3300 = end (linger 5s for post-portal flashback detection window)
]

def send(sock, command):
    sock.sendall((command + "\n").encode())
    return sock.recv(65536).decode()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--socket", default=SOCKET_PATH)
    args = parser.parse_args()
    os.makedirs(args.output_dir, exist_ok=True)

    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.connect(args.socket)

    # Step engine in deterministic mode: 1 frame per "step" command.
    timeline_idx = 0
    capture_set = set(CAPTURE_FRAMES)
    for frame in range(3301):
        # Dispatch any inputs scheduled for this frame.
        while timeline_idx < len(INPUT_TIMELINE) and INPUT_TIMELINE[timeline_idx][0] == frame:
            send(sock, INPUT_TIMELINE[timeline_idx][1])
            timeline_idx += 1

        send(sock, "step 1")  # advance 1 simulation frame

        if frame in capture_set:
            out_path = os.path.join(args.output_dir, f"frame_{frame:05d}.png")
            send(sock, f"screenshot {out_path}")

    sock.close()
    print(f"Captured {len(CAPTURE_FRAMES)} frames to {args.output_dir}")

if __name__ == "__main__":
    main()
```

This depends on the engine's control server supporting `step <n>` (advance N frames in deterministic mode). Verify that command exists in the control server; if not, add it as part of Task 14.

- [ ] **Task 14: Verify or add engine `step` command**

Search `src/engine/` for the control-server command dispatcher (likely `command_dispatcher.cpp` or `control_server.cpp`):

```bash
grep -rn '"step"' src/engine/
```

If `step <n>` exists and advances N frames in deterministic mode without rendering more than N frames, no change needed. If not, add it: dispatcher reads `n`, calls the main loop's tick function `n` times. This is the discrete-time hook that makes frame-by-frame regression possible.

- [ ] **Task 15: Implement SSIM diff (`scripts/regression/diff_golden.py`)**

```python
"""SSIM diff between two directories of PNG frames.

Usage:
    python3 scripts/regression/diff_golden.py \
        --baseline tests/regression/baseline/<commit>/ \
        --current tests/regression/current/ \
        --threshold 0.985
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image

# scikit-image required for SSIM. Install via: pip install scikit-image
from skimage.metrics import structural_similarity as ssim

def load_rgb(path):
    img = Image.open(path).convert("RGB")
    return np.asarray(img, dtype=np.float32) / 255.0

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--current", required=True)
    parser.add_argument("--threshold", type=float, default=0.985)
    parser.add_argument("--report", default=None)
    args = parser.parse_args()

    baseline_files = sorted(f for f in os.listdir(args.baseline) if f.endswith(".png"))
    current_files = sorted(f for f in os.listdir(args.current) if f.endswith(".png"))

    if baseline_files != current_files:
        print(f"FAIL: file set mismatch.\n  baseline: {baseline_files}\n  current: {current_files}",
              file=sys.stderr)
        return 2

    failures = []
    report_lines = []
    for fname in baseline_files:
        b = load_rgb(os.path.join(args.baseline, fname))
        c = load_rgb(os.path.join(args.current, fname))
        if b.shape != c.shape:
            failures.append((fname, "shape mismatch", b.shape, c.shape))
            continue
        score = ssim(b, c, channel_axis=2, data_range=1.0)
        report_lines.append(f"{fname}: SSIM={score:.6f}")
        if score < args.threshold:
            failures.append((fname, "ssim_low", score, args.threshold))

    if args.report:
        with open(args.report, "w") as fh:
            fh.write("\n".join(report_lines) + "\n")
            if failures:
                fh.write("\nFAILURES:\n")
                for f in failures:
                    fh.write(f"  {f}\n")

    if failures:
        for f in failures:
            print(f"FAIL: {f}", file=sys.stderr)
        return 1

    print("\n".join(report_lines))
    print(f"PASS ({len(baseline_files)} frames ≥ {args.threshold})")
    return 0

if __name__ == "__main__":
    sys.exit(main())
```

Add `scikit-image` and `Pillow` to project Python deps. Verify install path or add to `requirements.txt` if one exists.

- [ ] **Task 16: Implement harness orchestrator (`scripts/regression/run_harness.py`)**

```python
"""Run the regression harness: build, run scenario, optionally diff vs baseline.

Modes:
    --self-check       : run scenario twice, assert SSIM=1.0 (determinism check)
    --baseline <ref>   : run scenario, diff vs tests/regression/baseline/<ref>/
    --no-pixel-diff    : run scenario, skip pixel diff (Linux/Windows CI)
    --update-baseline  : run scenario, save output as new baseline (DESTRUCTIVE)
"""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import time

DEMO_BIN = "build/macos-release-with-diag/gseurat_demo"
SCENARIO = "scripts/regression/island_demo_canonical.py"
SOCKET = "/tmp/gseurat.sock"

def run_scenario(out_dir):
    """Spawn engine in deterministic mode, drive the scenario, capture frames."""
    os.makedirs(out_dir, exist_ok=True)
    proc = subprocess.Popen([DEMO_BIN, "--deterministic"],
                            stderr=subprocess.PIPE)
    try:
        # Wait for socket to appear (engine startup).
        t0 = time.time()
        while not os.path.exists(SOCKET):
            if time.time() - t0 > 10:
                raise RuntimeError("engine did not create socket in 10s")
            time.sleep(0.1)
        # Drive the scenario.
        subprocess.run(["python3", SCENARIO,
                        "--output-dir", out_dir,
                        "--socket", SOCKET],
                       check=True)
    finally:
        proc.terminate()
        try: proc.wait(timeout=5)
        except subprocess.TimeoutExpired: proc.kill()

    stderr = proc.stderr.read().decode()
    return stderr

def diff(baseline_dir, current_dir, threshold):
    return subprocess.run([
        "python3", "scripts/regression/diff_golden.py",
        "--baseline", baseline_dir,
        "--current", current_dir,
        "--threshold", str(threshold),
    ]).returncode

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--self-check", action="store_true")
    p.add_argument("--baseline", default=None)
    p.add_argument("--no-pixel-diff", action="store_true")
    p.add_argument("--update-baseline", default=None,
                   help="Path to save new baseline; replaces existing")
    p.add_argument("--threshold", type=float, default=0.985)
    args = p.parse_args()

    if args.self_check:
        with tempfile.TemporaryDirectory() as t1, tempfile.TemporaryDirectory() as t2:
            run_scenario(t1)
            run_scenario(t2)
            rc = diff(t1, t2, threshold=1.0)
            if rc == 0:
                print("DETERMINISM SELF-CHECK: PASS (SSIM=1.0 across runs)")
                return 0
            print("DETERMINISM SELF-CHECK: FAIL — engine is non-deterministic", file=sys.stderr)
            return 1

    with tempfile.TemporaryDirectory() as cur:
        stderr = run_scenario(cur)

        # Validation-layer assertion
        if "VK_VALIDATION" in stderr or "VUID-" in stderr:
            print("VALIDATION LAYER WARNINGS/ERRORS:\n" + stderr, file=sys.stderr)
            return 2

        # Diag invariant assertion (best-effort: check for INVARIANT FAILED in stderr)
        if "INVARIANT FAILED" in stderr:
            print("DIAG INVARIANT VIOLATION:\n" + stderr, file=sys.stderr)
            return 3

        if args.update_baseline:
            if os.path.exists(args.update_baseline):
                shutil.rmtree(args.update_baseline)
            shutil.copytree(cur, args.update_baseline)
            print(f"Baseline updated: {args.update_baseline}")
            return 0

        if args.no_pixel_diff:
            print("Scenario completed (no pixel diff requested)")
            return 0

        if not args.baseline:
            print("--baseline required unless --no-pixel-diff or --update-baseline", file=sys.stderr)
            return 4

        return diff(args.baseline, cur, threshold=args.threshold)

if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Task 17: Establish baseline frames**

Build the demo, capture the first baseline:

```bash
cmake --build --preset macos-release-with-diag --target gseurat_demo
mkdir -p tests/regression/baseline/main
python3 scripts/regression/run_harness.py --update-baseline tests/regression/baseline/main
```

Verify the 12 PNGs were created in `tests/regression/baseline/main/`. Inspect 2-3 visually to confirm they look correct (engine actually rendered the scenario).

- [ ] **Task 18: Self-check determinism end-to-end**

```bash
python3 scripts/regression/run_harness.py --self-check
```

Expected: `DETERMINISM SELF-CHECK: PASS (SSIM=1.0 across runs)`. If FAIL, return to Task 12 and find the remaining non-determinism source.

- [ ] **Task 19: Self-check the harness against the baseline (zero-change diff)**

```bash
python3 scripts/regression/run_harness.py --baseline tests/regression/baseline/main --threshold 0.985
```

Expected: `PASS (12 frames ≥ 0.985)` with all SSIM scores at 1.000000. If any score is below 1.000, the engine has residual non-determinism.

- [ ] **Task 20: Add CI workflow (`.github/workflows/regression.yml`)**

```yaml
name: Regression Harness

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  golden-frames:
    name: Golden Frames (macOS, Apple Silicon)
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
        with: { lfs: true }
      - name: Install Python deps
        run: pip3 install scikit-image Pillow numpy
      - name: Configure
        run: cmake --preset macos-release-with-diag
      - name: Build
        run: cmake --build --preset macos-release-with-diag --target gseurat_demo
      - name: Determinism self-check
        run: python3 scripts/regression/run_harness.py --self-check
      - name: Regression diff vs baseline
        run: python3 scripts/regression/run_harness.py
             --baseline tests/regression/baseline/main
             --threshold 0.985
      - name: Upload diff artifacts on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: regression-diff
          path: tests/regression/diff/

  build-and-validate:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - name: Configure
        run: cmake --preset $(echo ${{ matrix.os }} | sed 's/-latest/-release-with-diag/' | sed 's/ubuntu/linux/')
      - name: Build
        run: cmake --build --preset $(echo ${{ matrix.os }} | sed 's/-latest/-release-with-diag/' | sed 's/ubuntu/linux/')
      - name: Run scenario without pixel diff
        run: python3 scripts/regression/run_harness.py --no-pixel-diff
```

Verify Linux/Windows preset names match what's in `CMakePresets.json`. Adjust the sed expressions or replace with explicit case mapping if presets don't follow this pattern.

- [ ] **Task 21: Write `tests/regression/README.md`**

```markdown
# Regression Harness

The regression harness runs a canonical 60-second walkthrough of `island_demo` in deterministic mode and compares 12 captured frames against a baseline using SSIM diff.

**Hard requirement:** the engine MUST be built with `--preset macos-release-with-diag` (or another `GSEURAT_DEBUG_FORCE=ON` preset) so validation layers and diagnostic tiers are active. Pixel diff runs on macOS only because floating-point rasterization differs across MoltenVK / Lavapipe / AMD / Intel.

## Running locally

```bash
# Self-check determinism (run scenario twice, assert SSIM=1.0)
python3 scripts/regression/run_harness.py --self-check

# Full regression diff vs baseline
python3 scripts/regression/run_harness.py \
    --baseline tests/regression/baseline/main \
    --threshold 0.985
```

## When tests fail

1. **SSIM < threshold:** inspect `tests/regression/diff/` for the failing frames. If the change is intentional (e.g., a deliberate visual change), update the baseline.
2. **Determinism self-check fails:** something in the engine reads wall-clock time or unseeded RNG. Audit recent changes to `src/engine/` and `include/gseurat/engine/` for `std::random_device`, `std::chrono::*::now`, or other entropy sources.
3. **Validation layer warnings:** the harness fails if stderr contains `VK_VALIDATION` or `VUID-` strings. Address the layer warning before merging.

## Updating the baseline

Only update when shipping intentional visual changes:

```bash
python3 scripts/regression/run_harness.py --update-baseline tests/regression/baseline/main
git add tests/regression/baseline/main/
git commit -m "test(regression): update baseline for <reason>"
```

Always commit baseline updates in a separate PR, never alongside refactor/feature changes.

## Adding a frame to the baseline

Edit `scripts/regression/island_demo_canonical.py`: add a frame number to `CAPTURE_FRAMES`. Update the baseline.
```

- [ ] **Task 22: Run full pre-merge gate locally**

```bash
# Build all profiles
cmake --build --preset macos-debug
cmake --build --preset macos-release
cmake --build --preset macos-release-with-diag

# Unit tests
ctest --preset macos-debug --output-on-failure

# Determinism + regression
python3 scripts/regression/run_harness.py --self-check
python3 scripts/regression/run_harness.py --baseline tests/regression/baseline/main --threshold 0.985
```

All steps must pass before commit.

- [ ] **Task 23: Commit and push**

```bash
git add -A   # large change set; review staged files before commit
git status
# Verify: no .build/ artifacts, no .DS_Store, no /tmp paths.
# tests/regression/baseline/main/*.png should be in git (they're ground truth).

git commit -m "$(cat <<'EOF'
feat(engine,scripts): determinism mode + golden-frame regression harness (Phase 0b)

Determinism mode (HARD prerequisite for golden-frame diffing):
- gs::SimClock abstraction: simulated time in deterministic mode,
  wall-clock otherwise. fixed_dt() = 1/60s.
- gs::random facade: single seeded RNG source replacing std::random_device.
- --deterministic CLI flag wired through DemoApp; seeds RNG to 0xC0FFEE,
  initializes SimClock, prefers IMMEDIATE present mode (no vsync pacing).
- Audited and migrated 3 RNG sites and 4 simulation-affecting clock sites.
  Human-facing clocks (perf timing, save timestamps) intentionally left
  on wall-clock; documented with one-line comments.

Golden-frame regression harness:
- scripts/regression/island_demo_canonical.py: 60s walkthrough,
  frame-aligned input dispatch, 12-frame capture cadence.
- scripts/regression/diff_golden.py: SSIM diff (skimage), 0.985 default.
- scripts/regression/run_harness.py: orchestrator. --self-check verifies
  SSIM=1.0 across repeated runs; --baseline diffs vs ground truth;
  --no-pixel-diff for non-macOS CI; --update-baseline for ground-truth
  refresh (DESTRUCTIVE).
- Validation-layer assertion: harness fails if stderr contains
  VK_VALIDATION or VUID- strings.
- .github/workflows/regression.yml: macOS pixel diff + Linux/Windows
  build-and-validate (no pixel diff).

Tests: tests/test_sim_clock.cpp, tests/test_random.cpp.

Spec §7. Closes Phase 0b.
EOF
)"
git push -u origin refactor/0b-golden-frames
```

- [ ] **Task 24: Open PR with explicit baseline-included flag**

```bash
gh pr create --title "feat(engine): determinism mode + regression harness (Phase 0b)" \
  --body "$(cat <<'EOF'
## Summary
Phase 0b: Determinism Mode + golden-frame regression harness — the safety net for the rest of the refactor.

Without this, every subsequent PR risks regressing visuals undetected (the failure mode that reverted two prior attempts in this area). See spec §7 for full design.

## Changes

### Determinism Mode
- `gs::SimClock` abstraction (`include/gseurat/engine/sim_clock.hpp`): simulated time vs wall-clock
- `gs::random` facade (`include/gseurat/engine/random.hpp`): single seeded RNG source
- `--deterministic` CLI flag in `DemoApp::parse_args`
- Audit + migration of 3 RNG sites and 4 sim-affecting clock sites
- Vsync disabled in deterministic mode

### Regression harness
- `scripts/regression/island_demo_canonical.py`: 60s scenario
- `scripts/regression/run_harness.py`: orchestrator
- `scripts/regression/diff_golden.py`: SSIM diff
- `tests/regression/baseline/main/*.png`: ground-truth frames (12 PNGs)
- `.github/workflows/regression.yml`: macOS pixel diff + Linux/Windows build-only

### Tests
- `tests/test_sim_clock.cpp`
- `tests/test_random.cpp`

## Test plan
- [ ] Unit: `ctest --preset macos-debug` includes new sim_clock + random tests
- [ ] Build: all three profiles green
- [ ] Local: `python3 scripts/regression/run_harness.py --self-check` passes
- [ ] Local: `python3 scripts/regression/run_harness.py --baseline tests/regression/baseline/main` passes
- [ ] CI: macos-14 job green; ubuntu/windows build-and-validate green

## Notes for reviewers
- 12 PNGs (~1MB total via Git LFS) added under `tests/regression/baseline/main/`. These are ground truth and should be reviewed visually for sanity, not byte-by-byte.
- Baseline regeneration procedure documented in `tests/regression/README.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Task 25: Merge once green**

```bash
gh pr merge --merge --delete-branch=false
```

After merge, **Phase 0 is complete**. The full per-PR validation gate from this plan's preamble now activates for all subsequent PRs.

---

# Phases 1–5 (PR-level guides)

Each PR below has a focused brief. When the corresponding phase begins, expand its PRs into detailed sub-plans using the writing-plans skill, referencing the spec section and this brief as input.

The validation gate from the plan preamble applies to every PR. Test-plan additions specific to each PR are noted.

---

## Phase 1 — Deletion

Spec §6 Phase 1. Goal: purge legacy runtime paths whose coexistence with streaming caused PRs #385–#388.

### PR 1a: `refactor/1a-purge-ply-legacy`

**Risk:** Medium

**Files to modify or delete:**
- Delete: `gs_renderer.cpp` lines 935–1043 (`load_cloud`) and 1814–2079 (`load_cloud_legacy`)
- Delete: corresponding declarations in `gs_renderer.hpp`
- Audit and update callers — `git grep "load_cloud"` and remove every call site
- Create: `tools/ply_importer/` directory with extracted PLY parsing logic. New CMake target `ply_importer` (executable, **not** linked into `gseurat_core`).
  - `tools/ply_importer/main.cpp` — CLI entry point: `ply_importer <in.ply> <out.gsvx>`
  - `tools/ply_importer/ply_parse.{hpp,cpp}` — PLY parsing logic (extracted as-is from `load_cloud_legacy`)
  - `tools/ply_importer/CMakeLists.txt` — declares the new target

**Validation gate additions:**
- Build `ply_importer` target green
- Smoke test: `ply_importer assets/<some.ply> /tmp/out.gsvx` produces valid `.gsvx`
- Regression harness pass — pixel-identical (SSIM=1.0) since `load_cloud_legacy` was unreachable in streaming-strict mode

**Suggested commit message:**
```
refactor(engine): purge load_cloud_legacy, extract to tools/ply_importer

Phase 1a per spec §6. Removes ~265 LOC of dead PLY-load code from
runtime renderer; extracts parse logic to standalone offline utility.
gseurat_core no longer links PLY parsing.
```

### PR 1b: `refactor/1b-purge-streaming-legacy`

**Risk:** High — touches per-frame data flow.

**Files to modify or delete:**
- Delete: `gs_renderer.cpp` lines 2080–2117 (`update_static_gaussians` legacy gather/stomp)
- Delete: `gs_renderer.cpp` lines 2154–2228 (`ensure_capacity` legacy growth)
- Delete: `renderer.cpp:1127` legacy chunk-cull block (search for `gs_chunk_grid_` and `streaming_strict` — the gated legacy block)
- Delete: `gs_chunk_grid_` field and all references
- Delete: `add_vfx_instance` legacy branch (the `!streaming_initialized()` insertion into `gs_static_buffer_`)
- Delete: `gs_static_buffer_` if no remaining users (verify with `git grep gs_static_buffer_` after the previous deletes)
- Delete: corresponding declarations in headers

**Validation gate additions:**
- Pre-merge: explicit code-review on the deleted symbol set. Reviewer runs `git grep "<symbol>"` for each removed name; must return zero hits.
- Regression harness: SSIM ≥ 0.985 (some sub-ULP shading drift possible due to descriptor binding order changes; **no geometric drift acceptable**)
- `GS_DIAG_STREAMING=1` invariant clean for entire 60s

**Suggested commit message:**
```
refactor(engine): purge legacy streaming-collision paths

Phase 1b per spec §6. Removes update_static_gaussians legacy gather,
ensure_capacity legacy growth, gs_chunk_grid_ runtime culling, and
the !streaming_initialized() branch of add_vfx_instance. These paths
were unreachable in streaming-strict mode (PR #388) and were the root
cause of the static_count_ vs sum(active_chunks_.splats) collision.
```

### PR 1c (conditional): `refactor/1c-purge-fullras`

**Risk:** Medium — only proceed if audit confirms `tile_render_pipeline_` covers all `render_pipeline_` use cases.

**Pre-PR audit (do BEFORE creating worktree):**
1. `git grep "render_pipeline_" src/engine/`
2. For every dispatch site, identify the entry condition. If all entry conditions imply `tile_render_pipeline_` would be a valid substitute → proceed with deletion. If any entry condition exists where `render_pipeline_` is the only correct path → **skip this PR** and document why in spec §9.
3. Document audit findings in `docs/refactor-1c-audit.md` regardless of outcome.

**Files to modify (conditional):**
- Delete: `render_pipeline_` field, creation, and dispatch
- Delete: corresponding shader file if no other pipeline uses it
- Update: `gs_renderer.cpp::render` to dispatch only `tile_render_pipeline_`

**Validation gate additions:** standard regression harness.

---

## Phase 2 — Instrumentation

Spec §6 Phase 2. Goal: add comprehensive Vulkan Debug Utils labels and known-invariant assertions to current (post-deletion) renderer. PR 0a's `gs::dbg` is the foundation.

### PR 2: `refactor/2-debug-utils`

**Risk:** Low — purely additive.

**Files to modify:**
- `src/engine/gs_renderer.cpp` — add `GS_LABEL` to every `vkCmdDispatch` and `vkCmdDraw*` call site. Two-level hierarchy: outer label per logical group (e.g., "Sort", "TileBin"), inner label per dispatch (e.g., "Onesweep::Histogram").
- `src/engine/gs_renderer.cpp:1435–1547` — replace `getenv("GS_DIAG_STREAMING")` with `gs::dbg::enabled(gs::dbg::Diag::StreamingState)`
- Add `GS_DBG_INVARIANT(static_count_ == sum_active_chunk_splats(), "static drift")` at end of `publish_pending_chunks` (the invariant that took 2 weeks to surface in #387)
- Add `GS_DBG_INVARIANT` for any other documented invariant: post-conditions of `unload_cloud`, `clear_chunks`, `init_streaming`
- `vk_context.cpp` after device creation — call `gs::dbg::set_object_name` for the device, queues, and major buffers/images that exist at startup. (For lazily-created buffers, set names at creation site.)

**Validation gate additions:**
- RenderDoc capture: trace shows nested label hierarchy. Manually inspect 3 frames; label tree must be sensible.
- Regression harness clean (SSIM = 1.0 since labels and disabled invariants are no-ops in non-debug builds).

**Suggested commit message:**
```
feat(engine): comprehensive Vulkan Debug Utils labels + invariants

Phase 2 per spec §6. Two-level label hierarchy on every dispatch.
GS_DBG_INVARIANT for static_count vs sum(active_chunks) — would have
caught PR #387 in minutes instead of weeks. set_object_name on all
long-lived buffers/images. Migrates GS_DIAG_STREAMING getenv to
gs::dbg::Diag registry.
```

---

## Phase 3 — Infrastructure

Spec §6 Phase 3. Goal: build event bus and `RenderState` scaffolding before any caller migrates to them. **No callers migrate in this phase.**

### PR 3a: `refactor/3a-event-bus`

**Risk:** Low — additive infrastructure only.

**Files to create:**
- `include/gseurat/engine/ecs/events.hpp` — `EventQueue<T>`, `EventCursor`, `World::events<T>()` accessor
- `src/engine/ecs/events.cpp` — type-erased registry (`World` holds `std::unordered_map<std::type_index, std::unique_ptr<EventQueueBase>>`); `EventCleanupStage` (calls `rotate()` on every queue at end-of-frame)
- `tests/test_event_queue.cpp` — verifies send → read with same-frame and next-frame cursors; rotate behavior with retention=2

**Files to modify:**
- `src/engine/system_scheduler.cpp` — register `EventCleanupStage` as the final stage of `update()`
- `include/gseurat/engine/ecs/world.hpp` — expose `events<T>()` template accessor

**Validation gate additions:** standard. No production callers yet, so no behavior change expected. SSIM = 1.0.

**Suggested commit message:**
```
feat(ecs): typed event queue infrastructure (Bevy Events<T> model)

Phase 3a per spec §5.3. Per-event-type EventQueue<T> with 2-frame
retention; consumers poll via cursor. EventCleanupStage rotates
buffers at end-of-frame. No callers migrated yet — Phase 4.
```

### PR 3b: `refactor/3b-render-state`

**Risk:** Medium — new persistent-mapped buffers, but renderer signature unchanged.

**Files to create:**
- `include/gseurat/engine/render_state.hpp` — `gs::RenderState` class, `kMaxFramesInFlight` constant, writer types (`BonesWriter`, `VfxWriter`, `PbdWriter`, `ParticlesWriter`, `PointLightsWriter`)
- `src/engine/render_state.cpp` — implementation: persistent-mapped buffer creation via VMA, double-buffering by frame_idx, dirty range tracking, `begin_frame` / `end_frame`
- `tests/test_render_state.cpp` — verifies writer slot bounds, dirty range tracking, frame-in-flight isolation

**Files to modify:**
- `src/engine/app_base.cpp` — construct `RenderState` member; call `begin_frame` / `end_frame` in main loop. **Do not yet route callers through it** — that's Phase 4.

**Validation gate additions:** standard. Memory growth visible in `vmaBuildStatsString` — document the increase (~12 MB for double-buffered dynamic data) in PR description.

**Suggested commit message:**
```
feat(engine): RenderState contract (persistent-mapped, double-buffered)

Phase 3b per spec §5.2. Adds gs::RenderState with typed writer APIs
(BonesWriter, VfxWriter, PbdWriter, ParticlesWriter, PointLightsWriter).
Persistent-mapped, double-buffered per frame-in-flight. AppBase
constructs and frames it; no callers migrated yet (Phase 4).
```

---

## Phase 4 — Caller migration

Spec §6 Phase 4. Goal: migrate callers from direct AppBase-state mutation to events and RenderState writers, in subsystem-isolated PRs.

### PR 4a: `refactor/4a-cmd-events`

**Risk:** Medium

**Files to modify:**
- `src/engine/command_dispatcher.cpp` — replace `ctx_.renderer.vfx_instances_mutable()` access with `world.events<VfxSpawnEvent>().send({...})`. Defines `VfxSpawnEvent` struct.
- New: `src/engine/systems/vfx_system.{hpp,cpp}` — consumes `VfxSpawnEvent`, manages VFX entity lifecycle in ECS (initially still backed by `vfx_instances_` data; full ECS-componentization is a future concern).
- Register `VfxSystem` in `system_scheduler.cpp`.

**Validation gate additions:** scenario test triggering VFX via Game Director (`scripts/scenario_runner.py --role vfx-designer` or equivalent). Visual comparison: VFX must spawn at the correct position with the correct preset.

### PR 4b: `refactor/4b-bones-writer`

**Risk:** Medium

**Files to modify:**
- `src/engine/bone_animation_system.cpp` — write computed transforms via `render_state.bones_writer(frame_idx)`
- `src/engine/renderer.cpp:1106-1434` — `update_dynamic_gaussians` reads from RenderState bones buffer instead of `gs_animator_`
- `src/engine/app_base.{hpp,cpp}` — drop `gs_animator_` field; ECS-side BoneAnimationComponent stores per-entity animation state

**Validation gate additions:** scenario must include a bone-animated entity in motion. Frame at t=10s captures animation phase; SSIM ≥ 0.985 expected (sub-ULP differences possible from interpolation reordering).

### PR 4c: `refactor/4c-vfx-pbd-writers`

**Risk:** Medium

**Files to modify:**
- `src/engine/systems/vfx_system.cpp` — write splat data via `render_state.vfx_writer(frame_idx)`
- `src/engine/systems/pbd_system.{hpp,cpp}` — new system; consumes PBD events, writes via `render_state.pbd_writer(frame_idx)`
- `src/engine/renderer.cpp` — drop `vfx_instances_` and `gs_pending_dynamics_` reads; use RenderState
- `src/engine/app_base.{hpp,cpp}` — drop both fields

**Validation gate additions:** scenario must include both VFX active in motion and PBD trees swaying. Determinism is critical here (PBD wind must use seeded RNG). SSIM ≥ 0.985.

### PR 4d: `refactor/4d-scene-loader-events`

**Risk:** Medium

**Files to modify:**
- `src/engine/gs_scene_loader.cpp:289` — emit `PbdElementsLoadedEvent` and `PointLightsLoadedEvent` instead of calling `renderer.upload_pbd_elements` / `set_point_lights`
- `src/engine/systems/pbd_system.cpp` — consume `PbdElementsLoadedEvent`
- New: `src/engine/systems/lighting_system.{hpp,cpp}` — consume `PointLightsLoadedEvent`, write via `render_state.point_lights_writer`

**Validation gate additions:** scenario must include scene-load mid-walkthrough (e.g., portal transition). Pre/post portal frames at t=10s and t=12s must match SSIM ≥ 0.985.

### PR 4e: `refactor/4e-misc-writers`

**Risk:** Low

**Files to modify:**
- Particle systems → `particles_writer`
- Any remaining direct AppBase shared-state reads in renderer
- Remove last residual fields from `AppBase` (if any: `gs_particle_emitters_`, `gs_pending_dynamics_`, etc.)

**Validation gate additions:** standard. After this PR, `git grep "gs_animator_\|vfx_instances_\|gs_pending_dynamics_\|gs_particle_emitters_" src/engine/renderer.cpp` should return zero hits.

---

## Phase 5 — Renderer system extraction

Spec §6 Phase 5. Goal: split `gs_renderer.cpp` into 5 cohesive systems consumed by an ~80-line orchestrator. **Smallest-coupling-first to build confidence and establish patterns.**

### PR 5a: `refactor/5a-resource-mgr`

**Risk:** High — changes ownership of every long-lived Vulkan resource.

**Files to create:**
- `include/gseurat/engine/gs_renderer/gs_resources.hpp` — `struct GsResourceManager` containing `vk::raii::Buffer` / `vk::raii::Image` arrays for output/depth/processed images (per-frame) and all SSBOs

**Files to modify:**
- `gs_renderer.cpp` — every resource creation moves to `GsResourceManager`'s constructor. Pass `GsResourceManager&` reference to all internal dispatch methods. Resource access via `resources.<field>` instead of `this-><field>`.
- `gs_renderer.hpp` — declare `GsResourceManager& resources_;` member; constructor now takes `GsResourceManager&`.
- `app_base.cpp` — construct `GsResourceManager` before constructing `GsRenderer`.

**Validation gate additions:** standard. Memory layout unchanged; SSIM = 1.0 expected.

### PR 5b: `refactor/5b-post-process` ← **first system extraction**

**Risk:** Medium — single pass, lowest coupling. Establishes the extraction pattern.

**Files to create:**
- `include/gseurat/engine/gs_renderer/post/gs_post_process_system.hpp`
- `src/engine/gs_renderer/post/gs_post_process_system.cpp`

**Files to modify:**
- `gs_renderer.cpp` — replace post-process pipeline ownership and dispatch with `post_.dispatch(...)`. Pipeline + descriptor layout move into the system class.

**Validation gate additions:** RenderDoc trace must show `PostProcess` outer label with single inner pass. SSIM = 1.0.

### PR 5c: `refactor/5c-sort-system`

**Risk:** High — 3 passes with shared state; reference pattern for tile-bin extraction.

**Files to create:**
- `include/gseurat/engine/gs_renderer/sort/gs_sort_system.hpp`
- `src/engine/gs_renderer/sort/gs_sort_system.cpp`

**Files to modify:**
- `gs_renderer.cpp` — depth sort dispatch (lines 2952–3003) and merge dispatch move into `GsSortSystem::dispatch`. Onesweep histogram + scatter pipelines owned by the system.

**Validation gate additions:** stress-test scenario with rapid camera motion (varying sort order). SSIM ≥ 0.985.

### PR 5d: `refactor/5d-tile-bin-system`

**Risk:** High — 6-pass chain, biggest extraction.

**Files to create:**
- `include/gseurat/engine/gs_renderer/tile_bin/gs_tile_bin_system.hpp`
- `src/engine/gs_renderer/tile_bin/gs_tile_bin_system.cpp`

**Files to modify:**
- `gs_renderer.cpp:3004–3243` (`dispatch_tile_sort`) moves entirely into the new system.

**Validation gate additions:** standard regression. GPU timing budget critical here — TileBin is the hot path; `±5%` regression threshold.

### PR 5e: `refactor/5e-streaming-system` ← **renderer becomes orchestrator**

**Risk:** Highest — touches the most-recently-stabilized streaming logic.

**Files to create:**
- `include/gseurat/engine/gs_renderer/streaming/gs_streaming_system.hpp`
- `src/engine/gs_renderer/streaming/gs_streaming_system.cpp`

**Files to modify:**
- `gs_renderer.cpp::publish_pending_chunks` (lines 1548–1813) and chunk lifecycle (`unload_cloud`, `clear_chunks`, `chunk_inventory`, `init_streaming`) move into `GsStreamingSystem`.
- After this PR, `GsRenderer::render()` is < 100 LOC and contains no `vkCmdDispatch` calls. All GPU work delegated to systems.

**Validation gate additions:**
- Full streaming stress test: walk through entire island_demo with `GS_DIAG_STREAMING=1` for 5 minutes. Invariant must hold throughout.
- SSIM ≥ 0.985 across full 60s scenario.
- Final `gs_renderer.cpp` LOC count < 800 (down from 3,919). Header LOC < 200 (down from 768).

**Suggested commit message:**
```
refactor(engine): extract GsStreamingSystem; GsRenderer is now an orchestrator

Phase 5e per spec §6. Final renderer split. GsRenderer::render() is
~80 LOC of system orchestration; no vkCmdDispatch calls remain.
Closes Phase 1 of the engine refactor.

gs_renderer.cpp: 3919 → ~600 LOC
gs_renderer.hpp: 768 → ~150 LOC
214 fields → ~30 fields (rest moved to GsResourceManager + per-system state)
```

---

# Cross-cutting concerns

## Communication discipline (avoid the "stuck on a wall" trap)

Per project memory `feedback_dont_dismiss_bugs.md` and the regression-safety theme of this refactor:

- If a PR's regression harness FAILS, do not bypass with `--threshold` lowering. Investigate root cause.
- If determinism self-check fails after a refactor PR, the refactor introduced a non-deterministic dependency. Bisect within the PR's diff.
- If validation layers fire after a refactor PR, do not silence — fix the root cause.
- If a phase exceeds estimated time by > 50%, **stop and reassess** before continuing. The strict-serial discipline means downstream phases can't paper over upstream errors.

## Tool requirements

- macOS dev box: Apple Silicon (matches CI runner architecture for golden frames)
- `gh` CLI: PR creation and merge
- Python 3.10+ with `scikit-image`, `Pillow`, `numpy`
- Vulkan SDK 1.3+ with `VK_EXT_debug_utils` (already present in project deps)
- Git LFS (for baseline PNG storage if size grows)

---

# Self-review notes

After writing this plan, I checked it against the spec:

**Spec coverage:**
- §1 Context → covered by plan preamble + PR 1a/1b/1c briefs
- §2 Goals → all 8 goals mapped to specific PRs (1: PR 1a/1b/1c; 2: PR 5a–5e; 3: PR 5a, RenderState class in 3b; 4: PR 4a–4e; 5: PR 3a + PR 4a/4d; 6: PR 0a + PR 2; 7: PR 0a; 8: PR 0b)
- §3 Architectural Principles → PR 0a sketches, PR 3b enforces "Vulkan headers confined", PR 1b removes legacy
- §4 Current State → referenced in PR 1b file:line table
- §5 Target Architecture → PR 0a (5.4), PR 3b (5.2), PR 3a (5.3), PR 5a–5e (5.5)
- §6 Rollout → directly mapped phase-by-phase
- §7 Regression Safety Harness → PR 0b is the entire harness, including determinism + CI parity
- §8 Risks → mitigations referenced via the per-PR validation gates and the strict-serial discipline
- §9 Open Questions → vk::raii locked in (PR 5a uses it explicitly); EventCursor implementation flagged for refinement during PR 3a
- §10 Glossary → no plan-side ambiguity

**Placeholder scan:** No "TBD", "TODO", "implement later", or empty stubs in Phase 0 tasks (the only fully-detailed phase). Phases 1–5 are PR-level guides intentionally — each will be expanded into a detailed sub-plan when its phase begins. The `tools/ply_importer/` extraction is referenced concretely (`main.cpp`, `ply_parse.{hpp,cpp}`, `CMakeLists.txt`) rather than as a vague "extract to standalone utility."

**Type consistency:**
- `gs::dbg::ScopedLabel`, `gs::dbg::Diag`, `gs::dbg::enabled` — used identically in PR 0a tasks 2, 3, 4, 9
- `gs::SimClock::fixed_dt()` returning `double` — consistent across Tasks 2, 3, 7, 10, 11, 12
- `gs::random::next_float()` — consistent across Tasks 4, 5, 10, 11
- `gs::RenderState` writer names (`bones_writer`, `vfx_writer`, etc.) — consistent across PR 3b, 4b, 4c, 4d, 4e
- `kMaxFramesInFlight` — referenced consistently in spec §5.2 + PR 3b

**Scope check:** 17 PRs is upper-edge for a single plan, but each phase is independently shippable per the spec's strict-serial discipline. Phase 0's 25 tasks are bite-sized as required. Phases 1–5 PR-level guides are sufficient runway for the next 1–2 weeks of work; detailed sub-plans for each later phase are produced on demand. This decomposition matches the spec's deliberate avoidance of front-loaded over-specification.
