# Phase 0.3b — Assets Panel UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add kind filtering, kind badges, kind picker in NewProjectDialog, and hide animate mode for non-character assets.

**Architecture:** Pure UI changes in 3 files: AssetsPanel.tsx (filter + badges), NewProjectDialog.tsx (kind picker), App.tsx (conditional panels/tabs). One small store change in openAsset for mode reset.

**Tech Stack:** React, Zustand, TypeScript

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `tools/apps/echidna/src/panels/AssetsPanel.tsx` | Modify | Kind filter dropdown + kind badges on rows |
| `tools/apps/echidna/src/panels/NewProjectDialog.tsx` | Modify | Kind picker dropdown, dynamic title/label |
| `tools/apps/echidna/src/App.tsx` | Modify | Conditional mode tabs, conditional panels, mode reset |
| `tools/apps/echidna/src/store/useCharacterStore.ts` | Modify | Mode reset in openAsset for non-character assets |
| `tools/apps/echidna/src/__tests__/characterStore.test.ts` | Modify | Test mode reset on openAsset |

---

### Task 1: AssetsPanel — kind filter dropdown + kind badges

**Files:**
- Modify: `tools/apps/echidna/src/panels/AssetsPanel.tsx`

- [ ] **Step 1: Add kind filter state and badge styles**

In `tools/apps/echidna/src/panels/AssetsPanel.tsx`, add to the styles object:

```typescript
  filterRow: {
    display: 'flex',
    padding: '4px 10px',
    borderBottom: '1px solid #2a2a3a',
  },
  filterSelect: {
    flex: 1,
    background: '#2a2a4a',
    color: '#aaa',
    border: '1px solid #444',
    borderRadius: 3,
    padding: '2px 6px',
    fontSize: 10,
  },
  kindBadge: {
    fontSize: 9,
    fontWeight: 700,
    padding: '1px 4px',
    borderRadius: 2,
    marginRight: 6,
    letterSpacing: 0.5,
  },
```

Add a badge color helper outside the component:

```typescript
const KIND_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  character: { label: 'CHR', bg: '#1a3a2a', color: '#6c8' },
  map:       { label: 'MAP', bg: '#1a2a3a', color: '#68c' },
  object:    { label: 'OBJ', bg: '#3a2a1a', color: '#c86' },
};
```

- [ ] **Step 2: Add filter state and filter dropdown to the component**

Inside the `AssetsPanel` component, add filter state:

```typescript
  const [kindFilter, setKindFilter] = useState<string>('all');
```

Add import for `EchidnaAssetKind` type:
```typescript
import type { EchidnaAssetKind } from '../store/types.js';
```

Compute filtered assets:
```typescript
  const filteredAssets = kindFilter === 'all'
    ? knownAssets
    : knownAssets.filter((c) => c.kind === kindFilter);
```

Add the filter dropdown after the header, before the list:

```tsx
          <div style={styles.filterRow}>
            <select
              style={styles.filterSelect}
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
            >
              <option value="all">All</option>
              <option value="character">Characters</option>
              <option value="map">Maps</option>
              <option value="object">Objects</option>
            </select>
          </div>
```

- [ ] **Step 3: Update the list to use filteredAssets and add badges**

Change `knownAssets.length === 0` check to `filteredAssets.length === 0`:
```tsx
          {filteredAssets.length === 0 ? (
            <div style={styles.empty}>No assets yet.</div>
          ) : (
```

Change `knownAssets.map((c) =>` to `filteredAssets.map((c) =>`.

Add the kind badge inside each row, before the name span:
```tsx
                    <span style={{
                      ...styles.kindBadge,
                      background: KIND_BADGE[c.kind]?.bg ?? '#333',
                      color: KIND_BADGE[c.kind]?.color ?? '#888',
                    }}>
                      {KIND_BADGE[c.kind]?.label ?? c.kind.toUpperCase().slice(0, 3)}
                    </span>
```

- [ ] **Step 4: Update header and button text**

Change the header label from `"Characters"` to `"Assets"`:
```tsx
        <span style={styles.headerLabel}>Assets</span>
```

