# ComfyUI Asset Generation Research Report

## Overview

Research into using ComfyUI with Stable Diffusion 1.5 on Apple Silicon (MPS) for generating medieval RPG pixel art assets: 24 tileset tiles and 288 character sprite frames (6 characters x 3 states x 4 directions x 4 frames).

## Environment

- **ComfyUI**: v0.16.1
- **Model**: `v1-5-pruned-emaonly.safetensors` (SD 1.5)
- **LoRA**: `PixelArtRedmond15V-PixelArt-PIXARFK.safetensors` (trigger: `Pixel Art, PIXARFK`)
- **Device**: Apple Silicon MPS (16GB unified RAM)
- **Client**: `@vulkan-game/ai-providers` ComfyUIClient (TypeScript, via Node.js)

## Key Findings

### 1. Black Image Problem on MPS

The most significant issue encountered was **black (empty) 512x512 PNG outputs** (~2KB). This affected 30-60% of generations depending on configuration.

**Root Cause**: MPS fp16 precision instability in the VAE decoder and diffusion model. Certain seed values cause numerical underflow/overflow that produces all-black latent outputs.

**Mitigations tested**:

| Flag | Effect | Quality Impact |
|------|--------|---------------|
| `--fp32-vae` | Reduces black rate to ~30-40% | No quality loss, slight speed decrease |
| `--cpu-vae` | Same as fp32-vae (~30-40% black) | No quality loss |
| `--force-fp32` | Reduces black rate to ~20% | **Degrades quality significantly** — model produces blurry/abstract outputs |
| LoRA loaded | Reduces black rate independently | LoRA presence changes latent space, avoiding some degenerate regions |

**Best solution**: `--fp32-vae` + LoRA + retry with different seeds (prime offset `seed + 7919 * attempt`). With 10 retries, success rate reaches ~99%.

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
ComfyUI flags: --fp32-vae --listen --enable-cors-header '*'
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
import { ComfyUIClient } from "@vulkan-game-tools/ai-providers";

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
./venv/bin/python main.py --listen --enable-cors-header '*' --force-fp32
```

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
2. **Pass 2 (Chibi-fy)**: IP-Adapter (chibi reference) + img2img on Pass 1 output → chibi-fied character
3. **Downscale**: Nearest-neighbor to final sprite size (e.g. 128x128)

This approach gives better control than single-pass because the concept art drives the character identity/pose while the chibi reference drives the final art style.

### Workflow Architecture

```
Pass 1:
CheckpointLoader → IPAdapterUnifiedLoader → IPAdapterAdvanced (concept art)
                                               ↓
ControlNetLoader (OpenPose) → ControlNetApplyAdvanced (pose skeleton)
                                               ↓
EmptyLatentImage → KSampler (denoise=1.0) → VAEDecode → Pass 1 output

Pass 2:
Pass 1 output → VAEEncode → KSampler (denoise=0.7) → VAEDecode → ImageScale → SaveImage
                               ↑
IPAdapterUnifiedLoader → IPAdapterAdvanced (chibi reference)
```

### API Usage

```typescript
import { ComfyUIClient } from "@vulkan-game-tools/ai-providers";

const client = new ComfyUIClient("http://localhost:8188", 1000, 600_000);

const frame = await client.generateTwoPassIPAdapterWithRetry(
  prompt, conceptImageBytes, chibiImageBytes, poseSkeletonBytes,
  {
    width: 512, height: 512,
    steps: 20, seed: 42, cfgScale: 5, samplerName: "euler",
    checkpoint: "AnythingV5_v5PrtRE.safetensors",
    vae: "vae-ft-mse-840000-ema-pruned.safetensors",
    ipAdapterWeight: 0.7,
    ipAdapterPreset: "PLUS (high strength)",
    ipAdapterStartAt: 0.0,
    ipAdapterEndAt: 0.8,
    openPoseModel: "control_v11p_sd15_openpose.pth",
    openPoseStrength: 0.5,
    chibiWeight: 0.7,
    chibiDenoise: 0.7,
    outputWidth: 128, outputHeight: 128,
  },
);
```

### MPS / Apple Silicon Notes

- **`--force-fp32` is required** for the two-pass workflow on MPS. The intermediate VAEEncode/VAEDecode between passes produces all-black images without fp32 precision (`--cpu-vae` is not sufficient).
- Expect ~40s per frame at 512x512 with 20 steps on Apple Silicon.

### Experiment Results

A parameter sweep of 14 experiments (56 frames total) was conducted. See `tools/twopass-experiments/`. Key findings:

| Parameter | Best Value | Notes |
|-----------|-----------|-------|
| **chibiDenoise** | **0.7** | Lower values (0.3-0.5) barely change the concept art style. 0.7 produces visible chibi proportions. |
| **openPoseStrength** | **0.5** | Lower strength gives more natural, fluid poses. 1.0 is too rigid. |
| **consistentSeed** | **true** | Same seed across all frames ensures character appearance stays consistent; the pose skeleton drives variation. |
| chibiWeight | 0.7 | Weight has minimal effect compared to denoise. 0.5-0.9 all look similar. |
| ipAdapterEndAt | 0.8 | Stopping IP-Adapter at 80% lets the model refine details in the final denoising steps. |
| ipAdapterWeight | 0.7 | Standard value; balances identity preservation with prompt adherence. |

**Two-pass vs single-pass comparison:**
- Two-pass produces more detailed, higher-quality sprites with better concept art fidelity
- Single-pass with chibi reference is faster (~22s vs ~40s) and produces warmer colors
- Single-pass with concept reference produces the most ornate/detailed output but lacks chibi proportions

## Recommendations for Future Work

1. **Use SDXL or a dedicated pixel art model** for better tile generation. SD 1.5 lacks understanding of top-down game tiles.

2. **Add a pixel art LoRA trained on RPG tilesets** (e.g., PixelArtRedmond trained on top-down maps) for tile-specific generation.

3. **Post-processing pipeline**: Downscale 512x512 to 16x16 or 32x32 with nearest-neighbor sampling for actual game integration (the Pixel Painter's `downscaleToPixelData()` function does this).

4. **Manual curation pass**: Not all non-black images are usable. Estimate ~70% of character sprites and ~40% of tiles are good quality. A human review step is essential.

5. **Consider IP-Adapter for style transfer**: For chibi generation, txt2img + IP-Adapter gives better results than img2img — the prompt controls proportions while IP-Adapter preserves character identity. For sprite frames, the two-pass IP-Adapter + OpenPose pipeline provides explicit pose control.

6. **GPU recommendation**: For production use, an NVIDIA GPU avoids all MPS precision issues. The black image problem is entirely an Apple Silicon limitation.

## Script Location

The generation script is at: `/tmp/generate_medieval_rpg_final.mjs`

Key features:
- Skip logic for already-generated files (`existsSync` + size check)
- Retry with prime seed offsets for black image recovery
- LoRA integration via ComfyUIClient `loras` parameter
- Sequential generation (ComfyUI queues don't handle parallel well on MPS)
