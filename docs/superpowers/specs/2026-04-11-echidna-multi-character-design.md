# Echidna Multi-Character Management — Design

**Phase**: 0.2
**Date**: 2026-04-11
**Scope**: Echidna only (tools/apps/echidna)
**Effort estimate**: ~12–15 hours
**Depends on**: Phase 0.0 Foundation (project root handle, `@gseurat/project-root`, `tools_data/echidna_saves/{id}.echidna` layout, `ensureCharacterId`, `migrateEchidnaFile`)

## Goal

Echidna today treats one character as the entire editor state. Opening a different character means clobbering whatever's in memory — there's no list view, no switching, no management UI. This design turns Echidna into a proper project-based editor where the user opens a project root and then browses, switches, and manages many characters inside it.

Phase 0.2 is deliberately **multi-character only**, not multi-asset. Echidna producing PLYs for maps and VFX objects — the "multi-asset" framing from the 2026-04-11 review session — is Phase 0.3. Shipping multi-character first is a stepping stone: it validates the project-first UX patterns (list, switch, dirty guard) before expanding to new asset kinds.

## Design decisions (resolved during brainstorming)

| # | Decision | Choice |
|---|---|---|
| 1 | Scope | Multi-character now, multi-asset (maps + objects) deferred to Phase 0.3 |
| 2 | Switching workflow | Persistent left-sidebar project panel (not modal, not tabs) |
| 3 | Panel placement | Collapsible top section of the existing left column |
| 4 | Empty state | Project-first: on first launch with no project root, show welcome + "Open Project Root…" button; no anonymous in-memory editing |
| 5 | Save-on-switch | Modal with `Save & Switch` / `Discard & Switch` / `Cancel`, warning includes undo-depth when stack has entries |
| 6 | Feature scope | Core + Rename + Duplicate + Delete (all three management ops) |
| 7 | Méliès Object PLYs | Leave alone; still waiting on Phase 0.3 |
| 8 | Rename semantics | Display name only — `id`/filename stay immutable; no dangling Bricklayer refs |
| 9 | Implementation approach | Per-character state slice (Approach 2) — clean store design from the start |
| 10 | Delete cleanup | `.echidna` source only; `assets/characters/{id}/*` stay on disk |
| 11 | Menu structure | Parent-child dropdown — `Project`, `Import`, `Export` submenus |
| 12 | Primary save action | `⌘S Save` writes both `.echidna` and builds PLY + manifest in one action |

## Store architecture

The biggest single chunk of work is the store refactor. Today `useCharacterStore` is ~900 lines and mixes per-character data (voxels, parts, poses, animations, characterName) with global state (projectRootHandle, tool, mode, camera). Phase 0.2 splits these into two clearly-bounded slices.

### State shape after refactor

```ts
interface EchidnaStoreState {
  // ─── Per-character slice ───────────────────────────────
  // Nullable: null when no character is loaded (empty project or just
  // after Delete). Swapped atomically on openCharacter(). Never referenced
  // directly from outside the store; always go through actions.
  character: {
    id: string;                                 // slug, stable for the character's lifetime
    characterName: string;                      // display name
    gridWidth: number;
    gridDepth: number;
    voxels: Map<string, Voxel>;
    characterParts: BodyPart[];
    characterPoses: Record<string, PoseData>;
    animations: Record<string, AnimationClip>;
    currentFilename: string | null;             // legacy .echidna download target
  } | null;

  // ─── Global slice ──────────────────────────────────────
  // Survives character switches.
  projectRootHandle: FileSystemDirectoryHandle | null;
  knownCharacters: CharacterListEntry[];        // the panel's data source
  dirty: boolean;                                // true after any per-character mutation

  mode: 'build' | 'animate';
  tool: ToolType;
  brushSize: number;
  xrayMode: boolean;
  showGrid: boolean;
  showGizmos: boolean;
  boxSelection: BoxSelection | null;
  lassoSelection: LassoSelection | null;
  clipboard: Clipboard | null;
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];
  // ... camera orbit, preview settings, etc.
}

interface CharacterListEntry {
  id: string;           // slug / filename root
  name: string;         // display name read from file
  lastModified: number; // file mtime for sort
}
```

