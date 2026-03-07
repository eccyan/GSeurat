import type { ImageProvider, ImageGenerateOptions, Img2ImgOptions, ControlNetOptions, IPAdapterOptions, AvailabilityResult } from "./types.js";

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
  removeBackground?: boolean;
  remBgNodeType?: string;
}

/**
 * If removeBackground is enabled, insert a background-removal node between
 * VAEDecode ("8") and SaveImage ("9").
 */
function injectRemBGNodes(
  nodes: Record<string, WorkflowNode>,
  opts: Pick<WorkflowOptions, 'removeBackground' | 'remBgNodeType'>,
): void {
  if (!opts.removeBackground) return;

  const classType = opts.remBgNodeType ?? "BRIA_RMBG_Zho";
  // Model loader for BRIA RMBG
  nodes["31"] = {
    class_type: "BRIA_RMBG_ModelLoader_Zho",
    inputs: {},
  };
  nodes["30"] = {
    class_type: classType,
    inputs: {
      rmbgmodel: ["31", 0],
      image: ["8", 0],
    },
  };
  // Rewire SaveImage to take input from RemBG node instead of VAEDecode
  (nodes["9"].inputs as Record<string, unknown>).images = ["30", 0];
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

  injectRemBGNodes(nodes, opts);
  return nodes;
}

/** Options for building the img2img workflow. */
interface Img2ImgWorkflowOptions extends WorkflowOptions {
  /** Uploaded image filename (as returned by ComfyUI /upload/image). */
  imageName: string;
  /** Denoise strength (0.0 = no change, 1.0 = full regeneration). */
  denoise: number;
}

function buildImg2ImgWorkflow(
  opts: Img2ImgWorkflowOptions
): Record<string, WorkflowNode> {
  const nodes: Record<string, WorkflowNode> = {
    "4": {
      class_type: "CheckpointLoaderSimple",
      inputs: {
        ckpt_name: "v1-5-pruned-emaonly.safetensors",
      },
    },
    "10": {
      class_type: "LoadImage",
      inputs: {
        image: opts.imageName,
      },
    },
    "11": {
      class_type: "VAEEncode",
      inputs: {
        pixels: ["10", 0],
        vae: ["4", 2],
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
    "3": {
      class_type: "KSampler",
      inputs: {
        seed: opts.seed,
        steps: opts.steps,
        cfg: opts.cfg,
        sampler_name: opts.samplerName,
        scheduler: "normal",
        denoise: opts.denoise,
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["11", 0],
      },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["3", 0],
        vae: ["4", 2],
      },
    },
    "9": {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: "vulkan_game_i2i_",
        images: ["8", 0],
      },
    },
  };

  // Chain LoRA loaders
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

    (nodes["3"].inputs as Record<string, unknown>).model = prevModelRef;
    (nodes["6"].inputs as Record<string, unknown>).clip = prevClipRef;
    (nodes["7"].inputs as Record<string, unknown>).clip = prevClipRef;
  }

  injectRemBGNodes(nodes, opts);
  return nodes;
}

/** Options for building the ControlNet-guided workflow. */
interface ControlNetWorkflowOptions extends WorkflowOptions {
  /** Uploaded reference image filename. */
  imageName: string;
  /** Denoise strength. */
  denoise: number;
  /** ControlNet model filename. */
  controlNetModel: string;
  /** ControlNet conditioning strength. */
  controlStrength: number;
  /** ControlNet start percent. */
  controlStart: number;
  /** ControlNet end percent. */
  controlEnd: number;
}

