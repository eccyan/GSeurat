export function frameToPixel(frame: number, viewStart: number, viewEnd: number, width: number): number {
  if (viewEnd === viewStart) return 0;
  return ((frame - viewStart) / (viewEnd - viewStart)) * width;
}

export function pixelToFrame(px: number, viewStart: number, viewEnd: number, width: number): number {
  if (width === 0) return viewStart;
  return Math.round(viewStart + (px / width) * (viewEnd - viewStart));
}

export function framesToSeconds(frame: number, sampleRate: number): number {
  return frame / sampleRate;
}

export function secondsToFrames(seconds: number, sampleRate: number): number {
  return Math.round(seconds * sampleRate);
}

export function frameToBarBeat(frame: number, sampleRate: number, bpm: number): { bar: number; beat: number } {
  const seconds = frame / sampleRate;
  const totalBeats = (seconds * bpm) / 60;
  const bar = Math.floor(totalBeats / 4) + 1;
  const beat = Math.floor(totalBeats % 4) + 1;
  return { bar, beat };
}