### Slice boundary rule

**If editing two characters would legitimately have different values, it's per-character. Otherwise global.**

- **Per-character**: voxels, parts, poses, animations, characterName, gridWidth/Depth, currentFilename
- **Global**: projectRootHandle, knownCharacters, dirty, mode, tool, brushSize, xrayMode, showGrid, showGizmos, selections, clipboard, undo/redo stacks, camera

**Why no `currentCharacterId` in the global slice**: the loaded character's id is simply `state.character?.id`. Storing it as a separate top-level field creates a "must stay in sync" rule with no upside — there is no state where the two would differ. Consumers that want "which character is loaded" read `state.character?.id ?? null`.

### Undo/redo on switch

The undo stack is **cleared on openCharacter**. It's per-character in spirit but lives in the global slice so it's explicitly reset rather than restored from some per-character history. Restoring stacks across switches adds complexity Phase 0.2 doesn't need.

**The switch-with-undo warning**: the save-on-switch modal triggers when `dirty === true` OR `undoStack.length > 0`. Dirty reflects "unsaved file changes"; undo depth reflects "history you'd lose." Both matter. The modal message dynamically includes the undo depth when `undoStack.length > 0`:

> You have unsaved changes to **Walker Bot**.
> Switching characters will clear your undo history (12 steps) in addition to any unsaved edits.
> **[Save & Switch] [Discard & Switch] [Cancel]**

When undo depth is 0 (e.g., user just opened the character and immediately started editing), the second line is omitted.

### Action categorisation

Every action falls into one of three buckets:

1. **Per-character mutation** — touches `state.character.*`. Examples: `addVoxel`, `removeVoxel`, `setCharacterName`, `addPart`, `setPose`, `addAnimation`. These automatically call `markDirty()` inside the `set()`.
2. **Global mutation** — touches top-level state. Examples: `setMode`, `setTool`, `setBrushSize`, `setProjectRootHandle`, `setXrayMode`. Never touch `dirty`.
3. **Lifecycle** — the new actions: `listCharacters`, `openCharacter`, `requestOpenCharacter`, `newCharacter`, `save`, `renameCharacter`, `duplicateCharacter`, `deleteCharacter`, `markDirty`, `markClean`.

### The mechanical rename commit

Every site that reads `state.voxels` becomes `state.character.voxels` etc. This touches ~10 files: `useCharacterStore.ts`, `CharacterViewport.tsx`, `BuildPanel.tsx`, `PosePanel.tsx`, `PartsPanel.tsx`, `AnimateLeftPanel.tsx`, `AnimateRightPanel.tsx`, `Timeline.tsx`, and the ~10 test files. The plan isolates this into a **single mechanical rename commit** before any new feature code lands, so the diff stays reviewable. The commit is validated by running the existing test suite and confirming the same pass/fail count as before.

## UI components

### New components

**`panels/CharactersPanel.tsx`** — the collapsible section at the top of the left column.

```
┌─ Characters ─────────── [−] ┐    ← collapse toggle
│ ● Walker Bot            ⋯  │    ← current, dirty indicator + menu
│ ○ Archer                ⋯  │
│ ○ Mage                  ⋯  │
│ + New Character             │    ← trailing button
└────────────────────────────┘
```

- Row states: current (`●` or highlighted row), other (`○` ghost dot), dirty (`●` orange after name on current row only)
- Click any non-current row → triggers `requestOpenCharacter(id)`
- `⋯` button (or right-click context menu) on each row → **Rename / Duplicate / Delete**
- Collapse toggle in the header stores preference in `localStorage` — independent of mode
- When project root is set but there are 0 characters: small inline "No characters yet. Click **+ New Character** to start."

**`panels/EmptyProjectState.tsx`** — full-viewport welcome shown when `projectRootHandle === null`.

