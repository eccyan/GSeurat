# Phase 0.3a — Schema + Registry Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-asset support infrastructure to Echidna — EchidnaFile v4 with `kind` discriminator, `objects` kind in AssetRegistry, and store rename from Character → Asset.

**Architecture:** Bottom-up approach: shared package changes first (layout, registry), then Echidna types, then store, then consumers. Each task is independently testable.

**Tech Stack:** TypeScript, Zustand, Vitest, `@gseurat/project-root`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `tools/packages/project-root/src/layout.ts` | Modify | Add `objects` to PROJECT_LAYOUT and ASSET_KINDS |
| `tools/packages/project-root/src/registry.ts` | Modify | Add `objects` field, `registerObject`, update `RefKind`, `resolveRef` |
| `tools/packages/project-root/test/layout.test.ts` | Modify | Test `objects` in ASSET_KINDS |
| `tools/packages/project-root/test/registry.test.ts` | Modify | Test `registerObject` + `resolveRef('object')` |
| `tools/apps/echidna/src/store/types.ts` | Modify | EchidnaFile v4, Asset, AssetListEntry, EchidnaAssetKind, migration |
| `tools/apps/echidna/src/lib/projectFs.ts` | Modify | Export functions for map/object PLY, update list return type |
| `tools/apps/echidna/src/store/useCharacterStore.ts` | Modify | Rename character→asset throughout, newAsset(kind), save() branching |
| `tools/apps/echidna/src/panels/CharactersPanel.tsx` | Rename→Modify | Becomes `AssetsPanel.tsx` |
| `tools/apps/echidna/src/panels/*.tsx` | Modify | Update store selector names (character→asset) |
| `tools/apps/echidna/src/viewport/*.tsx` | Modify | Update store selector names |
| `tools/apps/echidna/src/App.tsx` | Modify | Update store selectors, component imports |
| `tools/apps/echidna/src/__tests__/characterStore.test.ts` | Modify | Rename all character→asset references |
| `tools/apps/echidna/src/__tests__/CharactersPanel.test.ts` | Rename→Modify | Becomes `AssetsPanel.test.ts` |
| `tools/apps/echidna/src/__tests__/projectFs.test.ts` | Modify | Add export tests for map/object kinds |

---

### Task 1: PROJECT_LAYOUT + ASSET_KINDS — add `objects`

**Files:**
- Modify: `tools/packages/project-root/src/layout.ts`
- Test: `tools/packages/project-root/test/layout.test.ts`

- [ ] **Step 1: Write failing test for objects in ASSET_KINDS**

In `tools/packages/project-root/test/layout.test.ts`, add:

```typescript
it('ASSET_KINDS includes objects', () => {
  expect(ASSET_KINDS).toContain('objects');
});

it('PROJECT_LAYOUT.assets.objects is assets/objects', () => {
  expect(PROJECT_LAYOUT.assets.objects).toBe('assets/objects');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tools && pnpm --filter @gseurat/project-root test -- --run --reporter verbose 2>&1 | tail -20`
Expected: FAIL

- [ ] **Step 3: Add objects to layout.ts**

In `tools/packages/project-root/src/layout.ts`, add `objects` to `PROJECT_LAYOUT.assets`:

```typescript
export const PROJECT_LAYOUT = {
  assets: {
    characters: 'assets/characters',
    vfx:        'assets/vfx',
    vfxPresets: 'assets/vfx/presets',
    scenes:     'assets/scenes',
    maps:       'assets/maps',
    textures:   'assets/textures',
    audio:      'assets/audio',
    components: 'assets/components',
    objects:    'assets/objects',
  },
  toolsData: {
    bricklayer:   'tools_data/bricklayer',
    melies:       'tools_data/melies_projects',
    echidnaSaves: 'tools_data/echidna_saves',
    cache:        'tools_data/cache',
  },
} as const;
```

Add `'objects'` to `ASSET_KINDS`:

```typescript
export const ASSET_KINDS = [
  'characters',
  'vfx',
  'scenes',
  'maps',
  'textures',
  'audio',
  'objects',
] as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tools && pnpm --filter @gseurat/project-root test -- --run --reporter verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/packages/project-root/src/layout.ts tools/packages/project-root/test/layout.test.ts
git commit -m "feat(project-root): add objects to PROJECT_LAYOUT and ASSET_KINDS"
```

---

### Task 2: AssetRegistry — add `objects` kind

**Files:**
- Modify: `tools/packages/project-root/src/registry.ts`
- Test: `tools/packages/project-root/test/registry.test.ts`

- [ ] **Step 1: Write failing tests**

In `tools/packages/project-root/test/registry.test.ts`:

Add `registerObject` to the import:
```typescript
import {
  createEmptyRegistry,
  registerCharacter,
  registerVfx,
  registerTexture,
  registerAudio,
  registerMap,
  registerObject,
  resolveRef,
  type AssetRegistry,
} from '../src/registry';
```

Add to the `AssetRegistry` describe block:
```typescript
  it('starts empty with objects field', () => {
    const r = createEmptyRegistry();
    expect(Object.keys(r.objects)).toEqual([]);
  });

  it('registers an object', () => {
    let r = createEmptyRegistry();
    r = registerObject(r, 'crystal', { file: 'assets/objects/crystal.ply' });
    expect(r.objects.crystal).toEqual({ id: 'crystal', file: 'assets/objects/crystal.ply' });
  });
```

Add to the `resolveRef` describe block:
```typescript
  it('returns object path by id', () => {
    const r0 = createEmptyRegistry();
    const r = registerObject(r0, 'crystal', { file: 'assets/objects/crystal.ply' });
    expect(resolveRef('#crystal', 'object', r)).toBe('assets/objects/crystal.ply');
  });

  it('throws on unknown object id', () => {
    const r = createEmptyRegistry();
    expect(() => resolveRef('#missing', 'object', r)).toThrow(/unknown id.*object.*registry/i);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tools && pnpm --filter @gseurat/project-root test -- --run --reporter verbose 2>&1 | tail -20`
Expected: FAIL — `registerObject` does not exist yet

- [ ] **Step 3: Add objects to registry.ts**

Add `objects` field to `AssetRegistry`:
```typescript
export interface AssetRegistry {
  version: 1;
  characters: Record<string, CharacterEntry>;
  vfx:        Record<string, FileEntry>;
  textures:   Record<string, FileEntry>;
  audio:      Record<string, FileEntry>;
  maps:       Record<string, FileEntry>;
  objects:    Record<string, FileEntry>;
}
```

Update `createEmptyRegistry`:
```typescript
export function createEmptyRegistry(): AssetRegistry {
  return {
    version: 1,
    characters: {},
    vfx: {},
    textures: {},
    audio: {},
    maps: {},
    objects: {},
  };
}
```

Add `registerObject` function (after `registerMap`):
```typescript
export function registerObject(
  reg: AssetRegistry,
  id: string,
  entry: { file: string },
): AssetRegistry {
  return {
    ...reg,
    objects: {
      ...reg.objects,
      [id]: { id, file: entry.file },
    },
  };
}
```

Update `RefKind`:
```typescript
export type RefKind = 'character' | 'vfx' | 'texture' | 'audio' | 'map' | 'object';
```

