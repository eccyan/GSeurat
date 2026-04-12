# Phase 0.3a — Echidna Schema + Registry Infrastructure

Foundation layer for multi-asset Echidna. No UI changes — schema, registry, store renaming, and export branching only.

## EchidnaFile v4 Schema

### New type

```ts
export type EchidnaAssetKind = 'character' | 'map' | 'object';
```

### EchidnaFile changes (v3 → v4)

- Add `kind: EchidnaAssetKind` field (required)
- Add optional `tags?: string[]` (object-only, for future asset picker filtering)
- `parts`, `poses`, `animations` stay optional (animations already is; make parts/poses optional too)
- Bump `ECHIDNA_FILE_VERSION` to 4

No `collision` field — collision grids are Bricklayer's responsibility (it assembles maps from multiple PLY assets).

### Migration (v3 → v4)

`migrateEchidnaFile` defaults `kind: 'character'` for all legacy files. All existing `.echidna` files are characters.

### In-memory type rename

`Character` → `Asset`:

```ts
export interface Asset {
  id: string;
  kind: EchidnaAssetKind;
  characterName: string;   // semantically "asset name", field name kept for back-compat
  gridWidth: number;
  gridDepth: number;
  voxels: Map<VoxelKey, Voxel>;
  characterParts: BodyPart[];
  characterPoses: Record<string, PoseData>;
  animations: Record<string, AnimationClip>;
  tags: string[];
  currentFilename: string | null;
}
```

`CharacterListEntry` → `AssetListEntry`:

```ts
export interface AssetListEntry {
  id: string;
  kind: EchidnaAssetKind;
  name: string;
  lastModified: number;
}
```

## AssetRegistry + PROJECT_LAYOUT

### AssetRegistry (additive, no version bump)

- Add `objects: Record<string, FileEntry>` field
- Add `registerObject(reg, id, filePath): AssetRegistry` function
- `RefKind` gains `'object'`
- `resolveRef` handles `'object'` kind

### PROJECT_LAYOUT

- Add `assets.objects = 'assets/objects'`
- Add `'objects'` to `ASSET_KINDS` array
- `AssetKind` type automatically includes it

## Echidna Store Refactor

### Renames

| Old | New |
|-----|-----|
| `Character` interface | `Asset` |
| `CharacterListEntry` | `AssetListEntry` |
| `state.character` | `state.asset` |
| `state.knownCharacters` | `state.knownAssets` |
| `newCharacter(gridSize?, name?)` | `newAsset(kind, gridSize?, name?)` |
| `openCharacter(id)` | `openAsset(id)` |
| `listCharacters()` | `listAssets()` |
| `deleteCharacter(id)` | `deleteAsset(id)` |
| `renameCharacter(id, name)` | `renameAsset(id, name)` |
| `duplicateCharacter(id, name)` | `duplicateAsset(id, name)` |
| `requestOpenCharacter` | `requestOpenAsset` |
| `ConfirmSwitch` (unchanged signature) | `ConfirmSwitch` (no rename needed) |
| `CharactersPanel` | `AssetsPanel` |
| `CharactersPanel.test.ts` | `AssetsPanel.test.ts` |

### Export behavior per kind

`save()` branches on `asset.kind` for the engine-file export step:

| Kind | Engine output | Path |
|------|--------------|------|
| `character` | PLY + manifest JSON | `assets/characters/{id}/{id}.ply` + `{id}.manifest.json` |
| `map` | PLY only | `assets/maps/{id}.ply` |
| `object` | PLY only | `assets/objects/{id}.ply` |

The `.echidna` source file save is identical for all kinds — always `tools_data/echidna_saves/{id}.echidna`.

### projectFs.ts

Function names stay generic (`listEchidnaProjects`, `loadEchidnaProject`, etc.). The `kind` field is now in the `.echidna` JSON, so `listAssets()` reads it from each file and populates `AssetListEntry.kind`.

### newAsset(kind, gridSize?, name?)

Creates a fresh asset of the given kind. For `map` and `object` kinds, `characterParts`, `characterPoses`, and `animations` default to empty (same as characters, but semantically unused).

### DEFAULT_ASSET

Replaces `DEFAULT_CHARACTER`. Adds `kind: 'character'`, `tags: []`.

## Testing

### Updated tests

All existing tests in `characterStore.test.ts` and `CharactersPanel.test.ts` update field names (`character` → `asset`, `knownCharacters` → `knownAssets`, etc.).

### New tests

- `migrateEchidnaFile` v3 → v4: input without `kind` → outputs `kind: 'character'`
- `newAsset('map', 32)`: creates asset with `kind: 'map'`, empty parts/poses/animations
- `newAsset('object', 16, 'Crystal')`: creates asset with `kind: 'object'`, id `'crystal'`
- `save()` for `map` kind: writes PLY to `assets/maps/{id}.ply`, no manifest, no `assets/characters/` dir
- `save()` for `object` kind: writes PLY to `assets/objects/{id}.ply`, no manifest
- `registerObject` + `resolveRef('object')` in registry tests

## Scope Boundary

### In scope (0.3a)

- EchidnaFile v4 schema + migration
- AssetRegistry `objects` kind + PROJECT_LAYOUT
- Store rename Character → Asset, all actions
- `newAsset(kind)` with kind parameter
- Export branching by kind (PLY-only for map/object)
- Register map/object in AssetRegistry on save
- Tests

### Out of scope (deferred to 0.3b+)

- UI changes (Assets panel kind filter, kind-aware editor panels, "New" dropdown with kind picker)
- Méliès asset picker refactor
- Collision grid features
- Bricklayer Map Painter changes
