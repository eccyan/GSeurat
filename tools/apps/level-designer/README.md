# Level Designer

Browser-based tile map editor for authoring scenes loaded by the gseurat engine. Supports tile painting, entity placement, and live preview inside the running engine window.

## UI Layout

```
+----------------------------------------------------------+
| File  Edit  View  Tools          [Save] [Load] [Sync]    |
+----------------+---------------------+-------------------+
|                |                     |                   |
|  Tile Palette  |    Map Canvas       |  Properties       |
|  (scrollable)  |    (pan/zoom)       |  Panel            |
|                |                     |                   |
|  [0] Floor     |  +-+-+-+-+-+-+-+-+  |  Selected: NPC    |
|  [1] Wall      |  |.|.|.|.|.|.|.|.|  |  x: 3.5           |
|  [2] Water A   |  |.|.|W|W|W|.|.|.|  |  y: -2.0          |
|  [3] Water B   |  |.|W|.|.|.|W|.|.|  |  script: guard    |
|  [4] Water C   |  |.|W|.|N|.|W|.|.|  |  dialog: npc_0    |
|  [5] Lava A    |  |.|W|.|.|.|W|.|.|  |  tint: [r,g,b]    |
|  [6] Lava B    |  |.|.|W|W|W|.|.|.|  |                   |
|  [7] Lava C    |  +-+-+-+-+-+-+-+-+  |  Waypoints        |
|  [8] Torch L   |                     |  [+ Add Point]    |
|  [9] Torch R   |  Layers: BG  FG  C  |                   |
|                |                     |  [Delete Entity]  |
+----------------+---------------------+-------------------+
| Status: connected  Tick: 4821  Zoom: 2x  16 x 16 tiles  |
+----------------------------------------------------------+
```

## Features

- **Tile painting** — left-click drag to paint, right-click to erase. Flood fill with F.
- **Entity placement** — place Player spawn, NPCs, static lights, and portals from the toolbar.
- **Undo/redo** — full history stack with Ctrl+Z / Ctrl+Y.
- **Layer visibility** — toggle background, foreground, and collision layers independently.
- **Live engine sync** — each paint stroke sends a scene reload command so changes appear in the Vulkan window immediately.
- **AI tile generation** — describe the map in natural language and Ollama fills tile IDs and places entities.

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `1` - `9` | Select tile by ID |
| `P` | Paint tool |
| `E` | Erase tool |
| `F` | Flood fill |
| `S` | Select / move entity |
| `L` | Place light |
| `O` | Place portal |
| `G` | Toggle grid |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |
| `Ctrl+S` | Save scene JSON |
| `Ctrl+Shift+S` | Save and sync to engine |
| `Space + drag` | Pan canvas |
| `Scroll` | Zoom in/out |

## Tile Palette

| ID | Name | Color |
|---|---|---|
| 0 | Floor | Warm beige |
| 1 | Wall | Dark gray |
| 2 | Water A | Blue |
| 3 | Water B | Blue (mid-wave) |
| 4 | Water C | Blue (peak) |
| 5 | Lava A | Deep red-orange |
| 6 | Lava B | Orange |
| 7 | Lava C | Bright orange |
| 8 | Wall Torch L | Warm amber |
| 9 | Wall Torch R | Warm amber |

Tiles 2-4 and 5-7 are animated sequences defined in `tilemap.tile_animations`. Tile 8 is also flagged solid.

## Live Sync

Every edit that changes scene data serializes the current `SceneData` to JSON and posts it to `POST /api/files/scenes/test_scene.json` via the bridge REST API, then sends `{"cmd":"reload_scene"}` over WebSocket. The engine reloads the scene file without restarting.

The status bar shows the current engine tick and connection state. A yellow indicator means the bridge is reachable but the engine is not running.

## Scene JSON Output

The designer saves files to `assets/scenes/` in the format consumed by `SceneLoader`. All fields match the `SceneData` struct including `tilemap`, `entities`, `background_layers`, `portals`, `weather`, `day_night`, and `minimap`.