Add `object` case to `resolveRef` (before `default`):
```typescript
    case 'object': {
      const e = reg.objects[parsed.id];
      if (!e) throw new Error(`resolveRef: unknown id "${parsed.id}" in the object registry`);
      return e.file;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tools && pnpm --filter @gseurat/project-root test -- --run --reporter verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Run build to ensure no type errors in consumers**

Run: `cd tools && pnpm build 2>&1 | tail -20`

Note: `createEmptyRegistry()` callers (Bricklayer) will now need `objects: {}` in their existing registry literals. The build will flag these. If any consumer constructs an `AssetRegistry` literal directly (not via `createEmptyRegistry()`), it will fail typecheck. Fix those by adding `objects: {}`.

- [ ] **Step 6: Fix any consumer type errors from the new `objects` field**

Search for `AssetRegistry` literals in `tools/apps/bricklayer/` and add `objects: {}` where needed. Also check `tools/apps/melies/` and any test files.

- [ ] **Step 7: Run build again**

Run: `cd tools && pnpm build 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 8: Commit**

```bash
git add tools/packages/project-root/src/registry.ts tools/packages/project-root/test/registry.test.ts
# Also add any consumer files fixed in step 6
git commit -m "feat(project-root): add objects kind to AssetRegistry"
```

---

### Task 3: EchidnaFile v4 schema + migration

**Files:**
- Modify: `tools/apps/echidna/src/store/types.ts`
- Test: `tools/apps/echidna/src/__tests__/characterStore.test.ts`

- [ ] **Step 1: Write failing test for migration**

In `tools/apps/echidna/src/__tests__/characterStore.test.ts`, add at the top level:

```typescript
import { migrateEchidnaFile, ECHIDNA_FILE_VERSION } from '../store/types';

describe('migrateEchidnaFile v3 → v4', () => {
  it('defaults kind to character for legacy v3 files', () => {
    const raw = {
      version: 3,
      id: 'walker',
      characterName: 'Walker',
      gridWidth: 32,
      gridDepth: 32,
      voxels: [],
      parts: [],
      poses: {},
    };
    const result = migrateEchidnaFile(raw);
    expect(result.version).toBe(4);
    expect(result.kind).toBe('character');
  });

  it('preserves kind when already present', () => {
    const raw = {
      version: 4,
      id: 'crystal',
      kind: 'object',
      characterName: 'Crystal',
      gridWidth: 16,
      gridDepth: 16,
      voxels: [],
      parts: [],
      poses: {},
      tags: ['prop'],
    };
    const result = migrateEchidnaFile(raw);
    expect(result.kind).toBe('object');
    expect(result.tags).toEqual(['prop']);
  });

  it('defaults tags to empty array', () => {
    const raw = { version: 3, id: 'test', characterName: 'Test', voxels: [], parts: [], poses: {} };
    const result = migrateEchidnaFile(raw);
    expect(result.tags).toEqual([]);
  });

  it('ECHIDNA_FILE_VERSION is 4', () => {
    expect(ECHIDNA_FILE_VERSION).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tools && pnpm --filter echidna test -- --run --reporter verbose 2>&1 | tail -20`
Expected: FAIL — `kind` not on EchidnaFile, version is still 3

- [ ] **Step 3: Update types.ts**

In `tools/apps/echidna/src/store/types.ts`:

Add `EchidnaAssetKind` type (after AppMode):
```typescript
export type EchidnaAssetKind = 'character' | 'map' | 'object';
```

Bump version:
```typescript
export const ECHIDNA_FILE_VERSION = 4 as const;
```

Update `EchidnaFile`:
```typescript
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
}
```

Update `migrateEchidnaFile`:
```typescript
export function migrateEchidnaFile(raw: any): EchidnaFile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('migrateEchidnaFile: expected an object');
  }
  const id: string = typeof raw.id === 'string' && raw.id.length > 0
    ? raw.id
    : slugifyCharacterId(typeof raw.characterName === 'string' ? raw.characterName : '');

  const kind: EchidnaAssetKind =
    raw.kind === 'character' || raw.kind === 'map' || raw.kind === 'object'
      ? raw.kind
      : 'character';

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
  };
}
```

Rename `Character` → `Asset`:
```typescript
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
  currentFilename: string | null;
}
```

Rename `CharacterListEntry` → `AssetListEntry`:
```typescript
export interface AssetListEntry {
  id: string;
  kind: EchidnaAssetKind;
  name: string;
  lastModified: number;
}
```

