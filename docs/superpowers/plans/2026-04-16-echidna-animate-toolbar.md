# Echidna Animate ToolBar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated Animate mode toolbar with Orbit, Assign Part, Box Select, Lasso, and a Target Bone dropdown. Introduce a neutral Orbit tool as default on mode switch.

**Architecture:** New `AnimateToolBar` component rendered above `AnimateLeftPanel` in Animate mode. New `'orbit'` tool type that does nothing in the viewport's click handler. `setMode()` resets `activeTool` to `'orbit'` to prevent edit bleed-through between modes.

**Tech Stack:** TypeScript, React, Zustand, Vitest

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `tools/apps/echidna/src/store/types.ts` | Modify | Add `'orbit'` to ToolType |
| `tools/apps/echidna/src/store/useCharacterStore.ts` | Modify | `setMode()` resets activeTool |
| `tools/apps/echidna/src/App.tsx` | Modify | Add `q` key binding; render AnimateToolBar |
| `tools/apps/echidna/src/panels/ToolBar.tsx` | Modify | Add Orbit button |
| `tools/apps/echidna/src/panels/AnimateToolBar.tsx` | Create | New component |
| `tools/apps/echidna/src/viewport/VoxelMesh.tsx` | Modify | No-op for `'orbit'` tool |
| `tools/apps/echidna/src/__tests__/animateToolBar.test.ts` | Create | Mode switch + orbit tests |

---

### Task 1: Add `'orbit'` ToolType and `setMode` reset (TDD)

**Files:**
- Modify: `tools/apps/echidna/src/store/types.ts`
- Modify: `tools/apps/echidna/src/store/useCharacterStore.ts`
- Create: `tools/apps/echidna/src/__tests__/animateToolBar.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tools/apps/echidna/src/__tests__/animateToolBar.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useCharacterStore } from '../store/useCharacterStore.js';

describe('setMode resets activeTool to orbit', () => {
  beforeEach(() => {
    useCharacterStore.setState({ mode: 'build', activeTool: 'place' });
  });

  it('resets activeTool to orbit when switching to animate', () => {
    useCharacterStore.getState().setMode('animate');
    expect(useCharacterStore.getState().activeTool).toBe('orbit');
  });

  it('resets activeTool to orbit when switching to build', () => {
    useCharacterStore.setState({ mode: 'animate', activeTool: 'assign_part' });
    useCharacterStore.getState().setMode('build');
    expect(useCharacterStore.getState().activeTool).toBe('orbit');
  });

  it('orbit tool can be set in both modes', () => {
    useCharacterStore.getState().setMode('build');
    useCharacterStore.getState().setTool('orbit');
    expect(useCharacterStore.getState().activeTool).toBe('orbit');

    useCharacterStore.getState().setMode('animate');
    useCharacterStore.getState().setTool('orbit');
    expect(useCharacterStore.getState().activeTool).toBe('orbit');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/eccyan/dev/GSeurat/tools/apps/echidna && npx vitest run src/__tests__/animateToolBar.test.ts 2>&1 || true
```

Expected: FAIL — `'orbit'` not assignable to ToolType, or activeTool remains `'place'`.

- [ ] **Step 3: Add `'orbit'` to ToolType**

In `tools/apps/echidna/src/store/types.ts`, change:

```ts
export type ToolType =
  | 'place'
  | 'paint'
  | 'erase'
  | 'fill'
  | 'extrude'
  | 'eyedropper'
  | 'assign_part'
  | 'box_select'
  | 'lasso_select';
```

to:

```ts
export type ToolType =
  | 'orbit'
  | 'place'
  | 'paint'
  | 'erase'
  | 'fill'
  | 'extrude'
  | 'eyedropper'
  | 'assign_part'
  | 'box_select'
  | 'lasso_select';
```

- [ ] **Step 4: Update `setMode` to reset activeTool**

In `tools/apps/echidna/src/store/useCharacterStore.ts`, find:

```ts
  setMode: (mode) => set({ mode }),
```

Change to:

