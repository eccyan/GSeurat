export function computeWaveformPeaks(buffer: AudioBuffer, numBuckets: number = 1000): Float32Array {
  const data = buffer.getChannelData(0);
  const bucketSize = Math.ceil(data.length / numBuckets);
  const peaks = new Float32Array(numBuckets);
  for (let i = 0; i < numBuckets; i++) {
    let max = 0;
    const start = i * bucketSize;
    const end = Math.min(start + bucketSize, data.length);
    for (let j = start; j < end; j++) {
      const abs = Math.abs(data[j]);
      if (abs > max) max = abs;
    }
    peaks[i] = max;
  }
  return peaks;
}
