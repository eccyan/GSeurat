# Echidna Multi-Character Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Echidna from a single-character editor into a project-based editor that manages many characters in one project root — list view, switching with dirty-state guard, Rename / Duplicate / Delete operations, and a unified `⌘S Save` that writes both the `.echidna` source and the engine-ready PLY + manifest in one action.

**Architecture:** Refactor `useCharacterStore` so per-character data (voxels, parts, poses, animations) is nested under `state.character` (nullable) while global data (projectRootHandle, knownCharacters, dirty, tool, mode, camera, undo stacks) stays at the top level. A new `CharactersPanel` component renders the list in the top section of the left column; an `EmptyProjectState` component replaces the viewport when no project is open. The File menu is restructured into `Project ▸ / Import ▸ / Export ▸` submenus via an extended `DropdownMenu` with nested-submenu support. FSAPI is mocked for tests via a new `@gseurat/project-root/src/testing.ts` module that promotes the existing `MockDirHandle` and extends it with `removeEntry` and async iteration.

**Tech Stack:** React 18, TypeScript, Zustand 4.5, FSAPI (`File System Access API`), vitest, `@gseurat/project-root` workspace package, `idb-keyval` for handle persistence.

**Depends on:** Phase 0.0 Foundation (project root handle, `@gseurat/project-root`, `tools_data/echidna_saves/{id}.echidna` layout, `ensureCharacterId`, `migrateEchidnaFile`, `loadEchidnaProject`, `saveEchidnaProject`, `exportCharacterToProject`).

**Spec:** `docs/superpowers/specs/2026-04-11-echidna-multi-character-design.md`

---

## File Structure

### Phase A: Mock infrastructure (shared testing module)

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `tools/packages/project-root/src/testing.ts` | Promoted `MockDirHandle` + extensions (`removeEntry`, async iteration) |
| Modify | `tools/packages/project-root/src/index.ts` | Re-export testing module |
| Modify | `tools/packages/project-root/test/fs.test.ts` | Import mock from `../src/testing` instead of defining inline |

### Phase B: Store refactor (nest per-character slice)

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `tools/apps/echidna/src/store/types.ts` | `EchidnaStoreState.character` becomes nullable nested object |
| Modify | `tools/apps/echidna/src/store/useCharacterStore.ts` | All per-character state moves under `state.character.*` |
| Modify | `tools/apps/echidna/src/viewport/CharacterViewport.tsx` | Read from `state.character?.*` |
| Modify | `tools/apps/echidna/src/panels/BuildPanel.tsx` | Read from `state.character?.*` |
| Modify | `tools/apps/echidna/src/panels/PartsPanel.tsx` | Read from `state.character?.*` |
| Modify | `tools/apps/echidna/src/panels/PosePanel.tsx` | Read from `state.character?.*` |
| Modify | `tools/apps/echidna/src/panels/AnimateLeftPanel.tsx` | Read from `state.character?.*` |
| Modify | `tools/apps/echidna/src/panels/AnimateRightPanel.tsx` | Read from `state.character?.*` |
| Modify | `tools/apps/echidna/src/panels/Timeline.tsx` | Read from `state.character?.*` |
| Modify | `tools/apps/echidna/src/panels/BuildPanel.tsx` (and siblings) | Test suite must still pass with same count |

### Phase C: Store actions + FS helpers (the new surface area)

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `tools/apps/echidna/src/__tests__/characterStore.test.ts` | Store action tests (slice preservation, dirty, undo reset, etc.) |
| Modify | `tools/apps/echidna/src/lib/projectFs.ts` | Add `listEchidnaProjects`, `deleteEchidnaProject`, `renameEchidnaProject`, `duplicateEchidnaProject` |
| Modify | `tools/apps/echidna/src/__tests__/projectFs.test.ts` | Test the new FS helpers using the shared mock |
| Modify | `tools/apps/echidna/src/store/useCharacterStore.ts` | Add `listCharacters`, `openCharacter`, `requestOpenCharacter`, `save`, `markDirty`, `markClean`, `renameCharacter`, `duplicateCharacter`, `deleteCharacter`, `knownCharacters` state |

### Phase D: UI infrastructure (DropdownMenu + dialogs)

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `tools/apps/echidna/src/panels/MenuBar.tsx` | Extend `DropdownMenu` to support nested submenus (items with `children`) |
| Create | `tools/apps/echidna/src/panels/SwitchCharacterDialog.tsx` | Save / Discard / Cancel modal (reusable for switch, new, delete-current) |
| Create | `tools/apps/echidna/src/panels/RenameCharacterDialog.tsx` | One text input, prefilled with current name |
| Create | `tools/apps/echidna/src/panels/DuplicateCharacterDialog.tsx` | One text input, prefilled with "Copy of {name}" |
| Create | `tools/apps/echidna/src/panels/DeleteCharacterDialog.tsx` | Confirmation with warning about `assets/characters/{id}/*` staying |

### Phase E: Main panels

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `tools/apps/echidna/src/panels/CharactersPanel.tsx` | Collapsible list at top of left column |
| Create | `tools/apps/echidna/src/panels/EmptyProjectState.tsx` | Welcome + "Open Project Root…" button for no-project state |

### Phase F: Integration

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `tools/apps/echidna/src/panels/MenuBar.tsx` | File menu restructure (Project / Import / Export submenus, rename items, dirty indicator) |
| Modify | `tools/apps/echidna/src/panels/NewProjectDialog.tsx` | Dirty-state guard when invoked from New Character |
| Modify | `tools/apps/echidna/src/App.tsx` | Left-column layout with CharactersPanel, center-column routing, `beforeunload` handler |

---

## Task 1: Extract `MockDirHandle` to a shared testing module

**Files:**
- Create: `tools/packages/project-root/src/testing.ts`
- Modify: `tools/packages/project-root/src/index.ts`
- Modify: `tools/packages/project-root/test/fs.test.ts`

- [ ] **Step 1: Create `src/testing.ts` by lifting the existing mock**

Copy lines 5–77 of `tools/packages/project-root/test/fs.test.ts` (everything from `type Node` through `function makeRoot`) into a new file `tools/packages/project-root/src/testing.ts`. Export `MockDirHandle` and `makeRoot`:

```ts
// tools/packages/project-root/src/testing.ts
//
// Minimal in-memory mock matching the FileSystemDirectoryHandle subset we use.
// Promoted from test/fs.test.ts so Echidna (and future editors) can reuse it
// when testing FSAPI wrappers.

type Node =
  | { kind: 'dir'; entries: Map<string, Node> }
  | { kind: 'file'; data: Uint8Array };

export class MockDirHandle {
  kind: 'directory' = 'directory';
  constructor(
    public node: Extract<Node, { kind: 'dir' }>,
    public name = '',
  ) {}

  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<MockDirHandle> {
    let n = this.node.entries.get(name);
    if (!n) {
      if (!opts?.create) {
        const e: any = new Error(`NotFoundError: ${name}`);
        e.name = 'NotFoundError';
        throw e;
      }
      n = { kind: 'dir', entries: new Map() };
      this.node.entries.set(name, n);
    }
    if (n.kind !== 'dir') {
      const e: any = new Error(`TypeMismatchError: ${name}`);
      e.name = 'TypeMismatchError';
      throw e;
    }
    return new MockDirHandle(n, name);
  }

  async getFileHandle(name: string, opts?: { create?: boolean }) {
    let n = this.node.entries.get(name);
    if (!n) {
      if (!opts?.create) {
        const e: any = new Error(`NotFoundError: ${name}`);
        e.name = 'NotFoundError';
        throw e;
      }
      n = { kind: 'file', data: new Uint8Array() };
      this.node.entries.set(name, n);
    }
    if (n.kind !== 'file') {
      const e: any = new Error(`TypeMismatchError: ${name}`);
      e.name = 'TypeMismatchError';
      throw e;
    }
    const file = n;
    return {
      kind: 'file' as const,
      name,
      async createWritable() {
        return {
          async write(d: Uint8Array | string | ArrayBuffer | Blob) {
            let bytes: Uint8Array;
            if (typeof d === 'string') bytes = new TextEncoder().encode(d);
            else if (d instanceof Blob) bytes = new Uint8Array(await d.arrayBuffer());
            else if (d instanceof Uint8Array) bytes = d;
            else bytes = new Uint8Array(d);
            file.data = bytes;
          },
          async close() {},
        };
      },
      async getFile() {
        return new Blob([file.data as Uint8Array<ArrayBuffer>]);
      },
    };
  }
}

export function makeRoot(): MockDirHandle {
  return new MockDirHandle({ kind: 'dir', entries: new Map() });
}
```

- [ ] **Step 2: Re-export from the package barrel**

Add to `tools/packages/project-root/src/index.ts`:

```ts
export * as testing from './testing';
```

Using a namespace export keeps test utilities separate from production symbols: consumers import as `import { testing } from '@gseurat/project-root'` and call `testing.makeRoot()`.

- [ ] **Step 3: Update `test/fs.test.ts` to import from the new location**

Replace lines 5–77 of `tools/packages/project-root/test/fs.test.ts` (the inline mock) with:

```ts
import { describe, it, expect } from 'vitest';
import { ensureSubdir, writeFileAtPath, readFileAtPath, fileExistsAtPath } from '../src/fs';
import { MockDirHandle, makeRoot } from '../src/testing';
```

Leave the test bodies below line 78 unchanged.

- [ ] **Step 4: Run `project-root` tests to verify no regression**

```bash
cd tools/packages/project-root && pnpm test
```

Expected: 74 tests pass (same as Phase 0.1 baseline).

- [ ] **Step 5: Build to verify exports**

```bash
cd tools/packages/project-root && pnpm build
```

Expected: `tsc` exits clean. The new `src/testing.ts` compiles to `dist/src/testing.js`.

- [ ] **Step 6: Commit**

```bash
git add tools/packages/project-root/src/testing.ts \
        tools/packages/project-root/src/index.ts \
        tools/packages/project-root/test/fs.test.ts
git commit -m "refactor(project-root): promote MockDirHandle to shared testing module

Extracted the in-memory FSAPI mock from test/fs.test.ts into
src/testing.ts so other editors can reuse it. Zero behavior change —
test/fs.test.ts still passes 20/20 via the re-imported mock.

Prepares the ground for Phase 0.2 Echidna tests that need to exercise
new FSAPI wrappers (listEchidnaProjects, deleteEchidnaProject, etc.)."
```

---

## Task 2: Add `removeEntry` to `MockDirHandle`

**Files:**
- Modify: `tools/packages/project-root/src/testing.ts`
- Create: `tools/packages/project-root/test/testing.test.ts`

- [ ] **Step 1: Create a new test file for the mock itself**

Create `tools/packages/project-root/test/testing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeRoot } from '../src/testing';

describe('MockDirHandle.removeEntry', () => {
  it('removes a file from the parent directory', async () => {
    const root = makeRoot();
    const fh = await root.getFileHandle('walker.echidna', { create: true });
    const w = await fh.createWritable();
    await w.write('hello');
    await w.close();

    // Confirm the file exists first
    await root.getFileHandle('walker.echidna');

    await root.removeEntry('walker.echidna');

    await expect(root.getFileHandle('walker.echidna')).rejects.toThrow(/NotFoundError/);
  });

  it('throws NotFoundError when removing a nonexistent entry', async () => {
    const root = makeRoot();
    await expect(root.removeEntry('ghost')).rejects.toThrow(/NotFoundError/);
  });

  it('removes a subdirectory', async () => {
    const root = makeRoot();
    await root.getDirectoryHandle('tools_data', { create: true });
    await root.removeEntry('tools_data');
    await expect(root.getDirectoryHandle('tools_data')).rejects.toThrow(/NotFoundError/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd tools/packages/project-root && pnpm test testing
```

Expected: FAIL with `TypeError: root.removeEntry is not a function`.

- [ ] **Step 3: Implement `removeEntry` on `MockDirHandle`**

Add this method to `MockDirHandle` in `tools/packages/project-root/src/testing.ts` (below `getFileHandle`):

```ts
  async removeEntry(name: string, _opts?: { recursive?: boolean }): Promise<void> {
    if (!this.node.entries.has(name)) {
      const e: any = new Error(`NotFoundError: ${name}`);
      e.name = 'NotFoundError';
      throw e;
    }
    this.node.entries.delete(name);
  }
```

**Note:** The `recursive` option is accepted but ignored — the Map-based implementation doesn't need special handling for recursive deletes because removing a directory entry discards its subtree naturally. Tests that care about recursive semantics can verify via direct inspection.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd tools/packages/project-root && pnpm test testing
```

Expected: 3 tests pass.

- [ ] **Step 5: Run the full suite to confirm no regression**

```bash
cd tools/packages/project-root && pnpm test
```

Expected: 77 tests pass (74 baseline + 3 new).

- [ ] **Step 6: Commit**

```bash
git add tools/packages/project-root/src/testing.ts \
        tools/packages/project-root/test/testing.test.ts
git commit -m "feat(project-root/testing): add removeEntry to MockDirHandle

