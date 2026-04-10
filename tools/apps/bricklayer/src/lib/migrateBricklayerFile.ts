import {
  createEmptyRegistry,
  registerCharacter,
  registerTexture,
  registerAudio,
  registerMap,
  type AssetRegistry,
} from '@gseurat/project-root';
import type { BricklayerFile } from '../store/types.js';
import { BRICKLAYER_FILE_VERSION } from '../store/types.js';

interface LegacyAssetEntry {
  id: string;
  name: string;
  type: 'ply' | 'texture' | 'audio';
  path: string;
}

function buildRegistryFromLegacyAssets(entries: LegacyAssetEntry[] | undefined): AssetRegistry {
  let reg = createEmptyRegistry();
  if (!Array.isArray(entries)) return reg;
  for (const e of entries) {
    if (!e || typeof e.path !== 'string' || !e.path.startsWith('assets/')) continue;
    if (e.type === 'ply') {
      // Heuristic: if under characters/, treat as a character; else as a map.
      if (e.path.startsWith('assets/characters/')) {
        reg = registerCharacter(reg, e.id, {
          ply: e.path,
          manifest: e.path.replace(/\.ply$/, '.manifest.json'),
        });
      } else {
        reg = registerMap(reg, e.id, { file: e.path });
      }
    } else if (e.type === 'texture') {
      reg = registerTexture(reg, e.id, { file: e.path });
    } else if (e.type === 'audio') {
      reg = registerAudio(reg, e.id, { file: e.path });
    }
  }
  return reg;
}

/**
 * Migrate a parsed BricklayerFile JSON object to the current schema version.
 *
 * - v1 → v2: synthesize an `asset_registry` from the legacy flat `assets[]`
 *   array, preserving the original `assets` field for diagnostic purposes.
 * - v2: pass through unchanged.
 *
 * Throws on non-object input or unknown version numbers.
 */
export function migrateBricklayerFile(raw: any): BricklayerFile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('migrateBricklayerFile: expected an object');
  }
  const ver = raw.version ?? 1;
  if (ver !== 1 && ver !== 2) {
    throw new Error(`migrateBricklayerFile: unknown file version ${ver}`);
  }
  if (ver === 2) {
    return raw as BricklayerFile;
  }

  console.warn('[bricklayer] Loaded v1 file; migrating to v2 in memory.');
  const registry = buildRegistryFromLegacyAssets(raw.assets);

  return {
    version: BRICKLAYER_FILE_VERSION,
    asset_registry: registry,
    gridWidth: raw.gridWidth ?? 128,
    gridDepth: raw.gridDepth ?? 96,
    voxels: raw.voxels ?? [],
    collision: raw.collision ?? [],
    collisionGridData: raw.collisionGridData,
    nav_zone_names: raw.nav_zone_names,
    color_palettes: raw.color_palettes,
    terrains: raw.terrains,
    assets: raw.assets,
    scene: raw.scene ?? {},
  };
}
