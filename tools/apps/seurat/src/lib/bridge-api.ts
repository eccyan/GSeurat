import type {
  CharacterManifest,
  FrameStatus,
  PipelineStage,
  ViewDirection,
} from '@vulkan-game-tools/asset-types';
import type { AssembleResult } from '../store/types.js';

// In dev mode, Vite proxies /api to the bridge server (avoids CORS).
// In production, fall back to the bridge URL directly.
const BASE = '';

export async function fetchCharacters(): Promise<string[]> {
  const res = await fetch(`${BASE}/api/characters`);
  if (!res.ok) throw new Error(`Failed to list characters: ${res.status}`);
  const data = await res.json();
  // Bridge returns { characters: string[] }
  return data.characters ?? data;
}

export async function fetchManifest(id: string): Promise<CharacterManifest> {
  const res = await fetch(`${BASE}/api/characters/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Failed to fetch manifest for ${id}: ${res.status}`);
  return res.json();
}

export async function saveManifest(manifest: CharacterManifest): Promise<void> {
  const res = await fetch(
    `${BASE}/api/characters/${encodeURIComponent(manifest.character_id)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(manifest, null, 2),
    },
  );
  if (!res.ok) throw new Error(`Failed to save manifest: ${res.status}`);
}

export async function createCharacter(
  id: string,
  name: string,
  manifest: CharacterManifest,
): Promise<void> {
  const res = await fetch(`${BASE}/api/characters/${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(manifest, null, 2),
  });
  if (!res.ok) throw new Error(`Failed to create character ${id}: ${res.status}`);
}

export async function renameCharacter(oldId: string, newId: string): Promise<void> {
  const res = await fetch(
    `${BASE}/api/characters/${encodeURIComponent(oldId)}/rename`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newId }),
    },
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Failed to rename character: ${res.status}`);
  }
}

export async function updateFrameStatus(
  characterId: string,
  animName: string,
  frameIndex: number,
  status: FrameStatus,
  notes?: string,
): Promise<void> {
  const res = await fetch(
    `${BASE}/api/characters/${encodeURIComponent(characterId)}/frames/${encodeURIComponent(animName)}/${frameIndex}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, notes }),
    },
  );
  if (!res.ok) throw new Error(`Failed to update frame: ${res.status}`);
}

export async function assembleAtlas(
  characterId: string,
  validateOnly = false,
): Promise<AssembleResult> {
  const res = await fetch(
    `${BASE}/api/characters/${encodeURIComponent(characterId)}/assemble`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ validateOnly }),
    },
  );
  if (!res.ok) throw new Error(`Assembly failed: ${res.status}`);
  return res.json();
}

export function spriteSheetUrl(characterId: string): string {
  return `${BASE}/api/characters/${encodeURIComponent(characterId)}/spritesheet.png?t=${Date.now()}`;
}

export function conceptImageUrl(characterId: string, view?: ViewDirection): string {
  const suffix = view ? `/${view}` : '';
  return `${BASE}/api/characters/${encodeURIComponent(characterId)}/concept-image${suffix}?t=${Date.now()}`;
}

export async function fetchConceptImageBytes(characterId: string, view?: ViewDirection): Promise<Uint8Array> {
  const suffix = view ? `/${view}` : '';
  const res = await fetch(`${BASE}/api/characters/${encodeURIComponent(characterId)}/concept-image${suffix}`);
  if (!res.ok) throw new Error(`No concept image for ${characterId}${view ? ` (${view})` : ''}: ${res.status}`);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

export async function saveFrameImage(
  characterId: string,
  animName: string,
  frameIndex: number,
  pngBytes: Uint8Array,
): Promise<void> {
  let binary = '';
  for (let i = 0; i < pngBytes.length; i++) {
    binary += String.fromCharCode(pngBytes[i]);
  }
  const base64 = btoa(binary);

  const res = await fetch(
    `${BASE}/api/characters/${encodeURIComponent(characterId)}/frames/${encodeURIComponent(animName)}/${frameIndex}/image`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: base64 }),
    },
  );
  if (!res.ok) throw new Error(`Failed to save frame image: ${res.status}`);
}

