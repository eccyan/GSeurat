export type LayerType = 'emitter' | 'animation' | 'light';
export type Phase = 'anticipation' | 'impact' | 'residual' | 'custom';

export interface VfxLayer {
  id: string;
  name: string;
  type: LayerType;
  phase: Phase;
  start: number;
  duration: number;
  emitter?: Record<string, unknown>;
  animation?: Record<string, unknown>;
  light?: { color: [number, number, number]; intensity: number; radius: number };
}

export interface VfxPhases {
  anticipation: number;
  impact: number;
}

export interface VfxPreset {
  id: string;
  name: string;
  duration: number;
  phases: VfxPhases;
  layers: VfxLayer[];
}
