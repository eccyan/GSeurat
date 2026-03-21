/**
 * Manifest file operations — init, read, update, stats.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type {
  CharacterManifest,
  FrameStatus,
  ManifestStats,
} from "@gseurat/asset-types";
import { createDefaultManifest, getManifestStats } from "@gseurat/asset-types";

// Resolve from the engine root (4 levels up from this file in tools/packages/atlas-assembler/src/)
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const ENGINE_ROOT = path.resolve(__dirname, "../../../..");
const CHARACTERS_DIR = path.join(ENGINE_ROOT, "assets/characters");

function characterDir(characterId: string): string {
  return path.join(CHARACTERS_DIR, characterId);
}

function manifestPath(characterId: string): string {
  return path.join(characterDir(characterId), "manifest.json");
}

/**
 * Initialize a new character directory with a default manifest.
 */
export async function initCharacter(
  characterId: string,
  displayName: string,
  frameWidth = 128,
  frameHeight = 128,
): Promise<CharacterManifest> {
  const dir = characterDir(characterId);
  await fs.mkdir(dir, { recursive: true });

  const manifest = createDefaultManifest(characterId, displayName, frameWidth, frameHeight);
  await fs.writeFile(manifestPath(characterId), JSON.stringify(manifest, null, 2));
  return manifest;
}

/**
 * Load a character manifest from disk.
 */
export async function loadManifest(characterId: string): Promise<CharacterManifest> {
  const content = await fs.readFile(manifestPath(characterId), "utf8");
  return JSON.parse(content) as CharacterManifest;
}

/**
 * Save a character manifest to disk.
 */
export async function saveManifest(manifest: CharacterManifest): Promise<void> {
  const dir = characterDir(manifest.character_id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    manifestPath(manifest.character_id),
    JSON.stringify(manifest, null, 2),
  );
}

/**
 * Update the status of a specific frame in the manifest.
 */
export async function updateFrameStatus(
  characterId: string,
  animationName: string,
  frameIndex: number,
  status: FrameStatus,
  notes?: string,
): Promise<CharacterManifest> {
  const manifest = await loadManifest(characterId);
  const anim = manifest.animations.find((a) => a.name === animationName);
  if (!anim) throw new Error(`Animation "${animationName}" not found`);

  const frame = anim.frames.find((f) => f.index === frameIndex);
  if (!frame) throw new Error(`Frame ${frameIndex} not found in "${animationName}"`);

  frame.status = status;
  if (notes !== undefined) {
    if (!frame.review) {
      frame.review = { reviewer: "human", notes };
    } else {
      frame.review.notes = notes;
    }
  }

  await saveManifest(manifest);
  return manifest;
}

/**
 * Get stats for a character manifest.
 */
export async function getStats(characterId: string): Promise<ManifestStats> {
  const manifest = await loadManifest(characterId);
  return getManifestStats(manifest);
}

/**
 * List all character IDs that have manifest.json files.
 */
export async function listCharacters(): Promise<string[]> {
  try {
    const entries = await fs.readdir(CHARACTERS_DIR, { withFileTypes: true });
    const ids: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const mPath = path.join(CHARACTERS_DIR, entry.name, "manifest.json");
        try {
          await fs.access(mPath);
          ids.push(entry.name);
        } catch {
          // No manifest — skip
        }
      }
    }
    return ids.sort();
  } catch {
    return [];
  }
}
