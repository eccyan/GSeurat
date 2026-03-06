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

## Recommendations for Future Work

1. **Use SDXL or a dedicated pixel art model** for better tile generation. SD 1.5 lacks understanding of top-down game tiles.

2. **Add a pixel art LoRA trained on RPG tilesets** (e.g., PixelArtRedmond trained on top-down maps) for tile-specific generation.

3. **Post-processing pipeline**: Downscale 512x512 to 16x16 or 32x32 with nearest-neighbor sampling for actual game integration (the Pixel Painter's `downscaleToPixelData()` function does this).

4. **Manual curation pass**: Not all non-black images are usable. Estimate ~70% of character sprites and ~40% of tiles are good quality. A human review step is essential.

5. **Consider img2img**: Start from a rough pixel art sketch and use SD to refine it. This gives much more control over composition and perspective.

6. **GPU recommendation**: For production use, an NVIDIA GPU avoids all MPS precision issues. The black image problem is entirely an Apple Silicon limitation.

## Script Location

The generation script is at: `/tmp/generate_medieval_rpg_final.mjs`

Key features:
- Skip logic for already-generated files (`existsSync` + size check)
- Retry with prime seed offsets for black image recovery
- LoRA integration via ComfyUIClient `loras` parameter
- Sequential generation (ComfyUI queues don't handle parallel well on MPS)
