import type { ImageProvider, ImageGenerateOptions, AvailabilityResult } from "./types.js";

/** Response shape from POST /sdapi/v1/txt2img. */
interface Txt2ImgResponse {
  images: string[]; // base64-encoded PNG
  parameters: Record<string, unknown>;
  info: string;
}

/** Partial response from GET /sdapi/v1/sd-models. */
interface SDModel {
  title: string;
  model_name: string;
}

/**
 * HTTP client for SD WebUI Forge (or AUTOMATIC1111) API.
 *
 * Forge is a faster, more efficient fork of A1111 with the same API.
 * Recommended model: SD 1.5 based (<4GB) for lightweight pixel art generation.
 *
 * @see https://github.com/lllyasviel/stable-diffusion-webui-forge
 */
export class StableDiffusionWebUIClient implements ImageProvider {
  private readonly baseUrl: string;

  /**
   * @param baseUrl - SD WebUI Forge server base URL (default: http://localhost:7860)
   */
  constructor(baseUrl = "http://localhost:7860") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  /**
   * Generate an image from a text prompt via the SD WebUI txt2img API.
   *
   * @param prompt - Text description of the desired image
   * @param opts   - Optional generation parameters
   * @returns Raw PNG image bytes
   */
  async generateImage(
    prompt: string,
    opts?: ImageGenerateOptions
  ): Promise<Uint8Array> {
    const width = opts?.width ?? 512;
    const height = opts?.height ?? 512;
    const steps = opts?.steps ?? 20;
    const seed = opts?.seed ?? -1;
    const negativePrompt = opts?.negativePrompt ?? "";
    const cfgScale = opts?.cfgScale ?? 7;
    const samplerName = opts?.samplerName ?? "Euler a";
    const loras = opts?.loras ?? [];

    // Inject LoRA tags into the prompt (SD WebUI syntax: <lora:name:weight>)
    let finalPrompt = prompt;
    if (loras.length > 0) {
      const loraTags = loras
        .map((l) => `<lora:${l.name}:${l.weight ?? 1.0}>`)
        .join(" ");
      finalPrompt = `${prompt} ${loraTags}`;
    }

    const body = {
      prompt: finalPrompt,
      negative_prompt: negativePrompt,
      width,
      height,
      steps,
      seed,
      cfg_scale: cfgScale,
      sampler_name: samplerName,
      batch_size: 1,
      n_iter: 1,
    };

    const response = await fetch(`${this.baseUrl}/sdapi/v1/txt2img`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "(no body)");
      throw new Error(
        `SD WebUI txt2img failed: HTTP ${response.status} ${response.statusText} — ${text}`
      );
    }

    const data = (await response.json()) as Txt2ImgResponse;

    if (!data.images || data.images.length === 0) {
      throw new Error("SD WebUI returned no images");
    }

    // Decode base64 PNG to Uint8Array
    const base64 = data.images[0];
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Check whether the SD WebUI server is reachable.
   */
  async isAvailable(): Promise<boolean> {
    return (await this.checkAvailability()).available;
  }

  /**
   * Check availability with a descriptive error message on failure.
   */
  async checkAvailability(): Promise<AvailabilityResult> {
    try {
      const response = await fetch(`${this.baseUrl}/sdapi/v1/sd-models`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        return {
          available: false,
          error: `SD WebUI returned HTTP ${response.status}. Ensure Forge is running at ${this.baseUrl}.`,
        };
      }
      const data = (await response.json()) as SDModel[];
      if (!Array.isArray(data)) {
        return { available: false, error: "SD WebUI returned unexpected response format." };
      }
      return { available: true };
    } catch {
      return {
        available: false,
        error: `Cannot reach SD WebUI at ${this.baseUrl}. Start Forge with: ./webui.sh --api`,
      };
    }
  }
}
