# Phase 0.3b — Echidna Assets Panel UI

UI layer for multi-asset Echidna. Builds on Phase 0.3a's schema + store infrastructure.

## 1. AssetsPanel Kind Filter

Add a kind filter dropdown and kind badges to the existing AssetsPanel.

### Filter dropdown

- Position: top of the list area, below the "Characters" header (rename header to "Assets")
- Options: `All` (default), `Characters`, `Maps`, `Objects`
- State: local component state (`useState`), not persisted to localStorage
- When a filter is active, only assets matching that kind appear in the list
- The `knownAssets` array is filtered client-side — no store changes needed

### Kind badge

- Each row shows a small text badge before the asset name: `CHR`, `MAP`, or `OBJ`
- Badge color: muted, kind-specific (e.g., green for CHR, blue for MAP, orange for OBJ)
- Badge is always visible regardless of filter selection

### No other changes

The "+ New Asset" button, context menu (rename/duplicate/delete), dialogs (switch/rename/duplicate/delete), collapse state, and dirty indicator all stay the same.

## 2. NewProjectDialog Kind Picker

Add a "Kind" dropdown as the **first field** in NewProjectDialog, before "Character Name".

- Options: `Character`, `Map`, `Object` — default: `Character`
- The "Character Name" label changes based on kind: "Character Name" / "Map Name" / "Object Name"
- Dialog title changes: "New Character" / "New Map" / "New Object"
- On Create: calls `newAsset(selectedKind, resolvedSize, charName)`
- Grid size defaults stay the same for all kinds

## 3. Kind-Aware Editor Panels

Restrict the editor based on `asset.kind`:

### Characters (kind = 'character')

Full editor — no changes from current behavior:
- Mode tabs: Build / Animate
- Build mode: left = BuildPanel, right = PartsPanel
- Animate mode: left = AnimateLeftPanel, right = AnimateRightPanel
- Timeline overlay visible in animate mode

### Maps and Objects (kind = 'map' | 'object')

Build-only editor:
- Mode tabs: hidden (or show only "Build" as a static label)
- Build mode: left = BuildPanel, right = empty or minimal info panel
- No PartsPanel, PosePanel, Timeline, or animation panels
- If `mode` is `'animate'` when switching to a non-character asset, reset to `'build'`

### Implementation

- `App.tsx` checks `store.asset?.kind` to decide:
  - Whether to show mode tabs (only for characters)
  - Which panels to render in left/right columns
  - Whether to show the Timeline overlay
- The mode reset happens in `openAsset()` — if the loaded asset is not a character, set `mode: 'build'`
- No new components needed — just conditional rendering in `App.tsx`

## 4. Scope Boundary

### In scope

- AssetsPanel kind filter dropdown + kind badges
- NewProjectDialog kind picker
- Hide animate mode + character-specific panels for map/object assets
- Mode reset on opening non-character asset

### Out of scope (deferred)

- Kind-specific toolsets (different brush sets for maps)
- Tags editing UI for objects
- Méliès asset picker integration (Phase 0.3c)
- Any new panels for map/object-specific features
