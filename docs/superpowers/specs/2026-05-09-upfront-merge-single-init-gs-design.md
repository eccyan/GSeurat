# Upfront-Merge Single `init_gs` — Design Spec

**Date:** 2026-05-09
**Branch:** `fix/double-init-gs-append-cloud` (will be reused; the broken `append_async_cloud` attempt is reverted)
**Worktree:** `.worktrees/fix-double-init-gs/`
**Original framing:** "Demo freezes / oscillates after on_enter due to double `init_gs` corruption when merging chunks + character on top of terrain."

> **Postmortem (added after implementation):** the original framing turned out
> to be wrong. After landing this fix the same render → spinner → blank →
> hung-main-thread symptom reproduced with a single `init_gs` and a single
> chunk in `active_chunks_`. The freeze is pre-existing on `origin/main`
> and is **not addressed by this design**. We are keeping the change on
> its architectural merits — single init_gs, single chunk, no double
> upload, no second `clear_chunks` — and tracking the actual freeze as
> a separate follow-up. See §8 ("Postmortem") at the end of this doc.

## Why this exists

Two prior attempts ran on this problem before this design:

1. **Original code (current `origin/main`):** `on_enter` calls `init_gs(terrain_only)` via `load_pre_parsed_gs_scene`, then later calls `init_gs(merged)` again to re-upload terrain + chunks + character together. The second call's `clear_chunks` re-allocates the static-sort scratch buffers. The leading hypothesis at the time was that this was corrupting Radix Sort state and producing the post-load freeze.

2. **Append-only attempt (`fix/double-init-gs-append-cloud` first round):** Added `Renderer::append_async_cloud`, removed the second `init_gs`, kept terrain on the GPU and called `gs_renderer.load_cloud_async(extras_only)` to add chunks + character as a second chunk. Different symptom emerged: rendering oscillated between correct frame and uniform navy (sky-only) frame. Reverted.

This design replaces both. Architectural goal: **one `init_gs` per scene activation**, with the cloud already merged on the CPU before any GPU work. Same final-state shape as a fresh scene load via `WorldStreamer` (one chunk, sort-scratch sized once during `init_streaming`, no re-clear), but applied at startup / portal transition.

> **Important caveat (added in postmortem):** the original framing assumed
> the double-`init_gs` was the cause of the post-load freeze. After
> landing this fix, the same freeze reproduced with a single init_gs.
> The freeze is **pre-existing on origin/main** and unaddressed by this
> design. We're keeping the cleanup on its independent architectural
> merits. See §8.

## What we're going to do

**Single `init_gs` call, with the cloud already merged on the CPU side before any GPU work.** Same end-state the original code intended — one chunk in `active_chunks_`, single static-sort context, single Radix Sort pass — without the destructive re-init.

The merge moves from "after `init_gs`" to "before `init_gs`": `on_enter` and `perform_portal_transition` build the full `terrain + chunks + character` gaussian vector synchronously, then hand it to `load_pre_parsed_gs_scene` which runs its single `init_gs` on the merged cloud.

### What we explicitly accept

The chunk PLY parses + character PLY parse run synchronously on the main thread. On a cold filesystem cache that's the ~1.5 s stall the user originally wanted to avoid. We **accept this regression for now** — correctness before optimization. The follow-up plan to recover the async benefit (parallel worker parses joined before `init_gs`) is sketched in §6 below but is explicitly out of scope for this PR.

### What we explicitly preserve

- The **terrain** parse stays on the existing async worker (`std::async(std::launch::async, ...)` in `on_enter`).
- The first `init_gs` happens exactly once, on a fully-merged cloud, on the main thread, before any frame ticks. This matches the M5 Address Fault avoidance contract and the Radix Sort state ownership contract.
- `LoadingMonitor::begin_load(handles)` in `DemoApp::run` continues to track the single `init_gs`'s slab handles and gates compute via `should_dispatch_gpu_work()` until they drain.

## 1. Architecture

