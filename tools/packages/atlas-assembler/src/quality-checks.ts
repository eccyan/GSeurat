/**
 * Reusable quality checks for AI-generated sprite frames.
 * Used by both the atlas assembler CLI and Pixel Painter's AI generate handler.
 */

export interface QualityCheckResult {
  passed: boolean;
  checks: {
    name: string;
    passed: boolean;
    message: string;
  }[];
}

/**
 * Check if an image buffer is mostly black (>threshold% black pixels).
 * Expects raw RGBA pixel data.
 */
export function checkBlackBlob(
  pixels: Buffer | Uint8Array,
  width: number,
  height: number,
  threshold = 0.8,
): { passed: boolean; message: string } {
  const totalPixels = width * height;
  let blackCount = 0;

  for (let i = 0; i < totalPixels; i++) {
    const offset = i * 4;
    const r = pixels[offset]!;
    const g = pixels[offset + 1]!;
    const b = pixels[offset + 2]!;
    const a = pixels[offset + 3]!;
    // Consider a pixel "black" if all RGB < 10 and alpha > 128
    if (r < 10 && g < 10 && b < 10 && a > 128) {
      blackCount++;
    }
  }

  const ratio = blackCount / totalPixels;
  const passed = ratio < threshold;
  return {
    passed,
    message: passed
      ? `Black pixel ratio: ${(ratio * 100).toFixed(1)}% (OK)`
      : `Black pixel ratio: ${(ratio * 100).toFixed(1)}% exceeds ${(threshold * 100).toFixed(0)}% threshold`,
  };
}

/**
 * Check that image dimensions match expected values.
 */
export function checkDimensions(
  actualWidth: number,
  actualHeight: number,
  expectedWidth: number,
  expectedHeight: number,
): { passed: boolean; message: string } {
  const passed = actualWidth === expectedWidth && actualHeight === expectedHeight;
  return {
    passed,
    message: passed
      ? `Dimensions ${actualWidth}x${actualHeight} match expected`
      : `Dimensions ${actualWidth}x${actualHeight} do not match expected ${expectedWidth}x${expectedHeight}`,
  };
}

/**
 * Check if the image has any transparent pixels (alpha < 255).
 */
export function checkHasAlpha(
  pixels: Buffer | Uint8Array,
  width: number,
  height: number,
): { passed: boolean; message: string } {
  const totalPixels = width * height;
  let hasTransparent = false;

  for (let i = 0; i < totalPixels; i++) {
    if (pixels[i * 4 + 3]! < 255) {
      hasTransparent = true;
      break;
    }
  }

  return {
    passed: true, // This is a warning, not a failure
    message: hasTransparent
      ? "Image contains transparent pixels"
      : "Warning: no transparent pixels found (sprite may not be properly extracted)",
  };
}

/**
 * Check pixel color variance. Very low variance likely indicates degenerate output.
 */
export function checkPixelVariance(
  pixels: Buffer | Uint8Array,
  width: number,
  height: number,
  minVariance = 50,
): { passed: boolean; message: string } {
  const totalPixels = width * height;
  if (totalPixels === 0) {
    return { passed: false, message: "Empty image" };
  }

  // Compute mean RGB
  let sumR = 0, sumG = 0, sumB = 0;
  let opaqueCount = 0;

  for (let i = 0; i < totalPixels; i++) {
    const offset = i * 4;
    if (pixels[offset + 3]! > 128) {
      sumR += pixels[offset]!;
      sumG += pixels[offset + 1]!;
      sumB += pixels[offset + 2]!;
      opaqueCount++;
    }
  }

  if (opaqueCount === 0) {
    return { passed: true, message: "Fully transparent image (variance check skipped)" };
  }

  const meanR = sumR / opaqueCount;
  const meanG = sumG / opaqueCount;
  const meanB = sumB / opaqueCount;

  // Compute variance
  let varSum = 0;
  for (let i = 0; i < totalPixels; i++) {
    const offset = i * 4;
    if (pixels[offset + 3]! > 128) {
      const dr = pixels[offset]! - meanR;
      const dg = pixels[offset + 1]! - meanG;
      const db = pixels[offset + 2]! - meanB;
      varSum += dr * dr + dg * dg + db * db;
    }
  }

  const variance = Math.sqrt(varSum / (opaqueCount * 3));
  const passed = variance >= minVariance;
  return {
    passed,
    message: passed
      ? `Color variance: ${variance.toFixed(1)} (OK)`
      : `Color variance: ${variance.toFixed(1)} below minimum ${minVariance} (likely degenerate)`,
  };
}

/**
 * Run all quality checks on a raw RGBA pixel buffer.
 */
export function runAllChecks(
  pixels: Buffer | Uint8Array,
  width: number,
  height: number,
  expectedWidth: number,
  expectedHeight: number,
): QualityCheckResult {
  const checks = [
    { name: "dimensions", ...checkDimensions(width, height, expectedWidth, expectedHeight) },
    { name: "black_blob", ...checkBlackBlob(pixels, width, height) },
    { name: "alpha_channel", ...checkHasAlpha(pixels, width, height) },
    { name: "pixel_variance", ...checkPixelVariance(pixels, width, height) },
  ];

  return {
    passed: checks.every((c) => c.passed),
    checks,
  };
}
