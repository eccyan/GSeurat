// Runtime types (used by active group — contain AudioBuffer)
export interface StemState {
  fileName: string;
  sourcePath: string;
  initialVolume: number;
  audioBuffer: AudioBuffer | null;
  waveformPeaks: Float32Array | null;
  muted: boolean;
  soloed: boolean;
}

export interface MarkerState {
  frame: number;
  name: string;
}

// Re-export project types
export type {
  WeaverProjectFile,
  WeaverGroupConfig,
  WeaverStemConfig,
} from './projectTypes.js';