```
┌─ on_enter (main thread) ──────────────────────────────────────────┐
│                                                                    │
│  parse_future = std::async(parse_terrain)   ─── worker thread     │
│                                                                    │
│  ... main-thread setup (audio/world/collision/heightfield) ...    │
│                                                                    │
│  parsed = parse_future.get()    ◄─ blocks if worker not done      │
│                                                                    │
│  ┌── §A merge (NEW: BEFORE load_pre_parsed_gs_scene) ──┐          │
│  │  std::vector<Gaussian> merged = parsed.cloud.gauss; │          │
│  │  for each chunk in world manifest:                  │          │
│  │      load PLY, transform, append to merged          │          │
│  │  load character PLY, transform, append to merged    │          │
│  │  parsed.cloud = GaussianCloud::from_gaussians(...)  │          │
│  │  // bone allocations + ECS entity creation deferred │          │
│  │  // until after load_pre_parsed_gs_scene runs       │          │
│  └─────────────────────────────────────────────────────┘          │
│                                                                    │
│  load_pre_parsed_gs_scene(scene_data, parsed, opts)                │
│    └── single init_gs(merged_cloud) ─── all 2.44M splats once     │
│                                                                    │
│  ... bone allocations + ECS entities for §A merged content ...    │
│                                                                    │
│  end of on_enter — pending_load_handles_ has one batch's handles  │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
DemoApp::run picks up the handles via take_pending_load_handles(),
calls loading_monitor_.begin_load(handles), the standard Loading→
Warming→Playing flow runs as it does today.
```

**Key shape difference vs. the failed append attempt:** the §A merge's PLY loads happen *before* `load_pre_parsed_gs_scene`, which means they happen before any GPU work. The CPU does all the gathering, then the GPU sees one cloud, one chunk, one upload.

## 2. Code changes

Three files. No new public API surface required — the existing `load_pre_parsed_gs_scene` already accepts a fully-formed `ParsedScene&&`, so we just hand it a cloud that's already merged.

### 2.1 `src/demo/island_demo_state.cpp` — `on_enter`

Restructure the §A block to run **before** `load_pre_parsed_gs_scene`:

```cpp
ParsedScene parsed_scene = parse_future.get();

// ── §A merge (now before init_gs) ──
// Build the full terrain + chunks + character gaussian vector on the
// CPU. Single init_gs uploads it as one chunk.
std::vector<Gaussian> merged = parsed_scene.cloud.gaussians();

if (world_streamer_) {
    for (const auto& chunk : world_streamer_->manifest().chunks) {
        if (chunk.grid == glm::ivec3(0, 0, 0)) continue;
        if (chunk.ply_file.empty()) continue;
        auto resolved = resolve_asset_path(chunk.ply_file);
        auto extra = GaussianCloud::load_with_gsvx_first(resolved.string());
        if (!extra.empty()) {
            const auto& gs = extra.gaussians();
            merged.insert(merged.end(), gs.begin(), gs.end());
            std::fprintf(stderr, "[IslandDemo] Merged chunk [%d,%d,%d]: +%u Gaussians\n",
                chunk.grid.x, chunk.grid.y, chunk.grid.z, extra.count());

            // Process chunk's scene game_objects (NPCs)
            // ... (existing code, builds bone_allocations side-effect) ...
        }
    }
}

const float gs_scale = scene_data.gaussian_splat
    ? scene_data.gaussian_splat->scale_multiplier : 1.0f;
gs_scale_ = gs_scale;

// Character merge
auto char_cloud = GaussianCloud::load_with_gsvx_first(
    "assets/characters/snes_hero/snes_hero.ply");
if (!char_cloud.empty()) {
    for (const auto& g : char_cloud.gaussians()) {
        Gaussian cg = g;
        glm::vec3 rotated(-cg.position.x, cg.position.y, -cg.position.z);
        glm::vec3 offset = rotated * kCharScale;
        offset.y *= gs_scale;
        cg.position = player_pos + offset + glm::vec3(0, 2.0f, 0);
        cg.scale *= kCharScale;
        cg.opacity = std::min(1.0f, cg.opacity * 1.3f);
        cg.bone_index = cg.bone_index + 1;
        merged.push_back(cg);
    }
}

// Replace parsed_scene.cloud with the merged cloud — single init_gs
// will upload everything below.
parsed_scene.cloud = GaussianCloud::from_gaussians(std::move(merged));

// Existing call — now does the one-and-only init_gs with the full cloud
{
    GsSceneOptions parse_opts;
    parse_opts.add_default_light = true;
    parse_opts.set_god_rays = true;
    app.load_pre_parsed_gs_scene(scene_data, std::move(parsed_scene), parse_opts);
}

// ── No second init_gs! ──

// Continue with bone-animation-registry registration, ECS spawn, etc.
// These don't touch the GPU cloud; they only register CPU-side entries.
populate_bone_animation_registry(...);
... player BoneAnimationEntry setup ...
... PBD elements re-upload ...
```