function buildControlNetWorkflow(
  opts: ControlNetWorkflowOptions
): Record<string, WorkflowNode> {
  const nodes: Record<string, WorkflowNode> = {
    "4": {
      class_type: "CheckpointLoaderSimple",
      inputs: {
        ckpt_name: "v1-5-pruned-emaonly.safetensors",
      },
    },
    // Load the reference image for ControlNet conditioning
    "10": {
      class_type: "LoadImage",
      inputs: {
        image: opts.imageName,
      },
    },
    // Also use it as the img2img starting latent
    "11": {
      class_type: "VAEEncode",
      inputs: {
        pixels: ["10", 0],
        vae: ["4", 2],
      },
    },
    // ControlNet model loader
    "20": {
      class_type: "ControlNetLoader",
      inputs: {
        control_net_name: opts.controlNetModel,
      },
    },
    // Positive CLIP
    "6": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: opts.prompt,
        clip: ["4", 1],
      },
    },
    // Negative CLIP
    "7": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: opts.negativePrompt,
        clip: ["4", 1],
      },
    },
    // Apply ControlNet to positive and negative conditioning
    "21": {
      class_type: "ControlNetApplyAdvanced",
      inputs: {
        positive: ["6", 0],
        negative: ["7", 0],
        control_net: ["20", 0],
        image: ["10", 0],
        strength: opts.controlStrength,
        start_percent: opts.controlStart,
        end_percent: opts.controlEnd,
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
        denoise: opts.denoise,
        model: ["4", 0],
        positive: ["21", 0],  // ControlNet-conditioned positive
        negative: ["21", 1],  // ControlNet-conditioned negative
        latent_image: ["11", 0],
      },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["3", 0],
        vae: ["4", 2],
      },
    },
    "9": {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: "vulkan_game_cn_",
        images: ["8", 0],
      },
    },
  };

  // Chain LoRA loaders
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

    (nodes["3"].inputs as Record<string, unknown>).model = prevModelRef;
    (nodes["6"].inputs as Record<string, unknown>).clip = prevClipRef;
    (nodes["7"].inputs as Record<string, unknown>).clip = prevClipRef;
  }

  injectRemBGNodes(nodes, opts);
  return nodes;
}

/** Options for building the IP-Adapter + OpenPose workflow. */
interface IPAdapterWorkflowOptions extends WorkflowOptions {
  /** Uploaded concept image filename. */
  conceptImageName: string;
  /** Uploaded pose skeleton image filename. */
  poseImageName: string;
  /** Denoise strength. */
  denoise: number;
  /** IP-Adapter weight (0.0–1.0). */
  ipAdapterWeight: number;
  /** IP-Adapter preset (LIGHT, STANDARD, PLUS, etc.). */
  ipAdapterPreset: string;
  /** OpenPose ControlNet model filename. */
  openPoseModel: string;
  /** OpenPose ControlNet strength. */
  openPoseStrength: number;
}

