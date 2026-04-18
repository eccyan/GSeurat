import { writeFileAtPath, readFileAtPath } from '@gseurat/project-root';
import { PROJECT_LAYOUT } from '@gseurat/project-root';
import type { WeaverProjectFile } from './projectTypes.js';
import { WEAVER_PROJECT_VERSION } from './projectTypes.js';

const WEAVER_DIR = PROJECT_LAYOUT.toolsData.weaver;
const EXT = '.weaver';

/**
 * List all .weaver project files in tools_data/weaver/.
 * Returns project names (without extension), sorted alphabetically.
 */
export async function listWeaverProjects(
  root: FileSystemDirectoryHandle,
): Promise<string[]> {
  const names: string[] = [];
  try {
    const parts = WEAVER_DIR.split('/');
    let dir = root;
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part);
    }
    for await (const entry of dir.values()) {
      if (entry.kind === 'file' && entry.name.endsWith(EXT)) {
        names.push(entry.name.slice(0, -EXT.length));
      }
    }
  } catch {
    // Directory doesn't exist yet — return empty list
  }
  return names.sort();
}

/**
 * Save a WeaverProjectFile to tools_data/weaver/<name>.weaver.
 */
export async function saveWeaverProject(
  root: FileSystemDirectoryHandle,
  project: WeaverProjectFile,
): Promise<void> {
  const path = `${WEAVER_DIR}/${project.name}${EXT}`;
  const json = JSON.stringify(project, null, 2);
  await writeFileAtPath(root, path, json);
}

/**
 * Load a WeaverProjectFile from tools_data/weaver/<name>.weaver.
 */
export async function loadWeaverProject(
  root: FileSystemDirectoryHandle,
  name: string,
): Promise<WeaverProjectFile> {
  const path = `${WEAVER_DIR}/${name}${EXT}`;
  const blob = await readFileAtPath(root, path);
  const text = await blob.text();
  const data = JSON.parse(text) as WeaverProjectFile;
  if (data.version !== WEAVER_PROJECT_VERSION) {
    throw new Error(`Unsupported .weaver version: ${data.version}`);
  }
  return data;
}

/**
 * Copy a stem audio file into the project directory at the given path.
 */
export async function saveStemFile(
  root: FileSystemDirectoryHandle,
  relativePath: string,
  file: File,
): Promise<void> {
  const blob = new Blob([await file.arrayBuffer()], { type: file.type });
  await writeFileAtPath(root, relativePath, blob);
}

/**
 * Load and decode a stem audio file relative to the project root.
 */
export async function loadStemAudio(
  root: FileSystemDirectoryHandle,
  sourcePath: string,
  audioContext: AudioContext,
): Promise<AudioBuffer> {
  const blob = await readFileAtPath(root, sourcePath);
  const arrayBuffer = await blob.arrayBuffer();
  return audioContext.decodeAudioData(arrayBuffer);
}
