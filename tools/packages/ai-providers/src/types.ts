/**
 * Options for LLM text generation.
 */
export interface LLMGenerateOptions {
  /** System prompt to set model behavior. */
  system?: string;
  /** Sampling temperature (0.0–2.0). Higher = more creative. */
  temperature?: number;
  /** Maximum number of tokens to generate. */
  maxTokens?: number;
}

/**
 * A provider that generates text via a large language model.
 */
export interface LLMProvider {
  generate(prompt: string, opts?: LLMGenerateOptions): Promise<string>;
}

/**
 * Options for image generation.
 */
export interface ImageGenerateOptions {
  /** Output image width in pixels. */
  width?: number;
  /** Output image height in pixels. */
  height?: number;
  /** Number of diffusion steps. Higher = better quality but slower. */
  steps?: number;
  /** Random seed for reproducibility. */
  seed?: number;
  /** Negative prompt — features to avoid in the generated image. */
  negativePrompt?: string;
  /** Classifier-free guidance scale (default varies by provider). */
  cfgScale?: number;
  /** Sampler/scheduler name (e.g. "Euler a", "DPM++ 2M Karras"). */
  samplerName?: string;
  /** LoRA models to apply. Each entry has a name and optional weight (default 1.0). */
  loras?: Array<{ name: string; weight?: number }>;
  /** Run background removal on the output image (requires ComfyUI RemBG node). */
  removeBackground?: boolean;
  /** ComfyUI class_type for the background removal node. Default: BRIA_REMBG_Zeroshot. */
  remBgNodeType?: string;
}

/**
 * Options for img2img generation — inherits from ImageGenerateOptions,
 * adds denoise strength.
 */
export interface Img2ImgOptions extends ImageGenerateOptions {
  /** Denoise strength (0.0 = no change, 1.0 = full regeneration). Default 0.4. */
  denoise?: number;
}

/**
 * Options for ControlNet-guided generation.
 */
export interface ControlNetOptions extends ImageGenerateOptions {
  /** Denoise strength (0.0 = no change, 1.0 = full regeneration). Default 0.75. */
  denoise?: number;
  /** ControlNet model filename (without .pth/.safetensors if omitted). */
  controlNetModel: string;
  /** ControlNet conditioning strength (0.0–2.0). Default 0.7. */
  controlStrength?: number;
  /** Start percent for ControlNet application (0.0–1.0). Default 0.0. */
  controlStart?: number;
  /** End percent for ControlNet application (0.0–1.0). Default 1.0. */
  controlEnd?: number;
}

/**
 * Options for IP-Adapter + OpenPose generation.
 */
export interface IPAdapterOptions extends ImageGenerateOptions {
  /** Denoise strength. Default 0.75. */
  denoise?: number;
  /** IP-Adapter weight (0.0–1.0). Default 0.6. */
  ipAdapterWeight?: number;
  /** IP-Adapter preset. Default "PLUS". */
  ipAdapterPreset?: string;
  /** OpenPose ControlNet model filename. */
  openPoseModel?: string;
  /** OpenPose ControlNet strength. Default 0.8. */
  openPoseStrength?: number;
}

/**
 * A provider that generates images from text prompts.
 */
export interface ImageProvider {
  generateImage(prompt: string, opts?: ImageGenerateOptions): Promise<Uint8Array>;
}

/**
 * Options for audio generation.
 */
export interface AudioGenerateOptions {
  /** Desired audio duration in seconds. */
  duration?: number;
  /** Sampling temperature for generation variety. */
  temperature?: number;
  /** Number of diffusion steps (for diffusion-based models like Stable Audio). */
  steps?: number;
  /** Classifier-free guidance scale. */
  cfgScale?: number;
}

/**
 * A provider that generates audio from text prompts.
 */
export interface AudioProvider {
  generateAudio(prompt: string, opts?: AudioGenerateOptions): Promise<ArrayBuffer>;
}

/**
 * Result of an availability check.
 */
export interface AvailabilityResult {
  available: boolean;
  error?: string;
}

/**
 * Union type covering all provider interfaces.
 */
export type ProviderType = LLMProvider | ImageProvider | AudioProvider;
