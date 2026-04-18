import type { MusicConfigV2, StemState, MarkerState } from './types.js';

export function exportMusicConfig(opts: {
  groupId: number; groupName: string; sampleRate: number; bpm: number;
  loopStart: number; loopEnd: number; markers: MarkerState[]; stems: StemState[];
}): MusicConfigV2 {
  return {
    version: 2,
    sample_rate: opts.sampleRate,
    track_groups: [{
      id: opts.groupId, name: opts.groupName, bpm: opts.bpm,
      loop_start: opts.loopStart, loop_end: opts.loopEnd,
      markers: [...opts.markers].sort((a, b) => a.frame - b.frame)
        .map(m => ({ frame: m.frame, name: m.name })),
      stems: opts.stems.map(s => ({ source: s.sourcePath, initial_volume: s.initialVolume })),
    }],
  };
}

export function downloadJson(data: MusicConfigV2, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
