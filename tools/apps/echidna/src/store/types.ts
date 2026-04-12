// ── Voxel ──

export interface Voxel {
  color: [number, number, number, number];
}

export type VoxelKey = `${number},${number},${number}`;

// ── Character ──

export interface BodyPart {
  id: string;
  name: string;
  parent: string | null;
  joint: [number, number, number];
  voxelKeys: VoxelKey[];
}

export interface PoseData {
  /** Per-part euler rotations in degrees [rx, ry, rz] */
  rotations: Record<string, [number, number, number]>;
  /** Root bone world-space translation offset [x, y, z] */
  rootPosition?: [number, number, number];
}

export type ToolType =
  | 'place'
  | 'paint'
  | 'erase'
  | 'fill'
  | 'extrude'
  | 'eyedropper'
  | 'assign_part'
  | 'box_select'
  | 'lasso_select';

// ── Animation ──

export type EasingType = 'linear' | 'ease-in-out' | 'bounce' | 'elastic' | 'step' | 'custom';

export type PlaybackMode = 'loop' | 'ping-pong' | 'once';

export interface AnimationKeyframe {
  time: number;
  poseName: string;
  easing: EasingType;
  curve?: [number, number, number, number];
  parts?: string[];
}

export interface AnimationClip {
  name: string;
  keyframes: AnimationKeyframe[];
  duration: number;
  playbackMode: PlaybackMode;
  /** When true, root bone delta drives actor world position */
  rootMotion?: boolean;
}

// ── App mode ──

export type AppMode = 'build' | 'animate';

// ── Asset kind ──

export type EchidnaAssetKind = 'character' | 'map' | 'object';

// ── Clipboard ──

export interface ClipboardEntry {
  dx: number;
  dy: number;
  dz: number;
  color: [number, number, number, number];
}

// ── File format (v4) ──

export const ECHIDNA_FILE_VERSION = 4 as const;

export interface EchidnaFile {
  version: number;
  id: string;            // persistent slug, immutable after first save
  kind: EchidnaAssetKind;
  characterName: string;
  gridWidth: number;
  gridDepth: number;
  voxels: { x: number; y: number; z: number; r: number; g: number; b: number; a: number }[];
  parts: BodyPart[];
  poses: Record<string, PoseData>;
  animations?: Record<string, AnimationClip>;
  tags: string[];
}

/**
 * Slugify an asset name into a stable ID usable as a directory name.
 * Rules: lowercase, trim, collapse whitespace runs to single underscores,
 * strip characters outside [a-z0-9_-], fall back to "character" if empty.
 */
export function slugifyAssetId(name: string): string {
  const cleaned = name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '');
  return cleaned.length > 0 ? cleaned : 'character';
}

/** @deprecated Use slugifyAssetId */
export const slugifyCharacterId = slugifyAssetId;

/**
 * Migrate a raw parsed JSON object to the current EchidnaFile shape.
 * - Adds a persistent `id` (slugified from characterName) if missing.
 * - Bumps version to ECHIDNA_FILE_VERSION.
 * - Defaults `kind` to 'character' for legacy v3 files.
 * - Defaults `tags` to [] if missing.
 * - Throws on non-object input.
 *
 * Does NOT attempt to validate voxel/part/pose structure — the store
 * loader handles those. This migration covers schema v2 → v3 → v4.
 */
export function migrateEchidnaFile(raw: any): EchidnaFile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('migrateEchidnaFile: expected an object');
  }
  const id: string = typeof raw.id === 'string' && raw.id.length > 0
    ? raw.id
    : slugifyAssetId(typeof raw.characterName === 'string' ? raw.characterName : '');

  const kind: EchidnaAssetKind =
    raw.kind === 'character' || raw.kind === 'map' || raw.kind === 'object'
      ? raw.kind
      : 'character';

  return {
    version: ECHIDNA_FILE_VERSION,
    id,
    kind,
    characterName: raw.characterName ?? '',
    gridWidth: raw.gridWidth ?? 32,
    gridDepth: raw.gridDepth ?? 32,
    voxels: Array.isArray(raw.voxels) ? raw.voxels : [],
    parts: Array.isArray(raw.parts) ? raw.parts : [],
    poses: raw.poses && typeof raw.poses === 'object' ? raw.poses : {},
    animations: raw.animations && typeof raw.animations === 'object' && !Array.isArray(raw.animations)
      ? raw.animations
      : undefined,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
  };
}

// ── Undo snapshot ──

export interface Snapshot {
  voxels: [VoxelKey, Voxel][];
  parts: BodyPart[];
}

// ── Per-asset slice ──

/**
 * Per-asset slice of EchidnaStoreState. Nullable — null when no asset
 * is loaded (empty project, or just after Delete). Swapped atomically on
 * openCharacter() and newCharacter(). Every mutating action that writes to
 * this slice must also call markDirty().
 */
export interface Asset {
  id: string;                                        // slug, stable for the asset's lifetime
  kind: EchidnaAssetKind;
  characterName: string;                             // display name
  gridWidth: number;
  gridDepth: number;
  voxels: Map<VoxelKey, Voxel>;
  characterParts: BodyPart[];
  characterPoses: Record<string, PoseData>;
  animations: Record<string, AnimationClip>;
  tags: string[];
  currentFilename: string | null;                    // legacy .echidna download target
}

/** @deprecated Use Asset */
export type Character = Asset;

export interface AssetListEntry {
  id: string;
  kind: EchidnaAssetKind;
  name: string;
  lastModified: number;
}

/** @deprecated Use AssetListEntry */
export type CharacterListEntry = AssetListEntry;
