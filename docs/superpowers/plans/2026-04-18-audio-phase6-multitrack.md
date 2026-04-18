# Phase 6: Multi-Track Management & Project Directory — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve Weaver into a project-based multi-track editor with `.weaver` project files, FSAPI project directory, and multi-group management.

**Architecture:** Separate authoring data (`.weaver`) from runtime data (`music_config.json` v2). Single group in memory at a time (Echidna pattern). Reuse `@gseurat/project-root` for FSAPI.

**Tech Stack:** React 18, Zustand 4, TypeScript, Web Audio API, File System Access API, `@gseurat/project-root`

**Spec:** `docs/superpowers/specs/2026-04-18-audio-phase6-multitrack-design.md`

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `tools/packages/project-root/src/layout.ts` | Add `weaver` entry to `PROJECT_LAYOUT.toolsData` |
| `tools/apps/weaver/src/lib/projectTypes.ts` | WeaverProjectFile, WeaverGroupConfig, WeaverStemConfig interfaces |
| `tools/apps/weaver/src/lib/projectFs.ts` | FSAPI operations: list/save/load projects, load stem audio |
| `tools/apps/weaver/src/lib/slugify.ts` | Group ID slug generation |
| `tools/apps/weaver/src/components/GroupSelector.tsx` | Group list + CRUD buttons in sidebar |
| `tools/apps/weaver/src/components/EmptyProjectState.tsx` | No-project-root / no-project screens |
| `tools/apps/weaver/src/components/DirtyDialog.tsx` | Save/discard/cancel prompt on group switch |
| `tools/apps/weaver/src/lib/__tests__/projectFs.test.ts` | Unit tests for project file I/O |
| `tools/apps/weaver/src/lib/__tests__/exportConfig.test.ts` | Unit tests for multi-group export |
| `tools/apps/weaver/src/lib/__tests__/projectTypes.test.ts` | Unit tests for flush/migration |

### Modified files
| File | Changes |
|------|---------|
| `tools/apps/weaver/src/lib/types.ts` | Keep StemState/MarkerState, re-export project types |
| `tools/apps/weaver/src/lib/exportConfig.ts` | Multi-group export, strip editor-only fields |
| `tools/apps/weaver/src/lib/importConfig.ts` | Legacy v2 JSON → WeaverProjectFile migration |
| `tools/apps/weaver/src/store/useWeaverStore.ts` | Project-level + active-group split, flush/switch |
| `tools/apps/weaver/src/components/Toolbar.tsx` | Open/Save Project, updated Export |
| `tools/apps/weaver/src/components/Sidebar.tsx` | Add GroupSelector, update GroupMetadata |
| `tools/apps/weaver/src/App.tsx` | Project root restore, empty states, Cmd+S |
| `tools/apps/weaver/package.json` | Add `@gseurat/project-root` dependency |

### Unchanged files
Ruler.tsx, StemLane.tsx, TimelinePanel.tsx, useAudioPlayer.ts, waveformPeaks.ts, frameUtils.ts, main.tsx, App.css

---

### Task 1: Add `weaver` to PROJECT_LAYOUT

**Files:**
- Modify: `tools/packages/project-root/src/layout.ts:1-20`

- [ ] **Step 1: Add weaver entry to PROJECT_LAYOUT.toolsData**

In `tools/packages/project-root/src/layout.ts`, add `weaver` to the `toolsData` object:

```typescript
  toolsData: {
    bricklayer:   'tools_data/bricklayer',
    melies:       'tools_data/melies_projects',
    echidnaSaves: 'tools_data/echidna_saves',
    weaver:       'tools_data/weaver',
    cache:        'tools_data/cache',
  },
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/eccyan/dev/GSeurat/.worktrees/feature-audio-phase5-weaver/tools && pnpm --filter @gseurat/project-root build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tools/packages/project-root/src/layout.ts
git commit -m "feat(project-root): add weaver entry to PROJECT_LAYOUT.toolsData"
```

---

### Task 2: Create project types

**Files:**
- Create: `tools/apps/weaver/src/lib/projectTypes.ts`
- Create: `tools/apps/weaver/src/lib/slugify.ts`

- [ ] **Step 1: Create projectTypes.ts**

```typescript
// tools/apps/weaver/src/lib/projectTypes.ts

export const WEAVER_PROJECT_VERSION = 1;

export interface WeaverProjectFile {
  version: 1;
  name: string;
  sample_rate: number;
  groups: WeaverGroupConfig[];
}

export interface WeaverGroupConfig {
  id: string;
  name: string;
  bpm: number;
  loop_start: number;
  loop_end: number;
  loop_enabled: boolean;
  markers: { frame: number; name: string }[];
  stems: WeaverStemConfig[];
}

export interface WeaverStemConfig {
  source: string;
  initial_volume: number;
  muted: boolean;
  soloed: boolean;
}

export function createEmptyGroup(id: string, name: string): WeaverGroupConfig {
  return {
    id,
    name,
    bpm: 120,
    loop_start: 0,
    loop_end: 0,
    loop_enabled: true,
    markers: [],
    stems: [],
  };
}

export function createEmptyProject(name: string, sampleRate: number = 44100): WeaverProjectFile {
  return {
    version: WEAVER_PROJECT_VERSION,
    name,
    sample_rate: sampleRate,
    groups: [],
  };
}
```

- [ ] **Step 2: Create slugify.ts**

```typescript
// tools/apps/weaver/src/lib/slugify.ts

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    || 'untitled';
}

export function uniqueSlug(name: string, existing: string[]): string {
  const base = slugify(name);
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/eccyan/dev/GSeurat/.worktrees/feature-audio-phase5-weaver/tools && pnpm --filter weaver build`
Expected: PASS (unused exports are fine for types)

- [ ] **Step 4: Commit**

```bash
git add tools/apps/weaver/src/lib/projectTypes.ts tools/apps/weaver/src/lib/slugify.ts
git commit -m "feat(weaver): add project types and slug utilities"
```

---

### Task 3: Create projectFs.ts — FSAPI project file operations

**Files:**
- Create: `tools/apps/weaver/src/lib/projectFs.ts`
- Modify: `tools/apps/weaver/package.json` — add `@gseurat/project-root` dependency

- [ ] **Step 1: Add project-root dependency**

In `tools/apps/weaver/package.json`, add to `dependencies`:

```json
"@gseurat/project-root": "workspace:*"
```

Run: `cd /Users/eccyan/dev/GSeurat/.worktrees/feature-audio-phase5-weaver/tools && pnpm install`

- [ ] **Step 2: Create projectFs.ts**

