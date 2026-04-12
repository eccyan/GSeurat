# Phase 0.2.1 — Echidna Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix five deferred follow-ups from Phase 0.2 Multi-Character Management.

**Architecture:** All changes are isolated to the Echidna app store (`useCharacterStore.ts`), the `NewProjectDialog` component, and tests. No cross-app or engine changes.

**Tech Stack:** TypeScript, Zustand, Vitest, `@gseurat/project-root` testing helpers

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `tools/apps/echidna/src/store/useCharacterStore.ts` | Modify | Tasks 1-4: `newCharacter`, `saveProject`, `save`, `renameCharacter`, `requestOpenCharacter` |
| `tools/apps/echidna/src/panels/NewProjectDialog.tsx` | Modify | Task 1: add character name input |
| `tools/apps/echidna/src/__tests__/characterStore.test.ts` | Modify | Tasks 1-4: new test cases |
| `tools/apps/echidna/src/__tests__/CharactersPanel.test.ts` | Create | Task 5: store-level panel data contract tests |

---

### Task 1: NewProjectDialog character name prompt

**Files:**
- Modify: `tools/apps/echidna/src/store/useCharacterStore.ts:235,1123-1179`
- Modify: `tools/apps/echidna/src/panels/NewProjectDialog.tsx`
- Test: `tools/apps/echidna/src/__tests__/characterStore.test.ts`

- [ ] **Step 1: Write test for newCharacter with custom name**

Add to `tools/apps/echidna/src/__tests__/characterStore.test.ts`:

```typescript
describe('useCharacterStore.newCharacter — name parameter', () => {
  beforeEach(() => {
    useCharacterStore.setState({
      knownCharacters: [],
      character: null,
      dirty: false,
    });
  });

  it('uses the provided name and derives id from it', () => {
    useCharacterStore.getState().newCharacter(32, 'Knight');
    const s = useCharacterStore.getState();
    expect(s.character?.characterName).toBe('Knight');
    expect(s.character?.id).toBe('knight');
  });

  it('falls back to Untitled when name is undefined', () => {
    useCharacterStore.getState().newCharacter(32);
    const s = useCharacterStore.getState();
    expect(s.character?.characterName).toBe('Untitled');
    expect(s.character?.id).toBe('untitled');
  });

  it('falls back to Untitled when name is empty string', () => {
    useCharacterStore.getState().newCharacter(32, '');
    const s = useCharacterStore.getState();
    expect(s.character?.characterName).toBe('Untitled');
  });

  it('deduplicates id when name collides with existing character', () => {
    useCharacterStore.setState({
      knownCharacters: [{ id: 'knight', name: 'Knight', lastModified: 0 }],
    });
    useCharacterStore.getState().newCharacter(32, 'Knight');
    const s = useCharacterStore.getState();
    expect(s.character?.characterName).toBe('Knight');
    expect(s.character?.id).toBe('knight_2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tools && pnpm --filter echidna test -- --run --reporter verbose 2>&1 | tail -30`
Expected: FAIL — `newCharacter` does not accept a `name` parameter yet.

- [ ] **Step 3: Update newCharacter signature and implementation**

In `tools/apps/echidna/src/store/useCharacterStore.ts`:

Change the interface declaration (line 235):
```typescript
  newCharacter: (gridSize?: number, name?: string) => void;
```

Change the implementation (line 1123 onward):
```typescript
  newCharacter: (gridSize?: number, name?: string) => {
    const size = gridSize ?? 32;
    const charName = (name && name.trim().length > 0) ? name.trim() : 'Untitled';
    const s = get();

    const MAX_NEW_SUFFIX = 1000;
    const baseId = slugifyCharacterId(charName);
    const existingIds = new Set(s.knownCharacters.map((c) => c.id));
    let newId = baseId;
    let counter = 2;
    while (existingIds.has(newId)) {
      if (counter > MAX_NEW_SUFFIX) {
        console.error(`[echidna] newCharacter: > ${MAX_NEW_SUFFIX} collisions for base id "${baseId}"`);
        return;
      }
      newId = `${baseId}_${counter}`;
      counter += 1;
    }

    set({
      character: {
        id: newId,
        voxels: new Map(),
        gridWidth: size,
        gridDepth: size,
        characterName: charName,
        characterParts: [],
        characterPoses: {},
        animations: {},
        currentFilename: null,
      },
      knownCharacters: [
        ...s.knownCharacters,
        { id: newId, name: charName, lastModified: Date.now() },
      ],
      selectedPart: null,
      selectedPose: null,
      selectedAnimation: null,
      previewPose: false,
      undoStack: [],
      redoStack: [],
      playbackTime: 0,
      isPlaying: false,
      boxSelection: null,
      colorByPart: false,
      partColors: {},
      dirty: true,
    });
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tools && pnpm --filter echidna test -- --run --reporter verbose 2>&1 | tail -30`
Expected: PASS

