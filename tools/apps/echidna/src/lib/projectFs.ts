import {
  PROJECT_LAYOUT,
  toAssetPath,
  ensureSubdir,
  writeFileAtPath,
  readFileAtPath,
} from '@gseurat/project-root';
import { migrateEchidnaFile, type EchidnaFile } from '../store/types';

/* ----- path builders ----- */

/**
 * Returns the project-relative path for an Echidna project save file.
 * Example: `echidnaSavePath('walker')` → `'tools_data/echidna_saves/walker.echidna'`.
 */
export function echidnaSavePath(id: string): string {
  return `${PROJECT_LAYOUT.toolsData.echidnaSaves}/${id}.echidna`;
}

/**
 * Returns the project-relative path for a character's PLY file.
 * Example: `characterPlyPath('walker')` → `'assets/characters/walker/walker.ply'`.
 */
export function characterPlyPath(id: string): string {
  return toAssetPath('characters', id, `${id}.ply`);
}

/**
 * Returns the project-relative path for a character's manifest JSON.
 * Example: `characterManifestPath('walker')` → `'assets/characters/walker/walker.manifest.json'`.
 */
export function characterManifestPath(id: string): string {
  return toAssetPath('characters', id, `${id}.manifest.json`);
}

/* ----- save / load / export ----- */

/**
 * Save an Echidna project file to `tools_data/echidna_saves/{id}.echidna`.
 * Creates the directory if needed.
 */
export async function saveEchidnaProject(
  root: FileSystemDirectoryHandle,
  file: EchidnaFile,
): Promise<void> {
  await ensureSubdir(root, PROJECT_LAYOUT.toolsData.echidnaSaves);
  const path = echidnaSavePath(file.id);
  const json = JSON.stringify(file, null, 2);
  await writeFileAtPath(root, path, json);
}

/**
 * Load an Echidna project file from `tools_data/echidna_saves/{id}.echidna`.
 * Routes through `migrateEchidnaFile` so legacy files are migrated on read.
 */
export async function loadEchidnaProject(
  root: FileSystemDirectoryHandle,
  id: string,
): Promise<EchidnaFile> {
  const blob = await readFileAtPath(root, echidnaSavePath(id));
  const text = await blob.text();
  return migrateEchidnaFile(JSON.parse(text));
}

/**
 * Export a character's PLY and manifest to `assets/characters/{id}/`.
 * Creates the character subdirectory if needed. Returns the written paths.
 */
export async function exportCharacterToProject(
  root: FileSystemDirectoryHandle,
  id: string,
  ply: Blob | Uint8Array,
  manifestJson: string,
): Promise<{ plyPath: string; manifestPath: string }> {
  await ensureSubdir(root, `${PROJECT_LAYOUT.assets.characters}/${id}`);
  const plyPath = characterPlyPath(id);
  const manifestPath = characterManifestPath(id);

  // writeFileAtPath accepts string | Uint8Array | Blob per the shared package
  // — just pass the PLY through unchanged.
  await writeFileAtPath(root, plyPath, ply);
  await writeFileAtPath(root, manifestPath, manifestJson);

  return { plyPath, manifestPath };
}
