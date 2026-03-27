import { useVfxStore } from '../store/useVfxStore.js';
import { serializeVfx } from './vfxExport.js';
import type { VfxProject } from '../store/types.js';

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

/**
 * Save all presets to the project directory.
 *
 * Structure:
 * my_project/
 * ├── project.json          # Project manifest with all presets
 * ├── effects/
 * │   ├── preset_1.vfx.json # Individual VFX files
 * │   └── preset_2.vfx.json
 * └── scene/                # (for future PLY import)
 */
export async function saveProject(handle: FileSystemDirectoryHandle): Promise<void> {
  const store = useVfxStore.getState();
  const projectData = store.saveProjectData();

  // Write project.json manifest
  const manifestHandle = await handle.getFileHandle('project.json', { create: true });
  const mw = await manifestHandle.createWritable();
  await mw.write(JSON.stringify(projectData, null, 2));
  await mw.close();

  // Write individual VFX files to effects/ directory
  const effectsDir = await handle.getDirectoryHandle('effects', { create: true });
  for (const preset of store.presets) {
    const fileName = `${preset.name.replace(/\s+/g, '_').toLowerCase()}.vfx.json`;
    const vfxJson = serializeVfx(preset);
    const fh = await effectsDir.getFileHandle(fileName, { create: true });
    const w = await fh.createWritable();
    await w.write(vfxJson);
    await w.close();
  }

  // Create scene/ directory (for future PLY import)
  await handle.getDirectoryHandle('scene', { create: true });
}

/**
 * Load a project from a project directory.
 */
export async function loadProject(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    const fileHandle = await handle.getFileHandle('project.json');
    const file = await fileHandle.getFile();
    const text = await file.text();
    const data = JSON.parse(text) as VfxProject;
    useVfxStore.getState().loadProjectData(data);
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
    const data = JSON.parse(text) as VfxProject;
    useVfxStore.getState().loadProjectData(data);
    return true;
  } catch {
    return false;
  }
}
