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
  /** Checkpoint model filename (e.g. "v1-5-pruned-emaonly.safetensors"). */
  checkpoint?: string;
  /** Number of diffusion steps. Higher = better quality but slower. */
  steps?: number;
  /** Random seed for reproducibility. */
  seed?: number;
  /** Negative prompt — features to avoid in the generated image. */
  negativePrompt?: string;
  /** Classifier-free guidance scale (default varies by provider). */
  cfgScale?: number;
  /** Sampler name (e.g. "euler", "dpmpp_2m", "dpmpp_sde"). */
  samplerName?: string;
  /** Scheduler name (e.g. "normal", "karras", "exponential", "sgm_uniform"). */
  scheduler?: string;
  /** External VAE model filename. If set, uses a separate VAELoader instead of the checkpoint's built-in VAE. */
  vae?: string;
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
  /** IP-Adapter weight (0.0–1.0). Default 0.7. */
  ipAdapterWeight?: number;
  /** IP-Adapter preset. Default "PLUS". */
  ipAdapterPreset?: string;
  /** IP-Adapter start_at — begin applying IP-Adapter at this denoising % (0.0–1.0). Default 0.0. */
  ipAdapterStartAt?: number;
  /** IP-Adapter end_at — stop applying IP-Adapter at this denoising % (0.0–1.0). Default 0.8. */
  ipAdapterEndAt?: number;
  /** OpenPose ControlNet model filename. */
  openPoseModel?: string;
  /** OpenPose ControlNet strength. Default 0.8. */
  openPoseStrength?: number;
  /** Final output width — downscale from generation resolution. */
  outputWidth?: number;
  /** Final output height — downscale from generation resolution. */
  outputHeight?: number;
  /** Downscale interpolation method. Default "nearest-exact". */
  downscaleMethod?: string;
}

/**
 * Options for two-pass IP-Adapter generation (Concept→Pose→Chibi→Pixel).
 * Pass 1: Concept art (IP-Adapter) + OpenPose → posed character
 * Pass 2: Chibi reference (IP-Adapter) + img2img → chibi-fied posed character
 */
export interface TwoPassIPAdapterOptions extends IPAdapterOptions {
  /** IP-Adapter weight for pass 2 (chibi style transfer). Default 0.7. */
  chibiWeight?: number;
  /** Denoise for pass 2 (how much to chibi-fy). Lower = closer to posed concept. Default 0.5. */
  chibiDenoise?: number;
  /** Enable pixel art pass 3 (LoRA-based pixelization of chibi output). Default false. */
  pixelPassEnabled?: boolean;
  /** Denoise strength for pixel pass 3. Default 0.35. */
  pixelPassDenoise?: number;
  /** LoRA models to apply during pixel pass 3. */
  pixelPassLoras?: Array<{ name: string; weight?: number }>;
}

/**
 * Options for img2img generation with IP-Adapter reference.
 * Uses VAEEncode(inputImage) + IPAdapterAdvanced(referenceImage) + KSampler(denoise) + RemBG.
 */
export interface Img2ImgWithIPAdapterOptions extends ImageGenerateOptions {
  /** Denoise strength. Default 0.7. */
  denoise?: number;
  /** IP-Adapter weight for the reference image. Default 0.5. */
  ipAdapterWeight?: number;
  /** IP-Adapter preset. Default "PLUS (high strength)". */
  ipAdapterPreset?: string;
  /** IP-Adapter start_at (0.0–1.0). Default 0.0. */
  ipAdapterStartAt?: number;
  /** IP-Adapter end_at (0.0–1.0). Default 0.7. */
  ipAdapterEndAt?: number;
  /** Final output width — downscale from generation resolution. */
  outputWidth?: number;
  /** Final output height — downscale from generation resolution. */
  outputHeight?: number;
  /** Downscale interpolation method. Default "nearest-exact". */
  downscaleMethod?: string;
}

/**
 * Options for AnimateDiff animation generation from an input image.
 */
export interface AnimateDiffOptions extends ImageGenerateOptions {
  /** Denoise strength (0.0 = no change, 1.0 = full regeneration). Default 0.6. */
  denoise?: number;
  /** Motion model filename (e.g. "mm_sd_v15_v2.ckpt"). */
  motionModel?: string;
  /** Number of frames to generate. Default 16. */
  frameCount?: number;
  /** Output frame rate for the combined video. Default 8. */
  frameRate?: number;
  /** Context length for AnimateDiff uniform context. Default 16. */
  contextLength?: number;
  /** Output format: "image/gif", "image/webp", or an ffmpeg format. Default "image/webp". */
  outputFormat?: string;
  /** Loop count for the output animation (0 = infinite). Default 0. */
  loopCount?: number;
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