- Centered heading "No project open"
- Subtext explaining project-root semantics
- Big **Open Project Root…** button (triggers the same action as `handlePickProjectRoot` in MenuBar)
- Replaces the `CharacterViewport` in the center column — the R3F canvas is NOT mounted when there's no project. Avoids the "empty 3D scene" state

**`panels/SwitchCharacterDialog.tsx`** — the three-way modal (reusable for discard-on-new, discard-on-delete-current, etc.).

Props: `{ currentName: string; targetName: string; undoDepth: number; onSave, onDiscard, onCancel }`. Message template composes dynamically based on `undoDepth`. Shared by every flow that needs a dirty-state guard.

**`panels/RenameCharacterDialog.tsx`** — small modal with one text input, prefilled with current `characterName`. Enter submits, Esc cancels. Validation: non-empty after trim, max 64 chars, matches `/^[A-Za-z0-9 _\-]+$/`.

**`panels/DeleteCharacterDialog.tsx`** — confirmation. "Delete **Walker Bot**? The `.echidna` source file will be removed from `tools_data/echidna_saves/`. **Exported files in `assets/characters/{id}/` will NOT be removed.** This cannot be undone." Two buttons: `[Cancel]` `[Delete]`, Delete is red.

**`panels/DuplicateCharacterDialog.tsx`** — same shape as Rename, but the submit mints a new `id` via `slugifyCharacterId(newName)` with automatic collision-suffix (`walker_bot_2`, `walker_bot_3`, etc.).

### Modified components

**`App.tsx`** — three changes:

1. Left column gains the `CharactersPanel` section above the existing `ModeTabs` → tool/animate panel. The two sections share the left column's height with an internal drag handle.
2. Center column routes between `EmptyProjectState` (no project) and `CharacterViewport` (project open AND `state.character !== null`). If project is open but `state.character === null`, show a simpler "Select a character from the panel or create a new one" placeholder in the same slot.
3. New `beforeunload` handler matching Bricklayer's: `e.preventDefault()` when `dirty === true`. Only registered in `import.meta.env.PROD` builds to avoid dev-HMR noise.

**`panels/MenuBar.tsx`** — File menu restructured into the parent-child hierarchy:

```
File
├── New Character                     (⌘N)
├── Save                               (⌘S)   ← writes .echidna + builds PLY + manifest
├── ────────────────────
├── Project ▸
│   ├── Open Project Root…
│   └── Connect Bridge to Project Root…
├── ────────────────────
├── Import ▸
│   ├── Import (PLY/VOX/OBJ)…
│   ├── Import .vox…
│   └── Load .echidna…                  ← legacy upload, moved from top level
├── Export ▸
│   ├── Save As .echidna…               ← legacy download, moved from top level
│   ├── Export PLY…
│   └── Export Manifest…
└── Preview in Staging
```

Renames: **Set Project Root…** → **Open Project Root…**. **Save to Project** and **Export Character to Project** are removed (replaced by the unified top-level **Save**). The old generic **Export Character…** and **Export…** dialogs are removed (download semantics already covered by `Save As .echidna…`, `Export PLY…`, and `Export Manifest…`).

Dirty indicator: append `●` in the title bar when `dirty === true`, using the same styling as Bricklayer's indicator (`color: #fa0`).

**`panels/DropdownMenu.tsx`** (existing, needs extension) — support nested submenus. Items with a `children` array open a sibling popup on hover to the right. Roughly 30 additional lines in the component.

**`panels/NewProjectDialog.tsx`** — minor update: dirty-state guard. When invoked from `New Character`, checks `dirty` and shows the `SwitchCharacterDialog` first if needed. On confirm, replaces `state.character` with the new character.

### Left-column layout

- Default widths: Characters section 180px tall (fits ~6 rows); rest of the column for tools.
- Internal drag handle between the two sections, resizable.
- Collapse toggle zeros the Characters height and gives the full column to tools — preference stored in `localStorage('echidna:characters-panel-collapsed')`.

## Data flow

### 1. Open Project Root

