/**
 * File System Access API integration for Bricklayer project directories.
 *
 * The File System Access API (showDirectoryPicker) is only available in
 * Chromium-based browsers (Chrome, Edge). A feature check + fallback
 * message is provided for unsupported browsers.
 */

import type {
  ProjectManifest,
  TerrainEntry,
  AssetEntry,
  VoxelKey,
  Voxel,
  CollisionGridData,
} from '../store/types.js';

// ── Feature detection ──

export function hasFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

// ── Open directory ──

export async function openProjectDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!hasFileSystemAccess()) return null;
  try {
    return await (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker();
  } catch {
    // User cancelled or permission denied
    return null;
  }
}

// ── Helpers ──

async function getOrCreateSubDir(
  parent: FileSystemDirectoryHandle,
  name: string,
): Promise<FileSystemDirectoryHandle> {
  return parent.getDirectoryHandle(name, { create: true });
}

async function writeTextFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  content: string,
): Promise<void> {
  const fileHandle = await dir.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

async function readTextFile(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<string | null> {
  try {
    const fileHandle = await dir.getFileHandle(name);
    const file = await fileHandle.getFile();
    return await file.text();
  } catch {
    return null;
  }
}

// ── Voxel data serialization ──

interface SerializedVoxel {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

function serializeVoxels(entries: [VoxelKey, Voxel][]): SerializedVoxel[] {
  return entries.map(([key, vox]) => {
    const parts = key.split(',');
    return {
      x: Number(parts[0]),
      y: Number(parts[1]),
      z: Number(parts[2]),
      r: vox.color[0],
      g: vox.color[1],
      b: vox.color[2],
      a: vox.color[3],
    };
  });
}

function deserializeVoxels(arr: SerializedVoxel[]): [VoxelKey, Voxel][] {
  return arr.map((v) => [
    `${v.x},${v.y},${v.z}` as VoxelKey,
    { color: [v.r, v.g, v.b, v.a] },
  ]);
}

// ── Save project ──

export async function saveProject(
  handle: FileSystemDirectoryHandle,
  manifest: ProjectManifest,
  voxelDataMap: Map<string, [VoxelKey, Voxel][]>,
): Promise<void> {
  // Write project.json
  await writeTextFile(handle, 'project.json', JSON.stringify(manifest, null, 2));

  // Ensure terrains/ directory exists
  const terrainsDir = await getOrCreateSubDir(handle, 'terrains');

  // Write per-terrain voxel data files
  for (const terrain of manifest.terrains) {
    const voxelData = voxelDataMap.get(terrain.id);
    if (!voxelData) continue;

    // terrain.voxelFile is e.g. "terrains/terrain_123.bricklayer"
    const filename = terrain.voxelFile.replace(/^terrains\//, '');
    const serialized = serializeVoxels(voxelData);
    await writeTextFile(terrainsDir, filename, JSON.stringify(serialized));
  }

  // Ensure assets/ directory exists
  await getOrCreateSubDir(handle, 'assets');
}

// ── Load project ──

export async function loadProject(
  handle: FileSystemDirectoryHandle,
): Promise<{
  manifest: ProjectManifest;
  voxelDataMap: Map<string, [VoxelKey, Voxel][]>;
} | null> {
  const manifestJson = await readTextFile(handle, 'project.json');
  if (!manifestJson) return null;

  let manifest: ProjectManifest;
  try {
    manifest = JSON.parse(manifestJson) as ProjectManifest;
  } catch {
    return null;
  }

  const voxelDataMap = new Map<string, [VoxelKey, Voxel][]>();

  // Load each terrain's voxel data
  let terrainsDir: FileSystemDirectoryHandle | null = null;
  try {
    terrainsDir = await handle.getDirectoryHandle('terrains');
  } catch {
    // No terrains directory yet
  }

  if (terrainsDir) {
    for (const terrain of manifest.terrains) {
      const filename = terrain.voxelFile.replace(/^terrains\//, '');
      const data = await readTextFile(terrainsDir, filename);
      if (data) {
        try {
          const arr = JSON.parse(data) as SerializedVoxel[];
          voxelDataMap.set(terrain.id, deserializeVoxels(arr));
        } catch {
          // Skip corrupt terrain data
        }
      }
    }
  }

  return { manifest, voxelDataMap };
}

// ── Import asset ──

export async function importAssetToProject(
  handle: FileSystemDirectoryHandle,
  file: File,
  subdir?: string,
): Promise<string> {
  const assetsDir = await getOrCreateSubDir(handle, 'assets');
  const targetDir = subdir
    ? await getOrCreateSubDir(assetsDir, subdir)
    : assetsDir;

  const fileHandle = await targetDir.getFileHandle(file.name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(file);
  await writable.close();

  const relativePath = subdir ? `assets/${subdir}/${file.name}` : `assets/${file.name}`;
  return relativePath;
}

// ── Export scene.json ──

export async function exportSceneJson(
  handle: FileSystemDirectoryHandle,
  scene: object,
): Promise<void> {
  await writeTextFile(handle, 'scene.json', JSON.stringify(scene, null, 2));
}
