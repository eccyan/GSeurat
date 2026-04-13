// tools/packages/project-root/src/world.ts

export interface WorldChunk {
  grid: [number, number, number];
  ply_file: string;
  scene_file?: string;
}

export interface StreamingVolumeData {
  id: string;
  shape: 'box' | 'sphere';
  position: [number, number, number];
  half_extents?: [number, number, number];
  radius?: number;
  preload_target_ids: string[];
}

export interface WorldPortalData {
  id: string;
  position: [number, number, number];
  region_shape: 'box' | 'sphere';
  region_radius?: number;
  region_half_extents?: [number, number, number];
  target_instance_id: string;
  spawn_position?: [number, number, number];
  spawn_facing?: string;
}

export interface WorldManifest {
  version: 1;
  grid_cell_size: [number, number, number];
  chunks: WorldChunk[];
  streaming_volumes: StreamingVolumeData[];
  portals: WorldPortalData[];
}

export function chunkAabbMin(
  grid: [number, number, number],
  cellSize: [number, number, number],
): [number, number, number] {
  return [grid[0] * cellSize[0], grid[1] * cellSize[1], grid[2] * cellSize[2]];
}

export function chunkAabbMax(
  grid: [number, number, number],
  cellSize: [number, number, number],
): [number, number, number] {
  const min = chunkAabbMin(grid, cellSize);
  return [min[0] + cellSize[0], min[1] + cellSize[1], min[2] + cellSize[2]];
}

export function chunkGridKey(grid: [number, number, number]): string {
  return `${grid[0]},${grid[1]},${grid[2]}`;
}

export function parseGridKey(key: string): [number, number, number] {
  const parts = key.split(',').map(Number);
  return [parts[0], parts[1], parts[2]];
}

export function createEmptyManifest(): WorldManifest {
  return {
    version: 1,
    grid_cell_size: [64, 32, 64],
    chunks: [],
    streaming_volumes: [],
    portals: [],
  };
}
