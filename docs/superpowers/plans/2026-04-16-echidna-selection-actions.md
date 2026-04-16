# Echidna Selection Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Assign, Unassign, and Clear Selection buttons to AnimateToolBar so users can commit/remove box or lasso selections to/from bones.

**Architecture:** New `unassignVoxelsFromPart` store action. New "Selection" section in AnimateToolBar with 3 action buttons operating on the union of boxSelection and lassoSelection.

**Tech Stack:** TypeScript, React, Zustand, Vitest

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `tools/apps/echidna/src/store/useCharacterStore.ts` | Modify | Add `unassignVoxelsFromPart` |
| `tools/apps/echidna/src/__tests__/unassignVoxelsFromPart.test.ts` | Create | Unit tests |
| `tools/apps/echidna/src/panels/AnimateToolBar.tsx` | Modify | Add Selection section |

---

### Task 1: `unassignVoxelsFromPart` store action (TDD)

**Files:**
- Modify: `tools/apps/echidna/src/store/useCharacterStore.ts`
- Create: `tools/apps/echidna/src/__tests__/unassignVoxelsFromPart.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tools/apps/echidna/src/__tests__/unassignVoxelsFromPart.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useCharacterStore } from '../store/useCharacterStore.js';
import { voxelKey } from '../lib/voxelUtils.js';
import type { Asset, BodyPart } from '../store/types.js';

function makeAsset(): Asset {
  const parts: BodyPart[] = [
    { id: 'root', name: 'root', parent: null, joint: [0, 0, 0], voxelKeys: [] },
    { id: 'head', name: 'head', parent: 'root', joint: [0, 10, 0], voxelKeys: [voxelKey(1, 1, 1), voxelKey(2, 2, 2)] },
    { id: 'torso', name: 'torso', parent: 'root', joint: [0, 5, 0], voxelKeys: [voxelKey(3, 3, 3)] },
  ];
  const voxels = new Map();
  for (const p of parts) for (const k of p.voxelKeys) voxels.set(k, { color: [255, 0, 0, 255] });
  return {
    id: 'test',
    kind: 'character',
    characterName: 'Test',
    gridWidth: 32,
    gridDepth: 32,
    voxels,
    characterParts: parts,
    characterPoses: {},
    animations: {},
    tags: [],
    currentFilename: null,
  };
}

describe('unassignVoxelsFromPart', () => {
  beforeEach(() => {
    useCharacterStore.setState({ asset: makeAsset(), mirrorAxis: null });
  });

  it('removes voxels from the target bone', () => {
    useCharacterStore.getState().unassignVoxelsFromPart([voxelKey(1, 1, 1)], 'head');
    const head = useCharacterStore.getState().asset!.characterParts.find((p) => p.id === 'head')!;
    expect(head.voxelKeys).toEqual([voxelKey(2, 2, 2)]);
  });

  it('does nothing when voxel is not in target bone', () => {
    // voxel (3,3,3) is in torso, not head
    useCharacterStore.getState().unassignVoxelsFromPart([voxelKey(3, 3, 3)], 'head');
    const torso = useCharacterStore.getState().asset!.characterParts.find((p) => p.id === 'torso')!;
    expect(torso.voxelKeys).toEqual([voxelKey(3, 3, 3)]);
  });

  it('does nothing for non-existent target bone', () => {
    expect(() => {
      useCharacterStore.getState().unassignVoxelsFromPart([voxelKey(1, 1, 1)], 'nonexistent');
    }).not.toThrow();
    const head = useCharacterStore.getState().asset!.characterParts.find((p) => p.id === 'head')!;
    expect(head.voxelKeys).toEqual([voxelKey(1, 1, 1), voxelKey(2, 2, 2)]);
  });

  it('empty keys array is no-op', () => {
    useCharacterStore.getState().unassignVoxelsFromPart([], 'head');
    const head = useCharacterStore.getState().asset!.characterParts.find((p) => p.id === 'head')!;
    expect(head.voxelKeys).toEqual([voxelKey(1, 1, 1), voxelKey(2, 2, 2)]);
  });

  it('marks dirty', () => {
    useCharacterStore.setState({ dirty: false });
    useCharacterStore.getState().unassignVoxelsFromPart([voxelKey(1, 1, 1)], 'head');
    expect(useCharacterStore.getState().dirty).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/eccyan/dev/GSeurat/tools/apps/echidna && npx vitest run src/__tests__/unassignVoxelsFromPart.test.ts 2>&1 || true
```

