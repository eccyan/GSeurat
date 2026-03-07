import type {
  CharacterManifest,
  FrameStatus,
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

export function frameThumbnailUrl(
  characterId: string,
  animName: string,
  frameIndex: number,
): string {
  return `${BASE}/api/characters/${encodeURIComponent(characterId)}/frames/${encodeURIComponent(animName)}/${frameIndex}/image?t=${Date.now()}`;
}
