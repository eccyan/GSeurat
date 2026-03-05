# Pixel Painter

16x16 pixel art editor for authoring tiles and sprite sheets used by the vulkan-game engine. Supports both the 128x48 tileset and the 64x192 player sprite sheet.

## Views

Switch between views with the tab bar at the top:

- **Tile** — edit a single 16x16 tile in isolation with a large zoomed canvas
- **Tileset** — view and edit the full 128x48 tileset (8 columns x 3 rows of 16x16 tiles)
- **Sprite Sheet** — view and edit the 64x192 player sheet (4 columns x 12 rows representing 4 frames x 3 states x 4 directions)
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

The Pixel Painter integrates with **Stable Diffusion WebUI** (AUTOMATIC1111 or Forge) for AI-assisted pixel art generation. Toggle the AI panel with the `[A]` key or the "AI Gen" toolbar button.

### Requirements

- [AUTOMATIC1111 WebUI](https://github.com/AUTOMATIC1111/stable-diffusion-webui) or [SD WebUI Forge](https://github.com/lllyasviel/stable-diffusion-webui-forge)
- A Stable Diffusion 1.5 checkpoint (e.g. `v1-5-pruned-emaonly.safetensors`)
- (Recommended) A pixel art LoRA model for better results

### Setup on macOS (No CUDA)

Since macOS does not have NVIDIA CUDA, run the WebUI in CPU mode:

```bash
cd stable-diffusion-webui   # or stable-diffusion-webui-forge
./webui.sh --api --skip-torch-cuda-test --use-cpu all --no-half
```

The server starts at `http://localhost:7860` by default. You can change the URL in the Pixel Painter's Advanced settings or via the `VITE_SD_WEBUI_URL` environment variable.

> **Note:** CPU inference is slower than GPU. Expect 1–5 minutes per image at 20 steps on an Apple Silicon Mac. Reducing steps to 10–15 gives faster results with slightly lower quality.

### Using a Pixel Art LoRA

LoRA (Low-Rank Adaptation) models specialize Stable Diffusion for a specific style. For pixel art, a LoRA dramatically improves output quality compared to prompt keywords alone.

1. **Download a pixel art LoRA** — search for "pixel art" on [Civitai](https://civitai.com) or Hugging Face. Look for SD 1.5 compatible LoRA files (`.safetensors`). Popular choices include:
   - "Pixel Art XL" style LoRAs
   - "16-bit SNES" style LoRAs
   - Any LoRA tagged `pixel art` + `SD 1.5`

2. **Install the LoRA** — copy the `.safetensors` file into your SD WebUI installation:
   ```
   stable-diffusion-webui/models/Lora/pixel-art.safetensors
   ```

3. **Configure in Pixel Painter** — open the AI panel, expand **Advanced**, and enter the LoRA filename without the `.safetensors` extension:
   - **LoRA Model:** `pixel-art`
   - **Weight:** `0.8` (adjust 0.5–1.0 to taste; higher = stronger style effect)

4. **Generate** — type a prompt like "stone floor tile, top-down, gray, rough texture" and click Generate (or Ctrl+Enter). The LoRA tag `<lora:pixel-art:0.8>` is automatically appended to the prompt.

### Generation Workflow

1. Enter a text prompt describing the desired tile or sprite
2. (Optional) Use a **Quick Preset** button for common game asset prompts
3. Click **Generate** — the tool sends a 512×512 txt2img request to SD WebUI
4. The generated image is displayed as a full-resolution preview
5. A **16×16 nearest-neighbor downscale** preview shows the final pixel art result
6. Click **Apply to Canvas** to place the result on the current tile/sprite cell
7. Refine manually with the drawing tools as needed

### Settings Reference

| Setting | Default | Description |
|---|---|---|
| Steps | 20 | Diffusion steps. Lower = faster, higher = more detail |
| Seed | -1 (random) | Fixed seed for reproducible results |
| CFG Scale | 7 | How closely to follow the prompt (1–30) |
| Sampler | Euler a | Sampling algorithm |
| LoRA Model | (empty) | LoRA filename without extension |
| LoRA Weight | 0.8 | LoRA influence strength (0–1.5) |
| Forge URL | localhost:7860 | SD WebUI server address |

### Prompt Tips

- The tool automatically appends pixel art style keywords (`pixel art, 8-bit, 16-bit, low-res, retro game graphics, NES palette, clean edges, game asset`) to your prompt
- The default negative prompt excludes smooth/realistic/blurry styles
- Keep prompts short and descriptive: subject + color + style
- For tiles: mention "top-down", "seamless", "tile" for better tiling results
- For sprites: mention facing direction and character description

Generation always targets the currently selected 16×16 tile or sprite cell. Full sheet generation is not supported.

## Export and Hot-Reload

Clicking "Export" writes the PNG to `assets/` via `POST /api/files/textures/:name` on the bridge REST API, then sends `{"cmd":"reload_texture","name":"tileset.png"}` to the engine. The engine reloads the texture GPU-side without restarting, and the change appears in the Vulkan window within one frame.

Supported export targets:

| File | Dimensions | Target |
|---|---|---|
| `tileset.png` | 128x48 | Tile map rendering |
| `player_sheet.png` | 64x192 | Player animation |
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