```
user: File → Project → Open Project Root…
  → showDirectoryPicker({mode: 'readwrite'})
  → saveProjectRootHandle('echidna', handle)
  → store.setProjectRootHandle(handle)
  → store.listCharacters()              ← scans tools_data/echidna_saves/*.echidna
      → reads each file, extracts {id, characterName, lastModified}
      → store.setKnownCharacters(entries)
  → App.tsx now sees projectRootHandle !== null
      → EmptyProjectState unmounts, CharacterViewport mounts
      → CharactersPanel shows the list
      → if entries.length === 0, panel shows "No characters yet. + New Character"
      → if entries.length > 0, NOTHING auto-opens — state.character stays null
      → center shows "Select a character or create a new one"
```

**No auto-open**: auto-opening the first character on every project load is a surprise behavior that conflicts with "user controls when a character becomes dirty." Explicit click = explicit intent.

### 2. Switch to another character (the critical flow)

```
user: clicks "Archer" row while "Walker Bot" is the active character
  → CharactersPanel calls store.requestOpenCharacter('archer')
      ├── if dirty === false AND undoStack.length === 0:
      │       → proceed directly to openCharacter('archer')
      │
      └── if dirty === true OR undoStack.length > 0:
              → show SwitchCharacterDialog
              → dialog shows current name, target name, undo depth
              → user clicks Save & Switch
              │    → await store.save()
              │    → store.openCharacter('archer')
              │
              → OR user clicks Discard & Switch
              │    → store.openCharacter('archer')   ← dirty state lost
              │
              → OR user clicks Cancel
                   → dialog closes, no state change

store.openCharacter(id):
  → read tools_data/echidna_saves/{id}.echidna via FSAPI
  → migrateEchidnaFile(raw)
  → set state.character = { id, characterName, voxels, parts, poses, animations, ... }
  → set state.dirty = false
  → clear state.undoStack and state.redoStack
  → clear state.boxSelection, state.lassoSelection, state.clipboard
  → tool, mode, xrayMode, camera, projectRootHandle, knownCharacters — ALL UNCHANGED
```

### 3. Save (⌘S)

```
user: ⌘S (or File → Save)
  → store.save()
      ├── if projectRootHandle === null:
      │       → await handleOpenProjectRoot()   ← blocks until picked or cancelled
      │       → if cancelled, bail out
      │
      ├── if state.character === null:
      │       → bail out silently (nothing to save)
      │
      ├── id = store.ensureCharacterId()   ← mints slug from characterName if needed
      │
      ├── write tools_data/echidna_saves/{id}.echidna   ← editor source
      │       via saveEchidnaProject(handle, file)
      │
      ├── build ply + manifest from current state.character
      ├── write assets/characters/{id}/{id}.ply
      ├── write assets/characters/{id}/{id}.manifest.json
      │       via exportCharacterToProject(handle, id, ply, manifest)
      │
      ├── store.markClean()
      ├── store.refreshKnownCharacter(id, ...)   ← update that row's mtime in the list
      └── toast "Saved — engine files built"
```

### 4. New Character (⌘N)

```
user: + New Character (in panel header) OR ⌘N
  → if dirty === true OR undoStack.length > 0:
       → show SwitchCharacterDialog
       → on Save & Switch, save current first, then proceed
       → on Discard & Switch, proceed
       → on Cancel, bail
  → show NewProjectDialog
       → user enters character name + grid size
       → on submit:
            → store.newCharacter(name, gridSize)
                 → id = slugifyCharacterId(name)
                 → set state.character = <fresh empty character with id, name>
                 → set state.dirty = false
                 → clear undo/redo/selection/clipboard
                 → store.addKnownCharacter(id, name)   ← optimistic add to the list
```

**In-memory until save**: the new character exists in the panel list immediately after `newCharacter()`, but the file is not written to disk until the user ⌘S. If the user closes the tab before saving, the character is gone — same as today.

### 5. Rename (display name only)

```
user: right-click a character → Rename…
  → show RenameCharacterDialog (prefilled with current characterName)
  → user enters new name → submit
  → store.renameCharacter(id, newName)
       ├── if id === state.character?.id:
       │       → update state.character.characterName
       │       → store.markDirty()                      ← unsaved rename
       │
       └── else (renaming a non-current character):
               → read tools_data/echidna_saves/{id}.echidna
               → mutated = { ...parsed, characterName: newName }
               → write back
               → update knownCharacters[{id}].name
               → no effect on current state.character or dirty flag
```

