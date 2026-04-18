import { computeWaveformPeaks } from './waveformPeaks.js';
import type { MusicConfigV2 } from './exportConfig.js';
import type { WeaverProjectFile, WeaverGroupConfig } from './projectTypes.js';

/**
 * Decode a stem audio file to AudioBuffer + waveform peaks.
 */
export async function decodeStemFile(
  file: File,
  ctx: AudioContext,
): Promise<{ audioBuffer: AudioBuffer; waveformPeaks: Float32Array }> {
  const arrayBuffer = await file.arrayBuffer();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  const waveformPeaks = computeWaveformPeaks(audioBuffer);
  return { audioBuffer, waveformPeaks };
}

/**
 * Parse a music_config.json v2 and validate its structure.
 */
export function parseConfigJson(json: string): MusicConfigV2 {
  const data = JSON.parse(json);
  if (data.version !== 2) {
    throw new Error(`Unsupported music_config version: ${data.version}`);
  }
  return data as MusicConfigV2;
}

/**
 * Migrate a legacy music_config.json v2 into a WeaverProjectFile.
 * Adds editor-only defaults (loop_enabled, muted, soloed).
 */
export function migrateV2ToWeaverProject(
  config: MusicConfigV2,
  projectName: string,
): WeaverProjectFile {
  const groups: WeaverGroupConfig[] = config.track_groups.map((tg) => ({
    id: tg.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      || `group-${tg.id}`,
    name: tg.name,
    bpm: tg.bpm ?? 120,
    loop_start: tg.loop_start,
    loop_end: tg.loop_end,
    loop_enabled: true,
    markers: tg.markers.map((m) => ({ frame: m.frame, name: m.name })),
    stems: tg.stems.map((s) => ({
      source: s.source,
      initial_volume: s.initial_volume,
      muted: false,
      soloed: false,
    })),
  }));
  return {
    version: 1,
    name: projectName,
    sample_rate: config.sample_rate,
    groups,
  };
}
