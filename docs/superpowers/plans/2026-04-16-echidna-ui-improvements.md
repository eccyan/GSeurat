# Echidna UI Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Echidna's Build and Animate toolbars compact (matching Bricklayer's icon-grid density), add a 256-slot per-character multi-palette system, remove the redundant Target Bone dropdown, and share environment controls between Build and Animate right panels.

**Architecture:** Extract three shared sub-components (`YClipControl`, `YLevelLock`, `DisplaySettings`) into `panels/controls/` so both `BuildPanel` and `AnimateRightPanel` can compose them. Add a `ColorPalette[]` field to the Asset slice and persist it in the `.echidna` file via a schema bump (v4 → v5). Rewrite `ToolBar` and `AnimateToolBar` as icon grids plus a compact palette UI.

**Tech Stack:** TypeScript, React 18, Zustand, Vitest.

**Spec:** `docs/superpowers/specs/2026-04-16-echidna-ui-improvements-design.md`

**Working directory:** `/Users/eccyan/dev/GSeurat/.worktrees/echidna-ui-improvements/` (all commands below assume this root).

---

## Task 1: Add ColorPalette type, bump EchidnaFile version, migrate

**Files:**
- Modify: `tools/apps/echidna/src/store/types.ts`
- Modify: `tools/apps/echidna/src/__tests__/echidnaFile.test.ts`

- [ ] **Step 1: Update the existing version assertion test**

The current test at `tools/apps/echidna/src/__tests__/echidnaFile.test.ts:36-37` asserts `migrated.version === 4`. Change it to 5 and keep `ECHIDNA_FILE_VERSION` check so both advance together:

```ts
// line 35-37 in echidnaFile.test.ts — current content:
//   expect(migrated.version).toBe(ECHIDNA_FILE_VERSION);
//   expect(migrated.version).toBe(4);
// replace with:
    expect(migrated.version).toBe(ECHIDNA_FILE_VERSION);
    expect(migrated.version).toBe(5);
```

- [ ] **Step 2: Write the failing tests for palette migration**

Append to `tools/apps/echidna/src/__tests__/echidnaFile.test.ts` inside the `describe('migrateEchidnaFile', ...)` block (before the final closing `});`):

```ts
  it('seeds color_palettes with a 256-slot default when absent', () => {
    const old = {
      version: 2,
      characterName: 'Walker',
      gridWidth: 32,
      gridDepth: 32,
      voxels: [],
      parts: [],
      poses: {},
    };
    const migrated = migrateEchidnaFile(old);
    expect(migrated.color_palettes).toBeDefined();
    expect(migrated.color_palettes!.length).toBe(1);
    expect(migrated.color_palettes![0].colors.length).toBe(256);
    // First 16 slots should be grayscale (r === g === b)
    for (let i = 0; i < 16; i++) {
      const [r, g, b, a] = migrated.color_palettes![0].colors[i];
      expect(r).toBe(g);
      expect(g).toBe(b);
      expect(a).toBe(255);
    }
  });

  it('preserves existing color_palettes when present', () => {
    const file = {
      version: 5,
      id: 'walker',
      characterName: 'Walker',
      gridWidth: 32,
      gridDepth: 32,
      voxels: [],
      parts: [],
      poses: {},
      color_palettes: [{ name: 'Custom', colors: [[10, 20, 30, 255]] }],
    };
    const migrated = migrateEchidnaFile(file);
    expect(migrated.color_palettes).toEqual([{ name: 'Custom', colors: [[10, 20, 30, 255]] }]);
  });
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd tools && pnpm --filter @gseurat/echidna test -- echidnaFile`
Expected: FAIL — `seeds color_palettes with a 256-slot default when absent` (property undefined) and `preserves existing color_palettes when present`. The existing `expect(migrated.version).toBe(5)` also fails because the constant is still 4.

- [ ] **Step 4: Update `types.ts` — add `ColorPalette`, bump version, extend migration**

Open `tools/apps/echidna/src/store/types.ts` and make these edits:

Change the version constant (currently line 80):

```ts
export const ECHIDNA_FILE_VERSION = 5 as const;
```

Add the `ColorPalette` interface — insert after the `AnimationClip` interface (after line 59):

```ts
// ── Color palettes ──

export interface ColorPalette {
  name: string;
  colors: [number, number, number, number][];
}

/**
 * Generate the default 256-slot palette: 16 grayscale + 12 hues × 4 sats × 5 lights.
 * Matches Bricklayer's `generateDefaultPalette` shape so imports between apps feel consistent.
 */
export function generateDefaultPalette(): ColorPalette {
  const colors: [number, number, number, number][] = [];
  // 16 grayscale: black to white
  for (let i = 0; i < 16; i++) {
    const v = Math.round((i / 15) * 255);
    colors.push([v, v, v, 255]);
  }
  // 240 chromatic: 12 hues × 4 saturations × 5 lightness levels
  const hues = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
  const sats = [0.3, 0.5, 0.75, 1.0];
  const lights = [0.2, 0.35, 0.5, 0.65, 0.8];
  for (const sat of sats) {
    for (const light of lights) {
      for (const hue of hues) {
        const [r, g, b] = hslToRgb(hue, sat, light);
        colors.push([r, g, b, 255]);
      }
    }
  }
  return { name: 'Default (256)', colors };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
```

Extend the `EchidnaFile` interface — add one field (after `tags: string[];` around line 93):

```ts
export interface EchidnaFile {
  version: number;
  id: string;
  kind: EchidnaAssetKind;
  characterName: string;
  gridWidth: number;
  gridDepth: number;
  voxels: { x: number; y: number; z: number; r: number; g: number; b: number; a: number }[];
  parts: BodyPart[];
  poses: Record<string, PoseData>;
  animations?: Record<string, AnimationClip>;
  tags: string[];
  color_palettes?: ColorPalette[];
}
```

Extend the `Asset` interface (around line 168):

```ts
export interface Asset {
  id: string;
  kind: EchidnaAssetKind;
  characterName: string;
  gridWidth: number;
  gridDepth: number;
  voxels: Map<VoxelKey, Voxel>;
  characterParts: BodyPart[];
  characterPoses: Record<string, PoseData>;
  animations: Record<string, AnimationClip>;
  tags: string[];
  colorPalettes: ColorPalette[];
  currentFilename: string | null;
}
```