### 6. Duplicate

```
user: right-click a character → Duplicate…
  → show DuplicateCharacterDialog (prefilled with "Copy of {name}")
  → user confirms new name → submit
  → store.duplicateCharacter(sourceId, newName)
       → newId = slugifyCharacterId(newName)
       → if newId collides with existing, append suffix (newId_2, newId_3, ...)
       → read tools_data/echidna_saves/{sourceId}.echidna
       → mutated = { ...parsed, id: newId, characterName: newName }
       → write tools_data/echidna_saves/{newId}.echidna
       → store.addKnownCharacter(newId, newName, mtime: Date.now())
       → does NOT build engine files — user hits ⌘S for that
       → does NOT auto-open the duplicate — user clicks to switch
```

### 7. Delete

```
user: right-click a character → Delete…
  → show DeleteCharacterDialog (with warning about assets/characters/{id}/* NOT being removed)
  → user clicks Delete
  → store.deleteCharacter(id)
       ├── delete tools_data/echidna_saves/{id}.echidna via FSAPI removeEntry
       │       (assets/characters/{id}/* deliberately left alone)
       │
       ├── store.removeKnownCharacter(id)
       │
       └── if id === state.character?.id:
               → set state.character = null
               → set state.dirty = false
               → clear undo/redo/selection
               → center column shows "Select a character or create a new one"
```

## Error handling

### FSAPI permission denied

- **Bootstrap**: `restoreProjectRoot('echidna')` wraps `ensureHandlePermission`. If denied, returns `null` — treated exactly the same as "no project root set" → empty state with `Open Project Root…` button.
- **Any write operation** (save, rename, duplicate, delete): calls `ensureHandlePermission(handle)` defensively. If denied, the operation aborts with a toast: `"Project root permission denied. Re-open via File → Project → Open Project Root…"`. The store state does NOT become inconsistent — no partial writes, no phantom list updates.

### File system write failures

- **On write failure** (quota, transient I/O): toast `"Save failed: {error message}"`, `dirty` stays `true` so the user can retry, no list mutation.
- **On partial write during Save** (`.echidna` succeeded but PLY failed, or vice versa): log a warning, toast `"Partial save — engine files may be stale. Retry ⌘S."`, `dirty` stays `true`. No rollback attempt — simpler to let the next Save fix it.
- **On Delete failure**: toast `"Delete failed"`, no list mutation. The character stays in the panel.

### `openCharacter` failures

- **File missing** (`NotFoundError`): toast `"Character file missing — refreshing list"`, call `store.listCharacters()` to re-sync, leave `state.character` unchanged.
- **Malformed JSON**: toast `"Character file corrupt: {path}"`, abort the switch, leave state unchanged.
- **Old schema version**: pass through `migrateEchidnaFile()` silently. Only surface errors if migration itself throws.

### Race: switch during save

User hits ⌘S, then immediately clicks another character row before the save finishes.

1. A module-level `saving: boolean` flag in the store guards the modal. When `true`, `requestOpenCharacter` queues the request and the Save button in the modal is disabled until `saving === false`.
2. The save writes succeed after the switch has already happened — not possible because (1) blocks the switch until the save resolves. The await in the switch handler serialises the two operations.

### Race: new character with a colliding slug

`listCharacters` is called after every mutation (save, delete, rename, duplicate) to keep the panel in sync. The "in-memory character named the same as an existing saved one" case still collides on save — Phase 0.2 accepts that; the user created a character explicitly named the same as another. If it becomes a footgun, Phase 0.2.1 can add a pre-save collision check.

### Empty / invalid character name

`NewProjectDialog`, `RenameCharacterDialog`, and `DuplicateCharacterDialog` validate: non-empty after trim, max 64 chars, matches `/^[A-Za-z0-9 _\-]+$/`. Submit button disabled until valid.