```ts
  setMode: (mode) => set({ mode, activeTool: 'orbit' }),
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/eccyan/dev/GSeurat/tools/apps/echidna && npx vitest run src/__tests__/animateToolBar.test.ts
```

Expected: all 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/eccyan/dev/GSeurat
git add tools/apps/echidna/src/store/types.ts \
  tools/apps/echidna/src/store/useCharacterStore.ts \
  tools/apps/echidna/src/__tests__/animateToolBar.test.ts
git commit -m "feat(echidna): add orbit tool, setMode resets activeTool"
```

---

### Task 2: Handle `'orbit'` in viewport (no-op)

**Files:**
- Modify: `tools/apps/echidna/src/viewport/VoxelMesh.tsx`

- [ ] **Step 1: Add orbit case to click handler switch**

In `tools/apps/echidna/src/viewport/VoxelMesh.tsx`, find line 523:

```ts
    switch (store.activeTool) {
      case 'place': {
```

Insert a new case before `'place'`:

```ts
    switch (store.activeTool) {
      case 'orbit': {
        // Orbit is camera-only — no voxel interactions
        return;
      }
      case 'place': {
```

- [ ] **Step 2: Build to verify types**

```bash
cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter echidna build
```

Expected: builds successfully.

- [ ] **Step 3: Commit**

```bash
cd /Users/eccyan/dev/GSeurat
git add tools/apps/echidna/src/viewport/VoxelMesh.tsx
git commit -m "feat(echidna): orbit tool is no-op in viewport click handler"
```

---

### Task 3: Add Orbit button to Build ToolBar + `q` keybinding

**Files:**
- Modify: `tools/apps/echidna/src/panels/ToolBar.tsx`
- Modify: `tools/apps/echidna/src/App.tsx`

- [ ] **Step 1: Add Orbit to Build ToolBar tools array**

In `tools/apps/echidna/src/panels/ToolBar.tsx`, find:

```ts
const tools: { id: ToolType; label: string; key: string }[] = [
  { id: 'place', label: 'Place', key: 'V' },
```

Add Orbit as the first item:

```ts
const tools: { id: ToolType; label: string; key: string }[] = [
  { id: 'orbit', label: 'Orbit', key: 'Q' },
  { id: 'place', label: 'Place', key: 'V' },
```

- [ ] **Step 2: Add `q` to Build tool keyboard shortcuts**

In `tools/apps/echidna/src/App.tsx`, find:

```ts
const buildToolKeys: Record<string, ToolType> = {
  v: 'place',
```

Change to:

```ts
const buildToolKeys: Record<string, ToolType> = {
  q: 'orbit',
  v: 'place',
```

- [ ] **Step 3: Add `q` to Animate tool keyboard shortcuts**

In the same file, find:

```ts
const animateToolKeys: Record<string, ToolType> = {
  a: 'assign_part',
  s: 'box_select',
};
```

Change to:

```ts
const animateToolKeys: Record<string, ToolType> = {
  q: 'orbit',
  a: 'assign_part',
  s: 'box_select',
  l: 'lasso_select',
};
```

- [ ] **Step 4: Build to verify**

```bash
cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter echidna build
```

Expected: builds successfully.

- [ ] **Step 5: Commit**

```bash
cd /Users/eccyan/dev/GSeurat
git add tools/apps/echidna/src/panels/ToolBar.tsx \
  tools/apps/echidna/src/App.tsx
git commit -m "feat(echidna): add orbit tool button and Q keybinding"
```

---

### Task 4: Create AnimateToolBar component

**Files:**
- Create: `tools/apps/echidna/src/panels/AnimateToolBar.tsx`

- [ ] **Step 1: Create the component**

Create `tools/apps/echidna/src/panels/AnimateToolBar.tsx`:

```tsx
import React from 'react';
import { useComponentRegistry } from '@gseurat/ui-kit';
import { useCharacterStore } from '../store/useCharacterStore.js';
import type { ToolType } from '../store/types.js';

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
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  label: {
    fontSize: 11,
    color: '#888',
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
  },
  toolBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 10px',
    borderWidth: 1,
    borderStyle: 'solid' as const,
    borderColor: '#444',
    borderRadius: 4,
    background: '#2a2a4a',
    color: '#ddd',
    cursor: 'pointer',
    fontSize: 13,
  },
  toolBtnActive: {
    background: '#4a4a8a',
    borderColor: '#77f',
  },
  shortcut: {
    fontSize: 11,
    color: '#777',
  },
  select: {
    padding: '6px 8px',
    background: '#2a2a4a',
    border: '1px solid #444',
    borderRadius: 4,
    color: '#ddd',
    fontSize: 13,
  },
  selectDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
};

export function AnimateToolBar() {
  useComponentRegistry('AnimateToolBar');
  const activeTool = useCharacterStore((s) => s.activeTool);
  const setTool = useCharacterStore((s) => s.setTool);
  const parts = useCharacterStore((s) => s.asset?.characterParts ?? []);
  const selectedPart = useCharacterStore((s) => s.selectedPart);
  const setSelectedPart = useCharacterStore((s) => s.setSelectedPart);

  const hasBones = parts.length > 0;

  return (
    <div style={styles.container}>
      <div style={styles.section}>
        <span style={styles.label}>Tools</span>
        {tools.map((t) => (
          <button
            key={t.id}
            style={{
              ...styles.toolBtn,
              ...(activeTool === t.id ? styles.toolBtnActive : {}),
            }}
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
          style={{
            ...styles.select,
            ...(!hasBones ? styles.selectDisabled : {}),
          }}
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
git commit -m "feat(echidna): add AnimateToolBar component"
```

---

### Task 5: Mount AnimateToolBar above AnimateLeftPanel

**Files:**
- Modify: `tools/apps/echidna/src/App.tsx`

- [ ] **Step 1: Add import**

In `tools/apps/echidna/src/App.tsx`, find:

```ts
import { ToolBar } from './panels/ToolBar.js';
```

Add after it:

```ts
import { AnimateToolBar } from './panels/AnimateToolBar.js';
```

- [ ] **Step 2: Render AnimateToolBar above AnimateLeftPanel**

In the same file, find line 300:

```tsx
            {mode === 'build' || assetKind !== 'character' ? <ToolBar /> : <AnimateLeftPanel />}
```

Change to:

```tsx
            {mode === 'build' || assetKind !== 'character' ? (
              <ToolBar />
            ) : (
              <>
                <AnimateToolBar />
                <AnimateLeftPanel />
              </>
            )}
```

- [ ] **Step 3: Build and verify**

```bash
cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter echidna build
```

Expected: builds successfully.

- [ ] **Step 4: Run store tests to verify nothing broke**

```bash
cd /Users/eccyan/dev/GSeurat/tools/apps/echidna && npx vitest run src/__tests__/animateToolBar.test.ts
```

Expected: all 3 tests still pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/eccyan/dev/GSeurat
git add tools/apps/echidna/src/App.tsx
git commit -m "feat(echidna): mount AnimateToolBar above AnimateLeftPanel"
```

---

### Task 6: Register AnimateToolBar in expected-components

**Files:**
- Modify: `tools/apps/echidna/src/expected-components.json`

- [ ] **Step 1: Read current file**

Read `tools/apps/echidna/src/expected-components.json` to understand its structure.

- [ ] **Step 2: Add AnimateToolBar**

Add `"AnimateToolBar"` to the appropriate section (likely under Animate mode components or always-present components). Follow the pattern for `AnimateLeftPanel` if it's listed — AnimateToolBar should be in the same scope since it renders alongside.

If `AnimateLeftPanel` is listed under `animate` or similar conditional mode, add `AnimateToolBar` there.

- [ ] **Step 3: Build to verify**

```bash
cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter echidna build
```

Expected: builds successfully.

- [ ] **Step 4: Commit**

```bash
cd /Users/eccyan/dev/GSeurat
git add tools/apps/echidna/src/expected-components.json
git commit -m "chore(echidna): register AnimateToolBar in expected-components"
```