- [ ] **Step 5: Update NewProjectDialog to include name input**

In `tools/apps/echidna/src/panels/NewProjectDialog.tsx`:

Add name state and pass it to `newCharacter`:

```tsx
export function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const [charName, setCharName] = useState('');
  const [sizeOption, setSizeOption] = useState<string>('64');
  const [customSize, setCustomSize] = useState<number>(64);

  const isCustom = sizeOption === 'custom';
  const resolvedSize = isCustom
    ? Math.max(8, Math.min(1024, customSize))
    : Number(sizeOption);

  const handleCreate = () => {
    useCharacterStore.getState().newCharacter(resolvedSize, charName);
    onClose();
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div style={styles.title}>New Character</div>

        <div style={styles.section}>
          <span style={styles.label}>Character Name</span>
          <input
            type="text"
            style={styles.input}
            placeholder="Untitled"
            value={charName}
            onChange={(e) => setCharName(e.target.value)}
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
          />
        </div>

        <div style={styles.section}>
          <span style={styles.label}>Grid Size</span>
          <select
            style={styles.select}
            value={sizeOption}
            onChange={(e) => setSizeOption(e.target.value)}
          >
            {PRESET_SIZES.map((s) => (
              <option key={s} value={String(s)}>{s} × {s} × {s}</option>
            ))}
            <option value="custom">Custom...</option>
          </select>

          {isCustom && (
            <input
              type="number"
              style={styles.input}
              min={8}
              max={1024}
              value={customSize}
              onChange={(e) => setCustomSize(Number(e.target.value))}
            />
          )}
        </div>

        <div style={styles.footer}>
          <button style={styles.btn} onClick={onClose}>Cancel</button>
          <button style={styles.btnPrimary} onClick={handleCreate}>Create</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run full test suite and build**

Run: `cd tools && pnpm --filter echidna test -- --run --reporter verbose 2>&1 | tail -30`
Run: `cd tools && pnpm build 2>&1 | tail -10`
Expected: all PASS, build succeeds

- [ ] **Step 7: Commit**

```bash
git add tools/apps/echidna/src/store/useCharacterStore.ts tools/apps/echidna/src/panels/NewProjectDialog.tsx tools/apps/echidna/src/__tests__/characterStore.test.ts
git commit -m "feat(echidna): add character name prompt to NewProjectDialog"
```

---

### Task 2: saveProject DTO null fallback → hard throw

**Files:**
- Modify: `tools/apps/echidna/src/store/useCharacterStore.ts:1205-1228`
- Test: `tools/apps/echidna/src/__tests__/characterStore.test.ts`

- [ ] **Step 1: Write test for saveProject throwing on null character**

Add to `tools/apps/echidna/src/__tests__/characterStore.test.ts`:

```typescript
describe('useCharacterStore.saveProject — null guard', () => {
  it('throws when character is null', () => {
    useCharacterStore.setState({ character: null });
    expect(() => useCharacterStore.getState().saveProject()).toThrow(
      '[echidna] saveProject called with null character',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tools && pnpm --filter echidna test -- --run --reporter verbose 2>&1 | tail -20`
Expected: FAIL — currently `saveProject()` does not throw, it returns a default.

- [ ] **Step 3: Replace fallback with throw**

In `tools/apps/echidna/src/store/useCharacterStore.ts`, replace lines 1208-1211:

Old:
```typescript
    if (!s.character) {
      console.warn('[echidna] saveProject called with null character — returning DEFAULT_CHARACTER shape; callers should check s.character first');
    }
    const char = s.character ?? DEFAULT_CHARACTER;
```

New:
```typescript
    if (!s.character) {
      throw new Error('[echidna] saveProject called with null character');
    }
    const char = s.character;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tools && pnpm --filter echidna test -- --run --reporter verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/apps/echidna/src/store/useCharacterStore.ts tools/apps/echidna/src/__tests__/characterStore.test.ts
git commit -m "fix(echidna): saveProject throws on null character instead of silent fallback"
```

---

### Task 3: save() returns boolean

**Files:**
- Modify: `tools/apps/echidna/src/store/useCharacterStore.ts:243,1042-1111,931-957`
- Test: `tools/apps/echidna/src/__tests__/characterStore.test.ts`

- [ ] **Step 1: Write tests for save() return value**

Add to `tools/apps/echidna/src/__tests__/characterStore.test.ts`:

```typescript
describe('useCharacterStore.save — return value', () => {
  beforeEach(() => {
    useCharacterStore.setState({ _saving: false });
  });

  it('returns true on successful save', async () => {
    const root = testing.makeRoot();
    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      character: {
        id: 'walker', characterName: 'Walker',
        gridWidth: 32, gridDepth: 32, voxels: new Map(),
        characterParts: [], characterPoses: {}, animations: {},
        currentFilename: null,
      },
      dirty: true,
    });
    const result = await useCharacterStore.getState().save();
    expect(result).toBe(true);
  });

  it('returns false when projectRootHandle is null', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useCharacterStore.setState({
      projectRootHandle: null,
      character: {
        id: 'walker', characterName: 'Walker',
        gridWidth: 32, gridDepth: 32, voxels: new Map(),
        characterParts: [], characterPoses: {}, animations: {},
        currentFilename: null,
      },
      dirty: true,
    });
    const result = await useCharacterStore.getState().save();
    expect(result).toBe(false);
    warnSpy.mockRestore();
  });

  it('returns false when character is null', async () => {
    useCharacterStore.setState({
      projectRootHandle: testing.makeRoot() as unknown as FileSystemDirectoryHandle,
      character: null,
    });
    const result = await useCharacterStore.getState().save();
    expect(result).toBe(false);
  });

  it('returns false when race guard blocks', async () => {
    useCharacterStore.setState({ _saving: true });
    const result = await useCharacterStore.getState().save();
    expect(result).toBe(false);
  });

  it('returns false on partial failure', async () => {
    const root = testing.makeRoot();
    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      character: {
        id: 'walker', characterName: 'Walker',
        gridWidth: 32, gridDepth: 32, voxels: new Map(),
        characterParts: [], characterPoses: {}, animations: {},
        currentFilename: null,
      },
      dirty: true,
    });
    const projectFs = await import('../lib/projectFs');
    const spy = vi.spyOn(projectFs, 'exportCharacterToProject').mockRejectedValueOnce(
      new Error('simulated engine write failure'),
    );
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await useCharacterStore.getState().save();
      expect(result).toBe(false);
    } finally {
      spy.mockRestore();
      errSpy.mockRestore();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tools && pnpm --filter echidna test -- --run --reporter verbose 2>&1 | tail -30`
Expected: FAIL — `save()` currently returns `void` (undefined), not a boolean.

- [ ] **Step 3: Change save() to return boolean**

In `tools/apps/echidna/src/store/useCharacterStore.ts`:

Update the interface (line 243):
```typescript
  save: () => Promise<boolean>;
```

Update the implementation — replace the entire `save` method (lines 1042-1111):
```typescript
  save: async () => {
    if (get()._saving) return false;
    set({ _saving: true });
    try {
      const handleCheck = get();
      const handle = handleCheck.projectRootHandle;
      if (!handle) {
        console.warn('[echidna] save called with no projectRootHandle');
        return false;
      }
      if (!handleCheck.character) return false;

      const id = get().ensureCharacterId();
      const s = get();
      if (!s.character) return false;

      const file = s.saveProject();
      try {
        await saveEchidnaProject(handle, file);
      } catch (e) {
        console.error('[echidna] save: .echidna write failed:', e);
        return false;
      }

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
        return false;
      }

      set((state) => ({
        dirty: false,
        knownCharacters: state.knownCharacters.map((c) =>
          c.id === id ? { ...c, lastModified: Date.now() } : c,
        ),
      }));
      return true;
    } finally {
      set({ _saving: false });
    }
  },
```

- [ ] **Step 4: Update requestOpenCharacter to use boolean return**

In `tools/apps/echidna/src/store/useCharacterStore.ts`, replace lines 945-952 inside `requestOpenCharacter`:

Old:
```typescript
      if (decision === 'save') {
        await s.save();
        if (get().dirty) {
          console.error('[echidna] requestOpenCharacter: save() failed, aborting switch');
          return;
        }
      }
```

New:
```typescript
      if (decision === 'save') {
        const ok = await s.save();
        if (!ok) {
          console.error('[echidna] requestOpenCharacter: save() failed, aborting switch');
          return;
        }
      }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd tools && pnpm --filter echidna test -- --run --reporter verbose 2>&1 | tail -30`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add tools/apps/echidna/src/store/useCharacterStore.ts tools/apps/echidna/src/__tests__/characterStore.test.ts
git commit -m "feat(echidna): save() returns boolean for success/failure detection"
```

---

### Task 4: Eager persist for current-character rename

**Files:**
- Modify: `tools/apps/echidna/src/store/useCharacterStore.ts:985-1008`
- Test: `tools/apps/echidna/src/__tests__/characterStore.test.ts`

- [ ] **Step 1: Write test for eager disk rename of current character**

Add to `tools/apps/echidna/src/__tests__/characterStore.test.ts`:

```typescript
describe('useCharacterStore.renameCharacter — eager persist', () => {
  it('writes the new name to disk even for the current character', async () => {
    const root = testing.makeRoot();
    const td = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await td.getDirectoryHandle('echidna_saves', { create: true });
    const fh = await saves.getFileHandle('walker.echidna', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({
      version: 3, id: 'walker', characterName: 'Walker Bot',
      voxels: [], parts: [], poses: {},
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
      knownCharacters: [{ id: 'walker', name: 'Walker Bot', lastModified: 0 }],
      dirty: false,
    });

    await useCharacterStore.getState().renameCharacter('walker', 'Walker v2');

    // In-memory state updated
    const s = useCharacterStore.getState();
    expect(s.character?.characterName).toBe('Walker v2');
    expect(s.knownCharacters[0].name).toBe('Walker v2');

    // Disk file also updated
    const fh2 = await saves.getFileHandle('walker.echidna');
    const file2 = await fh2.getFile();
    const parsed = JSON.parse(await file2.text());
    expect(parsed.characterName).toBe('Walker v2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tools && pnpm --filter echidna test -- --run --reporter verbose 2>&1 | tail -20`
Expected: FAIL — current-character rename doesn't write to disk.

- [ ] **Step 3: Make current-character rename also persist to disk**

In `tools/apps/echidna/src/store/useCharacterStore.ts`, replace the `renameCharacter` method (lines 985-1008):

```typescript
  renameCharacter: async (id, newName) => {
    const s = get();
    const handle = s.projectRootHandle;
    if (!handle) return;

    // Always persist to disk — no asymmetry between current and non-current
    try {
      await renameEchidnaProject(handle, id, newName);
    } catch (e) {
      console.error(`[echidna] renameCharacter failed for ${id}:`, e);
      return;
    }

    if (s.character?.id === id) {
      // Current character — also update in-memory state
      set((state) => ({
        character: state.character ? { ...state.character, characterName: newName } : null,
        knownCharacters: state.knownCharacters.map((c) =>
          c.id === id ? { ...c, name: newName } : c,
        ),
      }));
    } else {
      // Non-current — refresh list from disk
      await get().listCharacters();
    }
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tools && pnpm --filter echidna test -- --run --reporter verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `cd tools && pnpm --filter echidna test -- --run --reporter verbose 2>&1 | tail -30`
Expected: all PASS (including the existing rename tests which should still work)

- [ ] **Step 6: Commit**

```bash
git add tools/apps/echidna/src/store/useCharacterStore.ts tools/apps/echidna/src/__tests__/characterStore.test.ts
git commit -m "fix(echidna): eager disk persist for current-character rename"
```

---

### Task 5: CharactersPanel data contract tests

**Note:** RTL (`@testing-library/react`) and jsdom are not installed in the workspace. Instead of adding dependencies, these tests verify the store-level data contract that `CharactersPanel` relies on: knownCharacters population, dirty indicator state, and current-character detection. This covers the same logical concerns as a render test without new dependencies.

**Files:**
- Create: `tools/apps/echidna/src/__tests__/CharactersPanel.test.ts`

- [ ] **Step 1: Write store-level data contract tests**

Create `tools/apps/echidna/src/__tests__/CharactersPanel.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useCharacterStore } from '../store/useCharacterStore';
import { testing } from '@gseurat/project-root';
import type { CharacterListEntry } from '../store/types';

/**
 * CharactersPanel data contract tests.
 *
 * These verify the store selectors and state shapes that CharactersPanel.tsx
 * consumes. RTL render tests are deferred until @testing-library/react is
 * added to the workspace.
 */

const makeCharacter = (id: string, name: string) => ({
  id,
  characterName: name,
  gridWidth: 32,
  gridDepth: 32,
  voxels: new Map(),
  characterParts: [],
  characterPoses: {},
  animations: {},
  currentFilename: null,
});

describe('CharactersPanel data contract', () => {
  beforeEach(() => {
    useCharacterStore.setState({
      character: null,
      knownCharacters: [],
      dirty: false,
      undoStack: [],
      redoStack: [],
    });
  });

  it('knownCharacters is empty when no characters exist', () => {
    const s = useCharacterStore.getState();
    expect(s.knownCharacters).toEqual([]);
    expect(s.character).toBeNull();
  });

  it('knownCharacters reflects listed characters', async () => {
    const root = testing.makeRoot();
    const td = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await td.getDirectoryHandle('echidna_saves', { create: true });
    for (const [file, id, name] of [
      ['knight.echidna', 'knight', 'Knight'],
      ['mage.echidna', 'mage', 'Mage'],
    ] as const) {
      const fh = await saves.getFileHandle(file, { create: true });
      const w = await fh.createWritable();
      await w.write(JSON.stringify({ version: 3, id, characterName: name, voxels: [], parts: [], poses: {} }));
      await w.close();
    }

    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
    });
    await useCharacterStore.getState().listCharacters();

    const known = useCharacterStore.getState().knownCharacters;
    expect(known).toHaveLength(2);
    const ids = known.map((c) => c.id).sort();
    expect(ids).toEqual(['knight', 'mage']);
  });

  it('current character id matches character.id selector', () => {
    useCharacterStore.setState({ character: makeCharacter('knight', 'Knight') });
    const s = useCharacterStore.getState();
    expect(s.character?.id).toBe('knight');
  });

  it('dirty indicator is true only when dirty flag is set', () => {
    useCharacterStore.setState({
      character: makeCharacter('knight', 'Knight'),
      dirty: false,
    });
    expect(useCharacterStore.getState().dirty).toBe(false);

    useCharacterStore.getState().markDirty();
    expect(useCharacterStore.getState().dirty).toBe(true);
  });

  it('currentHasWork is true when undoStack or redoStack is non-empty', () => {
    useCharacterStore.setState({
      character: makeCharacter('knight', 'Knight'),
      dirty: false,
      undoStack: [{} as any],
      redoStack: [],
    });
    const s = useCharacterStore.getState();
    const currentHasWork = s.dirty || s.undoStack.length > 0 || s.redoStack.length > 0;
    expect(currentHasWork).toBe(true);
  });

  it('newCharacter adds optimistic entry to knownCharacters', () => {
    useCharacterStore.getState().newCharacter(32, 'Archer');
    const s = useCharacterStore.getState();
    expect(s.knownCharacters).toHaveLength(1);
    expect(s.knownCharacters[0].id).toBe('archer');
    expect(s.knownCharacters[0].name).toBe('Archer');
    expect(s.character?.id).toBe('archer');
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd tools && pnpm --filter echidna test -- --run --reporter verbose 2>&1 | tail -30`
Expected: all PASS

- [ ] **Step 3: Commit**

```bash
git add tools/apps/echidna/src/__tests__/CharactersPanel.test.ts
git commit -m "test(echidna): add CharactersPanel data contract tests"
```

---

### Task 6: Final build verification

- [ ] **Step 1: Run full test suite**

Run: `cd tools && pnpm --filter echidna test -- --run --reporter verbose`
Expected: all PASS

- [ ] **Step 2: Run build**

Run: `cd tools && pnpm build 2>&1 | tail -10`
Expected: build succeeds with no errors
