# ComfyUI Asset Generation Research Report

## Overview

Research into using ComfyUI with Stable Diffusion 1.5 on Apple Silicon (MPS) for generating medieval RPG pixel art assets: 24 tileset tiles and 288 character sprite frames (6 characters x 3 states x 4 directions x 4 frames).

## Environment

- **ComfyUI**: v0.16.1
- **Model**: `v1-5-pruned-emaonly.safetensors` (SD 1.5)
- **LoRA**: `PixelArtRedmond15V-PixelArt-PIXARFK.safetensors` (trigger: `Pixel Art, PIXARFK`)
- **Device**: Apple Silicon MPS (16GB unified RAM)
- **Client**: `@gseurat/ai-providers` ComfyUIClient (TypeScript, via Node.js)

## Key Findings

### 1. Black Image Problem on MPS

The most significant issue encountered was **black (empty) 512x512 PNG outputs** (~2KB). This affected 30-60% of generations depending on configuration.

**Root Cause**: MPS fp16 precision instability in the VAE decoder and diffusion model. Certain seed values cause numerical underflow/overflow that produces all-black latent outputs.

**Mitigations tested**:

| Flag | Effect | Quality Impact |
|------|--------|---------------|
| `--fp32-vae` | Reduces black rate to ~30-40% | No quality loss, slight speed decrease |
| `--cpu-vae` | Same as fp32-vae (~30-40% black) | No quality loss |
| `--force-fp32` | Reduces black rate to ~20%, **fixes ControlNet** | Slower, but required for ControlNet (OpenPose) to function correctly on MPS |
| LoRA loaded | Reduces black rate independently | LoRA presence changes latent space, avoiding some degenerate regions |

**Best solution**: `--force-fp32` + LoRA + retry with different seeds (prime offset `seed + 7919 * attempt`). With 10 retries, success rate reaches ~99%. Note: `--force-fp32` is now recommended over `--fp32-vae` because it also fixes ControlNet (OpenPose) precision on MPS — without it, OpenPose ControlNet produces garbage output (head-in-circle instead of full-body poses).

### 2. LoRA Weight Impact

| Weight | Pixel Art Consistency | Color Accuracy | Degenerate Rate |
|--------|----------------------|----------------|-----------------|
| 0.65 | Low — often non-pixel-art | Better natural colors | Low noise |
| 0.75 | Medium | Good balance | Medium |
| 0.85 | High — strong pixel art style | Sometimes garish (magenta/neon) | Higher noise |

**Recommendation**: Weight 0.85 for strongest pixel art style. Accept occasional color issues as trade-off for consistent style.

### 3. Sampler Comparison

| Sampler | Quality | Consistency | Speed |
|---------|---------|-------------|-------|
| `euler` | Best overall | Good with LoRA | Fast |
| `euler_ancestral` | Poor — abstract blobs | Very inconsistent | Fast |
| `dpmpp_2m` | OK — scene-style | Mixed | Medium |
| `dpmpp_sde` | Poor — noisy | Very inconsistent | Slow |

**Recommendation**: `euler` sampler only. Other samplers produced significantly worse results on MPS.

### 4. Tile vs Character Quality

**Character sprites**: Consistently good quality. SD 1.5 understands "character sprite, front view, full body" well. The LoRA enhances the pixel art style effectively.

**Tiles**: Very inconsistent. SD 1.5 struggles with "top-down RPG tile" — it tends to generate:
- Full scene views instead of isolated tiles
- Wrong perspective (side view landscapes)
- Abstract patterns or noise
- Unrelated imagery

**Recommendation**: Character sprites are production-viable with curation. Tiles need manual review and may require re-generation or hand-editing.

### 5. MPS Numerical Instability Across Restarts

The same seed + prompt + settings can produce **different outputs** after restarting ComfyUI. This is due to MPS non-deterministic behavior. Results that looked excellent in one session may be garbage in the next.

**Implication**: Cannot rely on "known good seeds" across sessions. Always use retry logic.

## Final Generation Run