export async function saveConceptImage(characterId: string, pngBytes: Uint8Array, view?: ViewDirection): Promise<void> {
  // Convert to base64 for JSON transport
  let binary = '';
  for (let i = 0; i < pngBytes.length; i++) {
    binary += String.fromCharCode(pngBytes[i]);
  }
  const base64 = btoa(binary);

  const suffix = view ? `/${view}` : '';
  const res = await fetch(
    `${BASE}/api/characters/${encodeURIComponent(characterId)}/concept-image${suffix}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: base64 }),
    },
  );
  if (!res.ok) throw new Error(`Failed to save concept image: ${res.status}`);
}

export function chibiImageUrl(characterId: string, view?: ViewDirection): string {
  const suffix = view ? `/${view}` : '';
  return `${BASE}/api/characters/${encodeURIComponent(characterId)}/chibi-image${suffix}?t=${Date.now()}`;
}

export async function fetchChibiImageBytes(characterId: string, view?: ViewDirection): Promise<Uint8Array> {
  const suffix = view ? `/${view}` : '';
  const res = await fetch(`${BASE}/api/characters/${encodeURIComponent(characterId)}/chibi-image${suffix}`);
  if (!res.ok) throw new Error(`No chibi image for ${characterId}${view ? ` (${view})` : ''}: ${res.status}`);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

export async function saveChibiImage(characterId: string, pngBytes: Uint8Array, view?: ViewDirection): Promise<void> {
  let binary = '';
  for (let i = 0; i < pngBytes.length; i++) {
    binary += String.fromCharCode(pngBytes[i]);
  }
  const base64 = btoa(binary);

  const suffix = view ? `/${view}` : '';
  const res = await fetch(
    `${BASE}/api/characters/${encodeURIComponent(characterId)}/chibi-image${suffix}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: base64 }),
    },
  );
  if (!res.ok) throw new Error(`Failed to save chibi image: ${res.status}`);
}

export function pixelImageUrl(characterId: string): string {
  return `${BASE}/api/characters/${encodeURIComponent(characterId)}/pixel-image?t=${Date.now()}`;
}

export async function fetchPixelImageBytes(characterId: string): Promise<Uint8Array> {
  const res = await fetch(`${BASE}/api/characters/${encodeURIComponent(characterId)}/pixel-image`);
  if (!res.ok) throw new Error(`No pixel image for ${characterId}: ${res.status}`);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

export async function savePixelImage(characterId: string, pngBytes: Uint8Array): Promise<void> {
  let binary = '';
  for (let i = 0; i < pngBytes.length; i++) {
    binary += String.fromCharCode(pngBytes[i]);
  }
  const base64 = btoa(binary);

  const res = await fetch(
    `${BASE}/api/characters/${encodeURIComponent(characterId)}/pixel-image`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: base64 }),
    },
  );
  if (!res.ok) throw new Error(`Failed to save pixel image: ${res.status}`);
}

// ---------------------------------------------------------------------------
// Generic character file save/load (for skeleton PNGs etc.)
// ---------------------------------------------------------------------------

