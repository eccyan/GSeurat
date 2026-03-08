import type {
  CharacterManifest,
  FrameStatus,
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

export function frameThumbnailUrl(
  characterId: string,
  animName: string,
  frameIndex: number,
): string {
  return `${BASE}/api/characters/${encodeURIComponent(characterId)}/frames/${encodeURIComponent(animName)}/${frameIndex}/image?t=${Date.now()}`;
}
