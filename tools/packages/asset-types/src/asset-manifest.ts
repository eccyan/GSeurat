// ---------------------------------------------------------------------------
// Asset Manifest — single source of truth for tileset / spritesheet layout
// ---------------------------------------------------------------------------

export interface TileSlotDef {
  id: number;
  label: string;
  group?: string;
}

export interface SpriteRowDef {
  row: number;
  label: string;
  state: string;
  direction: string;
  frames: number;
}

export interface TilesetManifest {
  tile_width: number;
  tile_height: number;
  columns: number;
  rows: number;
  slots: TileSlotDef[];
}

export interface SpritesheetManifest {
  frame_width: number;
  frame_height: number;
  columns: number;
  rows: SpriteRowDef[];
}

export interface AssetManifest {
  version: number;
  tileset: TilesetManifest;
  spritesheet: SpritesheetManifest;
}

/** Default manifest matching current engine hardcoded values */
export const DEFAULT_ASSET_MANIFEST: AssetManifest = {
  version: 1,
  tileset: {
    tile_width: 16,
    tile_height: 16,
    columns: 8,
    rows: 3,
    slots: [
      { id: 0, label: "floor", group: "ground" },
      { id: 1, label: "wall", group: "wall" },
      { id: 2, label: "water_0", group: "water" },
      { id: 3, label: "water_1", group: "water" },
      { id: 4, label: "water_2", group: "water" },
      { id: 5, label: "lava_0", group: "lava" },
      { id: 6, label: "lava_1", group: "lava" },
      { id: 7, label: "lava_2", group: "lava" },
      { id: 8, label: "torch_0", group: "torch" },
      { id: 9, label: "torch_1", group: "torch" },
    ],
  },
  spritesheet: {
    frame_width: 128,
    frame_height: 128,
    columns: 4,
    rows: [
      { row: 0, label: "idle_S", state: "idle", direction: "S", frames: 4 },
      { row: 1, label: "idle_N", state: "idle", direction: "N", frames: 4 },
      { row: 2, label: "idle_E", state: "idle", direction: "E", frames: 4 },
      { row: 3, label: "idle_W", state: "idle", direction: "W", frames: 4 },
      { row: 4, label: "walk_S", state: "walk", direction: "S", frames: 4 },
      { row: 5, label: "walk_N", state: "walk", direction: "N", frames: 4 },
      { row: 6, label: "walk_E", state: "walk", direction: "E", frames: 4 },
      { row: 7, label: "walk_W", state: "walk", direction: "W", frames: 4 },
      { row: 8, label: "run_S", state: "run", direction: "S", frames: 4 },
      { row: 9, label: "run_N", state: "run", direction: "N", frames: 4 },
      { row: 10, label: "run_E", state: "run", direction: "E", frames: 4 },
      { row: 11, label: "run_W", state: "run", direction: "W", frames: 4 },
    ],
  },
};
