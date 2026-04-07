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

// ── Clipboard ──

export interface ClipboardEntry {
  dx: number;
  dy: number;
  dz: number;
  color: [number, number, number, number];
}

// ── File format (v2) ──

export interface EchidnaFile {
  version: number;
  characterName: string;
  gridWidth: number;
  gridDepth: number;
  voxels: { x: number; y: number; z: number; r: number; g: number; b: number; a: number }[];
  parts: BodyPart[];
  poses: Record<string, PoseData>;
  animations?: Record<string, AnimationClip>;
}

// ── Undo snapshot ──

export interface Snapshot {
  voxels: [VoxelKey, Voxel][];
  parts: BodyPart[];
}
