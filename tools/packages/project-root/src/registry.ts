import { parseAssetRef } from './paths';

export interface CharacterEntry {
  id: string;
  ply: string;       // assets/characters/{id}/{id}.ply
  manifest: string;  // assets/characters/{id}/{id}.manifest.json
}

export interface FileEntry {
  id: string;
  file: string;
}

export interface AssetRegistry {
  version: 1;
  characters: Record<string, CharacterEntry>;
  vfx:        Record<string, FileEntry>;
  textures:   Record<string, FileEntry>;
  audio:      Record<string, FileEntry>;
  maps:       Record<string, FileEntry>;
  objects:    Record<string, FileEntry>;
}

export function createEmptyRegistry(): AssetRegistry {
  return {
    version: 1,
    characters: {},
    vfx: {},
    textures: {},
    audio: {},
    maps: {},
    objects: {},
  };
}

export function registerCharacter(
  reg: AssetRegistry,
  id: string,
  entry: { ply: string; manifest: string },
): AssetRegistry {
  return {
    ...reg,
    characters: {
      ...reg.characters,
      [id]: { id, ply: entry.ply, manifest: entry.manifest },
    },
  };
}

export function registerVfx(
  reg: AssetRegistry,
  id: string,
  entry: { file: string },
): AssetRegistry {
  return {
    ...reg,
    vfx: {
      ...reg.vfx,
      [id]: { id, file: entry.file },
    },
  };
}

export function registerTexture(
  reg: AssetRegistry,
  id: string,
  entry: { file: string },
): AssetRegistry {
  return {
    ...reg,
    textures: {
      ...reg.textures,
      [id]: { id, file: entry.file },
    },
  };
}

export function registerAudio(
  reg: AssetRegistry,
  id: string,
  entry: { file: string },
): AssetRegistry {
  return {
    ...reg,
    audio: {
      ...reg.audio,
      [id]: { id, file: entry.file },
    },
  };
}

export function registerMap(
  reg: AssetRegistry,
  id: string,
  entry: { file: string },
): AssetRegistry {
  return {
    ...reg,
    maps: {
      ...reg.maps,
      [id]: { id, file: entry.file },
    },
  };
}

export function registerObject(
  reg: AssetRegistry, id: string, entry: { file: string },
): AssetRegistry {
  return { ...reg, objects: { ...reg.objects, [id]: { id, file: entry.file } } };
}

export type RefKind = 'character' | 'vfx' | 'texture' | 'audio' | 'map' | 'object';

/**
 * Resolve an asset ref to its canonical project-relative file path.
 * - For `#id` refs, looks up the entry in the registry.
 *   - Characters resolve to their **manifest** file (not the PLY).
 *   - Other kinds resolve to their single `file` field.
 * - For `assets/...` path refs, returns the path unchanged (pass-through).
 * - Throws on bare filenames, absolute paths, traversal, unknown ids, etc.
 */
export function resolveRef(ref: string, kind: RefKind, reg: AssetRegistry): string {
  const parsed = parseAssetRef(ref);
  if (parsed.kind === 'path') {
    return parsed.path;
  }
  switch (kind) {
    case 'character': {
      const e = reg.characters[parsed.id];
      if (!e) throw new Error(`resolveRef: unknown id "${parsed.id}" in the character registry`);
      return e.manifest;
    }
    case 'vfx': {
      const e = reg.vfx[parsed.id];
      if (!e) throw new Error(`resolveRef: unknown id "${parsed.id}" in the vfx registry`);
      return e.file;
    }
    case 'texture': {
      const e = reg.textures[parsed.id];
      if (!e) throw new Error(`resolveRef: unknown id "${parsed.id}" in the texture registry`);
      return e.file;
    }
    case 'audio': {
      const e = reg.audio[parsed.id];
      if (!e) throw new Error(`resolveRef: unknown id "${parsed.id}" in the audio registry`);
      return e.file;
    }
    case 'map': {
      const e = reg.maps[parsed.id];
      if (!e) throw new Error(`resolveRef: unknown id "${parsed.id}" in the map registry`);
      return e.file;
    }
    case 'object': {
      const e = reg.objects[parsed.id];
      if (!e) throw new Error(`resolveRef: unknown id "${parsed.id}" in the object registry`);
      return e.file;
    }
    default: {
      const _exhaustive: never = kind;
      throw new Error(`resolveRef: unhandled kind: ${_exhaustive}`);
    }
  }
}
