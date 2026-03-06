# Pixel Painter

16x16 pixel art editor for authoring tiles and sprite sheets used by the vulkan-game engine. Supports both the 128x48 tileset and the 512x1536 player sprite sheet.

## Views

Switch between views with the tab bar at the top:

- **Tile** — edit a single 16x16 tile in isolation with a large zoomed canvas
- **Tileset** — view and edit the full 128x48 tileset (8 columns x 3 rows of 16x16 tiles)
- **Sprite Sheet** — view and edit the 512x1536 player sheet (4 columns x 12 rows representing 4 frames x 3 states x 4 directions)
- **Animation Preview** — looping playback of the currently selected animation row

## Features

### Drawing Tools

| Tool | Shortcut | Description |
|---|---|---|
| Pencil | `B` | Single pixel freehand draw |
| Line | `L` | Click and drag straight line |
| Rectangle | `R` | Hollow rectangle outline |
| Fill | `F` | Flood fill contiguous region |
| Eyedropper | `I` | Pick color from canvas |
| Eraser | `E` | Set pixels to transparent |

### Mirror Modes

- **Horizontal mirror** — strokes are reflected across the vertical center axis
- **Vertical mirror** — strokes are reflected across the horizontal center axis
- **Quad mirror** — both axes simultaneously, useful for symmetric tiles

### Color Palette

- 32-slot custom palette with save/load as JSON
- HSV picker for precise color selection
- Opacity slider (alpha channel)
- Recent colors row (last 8 used)

### Tileset View (128x48)

Clicking a tile cell in the tileset view selects it for editing in the Tile view. Tile IDs match the engine's tileset indexing: row * 8 + col. The tileset grid overlay can be toggled with `G`.

### Sprite Sheet View (64x192)

Row layout matches the engine's 12-row animation layout:

| Rows | State | Direction |
|---|---|---|
| 0-2 | idle | down, left, right |
| 3-5 | walk | down, left, right |
| 6-8 | run | down, left, right |
| 9-11 | (reserved) | — |

### Animation Preview

Plays back the 4 frames of the selected row at the frame duration defined for that animation clip. Frame duration is editable in the preview panel and writes back to the animation JSON.

## AI Generation

The Pixel Painter integrates with **ComfyUI** for AI-assisted pixel art generation. Toggle the AI panel with the `[A]` key or the "AI Gen" toolbar button.

### Requirements

