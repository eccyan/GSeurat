import { pipeline, env } from '@huggingface/transformers';

// Use remote models only (no local FS), cache in browser IndexedDB
env.allowLocalModels = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let depthPipeline: any = null;

async function getPipeline(
  onProgress?: (progress: number) => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  if (depthPipeline) return depthPipeline;

  depthPipeline = await (pipeline as Function)('depth-estimation', 'onnx-community/depth-anything-v2-small', {
    dtype: 'fp32',
    progress_callback: (info: { status: string; progress?: number }) => {
      if (info.status === 'progress' && info.progress != null && onProgress) {
        onProgress(info.progress);
      }
    },
  });

  return depthPipeline;
}

/**
 * Estimate per-pixel depth from an image using Depth Anything V2.
 * Returns a Float32Array of normalized depth values (0..1) in row-major order,
 * where 0 = closest to camera and 1 = farthest.
 */
export async function estimateDepth(
  imageData: ImageData,
  onProgress?: (progress: number) => void,
): Promise<{ depthMap: Float32Array; width: number; height: number }> {
  const pipe = await getPipeline(onProgress);

  // Convert ImageData to a blob URL that transformers.js can read
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(imageData, 0, 0);

  const blob = await new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b!), 'image/png');
  });
  const url = URL.createObjectURL(blob);

  try {
    const result = await pipe(url);
    // Handle both single and array output
    const output = Array.isArray(result) ? result[0] : result;
    const depthImage = output.depth;

    // The output is a RawImage — extract the data
    const data = depthImage.data as Float32Array;
    const width = depthImage.width as number;
    const height = depthImage.height as number;

    // Normalize to 0..1 range
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < data.length; i++) {
      if (data[i] < min) min = data[i];
      if (data[i] > max) max = data[i];
    }

    const range = max - min || 1;
    const normalized = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) {
      normalized[i] = (data[i] - min) / range;
    }

    return { depthMap: normalized, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}
