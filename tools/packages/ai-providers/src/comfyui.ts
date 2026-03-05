import type { ImageProvider, ImageGenerateOptions, AvailabilityResult } from "./types.js";

/** A single node entry in a ComfyUI workflow graph. */
interface WorkflowNode {
  class_type: string;
  inputs: Record<string, unknown>;
}

/** Prompt submission request body. */
interface PromptRequest {
  prompt: Record<string, WorkflowNode>;
}

/** Response returned by POST /prompt. */
interface PromptResponse {
  prompt_id: string;
}

/** Output image file entry inside history. */
interface HistoryImageFile {
  filename: string;
  subfolder: string;
  type: string;
}

/** Per-node output inside a history entry. */
interface HistoryNodeOutput {
  images?: HistoryImageFile[];
}

/** A single history entry for a prompt ID. */
interface HistoryEntry {
  outputs: Record<string, HistoryNodeOutput>;
  status: {
    completed: boolean;
    status_str: string;
  };
}

/** GET /history/{id} response shape. */
type HistoryResponse = Record<string, HistoryEntry>;

/** GET /system_stats response (partial). */
interface SystemStats {
  system: Record<string, unknown>;
}

/** LoRA entry for workflow generation. */
interface LoraEntry {
  name: string;
  weight?: number;
}

/** Options for building the txt2img workflow. */
interface WorkflowOptions {
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  steps: number;
  seed: number;
  cfg: number;
  samplerName: string;
  loras: LoraEntry[];
}

function buildTxt2ImgWorkflow(
  opts: WorkflowOptions
): Record<string, WorkflowNode> {
  const nodes: Record<string, WorkflowNode> = {
    "4": {
      class_type: "CheckpointLoaderSimple",
      inputs: {
        ckpt_name: "v1-5-pruned-emaonly.safetensors",
      },
    },
    "5": {
      class_type: "EmptyLatentImage",
      inputs: {
        width: opts.width,
        height: opts.height,
        batch_size: 1,
      },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: opts.prompt,
        clip: ["4", 1],
      },
    },
    "7": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: opts.negativePrompt,
        clip: ["4", 1],
      },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["3", 0],
        vae: ["4", 2],
      },
    },
    "3": {
      class_type: "KSampler",
      inputs: {
        seed: opts.seed,
        steps: opts.steps,
        cfg: opts.cfg,
        sampler_name: opts.samplerName,
        scheduler: "normal",
        denoise: 1,
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
      },
    },
    "9": {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: "vulkan_game_",
        images: ["8", 0],
      },
    },
  };

  // Chain LoRA loaders between checkpoint and KSampler/CLIP
  // Each LoraLoader takes model+clip in, outputs model+clip out
  if (opts.loras.length > 0) {
    let prevModelRef: [string, number] = ["4", 0];
    let prevClipRef: [string, number] = ["4", 1];

    opts.loras.forEach((lora, i) => {
      const nodeId = `lora_${i}`;
      const weight = lora.weight ?? 1.0;
      nodes[nodeId] = {
        class_type: "LoraLoader",
        inputs: {
          lora_name: lora.name.includes(".") ? lora.name : `${lora.name}.safetensors`,
          strength_model: weight,
          strength_clip: weight,
          model: prevModelRef,
          clip: prevClipRef,
        },
      };
      prevModelRef = [nodeId, 0];
      prevClipRef = [nodeId, 1];
    });

    // Rewire KSampler and CLIP encoders to use final LoRA output
    (nodes["3"].inputs as Record<string, unknown>).model = prevModelRef;
    (nodes["6"].inputs as Record<string, unknown>).clip = prevClipRef;
    (nodes["7"].inputs as Record<string, unknown>).clip = prevClipRef;
  }

  return nodes;
}

/**
 * HTTP client for ComfyUI local image generation server.
 *
 * @see https://github.com/comfyanonymous/ComfyUI
 */
export class ComfyUIClient implements ImageProvider {
  private readonly baseUrl: string;
  private readonly pollIntervalMs: number;
  private readonly pollTimeoutMs: number;

  /**
   * @param baseUrl        - ComfyUI server base URL (default: http://localhost:8188)
   * @param pollIntervalMs - How often to poll /history while waiting (default: 500ms)
   * @param pollTimeoutMs  - Maximum time to wait for generation (default: 120000ms)
   */
  constructor(
    baseUrl = "http://localhost:8188",
    pollIntervalMs = 500,
    pollTimeoutMs = 120_000
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.pollIntervalMs = pollIntervalMs;
    this.pollTimeoutMs = pollTimeoutMs;
  }

