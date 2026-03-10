/**
 * Integration tests for ComfyUIClient against a running ComfyUI server.
 *
 * These tests require:
 *   - ComfyUI running at http://127.0.0.1:8188
 *   - v1-5-pruned-emaonly.safetensors checkpoint
 *   - (optional) BRIA_RMBG custom node for removeBackground tests
 *   - (optional) IP-Adapter PLUS + CLIP-ViT-H-14 + OpenPose for IP-Adapter tests
 *
 * Run:  pnpm exec vitest run src/comfyui.integration.test.ts
 * Skip: tests auto-skip when ComfyUI is not reachable.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { ComfyUIClient } from "./comfyui.js";

const COMFY_URL = "http://127.0.0.1:8188";

/** Check if a Uint8Array starts with the PNG magic header. */
function isPng(data: Uint8Array): boolean {
  return (
    data.length > 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47
  );
}

describe("ComfyUIClient integration", () => {
  const client = new ComfyUIClient(COMFY_URL, 500, 180_000);
  let comfyAvailable = false;
  let hasRemBg = false;
  let hasIPAdapter = false;
  /** A 128x128 reference PNG generated via txt2img in beforeAll. */
  let refImage: Uint8Array;

  beforeAll(async () => {
    // Check if ComfyUI is reachable
    const result = await client.checkAvailability();
    comfyAvailable = result.available;
    if (!comfyAvailable) {
      console.warn("ComfyUI not reachable — skipping integration tests");
      return;
    }

    // Probe for RemBG node
    try {
      const res = await fetch(`${COMFY_URL}/object_info/BRIA_RMBG_Zho`);
      hasRemBg = res.ok;
    } catch {
      hasRemBg = false;
    }

    // Probe for IP-Adapter node
    try {
      const res = await fetch(`${COMFY_URL}/object_info/IPAdapterAdvanced`);
      hasIPAdapter = res.ok;
    } catch {
      hasIPAdapter = false;
    }

    console.log(
      `ComfyUI: available=${comfyAvailable}, RemBG=${hasRemBg}, IPAdapter=${hasIPAdapter}`
    );

    // Generate a 128x128 reference image via txt2img for use in later tests.
    // This avoids the problem of hand-crafted tiny PNGs being too small for
    // SD 1.5's VAE (minimum ~8x8 after downsampling).
    refImage = await client.generateImage("a knight character on white background", {
      width: 128,
      height: 128,
      steps: 4,
      cfgScale: 7,
      samplerName: "euler",
      seed: 42,
    });
    console.log(`Reference image generated: ${refImage.length} bytes`);
  }, 120_000);

  // ─── Availability ────────────────────────────────────────────────

  it("checkAvailability returns available=true", async () => {
    const result = await client.checkAvailability();
    if (!result.available) {
      console.warn("Skipped: ComfyUI not running");
      return;
    }
    expect(result.available).toBe(true);
  });

  // ─── txt2img ─────────────────────────────────────────────────────

  it("generateImage (txt2img) returns a valid PNG", async () => {
    if (!comfyAvailable) return;

    const png = await client.generateImage("a red circle on white background", {
      width: 128,
      height: 128,
      steps: 4,
      cfgScale: 7,
      samplerName: "euler",
      seed: 42,
    });

    expect(png).toBeInstanceOf(Uint8Array);
    expect(png.length).toBeGreaterThan(100);
    expect(isPng(png)).toBe(true);
  }, 120_000);

  // ─── img2img ─────────────────────────────────────────────────────

  it("generateImg2Img returns a valid PNG", async () => {
    if (!comfyAvailable) return;

    const png = await client.generateImg2Img(
      "a blue square on white background",
      refImage,
      {
        width: 128,
        height: 128,
        steps: 4,
        cfgScale: 7,
        samplerName: "euler",
        seed: 42,
        denoise: 0.8,
      }
    );

    expect(png).toBeInstanceOf(Uint8Array);
    expect(png.length).toBeGreaterThan(100);
    expect(isPng(png)).toBe(true);
  }, 120_000);

  // ─── RemBG ───────────────────────────────────────────────────────

  it("removeBackground returns a valid PNG", async () => {
    if (!comfyAvailable || !hasRemBg) {
      console.warn("Skipped: requires ComfyUI + BRIA_RMBG node");
      return;
    }

    const png = await client.removeBackground(refImage);

    expect(png).toBeInstanceOf(Uint8Array);
    expect(png.length).toBeGreaterThan(50);
    expect(isPng(png)).toBe(true);
  }, 120_000);

  // ─── IP-Adapter (no pose) ────────────────────────────────────────

  it("generateIPAdapterOnly returns a valid PNG", async () => {
    if (!comfyAvailable || !hasIPAdapter) {
      console.warn("Skipped: requires ComfyUI + IPAdapterAdvanced node");
      return;
    }

    const png = await client.generateIPAdapterOnly(
      "chibi character, solid white background",
      refImage,
      {
        width: 128,
        height: 128,
        steps: 4,
        cfgScale: 7,
        samplerName: "euler",
        seed: 42,
        ipAdapterWeight: 0.5,
        ipAdapterEndAt: 0.6,
        ipAdapterPreset: "PLUS (high strength)",
      }
    );

    expect(png).toBeInstanceOf(Uint8Array);
    expect(png.length).toBeGreaterThan(100);
    expect(isPng(png)).toBe(true);
  }, 180_000);

  // ─── IP-Adapter + OpenPose ───────────────────────────────────────

  it("generateIPAdapter (with pose) returns a valid PNG", async () => {
    if (!comfyAvailable || !hasIPAdapter) {
      console.warn("Skipped: requires ComfyUI + IPAdapterAdvanced node");
      return;
    }

    const png = await client.generateIPAdapter(
      "pixel art character, standing, solid white background",
      refImage,
      refImage, // use same image as placeholder pose
      {
        width: 128,
        height: 128,
        steps: 4,
        cfgScale: 7,
        samplerName: "euler",
        seed: 42,
        ipAdapterWeight: 0.5,
        ipAdapterEndAt: 0.6,
        ipAdapterPreset: "PLUS (high strength)",
        openPoseModel: "control_v11p_sd15_openpose",
        openPoseStrength: 0.8,
      }
    );

    expect(png).toBeInstanceOf(Uint8Array);
    expect(png.length).toBeGreaterThan(100);
    expect(isPng(png)).toBe(true);
  }, 180_000);

  // ─── Two-pass IP-Adapter ─────────────────────────────────────────

  it("generateTwoPassIPAdapter returns a valid PNG", async () => {
    if (!comfyAvailable || !hasIPAdapter || !hasRemBg) {
      console.warn(
        "Skipped: requires ComfyUI + IPAdapterAdvanced + BRIA_RMBG nodes"
      );
      return;
    }

    const png = await client.generateTwoPassIPAdapter(
      "chibi pixel art character, standing, solid white background",
      refImage,  // concept
      refImage,  // chibi (reuse for testing)
      refImage,  // pose (reuse for testing)
      {
        width: 128,
        height: 128,
        steps: 4,
        cfgScale: 7,
        samplerName: "euler",
        seed: 42,
        ipAdapterWeight: 0.5,
        ipAdapterEndAt: 0.6,
        ipAdapterPreset: "PLUS (high strength)",
        openPoseModel: "control_v11p_sd15_openpose",
        openPoseStrength: 0.8,
        chibiWeight: 0.6,
        chibiDenoise: 0.7,
        removeBackground: true,
        remBgNodeType: "BRIA_RMBG_Zho",
        outputWidth: 128,
        outputHeight: 128,
      }
    );

    expect(png).toBeInstanceOf(Uint8Array);
    expect(png.length).toBeGreaterThan(100);
    expect(isPng(png)).toBe(true);
  }, 300_000);

  // ─── img2img + IP-Adapter (Pass 2 pipeline) ────────────────────

  it("generateImg2ImgWithIPAdapter returns a valid PNG", async () => {
    if (!comfyAvailable || !hasIPAdapter || !hasRemBg) {
      console.warn(
        "Skipped: requires ComfyUI + IPAdapterAdvanced + BRIA_RMBG nodes"
      );
      return;
    }

    const png = await client.generateImg2ImgWithIPAdapter(
      "chibi pixel art character, standing, solid white background",
      refImage, // input image (pass1 output)
      refImage, // reference image (chibi)
      {
        width: 128,
        height: 128,
        steps: 4,
        cfgScale: 7,
        samplerName: "euler",
        seed: 42,
        denoise: 0.7,
        ipAdapterWeight: 0.5,
        ipAdapterPreset: "PLUS (high strength)",
        ipAdapterStartAt: 0.0,
        ipAdapterEndAt: 0.6,
      }
    );

    expect(png).toBeInstanceOf(Uint8Array);
    expect(png.length).toBeGreaterThan(100);
    expect(isPng(png)).toBe(true);
  }, 180_000);

  it("generateImg2ImgWithIPAdapterWithRetry returns a valid PNG", async () => {
    if (!comfyAvailable || !hasIPAdapter || !hasRemBg) {
      console.warn(
        "Skipped: requires ComfyUI + IPAdapterAdvanced + BRIA_RMBG nodes"
      );
      return;
    }

    const png = await client.generateImg2ImgWithIPAdapterWithRetry(
      "chibi pixel art character, standing, solid white background",
      refImage,
      refImage,
      {
        width: 128,
        height: 128,
        steps: 4,
        cfgScale: 7,
        samplerName: "euler",
        seed: 42,
        denoise: 0.7,
        ipAdapterWeight: 0.5,
        ipAdapterPreset: "PLUS (high strength)",
      },
      2
    );

    expect(png).toBeInstanceOf(Uint8Array);
    expect(png.length).toBeGreaterThan(100);
    expect(isPng(png)).toBe(true);
  }, 180_000);

  // ─── Retry wrapper (blank image detection) ───────────────────────

  it("generateImageWithRetry retries on blank images", async () => {
    if (!comfyAvailable) return;

    const png = await client.generateImageWithRetry(
      "a green triangle on white background",
      {
        width: 128,
        height: 128,
        steps: 4,
        cfgScale: 7,
        samplerName: "euler",
        seed: 123,
      },
      2
    );

    expect(png).toBeInstanceOf(Uint8Array);
    expect(isPng(png)).toBe(true);
  }, 120_000);

  // ─── Error handling ──────────────────────────────────────────────

  it("detects execution errors instead of timing out", async () => {
    if (!comfyAvailable) return;

    // Use a short timeout — with the fix, errors should be detected
    // immediately instead of polling until timeout.
    const fastClient = new ComfyUIClient(COMFY_URL, 200, 15_000);

    await expect(
      fastClient.generateImage("test", {
        width: 128,
        height: 128,
        steps: 4,
        checkpoint: "NONEXISTENT_MODEL_12345.safetensors",
      })
    ).rejects.toThrow(/error/i);
  }, 30_000);

  it("checkAvailability returns available=false for unreachable server", async () => {
    const badClient = new ComfyUIClient("http://127.0.0.1:19999");
    const result = await badClient.checkAvailability();
    expect(result.available).toBe(false);
    expect(result.error).toBeDefined();
  });
});