Change the new button text from `"+ New Character"` to `"+ New Asset"`:
```tsx
            <button style={styles.newBtn} onClick={onNewAsset}>
              + New Asset
            </button>
```

- [ ] **Step 5: Run build**

Run: `cd /Users/eccyan/dev/GSeurat/tools && pnpm build 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add tools/apps/echidna/src/panels/AssetsPanel.tsx
git commit -m "feat(echidna): add kind filter and badges to AssetsPanel"
```

---

### Task 2: NewProjectDialog — kind picker

**Files:**
- Modify: `tools/apps/echidna/src/panels/NewProjectDialog.tsx`

- [ ] **Step 1: Add kind state and dropdown**

In `tools/apps/echidna/src/panels/NewProjectDialog.tsx`:

Add import:
```typescript
import type { EchidnaAssetKind } from '../store/types.js';
```

Add kind state as the first state variable:
```typescript
  const [kind, setKind] = useState<EchidnaAssetKind>('character');
```

Add a label helper:
```typescript
const KIND_LABELS: Record<EchidnaAssetKind, string> = {
  character: 'Character',
  map: 'Map',
  object: 'Object',
};
```

Update `handleCreate` to pass `kind`:
```typescript
  const handleCreate = () => {
    useCharacterStore.getState().newAsset(kind, resolvedSize, charName);
    onClose();
  };
```

- [ ] **Step 2: Update dialog title and labels**

Change the title from hardcoded to dynamic:
```tsx
        <div style={styles.title}>New {KIND_LABELS[kind]}</div>
```

Add the Kind dropdown as the first section (before Character Name):
```tsx
        <div style={styles.section}>
          <span style={styles.label}>Kind</span>
          <select
            style={styles.select}
            value={kind}
            onChange={(e) => setKind(e.target.value as EchidnaAssetKind)}
          >
            <option value="character">Character</option>
            <option value="map">Map</option>
            <option value="object">Object</option>
          </select>
        </div>
```

Change the name label to be dynamic:
```tsx
          <span style={styles.label}>{KIND_LABELS[kind]} Name</span>
```

- [ ] **Step 3: Run build**

Run: `cd /Users/eccyan/dev/GSeurat/tools && pnpm build 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add tools/apps/echidna/src/panels/NewProjectDialog.tsx
git commit -m "feat(echidna): add kind picker to NewProjectDialog"
```

---

### Task 3: Kind-aware editor — conditional panels and mode tabs

**Files:**
- Modify: `tools/apps/echidna/src/App.tsx`
- Modify: `tools/apps/echidna/src/store/useCharacterStore.ts`
- Test: `tools/apps/echidna/src/__tests__/characterStore.test.ts`

- [ ] **Step 1: Write test for mode reset in openAsset**

In `tools/apps/echidna/src/__tests__/characterStore.test.ts`, add to the `useCharacterStore.openAsset` describe block:

```typescript
  it('resets mode to build when opening a non-character asset', async () => {
    const root = testing.makeRoot();
    const toolsData = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await toolsData.getDirectoryHandle('echidna_saves', { create: true });
    const fh = await saves.getFileHandle('town.echidna', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({
      version: 4, id: 'town', kind: 'map', characterName: 'Town',
      gridWidth: 64, gridDepth: 64, voxels: [], parts: [], poses: {}, tags: [],
    }));
    await w.close();

    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      mode: 'animate',
    });

    await useCharacterStore.getState().openAsset('town');

    const s = useCharacterStore.getState();
    expect(s.asset?.kind).toBe('map');
    expect(s.mode).toBe('build');
  });

  it('preserves mode when opening a character asset', async () => {
    const root = testing.makeRoot();
    const toolsData = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await toolsData.getDirectoryHandle('echidna_saves', { create: true });
    const fh = await saves.getFileHandle('archer.echidna', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({
      version: 4, id: 'archer', kind: 'character', characterName: 'Archer',
      gridWidth: 32, gridDepth: 32, voxels: [], parts: [], poses: {}, tags: [],
    }));
    await w.close();

    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      mode: 'animate',
    });

    await useCharacterStore.getState().openAsset('archer');

    const s = useCharacterStore.getState();
    expect(s.asset?.kind).toBe('character');
    expect(s.mode).toBe('animate');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter echidna test -- --run --reporter verbose 2>&1 | tail -20`
