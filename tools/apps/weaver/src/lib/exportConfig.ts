import type { WeaverGroupConfig } from './projectTypes.js';

export interface MusicConfigV2 {
  version: 2;
  sample_rate: number;
  track_groups: TrackGroupConfig[];
}

export interface TrackGroupConfig {
  id: number;
  name: string;
  bpm?: number;
  loop_start: number;
  loop_end: number;
  markers: { frame: number; name: string }[];
  stems: { source: string; initial_volume: number }[];
}

/**
 * Export all groups as a single music_config.json v2.
 * Strips editor-only fields (muted, soloed, loop_enabled).
 */
export function exportMultiGroupConfig(
  sampleRate: number,
  groups: WeaverGroupConfig[],
): MusicConfigV2 {
  return {
    version: 2,
    sample_rate: sampleRate,
    track_groups: groups.map((g, i) => ({
      id: i + 1,
      name: g.name,
      bpm: g.bpm,
      loop_start: g.loop_start,
      loop_end: g.loop_end,
      markers: [...g.markers].sort((a, b) => a.frame - b.frame),
      stems: g.stems.map((s) => ({
        source: s.source,
        initial_volume: s.initial_volume,
      })),
    })),
  };
}

/**
 * Trigger a browser download of a JSON object.
 */
export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
