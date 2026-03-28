export type LayerType = 'emitter' | 'animation' | 'light';

export interface VfxLayer {
  id: string;
  name: string;
  type: LayerType;
  tags?: string[];
  start: number;
  duration: number;
  emitter?: Record<string, unknown>;
  animation?: Record<string, unknown>;
  light?: { color: [number, number, number]; intensity: number; radius: number };
}

export interface VfxPreset {
  id: string;
  name: string;
  duration: number;
  layers: VfxLayer[];
}

export interface PlyReference {
  id: string;
  name: string;
  path: string;  // relative path in project (e.g., "scene/blub.ply")
}

export interface VfxProject {
  version: 2;
  presets: VfxPreset[];
  scenes?: PlyReference[];
  activeSceneId?: string;
}