Keep old names as type aliases for incremental migration (removed in Task 5):
```typescript
/** @deprecated Use Asset */
export type Character = Asset;
/** @deprecated Use AssetListEntry */
export type CharacterListEntry = AssetListEntry;
```

Rename `slugifyCharacterId` → `slugifyAssetId`:
```typescript
export function slugifyAssetId(name: string): string {
  const cleaned = name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '');
  return cleaned.length > 0 ? cleaned : 'character';
}

/** @deprecated Use slugifyAssetId */
export const slugifyCharacterId = slugifyAssetId;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tools && pnpm --filter echidna test -- --run --reporter verbose 2>&1 | tail -20`
Expected: PASS (deprecated aliases keep existing code compiling)

- [ ] **Step 5: Commit**

```bash
git add tools/apps/echidna/src/store/types.ts tools/apps/echidna/src/__tests__/characterStore.test.ts
git commit -m "feat(echidna): EchidnaFile v4 schema with kind discriminator + Asset type"
```

---

### Task 4: projectFs.ts — export functions for map/object PLY

**Files:**
- Modify: `tools/apps/echidna/src/lib/projectFs.ts`
- Test: `tools/apps/echidna/src/__tests__/projectFs.test.ts`

- [ ] **Step 1: Write failing tests for map/object export**

In `tools/apps/echidna/src/__tests__/projectFs.test.ts`, add:

```typescript
import { exportMapToProject, exportObjectToProject } from '../lib/projectFs';

describe('exportMapToProject', () => {
  it('writes PLY to assets/maps/{id}.ply', async () => {
    const root = testing.makeRoot();
    const ply = new Uint8Array([1, 2, 3]);
    const result = await exportMapToProject(root as unknown as FileSystemDirectoryHandle, 'town', ply);
    expect(result.plyPath).toBe('assets/maps/town.ply');

    // Verify file exists
    const assets = await root.getDirectoryHandle('assets');
    const maps = await assets.getDirectoryHandle('maps');
    const fh = await maps.getFileHandle('town.ply');
    const file = await fh.getFile();
    const buf = new Uint8Array(await file.arrayBuffer());
    expect(buf).toEqual(ply);
  });
});

describe('exportObjectToProject', () => {
  it('writes PLY to assets/objects/{id}.ply', async () => {
    const root = testing.makeRoot();
    const ply = new Uint8Array([4, 5, 6]);
    const result = await exportObjectToProject(root as unknown as FileSystemDirectoryHandle, 'crystal', ply);
    expect(result.plyPath).toBe('assets/objects/crystal.ply');

    const assets = await root.getDirectoryHandle('assets');
    const objects = await assets.getDirectoryHandle('objects');
    const fh = await objects.getFileHandle('crystal.ply');
    const file = await fh.getFile();
    const buf = new Uint8Array(await file.arrayBuffer());
    expect(buf).toEqual(ply);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tools && pnpm --filter echidna test -- --run --reporter verbose 2>&1 | tail -20`
Expected: FAIL — `exportMapToProject` and `exportObjectToProject` don't exist

- [ ] **Step 3: Add export functions to projectFs.ts**

In `tools/apps/echidna/src/lib/projectFs.ts`, update the import to use `AssetListEntry` and `EchidnaAssetKind`:

```typescript
import { migrateEchidnaFile, type EchidnaFile, type AssetListEntry, type EchidnaAssetKind } from '../store/types';
```

Add path builders:
```typescript
export function mapPlyPath(id: string): string {
  return toAssetPath('maps', `${id}.ply`);
}

export function objectPlyPath(id: string): string {
  return toAssetPath('objects', `${id}.ply`);
}
```