```typescript
// tools/apps/weaver/src/lib/projectFs.ts

import { ensureSubdir, writeFileAtPath, readFileAtPath } from '@gseurat/project-root';
import { PROJECT_LAYOUT } from '@gseurat/project-root';
import type { WeaverProjectFile } from './projectTypes.js';
import { WEAVER_PROJECT_VERSION } from './projectTypes.js';

const WEAVER_DIR = PROJECT_LAYOUT.toolsData.weaver;
const EXT = '.weaver';

/**
 * List all .weaver project files in tools_data/weaver/.
 * Returns project names (without extension), sorted alphabetically.
 */
export async function listWeaverProjects(
  root: FileSystemDirectoryHandle,
): Promise<string[]> {
  const names: string[] = [];
  try {
    const dir = await root.getDirectoryHandle(
      WEAVER_DIR.split('/')[0],  // 'tools_data'
    );
    const sub = await dir.getDirectoryHandle(
      WEAVER_DIR.split('/')[1],  // 'weaver'
    );
    for await (const entry of sub.values()) {
      if (entry.kind === 'file' && entry.name.endsWith(EXT)) {
        names.push(entry.name.slice(0, -EXT.length));
      }
    }
  } catch {
    // Directory doesn't exist yet — return empty list
  }
  return names.sort();
}

/**
 * Save a WeaverProjectFile to tools_data/weaver/<name>.weaver.
 */
export async function saveWeaverProject(
  root: FileSystemDirectoryHandle,
  project: WeaverProjectFile,
): Promise<void> {
  const path = `${WEAVER_DIR}/${project.name}${EXT}`;
  const json = JSON.stringify(project, null, 2);
  await writeFileAtPath(root, path, json);
}

/**
 * Load a WeaverProjectFile from tools_data/weaver/<name>.weaver.
 */
export async function loadWeaverProject(
  root: FileSystemDirectoryHandle,
  name: string,
): Promise<WeaverProjectFile> {
  const path = `${WEAVER_DIR}/${name}${EXT}`;
  const blob = await readFileAtPath(root, path);
  const text = await blob.text();
  const data = JSON.parse(text) as WeaverProjectFile;
  if (data.version !== WEAVER_PROJECT_VERSION) {
    throw new Error(`Unsupported .weaver version: ${data.version}`);
  }
  return data;
}

/**
 * Load and decode a stem audio file relative to the project root.
 * Returns the decoded AudioBuffer.
 */
export async function loadStemAudio(
  root: FileSystemDirectoryHandle,
  sourcePath: string,
  audioContext: AudioContext,
): Promise<AudioBuffer> {
  const blob = await readFileAtPath(root, sourcePath);
  const arrayBuffer = await blob.arrayBuffer();
  return audioContext.decodeAudioData(arrayBuffer);
}
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/eccyan/dev/GSeurat/.worktrees/feature-audio-phase5-weaver/tools && pnpm --filter weaver build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tools/apps/weaver/package.json tools/apps/weaver/src/lib/projectFs.ts pnpm-lock.yaml
git commit -m "feat(weaver): add FSAPI project file operations"
```

---

### Task 4: Restructure the Zustand store — project-level + active-group

This is the largest task. The store gains project-level state, group CRUD, `flushActiveGroup()`, and `switchGroup()`.

**Files:**
- Modify: `tools/apps/weaver/src/store/useWeaverStore.ts`
- Modify: `tools/apps/weaver/src/lib/types.ts`

- [ ] **Step 1: Update types.ts — keep StemState/MarkerState, re-export project types**

```typescript
// tools/apps/weaver/src/lib/types.ts

// Runtime types (used by active group — contain AudioBuffer)
export interface StemState {
  fileName: string;
  sourcePath: string;
  initialVolume: number;
  audioBuffer: AudioBuffer | null;
  waveformPeaks: Float32Array | null;
  muted: boolean;
  soloed: boolean;
}

export interface MarkerState {
  frame: number;
  name: string;
}

// Re-export config types for convenience
export type { MusicConfigV2, TrackGroupConfig } from './exportConfig.js';
export type {
  WeaverProjectFile,
  WeaverGroupConfig,
  WeaverStemConfig,
} from './projectTypes.js';
```

Note: `MusicConfigV2` and `TrackGroupConfig` will move to `exportConfig.ts` in Task 5. For now, keep them in types.ts if the build requires it — Task 5 handles the final location.

- [ ] **Step 2: Rewrite useWeaverStore.ts with project + active-group split**

The full rewrite of `tools/apps/weaver/src/store/useWeaverStore.ts`:

```typescript
import { create } from 'zustand';
import type { StemState, MarkerState } from '../lib/types.js';
import type { WeaverGroupConfig, WeaverProjectFile } from '../lib/projectTypes.js';
import { createEmptyGroup, createEmptyProject } from '../lib/projectTypes.js';
import { slugify, uniqueSlug } from '../lib/slugify.js';
import { decodeStemFile } from '../lib/importConfig.js';
import { computeWaveformPeaks } from '../lib/waveformPeaks.js';
import {
  saveWeaverProject,
  loadWeaverProject,
  listWeaverProjects,
  loadStemAudio,
} from '../lib/projectFs.js';

// ── Shared AudioContext ──────────────────────────────────────────

let sharedCtx: AudioContext | null = null;
function getAudioContext(): AudioContext {
  if (!sharedCtx) sharedCtx = new AudioContext();
  return sharedCtx;
}

// ── Store Interface ──────────────────────────────────────────────

interface WeaverStore {
  // === Project-level ===
  projectName: string;
  sampleRate: number;
  groups: WeaverGroupConfig[];
  dirty: boolean;

  // Project I/O
  projectRootHandle: FileSystemDirectoryHandle | null;
  setProjectRootHandle: (h: FileSystemDirectoryHandle | null) => void;
  saveProject: () => Promise<void>;
  loadProject: (name: string) => Promise<void>;
  listProjects: () => Promise<string[]>;
  newProject: (name: string) => void;

  // Group CRUD
  addGroup: (name: string) => void;
  duplicateGroup: (id: string) => void;
  deleteGroup: (id: string) => void;
  renameGroup: (id: string, name: string) => void;

  // === Active group ===
  activeGroupId: string | null;
  switchGroup: (id: string) => Promise<void>;
  flushActiveGroup: () => void;

  // Active group live state
  stems: StemState[];
  bpm: number;
  loopStart: number;
  loopEnd: number;
  loopEnabled: boolean;
  markers: MarkerState[];
  isPlaying: boolean;
  playheadFrame: number;

  // Mutators
  addStem: (file: File) => Promise<void>;
  removeStem: (index: number) => void;
  setStemVolume: (index: number, volume: number) => void;
  toggleMute: (index: number) => void;
  toggleSolo: (index: number) => void;
  setLoopStart: (frame: number) => void;
  setLoopEnd: (frame: number) => void;
  setLoopEnabled: (enabled: boolean) => void;
  setBpm: (bpm: number) => void;
  setGroupName: (name: string) => void;
  addMarker: (frame: number, name?: string) => void;
  removeMarker: (index: number) => void;
  updateMarker: (index: number, patch: Partial<MarkerState>) => void;
  moveMarker: (index: number, frame: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setPlayheadFrame: (frame: number) => void;

  // Export
  exportMusicConfig: () => WeaverProjectFile;

  // Viewport
  viewStartFrame: number;
  viewEndFrame: number;
  setView: (start: number, end: number) => void;
  zoomToFit: () => void;
  maxFrames: () => number;
}

// ── Store Implementation ─────────────────────────────────────────

export const useWeaverStore = create<WeaverStore>((set, get) => ({
  // === Project-level ===
  projectName: 'untitled',
  sampleRate: 44100,
  groups: [],
  dirty: false,

  projectRootHandle: null,
  setProjectRootHandle: (h) => set({ projectRootHandle: h }),

  newProject: (name) => {
    const project = createEmptyProject(name, get().sampleRate);
    set({
      projectName: project.name,
      sampleRate: project.sample_rate,
      groups: [],
      activeGroupId: null,
      stems: [],
      bpm: 120,
      loopStart: 0,
      loopEnd: 0,
      loopEnabled: true,
      markers: [],
      playheadFrame: 0,
      isPlaying: false,
      viewStartFrame: 0,
      viewEndFrame: 0,
      dirty: false,
    });
  },

  saveProject: async () => {
    const s = get();
    if (!s.projectRootHandle) return;
    s.flushActiveGroup();
    const state = get(); // re-read after flush
    const project: WeaverProjectFile = {
      version: 1,
      name: state.projectName,
      sample_rate: state.sampleRate,
      groups: state.groups,
    };
    await saveWeaverProject(state.projectRootHandle!, project);
    set({ dirty: false });
  },

  loadProject: async (name) => {
    const s = get();
    if (!s.projectRootHandle) return;
    const project = await loadWeaverProject(s.projectRootHandle, name);
    set({
      projectName: project.name,
      sampleRate: project.sample_rate,
      groups: project.groups,
      activeGroupId: null,
      stems: [],
      bpm: 120,
      loopStart: 0,
      loopEnd: 0,
      loopEnabled: true,
      markers: [],
      playheadFrame: 0,
      isPlaying: false,
      viewStartFrame: 0,
      viewEndFrame: 0,
      dirty: false,
    });
    // Auto-open first group if available
    if (project.groups.length > 0) {
      await get().switchGroup(project.groups[0].id);
    }
  },

  listProjects: async () => {
    const s = get();
    if (!s.projectRootHandle) return [];
    return listWeaverProjects(s.projectRootHandle);
  },

  // Group CRUD
  addGroup: (name) => {
    const s = get();
    const existingIds = s.groups.map((g) => g.id);
    const id = uniqueSlug(name, existingIds);
    const group = createEmptyGroup(id, name);
    set((prev) => ({ groups: [...prev.groups, group], dirty: true }));
  },

  duplicateGroup: (id) => {
    const s = get();
    const source = s.groups.find((g) => g.id === id);
    if (!source) return;
    // Flush active group first so we copy latest state
    if (s.activeGroupId === id) s.flushActiveGroup();
    const updated = get();
    const freshSource = updated.groups.find((g) => g.id === id)!;
    const newName = `${freshSource.name} (copy)`;
    const existingIds = updated.groups.map((g) => g.id);
    const newId = uniqueSlug(newName, existingIds);
    const copy: WeaverGroupConfig = {
      ...JSON.parse(JSON.stringify(freshSource)),
      id: newId,
      name: newName,
    };
    set((prev) => ({ groups: [...prev.groups, copy], dirty: true }));
  },

  deleteGroup: (id) => {
    const s = get();
    const remaining = s.groups.filter((g) => g.id !== id);
    const wasActive = s.activeGroupId === id;
    set({
      groups: remaining,
      dirty: true,
      ...(wasActive
        ? {
            activeGroupId: null,
            stems: [],
            bpm: 120,
            loopStart: 0,
            loopEnd: 0,
            loopEnabled: true,
            markers: [],
            playheadFrame: 0,
            isPlaying: false,
            viewStartFrame: 0,
            viewEndFrame: 0,
          }
        : {}),
    });
  },

  renameGroup: (id, name) => {
    set((s) => ({
      groups: s.groups.map((g) => (g.id === id ? { ...g, name } : g)),
      dirty: true,
    }));
  },

  // === Active group ===
  activeGroupId: null,

  flushActiveGroup: () => {
    const s = get();
    if (!s.activeGroupId) return;
    const updated = s.groups.map((g) => {
      if (g.id !== s.activeGroupId) return g;
      return {
        ...g,
        bpm: s.bpm,
        loop_start: s.loopStart,
        loop_end: s.loopEnd,
        loop_enabled: s.loopEnabled,
        markers: s.markers.map((m) => ({ frame: m.frame, name: m.name })),
        stems: s.stems.map((st) => ({
          source: st.sourcePath,
          initial_volume: st.initialVolume,
          muted: st.muted,
          soloed: st.soloed,
        })),
      };
    });
    set({ groups: updated });
  },

  switchGroup: async (id) => {
    const s = get();
    // 1. Flush current active group
    if (s.activeGroupId) s.flushActiveGroup();
    // 2. Stop playback, discard buffers
    set({ isPlaying: false });
    // 3. Find target group
    const state = get();
    const group = state.groups.find((g) => g.id === id);
    if (!group) return;
    // 4. Decode stems
    const ctx = getAudioContext();
    const loadedStems: StemState[] = [];
    for (const stemCfg of group.stems) {
      let audioBuffer: AudioBuffer | null = null;
      let waveformPeaks: Float32Array | null = null;
      try {
        if (state.projectRootHandle) {
          audioBuffer = await loadStemAudio(
            state.projectRootHandle,
            stemCfg.source,
            ctx,
          );
          waveformPeaks = computeWaveformPeaks(audioBuffer);
        }
      } catch (e) {
        console.warn(`[weaver] Failed to load stem: ${stemCfg.source}`, e);
      }
      loadedStems.push({
        fileName: stemCfg.source.split('/').pop() ?? stemCfg.source,
        sourcePath: stemCfg.source,
        initialVolume: stemCfg.initial_volume,
        audioBuffer,
        waveformPeaks,
        muted: stemCfg.muted,
        soloed: stemCfg.soloed,
      });
    }
    // 5. Populate live state
    const maxLen = Math.max(
      0,
      ...loadedStems.map((st) => st.audioBuffer?.length ?? 0),
    );
    set({
      activeGroupId: id,
      stems: loadedStems,
      bpm: group.bpm,
      loopStart: group.loop_start,
      loopEnd: group.loop_end,
      loopEnabled: group.loop_enabled,
      markers: group.markers.map((m) => ({ ...m })),
      playheadFrame: 0,
      viewStartFrame: 0,
      viewEndFrame: maxLen > 0 ? maxLen : 44100,
    });
  },

  // Live state
  stems: [],
  bpm: 120,
  loopStart: 0,
  loopEnd: 0,
  loopEnabled: true,
  markers: [],
  isPlaying: false,
  playheadFrame: 0,

  addStem: async (file: File) => {
    const ctx = getAudioContext();
    const { audioBuffer, waveformPeaks } = await decodeStemFile(file, ctx);
    const s = get();
    const stem: StemState = {
      fileName: file.name,
      sourcePath: `assets/audio/${s.activeGroupId ?? s.projectName}/${file.name}`,
      initialVolume: 1.0,
      audioBuffer,
      waveformPeaks,
      muted: false,
      soloed: false,
    };
    set((prev) => {
      const stems = [...prev.stems, stem];
      const maxLen = Math.max(...stems.map((st) => st.audioBuffer?.length ?? 0));
      return {
        stems,
        viewEndFrame: prev.viewEndFrame === 0 ? maxLen : prev.viewEndFrame,
        dirty: true,
      };
    });
  },

  removeStem: (index) =>
    set((s) => ({
      stems: s.stems.filter((_, i) => i !== index),
      dirty: true,
    })),

  setStemVolume: (index, volume) =>
    set((s) => ({
      stems: s.stems.map((st, i) =>
        i === index ? { ...st, initialVolume: volume } : st,
      ),
      dirty: true,
    })),

  toggleMute: (index) =>
    set((s) => ({
      stems: s.stems.map((st, i) =>
        i === index ? { ...st, muted: !st.muted } : st,
      ),
      dirty: true,
    })),

  toggleSolo: (index) =>
    set((s) => ({
      stems: s.stems.map((st, i) =>
        i === index ? { ...st, soloed: !st.soloed } : st,
      ),
      dirty: true,
    })),

  setLoopStart: (frame) => set({ loopStart: Math.max(0, frame), dirty: true }),
  setLoopEnd: (frame) => set({ loopEnd: Math.max(0, frame), dirty: true }),
  setLoopEnabled: (enabled) => set({ loopEnabled: enabled, dirty: true }),
  setBpm: (bpm) => set({ bpm, dirty: true }),
  setGroupName: (name) => {
    const s = get();
    if (s.activeGroupId) {
      s.renameGroup(s.activeGroupId, name);
    }
  },

  addMarker: (frame, name) =>
    set((s) => ({
      markers: [
        ...s.markers,
        { frame, name: name ?? `Marker ${s.markers.length + 1}` },
      ],
      dirty: true,
    })),
  removeMarker: (index) =>
    set((s) => ({
      markers: s.markers.filter((_, i) => i !== index),
      dirty: true,
    })),
  updateMarker: (index, patch) =>
    set((s) => ({
      markers: s.markers.map((m, i) =>
        i === index ? { ...m, ...patch } : m,
      ),
      dirty: true,
    })),
  moveMarker: (index, frame) =>
    set((s) => ({
      markers: s.markers.map((m, i) =>
        i === index ? { ...m, frame } : m,
      ),
      dirty: true,
    })),

  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setPlayheadFrame: (frame) => set({ playheadFrame: frame }),

  // Export
  exportMusicConfig: () => {
    const s = get();
    s.flushActiveGroup();
    return get() as unknown as WeaverProjectFile; // Caller uses exportMultiGroupConfig()
  },

  // Viewport
  viewStartFrame: 0,
  viewEndFrame: 0,
  setView: (start, end) => set({ viewStartFrame: start, viewEndFrame: end }),
  zoomToFit: () => {
    const max = get().maxFrames();
    set({ viewStartFrame: 0, viewEndFrame: max > 0 ? max : 44100 });
  },
  maxFrames: () => {
    const s = get();
    if (s.stems.length === 0) return 0;
    return Math.max(...s.stems.map((st) => st.audioBuffer?.length ?? 0));
  },
}));
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/eccyan/dev/GSeurat/.worktrees/feature-audio-phase5-weaver/tools && pnpm --filter weaver build`

