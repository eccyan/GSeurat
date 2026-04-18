import type { MusicConfigV2 } from './types.js';
import { computeWaveformPeaks } from './waveformPeaks.js';

export async function parseConfigJson(text: string): Promise<MusicConfigV2> {
  const data = JSON.parse(text);
  if (data.version !== 2) throw new Error(`Unsupported version: ${data.version}`);
  return data as MusicConfigV2;
}

export async function decodeStemFile(
  file: File, audioContext: AudioContext,
): Promise<{ audioBuffer: AudioBuffer; waveformPeaks: Float32Array }> {
  const arrayBuffer = await file.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  const waveformPeaks = computeWaveformPeaks(audioBuffer);
  return { audioBuffer, waveformPeaks };
}