**Key changes vs. current code:**

- The §A merge moves from line ~427-572 (after `load_pre_parsed_gs_scene`) to a position before it.
- `parsed_scene.cloud` is rebuilt with the full merged cloud before being moved into `load_pre_parsed_gs_scene`.
- The `app.renderer().init_gs(cloud, gs_w, gs_h)` call at line 581 (the second init_gs) is **removed entirely**.
- The bone-allocation registration (`populate_bone_animation_registry` at line 588) and PBD re-upload (lines 631-651) stay where they are — they operate on CPU-side state, not the GPU cloud.

**The character bone-allocation push to `app.gs_terrain().bone_allocations`** stays where it is (around lines 478-510 for chunk NPCs, and the existing player_entry setup further down). That state is the *registry* for bone animation; it's independent of the GPU upload path.

**Flow for `parse_future.get()` → merge → `load_pre_parsed_gs_scene`:** The terrain parse worker still runs on its own thread, parallel to main-thread setup. The §A chunk/character PLY parses are synchronous on the main thread, after `parse_future.get()` returns. This is the 1.5 s stall we're accepting.

### 2.2 `src/demo/island_demo_state.cpp` — `perform_portal_transition`

Mirror the same restructure: §A merge moves from after `load_pre_parsed_gs_scene` to before. `parsed_scene.cloud` is rebuilt with the merged cloud. The second `init_gs` call disappears.

The §A re-merge in portal transitions has more variants (the `skip_phase_b_remerge` fast path for non-overworld destinations, the `player_already_merged_fast` detection for scenes that author a `player` game_object). All of those branches stay; they just decide *what* to merge into the parsed cloud, not whether to issue a second `init_gs`.

The `loading_monitor.begin_load(...)` call at the end (line 2530 today) keeps working unchanged — it tracks the single `init_gs`'s handles via `take_pending_load_handles()` as before.

### 2.3 No new method on `Renderer`

The failed attempt added `Renderer::append_async_cloud`. We don't need it anymore. `init_gs` plus its existing internal `load_cloud_async` is sufficient — the merged cloud goes through one upload.

## 3. What this preserves

- **Single `init_gs`:** Radix Sort scratch buffers allocated once. No clear/realloc cycle. Sort state preserved.
- **Single chunk in `active_chunks_`:** Same shape as the original scene-load. No two-chunk-publication hazard.
- **Async terrain parse:** The terrain PLY (the largest single load) still parses on a worker thread.
- **All existing call sites of `load_pre_parsed_gs_scene`:** Public API unchanged.
- **`LoadingMonitor` flow:** Same handles-tracking, same Loading → Warming → Playing transitions.
- **Vulkan lifecycle:** All GPU calls remain main-thread, single-shot. M5 Address Fault still avoided.
- **Bone allocation registry:** Side-effects of the merge (allocations pushed to `gs_terrain().bone_allocations`) preserved — they're now done before init_gs, but `populate_bone_animation_registry` runs after, at the same place it does today.

