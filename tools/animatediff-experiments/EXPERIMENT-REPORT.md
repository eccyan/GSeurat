# AnimateDiff Experiment Report

## Objective

Evaluate AnimateDiff (via ComfyUI-AnimateDiff-Evolved + Video Helper Suite) for generating sprite animation frames from a reference character image with a text prompt. Tested on Apple Silicon MPS (16GB unified RAM) with SD 1.5.

## Setup

- **ComfyUI**: v0.16.1, `--force-fp32` (required for AnimateDiff on MPS)
- **Motion model**: `mm_sd_v15_v2.ckpt` (AnimateDiff v2, 1.7GB)
- **Checkpoint**: `v1-5-pruned-emaonly.safetensors` (SD 1.5)
- **Custom nodes**: ComfyUI-AnimateDiff-Evolved v1.5.6, ComfyUI-VideoHelperSuite v1.7.9
- **Workflow**: CheckpointLoader → VAEEncode (reference image) → RepeatLatentBatch → ADE_UseEvolvedSampling + ADE_ApplyAnimateDiffModelSimple → KSampler → VAEDecode → VHS_VideoCombine + SaveImage

## Workflow Bug Found & Fixed

The initial workflow used `ADE_EmptyLatentImageLarge` (pure noise) as the KSampler input, completely ignoring the reference image. This produced tiny mosaic-like people with no resemblance to the input. Fixed by replacing with `RepeatLatentBatch` that repeats the VAE-encoded reference image latent across all animation frames.

## Batch 1 — Concept Art Reference (Parameter Sweep)

Reference image: protagonist concept art (512x512 knight in plate armor).
Fixed seed: 42. Base config: denoise=0.6, steps=20, CFG=7, 8 frames, euler sampler.

### Results

| Experiment | Status | Time | Notes |
|-----------|--------|------|-------|
| **Denoise sweep** | | | |
| denoise_0.3 | OK | 178s | Minimal change from reference — almost static |
| denoise_0.5 | OK | 173s | Slight motion, character mostly preserved |
| denoise_0.6 | OK | 171s | Moderate motion, some character drift |
| denoise_0.7 | OK | 176s | More motion, character starts to change |
| denoise_0.9 | OK | 192s | Heavy motion, character appearance changes significantly |
| **Steps sweep** | | | |
| steps_10 | OK | 105s | Faster, slightly lower quality |
| steps_15 | OK | 183s | Good balance |
| steps_20 | OK | 167s | Baseline quality |
| steps_30 | OK | 289s | Diminishing returns, slower |
| **CFG sweep** | | | |
| cfg_3 | OK | 196s | Softer, more creative |
| cfg_5 | OK | 178s | Balanced |
| cfg_7 | OK | 170s | Standard |
| cfg_10 | OK | 170s | More prompt-adherent, slightly rigid |
| **Frame count** | | | |
| frames_4 | OK | 90s | Short animation, fast |
| frames_8 | OK | 176s | Good for walk cycles |
| frames_12 | OK | 353s | Longer, later frames degrade |
| frames_16 | TIMEOUT | — | Exceeded 10min, MPS memory pressure |
| **Samplers** | | | |
| sampler_euler | TIMEOUT | — | ComfyUI hung after sequential jobs |
| sampler_euler_a | TIMEOUT | — | Same MPS hang issue |
| sampler_dpmpp_2m | TIMEOUT | — | Same MPS hang issue |
| **Prompts** | | | |
| prompt_idle | TIMEOUT | — | MPS hang |
| prompt_run | OK | 318s | Running motion visible |
| prompt_attack | OK | 182s | Attack motion visible |

**Note**: Many timeouts were caused by MPS memory accumulation across sequential generations, not the parameters themselves. ComfyUI on Apple Silicon becomes unresponsive after ~5-8 consecutive AnimateDiff jobs.

## Batch 2 — Chibi Reference + Margin Padding

Tested the hypothesis that chibi art (closer to sprite proportions) produces better sprite animations, and that adding margin around the character gives it room to move.

Margin implementation: Pillow-based padding with neutral gray (128,128,128), then resize back to 512x512 to maintain consistent latent size.

### Results

