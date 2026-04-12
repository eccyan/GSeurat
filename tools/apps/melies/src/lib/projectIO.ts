import { useVfxStore } from '../store/useVfxStore.js';
import { serializeVfx } from './vfxExport.js';
import type { VfxProject } from '../store/types.js';
import { VFX_PROJECT_VERSION } from '../store/types.js';
import {
  PROJECT_LAYOUT,
  ensureSubdir,
  writeFileAtPath,
  readFileAtPath,
} from '@gseurat/project-root';

/**
 * Check if the File System Access API is available.
 */
export function hasFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/**
 * Open a project directory.
 */
export async function openProjectDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!hasFileSystemAccess()) return null;
  try {
    return await (window as any).showDirectoryPicker({ mode: 'readwrite' });
  } catch {
    return null;
  }
}

/* ----- path builders ----- */

/**
 * Slugify a project or preset name into a stable filename fragment.
 * Rules: lowercase, trim, whitespace→underscore, strip non-[a-z0-9_-], fallback 'project'.
 */
export function slugifyProjectName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '');
  return cleaned.length > 0 ? cleaned : 'project';
}

export function meliesProjectPath(projectName: string): string {
  return `${PROJECT_LAYOUT.toolsData.melies}/${slugifyProjectName(projectName)}.json`;
}

export function vfxPresetPath(presetName: string): string {
  return `${PROJECT_LAYOUT.assets.vfxPresets}/${slugifyProjectName(presetName)}.vfx.json`;
}

/**
 * Save all presets to the project directory.
 *
 * New structure (Phase 0):
 * <project-root>/
 * ├── tools_data/melies_projects/{slug}.json   # project state
 * ├── assets/vfx/presets/{slug}.vfx.json       # per-preset VFX files
 * └── scene/                                    # PLY imports (unchanged)
 */
export async function saveProject(handle: FileSystemDirectoryHandle): Promise<void> {
  const store = useVfxStore.getState();
  const projectData = store.saveProjectData();
  const projectName = store.projectName || 'project';

  // 1. Project state under tools_data/melies_projects/
  await ensureSubdir(handle, PROJECT_LAYOUT.toolsData.melies);
  await writeFileAtPath(
    handle,
    meliesProjectPath(projectName),
    JSON.stringify(projectData, null, 2),
  );

  // 2. Each preset under assets/vfx/presets/
  await ensureSubdir(handle, PROJECT_LAYOUT.assets.vfxPresets);
  for (const preset of store.presets) {
    await writeFileAtPath(handle, vfxPresetPath(preset.name), serializeVfx(preset));
  }

  // 3. Keep the legacy scene/ dir for PLY imports (not migrated in this phase)
  await handle.getDirectoryHandle('scene', { create: true });
}

/**
 * Copy a PLY file into the project's scene/ directory and return the relative path.
 */
export async function copyPlyToProject(handle: FileSystemDirectoryHandle, file: File): Promise<string> {
  const sceneDir = await handle.getDirectoryHandle('scene', { create: true });
  const fh = await sceneDir.getFileHandle(file.name, { create: true });
  const w = await fh.createWritable();
  await w.write(file);
  await w.close();
  return `scene/${file.name}`;
}

/**
 * Load a PLY file from the project's scene/ directory.
 */
export async function loadPlyFromProject(handle: FileSystemDirectoryHandle, relativePath: string): Promise<File | null> {
  try {
    // relativePath is like "scene/blub.ply"
    const parts = relativePath.split('/');
    let dir: FileSystemDirectoryHandle = handle;
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i]);
    }
    const fh = await dir.getFileHandle(parts[parts.length - 1]);
    return await fh.getFile();
  } catch {
    return null;
  }
}

/**
 * Scan tools_data/melies_projects/ for the first .json file and return its
 * project name (filename without extension). Returns null if the directory
 * doesn't exist or contains no .json files.
 */
