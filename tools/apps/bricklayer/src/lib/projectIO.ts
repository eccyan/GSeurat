import JSZip from 'jszip';
import { useSceneStore, BUILTIN_SCHEMAS } from '../store/useSceneStore.js';
import { exportSceneJson } from './sceneExport.js';
import { exportPly } from './plyExport.js';
import type { BricklayerFile, ComponentSchema } from '../store/types.js';
import {
  PROJECT_LAYOUT,
  toAssetPath,
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
 * Open a project directory and set it as the project handle.
 */
export async function openProjectDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!hasFileSystemAccess()) return null;
  try {
    const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
    return handle;
  } catch {
    return null; // user cancelled
  }
}

/* ----- path builders ----- */

/**
 * Slugify a name into a stable filename fragment.
 * Same rules as echidna/melies — lowercase, trim, whitespace → underscore,
 * strip [^a-z0-9_-], fallback if empty.
 */
function slugify(name: string, fallback = 'project'): string {
  const cleaned = name.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '');
  return cleaned.length > 0 ? cleaned : fallback;
}

/** Returns the project-relative path for the Bricklayer save file. */
export function bricklayerSavePath(): string {
  return `${PROJECT_LAYOUT.toolsData.bricklayer}/scene.bricklayer`;
}

/** Returns the project-relative path for the engine scene JSON. */
export function engineScenePath(projectName: string): string {
  return toAssetPath('scenes', `${slugify(projectName)}.json`);
}

/** Returns the project-relative path for the terrain PLY. */
export function terrainPlyPath(projectName: string): string {
  return toAssetPath('maps', `${slugify(projectName)}.ply`);
}

/** Returns the project-relative path for a VFX preset file. */
export function vfxPresetPath(presetName: string): string {
  return `${PROJECT_LAYOUT.assets.vfxPresets}/${slugify(presetName, 'preset')}.vfx.json`;
}

/**
 * Save the current project to the project directory.
 *
 * New structure (Phase 0):
 * <project-root>/
 * ├── tools_data/bricklayer/scene.bricklayer   # Bricklayer save file
 * ├── assets/scenes/{slug}.json                # engine scene JSON
 * ├── assets/maps/{slug}.ply                   # terrain PLY
 * ├── assets/vfx/presets/{slug}.vfx.json       # VFX instance presets
 * └── assets/**                                # imported asset blobs
 */
export async function saveProject(handle: FileSystemDirectoryHandle): Promise<void> {
  const store = useSceneStore.getState();
  const projectName = store.projectName || 'project';

  // 1. Bricklayer save file under tools_data/bricklayer/
  const data = store.saveProject();
  const json = JSON.stringify(data, null, 2);
  await ensureSubdir(handle, PROJECT_LAYOUT.toolsData.bricklayer);
  await writeFileAtPath(handle, bricklayerSavePath(), json);

  // 2. Engine scene JSON under assets/scenes/
  const sceneJson = JSON.stringify(exportSceneJson(store), null, 2);
  await ensureSubdir(handle, PROJECT_LAYOUT.assets.scenes);
  await writeFileAtPath(handle, engineScenePath(projectName), sceneJson);

  // 3. Terrain PLY under assets/maps/
  if (store.voxels.size > 0) {
    const plyBlob = exportPly(store.voxels, store.gridWidth, store.gridDepth);
    await ensureSubdir(handle, PROJECT_LAYOUT.assets.maps);
    await writeFileAtPath(handle, terrainPlyPath(projectName), plyBlob);
  }

  // 4. Asset blobs from assetBlobs Map (paths already under assets/)
  if (store.assetBlobs.size > 0) {
    for (const [path, blob] of store.assetBlobs) {
      // Only write paths that are under assets/ for safety
      if (!path.startsWith('assets/')) continue;
      await writeFileAtPath(handle, path, blob);
    }
  }

  // 5. VFX instance preset files under assets/vfx/presets/
  if (store.vfxInstances.length > 0) {
    await ensureSubdir(handle, PROJECT_LAYOUT.assets.vfxPresets);
    for (const inst of store.vfxInstances) {
      // Re-serialize the preset data (applies any name edits)
      const out: Record<string, unknown> = {
        name: inst.name,
        elements: inst.vfx_preset.elements,
      };
      if (inst.vfx_preset.duration !== undefined) out.duration = inst.vfx_preset.duration;
      if (inst.vfx_preset.category) out.category = inst.vfx_preset.category;
      const vfxJson = JSON.stringify(out, null, 2);
      const newPath = vfxPresetPath(inst.name);
      await writeFileAtPath(handle, newPath, vfxJson);
      // Update vfx_file path if name/path changed
      if (inst.vfx_file !== newPath) {
        store.updateVfxInstance(inst.id, { vfx_file: newPath });
      }
    }
  }
}