  /**
   * Generate an image from a text prompt via ComfyUI's txt2img workflow.
   *
   * @param prompt - Text description of the desired image
   * @param opts   - Optional generation parameters (width, height, steps, seed)
   * @returns Raw PNG image bytes
   */
  async generateImage(
    prompt: string,
    opts?: ImageGenerateOptions
  ): Promise<Uint8Array> {
    const workflow = buildTxt2ImgWorkflow({
      prompt,
      negativePrompt: opts?.negativePrompt ?? "bad quality, blurry, deformed",
      width: opts?.width ?? 512,
      height: opts?.height ?? 512,
      steps: opts?.steps ?? 20,
      seed: opts?.seed ?? Math.floor(Math.random() * 2 ** 32),
      cfg: opts?.cfgScale ?? 7,
      samplerName: opts?.samplerName ?? "euler",
      loras: opts?.loras ?? [],
    });

    // Submit the prompt
    const submitBody: PromptRequest = { prompt: workflow };
    const submitResponse = await fetch(`${this.baseUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(submitBody),
    });

    if (!submitResponse.ok) {
      const text = await submitResponse.text().catch(() => "(no body)");
      throw new Error(
        `ComfyUI prompt submission failed: HTTP ${submitResponse.status} ${submitResponse.statusText} — ${text}`
      );
    }

    const { prompt_id } = (await submitResponse.json()) as PromptResponse;

    // Poll /history/{id} until generation completes
    const imageFile = await this.pollForCompletion(prompt_id);

    // Fetch the generated image bytes
    const imageUrl = `${this.baseUrl}/view?filename=${encodeURIComponent(
      imageFile.filename
    )}&subfolder=${encodeURIComponent(imageFile.subfolder)}&type=${encodeURIComponent(
      imageFile.type
    )}`;

    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(
        `ComfyUI image fetch failed: HTTP ${imageResponse.status} ${imageResponse.statusText}`
      );
    }

    const buffer = await imageResponse.arrayBuffer();
    return new Uint8Array(buffer);
  }

  /**
   * Poll GET /history/{id} until the job completes, then return the first
   * output image file descriptor.
   */
  private async pollForCompletion(promptId: string): Promise<HistoryImageFile> {
    const deadline = Date.now() + this.pollTimeoutMs;

    while (Date.now() < deadline) {
      await sleep(this.pollIntervalMs);

      const response = await fetch(`${this.baseUrl}/history/${promptId}`);
      if (!response.ok) continue;

      const history = (await response.json()) as HistoryResponse;
      const entry = history[promptId];

      if (!entry) continue;
      if (!entry.status.completed) continue;

      if (entry.status.status_str === "error") {
        throw new Error(`ComfyUI generation error for prompt ${promptId}`);
      }

      // Find the first image output across all nodes
      for (const nodeOutput of Object.values(entry.outputs)) {
        if (nodeOutput.images && nodeOutput.images.length > 0) {
          return nodeOutput.images[0];
        }
      }

      throw new Error(
        `ComfyUI prompt ${promptId} completed but produced no image outputs`
      );
    }

    throw new Error(
      `ComfyUI generation timed out after ${this.pollTimeoutMs}ms for prompt ${promptId}`
    );
  }

  /**
   * Check whether the ComfyUI server is reachable and responding.
   *
   * @returns true if GET /system_stats returns a valid response, false otherwise
   */
  async isAvailable(): Promise<boolean> {
    return (await this.checkAvailability()).available;
  }

  /**
   * Check availability with a descriptive error message on failure.
   */
  async checkAvailability(): Promise<AvailabilityResult> {
    try {
      const response = await fetch(`${this.baseUrl}/system_stats`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        return {
          available: false,
          error: `ComfyUI returned HTTP ${response.status}. Ensure ComfyUI is running at ${this.baseUrl}.`,
        };
      }
      const data = (await response.json()) as SystemStats;
      if (typeof data.system !== "object" || data.system === null) {
        return { available: false, error: 'ComfyUI returned unexpected response format.' };
      }
      return { available: true };
    } catch {
      return {
        available: false,
        error: `Cannot reach ComfyUI at ${this.baseUrl}. Start it with: python main.py --listen`,
      };
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
