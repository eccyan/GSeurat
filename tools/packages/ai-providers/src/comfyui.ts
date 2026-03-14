import type { ImageProvider, ImageGenerateOptions, Img2ImgOptions, ControlNetOptions, IPAdapterOptions, TwoPassIPAdapterOptions, Img2ImgWithIPAdapterOptions, AnimateDiffOptions, AvailabilityResult } from "./types.js";

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
    messages?: Array<[string, Record<string, unknown>]>;
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
  scheduler?: string;
  loras: LoraEntry[];
  checkpoint?: string;
  vae?: string;
  removeBackground?: boolean;
  remBgNodeType?: string;
}

/**
 * If removeBackground is enabled, insert a background-removal node just before
 * SaveImage ("9"). Reads whatever SaveImage currently points to (could be
 * VAEDecode from pass 1, 2, or 3 depending on the workflow).
 */
function injectRemBGNodes(
  nodes: Record<string, WorkflowNode>,
  opts: Pick<WorkflowOptions, 'removeBackground' | 'remBgNodeType'>,
): void {
  if (!opts.removeBackground) return;

  const classType = opts.remBgNodeType ?? "BRIA_RMBG_Zho";
  // Grab whatever SaveImage currently reads from (the final image source)
  const saveInputs = nodes["9"].inputs as Record<string, unknown>;
  const currentSource = saveInputs.images;

  // Model loader for BRIA RMBG
  nodes["31"] = {
    class_type: "BRIA_RMBG_ModelLoader_Zho",
    inputs: {},
  };
  nodes["30"] = {
    class_type: classType,
    inputs: {
      rmbgmodel: ["31", 0],
      image: currentSource,
    },
  };
  // Rewire SaveImage to take input from RemBG node
  saveInputs.images = ["30", 0];
}

