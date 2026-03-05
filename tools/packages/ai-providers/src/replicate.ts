import type { AudioProvider, AudioGenerateOptions, AvailabilityResult } from "./types.js";

/**
 * Replicate API client for cloud-based audio generation.
 *
 * Uses the Replicate predictions API (https://replicate.com/docs/reference/http).
 * Requires an API token — NOT auto-registered in the provider registry.
 *
 * Default model: meta/musicgen (can be overridden in constructor).
 */
export class ReplicateClient implements AudioProvider {
  private readonly apiToken: string;
  private readonly model: string;
  private readonly baseUrl = "https://api.replicate.com/v1";

  /**
   * @param apiToken     - Replicate API token (required)
   * @param defaultModel - Model version string (default: meta/musicgen)
   */
  constructor(apiToken: string, defaultModel = "meta/musicgen") {
    this.apiToken = apiToken;
    this.model = defaultModel;
  }

  /**
   * Generate audio from a text prompt via Replicate.
   *
   * Creates a prediction, polls until complete, then fetches the output file.
   *
   * @param prompt - Text description of the desired audio
   * @param opts   - Optional generation parameters (duration, temperature)
   * @returns Raw audio bytes
   */
  async generateAudio(
    prompt: string,
    opts?: AudioGenerateOptions,
  ): Promise<ArrayBuffer> {
    const input: Record<string, unknown> = { prompt };
    if (opts?.duration !== undefined) input.duration = opts.duration;
    if (opts?.temperature !== undefined) input.temperature = opts.temperature;

    // Create prediction
    const createResp = await fetch(`${this.baseUrl}/predictions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
        Prefer: "wait",
      },
      body: JSON.stringify({
        version: this.model,
        input,
      }),
    });

    if (!createResp.ok) {
      const text = await createResp.text().catch(() => "(no body)");
      throw new Error(
        `Replicate create prediction failed: HTTP ${createResp.status} — ${text}`,
      );
    }

    let prediction = (await createResp.json()) as ReplicatePrediction;

    // Poll until terminal state (if Prefer: wait didn't resolve it)
    while (prediction.status === "starting" || prediction.status === "processing") {
      await sleep(1000);
      const pollResp = await fetch(prediction.urls.get, {
        headers: { Authorization: `Bearer ${this.apiToken}` },
      });
      if (!pollResp.ok) {
        throw new Error(`Replicate poll failed: HTTP ${pollResp.status}`);
      }
      prediction = (await pollResp.json()) as ReplicatePrediction;
    }

    if (prediction.status === "failed") {
      throw new Error(`Replicate prediction failed: ${prediction.error ?? "unknown error"}`);
    }

    if (prediction.status === "canceled") {
      throw new Error("Replicate prediction was canceled");
    }

    // Fetch output audio
    const outputUrl = Array.isArray(prediction.output)
      ? prediction.output[0]
      : prediction.output;

    if (!outputUrl || typeof outputUrl !== "string") {
      throw new Error("Replicate prediction returned no output URL");
    }

    const audioResp = await fetch(outputUrl);
    if (!audioResp.ok) {
      throw new Error(`Failed to fetch Replicate output: HTTP ${audioResp.status}`);
    }

    return audioResp.arrayBuffer();
  }

  /**
   * Check whether the Replicate API is reachable with valid credentials.
   */
  async isAvailable(): Promise<boolean> {
    return (await this.checkAvailability()).available;
  }

  /**
   * Check availability with a descriptive error message on failure.
   */
  async checkAvailability(): Promise<AvailabilityResult> {
    try {
      const resp = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiToken}` },
        signal: AbortSignal.timeout(5000),
      });
      if (resp.status === 401) {
        return { available: false, error: "Invalid Replicate API token." };
      }
      if (!resp.ok) {
        return {
          available: false,
          error: `Replicate returned HTTP ${resp.status}.`,
        };
      }
      return { available: true };
    } catch {
      return {
        available: false,
        error: "Cannot reach Replicate API. Check your internet connection.",
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ReplicatePrediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output: unknown;
  error: string | null;
  urls: { get: string; cancel: string };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