export async function saveCharacterFile(characterId: string, filename: string, data: Uint8Array): Promise<void> {
  let binary = '';
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  const base64 = btoa(binary);
  const res = await fetch(
    `${BASE}/api/characters/${encodeURIComponent(characterId)}/file/${encodeURIComponent(filename)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: base64 }) },
  );
  if (!res.ok) throw new Error(`Failed to save ${filename}: ${res.status}`);
}

export async function fetchCharacterFile(characterId: string, filename: string): Promise<Uint8Array> {
  const res = await fetch(`${BASE}/api/characters/${encodeURIComponent(characterId)}/file/${encodeURIComponent(filename)}`);
  if (!res.ok) throw new Error(`File not found: ${filename} (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

export function characterFileUrl(characterId: string, filename: string): string {
  return `${BASE}/api/characters/${encodeURIComponent(characterId)}/file/${encodeURIComponent(filename)}?t=${Date.now()}`;
}

export function frameThumbnailUrl(
  characterId: string,
  animName: string,
  frameIndex: number,
  cacheBuster?: number,
): string {
  const t = cacheBuster ?? Date.now();
  return `${BASE}/api/characters/${encodeURIComponent(characterId)}/frames/${encodeURIComponent(animName)}/${frameIndex}/image?t=${t}`;
}

// --- Pipeline pass image endpoints ---

export function passImageUrl(
  characterId: string,
  animName: string,
  frameIndex: number,
  pass: PipelineStage,
  cacheBuster?: number,
): string {
  const t = cacheBuster ?? Date.now();
  return `${BASE}/api/characters/${encodeURIComponent(characterId)}/frames/${encodeURIComponent(animName)}/${frameIndex}/pass/${pass}?t=${t}`;
}

export async function fetchPassImageBytes(
  characterId: string,
  animName: string,
  frameIndex: number,
  pass: PipelineStage,
): Promise<Uint8Array> {
  const res = await fetch(
    `${BASE}/api/characters/${encodeURIComponent(characterId)}/frames/${encodeURIComponent(animName)}/${frameIndex}/pass/${pass}`,
  );
  if (!res.ok) throw new Error(`No pass image for ${characterId}/${animName}/${frameIndex}/${pass}: ${res.status}`);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

// --- Project endpoints ---

export async function createProject(dirPath: string, name: string): Promise<{ project: Record<string, unknown> }> {
  const res = await fetch(`${BASE}/api/projects/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: dirPath, name }),
  });
  if (!res.ok) throw new Error(`Failed to create project: ${res.status}`);
  return res.json();
}

export async function openProject(dirPath: string): Promise<{ project: Record<string, unknown>; path: string }> {
  const res = await fetch(`${BASE}/api/projects/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: dirPath }),
  });
  if (!res.ok) throw new Error(`Failed to open project: ${res.status}`);
  return res.json();
}

export async function fetchCurrentProject(): Promise<{ project: Record<string, unknown> | null; path: string | null }> {
  const res = await fetch(`${BASE}/api/projects/current`);
  if (!res.ok) throw new Error(`Failed to get current project: ${res.status}`);
  return res.json();
}

export async function saveProject(project: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${BASE}/api/projects/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project }),
  });
  if (!res.ok) throw new Error(`Failed to save project: ${res.status}`);
}

export async function closeProject(): Promise<void> {
  const res = await fetch(`${BASE}/api/projects/close`, { method: 'POST' });
  if (!res.ok) throw new Error(`Failed to close project: ${res.status}`);
}

export async function exportCharacters(opts: {
  characterIds?: string[];
  format?: string;
  outputDir?: string;
}): Promise<{ results: Record<string, unknown>[] }> {
  const res = await fetch(`${BASE}/api/projects/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
  if (!res.ok) throw new Error(`Export failed: ${res.status}`);
  return res.json();
}

export async function savePassImage(
  characterId: string,
  animName: string,
  frameIndex: number,
  pass: PipelineStage,
  pngBytes: Uint8Array,
): Promise<void> {
  let binary = '';
  for (let i = 0; i < pngBytes.length; i++) {
    binary += String.fromCharCode(pngBytes[i]);
  }
  const base64 = btoa(binary);

  const res = await fetch(
    `${BASE}/api/characters/${encodeURIComponent(characterId)}/frames/${encodeURIComponent(animName)}/${frameIndex}/pass/${pass}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: base64 }),
    },
  );
  if (!res.ok) throw new Error(`Failed to save pass image: ${res.status}`);
}