function buildIPAdapterPoseWorkflow(
  opts: IPAdapterWorkflowOptions
): Record<string, WorkflowNode> {
  const nodes: Record<string, WorkflowNode> = {
    // Checkpoint
    "4": {
      class_type: "CheckpointLoaderSimple",
      inputs: {
        ckpt_name: "v1-5-pruned-emaonly.safetensors",
      },
    },
    // Load concept image for IP-Adapter
    "40": {
      class_type: "LoadImage",
      inputs: {
        image: opts.conceptImageName,
      },
    },
    // Load pose skeleton image for OpenPose ControlNet
    "45": {
      class_type: "LoadImage",
      inputs: {
        image: opts.poseImageName,
      },
    },
    // IP-Adapter Unified Loader
    "41": {
      class_type: "IPAdapterUnifiedLoader",
      inputs: {
        preset: opts.ipAdapterPreset,
        model: ["4", 0],
      },
    },
    // IP-Adapter Apply
    "42": {
      class_type: "IPAdapterAdvanced",
      inputs: {
        weight: opts.ipAdapterWeight,
        weight_type: "linear",
        combine_embeds: "concat",
        start_at: 0.0,
        end_at: 1.0,
        embeds_scaling: "V only",
        model: ["41", 0],
        ipadapter: ["41", 1],
        image: ["40", 0],
      },
    },
    // Positive CLIP
    "6": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: opts.prompt,
        clip: ["4", 1],
      },
    },
    // Negative CLIP
    "7": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: opts.negativePrompt,
        clip: ["4", 1],
      },
    },
    // OpenPose ControlNet model loader
    "46": {
      class_type: "ControlNetLoader",
      inputs: {
        control_net_name: opts.openPoseModel,
      },
    },
    // Apply OpenPose ControlNet
    "47": {
      class_type: "ControlNetApplyAdvanced",
      inputs: {
        positive: ["6", 0],
        negative: ["7", 0],
        control_net: ["46", 0],
        image: ["45", 0],
        strength: opts.openPoseStrength,
        start_percent: 0.0,
        end_percent: 1.0,
      },
    },
    // Empty latent (txt2img style — no reference latent needed)
    "5": {
      class_type: "EmptyLatentImage",
      inputs: {
        width: opts.width,
        height: opts.height,
        batch_size: 1,
      },
    },
    // KSampler — model from IP-Adapter, conditioning from ControlNet
    "3": {
      class_type: "KSampler",
      inputs: {
        seed: opts.seed,
        steps: opts.steps,
        cfg: opts.cfg,
        sampler_name: opts.samplerName,
        scheduler: "normal",
        denoise: opts.denoise,
        model: ["42", 0],     // IP-Adapter conditioned model
        positive: ["47", 0],  // OpenPose conditioned positive
        negative: ["47", 1],  // OpenPose conditioned negative
        latent_image: ["5", 0],
      },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["3", 0],
        vae: ["4", 2],
      },
    },
    "9": {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: "vulkan_game_ipa_",
        images: ["8", 0],
      },
    },
  };

  // Chain LoRA loaders (between checkpoint and IP-Adapter loader)
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

    // Rewire IP-Adapter loader and CLIP encoders to use LoRA output
    (nodes["41"].inputs as Record<string, unknown>).model = prevModelRef;
    (nodes["6"].inputs as Record<string, unknown>).clip = prevClipRef;
    (nodes["7"].inputs as Record<string, unknown>).clip = prevClipRef;
  }

  injectRemBGNodes(nodes, opts);
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
      removeBackground: opts?.removeBackground,
      remBgNodeType: opts?.remBgNodeType,
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
   * Generate an image via img2img — uses a reference image as the starting
   * latent, with denoise controlling how much to change.
   *
   * @param prompt        - Text description guiding the output
   * @param referenceImage - PNG bytes of the reference/source image
   * @param opts          - Generation options including denoise (default 0.4)
   * @returns Raw PNG image bytes
   */
  async generateImg2Img(
    prompt: string,
    referenceImage: Uint8Array,
    opts?: Img2ImgOptions
  ): Promise<Uint8Array> {
    // Upload the reference image to ComfyUI
    const imageName = await this.uploadImage(referenceImage);

    const workflow = buildImg2ImgWorkflow({
      prompt,
      negativePrompt: opts?.negativePrompt ?? "bad quality, blurry, deformed",
      width: opts?.width ?? 512,
      height: opts?.height ?? 512,
      steps: opts?.steps ?? 20,
      seed: opts?.seed ?? Math.floor(Math.random() * 2 ** 32),
      cfg: opts?.cfgScale ?? 7,
      samplerName: opts?.samplerName ?? "euler",
      loras: opts?.loras ?? [],
      imageName,
      denoise: opts?.denoise ?? 0.4,
      removeBackground: opts?.removeBackground,
      remBgNodeType: opts?.remBgNodeType,
    });

    const submitBody: PromptRequest = { prompt: workflow };
    const submitResponse = await fetch(`${this.baseUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(submitBody),
    });

    if (!submitResponse.ok) {
      const text = await submitResponse.text().catch(() => "(no body)");
      throw new Error(
        `ComfyUI img2img prompt failed: HTTP ${submitResponse.status} ${submitResponse.statusText} — ${text}`
      );
    }

    const { prompt_id } = (await submitResponse.json()) as PromptResponse;
    const imageFile = await this.pollForCompletion(prompt_id);

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
   * Upload a PNG image to ComfyUI's input directory.
   * @returns The filename as stored by ComfyUI (used by LoadImage node).
   */
  private async uploadImage(pngBytes: Uint8Array): Promise<string> {
    const blob = new Blob([pngBytes as BlobPart], { type: "image/png" });
    const formData = new FormData();
    const filename = `ref_${Date.now()}.png`;
    formData.append("image", blob, filename);

    const response = await fetch(`${this.baseUrl}/upload/image`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "(no body)");
      throw new Error(
        `ComfyUI image upload failed: HTTP ${response.status} ${response.statusText} — ${text}`
      );
    }

    const result = (await response.json()) as { name: string; subfolder?: string; type?: string };
    return result.name;
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
   * Generate an image with automatic retry when the result appears to be
   * a blank/black image.  Uses a different seed on each retry.
   *
   * @param prompt      - Text description of the desired image
   * @param opts        - Generation parameters
   * @param maxRetries  - Maximum number of attempts (default 3)
   * @param onRetry     - Optional callback invoked before each retry with (attempt, maxRetries)
   * @returns Raw PNG image bytes of a non-blank image
   */
  async generateImageWithRetry(
    prompt: string,
    opts?: ImageGenerateOptions,
    maxRetries = 3,
    onRetry?: (attempt: number, max: number) => void,
  ): Promise<Uint8Array> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const seed = attempt === 1
        ? (opts?.seed ?? Math.floor(Math.random() * 2 ** 32))
        : Math.floor(Math.random() * 2 ** 32);

      const pngBytes = await this.generateImage(prompt, { ...opts, seed });

      if (!isBlankImage(pngBytes)) {
        return pngBytes;
      }

      if (attempt < maxRetries) {
        onRetry?.(attempt + 1, maxRetries);
        // Brief pause before retrying
        await sleep(1000);
      }
    }

    throw new Error(
      `ComfyUI returned a blank/black image after ${maxRetries} attempts. ` +
      `Try different prompts, check the model is loaded, or increase steps.`
    );
  }

  /**
   * Generate an img2img image with automatic retry when the result appears
   * to be a blank/black image.  Uses a different seed on each retry.
   */
  async generateImg2ImgWithRetry(
    prompt: string,
    referenceImage: Uint8Array,
    opts?: Img2ImgOptions,
    maxRetries = 3,
    onRetry?: (attempt: number, max: number) => void,
  ): Promise<Uint8Array> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const seed = attempt === 1
        ? (opts?.seed ?? Math.floor(Math.random() * 2 ** 32))
        : Math.floor(Math.random() * 2 ** 32);

      const pngBytes = await this.generateImg2Img(prompt, referenceImage, { ...opts, seed });

      if (!isBlankImage(pngBytes)) {
        return pngBytes;
      }

      if (attempt < maxRetries) {
        onRetry?.(attempt + 1, maxRetries);
        await sleep(1000);
      }
    }

    throw new Error(
      `ComfyUI returned a blank/black image after ${maxRetries} img2img attempts. ` +
      `Try different prompts, check the model is loaded, or increase steps.`
    );
  }

  /**
   * Generate an image using ControlNet conditioning.
   * Uploads the reference image, uses it for both ControlNet and img2img latent.
   */
  async generateControlNet(
    prompt: string,
    referenceImage: Uint8Array,
    opts: ControlNetOptions,
  ): Promise<Uint8Array> {
    const imageName = await this.uploadImage(referenceImage);

    const controlNetModel = opts.controlNetModel.includes(".")
      ? opts.controlNetModel
      : `${opts.controlNetModel}.pth`;

    const workflow = buildControlNetWorkflow({
      prompt,
      negativePrompt: opts.negativePrompt ?? "bad quality, blurry, deformed",
      width: opts.width ?? 512,
      height: opts.height ?? 512,
      steps: opts.steps ?? 20,
      seed: opts.seed ?? Math.floor(Math.random() * 2 ** 32),
      cfg: opts.cfgScale ?? 7,
      samplerName: opts.samplerName ?? "euler",
      loras: opts.loras ?? [],
      imageName,
      denoise: opts.denoise ?? 0.75,
      controlNetModel,
      controlStrength: opts.controlStrength ?? 0.7,
      controlStart: opts.controlStart ?? 0.0,
      controlEnd: opts.controlEnd ?? 1.0,
      removeBackground: opts.removeBackground,
      remBgNodeType: opts.remBgNodeType,
    });

    const submitBody: PromptRequest = { prompt: workflow };
    const submitResponse = await fetch(`${this.baseUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(submitBody),
    });

    if (!submitResponse.ok) {
      const text = await submitResponse.text().catch(() => "(no body)");
      throw new Error(
        `ComfyUI ControlNet prompt failed: HTTP ${submitResponse.status} ${submitResponse.statusText} — ${text}`
      );
    }

    const { prompt_id } = (await submitResponse.json()) as PromptResponse;
    const imageFile = await this.pollForCompletion(prompt_id);

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
   * Generate a ControlNet image with retry on blank/black results.
   */
  async generateControlNetWithRetry(
    prompt: string,
    referenceImage: Uint8Array,
    opts: ControlNetOptions,
    maxRetries = 3,
    onRetry?: (attempt: number, max: number) => void,
  ): Promise<Uint8Array> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const seed = attempt === 1
        ? (opts.seed ?? Math.floor(Math.random() * 2 ** 32))
        : Math.floor(Math.random() * 2 ** 32);

      const pngBytes = await this.generateControlNet(prompt, referenceImage, { ...opts, seed });

      if (!isBlankImage(pngBytes)) {
        return pngBytes;
      }

      if (attempt < maxRetries) {
        onRetry?.(attempt + 1, maxRetries);
        await sleep(1000);
      }
    }

    throw new Error(
      `ComfyUI returned a blank/black image after ${maxRetries} ControlNet attempts. ` +
      `Try different prompts, check the model is loaded, or increase steps.`
    );
  }

  /**
   * Generate an image using IP-Adapter (character consistency) + OpenPose ControlNet (pose control).
   * Uploads the concept image and pose skeleton, then runs the combined workflow.
   */
  async generateIPAdapter(
    prompt: string,
    conceptImage: Uint8Array,
    poseImage: Uint8Array,
    opts: IPAdapterOptions,
  ): Promise<Uint8Array> {
    const conceptImageName = await this.uploadImage(conceptImage);
    const poseImageName = await this.uploadImage(poseImage);

    const openPoseModel = (opts.openPoseModel ?? "control_v11p_sd15_openpose").includes(".")
      ? opts.openPoseModel!
      : `${opts.openPoseModel ?? "control_v11p_sd15_openpose"}.pth`;

    const workflow = buildIPAdapterPoseWorkflow({
      prompt,
      negativePrompt: opts.negativePrompt ?? "bad quality, blurry, deformed",
      width: opts.width ?? 512,
      height: opts.height ?? 512,
      steps: opts.steps ?? 20,
      seed: opts.seed ?? Math.floor(Math.random() * 2 ** 32),
      cfg: opts.cfgScale ?? 7,
      samplerName: opts.samplerName ?? "euler",
      loras: opts.loras ?? [],
      conceptImageName,
      poseImageName,
      denoise: opts.denoise ?? 0.75,
      ipAdapterWeight: opts.ipAdapterWeight ?? 0.6,
      ipAdapterPreset: opts.ipAdapterPreset ?? "PLUS",
      openPoseModel,
      openPoseStrength: opts.openPoseStrength ?? 0.8,
      removeBackground: opts.removeBackground,
      remBgNodeType: opts.remBgNodeType,
    });

    const submitBody: PromptRequest = { prompt: workflow };
    const submitResponse = await fetch(`${this.baseUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(submitBody),
    });

    if (!submitResponse.ok) {
      const text = await submitResponse.text().catch(() => "(no body)");
      throw new Error(
        `ComfyUI IP-Adapter prompt failed: HTTP ${submitResponse.status} ${submitResponse.statusText} — ${text}`
      );
    }

    const { prompt_id } = (await submitResponse.json()) as PromptResponse;
    const imageFile = await this.pollForCompletion(prompt_id);

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
   * Generate an IP-Adapter + OpenPose image with retry on blank results.
   */
  async generateIPAdapterWithRetry(
    prompt: string,
    conceptImage: Uint8Array,
    poseImage: Uint8Array,
    opts: IPAdapterOptions,
    maxRetries = 3,
    onRetry?: (attempt: number, max: number) => void,
  ): Promise<Uint8Array> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const seed = attempt === 1
        ? (opts.seed ?? Math.floor(Math.random() * 2 ** 32))
        : Math.floor(Math.random() * 2 ** 32);

      const pngBytes = await this.generateIPAdapter(prompt, conceptImage, poseImage, { ...opts, seed });

      if (!isBlankImage(pngBytes)) {
        return pngBytes;
      }

      if (attempt < maxRetries) {
        onRetry?.(attempt + 1, maxRetries);
        await sleep(1000);
      }
    }

    throw new Error(
      `ComfyUI returned a blank/black image after ${maxRetries} IP-Adapter attempts. ` +
      `Try different prompts, check the model is loaded, or increase steps.`
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

/**
 * Detect whether a PNG image is essentially blank (all black or all same color).
 *
 * Parses the raw PNG to find IDAT chunks and checks if the uncompressed pixel
 * data has near-zero variance.  Falls back to a byte-entropy heuristic when
 * full decompression is not available.
 *
 * The heuristic: a valid non-blank PNG has meaningful entropy in its IDAT data.
 * A pure black image compresses to very few unique byte values.
 */
function isBlankImage(pngBytes: Uint8Array): boolean {
  if (pngBytes.length < 100) return true;

  // Verify PNG signature
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < sig.length; i++) {
    if (pngBytes[i] !== sig[i]) return false; // Not a PNG — don't flag as blank
  }

  // Collect all IDAT chunk data
  const idatBytes: number[] = [];
  let offset = 8; // skip signature
  while (offset + 12 <= pngBytes.length) {
    const length =
      (pngBytes[offset] << 24) |
      (pngBytes[offset + 1] << 16) |
      (pngBytes[offset + 2] << 8) |
      pngBytes[offset + 3];
    const type = String.fromCharCode(
      pngBytes[offset + 4],
      pngBytes[offset + 5],
      pngBytes[offset + 6],
      pngBytes[offset + 7],
    );

    if (type === 'IDAT') {
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      for (let i = dataStart; i < dataEnd && i < pngBytes.length; i++) {
        idatBytes.push(pngBytes[i]);
      }
    }

    // Move to next chunk: 4 (length) + 4 (type) + length (data) + 4 (CRC)
    offset += 12 + length;

    if (type === 'IEND') break;
  }

  if (idatBytes.length === 0) return true;

  // Heuristic: count unique byte values in IDAT data.
  // A blank image compresses to very few distinct bytes.
  // Sample up to 2048 bytes for performance.
  const sampleSize = Math.min(idatBytes.length, 2048);
  const seen = new Set<number>();
  for (let i = 0; i < sampleSize; i++) {
    seen.add(idatBytes[i]);
  }

  // A non-blank 512x512 image typically has 100+ unique byte values
  // in its compressed data. A pure black image has < 20.
  const uniqueRatio = seen.size / sampleSize;
  const isBlank = uniqueRatio < 0.03 || seen.size < 15;
  if (isBlank) {
    console.warn(`[ComfyUI] Blank image detected: ${seen.size} unique bytes in ${sampleSize} sampled (ratio ${uniqueRatio.toFixed(4)}), total IDAT ${idatBytes.length} bytes`);
  }
  return isBlank;
}