Extend `migrateEchidnaFile` — inside the returned object (around line 136), add `color_palettes`:

```ts
  return {
    version: ECHIDNA_FILE_VERSION,
    id,
    kind,
    characterName: raw.characterName ?? '',
    gridWidth: raw.gridWidth ?? 32,
    gridDepth: raw.gridDepth ?? 32,
    voxels: Array.isArray(raw.voxels) ? raw.voxels : [],
    parts: Array.isArray(raw.parts) ? raw.parts : [],
    poses: raw.poses && typeof raw.poses === 'object' ? raw.poses : {},
    animations: raw.animations && typeof raw.animations === 'object' && !Array.isArray(raw.animations)
      ? raw.animations
      : undefined,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    color_palettes: Array.isArray(raw.color_palettes) && raw.color_palettes.length > 0
      ? raw.color_palettes
      : [generateDefaultPalette()],
  };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd tools && pnpm --filter @gseurat/echidna test -- echidnaFile`
Expected: PASS — all `migrateEchidnaFile` tests including new palette tests.

- [ ] **Step 6: Commit**

```bash
git add tools/apps/echidna/src/store/types.ts tools/apps/echidna/src/__tests__/echidnaFile.test.ts
git commit -m "feat(echidna): add ColorPalette type and bump file version to v5

Adds color_palettes to EchidnaFile, colorPalettes to Asset, and a
generateDefaultPalette helper (256 slots: 16 grayscale + 240 chromatic).
Migration seeds the default palette on v4 → v5 upgrade."
```

---

## Task 2: Port `colorExtract` utility from Bricklayer to Echidna

**Files:**
- Create: `tools/apps/echidna/src/lib/colorExtract.ts`
- Create: `tools/apps/echidna/src/__tests__/colorExtract.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tools/apps/echidna/src/__tests__/colorExtract.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractColorsFromImage } from '../lib/colorExtract.js';

function solidColorImageData(r: number, g: number, b: number, w = 8, h = 8): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h, colorSpace: 'srgb' } as ImageData;
}

describe('extractColorsFromImage', () => {
  it('returns a single color for a solid-fill image', () => {
    const img = solidColorImageData(120, 200, 80);
    const colors = extractColorsFromImage(img, 16);
    expect(colors.length).toBeGreaterThanOrEqual(1);
    // Bucketed, so the reported color is close but not necessarily exact
    const [r, g, b, a] = colors[0];
    expect(Math.abs(r - 120)).toBeLessThan(8);
    expect(Math.abs(g - 200)).toBeLessThan(8);
    expect(Math.abs(b - 80)).toBeLessThan(8);
    expect(a).toBe(255);
  });

  it('skips transparent pixels', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4);
    // First pixel opaque red, rest transparent
    data[0] = 255; data[1] = 0; data[2] = 0; data[3] = 255;
    const img = { data, width: 4, height: 4, colorSpace: 'srgb' } as ImageData;
    const colors = extractColorsFromImage(img, 16);
    expect(colors.length).toBe(1);
    expect(colors[0][0]).toBeGreaterThan(240);
    expect(colors[0][1]).toBeLessThan(16);
    expect(colors[0][2]).toBeLessThan(16);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tools && pnpm --filter @gseurat/echidna test -- colorExtract`
Expected: FAIL — `Cannot find module '../lib/colorExtract.js'`.

- [ ] **Step 3: Create `colorExtract.ts` by copying from Bricklayer**

Create `tools/apps/echidna/src/lib/colorExtract.ts` with the exact contents of `tools/apps/bricklayer/src/lib/colorExtract.ts` (verbatim — identical file). The file exports `extractColorsFromImage(imageData, maxColors)` and `extractColorsFromFile(file, maxColors)`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tools && pnpm --filter @gseurat/echidna test -- colorExtract`
Expected: PASS — both tests.

- [ ] **Step 5: Commit**

```bash
git add tools/apps/echidna/src/lib/colorExtract.ts tools/apps/echidna/src/__tests__/colorExtract.test.ts
git commit -m "feat(echidna): port colorExtract utility from Bricklayer

