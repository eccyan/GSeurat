import type { AudioProvider, AudioGenerateOptions, AvailabilityResult } from "./types.js";

/** Request body for POST /generate. */
interface StableAudioGenerateRequest {
  prompt: string;
  duration?: number;
  steps?: number;
  cfg_scale?: number;
}

/** Response body from GET /health. */
interface HealthResponse {
  status: string;
  model?: string;
}

/**
 * HTTP client for a Stable Audio Open Small REST server.
 *
 * Expects a lightweight Python server wrapping `stable-audio-tools`
 * that exposes POST /generate (returns WAV bytes) and GET /health.
 *
 * Model: stabilityai/stable-audio-open-small
 * Output: 44.1 kHz stereo WAV, up to 11 seconds.
 *
 * @deprecated Use procedural generation (SFX Designer / Audio Composer built-in)
 * or ReplicateClient for cloud-based AI audio. This client requires a complex
 * Python 3.11 venv + gated HuggingFace model setup.
 *
 * @see https://huggingface.co/stabilityai/stable-audio-open-small
 */
export class StableAudioClient implements AudioProvider {
  private readonly baseUrl: string;

  /**
   * @param baseUrl - Stable Audio server base URL (default: http://localhost:8001)
   */
  constructor(baseUrl = "http://localhost:8001") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  /**
   * Generate audio from a text prompt via Stable Audio Open Small.
   *
   * @param prompt - Text description of the desired audio
   * @param opts   - Optional generation parameters (duration, steps, cfgScale)
   * @returns Raw WAV audio bytes
   */
  async generateAudio(
    prompt: string,
    opts?: AudioGenerateOptions
  ): Promise<ArrayBuffer> {
    const requestBody: StableAudioGenerateRequest = { prompt };

    if (opts?.duration !== undefined) {
      // Stable Audio Open Small supports up to 11 seconds
      requestBody.duration = Math.min(opts.duration, 11);
    }
    if (opts?.steps !== undefined) {
      requestBody.steps = opts.steps;
    }
    if (opts?.cfgScale !== undefined) {
      requestBody.cfg_scale = opts.cfgScale;
    }

    const response = await fetch(`${this.baseUrl}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "(no body)");
      throw new Error(
        `Stable Audio generate failed: HTTP ${response.status} ${response.statusText} — ${text}`
      );
    }

    const contentType = response.headers.get("Content-Type") ?? "";

    // Server returns raw WAV bytes
    if (contentType.startsWith("audio/")) {
      return response.arrayBuffer();
    }

    // Fallback: JSON envelope with base64 audio_data
    const data = (await response.json()) as { audio_data?: string; url?: string };

    if (data.audio_data) {
      return base64ToArrayBuffer(data.audio_data);
    }

    if (data.url) {
      const audioUrl = data.url.startsWith("http")
        ? data.url
        : `${this.baseUrl}${data.url}`;
      const audioResponse = await fetch(audioUrl);
      if (!audioResponse.ok) {
        throw new Error(
          `Stable Audio audio fetch failed: HTTP ${audioResponse.status} ${audioResponse.statusText}`
        );
      }
      return audioResponse.arrayBuffer();
    }

    throw new Error(
      "Stable Audio response contained neither audio bytes, audio_data, nor a url field"
    );
  }

  /**
   * Check whether the Stable Audio server is reachable and healthy.
   */
  async isAvailable(): Promise<boolean> {
    return (await this.checkAvailability()).available;
  }

  /**
   * Check availability with a descriptive error message on failure.
   */
  async checkAvailability(): Promise<AvailabilityResult> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        return {
          available: false,
          error: `Stable Audio returned HTTP ${response.status}. Ensure the server is running at ${this.baseUrl}.`,
        };
      }
      const data = (await response.json()) as HealthResponse;
      if (typeof data.status !== "string" || data.status.toLowerCase() !== "ok") {
        return {
          available: false,
          error: `Stable Audio server is not healthy (status: ${data.status ?? "unknown"}).`,
        };
      }
      return { available: true };
    } catch {
      return {
        available: false,
        error: `Cannot reach Stable Audio at ${this.baseUrl}. Start the server with: python tools/scripts/stable-audio-server.py`,
      };
    }
  }
}

/**
 * Decode a base64 string to an ArrayBuffer.
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}