### Configuration
```
LoRA: PixelArtRedmond15V weight=0.85
Steps: 20 | CFG: 7 | Sampler: euler
Resolution: 512x512
ComfyUI flags: --force-fp32 --listen --enable-cors-header '*'
Retry: up to 10 attempts with seed offset +7919*attempt
```

### Results
- **Total time**: 182 minutes (~3 hours)
- **Generated**: 309 / 312 (99.0% success)
- **Failed**: 3 (1 tile, 2 sprite frames)
- **Average time per image**: ~35 seconds (including retries)
- **Average retries per image**: ~1.5

### Output Location
```
/tmp/medieval_rpg_assets_final/
  tiles/          — 24 tiles (23 valid + 1 failed)
  sprites/
    protagonist/  — 48 frames
    guard/        — 48 frames (1 black)
    wizard/       — 48 frames
    merchant/     — 48 frames
    slime/        — 48 frames
    skeleton/     — 48 frames
```

### Asset Inventory

**Tiles** (24):
- Terrain: grass, grass_flowers, dirt_path, cobblestone
- Nature: tree_canopy, tree_trunk, bush, wildflowers
- Water: brook_0, brook_1, brook_2, bridge
- Objects: fence, rock, wheat_field, hay_bale
- Buildings: stone_wall, brick_wall, wooden_door, window, thatch_roof (FAILED), signpost, barrel, crate

**Characters** (6 x 48 frames each):
- protagonist: RPG hero, green tunic, brown hair, sword
- guard: chain mail, iron helmet, spear, red tabard
- wizard: blue robe, pointed hat, white beard, staff
- merchant: brown vest, apron, coin purse
- slime: green gelatinous blob
- skeleton: tattered armor, bone sword, glowing eyes

Each character has: idle/walk/run x S/N/E/W x 4 animation frames

## AnimateDiff Integration

### Overview

AnimateDiff generates multi-frame animations from a reference image and a text prompt. It works by injecting temporal motion modules into Stable Diffusion, producing coherent frame sequences rather than individual images.

### Installed Components

| Component | Location | Purpose |
|-----------|----------|---------|
| **ComfyUI-AnimateDiff-Evolved** | `tools/ComfyUI/custom_nodes/ComfyUI-AnimateDiff-Evolved/` | Motion module loader, evolved sampling, context options |
| **ComfyUI-VideoHelperSuite** | `tools/ComfyUI/custom_nodes/ComfyUI-VideoHelperSuite/` | Frame-to-video combiner (GIF/WebP/MP4 output) |
| **mm_sd_v15_v2.ckpt** | `tools/ComfyUI/models/animatediff_models/` | Motion model for SD 1.5 (~1.7GB) |

VHS Python dependencies (`opencv-python`, `imageio-ffmpeg`) are installed in the ComfyUI venv.

### Workflow Architecture

The AnimateDiff workflow (`buildAnimateDiffWorkflow` in `comfyui.ts`) chains:

```
CheckpointLoaderSimple ──→ ADE_UseEvolvedSampling ──→ KSampler ──→ VAEDecode ──→ VHS_VideoCombine
                               ↑           ↑                                        ↓
ADE_LoadAnimateDiffModel       │           │                                   (GIF/WebP)
  → ADE_ApplyAnimateDiffModelSimple        │
      (M_MODELS) ──────────────┘           │
                                           │
ADE_StandardUniformContextOptions          │
  (CONTEXT_OPTIONS) ───────────────────────┘
                                           │
ADE_EmptyLatentImageLarge (batch) ─────────┘
                                           │
CLIPTextEncode (positive/negative) ────────┘
```

Key node connections:
- `ADE_ApplyAnimateDiffModelSimple` takes only the motion model, outputs `M_MODELS`
- `ADE_UseEvolvedSampling` takes `MODEL` (from checkpoint) + `m_models` (optional, from AnimateDiff) + `context_options`
- `ADE_EmptyLatentImageLarge` generates a batch of latents (one per frame)
- `VHS_VideoCombine` combines decoded frames into a looping animation
- Individual frames are also saved via `SaveImage`

### API Usage

