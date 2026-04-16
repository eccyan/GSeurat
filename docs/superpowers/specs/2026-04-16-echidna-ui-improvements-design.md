# Echidna UI Improvements — Design

Date: 2026-04-16
Branch: `feat/echidna-ui-improvements`

## Goals

1. Make the **Build tab** tool layout compact — mirror Bricklayer's `TerrainLeftPanel` icon-grid density — and replace the 12-color hardcoded preset with a full 256-slot multi-palette system, persisted per character.
2. Make the **Animate tab** tool layout compact with the same style.
3. Remove the redundant **Target Bone** dropdown from the Animate toolbar; bone selection happens via the tree in `AnimateLeftPanel`.
4. Add environment display controls (**Y-Clip**, **Y-Level Lock**, **Display** (Grid/Gizmos), **Color by Part**, **X-Ray Mode**) to the Animate right panel, matching what the Build right panel exposes.

## Non-goals

- Sharing `colorExtract` / `ColorPalette` type with Bricklayer via a shared package. Duplicate for now; extract later if a third consumer appears.
- Palette editing beyond what Bricklayer offers today (no rename-in-place, no reorder, no per-slot delete).
- Adding a Mirror control to the Animate mode. Mirror applies to voxel placement, which is a Build-mode action.

## Architecture

### Shared environment controls

New folder: `tools/apps/echidna/src/panels/controls/`