### Bridge unreachable during Preview in Staging

Already handled by existing code (`Promise.race` with 5s timeout, toast on failure). No changes needed.

### beforeunload false positives

HMR triggers `beforeunload` in dev. Guard: register the handler only when `import.meta.env.PROD`.

## Testing strategy

### 5.1 Pure helper tests — new file `src/__tests__/characterStore.test.ts`

Fast, no FSAPI mocking. Manipulate store state via `setState`, call actions, assert on the result.

- Slice boundary: switching characters preserves global fields (`mode`, `tool`, `xrayMode`, etc.)
- `markDirty` / `markClean` lifecycle
- Undo stack reset on switch
- `requestOpenCharacter` short-circuit (clean + empty stack → no modal; dirty OR stack > 0 → modal)
- `ensureCharacterId` with empty slug
- `newCharacter` resets per-character slice

### 5.2 FS operations — extend `src/__tests__/projectFs.test.ts`

Today Echidna's `projectFs.test.ts` only covers the pure path builders (`echidnaSavePath`, `characterPlyPath`, `characterManifestPath`); the async FSAPI wrappers are untested because the in-memory mock lives only in `@gseurat/project-root/test/fs.test.ts` (~66 lines) and was "too thin to duplicate" for the simpler Phase 0.0 helpers. With the new multi-character management helpers the value of having them tested goes up, so Phase 0.2 will **promote the mock to a shared location**.

**Step 5.2.0 — mock extraction and extension (prerequisite)**

Add a new file `tools/packages/project-root/src/testing.ts` that exports a minimal FSAPI test fixture:

```ts
export class MockDirHandle { /* lifted from test/fs.test.ts + extensions */ }
export function makeRoot(): MockDirHandle;
```

Today's `MockDirHandle` (~65 lines) only implements `getDirectoryHandle` and `getFileHandle` — enough for `ensureSubdir` / `writeFileAtPath` / `readFileAtPath`. The new Phase 0.2 helpers need two more methods:

- **`removeEntry(name: string, opts?: { recursive?: boolean })`** — used by `deleteEchidnaProject`. Removes the entry from `this.node.entries`; throws `NotFoundError` if missing. ~10 lines.
- **Async iterator support** — `values()` / `entries()` / `keys()` returning async iterables, used by `listEchidnaProjects` to enumerate `tools_data/echidna_saves/*.echidna`. ~15 lines (implementing `[Symbol.asyncIterator]`).

Total mock size after extension: ~90 lines. Update the existing `tools/packages/project-root/test/fs.test.ts` to import from `../src/testing.ts` instead of defining the mock inline — no behavioural change to existing tests, just a move. Export from the `@gseurat/project-root` barrel so Echidna can import it as `@gseurat/project-root`.

This step lands as commit 1 below.

**Step 5.2.1 — Echidna tests use the shared mock**

- `listCharacters` on a seeded directory with v1/v2/v3 files (migration coverage)
- `listCharacters` with empty project returns `[]`
- `deleteEchidnaProject`: deletes source file, leaves `assets/characters/{id}/*` alone
- `renameEchidnaProject`: non-current rename round-trips correctly
- `duplicateEchidnaProject`: both files exist with correct `id`/`characterName`
- `saveEchidnaProject` with mocked partial failure leaves `.echidna` intact and no phantom files

### 5.3 Migration safety — extend `src/__tests__/echidnaFile.test.ts`

- v2 → v3 → current still migrates
- Malformed JSON returns a descriptive error
- Missing `id` field → derived from `characterName` via slugify

### 5.4 Slice refactor coverage

The mechanical `state.voxels` → `state.character.voxels` rename touches ~10 files and all their existing tests. Strategy:

1. Run existing test suite before the refactor: record pass count.
2. Do the mechanical rename commit.
3. Run the test suite again: expect the same pass count. Any new failures are refactor bugs.

### 5.5 What's NOT tested

- React component tests (`CharactersPanel`, dialogs) — no existing Echidna React test infra; manual verification sufficient for Phase 0.2.
- FSAPI permission denial paths — covered by Phase 0.0's `ensureHandlePermission` already.
- Cross-editor interaction (Echidna → Bricklayer refs) — Phase 0.3 scope.
- Visual regression of panel layout — manual only.