| Experiment | Status | Time | Notes |
|-----------|--------|------|-------|
| chibi_no_margin | OK | 257s | Chibi character preserved, background animates more than character |
| concept_no_margin | OK | ~180s | Concept art preserved, same background animation issue |
| chibi_margin_32 | OK | ~180s | Slight margin, character smaller in frame |
| chibi_margin_64 | OK | 185s | Moderate margin, character has room to move |
| chibi_margin_96 | OK | 189s | More margin, character noticeably smaller |
| chibi_margin_128 | OOM | — | Process killed by macOS OOM killer |
| chibi_m64_denoise_* | OOM | — | Process killed before completion |
| chibi_m64_idle/run/attack | OOM | — | Process killed before completion |
| concept_margin_64 | OOM | — | Process killed before completion |

## Key Findings

### 1. AnimateDiff Animates Backgrounds, Not Characters

**This is the most critical finding.** AnimateDiff applies temporal motion to the entire latent space without distinguishing foreground from background. In practice:
- Backgrounds shimmer, shift, and move significantly
- Characters remain mostly static or experience minor wobble
- The motion model was trained on natural video where backgrounds have subtle motion — it replicates this pattern

**Implication**: AnimateDiff is not suitable for sprite animation where the character needs to perform specific movements (walk cycles, attacks, idle breathing). It works better for video-style effects (camera pans, environmental animation, hair/cloth movement).

### 2. MPS Stability Issues

- `--force-fp32` is mandatory — without it, all frames are black
- ComfyUI hangs after ~5-8 consecutive AnimateDiff generations on MPS
- 16 frames at 512x512 exceeds practical memory limits
- Process frequently OOM-killed by macOS during back-to-back experiments
- **Recommendation**: Restart ComfyUI between each AnimateDiff generation on Apple Silicon

### 3. Parameter Insights (from successful runs)

- **Denoise 0.5-0.6**: Best balance of character preservation and motion
- **Denoise < 0.4**: Too static, barely any animation
- **Denoise > 0.8**: Character appearance changes too much between frames
- **8 frames**: Sweet spot for walk cycles; 12 frames works but is slow; 16 times out
- **Steps 15-20**: Sufficient quality; 30 gives diminishing returns at 2x cost
- **CFG 5-7**: Standard range works well
- **euler sampler**: Only sampler reliably tested (others timed out due to MPS issues, not sampler quality)

### 4. Chibi vs Concept Art

Both produce similar results. The chibi style is slightly closer to the final sprite aesthetic, but the fundamental issue (background animation > character animation) applies equally.

### 5. Margin Padding

Adding margin and resizing back to 512x512 works technically (character becomes smaller in frame), but does not solve the core issue of background-dominant animation.

## Conclusion

**AnimateDiff is not recommended for sprite animation generation.** The existing **IP-Adapter + OpenPose** per-frame pipeline in Seurat provides:
- Explicit pose control per frame
- Character consistency via IP-Adapter
- No background animation issues
- Deterministic frame-by-frame output

AnimateDiff could potentially be useful for:
- Motion reference/prototyping (visualize timing before creating final sprites)
- Environmental animation (water, fire, foliage for tileset animations)
- UI effects (animated backgrounds, particle-like effects)

## File Locations

```
tools/animatediff-experiments/
├── results/                    # Batch 1: concept art parameter sweep (18 completed)
│   ├── denoise_*/              # denoise=0.3, 0.5, 0.6, 0.7, 0.9
│   ├── steps_*/                # steps=10, 15, 20, 30
│   ├── cfg_*/                  # cfg=3, 5, 7, 10
│   ├── frames_*/               # frames=4, 8, 12
│   ├── prompt_run/
│   ├── prompt_attack/
│   └── summary.json
├── results-chibi/              # Batch 2: chibi + margin (5 completed)
│   ├── chibi_no_margin/
│   ├── concept_no_margin/
│   ├── chibi_margin_32/
│   ├── chibi_margin_64/
│   └── chibi_margin_96/
├── run-experiments.ts          # Batch 1 script
├── run-chibi-v2.ts             # Batch 2 script (with ComfyUI restart)
├── pad-image.py                # Pillow-based image padding utility
└── EXPERIMENT-REPORT.md        # This file
```

Each experiment directory contains:
- `params.json` — generation parameters
- `frame_00.png` through `frame_07.png` — individual animation frames
- `animation.gif` — combined animation (8 FPS, infinite loop)
- `input_padded.png` — (chibi experiments) padded input image