```typescript
import { ComfyUIClient } from "@gseurat-tools/ai-providers";

const client = new ComfyUIClient("http://localhost:8188", 1000, 300_000);

const animation = await client.generateAnimateDiff(
  "pixel art character walking animation, side view, game sprite",
  referenceImageBytes,  // Uint8Array of PNG
  {
    motionModel: "mm_sd_v15_v2.ckpt",  // default
    frameCount: 8,       // number of animation frames (default 16)
    frameRate: 8,        // output GIF/WebP frame rate (default 8)
    steps: 20,           // diffusion steps (default 20)
    width: 512,          // generation resolution
    height: 512,
    denoise: 0.6,        // 0.0 = no change, 1.0 = full regen (default 0.6)
    cfgScale: 7,         // classifier-free guidance (default 7)
    samplerName: "euler", // recommended for MPS
    outputFormat: "image/gif",  // or "image/webp" (default)
    loopCount: 0,        // 0 = infinite loop
  }
);

// With automatic retry on blank images:
const result = await client.generateAnimateDiffWithRetry(
  prompt, referenceImage, opts, 3  // maxRetries
);

// List available motion models:
const models = await client.listMotionModels();
```

### MPS / Apple Silicon Notes

- **`--force-fp32` is required** for AnimateDiff on MPS. Unlike single-image generation where `--cpu-vae` suffices, AnimateDiff produces all-black frames without full fp32 precision.
- **`--cpu-vae` alone is NOT enough** — the motion module's temporal attention layers also need fp32.
- Expect higher memory usage and slower generation (~2-4min for 8 frames at 512x512, 15 steps).
- Later frames in longer sequences (16+) may show quality degradation/noise. For sprite animations, 4-8 frames is the sweet spot.

### Recommended Launch Command

```bash
cd tools/ComfyUI
./venv/bin/python main.py --listen localhost --port 8188 --force-fp32 --enable-cors-header "*"
```

> **Note**: `--force-fp32` is required on Apple Silicon (MPS) for both ControlNet and AnimateDiff. Without it, OpenPose ControlNet produces garbage (head-in-circle closeups instead of full-body posed output) and AnimateDiff produces all-black frames. The older `--fp32-vae` flag only fixes the VAE decoder but not ControlNet precision.

### Experiment Results

Extensive parameter sweep experiments were conducted (see `tools/animatediff-experiments/EXPERIMENT-REPORT.md`). Key findings:

- **AnimateDiff animates backgrounds, not characters.** The motion model applies temporal changes to the entire latent space, resulting in shimmering backgrounds while the character remains mostly static. This makes it unsuitable for sprite animation where characters need specific movements (walk cycles, attacks).
- **Denoise 0.5-0.6** balances character preservation with motion; >0.8 changes the character too much.
- **8 frames** is the practical maximum on Apple Silicon (16 frames OOM).
- **MPS instability**: ComfyUI hangs after ~5-8 consecutive AnimateDiff jobs. Restart between generations.
- **Chibi vs concept art**: Both produce similar results; neither solves the background animation issue.
- **Margin padding**: Adding space around the character does not help with the core issue.

### Recommendation

**AnimateDiff is not recommended for sprite animation.** The existing **IP-Adapter + OpenPose** per-frame pipeline provides explicit pose control without background animation issues. AnimateDiff may still be useful for environmental animation (water, fire, foliage tiles) or motion prototyping.

## IP-Adapter Only Pipeline (Concept→Chibi)

### Overview

For generating chibi versions of concept art, Seurat uses a **txt2img + IP-Adapter** workflow (no ControlNet or img2img):

- **txt2img**: Generates from scratch so the prompt fully controls chibi proportions (2-head body ratio, big head, small body)
- **IP-Adapter**: Feeds the concept art as an identity reference, preserving character colors/features/design without constraining body structure

This replaced the previous img2img approach, which forced an impossible tradeoff: low denoise preserved the concept but couldn't change proportions, while high denoise changed proportions but lost character identity.