There will likely be compilation errors from components that reference removed store fields (`groupId`, `groupName`, `setSampleRate`, `setGroupId`, `getExportData`). These are fixed in subsequent tasks. For now, fix any blocking errors by adjusting imports.

- [ ] **Step 4: Commit**

```bash
git add tools/apps/weaver/src/store/useWeaverStore.ts tools/apps/weaver/src/lib/types.ts
git commit -m "feat(weaver): restructure store for project-level + active-group split"
```

---

### Task 5: Update exportConfig.ts — multi-group export

**Files:**
- Modify: `tools/apps/weaver/src/lib/exportConfig.ts`

- [ ] **Step 1: Rewrite exportConfig.ts for multi-group export**

```typescript
// tools/apps/weaver/src/lib/exportConfig.ts

export interface MusicConfigV2 {
  version: 2;
  sample_rate: number;
  track_groups: TrackGroupConfig[];
}

export interface TrackGroupConfig {
  id: number;
  name: string;
  bpm?: number;
  loop_start: number;
  loop_end: number;
  markers: { frame: number; name: string }[];
  stems: { source: string; initial_volume: number }[];
}

import type { WeaverGroupConfig } from './projectTypes.js';

/**
 * Export all groups as a single music_config.json v2.
 * Strips editor-only fields (muted, soloed, loop_enabled).
 */
export function exportMultiGroupConfig(
  sampleRate: number,
  groups: WeaverGroupConfig[],
): MusicConfigV2 {
  return {
    version: 2,
    sample_rate: sampleRate,
    track_groups: groups.map((g, i) => ({
      id: i + 1,
      name: g.name,
      bpm: g.bpm,
      loop_start: g.loop_start,
      loop_end: g.loop_end,
      markers: [...g.markers].sort((a, b) => a.frame - b.frame),
      stems: g.stems.map((s) => ({
        source: s.source,
        initial_volume: s.initial_volume,
      })),
    })),
  };
}

/**
 * Trigger a browser download of a JSON object.
 */
export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/eccyan/dev/GSeurat/.worktrees/feature-audio-phase5-weaver/tools && pnpm --filter weaver build`

- [ ] **Step 3: Commit**

```bash
git add tools/apps/weaver/src/lib/exportConfig.ts
git commit -m "feat(weaver): multi-group export with editor-field stripping"
```

---

### Task 6: Update importConfig.ts — legacy v2 migration

**Files:**
- Modify: `tools/apps/weaver/src/lib/importConfig.ts`

- [ ] **Step 1: Add legacy migration alongside existing decode function**

```typescript
// tools/apps/weaver/src/lib/importConfig.ts

import { computeWaveformPeaks } from './waveformPeaks.js';
import type { StemState } from './types.js';
import type { MusicConfigV2 } from './exportConfig.js';
import type { WeaverProjectFile, WeaverGroupConfig } from './projectTypes.js';

/**
 * Decode a stem audio file to AudioBuffer + waveform peaks.
 */
export async function decodeStemFile(
  file: File,
  ctx: AudioContext,
): Promise<{ audioBuffer: AudioBuffer; waveformPeaks: Float32Array }> {
  const arrayBuffer = await file.arrayBuffer();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  const waveformPeaks = computeWaveformPeaks(audioBuffer);
  return { audioBuffer, waveformPeaks };
}

/**
 * Parse a music_config.json v2 and validate its structure.
 */
export function parseConfigJson(json: string): MusicConfigV2 {
  const data = JSON.parse(json);
  if (data.version !== 2) {
    throw new Error(`Unsupported music_config version: ${data.version}`);
  }
  return data as MusicConfigV2;
}

/**
 * Migrate a legacy music_config.json v2 into a WeaverProjectFile.
 * Adds editor-only defaults (loop_enabled, muted, soloed).
 */
export function migrateV2ToWeaverProject(
  config: MusicConfigV2,
  projectName: string,
): WeaverProjectFile {
  const groups: WeaverGroupConfig[] = config.track_groups.map((tg) => ({
    id: tg.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      || `group-${tg.id}`,
    name: tg.name,
    bpm: tg.bpm ?? 120,
    loop_start: tg.loop_start,
    loop_end: tg.loop_end,
    loop_enabled: true,
    markers: tg.markers.map((m) => ({ frame: m.frame, name: m.name })),
    stems: tg.stems.map((s) => ({
      source: s.source,
      initial_volume: s.initial_volume,
      muted: false,
      soloed: false,
    })),
  }));
  return {
    version: 1,
    name: projectName,
    sample_rate: config.sample_rate,
    groups,
  };
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/eccyan/dev/GSeurat/.worktrees/feature-audio-phase5-weaver/tools && pnpm --filter weaver build`

- [ ] **Step 3: Commit**

