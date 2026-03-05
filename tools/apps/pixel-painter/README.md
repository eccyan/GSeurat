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

When ComfyUI is running at `localhost:8188`, an "AI Generate" button appears in the toolbar. Enter a text prompt such as "mossy stone floor tile, top-down, pixel art, 16x16" and the tool sends a ComfyUI workflow request. The returned image is downsampled to 16x16 and placed on the canvas as a starting point for manual refinement.

Generation always targets the currently selected 16x16 tile region. Full sheet generation is not supported.

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