Expected: FAIL — `unassignVoxelsFromPart` not found.

- [ ] **Step 3: Add interface entry**

In `tools/apps/echidna/src/store/useCharacterStore.ts`, find:

```ts
  assignVoxelsToPart: (keys: VoxelKey[], partId: string) => void;
```

Add after it:

```ts
  unassignVoxelsFromPart: (keys: VoxelKey[], partId: string) => void;
```

- [ ] **Step 4: Implement the action**

In the same file, find the `assignVoxelsToPart` implementation block (around line 574). After its closing brace (before `setSelectedPart`), add:

```ts
  unassignVoxelsFromPart: (keys, partId) => {
    const s = get();
    if (!s.asset) return;
    const { mirrorAxis } = s;
    const { voxels: voxelMap, gridWidth, characterParts } = s.asset;
    const allKeys = [...keys];
    if (mirrorAxis) {
      for (const k of keys) {
        const [x, y, z] = parseKey(k);
        const m = mirrorPos(x, y, z, mirrorAxis, gridWidth);
        if (m) {
          const mk = voxelKey(m[0], m[1], m[2]);
          if (voxelMap.has(mk) && !allKeys.includes(mk)) allKeys.push(mk);
        }
      }
    }
    const keySet = new Set(allKeys);
    set({
      asset: {
        ...s.asset,
        characterParts: characterParts.map((p) => {
          if (p.id !== partId) return p;
          const filtered = p.voxelKeys.filter((k) => !keySet.has(k));
          return filtered.length !== p.voxelKeys.length ? { ...p, voxelKeys: filtered } : p;
        }),
      },
      dirty: true,
    });
  },
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/eccyan/dev/GSeurat/tools/apps/echidna && npx vitest run src/__tests__/unassignVoxelsFromPart.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/eccyan/dev/GSeurat
git add tools/apps/echidna/src/store/useCharacterStore.ts \
  tools/apps/echidna/src/__tests__/unassignVoxelsFromPart.test.ts
git commit -m "feat(echidna): add unassignVoxelsFromPart store action"
```

---

### Task 2: Add Selection section to AnimateToolBar

**Files:**
- Modify: `tools/apps/echidna/src/panels/AnimateToolBar.tsx`

- [ ] **Step 1: Update AnimateToolBar to include Selection section**

Replace the entire content of `tools/apps/echidna/src/panels/AnimateToolBar.tsx` with:

```tsx
import React, { useMemo } from 'react';
import { useComponentRegistry } from '@gseurat/ui-kit';
import { useCharacterStore } from '../store/useCharacterStore.js';
import type { ToolType, VoxelKey } from '../store/types.js';

const tools: { id: ToolType; label: string; key: string }[] = [
  { id: 'orbit', label: 'Orbit', key: 'Q' },
  { id: 'assign_part', label: 'Assign Part', key: 'A' },
  { id: 'box_select', label: 'Box Select', key: 'S' },
  { id: 'lasso_select', label: 'Lasso', key: 'L' },
];

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: '#1e1e3a',
    borderBottom: '1px solid #333',
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  section: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: {
    fontSize: 11, color: '#888', textTransform: 'uppercase' as const,
    letterSpacing: 1,
  },
  toolBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '6px 10px', borderWidth: 1, borderStyle: 'solid' as const,
    borderColor: '#444', borderRadius: 4, background: '#2a2a4a', color: '#ddd',
    cursor: 'pointer', fontSize: 13,
  },
  toolBtnActive: { background: '#4a4a8a', borderColor: '#77f' },
  shortcut: { fontSize: 11, color: '#777' },
  select: {
    padding: '6px 8px', background: '#2a2a4a', border: '1px solid #444',
    borderRadius: 4, color: '#ddd', fontSize: 13,
  },
  selectDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  actionBtn: {
    padding: '6px 10px', borderWidth: 1, borderStyle: 'solid' as const,
    borderColor: '#555', borderRadius: 4, background: '#3a3a6a', color: '#ddd',
    cursor: 'pointer', fontSize: 13, textAlign: 'center' as const,
  },
  actionBtnPrimary: {
    background: '#4a4a8a', borderColor: '#77f', color: '#fff',
  },
  actionBtnDisabled: {
    opacity: 0.4, cursor: 'not-allowed',
  },
  countDisplay: {
    fontSize: 12, color: '#aaa',
    padding: '4px 8px', background: '#16162a', borderRadius: 4,
    textAlign: 'center' as const,
  },
};

export function AnimateToolBar() {
  useComponentRegistry('AnimateToolBar');
  const activeTool = useCharacterStore((s) => s.activeTool);
  const setTool = useCharacterStore((s) => s.setTool);
  const parts = useCharacterStore((s) => s.asset?.characterParts ?? []);
  const selectedPart = useCharacterStore((s) => s.selectedPart);
  const setSelectedPart = useCharacterStore((s) => s.setSelectedPart);
  const boxSelection = useCharacterStore((s) => s.boxSelection);
  const lassoSelection = useCharacterStore((s) => s.lassoSelection);
  const assignVoxelsToPart = useCharacterStore((s) => s.assignVoxelsToPart);
  const unassignVoxelsFromPart = useCharacterStore((s) => s.unassignVoxelsFromPart);
  const setBoxSelection = useCharacterStore((s) => s.setBoxSelection);
  const setLassoSelection = useCharacterStore((s) => s.setLassoSelection);
  const pushUndo = useCharacterStore((s) => s.pushUndo);

  const hasBones = parts.length > 0;

  const selection = useMemo<VoxelKey[]>(() => {
    const s = new Set<VoxelKey>();
    if (boxSelection) for (const k of boxSelection) s.add(k);
    if (lassoSelection) for (const k of lassoSelection) s.add(k);
    return Array.from(s);
  }, [boxSelection, lassoSelection]);

  const selectionCount = selection.length;
  const canCommit = selectionCount > 0 && selectedPart !== null;
  const canClear = selectionCount > 0;

  const clearSelection = () => {
    setBoxSelection(null);
    setLassoSelection(null);
  };

  const handleAssign = () => {
    if (!canCommit || !selectedPart) return;
    pushUndo();
    assignVoxelsToPart(selection, selectedPart);
    clearSelection();
  };

  const handleUnassign = () => {
    if (!canCommit || !selectedPart) return;
    pushUndo();
    unassignVoxelsFromPart(selection, selectedPart);
    clearSelection();
  };

  return (
    <div style={styles.container}>
      <div style={styles.section}>
        <span style={styles.label}>Tools</span>
        {tools.map((t) => (
          <button
            key={t.id}
            style={{ ...styles.toolBtn, ...(activeTool === t.id ? styles.toolBtnActive : {}) }}
            onClick={() => setTool(t.id)}
          >
            {t.label}
            <span style={styles.shortcut}>{t.key}</span>
          </button>
        ))}
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Target Bone</span>
        <select
          style={{ ...styles.select, ...(!hasBones ? styles.selectDisabled : {}) }}
          value={selectedPart ?? ''}
          onChange={(e) => setSelectedPart(e.target.value || null)}
          disabled={!hasBones}
        >
          {!hasBones && <option value="">No bones</option>}
          {hasBones && <option value="">(none)</option>}
          {parts.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Selection</span>
        <div style={styles.countDisplay}>
          {selectionCount === 0 ? 'No selection' : `${selectionCount} voxels selected`}
        </div>
        <button
          style={{
            ...styles.actionBtn,
            ...styles.actionBtnPrimary,
            ...(!canCommit ? styles.actionBtnDisabled : {}),
          }}
          onClick={handleAssign}
          disabled={!canCommit}
        >
          Assign to Bone
        </button>
        <button
          style={{
            ...styles.actionBtn,
            ...(!canCommit ? styles.actionBtnDisabled : {}),
          }}
          onClick={handleUnassign}
          disabled={!canCommit}
        >
          Unassign
        </button>
        <button
          style={{
            ...styles.actionBtn,
            ...(!canClear ? styles.actionBtnDisabled : {}),
          }}
          onClick={clearSelection}
          disabled={!canClear}
        >
          Clear Selection
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build to verify**

```bash
cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter echidna build
```

Expected: builds successfully.

- [ ] **Step 3: Commit**

```bash
cd /Users/eccyan/dev/GSeurat
git add tools/apps/echidna/src/panels/AnimateToolBar.tsx
git commit -m "feat(echidna): add Selection section with Assign/Unassign/Clear buttons"
```