```bash
git add tools/apps/weaver/src/lib/importConfig.ts
git commit -m "feat(weaver): legacy music_config.json v2 to .weaver migration"
```

---

### Task 7: Create UI — EmptyProjectState, DirtyDialog, GroupSelector

**Files:**
- Create: `tools/apps/weaver/src/components/EmptyProjectState.tsx`
- Create: `tools/apps/weaver/src/components/DirtyDialog.tsx`
- Create: `tools/apps/weaver/src/components/GroupSelector.tsx`

- [ ] **Step 1: Create EmptyProjectState.tsx**

```typescript
// tools/apps/weaver/src/components/EmptyProjectState.tsx

import React from 'react';

interface EmptyProjectStateProps {
  hasProjectRoot: boolean;
  onOpenProjectRoot: () => void;
  onNewProject: () => void;
}

export function EmptyProjectState({
  hasProjectRoot,
  onOpenProjectRoot,
  onNewProject,
}: EmptyProjectStateProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        gap: 16,
        color: '#888',
      }}
    >
      <h2 style={{ color: '#77aaff', fontWeight: 700 }}>Weaver</h2>
      {!hasProjectRoot ? (
        <>
          <p>No project directory selected.</p>
          <button onClick={onOpenProjectRoot} style={{ padding: '8px 24px' }}>
            Open Project Root...
          </button>
        </>
      ) : (
        <>
          <p>No Weaver projects found in this directory.</p>
          <button onClick={onNewProject} style={{ padding: '8px 24px' }}>
            Create New Project
          </button>
          <button
            onClick={onOpenProjectRoot}
            style={{ padding: '4px 16px', fontSize: 11, opacity: 0.7 }}
          >
            Change Project Root...
          </button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create DirtyDialog.tsx**

```typescript
// tools/apps/weaver/src/components/DirtyDialog.tsx

import React from 'react';

interface DirtyDialogProps {
  groupName: string;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export function DirtyDialog({
  groupName,
  onSave,
  onDiscard,
  onCancel,
}: DirtyDialogProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: '#1e1e3e',
          border: '1px solid #555',
          borderRadius: 8,
          padding: '24px 32px',
          maxWidth: 400,
        }}
      >
        <p style={{ marginBottom: 16 }}>
          You have unsaved changes to <strong>{groupName}</strong>. Save before
          switching?
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel}>Cancel</button>
          <button onClick={onDiscard}>Discard</button>
          <button
            onClick={onSave}
            style={{ background: '#2255aa', fontWeight: 600 }}
          >
            Save & Switch
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create GroupSelector.tsx**

```typescript
// tools/apps/weaver/src/components/GroupSelector.tsx

import React, { useState } from 'react';
import { useWeaverStore } from '../store/useWeaverStore.js';

export function GroupSelector() {
  const groups = useWeaverStore((s) => s.groups);
  const activeGroupId = useWeaverStore((s) => s.activeGroupId);
  const addGroup = useWeaverStore((s) => s.addGroup);
  const duplicateGroup = useWeaverStore((s) => s.duplicateGroup);
  const deleteGroup = useWeaverStore((s) => s.deleteGroup);
  const switchGroup = useWeaverStore((s) => s.switchGroup);
  const dirty = useWeaverStore((s) => s.dirty);
  const saveProject = useWeaverStore((s) => s.saveProject);

  const [pendingSwitchId, setPendingSwitchId] = useState<string | null>(null);
  const [showNewInput, setShowNewInput] = useState(false);
  const [newName, setNewName] = useState('');

  const handleSwitchRequest = (id: string) => {
    if (id === activeGroupId) return;
    if (dirty) {
      setPendingSwitchId(id);
    } else {
      switchGroup(id);
    }
  };

  const handleDirtySave = async () => {
    await saveProject();
    if (pendingSwitchId) await switchGroup(pendingSwitchId);
    setPendingSwitchId(null);
  };

  const handleDirtyDiscard = async () => {
    if (pendingSwitchId) await switchGroup(pendingSwitchId);
    setPendingSwitchId(null);
  };

  const handleAdd = () => {
    if (!newName.trim()) return;
    addGroup(newName.trim());
    setNewName('');
    setShowNewInput(false);
    // Switch to the newly added group
    const state = useWeaverStore.getState();
    const last = state.groups[state.groups.length - 1];
    if (last) switchGroup(last.id);
  };

  const handleDelete = () => {
    if (!activeGroupId) return;
    if (!confirm('Delete this track group?')) return;
    deleteGroup(activeGroupId);
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: '#77aaff',
          marginBottom: 6,
        }}
      >
        Track Groups
      </div>

      {groups.length === 0 && (
        <div style={{ fontSize: 11, color: '#666', marginBottom: 8 }}>
          No groups yet. Add your first track group.
        </div>
      )}

      <div style={{ maxHeight: 150, overflowY: 'auto', marginBottom: 8 }}>
        {groups.map((g) => (
          <div
            key={g.id}
            onClick={() => handleSwitchRequest(g.id)}
            style={{
              padding: '4px 8px',
              cursor: 'pointer',
              fontSize: 11,
              borderRadius: 3,
              background:
                g.id === activeGroupId ? 'rgba(68,136,255,0.2)' : 'transparent',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span style={{ color: g.id === activeGroupId ? '#4488ff' : '#666' }}>
              {g.id === activeGroupId ? '●' : '○'}
            </span>
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {g.name}
            </span>
          </div>
        ))}
      </div>

      {showNewInput ? (
        <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="Group name"
            autoFocus
            style={{
              flex: 1,
              padding: '2px 6px',
              fontSize: 11,
              background: '#111',
              color: '#eee',
              border: '1px solid #555',
              borderRadius: 3,
            }}
          />
          <button onClick={handleAdd} style={{ fontSize: 10, padding: '2px 6px' }}>
            OK
          </button>
          <button
            onClick={() => setShowNewInput(false)}
            style={{ fontSize: 10, padding: '2px 6px' }}
          >
            ✕
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={() => setShowNewInput(true)}
            style={{ fontSize: 10, padding: '2px 8px' }}
          >
            + Add
          </button>
          <button
            onClick={() => activeGroupId && duplicateGroup(activeGroupId)}
            disabled={!activeGroupId}
            style={{
              fontSize: 10,
              padding: '2px 8px',
              opacity: activeGroupId ? 1 : 0.4,
            }}
          >
            Dup
          </button>
          <button
            onClick={handleDelete}
            disabled={!activeGroupId}
            style={{
              fontSize: 10,
              padding: '2px 8px',
              opacity: activeGroupId ? 1 : 0.4,
            }}
          >
            Del
          </button>
        </div>
      )}

      {/* Dirty dialog */}
      {pendingSwitchId && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: '#1e1e3e',
              border: '1px solid #555',
              borderRadius: 8,
              padding: '24px 32px',
              maxWidth: 400,
            }}
          >
            <p style={{ marginBottom: 16 }}>
              You have unsaved changes. Save before switching?
            </p>
            <div
              style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}
            >
              <button onClick={() => setPendingSwitchId(null)}>Cancel</button>
              <button onClick={handleDirtyDiscard}>Discard</button>
              <button
                onClick={handleDirtySave}
                style={{ background: '#2255aa', fontWeight: 600 }}
              >
                Save & Switch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify build**

Run: `cd /Users/eccyan/dev/GSeurat/.worktrees/feature-audio-phase5-weaver/tools && pnpm --filter weaver build`

- [ ] **Step 5: Commit**

```bash
git add tools/apps/weaver/src/components/EmptyProjectState.tsx tools/apps/weaver/src/components/DirtyDialog.tsx tools/apps/weaver/src/components/GroupSelector.tsx
git commit -m "feat(weaver): add GroupSelector, EmptyProjectState, and DirtyDialog components"
```

---

### Task 8: Update Sidebar — integrate GroupSelector

**Files:**
- Modify: `tools/apps/weaver/src/components/Sidebar.tsx`

- [ ] **Step 1: Update Sidebar to include GroupSelector and project-aware metadata**

```typescript
// tools/apps/weaver/src/components/Sidebar.tsx