**Default IP-Adapter settings**: weight=0.6, end_at=0.7 (adjustable in Seurat's chibi generation UI).

## Two-Pass IP-Adapter Pipeline (Concept→Pose→Chibi→Pixel)

### Overview

The recommended **sprite frame** generation pipeline uses a **two-pass ComfyUI workflow** that separates posing from style transfer:

1. **Pass 1 (Pose)**: IP-Adapter (concept art reference) + OpenPose ControlNet → posed character at 512x512
2. **Inter-pass RemBG**: Background removal on Pass 1 output to prevent Pass 2 from reinforcing generated backgrounds
3. **Pass 2 (Chibi-fy)**: IP-Adapter (chibi reference) + img2img on cleaned Pass 1 output → chibi-fied character
4. **Downscale**: Nearest-neighbor to final sprite size (e.g. 128x128)

This approach gives better control than single-pass because the concept art drives the character identity/pose while the chibi reference drives the final art style.

### Background Mitigation

Backgrounds in generated frames were a persistent issue. The pipeline uses multiple layers of defense:

1. **Prompt engineering**: Frames use `plain white background, solid color background` instead of `transparent background` (SD 1.5 handles solid colors much better than transparency). Negative prompts include `detailed background, room, interior, exterior, furniture, floor, wall, ceiling, sky, ground, environment`.
2. **Reference image pre-processing**: When IP-Adapter + RemBG are both enabled, all reference images (concept art and chibi, per-direction) are run through RemBG *before* being fed to IP-Adapter. This prevents IP-Adapter from reproducing backgrounds present in the reference images. Results are cached per-view so RemBG runs once per direction.
3. **IP-Adapter embeds_scaling**: Pass-1 identity nodes use `"V only"` — experimentally validated as the best option for character consistency with least circular frame artifacts (tested against `"K+V"`, `"K+V w/ C penalty"`, `"K+mean(V) w/ C penalty"`). Pass-2 chibi nodes use `"K+mean(V) w/ C penalty"` to reduce background leakage during style transfer.
4. **IP-Adapter end_at**: Pass 1 default is `1.0` (full denoising guidance). Pass 2 uses `0.6`. The `weight_type` is `"linear"` for all passes — experimentally validated as the most reliable on Apple Silicon MPS (other types like `"weak input"` and `"ease out"` caused rendering failures or worse results with OpenPose).
5. **Inter-pass RemBG + white compositing**: Background removal runs between Pass 1 and Pass 2. Critically, the RemBG output is composited onto a **solid white background** (via `SolidMask` → `MaskToImage` → `ImageCompositeMasked`) before being fed to Pass 2's VAEEncode. Without this step, RemBG strips backgrounds to black/transparent, and VAEEncode turns those black regions into latent noise that Pass 2 renders as swirling artifacts.
6. **Pass 2/3 white background prompts**: Both the chibi pass and pixel art pass CLIP prompts explicitly include `plain white background, solid color background` to reinforce white background generation in later passes.
7. **Final RemBG**: Standard background removal on the final output.

### Known Limitation: IP-Adapter PLUS Always Generates Backgrounds

Testing confirmed that IP-Adapter "PLUS (high strength)" (CLIP-ViT-H-14) **always generates backgrounds** with SD 1.5, regardless of:
- Prompt engineering (negative prompts, "plain white background")
- Reference image pre-processing (RemBG-cleaned references)
- embeds_scaling setting (all variants tested)
- Weight and end_at values (tested 0.3–0.7 weight, 0.2–0.6 end_at)
- Attention masking (center-region attn_mask on IPAdapterAdvanced)
- Checkpoint (AnythingV5 and base v1-5-pruned-emaonly both affected)

Without IP-Adapter, the model generates clean white backgrounds but loses character identity. The current pipeline mitigates this by:
1. Generating with IP-Adapter (accepting backgrounds will exist)
2. Relying on multi-stage RemBG to extract the character
3. Using the base `v1-5-pruned-emaonly` checkpoint + higher CFG (7–10) produces simpler/more uniform backgrounds that RemBG handles better than AnythingV5's complex artistic backgrounds

**Future options** to fully solve this:
- Install the `ip-adapter_sd15_light.safetensors` model for `"LIGHT - SD1.5 only (low strength)"` preset — uses a simpler CLIP encoder with less compositional influence
- Use `"STANDARD (medium strength)"` with its separate model file
- Explore ControlNet inpainting to regenerate only the background region after initial generation

### Workflow Architecture

```
Pass 1:
CheckpointLoader → IPAdapterUnifiedLoader → IPAdapterAdvanced (concept art, V only, linear, end_at=1.0)
                                               ↓
ControlNetLoader (OpenPose) → ControlNetApplyAdvanced (pose skeleton, strength=0.8)
                                               ↓
EmptyLatentImage → KSampler (denoise=1.0) → VAEDecode → Pass 1 output

Inter-pass (white compositing):
Pass 1 output → BRIA_RMBG → mask
SolidMask(1.0) → MaskToImage → white background
ImageCompositeMasked(white, pass1_rgb, rmbg_mask) → character on white

Pass 2:
Character-on-white → VAEEncode → KSampler (denoise=0.7) → VAEDecode → ImageScale → RemBG → SaveImage
                                     ↑
IPAdapterUnifiedLoader → IPAdapterAdvanced (chibi reference, K+mean(V) w/ C penalty, linear, end_at=0.6)
```

### API Usage

```typescript
import { ComfyUIClient } from "@gseurat-tools/ai-providers";

const client = new ComfyUIClient("http://localhost:8188", 1000, 600_000);

const frame = await client.generateTwoPassIPAdapterWithRetry(
  prompt, conceptImageBytes, chibiImageBytes, poseSkeletonBytes,
  {
    width: 512, height: 512,
    steps: 30, seed: 42, cfgScale: 7, samplerName: "euler",
    checkpoint: "AnythingV5_v5PrtRE.safetensors",
    vae: "vae-ft-mse-840000-ema-pruned.safetensors",
    ipAdapterWeight: 0.7,
    ipAdapterPreset: "PLUS (high strength)",
    ipAdapterStartAt: 0.0,
    ipAdapterEndAt: 1.0,
    openPoseModel: "control_v11p_sd15_openpose.pth",
    openPoseStrength: 0.8,
    chibiWeight: 0.7,
    chibiDenoise: 0.7,
    removeBackground: true,
    remBgNodeType: "BRIA_RMBG_Zho",
    outputWidth: 128, outputHeight: 128,
  },
);

// Standalone background removal (e.g. pre-process references):
const cleaned = await client.removeBackground(imageBytes, "BRIA_RMBG_Zho");
```

### MPS / Apple Silicon Notes

- **`--force-fp32` is required** for all IP-Adapter + OpenPose workflows on MPS. Without full fp32, OpenPose ControlNet fails to control pose (produces head closeups instead of full-body). The intermediate VAEEncode/VAEDecode between passes also produces all-black images without fp32 precision.
- **OpenPose skeleton format**: Must use **14 keypoints** (no mid_hip). Neck connects directly to r_hip and l_hip. The 15-keypoint format with mid_hip creates a visual topology that ControlNet v1.1 OpenPose does not recognize. Additionally, **shoulders must be at the same Y-coordinate as the neck** (horizontal T-bar shape). If shoulders are placed below the neck (Y-shape), the ControlNet ignores the pose entirely. Standard proportions: head ~12%, neck ~22%, hips ~45% from top of frame.
- Expect ~40s per frame at 512x512 with 30 steps on Apple Silicon.

### Experiment Results

A parameter sweep of 14 experiments (56 frames total) was conducted. See `tools/twopass-experiments/`. Key findings:

| Parameter | Best Value | Notes |
|-----------|-----------|-------|
| **chibiDenoise** | **0.7** | Lower values (0.3-0.5) barely change the concept art style. 0.7 produces visible chibi proportions. |
| **openPoseStrength** | **0.8** | Stronger pose guidance ensures the OpenPose skeleton is followed. Previous default of 0.5 was too weak when IP-Adapter dominated. |
| **consistentSeed** | **true** | Same seed across all frames ensures character appearance stays consistent; the pose skeleton drives variation. |
| chibiWeight | 0.7 | Weight has minimal effect compared to denoise. 0.5-0.9 all look similar. |
| **ipAdapterEndAt** | **1.0** | Full denoising guidance produces the most consistent character identity. Previously 0.6, but experiments showed full range works best with `"V only"` embeds_scaling. |
| ipAdapterWeight | 0.7 | Standard value; balances identity preservation with prompt adherence. |
| **embeds_scaling (pass 1)** | **V only** | Experimentally validated (8 param combos round 1, 3x4 frames round 2). `"V only"` gave best character consistency and least circular frame artifacts. `"K+V w/ C penalty"` was the runner-up. `"K+mean(V) w/ C penalty"` was too conservative. Pass 2 still uses `"K+mean(V) w/ C penalty"`. |
| **weight_type** | **linear** | Tested: linear, ease out, weak input, style transfer. `"weak input"` was best without OpenPose but caused black/corrupted frames with OpenPose on MPS. `"ease out"` produced the worst results. `"linear"` is the most reliable across all modes. |
| checkpoint | v1-5-pruned-emaonly | Base SD 1.5 produces simpler/uniform backgrounds that RemBG handles better. AnythingV5 produces complex artistic backgrounds that resist removal. |
| **CFG** | **7** | Balances prompt adherence (direction control) with IP-Adapter influence. Lower values (4-5) let IP-Adapter dominate too much. |
| **steps** | **30** | IP-Adapter needs 30+ steps for proper convergence. 20 steps produced inconsistent results. |

**Two-pass vs single-pass comparison:**
- Two-pass produces more detailed, higher-quality sprites with better concept art fidelity
- Single-pass with chibi reference is faster (~22s vs ~40s) and produces warmer colors
- Single-pass with concept reference produces the most ornate/detailed output but lacks chibi proportions

## Recommendations for Future Work

1. **Use SDXL or a dedicated pixel art model** for better tile generation. SD 1.5 lacks understanding of top-down game tiles.

2. **Add a pixel art LoRA trained on RPG tilesets** (e.g., PixelArtRedmond trained on top-down maps) for tile-specific generation.

3. **Post-processing pipeline**: Downscale 512x512 to 16x16 or 32x32 with nearest-neighbor sampling for actual game integration (the Pixel Painter's `downscaleToPixelData()` function does this).

4. **Manual curation pass**: Not all non-black images are usable. Estimate ~70% of character sprites and ~40% of tiles are good quality. A human review step is essential.

5. **Consider IP-Adapter for style transfer**: For chibi generation, txt2img + IP-Adapter gives better results than img2img — the prompt controls proportions while IP-Adapter preserves character identity. For sprite frames, the two-pass IP-Adapter + OpenPose pipeline provides explicit pose control. Use `embeds_scaling: "V only"` with `weight_type: "linear"` on pass-1 identity nodes for best character consistency. Pre-process reference images through RemBG and composite onto white background before feeding to IP-Adapter. Frame prompts should omit the concept's `style_prompt` (IP-Adapter handles style transfer) and place direction terms first for strongest orientation influence.

6. **GPU recommendation**: For production use, an NVIDIA GPU avoids all MPS precision issues. The black image problem is entirely an Apple Silicon limitation.

7. **RIFE frame interpolation**: ComfyUI-Frame-Interpolation provides the `RIFE VFI` node for AI-powered in-between frame generation. On MPS, use `dtype: float32` (consistent with `--force-fp32`). The `rife47.pth` checkpoint is recommended — `rife49.pth` has unreliable download mirrors. Models go in `custom_nodes/ComfyUI-Frame-Interpolation/ckpts/rife/`. Install with `requirements-no-cupy.txt` (cupy is CUDA-only). Seurat auto-detects the node class name and queries its schema to handle version differences.

## Script Location

The generation script is at: `/tmp/generate_medieval_rpg_final.mjs`

Key features:
- Skip logic for already-generated files (`existsSync` + size check)
- Retry with prime seed offsets for black image recovery
- LoRA integration via ComfyUIClient `loras` parameter
- Sequential generation (ComfyUI queues don't handle parallel well on MPS)