- [ComfyUI](https://github.com/comfyanonymous/ComfyUI)
- Python 3.10 (required by PyTorch / ComfyUI dependencies)
- A Stable Diffusion 1.5 checkpoint (e.g. `v1-5-pruned-emaonly.safetensors`)
- (Recommended) A pixel art LoRA model for better results

### Setup on macOS (No CUDA)

ComfyUI runs on Mac in CPU mode with minimal setup hassle:

```bash
# 1. Install Python 3.10 via pyenv (keeps your system Python untouched)
brew install pyenv
pyenv install 3.10.17

# 2. Clone ComfyUI
git clone https://github.com/comfyanonymous/ComfyUI
cd ComfyUI

# 3. Create a venv with Python 3.10
$(pyenv prefix 3.10.17)/bin/python3.10 -m venv venv
./venv/bin/pip install -r requirements.txt

# 4. Download SD 1.5 checkpoint (~4.3 GB)
cd models/checkpoints
curl -L -o v1-5-pruned-emaonly.safetensors \
  https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-v1-5/resolve/main/v1-5-pruned-emaonly.safetensors
cd ../..

# 5. Start ComfyUI with CORS enabled
# Apple Silicon (MPS backend — recommended, ~30s per image at 20 steps):
./venv/bin/python main.py --listen --enable-cors-header "*" --cpu-vae

# CPU-only fallback (slower, ~2–5 min per image):
# ./venv/bin/python main.py --cpu --listen --enable-cors-header "*"
```

> **Important:** The `--enable-cors-header "*"` flag is required so the Pixel Painter browser app (on `localhost:5174`) can reach the ComfyUI API (on `localhost:8188`).

> **Apple Silicon note:** Use `--cpu-vae` instead of `--cpu` to run the diffusion model on the MPS (Metal) GPU while keeping the VAE on CPU (avoids MPS float16 VAE issues). The `euler` sampler is recommended — other samplers may produce poor results on MPS.

The server starts at `http://localhost:8188` by default. You can change the URL in the Pixel Painter's Advanced settings or via the `VITE_COMFYUI_URL` environment variable.

### Using a Pixel Art LoRA

LoRA (Low-Rank Adaptation) models specialize Stable Diffusion for a specific style. For pixel art, a LoRA dramatically improves output quality compared to prompt keywords alone.

1. **Download a pixel art LoRA** — we recommend [PixelArtRedmond 1.5V](https://huggingface.co/artificialguybr/pixelartredmond-1-5v-pixel-art-loras-for-sd-1-5) (SD 1.5, ~26MB):
   ```bash
   cd ComfyUI/models/loras
   curl -L -o PixelArtRedmond15V-PixelArt-PIXARFK.safetensors \
     https://huggingface.co/artificialguybr/pixelartredmond-1-5v-pixel-art-loras-for-sd-1-5/resolve/main/PixelArtRedmond15V-PixelArt-PIXARFK.safetensors
   ```
   Other options: search "pixel art SD 1.5 LoRA" on [Civitai](https://civitai.com) or Hugging Face.

2. **Configure in Pixel Painter** — open the AI panel, expand **Advanced**, and enter the LoRA filename without the `.safetensors` extension:
   - **LoRA Model:** `PixelArtRedmond15V-PixelArt-PIXARFK`
   - **Weight:** `0.8` (adjust 0.5–1.0 to taste; higher = stronger style effect)

3. **Generate** — type a prompt like "stone floor tile, top-down, gray, rough texture" and click Generate (or Ctrl+Enter). A `LoraLoader` node is automatically inserted into the ComfyUI workflow. Include the trigger word `PixArFK` in your prompt for best results (or the trigger word specific to your chosen LoRA).

### Generation Modes

#### Single Frame Mode

1. Enter a text prompt describing the desired tile or sprite
2. (Optional) Use a **Quick Preset** button for common game asset prompts
3. Click **Generate** — the tool sends a 512×512 txt2img workflow to ComfyUI
4. The generated image is displayed as a full-resolution preview
5. A **128×128 nearest-neighbor downscale** preview shows the final pixel art result
6. Click **Apply to Canvas** to place the result on the current tile/sprite cell
7. Refine manually with the drawing tools as needed

#### Row Mode (Sprite Sheet)

When editing a sprite sheet, a **Single / Row** toggle appears in the AI panel. Row mode generates all frames for an animation row at once with visual consistency:

1. Switch to **Row** mode — the panel shows the current row info (e.g. "idle_S, 4 frames")
2. Enter a character description prompt
3. Click **Generate Row** — frame 0 is generated via **txt2img** as the reference character, then frames 1–N are generated via **img2img** from that reference with low denoise (default 0.4) for consistent variation
4. Per-frame thumbnails appear in the preview area
5. Click **Apply to Row** to write all frames to the sprite sheet

The img2img approach ensures all frames share the same character appearance (colors, proportions, style) while allowing slight pose variation per frame. Each frame that produces blank output is automatically retried up to 3 times.

Row generation is also available via remote command:
```json
{"cmd": "ai_generate_row", "prompt": "medieval knight, green tunic", "row": 0, "seed": 42, "denoise": 0.4}
```

### Settings Reference

| Setting | Default | Description |
|---|---|---|
| Steps | 20 | Diffusion steps. Lower = faster, higher = more detail |
| Seed | -1 (random) | Fixed seed for reproducible results |
| CFG Scale | 7 | How closely to follow the prompt (1–30) |
| Sampler | euler | Sampling algorithm (euler, euler_ancestral, dpmpp_2m, ddim, uni_pc) |
| LoRA Model | (empty) | LoRA filename without extension |
| LoRA Weight | 0.8 | LoRA influence strength (0–1.5) |
| Denoise | 0.4 | img2img variation strength for row mode (0=identical, 1=full regen) |
| ComfyUI URL | localhost:8188 | ComfyUI server address |

### Prompt Tips

- The tool automatically appends pixel art style keywords (`pixel art, 8-bit, 16-bit, low-res, retro game graphics, NES palette, clean edges, game asset`) to your prompt
- The default negative prompt excludes smooth/realistic/blurry styles
- Keep prompts short and descriptive: subject + color + style
- For tiles: mention "top-down", "seamless", "tile" for better tiling results
- For sprites: mention facing direction and character description

Single mode targets the currently selected tile or sprite cell. Row mode generates all frames for a sprite sheet animation row at once.

## Batch Generation (CLI Scripts)

For generating entire tilesets or sprite sheets at once, use the Python scripts in `tools/scripts/`. These talk directly to ComfyUI's API and assemble the results into game-ready PNG files.

```bash
# Generate full 128x48 tileset (24 tiles, ~12 min on CPU)
./tools/ComfyUI/venv/bin/python tools/scripts/generate_tileset.py

# Generate full 512x1536 player sprite sheet (48 frames, ~25 min on CPU)
./tools/ComfyUI/venv/bin/python tools/scripts/generate_player_sheet.py
```

Both scripts use the PixelArtRedmond LoRA by default. Edit the `LORA_NAME`, `LORA_WEIGHT`, and `TILE_PROMPTS` / `CHARACTER_DESC` variables at the top of each script to customize. Seeds are deterministic for reproducible results.

## Export and Hot-Reload

Clicking "Export" writes the PNG to `assets/` via `POST /api/files/textures/:name` on the bridge REST API, then sends `{"cmd":"reload_texture","name":"tileset.png"}` to the engine. The engine reloads the texture GPU-side without restarting, and the change appears in the Vulkan window within one frame.

Supported export targets:

| File | Dimensions | Target |
|---|---|---|
| `tileset.png` | 128x48 | Tile map rendering |
| `player_sheet.png` | 512x1536 | Player animation |
| `particle_atlas.png` | 96x16 | Particle system |

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |
| `Ctrl+S` | Save and export |
| `[` / `]` | Zoom out / in |
| `Space + drag` | Pan canvas |
| `X` | Swap foreground/background color |