import React from 'react';
import { useWeaverStore } from '../store/useWeaverStore.js';
import { GroupSelector } from './GroupSelector.js';

export function Sidebar() {
  return (
    <aside className="weaver-sidebar">
      <GroupSelector />
      <GroupMetadata />
      <MarkerList />
    </aside>
  );
}

function GroupMetadata() {
  const activeGroupId = useWeaverStore((s) => s.activeGroupId);
  const groups = useWeaverStore((s) => s.groups);
  const bpm = useWeaverStore((s) => s.bpm);
  const sampleRate = useWeaverStore((s) => s.sampleRate);
  const setBpm = useWeaverStore((s) => s.setBpm);
  const setGroupName = useWeaverStore((s) => s.setGroupName);

  const activeGroup = groups.find((g) => g.id === activeGroupId);
  if (!activeGroup) {
    return (
      <div style={{ fontSize: 11, color: '#666', padding: '8px 0' }}>
        Select or create a track group to edit.
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: '#77aaff',
          marginBottom: 6,
        }}
      >
        Group Metadata
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 11 }}>
        <span style={{ width: 80 }}>Name</span>
        <input
          type="text"
          value={activeGroup.name}
          onChange={(e) => setGroupName(e.target.value)}
          style={{ flex: 1, padding: '2px 6px', background: '#111', color: '#eee', border: '1px solid #555', borderRadius: 3, fontSize: 11 }}
        />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 11 }}>
        <span style={{ width: 80 }}>ID</span>
        <span style={{ color: '#888' }}>{activeGroup.id}</span>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 11 }}>
        <span style={{ width: 80 }}>BPM</span>
        <input
          type="number"
          value={bpm}
          onChange={(e) => setBpm(Number(e.target.value))}
          style={{ width: 60, padding: '2px 6px', background: '#111', color: '#eee', border: '1px solid #555', borderRadius: 3, fontSize: 11 }}
        />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
        <span style={{ width: 80 }}>Sample Rate</span>
        <span style={{ color: '#888' }}>{sampleRate}</span>
      </label>
    </div>
  );
}

