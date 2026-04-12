import {
  PROJECT_LAYOUT,
  toAssetPath,
  ensureSubdir,
  writeFileAtPath,
  readFileAtPath,
} from '@gseurat/project-root';
import { migrateEchidnaFile, type EchidnaFile, type CharacterListEntry } from '../store/types';

/* ----- private helpers ----- */

/**
 * Navigate from the project root to the echidna saves directory.
 * Private helper — not exported — used by all the .echidna FS helpers.
 */
async function getEchidnaSavesDir(
  handle: FileSystemDirectoryHandle,
  opts: { create?: boolean } = {},
): Promise<FileSystemDirectoryHandle> {
  const parts = PROJECT_LAYOUT.toolsData.echidnaSaves.split('/');
  let dir = handle;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, opts);
  }
  return dir;
}

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

/**
 * Enumerate all .echidna files in tools_data/echidna_saves/ and return
 * their metadata for the CharactersPanel list. Skips malformed files with
 * a console.warn rather than throwing — one bad file must not prevent the
 * panel from rendering the rest.
 *
 * Returns [] when the directory doesn't exist yet.
 */
export async function listEchidnaProjects(
  handle: FileSystemDirectoryHandle,
): Promise<CharacterListEntry[]> {
  let savesDir: FileSystemDirectoryHandle;
  try {
    savesDir = await getEchidnaSavesDir(handle);
  } catch (e) {
    if ((e as Error).name === 'NotFoundError') return [];
    throw e;
  }

  /** Structural type for FSAPI directory entries (values() is not yet in lib.dom). */
  type DirChild =
    | { kind: 'directory'; name: string }
    | {
        kind: 'file';
        name: string;
        getFile(): Promise<File>;
        createWritable(): Promise<{
          write(d: Uint8Array | string | ArrayBuffer | Blob): Promise<void>;
          close(): Promise<void>;
        }>;
      };

  const iter = (savesDir as unknown as {
    values(): AsyncIterable<DirChild>;
  }).values();

  const entries: CharacterListEntry[] = [];
  for await (const child of iter) {
    if (child.kind !== 'file') continue;
    if (!child.name.endsWith('.echidna')) continue;
    try {
      const file = await child.getFile();
      const text = await file.text();
      const raw = JSON.parse(text);
      const migrated = migrateEchidnaFile(raw);
      entries.push({
        id: migrated.id,
        kind: migrated.kind,
        name: migrated.characterName,
        lastModified: file.lastModified ?? 0,
      });
    } catch (err) {
      console.warn(`[echidna] Skipped unreadable character file: ${child.name}`, err);
    }
  }

  // Sort by lastModified desc (most recent first)
  entries.sort((a, b) => b.lastModified - a.lastModified);
  return entries;
}

/**
 * Rename a character's display name (only). The file on disk keeps its
 * filename/id — see Phase 0.2 spec Decision #8 for why. Fails with
 * NotFoundError if the source file doesn't exist.
 */
export async function renameEchidnaProject(
  handle: FileSystemDirectoryHandle,
  id: string,
  newCharacterName: string,
): Promise<void> {
  const dir = await getEchidnaSavesDir(handle);
  const fh = await dir.getFileHandle(`${id}.echidna`);
  const file = await fh.getFile();
  const raw = JSON.parse(await file.text());
  raw.characterName = newCharacterName;
  const w = await fh.createWritable();
  await w.write(JSON.stringify(raw, null, 2));
  await w.close();
}

/**
 * Read a source .echidna, change its id + characterName, and write it as
 * a new file. Does NOT build engine files — the user hits ⌘S later for
 * that. Does NOT check for collision — the caller (duplicateCharacter
 * store action) is responsible for minting a non-colliding newId.
 */
export async function duplicateEchidnaProject(
  handle: FileSystemDirectoryHandle,
  sourceId: string,
  newId: string,
  newCharacterName: string,
): Promise<void> {
  const dir = await getEchidnaSavesDir(handle);
  const sourceFh = await dir.getFileHandle(`${sourceId}.echidna`);
  const sourceFile = await sourceFh.getFile();
  const raw = JSON.parse(await sourceFile.text());
  raw.id = newId;
  raw.characterName = newCharacterName;

  const newFh = await dir.getFileHandle(`${newId}.echidna`, { create: true });
  const w = await newFh.createWritable();
  await w.write(JSON.stringify(raw, null, 2));
  await w.close();
}

/**
 * Delete the .echidna source file for a character. The exported files in
 * assets/characters/{id}/ are deliberately NOT touched — users can remove
 * them manually, and Phase 0.2.1+ may add a "Clean orphan exports" action.
 *
 * Throws NotFoundError if the source file is missing.
 */
export async function deleteEchidnaProject(
  handle: FileSystemDirectoryHandle,
  id: string,
): Promise<void> {
  const dir = await getEchidnaSavesDir(handle);
  // removeEntry is not yet in lib.dom; use a narrowed structural cast
  // (same pattern as listEchidnaProjects uses for values())
  await (dir as FileSystemDirectoryHandle & {
    removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void>;
  }).removeEntry(`${id}.echidna`);
}
