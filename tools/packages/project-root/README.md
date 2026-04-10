# @gseurat/project-root

Shared TypeScript package defining the canonical project layout, asset registry, path validation, FSAPI helpers, and IndexedDB-backed directory handle persistence used by Bricklayer, Méliès, Echidna, and the Bridge server.

This package is the single source of truth for **where files go** under a GSeurat project root. It was introduced in **Phase 0.0** of the toolchain refactor.

## Modules

### `layout.ts` — canonical directory layout

```ts
import { PROJECT_LAYOUT, ASSET_KINDS, isAssetPath, isToolsDataPath } from '@gseurat/project-root';

PROJECT_LAYOUT.assets.characters     // 'assets/characters'
PROJECT_LAYOUT.assets.vfxPresets     // 'assets/vfx/presets'
PROJECT_LAYOUT.assets.scenes         // 'assets/scenes'
PROJECT_LAYOUT.assets.maps           // 'assets/maps'
PROJECT_LAYOUT.toolsData.bricklayer  // 'tools_data/bricklayer'
PROJECT_LAYOUT.toolsData.melies      // 'tools_data/melies_projects'
PROJECT_LAYOUT.toolsData.echidnaSaves // 'tools_data/echidna_saves'

ASSET_KINDS  // ['characters', 'vfx', 'scenes', 'maps', 'textures', 'audio'] as const

isAssetPath('assets/characters/walker/walker.ply')   // true
isAssetPath('assets/../evil/foo')                    // false (segment-aware traversal check)
isToolsDataPath('tools_data/bricklayer/scene.bricklayer') // true
```

### `paths.ts` — asset reference parser & validator

Asset references come in two forms: `#id` (looked up against the registry) or `assets/...` (project-relative path). Both are first-class.

```ts
import { toAssetPath, parseAssetRef, isAssetRef, validateAssetRef } from '@gseurat/project-root';

toAssetPath('characters', 'walker', 'walker.ply')
// → 'assets/characters/walker/walker.ply'

parseAssetRef('#walker')
// → { kind: 'id', id: 'walker' }

parseAssetRef('assets/characters/walker/walker.manifest.json')
// → { kind: 'path', path: 'assets/characters/walker/walker.manifest.json' }

parseAssetRef('walker.ply')                   // throws: bare filename
parseAssetRef('/Users/foo/walker.ply')        // throws: absolute path
parseAssetRef('assets/')                      // throws: needs at least 2 segments
parseAssetRef('assets/foo/../../etc/passwd')  // throws: traversal

isAssetRef(s)        // boolean wrapper
validateAssetRef(s)  // null if valid, error message if invalid
```

### `registry.ts` — asset registry data model

Bricklayer's `BricklayerFile` v2 stores a top-level `AssetRegistry` indexing assets by stable ID. The registry is **immutable** — `register*` functions return a new registry (Zustand-friendly).

```ts
import {
  createEmptyRegistry,
  registerCharacter, registerVfx, registerTexture, registerAudio, registerMap,
  resolveRef,
  type AssetRegistry, type RefKind,
} from '@gseurat/project-root';

let reg = createEmptyRegistry();
reg = registerCharacter(reg, 'walker', {
  ply: 'assets/characters/walker/walker.ply',
  manifest: 'assets/characters/walker/walker.manifest.json',
});
reg = registerVfx(reg, 'explosion', { file: 'assets/vfx/presets/explosion.vfx.json' });

resolveRef('#walker', 'character', reg)
// → 'assets/characters/walker/walker.manifest.json'  (returns manifest, not PLY)

resolveRef('assets/maps/town.ply', 'map', reg)
// → 'assets/maps/town.ply'  (path refs pass through)

resolveRef('#missing', 'character', reg)
// throws: unknown id "missing" in the character registry
```

### `fs.ts` — FileSystemDirectoryHandle helpers

Thin wrappers over the File System Access API with segment-aware traversal guards. The async functions accept any `FileSystemDirectoryHandle` (real browser FSAPI or an in-memory mock for tests).

