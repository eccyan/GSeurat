# Phase 6: Multi-Track Management & Project Directory — Design Spec

**Date:** 2026-04-18
**Status:** Design approved, ready for implementation planning
**Branch:** `feature/audio-phase6-multitrack`
**Depends on:** Phase 5 (Weaver) — merged as PR #280

---

## 1. Purpose and scope

Evolve Weaver from a single-group editor into a project-based multi-track
authoring tool. Introduces a `.weaver` project file format that separates
authoring data from the engine's runtime `music_config.json` v2, and adds
a project directory workflow using the File System Access API (matching
Echidna's `@gseurat/project-root` pattern).

### In scope

- `.weaver` project file format (version 1) — authoring source of truth
- Project directory via File System Access API + `@gseurat/project-root`
- Zustand store restructure: project-level + active-group state
- Group Selector UI in sidebar (add, duplicate, delete, switch)
- Dirty tracking with save/discard/cancel on group switch
- Multi-group export to single `music_config.json` v2
- Save/load project (Cmd+S, Open Project)
- Empty state UI (no project root, no projects, no groups)

### Out of scope

- Transition preview between groups (engine-side feature)
- Drag-and-drop reordering of groups
- Per-group sample rate (project-level only)
- Undo/redo across group switches
- AI generation or procedural features

---

## 2. Architecture — Authoring Data vs. Runtime Data

**Key principle:** The `.weaver` project file is the authoring source of truth.
The engine's `music_config.json` v2 is a derived export artifact. This is
analogous to `.blend` → `.gltf` or `.aup3` → `.ogg`.

### Project file (`.weaver`)

Saved to `tools_data/weaver/<project-name>.weaver` via the File System
Access API. Contains all group metadata, editor-only state, and stem
source paths. Does NOT contain decoded audio data.

```typescript
interface WeaverProjectFile {
  version: 1;
  name: string;                    // project display name
  sample_rate: number;             // shared across all groups
  groups: WeaverGroupConfig[];     // all group metadata
}

interface WeaverGroupConfig {
  id: string;                      // stable slug (e.g., "field-theme")
  name: string;                    // display name
  bpm: number;
  loop_start: number;              // frames
  loop_end: number;                // frames
  loop_enabled: boolean;           // editor-only — stripped on export
  markers: { frame: number; name: string }[];
  stems: WeaverStemConfig[];
}

interface WeaverStemConfig {
  source: string;                  // relative path (e.g., "assets/audio/field/bass.ogg")
  initial_volume: number;
  muted: boolean;                  // editor-only — stripped on export
  soloed: boolean;                 // editor-only — stripped on export
}
```

### Export file (`music_config.json` v2)

Pure derived output. Strips all editor-only fields (`muted`, `soloed`,
`loop_enabled`). Serializes ALL groups into a single `track_groups` array.

```json
{
  "version": 2,
  "sample_rate": 44100,
  "track_groups": [
    { "id": 1, "name": "field-theme", "bpm": 120, ... },
    { "id": 2, "name": "dungeon-theme", "bpm": 90, ... }
  ]
}
```

---

## 3. Zustand store architecture

The store splits into project-level state (persisted to `.weaver`) and
active-group state (one group loaded at a time, Echidna pattern).

```typescript
interface WeaverStore {
  // === Project-level (persisted to .weaver) ===
  projectName: string;
  sampleRate: number;
  groups: WeaverGroupConfig[];     // lightweight metadata for ALL groups
  dirty: boolean;                  // unsaved project changes

  // Project I/O
  projectRootHandle: FileSystemDirectoryHandle | null;
  setProjectRootHandle: (h: FileSystemDirectoryHandle) => void;
  saveProject: () => Promise<void>;
  loadProject: (name: string) => Promise<void>;
  listProjects: () => Promise<string[]>;
  newProject: (name: string) => void;

  // Group CRUD (operates on groups[] array)
  addGroup: (name: string) => void;
  duplicateGroup: (id: string) => void;
  deleteGroup: (id: string) => void;
  renameGroup: (id: string, name: string) => void;

  // === Active group (one at a time) ===
  activeGroupId: string | null;
  switchGroup: (id: string) => Promise<void>;

  // Active group's live state (decoded audio + editing state)
  stems: StemState[];              // with AudioBuffer + waveformPeaks
  loopStart: number;
  loopEnd: number;
  loopEnabled: boolean;
  bpm: number;
  markers: MarkerState[];
  playheadFrame: number;
  isPlaying: boolean;

  // Mutators for active group (existing)
  addStem: (file: File) => Promise<void>;
  removeStem: (index: number) => void;
  setStemVolume: (index: number, volume: number) => void;
  toggleMute: (index: number) => void;
  toggleSolo: (index: number) => void;
  setLoopStart: (frame: number) => void;
  setLoopEnd: (frame: number) => void;
  setLoopEnabled: (enabled: boolean) => void;
  setBpm: (bpm: number) => void;
  addMarker: (frame: number, name?: string) => void;
  removeMarker: (index: number) => void;
  updateMarker: (index: number, patch: Partial<MarkerState>) => void;
  moveMarker: (index: number, frame: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setPlayheadFrame: (frame: number) => void;

  // Export
  exportMusicConfig: () => MusicConfigV2;  // ALL groups → single v2 JSON

  // Viewport (editor-only, not persisted)
  viewStartFrame: number;
  viewEndFrame: number;
  setView: (start: number, end: number) => void;
  zoomToFit: () => void;
  maxFrames: () => number;
}
```

### `switchGroup(id)` flow

1. If active group exists: flush current live state back into `groups[]` entry
2. Stop playback, discard all `AudioBuffer` and `waveformPeaks` objects
3. Set `activeGroupId = id`
4. Read new group's `WeaverGroupConfig` from `groups[]`
5. For each stem, fetch + decode audio file from `source` path (relative to project root)
6. Compute `waveformPeaks` for each decoded stem
7. Populate live state (bpm, markers, loop points, stems with buffers)
8. Call `zoomToFit()`

### `flushActiveGroup()` helper

Writes current live state (bpm, markers, loop points, stem volumes,
muted/soloed) back into the matching `groups[]` entry. Called by:
- `switchGroup()` — before switching away
- `saveProject()` — before serializing
- `exportMusicConfig()` — before exporting

### `saveProject()` flow

1. Call `flushActiveGroup()`
2. Serialize `{ version: 1, name, sample_rate, groups }` (no AudioBuffers)
3. Write to `tools_data/weaver/<projectName>.weaver` via FSAPI
4. Set `dirty = false`

### `exportMusicConfig()` flow

1. Call `flushActiveGroup()`
2. Map ALL `groups[]` → `track_groups[]`:
   - Assign sequential `id` (1, 2, 3, ...)
   - Strip `muted`, `soloed`, `loop_enabled` from stems
   - Strip `loop_enabled` from group level
3. Return `{ version: 2, sample_rate, track_groups }`
4. Trigger browser download as `<projectName>.music.json`

---

## 4. UI components

### Layout (updated sidebar)

```
┌─────────────────────────────────────────────────────────┐
│  Toolbar: [Open Project] [Save] [Import Stems]          │
│           [⏮ Rewind] [Play/Stop] [Loop ON]              │
│           [Zoom to Fit] [Export v2 JSON]                 │
├──────────────────────────────────────────┬──────────────┤
│  Ruler                                  │  Sidebar     │
│  ├─ loop handles                        │  ┌──────────┐│
│  └─ markers + playhead                  │  │ Groups   ││
│─────────────────────────────────────────│  │ ● field  ││
│  Lane 0: [waveform] [M][S] [vol] [×]   │  │ ○ dung.  ││
│  Lane 1: [waveform] [M][S] [vol] [×]   │  │ ○ battle ││
│  ...N lanes                             │  │[+][dup][×]││
│  [+ Add Stem]                           │  ├──────────┤│
│                                         │  │ Group    ││
│                                         │  │ metadata ││
│                                         │  ├──────────┤│
│                                         │  │ Markers  ││
│                                         │  │ list     ││
│                                         │  └──────────┘│
└──────────────────────────────────────────┴──────────────┘
```

### GroupSelector (new component)

- List of all groups from `store.groups[]`
- Active group shown with filled dot (●), others with empty (○)
- Click row → `switchGroup(id)` — if dirty, prompt save/discard/cancel
- **[+ Add]** — prompts for name, creates empty group, switches to it
- **[Duplicate]** — copies active group's config (not AudioBuffers)
- **[Delete]** — confirms, deletes from `groups[]`, switches to next

### GroupMetadata (updated)

- **Name** — editable, calls `renameGroup()`
- **BPM** — editable, updates active group's `bpm`
- **Sample Rate** — displayed read-only (project-level, set at creation)

### Toolbar (updated)

- **Open Project** — `window.showDirectoryPicker()` → set project root
  → list `.weaver` files → open selected (or show "New Project" if none)
- **Save Project** (Cmd+S) — `saveProject()`
- **Import Stems** — unchanged, adds to active group
- **Export v2 JSON** — exports ALL groups from project

### Empty states

1. **No project root** — full-page "Open Project Root..." button
   (uses `EmptyProjectState` pattern from Echidna)
2. **Project root set, no `.weaver` files** — "Create New Project" button
   with name input
3. **Project loaded, no groups** — "Add your first track group" prompt
   in the timeline area

### Dirty state dialog

On `switchGroup()` when `dirty === true`:

> "You have unsaved changes to [group name]. Save before switching?"
> [Save & Switch] [Discard & Switch] [Cancel]

---

## 5. File System Access API integration

Reuse `@gseurat/project-root` package (same as Echidna):

- `saveProjectRootHandle('weaver', handle)` — persist to IndexedDB
- `restoreProjectRoot('weaver')` — recover on app startup
- `PROJECT_LAYOUT.toolsData.weaverSaves` — path constant for
  `tools_data/weaver/`

### Project file operations (new `lib/projectFs.ts`)

```typescript
// List all .weaver files in tools_data/weaver/
async function listWeaverProjects(root: FileSystemDirectoryHandle): Promise<string[]>

// Save project to tools_data/weaver/<name>.weaver
async function saveWeaverProject(
  root: FileSystemDirectoryHandle,
  project: WeaverProjectFile,
): Promise<void>

// Load project from tools_data/weaver/<name>.weaver
async function loadWeaverProject(
  root: FileSystemDirectoryHandle,
  name: string,
): Promise<WeaverProjectFile>

// Resolve stem audio file relative to project root
async function loadStemAudio(
  root: FileSystemDirectoryHandle,
  sourcePath: string,
  audioContext: AudioContext,
): Promise<AudioBuffer>
```

---

## 6. Backward compatibility — importing legacy single-group files

The existing "Import" flow (loading a `.music.json` v2 with a single
`track_groups` entry) should still work. When a user opens a legacy
`.music.json`:

1. Create a new `.weaver` project from it
2. Each `track_groups` entry becomes a `WeaverGroupConfig`
3. Add `loop_enabled: true`, `muted: false`, `soloed: false` defaults
4. Prompt user to set a project name and save

This preserves the quick-start workflow from Phase 5 while migrating
users to the project-based model.

---

## 7. Testing

| # | Test | Method |
|---|---|---|
| 1 | Save/load round-trip | Unit: create project → save → load → assert identical |
| 2 | Export produces valid v2 JSON | Unit: multi-group project → export → validate schema |
| 3 | Editor-only fields stripped on export | Unit: muted/soloed/loop_enabled not in output |
| 4 | Group CRUD | Unit: add/duplicate/delete → verify groups[] |
| 5 | flushActiveGroup | Unit: mutate live state → flush → verify groups[] entry |
| 6 | switchGroup discards buffers | Unit: verify AudioBuffer refs are nulled |
| 7 | Legacy import | Unit: v2 JSON → .weaver project with correct defaults |
| 8 | Build succeeds | CI: `pnpm --filter weaver build` |

---

## 8. Files

**New files:**
- `tools/apps/weaver/src/lib/projectFs.ts` — FSAPI project file operations
- `tools/apps/weaver/src/lib/projectTypes.ts` — WeaverProjectFile, WeaverGroupConfig, WeaverStemConfig
- `tools/apps/weaver/src/components/GroupSelector.tsx` — group list + CRUD buttons
- `tools/apps/weaver/src/components/EmptyProjectState.tsx` — no-project-root screen
- `tools/apps/weaver/src/components/DirtyDialog.tsx` — save/discard/cancel prompt

**Modified files:**
- `tools/apps/weaver/src/store/useWeaverStore.ts` — project-level + active-group split
- `tools/apps/weaver/src/lib/types.ts` — add project types, keep StemState/MarkerState
- `tools/apps/weaver/src/lib/exportConfig.ts` — multi-group export
- `tools/apps/weaver/src/lib/importConfig.ts` — legacy v2 JSON → .weaver migration
- `tools/apps/weaver/src/components/Toolbar.tsx` — Open/Save Project buttons
- `tools/apps/weaver/src/components/Sidebar.tsx` — add GroupSelector, update GroupMetadata
- `tools/apps/weaver/src/App.tsx` — project root restore on startup, empty states

**Unchanged:** Engine code, Ruler, StemLane, TimelinePanel, useAudioPlayer, waveformPeaks, frameUtils.

**Package dependency:** `@gseurat/project-root` (already exists, used by Echidna)

---

## 9. Decision log

| # | Decision | Rationale |
|---|---|---|
| 1 | Separate `.weaver` from `music_config.json` | Authoring data ≠ runtime data; like .blend → .gltf |
| 2 | Single group in memory (Echidna pattern) | AudioBuffers are large; constant memory footprint |
| 3 | Project-level sample rate | Engine mixer uses single rate; prevents invalid configs |
| 4 | Editor-only fields in project file | muted/soloed/loop_enabled improve UX, stripped on export |
| 5 | Reuse `@gseurat/project-root` | Consistent FSAPI pattern across all GSeurat tools |
| 6 | Legacy import creates .weaver | Preserves Phase 5 quick-start, migrates to new model |
| 7 | flush-before-switch pattern | Prevents data loss; single source of truth in groups[] |