function buildTxt2ImgWorkflow(
  opts: WorkflowOptions
): Record<string, WorkflowNode> {
  const nodes: Record<string, WorkflowNode> = {
    "4": {
      class_type: "CheckpointLoaderSimple",
      inputs: {
        ckpt_name: opts.checkpoint ?? "v1-5-pruned-emaonly.safetensors",
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
        scheduler: opts.scheduler ?? "normal",
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

  // Optional external VAE loader
  if (opts.vae) {
    nodes["20"] = {
      class_type: "VAELoader",
      inputs: { vae_name: opts.vae },
    };
    (nodes["8"].inputs as Record<string, unknown>).vae = ["20", 0];
  }

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
        ckpt_name: opts.checkpoint ?? "v1-5-pruned-emaonly.safetensors",
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
        scheduler: opts.scheduler ?? "normal",
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

  // Optional external VAE loader
  if (opts.vae) {
    nodes["20"] = {
      class_type: "VAELoader",
      inputs: { vae_name: opts.vae },
    };
    (nodes["11"].inputs as Record<string, unknown>).vae = ["20", 0];
    (nodes["8"].inputs as Record<string, unknown>).vae = ["20", 0];
  }

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
        ckpt_name: opts.checkpoint ?? "v1-5-pruned-emaonly.safetensors",
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
        scheduler: opts.scheduler ?? "normal",
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

  // Optional external VAE loader (use node "25" to avoid conflict with ControlNet "20")
  if (opts.vae) {
    nodes["25"] = {
      class_type: "VAELoader",
      inputs: { vae_name: opts.vae },
    };
    (nodes["11"].inputs as Record<string, unknown>).vae = ["25", 0];
    (nodes["8"].inputs as Record<string, unknown>).vae = ["25", 0];
  }

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

/** Options for building the IP-Adapter-only workflow (txt2img + IP-Adapter, no ControlNet). */
interface IPAdapterOnlyWorkflowOptions extends WorkflowOptions {
  /** Uploaded reference image filename. */
  referenceImageName: string;
  /** IP-Adapter weight (0.0–1.0). */
  ipAdapterWeight: number;
  /** IP-Adapter preset (LIGHT, STANDARD, PLUS, etc.). */
  ipAdapterPreset: string;
  /** IP-Adapter start_at — begin applying at this denoising % (0.0–1.0). */
  ipAdapterStartAt: number;
  /** IP-Adapter end_at — stop applying at this denoising % (0.0–1.0). */
  ipAdapterEndAt: number;
}

/**
 * txt2img + IP-Adapter workflow (no ControlNet/pose required).
 * The prompt controls style/proportions while IP-Adapter preserves identity from the reference.
 */
function buildIPAdapterOnlyWorkflow(
  opts: IPAdapterOnlyWorkflowOptions
): Record<string, WorkflowNode> {
  const embedsScaling = "V only";
  const nodes: Record<string, WorkflowNode> = {
    // Checkpoint
    "4": {
      class_type: "CheckpointLoaderSimple",
      inputs: {
        ckpt_name: opts.checkpoint ?? "v1-5-pruned-emaonly.safetensors",
      },
    },
    // Empty latent (txt2img — generate from scratch)
    "5": {
      class_type: "EmptyLatentImage",
      inputs: {
        width: opts.width,
        height: opts.height,
        batch_size: 1,
      },
    },
    // Load reference image for IP-Adapter
    "40": {
      class_type: "LoadImage",
      inputs: { image: opts.referenceImageName },
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
        start_at: opts.ipAdapterStartAt,
        end_at: opts.ipAdapterEndAt,
        embeds_scaling: embedsScaling,
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
    // KSampler — uses IP-Adapter-enhanced model, empty latent (txt2img)
    "3": {
      class_type: "KSampler",
      inputs: {
        seed: opts.seed,
        steps: opts.steps,
        cfg: opts.cfg,
        sampler_name: opts.samplerName,
        scheduler: opts.scheduler ?? "normal",
        denoise: 1,
        model: ["42", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
      },
    },
    // VAE Decode
    "8": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["3", 0],
        vae: ["4", 2],
      },
    },
    // Save
    "9": {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: "vulkan_game_",
        images: ["8", 0],
      },
    },
  };

  // Optional external VAE
  if (opts.vae) {
    nodes["20"] = {
      class_type: "VAELoader",
      inputs: { vae_name: opts.vae },
    };
    (nodes["8"].inputs as Record<string, unknown>).vae = ["20", 0];
  }

  // Chain LoRA loaders between checkpoint and IP-Adapter/CLIP
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

    // IP-Adapter loader takes model from final LoRA
    (nodes["41"].inputs as Record<string, unknown>).model = prevModelRef;
    // CLIP encoders use final LoRA clip
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
  /** IP-Adapter start_at — begin applying at this denoising % (0.0–1.0). */
  ipAdapterStartAt: number;
  /** IP-Adapter end_at — stop applying at this denoising % (0.0–1.0). */
  ipAdapterEndAt: number;
  /** OpenPose ControlNet model filename. */
  openPoseModel: string;
  /** OpenPose ControlNet strength. */
  openPoseStrength: number;
  /** Final output width (downscale from generation resolution). */
  outputWidth?: number;
  /** Final output height (downscale from generation resolution). */
  outputHeight?: number;
  /** Downscale interpolation method. Default "nearest-exact". */
  downscaleMethod?: string;
}

function buildIPAdapterPoseWorkflow(
  opts: IPAdapterWorkflowOptions
): Record<string, WorkflowNode> {
  const embedsScaling = "V only";
  const nodes: Record<string, WorkflowNode> = {
    // Checkpoint
    "4": {
      class_type: "CheckpointLoaderSimple",
      inputs: {
        ckpt_name: opts.checkpoint ?? "v1-5-pruned-emaonly.safetensors",
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
        start_at: opts.ipAdapterStartAt,
        end_at: opts.ipAdapterEndAt,
        embeds_scaling: embedsScaling,
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
        scheduler: opts.scheduler ?? "normal",
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

  // Optional external VAE loader
  if (opts.vae) {
    nodes["60"] = {
      class_type: "VAELoader",
      inputs: { vae_name: opts.vae },
    };
    (nodes["8"].inputs as Record<string, unknown>).vae = ["60", 0];
  }

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

  // Downscale from generation resolution to final sprite size
  if (opts.outputWidth && opts.outputHeight &&
      (opts.outputWidth !== opts.width || opts.outputHeight !== opts.height)) {
    const saveInputs = nodes["9"].inputs as Record<string, unknown>;
    const currentSource = saveInputs.images;
    nodes["50"] = {
      class_type: "ImageScale",
      inputs: {
        upscale_method: opts.downscaleMethod ?? "nearest-exact",
        width: opts.outputWidth,
        height: opts.outputHeight,
        crop: "disabled",
        image: currentSource,
      },
    };
    saveInputs.images = ["50", 0];
  }

  return nodes;
}

/** Options for building the two-pass IP-Adapter workflow (Concept→Pose→Chibi→Pixel). */
interface TwoPassIPAdapterWorkflowOptions extends WorkflowOptions {
  /** Uploaded concept image filename (for pass 1 identity). */
  conceptImageName: string;
  /** Uploaded chibi image filename (for pass 2 style transfer). */
  chibiImageName: string;
  /** Uploaded pose skeleton image filename. */
  poseImageName: string;
  /** IP-Adapter weight for pass 1 (concept identity). */
  ipAdapterWeight: number;
  /** IP-Adapter preset for pass 1. */
  ipAdapterPreset: string;
  /** IP-Adapter start_at for pass 1. */
  ipAdapterStartAt: number;
  /** IP-Adapter end_at for pass 1. */
  ipAdapterEndAt: number;
  /** OpenPose ControlNet model filename. */
  openPoseModel: string;
  /** OpenPose ControlNet strength. */
  openPoseStrength: number;
  /** IP-Adapter weight for pass 2 (chibi style). */
  chibiWeight: number;
  /** Denoise for pass 2 (how much to chibi-fy; lower = closer to posed concept). */
  chibiDenoise: number;
  /** Final output width. */
  outputWidth?: number;
  /** Final output height. */
  outputHeight?: number;
  /** Enable pixel art pass 3 (LoRA-based pixelization). */
  pixelPassEnabled?: boolean;
  /** Denoise strength for pixel pass 3. Default 0.35. */
  pixelPassDenoise?: number;
  /** LoRA models to apply during pixel pass 3. */
  pixelPassLoras?: LoraEntry[];
  /** Downscale interpolation method. Default "nearest-exact". */
  downscaleMethod?: string;
}

/**
 * Two-pass workflow: Concept Art + Pose → Posed Character → Chibi-fy → Pixelize
 *
 * Pass 1: IP-Adapter (concept) + OpenPose → posed concept at 512x512
 * Pass 2: IP-Adapter (chibi ref) + img2img (pass 1 output) with low denoise → chibi-fied
 * Then downscale to final sprite size.
 */
function buildTwoPassIPAdapterWorkflow(
  opts: TwoPassIPAdapterWorkflowOptions
): Record<string, WorkflowNode> {
  const pass1EmbedScaling = "V only";
  const pass2EmbedScaling = "K+mean(V) w/ C penalty";
  const nodes: Record<string, WorkflowNode> = {
    // === Shared: Checkpoint ===
    "4": {
      class_type: "CheckpointLoaderSimple",
      inputs: {
        ckpt_name: opts.checkpoint ?? "v1-5-pruned-emaonly.safetensors",
      },
    },

    // === Pass 1: Concept + Pose → Posed character ===

    // Load concept image for IP-Adapter (identity source)
    "40": {
      class_type: "LoadImage",
      inputs: { image: opts.conceptImageName },
    },
    // Load pose skeleton for OpenPose ControlNet
    "45": {
      class_type: "LoadImage",
      inputs: { image: opts.poseImageName },
    },
    // IP-Adapter Unified Loader (pass 1)
    "41": {
      class_type: "IPAdapterUnifiedLoader",
      inputs: {
        preset: opts.ipAdapterPreset,
        model: ["4", 0],
      },
    },
    // IP-Adapter Apply (pass 1 — concept identity)
    "42": {
      class_type: "IPAdapterAdvanced",
      inputs: {
        weight: opts.ipAdapterWeight,
        weight_type: "linear",
        combine_embeds: "concat",
        start_at: opts.ipAdapterStartAt,
        end_at: opts.ipAdapterEndAt,
        embeds_scaling: pass1EmbedScaling,
        model: ["41", 0],
        ipadapter: ["41", 1],
        image: ["40", 0],
      },
    },
    // Positive CLIP (pass 1 — concept prompt focuses on pose)
    "6": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: opts.prompt,
        clip: ["4", 1],
      },
    },
    // Negative CLIP (shared)
    "7": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: opts.negativePrompt,
        clip: ["4", 1],
      },
    },
    // OpenPose ControlNet loader
    "46": {
      class_type: "ControlNetLoader",
      inputs: { control_net_name: opts.openPoseModel },
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
    // Empty latent for pass 1 (txt2img style)
    "5": {
      class_type: "EmptyLatentImage",
      inputs: {
        width: opts.width,
        height: opts.height,
        batch_size: 1,
      },
    },
    // KSampler pass 1 — full generation from concept + pose
    "3": {
      class_type: "KSampler",
      inputs: {
        seed: opts.seed,
        steps: opts.steps,
        cfg: opts.cfg,
        sampler_name: opts.samplerName,
        scheduler: opts.scheduler ?? "normal",
        denoise: 1.0,
        model: ["42", 0],     // IP-Adapter conditioned model
        positive: ["47", 0],  // OpenPose conditioned positive
        negative: ["47", 1],  // OpenPose conditioned negative
        latent_image: ["5", 0],
      },
    },
    // VAEDecode pass 1 output (intermediate — used as input for pass 2)
    "8": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["3", 0],
        vae: ["4", 2],
      },
    },

    // === Inter-pass: Remove background from pass 1 output and composite on white ===
    // RemBG strips background to black/transparent. If fed directly to VAEEncode,
    // the black regions become noise in latent space that pass 2 turns into swirling
    // artifacts. So we composite the character onto solid white first.
    "70": {
      class_type: "BRIA_RMBG_ModelLoader_Zho",
      inputs: {},
    },
    "71": {
      class_type: opts.remBgNodeType ?? "BRIA_RMBG_Zho",
      inputs: {
        rmbgmodel: ["70", 0],
        image: ["8", 0],  // pass 1 VAEDecode output
      },
    },
    // Create solid white background image
    "72": {
      class_type: "SolidMask",
      inputs: {
        value: 1.0,
        width: opts.width,
        height: opts.height,
      },
    },
    "73": {
      class_type: "MaskToImage",
      inputs: {
        mask: ["72", 0],
      },
    },
    // Composite character (from RemBG) onto white using the RemBG mask
    "74": {
      class_type: "ImageCompositeMasked",
      inputs: {
        destination: ["73", 0],   // white background
        source: ["8", 0],         // original pass 1 output (full RGB)
        x: 0,
        y: 0,
        resize_source: false,
        mask: ["71", 1],          // RemBG foreground mask (slot 1)
      },
    },

    // === Pass 2: Chibi-fy the posed character ===

    // Load chibi reference image for IP-Adapter pass 2
    "80": {
      class_type: "LoadImage",
      inputs: { image: opts.chibiImageName },
    },
    // VAEEncode the character-on-white as starting latent for pass 2
    "81": {
      class_type: "VAEEncode",
      inputs: {
        pixels: ["74", 0],  // character on white background
        vae: ["4", 2],
      },
    },
    // IP-Adapter Unified Loader (pass 2 — reuses same checkpoint model)
    "82": {
      class_type: "IPAdapterUnifiedLoader",
      inputs: {
        preset: opts.ipAdapterPreset,
        model: ["4", 0],
      },
    },
    // IP-Adapter Apply (pass 2 — chibi style)
    "83": {
      class_type: "IPAdapterAdvanced",
      inputs: {
        weight: opts.chibiWeight,
        weight_type: "linear",
        combine_embeds: "concat",
        start_at: 0.0,
        end_at: 0.6,
        embeds_scaling: pass2EmbedScaling,
        model: ["82", 0],
        ipadapter: ["82", 1],
        image: ["80", 0],
      },
    },
    // Positive CLIP (pass 2 — chibi style prompt)
    "84": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: opts.prompt + ", chibi style, cute, big head, small body, deformed proportions, plain white background, solid color background",
        clip: ["4", 1],
      },
    },
    // KSampler pass 2 — low denoise img2img to chibi-fy
    "85": {
      class_type: "KSampler",
      inputs: {
        seed: opts.seed,
        steps: opts.steps,
        cfg: opts.cfg,
        sampler_name: opts.samplerName,
        scheduler: opts.scheduler ?? "normal",
        denoise: opts.chibiDenoise,
        model: ["83", 0],     // IP-Adapter (chibi) conditioned model
        positive: ["84", 0],  // Chibi style positive
        negative: ["7", 0],   // Shared negative
        latent_image: ["81", 0], // Pass 1 output as starting latent
      },
    },
    // VAEDecode pass 2
    "86": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["85", 0],
        vae: ["4", 2],
      },
    },
    // Save final output (source will be rewired by pass 3 / downscale / RemBG if active)
    "9": {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: "vulkan_game_2pass_",
        images: ["86", 0],
      },
    },
  };

  // === Pass 3: Pixel art LoRA refinement (optional) ===
  if (opts.pixelPassEnabled) {
    const pixelLoras = opts.pixelPassLoras ?? [{ name: "PixelArtRedmond15V-PixelArt-PIXARFK", weight: 0.6 }];

    // Chain pixel LoRA loaders onto checkpoint model/clip
    let prevPixelModel: [string, number] = ["4", 0];
    let prevPixelClip: [string, number] = ["4", 1];
    pixelLoras.forEach((lora, i) => {
      const nodeId = `90_lora_${i}`;
      const weight = lora.weight ?? 1.0;
      nodes[nodeId] = {
        class_type: "LoraLoader",
        inputs: {
          lora_name: lora.name.includes(".") ? lora.name : `${lora.name}.safetensors`,
          strength_model: weight,
          strength_clip: weight,
          model: prevPixelModel,
          clip: prevPixelClip,
        },
      };
      prevPixelModel = [nodeId, 0];
      prevPixelClip = [nodeId, 1];
    });

    // Inter-pass RemBG between pass 2→3: strip background and composite on white
    // (same approach as pass 1→2 to prevent background leakage into pixel pass)
    nodes["75"] = {
      class_type: opts.remBgNodeType ?? "BRIA_RMBG_Zho",
      inputs: {
        rmbgmodel: ["70", 0],  // reuse RemBG model loader from pass 1→2
        image: ["86", 0],      // pass 2 VAEDecode output
      },
    };
    nodes["76"] = {
      class_type: "SolidMask",
      inputs: { value: 1.0, width: opts.width, height: opts.height },
    };
    nodes["77"] = {
      class_type: "MaskToImage",
      inputs: { mask: ["76", 0] },
    };
    nodes["78"] = {
      class_type: "ImageCompositeMasked",
      inputs: {
        destination: ["77", 0],   // white background
        source: ["86", 0],        // pass 2 output (full RGB)
        x: 0, y: 0, resize_source: false,
        mask: ["75", 1],          // RemBG foreground mask
      },
    };

    // VAEEncode the cleaned pass 2 output (character on white) for pass 3
    nodes["91"] = {
      class_type: "VAEEncode",
      inputs: {
        pixels: ["78", 0],  // character on white (after inter-pass RemBG)
        vae: ["4", 2],
      },
    };
    // Positive CLIP for pixel art style
    nodes["92"] = {
      class_type: "CLIPTextEncode",
      inputs: {
        text: opts.prompt + ", pixel art, 8-bit, clean edges, retro game sprite, plain white background, solid color background",
        clip: prevPixelClip,
      },
    };
    // KSampler pass 3 — low denoise pixel art refinement
    nodes["93"] = {
      class_type: "KSampler",
      inputs: {
        seed: opts.seed,
        steps: opts.steps,
        cfg: opts.cfg,
        sampler_name: opts.samplerName,
        scheduler: opts.scheduler ?? "normal",
        denoise: opts.pixelPassDenoise ?? 0.35,
        model: prevPixelModel,
        positive: ["92", 0],
        negative: ["7", 0],
        latent_image: ["91", 0],
      },
    };
    // VAEDecode pass 3
    nodes["94"] = {
      class_type: "VAEDecode",
      inputs: {
        samples: ["93", 0],
        vae: ["4", 2],
      },
    };

    // Rewire SaveImage to take pass 3 output
    (nodes["9"].inputs as Record<string, unknown>).images = ["94", 0];
  }

  // Optional external VAE loader
  if (opts.vae) {
    nodes["60"] = {
      class_type: "VAELoader",
      inputs: { vae_name: opts.vae },
    };
    // Rewire all VAE references
    (nodes["8"].inputs as Record<string, unknown>).vae = ["60", 0];
    (nodes["81"].inputs as Record<string, unknown>).vae = ["60", 0];
    (nodes["86"].inputs as Record<string, unknown>).vae = ["60", 0];
    // Pass 3 VAE nodes (if pixel pass enabled)
    if (nodes["91"]) (nodes["91"].inputs as Record<string, unknown>).vae = ["60", 0];
    if (nodes["94"]) (nodes["94"].inputs as Record<string, unknown>).vae = ["60", 0];
  }

  // Chain LoRA loaders (between checkpoint and both IP-Adapter loaders)
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

    // Rewire both IP-Adapter loaders and CLIP encoders to use LoRA output
    (nodes["41"].inputs as Record<string, unknown>).model = prevModelRef;
    (nodes["82"].inputs as Record<string, unknown>).model = prevModelRef;
    (nodes["6"].inputs as Record<string, unknown>).clip = prevClipRef;
    (nodes["7"].inputs as Record<string, unknown>).clip = prevClipRef;
    (nodes["84"].inputs as Record<string, unknown>).clip = prevClipRef;
  }

  injectRemBGNodes(nodes, opts);

  // Downscale from generation resolution to final sprite size
  if (opts.outputWidth && opts.outputHeight &&
      (opts.outputWidth !== opts.width || opts.outputHeight !== opts.height)) {
    const saveInputs = nodes["9"].inputs as Record<string, unknown>;
    const currentSource = saveInputs.images;
    nodes["50"] = {
      class_type: "ImageScale",
      inputs: {
        upscale_method: opts.downscaleMethod ?? "nearest-exact",
        width: opts.outputWidth,
        height: opts.outputHeight,
        crop: "disabled",
        image: currentSource,
      },
    };
    saveInputs.images = ["50", 0];
  }

  return nodes;
}

