// tools/packages/project-root/src/world.ts

import type { AssetRegistry } from './registry';
import { createEmptyRegistry } from './registry';

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

export interface WorldInstance {
  id: string;
  display_name: string;
  scene_file: string;
}

export interface WorldPortal {
  id: string;
  display_name: string;
  position: [number, number, number];
  half_extents: [number, number, number];
  source_chunk: string;        // grid key "x,y,z" of the chunk this portal sits in
  target_instance: string;     // instance ID to teleport into
  target_spawn: [number, number, number]; // spawn point inside the target instance
}

export interface WorldManifest {
  version: 1;
  grid_cell_size: [number, number, number];
  asset_registry: AssetRegistry;
  start_instance?: string;  // instance ID to load on game start (for instance-only games with no chunks)
  chunks: WorldChunk[];
  instances: WorldInstance[];
  streaming_volumes: StreamingVolumeData[];
  portals: WorldPortal[];
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
    asset_registry: createEmptyRegistry(),
    chunks: [],
    instances: [],
    streaming_volumes: [],
    portals: [],
  };
}