```ts
import { ensureSubdir, writeFileAtPath, readFileAtPath, fileExistsAtPath } from '@gseurat/project-root';

const root: FileSystemDirectoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });

await ensureSubdir(root, 'assets/characters/walker');
// recursively creates assets/, assets/characters/, assets/characters/walker/

await writeFileAtPath(root, 'assets/characters/walker/walker.ply', plyBytes);
// accepts string | Uint8Array | Blob
// creates intermediate directories on the fly
// overwrites existing content

const blob = await readFileAtPath(root, 'assets/scenes/town.json');
// strict — throws if any segment is missing

const exists = await fileExistsAtPath(root, 'assets/scenes/town.json');
// boolean — propagates traversal errors instead of returning false
```

### `handle.ts` — IndexedDB-backed directory handle persistence

Each editor (`echidna`, `melies`, `bricklayer`) keeps its picked project root in IndexedDB so it survives page reloads. The browser still requires a permission re-grant on the next session — usually silent if the user previously approved.

```ts
import {
  saveProjectRootHandle,
  loadProjectRootHandle,
  ensureHandlePermission,
  restoreProjectRoot,
  clearProjectRootHandle,
} from '@gseurat/project-root';

// On user "Set Project Root…" action:
const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
await saveProjectRootHandle('echidna', handle);

// On editor bootstrap (App.tsx useEffect):
const restored = await restoreProjectRoot('echidna');
if (restored) {
  // Restored handle has read/write permission. Use directly.
}

// Lower-level if you need finer control:
const stored = await loadProjectRootHandle('echidna');
if (stored && (await ensureHandlePermission(stored))) { /* ... */ }
```

## Canonical project layout (Phase 0.0 contract)

```
{ProjectRoot}/
├── assets/                    # engine-ready files (read by the C++ engine)
│   ├── characters/{id}/{id}.ply  + {id}.manifest.json
│   ├── vfx/presets/{slug}.vfx.json
│   ├── scenes/{slug}.json     # engine scene JSON exported by Bricklayer
│   ├── maps/{slug}.ply        # terrain Gaussian clouds
│   ├── textures/...
│   ├── audio/...
│   └── components/*.schema.json  # editor schema definitions
└── tools_data/                # editor-only state (engine never reads this)
    ├── bricklayer/scene.bricklayer
    ├── melies_projects/{slug}.json
    ├── echidna_saves/{id}.echidna
    └── cache/
```

The engine learns about the project root via the bridge endpoint `POST /api/project/root`, which forwards a `set_project_root` command over the Unix socket. After that, `gseurat::resolve_asset_path` (C++) joins relative scene/PLY paths against the project root before opening files.

## Development

```bash
pnpm --filter @gseurat/project-root test         # 69 tests
pnpm --filter @gseurat/project-root exec tsc --noEmit
pnpm --filter @gseurat/project-root build        # tsc → dist/
```

## Tests

| Module | Test count |
|---|---|
| `layout` | 9 |
| `paths` | 22 |
| `registry` | 18 |
| `fs` | 20 (with in-memory FSAPI mock) |
| `handle` | 0 — browser-runtime only, exercised by editor integration |
| **Total** | **69** |

## Consumers

- **`@gseurat/echidna`** — uses `PROJECT_LAYOUT.toolsData.echidnaSaves`, `toAssetPath('characters', ...)`, `restoreProjectRoot('echidna')` in App bootstrap
- **`@gseurat/melies`** — uses `PROJECT_LAYOUT.toolsData.melies` and `PROJECT_LAYOUT.assets.vfxPresets`
- **`@gseurat/bricklayer`** — embeds `AssetRegistry` in `BricklayerFile`, uses `validateAssetRef`/`resolveRef` in scene export
- **`@gseurat/bridge`** — currently does not import the package directly (it shares the same conceptual layout via the engine's `resolve_asset_path` C++ function), but matches the `assets/scenes`, `assets/textures`, `assets/characters` subdirectories in its asset endpoints

## Why "pure" register functions

The `register*` functions return a new `AssetRegistry` instead of mutating in place because Bricklayer's Zustand store relies on reference identity for re-renders. A mutating API would silently fail to trigger React updates. The cost is one object spread per registration; the benefit is that the API is safe to drop into any immutable state container without ceremony.
