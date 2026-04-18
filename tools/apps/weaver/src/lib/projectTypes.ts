export const WEAVER_PROJECT_VERSION = 1;

export interface WeaverProjectFile {
  version: 1;
  name: string;
  sample_rate: number;
  groups: WeaverGroupConfig[];
}

export interface WeaverGroupConfig {
  id: string;
  name: string;
  bpm: number;
  loop_start: number;
  loop_end: number;
  loop_enabled: boolean;
  markers: { frame: number; name: string }[];
  stems: WeaverStemConfig[];
}

export interface WeaverStemConfig {
  source: string;
  initial_volume: number;
  muted: boolean;
  soloed: boolean;
}

export function createEmptyGroup(id: string, name: string): WeaverGroupConfig {
  return {
    id,
    name,
    bpm: 120,
    loop_start: 0,
    loop_end: 0,
    loop_enabled: true,
    markers: [],
    stems: [],
  };
}

export function createEmptyProject(name: string, sampleRate: number = 44100): WeaverProjectFile {
  return {
    version: WEAVER_PROJECT_VERSION,
    name,
    sample_rate: sampleRate,
    groups: [],
  };
}