Expected: FAIL — openAsset doesn't reset mode

- [ ] **Step 3: Add mode reset in openAsset**

In `tools/apps/echidna/src/store/useCharacterStore.ts`, in the `openAsset` action, add a mode reset to the `set()` call (around line 911). Add `mode` conditionally:

Change the `set()` call from:
```typescript
      set({
        asset: char,
        dirty: false,
        undoStack: [],
        ...
      });
```

To:
```typescript
      set({
        asset: char,
        dirty: false,
        undoStack: [],
        redoStack: [],
        boxSelection: null,
        lassoSelection: null,
        clipboard: null,
        selectedPart: null,
        selectedPose: null,
        selectedAnimation: null,
        previewPose: false,
        playbackTime: 0,
        isPlaying: false,
        ...(char.kind !== 'character' ? { mode: 'build' as const } : {}),
      });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter echidna test -- --run --reporter verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Update App.tsx — conditional mode tabs**

In `tools/apps/echidna/src/App.tsx`, add an `assetKind` selector:

```typescript
  const assetKind = useCharacterStore((s) => s.asset?.kind ?? null);
```

Update the `ModeTabs` component to accept a `showAnimate` prop:

```typescript
function ModeTabs({ showAnimate }: { showAnimate: boolean }) {
  const mode = useCharacterStore((s) => s.mode);
  const setMode = useCharacterStore((s) => s.setMode);

  if (!showAnimate) {
    return (
      <div style={modeTabStyles.container}>
        <div style={{ ...modeTabStyles.tab, ...modeTabStyles.tabActive }}>BUILD</div>
      </div>
    );
  }

  return (
    <div style={modeTabStyles.container}>
      <button
        style={{ ...modeTabStyles.tab, ...(mode === 'build' ? modeTabStyles.tabActive : {}) }}
        onClick={() => setMode('build')}
      >
        BUILD
      </button>
      <button
        style={{ ...modeTabStyles.tab, ...(mode === 'animate' ? modeTabStyles.tabActive : {}) }}
        onClick={() => setMode('animate')}
      >
        ANIMATE
      </button>
    </div>
  );
}
```

Update the `<ModeTabs />` usage in App to pass the prop:
```tsx
          <ModeTabs showAnimate={assetKind === 'character'} />
```

- [ ] **Step 6: Update App.tsx — conditional left/right panels**

For the left panel, only show AnimateLeftPanel for characters:
```tsx
          <div style={{ flex: 1, overflow: 'auto' }}>
            {mode === 'build' || assetKind !== 'character' ? <ToolBar /> : <AnimateLeftPanel />}
          </div>
```

For the right panel:
```tsx
        <div style={{ ...styles.inspector, width: rightWidth }}>
          {mode === 'build' || assetKind !== 'character' ? <BuildPanel /> : <AnimateRightPanel />}
        </div>
```

For the Timeline overlay, only show for characters:
```tsx
          {asset !== null && mode === 'animate' && assetKind === 'character' && (
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10 }}>
              <Timeline />
            </div>
          )}
```

- [ ] **Step 7: Update NoCharacterSelected text**

Change the placeholder text:
```typescript
function NoCharacterSelected() {
  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#16162a', color: '#888', fontSize: 14,
    }}>
      Select an asset from the panel or create a new one.
    </div>
  );
}
```

- [ ] **Step 8: Run full test suite and build**

Run: `cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter echidna test -- --run --reporter verbose 2>&1 | tail -20`
Run: `cd /Users/eccyan/dev/GSeurat/tools && pnpm build 2>&1 | tail -10`
Expected: all PASS, build succeeds

- [ ] **Step 9: Commit**

```bash
git add tools/apps/echidna/src/App.tsx tools/apps/echidna/src/store/useCharacterStore.ts tools/apps/echidna/src/__tests__/characterStore.test.ts
git commit -m "feat(echidna): kind-aware editor — hide animate mode for non-character assets"
```
