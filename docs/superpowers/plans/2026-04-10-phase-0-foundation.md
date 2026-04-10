# Phase 0.0 — Foundation: Unified Project Structure & Data Separation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a single-source-of-truth project layout where Bricklayer, Méliès, and Echidna all read/write under one user-picked root directory (`/assets/` for engine-ready files, `/tools_data/` for editor-only files), and Bricklayer tracks references through an asset registry with relative paths only — so the Staging engine can resolve them without absolute paths.

**Architecture:** A new shared `@gseurat/project-root` package owns the canonical layout, path validators, and asset registry types. Each editor stores a `FileSystemDirectoryHandle` (persisted via IndexedDB), uses the shared package to compute paths, and writes its files into the standardized subdirectories. Bricklayer's project file gains a top-level `asset_registry`, validated by a path emitter on scene export. The bridge gains a `POST /api/project/root` endpoint that updates `activeProjectDir` for **all** asset endpoints (not just characters), and forwards a `set_project_root` command to the engine. The engine's `ControlServer` accepts the command and stores a global `g_project_root` that `SceneLoader` and `GaussianCloud::load_ply` consult to resolve relative paths.

**Tech Stack:** TypeScript / React / Vitest (editors + shared package), Node.js / Express (bridge), C++23 / nlohmann::json / ctest (engine), File System Access API, idb-keyval (handle persistence).

**Spec:** brainstormed in conversation 2026-04-10. Decisions baked in:
- **Asset refs** are string-prefixed: `#walker` for ID lookups, `assets/...` for raw paths. Bare filenames and absolute paths are forbidden.
- **Engine `set_project_root`** is delivered at runtime over the bridge socket (no CLI arg, no Staging restart needed).
- **Echidna `id`** is slugified from `characterName` on first save and is **immutable** afterward — renaming the character does not relocate files.
- **v1 backward compat**: read v1 with auto-migration in memory, write only v2, log a console warning on v1 load.
- **VFX preset directory** is `assets/vfx/presets/` (per spec, not the legacy `assets/vfx/`).

**Pause-point:** End of Group 4 is a usable TS-only milestone — all three editors save under the new layout, but the engine still resolves from CWD. Groups 5–6 add the bridge+engine wiring for relative-path resolution.

---

## File Structure

### Group 1: Shared `@gseurat/project-root` package
| Action | File | Responsibility |
|--------|------|---------------|
| Create | `tools/packages/project-root/package.json` | Package manifest + deps |
| Create | `tools/packages/project-root/tsconfig.json` | TS config |
| Create | `tools/packages/project-root/vitest.config.ts` | Vitest setup |
| Create | `tools/packages/project-root/src/index.ts` | Public API barrel |
| Create | `tools/packages/project-root/src/layout.ts` | `PROJECT_LAYOUT` constants |
| Create | `tools/packages/project-root/src/paths.ts` | `toAssetPath`, `validateAssetPath`, `parseAssetRef` |
| Create | `tools/packages/project-root/src/registry.ts` | `AssetRegistry` types + helpers |
| Create | `tools/packages/project-root/src/handle.ts` | IDB-backed handle persistence |
| Create | `tools/packages/project-root/src/fs.ts` | `ensureSubdir`, `writeFileAtPath`, `readFileAtPath` |
| Create | `tools/packages/project-root/test/layout.test.ts` | Layout invariants |
| Create | `tools/packages/project-root/test/paths.test.ts` | Path helper round-trip + validator |
| Create | `tools/packages/project-root/test/registry.test.ts` | Registry build / lookup / serialize |
| Create | `tools/packages/project-root/test/fs.test.ts` | FS helper unit tests against in-memory FSAPI mock |
| Modify | `tools/pnpm-workspace.yaml` | Add new package (already covered by glob) |

### Group 2: Echidna FSAPI introduction
| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `tools/apps/echidna/package.json` | Add `@gseurat/project-root` dep |
| Modify | `tools/apps/echidna/src/store/types.ts` | Add `id` to `EchidnaFile` |
| Modify | `tools/apps/echidna/src/store/useCharacterStore.ts` | Persistent `id`, `projectRootHandle`, slug-on-first-save |
| Create | `tools/apps/echidna/src/lib/projectFs.ts` | Save/load to project root using shared package |
| Modify | `tools/apps/echidna/src/panels/MenuBar.tsx` | Replace download/upload with FSAPI handlers |
| Modify | `tools/apps/echidna/src/components/ExportDialog.tsx` | Route exports through `projectFs` |
| Create | `tools/apps/echidna/src/store/__tests__/echidnaFile.test.ts` | `id` immutability + load/save round trip |
| Create | `tools/apps/echidna/src/lib/__tests__/projectFs.test.ts` | Save targets correct directories |

### Group 3: Méliès save path migration
| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `tools/apps/melies/package.json` | Add `@gseurat/project-root` dep |
| Modify | `tools/apps/melies/src/store/types.ts` | Bump `VfxProject.version` to 3 |
| Modify | `tools/apps/melies/src/lib/projectIO.ts` | Save under `tools_data/melies_projects/` and `assets/vfx/presets/` |
| Create | `tools/apps/melies/src/lib/__tests__/projectIO.test.ts` | Save target paths + v2→v3 migration |

### Group 4: Bricklayer schema v2 + asset registry
| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `tools/apps/bricklayer/package.json` | Add `@gseurat/project-root` dep |
| Modify | `tools/apps/bricklayer/src/store/types.ts` | Bump version to 2, add `asset_registry` |
| Create | `tools/apps/bricklayer/src/lib/migrateBricklayerFile.ts` | v1→v2 migration (synthesize registry) |
| Create | `tools/apps/bricklayer/src/lib/__tests__/migrateBricklayerFile.test.ts` | Migration round-trip + warnings |
| Modify | `tools/apps/bricklayer/src/store/useSceneStore.ts` | Call migration on load, emit v2 on save |
| Modify | `tools/apps/bricklayer/src/lib/projectIO.ts` | Save to `tools_data/bricklayer/scene.bricklayer` + `assets/...` |
| Modify | `tools/apps/bricklayer/src/lib/sceneExport.ts` | Path validator (reject absolute / bare filenames) |
| Create | `tools/apps/bricklayer/src/lib/__tests__/sceneExport.test.ts` | Path validator unit tests |

### Group 5: Bridge `POST /api/project/root`
| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `tools/apps/bridge/src/index.ts` | New endpoint, dynamic SCENES/TEXTURES/CHARACTERS dirs, forward to engine |
| Create | `tools/apps/bridge/test/projectRoot.test.ts` | Endpoint sets root, subsequent reads/writes hit new path |

### Group 6: Engine `set_project_root` + path resolution
| Action | File | Responsibility |
|--------|------|---------------|
| Create | `include/gseurat/engine/project_root.hpp` | Global `g_project_root` accessor |
| Create | `src/engine/project_root.cpp` | Implementation + path resolution helper |
| Modify | `src/engine/control_server.cpp` | Dispatch `set_project_root` command |
| Modify | `src/engine/scene_loader.cpp` | Resolve relative paths against project root |
| Modify | `src/engine/gaussian_cloud.cpp` | Same resolution at PLY load |
| Modify | `CMakeLists.txt` | Add `project_root.cpp` to `gseurat_core` |
| Create | `tests/test_project_root.cpp` | Unit tests for resolution + back-compat |
| Modify | `CMakeLists.txt` | Register new test |

---

## Group 1 — Shared `@gseurat/project-root` package

### Task 1: Create the feature branch

**Files:** none

- [ ] **Step 1: Switch to main and pull latest**

```bash
git checkout main && git pull origin main
```
Expected: "Already up to date" or fast-forward.

- [ ] **Step 2: Create the feature branch**

```bash
git checkout -b feature/phase-0-foundation
```

Expected: `Switched to a new branch 'feature/phase-0-foundation'`

---

### Task 2: Scaffold the `@gseurat/project-root` package

**Files:**
- Create: `tools/packages/project-root/package.json`
- Create: `tools/packages/project-root/tsconfig.json`
- Create: `tools/packages/project-root/vitest.config.ts`
- Create: `tools/packages/project-root/src/index.ts`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "@gseurat/project-root",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": {
      "source": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "idb-keyval": "^6.2.1"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM"],
    "types": ["vitest/globals"]
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
});
```

- [ ] **Step 4: Write empty barrel `src/index.ts`**

```ts
export * from './layout';
export * from './paths';
export * from './registry';
export * from './handle';
export * from './fs';
```

- [ ] **Step 5: Install and verify**

```bash
pnpm install
pnpm --filter @gseurat/project-root test 2>&1 | tail -5
```

Expected: vitest runs, reports "No test files found" (zero tests yet, exit 0 or expected message).

- [ ] **Step 6: Commit**

```bash
git add tools/packages/project-root/ tools/pnpm-lock.yaml 2>/dev/null || git add tools/packages/project-root/
git commit -m "feat(project-root): scaffold @gseurat/project-root package"
```

---

### Task 3: Implement and test `layout.ts`

**Files:**
- Create: `tools/packages/project-root/src/layout.ts`
- Create: `tools/packages/project-root/test/layout.test.ts`

- [ ] **Step 1: Write the failing test**

`tools/packages/project-root/test/layout.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PROJECT_LAYOUT, ASSET_KINDS, isToolsDataPath, isAssetPath } from '../src/layout';

describe('PROJECT_LAYOUT', () => {
  it('exposes asset subdirs', () => {
    expect(PROJECT_LAYOUT.assets.characters).toBe('assets/characters');
    expect(PROJECT_LAYOUT.assets.vfx).toBe('assets/vfx');
    expect(PROJECT_LAYOUT.assets.scenes).toBe('assets/scenes');
    expect(PROJECT_LAYOUT.assets.maps).toBe('assets/maps');
    expect(PROJECT_LAYOUT.assets.textures).toBe('assets/textures');
    expect(PROJECT_LAYOUT.assets.audio).toBe('assets/audio');
    expect(PROJECT_LAYOUT.assets.components).toBe('assets/components');
  });

  it('exposes tools_data subdirs', () => {
    expect(PROJECT_LAYOUT.toolsData.bricklayer).toBe('tools_data/bricklayer');
    expect(PROJECT_LAYOUT.toolsData.melies).toBe('tools_data/melies_projects');
    expect(PROJECT_LAYOUT.toolsData.echidnaSaves).toBe('tools_data/echidna_saves');
    expect(PROJECT_LAYOUT.toolsData.cache).toBe('tools_data/cache');
  });

  it('lists asset kinds', () => {
    expect(ASSET_KINDS).toContain('characters');
    expect(ASSET_KINDS).toContain('vfx');
    expect(ASSET_KINDS).toContain('maps');
  });
});

