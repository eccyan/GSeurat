export type ElementType = 'object' | 'emitter' | 'animation' | 'light';

export interface SplineConfig {
  mode: 'emitter_path' | 'particle_path';
  control_points: [number, number, number][];
  emitter_speed?: number;       // cycles/sec along spline (emitter_path)
  path_spread?: number;         // lateral offset from spline (particle_path)
  align_to_tangent?: boolean;   // orient particles along spline tangent
}

/** @deprecated Use ElementType */
export type LayerType = ElementType;

export interface VfxElement {
  id: string;
  name: string;
  type: ElementType;
  position?: [number, number, number];   // relative to prefab origin
  tags?: string[];
  start?: number;                         // start time (for timeline effects)
  duration?: number;                      // duration of one cycle
  loop?: boolean;                         // true = repeats after duration
  // type=object
  ply_file?: string;
  scale?: number;
  // type=emitter
  emitter?: Record<string, unknown>;
  // type=animation
  animation?: Record<string, unknown>;
  region?: { shape: string; radius?: number; half_extents?: [number, number, number] };
  // type=light
  light?: { color: [number, number, number]; intensity: number; radius: number };
}

/** @deprecated Use VfxElement */
export type VfxLayer = VfxElement;

export interface VfxPreset {
  id: string;
  name: string;
  duration?: number;                      // override; derived from elements if omitted
  category?: string;
  elements: VfxElement[];
}

export interface PlyReference {
  id: string;
  name: string;
  path: string;
}

export interface VfxProject {
  version: 2;
  presets: VfxPreset[];
  scenes?: PlyReference[];
  activeSceneId?: string;
}