/**
 * Load a project from the project directory.
 * Reads from tools_data/bricklayer/scene.bricklayer (new layout).
 * Falls back to root-level scene.bricklayer for back-compat with old saves.
 */
export async function loadProject(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    let text: string;
    try {
      // New path: tools_data/bricklayer/scene.bricklayer
      const blob = await readFileAtPath(handle, bricklayerSavePath());
      text = await blob.text();
    } catch {
      // Legacy fallback: root-level scene.bricklayer
      console.warn('[bricklayer] No scene.bricklayer at new path, falling back to legacy root');
      const fh = await handle.getFileHandle('scene.bricklayer');
      const legacy = await fh.getFile();
      text = await legacy.text();
    }
    const data = JSON.parse(text) as BricklayerFile;
    useSceneStore.getState().loadProject(data);

    // Load component schemas from project
    try {
      const assetsDir = await handle.getDirectoryHandle('assets').catch(() => null);
      const componentsDir = assetsDir ? await assetsDir.getDirectoryHandle('components').catch(() => null) : null;
      if (componentsDir) {
        const schemas: ComponentSchema[] = [];
        for await (const entry of (componentsDir as any).values()) {
          if (entry.kind === 'file' && entry.name.endsWith('.schema.json')) {
            const schemaFile = await entry.getFile();
            const schemaText = await schemaFile.text();
            try { schemas.push(JSON.parse(schemaText)); } catch {}
          }
        }
        if (schemas.length > 0) {
          useSceneStore.getState().loadComponentSchemas(schemas);
        } else {
          useSceneStore.getState().loadComponentSchemas(BUILTIN_SCHEMAS);
        }
      } else {
        useSceneStore.getState().loadComponentSchemas(BUILTIN_SCHEMAS);
      }
    } catch {
      useSceneStore.getState().loadComponentSchemas(BUILTIN_SCHEMAS);
    }

    return true;
  } catch (err) {
    console.error('Failed to load project:', err);
    return false;
  }
}

/**
 * Import an asset file into the project directory.
 */
export async function importAssetToProject(
  handle: FileSystemDirectoryHandle,
  file: File,
): Promise<string> {
  const assetsDir = await handle.getDirectoryHandle('assets', { create: true });
  const fileHandle = await assetsDir.getFileHandle(file.name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(file);
  await writable.close();
  return `assets/${file.name}`;
}

/**
 * Export the scene JSON to the project directory or download it.
 */
export function exportSceneJsonBlob(): Blob {
  const state = useSceneStore.getState();
  const scene = exportSceneJson(state);
  const json = JSON.stringify(scene, null, 2);
  return new Blob([json], { type: 'application/json' });
}

/**
 * Save the current project as a zip file (fallback for browsers without FSAPI).
 * Includes scene data and engine scene export.
 */
export async function saveProjectAsZip(): Promise<Blob> {
  const store = useSceneStore.getState();
  const data = store.saveProject();
  const zip = new JSZip();
  zip.file('scene.bricklayer', JSON.stringify(data, null, 2));

  // Include the engine scene export
  const scene = exportSceneJson(store);
  zip.file(`${store.projectName || 'scene'}.json`, JSON.stringify(scene, null, 2));

  // Include terrain PLY
  if (store.voxels.size > 0) {
    const plyBlob = exportPly(store.voxels, store.gridWidth, store.gridDepth);
    zip.file(`assets/maps/${store.projectName || 'map'}.ply`, plyBlob);
  }

  // Include all asset blobs (PLY files, textures, etc.)
  const assetsFolder = zip.folder('assets');
  for (const [path, blob] of store.assetBlobs) {
    const name = path.startsWith('assets/') ? path.slice(7) : path;
    assetsFolder!.file(name, blob);
  }

  return zip.generateAsync({ type: 'blob' });
}

/**
 * Load a project from a zip file (fallback for browsers without FSAPI).
 */
export async function loadProjectFromZip(file: File): Promise<boolean> {
  try {
    const zip = await JSZip.loadAsync(file);
    const sceneFile = zip.file('scene.bricklayer');
    if (!sceneFile) return false;
    const text = await sceneFile.async('text');
    const data = JSON.parse(text) as BricklayerFile;
    useSceneStore.getState().loadProject(data);

    // Restore asset blobs from zip
    const assetsFolder = zip.folder('assets');
    if (assetsFolder) {
      const store = useSceneStore.getState();
      assetsFolder.forEach((relativePath, zipEntry) => {
        if (!zipEntry.dir) {
          zipEntry.async('blob').then((blob) => {
            store.storeAssetBlob(`assets/${relativePath}`, blob);
          });
        }
      });
    }

    return true;
  } catch {
    return false;
  }
}