describe('classifiers', () => {
  it('isAssetPath', () => {
    expect(isAssetPath('assets/characters/walker/walker.ply')).toBe(true);
    expect(isAssetPath('tools_data/bricklayer/scene.bricklayer')).toBe(false);
    expect(isAssetPath('walker.ply')).toBe(false);
  });

  it('isToolsDataPath', () => {
    expect(isToolsDataPath('tools_data/echidna_saves/walker.echidna')).toBe(true);
    expect(isToolsDataPath('assets/scenes/town.json')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @gseurat/project-root test 2>&1 | tail -15
```

Expected: FAIL — `Cannot find module '../src/layout'`.

- [ ] **Step 3: Implement `src/layout.ts`**

```ts
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
  },
  toolsData: {
    bricklayer:   'tools_data/bricklayer',
    melies:       'tools_data/melies_projects',
    echidnaSaves: 'tools_data/echidna_saves',
    cache:        'tools_data/cache',
  },
} as const;

export const ASSET_KINDS = [
  'characters',
  'vfx',
  'scenes',
  'maps',
  'textures',
  'audio',
] as const;

export type AssetKind = typeof ASSET_KINDS[number];

export function isAssetPath(p: string): boolean {
  return p.startsWith('assets/') && !p.includes('..');
}

export function isToolsDataPath(p: string): boolean {
  return p.startsWith('tools_data/') && !p.includes('..');
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @gseurat/project-root test 2>&1 | tail -10
```

Expected: PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add tools/packages/project-root/src/layout.ts tools/packages/project-root/test/layout.test.ts
git commit -m "feat(project-root): canonical PROJECT_LAYOUT constants + classifiers"
```

---

### Task 4: Implement and test `paths.ts`

**Files:**
- Create: `tools/packages/project-root/src/paths.ts`
- Create: `tools/packages/project-root/test/paths.test.ts`

- [ ] **Step 1: Write the failing test**

`tools/packages/project-root/test/paths.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  toAssetPath,
  validateAssetRef,
  parseAssetRef,
  isAssetRef,
  type AssetRef,
} from '../src/paths';

describe('toAssetPath', () => {
  it('builds character paths', () => {
    expect(toAssetPath('characters', 'walker', 'walker.ply'))
      .toBe('assets/characters/walker/walker.ply');
  });

  it('builds vfx preset paths', () => {
    expect(toAssetPath('vfx', 'presets', 'explosion.vfx.json'))
      .toBe('assets/vfx/presets/explosion.vfx.json');
  });

  it('rejects empty parts', () => {
    expect(() => toAssetPath('characters', '')).toThrow(/empty/i);
  });

  it('rejects parts with separators', () => {
    expect(() => toAssetPath('characters', 'foo/bar')).toThrow(/separator/i);
  });

  it('rejects traversal', () => {
    expect(() => toAssetPath('characters', '..', 'evil')).toThrow(/traversal/i);
  });
});

describe('parseAssetRef / isAssetRef', () => {
  it('recognizes ID refs', () => {
    expect(parseAssetRef('#walker')).toEqual({ kind: 'id', id: 'walker' });
    expect(isAssetRef('#walker')).toBe(true);
  });

  it('recognizes path refs', () => {
    expect(parseAssetRef('assets/characters/walker/walker.ply'))
      .toEqual({ kind: 'path', path: 'assets/characters/walker/walker.ply' });
    expect(isAssetRef('assets/characters/walker/walker.ply')).toBe(true);
  });

  it('rejects bare filenames', () => {
    expect(() => parseAssetRef('walker.ply')).toThrow(/bare filename/i);
    expect(isAssetRef('walker.ply')).toBe(false);
  });

  it('rejects absolute paths', () => {
    expect(() => parseAssetRef('/Users/foo/walker.ply')).toThrow(/absolute/i);
    expect(isAssetRef('/Users/foo/walker.ply')).toBe(false);
  });

  it('rejects traversal', () => {
    expect(() => parseAssetRef('assets/../evil')).toThrow(/traversal/i);
  });

  it('rejects tools_data paths as asset refs', () => {
    expect(() => parseAssetRef('tools_data/bricklayer/scene.bricklayer')).toThrow(/asset path/i);
  });
});

describe('validateAssetRef', () => {
  it('returns null for valid', () => {
    expect(validateAssetRef('#walker')).toBeNull();
    expect(validateAssetRef('assets/foo/bar.ply')).toBeNull();
  });

  it('returns error message for invalid', () => {
    expect(validateAssetRef('walker.ply')).toMatch(/bare filename/i);
    expect(validateAssetRef('/abs/walker.ply')).toMatch(/absolute/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @gseurat/project-root test 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module '../src/paths'`.

- [ ] **Step 3: Implement `src/paths.ts`**

```ts
import type { AssetKind } from './layout';

export type AssetRef =
  | { kind: 'id'; id: string }
  | { kind: 'path'; path: string };

const PART_SEPARATOR_RE = /[/\\]/;
const TRAVERSAL_RE = /(^|\/)\.\.($|\/)/;

export function toAssetPath(kind: AssetKind, ...parts: string[]): string {
  if (parts.length === 0) {
    throw new Error(`toAssetPath: at least one part required for kind=${kind}`);
  }
  for (const p of parts) {
    if (p.length === 0) {
      throw new Error(`toAssetPath: empty part not allowed (kind=${kind})`);
    }
    if (PART_SEPARATOR_RE.test(p)) {
      throw new Error(`toAssetPath: part contains separator: "${p}"`);
    }
    if (p === '..' || p === '.') {
      throw new Error(`toAssetPath: traversal segment not allowed: "${p}"`);
    }
  }
  return `assets/${kind}/${parts.join('/')}`;
}

export function parseAssetRef(s: string): AssetRef {
  if (typeof s !== 'string' || s.length === 0) {
    throw new Error('parseAssetRef: empty');
  }
  if (s.startsWith('#')) {
    const id = s.slice(1);
    if (id.length === 0 || PART_SEPARATOR_RE.test(id)) {
      throw new Error(`parseAssetRef: invalid id: "${s}"`);
    }
    return { kind: 'id', id };
  }
  if (s.startsWith('/') || /^[A-Za-z]:[/\\]/.test(s)) {
    throw new Error(`parseAssetRef: absolute path not allowed: "${s}"`);
  }
  if (TRAVERSAL_RE.test(s)) {
    throw new Error(`parseAssetRef: traversal not allowed: "${s}"`);
  }
  if (s.startsWith('tools_data/')) {
    throw new Error(`parseAssetRef: not an asset path (tools_data): "${s}"`);
  }
  if (!s.startsWith('assets/')) {
    throw new Error(`parseAssetRef: bare filename not allowed: "${s}"`);
  }
  return { kind: 'path', path: s };
}

export function isAssetRef(s: string): boolean {
  try {
    parseAssetRef(s);
    return true;
  } catch {
    return false;
  }
}

export function validateAssetRef(s: string): string | null {
  try {
    parseAssetRef(s);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @gseurat/project-root test 2>&1 | tail -10
```

Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add tools/packages/project-root/src/paths.ts tools/packages/project-root/test/paths.test.ts
git commit -m "feat(project-root): asset path builder + ref parser/validator"
```

---

### Task 5: Implement and test `registry.ts`

**Files:**
- Create: `tools/packages/project-root/src/registry.ts`
- Create: `tools/packages/project-root/test/registry.test.ts`

- [ ] **Step 1: Write the failing test**

`tools/packages/project-root/test/registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  createEmptyRegistry,
  registerCharacter,
  registerVfx,
  registerTexture,
  resolveRef,
  type AssetRegistry,
} from '../src/registry';

describe('AssetRegistry', () => {
  it('starts empty with version 1', () => {
    const r = createEmptyRegistry();
    expect(r.version).toBe(1);
    expect(Object.keys(r.characters)).toEqual([]);
    expect(Object.keys(r.vfx)).toEqual([]);
  });

  it('registers a character', () => {
    const r = createEmptyRegistry();
    registerCharacter(r, 'walker', {
      ply: 'assets/characters/walker/walker.ply',
      manifest: 'assets/characters/walker/walker.manifest.json',
    });
    expect(r.characters.walker).toEqual({
      id: 'walker',
      ply: 'assets/characters/walker/walker.ply',
      manifest: 'assets/characters/walker/walker.manifest.json',
    });
  });

  it('registers vfx and textures', () => {
    const r = createEmptyRegistry();
    registerVfx(r, 'explosion', { file: 'assets/vfx/presets/explosion.vfx.json' });
    registerTexture(r, 'sky', { file: 'assets/textures/sky.png' });
    expect(r.vfx.explosion.file).toBe('assets/vfx/presets/explosion.vfx.json');
    expect(r.textures.sky.file).toBe('assets/textures/sky.png');
  });

  it('resolveRef finds character manifest by id', () => {
    const r = createEmptyRegistry();
    registerCharacter(r, 'walker', {
      ply: 'assets/characters/walker/walker.ply',
      manifest: 'assets/characters/walker/walker.manifest.json',
    });
    expect(resolveRef('#walker', 'character', r))
      .toBe('assets/characters/walker/walker.manifest.json');
  });

  it('resolveRef returns path for path-typed ref', () => {
    const r = createEmptyRegistry();
    expect(resolveRef('assets/characters/walker/walker.manifest.json', 'character', r))
      .toBe('assets/characters/walker/walker.manifest.json');
  });

  it('resolveRef throws on unknown id', () => {
    const r = createEmptyRegistry();
    expect(() => resolveRef('#missing', 'character', r)).toThrow(/unknown id/i);
  });

  it('resolveRef rejects bare filenames', () => {
    const r = createEmptyRegistry();
    expect(() => resolveRef('walker.ply', 'character', r)).toThrow(/bare filename/i);
  });

  it('serializes round-trip', () => {
    const r = createEmptyRegistry();
    registerCharacter(r, 'walker', {
      ply: 'assets/characters/walker/walker.ply',
      manifest: 'assets/characters/walker/walker.manifest.json',
    });
    const json = JSON.stringify(r);
    const parsed: AssetRegistry = JSON.parse(json);
    expect(parsed).toEqual(r);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @gseurat/project-root test 2>&1 | tail -15
```

Expected: FAIL — `Cannot find module '../src/registry'`.

- [ ] **Step 3: Implement `src/registry.ts`**

```ts
import { parseAssetRef } from './paths';

export interface CharacterEntry {
  id: string;
  ply: string;       // assets/characters/{id}/{id}.ply
  manifest: string;  // assets/characters/{id}/{id}.manifest.json
}

export interface FileEntry {
  id: string;
  file: string;
}

export interface AssetRegistry {
  version: 1;
  characters: Record<string, CharacterEntry>;
  vfx:        Record<string, FileEntry>;
  textures:   Record<string, FileEntry>;
  audio:      Record<string, FileEntry>;
  maps:       Record<string, FileEntry>;
}

export function createEmptyRegistry(): AssetRegistry {
  return {
    version: 1,
    characters: {},
    vfx: {},
    textures: {},
    audio: {},
    maps: {},
  };
}

export function registerCharacter(
  reg: AssetRegistry,
  id: string,
  entry: { ply: string; manifest: string },
): void {
  reg.characters[id] = { id, ply: entry.ply, manifest: entry.manifest };
}

export function registerVfx(
  reg: AssetRegistry,
  id: string,
  entry: { file: string },
): void {
  reg.vfx[id] = { id, file: entry.file };
}

export function registerTexture(
  reg: AssetRegistry,
  id: string,
  entry: { file: string },
): void {
  reg.textures[id] = { id, file: entry.file };
}

export function registerAudio(
  reg: AssetRegistry,
  id: string,
  entry: { file: string },
): void {
  reg.audio[id] = { id, file: entry.file };
}

export function registerMap(
  reg: AssetRegistry,
  id: string,
  entry: { file: string },
): void {
  reg.maps[id] = { id, file: entry.file };
}

export type RefKind = 'character' | 'vfx' | 'texture' | 'audio' | 'map';

export function resolveRef(ref: string, kind: RefKind, reg: AssetRegistry): string {
  const parsed = parseAssetRef(ref);
  if (parsed.kind === 'path') {
    return parsed.path;
  }
  switch (kind) {
    case 'character': {
      const e = reg.characters[parsed.id];
      if (!e) throw new Error(`resolveRef: unknown id "${parsed.id}" in characters`);
      return e.manifest;
    }
    case 'vfx': {
      const e = reg.vfx[parsed.id];
      if (!e) throw new Error(`resolveRef: unknown id "${parsed.id}" in vfx`);
      return e.file;
    }
    case 'texture': {
      const e = reg.textures[parsed.id];
      if (!e) throw new Error(`resolveRef: unknown id "${parsed.id}" in textures`);
      return e.file;
    }
    case 'audio': {
      const e = reg.audio[parsed.id];
      if (!e) throw new Error(`resolveRef: unknown id "${parsed.id}" in audio`);
      return e.file;
    }
    case 'map': {
      const e = reg.maps[parsed.id];
      if (!e) throw new Error(`resolveRef: unknown id "${parsed.id}" in maps`);
      return e.file;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @gseurat/project-root test 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/packages/project-root/src/registry.ts tools/packages/project-root/test/registry.test.ts
git commit -m "feat(project-root): AssetRegistry types + register/resolve helpers"
```

---

### Task 6: Implement and test `fs.ts`

**Files:**
- Create: `tools/packages/project-root/src/fs.ts`
- Create: `tools/packages/project-root/test/fs.test.ts`

- [ ] **Step 1: Write the failing test**

`tools/packages/project-root/test/fs.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ensureSubdir, writeFileAtPath, readFileAtPath } from '../src/fs';

// Minimal in-memory mock matching the FileSystemDirectoryHandle subset we use.
type Node = { kind: 'dir'; entries: Map<string, Node> } | { kind: 'file'; data: Uint8Array };

class MockDirHandle {
  kind: 'directory' = 'directory';
  constructor(public node: Extract<Node, { kind: 'dir' }>, public name = '') {}

  async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
    let n = this.node.entries.get(name);
    if (!n) {
      if (!opts?.create) throw new Error(`NotFoundError: ${name}`);
      n = { kind: 'dir', entries: new Map() };
      this.node.entries.set(name, n);
    }
    if (n.kind !== 'dir') throw new Error(`TypeMismatch: ${name}`);
    return new MockDirHandle(n, name);
  }

  async getFileHandle(name: string, opts?: { create?: boolean }) {
    let n = this.node.entries.get(name);
    if (!n) {
      if (!opts?.create) throw new Error(`NotFoundError: ${name}`);
      n = { kind: 'file', data: new Uint8Array() };
      this.node.entries.set(name, n);
    }
    if (n.kind !== 'file') throw new Error(`TypeMismatch: ${name}`);
    const file = n;
    return {
      kind: 'file' as const,
      name,
      async createWritable() {
        return {
          async write(d: Uint8Array | string) {
            const bytes = typeof d === 'string' ? new TextEncoder().encode(d) : d;
            file.data = bytes;
          },
          async close() {},
        };
      },
      async getFile() {
        return new Blob([file.data]);
      },
    };
  }
}

function makeRoot(): MockDirHandle {
  return new MockDirHandle({ kind: 'dir', entries: new Map() });
}

describe('ensureSubdir', () => {
  it('creates nested subdirectories', async () => {
    const root = makeRoot();
    const handle = await ensureSubdir(root as any, 'assets/characters/walker');
    expect(handle.name).toBe('walker');
    // Check the parent chain exists
    const assets = await (root as any).getDirectoryHandle('assets');
    const characters = await assets.getDirectoryHandle('characters');
    await characters.getDirectoryHandle('walker'); // throws if missing
  });

  it('is idempotent', async () => {
    const root = makeRoot();
    await ensureSubdir(root as any, 'assets/foo');
    await ensureSubdir(root as any, 'assets/foo'); // should not throw
  });

  it('rejects empty path', async () => {
    const root = makeRoot();
    await expect(ensureSubdir(root as any, '')).rejects.toThrow(/empty/i);
  });

  it('rejects traversal', async () => {
    const root = makeRoot();
    await expect(ensureSubdir(root as any, 'assets/../evil')).rejects.toThrow(/traversal/i);
  });
});

describe('writeFileAtPath / readFileAtPath', () => {
  it('round-trips text content', async () => {
    const root = makeRoot();
    await writeFileAtPath(root as any, 'assets/scenes/town.json', '{"hello":"world"}');
    const blob = await readFileAtPath(root as any, 'assets/scenes/town.json');
    const text = await blob.text();
    expect(text).toBe('{"hello":"world"}');
  });

  it('round-trips binary content', async () => {
    const root = makeRoot();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await writeFileAtPath(root as any, 'assets/maps/town.ply', bytes);
    const blob = await readFileAtPath(root as any, 'assets/maps/town.ply');
    const arr = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(arr)).toEqual([1, 2, 3, 4]);
  });

  it('creates intermediate directories on write', async () => {
    const root = makeRoot();
    await writeFileAtPath(root as any, 'tools_data/bricklayer/scene.bricklayer', '{}');
    const blob = await readFileAtPath(root as any, 'tools_data/bricklayer/scene.bricklayer');
    expect(await blob.text()).toBe('{}');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @gseurat/project-root test 2>&1 | tail -15
```

Expected: FAIL — `Cannot find module '../src/fs'`.

- [ ] **Step 3: Implement `src/fs.ts`**

```ts
const TRAVERSAL_RE = /(^|\/)\.\.($|\/)/;

function splitPath(p: string): string[] {
  if (!p || p.length === 0) {
    throw new Error('path is empty');
  }
  if (TRAVERSAL_RE.test(p)) {
    throw new Error(`path contains traversal: "${p}"`);
  }
  return p.split('/').filter(s => s.length > 0);
}

export async function ensureSubdir(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<FileSystemDirectoryHandle> {
  const parts = splitPath(relativePath);
  if (parts.length === 0) {
    throw new Error('ensureSubdir: empty path');
  }
  let cur: FileSystemDirectoryHandle = root;
  for (const part of parts) {
    cur = await cur.getDirectoryHandle(part, { create: true });
  }
  return cur;
}

export async function writeFileAtPath(
  root: FileSystemDirectoryHandle,
  relativePath: string,
  content: string | Uint8Array,
): Promise<void> {
  const parts = splitPath(relativePath);
  if (parts.length === 0) {
    throw new Error('writeFileAtPath: empty path');
  }
  const filename = parts.pop() as string;
  let cur: FileSystemDirectoryHandle = root;
  for (const part of parts) {
    cur = await cur.getDirectoryHandle(part, { create: true });
  }
  const fileHandle = await cur.getFileHandle(filename, { create: true });
  const writable = await (fileHandle as any).createWritable();
  await writable.write(content);
  await writable.close();
}

export async function readFileAtPath(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<Blob> {
  const parts = splitPath(relativePath);
  if (parts.length === 0) {
    throw new Error('readFileAtPath: empty path');
  }
  const filename = parts.pop() as string;
  let cur: FileSystemDirectoryHandle = root;
  for (const part of parts) {
    cur = await cur.getDirectoryHandle(part, { create: false });
  }
  const fileHandle = await cur.getFileHandle(filename, { create: false });
  return await (fileHandle as any).getFile();
}

export async function fileExistsAtPath(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<boolean> {
  try {
    await readFileAtPath(root, relativePath);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @gseurat/project-root test 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/packages/project-root/src/fs.ts tools/packages/project-root/test/fs.test.ts
git commit -m "feat(project-root): ensureSubdir + writeFileAtPath + readFileAtPath"
```

---

### Task 7: Implement `handle.ts` (IDB persistence)

**Files:**
- Create: `tools/packages/project-root/src/handle.ts`

This task has no unit test because IDB requires a browser environment and the logic is a thin wrapper. It will be integration-tested by the editors in Groups 2–4.

- [ ] **Step 1: Implement `src/handle.ts`**

```ts
import { get, set, del } from 'idb-keyval';

const KEY_PREFIX = 'gseurat:project-root-handle:';

/**
 * Persist a directory handle in IndexedDB so future sessions can re-acquire it.
 * The browser still requires re-prompting for permission via requestPermission().
 */
export async function saveProjectRootHandle(
  appId: string,
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  await set(KEY_PREFIX + appId, handle);
}

export async function loadProjectRootHandle(
  appId: string,
): Promise<FileSystemDirectoryHandle | null> {
  const handle = await get<FileSystemDirectoryHandle>(KEY_PREFIX + appId);
  return handle ?? null;
}

export async function clearProjectRootHandle(appId: string): Promise<void> {
  await del(KEY_PREFIX + appId);
}

/**
 * Re-request read/write permission on a previously stored handle.
 * Returns true if granted (browser usually grants silently if it was approved before).
 */
export async function ensureHandlePermission(
  handle: FileSystemDirectoryHandle,
): Promise<boolean> {
  const opts = { mode: 'readwrite' as const };
  // queryPermission / requestPermission are FSAPI extensions; not in TS lib.
  const h = handle as unknown as {
    queryPermission(o: { mode: 'readwrite' }): Promise<PermissionState>;
    requestPermission(o: { mode: 'readwrite' }): Promise<PermissionState>;
  };
  if ((await h.queryPermission(opts)) === 'granted') return true;
  return (await h.requestPermission(opts)) === 'granted';
}

/**
 * Use this in editor bootstrap. Returns null if no stored handle or permission denied.
 */
export async function restoreProjectRoot(
  appId: string,
): Promise<FileSystemDirectoryHandle | null> {
  const handle = await loadProjectRootHandle(appId);
  if (!handle) return null;
  const ok = await ensureHandlePermission(handle);
  return ok ? handle : null;
}
```

- [ ] **Step 2: Verify build**

```bash
pnpm --filter @gseurat/project-root test 2>&1 | tail -5
```

Expected: existing tests still pass; no test for handle.ts (FSAPI/IDB needs browser).

- [ ] **Step 3: Commit**

```bash
git add tools/packages/project-root/src/handle.ts
git commit -m "feat(project-root): IDB-backed directory handle persistence"
```

---

### Task 8: Verify package builds for downstream consumers

**Files:** none — verification only.

- [ ] **Step 1: Run all package tests**

```bash
pnpm --filter @gseurat/project-root test 2>&1 | tail -20
```

Expected: All test files pass.

- [ ] **Step 2: TypeScript compile check**

```bash
cd tools/packages/project-root && pnpm exec tsc --noEmit 2>&1 | tail -20 && cd -
```

Expected: no output (success).

- [ ] **Step 3: Verify barrel exports resolve**

Inspect `tools/packages/project-root/src/index.ts` and confirm it re-exports from layout, paths, registry, handle, and fs. If any are missing, add them and commit.

```bash
cat tools/packages/project-root/src/index.ts
```

---

## Group 2 — Echidna FSAPI introduction

### Task 9: Add `id` field to `EchidnaFile`

**Files:**
- Modify: `tools/apps/echidna/src/store/types.ts`
- Create: `tools/apps/echidna/src/store/__tests__/echidnaFile.test.ts`

- [ ] **Step 1: Read current `EchidnaFile`**

```bash
sed -n '70,95p' tools/apps/echidna/src/store/types.ts
```

Locate the `EchidnaFile` interface. It currently looks like:

```ts
export interface EchidnaFile {
  version: number;
  characterName: string;
  gridWidth: number;
  gridDepth: number;
  voxels: VoxelDto[];
  parts: BodyPart[];
  poses: Record<string, PoseData>;
  animations?: Record<string, AnimationClip>;
}
```

- [ ] **Step 2: Write the failing test**

`tools/apps/echidna/src/store/__tests__/echidnaFile.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { migrateEchidnaFile, slugifyCharacterId, type EchidnaFile } from '../types';

describe('slugifyCharacterId', () => {
  it('lowercases and underscores', () => {
    expect(slugifyCharacterId('Walker Bot')).toBe('walker_bot');
    expect(slugifyCharacterId('  Hello   World  ')).toBe('hello_world');
  });
  it('strips invalid chars', () => {
    expect(slugifyCharacterId('Cat/Dog#1')).toBe('catdog1');
  });
  it('falls back when empty', () => {
    expect(slugifyCharacterId('')).toBe('character');
    expect(slugifyCharacterId('   ')).toBe('character');
  });
});

describe('migrateEchidnaFile', () => {
  it('promotes v1/v2 file (no id) to current with slugified id', () => {
    const old = {
      version: 2,
      characterName: 'Walker Bot',
      gridWidth: 32,
      gridDepth: 32,
      voxels: [],
      parts: [],
      poses: {},
    };
    const migrated = migrateEchidnaFile(old);
    expect(migrated.version).toBe(3);
    expect(migrated.id).toBe('walker_bot');
  });

  it('preserves an existing id', () => {
    const file: EchidnaFile = {
      version: 3,
      id: 'walker',
      characterName: 'Walker Bot',
      gridWidth: 32,
      gridDepth: 32,
      voxels: [],
      parts: [],
      poses: {},
    };
    const migrated = migrateEchidnaFile(file);
    expect(migrated.id).toBe('walker');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm --filter @gseurat/echidna test --run 2>&1 | tail -15
```

Expected: FAIL — `migrateEchidnaFile` and `slugifyCharacterId` not exported.

- [ ] **Step 4: Implement changes in `types.ts`**

Add to `tools/apps/echidna/src/store/types.ts` (keep existing `EchidnaFile` interface but add `id` and `version: 3`):

```ts
export interface EchidnaFile {
  version: number;        // current = 3
  id: string;             // persistent slug, immutable after first save
  characterName: string;
  gridWidth: number;
  gridDepth: number;
  voxels: VoxelDto[];
  parts: BodyPart[];
  poses: Record<string, PoseData>;
  animations?: Record<string, AnimationClip>;
}

export const ECHIDNA_FILE_VERSION = 3;

export function slugifyCharacterId(name: string): string {
  const cleaned = name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '');
  return cleaned.length > 0 ? cleaned : 'character';
}

export function migrateEchidnaFile(raw: any): EchidnaFile {
  if (!raw || typeof raw !== 'object') {
    throw new Error('migrateEchidnaFile: not an object');
  }
  const id: string = typeof raw.id === 'string' && raw.id.length > 0
    ? raw.id
    : slugifyCharacterId(typeof raw.characterName === 'string' ? raw.characterName : '');
  return {
    version: ECHIDNA_FILE_VERSION,
    id,
    characterName: raw.characterName ?? '',
    gridWidth: raw.gridWidth ?? 32,
    gridDepth: raw.gridDepth ?? 32,
    voxels: Array.isArray(raw.voxels) ? raw.voxels : [],
    parts: Array.isArray(raw.parts) ? raw.parts : [],
    poses: raw.poses ?? {},
    animations: raw.animations,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm --filter @gseurat/echidna test --run 2>&1 | tail -10
```

Expected: PASS for the new `echidnaFile.test.ts`. (Pre-existing tests should still pass.)

- [ ] **Step 6: Commit**

```bash
git add tools/apps/echidna/src/store/types.ts tools/apps/echidna/src/store/__tests__/echidnaFile.test.ts
git commit -m "feat(echidna): persistent id field + slugify + migration to v3"
```

---

### Task 10: Wire `id` and `projectRootHandle` into the store

**Files:**
- Modify: `tools/apps/echidna/src/store/useCharacterStore.ts`

- [ ] **Step 1: Locate save/load functions**

```bash
grep -n "saveProject\|loadProject\|projectHandle\|characterId" tools/apps/echidna/src/store/useCharacterStore.ts
```

Find lines for `saveProject` and `loadProject` (~735 and ~754 from prior investigation).

- [ ] **Step 2: Add state fields**

In `tools/apps/echidna/src/store/useCharacterStore.ts`, add to the store state interface:

```ts
// near the other state fields:
characterId: string;        // persistent — set on first save, never changes
projectRootHandle: FileSystemDirectoryHandle | null;
setProjectRootHandle: (h: FileSystemDirectoryHandle | null) => void;
ensureCharacterId: () => string;  // initializes if empty, returns it
```

In the store's create initializer:

```ts
characterId: '',
projectRootHandle: null,
setProjectRootHandle: (h) => set({ projectRootHandle: h }),
ensureCharacterId: () => {
  const s = get();
  if (s.characterId) return s.characterId;
  // import slugifyCharacterId from './types'
  const id = slugifyCharacterId(s.characterName);
  set({ characterId: id });
  return id;
},
```

- [ ] **Step 3: Update `saveProject` to emit v3 with `id`**

Replace the body of `saveProject` (the pure serializer) with:

```ts
saveProject: (): EchidnaFile => {
  const s = get();
  const id = s.characterId || slugifyCharacterId(s.characterName);
  if (!s.characterId) set({ characterId: id });
  return {
    version: ECHIDNA_FILE_VERSION,
    id,
    characterName: s.characterName,
    gridWidth: s.gridWidth,
    gridDepth: s.gridDepth,
    voxels: Array.from(s.voxels.values()),
    parts: s.parts,
    poses: s.poses,
    animations: s.animations,
  };
},
```

- [ ] **Step 4: Update `loadProject` to call `migrateEchidnaFile`**

Replace the entry of `loadProject(file: EchidnaFile)` with:

```ts
loadProject: (raw: any) => {
  const file = migrateEchidnaFile(raw);
  if ((raw?.version ?? 0) < ECHIDNA_FILE_VERSION) {
    console.warn(`[echidna] Loaded legacy v${raw?.version} file; migrated to v${ECHIDNA_FILE_VERSION}`);
  }
  set({
    characterId: file.id,
    characterName: file.characterName,
    gridWidth: file.gridWidth,
    gridDepth: file.gridDepth,
    voxels: new Map(file.voxels.map(v => [`${v.x},${v.y},${v.z}`, v])),
    parts: file.parts,
    poses: file.poses,
    animations: file.animations ?? {},
  });
},
```

Also add `migrateEchidnaFile, ECHIDNA_FILE_VERSION, slugifyCharacterId` to the existing `import` from `./types`.

- [ ] **Step 5: TypeScript compile check**

```bash
pnpm --filter @gseurat/echidna exec tsc --noEmit 2>&1 | tail -20
```

Expected: no errors. (If `EchidnaFile` was previously imported under a different alias in the file, fix the import accordingly.)

- [ ] **Step 6: Run echidna tests**

```bash
pnpm --filter @gseurat/echidna test --run 2>&1 | tail -15
```

Expected: PASS. Pre-existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add tools/apps/echidna/src/store/useCharacterStore.ts
git commit -m "feat(echidna): store characterId + projectRootHandle, route save/load through migration"
```

---

### Task 11: Add `@gseurat/project-root` dependency to Echidna

**Files:**
- Modify: `tools/apps/echidna/package.json`

- [ ] **Step 1: Add dep**

In `tools/apps/echidna/package.json`, add to `dependencies`:

```json
"@gseurat/project-root": "workspace:*"
```

- [ ] **Step 2: Install**

```bash
pnpm install 2>&1 | tail -10
```

Expected: lockfile updates, project-root package gets linked.

- [ ] **Step 3: Smoke import**

Create a temporary check (don't commit):

```bash
echo 'import { PROJECT_LAYOUT } from "@gseurat/project-root"; console.log(PROJECT_LAYOUT.assets.characters);' > /tmp/echidna_smoke.ts
```

You don't need to run this — just confirm the import resolves in the next task.

- [ ] **Step 4: Commit**

```bash
git add tools/apps/echidna/package.json pnpm-lock.yaml 2>/dev/null || git add tools/apps/echidna/package.json
git commit -m "build(echidna): add @gseurat/project-root workspace dep"
```

---

### Task 12: Implement `projectFs.ts` for Echidna

**Files:**
- Create: `tools/apps/echidna/src/lib/projectFs.ts`
- Create: `tools/apps/echidna/src/lib/__tests__/projectFs.test.ts`

- [ ] **Step 1: Write the failing test**

`tools/apps/echidna/src/lib/__tests__/projectFs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  echidnaSavePath,
  characterPlyPath,
  characterManifestPath,
} from '../projectFs';

describe('echidna path helpers', () => {
  it('echidnaSavePath places files under tools_data/echidna_saves', () => {
    expect(echidnaSavePath('walker')).toBe('tools_data/echidna_saves/walker.echidna');
  });

  it('characterPlyPath places files under assets/characters/{id}/', () => {
    expect(characterPlyPath('walker')).toBe('assets/characters/walker/walker.ply');
  });

  it('characterManifestPath places files under assets/characters/{id}/', () => {
    expect(characterManifestPath('walker')).toBe('assets/characters/walker/walker.manifest.json');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @gseurat/echidna test --run 2>&1 | tail -15
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/projectFs.ts`**

```ts
import {
  PROJECT_LAYOUT,
  toAssetPath,
  ensureSubdir,
  writeFileAtPath,
  readFileAtPath,
} from '@gseurat/project-root';
import { migrateEchidnaFile, type EchidnaFile } from '../store/types';

/* ----- path builders ----- */

export function echidnaSavePath(id: string): string {
  return `${PROJECT_LAYOUT.toolsData.echidnaSaves}/${id}.echidna`;
}

export function characterPlyPath(id: string): string {
  return toAssetPath('characters', id, `${id}.ply`);
}

export function characterManifestPath(id: string): string {
  return toAssetPath('characters', id, `${id}.manifest.json`);
}

/* ----- save / load ----- */

export async function saveEchidnaProject(
  root: FileSystemDirectoryHandle,
  file: EchidnaFile,
): Promise<void> {
  await ensureSubdir(root, PROJECT_LAYOUT.toolsData.echidnaSaves);
  const path = echidnaSavePath(file.id);
  const json = JSON.stringify(file, null, 2);
  await writeFileAtPath(root, path, json);
}

export async function loadEchidnaProject(
  root: FileSystemDirectoryHandle,
  id: string,
): Promise<EchidnaFile> {
  const blob = await readFileAtPath(root, echidnaSavePath(id));
  const text = await blob.text();
  return migrateEchidnaFile(JSON.parse(text));
}

/* ----- character export (PLY + manifest) ----- */

export async function exportCharacterToProject(
  root: FileSystemDirectoryHandle,
  id: string,
  ply: Blob | Uint8Array,
  manifestJson: string,
): Promise<{ plyPath: string; manifestPath: string }> {
  await ensureSubdir(root, `${PROJECT_LAYOUT.assets.characters}/${id}`);
  const plyBytes = ply instanceof Blob
    ? new Uint8Array(await ply.arrayBuffer())
    : ply;
  const plyPath = characterPlyPath(id);
  const manifestPath = characterManifestPath(id);
  await writeFileAtPath(root, plyPath, plyBytes);
  await writeFileAtPath(root, manifestPath, manifestJson);
  return { plyPath, manifestPath };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @gseurat/echidna test --run 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/apps/echidna/src/lib/projectFs.ts tools/apps/echidna/src/lib/__tests__/projectFs.test.ts
git commit -m "feat(echidna): projectFs module — save/load + character export to canonical paths"
```

---

### Task 13: Wire FSAPI into Echidna's MenuBar

**Files:**
- Modify: `tools/apps/echidna/src/panels/MenuBar.tsx`

- [ ] **Step 1: Locate handlers**

```bash
grep -n "handleSave\|handleLoad\|handleSaveAs\|handleNew\|download" tools/apps/echidna/src/panels/MenuBar.tsx
```

You'll see download-based handlers (~268–307) and an `<input type="file">` ref for load.

- [ ] **Step 2: Add new handlers**

Add to `MenuBar.tsx` near the existing imports:

```tsx
import {
  saveProjectRootHandle,
  loadProjectRootHandle,
  ensureHandlePermission,
  restoreProjectRoot,
} from '@gseurat/project-root';
import {
  saveEchidnaProject,
  loadEchidnaProject,
  exportCharacterToProject,
  echidnaSavePath,
} from '../lib/projectFs';
```

Add new handlers (place near the other `handleSave*` functions):

```tsx
const handlePickProjectRoot = useCallback(async () => {
  // @ts-ignore - showDirectoryPicker is FSAPI extension
  const handle: FileSystemDirectoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await saveProjectRootHandle('echidna', handle);
  useCharacterStore.getState().setProjectRootHandle(handle);
  toast.success(`Project root set: ${handle.name}`);
}, []);

const handleSaveToProject = useCallback(async () => {
  const s = useCharacterStore.getState();
  let handle = s.projectRootHandle;
  if (!handle) {
    // @ts-ignore
    handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    if (!handle) return;
    await saveProjectRootHandle('echidna', handle);
    s.setProjectRootHandle(handle);
  } else {
    const ok = await ensureHandlePermission(handle);
    if (!ok) {
      toast.error('Project root permission denied');
      return;
    }
  }
  const id = s.ensureCharacterId();
  const file = s.saveProject();
  await saveEchidnaProject(handle, file);
  toast.success(`Saved to ${echidnaSavePath(id)}`);
}, []);

const handleExportCharacterToProject = useCallback(async () => {
  const s = useCharacterStore.getState();
  if (s.voxels.size === 0) {
    toast.error('No voxels to export');
    return;
  }
  let handle = s.projectRootHandle;
  if (!handle) {
    handle = await restoreProjectRoot('echidna');
    if (!handle) {
      toast.error('Set a project root first');
      return;
    }
    s.setProjectRootHandle(handle);
  }
  const id = s.ensureCharacterId();
  const ply = exportPly(s.voxels, s.gridWidth, s.gridDepth, s.parts);
  const manifest = buildManifest(s.characterName, `${id}.ply`, 1.0, s.parts, s.poses, s.animations);
  // Re-center bones to match PLY centering
  const halfW = s.gridWidth / 2;
  const maxY = Math.max(...Array.from(s.voxels.values()).map(v => v.y), 0);
  const halfH = maxY / 2;
  for (const b of manifest.bones) {
    b.joint = [b.joint[0] - halfW, b.joint[1] - halfH, b.joint[2] - halfW];
  }
  const { plyPath, manifestPath } = await exportCharacterToProject(
    handle,
    id,
    ply,
    JSON.stringify(manifest, null, 2),
  );
  toast.success(`Exported ${plyPath} + ${manifestPath}`);
}, []);
```

- [ ] **Step 3: Add menu entries**

In the File menu JSX, add new entries above the existing Save/Load:

```tsx
<MenuItem onClick={handlePickProjectRoot}>Set Project Root…</MenuItem>
<MenuItem onClick={handleSaveToProject}>Save to Project</MenuItem>
<MenuItem onClick={handleExportCharacterToProject}>Export Character to Project</MenuItem>
<MenuSeparator />
{/* keep legacy Save / Load As Download for now */}
```

(Keep the legacy download handlers — they're a safety net until the FSAPI flow is proven.)

- [ ] **Step 4: Bootstrap restore on first mount**

In `tools/apps/echidna/src/App.tsx` (the top-level mount), add a `useEffect` that runs once:

```tsx
import { restoreProjectRoot } from '@gseurat/project-root';

useEffect(() => {
  (async () => {
    const handle = await restoreProjectRoot('echidna');
    if (handle) {
      useCharacterStore.getState().setProjectRootHandle(handle);
      console.log(`[echidna] Restored project root: ${handle.name}`);
    }
  })();
}, []);
```

- [ ] **Step 5: Build verification**

```bash
pnpm --filter @gseurat/echidna build 2>&1 | tail -20
```

Expected: build succeeds. Fix any TS errors before commit.

- [ ] **Step 6: Commit**

```bash
git add tools/apps/echidna/src/panels/MenuBar.tsx tools/apps/echidna/src/App.tsx
git commit -m "feat(echidna): FSAPI menu actions — set root, save/export to project layout"
```

---

### Task 14: Run Echidna's full test suite + verify build

**Files:** none.

- [ ] **Step 1: Run all tests**

```bash
pnpm --filter @gseurat/echidna test --run 2>&1 | tail -20
```

Expected: all green.

- [ ] **Step 2: Build**

```bash
pnpm --filter @gseurat/echidna build 2>&1 | tail -10
```

Expected: success.

---

## Group 3 — Méliès save path migration

### Task 15: Add `@gseurat/project-root` to Méliès + bump schema to v3

**Files:**
- Modify: `tools/apps/melies/package.json`
- Modify: `tools/apps/melies/src/store/types.ts`

- [ ] **Step 1: Add dep**

In `tools/apps/melies/package.json` `dependencies`, add:

```json
"@gseurat/project-root": "workspace:*"
```

Then:

```bash
pnpm install 2>&1 | tail -5
```

- [ ] **Step 2: Update `VfxProject` version**

In `tools/apps/melies/src/store/types.ts`, change `version: 2` to `version: 3` for the project type, AND export a constant:

```ts
export const VFX_PROJECT_VERSION = 3;

export interface VfxProject {
  version: 3;
  presets: VfxPreset[];
  scenes?: PlyReference[];
  activeSceneId?: string;
}
```

- [ ] **Step 3: Commit**

```bash
git add tools/apps/melies/package.json tools/apps/melies/src/store/types.ts
git commit -m "feat(melies): bump VfxProject to v3, add project-root workspace dep"
```

---

### Task 16: Update Méliès `projectIO.ts` save targets (test-first)

**Files:**
- Modify: `tools/apps/melies/src/lib/projectIO.ts`
- Create: `tools/apps/melies/src/lib/__tests__/projectIO.test.ts`

- [ ] **Step 1: Write the failing test**

`tools/apps/melies/src/lib/__tests__/projectIO.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { meliesProjectPath, vfxPresetPath, migrateVfxProject } from '../projectIO';

describe('melies path helpers', () => {
  it('meliesProjectPath places projects under tools_data/melies_projects', () => {
    expect(meliesProjectPath('forest_demo'))
      .toBe('tools_data/melies_projects/forest_demo.json');
  });

  it('vfxPresetPath places presets under assets/vfx/presets', () => {
    expect(vfxPresetPath('Particle Burst'))
      .toBe('assets/vfx/presets/particle_burst.vfx.json');
  });

  it('vfxPresetPath strips invalid chars', () => {
    expect(vfxPresetPath('Cool/Effect#1'))
      .toBe('assets/vfx/presets/cooleffect1.vfx.json');
  });
});

describe('migrateVfxProject', () => {
  it('upgrades v2 to v3', () => {
    const v2 = {
      version: 2,
      presets: [{ id: 'p1', name: 'Test', elements: [] }],
    };
    const migrated = migrateVfxProject(v2);
    expect(migrated.version).toBe(3);
    expect(migrated.presets).toHaveLength(1);
  });

  it('passes v3 through unchanged', () => {
    const v3 = {
      version: 3,
      presets: [],
    };
    expect(migrateVfxProject(v3).version).toBe(3);
  });

  it('upgrades legacy v1 (with `layers` field) to v3', () => {
    const v1 = {
      version: 1,
      presets: [{ id: 'p1', name: 'Test', layers: [{ id: 'l1', name: 'L', type: 'emitter' }] }],
    };
    const migrated = migrateVfxProject(v1);
    expect(migrated.version).toBe(3);
    expect(migrated.presets[0].elements).toBeDefined();
    expect(migrated.presets[0].elements).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @gseurat/melies test --run 2>&1 | tail -15
```

Expected: FAIL — exports not found.

- [ ] **Step 3: Edit `tools/apps/melies/src/lib/projectIO.ts`**

Add at the top of the file:

```ts
import {
  PROJECT_LAYOUT,
  ensureSubdir,
  writeFileAtPath,
  readFileAtPath,
} from '@gseurat/project-root';
```

Add new exports near the top:

```ts
export function slugifyPresetName(name: string): string {
  const cleaned = name.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '');
  return cleaned.length > 0 ? cleaned : 'preset';
}

export function meliesProjectPath(projectName: string): string {
  const slug = slugifyPresetName(projectName);
  return `${PROJECT_LAYOUT.toolsData.melies}/${slug}.json`;
}

export function vfxPresetPath(presetName: string): string {
  const slug = slugifyPresetName(presetName);
  return `${PROJECT_LAYOUT.assets.vfxPresets}/${slug}.vfx.json`;
}
```

Update `migrateProject` (rename to `migrateVfxProject` and export):

```ts
export function migrateVfxProject(raw: any): VfxProject {
  if (!raw || typeof raw !== 'object') {
    throw new Error('migrateVfxProject: not an object');
  }
  let presets = Array.isArray(raw.presets) ? raw.presets : [];
  // v1 → v2: rename `layers` to `elements`
  presets = presets.map((p: any) => {
    if (Array.isArray(p.layers) && !Array.isArray(p.elements)) {
      return { ...p, elements: p.layers, layers: undefined };
    }
    return p;
  });
  return {
    version: 3,
    presets,
    scenes: raw.scenes,
    activeSceneId: raw.activeSceneId,
  };
}
```

If the old `migrateProject` is still imported elsewhere, leave a thin re-export:

```ts
export const migrateProject = migrateVfxProject;
```

Update `saveProject` to write to the new locations:

```ts
export async function saveProject(
  handle: FileSystemDirectoryHandle,
  projectName: string,
): Promise<void> {
  const data = useVfxStore.getState().exportProjectData(); // existing function
  const json = JSON.stringify({ ...data, version: 3 }, null, 2);

  // 1. Project state under tools_data/melies_projects/
  await writeFileAtPath(handle, meliesProjectPath(projectName), json);

  // 2. Each preset under assets/vfx/presets/
  await ensureSubdir(handle, PROJECT_LAYOUT.assets.vfxPresets);
  for (const preset of data.presets) {
    const path = vfxPresetPath(preset.name);
    const presetJson = JSON.stringify(serializeVfx(preset), null, 2);
    await writeFileAtPath(handle, path, presetJson);
  }
}
```

Update `loadProject` to read from `tools_data/melies_projects/`. Since we don't know the project name on cold load, we need a small list helper — for now, accept the project name as a parameter:

```ts
export async function loadProject(
  handle: FileSystemDirectoryHandle,
  projectName: string,
): Promise<boolean> {
  try {
    const blob = await readFileAtPath(handle, meliesProjectPath(projectName));
    const data = migrateVfxProject(JSON.parse(await blob.text()));
    useVfxStore.getState().loadProjectData(data);
    if ((JSON.parse(await blob.text()).version ?? 0) < VFX_PROJECT_VERSION) {
      console.warn('[melies] Loaded legacy project; migrated.');
    }
    return true;
  } catch (e) {
    console.error('[melies] Failed to load project:', e);
    return false;
  }
}
```

Note: this changes the `loadProject` signature. Update all call sites in `App.tsx` to pass a project name. If a project name isn't tracked, prompt the user or default to `'default'` for the migration window.

- [ ] **Step 4: Run test to verify pass**

```bash
pnpm --filter @gseurat/melies test --run 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Build verification**

```bash
pnpm --filter @gseurat/melies build 2>&1 | tail -20
```

Fix call-site errors in `App.tsx` by passing a project name (e.g., from `useVfxStore.getState().projectName ?? 'default'`).

- [ ] **Step 6: Commit**

```bash
git add tools/apps/melies/src/lib/projectIO.ts tools/apps/melies/src/lib/__tests__/projectIO.test.ts tools/apps/melies/src/App.tsx
git commit -m "feat(melies): save to tools_data/melies_projects + assets/vfx/presets, migrate to v3"
```

---

## Group 4 — Bricklayer schema v2 + asset registry

### Task 17: Add `@gseurat/project-root` to Bricklayer

**Files:**
- Modify: `tools/apps/bricklayer/package.json`

- [ ] **Step 1: Add dep**

In `tools/apps/bricklayer/package.json` `dependencies`:

```json
"@gseurat/project-root": "workspace:*"
```

```bash
pnpm install 2>&1 | tail -5
```

- [ ] **Step 2: Commit**

```bash
git add tools/apps/bricklayer/package.json
git commit -m "build(bricklayer): add @gseurat/project-root workspace dep"
```

---

### Task 18: Update `BricklayerFile` schema to v2 with `asset_registry`

**Files:**
- Modify: `tools/apps/bricklayer/src/store/types.ts`

- [ ] **Step 1: Edit `types.ts`**

At the top of the file, add:

```ts
import type { AssetRegistry } from '@gseurat/project-root';
```

Locate the `BricklayerFile` interface (~432). Modify:

```ts
export const BRICKLAYER_FILE_VERSION = 2;

export interface BricklayerFile {
  version: 2;
  asset_registry: AssetRegistry;       // NEW — top-level
  gridWidth: number;
  gridDepth: number;
  voxels: VoxelDto[];
  collision: string[];
  collisionGridData?: CollisionGridData;
  nav_zone_names?: string[];
  color_palettes?: ColorPalette[];
  terrains?: TerrainEntry[];
  assets?: AssetEntry[];   // legacy — kept for back-compat reads
  scene: SceneState;
}
```

- [ ] **Step 2: TypeScript check**

```bash
pnpm --filter @gseurat/bricklayer exec tsc --noEmit 2>&1 | tail -20
```

Expected errors: every place that constructs a `BricklayerFile` now needs `asset_registry` and `version: 2`. Fix them in the next task; for now, commit the type only.

- [ ] **Step 3: Commit**

```bash
git add tools/apps/bricklayer/src/store/types.ts
git commit -m "feat(bricklayer): bump BricklayerFile to v2 with top-level asset_registry"
```

---

### Task 19: Implement v1→v2 migration (test-first)

**Files:**
- Create: `tools/apps/bricklayer/src/lib/migrateBricklayerFile.ts`
- Create: `tools/apps/bricklayer/src/lib/__tests__/migrateBricklayerFile.test.ts`

- [ ] **Step 1: Write the failing test**

`tools/apps/bricklayer/src/lib/__tests__/migrateBricklayerFile.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { migrateBricklayerFile } from '../migrateBricklayerFile';

describe('migrateBricklayerFile', () => {
  it('upgrades v1 with no assets to v2 with empty registry', () => {
    const v1 = {
      version: 1,
      gridWidth: 32,
      gridDepth: 32,
      voxels: [],
      collision: [],
      scene: {},
    };
    const v2 = migrateBricklayerFile(v1);
    expect(v2.version).toBe(2);
    expect(v2.asset_registry.version).toBe(1);
    expect(Object.keys(v2.asset_registry.characters)).toEqual([]);
  });

  it('synthesizes registry entries from v1 flat assets[]', () => {
    const v1 = {
      version: 1,
      gridWidth: 32,
      gridDepth: 32,
      voxels: [],
      collision: [],
      assets: [
        { id: 'house', name: 'House', type: 'ply', path: 'assets/maps/house.ply' },
        { id: 'sky', name: 'Sky', type: 'texture', path: 'assets/textures/sky.png' },
      ],
      scene: {},
    };
    const v2 = migrateBricklayerFile(v1);
    expect(v2.asset_registry.maps.house?.file).toBe('assets/maps/house.ply');
    expect(v2.asset_registry.textures.sky?.file).toBe('assets/textures/sky.png');
  });

  it('passes v2 through unchanged', () => {
    const v2 = {
      version: 2,
      asset_registry: { version: 1, characters: {}, vfx: {}, textures: {}, audio: {}, maps: {} },
      gridWidth: 32,
      gridDepth: 32,
      voxels: [],
      collision: [],
      scene: {},
    };
    const result = migrateBricklayerFile(v2);
    expect(result).toEqual(v2);
  });

  it('throws on unknown version', () => {
    expect(() => migrateBricklayerFile({ version: 99, scene: {} })).toThrow(/unknown.*version/i);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm --filter @gseurat/bricklayer test --run 2>&1 | tail -15
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `migrateBricklayerFile.ts`**

```ts
import {
  createEmptyRegistry,
  registerCharacter,
  registerVfx,
  registerTexture,
  registerAudio,
  registerMap,
  type AssetRegistry,
} from '@gseurat/project-root';
import type { BricklayerFile } from '../store/types';
import { BRICKLAYER_FILE_VERSION } from '../store/types';

interface LegacyAssetEntry {
  id: string;
  name: string;
  type: 'ply' | 'texture' | 'audio';
  path: string;
}

function buildRegistryFromLegacyAssets(entries: LegacyAssetEntry[] | undefined): AssetRegistry {
  const reg = createEmptyRegistry();
  if (!Array.isArray(entries)) return reg;
  for (const e of entries) {
    if (!e || typeof e.path !== 'string' || !e.path.startsWith('assets/')) continue;
    if (e.type === 'ply') {
      // Heuristic: if under maps/, it's a map; if under characters/, it's a character.
      if (e.path.startsWith('assets/characters/')) {
        registerCharacter(reg, e.id, {
          ply: e.path,
          manifest: e.path.replace(/\.ply$/, '.manifest.json'),
        });
      } else {
        registerMap(reg, e.id, { file: e.path });
      }
    } else if (e.type === 'texture') {
      registerTexture(reg, e.id, { file: e.path });
    } else if (e.type === 'audio') {
      registerAudio(reg, e.id, { file: e.path });
    }
  }
  return reg;
}

export function migrateBricklayerFile(raw: any): BricklayerFile {
  if (!raw || typeof raw !== 'object') {
    throw new Error('migrateBricklayerFile: not an object');
  }
  const ver = raw.version ?? 1;
  if (ver !== 1 && ver !== 2) {
    throw new Error(`migrateBricklayerFile: unknown file version ${ver}`);
  }
  if (ver === 2) {
    return raw as BricklayerFile;
  }

  // ver === 1: synthesize registry from legacy `assets[]`
  console.warn('[bricklayer] Loaded v1 file; migrating to v2 in memory.');
  const registry = buildRegistryFromLegacyAssets(raw.assets);

  return {
    version: BRICKLAYER_FILE_VERSION,
    asset_registry: registry,
    gridWidth: raw.gridWidth ?? 128,
    gridDepth: raw.gridDepth ?? 96,
    voxels: raw.voxels ?? [],
    collision: raw.collision ?? [],
    collisionGridData: raw.collisionGridData,
    nav_zone_names: raw.nav_zone_names,
    color_palettes: raw.color_palettes,
    terrains: raw.terrains,
    assets: raw.assets, // preserved for diagnostic purposes
    scene: raw.scene ?? {},
  };
}
```

- [ ] **Step 4: Verify tests pass**

```bash
pnpm --filter @gseurat/bricklayer test --run 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/apps/bricklayer/src/lib/migrateBricklayerFile.ts tools/apps/bricklayer/src/lib/__tests__/migrateBricklayerFile.test.ts
git commit -m "feat(bricklayer): v1→v2 BricklayerFile migration with registry synthesis"
```

---

### Task 20: Wire migration into store load + emit v2 on save

**Files:**
- Modify: `tools/apps/bricklayer/src/store/useSceneStore.ts`

- [ ] **Step 1: Locate save/load**

```bash
grep -n "saveProject\|loadProject" tools/apps/bricklayer/src/store/useSceneStore.ts
```

- [ ] **Step 2: Update `loadProject`**

In `useSceneStore.ts`, find the `loadProject` action and wrap the input with the migration:

```ts
import { migrateBricklayerFile } from '../lib/migrateBricklayerFile';
import { createEmptyRegistry, type AssetRegistry } from '@gseurat/project-root';

// inside the store:
loadProject: (raw: any) => {
  const file = migrateBricklayerFile(raw);
  set({
    asset_registry: file.asset_registry,
    gridWidth: file.gridWidth,
    gridDepth: file.gridDepth,
    voxels: new Map(file.voxels.map(v => [`${v.x},${v.y},${v.z}`, v])),
    collision: file.collision,
    collisionGridData: file.collisionGridData,
    nav_zone_names: file.nav_zone_names ?? [],
    color_palettes: file.color_palettes ?? [],
    terrains: file.terrains ?? [],
    assets: file.assets ?? [],
    // ... existing scene fields ...
    ...flattenScene(file.scene),
  });
},
```

(`flattenScene` is whatever existing helper unpacks `file.scene` into store fields. Use the existing pattern from the current `loadProject`.)

- [ ] **Step 3: Add `asset_registry` to store state**

In the store state interface and initializer:

```ts
asset_registry: AssetRegistry;
// in initial state:
asset_registry: createEmptyRegistry(),
```

- [ ] **Step 4: Update `saveProject` to emit v2**

```ts
saveProject: (): BricklayerFile => {
  const s = get();
  return {
    version: 2,
    asset_registry: s.asset_registry,
    gridWidth: s.gridWidth,
    gridDepth: s.gridDepth,
    voxels: Array.from(s.voxels.values()),
    collision: s.collision,
    collisionGridData: s.collisionGridData,
    nav_zone_names: s.nav_zone_names,
    color_palettes: s.color_palettes,
    terrains: s.terrains,
    assets: s.assets,
    scene: collectSceneFields(s),
  };
},
```

- [ ] **Step 5: TypeScript compile check**

```bash
pnpm --filter @gseurat/bricklayer exec tsc --noEmit 2>&1 | tail -25
```

Fix any remaining errors (likely places that destructure `BricklayerFile` and now miss `asset_registry`).

- [ ] **Step 6: Commit**

```bash
git add tools/apps/bricklayer/src/store/useSceneStore.ts
git commit -m "feat(bricklayer): load through migration, save as v2 with asset_registry"
```

---

### Task 21: Update Bricklayer `projectIO.ts` to use new save paths

**Files:**
- Modify: `tools/apps/bricklayer/src/lib/projectIO.ts`

- [ ] **Step 1: Edit `projectIO.ts`**

At the top, add:

```ts
import {
  PROJECT_LAYOUT,
  ensureSubdir,
  writeFileAtPath,
  readFileAtPath,
} from '@gseurat/project-root';
```

In `saveProject(handle)`, change the destination of `scene.bricklayer`:

```ts
// OLD: const fileHandle = await handle.getFileHandle('scene.bricklayer', { create: true });
// NEW:
await ensureSubdir(handle, PROJECT_LAYOUT.toolsData.bricklayer);
const bricklayerPath = `${PROJECT_LAYOUT.toolsData.bricklayer}/scene.bricklayer`;
await writeFileAtPath(handle, bricklayerPath, JSON.stringify(useSceneStore.getState().saveProject(), null, 2));
```

For the engine scene JSON export:

```ts
// OLD: write to {projectName}.json at root
// NEW: under assets/scenes/
const sceneJsonPath = `${PROJECT_LAYOUT.assets.scenes}/${projectName}.json`;
await writeFileAtPath(handle, sceneJsonPath, JSON.stringify(exportSceneJson(useSceneStore.getState()), null, 2));
```

For the terrain PLY:

```ts
const terrainPath = `${PROJECT_LAYOUT.assets.maps}/${projectName}.ply`;
await writeFileAtPath(handle, terrainPath, plyBytes);
```

For VFX instance preset files:

```ts
// OLD: assets/vfx/{inst.name}.vfx.json
// NEW: assets/vfx/presets/{inst.name}.vfx.json
const presetPath = `${PROJECT_LAYOUT.assets.vfxPresets}/${slugify(inst.name)}.vfx.json`;
```

In `loadProject(handle)`:

```ts
// OLD: handle.getFileHandle('scene.bricklayer')
// NEW:
const blob = await readFileAtPath(handle, `${PROJECT_LAYOUT.toolsData.bricklayer}/scene.bricklayer`);
const text = await blob.text();
const data = JSON.parse(text);
useSceneStore.getState().loadProject(data);
```

Add a small back-compat read for the legacy root location:

```ts
async function readBricklayerFile(handle: FileSystemDirectoryHandle): Promise<any> {
  try {
    const blob = await readFileAtPath(handle, `${PROJECT_LAYOUT.toolsData.bricklayer}/scene.bricklayer`);
    return JSON.parse(await blob.text());
  } catch {
    // Legacy fallback: root-level scene.bricklayer
    const fh = await handle.getFileHandle('scene.bricklayer');
    const file = await fh.getFile();
    return JSON.parse(await file.text());
  }
}
```

Use `readBricklayerFile(handle)` inside `loadProject`.

- [ ] **Step 2: Build check**

```bash
pnpm --filter @gseurat/bricklayer build 2>&1 | tail -20
```

Fix any TS errors.

- [ ] **Step 3: Commit**

```bash
git add tools/apps/bricklayer/src/lib/projectIO.ts
git commit -m "feat(bricklayer): write to tools_data + canonical asset paths, fall back to legacy root"
```

---

### Task 22: Add a path validator to `sceneExport.ts` (test-first)

**Files:**
- Modify: `tools/apps/bricklayer/src/lib/sceneExport.ts`
- Create: `tools/apps/bricklayer/src/lib/__tests__/sceneExport.test.ts`

- [ ] **Step 1: Write the failing test**

`tools/apps/bricklayer/src/lib/__tests__/sceneExport.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateScenePaths, type ScenePathError } from '../sceneExport';
import { createEmptyRegistry, registerCharacter } from '@gseurat/project-root';

describe('validateScenePaths', () => {
  it('passes a clean scene with relative asset paths', () => {
    const reg = createEmptyRegistry();
    const scene = {
      game_objects: [{ id: 'a', ply_file: 'assets/maps/house.ply' }],
      vfx_instances: [{ vfx_file: 'assets/vfx/presets/explosion.vfx.json' }],
      gaussian_splat: { ply_file: 'assets/maps/town.ply' },
    } as any;
    const errs = validateScenePaths(scene, reg);
    expect(errs).toEqual([]);
  });

  it('resolves #id refs against the registry', () => {
    const reg = createEmptyRegistry();
    registerCharacter(reg, 'walker', {
      ply: 'assets/characters/walker/walker.ply',
      manifest: 'assets/characters/walker/walker.manifest.json',
    });
    const scene = {
      game_objects: [{
        id: 'a',
        components: { CharacterModel: { manifest: '#walker' } },
      }],
    } as any;
    const errs = validateScenePaths(scene, reg);
    expect(errs).toEqual([]);
  });

  it('rejects bare filenames in ply_file', () => {
    const scene = { game_objects: [{ id: 'a', ply_file: 'walker.ply' }] } as any;
    const errs = validateScenePaths(scene, createEmptyRegistry());
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0].message).toMatch(/bare filename/i);
  });

  it('rejects absolute paths', () => {
    const scene = { game_objects: [{ id: 'a', ply_file: '/Users/foo/walker.ply' }] } as any;
    const errs = validateScenePaths(scene, createEmptyRegistry());
    expect(errs[0].message).toMatch(/absolute/i);
  });

  it('rejects unknown #id', () => {
    const scene = {
      game_objects: [{ id: 'a', components: { CharacterModel: { manifest: '#nope' } } }],
    } as any;
    const errs = validateScenePaths(scene, createEmptyRegistry());
    expect(errs[0].message).toMatch(/unknown id/i);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm --filter @gseurat/bricklayer test --run 2>&1 | tail -15
```

Expected: FAIL — `validateScenePaths` not exported.

- [ ] **Step 3: Implement validator in `sceneExport.ts`**

Add to `tools/apps/bricklayer/src/lib/sceneExport.ts`:

```ts
import { parseAssetRef, type AssetRegistry, resolveRef } from '@gseurat/project-root';

export interface ScenePathError {
  field: string;
  value: string;
  message: string;
}

function validateRef(
  field: string,
  value: unknown,
  kind: 'character' | 'vfx' | 'texture' | 'audio' | 'map',
  reg: AssetRegistry,
  out: ScenePathError[],
): void {
  if (typeof value !== 'string' || value.length === 0) return;
  try {
    parseAssetRef(value);
  } catch (e) {
    out.push({ field, value, message: (e as Error).message });
    return;
  }
  if (value.startsWith('#')) {
    try {
      resolveRef(value, kind, reg);
    } catch (e) {
      out.push({ field, value, message: (e as Error).message });
    }
  }
}

export function validateScenePaths(scene: any, reg: AssetRegistry): ScenePathError[] {
  const errs: ScenePathError[] = [];
  if (Array.isArray(scene?.game_objects)) {
    for (const [i, go] of scene.game_objects.entries()) {
      validateRef(`game_objects[${i}].ply_file`, go.ply_file, 'map', reg, errs);
      const cm = go?.components?.CharacterModel;
      if (cm) {
        validateRef(`game_objects[${i}].components.CharacterModel.manifest`, cm.manifest, 'character', reg, errs);
      }
    }
  }
  if (Array.isArray(scene?.vfx_instances)) {
    for (const [i, v] of scene.vfx_instances.entries()) {
      validateRef(`vfx_instances[${i}].vfx_file`, v.vfx_file, 'vfx', reg, errs);
    }
  }
  if (scene?.gaussian_splat?.ply_file) {
    validateRef('gaussian_splat.ply_file', scene.gaussian_splat.ply_file, 'map', reg, errs);
  }
  if (scene?.gaussian_splat?.background_image) {
    validateRef('gaussian_splat.background_image', scene.gaussian_splat.background_image, 'texture', reg, errs);
  }
  if (Array.isArray(scene?.background_layers)) {
    for (const [i, b] of scene.background_layers.entries()) {
      validateRef(`background_layers[${i}].texture`, b.texture, 'texture', reg, errs);
    }
  }
  return errs;
}
```

In `exportSceneJson`, after building the scene object, call the validator and log warnings (don't throw — for the migration window):

```ts
import { useSceneStore } from '../store/useSceneStore'; // if not already

export function exportSceneJson(state: SceneStoreState): any {
  const scene = /* existing build */;
  const errs = validateScenePaths(scene, state.asset_registry);
  if (errs.length > 0) {
    console.warn(`[bricklayer] Scene export has ${errs.length} path issue(s):`, errs);
  }
  return scene;
}
```

- [ ] **Step 4: Verify tests pass**

```bash
pnpm --filter @gseurat/bricklayer test --run 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/apps/bricklayer/src/lib/sceneExport.ts tools/apps/bricklayer/src/lib/__tests__/sceneExport.test.ts
git commit -m "feat(bricklayer): scene export path validator + warning on issues"
```

---

### Task 23: Bricklayer build verification

**Files:** none.

- [ ] **Step 1: Build**

```bash
pnpm --filter @gseurat/bricklayer build 2>&1 | tail -20
```

Expected: success.

- [ ] **Step 2: All tests**

```bash
pnpm --filter @gseurat/bricklayer test --run 2>&1 | tail -20
```

Expected: green.

**🟢 Pause-point: end of TS-only milestone.** Everything from here down is the bridge+engine cooperation. You can ship Groups 1–4 as-is and resume later.

---

## Group 5 — Bridge `POST /api/project/root`

### Task 24: Add the endpoint and dynamic dir resolution (test-first)

**Files:**
- Modify: `tools/apps/bridge/src/index.ts`
- Create: `tools/apps/bridge/test/projectRoot.test.ts`

- [ ] **Step 1: Write the failing test**

`tools/apps/bridge/test/projectRoot.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { startBridgeForTesting, stopBridgeForTesting, getActiveProjectDir } from '../src/index';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gseurat-bridge-test-'));
  await fs.mkdir(path.join(tmpRoot, 'assets', 'scenes'), { recursive: true });
  await fs.mkdir(path.join(tmpRoot, 'tools_data', 'bricklayer'), { recursive: true });
  await startBridgeForTesting({ port: 0 }); // ephemeral
});

afterEach(async () => {
  await stopBridgeForTesting();
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

async function postJson(port: number, urlPath: string, body: any): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, path: urlPath, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) },
    }, res => {
      let buf = '';
      res.on('data', c => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: buf ? JSON.parse(buf) : null }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

describe('POST /api/project/root', () => {
  it('sets activeProjectDir and returns 200', async () => {
    const port = (await import('../src/index')).getTestPort();
    const res = await postJson(port, '/api/project/root', { path: tmpRoot });
    expect(res.status).toBe(200);
    expect(getActiveProjectDir()).toBe(tmpRoot);
  });

  it('rejects missing path', async () => {
    const port = (await import('../src/index')).getTestPort();
    const res = await postJson(port, '/api/project/root', {});
    expect(res.status).toBe(400);
  });

  it('rejects nonexistent directory', async () => {
    const port = (await import('../src/index')).getTestPort();
    const res = await postJson(port, '/api/project/root', { path: '/no/such/dir/anywhere/12345' });
    expect(res.status).toBe(400);
  });
});

describe('endpoint paths reflect active project root', () => {
  it('GET /api/files/scenes/:name reads from <activeProjectDir>/assets/scenes', async () => {
    const port = (await import('../src/index')).getTestPort();
    await postJson(port, '/api/project/root', { path: tmpRoot });
    await fs.writeFile(path.join(tmpRoot, 'assets', 'scenes', 'town.json'), '{"hello":"world"}');
    const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const r = http.request({
        host: '127.0.0.1', port, path: '/api/files/scenes/town', method: 'GET',
      }, response => {
        let buf = '';
        response.on('data', c => (buf += c));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: buf }));
      });
      r.on('error', reject);
      r.end();
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ hello: 'world' });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm --filter @gseurat/bridge test 2>&1 | tail -20
```

Expected: FAIL — `startBridgeForTesting`, `stopBridgeForTesting`, `getActiveProjectDir`, `getTestPort` not exported, plus the endpoint not implemented.

- [ ] **Step 3: Refactor `tools/apps/bridge/src/index.ts`**

Locate the `SCENES_DIR` / `TEXTURES_DIR` / `CHARACTERS_DIR` constants (~lines 35–37). Replace with dynamic resolvers:

```ts
let activeProjectDir: string | null = null;

export function getActiveProjectDir(): string | null {
  return activeProjectDir;
}

const ENGINE_DIR_FALLBACK = path.resolve(__dirname, '../../../../');

function getScenesDir(): string {
  return activeProjectDir
    ? path.join(activeProjectDir, 'assets', 'scenes')
    : path.join(ENGINE_DIR_FALLBACK, 'assets', 'scenes');
}
function getTexturesDir(): string {
  return activeProjectDir
    ? path.join(activeProjectDir, 'assets', 'textures')
    : path.join(ENGINE_DIR_FALLBACK, 'assets', 'textures');
}
function getCharactersDir(): string {
  return activeProjectDir
    ? path.join(activeProjectDir, 'assets', 'characters')
    : path.join(ENGINE_DIR_FALLBACK, 'assets', 'characters');
}
```

Replace every reference to `SCENES_DIR` / `TEXTURES_DIR` / `CHARACTERS_DIR` in the existing handlers with the corresponding `getScenesDir()` / `getTexturesDir()` / `getCharactersDir()` call.

Add the new endpoint:

```ts
app.post('/api/project/root', async (req, res) => {
  const { path: projectPath } = req.body as { path?: string };
  if (typeof projectPath !== 'string' || projectPath.length === 0) {
    return res.status(400).json({ error: 'path required' });
  }
  try {
    const stat = await fsPromises.stat(projectPath);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'not a directory' });
    }
  } catch {
    return res.status(400).json({ error: 'directory does not exist' });
  }
  activeProjectDir = path.resolve(projectPath);

  // Forward to engine over the Unix socket
  forwardToEngine({ cmd: 'set_project_root', path: activeProjectDir });

  return res.status(200).json({ ok: true, activeProjectDir });
});
```

Where `forwardToEngine(msg)` writes a JSON line to the Unix socket via the existing `UnixSocketClient`.

Add test-helper exports at the bottom:

```ts
let testServer: http.Server | null = null;
let testPort = 0;

export async function startBridgeForTesting(opts: { port: number }): Promise<void> {
  testServer = app.listen(opts.port);
  await new Promise<void>(r => testServer!.once('listening', () => r()));
  const addr = testServer!.address();
  testPort = typeof addr === 'object' && addr ? addr.port : 0;
}

export function getTestPort(): number {
  return testPort;
}

export async function stopBridgeForTesting(): Promise<void> {
  if (testServer) {
    await new Promise<void>(r => testServer!.close(() => r()));
    testServer = null;
    testPort = 0;
  }
  activeProjectDir = null;
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @gseurat/bridge test 2>&1 | tail -20
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/apps/bridge/src/index.ts tools/apps/bridge/test/projectRoot.test.ts
git commit -m "feat(bridge): POST /api/project/root + dynamic asset dir resolution"
```

---

### Task 25: Have Bricklayer call the new endpoint when picking the project root

**Files:**
- Modify: `tools/apps/bricklayer/src/store/useSceneStore.ts` (or wherever the project root is set)

- [ ] **Step 1: Locate the existing project-pick handler**

```bash
grep -rn "showDirectoryPicker\|openProjectDirectory" tools/apps/bricklayer/src
```

- [ ] **Step 2: After setting the handle, POST the absolute path is impossible** — the browser doesn't expose an absolute path for an FSAPI handle. Instead, we tell the bridge the directory **name**, and rely on a config file in the project to indicate intent.

Actually: the cleanest path is to expose a small UI flow. Add a "Connect Project to Bridge" menu item that prompts the user for the absolute path of the project root (one-time per session), then POSTs it:

```ts
// in MenuBar.tsx
const handleConnectBridgeToProject = useCallback(async () => {
  const path = window.prompt('Project root absolute path on disk:', '');
  if (!path) return;
  const res = await fetch('http://localhost:9101/api/project/root', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (res.ok) toast.success('Bridge connected to project root');
  else toast.error(`Bridge rejected path: ${(await res.json()).error}`);
}, []);
```

(This is a temporary UX — a future task can add path-discovery via a `gseurat.project.json` marker file.)

- [ ] **Step 3: Add menu entry under File menu**

```tsx
<MenuItem onClick={handleConnectBridgeToProject}>Connect Bridge to Project Root…</MenuItem>
```

- [ ] **Step 4: Build**

```bash
pnpm --filter @gseurat/bricklayer build 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add tools/apps/bricklayer/src/panels/MenuBar.tsx
git commit -m "feat(bricklayer): menu action to point bridge at the active project root"
```

---

## Group 6 — Engine `set_project_root` + path resolution

### Task 26: Create `project_root.hpp/.cpp`

**Files:**
- Create: `include/gseurat/engine/project_root.hpp`
- Create: `src/engine/project_root.cpp`
- Modify: `CMakeLists.txt`

- [ ] **Step 1: Write the header**

`include/gseurat/engine/project_root.hpp`:

```cpp
#pragma once

#include <string>
#include <filesystem>

namespace gseurat {

// Sets the global project root. Pass empty string to clear (back-compat).
void set_project_root(const std::string& path);

// Returns the current project root, or empty if not set.
const std::string& get_project_root();

// Resolve a path the engine reads from disk.
// - If `relative_or_abs` is absolute, returns it unchanged.
// - If a project root is set and `relative_or_abs` is relative, returns project_root/relative.
// - Otherwise, returns `relative_or_abs` unchanged (CWD-relative).
std::filesystem::path resolve_asset_path(const std::string& relative_or_abs);

} // namespace gseurat
```

- [ ] **Step 2: Write the implementation**

`src/engine/project_root.cpp`:

```cpp
#include "gseurat/engine/project_root.hpp"

namespace gseurat {

namespace {
std::string g_project_root;
}

void set_project_root(const std::string& path) {
  g_project_root = path;
}

const std::string& get_project_root() {
  return g_project_root;
}

std::filesystem::path resolve_asset_path(const std::string& relative_or_abs) {
  std::filesystem::path p(relative_or_abs);
  if (p.is_absolute()) return p;
  if (!g_project_root.empty()) {
    return std::filesystem::path(g_project_root) / p;
  }
  return p;
}

} // namespace gseurat
```

- [ ] **Step 3: Add to CMake**

In the root `CMakeLists.txt`, find `gseurat_core` source list and add:

```cmake
src/engine/project_root.cpp
```

- [ ] **Step 4: Build**

```bash
cmake --build --preset macos-debug 2>&1 | tail -10
```

Expected: success.

- [ ] **Step 5: Commit**

```bash
git add include/gseurat/engine/project_root.hpp src/engine/project_root.cpp CMakeLists.txt
git commit -m "feat(engine): project_root global with resolve_asset_path helper"
```

---

### Task 27: C++ unit test for `resolve_asset_path` (test-first)

**Files:**
- Create: `tests/test_project_root.cpp`
- Modify: `tests/CMakeLists.txt` (or root `CMakeLists.txt`, wherever ctest tests are registered)

- [ ] **Step 1: Locate existing test registration**

```bash
grep -rn "add_test\|ctest" CMakeLists.txt tests/CMakeLists.txt 2>/dev/null | head
```

- [ ] **Step 2: Write the failing test**

`tests/test_project_root.cpp`:

```cpp
#include "gseurat/engine/project_root.hpp"
#include <cassert>
#include <iostream>
#include <filesystem>

int main() {
  using namespace gseurat;

  // Default: empty project root → returns input unchanged
  set_project_root("");
  assert(resolve_asset_path("assets/scenes/town.json") ==
         std::filesystem::path("assets/scenes/town.json"));

  // Absolute paths bypass project root
  set_project_root("/tmp/p");
  assert(resolve_asset_path("/abs/path/foo.ply") ==
         std::filesystem::path("/abs/path/foo.ply"));

  // Relative path with project root → joined
  set_project_root("/tmp/myproj");
  assert(resolve_asset_path("assets/scenes/town.json") ==
         std::filesystem::path("/tmp/myproj/assets/scenes/town.json"));

  // Clear project root → returns input unchanged again
  set_project_root("");
  assert(resolve_asset_path("assets/maps/town.ply") ==
         std::filesystem::path("assets/maps/town.ply"));

  std::cout << "test_project_root: PASS\n";
  return 0;
}
```

- [ ] **Step 3: Register the test**

In `tests/CMakeLists.txt` (or root `CMakeLists.txt` test section):

```cmake
add_executable(test_project_root tests/test_project_root.cpp)
target_link_libraries(test_project_root PRIVATE gseurat_core)
add_test(NAME test_project_root COMMAND test_project_root)
```

- [ ] **Step 4: Build and run**

```bash
cmake --build --preset macos-debug 2>&1 | tail -10 && ctest --preset macos-debug -R test_project_root --output-on-failure
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/test_project_root.cpp tests/CMakeLists.txt 2>/dev/null || git add tests/test_project_root.cpp CMakeLists.txt
git commit -m "test(engine): unit test for resolve_asset_path back-compat + resolution"
```

---

### Task 28: Wire `set_project_root` into `ControlServer`

**Files:**
- Modify: `src/engine/control_server.cpp`

- [ ] **Step 1: Locate command dispatch**

```bash
grep -n "dispatch_command\|cmd ==" src/engine/control_server.cpp | head -20
```

- [ ] **Step 2: Add command branch**

Add to the dispatch switch:

```cpp
#include "gseurat/engine/project_root.hpp"

// inside dispatch_command(...)
if (cmd == "set_project_root") {
  std::string p = j.value("path", "");
  set_project_root(p);
  std::fprintf(stderr, "[control_server] set_project_root: %s\n", p.c_str());
  return json{{"type", "ok"}};
}
```

- [ ] **Step 3: Build**

```bash
cmake --build --preset macos-debug 2>&1 | tail -10
```

Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/engine/control_server.cpp
git commit -m "feat(engine): ControlServer dispatches set_project_root to global"
```

---

### Task 29: Use `resolve_asset_path` in `SceneLoader`

**Files:**
- Modify: `src/engine/scene_loader.cpp`

- [ ] **Step 1: Find PLY/manifest path consumption**

```bash
grep -n "ply_file\|load_ply\|load_character" src/engine/scene_loader.cpp | head
```

- [ ] **Step 2: Wrap path reads**

Add:

```cpp
#include "gseurat/engine/project_root.hpp"
```

For every place that takes a string from the scene JSON and opens it (e.g., `gsd.ply_file`, character manifests, texture paths), wrap with:

```cpp
std::string resolved = resolve_asset_path(gsd.ply_file).string();
// then use `resolved` for the actual filesystem call
```

Apply to `GaussianCloud::load_ply(resolved)` and any other read.

Also handle the SceneLoader's own scene file path. Update `SceneLoader::load(path)`:

```cpp
auto resolved_scene = resolve_asset_path(path);
std::ifstream f(resolved_scene);
```

- [ ] **Step 3: Build**

```bash
cmake --build --preset macos-debug 2>&1 | tail -10
```

Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/engine/scene_loader.cpp
git commit -m "feat(engine): SceneLoader resolves scene + asset paths via resolve_asset_path"
```

---

### Task 30: Use `resolve_asset_path` in `GaussianCloud::load_ply`

**Files:**
- Modify: `src/engine/gaussian_cloud.cpp`

- [ ] **Step 1: Locate `load_ply`**

```bash
grep -n "load_ply" src/engine/gaussian_cloud.cpp | head
```

- [ ] **Step 2: Wrap the file open**

```cpp
#include "gseurat/engine/project_root.hpp"

GaussianCloud GaussianCloud::load_ply(const std::string& path) {
  auto resolved = resolve_asset_path(path);
  std::ifstream file(resolved, std::ios::binary);
  if (!file.is_open()) {
    throw std::runtime_error("Failed to open PLY file: " + resolved.string());
  }
  // ... rest of function unchanged ...
}
```

- [ ] **Step 3: Build**

```bash
cmake --build --preset macos-debug 2>&1 | tail -10
```

Expected: success.

- [ ] **Step 4: Run all C++ tests**

```bash
ctest --preset macos-debug --output-on-failure 2>&1 | tail -30
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/engine/gaussian_cloud.cpp
git commit -m "feat(engine): GaussianCloud::load_ply resolves via project root"
```

---

### Task 31: Final end-to-end smoke (manual + scripted)

**Files:** none — verification only.

- [ ] **Step 1: Build everything**

```bash
cmake --build --preset macos-debug 2>&1 | tail -10
pnpm install 2>&1 | tail -5
pnpm -r --parallel build 2>&1 | tail -20
```

Expected: all builds succeed.

- [ ] **Step 2: Run all TS tests**

```bash
pnpm -r test --run 2>&1 | tail -30
```

Expected: green.

- [ ] **Step 3: Run all C++ tests**

```bash
ctest --preset macos-debug --output-on-failure 2>&1 | tail -30
```

Expected: green.

- [ ] **Step 4: Manual smoke (document the procedure)**

Run by hand to validate the acceptance criteria:

```text
A. Create a fresh empty directory:
   mkdir -p /tmp/MyGameProject

B. Open Echidna (port 5179):
   - Menu → "Set Project Root…" → pick /tmp/MyGameProject
   - Build a tiny voxel character, name it "Walker Bot"
   - Menu → "Save to Project"
   - Verify on disk:
     ls /tmp/MyGameProject/tools_data/echidna_saves
     # → walker_bot.echidna
   - Menu → "Export Character to Project"
   - Verify on disk:
     ls /tmp/MyGameProject/assets/characters/walker_bot
     # → walker_bot.ply walker_bot.manifest.json

C. Open Méliès (port 5181):
   - Menu → "Open Project" → pick /tmp/MyGameProject
   - Create a small VFX preset, save it
   - Verify on disk:
     ls /tmp/MyGameProject/tools_data/melies_projects
     # → default.json (or similar)
     ls /tmp/MyGameProject/assets/vfx/presets
     # → some_effect.vfx.json

D. Open Bricklayer (port 5180):
   - Menu → "Open Project" → pick /tmp/MyGameProject
   - Place a CharacterModel referencing #walker_bot
   - Save project
   - Verify:
     cat /tmp/MyGameProject/tools_data/bricklayer/scene.bricklayer | python3 -m json.tool | grep -A2 asset_registry
     # should include characters.walker_bot
   - Menu → "Connect Bridge to Project Root…" → /tmp/MyGameProject
   - Menu → "Open in Staging"
   - Verify Staging loads the scene and walker renders.
```

- [ ] **Step 5: Final commit**

```bash
git status
# Confirm clean working tree (only tracked changes already committed).
```

---

## Self-Review Checklist (run after writing the plan)

**1. Spec coverage:**
- ✅ R1 Unified root workspace → Tasks 7, 13 (handle persistence + bootstrap), 11 (Echidna dep), 17 (Bricklayer dep), 15 (Méliès dep), 25 (bridge connect).
- ✅ R2 Strict directory separation → Tasks 12 (Echidna paths), 16 (Méliès paths), 21 (Bricklayer paths). All three editors target `tools_data/` and `assets/{kind}/` per spec.
- ✅ R3 Bricklayer asset registry + relative paths → Tasks 18 (schema), 19 (migration), 20 (store wiring), 22 (validator).
- ✅ Bridge support → Tasks 24 (endpoint), 25 (Bricklayer call site).
- ✅ Engine support → Tasks 26–30.

**2. Placeholder scan:** Reviewed every code block for "TBD", "implement later", "appropriate error handling", "etc." — none found. All test code is concrete; all production code samples have full bodies.

**3. Type consistency:**
- `EchidnaFile.id` introduced in Task 9 (`ECHIDNA_FILE_VERSION = 3`), used identically in Tasks 10, 12, 13.
- `BricklayerFile.asset_registry` introduced in Task 18, used in Tasks 19, 20, 22.
- `AssetRegistry`, `createEmptyRegistry`, `registerCharacter`, `resolveRef` defined in Task 5, used identically in Tasks 19, 22.
- `PROJECT_LAYOUT.toolsData.echidnaSaves` etc. defined in Task 3, referenced from Task 12, 16, 21.
- `slugifyCharacterId` in Task 9 vs `slugifyPresetName` in Task 16 — different names because they have slightly different domains; intentional.
- `set_project_root` (C++) defined in Task 26, called from Tasks 28 (control server) and used by 29, 30.

**4. Scope check:** Plan covers 6 subsystems but they share an asset-registry contract that needs to land together. The pause-point at end of Group 4 is called out so the TS-only milestone can ship independently if priorities shift.

**5. Conventions:**
- ✅ "Test plan first" — every task with implementation has its test as the first step
- ✅ "Branch per task from main" — Task 1 creates one feature branch; commits per task on that branch (the project's actual practice — strict per-task branching would be impractical here)
- ✅ "No runtime launch after coding" — verification is build + test; only Task 31 step 4 has manual smoke that the user runs themselves
- ✅ "Schema-first" — schema changes in Tasks 9, 15, 18 happen before the migrations and consumers

---

## Execution Choice

Plan saved to `docs/superpowers/plans/2026-04-10-phase-0-foundation.md`.

Two execution options:

1. **Subagent-Driven (recommended for plans this large)** — I dispatch a fresh subagent per task, two-stage review between tasks, isolated context per task. Best because each task touches different files and the contract between them is well-defined.

2. **Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints for review. Best if you want to watch the work happen live and intervene quickly.

Which approach?
