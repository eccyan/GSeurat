/**
 * Extract dominant colors from an image using histogram-based sampling.
 * Returns up to `maxColors` RGBA tuples.
 */
export function extractColorsFromImage(
  imageData: ImageData,
  maxColors: number = 128,
): [number, number, number, number][] {
  const { data, width, height } = imageData;
  const bucketBits = 5; // group into 32 bins per channel (32768 total buckets)
  const shift = 8 - bucketBits;
  const bucketCount = (1 << bucketBits) ** 3;

  // Count pixels per bucket
  const counts = new Uint32Array(bucketCount);
  const sumR = new Float64Array(bucketCount);
  const sumG = new Float64Array(bucketCount);
  const sumB = new Float64Array(bucketCount);

  const totalPixels = width * height;
  for (let i = 0; i < totalPixels; i++) {
    const off = i * 4;
    const a = data[off + 3];
    if (a < 128) continue; // skip transparent pixels

    const r = data[off];
    const g = data[off + 1];
    const b = data[off + 2];

    const ri = r >> shift;
    const gi = g >> shift;
    const bi = b >> shift;
    const bucket = (ri << (bucketBits * 2)) | (gi << bucketBits) | bi;

    counts[bucket]++;
    sumR[bucket] += r;
    sumG[bucket] += g;
    sumB[bucket] += b;
  }

  // Collect non-empty buckets and sort by count descending
  const entries: { count: number; r: number; g: number; b: number }[] = [];
  for (let i = 0; i < bucketCount; i++) {
    if (counts[i] > 0) {
      entries.push({
        count: counts[i],
        r: Math.round(sumR[i] / counts[i]),
        g: Math.round(sumG[i] / counts[i]),
        b: Math.round(sumB[i] / counts[i]),
      });
    }
  }
  entries.sort((a, b) => b.count - a.count);

  // Take top N, filtering colors that are too similar
  const result: [number, number, number, number][] = [];
  for (const entry of entries) {
    if (result.length >= maxColors) break;

    // Check minimum distance to already-selected colors
    const tooClose = result.some(([r, g, b]) => {
      const dr = entry.r - r;
      const dg = entry.g - g;
      const db = entry.b - b;
      return (dr * dr + dg * dg + db * db) < 200; // ~14 distance threshold
    });
    if (tooClose) continue;

    result.push([entry.r, entry.g, entry.b, 255]);
  }

  return result;
}

/**
 * Load an image file and extract colors from it.
 */
export async function extractColorsFromFile(
  file: File,
  maxColors: number = 128,
): Promise<[number, number, number, number][]> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      // Sample at higher resolution for more color detail
      const maxDim = 512;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);

      URL.revokeObjectURL(url);
      resolve(extractColorsFromImage(imageData, maxColors));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve([]);
    };
    img.src = url;
  });
}
