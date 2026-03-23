import JSZip from 'jszip';
import { useSceneStore } from '../store/useSceneStore.js';
import { exportSceneJson } from './sceneExport.js';
import type { BricklayerFile } from '../store/types.js';

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

/**
 * Save the current project to the project directory.
 */
export async function saveProject(handle: FileSystemDirectoryHandle): Promise<void> {
  const store = useSceneStore.getState();
  const data = store.saveProject();
  const json = JSON.stringify(data, null, 2);

  const fileHandle = await handle.getFileHandle('scene.bricklayer', { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(json);
  await writable.close();

  // Write asset blobs to assets/ directory
  if (store.assetBlobs.size > 0) {
    const assetsDir = await handle.getDirectoryHandle('assets', { create: true });
    for (const [path, blob] of store.assetBlobs) {
      const name = path.startsWith('assets/') ? path.slice(7) : path;
      const assetHandle = await assetsDir.getFileHandle(name, { create: true });
      const w = await assetHandle.createWritable();
      await w.write(blob);
      await w.close();
    }
  }
}

/**
 * Load a project from the project directory.
 */
export async function loadProject(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    const fileHandle = await handle.getFileHandle('scene.bricklayer');
    const file = await fileHandle.getFile();
    const text = await file.text();
    const data = JSON.parse(text) as BricklayerFile;
    useSceneStore.getState().loadProject(data);
    return true;
  } catch {
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
  zip.file('scene.json', JSON.stringify(scene, null, 2));

  // Include all asset blobs (PLY files, textures, etc.)
  const assetsFolder = zip.folder('assets');
  for (const [path, blob] of store.assetBlobs) {
    // path is "assets/filename.ply" — strip the "assets/" prefix
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
