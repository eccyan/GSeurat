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