Add export functions:
```typescript
export async function exportMapToProject(
  root: FileSystemDirectoryHandle,
  id: string,
  ply: Blob | Uint8Array,
): Promise<{ plyPath: string }> {
  await ensureSubdir(root, PROJECT_LAYOUT.assets.maps);
  const plyPath = mapPlyPath(id);
  await writeFileAtPath(root, plyPath, ply);
  return { plyPath };
}

export async function exportObjectToProject(
  root: FileSystemDirectoryHandle,
  id: string,
  ply: Blob | Uint8Array,
): Promise<{ plyPath: string }> {
  await ensureSubdir(root, PROJECT_LAYOUT.assets.objects);
  const plyPath = objectPlyPath(id);
  await writeFileAtPath(root, plyPath, ply);
  return { plyPath };
}
```

Update `listEchidnaProjects` return type and populate `kind`:
```typescript
export async function listEchidnaProjects(
  handle: FileSystemDirectoryHandle,
): Promise<AssetListEntry[]> {
```

In the entries loop, change the push to include `kind`:
```typescript
      entries.push({
        id: migrated.id,
        kind: migrated.kind,
        name: migrated.characterName,
        lastModified: file.lastModified ?? 0,
      });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tools && pnpm --filter echidna test -- --run --reporter verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/apps/echidna/src/lib/projectFs.ts tools/apps/echidna/src/__tests__/projectFs.test.ts
git commit -m "feat(echidna): add exportMapToProject and exportObjectToProject"
```

---

### Task 5: Store rename — character → asset

This is a large mechanical rename across the Zustand store and all 22 consumer files. The subagent should use search-and-replace.

**Files:**
- Modify: `tools/apps/echidna/src/store/useCharacterStore.ts`
- Modify: `tools/apps/echidna/src/store/types.ts` (remove deprecated aliases)
- Modify: `tools/apps/echidna/src/lib/projectFs.ts` (update import)
- Modify: All panel/viewport/App files (22 files total)
- Rename: `tools/apps/echidna/src/panels/CharactersPanel.tsx` → `tools/apps/echidna/src/panels/AssetsPanel.tsx`
- Rename: `tools/apps/echidna/src/__tests__/CharactersPanel.test.ts` → `tools/apps/echidna/src/__tests__/AssetsPanel.test.ts`
- Modify: `tools/apps/echidna/src/__tests__/characterStore.test.ts`

- [ ] **Step 1: Perform the renames in useCharacterStore.ts**

This is the core file. Apply these renames throughout `tools/apps/echidna/src/store/useCharacterStore.ts`:

| Old | New |
|-----|-----|
| `import { ... Character, CharacterListEntry }` | `import { ... Asset, AssetListEntry }` |
| `import { ... slugifyCharacterId }` | `import { ... slugifyAssetId }` |
| `DEFAULT_CHARACTER` | `DEFAULT_ASSET` |
| `character: Character \| null` | `asset: Asset \| null` |
| `knownCharacters: CharacterListEntry[]` | `knownAssets: AssetListEntry[]` |
| `newCharacter:` | `newAsset:` |
| `openCharacter:` | `openAsset:` |
| `listCharacters:` | `listAssets:` |
| `deleteCharacter:` | `deleteAsset:` |
| `renameCharacter:` | `renameAsset:` |
| `duplicateCharacter:` | `duplicateAsset:` |
| `requestOpenCharacter:` | `requestOpenAsset:` |
| `ensureCharacterId` | `ensureAssetId` |
| `ConfirmSwitch` info field `currentName` | stays `currentName` (no change) |
| All `s.character` / `state.character` | `s.asset` / `state.asset` |
| All `s.knownCharacters` / `state.knownCharacters` | `s.knownAssets` / `state.knownAssets` |
| `slugifyCharacterId(` | `slugifyAssetId(` |

Also update `DEFAULT_ASSET` to include `kind` and `tags`:
```typescript
const DEFAULT_ASSET: Asset = {
  id: '',
  kind: 'character',
  characterName: 'Untitled',
  gridWidth: 32,
  gridDepth: 32,
  voxels: new Map(),
  characterParts: [],
  characterPoses: {},
  animations: {},
  tags: [],
  currentFilename: null,
};
```