async function findFirstMeliesProject(
  handle: FileSystemDirectoryHandle,
): Promise<string | null> {
  try {
    const parts = PROJECT_LAYOUT.toolsData.melies.split('/');
    let dir: FileSystemDirectoryHandle = handle;
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part);
    }
    type DirChild = { kind: string; name: string };
    const iter = (dir as unknown as { values(): AsyncIterable<DirChild> }).values();
    for await (const child of iter) {
      if (child.kind === 'file' && child.name.endsWith('.json')) {
        return child.name.replace(/\.json$/, '');
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Load a project from a project directory.
 * 1. Try tools_data/melies_projects/{projectName}.json
 * 2. If not found, scan tools_data/melies_projects/ for any .json file
 * 3. Fall back to root-level project.json for back-compat with old saves
 * 4. If nothing found, return false (first time opening)
 */
export async function loadProject(
  handle: FileSystemDirectoryHandle,
  projectName: string,
): Promise<boolean> {
  try {
    let text: string;
    let loadedName = projectName;
    try {
      // Try the named project first
      const blob = await readFileAtPath(handle, meliesProjectPath(projectName));
      text = await (blob as Blob).text();
    } catch {
      // Named project not found — scan for any project in the directory
      const found = await findFirstMeliesProject(handle);
      if (found) {
        console.info(`[melies] Project "${projectName}" not found, loading "${found}" instead`);
        const blob = await readFileAtPath(handle, meliesProjectPath(found));
        text = await (blob as Blob).text();
        loadedName = found;
      } else {
        // No projects in melies_projects/ — try legacy project.json
        try {
          console.info('[melies] No projects in melies_projects/, trying legacy project.json');
          const fh = await handle.getFileHandle('project.json');
          const legacy = await fh.getFile();
          text = await legacy.text();
        } catch (e2) {
          if ((e2 as Error).name === 'NotFoundError') {
            console.info('[melies] No existing project found — starting fresh');
            return false;
          }
          throw e2;
        }
      }
    }
    const raw = JSON.parse(text);
    const data = migrateVfxProject(raw);
    if ((raw?.version ?? 0) < VFX_PROJECT_VERSION) {
      console.warn(`[melies] Loaded legacy v${raw?.version} project; migrated to v${VFX_PROJECT_VERSION}`);
    }
    useVfxStore.getState().loadProjectData(data);
    // Update projectName to match what was actually loaded
    if (loadedName !== projectName) {
      useVfxStore.getState().setProjectName(loadedName);
    }
    return true;
  } catch (err) {
    console.error('Failed to load VFX project:', err);
    return false;
  }
}

/**
 * Fallback: download project as single JSON file.
 */
export function downloadProject(): void {
  const store = useVfxStore.getState();
  const data = store.saveProjectData();
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${store.projectName || 'project'}.vfx-project.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Fallback: load project from uploaded JSON file.
 */
export async function uploadProject(file: File): Promise<boolean> {
  try {
    const text = await file.text();
    const raw = JSON.parse(text);
    const data = migrateVfxProject(raw);
    useVfxStore.getState().loadProjectData(data);
    return true;
  } catch {
    return false;
  }
}

/**
 * Migrate project data from older versions.
 * v1 → v3: remove phases from presets, convert layer.phase to tags.
 * v2+ → v3: coerce version number to current.
 */
export function migrateVfxProject(data: Record<string, unknown>): VfxProject {
  const version = (data.version as number) ?? 1;
  if (version >= 2) return { ...data, version: VFX_PROJECT_VERSION } as unknown as VfxProject;

  // v1 → v3 migration (layers → elements, drops phases)
  const presets = (data.presets as Record<string, unknown>[]) ?? [];
  return {
    version: VFX_PROJECT_VERSION,
    presets: presets.map((p) => {
      const layers = (p.layers as Record<string, unknown>[]) ?? [];
      const { phases: _, ...rest } = p;
      return {
        ...rest,
        layers: layers.map((l) => {
          const phase = l.phase as string | undefined;
          const tags = phase && phase !== 'custom' ? [phase] : undefined;
          const { phase: __, ...layerRest } = l;
          return { ...layerRest, ...(tags ? { tags } : {}) };
        }),
      };
    }),
  } as unknown as VfxProject;
}

// Legacy alias — kept so any internal callers (uploadProject) don't break.
// Also exported so external consumers that imported migrateProject can still work.
export const migrateProject = migrateVfxProject;

/**
 * List all .ply filenames in assets/objects/.
 * Returns an array of filenames (e.g., ['crystal.ply', 'barrel.ply']).
 * Returns [] if the directory doesn't exist.
 */
export async function listObjectPlys(
  handle: FileSystemDirectoryHandle,
): Promise<string[]> {
  let dir: FileSystemDirectoryHandle;
  try {
    const assets = await handle.getDirectoryHandle('assets');
    dir = await assets.getDirectoryHandle('objects');
  } catch (e) {
    if ((e as Error).name === 'NotFoundError') return [];
    throw e;
  }

  type DirChild = { kind: string; name: string };
  const iter = (dir as unknown as { values(): AsyncIterable<DirChild> }).values();
  const names: string[] = [];
  for await (const child of iter) {
    if (child.kind === 'file' && child.name.endsWith('.ply')) {
      names.push(child.name);
    }
  }
  return names;
}
