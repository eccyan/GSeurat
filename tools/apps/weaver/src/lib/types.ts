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

export interface MusicConfigV2 {
  version: 2;
  sample_rate: number;
  track_groups: TrackGroupConfig[];
}

export interface TrackGroupConfig {
  id: number;
  name: string;
  loop_start: number;
  loop_end: number;
  bpm?: number;
  markers: { frame: number; name: string }[];
  stems: { source: string; initial_volume: number }[];
}