## 4. What this changes (and the trade-off)

**Regression:** chunk PLY parses + character PLY parse run synchronously on main thread. On a cold cache:

- Northern forest chunk: ~158k splats → ~50-100 ms parse
- Snes_hero character: ~30k splats → ~20-50 ms parse
- Each chunk-NPC PLY (forest_guardian etc.): ~50-100 ms each

Total: roughly **200-400 ms** of synchronous main-thread PLY work in `on_enter`. On top of `init_streaming + create_transfer_queue`'s already-measured 367 ms (first-time only), the `on_enter` total returns to the ~700-800 ms range — better than the pre-fix 1.5 s only because the PBD re-upload and other small phases have already been instrumented and are confirmed near-zero.

For `perform_portal_transition`, each portal pays its own per-chunk PLY parse cost — typically 1 chunk + 1 character + a couple of NPCs = ~150-300 ms. Better than the pre-fix freeze, worse than the architectural ideal of "instant transition with a brief loading overlay".

**Trade-off:** correctness *now*, performance *later*. Once we know the upfront-merge approach renders correctly without freezes, we can recover the async-parse benefit in a follow-up PR (see §6).

## 5. Validation plan

**Build gates:**

1. `cmake --build build/macos-release-with-diag --target gseurat_demo` — clean build, no errors.
2. Run the existing `tests/test_gaussian_cloud.cpp` to confirm cloud merge semantics unchanged (the merge path uses `GaussianCloud::from_gaussians` and `gaussians()` which already have unit coverage).

**Manual gates (you, by hand):**

1. **Demo startup:** Launch `gseurat_demo`, world renders, accept input (WASD movement, no freeze, no oscillation).
2. **Portal transition (overworld → forest):** Walk into the north bridge portal, loading overlay shows briefly, world reappears, accept input.
3. **Portal transition (forest → overworld):** Walk back through the return portal, same behavior.
4. **Portal transition into dungeon:** Walk into a dungeon entrance, scene transitions, accept input.
5. **Portal transition out of dungeon:** Return to overworld, accept input.

**No automated regression harness run on this machine until correctness is confirmed by hand** — the WindowServer watchdog and kernel-reset incidents from prior runs are still in scope; we don't add load until we're sure the basics work.

**Rollback criteria (as written before implementation):** if any of the manual gates reproduces the freeze or oscillation symptoms, revert and reconvene.

**What actually happened:** the freeze reproduced. Per the postmortem in §8, the freeze is pre-existing on origin/main and unrelated to the double-`init_gs`, so this fix is *not* reverted on the original criterion. The architectural shape (single init_gs, single chunk, no double upload) is correct independently of the freeze. The freeze investigation continues as a separate follow-up.

## 6. Follow-up: recover the async-parse benefit

Out of scope for this PR. Sketch only:

The §A chunk PLY parses + character PLY parse can run on additional `std::async` worker threads in parallel with the terrain parse. The existing `parse_future` becomes one of N futures; `on_enter` joins them all (`future.get()` on each) before assembling the merged cloud.

Care needed:
- Each worker just parses its PLY into a `GaussianCloud` — no ECS / Vulkan work.
- The transforms (position offset, rotation, bone_index assignment) happen on the main thread after join — they need bone-allocation indices and `world_pos` from main-thread state.
- The transform step is fast (vector arithmetic) once the parse is done.

Expected wall-clock improvement for `on_enter`: parallel parse of terrain (largest, ~200ms) + chunk (~50-100ms) + character (~20-50ms) costs `max(...)` instead of `sum(...)`. Probably reduces 700-800ms back toward 400-500ms on cold cache.

Probably worth a separate spec when we get there.

## 7. Latent issues we are NOT addressing