Verbatim copy of extractColorsFromImage + extractColorsFromFile for use
by the new palette system's From Image button. Future refactor: move to
a shared package when a third consumer appears."
```

---

## Task 3: Add palette state, actions, and serialization to `useCharacterStore`

**Files:**
- Modify: `tools/apps/echidna/src/store/useCharacterStore.ts`
- Modify: `tools/apps/echidna/src/__tests__/characterStore.test.ts`

- [ ] **Step 1: Write failing tests for palette actions and round-trip**

Append to `tools/apps/echidna/src/__tests__/characterStore.test.ts`. (First inspect the top of that file to match its existing `beforeEach` and import style, then append this block at the end.)

```ts
describe('color palettes', () => {
  beforeEach(() => {
    useCharacterStore.setState({
      asset: null,
      knownAssets: [],
      activePaletteIndex: 0,
    });
  });

  it('newAsset seeds asset.colorPalettes with a 256-slot default palette', () => {
    useCharacterStore.getState().newAsset('character', 32, 'Test Bot');
    const asset = useCharacterStore.getState().asset!;
    expect(asset.colorPalettes.length).toBe(1);
    expect(asset.colorPalettes[0].colors.length).toBe(256);
  });

  it('addPalette appends an empty 256-slot palette and activates it', () => {
    const store = useCharacterStore.getState();
    store.newAsset('character', 32, 'Test');
    store.addPalette('MyPalette');
    const s = useCharacterStore.getState();
    expect(s.asset!.colorPalettes.length).toBe(2);
    expect(s.asset!.colorPalettes[1].name).toBe('MyPalette');
    expect(s.asset!.colorPalettes[1].colors.length).toBe(256);
    expect(s.asset!.colorPalettes[1].colors[0]).toEqual([0, 0, 0, 0]); // empty slot
    expect(s.activePaletteIndex).toBe(1);
  });

  it('addColorToPalette fills the first empty slot', () => {
    const store = useCharacterStore.getState();
    store.newAsset('character', 32, 'Test');
    store.addPalette('MyPalette');
    store.addColorToPalette(1, [200, 100, 50, 255]);
    const s = useCharacterStore.getState();
    expect(s.asset!.colorPalettes[1].colors[0]).toEqual([200, 100, 50, 255]);
  });

  it('removePalette drops by index and adjusts activePaletteIndex', () => {
    const store = useCharacterStore.getState();
    store.newAsset('character', 32, 'Test');
    store.addPalette('A');
    store.addPalette('B');
    expect(useCharacterStore.getState().asset!.colorPalettes.length).toBe(3);
    store.removePalette(0);
    const s = useCharacterStore.getState();
    expect(s.asset!.colorPalettes.length).toBe(2);
    expect(s.asset!.colorPalettes.map((p) => p.name)).toEqual(['A', 'B']);
  });

  it('removePalette never leaves zero palettes', () => {
    const store = useCharacterStore.getState();
    store.newAsset('character', 32, 'Test');
    // Asset already has 1 (default). Try to remove it.
    store.removePalette(0);
    const s = useCharacterStore.getState();
    expect(s.asset!.colorPalettes.length).toBeGreaterThanOrEqual(1);
  });

  it('saveProject / loadProject round-trips color_palettes', () => {
    const store = useCharacterStore.getState();
    store.newAsset('character', 32, 'Test');
    store.addColorToPalette(0, [11, 22, 33, 255]);
    const file = store.saveProject();
    expect(file.color_palettes).toBeDefined();
    expect(file.color_palettes!.length).toBe(1);
    expect(file.color_palettes![0].colors[16]).toEqual([11, 22, 33, 255]); // first empty slot after 16 grayscale

    // Clear and reload
    useCharacterStore.setState({ asset: null });
    store.loadProject(file);
    const reloaded = useCharacterStore.getState().asset!;
    expect(reloaded.colorPalettes[0].colors[16]).toEqual([11, 22, 33, 255]);
  });

  it('openAsset resets activePaletteIndex to 0', () => {
    useCharacterStore.setState({ activePaletteIndex: 3 });
    // Simulate state reset that openAsset performs.
    useCharacterStore.setState({ activePaletteIndex: 0 });
    expect(useCharacterStore.getState().activePaletteIndex).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tools && pnpm --filter @gseurat/echidna test -- characterStore`
Expected: FAIL — `colorPalettes` / `activePaletteIndex` / `addPalette` not defined.

- [ ] **Step 3: Add palette state + actions to the store**

Open `tools/apps/echidna/src/store/useCharacterStore.ts`.

Add imports (top of file, in the type import block):

```ts
import type {
  Voxel,
  VoxelKey,
  BodyPart,
  PoseData,
  ToolType,
  Snapshot,
  EchidnaFile,
  AppMode,
  AnimationClip,
  AnimationKeyframe,
  ClipboardEntry,
  PlaybackMode,
  Asset,
  AssetListEntry,
  EchidnaAssetKind,
  ColorPalette,
} from './types.js';
import { migrateEchidnaFile, slugifyAssetId, ECHIDNA_FILE_VERSION, generateDefaultPalette } from './types.js';
```

Add to the `CharacterStoreState` interface (find the section with UI-state fields, e.g. near `activeTool`) — top-level state (NOT on `Asset`):

```ts
  activePaletteIndex: number;
```

Add to the action interface section (near `setTool`, `setActiveColor`):

```ts
  addPalette: (name: string) => void;
  removePalette: (index: number) => void;
  setActivePalette: (index: number) => void;
  addColorToPalette: (paletteIndex: number, color: [number, number, number, number]) => void;
  addPaletteFromFile: (file: File) => Promise<void>;
```

Add to the store's initial state object (alongside other top-level defaults like `activeTool`, `activeColor`):

```ts
  activePaletteIndex: 0,
```

Add the action implementations anywhere in the actions block (e.g. near the end, before `save`). Every mutating action calls `markDirty()` so the file is saved; `setActivePalette` does not mutate the asset, so no dirty flag.

```ts
  addPalette: (name) => {
    const s = get();
    if (!s.asset) return;
    const emptyColors: [number, number, number, number][] = Array.from({ length: 256 }, () => [0, 0, 0, 0]);
    const palettes = [...s.asset.colorPalettes, { name, colors: emptyColors }];
    set({
      asset: { ...s.asset, colorPalettes: palettes },
      activePaletteIndex: palettes.length - 1,
      dirty: true,
    });
  },

  removePalette: (index) => {
    const s = get();
    if (!s.asset) return;
    let palettes = s.asset.colorPalettes.filter((_, i) => i !== index);
    // Always keep at least one palette so the Build UI never has nothing to draw.
    if (palettes.length === 0) palettes = [generateDefaultPalette()];
    set({
      asset: { ...s.asset, colorPalettes: palettes },
      activePaletteIndex: Math.min(s.activePaletteIndex, palettes.length - 1),
      dirty: true,
    });
  },

  setActivePalette: (index) => set({ activePaletteIndex: index }),

  addColorToPalette: (paletteIndex, color) => {
    const s = get();
    if (!s.asset) return;
    const palettes = [...s.asset.colorPalettes];
    if (!palettes[paletteIndex]) return;
    const colors = [...palettes[paletteIndex].colors];
    const emptyIdx = colors.findIndex((c) => c[3] === 0);
    if (emptyIdx >= 0) {
      colors[emptyIdx] = color;
    } else if (colors.length < 256) {
      colors.push(color);
    } else {
      return; // palette full, no-op
    }
    palettes[paletteIndex] = { ...palettes[paletteIndex], colors };
    set({ asset: { ...s.asset, colorPalettes: palettes }, dirty: true });
  },

  addPaletteFromFile: async (file) => {
    const { extractColorsFromFile } = await import('../lib/colorExtract.js');
    const extracted = await extractColorsFromFile(file, 256);
    const colors: [number, number, number, number][] = [...extracted];
    while (colors.length < 256) colors.push([0, 0, 0, 0]);
    const s = get();
    if (!s.asset) return;
    const palettes = [...s.asset.colorPalettes, { name: file.name, colors }];
    set({
      asset: { ...s.asset, colorPalettes: palettes },
      activePaletteIndex: palettes.length - 1,
      dirty: true,
    });
  },
```

Update `newAsset` (around line 1204) — add `colorPalettes: [generateDefaultPalette()]` to the new Asset object:

```ts
    set({
      asset: {
        id: newId,
        kind,
        voxels: new Map(),
        gridWidth: size,
        gridDepth: size,
        characterName: charName,
        characterParts: [],
        characterPoses: {},
        animations: {},
        tags: [],
        colorPalettes: [generateDefaultPalette()],
        currentFilename: null,
      },
      // ... rest unchanged
      activePaletteIndex: 0,
      // ... rest unchanged
    });
```

Note: add `activePaletteIndex: 0` to that `set()` call's state reset (alongside `selectedPart: null`, etc.).

Update `openAsset` (around line 927) — the constructed `char: Asset` needs `colorPalettes`, and the `set()` call needs `activePaletteIndex: 0`:

```ts
      const char: Asset = {
        id: data.id,
        kind: data.kind ?? 'character',
        characterName: data.characterName,
        gridWidth: data.gridWidth,
        gridDepth: data.gridDepth,
        voxels: voxelArrayToMap(data.voxels),
        characterParts: parts,
        characterPoses: data.poses,
        animations,
        tags: data.tags ?? [],
        colorPalettes: data.color_palettes ?? [generateDefaultPalette()],
        currentFilename: null,
      };
      set({
        asset: char,
        // ... existing fields
        activePaletteIndex: 0,
        // ... existing fields
      });
```

Update `saveProject` (around line 1289) — include `color_palettes` in the returned `EchidnaFile`:

```ts
    return {
      version: ECHIDNA_FILE_VERSION,
      id,
      kind: char.kind ?? 'character',
      characterName: char.characterName,
      gridWidth: char.gridWidth,
      gridDepth: char.gridDepth,
      voxels: voxelArr,
      parts: char.characterParts,
      poses: char.characterPoses,
      animations: Object.keys(char.animations).length > 0 ? char.animations : undefined,
      tags: char.tags ?? [],
      color_palettes: char.colorPalettes,
    };
```

Update `loadProject` (around line 1316) — construct the Asset with `colorPalettes`:

```ts
    set({
      asset: {
        id: data.id,
        kind: data.kind ?? 'character',
        voxels,
        gridWidth: data.gridWidth,
        gridDepth: data.gridDepth,
        characterName: data.characterName,
        characterParts: parts,
        characterPoses: data.poses,
        animations,
        tags: data.tags ?? [],
        colorPalettes: data.color_palettes ?? [generateDefaultPalette()],
        currentFilename: get().asset?.currentFilename ?? null,
      },
      // ...
      activePaletteIndex: 0,
      // ...
    });
```

(`data.color_palettes` is populated by `migrateEchidnaFile`, so the fallback is defensive only.)

Check every other place that constructs an `Asset` object inline (grep for `currentFilename: null,` within `useCharacterStore.ts`) and add `colorPalettes: [generateDefaultPalette()]` — expect at least `duplicateAsset` and any import-from-vox / import-from-image paths. If an import preserves the source palette, use that instead of the default.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd tools && pnpm --filter @gseurat/echidna test -- characterStore`
Expected: PASS — all palette tests plus all existing characterStore tests.

- [ ] **Step 5: Run the full echidna test suite to catch Asset-shape breakages**

Run: `cd tools && pnpm --filter @gseurat/echidna test`
Expected: PASS — all suites. If any suite constructs an Asset inline without `colorPalettes`, fix the fixture.

- [ ] **Step 6: Commit**

```bash
git add tools/apps/echidna/src/store/useCharacterStore.ts tools/apps/echidna/src/__tests__/characterStore.test.ts
git commit -m "feat(echidna): persist color palettes per-character in the store

Adds activePaletteIndex top-level state plus addPalette, removePalette,
setActivePalette, addColorToPalette, and addPaletteFromFile actions.
newAsset seeds the default 256-slot palette; openAsset/loadProject
read color_palettes via migration; saveProject writes it back."
```

---

## Task 4: Extract `YClipControl`, `YLevelLock`, and `DisplaySettings` to shared controls

**Files:**
- Create: `tools/apps/echidna/src/panels/controls/YClipControl.tsx`
- Create: `tools/apps/echidna/src/panels/controls/YLevelLock.tsx`
- Create: `tools/apps/echidna/src/panels/controls/DisplaySettings.tsx`
- Modify: `tools/apps/echidna/src/panels/BuildPanel.tsx`

This is a behavior-preserving refactor — no tests change. Smoke-check via the existing test suite plus `pnpm build`.

- [ ] **Step 1: Create `YClipControl.tsx`**

Create `tools/apps/echidna/src/panels/controls/YClipControl.tsx`:

```tsx
import React from 'react';
import { useCharacterStore } from '../../store/useCharacterStore.js';

const styles: Record<string, React.CSSProperties> = {
  section: { display: 'flex', flexDirection: 'column', gap: 8 },
  label: { fontSize: 11, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 1 },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
};

export function YClipControl() {
  const yClip = useCharacterStore((s) => s.yClip);
  const setYClip = useCharacterStore((s) => s.setYClip);
  const voxels = useCharacterStore((s) => s.asset?.voxels ?? new Map());

  let maxY = 0;
  for (const [key] of voxels) {
    const parts = key.split(',');
    const y = Number(parts[1]);
    if (y > maxY) maxY = y;
  }

  const enabled = yClip !== null;

  return (
    <div style={styles.section}>
      <span style={styles.label}>Y-Clip</span>
      <label style={{ ...styles.row, fontSize: 13, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setYClip(e.target.checked ? Math.floor(maxY / 2) : null)}
        />
        Enable
      </label>
      {enabled && (
        <div style={styles.row}>
          <input
            type="range"
            min={0}
            max={maxY}
            value={yClip}
            onChange={(e) => setYClip(Number(e.target.value))}
            style={{ flex: 1 }}
          />
          <span style={{ fontSize: 13, color: '#ddd', minWidth: 24 }}>Y:{yClip}</span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `YLevelLock.tsx`**

Create `tools/apps/echidna/src/panels/controls/YLevelLock.tsx`:

```tsx
import React from 'react';
import { NumberInput } from '@gseurat/ui-kit';
import { useCharacterStore } from '../../store/useCharacterStore.js';

const styles: Record<string, React.CSSProperties> = {
  section: { display: 'flex', flexDirection: 'column', gap: 8 },
  label: { fontSize: 11, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 1 },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
};

export function YLevelLock() {
  const yLevelLock = useCharacterStore((s) => s.yLevelLock);
  const setYLevelLock = useCharacterStore((s) => s.setYLevelLock);

  return (
    <div style={styles.section}>
      <span style={styles.label}>Y-Level Lock</span>
      <label style={{ ...styles.row, fontSize: 13, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={yLevelLock !== null}
          onChange={(e) => setYLevelLock(e.target.checked ? 0 : null)}
        />
        Enable
      </label>
      {yLevelLock !== null && (
        <NumberInput value={yLevelLock} onChange={setYLevelLock} min={0} step={1} label="Y" />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create `DisplaySettings.tsx`**

Create `tools/apps/echidna/src/panels/controls/DisplaySettings.tsx`:

```tsx
import React from 'react';
import { useCharacterStore } from '../../store/useCharacterStore.js';

const styles: Record<string, React.CSSProperties> = {
  section: { display: 'flex', flexDirection: 'column', gap: 8 },
  label: { fontSize: 11, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 1 },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
};

export function DisplaySettings() {
  const showGrid = useCharacterStore((s) => s.showGrid);
  const showGizmos = useCharacterStore((s) => s.showGizmos);
  const setShowGrid = useCharacterStore((s) => s.setShowGrid);
  const setShowGizmos = useCharacterStore((s) => s.setShowGizmos);
  const colorByPart = useCharacterStore((s) => s.colorByPart);
  const setColorByPart = useCharacterStore((s) => s.setColorByPart);
  const xrayMode = useCharacterStore((s) => s.xrayMode);
  const setXrayMode = useCharacterStore((s) => s.setXrayMode);

  return (
    <div style={styles.section}>
      <span style={styles.label}>Display</span>
      <label style={{ ...styles.row, fontSize: 13, cursor: 'pointer' }}>
        <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
        Grid
      </label>
      <label style={{ ...styles.row, fontSize: 13, cursor: 'pointer' }}>
        <input type="checkbox" checked={showGizmos} onChange={(e) => setShowGizmos(e.target.checked)} />
        Gizmos
      </label>
      <label style={{ ...styles.row, fontSize: 13, cursor: 'pointer' }}>
        <input type="checkbox" checked={colorByPart} onChange={(e) => setColorByPart(e.target.checked)} />
        Color by Part
      </label>
      <label style={{ ...styles.row, fontSize: 13, cursor: 'pointer' }}>
        <input type="checkbox" checked={xrayMode} onChange={(e) => setXrayMode(e.target.checked)} />
        X-Ray Mode (T)
      </label>
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `BuildPanel.tsx` to compose the shared controls**

Replace the full contents of `tools/apps/echidna/src/panels/BuildPanel.tsx`:

```tsx
import React from 'react';
import { useComponentRegistry } from '@gseurat/ui-kit';
import { useCharacterStore } from '../store/useCharacterStore.js';
import { YClipControl } from './controls/YClipControl.js';
import { YLevelLock } from './controls/YLevelLock.js';
import { DisplaySettings } from './controls/DisplaySettings.js';

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    background: '#1e1e3a',
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    overflowY: 'auto',
  },
  section: { display: 'flex', flexDirection: 'column', gap: 8 },
  label: { fontSize: 11, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 1 },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
  select: {
    flex: 1, padding: '4px 6px', background: '#2a2a4a', border: '1px solid #444',
    borderRadius: 4, color: '#ddd', fontSize: 13,
  },
};

function MirrorControl() {
  const mirrorAxis = useCharacterStore((s) => s.mirrorAxis);
  const setMirrorAxis = useCharacterStore((s) => s.setMirrorAxis);

  return (
    <div style={styles.section}>
      <span style={styles.label}>Mirror</span>
      <div style={styles.row}>
        <select
          style={styles.select}
          value={mirrorAxis ?? 'none'}
          onChange={(e) => {
            const v = e.target.value;
            setMirrorAxis(v === 'none' ? null : (v as 'x' | 'z'));
          }}
        >
          <option value="none">Off</option>
          <option value="x">Mirror X</option>
          <option value="z">Mirror Z</option>
        </select>
      </div>
    </div>
  );
}

export function BuildPanel() {
  useComponentRegistry('BuildPanel');
  return (
    <div style={styles.container}>
      <YClipControl />
      <YLevelLock />
      <MirrorControl />
      <DisplaySettings />
    </div>
  );
}
```

- [ ] **Step 5: Build + run full test suite**

Run: `cd tools && pnpm --filter @gseurat/echidna build && pnpm --filter @gseurat/echidna test`
Expected: PASS — no type errors, no test regressions. `BuildPanel` now composes three shared controls.

- [ ] **Step 6: Commit**

```bash
git add tools/apps/echidna/src/panels/controls/ tools/apps/echidna/src/panels/BuildPanel.tsx
git commit -m "refactor(echidna): extract shared environment controls

YClipControl, YLevelLock, DisplaySettings move to panels/controls/ so
they can be composed by both BuildPanel and the upcoming AnimateRightPanel
extension. BuildPanel behavior is unchanged."
```

---

## Task 5: Rewrite the Build `ToolBar` as icon grids with the full palette UI

**Files:**
- Modify: `tools/apps/echidna/src/panels/ToolBar.tsx`

- [ ] **Step 1: Rewrite the full file**

Replace the full contents of `tools/apps/echidna/src/panels/ToolBar.tsx`:

```tsx
import React from 'react';
import { useComponentRegistry } from '@gseurat/ui-kit';
import { useCharacterStore } from '../store/useCharacterStore.js';
import type { ToolType } from '../store/types.js';

const drawTools: { id: ToolType; label: string; key: string; icon: string }[] = [
  { id: 'place', label: 'Place', key: 'V', icon: '\u25A3' },    // ▣
  { id: 'paint', label: 'Paint', key: 'B', icon: '\u270E' },    // ✎
  { id: 'erase', label: 'Erase', key: 'E', icon: '\u25AB' },    // ▫
  { id: 'fill', label: 'Fill', key: 'G', icon: '\u25A7' },      // ▧
  { id: 'extrude', label: 'Extrude', key: 'X', icon: '\u2B06' },// ⬆
];

const utilTools: { id: ToolType; label: string; key: string; icon: string }[] = [
  { id: 'orbit', label: 'Orbit', key: 'Q', icon: '\u27F2' },        // ⟲
  { id: 'eyedropper', label: 'Eyedrop', key: 'I', icon: '\u25C9' }, // ◉
  { id: 'box_select', label: 'Box Select', key: 'S', icon: '\u25AF' }, // ▯
  { id: 'lasso_select', label: 'Lasso', key: 'L', icon: '\u2312' },   // ⌒
];

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: 180,
    background: '#1e1e3a',
    borderRight: '1px solid #333',
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    overflowY: 'auto',
  },
  section: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 4 },
  label: { fontSize: 11, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 2 },
  toolGrid: { display: 'flex', flexWrap: 'wrap' as const, gap: 4 },
  toolBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 32, height: 32,
    border: '1px solid #444', borderRadius: 4,
    background: '#2a2a4a', color: '#ddd',
    cursor: 'pointer', fontSize: 16, padding: 0,
  },
  toolBtnActive: { background: '#4a4a8a', borderColor: '#77f' },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
  colorGrid: { display: 'grid', gridTemplateColumns: 'repeat(16, 1fr)', gap: 2 },
  colorSwatch: {
    width: '100%', aspectRatio: '1',
    border: '2px solid transparent', borderRadius: 3,
    cursor: 'pointer',
  },
  btn: {
    padding: '4px 10px', border: '1px solid #555', borderRadius: 4,
    background: '#3a3a6a', color: '#ddd', cursor: 'pointer', fontSize: 12,
  },
  select: {
    flex: 1, minWidth: 0,
    padding: '4px 6px', background: '#2a2a4a', border: '1px solid #444',
    borderRadius: 4, color: '#ddd', fontSize: 12,
    overflow: 'hidden', textOverflow: 'ellipsis',
  },
};

export function ToolBar() {
  useComponentRegistry('ToolBar');
  const activeTool = useCharacterStore((s) => s.activeTool);
  const activeColor = useCharacterStore((s) => s.activeColor);
  const brushSize = useCharacterStore((s) => s.brushSize);
  const setTool = useCharacterStore((s) => s.setTool);
  const setActiveColor = useCharacterStore((s) => s.setActiveColor);
  const setBrushSize = useCharacterStore((s) => s.setBrushSize);

  const colorPalettes = useCharacterStore((s) => s.asset?.colorPalettes ?? []);
  const activePaletteIndex = useCharacterStore((s) => s.activePaletteIndex);
  const setActivePalette = useCharacterStore((s) => s.setActivePalette);
  const addPalette = useCharacterStore((s) => s.addPalette);
  const addColorToPalette = useCharacterStore((s) => s.addColorToPalette);
  const addPaletteFromFile = useCharacterStore((s) => s.addPaletteFromFile);

  const hexColor = `#${activeColor.slice(0, 3).map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  const activePalette = colorPalettes[activePaletteIndex] ?? colorPalettes[0];

  return (
    <div style={styles.container}>
      {/* Draw */}
      <div style={styles.section}>
        <span style={styles.label}>Draw</span>
        <div style={styles.toolGrid}>
          {drawTools.map((t) => (
            <button
              key={t.id}
              title={`${t.label} (${t.key})`}
              style={{ ...styles.toolBtn, ...(activeTool === t.id ? styles.toolBtnActive : {}) }}
              onClick={() => setTool(t.id)}
            >
              {t.icon}
            </button>
          ))}
        </div>
        <div style={{ ...styles.row, marginTop: 4 }}>
          <input
            type="range"
            min={1}
            max={8}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            style={{ flex: 1 }}
          />
          <span style={{ fontSize: 11, color: '#888', minWidth: 14 }}>{brushSize}</span>
        </div>
      </div>

      {/* Utility */}
      <div style={styles.section}>
        <span style={styles.label}>Utility</span>
        <div style={styles.toolGrid}>
          {utilTools.map((t) => (
            <button
              key={t.id}
              title={`${t.label} (${t.key})`}
              style={{ ...styles.toolBtn, ...(activeTool === t.id ? styles.toolBtnActive : {}) }}
              onClick={() => setTool(t.id)}
            >
              {t.icon}
            </button>
          ))}
        </div>
      </div>

      {/* Color */}
      <div style={styles.section}>
        <span style={styles.label}>Color</span>
        <div style={styles.row}>
          <input
            type="color"
            value={hexColor}
            onChange={(e) => {
              const hex = e.target.value;
              const r = parseInt(hex.slice(1, 3), 16);
              const g = parseInt(hex.slice(3, 5), 16);
              const b = parseInt(hex.slice(5, 7), 16);
              setActiveColor([r, g, b, activeColor[3]]);
            }}
            style={{ width: 30, height: 24, border: 'none', cursor: 'pointer' }}
          />
          <div
            style={{
              width: 24, height: 24, borderRadius: 3,
              background: `rgba(${activeColor.join(',')})`,
              border: '1px solid #666',
            }}
          />
          <button
            style={{ ...styles.btn, fontSize: 11, padding: '2px 6px' }}
            onClick={() => addColorToPalette(activePaletteIndex, [...activeColor] as [number, number, number, number])}
          >
            + Palette
          </button>
        </div>

        <div style={styles.row}>
          <select
            value={activePaletteIndex}
            onChange={(e) => setActivePalette(Number(e.target.value))}
            style={styles.select}
          >
            {colorPalettes.map((p, i) => (
              <option key={i} value={i}>{p.name}</option>
            ))}
          </select>
          <button
            style={{ ...styles.btn, fontSize: 11, padding: '2px 6px' }}
            onClick={() => addPalette(`Palette ${colorPalettes.length + 1}`)}
          >
            New
          </button>
          <button
            style={{ ...styles.btn, fontSize: 11, padding: '2px 6px' }}
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = 'image/*';
              input.onchange = async () => {
                const file = input.files?.[0];
                if (!file) return;
                await addPaletteFromFile(file);
              };
              input.click();
            }}
          >
            From Image
          </button>
        </div>

        <div style={styles.colorGrid}>
          {(activePalette?.colors ?? []).map((c, i) => {
            const isEmpty = c[3] === 0;
            const isSelected = !isEmpty &&
              c[0] === activeColor[0] && c[1] === activeColor[1] && c[2] === activeColor[2];
            return (
              <div
                key={i}
                style={{
                  ...styles.colorSwatch,
                  background: isEmpty ? '#1a1a2e' : `rgba(${c.join(',')})`,
                  borderColor: isSelected ? '#fff' : 'transparent',
                }}
                onClick={() => { if (!isEmpty) setActiveColor(c); }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build the app**

Run: `cd tools && pnpm --filter @gseurat/echidna build`
Expected: PASS — no TypeScript errors.

- [ ] **Step 3: Smoke-check via dev server + Chrome MCP**

Start dev server if not running: `cd tools && pnpm --filter @gseurat/echidna dev`. Open `http://localhost:5179` in Chrome, open or create a character asset, verify:

- Build ToolBar renders icon grid (Draw: 5 icons, Utility: 4 icons).
- Brush size slider updates.
- Color picker + `+ Palette` + palette dropdown + `New` + `From Image` work.
- 16-column 256-slot grid renders with default palette.
- Component registry health: in Chrome DevTools console run `JSON.stringify(window.__COMPONENT_REGISTRY__.health())`. Expected: no missing components.
- Console has no React errors.

- [ ] **Step 4: Commit**

```bash
git add tools/apps/echidna/src/panels/ToolBar.tsx
git commit -m "feat(echidna): compact Build ToolBar with 256-slot palette UI

Icon-grid Draw and Utility sections match Bricklayer's TerrainLeftPanel
density. Color section adds a full 16-column palette grid, palette
dropdown, New palette, and From Image extraction — all persisted
per-character via the store's colorPalettes field."
```

---

## Task 6: Add shared environment controls to `AnimateRightPanel`

**Files:**
- Modify: `tools/apps/echidna/src/panels/AnimateRightPanel.tsx`

- [ ] **Step 1: Add a new environment section at the top**

Modify `tools/apps/echidna/src/panels/AnimateRightPanel.tsx`. Add imports:

```tsx
import { YClipControl } from './controls/YClipControl.js';
import { YLevelLock } from './controls/YLevelLock.js';
import { DisplaySettings } from './controls/DisplaySettings.js';
```

Update the exported `AnimateRightPanel` component (around line 275):

```tsx
export function AnimateRightPanel() {
  useComponentRegistry('AnimateRightPanel');
  return (
    <div style={styles.container}>
      <YClipControl />
      <YLevelLock />
      <DisplaySettings />
      <BoneProperties />
      <KeyframeEditor />
    </div>
  );
}
```

- [ ] **Step 2: Build the app**

Run: `cd tools && pnpm --filter @gseurat/echidna build`
Expected: PASS — no TypeScript errors.

- [ ] **Step 3: Smoke-check via Chrome MCP**

In a running dev server, switch to a character asset's Animate tab. Verify:

- Right panel now shows Y-Clip, Y-Level Lock, and Display sections above Bone properties.
- Toggling "Grid" in Animate mode affects the viewport identically to Build mode.
- Toggling "X-Ray Mode" works in Animate mode (same state key `xrayMode`).
- Component registry health check returns no missing components.
- Console has no React errors.

- [ ] **Step 4: Commit**

```bash
git add tools/apps/echidna/src/panels/AnimateRightPanel.tsx
git commit -m "feat(echidna): add environment controls to Animate right panel

Y-Clip, Y-Level Lock, Display (Grid/Gizmos/Color by Part/X-Ray) now
appear above Bone properties in Animate mode, sharing implementation
with BuildPanel via panels/controls/."
```

---

## Task 7: Rewrite `AnimateToolBar` — icon grid Tools, remove Target Bone, compact Selection

**Files:**
- Modify: `tools/apps/echidna/src/panels/AnimateToolBar.tsx`
- Modify: `tools/apps/echidna/src/__tests__/animateToolBar.test.ts`

- [ ] **Step 1: Inspect the existing test file to understand test structure**

Read `tools/apps/echidna/src/__tests__/animateToolBar.test.ts` to see how the component is currently tested. If there are assertions about the Target Bone `<select>`, they need updating or removing. If tests are store-level only, they probably still pass.

- [ ] **Step 2: Update any tests that depend on the Target Bone dropdown**

If a test queries for the target-bone `<select>`, replace or remove it. Any test that verifies `selectedPart` changes via the dropdown should be re-pointed to the `AnimateLeftPanel`'s `BoneTree` (or removed if redundant — the store-level action test already covers that).

- [ ] **Step 3: Rewrite the full `AnimateToolBar.tsx`**

Replace the full contents of `tools/apps/echidna/src/panels/AnimateToolBar.tsx`:

```tsx
import React, { useMemo } from 'react';
import { useComponentRegistry } from '@gseurat/ui-kit';
import { useCharacterStore } from '../store/useCharacterStore.js';
import type { ToolType, VoxelKey } from '../store/types.js';

const tools: { id: ToolType; label: string; key: string; icon: string }[] = [
  { id: 'orbit',        label: 'Orbit',       key: 'Q', icon: '\u27F2' }, // ⟲
  { id: 'assign_part',  label: 'Assign Part', key: 'A', icon: '\u2295' }, // ⊕
  { id: 'box_select',   label: 'Box Select',  key: 'S', icon: '\u25AF' }, // ▯
  { id: 'lasso_select', label: 'Lasso',       key: 'L', icon: '\u2312' }, // ⌒
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
  label: { fontSize: 11, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 2 },
  toolGrid: { display: 'flex', flexWrap: 'wrap' as const, gap: 4 },
  toolBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 32, height: 32,
    border: '1px solid #444', borderRadius: 4,
    background: '#2a2a4a', color: '#ddd',
    cursor: 'pointer', fontSize: 16, padding: 0,
  },
  toolBtnActive: { background: '#4a4a8a', borderColor: '#77f' },
  count: { fontSize: 11, color: '#aaa', padding: '2px 0' },
  selectionRow: { display: 'flex', gap: 4 },
  actionBtn: {
    flex: 1,
    padding: '4px 8px',
    borderWidth: 1, borderStyle: 'solid' as const, borderColor: '#555',
    borderRadius: 4, background: '#3a3a6a', color: '#ddd',
    cursor: 'pointer', fontSize: 11, textAlign: 'center' as const,
  },
  actionBtnPrimary: { background: '#4a4a8a', borderColor: '#77f', color: '#fff' },
  actionBtnDisabled: { opacity: 0.4, cursor: 'not-allowed' },
};

export function AnimateToolBar() {
  useComponentRegistry('AnimateToolBar');
  const activeTool = useCharacterStore((s) => s.activeTool);
  const setTool = useCharacterStore((s) => s.setTool);
  const selectedPart = useCharacterStore((s) => s.selectedPart);
  const boxSelection = useCharacterStore((s) => s.boxSelection);
  const lassoSelection = useCharacterStore((s) => s.lassoSelection);
  const assignVoxelsToPart = useCharacterStore((s) => s.assignVoxelsToPart);
  const unassignVoxelsFromPart = useCharacterStore((s) => s.unassignVoxelsFromPart);
  const setBoxSelection = useCharacterStore((s) => s.setBoxSelection);
  const setLassoSelection = useCharacterStore((s) => s.setLassoSelection);
  const pushUndo = useCharacterStore((s) => s.pushUndo);

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
        <div style={styles.toolGrid}>
          {tools.map((t) => (
            <button
              key={t.id}
              title={`${t.label} (${t.key})`}
              style={{ ...styles.toolBtn, ...(activeTool === t.id ? styles.toolBtnActive : {}) }}
              onClick={() => setTool(t.id)}
            >
              {t.icon}
            </button>
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Selection</span>
        <div style={styles.count}>
          {selectionCount === 0 ? 'No selection' : `${selectionCount} voxels`}
        </div>
        <div style={styles.selectionRow}>
          <button
            title="Assign selection to selected bone"
            style={{
              ...styles.actionBtn,
              ...styles.actionBtnPrimary,
              ...(!canCommit ? styles.actionBtnDisabled : {}),
            }}
            onClick={handleAssign}
            disabled={!canCommit}
          >
            Assign
          </button>
          <button
            title="Unassign selection from selected bone"
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
            title="Clear selection"
            style={{
              ...styles.actionBtn,
              ...(!canClear ? styles.actionBtnDisabled : {}),
            }}
            onClick={clearSelection}
            disabled={!canClear}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
```

Note: `selectedPart`, `setSelectedPart`, and the `parts` list are no longer consumed by `AnimateToolBar` — bone selection happens via the `BoneTree` in `AnimateLeftPanel`. The `selectedPart` still drives `canCommit`, but the `<select>` UI is gone.

- [ ] **Step 4: Run the echidna test suite**

Run: `cd tools && pnpm --filter @gseurat/echidna test`
Expected: PASS — all suites.

- [ ] **Step 5: Build**

Run: `cd tools && pnpm --filter @gseurat/echidna build`
Expected: PASS — no type errors.

- [ ] **Step 6: Smoke-check via Chrome MCP**

In a running dev server on a character asset, switch to Animate mode. Verify:

- Tools section is an icon grid (4 icons: Orbit, Assign Part, Box Select, Lasso).
- No Target Bone dropdown appears.
- Clicking a bone in the left tree sets the selected bone; Assign/Unassign buttons enable when both a bone is selected and a voxel selection exists.
- Selection row: three short-labeled buttons (Assign / Unassign / Clear) + a count line above.
- Component registry health check returns no missing components.
- Console has no React errors.

- [ ] **Step 7: Commit**

```bash
git add tools/apps/echidna/src/panels/AnimateToolBar.tsx tools/apps/echidna/src/__tests__/animateToolBar.test.ts
git commit -m "feat(echidna): compact Animate ToolBar, remove Target Bone dropdown

Tools section is now an icon grid. Target Bone select is removed — bone
selection comes from the AnimateLeftPanel tree. Selection actions
(Assign/Unassign/Clear) sit in a compact labeled row below a count line."
```

---

## Final verification

- [ ] **Step 1: Run the full Echidna test suite**

Run: `cd tools && pnpm --filter @gseurat/echidna test`
Expected: PASS — all suites (store, file, color extraction, any updated component tests).

- [ ] **Step 2: Full monorepo build**

Run: `cd tools && pnpm build`
Expected: PASS — no TypeScript errors in any workspace.

- [ ] **Step 3: Chrome MCP final sweep**

Start/resume dev server. In the Echidna UI:

- Load an existing v4 `.echidna` project; verify it migrates cleanly (console shows the legacy-migration warning) and the default palette is present.
- Save the project; close; reopen; verify v5 file round-trips including palettes.
- In Build mode: place, paint, fill, extrude, eyedrop, box/lasso select, mirror, Y-clip, Y-level-lock, display toggles all still work.
- In Animate mode: orbit, assign part, box/lasso select all still work. Clicking a bone in the tree selects it. Assign/Unassign/Clear behave identically to before. Y-Clip, Y-Level Lock, Display controls on the right panel affect the viewport.
- Run `JSON.stringify(window.__COMPONENT_REGISTRY__.health())` — no missing components.
- Browser console — no React errors.

- [ ] **Step 4: Cross-reference with `CLAUDE.md` UI checklist**

Tick the React (Echidna) UI checklist items from `CLAUDE.md`:
1. New components (`YClipControl`, `YLevelLock`, `DisplaySettings`) are imported in their parents (`BuildPanel`, `AnimateRightPanel`). ✓
2. They are rendered in JSX. ✓
3. `expected-components.json` — unchanged (sub-controls follow the existing non-registered convention, matching old `YClipControl`/`YLevelLock`/`GridSettings` in `BuildPanel.tsx`).
4. Build succeeds. ✓
5. Component registry health check — no missing components.
6. Browser console — no React errors.
7. Scenario runner — no Echidna-only role registered; no-op unless one is added.

- [ ] **Step 5: Done**

No additional commit — each task committed as it completed. Offer a PR via `superpowers:finishing-a-development-branch`.