function MarkerList() {
  const markers = useWeaverStore((s) => s.markers);
  const removeMarker = useWeaverStore((s) => s.removeMarker);
  const updateMarker = useWeaverStore((s) => s.updateMarker);
  const setPlayheadFrame = useWeaverStore((s) => s.setPlayheadFrame);
  const activeGroupId = useWeaverStore((s) => s.activeGroupId);

  if (!activeGroupId) return null;

  const sorted = [...markers]
    .map((m, i) => ({ ...m, origIdx: i }))
    .sort((a, b) => a.frame - b.frame);

  return (
    <div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: '#77aaff',
          marginBottom: 6,
        }}
      >
        Markers ({markers.length})
      </div>
      {sorted.length === 0 && (
        <div style={{ fontSize: 11, color: '#666' }}>
          Shift+click ruler to add markers
        </div>
      )}
      {sorted.map((m) => (
        <div
          key={m.origIdx}
          onClick={() => setPlayheadFrame(m.frame)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 0',
            cursor: 'pointer',
            fontSize: 11,
          }}
        >
          <span style={{ color: '#ffaa00', width: 60 }}>{m.frame}</span>
          <input
            type="text"
            value={m.name}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) =>
              updateMarker(m.origIdx, { name: e.target.value })
            }
            style={{
              flex: 1,
              padding: '1px 4px',
              background: '#111',
              color: '#eee',
              border: '1px solid #444',
              borderRadius: 2,
              fontSize: 11,
            }}
          />
          <button
            onClick={(e) => {
              e.stopPropagation();
              removeMarker(m.origIdx);
            }}
            style={{ padding: '0 4px', fontSize: 10 }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/eccyan/dev/GSeurat/.worktrees/feature-audio-phase5-weaver/tools && pnpm --filter weaver build`

- [ ] **Step 3: Commit**

```bash
git add tools/apps/weaver/src/components/Sidebar.tsx
git commit -m "feat(weaver): integrate GroupSelector into Sidebar with project-aware metadata"
```

---

### Task 9: Update Toolbar — Open/Save Project, updated Export

**Files:**
- Modify: `tools/apps/weaver/src/components/Toolbar.tsx`

- [ ] **Step 1: Rewrite Toolbar with project actions**

```typescript
// tools/apps/weaver/src/components/Toolbar.tsx

import React, { useRef } from 'react';
import { useWeaverStore } from '../store/useWeaverStore.js';
import { exportMultiGroupConfig, downloadJson } from '../lib/exportConfig.js';

export function Toolbar() {
  const fileRef = useRef<HTMLInputElement>(null);
  const addStem = useWeaverStore((s) => s.addStem);
  const isPlaying = useWeaverStore((s) => s.isPlaying);
  const setIsPlaying = useWeaverStore((s) => s.setIsPlaying);
  const setPlayheadFrame = useWeaverStore((s) => s.setPlayheadFrame);
  const zoomToFit = useWeaverStore((s) => s.zoomToFit);
  const loopEnabled = useWeaverStore((s) => s.loopEnabled);
  const setLoopEnabled = useWeaverStore((s) => s.setLoopEnabled);
  const saveProject = useWeaverStore((s) => s.saveProject);
  const projectName = useWeaverStore((s) => s.projectName);
  const sampleRate = useWeaverStore((s) => s.sampleRate);
  const activeGroupId = useWeaverStore((s) => s.activeGroupId);
  const dirty = useWeaverStore((s) => s.dirty);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      await addStem(file);
    }
    e.target.value = '';
  };

  const handleRewind = () => {
    const state = useWeaverStore.getState();
    if (state.isPlaying) {
      setIsPlaying(false);
      setPlayheadFrame(0);
      queueMicrotask(() => setIsPlaying(true));
    } else {
      setPlayheadFrame(0);
    }
  };

  const handleExport = () => {
    const state = useWeaverStore.getState();
    state.flushActiveGroup();
    const flushed = useWeaverStore.getState();
    const config = exportMultiGroupConfig(flushed.sampleRate, flushed.groups);
    downloadJson(config, `${flushed.projectName}.music.json`);
  };

  const handleSave = async () => {
    await saveProject();
  };

  return (
    <header className="weaver-toolbar">
      <span className="weaver-title">
        Weaver{' '}
        <span style={{ fontWeight: 400, fontSize: 11, color: '#888' }}>
          {projectName}
          {dirty ? ' *' : ''}
        </span>
      </span>
      <button onClick={handleSave} title="Cmd+S">
        Save
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".wav,.ogg,.mp3,.flac"
        multiple
        style={{ display: 'none' }}
        onChange={handleImport}
      />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={!activeGroupId}
        style={{ opacity: activeGroupId ? 1 : 0.4 }}
      >
        Import Stems
      </button>
      <button onClick={handleRewind}>⏮ Rewind</button>
      <button onClick={() => setIsPlaying(!isPlaying)}>
        {isPlaying ? 'Stop' : 'Play'}
      </button>
      <button
        onClick={() => setLoopEnabled(!loopEnabled)}
        style={{ opacity: loopEnabled ? 1 : 0.5 }}
      >
        {loopEnabled ? 'Loop ON' : 'Loop OFF'}
      </button>
      <button onClick={zoomToFit}>Zoom to Fit</button>
      <button onClick={handleExport}>Export v2 JSON</button>
    </header>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/eccyan/dev/GSeurat/.worktrees/feature-audio-phase5-weaver/tools && pnpm --filter weaver build`

- [ ] **Step 3: Commit**

```bash
git add tools/apps/weaver/src/components/Toolbar.tsx
git commit -m "feat(weaver): update Toolbar with Save Project, dirty indicator, multi-group export"
```

---

### Task 10: Update App.tsx — project root restore, empty states, Cmd+S

**Files:**
- Modify: `tools/apps/weaver/src/App.tsx`

- [ ] **Step 1: Rewrite App.tsx with project lifecycle**

```typescript
// tools/apps/weaver/src/App.tsx

import React, { useCallback, useEffect, useState } from 'react';
import './App.css';
import {
  saveProjectRootHandle,
  restoreProjectRoot,
} from '@gseurat/project-root';
import { useWeaverStore } from './store/useWeaverStore.js';
import { Toolbar } from './components/Toolbar.js';
import { TimelinePanel } from './components/TimelinePanel.js';
import { Sidebar } from './components/Sidebar.js';
import { EmptyProjectState } from './components/EmptyProjectState.js';
import { useAudioPlayer } from './hooks/useAudioPlayer.js';

export function App() {
  useAudioPlayer();

  const projectRootHandle = useWeaverStore((s) => s.projectRootHandle);
  const setProjectRootHandle = useWeaverStore((s) => s.setProjectRootHandle);
  const activeGroupId = useWeaverStore((s) => s.activeGroupId);
  const groups = useWeaverStore((s) => s.groups);
  const projectName = useWeaverStore((s) => s.projectName);

  const [projectList, setProjectList] = useState<string[]>([]);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  // Restore project root on startup
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const handle = await restoreProjectRoot('weaver');
        if (cancelled) return;
        if (handle) {
          setProjectRootHandle(handle);
        }
      } catch {
        console.info('[weaver] No project root to restore');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // List projects when root handle changes
  useEffect(() => {
    if (!projectRootHandle) return;
    (async () => {
      const list = await useWeaverStore.getState().listProjects();
      setProjectList(list);
      if (list.length === 1) {
        // Auto-open if single project
        await useWeaverStore.getState().loadProject(list[0]);
      } else if (list.length > 1) {
        setShowProjectPicker(true);
      }
    })();
  }, [projectRootHandle]);

  // Cmd+S keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        useWeaverStore.getState().saveProject();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleOpenProjectRoot = useCallback(async () => {
    try {
      // @ts-expect-error showDirectoryPicker is FSAPI extension
      const handle: FileSystemDirectoryHandle =
        await window.showDirectoryPicker({ mode: 'readwrite' });
      await saveProjectRootHandle('weaver', handle);
      setProjectRootHandle(handle);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        console.error('[weaver] Failed to set project root:', e);
      }
    }
  }, []);

  const handleNewProject = useCallback(() => {
    const name = prompt('Project name:');
    if (!name?.trim()) return;
    useWeaverStore.getState().newProject(name.trim());
  }, []);

  const handleOpenProject = useCallback(async (name: string) => {
    await useWeaverStore.getState().loadProject(name);
    setShowProjectPicker(false);
  }, []);

  // Empty state: no project root
  if (!projectRootHandle) {
    return (
      <EmptyProjectState
        hasProjectRoot={false}
        onOpenProjectRoot={handleOpenProjectRoot}
        onNewProject={handleNewProject}
      />
    );
  }

  // Empty state: project root set, show project picker or create new
  if (!projectName || projectName === 'untitled') {
    if (projectList.length === 0) {
      return (
        <EmptyProjectState
          hasProjectRoot={true}
          onOpenProjectRoot={handleOpenProjectRoot}
          onNewProject={handleNewProject}
        />
      );
    }
    if (showProjectPicker) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            gap: 8,
            color: '#888',
          }}
        >
          <h2 style={{ color: '#77aaff' }}>Open Project</h2>
          {projectList.map((name) => (
            <button
              key={name}
              onClick={() => handleOpenProject(name)}
              style={{ padding: '8px 32px', minWidth: 200 }}
            >
              {name}
            </button>
          ))}
          <button
            onClick={handleNewProject}
            style={{
              marginTop: 16,
              padding: '4px 16px',
              fontSize: 11,
              opacity: 0.7,
            }}
          >
            + New Project
          </button>
        </div>
      );
    }
  }

  return (
    <div className="weaver">
      <Toolbar />
      <main className="weaver-body">
        <TimelinePanel />
        <Sidebar />
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/eccyan/dev/GSeurat/.worktrees/feature-audio-phase5-weaver/tools && pnpm --filter weaver build`

- [ ] **Step 3: Commit**

```bash
git add tools/apps/weaver/src/App.tsx
git commit -m "feat(weaver): add project root restore, empty states, Cmd+S, project picker"
```

---

### Task 11: Fix remaining build errors and integration pass

After all individual tasks, there may be import mismatches or unused references. This task resolves any remaining build errors.

**Files:**
- Any files with build errors

- [ ] **Step 1: Run full build and fix any errors**

Run: `cd /Users/eccyan/dev/GSeurat/.worktrees/feature-audio-phase5-weaver/tools && pnpm --filter weaver build`

Common issues to look for:
- `MusicConfigV2` / `TrackGroupConfig` imports — now exported from `exportConfig.ts`
- `groupId` / `getExportData` references — removed from store
- `groupName` references — replaced by `projectName` (project-level) or `activeGroup.name`
- Missing `@gseurat/project-root` resolve conditions — may need to add `conditions: ['source']` in vite.config.ts if not already present

Check `vite.config.ts` has `resolve.conditions: ['source']` (it should, based on the Bricklayer pattern).

- [ ] **Step 2: Verify full build passes**

Run: `cd /Users/eccyan/dev/GSeurat/.worktrees/feature-audio-phase5-weaver/tools && pnpm --filter weaver build`
Expected: PASS with zero errors

- [ ] **Step 3: Commit if any fixes were needed**

```bash
git add -A tools/apps/weaver/
git commit -m "fix(weaver): resolve build errors from project restructure"
```

---

### Task 12: Unit tests

**Files:**
- Create: `tools/apps/weaver/src/lib/__tests__/exportConfig.test.ts`
- Create: `tools/apps/weaver/src/lib/__tests__/slugify.test.ts`
- Create: `tools/apps/weaver/src/lib/__tests__/importConfig.test.ts`

- [ ] **Step 1: Create export tests**

```typescript
// tools/apps/weaver/src/lib/__tests__/exportConfig.test.ts

import { describe, it, expect } from 'vitest';
import { exportMultiGroupConfig } from '../exportConfig.js';
import type { WeaverGroupConfig } from '../projectTypes.js';

describe('exportMultiGroupConfig', () => {
  it('exports multiple groups with sequential IDs', () => {
    const groups: WeaverGroupConfig[] = [
      {
        id: 'field', name: 'Field Theme', bpm: 120,
        loop_start: 0, loop_end: 44100, loop_enabled: true,
        markers: [{ frame: 100, name: 'A' }],
        stems: [{ source: 'a.wav', initial_volume: 0.8, muted: false, soloed: true }],
      },
      {
        id: 'dungeon', name: 'Dungeon Theme', bpm: 90,
        loop_start: 1000, loop_end: 50000, loop_enabled: false,
        markers: [],
        stems: [{ source: 'b.wav', initial_volume: 1, muted: true, soloed: false }],
      },
    ];

    const result = exportMultiGroupConfig(44100, groups);

    expect(result.version).toBe(2);
    expect(result.sample_rate).toBe(44100);
    expect(result.track_groups).toHaveLength(2);
    expect(result.track_groups[0].id).toBe(1);
    expect(result.track_groups[1].id).toBe(2);
    expect(result.track_groups[0].name).toBe('Field Theme');
    expect(result.track_groups[1].name).toBe('Dungeon Theme');
  });

  it('strips editor-only fields (muted, soloed)', () => {
    const groups: WeaverGroupConfig[] = [
      {
        id: 'test', name: 'Test', bpm: 120,
        loop_start: 0, loop_end: 1000, loop_enabled: true,
        markers: [],
        stems: [{ source: 'x.wav', initial_volume: 1, muted: true, soloed: true }],
      },
    ];

    const result = exportMultiGroupConfig(44100, groups);
    const stem = result.track_groups[0].stems[0];

    expect(stem).toEqual({ source: 'x.wav', initial_volume: 1 });
    expect('muted' in stem).toBe(false);
    expect('soloed' in stem).toBe(false);
  });

  it('strips loop_enabled from group level', () => {
    const groups: WeaverGroupConfig[] = [
      {
        id: 'test', name: 'Test', bpm: 120,
        loop_start: 0, loop_end: 1000, loop_enabled: false,
        markers: [], stems: [],
      },
    ];

    const result = exportMultiGroupConfig(44100, groups);
    expect('loop_enabled' in result.track_groups[0]).toBe(false);
  });

  it('sorts markers by frame', () => {
    const groups: WeaverGroupConfig[] = [
      {
        id: 'test', name: 'Test', bpm: 120,
        loop_start: 0, loop_end: 1000, loop_enabled: true,
        markers: [{ frame: 300, name: 'B' }, { frame: 100, name: 'A' }],
        stems: [],
      },
    ];

    const result = exportMultiGroupConfig(44100, groups);
    expect(result.track_groups[0].markers[0].name).toBe('A');
    expect(result.track_groups[0].markers[1].name).toBe('B');
  });
});
```

- [ ] **Step 2: Create slugify tests**

```typescript
// tools/apps/weaver/src/lib/__tests__/slugify.test.ts

import { describe, it, expect } from 'vitest';
import { slugify, uniqueSlug } from '../slugify.js';

describe('slugify', () => {
  it('lowercases and replaces spaces', () => {
    expect(slugify('Field Theme')).toBe('field-theme');
  });

  it('strips special characters', () => {
    expect(slugify('My Song! (remix)')).toBe('my-song-remix');
  });

  it('returns "untitled" for empty input', () => {
    expect(slugify('')).toBe('untitled');
    expect(slugify('!!!')).toBe('untitled');
  });
});

describe('uniqueSlug', () => {
  it('returns base slug when no conflict', () => {
    expect(uniqueSlug('Field', ['dungeon'])).toBe('field');
  });

  it('appends -2 on first conflict', () => {
    expect(uniqueSlug('Field', ['field'])).toBe('field-2');
  });

  it('increments until unique', () => {
    expect(uniqueSlug('Field', ['field', 'field-2', 'field-3'])).toBe('field-4');
  });
});
```

- [ ] **Step 3: Create import/migration tests**

```typescript
// tools/apps/weaver/src/lib/__tests__/importConfig.test.ts

import { describe, it, expect } from 'vitest';
import { migrateV2ToWeaverProject } from '../importConfig.js';
import type { MusicConfigV2 } from '../exportConfig.js';

describe('migrateV2ToWeaverProject', () => {
  const v2Config: MusicConfigV2 = {
    version: 2,
    sample_rate: 44100,
    track_groups: [
      {
        id: 1,
        name: 'Field Theme',
        bpm: 120,
        loop_start: 1000,
        loop_end: 50000,
        markers: [{ frame: 2000, name: 'Drop' }],
        stems: [{ source: 'assets/audio/field/bass.wav', initial_volume: 0.8 }],
      },
    ],
  };

  it('creates a valid WeaverProjectFile', () => {
    const result = migrateV2ToWeaverProject(v2Config, 'my-project');
    expect(result.version).toBe(1);
    expect(result.name).toBe('my-project');
    expect(result.sample_rate).toBe(44100);
    expect(result.groups).toHaveLength(1);
  });

  it('adds editor-only defaults', () => {
    const result = migrateV2ToWeaverProject(v2Config, 'test');
    const group = result.groups[0];
    expect(group.loop_enabled).toBe(true);
    expect(group.stems[0].muted).toBe(false);
    expect(group.stems[0].soloed).toBe(false);
  });

  it('generates slug IDs from group names', () => {
    const result = migrateV2ToWeaverProject(v2Config, 'test');
    expect(result.groups[0].id).toBe('field-theme');
  });

  it('preserves markers and stem data', () => {
    const result = migrateV2ToWeaverProject(v2Config, 'test');
    const group = result.groups[0];
    expect(group.markers).toEqual([{ frame: 2000, name: 'Drop' }]);
    expect(group.stems[0].source).toBe('assets/audio/field/bass.wav');
    expect(group.stems[0].initial_volume).toBe(0.8);
  });
});
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/eccyan/dev/GSeurat/.worktrees/feature-audio-phase5-weaver/tools && pnpm --filter weaver test -- --run`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add tools/apps/weaver/src/lib/__tests__/
git commit -m "test(weaver): add unit tests for multi-group export, slugify, and v2 migration"
```

---

### Task 13: Final build verification

- [ ] **Step 1: Full build**

Run: `cd /Users/eccyan/dev/GSeurat/.worktrees/feature-audio-phase5-weaver/tools && pnpm --filter weaver build`
Expected: PASS

- [ ] **Step 2: Run all tests**

Run: `cd /Users/eccyan/dev/GSeurat/.worktrees/feature-audio-phase5-weaver/tools && pnpm --filter weaver test -- --run`
Expected: All PASS

- [ ] **Step 3: Verify no regressions in other packages**

Run: `cd /Users/eccyan/dev/GSeurat/.worktrees/feature-audio-phase5-weaver/tools && pnpm build`
Expected: All packages build successfully

- [ ] **Step 4: Commit plan doc**

```bash
git add docs/superpowers/plans/2026-04-18-audio-phase6-multitrack.md
git commit -m "docs: add Phase 6 multi-track implementation plan"
```