### 5.6 Test count estimate

- ~12 new tests in `characterStore.test.ts`
- ~8 new tests in `projectFs.test.ts`
- ~3 new tests in `echidnaFile.test.ts`

**Total: ~23 new tests**, on top of ~50 existing Echidna tests that must keep passing through the refactor.

### 5.7 Manual verification checklist

- [ ] Fresh Echidna session → empty state shows → Open Project Root works
- [ ] Create 2 characters, switch between them, undo/redo bounded per-character
- [ ] Dirty indicator appears on edit, disappears on Save
- [ ] Switching with dirty triggers the modal; Save / Discard / Cancel all work correctly
- [ ] Rename / Duplicate / Delete each work from the context menu
- [ ] `assets/characters/{id}/*.ply` files appear after Save
- [ ] Preview in Staging still works end-to-end
- [ ] Reload the page mid-edit → `beforeunload` prompt appears
- [ ] Reload the page clean → silent (no prompt)

## Implementation order

Commit sequence for a reviewable PR (or series of small PRs):

1. **Extract MockDirHandle** into `@gseurat/project-root/src/testing.ts`. Update `project-root`'s own `test/fs.test.ts` to import from the new location. No behavioral change. Unblocks testing the new Echidna FS helpers in step 5.
2. **Mechanical slice rename**: pure find-and-replace `state.voxels` → `state.character.voxels` (and siblings), including making `state.character` nullable. Zero behavior change. Runs existing tests as a regression fence.
3. **New store actions**: `listCharacters`, `openCharacter`, `requestOpenCharacter`, `save`, `markDirty`, `markClean`. Store tests alongside.
4. **Management actions**: `renameCharacter`, `duplicateCharacter`, `deleteCharacter`. Store tests alongside.
5. **FS helpers**: `listEchidnaProjects`, `deleteEchidnaProject`, `renameEchidnaProject`, `duplicateEchidnaProject` in `tools/apps/echidna/src/lib/projectFs.ts`. projectFs tests alongside using the shared mock from step 1.
6. **DropdownMenu submenu support**: extend the existing component. No functional changes anywhere else.
7. **MenuBar restructure**: rename items, add submenus, remove legacy top-level items, wire up the new Save action.
8. **CharactersPanel**: new component, wired to store.
9. **EmptyProjectState**: new component, routed in App.tsx.
10. **Dialogs**: `SwitchCharacterDialog`, `RenameCharacterDialog`, `DuplicateCharacterDialog`, `DeleteCharacterDialog`.
11. **App.tsx integration**: left-column layout, center-column routing, beforeunload handler.
12. **Dirty indicator** in MenuBar title.
13. **Manual verification pass**: walk through the checklist in 5.7.

Steps 1–6 are backend work with no UI impact (existing UI keeps working). Steps 7–12 are the user-visible changes. This ordering lets reviewers land the refactor independently from the new UI if the PR splits.

## Out of scope (deferred)

- **Thumbnails in the character list** — needs a render-to-PNG step, not worth the complexity for Phase 0.2
- **`_index.json` manifest** for fast listing — directory scan is fine for <50 characters; YAGNI
- **Shared `ProjectItemList` component** extracted to `@gseurat/ui-kit` — cross-cutting refactor; Bricklayer and Méliès don't need it yet
- **"Clean orphan exports" action** — removes stale `assets/characters/{id}/*` entries that no longer have a `.echidna` source. Small utility for Phase 0.2.1 if needed.
- **Pre-save collision detection** — warning when saving a new in-memory character whose slug already exists on disk. Phase 0.2.1 if it becomes a footgun.
- **Restoring undo stacks across character switches** — Phase 0.3 or later; would need per-character undo history persistence.
- **Multi-asset support** (maps, objects) — Phase 0.3. This design deliberately ships multi-character first as a stepping stone.

## Open items

None. All five design questions from the brainstorming session are resolved.