/** Options for building the AnimateDiff workflow. */
interface AnimateDiffWorkflowOptions extends WorkflowOptions {
  /** Uploaded reference image filename. */
  imageName: string;
  /** Denoise strength. */
  denoise: number;
  /** Motion model filename (e.g. "mm_sd_v15_v2.ckpt"). */
  motionModel: string;
  /** Number of frames to generate. */
  frameCount: number;
  /** Output frame rate. */
  frameRate: number;
  /** Context length for uniform context options. */
  contextLength: number;
  /** Output format (e.g. "image/gif", "image/webp"). */
  outputFormat: string;
  /** Loop count (0 = infinite). */
  loopCount: number;
}

function buildAnimateDiffWorkflow(
  opts: AnimateDiffWorkflowOptions
): Record<string, WorkflowNode> {
  const nodes: Record<string, WorkflowNode> = {
    // Checkpoint
    "4": {
      class_type: "CheckpointLoaderSimple",
      inputs: {
        ckpt_name: opts.checkpoint ?? "v1-5-pruned-emaonly.safetensors",
      },
    },
    // Load the reference image
    "10": {
      class_type: "LoadImage",
      inputs: {
        image: opts.imageName,
      },
    },
    // Encode reference image to latent
    "11": {
      class_type: "VAEEncode",
      inputs: {
        pixels: ["10", 0],
        vae: ["4", 2],
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
    // Load AnimateDiff motion model
    "70": {
      class_type: "ADE_LoadAnimateDiffModel",
      inputs: {
        model_name: opts.motionModel,
      },
    },
    // Apply AnimateDiff motion model (outputs M_MODELS)
    "71": {
      class_type: "ADE_ApplyAnimateDiffModelSimple",
      inputs: {
        motion_model: ["70", 0],
      },
    },
    // Use Evolved Sampling — takes MODEL from checkpoint + M_MODELS from AnimateDiff
    "72": {
      class_type: "ADE_UseEvolvedSampling",
      inputs: {
        model: ["4", 0],
        m_models: ["71", 0],
        beta_schedule: "autoselect",
      },
    },
    // Context options for temporal consistency
    "73": {
      class_type: "ADE_StandardUniformContextOptions",
      inputs: {
        context_length: opts.contextLength,
        context_stride: 1,
        context_overlap: 4,
        fuse_method: "flat",
        use_on_equal_length: false,
        start_percent: 0.0,
        guarantee_steps: 1,
      },
    },
    // Repeat the reference image latent across all animation frames
    "74": {
      class_type: "RepeatLatentBatch",
      inputs: {
        samples: ["11", 0],
        amount: opts.frameCount,
      },
    },
    // KSampler — uses AnimateDiff-conditioned model + reference latent batch
    "3": {
      class_type: "KSampler",
      inputs: {
        seed: opts.seed,
        steps: opts.steps,
        cfg: opts.cfg,
        sampler_name: opts.samplerName,
        scheduler: opts.scheduler ?? "normal",
        denoise: opts.denoise,
        model: ["72", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["74", 0],
      },
    },
    // VAE decode all frames
    "8": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["3", 0],
        vae: ["4", 2],
      },
    },
    // Combine frames into animation using VHS
    "75": {
      class_type: "VHS_VideoCombine",
      inputs: {
        images: ["8", 0],
        frame_rate: opts.frameRate,
        loop_count: opts.loopCount,
        filename_prefix: "vulkan_game_anim_",
        format: opts.outputFormat,
        pingpong: false,
        save_output: true,
      },
    },
    // Also save individual frames as images
    "9": {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: "vulkan_game_anim_frame_",
        images: ["8", 0],
      },
    },
  };

  // Wire context options into evolved sampling
  (nodes["72"].inputs as Record<string, unknown>).context_options = ["73", 0];

  // Optional external VAE loader
  if (opts.vae) {
    nodes["80"] = {
      class_type: "VAELoader",
      inputs: { vae_name: opts.vae },
    };
    (nodes["11"].inputs as Record<string, unknown>).vae = ["80", 0];
    (nodes["8"].inputs as Record<string, unknown>).vae = ["80", 0];
  }

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

    // Rewire Evolved Sampling and CLIP encoders to use LoRA output
    (nodes["72"].inputs as Record<string, unknown>).model = prevModelRef;
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
   * Interrupt the currently running generation on ComfyUI.
   */
  async interrupt(): Promise<void> {
    await fetch(`${this.baseUrl}/interrupt`, { method: 'POST' });
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
      scheduler: opts?.scheduler,
      loras: opts?.loras ?? [],
      checkpoint: opts?.checkpoint,
      vae: opts?.vae,
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
      scheduler: opts?.scheduler,
      loras: opts?.loras ?? [],
      checkpoint: opts?.checkpoint,
      vae: opts?.vae,
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
   * Remove the background from an image using a BRIA RMBG workflow on ComfyUI.
   * Uploads the image, runs LoadImage → RemBG → SaveImage, and returns cleaned PNG bytes.
   *
   * @param imageBytes   - Raw PNG bytes of the image to clean
   * @param remBgNodeType - ComfyUI node class for background removal (default: BRIA_RMBG_Zho)
   * @returns PNG bytes with background removed
   */
  async removeBackground(imageBytes: Uint8Array, remBgNodeType = "BRIA_RMBG_Zho"): Promise<Uint8Array> {
    const imageName = await this.uploadImage(imageBytes);

    const workflow: Record<string, WorkflowNode> = {
      "1": {
        class_type: "LoadImage",
        inputs: { image: imageName },
      },
      "2": {
        class_type: "BRIA_RMBG_ModelLoader_Zho",
        inputs: {},
      },
      "3": {
        class_type: remBgNodeType,
        inputs: {
          rmbgmodel: ["2", 0],
          image: ["1", 0],
        },
      },
      "9": {
        class_type: "SaveImage",
        inputs: {
          filename_prefix: "rmbg",
          images: ["3", 0],
        },
      },
    };

    const submitBody: PromptRequest = { prompt: workflow };
    const submitResponse = await fetch(`${this.baseUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(submitBody),
    });

    if (!submitResponse.ok) {
      const text = await submitResponse.text().catch(() => "(no body)");
      throw new Error(
        `ComfyUI removeBackground failed: HTTP ${submitResponse.status} ${submitResponse.statusText} — ${text}`
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
        `ComfyUI removeBackground image fetch failed: HTTP ${imageResponse.status} ${imageResponse.statusText}`
      );
    }

    const buffer = await imageResponse.arrayBuffer();
    return new Uint8Array(buffer);
  }

  /**
   * Detect an OpenPose skeleton from an image using the DWPreprocessor node
   * (comfyui_controlnet_aux). Returns the rendered skeleton as PNG bytes.
   *
   * Falls back to OpenposePreprocessor if DWPreprocessor is not available.
   */
  async detectOpenPose(
    imageBytes: Uint8Array,
    opts?: { resolution?: number; nodeType?: string },
  ): Promise<Uint8Array> {
    const imageName = await this.uploadImage(imageBytes);
    const resolution = opts?.resolution ?? 512;

    // Try node types in order of preference until one succeeds.
    const nodeTypes = opts?.nodeType
      ? [opts.nodeType]
      : ["DWPreprocessor", "OpenposePreprocessor", "AIO_Preprocessor"];

    // DWPreprocessor input variants to try — different versions of
    // comfyui_controlnet_aux expect different model parameter names.
    const dwVariants: Record<string, unknown>[] = [
      // Newer versions: no model params, auto-downloads
      { detect_hand: "enable", detect_body: "enable", detect_face: "disable" },
      // Older versions with explicit model names
      { detect_hand: "enable", detect_body: "enable", detect_face: "disable",
        bbox_detector: "yolox_l.onnx", pose_estimator: "dw-ll_ucoco_384_bs5.torchscript.pt" },
    ];

    let lastError = "";
    for (const nodeType of nodeTypes) {
      // For DWPreprocessor, try multiple input variants
      const inputVariants: Record<string, unknown>[] = nodeType === "DWPreprocessor"
        ? dwVariants.map((extra) => ({ image: ["1", 0], resolution, ...extra }))
        : [nodeType === "AIO_Preprocessor"
          ? { image: ["1", 0], resolution, preprocessor: "DWPreprocessor" }
          : { image: ["1", 0], resolution }];

      for (const inputs of inputVariants) {

        const workflow: Record<string, WorkflowNode> = {
          "1": {
            class_type: "LoadImage",
            inputs: { image: imageName },
          },
          "2": {
            class_type: nodeType,
            inputs,
          },
          "9": {
            class_type: "SaveImage",
            inputs: {
              filename_prefix: "openpose_detect",
              images: ["2", 0],
            },
          },
        };

        const submitBody: PromptRequest = { prompt: workflow };
        const submitResponse = await fetch(`${this.baseUrl}/prompt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(submitBody),
        });

        if (!submitResponse.ok) {
          lastError = await submitResponse.text().catch(() => "(no body)");
          console.warn(`[ComfyUI] detectOpenPose: ${nodeType} variant failed (${submitResponse.status}), trying next...`);
          continue;
        }

        const { prompt_id } = (await submitResponse.json()) as PromptResponse;

        let imageFile;
        try {
          imageFile = await this.pollForCompletion(prompt_id);
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
          console.warn(`[ComfyUI] detectOpenPose: ${nodeType} execution failed, trying next...`);
          continue;
        }

        const imageUrl = `${this.baseUrl}/view?filename=${encodeURIComponent(
          imageFile.filename,
        )}&subfolder=${encodeURIComponent(imageFile.subfolder)}&type=${encodeURIComponent(
          imageFile.type,
        )}`;

        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
          throw new Error(
            `ComfyUI detectOpenPose image fetch failed: HTTP ${imageResponse.status} ${imageResponse.statusText}`,
          );
        }

        const buf = await imageResponse.arrayBuffer();
        return new Uint8Array(buf);
      } // end inputVariants loop
    } // end nodeTypes loop

    throw new Error(
      `ComfyUI detectOpenPose: all preprocessor nodes failed. Last error: ${lastError}. ` +
      `Install comfyui_controlnet_aux for DWPreprocessor/OpenposePreprocessor support.`,
    );
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

      // Check for errors before checking completion — ComfyUI sets
      // status_str="error" with completed=false on execution errors,
      // so we must detect errors first to avoid polling until timeout.
      if (entry.status.status_str === "error") {
        const errorMsg = entry.status.messages
          ?.filter(([type]) => type === "execution_error")
          .map(([, data]) => {
            const nodeType = data.node_type ?? "unknown";
            const msg = data.exception_message ?? "unknown error";
            return `${nodeType}: ${msg}`;
          })
          .join("; ");
        throw new Error(
          `ComfyUI generation error for prompt ${promptId}${errorMsg ? `: ${errorMsg}` : ""}`
        );
      }

      if (!entry.status.completed) continue;

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
      scheduler: opts.scheduler,
      loras: opts.loras ?? [],
      checkpoint: opts.checkpoint,
      vae: opts.vae,
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
   * Generate an image using IP-Adapter only (no ControlNet/pose).
   * Uses txt2img so the prompt fully controls proportions/style,
   * while IP-Adapter preserves character identity from the reference image.
   */
  async generateIPAdapterOnly(
    prompt: string,
    referenceImage: Uint8Array,
    opts: Omit<IPAdapterOptions, 'openPoseModel' | 'openPoseStrength'>,
  ): Promise<Uint8Array> {
    const referenceImageName = await this.uploadImage(referenceImage);

    const workflow = buildIPAdapterOnlyWorkflow({
      prompt,
      negativePrompt: opts.negativePrompt ?? "bad quality, blurry, deformed",
      width: opts.width ?? 512,
      height: opts.height ?? 512,
      steps: opts.steps ?? 20,
      seed: opts.seed ?? Math.floor(Math.random() * 2 ** 32),
      cfg: opts.cfgScale ?? 7,
      samplerName: opts.samplerName ?? "euler",
      scheduler: opts.scheduler,
      loras: opts.loras ?? [],
      checkpoint: opts.checkpoint,
      vae: opts.vae,
      referenceImageName,
      ipAdapterWeight: opts.ipAdapterWeight ?? 0.7,
      ipAdapterPreset: opts.ipAdapterPreset ?? "PLUS (high strength)",
      ipAdapterStartAt: opts.ipAdapterStartAt ?? 0.0,
      ipAdapterEndAt: opts.ipAdapterEndAt ?? 0.85,
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
      throw new Error(`Failed to fetch generated image: HTTP ${imageResponse.status}`);
    }

    return new Uint8Array(await imageResponse.arrayBuffer());
  }

  /**
   * generateIPAdapterOnly with blank-image retry logic.
   */
  async generateIPAdapterOnlyWithRetry(
    prompt: string,
    referenceImage: Uint8Array,
    opts: Omit<IPAdapterOptions, 'openPoseModel' | 'openPoseStrength'>,
    maxRetries = 3,
    onRetry?: (attempt: number, max: number) => void,
  ): Promise<Uint8Array> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const seed = (opts.seed ?? Math.floor(Math.random() * 2 ** 32)) + attempt;
      const pngBytes = await this.generateIPAdapterOnly(prompt, referenceImage, { ...opts, seed });

      if (!isBlankImage(pngBytes)) {
        return pngBytes;
      }

      if (attempt < maxRetries - 1) {
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
      scheduler: opts.scheduler,
      loras: opts.loras ?? [],
      checkpoint: opts.checkpoint,
      vae: opts.vae,
      conceptImageName,
      poseImageName,
      denoise: opts.denoise ?? 0.75,
      ipAdapterWeight: opts.ipAdapterWeight ?? 0.5,
      ipAdapterPreset: opts.ipAdapterPreset ?? "PLUS (high strength)",
      ipAdapterStartAt: opts.ipAdapterStartAt ?? 0.0,
      ipAdapterEndAt: opts.ipAdapterEndAt ?? 0.7,
      openPoseModel,
      openPoseStrength: opts.openPoseStrength ?? 1.0,
      removeBackground: opts.removeBackground,
      remBgNodeType: opts.remBgNodeType,
      outputWidth: opts.outputWidth,
      outputHeight: opts.outputHeight,
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
   * Img2img with IP-Adapter reference: VAEEncode(inputImage) + IPAdapterAdvanced(referenceImage) + KSampler + RemBG.
   * Used for pipeline Pass 2: apply chibi style to pass1 output using chibi as IP-Adapter reference.
   */
  async generateImg2ImgWithIPAdapter(
    prompt: string,
    inputImage: Uint8Array,
    referenceImage: Uint8Array,
    opts: Img2ImgWithIPAdapterOptions,
  ): Promise<Uint8Array> {
    const inputImageName = await this.uploadImage(inputImage);
    const refImageName = await this.uploadImage(referenceImage);

    const denoise = opts.denoise ?? 0.7;
    const ipWeight = opts.ipAdapterWeight ?? 0.5;
    const ipPreset = opts.ipAdapterPreset ?? "PLUS (high strength)";
    const ipStartAt = opts.ipAdapterStartAt ?? 0.0;
    const ipEndAt = opts.ipAdapterEndAt ?? 0.7;
    const width = opts.width ?? 512;
    const height = opts.height ?? 512;
    const steps = opts.steps ?? 20;
    const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 32);
    const cfg = opts.cfgScale ?? 7;
    const samplerName = opts.samplerName ?? "euler";
    const scheduler = opts.scheduler;
    const loras = opts.loras ?? [];
    const checkpoint = opts.checkpoint;
    const vae = opts.vae;

    // Build workflow: LoadCheckpoint → LoadImage(input) → VAEEncode → IPAdapter(ref) → KSampler → VAEDecode → RemBG → Downscale → Save
    const nodes: Record<string, WorkflowNode> = {};

    // Checkpoint loader
    nodes["1"] = {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: checkpoint ?? "v1-5-pruned-emaonly.safetensors" },
    };

    // Positive prompt
    nodes["2"] = {
      class_type: "CLIPTextEncode",
      inputs: { text: prompt, clip: ["1", 1] },
    };

    // Negative prompt
    nodes["3"] = {
      class_type: "CLIPTextEncode",
      inputs: { text: opts.negativePrompt ?? "bad quality, blurry, deformed", clip: ["1", 1] },
    };

    // Load input image (pass1 output)
    nodes["10"] = {
      class_type: "LoadImage",
      inputs: { image: inputImageName },
    };

    // Resize input to target
    nodes["11"] = {
      class_type: "ImageScale",
      inputs: { image: ["10", 0], width, height, upscale_method: "bilinear", crop: "center" },
    };

    // VAE encode input image
    nodes["12"] = {
      class_type: "VAEEncode",
      inputs: { pixels: ["11", 0], vae: ["1", 2] },
    };

    // Load reference image (chibi)
    nodes["20"] = {
      class_type: "LoadImage",
      inputs: { image: refImageName },
    };

    // IP-Adapter Unified Loader
    nodes["21"] = {
      class_type: "IPAdapterUnifiedLoader",
      inputs: { model: ["1", 0], preset: ipPreset },
    };

    // IP-Adapter Advanced
    nodes["22"] = {
      class_type: "IPAdapterAdvanced",
      inputs: {
        model: ["21", 0],
        ipadapter: ["21", 1],
        image: ["20", 0],
        weight: ipWeight,
        weight_type: "linear",
        combine_embeds: "concat",
        start_at: ipStartAt,
        end_at: ipEndAt,
        embeds_scaling: "V only",
      },
    };

    // KSampler — denoise on the VAE-encoded input latent
    nodes["5"] = {
      class_type: "KSampler",
      inputs: {
        model: ["22", 0],
        positive: ["2", 0],
        negative: ["3", 0],
        latent_image: ["12", 0],
        seed,
        steps,
        cfg,
        sampler_name: samplerName,
        scheduler: scheduler ?? "normal",
        denoise,
      },
    };

    // VAE Decode
    nodes["8"] = {
      class_type: "VAEDecode",
      inputs: { samples: ["5", 0], vae: ["1", 2] },
    };

    // Apply LoRAs if any
    let modelOutput: [string, number] = ["22", 0];
    let clipOutput: [string, number] = ["1", 1];
    if (loras.length > 0) {
      let prevModel: [string, number] = ["1", 0];
      let prevClip: [string, number] = ["1", 1];
      for (let i = 0; i < loras.length; i++) {
        const loraId = `lora_${i}`;
        const loraName = loras[i].name.includes('.') ? loras[i].name : `${loras[i].name}.safetensors`;
        nodes[loraId] = {
          class_type: "LoraLoader",
          inputs: {
            model: prevModel,
            clip: prevClip,
            lora_name: loraName,
            strength_model: loras[i].weight ?? 0.8,
            strength_clip: loras[i].weight ?? 0.8,
          },
        };
        prevModel = [loraId, 0];
        prevClip = [loraId, 1];
      }
      // Re-wire: IP-Adapter uses LoRA model output, prompts use LoRA clip output
      nodes["21"].inputs.model = prevModel;
      nodes["2"].inputs.clip = prevClip;
      nodes["3"].inputs.clip = prevClip;
      clipOutput = prevClip;
      modelOutput = ["22", 0];
    }

    // VAE override
    if (vae) {
      nodes["vae_loader"] = {
        class_type: "VAELoader",
        inputs: { vae_name: vae },
      };
      nodes["12"].inputs.vae = ["vae_loader", 0];
      nodes["8"].inputs.vae = ["vae_loader", 0];
    }

    // Save Image
    nodes["9"] = {
      class_type: "SaveImage",
      inputs: { images: ["8", 0], filename_prefix: "img2img_ipadapter" },
    };

    // RemBG
    injectRemBGNodes(nodes, { removeBackground: opts.removeBackground, remBgNodeType: opts.remBgNodeType });

    // Downscale if needed
    if (opts.outputWidth && opts.outputHeight && (opts.outputWidth !== width || opts.outputHeight !== height)) {
      const saveInputs = nodes["9"].inputs as Record<string, unknown>;
      const currentSource = saveInputs.images;
      nodes["downscale"] = {
        class_type: "ImageScale",
        inputs: {
          image: currentSource,
          width: opts.outputWidth,
          height: opts.outputHeight,
          upscale_method: opts.downscaleMethod ?? "nearest-exact",
          crop: "disabled",
        },
      };
      saveInputs.images = ["downscale", 0];
    }

    const submitBody: PromptRequest = { prompt: nodes };
    const submitResponse = await fetch(`${this.baseUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(submitBody),
    });

    if (!submitResponse.ok) {
      const text = await submitResponse.text().catch(() => "(no body)");
      throw new Error(
        `ComfyUI img2img+IPAdapter prompt failed: HTTP ${submitResponse.status} ${submitResponse.statusText} — ${text}`
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
   * Img2img with IP-Adapter with retry on blank results.
   */
  async generateImg2ImgWithIPAdapterWithRetry(
    prompt: string,
    inputImage: Uint8Array,
    referenceImage: Uint8Array,
    opts: Img2ImgWithIPAdapterOptions,
    maxRetries = 3,
    onRetry?: (attempt: number, max: number) => void,
  ): Promise<Uint8Array> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const seed = attempt === 1
        ? (opts.seed ?? Math.floor(Math.random() * 2 ** 32))
        : Math.floor(Math.random() * 2 ** 32);

      const pngBytes = await this.generateImg2ImgWithIPAdapter(prompt, inputImage, referenceImage, { ...opts, seed });

      if (!isBlankImage(pngBytes)) {
        return pngBytes;
      }

      if (attempt < maxRetries) {
        onRetry?.(attempt + 1, maxRetries);
        await sleep(1000);
      }
    }

    throw new Error(
      `ComfyUI returned a blank/black image after ${maxRetries} img2img+IPAdapter attempts.`
    );
  }

  /**
   * Two-pass generation: Concept Art + Pose → Posed Character → Chibi-fy → Pixelize.
   * Pass 1: IP-Adapter (concept) + OpenPose → posed concept character at 512x512
   * Pass 2: IP-Adapter (chibi) + img2img on pass 1 output → chibi-fied character
   * Then downscaled to final sprite size.
   */
  async generateTwoPassIPAdapter(
    prompt: string,
    conceptImage: Uint8Array,
    chibiImage: Uint8Array,
    poseImage: Uint8Array,
    opts: TwoPassIPAdapterOptions,
  ): Promise<Uint8Array> {
    const conceptImageName = await this.uploadImage(conceptImage);
    const chibiImageName = await this.uploadImage(chibiImage);
    const poseImageName = await this.uploadImage(poseImage);

    const openPoseModel = (opts.openPoseModel ?? "control_v11p_sd15_openpose").includes(".")
      ? opts.openPoseModel!
      : `${opts.openPoseModel ?? "control_v11p_sd15_openpose"}.pth`;

    const workflow = buildTwoPassIPAdapterWorkflow({
      prompt,
      negativePrompt: opts.negativePrompt ?? "bad quality, blurry, deformed",
      width: opts.width ?? 512,
      height: opts.height ?? 512,
      steps: opts.steps ?? 20,
      seed: opts.seed ?? Math.floor(Math.random() * 2 ** 32),
      cfg: opts.cfgScale ?? 7,
      samplerName: opts.samplerName ?? "euler",
      scheduler: opts.scheduler,
      loras: opts.loras ?? [],
      checkpoint: opts.checkpoint,
      vae: opts.vae,
      conceptImageName,
      chibiImageName,
      poseImageName,
      ipAdapterWeight: opts.ipAdapterWeight ?? 0.5,
      ipAdapterPreset: opts.ipAdapterPreset ?? "PLUS (high strength)",
      ipAdapterStartAt: opts.ipAdapterStartAt ?? 0.0,
      ipAdapterEndAt: opts.ipAdapterEndAt ?? 0.7,
      openPoseModel,
      openPoseStrength: opts.openPoseStrength ?? 1.0,
      chibiWeight: opts.chibiWeight ?? 0.7,
      chibiDenoise: opts.chibiDenoise ?? 0.5,
      removeBackground: opts.removeBackground,
      remBgNodeType: opts.remBgNodeType,
      outputWidth: opts.outputWidth,
      outputHeight: opts.outputHeight,
      pixelPassEnabled: opts.pixelPassEnabled,
      pixelPassDenoise: opts.pixelPassDenoise,
      pixelPassLoras: opts.pixelPassLoras,
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
        `ComfyUI two-pass IP-Adapter prompt failed: HTTP ${submitResponse.status} ${submitResponse.statusText} — ${text}`
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
   * Warmup: run a minimal 1-step inference to force ComfyUI to load all models
   * (checkpoint, IP-Adapter, OpenPose ControlNet, VAE) into memory.
   * On Apple Silicon MPS, the first inference after model load can produce
   * degraded results; this warmup absorbs that cost before real generation.
   * The result is discarded.
   */
  async warmupIPAdapter(
    conceptImage: Uint8Array,
    poseImage: Uint8Array,
    opts: {
      checkpoint?: string;
      vae?: string;
      ipAdapterPreset?: string;
      openPoseModel?: string;
      samplerName?: string;
    } = {},
  ): Promise<void> {
    try {
      console.log("[ComfyUI] Running warmup inference (1 step) to pre-load models...");
      const conceptImageName = await this.uploadImage(conceptImage);
      const poseImageName = await this.uploadImage(poseImage);

      const openPoseModel = (opts.openPoseModel ?? "control_v11p_sd15_openpose").includes(".")
        ? opts.openPoseModel!
        : `${opts.openPoseModel ?? "control_v11p_sd15_openpose"}.pth`;

      const workflow = buildIPAdapterPoseWorkflow({
        prompt: "full body character",
        negativePrompt: "",
        width: 128,
        height: 128,
        steps: 1,
        seed: 0,
        cfg: 1,
        samplerName: opts.samplerName ?? "euler",
        loras: [],
        checkpoint: opts.checkpoint,
        vae: opts.vae,
        conceptImageName,
        poseImageName,
        denoise: 1.0,
        ipAdapterWeight: 0.5,
        ipAdapterPreset: opts.ipAdapterPreset ?? "PLUS (high strength)",
        ipAdapterStartAt: 0.0,
        ipAdapterEndAt: 1.0,
        openPoseModel,
        openPoseStrength: 0.5,
      });

      const submitResponse = await fetch(`${this.baseUrl}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: workflow } as PromptRequest),
      });

      if (!submitResponse.ok) {
        console.warn("[ComfyUI] Warmup submit failed, continuing without warmup");
        return;
      }

      const { prompt_id } = (await submitResponse.json()) as PromptResponse;
      await this.pollForCompletion(prompt_id);
      console.log("[ComfyUI] Warmup complete — models loaded into memory");
    } catch (err) {
      console.warn("[ComfyUI] Warmup failed (non-fatal), continuing:", err);
    }
  }

  /**
   * Two-pass IP-Adapter generation with retry on blank results.
   */
  async generateTwoPassIPAdapterWithRetry(
    prompt: string,
    conceptImage: Uint8Array,
    chibiImage: Uint8Array,
    poseImage: Uint8Array,
    opts: TwoPassIPAdapterOptions,
    maxRetries = 3,
    onRetry?: (attempt: number, max: number) => void,
  ): Promise<Uint8Array> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const seed = attempt === 1
        ? (opts.seed ?? Math.floor(Math.random() * 2 ** 32))
        : Math.floor(Math.random() * 2 ** 32);

      const pngBytes = await this.generateTwoPassIPAdapter(prompt, conceptImage, chibiImage, poseImage, { ...opts, seed });

      if (!isBlankImage(pngBytes)) {
        return pngBytes;
      }

      if (attempt < maxRetries) {
        onRetry?.(attempt + 1, maxRetries);
        await sleep(1000);
      }
    }

    throw new Error(
      `ComfyUI returned a blank/black image after ${maxRetries} two-pass IP-Adapter attempts. ` +
      `Try different prompts, check the model is loaded, or increase steps.`
    );
  }

  /**
   * Generate an animation from a reference image using AnimateDiff.
   * Uploads the reference image, applies a motion model, and produces
   * a multi-frame animation guided by the text prompt.
   *
   * @param prompt         - Text description guiding the animation
   * @param referenceImage - PNG bytes of the reference/source image
   * @param opts           - AnimateDiff options (motion model, frame count, etc.)
   * @returns Raw bytes of the first output frame (individual frames also saved)
   */
  async generateAnimateDiff(
    prompt: string,
    referenceImage: Uint8Array,
    opts?: AnimateDiffOptions,
  ): Promise<Uint8Array> {
    const imageName = await this.uploadImage(referenceImage);

    const motionModel = opts?.motionModel ?? "mm_sd_v15_v2.ckpt";

    const workflow = buildAnimateDiffWorkflow({
      prompt,
      negativePrompt: opts?.negativePrompt ?? "bad quality, blurry, deformed, static, still image",
      width: opts?.width ?? 512,
      height: opts?.height ?? 512,
      steps: opts?.steps ?? 20,
      seed: opts?.seed ?? Math.floor(Math.random() * 2 ** 32),
      cfg: opts?.cfgScale ?? 7,
      samplerName: opts?.samplerName ?? "euler",
      scheduler: opts?.scheduler,
      loras: opts?.loras ?? [],
      checkpoint: opts?.checkpoint,
      vae: opts?.vae,
      imageName,
      denoise: opts?.denoise ?? 0.6,
      motionModel,
      frameCount: opts?.frameCount ?? 16,
      frameRate: opts?.frameRate ?? 8,
      contextLength: opts?.contextLength ?? 16,
      outputFormat: opts?.outputFormat ?? "image/webp",
      loopCount: opts?.loopCount ?? 0,
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
        `ComfyUI AnimateDiff prompt failed: HTTP ${submitResponse.status} ${submitResponse.statusText} — ${text}`
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
   * Generate an AnimateDiff animation with retry on blank/black results.
   */
  async generateAnimateDiffWithRetry(
    prompt: string,
    referenceImage: Uint8Array,
    opts?: AnimateDiffOptions,
    maxRetries = 3,
    onRetry?: (attempt: number, max: number) => void,
  ): Promise<Uint8Array> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const seed = attempt === 1
        ? (opts?.seed ?? Math.floor(Math.random() * 2 ** 32))
        : Math.floor(Math.random() * 2 ** 32);

      const pngBytes = await this.generateAnimateDiff(prompt, referenceImage, { ...opts, seed });

      if (!isBlankImage(pngBytes)) {
        return pngBytes;
      }

      if (attempt < maxRetries) {
        onRetry?.(attempt + 1, maxRetries);
        await sleep(1000);
      }
    }

    throw new Error(
      `ComfyUI returned a blank/black image after ${maxRetries} AnimateDiff attempts. ` +
      `Try different prompts, check the motion model is loaded, or increase steps.`
    );
  }

  /**
   * Interpolate between two frames using RIFE VFI (Video Frame Interpolation).
   * Requires ComfyUI-Frame-Interpolation custom nodes.
   *
   * @param frameA     - PNG bytes of the first frame
   * @param frameB     - PNG bytes of the second frame
   * @param opts       - Optional: model name, multiplier (default 2)
   * @returns Array of only the intermediate frames (excludes A and B)
   */
  async interpolateFramesRIFE(
    frameA: Uint8Array,
    frameB: Uint8Array,
    opts?: { model?: string; multiplier?: number },
  ): Promise<Uint8Array[]> {
    const multiplier = opts?.multiplier ?? 2;

    // Auto-detect which RIFE node class is available and query its schema
    const { nodeType, schema } = await this.detectRIFENode();

    // Resolve model name: use requested model if it's in the available list,
    // otherwise fall back to the node's default or first available model.
    // Also check which models are actually downloaded on disk to avoid
    // runtime download failures from broken mirrors.
    const availableModels = schema.ckpt_name_options ?? schema.model_options ?? [];
    const defaultModel = schema.ckpt_name_default ?? schema.model_default ?? availableModels[0];
    const requestedModel = opts?.model;

    // Try to find the requested model in the available list (with or without .pth)
    const matchInList = requestedModel
      ? availableModels.find((m: string) => m === requestedModel || m === `${requestedModel}.pth`)
      : undefined;

    let resolvedModel: string;
    if (matchInList) {
      resolvedModel = matchInList;
    } else {
      // Requested model not found — prefer rife47.pth (known to have working
      // download mirrors), then fall back through the available list
      const preferred = ['rife47.pth', 'rife49.pth'];
      const pick = preferred.find((p) => availableModels.includes(p));
      resolvedModel = pick ?? availableModels[0] ?? defaultModel;
      if (requestedModel) {
        console.warn(
          `[ComfyUI] RIFE model "${requestedModel}" not available. ` +
          `Using "${resolvedModel}" instead. Available: ${availableModels.join(', ')}`
        );
      }
    }

    // Upload both frames
    const [nameA, nameB] = await Promise.all([
      this.uploadImage(frameA),
      this.uploadImage(frameB),
    ]);

    // Build RIFE node inputs from the detected schema
    const rifeInputs: Record<string, unknown> = schema.usesModelKey
      ? {
          model: resolvedModel,
          images: ["3", 0],
          multiplier,
        }
      : {
          ckpt_name: resolvedModel,
          frames: ["3", 0],
          clear_cache_after_n_frames: 10,
          multiplier,
          fast_mode: true,
          ensemble: false,
          scale_factor: 1.0,
          ...(schema.hasDtype ? { dtype: 'float32' } : {}),
          ...(schema.hasTorchCompile ? { torch_compile: false } : {}),
          ...(schema.hasBatchSize ? { batch_size: 1 } : {}),
        };

    const workflow: Record<string, WorkflowNode> = {
      "1": {
        class_type: "LoadImage",
        inputs: { image: nameA },
      },
      "2": {
        class_type: "LoadImage",
        inputs: { image: nameB },
      },
      "3": {
        class_type: "ImageBatch",
        inputs: {
          image1: ["1", 0],
          image2: ["2", 0],
        },
      },
      "4": {
        class_type: nodeType,
        inputs: rifeInputs,
      },
      "9": {
        class_type: "SaveImage",
        inputs: {
          images: ["4", 0],
          filename_prefix: "rife_interp",
        },
      },
    };

    // Submit
    const submitBody: PromptRequest = { prompt: workflow };
    const submitResponse = await fetch(`${this.baseUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(submitBody),
    });

    if (!submitResponse.ok) {
      const text = await submitResponse.text().catch(() => "(no body)");
      throw new Error(
        `ComfyUI RIFE prompt submission failed: HTTP ${submitResponse.status} ${submitResponse.statusText} — ${text}`
      );
    }

    const { prompt_id } = (await submitResponse.json()) as PromptResponse;

    // Poll for all output images
    const allImages = await this.pollForMultipleImages(prompt_id);

    // Fetch intermediate frame bytes (skip first = A and last = B)
    const intermediates = allImages.slice(1, -1);
    const results: Uint8Array[] = [];
    for (const img of intermediates) {
      const imageUrl = `${this.baseUrl}/view?filename=${encodeURIComponent(
        img.filename
      )}&subfolder=${encodeURIComponent(img.subfolder)}&type=${encodeURIComponent(
        img.type
      )}`;
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
        throw new Error(
          `ComfyUI RIFE image fetch failed: HTTP ${imageResponse.status}`
        );
      }
      results.push(new Uint8Array(await imageResponse.arrayBuffer()));
    }

    return results;
  }

  /**
   * Poll until a prompt completes and return ALL output images across all nodes.
   */
  private async pollForMultipleImages(promptId: string): Promise<HistoryImageFile[]> {
    const deadline = Date.now() + this.pollTimeoutMs;

    while (Date.now() < deadline) {
      await sleep(this.pollIntervalMs);

      const response = await fetch(`${this.baseUrl}/history/${promptId}`);
      if (!response.ok) continue;

      const history = (await response.json()) as HistoryResponse;
      const entry = history[promptId];
      if (!entry) continue;

      if (entry.status.status_str === "error") {
        const errorMsg = entry.status.messages
          ?.filter(([type]) => type === "execution_error")
          .map(([, data]) => {
            const nodeType = data.node_type ?? "unknown";
            const msg = data.exception_message ?? "unknown error";
            return `${nodeType}: ${msg}`;
          })
          .join("; ");
        throw new Error(
          `ComfyUI RIFE error for prompt ${promptId}${errorMsg ? `: ${errorMsg}` : ""}`
        );
      }

      if (!entry.status.completed) continue;

      const images: HistoryImageFile[] = [];
      for (const nodeOutput of Object.values(entry.outputs)) {
        if (nodeOutput.images) {
          images.push(...nodeOutput.images);
        }
      }

      if (images.length === 0) {
        throw new Error(
          `ComfyUI RIFE prompt ${promptId} completed but produced no image outputs`
        );
      }

      return images;
    }

    throw new Error(
      `ComfyUI RIFE generation timed out after ${this.pollTimeoutMs}ms for prompt ${promptId}`
    );
  }

  /**
   * Detect which RIFE VFI node class is registered on the ComfyUI server,
   * and extract its input schema so we can build a valid workflow.
   */
  private async detectRIFENode(): Promise<{
    nodeType: string;
    schema: {
      usesModelKey: boolean;
      ckpt_name_options?: string[];
      ckpt_name_default?: string;
      model_options?: string[];
      model_default?: string;
      hasDtype: boolean;
      hasTorchCompile: boolean;
      hasBatchSize: boolean;
    };
  }> {
    const candidates = ['RIFE VFI', 'VFI_RIFE', 'RIFEInterpolation'];

    for (const name of candidates) {
      try {
        const res = await fetch(
          `${this.baseUrl}/object_info/${encodeURIComponent(name)}`,
          { signal: AbortSignal.timeout(5000) },
        );
        if (!res.ok) continue;

        const data = await res.json() as Record<string, unknown>;
        const info = data[name] as Record<string, unknown> | undefined;
        if (!info) continue;

        const input = info['input'] as Record<string, unknown> | undefined;
        const required = input?.['required'] as Record<string, unknown> | undefined;
        if (!required) continue;

        // Extract model/ckpt_name options
        const ckptField = required['ckpt_name'] as [string[], Record<string, unknown>] | undefined;
        const modelField = required['model'] as [string[], Record<string, unknown>] | undefined;
        const usesModelKey = !ckptField && !!modelField;

        return {
          nodeType: name,
          schema: {
            usesModelKey,
            ckpt_name_options: Array.isArray(ckptField?.[0]) ? ckptField![0] : undefined,
            ckpt_name_default: ckptField?.[1]?.['default'] as string | undefined,
            model_options: Array.isArray(modelField?.[0]) ? modelField![0] : undefined,
            model_default: modelField?.[1]?.['default'] as string | undefined,
            hasDtype: 'dtype' in required,
            hasTorchCompile: 'torch_compile' in required,
            hasBatchSize: 'batch_size' in required,
          },
        };
      } catch { /* try next */ }
    }

    throw new Error(
      `No RIFE frame interpolation node found on this ComfyUI server. ` +
      `Install ComfyUI-Frame-Interpolation: ` +
      `cd ComfyUI/custom_nodes && git clone https://github.com/Fannovel16/ComfyUI-Frame-Interpolation && ` +
      `pip install -r ComfyUI-Frame-Interpolation/requirements-no-cupy.txt ` +
      `(or requirements-with-cupy.txt for CUDA acceleration), then restart ComfyUI`
    );
  }

  /**
   * List available AnimateDiff motion model filenames from ComfyUI.
   * Queries GET /object_info/ADE_LoadAnimateDiffModel.
   */
  async listMotionModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/object_info/ADE_LoadAnimateDiffModel`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return [];
      const data = await res.json() as Record<string, unknown>;
      const info = data['ADE_LoadAnimateDiffModel'] as Record<string, unknown> | undefined;
      const input = info?.['input'] as Record<string, unknown> | undefined;
      const required = input?.['required'] as Record<string, unknown> | undefined;
      const modelName = required?.['model_name'] as [string[]] | undefined;
      return modelName?.[0] ?? [];
    } catch {
      return [];
    }
  }

  /**
   * List available checkpoint model filenames from ComfyUI.
   * Queries GET /object_info/CheckpointLoaderSimple.
   */
  async listCheckpoints(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/object_info/CheckpointLoaderSimple`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return [];
      const data = await res.json() as Record<string, unknown>;
      const info = data['CheckpointLoaderSimple'] as Record<string, unknown> | undefined;
      const input = info?.['input'] as Record<string, unknown> | undefined;
      const required = input?.['required'] as Record<string, unknown> | undefined;
      const ckptName = required?.['ckpt_name'] as [string[]] | undefined;
      return ckptName?.[0] ?? [];
    } catch {
      return [];
    }
  }

  /**
   * List available LoRA filenames from ComfyUI.
   * Queries GET /object_info/LoraLoader.
   */
  async listLoras(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/object_info/LoraLoader`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return [];
      const data = await res.json() as Record<string, unknown>;
      const info = data['LoraLoader'] as Record<string, unknown> | undefined;
      const input = info?.['input'] as Record<string, unknown> | undefined;
      const required = input?.['required'] as Record<string, unknown> | undefined;
      const loraName = required?.['lora_name'] as [string[]] | undefined;
      return loraName?.[0] ?? [];
    } catch {
      return [];
    }
  }

  /**
   * List available VAE model filenames from ComfyUI.
   * Queries GET /object_info/VAELoader.
   */
  async listVaes(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/object_info/VAELoader`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return [];
      const data = await res.json() as Record<string, unknown>;
      const info = data['VAELoader'] as Record<string, unknown> | undefined;
      const input = info?.['input'] as Record<string, unknown> | undefined;
      const required = input?.['required'] as Record<string, unknown> | undefined;
      const vaeName = required?.['vae_name'] as [string[]] | undefined;
      return vaeName?.[0] ?? [];
    } catch {
      return [];
    }
  }

  /**
   * List available scheduler names from ComfyUI's KSampler node.
   * Queries GET /object_info/KSampler.
   */
  async listSchedulers(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/object_info/KSampler`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return [];
      const data = await res.json() as Record<string, unknown>;
      const info = data['KSampler'] as Record<string, unknown> | undefined;
      const input = info?.['input'] as Record<string, unknown> | undefined;
      const required = input?.['required'] as Record<string, unknown> | undefined;
      const scheduler = required?.['scheduler'] as [string[]] | undefined;
      return scheduler?.[0] ?? [];
    } catch {
      return [];
    }
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