Update `CharacterStoreState` interface name to `AssetStoreState` (or keep as-is to reduce blast radius — implementer's judgment call; the important renames are the fields and actions).

- [ ] **Step 2: Update newAsset to accept kind parameter**

Change the signature:
```typescript
  newAsset: (kind: EchidnaAssetKind, gridSize?: number, name?: string) => void;
```

In the implementation, pass `kind` into the created asset:
```typescript
  newAsset: (kind, gridSize?, name?) => {
    const size = gridSize ?? 32;
    const charName = (name && name.trim().length > 0) ? name.trim() : 'Untitled';
    const s = get();

    const MAX_NEW_SUFFIX = 1000;
    const baseId = slugifyAssetId(charName);
    const existingIds = new Set(s.knownAssets.map((c) => c.id));
    let newId = baseId;
    let counter = 2;
    while (existingIds.has(newId)) {
      if (counter > MAX_NEW_SUFFIX) {
        console.error(`[echidna] newAsset: > ${MAX_NEW_SUFFIX} collisions for base id "${baseId}"`);
        return;
      }
      newId = `${baseId}_${counter}`;
      counter += 1;
    }

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
        currentFilename: null,
      },
      knownAssets: [
        ...s.knownAssets,
        { id: newId, kind, name: charName, lastModified: Date.now() },
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

- [ ] **Step 3: Update save() to branch on asset.kind**

In the `save()` method, after the `.echidna` source write succeeds, replace the engine-file export section with kind-branching:

```typescript
      // 2. Build engine-ready files based on asset kind
      try {
        if (s.asset.kind === 'character') {
          const ply = exportPly(
            s.asset.voxels,
            s.asset.gridWidth,
            s.asset.gridDepth,
            s.asset.characterParts,
          );
          const manifest = buildManifest(
            id,
            `${id}.ply`,
            1.0,
            s.asset.characterParts,
            s.asset.characterPoses,
            s.asset.animations,
          );
          await exportCharacterToProject(handle, id, ply, JSON.stringify(manifest, null, 2));
        } else if (s.asset.kind === 'map') {
          const ply = exportPly(
            s.asset.voxels,
            s.asset.gridWidth,
            s.asset.gridDepth,
            s.asset.characterParts,
          );
          await exportMapToProject(handle, id, ply);
        } else if (s.asset.kind === 'object') {
          const ply = exportPly(
            s.asset.voxels,
            s.asset.gridWidth,
            s.asset.gridDepth,
            s.asset.characterParts,
          );
          await exportObjectToProject(handle, id, ply);
        }
      } catch (e) {
        console.error('[echidna] save: partial write — engine files may be stale:', e);
        return false;
      }
```

Add imports for `exportMapToProject` and `exportObjectToProject` from `../lib/projectFs.js`.

- [ ] **Step 4: Update saveProject() to include kind and tags**

In the `saveProject()` method, add `kind` and `tags` to the returned DTO:

```typescript
    return {
      version: ECHIDNA_FILE_VERSION,
      id,
      kind: char.kind,
      characterName: char.characterName,
      gridWidth: char.gridWidth,
      gridDepth: char.gridDepth,
      voxels: voxelArr,
      parts: char.characterParts,
      poses: char.characterPoses,
      animations: Object.keys(char.animations).length > 0 ? char.animations : undefined,
      tags: char.tags,
    };
```

(Note: `char` here is the local variable after the null-throw guard — now renamed from `s.character` to `s.asset`.)

- [ ] **Step 5: Update loadProject() to include kind and tags**

In the `loadProject()` method, add `kind` and `tags` to the `set()` call:

```typescript
    set({
      asset: {
        id: data.id,
        kind: data.kind,
        voxels,
        gridWidth: data.gridWidth,
        gridDepth: data.gridDepth,
        characterName: data.characterName,
        characterParts: parts,
        characterPoses: data.poses,
        animations,
        tags: data.tags,
        currentFilename: null,
      },
      ...
```

- [ ] **Step 6: Remove deprecated aliases from types.ts**

In `tools/apps/echidna/src/store/types.ts`, remove:
```typescript
/** @deprecated Use Asset */
export type Character = Asset;
/** @deprecated Use AssetListEntry */
export type CharacterListEntry = AssetListEntry;
/** @deprecated Use slugifyAssetId */
export const slugifyCharacterId = slugifyAssetId;
```

- [ ] **Step 7: Rename CharactersPanel.tsx → AssetsPanel.tsx**

```bash
git mv tools/apps/echidna/src/panels/CharactersPanel.tsx tools/apps/echidna/src/panels/AssetsPanel.tsx
```

Update all internal references (`knownCharacters` → `knownAssets`, `character` → `asset`, etc.) and update the component export name from `CharactersPanel` to `AssetsPanel`.

- [ ] **Step 8: Rename CharactersPanel.test.ts → AssetsPanel.test.ts**

```bash
git mv tools/apps/echidna/src/__tests__/CharactersPanel.test.ts tools/apps/echidna/src/__tests__/AssetsPanel.test.ts
```

Update all internal references.

- [ ] **Step 9: Update all consumer files**

These files read `s.character` / `s.knownCharacters` from the store and need mechanical updates:

- `tools/apps/echidna/src/App.tsx` — selectors, imports (CharactersPanel→AssetsPanel), callbacks
- `tools/apps/echidna/src/panels/MenuBar.tsx` — selectors, syncCharacterToStaging uses `s.asset`
- `tools/apps/echidna/src/panels/BuildPanel.tsx` — selectors
- `tools/apps/echidna/src/panels/PartsPanel.tsx` — selectors
- `tools/apps/echidna/src/panels/PosePanel.tsx` — selectors
- `tools/apps/echidna/src/panels/Timeline.tsx` — selectors
- `tools/apps/echidna/src/panels/AnimateLeftPanel.tsx` — selectors
- `tools/apps/echidna/src/panels/AnimateRightPanel.tsx` — selectors
- `tools/apps/echidna/src/panels/ExportDialog.tsx` — selectors
- `tools/apps/echidna/src/panels/ResizeGridDialog.tsx` — selectors
- `tools/apps/echidna/src/panels/NewProjectDialog.tsx` — `newCharacter` → `newAsset('character', ...)`
- `tools/apps/echidna/src/panels/EmptyProjectState.tsx` — if it references character
- `tools/apps/echidna/src/viewport/CharacterViewport.tsx` — selectors
- `tools/apps/echidna/src/viewport/VoxelMesh.tsx` — selectors
- `tools/apps/echidna/src/viewport/MirrorPlane.tsx` — selectors
- `tools/apps/echidna/src/viewport/JointGizmos.tsx` — selectors
- `tools/apps/echidna/src/viewport/GroundPlane.tsx` — selectors

The rename is mechanical: `useCharacterStore((s) => s.character` → `useCharacterStore((s) => s.asset`, `s.knownCharacters` → `s.knownAssets`, action names as per the rename table.

- [ ] **Step 10: Update characterStore.test.ts**

Apply the same renames throughout the test file. Every `character:` in `setState` becomes `asset:`, every `s.character?.id` becomes `s.asset?.id`, every `knownCharacters` becomes `knownAssets`, etc.

Also update the `newCharacter` test block to call `newAsset('character', ...)` instead.

- [ ] **Step 11: Add new test cases for map/object asset creation and save**

In `tools/apps/echidna/src/__tests__/characterStore.test.ts`, add:

```typescript
describe('useCharacterStore.newAsset — kind parameter', () => {
  beforeEach(() => {
    useCharacterStore.setState({ knownAssets: [], asset: null, dirty: false });
  });

  it('creates a map asset with no parts or poses', () => {
    useCharacterStore.getState().newAsset('map', 64, 'Town');
    const s = useCharacterStore.getState();
    expect(s.asset?.kind).toBe('map');
    expect(s.asset?.id).toBe('town');
    expect(s.asset?.characterParts).toEqual([]);
    expect(s.asset?.characterPoses).toEqual({});
    expect(s.knownAssets[0].kind).toBe('map');
  });

  it('creates an object asset', () => {
    useCharacterStore.getState().newAsset('object', 16, 'Crystal');
    const s = useCharacterStore.getState();
    expect(s.asset?.kind).toBe('object');
    expect(s.asset?.id).toBe('crystal');
    expect(s.knownAssets[0].kind).toBe('object');
  });
});

describe('useCharacterStore.save — map kind', () => {
  beforeEach(() => {
    useCharacterStore.setState({ _saving: false });
  });

  it('writes PLY to assets/maps/ without manifest', async () => {
    const root = testing.makeRoot();
    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      asset: {
        id: 'town',
        kind: 'map',
        characterName: 'Town',
        gridWidth: 32,
        gridDepth: 32,
        voxels: new Map([['0,0,0', { color: [100, 150, 100, 255] }]]),
        characterParts: [],
        characterPoses: {},
        animations: {},
        tags: [],
        currentFilename: null,
      },
      dirty: true,
    });

    const ok = await useCharacterStore.getState().save();
    expect(ok).toBe(true);
    expect(useCharacterStore.getState().dirty).toBe(false);

    // PLY should exist at assets/maps/town.ply
    const assets = await root.getDirectoryHandle('assets');
    const maps = await assets.getDirectoryHandle('maps');
    await maps.getFileHandle('town.ply');  // throws if missing

    // No manifest or character directory should exist
    let hasCharDir = true;
    try {
      const chars = await assets.getDirectoryHandle('characters');
      await chars.getDirectoryHandle('town');
    } catch {
      hasCharDir = false;
    }
    expect(hasCharDir).toBe(false);
  });
});

describe('useCharacterStore.save — object kind', () => {
  beforeEach(() => {
    useCharacterStore.setState({ _saving: false });
  });

  it('writes PLY to assets/objects/ without manifest', async () => {
    const root = testing.makeRoot();
    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      asset: {
        id: 'crystal',
        kind: 'object',
        characterName: 'Crystal',
        gridWidth: 16,
        gridDepth: 16,
        voxels: new Map([['0,0,0', { color: [200, 200, 255, 255] }]]),
        characterParts: [],
        characterPoses: {},
        animations: {},
        tags: ['prop'],
        currentFilename: null,
      },
      dirty: true,
    });

    const ok = await useCharacterStore.getState().save();
    expect(ok).toBe(true);

    const assets = await root.getDirectoryHandle('assets');
    const objects = await assets.getDirectoryHandle('objects');
    await objects.getFileHandle('crystal.ply');
  });
});
```

- [ ] **Step 12: Run all tests**

Run: `cd tools && pnpm --filter echidna test -- --run --reporter verbose 2>&1 | tail -30`
Expected: all PASS

- [ ] **Step 13: Run build**

Run: `cd tools && pnpm build 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 14: Commit**

```bash
git add -A tools/apps/echidna/
git commit -m "feat(echidna): rename Character → Asset, add kind-based save branching"
```

---

### Task 6: Final build verification

- [ ] **Step 1: Run full project-root tests**

Run: `cd tools && pnpm --filter @gseurat/project-root test -- --run --reporter verbose`
Expected: all PASS

- [ ] **Step 2: Run full echidna tests**

Run: `cd tools && pnpm --filter echidna test -- --run --reporter verbose`
Expected: all PASS

- [ ] **Step 3: Run full build**

Run: `cd tools && pnpm build 2>&1 | tail -20`
Expected: Build succeeds