- `YClipControl.tsx` — Y-clip enable checkbox + slider (ported from `BuildPanel.tsx`).
- `YLevelLock.tsx` — Y-level lock checkbox + numeric input (ported from `BuildPanel.tsx`).
- `DisplaySettings.tsx` — single `DISPLAY` section containing Grid, Gizmos, Color by Part, X-Ray checkboxes (ported from `BuildPanel.tsx`'s `GridSettings`).

`BuildPanel.tsx` composes: `YClipControl` + `YLevelLock` + inline `MirrorControl` + `DisplaySettings`.
`AnimateRightPanel.tsx` composes: `YClipControl` + `YLevelLock` + `DisplaySettings` + existing `BoneProperties` + existing `KeyframeEditor`. Environment controls sit above the bone/keyframe sections.

Mirror stays inline in `BuildPanel.tsx` — single consumer, no reuse benefit.

The three new components use `useCharacterStore` directly (no prop drilling). They do not register themselves with `useComponentRegistry` — they are leaf subsections, matching the existing convention in `BuildPanel.tsx` where `YClipControl`, `YLevelLock`, `MirrorControl`, `GridSettings` are unregistered internal components.

### Palette system — per-character, persisted

**Type changes** (`tools/apps/echidna/src/store/types.ts`):

```ts
export interface ColorPalette {
  name: string;
  colors: [number, number, number, number][];
}

export interface Asset {
  // ... existing fields
  colorPalettes: ColorPalette[];
}

export const ECHIDNA_FILE_VERSION = 5 as const;

export interface EchidnaFile {
  // ... existing fields
  color_palettes?: ColorPalette[];
}
```

Migration (`migrateEchidnaFile`): when a pre-v5 file is loaded with no `color_palettes`, seed with `[generateDefaultPalette()]` where `generateDefaultPalette()` matches Bricklayer's implementation (16 grayscale + 12 hues × 4 saturations × 5 lightness = 256 slots).

**Store changes** (`tools/apps/echidna/src/store/useCharacterStore.ts`):

- `activePaletteIndex: number` — stored in the app-level store (not per-asset). Resets to 0 on asset switch via `openAsset` / `newAsset`.
- New actions (all `pushUndo()` where they mutate):
  - `addPalette(name: string)` — append empty 256-slot palette, set active.
  - `removePalette(index: number)` — remove (never removes the last one).
  - `setActivePalette(index: number)` — no undo (UI state).
  - `addColorToPalette(paletteIndex: number, color: RGBA)` — fill first empty slot.
  - `addPaletteFromImage(file: File)` — use `extractColorsFromFile` from lib, pad to 256 with `[0,0,0,0]`, append, set active.
- Serialization: `save()` writes `color_palettes` from current asset; `openAsset()` reads it via migration.

**Color extraction lib** — new `tools/apps/echidna/src/lib/colorExtract.ts`: copy verbatim from `tools/apps/bricklayer/src/lib/colorExtract.ts`.

### Build ToolBar rewrite (`panels/ToolBar.tsx`)

Layout mirroring Bricklayer's `TerrainLeftPanel`:

- **DRAW** section: icon grid (32×32 buttons, `flexWrap`, 4px gap) — Place ▣, Paint ✎, Erase ▫, Fill ▧, Extrude ⬆. Brush-size range slider (`type="range"`) with inline count display directly below.
- **UTILITY** section: icon grid — Orbit ⟲, Eyedrop ◉, Box Select ▯, Lasso ⌒.
- **COLOR** section:
  - Row: current color swatch (24×24) + native `<input type="color">` + `+ Palette` button (adds active color to active palette's first empty slot).
  - Row: palette `<select>` dropdown + `New` button + `From Image` button.
  - 16-column color grid (256 slots). Empty slots render `#1a1a2e` (background color); filled slots show the color with 2px selection border if active.

Panel width stays `180` (fits 16-col × small swatches cleanly).

Tool shortcut keys in `App.tsx` (`buildToolKeys`) stay identical; only the visual representation changes.

### Animate ToolBar rewrite (`panels/AnimateToolBar.tsx`)

- **TOOLS** section: icon grid — Orbit ⟲, Assign Part ⊕, Box Select ▯, Lasso ⌒.
- ~~TARGET BONE dropdown~~: removed. `AnimateLeftPanel`'s `BoneTree` already calls `setSelectedPart(part.id)` on click, so the dropdown was redundant.
- **SELECTION** section: compact one-line count (`3 voxels` or `No selection`, fontSize 11, muted) + single flex row with three short-labeled buttons — `Assign`, `Unassign`, `Clear`. Button style: 4px vertical / 8px horizontal padding, fontSize 11, `flex: 1` so they share width evenly. Disabled states (from `canCommit` / `canClear`) preserved.

Existing `assignVoxelsToPart` / `unassignVoxelsFromPart` / `clearSelection` handlers keep their current behavior.

### Animate RightPanel (`panels/AnimateRightPanel.tsx`)

New top section before `BoneProperties`:

```
<YClipControl />
<YLevelLock />
<DisplaySettings />
<BoneProperties />      // existing
<KeyframeEditor />      // existing
```

No changes to `BoneProperties` or `KeyframeEditor`.

## File-level change summary

| File | Change |
|------|--------|
| `tools/apps/echidna/src/store/types.ts` | Add `ColorPalette`; add `colorPalettes` to `Asset`; add `color_palettes` to `EchidnaFile`; bump version to 5; extend migration |
| `tools/apps/echidna/src/store/useCharacterStore.ts` | Add `activePaletteIndex`, palette actions, serialization wiring, `generateDefaultPalette` helper |
| `tools/apps/echidna/src/lib/colorExtract.ts` | NEW (port from Bricklayer) |
| `tools/apps/echidna/src/panels/controls/YClipControl.tsx` | NEW (extracted from `BuildPanel.tsx`) |
| `tools/apps/echidna/src/panels/controls/YLevelLock.tsx` | NEW (extracted from `BuildPanel.tsx`) |
| `tools/apps/echidna/src/panels/controls/DisplaySettings.tsx` | NEW (extracted from `BuildPanel.tsx`'s `GridSettings`) |
| `tools/apps/echidna/src/panels/ToolBar.tsx` | Rewrite: icon grids + full palette UI |
| `tools/apps/echidna/src/panels/BuildPanel.tsx` | Compose shared controls + inline `MirrorControl` |
| `tools/apps/echidna/src/panels/AnimateToolBar.tsx` | Icon grid Tools + remove Target Bone + compact Selection row |
| `tools/apps/echidna/src/panels/AnimateRightPanel.tsx` | Add shared controls section at top |
| `tools/apps/echidna/src/expected-components.json` | Unchanged (new sub-controls follow existing non-registered convention) |

## Testing

Per `CLAUDE.md`'s React UI checklist:

1. `pnpm build` in `tools/` succeeds.
2. Chrome MCP component-registry health check — no missing components:
   ```js
   JSON.stringify(window.__COMPONENT_REGISTRY__.health())
   ```
3. Browser console shows no React errors.
4. `python3 scripts/scenario_runner.py --list` — run whichever Echidna-relevant role scenarios exist (no Echidna-only role registered at design time, so this step is a no-op unless one is added).

Functional checks:

- Existing v4 `.echidna` file loads; `color_palettes` is seeded via migration; subsequent save writes v5 with the palette; reload round-trips the palette.
- "From Image" in Build mode appends a palette named after the file and activates it.
- Clicking a bone in `AnimateLeftPanel` selects it; Assign/Unassign buttons reflect the selected-part state identically to before (gated by `canCommit = selectionCount > 0 && selectedPart !== null`).
- Y-Clip / Y-Level Lock / Display / Color by Part / X-Ray toggles in Animate mode affect the viewport identically to Build mode (they write the same store keys).
- Build tab layout width remains ~180px; 16-column palette grid fits without horizontal scroll.

## Migration detail

`migrateEchidnaFile` change (pseudo):

```ts
const color_palettes =
  Array.isArray(raw.color_palettes) && raw.color_palettes.length > 0
    ? raw.color_palettes
    : [generateDefaultPalette()];
```

`openAsset` seeds `asset.colorPalettes = file.color_palettes ?? [generateDefaultPalette()]`. `save()` writes `color_palettes: asset.colorPalettes`.

On `newAsset`, start with `[generateDefaultPalette()]`.