- **`gs_total_gaussian_count_` accuracy in adaptive LOD:** Stays accurate in this design — `init_gs` runs with the merged cloud, `cloud.count()` includes everything, the adaptive LOD budget gets set from the correct total.
- **`gs_cloud_metadata_.bounds`:** Same — set from the merged cloud, includes everything.
- **The `c.load_ply(p)` calls through instance** (latent bugs at `island_demo_state.cpp:2623` and `staging_state.cpp:598` from PR-A): unchanged.
- **`perform_portal_transition`'s §B chunk re-mark loop** (lines 2508-2515 today): stays correct — `world_streamer_->on_chunk_loaded()` for each chunk still tells the streamer "this is loaded, don't re-issue".

## Open questions

1. **Should the §A merge logic be deduplicated between `on_enter` and `perform_portal_transition`?** They share most of the chunk-loop and character-merge code today, with subtle differences (overworld-vs-target detection, fast-path skip). Refactoring the shared body into a helper would shrink the diff, but the differences are real (each function picks different chunks). Recommend keeping them separate for this PR — same boundary as today — and revisiting deduplication only if a third caller emerges. This isn't a rule, but the user's `feedback_keep_lod_simple` and `branch_per_task` memories favor focused diffs.

2. **Should we add a test** that mocks the chunk loop and asserts `init_gs` is called exactly once per `on_enter`? Probably not — it would require a Renderer mock the codebase doesn't have, and the manual-gate step 1 ("demo starts up, world renders") is more meaningful than counting init_gs calls.

## Approval gate

If this design matches what you had in mind, please approve in your next message. After approval I'll implement the changes on `fix/double-init-gs-append-cloud` (replacing the now-reverted `append_async_cloud` work).

## 8. Postmortem

After approval the design was implemented (commits on this branch). Manual run on the user's M5 reproduced **the same render → spinner → blank → hung-main-thread symptom** that the broken append-only attempt produced. The user then confirmed the same symptom is present on `origin/main`. The double-`init_gs` was not the cause of the freeze.

**What we got right:**
- Single `init_gs` per scene activation.
- Single chunk in `active_chunks_` at startup, matching the gameplay-time shape.
- No second `clear_chunks` call, no double GPU upload of the terrain.
- Architecture matches the user's stated intent ("upload a single, fully merged cloud").

**What we got wrong:**
- The hypothesis ("double `init_gs` corrupts Radix Sort state → freeze") wasn't empirically tested before being built into the spec. We jumped from "this is a known bad pattern" to "this is *the* cause" without a reproducible isolation step.
- The "fix didn't work" outcome was discoverable cheaply (small Renderer change, single demo run) but only after going through the larger restructure.

**What's still broken:**
- The post-load freeze. macOS log line `error messaging the mach port for IMKCFRunLoopWakeUpReliable` accompanies the spinner — strong indicator that the main thread is hung indefinitely (Vulkan fence wait, deadlock, or shader hang). Pre-existing on `origin/main`.

**Where to look next (separate follow-up):**
- `vkWaitForFences` / `vkAcquireNextImageKHR` in the per-frame loop — what fence is the main thread blocking on, and which submission was supposed to signal it?
- The `[ProximityTrigger] ENTER` cluster of effects that fires on the first post-load frame (chimney_smoke VFX spawn, EmitterToggle, AnimationTrigger, EmissiveToggle): could one of these path's first dispatch hang the GPU?
- `update_descriptors` / per-frame dynamic upload paths — descriptor-set vs buffer-lifetime hazards that wouldn't fire during the harness (which runs deterministic input that doesn't exercise the same triggers).
- The macOS-only mach-port warning — does the same demo build hang on Linux/Windows too, or is this specific to a MoltenVK / IMKCFRunLoopWakeUpReliable interaction?

**Why we kept this fix anyway:**
- Independent architectural merit (cleaner shape, less GPU work, fewer moving parts).
- Future investigators of the freeze should not have to mentally subtract the double-init_gs noise to see the actual cause.
- Reverting would lose the spec, which now also documents the disproven hypothesis.