Required by the upcoming Echidna deleteEchidnaProject helper test.
Matches the FSAPI removeEntry contract: throws NotFoundError on
missing entries, silently deletes dirs or files from the parent map."
```

---

## Task 3: Add async iteration to `MockDirHandle`

**Files:**
- Modify: `tools/packages/project-root/src/testing.ts`
- Modify: `tools/packages/project-root/test/testing.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tools/packages/project-root/test/testing.test.ts`:

```ts
describe('MockDirHandle async iteration', () => {
  it('values() yields file handles', async () => {
    const root = makeRoot();
    for (const name of ['a.echidna', 'b.echidna', 'c.echidna']) {
      const fh = await root.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(name);
      await w.close();
    }

    const names: string[] = [];
    for await (const handle of root.values()) {
      names.push(handle.name);
    }
    expect(names.sort()).toEqual(['a.echidna', 'b.echidna', 'c.echidna']);
  });

  it('values() distinguishes file handles from dir handles by kind', async () => {
    const root = makeRoot();
    await root.getFileHandle('file.txt', { create: true });
    await root.getDirectoryHandle('subdir', { create: true });

    const kinds: string[] = [];
    for await (const handle of root.values()) {
      kinds.push(handle.kind);
    }
    expect(kinds.sort()).toEqual(['directory', 'file']);
  });

  it('values() yields nothing for empty directories', async () => {
    const root = makeRoot();
    const names: string[] = [];
    for await (const handle of root.values()) {
      names.push((handle as { name: string }).name);
    }
    expect(names).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd tools/packages/project-root && pnpm test testing
```

Expected: FAIL with `TypeError: root.values is not a function`.

- [ ] **Step 3: Implement `values()` on `MockDirHandle`**

Add this method to `MockDirHandle` in `tools/packages/project-root/src/testing.ts`:

```ts
  async *values(): AsyncGenerator<MockDirHandle | {
    kind: 'file';
    name: string;
    getFile(): Promise<Blob>;
    createWritable(): Promise<{
      write(d: Uint8Array | string | ArrayBuffer | Blob): Promise<void>;
      close(): Promise<void>;
    }>;
  }> {
    for (const [name, child] of this.node.entries) {
      if (child.kind === 'dir') {
        yield new MockDirHandle(child, name);
      } else {
        // Yield a file-shaped handle with the same contract as getFileHandle
        const file = child;
        yield {
          kind: 'file' as const,
          name,
          async createWritable() {
            return {
              async write(d: Uint8Array | string | ArrayBuffer | Blob) {
                let bytes: Uint8Array;
                if (typeof d === 'string') bytes = new TextEncoder().encode(d);
                else if (d instanceof Blob) bytes = new Uint8Array(await d.arrayBuffer());
                else if (d instanceof Uint8Array) bytes = d;
                else bytes = new Uint8Array(d);
                file.data = bytes;
              },
              async close() {},
            };
          },
          async getFile() {
            return new Blob([file.data as Uint8Array<ArrayBuffer>]);
          },
        };
      }
    }
  }
```

**Note:** real FSAPI also exposes `entries()` and `keys()` iterators. For the Phase 0.2 helpers only `values()` is needed (`listEchidnaProjects` iterates file handles). Add `entries()` / `keys()` later if a consumer needs them.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd tools/packages/project-root && pnpm test testing
```

Expected: 6 tests pass in `testing.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add tools/packages/project-root/src/testing.ts \
        tools/packages/project-root/test/testing.test.ts
git commit -m "feat(project-root/testing): add values() async iterator to MockDirHandle

Required by the upcoming listEchidnaProjects helper test which enumerates
all *.echidna files in tools_data/echidna_saves/ via FSAPI's
FileSystemDirectoryHandle.values() iterator."
```

---

## Task 4: Nest per-character state under `state.character` (mechanical slice rename)

This is the biggest single task — the mechanical rename that enables everything downstream. It touches ~10 files with no behavior change. The existing test suite acts as the regression fence.

**Files (all modified, no new files):**
- `tools/apps/echidna/src/store/types.ts`
- `tools/apps/echidna/src/store/useCharacterStore.ts`
- `tools/apps/echidna/src/viewport/CharacterViewport.tsx`
- `tools/apps/echidna/src/panels/BuildPanel.tsx`
- `tools/apps/echidna/src/panels/PartsPanel.tsx`
- `tools/apps/echidna/src/panels/PosePanel.tsx`
- `tools/apps/echidna/src/panels/AnimateLeftPanel.tsx`
- `tools/apps/echidna/src/panels/AnimateRightPanel.tsx`
- `tools/apps/echidna/src/panels/Timeline.tsx`
- `tools/apps/echidna/src/panels/MenuBar.tsx`
- `tools/apps/echidna/src/App.tsx`

- [ ] **Step 1: Record the baseline test count**

```bash
cd tools/apps/echidna && pnpm test 2>&1 | tail -5
```

Record the pass count (expect ~50 tests passing). This is the fence.

- [ ] **Step 2: Update `store/types.ts` — define the `Character` type and make it nullable**

In `tools/apps/echidna/src/store/types.ts`, add the `Character` type near the other state types:

```ts
/**
 * Per-character slice of EchidnaStoreState. Nullable — null when no character
 * is loaded (empty project, or just after Delete). Swapped atomically on
 * openCharacter() and newCharacter(). Every mutating action that writes to
 * this slice must also call markDirty().
 */
export interface Character {
  id: string;                                        // slug, stable for the character's lifetime
  characterName: string;                             // display name
  gridWidth: number;
  gridDepth: number;
  voxels: Map<string, Voxel>;
  characterParts: BodyPart[];
  characterPoses: Record<string, PoseData>;
  animations: Record<string, AnimationClip>;
  currentFilename: string | null;                    // legacy .echidna download target
}
```

- [ ] **Step 3: Update `EchidnaStoreState` in `useCharacterStore.ts`**

Find the state interface (around the top of the file) and restructure the slice:

```ts
// Before:
interface EchidnaStoreState {
  id: string;
  characterName: string;
  gridWidth: number;
  gridDepth: number;
  voxels: Map<string, Voxel>;
  characterParts: BodyPart[];
  characterPoses: Record<string, PoseData>;
  animations: Record<string, AnimationClip>;
  currentFilename: string | null;
  projectRootHandle: FileSystemDirectoryHandle | null;
  mode: 'build' | 'animate';
  // ... other globals
}

// After:
interface EchidnaStoreState {
  character: Character | null;

  projectRootHandle: FileSystemDirectoryHandle | null;
  knownCharacters: CharacterListEntry[];   // added here for Phase C, initialised to []
  dirty: boolean;                           // added here for Phase C
  mode: 'build' | 'animate';
  // ... other globals unchanged
}
```

Also add the `CharacterListEntry` type import or inline definition:

```ts
export interface CharacterListEntry {
  id: string;
  name: string;
  lastModified: number;
}
```

- [ ] **Step 4: Update store initial state**

Change the default state in the `create<EchidnaStoreState>()(() => ({...}))` call. Everything that used to be a top-level default is now either nested under `character` (initialised to an empty starter character) OR set to a starter value at the top level:

```ts
const DEFAULT_CHARACTER: Character = {
  id: '',
  characterName: 'Untitled',
  gridWidth: 32,
  gridDepth: 32,
  voxels: new Map(),
  characterParts: [],
  characterPoses: {},
  animations: {},
  currentFilename: null,
};

// In create():
{
  character: DEFAULT_CHARACTER,   // <-- nested slice (not null yet — Task 19 changes the
                                   //     App.tsx bootstrap to set this to null before first use)
  projectRootHandle: null,
  knownCharacters: [],
  dirty: false,
  mode: 'build',
  // ... rest of the globals unchanged
}
```

**Note:** this task deliberately leaves `character` non-null as the initial value. Making `character` null-by-default is deferred to Task 19 (App.tsx integration) where the center-column routing kicks in. Until then, non-null default preserves the existing "start with an empty character" behavior and keeps the mechanical rename pure.

- [ ] **Step 5: Update all mutator actions in the store to write under `state.character.*`**

This is the bulk of the mechanical rename. For every action that used to do:

```ts
addVoxel: (key, voxel) => set((s) => ({
  voxels: new Map(s.voxels).set(key, voxel),
})),
```

Change to:

```ts
addVoxel: (key, voxel) => set((s) => {
  if (!s.character) return s;   // no-op when no character loaded
  return {
    character: {
      ...s.character,
      voxels: new Map(s.character.voxels).set(key, voxel),
    },
  };
}),
```

Apply this transformation to **every** action that reads or writes fields now living under `character`: `addVoxel`, `removeVoxel`, `setVoxel`, `clearVoxels`, `setCharacterName`, `addPart`, `removePart`, `updatePart`, `setPose`, `removePose`, `addAnimation`, `removeAnimation`, `updateAnimation`, `setGridSize`, `newCharacter`, `loadProject`, `saveProject`, and any others that touch per-character fields. Use your editor's find-and-replace carefully — this is tedious but mechanical.

- [ ] **Step 6: Update consumers to read from `state.character?.*`**

In each of these files, change every subscription and getState() read that touches per-character fields:

```tsx
// Before:
const voxels = useCharacterStore((s) => s.voxels);
const characterParts = useCharacterStore((s) => s.characterParts);

// After:
const voxels = useCharacterStore((s) => s.character?.voxels ?? new Map());
const characterParts = useCharacterStore((s) => s.character?.characterParts ?? []);
```

Files to update (in this order — start with the most isolated):
1. `tools/apps/echidna/src/viewport/CharacterViewport.tsx`
2. `tools/apps/echidna/src/panels/BuildPanel.tsx`
3. `tools/apps/echidna/src/panels/PartsPanel.tsx`
4. `tools/apps/echidna/src/panels/PosePanel.tsx`
5. `tools/apps/echidna/src/panels/AnimateLeftPanel.tsx`
6. `tools/apps/echidna/src/panels/AnimateRightPanel.tsx`
7. `tools/apps/echidna/src/panels/Timeline.tsx`
8. `tools/apps/echidna/src/panels/MenuBar.tsx` (the toolbar + handlers that call `store.saveProject()` etc.)
9. `tools/apps/echidna/src/App.tsx` (the keyboard handler that reads `store.voxels.size` etc.)

For each file, do a text search for `s.voxels`, `s.characterParts`, `s.characterPoses`, `s.animations`, `s.characterName`, `s.gridWidth`, `s.gridDepth`, `s.currentFilename`, `s.id` (only where `id` refers to the per-character id — the projectHandle id stays at the top level). Replace each with `s.character?.<field> ?? <default>` or, for cases where a null check isn't idiomatic, gate the whole block on `if (s.character)`.

- [ ] **Step 7: Run the type checker**

```bash
cd tools/apps/echidna && pnpm build 2>&1 | tail -30
```

Expected: `tsc` completes without errors. If there are errors, fix them by adding null checks or default values. Do NOT proceed until this passes.

- [ ] **Step 8: Run the test suite and verify the same pass count as Step 1**

```bash
cd tools/apps/echidna && pnpm test 2>&1 | tail -5
```

Expected: same pass count as baseline. Any new failures are refactor bugs and must be fixed before committing.

- [ ] **Step 9: Commit**

```bash
git add tools/apps/echidna/src/
git commit -m "refactor(echidna): nest per-character state under state.character

Mechanical rename — no behavior change. Voxels, parts, poses, animations,
characterName, gridWidth/Depth, and currentFilename now live under
state.character (typed as Character, currently non-null — Task 19 will
make it nullable when the EmptyProjectState UI lands).

Also adds knownCharacters: [] and dirty: false at the top level to prepare
for Phase C store actions.

Test count unchanged (~50 passing), tsc clean. Slice boundary matches the
Phase 0.2 spec."
```

---

## Task 5: `markDirty` / `markClean` with automatic dirty-tracking on mutators

**Files:**
- Create: `tools/apps/echidna/src/__tests__/characterStore.test.ts`
- Modify: `tools/apps/echidna/src/store/useCharacterStore.ts`

- [ ] **Step 1: Write the failing tests**

Create `tools/apps/echidna/src/__tests__/characterStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useCharacterStore } from '../store/useCharacterStore';

describe('useCharacterStore — dirty tracking', () => {
  beforeEach(() => {
    useCharacterStore.getState().markClean();
  });

  it('markDirty sets dirty to true', () => {
    useCharacterStore.getState().markDirty();
    expect(useCharacterStore.getState().dirty).toBe(true);
  });

  it('markClean sets dirty to false', () => {
    useCharacterStore.getState().markDirty();
    useCharacterStore.getState().markClean();
    expect(useCharacterStore.getState().dirty).toBe(false);
  });

  it('addVoxel triggers markDirty automatically', () => {
    const s = useCharacterStore.getState();
    expect(s.dirty).toBe(false);
    s.addVoxel('0,0,0', { color: [255, 0, 0, 255] });
    expect(useCharacterStore.getState().dirty).toBe(true);
  });

  it('setCharacterName triggers markDirty automatically', () => {
    const s = useCharacterStore.getState();
    s.markClean();
    s.setCharacterName('Test Character');
    expect(useCharacterStore.getState().dirty).toBe(true);
  });

  it('addVoxel on null character is a no-op and does NOT dirty the state', () => {
    useCharacterStore.setState({ character: null });
    useCharacterStore.getState().markClean();
    useCharacterStore.getState().addVoxel('0,0,0', { color: [255, 0, 0, 255] });
    expect(useCharacterStore.getState().character).toBeNull();
    expect(useCharacterStore.getState().dirty).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd tools/apps/echidna && pnpm test characterStore
```

Expected: FAIL — `markDirty is not a function` (and related failures).

- [ ] **Step 3: Implement `markDirty` and `markClean` in the store**

Add to the action definitions in `tools/apps/echidna/src/store/useCharacterStore.ts`:

```ts
// In the EchidnaStoreState action list:
markDirty: () => void;
markClean: () => void;

// In the create() implementation:
markDirty: () => set({ dirty: true }),
markClean: () => set({ dirty: false }),
```

- [ ] **Step 4: Wire `markDirty` into every per-character mutator**

Every action that sets `state.character.*` must also set `dirty: true` in the same `set()` call. Wrap each mutator's set-return to include `dirty: true`:

```ts
// Before:
addVoxel: (key, voxel) => set((s) => {
  if (!s.character) return s;
  return {
    character: {
      ...s.character,
      voxels: new Map(s.character.voxels).set(key, voxel),
    },
  };
}),

// After:
addVoxel: (key, voxel) => set((s) => {
  if (!s.character) return s;
  return {
    character: {
      ...s.character,
      voxels: new Map(s.character.voxels).set(key, voxel),
    },
    dirty: true,
  };
}),
```

Apply to: `addVoxel`, `removeVoxel`, `setVoxel`, `clearVoxels`, `setCharacterName`, `addPart`, `removePart`, `updatePart`, `setPose`, `removePose`, `addAnimation`, `removeAnimation`, `updateAnimation`, `setGridSize`. Do NOT wire `markDirty` into `setMode`, `setTool`, `setBrushSize`, `setXrayMode`, `setShowGrid`, `setShowGizmos`, `setProjectRootHandle`, or any other global-slice mutator.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd tools/apps/echidna && pnpm test characterStore
```

Expected: 5 tests pass.

- [ ] **Step 6: Run the full echidna suite to confirm no regression**

```bash
cd tools/apps/echidna && pnpm test
```

Expected: baseline + 5 new tests pass.

- [ ] **Step 7: Commit**

```bash
git add tools/apps/echidna/src/__tests__/characterStore.test.ts \
        tools/apps/echidna/src/store/useCharacterStore.ts
git commit -m "feat(echidna): markDirty/markClean + auto-tracking on per-character mutators

Every action that writes to state.character.* now also sets dirty: true
inside the same set() call. Global mutators (setMode, setTool, etc.) are
explicitly not dirty-tracked.

Per-character mutators on a null character are no-ops (guard: if
(!s.character) return s) — adding a voxel without a character loaded
should not create phantom state or toggle dirty."
```

---

## Task 6: `listEchidnaProjects` FS helper

**Files:**
- Modify: `tools/apps/echidna/src/lib/projectFs.ts`
- Modify: `tools/apps/echidna/src/__tests__/projectFs.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tools/apps/echidna/src/__tests__/projectFs.test.ts`:

```ts
import { makeRoot } from '@gseurat/project-root/testing';
// or: import { testing } from '@gseurat/project-root'; then use testing.makeRoot()
// Use whichever import shape matches your barrel choice from Task 1 Step 2.
import {
  listEchidnaProjects,
} from '../lib/projectFs';

describe('listEchidnaProjects', () => {
  it('returns [] for an empty project', async () => {
    const root = makeRoot();
    const entries = await listEchidnaProjects(root as any);
    expect(entries).toEqual([]);
  });

  it('lists only .echidna files from tools_data/echidna_saves', async () => {
    const root = makeRoot();
    const toolsData = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await toolsData.getDirectoryHandle('echidna_saves', { create: true });

    // Write 3 .echidna files + 1 unrelated file
    for (const [name, body] of [
      ['walker.echidna', JSON.stringify({ version: 3, id: 'walker', characterName: 'Walker Bot', voxels: [], parts: [], poses: {} })],
      ['archer.echidna', JSON.stringify({ version: 3, id: 'archer', characterName: 'Archer', voxels: [], parts: [], poses: {} })],
      ['mage.echidna',   JSON.stringify({ version: 3, id: 'mage',   characterName: 'Mage',   voxels: [], parts: [], poses: {} })],
      ['junk.txt',       'not an echidna file'],
    ] as const) {
      const fh = await saves.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(body);
      await w.close();
    }

    const entries = await listEchidnaProjects(root as any);
    expect(entries.map((e) => e.id).sort()).toEqual(['archer', 'mage', 'walker']);
    expect(entries.find((e) => e.id === 'walker')?.name).toBe('Walker Bot');
  });

  it('returns [] when tools_data/echidna_saves does not exist', async () => {
    const root = makeRoot();
    // No subdirs created
    const entries = await listEchidnaProjects(root as any);
    expect(entries).toEqual([]);
  });

  it('skips unreadable files gracefully', async () => {
    const root = makeRoot();
    const toolsData = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await toolsData.getDirectoryHandle('echidna_saves', { create: true });

    const good = await saves.getFileHandle('good.echidna', { create: true });
    const wGood = await good.createWritable();
    await wGood.write(JSON.stringify({ version: 3, id: 'good', characterName: 'Good' }));
    await wGood.close();

    const bad = await saves.getFileHandle('bad.echidna', { create: true });
    const wBad = await bad.createWritable();
    await wBad.write('not json at all');
    await wBad.close();

    const entries = await listEchidnaProjects(root as any);
    // The bad file is skipped; good is still listed
    expect(entries.map((e) => e.id)).toEqual(['good']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd tools/apps/echidna && pnpm test projectFs
```

Expected: FAIL — `listEchidnaProjects is not a function`.

- [ ] **Step 3: Implement `listEchidnaProjects` in `lib/projectFs.ts`**

Add to `tools/apps/echidna/src/lib/projectFs.ts`:

```ts
import { PROJECT_LAYOUT, ensureSubdir, readFileAtPath } from '@gseurat/project-root';
import type { CharacterListEntry } from '../store/types';
import { migrateEchidnaFile } from '../store/types';

/**
 * Enumerate all .echidna files in tools_data/echidna_saves/ and return
 * their metadata for the CharactersPanel list. Skips malformed files with
 * a console.warn rather than throwing — one bad file must not prevent the
 * panel from rendering the rest.
 *
 * Returns [] when the directory doesn't exist yet.
 */
export async function listEchidnaProjects(
  handle: FileSystemDirectoryHandle,
): Promise<CharacterListEntry[]> {
  let savesDir: FileSystemDirectoryHandle;
  try {
    // tools_data/echidna_saves/
    const parts = PROJECT_LAYOUT.toolsData.echidnaSaves.split('/');
    let dir: FileSystemDirectoryHandle = handle;
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part);
    }
    savesDir = dir;
  } catch (e) {
    if ((e as Error).name === 'NotFoundError') return [];
    throw e;
  }

  const entries: CharacterListEntry[] = [];
  // @ts-expect-error — FSAPI values() is not yet in lib.dom
  for await (const child of savesDir.values()) {
    if (child.kind !== 'file') continue;
    if (!child.name.endsWith('.echidna')) continue;
    try {
      const file = await child.getFile();
      const text = await file.text();
      const raw = JSON.parse(text);
      const migrated = migrateEchidnaFile(raw);
      entries.push({
        id: migrated.id,
        name: migrated.characterName,
        lastModified: (file as unknown as File).lastModified ?? 0,
      });
    } catch (err) {
      console.warn(`[echidna] Skipped unreadable character file: ${child.name}`, err);
    }
  }

  // Sort by lastModified desc (most recent first)
  entries.sort((a, b) => b.lastModified - a.lastModified);
  return entries;
}
```

**Note:** `migrateEchidnaFile` is an existing helper from Phase 0.0. If the import path is different in your project, adjust accordingly. The `CharacterListEntry` type should have been added to `types.ts` in Task 4; if it wasn't, add it there before implementing this helper.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd tools/apps/echidna && pnpm test projectFs
```

Expected: 4 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add tools/apps/echidna/src/lib/projectFs.ts \
        tools/apps/echidna/src/__tests__/projectFs.test.ts
git commit -m "feat(echidna): listEchidnaProjects FS helper

Enumerates *.echidna files under tools_data/echidna_saves/ and returns
CharacterListEntry metadata for the CharactersPanel list. Uses FSAPI
async iteration (values()) — mocked in tests via MockDirHandle's new
values() iterator.

Malformed files are skipped with a console.warn rather than thrown —
one bad file must not prevent the rest of the panel from rendering."
```

---

## Task 7: `listCharacters` store action

**Files:**
- Modify: `tools/apps/echidna/src/store/useCharacterStore.ts`
- Modify: `tools/apps/echidna/src/__tests__/characterStore.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tools/apps/echidna/src/__tests__/characterStore.test.ts`:

```ts
import { makeRoot } from '@gseurat/project-root/testing';

describe('useCharacterStore.listCharacters', () => {
  it('is a no-op when projectRootHandle is null', async () => {
    useCharacterStore.setState({
      projectRootHandle: null,
      knownCharacters: [],
    });
    await useCharacterStore.getState().listCharacters();
    expect(useCharacterStore.getState().knownCharacters).toEqual([]);
  });

  it('populates knownCharacters from the project root', async () => {
    const root = makeRoot();
    const toolsData = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await toolsData.getDirectoryHandle('echidna_saves', { create: true });
    const fh = await saves.getFileHandle('walker.echidna', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({
      version: 3,
      id: 'walker',
      characterName: 'Walker Bot',
      voxels: [],
      parts: [],
      poses: {},
    }));
    await w.close();

    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      knownCharacters: [],
    });

    await useCharacterStore.getState().listCharacters();
    const known = useCharacterStore.getState().knownCharacters;
    expect(known).toHaveLength(1);
    expect(known[0].id).toBe('walker');
    expect(known[0].name).toBe('Walker Bot');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd tools/apps/echidna && pnpm test characterStore
```

Expected: FAIL — `listCharacters is not a function`.

- [ ] **Step 3: Implement `listCharacters` in the store**

Add to the action interface and implementation in `useCharacterStore.ts`:

```ts
// In EchidnaStoreState actions:
listCharacters: () => Promise<void>;

// In create():
listCharacters: async () => {
  const handle = get().projectRootHandle;
  if (!handle) return;
  try {
    const entries = await listEchidnaProjects(handle);
    set({ knownCharacters: entries });
  } catch (e) {
    console.error('[echidna] listCharacters failed:', e);
    // Do not clobber existing list on transient failure
  }
},
```

Add the import at the top:

```ts
import { listEchidnaProjects } from '../lib/projectFs';
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd tools/apps/echidna && pnpm test characterStore
```

Expected: 2 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add tools/apps/echidna/src/store/useCharacterStore.ts \
        tools/apps/echidna/src/__tests__/characterStore.test.ts
git commit -m "feat(echidna): listCharacters store action

Wraps listEchidnaProjects helper for the CharactersPanel to call. Silent
no-op when projectRootHandle is null. Preserves existing knownCharacters
on transient failures rather than clobbering them."
```

---

## Task 8: `openCharacter` store action + slice-preservation test

**Files:**
- Modify: `tools/apps/echidna/src/store/useCharacterStore.ts`
- Modify: `tools/apps/echidna/src/__tests__/characterStore.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tools/apps/echidna/src/__tests__/characterStore.test.ts`:

```ts
describe('useCharacterStore.openCharacter', () => {
  it('preserves global slice when switching characters', async () => {
    const root = makeRoot();
    const toolsData = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await toolsData.getDirectoryHandle('echidna_saves', { create: true });
    const fh = await saves.getFileHandle('archer.echidna', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({
      version: 3,
      id: 'archer',
      characterName: 'Archer',
      gridWidth: 24,
      gridDepth: 24,
      voxels: [],
      parts: [],
      poses: {},
    }));
    await w.close();

    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      mode: 'animate',
      tool: 'box_select',
      brushSize: 5,
      xrayMode: true,
    });

    await useCharacterStore.getState().openCharacter('archer');

    const s = useCharacterStore.getState();
    expect(s.character?.id).toBe('archer');
    expect(s.character?.characterName).toBe('Archer');
    expect(s.mode).toBe('animate');         // global preserved
    expect(s.tool).toBe('box_select');      // global preserved
    expect(s.brushSize).toBe(5);             // global preserved
    expect(s.xrayMode).toBe(true);           // global preserved
  });

  it('clears dirty flag, undo/redo stacks, and selection state', async () => {
    const root = makeRoot();
    const toolsData = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await toolsData.getDirectoryHandle('echidna_saves', { create: true });
    const fh = await saves.getFileHandle('mage.echidna', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({
      version: 3, id: 'mage', characterName: 'Mage', voxels: [], parts: [], poses: {},
    }));
    await w.close();

    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      dirty: true,
      undoStack: [{} as any, {} as any],
      redoStack: [{} as any],
      boxSelection: { min: [0,0,0], max: [1,1,1] } as any,
    });

    await useCharacterStore.getState().openCharacter('mage');

    const s = useCharacterStore.getState();
    expect(s.dirty).toBe(false);
    expect(s.undoStack).toEqual([]);
    expect(s.redoStack).toEqual([]);
    expect(s.boxSelection).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd tools/apps/echidna && pnpm test characterStore
```

Expected: FAIL — `openCharacter is not a function`.

- [ ] **Step 3: Implement `openCharacter`**

Add to `useCharacterStore.ts`:

```ts
// In EchidnaStoreState actions:
openCharacter: (id: string) => Promise<void>;

// In create():
openCharacter: async (id: string) => {
  const handle = get().projectRootHandle;
  if (!handle) {
    console.warn('[echidna] openCharacter called with no projectRootHandle');
    return;
  }
  try {
    // loadEchidnaProject is expected to either return the parsed file or
    // throw on I/O errors / missing files. Handle both: null return is
    // treated the same as "file missing" (refresh the list so the phantom
    // row disappears and leave state.character unchanged).
    const loaded = await loadEchidnaProject(handle, id);
    if (!loaded) {
      console.warn(`[echidna] openCharacter: file missing for ${id}, refreshing list`);
      await get().listCharacters();
      return;
    }
    const char: Character = {
      id: loaded.id,
      characterName: loaded.characterName,
      gridWidth: loaded.gridWidth,
      gridDepth: loaded.gridDepth,
      voxels: voxelArrayToMap(loaded.voxels),
      characterParts: loaded.parts ?? [],
      characterPoses: loaded.poses ?? {},
      animations: loaded.animations ?? {},
      currentFilename: null,
    };
    set({
      character: char,
      dirty: false,
      undoStack: [],
      redoStack: [],
      boxSelection: null,
      lassoSelection: null,
      clipboard: null,
    });
  } catch (e) {
    // On FSAPI NotFoundError (file missing), refresh the list to drop the
    // phantom row and leave state.character unchanged. Other errors
    // (permission, corruption) are logged but not surfaced to the user in
    // Phase 0.2 — a future follow-up can add a toast subscriber.
    if ((e as Error).name === 'NotFoundError') {
      console.warn(`[echidna] openCharacter: file missing for ${id}, refreshing list`);
      await get().listCharacters();
      return;
    }
    console.error(`[echidna] openCharacter failed for ${id}:`, e);
  }
},
```

Imports to add:

```ts
import { loadEchidnaProject } from '../lib/projectFs';
import type { Character } from './types';
```

**Note:** `voxelArrayToMap` is an existing helper used when loading from the legacy download format. If it doesn't exist in the file yet, extract it from the existing `loadProject` action into a private helper at the top of `useCharacterStore.ts` before Task 8. If you're unsure, `grep` for how `loadProject` currently converts its array-of-voxels input to the Map stored in state.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd tools/apps/echidna && pnpm test characterStore
```

Expected: 2 new tests pass (4 total in `characterStore.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add tools/apps/echidna/src/store/useCharacterStore.ts \
        tools/apps/echidna/src/__tests__/characterStore.test.ts
git commit -m "feat(echidna): openCharacter store action

Loads a character from tools_data/echidna_saves/{id}.echidna via the
existing loadEchidnaProject helper, replaces state.character atomically,
clears dirty flag + undo/redo/selection state. Global slice (mode, tool,
brushSize, xrayMode, camera, projectRootHandle, knownCharacters) is
explicitly preserved — verified by test."
```

---

## Task 9: `requestOpenCharacter` dispatcher with dirty guard

**Files:**
- Modify: `tools/apps/echidna/src/store/useCharacterStore.ts`
- Modify: `tools/apps/echidna/src/__tests__/characterStore.test.ts`

- [ ] **Step 1: Write the failing test**

The dispatcher takes a callback that the caller uses to display a modal. The test verifies the callback is invoked when dirty or undo-stack is non-empty, and skipped otherwise:

```ts
describe('useCharacterStore.requestOpenCharacter', () => {
  beforeEach(async () => {
    // Set up a fresh project root with one character we can switch to
    const root = makeRoot();
    const toolsData = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await toolsData.getDirectoryHandle('echidna_saves', { create: true });
    const fh = await saves.getFileHandle('archer.echidna', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({
      version: 3, id: 'archer', characterName: 'Archer', voxels: [], parts: [], poses: {},
    }));
    await w.close();
    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      dirty: false,
      undoStack: [],
    });
  });

  it('opens directly when dirty is false AND undoStack is empty', async () => {
    let confirmCalled = false;
    await useCharacterStore.getState().requestOpenCharacter('archer', async () => {
      confirmCalled = true;
      return 'discard';
    });
    expect(confirmCalled).toBe(false);
    expect(useCharacterStore.getState().character?.id).toBe('archer');
  });

  it('invokes the confirm callback when dirty is true', async () => {
    useCharacterStore.setState({ dirty: true });
    let confirmCalled = false;
    await useCharacterStore.getState().requestOpenCharacter('archer', async () => {
      confirmCalled = true;
      return 'discard';
    });
    expect(confirmCalled).toBe(true);
    expect(useCharacterStore.getState().character?.id).toBe('archer');
  });

  it('invokes the confirm callback when undoStack has entries', async () => {
    useCharacterStore.setState({ undoStack: [{} as any] });
    let confirmCalled = false;
    await useCharacterStore.getState().requestOpenCharacter('archer', async () => {
      confirmCalled = true;
      return 'discard';
    });
    expect(confirmCalled).toBe(true);
  });

  it('does NOT switch when user cancels', async () => {
    useCharacterStore.setState({ dirty: true });
    const initialCharId = useCharacterStore.getState().character?.id;
    await useCharacterStore.getState().requestOpenCharacter('archer', async () => 'cancel');
    expect(useCharacterStore.getState().character?.id).toBe(initialCharId);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd tools/apps/echidna && pnpm test characterStore
```

Expected: FAIL — `requestOpenCharacter is not a function`.

- [ ] **Step 3: Implement `requestOpenCharacter`**

Add to `useCharacterStore.ts` (export the types so the dialog in Task 16 and the panel in Task 18 can reuse them):

```ts
// Near the top of useCharacterStore.ts, above the interface:
export type SwitchDecision = 'save' | 'discard' | 'cancel';
export type ConfirmSwitch = (info: {
  currentName: string;
  targetName: string;
  undoDepth: number;
}) => Promise<SwitchDecision>;

// In EchidnaStoreState actions:
requestOpenCharacter: (id: string, confirm: ConfirmSwitch) => Promise<void>;

// In create():
requestOpenCharacter: async (id, confirm) => {
  const s = get();
  const currentHasWork = s.dirty || s.undoStack.length > 0;
  if (currentHasWork && s.character) {
    const target = s.knownCharacters.find((c) => c.id === id);
    const decision = await confirm({
      currentName: s.character.characterName,
      targetName: target?.name ?? id,
      undoDepth: s.undoStack.length,
    });
    if (decision === 'cancel') return;
    if (decision === 'save') {
      await s.save();
    }
    // 'discard' falls through to openCharacter
  }
  await s.openCharacter(id);
},
```

**Note:** `s.save()` is defined in Task 10 — this action depends on it. If you're implementing strictly in order, stub `save()` as a no-op in Task 9 and replace it with the real implementation in Task 10. Or implement Task 10 first and come back to Task 9.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd tools/apps/echidna && pnpm test characterStore
```

Expected: 4 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add tools/apps/echidna/src/store/useCharacterStore.ts \
        tools/apps/echidna/src/__tests__/characterStore.test.ts
git commit -m "feat(echidna): requestOpenCharacter dispatcher with dirty guard

Short-circuits the modal dialog when the current character has no
unsaved changes AND no undo history. When either is present, invokes
the caller's confirm callback and branches on the returned decision
(save / discard / cancel). Cancel returns cleanly without switching."
```

---

## Task 10: `save` store action (unified ⌘S)

**Files:**
- Modify: `tools/apps/echidna/src/store/useCharacterStore.ts`
- Modify: `tools/apps/echidna/src/__tests__/characterStore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('useCharacterStore.save', () => {
  it('is a no-op when character is null', async () => {
    useCharacterStore.setState({
      projectRootHandle: makeRoot() as unknown as FileSystemDirectoryHandle,
      character: null,
    });
    // Should not throw
    await useCharacterStore.getState().save();
    expect(useCharacterStore.getState().dirty).toBe(false);
  });

  it('writes the .echidna source + engine files and clears dirty', async () => {
    const root = makeRoot();
    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      character: {
        id: 'walker',
        characterName: 'Walker Bot',
        gridWidth: 32,
        gridDepth: 32,
        voxels: new Map([['0,0,0', { color: [255, 0, 0, 255] }]]),
        characterParts: [],
        characterPoses: {},
        animations: {},
        currentFilename: null,
      },
      dirty: true,
    });

    await useCharacterStore.getState().save();

    // Dirty should clear
    expect(useCharacterStore.getState().dirty).toBe(false);

    // The .echidna source file should exist at tools_data/echidna_saves/walker.echidna
    const td = await root.getDirectoryHandle('tools_data');
    const sv = await td.getDirectoryHandle('echidna_saves');
    const fh = await sv.getFileHandle('walker.echidna');
    const file = await fh.getFile();
    const text = await file.text();
    const parsed = JSON.parse(text);
    expect(parsed.id).toBe('walker');
    expect(parsed.characterName).toBe('Walker Bot');

    // The engine-ready files should exist at assets/characters/walker/*
    const assets = await root.getDirectoryHandle('assets');
    const chars = await assets.getDirectoryHandle('characters');
    const walkerDir = await chars.getDirectoryHandle('walker');
    await walkerDir.getFileHandle('walker.ply');           // throws if missing
    await walkerDir.getFileHandle('walker.manifest.json'); // throws if missing
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd tools/apps/echidna && pnpm test characterStore
```

Expected: FAIL — `save is not a function`.

- [ ] **Step 3: Implement `save`**

Add to `useCharacterStore.ts`:

```ts
// In EchidnaStoreState:
_saving: boolean;              // race guard — NOT a public store field
save: () => Promise<void>;

// In create() initial state:
_saving: false,

// In create() actions:
save: async () => {
  // Race guard: prevent concurrent saves from the same user. If a save is
  // already in flight, the second call returns immediately. This matters
  // because the switch-during-save race (user hits ⌘S then clicks another
  // character row) could otherwise double-trigger the write pipeline.
  if (get()._saving) return;
  set({ _saving: true });
  try {
    const s = get();
    const handle = s.projectRootHandle;
    if (!handle) {
      console.warn('[echidna] save called with no projectRootHandle');
      return;
    }
    if (!s.character) return;

    const id = s.ensureCharacterId();

    // 1. Write the .echidna source
    const file = s.saveProject();   // existing action that builds the EchidnaFile DTO
    try {
      await saveEchidnaProject(handle, file);
    } catch (e) {
      console.error('[echidna] save: .echidna write failed:', e);
      return;
    }

    // 2. Build PLY + manifest and write engine-ready files
    try {
      const ply = exportPly(
        s.character.voxels,
        s.character.gridWidth,
        s.character.gridDepth,
        s.character.characterParts,
      );
      const manifest = buildManifest(
        id,
        `${id}.ply`,
        1.0,
        s.character.characterParts,
        s.character.characterPoses,
        s.character.animations,
      );
      await exportCharacterToProject(handle, id, ply, JSON.stringify(manifest, null, 2));
    } catch (e) {
      console.error('[echidna] save: partial write — engine files may be stale:', e);
      // .echidna is on disk so dirty COULD clear, but partial-fail means
      // the user should retry. Leave dirty true so the next ⌘S rebuilds.
      return;
    }

    set({ dirty: false });
    // Refresh the list so the row's mtime updates
    await get().listCharacters();
  } finally {
    set({ _saving: false });
  }
},
```

The `_saving` field is prefixed with underscore to signal "internal" — consumers should not subscribe to it. It's not part of the spec's public slice contract; it lives in the global slice for convenience because Zustand doesn't have a natural "hidden" slice.

Imports:

```ts
import {
  loadEchidnaProject,
  saveEchidnaProject,
  exportCharacterToProject,
} from '../lib/projectFs';
import { exportPly } from '../lib/plyExport';
import { buildManifest } from '../lib/manifestExport';
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd tools/apps/echidna && pnpm test characterStore
```

Expected: 2 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add tools/apps/echidna/src/store/useCharacterStore.ts \
        tools/apps/echidna/src/__tests__/characterStore.test.ts
git commit -m "feat(echidna): unified save store action (Phase 0.2)

⌘S Save now writes both tools_data/echidna_saves/{id}.echidna AND the
engine-ready PLY + manifest to assets/characters/{id}/ in one action.
Partial-fail path (engine files fail after source succeeded) leaves
dirty=true so the user retries rather than getting a silent half-save."
```

---

## Task 11: `deleteEchidnaProject` FS helper

**Files:**
- Modify: `tools/apps/echidna/src/lib/projectFs.ts`
- Modify: `tools/apps/echidna/src/__tests__/projectFs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { deleteEchidnaProject } from '../lib/projectFs';

describe('deleteEchidnaProject', () => {
  it('removes the .echidna source and leaves assets/characters/{id}/* alone', async () => {
    const root = makeRoot();

    // Seed: .echidna source + exported engine files
    const td = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await td.getDirectoryHandle('echidna_saves', { create: true });
    const src = await saves.getFileHandle('walker.echidna', { create: true });
    const w = await src.createWritable();
    await w.write('{}');
    await w.close();

    const assets = await root.getDirectoryHandle('assets', { create: true });
    const chars = await assets.getDirectoryHandle('characters', { create: true });
    const walker = await chars.getDirectoryHandle('walker', { create: true });
    const ply = await walker.getFileHandle('walker.ply', { create: true });
    const wPly = await ply.createWritable();
    await wPly.write('fake ply bytes');
    await wPly.close();

    await deleteEchidnaProject(root as any, 'walker');

    // Source file is gone
    await expect(saves.getFileHandle('walker.echidna')).rejects.toThrow(/NotFoundError/);
    // Engine files are STILL THERE
    await walker.getFileHandle('walker.ply'); // does not throw
  });

  it('throws NotFoundError when the source file does not exist', async () => {
    const root = makeRoot();
    await expect(deleteEchidnaProject(root as any, 'ghost')).rejects.toThrow(/NotFoundError/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd tools/apps/echidna && pnpm test projectFs
```

Expected: FAIL — `deleteEchidnaProject is not a function`.

- [ ] **Step 3: Implement `deleteEchidnaProject`**

Add to `tools/apps/echidna/src/lib/projectFs.ts`:

```ts
/**
 * Delete the .echidna source file for a character. The exported files in
 * assets/characters/{id}/ are deliberately NOT touched — users can remove
 * them manually, and Phase 0.2.1+ may add a "Clean orphan exports" action.
 *
 * Throws NotFoundError if the source file is missing.
 */
export async function deleteEchidnaProject(
  handle: FileSystemDirectoryHandle,
  id: string,
): Promise<void> {
  const parts = PROJECT_LAYOUT.toolsData.echidnaSaves.split('/');
  let dir: FileSystemDirectoryHandle = handle;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part);
  }
  // @ts-expect-error — removeEntry is not yet in lib.dom
  await dir.removeEntry(`${id}.echidna`);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd tools/apps/echidna && pnpm test projectFs
```

Expected: 2 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add tools/apps/echidna/src/lib/projectFs.ts \
        tools/apps/echidna/src/__tests__/projectFs.test.ts
git commit -m "feat(echidna): deleteEchidnaProject FS helper

Removes tools_data/echidna_saves/{id}.echidna via FSAPI removeEntry.
Deliberately does NOT remove assets/characters/{id}/* — that's the
conservative default per the Phase 0.2 design."
```

---

## Task 12: `deleteCharacter` store action

**Files:**
- Modify: `tools/apps/echidna/src/store/useCharacterStore.ts`
- Modify: `tools/apps/echidna/src/__tests__/characterStore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('useCharacterStore.deleteCharacter', () => {
  it('removes the row from knownCharacters', async () => {
    const root = makeRoot();
    const td = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await td.getDirectoryHandle('echidna_saves', { create: true });
    const fh = await saves.getFileHandle('walker.echidna', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({ version: 3, id: 'walker', characterName: 'Walker', voxels: [], parts: [], poses: {} }));
    await w.close();

    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      knownCharacters: [
        { id: 'walker', name: 'Walker', lastModified: 0 },
        { id: 'archer', name: 'Archer', lastModified: 0 },
      ],
    });

    await useCharacterStore.getState().deleteCharacter('walker');

    expect(useCharacterStore.getState().knownCharacters.map((c) => c.id)).toEqual(['archer']);
  });

  it('clears state.character to null when deleting the current character', async () => {
    const root = makeRoot();
    const td = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await td.getDirectoryHandle('echidna_saves', { create: true });
    const fh = await saves.getFileHandle('walker.echidna', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({ version: 3, id: 'walker', characterName: 'Walker', voxels: [], parts: [], poses: {} }));
    await w.close();

    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      character: {
        id: 'walker',
        characterName: 'Walker',
        gridWidth: 32, gridDepth: 32,
        voxels: new Map(),
        characterParts: [], characterPoses: {}, animations: {},
        currentFilename: null,
      },
      knownCharacters: [{ id: 'walker', name: 'Walker', lastModified: 0 }],
      dirty: true,
    });

    await useCharacterStore.getState().deleteCharacter('walker');

    const s = useCharacterStore.getState();
    expect(s.character).toBeNull();
    expect(s.dirty).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd tools/apps/echidna && pnpm test characterStore
```

Expected: FAIL — `deleteCharacter is not a function`.

- [ ] **Step 3: Implement `deleteCharacter`**

Add to `useCharacterStore.ts`:

```ts
// In actions:
deleteCharacter: (id: string) => Promise<void>;

// In create():
deleteCharacter: async (id: string) => {
  const s = get();
  const handle = s.projectRootHandle;
  if (!handle) return;
  try {
    await deleteEchidnaProject(handle, id);
  } catch (e) {
    console.error(`[echidna] deleteCharacter failed for ${id}:`, e);
    return;
  }
  set((state) => ({
    knownCharacters: state.knownCharacters.filter((c) => c.id !== id),
    ...(state.character?.id === id
      ? {
          character: null,
          dirty: false,
          undoStack: [],
          redoStack: [],
          boxSelection: null,
          lassoSelection: null,
          clipboard: null,
        }
      : {}),
  }));
},
```

Import:

```ts
import { deleteEchidnaProject } from '../lib/projectFs';
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd tools/apps/echidna && pnpm test characterStore
```

Expected: 2 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add tools/apps/echidna/src/store/useCharacterStore.ts \
        tools/apps/echidna/src/__tests__/characterStore.test.ts
git commit -m "feat(echidna): deleteCharacter store action

Removes the .echidna source via deleteEchidnaProject and updates
knownCharacters. If the deleted character is the currently-loaded one,
clears state.character to null and resets dirty/undo/selection state."
```

---

## Task 13: `renameEchidnaProject` helper + `renameCharacter` store action

**Files:**
- Modify: `tools/apps/echidna/src/lib/projectFs.ts`
- Modify: `tools/apps/echidna/src/store/useCharacterStore.ts`
- Modify: `tools/apps/echidna/src/__tests__/projectFs.test.ts`
- Modify: `tools/apps/echidna/src/__tests__/characterStore.test.ts`

- [ ] **Step 1: Write the failing helper test**

In `projectFs.test.ts`:

```ts
import { renameEchidnaProject } from '../lib/projectFs';

describe('renameEchidnaProject', () => {
  it('updates characterName in the file without changing the filename', async () => {
    const root = makeRoot();
    const td = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await td.getDirectoryHandle('echidna_saves', { create: true });
    const fh = await saves.getFileHandle('walker.echidna', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({
      version: 3, id: 'walker', characterName: 'Walker Bot',
      voxels: [], parts: [], poses: {},
    }));
    await w.close();

    await renameEchidnaProject(root as any, 'walker', 'Walker v2');

    const re = await saves.getFileHandle('walker.echidna');   // same filename
    const reFile = await re.getFile();
    const parsed = JSON.parse(await reFile.text());
    expect(parsed.id).toBe('walker');                          // same id
    expect(parsed.characterName).toBe('Walker v2');            // new display name
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd tools/apps/echidna && pnpm test projectFs
```

Expected: FAIL — `renameEchidnaProject is not a function`.

- [ ] **Step 3: Implement `renameEchidnaProject`**

Add to `projectFs.ts`:

```ts
/**
 * Rename a character's display name (only). The file on disk keeps its
 * filename/id — see Phase 0.2 spec Decision #8 for why. Fails with
 * NotFoundError if the source file doesn't exist.
 */
export async function renameEchidnaProject(
  handle: FileSystemDirectoryHandle,
  id: string,
  newCharacterName: string,
): Promise<void> {
  const parts = PROJECT_LAYOUT.toolsData.echidnaSaves.split('/');
  let dir: FileSystemDirectoryHandle = handle;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part);
  }
  const fh = await dir.getFileHandle(`${id}.echidna`);
  const file = await fh.getFile();
  const raw = JSON.parse(await file.text());
  raw.characterName = newCharacterName;
  const w = await fh.createWritable();
  await w.write(JSON.stringify(raw, null, 2));
  await w.close();
}
```

- [ ] **Step 4: Verify helper test passes**

```bash
cd tools/apps/echidna && pnpm test projectFs
```

Expected: passes.

- [ ] **Step 5: Write the store action test**

In `characterStore.test.ts`:

```ts
describe('useCharacterStore.renameCharacter', () => {
  it('renames the current character in-memory and marks dirty', async () => {
    useCharacterStore.setState({
      projectRootHandle: makeRoot() as unknown as FileSystemDirectoryHandle,
      character: {
        id: 'walker', characterName: 'Walker Bot',
        gridWidth: 32, gridDepth: 32, voxels: new Map(),
        characterParts: [], characterPoses: {}, animations: {},
        currentFilename: null,
      },
      knownCharacters: [{ id: 'walker', name: 'Walker Bot', lastModified: 0 }],
      dirty: false,
    });

    await useCharacterStore.getState().renameCharacter('walker', 'Walker v2');

    const s = useCharacterStore.getState();
    expect(s.character?.characterName).toBe('Walker v2');
    expect(s.knownCharacters[0].name).toBe('Walker v2');
    expect(s.dirty).toBe(true);
  });

  it('renames a non-current character on disk without touching state.character', async () => {
    const root = makeRoot();
    const td = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await td.getDirectoryHandle('echidna_saves', { create: true });
    const fh = await saves.getFileHandle('archer.echidna', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({
      version: 3, id: 'archer', characterName: 'Archer', voxels: [], parts: [], poses: {},
    }));
    await w.close();

    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      character: {
        id: 'walker', characterName: 'Walker Bot',
        gridWidth: 32, gridDepth: 32, voxels: new Map(),
        characterParts: [], characterPoses: {}, animations: {},
        currentFilename: null,
      },
      knownCharacters: [
        { id: 'walker', name: 'Walker Bot', lastModified: 0 },
        { id: 'archer', name: 'Archer', lastModified: 0 },
      ],
      dirty: false,
    });

    await useCharacterStore.getState().renameCharacter('archer', 'Ace Archer');

    const s = useCharacterStore.getState();
    expect(s.character?.characterName).toBe('Walker Bot');        // unchanged
    expect(s.knownCharacters.find((c) => c.id === 'archer')?.name).toBe('Ace Archer');
    expect(s.dirty).toBe(false);                                    // still clean
  });
});
```

- [ ] **Step 6: Run to verify it fails**

```bash
cd tools/apps/echidna && pnpm test characterStore
```

Expected: FAIL — `renameCharacter is not a function`.

- [ ] **Step 7: Implement `renameCharacter`**

Add to `useCharacterStore.ts`:

```ts
renameCharacter: (id: string, newName: string) => Promise<void>;

// create():
renameCharacter: async (id, newName) => {
  const s = get();
  const handle = s.projectRootHandle;
  if (!handle) return;

  if (s.character?.id === id) {
    // Current character — mutate in-memory, mark dirty, defer disk write to next Save
    set((state) => ({
      character: state.character ? { ...state.character, characterName: newName } : null,
      knownCharacters: state.knownCharacters.map((c) =>
        c.id === id ? { ...c, name: newName } : c,
      ),
      dirty: true,
    }));
  } else {
    // Non-current character — persist directly
    try {
      await renameEchidnaProject(handle, id, newName);
      set((state) => ({
        knownCharacters: state.knownCharacters.map((c) =>
          c.id === id ? { ...c, name: newName } : c,
        ),
      }));
    } catch (e) {
      console.error(`[echidna] renameCharacter failed for ${id}:`, e);
    }
  }
},
```

Import:

```ts
import { renameEchidnaProject } from '../lib/projectFs';
```

- [ ] **Step 8: Run all tests**

```bash
cd tools/apps/echidna && pnpm test
```

Expected: all passing, including 2 new `renameCharacter` tests.

- [ ] **Step 9: Commit**

```bash
git add tools/apps/echidna/src/lib/projectFs.ts \
        tools/apps/echidna/src/store/useCharacterStore.ts \
        tools/apps/echidna/src/__tests__/projectFs.test.ts \
        tools/apps/echidna/src/__tests__/characterStore.test.ts
git commit -m "feat(echidna): rename character (display name only)

- renameEchidnaProject helper updates characterName in the .echidna JSON
  without touching the filename (id stays immutable — no dangling refs).
- renameCharacter store action mutates in-memory + marks dirty when
  renaming the current character; persists to disk directly when
  renaming a non-current character."
```

---

## Task 14: `duplicateEchidnaProject` helper + `duplicateCharacter` store action

**Files:**
- Modify: `tools/apps/echidna/src/lib/projectFs.ts`
- Modify: `tools/apps/echidna/src/store/useCharacterStore.ts`
- Modify: `tools/apps/echidna/src/__tests__/projectFs.test.ts`
- Modify: `tools/apps/echidna/src/__tests__/characterStore.test.ts`

- [ ] **Step 1: Write the failing helper test**

```ts
import { duplicateEchidnaProject } from '../lib/projectFs';

describe('duplicateEchidnaProject', () => {
  it('creates a new file with updated id and characterName', async () => {
    const root = makeRoot();
    const td = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await td.getDirectoryHandle('echidna_saves', { create: true });
    const fh = await saves.getFileHandle('walker.echidna', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({
      version: 3, id: 'walker', characterName: 'Walker Bot',
      voxels: [{ key: '0,0,0', color: [255, 0, 0, 255] }],
      parts: [], poses: {},
    }));
    await w.close();

    await duplicateEchidnaProject(root as any, 'walker', 'walker_2', 'Copy of Walker Bot');

    const newFh = await saves.getFileHandle('walker_2.echidna');
    const newFile = await newFh.getFile();
    const parsed = JSON.parse(await newFile.text());
    expect(parsed.id).toBe('walker_2');
    expect(parsed.characterName).toBe('Copy of Walker Bot');
    expect(parsed.voxels).toHaveLength(1);                 // content preserved

    // Original still exists
    await saves.getFileHandle('walker.echidna');
  });
});
```

- [ ] **Step 2: Verify it fails**

```bash
cd tools/apps/echidna && pnpm test projectFs
```

Expected: FAIL.

- [ ] **Step 3: Implement `duplicateEchidnaProject`**

```ts
/**
 * Read a source .echidna, change its id + characterName, and write it as
 * a new file. Does NOT build engine files — the user hits ⌘S later for
 * that. Does NOT check for collision — the caller (duplicateCharacter
 * store action) is responsible for minting a non-colliding newId.
 */
export async function duplicateEchidnaProject(
  handle: FileSystemDirectoryHandle,
  sourceId: string,
  newId: string,
  newCharacterName: string,
): Promise<void> {
  const parts = PROJECT_LAYOUT.toolsData.echidnaSaves.split('/');
  let dir: FileSystemDirectoryHandle = handle;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part);
  }
  const sourceFh = await dir.getFileHandle(`${sourceId}.echidna`);
  const sourceFile = await sourceFh.getFile();
  const raw = JSON.parse(await sourceFile.text());
  raw.id = newId;
  raw.characterName = newCharacterName;

  const newFh = await dir.getFileHandle(`${newId}.echidna`, { create: true });
  const w = await newFh.createWritable();
  await w.write(JSON.stringify(raw, null, 2));
  await w.close();
}
```

- [ ] **Step 4: Verify helper test passes**

```bash
cd tools/apps/echidna && pnpm test projectFs
```

- [ ] **Step 5: Write the store action test**

```ts
describe('useCharacterStore.duplicateCharacter', () => {
  it('appends a numeric suffix when newId collides', async () => {
    const root = makeRoot();
    const td = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await td.getDirectoryHandle('echidna_saves', { create: true });
    for (const [name, id] of [
      ['walker.echidna', 'walker'],
      ['walker_2.echidna', 'walker_2'],
    ] as const) {
      const fh = await saves.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(JSON.stringify({ version: 3, id, characterName: id, voxels: [], parts: [], poses: {} }));
      await w.close();
    }

    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      knownCharacters: [
        { id: 'walker', name: 'Walker', lastModified: 0 },
        { id: 'walker_2', name: 'Walker', lastModified: 0 },
      ],
    });

    await useCharacterStore.getState().duplicateCharacter('walker', 'Walker');
    // Expected: new id is walker_3 (since walker and walker_2 already exist)

    const known = useCharacterStore.getState().knownCharacters;
    expect(known.map((c) => c.id).sort()).toEqual(['walker', 'walker_2', 'walker_3']);
  });

  it('does not auto-open the duplicate', async () => {
    const root = makeRoot();
    const td = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await td.getDirectoryHandle('echidna_saves', { create: true });
    const fh = await saves.getFileHandle('walker.echidna', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({ version: 3, id: 'walker', characterName: 'Walker', voxels: [], parts: [], poses: {} }));
    await w.close();

    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      character: null,
      knownCharacters: [{ id: 'walker', name: 'Walker', lastModified: 0 }],
    });

    await useCharacterStore.getState().duplicateCharacter('walker', 'Archer');
    expect(useCharacterStore.getState().character).toBeNull();  // still null
  });
});
```

- [ ] **Step 6: Verify it fails**

```bash
cd tools/apps/echidna && pnpm test characterStore
```

- [ ] **Step 7: Implement `duplicateCharacter`**

```ts
// In actions:
duplicateCharacter: (sourceId: string, newName: string) => Promise<void>;

// In create():
duplicateCharacter: async (sourceId, newName) => {
  const s = get();
  const handle = s.projectRootHandle;
  if (!handle) return;

  // Mint a non-colliding id
  const baseId = slugifyCharacterId(newName);
  const existingIds = new Set(s.knownCharacters.map((c) => c.id));
  let newId = baseId;
  let counter = 2;
  while (existingIds.has(newId)) {
    newId = `${baseId}_${counter}`;
    counter += 1;
  }

  try {
    await duplicateEchidnaProject(handle, sourceId, newId, newName);
    set((state) => ({
      knownCharacters: [
        ...state.knownCharacters,
        { id: newId, name: newName, lastModified: Date.now() },
      ],
    }));
  } catch (e) {
    console.error(`[echidna] duplicateCharacter failed:`, e);
  }
},
```

Imports:

```ts
import { duplicateEchidnaProject } from '../lib/projectFs';
import { slugifyCharacterId } from './types';
```

- [ ] **Step 8: Run all tests**

```bash
cd tools/apps/echidna && pnpm test
```

- [ ] **Step 9: Commit**

```bash
git add tools/apps/echidna/src/lib/projectFs.ts \
        tools/apps/echidna/src/store/useCharacterStore.ts \
        tools/apps/echidna/src/__tests__/projectFs.test.ts \
        tools/apps/echidna/src/__tests__/characterStore.test.ts
git commit -m "feat(echidna): duplicate character

Creates a new .echidna file with mutated id + characterName, preserving
the source voxels/parts/poses/animations. Does NOT auto-open or build
engine files — user hits ⌘S after switching to the duplicate.

Collision handling: slugifyCharacterId(newName) + numeric suffix
(walker_2, walker_3, ...) until unique in knownCharacters."
```

---

## Task 15: Extend `DropdownMenu` to support nested submenus

**Files:**
- Modify: `tools/apps/echidna/src/panels/MenuBar.tsx` (inline `DropdownMenu` component only; MenuBar restructure is Task 20)

- [ ] **Step 1: Update the `DropdownMenu` item type**

In `MenuBar.tsx`, find the existing `DropdownMenuProps['items']` type and extend it:

```ts
interface DropdownMenuItemLeaf {
  label: string;
  shortcut?: string;
  action: () => void;
  separator?: false;
  children?: undefined;
}

interface DropdownMenuItemSubmenu {
  label: string;
  shortcut?: undefined;
  action?: undefined;
  separator?: false;
  children: DropdownMenuItem[];  // nested items
}

interface DropdownMenuItemSeparator {
  separator: true;
}

export type DropdownMenuItem = DropdownMenuItemLeaf | DropdownMenuItemSubmenu | DropdownMenuItemSeparator;
```

- [ ] **Step 2: Add a `Submenu` renderer inside `DropdownMenu`**

Below the existing item-rendering loop in `DropdownMenu`, add support for items with `children`:

```tsx
function SubmenuItem({
  item,
  onClose,
}: {
  item: DropdownMenuItemSubmenu;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        style={{
          ...styles.dropdownItem,
          justifyContent: 'space-between',
          background: open ? styles.dropdownItemHover.background : undefined,
        }}
      >
        <span>{item.label}</span>
        <span style={{ marginLeft: 12, color: '#888' }}>▸</span>
      </button>
      {open && (
        <div
          style={{
            ...styles.dropdown,
            position: 'absolute',
            top: 0,
            left: '100%',
            marginLeft: 0,
          }}
        >
          {item.children.map((child, i) => {
            if ('separator' in child && child.separator) {
              return <div key={i} style={styles.separator} />;
            }
            if ('children' in child && child.children) {
              return <SubmenuItem key={i} item={child} onClose={onClose} />;
            }
            const it = child as DropdownMenuItemLeaf;
            return (
              <button
                key={i}
                style={{
                  ...styles.dropdownItem,
                  ...(hovered === i ? styles.dropdownItemHover : {}),
                }}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => { it.action(); onClose(); }}
              >
                <span>{it.label}</span>
                {it.shortcut && <span style={styles.shortcut}>{it.shortcut}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

Then in the existing `DropdownMenu` body's item-rendering loop, check for `children` and delegate to `SubmenuItem`:

```tsx
{items.map((item, i) => {
  if ('separator' in item && item.separator) {
    return <div key={i} style={styles.separator} />;
  }
  if ('children' in item && item.children) {
    return <SubmenuItem key={i} item={item as DropdownMenuItemSubmenu} onClose={onClose} />;
  }
  // ... existing leaf rendering ...
})}
```

- [ ] **Step 3: Build to verify no type errors**

```bash
cd tools/apps/echidna && pnpm build 2>&1 | tail -20
```

Expected: `tsc` clean. No UI behavior change yet — `DropdownMenu` still accepts the existing flat items (the `children` branch is additive).

- [ ] **Step 4: Commit**

```bash
git add tools/apps/echidna/src/panels/MenuBar.tsx
git commit -m "feat(echidna): DropdownMenu submenu support

Adds an optional children array to DropdownMenu items. Items with
children render as a parent with a right-pointing arrow; hovering opens
a sibling popup to the right with the child items. Sub-sub-menus
supported via recursion.

Additive — no existing call site needs to change."
```

---

## Task 16: `SwitchCharacterDialog` component

**Files:**
- Create: `tools/apps/echidna/src/panels/SwitchCharacterDialog.tsx`

- [ ] **Step 1: Create the component**

```tsx
// tools/apps/echidna/src/panels/SwitchCharacterDialog.tsx
import React from 'react';
import type { SwitchDecision } from '../store/useCharacterStore.js';

interface Props {
  currentName: string;
  targetName: string;
  undoDepth: number;
  onDecide: (decision: SwitchDecision) => void;
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  dialog: {
    background: '#1e1e3a',
    border: '1px solid #444',
    borderRadius: 6,
    padding: 24,
    width: 440,
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
  },
  title: { fontSize: 15, color: '#ddd', marginBottom: 12 },
  body: { fontSize: 13, color: '#bbb', lineHeight: 1.5, marginBottom: 20 },
  buttons: { display: 'flex', gap: 8, justifyContent: 'flex-end' },
  button: {
    padding: '8px 16px',
    fontSize: 13,
    border: '1px solid #444',
    borderRadius: 4,
    cursor: 'pointer',
  },
  buttonPrimary: { background: '#3a6a8a', color: '#fff', borderColor: '#4a7a9a' },
  buttonDanger: { background: '#6a2a3a', color: '#fff', borderColor: '#8a3a4a' },
  buttonNeutral: { background: '#2a2a4a', color: '#ccc' },
};

export function SwitchCharacterDialog({ currentName, targetName, undoDepth, onDecide }: Props) {
  return (
    <div style={styles.overlay} onClick={() => onDecide('cancel')}>
      <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div style={styles.title}>Unsaved changes</div>
        <div style={styles.body}>
          You have unsaved changes to <strong>{currentName}</strong>.
          {undoDepth > 0 && (
            <>
              <br />
              Switching to <strong>{targetName}</strong> will clear your undo history ({undoDepth} steps) in addition to any unsaved edits.
            </>
          )}
          {undoDepth === 0 && (
            <>
              {' '}Switching to <strong>{targetName}</strong> will discard the unsaved edits.
            </>
          )}
        </div>
        <div style={styles.buttons}>
          <button style={{ ...styles.button, ...styles.buttonNeutral }} onClick={() => onDecide('cancel')}>
            Cancel
          </button>
          <button style={{ ...styles.button, ...styles.buttonDanger }} onClick={() => onDecide('discard')}>
            Discard &amp; Switch
          </button>
          <button style={{ ...styles.button, ...styles.buttonPrimary }} onClick={() => onDecide('save')}>
            Save &amp; Switch
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build to verify**

```bash
cd tools/apps/echidna && pnpm build 2>&1 | tail -15
```

Expected: `tsc` clean.

- [ ] **Step 3: Commit**

```bash
git add tools/apps/echidna/src/panels/SwitchCharacterDialog.tsx
git commit -m "feat(echidna): SwitchCharacterDialog component

Modal with Save / Discard / Cancel used as the dirty-state guard for
character switching, new-character creation, and delete-current-character
flows. Message dynamically includes undo history depth when > 0."
```

---

## Task 17: Rename, Duplicate, Delete dialogs

**Files:**
- Create: `tools/apps/echidna/src/panels/RenameCharacterDialog.tsx`
- Create: `tools/apps/echidna/src/panels/DuplicateCharacterDialog.tsx`
- Create: `tools/apps/echidna/src/panels/DeleteCharacterDialog.tsx`

- [ ] **Step 1: Create `RenameCharacterDialog.tsx`**

```tsx
// tools/apps/echidna/src/panels/RenameCharacterDialog.tsx
import React, { useState, useRef, useEffect } from 'react';

interface Props {
  currentName: string;
  onSubmit: (newName: string) => void;
  onCancel: () => void;
}

const NAME_RE = /^[A-Za-z0-9 _\-]+$/;

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000,
  },
  dialog: {
    background: '#1e1e3a', border: '1px solid #444', borderRadius: 6,
    padding: 24, width: 420,
  },
  title: { fontSize: 15, color: '#ddd', marginBottom: 12 },
  input: {
    width: '100%',
    padding: '8px 10px',
    fontSize: 13,
    background: '#16162a',
    border: '1px solid #444',
    borderRadius: 4,
    color: '#ddd',
    marginBottom: 16,
  },
  buttons: { display: 'flex', gap: 8, justifyContent: 'flex-end' },
  button: {
    padding: '8px 16px', fontSize: 13,
    border: '1px solid #444', borderRadius: 4, cursor: 'pointer',
  },
  buttonPrimary: { background: '#3a6a8a', color: '#fff', borderColor: '#4a7a9a' },
  buttonNeutral: { background: '#2a2a4a', color: '#ccc' },
  buttonDisabled: { opacity: 0.4, cursor: 'not-allowed' },
};

export function RenameCharacterDialog({ currentName, onSubmit, onCancel }: Props) {
  const [value, setValue] = useState(currentName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const trimmed = value.trim();
  const valid = trimmed.length > 0 && trimmed.length <= 64 && NAME_RE.test(trimmed);

  const submit = () => { if (valid) onSubmit(trimmed); };

  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div style={styles.title}>Rename character</div>
        <input
          ref={inputRef}
          style={styles.input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') onCancel();
          }}
          maxLength={64}
        />
        <div style={styles.buttons}>
          <button style={{ ...styles.button, ...styles.buttonNeutral }} onClick={onCancel}>
            Cancel
          </button>
          <button
            style={{
              ...styles.button,
              ...styles.buttonPrimary,
              ...(valid ? {} : styles.buttonDisabled),
            }}
            disabled={!valid}
            onClick={submit}
          >
            Rename
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `DuplicateCharacterDialog.tsx`**

```tsx
// tools/apps/echidna/src/panels/DuplicateCharacterDialog.tsx
import React, { useState, useRef, useEffect } from 'react';

interface Props {
  sourceName: string;
  onSubmit: (newName: string) => void;
  onCancel: () => void;
}

const NAME_RE = /^[A-Za-z0-9 _\-]+$/;

// Styles shared with RenameCharacterDialog — duplicate inline here rather
// than extract a shared style module because Phase 0.2 has no pattern for
// shared dialog styles and we'd be adding a module for two call sites.
const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000,
  },
  dialog: { background: '#1e1e3a', border: '1px solid #444', borderRadius: 6, padding: 24, width: 420 },
  title: { fontSize: 15, color: '#ddd', marginBottom: 12 },
  input: {
    width: '100%', padding: '8px 10px', fontSize: 13,
    background: '#16162a', border: '1px solid #444', borderRadius: 4,
    color: '#ddd', marginBottom: 16,
  },
  buttons: { display: 'flex', gap: 8, justifyContent: 'flex-end' },
  button: { padding: '8px 16px', fontSize: 13, border: '1px solid #444', borderRadius: 4, cursor: 'pointer' },
  buttonPrimary: { background: '#3a6a8a', color: '#fff', borderColor: '#4a7a9a' },
  buttonNeutral: { background: '#2a2a4a', color: '#ccc' },
  buttonDisabled: { opacity: 0.4, cursor: 'not-allowed' },
};

export function DuplicateCharacterDialog({ sourceName, onSubmit, onCancel }: Props) {
  const [value, setValue] = useState(`Copy of ${sourceName}`);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  const trimmed = value.trim();
  const valid = trimmed.length > 0 && trimmed.length <= 64 && NAME_RE.test(trimmed);
  const submit = () => { if (valid) onSubmit(trimmed); };

  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div style={styles.title}>Duplicate "{sourceName}"</div>
        <input
          ref={inputRef}
          style={styles.input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') onCancel();
          }}
          maxLength={64}
        />
        <div style={styles.buttons}>
          <button style={{ ...styles.button, ...styles.buttonNeutral }} onClick={onCancel}>Cancel</button>
          <button
            style={{
              ...styles.button,
              ...styles.buttonPrimary,
              ...(valid ? {} : styles.buttonDisabled),
            }}
            disabled={!valid}
            onClick={submit}
          >
            Duplicate
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `DeleteCharacterDialog.tsx`**

```tsx
// tools/apps/echidna/src/panels/DeleteCharacterDialog.tsx
import React from 'react';

interface Props {
  characterName: string;
  characterId: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000,
  },
  dialog: { background: '#1e1e3a', border: '1px solid #444', borderRadius: 6, padding: 24, width: 460 },
  title: { fontSize: 15, color: '#ddd', marginBottom: 12 },
  body: { fontSize: 13, color: '#bbb', lineHeight: 1.5, marginBottom: 20 },
  warn: { color: '#fa0', fontSize: 12, marginTop: 8 },
  buttons: { display: 'flex', gap: 8, justifyContent: 'flex-end' },
  button: { padding: '8px 16px', fontSize: 13, border: '1px solid #444', borderRadius: 4, cursor: 'pointer' },
  buttonDanger: { background: '#6a2a3a', color: '#fff', borderColor: '#8a3a4a' },
  buttonNeutral: { background: '#2a2a4a', color: '#ccc' },
};

export function DeleteCharacterDialog({ characterName, characterId, onConfirm, onCancel }: Props) {
  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div style={styles.title}>Delete character</div>
        <div style={styles.body}>
          Delete <strong>{characterName}</strong>? The <code>.echidna</code> source file will be permanently removed from <code>tools_data/echidna_saves/</code>.
          <div style={styles.warn}>
            ⚠ Exported files in <code>assets/characters/{characterId}/</code> will NOT be removed. Delete them manually if desired.
          </div>
          <div style={{ marginTop: 12 }}>This cannot be undone.</div>
        </div>
        <div style={styles.buttons}>
          <button style={{ ...styles.button, ...styles.buttonNeutral }} onClick={onCancel}>Cancel</button>
          <button style={{ ...styles.button, ...styles.buttonDanger }} onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Build**

```bash
cd tools/apps/echidna && pnpm build 2>&1 | tail -15
```

Expected: `tsc` clean.

- [ ] **Step 5: Commit**

```bash
git add tools/apps/echidna/src/panels/RenameCharacterDialog.tsx \
        tools/apps/echidna/src/panels/DuplicateCharacterDialog.tsx \
        tools/apps/echidna/src/panels/DeleteCharacterDialog.tsx
git commit -m "feat(echidna): rename, duplicate, delete character dialogs

Three modal dialogs for character management ops:
- RenameCharacterDialog: single text input with validation
- DuplicateCharacterDialog: prefilled with 'Copy of {name}'
- DeleteCharacterDialog: explicit warning that assets/characters/{id}/*
  will NOT be removed (only the .echidna source is touched)"
```

---

## Task 18: `CharactersPanel` component

**Files:**
- Create: `tools/apps/echidna/src/panels/CharactersPanel.tsx`

- [ ] **Step 1: Create the component**

```tsx
// tools/apps/echidna/src/panels/CharactersPanel.tsx
import React, { useState, useCallback, useRef } from 'react';
import { useCharacterStore, type SwitchDecision } from '../store/useCharacterStore.js';
import { SwitchCharacterDialog } from './SwitchCharacterDialog.js';
import { RenameCharacterDialog } from './RenameCharacterDialog.js';
import { DuplicateCharacterDialog } from './DuplicateCharacterDialog.js';
import { DeleteCharacterDialog } from './DeleteCharacterDialog.js';

const COLLAPSE_KEY = 'echidna:characters-panel-collapsed';

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    borderBottom: '1px solid #333',
    background: '#181830',
    flexShrink: 0,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    padding: '6px 10px',
    fontSize: 11,
    fontWeight: 600,
    color: '#888',
    textTransform: 'uppercase',
    cursor: 'pointer',
    userSelect: 'none',
  },
  headerLabel: { flex: 1 },
  collapseBtn: {
    padding: '0 6px',
    background: 'transparent',
    border: 'none',
    color: '#888',
    cursor: 'pointer',
    fontSize: 12,
  },
  list: {
    maxHeight: 200,
    overflowY: 'auto',
    padding: '2px 0',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    padding: '5px 12px',
    fontSize: 12,
    color: '#ccc',
    cursor: 'pointer',
  },
  rowCurrent: {
    background: '#2a2a4a',
    color: '#fff',
  },
  rowHover: { background: '#252540' },
  dot: { marginRight: 8, fontSize: 10 },
  dotCurrent: { color: '#7f7' },
  dotOther: { color: '#444' },
  name: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  dirtyMarker: { color: '#fa0', marginLeft: 6 },
  menuBtn: {
    padding: '0 6px',
    background: 'transparent',
    border: 'none',
    color: '#888',
    cursor: 'pointer',
    fontSize: 14,
  },
  footer: {
    padding: '6px 12px',
    borderTop: '1px solid #333',
  },
  newBtn: {
    width: '100%',
    padding: '6px',
    background: 'transparent',
    border: '1px dashed #444',
    borderRadius: 4,
    color: '#7a9',
    fontSize: 12,
    cursor: 'pointer',
  },
  empty: {
    padding: '12px 16px',
    fontSize: 11,
    color: '#666',
    fontStyle: 'italic',
  },
  contextMenu: {
    position: 'fixed',
    background: '#1e1e3a',
    border: '1px solid #444',
    borderRadius: 4,
    padding: '4px 0',
    minWidth: 160,
    zIndex: 500,
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
  },
  contextItem: {
    display: 'block',
    width: '100%',
    padding: '6px 14px',
    background: 'transparent',
    border: 'none',
    color: '#ccc',
    fontSize: 12,
    textAlign: 'left',
    cursor: 'pointer',
  },
};

type ContextMenuState = { x: number; y: number; id: string; name: string } | null;
type ActiveDialog =
  | { kind: 'switch'; targetId: string }
  | { kind: 'rename'; id: string; name: string }
  | { kind: 'duplicate'; id: string; name: string }
  | { kind: 'delete'; id: string; name: string }
  | null;

interface Props {
  onNewCharacter: () => void;    // parent handles NewProjectDialog
}

export function CharactersPanel({ onNewCharacter }: Props) {
  const knownCharacters = useCharacterStore((s) => s.knownCharacters);
  const currentId = useCharacterStore((s) => s.character?.id ?? null);
  const dirty = useCharacterStore((s) => s.dirty);
  const requestOpenCharacter = useCharacterStore((s) => s.requestOpenCharacter);
  const renameCharacter = useCharacterStore((s) => s.renameCharacter);
  const duplicateCharacter = useCharacterStore((s) => s.duplicateCharacter);
  const deleteCharacter = useCharacterStore((s) => s.deleteCharacter);

  const [collapsed, setCollapsed] = useState(() =>
    localStorage.getItem(COLLAPSE_KEY) === '1',
  );
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      return next;
    });
  }, []);

  // Build a promise-returning confirm callback for requestOpenCharacter
  const confirmSwitch = useCallback(
    (targetId: string): Promise<SwitchDecision> =>
      new Promise((resolve) => {
        setActiveDialog({ kind: 'switch', targetId });
        // The dialog's onDecide handler will call resolve. Store the resolver:
        (confirmSwitch as any)._resolve = resolve;
      }),
    [],
  );

  const handleSwitchDecision = (decision: SwitchDecision) => {
    const resolver = (confirmSwitch as any)._resolve as ((d: SwitchDecision) => void) | undefined;
    resolver?.(decision);
    (confirmSwitch as any)._resolve = undefined;
    setActiveDialog(null);
  };

  const handleRowClick = (id: string) => {
    if (id === currentId) return;
    void requestOpenCharacter(id, async ({ currentName, targetName, undoDepth }) => {
      // Surface the dialog, wait for decision
      return await new Promise<SwitchDecision>((resolve) => {
        setActiveDialog({ kind: 'switch', targetId: id });
        (handleRowClick as any)._resolve = resolve;
      });
    });
  };

  // A simpler, more honest plumbing: keep the switch target and the resolver
  // as refs so the dialog can call them when the user picks a decision.
  // Here we use component state; the resolver is stashed on the function.

  const handleContextMenu = (e: React.MouseEvent, id: string, name: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, id, name });
  };

  const closeContextMenu = () => setContextMenu(null);

  return (
    <div style={styles.root}>
      <div style={styles.header} onClick={toggleCollapsed}>
        <span style={styles.headerLabel}>Characters</span>
        <button style={styles.collapseBtn}>{collapsed ? '+' : '−'}</button>
      </div>
      {!collapsed && (
        <>
          {knownCharacters.length === 0 ? (
            <div style={styles.empty}>No characters yet.</div>
          ) : (
            <div style={styles.list}>
              {knownCharacters.map((c) => {
                const isCurrent = c.id === currentId;
                return (
                  <div
                    key={c.id}
                    style={{
                      ...styles.row,
                      ...(isCurrent ? styles.rowCurrent : {}),
                    }}
                    onClick={() => handleRowClick(c.id)}
                    onContextMenu={(e) => handleContextMenu(e, c.id, c.name)}
                  >
                    <span style={{ ...styles.dot, ...(isCurrent ? styles.dotCurrent : styles.dotOther) }}>
                      {isCurrent ? '●' : '○'}
                    </span>
                    <span style={styles.name}>{c.name}</span>
                    {isCurrent && dirty && <span style={styles.dirtyMarker}>●</span>}
                    <button
                      style={styles.menuBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleContextMenu(e, c.id, c.name);
                      }}
                    >
                      ⋯
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <div style={styles.footer}>
            <button style={styles.newBtn} onClick={onNewCharacter}>
              + New Character
            </button>
          </div>
        </>
      )}

      {/* Context menu */}
      {contextMenu && (
        <>
          <div
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 499 }}
            onClick={closeContextMenu}
          />
          <div
            style={{
              ...styles.contextMenu,
              left: contextMenu.x,
              top: contextMenu.y,
            }}
          >
            <button
              style={styles.contextItem}
              onClick={() => {
                setActiveDialog({ kind: 'rename', id: contextMenu.id, name: contextMenu.name });
                closeContextMenu();
              }}
            >
              Rename…
            </button>
            <button
              style={styles.contextItem}
              onClick={() => {
                setActiveDialog({ kind: 'duplicate', id: contextMenu.id, name: contextMenu.name });
                closeContextMenu();
              }}
            >
              Duplicate…
            </button>
            <button
              style={styles.contextItem}
              onClick={() => {
                setActiveDialog({ kind: 'delete', id: contextMenu.id, name: contextMenu.name });
                closeContextMenu();
              }}
            >
              Delete…
            </button>
          </div>
        </>
      )}

      {/* Dialogs */}
      {activeDialog?.kind === 'switch' && (
        <SwitchCharacterDialog
          currentName={useCharacterStore.getState().character?.characterName ?? ''}
          targetName={knownCharacters.find((c) => c.id === activeDialog.targetId)?.name ?? ''}
          undoDepth={useCharacterStore.getState().undoStack.length}
          onDecide={(decision) => {
            handleSwitchDecision(decision);
          }}
        />
      )}
      {activeDialog?.kind === 'rename' && (
        <RenameCharacterDialog
          currentName={activeDialog.name}
          onSubmit={(newName) => {
            void renameCharacter(activeDialog.id, newName);
            setActiveDialog(null);
          }}
          onCancel={() => setActiveDialog(null)}
        />
      )}
      {activeDialog?.kind === 'duplicate' && (
        <DuplicateCharacterDialog
          sourceName={activeDialog.name}
          onSubmit={(newName) => {
            void duplicateCharacter(activeDialog.id, newName);
            setActiveDialog(null);
          }}
          onCancel={() => setActiveDialog(null)}
        />
      )}
      {activeDialog?.kind === 'delete' && (
        <DeleteCharacterDialog
          characterName={activeDialog.name}
          characterId={activeDialog.id}
          onConfirm={() => {
            void deleteCharacter(activeDialog.id);
            setActiveDialog(null);
          }}
          onCancel={() => setActiveDialog(null)}
        />
      )}
    </div>
  );
}
```

**Note on the resolver pattern**: the code above stashes the switch-decision resolver on the `handleRowClick` function itself, which is ugly. A cleaner alternative uses `useRef<(d: SwitchDecision) => void>()` — but since this is Phase 0.2's most complex component and the resolver pattern needs to survive component re-renders, the `useRef` approach is what you should use. Replace the inline resolver stashing with:

```tsx
const pendingResolverRef = useRef<((d: SwitchDecision) => void) | null>(null);

const handleRowClick = (id: string) => {
  if (id === currentId) return;
  void requestOpenCharacter(id, async () => {
    return await new Promise<SwitchDecision>((resolve) => {
      pendingResolverRef.current = resolve;
      setActiveDialog({ kind: 'switch', targetId: id });
    });
  });
};

// In the Switch dialog onDecide:
onDecide={(decision) => {
  pendingResolverRef.current?.(decision);
  pendingResolverRef.current = null;
  setActiveDialog(null);
}}
```

Use the useRef version.

- [ ] **Step 2: Build to verify**

```bash
cd tools/apps/echidna && pnpm build 2>&1 | tail -15
```

Expected: `tsc` clean.

- [ ] **Step 3: Commit**

```bash
git add tools/apps/echidna/src/panels/CharactersPanel.tsx
git commit -m "feat(echidna): CharactersPanel component

Collapsible list at the top of the left column. Each row shows the
character name with a current/other indicator dot; the current row
shows an orange dirty marker when state.dirty is true.

Right-click or ⋯ button opens a context menu with Rename / Duplicate /
Delete. Click any non-current row triggers requestOpenCharacter,
which surfaces SwitchCharacterDialog when dirty or undoStack > 0.
Resolver pattern uses useRef to bridge the async callback and the
dialog's synchronous onDecide callback.

Collapse state stored in localStorage under echidna:characters-panel-collapsed."
```

---

## Task 19: `EmptyProjectState` component + App.tsx center-column routing + beforeunload

**Files:**
- Create: `tools/apps/echidna/src/panels/EmptyProjectState.tsx`
- Modify: `tools/apps/echidna/src/App.tsx`

- [ ] **Step 1: Create `EmptyProjectState.tsx`**

```tsx
// tools/apps/echidna/src/panels/EmptyProjectState.tsx
import React from 'react';

interface Props {
  onOpenProjectRoot: () => void;
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#16162a',
    color: '#888',
  },
  heading: {
    fontSize: 22,
    color: '#ccc',
    marginBottom: 12,
  },
  subtext: {
    fontSize: 13,
    color: '#888',
    maxWidth: 420,
    textAlign: 'center',
    lineHeight: 1.5,
    marginBottom: 24,
  },
  button: {
    padding: '10px 24px',
    fontSize: 13,
    fontWeight: 600,
    background: '#3a6a8a',
    color: '#fff',
    border: '1px solid #4a7a9a',
    borderRadius: 6,
    cursor: 'pointer',
  },
};

export function EmptyProjectState({ onOpenProjectRoot }: Props) {
  return (
    <div style={styles.root}>
      <div style={styles.heading}>No project open</div>
      <div style={styles.subtext}>
        Open a project root to browse, edit, and save characters. Project root is a folder on
        your disk containing <code>tools_data/echidna_saves/</code> for editor source files and{' '}
        <code>assets/characters/</code> for the engine-ready PLY + manifest exports.
      </div>
      <button style={styles.button} onClick={onOpenProjectRoot}>
        Open Project Root…
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create the "no character selected" placeholder (inline in App.tsx)**

This is a tiny component that doesn't need its own file. It's shown when a project is open but `state.character === null`:

```tsx
// In App.tsx, near EmptyProjectState import:
function NoCharacterSelected() {
  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#16162a', color: '#888', fontSize: 14,
    }}>
      Select a character from the panel or create a new one.
    </div>
  );
}
```

- [ ] **Step 3: Update `App.tsx` center-column routing**

In `App.tsx`, replace the line that renders `<CharacterViewport />` with a routing expression:

```tsx
// Before:
<CharacterViewport />

// After:
{useCharacterStore.getState().projectRootHandle === null ? (
  <EmptyProjectState onOpenProjectRoot={handleOpenProjectRoot} />
) : useCharacterStore.getState().character === null ? (
  <NoCharacterSelected />
) : (
  <CharacterViewport />
)}
```

This evaluation at render time doesn't re-render when the store changes — convert to reactive subscriptions:

```tsx
const projectRootHandle = useCharacterStore((s) => s.projectRootHandle);
const character = useCharacterStore((s) => s.character);
```

And use them in the routing:

```tsx
{projectRootHandle === null ? (
  <EmptyProjectState onOpenProjectRoot={handleOpenProjectRoot} />
) : character === null ? (
  <NoCharacterSelected />
) : (
  <CharacterViewport />
)}
```

You also need to define or lift `handleOpenProjectRoot` into `App.tsx`. It can be extracted from the existing `MenuBar.handlePickProjectRoot` handler (or call the same underlying action).

- [ ] **Step 4: Add `beforeunload` handler for dirty-state warning**

In `App.tsx`, add a new `useEffect`:

```tsx
useEffect(() => {
  if (!import.meta.env.PROD) return; // don't trigger on HMR reloads in dev

  const handler = (e: BeforeUnloadEvent) => {
    if (useCharacterStore.getState().dirty) {
      e.preventDefault();
    }
  };
  window.addEventListener('beforeunload', handler);
  return () => window.removeEventListener('beforeunload', handler);
}, []);
```

- [ ] **Step 5: Remove the "start with default character" initial state behavior**

In `tools/apps/echidna/src/store/useCharacterStore.ts`, change the initial `character` value to `null`:

```ts
// Before (from Task 4):
character: DEFAULT_CHARACTER,

// After:
character: null,
```

This is the deferred change from Task 4 Step 4 — now that `EmptyProjectState` and `NoCharacterSelected` exist, the app can handle a null character cleanly. Run the test suite after this change to catch any consumers that broke with null.

- [ ] **Step 6: Build + run all tests**

```bash
cd tools/apps/echidna && pnpm build 2>&1 | tail -20
cd tools/apps/echidna && pnpm test 2>&1 | tail -10
```

Expected: `tsc` clean; all tests still passing. Any test that relied on `character` being non-null at startup needs to explicitly `setState({ character: DEFAULT_CHARACTER })` in its setup.

- [ ] **Step 7: Commit**

```bash
git add tools/apps/echidna/src/panels/EmptyProjectState.tsx \
        tools/apps/echidna/src/App.tsx \
        tools/apps/echidna/src/store/useCharacterStore.ts
git commit -m "feat(echidna): empty project state + center-column routing

App.tsx center column now routes between three states:
- EmptyProjectState: no project root set
- NoCharacterSelected: project open but state.character === null
- CharacterViewport: a character is loaded

Also:
- Initial state.character is now null (was DEFAULT_CHARACTER)
- beforeunload handler warns on dirty state (PROD builds only, HMR-safe)"
```

---

## Task 20: MenuBar restructure — Project/Import/Export submenus, Save unified, dirty indicator

**Files:**
- Modify: `tools/apps/echidna/src/panels/MenuBar.tsx`

- [ ] **Step 1: Remove the old File menu items and replace with the new hierarchy**

Find the existing `fileItems` array in `MenuBar.tsx` and replace it with:

```tsx
const fileItems: DropdownMenuItem[] = [
  { label: 'New Character', shortcut: '\u2318N', action: handleNew },
  { label: 'Save', shortcut: '\u2318S', action: () => void useCharacterStore.getState().save() },
  { separator: true as const },
  {
    label: 'Project',
    children: [
      { label: 'Open Project Root\u2026', action: handlePickProjectRoot },
      { label: 'Connect Bridge to Project Root\u2026', action: handleConnectBridgeToProject },
    ],
  },
  { separator: true as const },
  {
    label: 'Import',
    children: [
      { label: 'Import (PLY/VOX/OBJ)\u2026', action: () => setShowImportDialog(true) },
      { label: 'Import .vox\u2026', action: handleImportVox },
      { label: 'Load .echidna\u2026', action: handleLoad },
    ],
  },
  {
    label: 'Export',
    children: [
      { label: 'Save As .echidna\u2026', action: handleSaveAs },
      { label: 'Export PLY\u2026', action: handleExportPly },
      { label: 'Export Manifest\u2026', action: handleExportManifest },
    ],
  },
  { separator: true as const },
  { label: 'Preview in Staging', action: handlePreviewInStaging },
];
```

**Items that were removed from the top level and where they live now:**
- `Set Project Root…` → renamed `Open Project Root…` → inside `Project ▸`
- `Save to Project` → removed (superseded by top-level `Save`)
- `Export Character to Project` → removed (superseded by top-level `Save`)
- `Save` (legacy download) → renamed `Save As .echidna…` → inside `Export ▸`
- `Save As…` (legacy download alt) → removed (same action as `Save As .echidna…`)
- `Load…` (legacy upload) → renamed `Load .echidna…` → inside `Import ▸`
- `Import (PLY/VOX/OBJ)…` → inside `Import ▸`
- `Import .vox…` → inside `Import ▸`
- `Export Character…` → removed (superseded by Save)
- `Export…` → removed (generic dialog, superseded)
- `Export PLY…` → inside `Export ▸`
- `Export Manifest…` → inside `Export ▸`
- `Preview in Staging` → stays at top level

- [ ] **Step 2: Delete dead handlers**

Remove any handler functions that no longer have a menu item calling them: `handleSaveToProject`, `handleExportCharacter`, `handleExportCharacterToProject`, `handleExport` (if any). The file compiler will flag them as unused; remove them entirely rather than leaving them.

- [ ] **Step 3: Add the dirty indicator to the title bar**

Find the title span in `MenuBar.tsx`:

```tsx
// Before:
<span style={styles.title}>Echidna</span>

// After:
<EchidnaTitle />
```

And add at the top of the file (or just above the `MenuBar` function):

```tsx
function EchidnaTitle() {
  const character = useCharacterStore((s) => s.character);
  const dirty = useCharacterStore((s) => s.dirty);
  const name = character?.characterName ?? '';
  return (
    <span style={styles.title}>
      Echidna{name ? ` — ${name}` : ''}
      {dirty && <span style={{ color: '#fa0', marginLeft: 6 }}>{'\u25CF'}</span>}
    </span>
  );
}
```

- [ ] **Step 4: Update `handleNew` to respect the dirty guard**

Find `handleNew` in `MenuBar.tsx`:

```tsx
// Before:
const handleNew = useCallback(() => {
  setShowNewDialog(true);
}, []);

// After:
const handleNew = useCallback(() => {
  const store = useCharacterStore.getState();
  if (store.dirty || store.undoStack.length > 0) {
    // Let the user decide via a native confirm — this handler runs from the
    // menu and can't easily show the SwitchCharacterDialog (the Characters
    // panel owns that component's state). Use confirm() for parity with the
    // existing "Create new character? Unsaved changes will be lost." flow.
    if (!confirm('Create new character? Unsaved changes will be lost.')) {
      return;
    }
  }
  setShowNewDialog(true);
}, []);
```

**Note**: ideally the Menu-bar-triggered New flow would use the same `SwitchCharacterDialog` as the panel-triggered New flow, but that requires lifting the dialog state into a shared location. For Phase 0.2 the browser `confirm()` is acceptable — it matches Echidna's existing pattern.

- [ ] **Step 5: Build**

```bash
cd tools/apps/echidna && pnpm build 2>&1 | tail -15
```

Expected: `tsc` clean.

- [ ] **Step 6: Commit**

```bash
git add tools/apps/echidna/src/panels/MenuBar.tsx
git commit -m "feat(echidna): MenuBar File restructure with Project/Import/Export submenus

- Top-level: New Character, Save (⌘S), Preview in Staging
- Project ▸: Open Project Root…, Connect Bridge to Project Root…
- Import ▸: Import (PLY/VOX/OBJ)…, Import .vox…, Load .echidna…
- Export ▸: Save As .echidna…, Export PLY…, Export Manifest…

Removed redundant items: 'Save to Project', 'Export Character to Project',
'Save' (legacy download), 'Save As…' (legacy), 'Export Character…',
generic 'Export…'. The unified ⌘S Save now writes both the .echidna
source AND the engine-ready PLY + manifest in one action.

Dirty indicator (●) added to the title bar when state.dirty is true."
```

---

## Task 21: CharactersPanel integration in App.tsx left column

**Files:**
- Modify: `tools/apps/echidna/src/App.tsx`

- [ ] **Step 1: Import `CharactersPanel`**

```tsx
import { CharactersPanel } from './panels/CharactersPanel.js';
```

- [ ] **Step 2: Wire `CharactersPanel` into the left column**

Find the left-column JSX in `App.tsx` and restructure:

```tsx
// Before:
<div style={{ width: leftWidth, flexShrink: 0, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', background: '#1e1e3a', borderRight: '1px solid #333' }}>
  <ModeTabs />
  {mode === 'build' ? <ToolBar /> : <AnimateLeftPanel />}
</div>

// After:
<div style={{ width: leftWidth, flexShrink: 0, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', background: '#1e1e3a', borderRight: '1px solid #333' }}>
  <CharactersPanel onNewCharacter={handleNewCharacter} />
  <ModeTabs />
  <div style={{ flex: 1, overflow: 'auto' }}>
    {mode === 'build' ? <ToolBar /> : <AnimateLeftPanel />}
  </div>
</div>
```

The inner `flex: 1` wrapper ensures the tool/animate panel takes the remaining vertical space below the Characters panel and ModeTabs.

- [ ] **Step 3: Add `handleNewCharacter` to `App.tsx`**

This is the handler the panel's `+ New Character` button invokes. It delegates to the existing `NewProjectDialog` flow:

```tsx
const [showNewDialog, setShowNewDialog] = useState(false);

const handleNewCharacter = useCallback(() => {
  const store = useCharacterStore.getState();
  if (store.dirty || store.undoStack.length > 0) {
    if (!confirm('Create new character? Unsaved changes will be lost.')) return;
  }
  setShowNewDialog(true);
}, []);
```

And render the dialog:

```tsx
{showNewDialog && <NewProjectDialog onClose={() => setShowNewDialog(false)} />}
```

Import `NewProjectDialog`:

```tsx
import { NewProjectDialog } from './panels/NewProjectDialog.js';
```

- [ ] **Step 4: Build**

```bash
cd tools/apps/echidna && pnpm build 2>&1 | tail -15
```

Expected: `tsc` clean.

- [ ] **Step 5: Commit**

```bash
git add tools/apps/echidna/src/App.tsx
git commit -m "feat(echidna): wire CharactersPanel into App.tsx left column

The panel sits above ModeTabs → ToolBar/AnimateLeftPanel. The '+ New
Character' button in the panel delegates to handleNewCharacter, which
guards against unsaved changes via confirm() (matching Echidna's
existing MenuBar pattern) before showing NewProjectDialog."
```

---

## Task 22: Wire `save` action into ⌘S keyboard handler

**Files:**
- Modify: `tools/apps/echidna/src/App.tsx`

- [ ] **Step 1: Replace the existing ⌘S handler logic**

Find the existing ⌘S handler in `App.tsx` (around line 152):

```tsx
// Before:
if (meta && e.key === 's' && !e.shiftKey) {
  e.preventDefault();
  const data = store.saveProject();
  const json = JSON.stringify(data, null, 2);
  const name = store.currentFilename ?? `${data.characterName.replace(/\s+/g, '_').toLowerCase() || 'character'}.echidna`;
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
  if (!store.currentFilename) store.setCurrentFilename(name);
  return;
}

// After:
if (meta && e.key === 's' && !e.shiftKey) {
  e.preventDefault();
  void store.save();
  return;
}
```

The new `save()` action handles everything: project-root check, writing `.echidna`, building engine files, clearing dirty. The legacy download-behavior is moved to `Save As .echidna…` under `Export ▸` (Task 20).

- [ ] **Step 2: Build**

```bash
cd tools/apps/echidna && pnpm build 2>&1 | tail -15
```

- [ ] **Step 3: Commit**

```bash
git add tools/apps/echidna/src/App.tsx
git commit -m "feat(echidna): ⌘S keyboard shortcut uses the unified save action

Replaces the legacy browser-download-based ⌘S with a call to
store.save(). The legacy download is still available via
File → Export → Save As .echidna…"
```

---

## Task 23: Bootstrap improvements — auto-list on project root restore

**Files:**
- Modify: `tools/apps/echidna/src/App.tsx`

- [ ] **Step 1: Update the existing bootstrap useEffect**

Find the existing bootstrap in `App.tsx`:

```tsx
// Before (from Phase 0.0):
useEffect(() => {
  (async () => {
    try {
      const handle = await restoreProjectRoot('echidna');
      if (handle && !useCharacterStore.getState().projectRootHandle) {
        useCharacterStore.getState().setProjectRootHandle(handle);
        console.info(`[echidna] Restored project root: ${handle.name}`);
      }
    } catch (e) {
      console.info('[echidna] No project root to restore');
    }
  })();
}, []);

// After:
useEffect(() => {
  let cancelled = false;
  (async () => {
    try {
      const handle = await restoreProjectRoot('echidna');
      if (cancelled) return;
      if (handle && !useCharacterStore.getState().projectRootHandle) {
        useCharacterStore.getState().setProjectRootHandle(handle);
        console.info(`[echidna] Restored project root: ${handle.name}`);
        // Populate knownCharacters for the panel
        await useCharacterStore.getState().listCharacters();
      }
    } catch (e) {
      console.info('[echidna] No project root to restore');
    }
  })();
  return () => { cancelled = true; };
}, []);
```

- [ ] **Step 2: Also call `listCharacters` after manual project root pick**

Find `handlePickProjectRoot` (either in `MenuBar.tsx` or in `App.tsx`, wherever it was placed in Task 20):

```tsx
// Before:
const handlePickProjectRoot = useCallback(async () => {
  try {
    const handle: FileSystemDirectoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await saveProjectRootHandle('echidna', handle);
    useCharacterStore.getState().setProjectRootHandle(handle);
    showToast(`Project root set: ${handle.name}`, 'success');
  } catch (e) { /* ... */ }
}, [showToast]);

// After:
const handlePickProjectRoot = useCallback(async () => {
  try {
    const handle: FileSystemDirectoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await saveProjectRootHandle('echidna', handle);
    useCharacterStore.getState().setProjectRootHandle(handle);
    await useCharacterStore.getState().listCharacters();     // <-- new
    showToast(`Project root set: ${handle.name}`, 'success');
  } catch (e) { /* ... */ }
}, [showToast]);
```

- [ ] **Step 3: Build**

```bash
cd tools/apps/echidna && pnpm build 2>&1 | tail -15
```

- [ ] **Step 4: Commit**

```bash
git add tools/apps/echidna/src/App.tsx tools/apps/echidna/src/panels/MenuBar.tsx
git commit -m "feat(echidna): auto-populate knownCharacters on project root restore

Both bootstrap restoreProjectRoot AND manual Open Project Root… now
call store.listCharacters() after setting the handle, so the
CharactersPanel populates without any extra user interaction."
```

---

## Task 24: Manual verification pass

**Files:**
- None (manual testing + docs update if issues found)

This is not a code task — it's the pre-merge smoke test. Walk through the checklist from the spec and confirm each item works.

- [ ] **Step 1: Start Echidna in dev mode**

```bash
cd tools/apps/echidna && pnpm dev
```

Open the printed localhost URL in Chrome (or an FSAPI-capable browser).

- [ ] **Step 2: Empty state check**

- Fresh session (clear IDB if needed via DevTools → Application → IndexedDB → delete the handle key, then reload)
- Verify `EmptyProjectState` welcome appears with "Open Project Root…" button
- Click the button → browser directory picker opens → pick a test project directory
- Verify the viewport now shows "Select a character or create a new one" placeholder

- [ ] **Step 3: Create two characters**

- Click "+ New Character" in the panel → NewProjectDialog → name "Walker Bot", grid 32
- Verify the character appears in the list with a green dot (current)
- Draw a few voxels → verify the orange dirty indicator appears in both the panel row and the title bar
- Press ⌘S → verify the dirty indicator clears and a toast says "Saved"
- Verify files exist on disk: `{ProjectRoot}/tools_data/echidna_saves/walker_bot.echidna`, `{ProjectRoot}/assets/characters/walker_bot/walker_bot.ply`, `{ProjectRoot}/assets/characters/walker_bot/walker_bot.manifest.json`
- Click "+ New Character" again → name "Archer", grid 32 → creates and switches

- [ ] **Step 4: Switch between characters with the dirty guard**

- Draw some voxels on Archer (creates dirty state)
- Click the "Walker Bot" row in the panel → `SwitchCharacterDialog` should appear
- Verify the dialog shows "unsaved changes to Archer" + undo depth (if any)
- Click "Cancel" → stays on Archer
- Click the row again → dialog → click "Discard & Switch" → switches to Walker Bot, Archer's dirty work is gone
- Click back to Archer → re-loads the saved state (empty voxels again)

- [ ] **Step 5: Rename**

- Right-click the Walker Bot row → Rename… → enter "Walker v2" → Enter
- Verify the panel row updates to "Walker v2"
- Verify the title bar updates if Walker is current
- Verify the file on disk at `walker_bot.echidna` still has the old filename but updated `characterName`

- [ ] **Step 6: Duplicate**

- Right-click the Walker v2 row → Duplicate… → accept "Copy of Walker v2" → Enter
- Verify a new row appears: "Copy of Walker v2" with id `copy_of_walker_v2`
- Click the new row → switches, confirm same voxels as Walker

- [ ] **Step 7: Delete**

- Right-click "Copy of Walker v2" → Delete… → confirm
- Verify the row disappears from the panel
- Verify the file `copy_of_walker_v2.echidna` is gone from `tools_data/echidna_saves/`
- Verify `assets/characters/copy_of_walker_v2/*` files (if any were produced by a previous Save) are NOT removed — they remain on disk per the Phase 0.2 decision

- [ ] **Step 8: beforeunload warning**

- Make an edit on any character to set dirty
- Try to reload the page (⌘R or browser refresh)
- Verify the browser shows a "Reload site?" warning
- Cancel
- Press ⌘S to clean the state
- Reload again → silent (no warning)

- [ ] **Step 9: Preview in Staging**

- With a character loaded, File → Preview in Staging
- Verify the character appears in the Staging window (assuming bridge + staging are running)
- Verify no errors in the browser console

- [ ] **Step 10: Multi-session persistence**

- With a project open, close the tab
- Reopen Echidna — verify the project root is restored from IDB
- Verify the CharactersPanel repopulates automatically (from the bootstrap `listCharacters()` call added in Task 23)
- Verify no character is auto-opened — state.character should start null

- [ ] **Step 11: If any step fails, update the spec's "Out of scope" list or file a Phase 0.2.1 follow-up**

Record any issues that surface during manual verification. Small bug fixes can land as follow-up commits on the same PR; anything larger gets a separate issue.

- [ ] **Step 12: Run the full test suite one final time**

```bash
cd tools/apps/echidna && pnpm build && pnpm test
```

Expected: clean build, all tests passing.

- [ ] **Step 13: Commit verification notes (if any)**

If any issues were found and fixed inline:

```bash
git add tools/apps/echidna/src/
git commit -m "fix(echidna): manual verification pass follow-ups

[describe each fix briefly]"
```

---

## Final Pre-Merge Checklist

Before opening the PR (or the final PR in a series), verify:

- [ ] All 23 store/FS tests pass (`pnpm test` in `tools/apps/echidna`)
- [ ] All 6 mock tests pass (`pnpm test` in `tools/packages/project-root`)
- [ ] `tsc && vite build` is clean for both packages
- [ ] Every step of the manual verification checklist (Task 24) was walked through successfully
- [ ] The commit log tells a coherent story (rebase or squash if needed)
- [ ] PR description links to the spec: `docs/superpowers/specs/2026-04-11-echidna-multi-character-design.md`
- [ ] `.superpowers/` is in `.gitignore` (if you used the visual companion earlier)

---

## Out of Scope (explicitly deferred)

These are listed in the spec and should NOT be implemented in Phase 0.2:

- Thumbnails in the character list (needs render-to-PNG step)
- `_index.json` manifest for fast listing (YAGNI for <50 characters)
- Shared `ProjectItemList` component extracted to `@gseurat/ui-kit`
- "Clean orphan exports" action for stale `assets/characters/{id}/*`
- Pre-save collision detection warning
- Restoring undo stacks across character switches
- Multi-asset support (maps, objects) — Phase 0.3
- React component tests for `CharactersPanel` / dialogs — manual verification only for now
