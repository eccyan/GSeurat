# Seurat — Sprite Art Pipeline

Seurat is a browser-based tool for generating, reviewing, and assembling pixel-art sprite sheets for the Vulkan game engine. It connects to a local [ComfyUI](https://github.com/comfyanonymous/ComfyUI) server for AI image generation and the bridge server for asset management.

## Quick Start

```bash
# 1. Start ComfyUI (must be running for generation)
cd /path/to/ComfyUI
python main.py --listen

# 2. Start the bridge server
cd tools/apps/bridge
pnpm dev

# 3. Start Seurat
cd tools/apps/seurat
pnpm dev
# Open http://localhost:5179
```

## UI Layout

Seurat uses a 3-pane layout:

| Pane | Width | Content |
|------|-------|---------|
| **Tree** (left) | 220px | Character & animation tree explorer |
| **Main** (center) | flex | Content viewer — concept art, animation preview, frame grid |
| **Right** (right) | 300px | Action panels — generation settings, review, atlas assembly |

### Tree Navigation

- Click **Manifest** to view stats and edit raw JSON
- Click a **character** to view/edit concept art and assemble atlas
- Click an **animation** to review frames, generate sprites, and preview playback

## ComfyUI Setup

Seurat requires a running ComfyUI instance with Stable Diffusion 1.5.

### Required Models

Place these in your ComfyUI `models/` directories:

| Type | File | Directory |
|------|------|-----------|
| **Checkpoint** | `v1-5-pruned-emaonly.safetensors` | `models/checkpoints/` |
| **LoRA** | `PixelArtRedmond15V-PixelArt-PIXARFK.safetensors` | `models/loras/` |
| **ControlNet (Tile)** | `control_v11f1e_sd15_tile.pth` | `models/controlnet/` |

- **Checkpoint**: [v1-5-pruned-emaonly](https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-v1-5) — base SD 1.5 model
- **LoRA**: [PixelArtRedmond](https://civitai.com/models/120096) — pixel art style LoRA
- **ControlNet**: [control_v11f1e_sd15_tile](https://huggingface.co/lllyasviel/ControlNet-v1-1) — tile model for character consistency

### Optional Models (for IP-Adapter + OpenPose mode)

| Type | File | Directory |
|------|------|-----------|
| **IP-Adapter** | `ip-adapter-plus_sd15.safetensors` | `models/ipadapter/` |
| **CLIP Vision** | `CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors` | `models/clip_vision/` |
| **ControlNet (OpenPose)** | `control_v11p_sd15_openpose.pth` | `models/controlnet/` |

- **IP-Adapter**: [ip-adapter-plus_sd15](https://huggingface.co/h94/IP-Adapter) — character appearance consistency from concept art
- **CLIP Vision**: [CLIP-ViT-H-14](https://huggingface.co/h94/IP-Adapter) — vision encoder required by IP-Adapter
- **OpenPose ControlNet**: [control_v11p_sd15_openpose](https://huggingface.co/lllyasviel/ControlNet-v1-1) — pose-guided generation

### Optional Custom Nodes

| Node | Purpose | Install |
|------|---------|---------|
| [ComfyUI_IPAdapter_plus](https://github.com/cubiq/ComfyUI_IPAdapter_plus) | IP-Adapter support | `git clone` into `custom_nodes/` |
| [ComfyUI-BRIA_AI-RMBG](https://github.com/ZHO-ZHO-ZHO/ComfyUI-BRIA_AI-RMBG) | Background removal | `git clone` into `custom_nodes/`, download `model.pth` into `RMBG-1.4/` |

### ComfyUI Settings (in Seurat UI)

| Setting | Default | Description |
|---------|---------|-------------|
| URL | `http://127.0.0.1:8188` | ComfyUI server address |
| Steps | 20 | Diffusion sampling steps |
| CFG | 7 | Classifier-free guidance scale |
| Seed | -1 | Random seed (-1 = random each time) |
| Sampler | `euler` | Sampling algorithm (recommended for Apple Silicon MPS) |
| Denoise | 0.55 | How much to change from the reference image (0 = no change, 1 = full regeneration) |

### LoRA Configuration

Add/remove LoRA models in the **LoRA** section. Each entry has:
- **Name**: filename without `.safetensors` extension
- **Weight**: strength of the LoRA effect (0.0–2.0, default 0.8)

### ControlNet Configuration

ControlNet tiles the concept art horizontally and uses it as conditioning to maintain character consistency across animation frames.

- **Model**: ControlNet model filename (without `.pth`). Clear to disable.
- **Strength**: conditioning strength (0.0–1.5, default 0.70)

### IP-Adapter + OpenPose Configuration

Uses IP-Adapter for character appearance consistency from concept art, combined with OpenPose ControlNet for per-frame pose control. Requires the optional models and `ComfyUI_IPAdapter_plus` custom node.

- **IP Weight**: IP-Adapter influence strength (0.1–1.0, default 0.60)
- **Preset**: IP-Adapter model variant (default "PLUS (high strength)")
- **Pose Model**: OpenPose ControlNet model filename (default `control_v11p_sd15_openpose`)
- **Pose Strength**: OpenPose conditioning strength (0.1–1.5, default 0.80)

When enabled, Seurat generates each frame individually with a programmatically rendered OpenPose skeleton matching the expected pose (idle breathing, walk cycle, run cycle) for each direction and frame index.

### Background Removal

Removes opaque backgrounds from generated sprites (SD 1.5 does not natively support alpha output). Requires the `ComfyUI-BRIA_AI-RMBG` custom node with its `RMBG-1.4/model.pth` weights.

- **Node**: ComfyUI class_type for the RemBG node (default `BRIA_RMBG_Zho`)

## Generation Modes

Seurat automatically selects the generation mode based on available assets and settings:

| Mode | When | Description |
|------|------|-------------|
| **txt2img** | No concept art uploaded | Generates from text prompt only |
| **img2img** | Concept art exists, ControlNet model cleared | Uses concept art as starting image |
| **ControlNet + img2img** | Concept art exists + ControlNet model set | Tiles concept art for ControlNet conditioning + img2img |
| **IP-Adapter + OpenPose** | IP-Adapter enabled + concept art exists | Per-frame generation with character consistency + pose control |

### Generation Scope

| Scope | Description |
|-------|-------------|
| **Single** | Generate one frame at a time |
| **Row** | Generate all frames of an animation as one wide image, then auto-slice into individual frames |
| **All** | Generate all pending frames across all animations (row mode per animation) |

Row mode generates a horizontal sprite strip (e.g., 512x128 for 4 frames of 128x128) and slices it into individual frame PNGs. This produces more consistent animations than single-frame generation.

When IP-Adapter + OpenPose is enabled, row mode generates each frame individually (per-frame pose skeletons) rather than as a single strip.

### Blank Image Detection

Seurat automatically retries generation (up to 3 times with different seeds) when ComfyUI produces blank or black images, which can happen with certain model/prompt combinations.

## Animation Preview

The main pane shows an animation preview when an animation is selected:

- **With generated frames**: Plays back individual frame images directly (no spritesheet needed)
- **With assembled spritesheet**: Shows the full spritesheet with grid overlay and frame highlighting
- Use the **play/pause** button or **spacebar** to control playback

## Workflow

1. **Create a character** via the tree's "+ New Character" button
2. **Set up concept art** — describe the character, configure style prompt, generate or upload concept art
3. **Generate sprites** — select an animation, configure ComfyUI settings, generate frames
4. **Review frames** — approve, reject, or regenerate individual frames
5. **Assemble atlas** — validate and build the final spritesheet PNG

## Architecture

```
seurat/
├── src/
│   ├── App.tsx                      # Root layout (3-pane)
│   ├── store/
│   │   ├── types.ts                 # AIConfig, TreeSelection, GenerationJob
│   │   └── useSeuratStore.ts        # Zustand store (state + actions)
│   ├── lib/
│   │   ├── ai-generate.ts           # Prompt builders (frame, row, negative)
│   │   ├── bridge-api.ts            # REST API client for bridge server
│   │   ├── frame-utils.ts           # Animation timing helpers
│   │   └── pose-templates.ts        # OpenPose skeleton data + renderer
│   ├── components/
│   │   ├── layout/                  # TreePane, MainPane, RightPane, Toolbar, StatusBar
│   │   ├── concept/                 # ConceptPreview, ConceptActions
│   │   ├── generate/                # GenerateActions (ComfyUI settings + scope)
│   │   ├── review/                  # FrameCell, FrameDetailModal, ReviewActions
│   │   ├── animate/                 # AnimationMainView, AnimationPreviewCanvas, FramePreviewCanvas
│   │   ├── atlas/                   # AtlasActions
│   │   └── manifest/                # ManifestStatsView, ManifestJsonEditor
│   └── hooks/
│       ├── usePlaybackEngine.ts     # requestAnimationFrame playback loop
│       └── useRemoteControl.ts      # WebSocket bridge connection
└── vite.config.ts                   # Dev server on :5179, proxies /api to bridge :9101
```
