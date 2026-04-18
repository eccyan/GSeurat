import JSZip from 'jszip';
import { useSceneStore, BUILTIN_SCHEMAS } from '../store/useSceneStore.js';
import { useWorldStore } from '../store/useWorldStore.js';
import { exportSceneJson } from './sceneExport.js';
import { exportPly } from './plyExport.js';
import type { BricklayerFile, ComponentSchema } from '../store/types.js';
import type { WorldManifest } from '@gseurat/project-root';
import {
  PROJECT_LAYOUT,
  toAssetPath,
  ensureSubdir,
  writeFileAtPath,
  readFileAtPath,
} from '@gseurat/project-root';

/**
 * Check if the File System Access API is available.
 */
export function hasFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/**
 * Open a project directory and set it as the project handle.
 */
export async function openProjectDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!hasFileSystemAccess()) return null;
  try {
    const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
    return handle;
  } catch {
    return null; // user cancelled
  }
}

/* ----- path builders ----- */

/**
 * Slugify a name into a stable filename fragment.
 * Same rules as echidna/melies — lowercase, trim, whitespace → underscore,
 * strip [^a-z0-9_-], fallback if empty.
 */
function slugify(name: string, fallback = 'project'): string {
  const cleaned = name.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '');
  return cleaned.length > 0 ? cleaned : fallback;
}

/** Returns the project-relative path for the Bricklayer save file. */
export function bricklayerSavePath(): string {
  // If editing a specific chunk/instance, save to its named file
  const ctx = useWorldStore.getState().editingContext;
  if (ctx) {
    const sceneName = ctx.sceneFile.split('/').pop()?.replace('.json', '') ?? 'scene';
    return `${PROJECT_LAYOUT.toolsData.bricklayer}/${sceneName}.bricklayer`;
  }
  return `${PROJECT_LAYOUT.toolsData.bricklayer}/scene.bricklayer`;
}

/** Returns the project-relative path for the engine scene JSON. */
export function engineScenePath(projectName: string): string {
  return toAssetPath('scenes', `${slugify(projectName)}.json`);
}

/** Returns the project-relative path for the terrain PLY. */
export function terrainPlyPath(projectName: string): string {
  return toAssetPath('maps', `${slugify(projectName)}.ply`);
}

/** Returns the project-relative path for a VFX preset file. */
export function vfxPresetPath(presetName: string): string {
  return `${PROJECT_LAYOUT.assets.vfxPresets}/${slugify(presetName, 'preset')}.vfx.json`;
}

/**
 * Save the current project to the project directory.
 *
 * New structure (Phase 0):
 * <project-root>/
 * ├── tools_data/bricklayer/scene.bricklayer   # Bricklayer save file
 * ├── assets/scenes/{slug}.json                # engine scene JSON
 * ├── assets/maps/{slug}.ply                   # terrain PLY
 * ├── assets/vfx/presets/{slug}.vfx.json       # VFX instance presets
 * └── assets/**                                # imported asset blobs
 */
export async function saveProject(handle: FileSystemDirectoryHandle): Promise<void> {
  const store = useSceneStore.getState();
  const projectName = store.projectName || 'project';

  // 1. Bricklayer save file under tools_data/bricklayer/
  const data = store.saveProject();
  const json = JSON.stringify(data, null, 2);
  await ensureSubdir(handle, PROJECT_LAYOUT.toolsData.bricklayer);
  await writeFileAtPath(handle, bricklayerSavePath(), json);

  // 2. Engine scene JSON under assets/scenes/
  const sceneJson = JSON.stringify(exportSceneJson(store), null, 2);
  await ensureSubdir(handle, PROJECT_LAYOUT.assets.scenes);
  await writeFileAtPath(handle, engineScenePath(projectName), sceneJson);

  // 3. Terrain PLY under assets/maps/
  if (store.voxels.size > 0) {
    const plyBlob = exportPly(store.voxels, store.gridWidth, store.gridDepth);
    await ensureSubdir(handle, PROJECT_LAYOUT.assets.maps);
    await writeFileAtPath(handle, terrainPlyPath(projectName), plyBlob);
  }

  // 4. Asset blobs from assetBlobs Map (paths already under assets/)
  if (store.assetBlobs.size > 0) {
    for (const [path, blob] of store.assetBlobs) {
      // Only write paths that are under assets/ for safety
      if (!path.startsWith('assets/')) continue;
      await writeFileAtPath(handle, path, blob);
    }
  }

  // 5. World manifest (world.json)
  const worldStore = useWorldStore.getState();
  // Sync asset_registry from scene store to world manifest before saving
  worldStore.setAssetRegistry(store.asset_registry);
  if (worldStore.loaded) {
    const worldJson = JSON.stringify(worldStore.saveManifest(), null, 2);
    await writeFileAtPath(handle, 'world.json', worldJson);
  }

  // 6. VFX instance preset files under assets/vfx/presets/
  if (store.vfxInstances.length > 0) {
    await ensureSubdir(handle, PROJECT_LAYOUT.assets.vfxPresets);
    for (const inst of store.vfxInstances) {
      // Re-serialize the preset data (applies any name edits)
      const out: Record<string, unknown> = {
        name: inst.name,
        elements: inst.vfx_preset.elements,
      };
      if (inst.vfx_preset.duration !== undefined) out.duration = inst.vfx_preset.duration;
      if (inst.vfx_preset.category) out.category = inst.vfx_preset.category;
      const vfxJson = JSON.stringify(out, null, 2);
      const newPath = vfxPresetPath(inst.name);
      await writeFileAtPath(handle, newPath, vfxJson);
      // Update vfx_file path if name/path changed
      if (inst.vfx_file !== newPath) {
        store.updateVfxInstance(inst.id, { vfx_file: newPath });
      }
    }
  }
}

/**
 * Load a project from the project directory.
 * Reads from tools_data/bricklayer/scene.bricklayer (new layout).
 * Falls back to root-level scene.bricklayer for back-compat with old saves.
 */
export async function loadProject(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    let text: string;
    try {
      // New path: tools_data/bricklayer/scene.bricklayer
      const blob = await readFileAtPath(handle, bricklayerSavePath());
      text = await blob.text();
    } catch {
      // Legacy fallback: root-level scene.bricklayer
      console.warn('[bricklayer] No scene.bricklayer at new path, falling back to legacy root');
      const fh = await handle.getFileHandle('scene.bricklayer');
      const legacy = await fh.getFile();
      text = await legacy.text();
    }
    const data = JSON.parse(text) as BricklayerFile;
    useSceneStore.getState().loadProject(data);

    // Load component schemas from project
    try {
      const assetsDir = await handle.getDirectoryHandle('assets').catch(() => null);
      const componentsDir = assetsDir ? await assetsDir.getDirectoryHandle('components').catch(() => null) : null;
      if (componentsDir) {
        const schemas: ComponentSchema[] = [];
        for await (const entry of (componentsDir as any).values()) {
          if (entry.kind === 'file' && entry.name.endsWith('.schema.json')) {
            const schemaFile = await entry.getFile();
            const schemaText = await schemaFile.text();
            try { schemas.push(JSON.parse(schemaText)); } catch {}
          }
        }
        if (schemas.length > 0) {
          useSceneStore.getState().loadComponentSchemas(schemas);
        } else {
          useSceneStore.getState().loadComponentSchemas(BUILTIN_SCHEMAS);
        }
      } else {
        useSceneStore.getState().loadComponentSchemas(BUILTIN_SCHEMAS);
      }
    } catch {
      useSceneStore.getState().loadComponentSchemas(BUILTIN_SCHEMAS);
    }

    // Load world manifest (world.json) if present
    try {
      const blob = await readFileAtPath(handle, 'world.json');
      const worldText = await blob.text();
      const worldData = JSON.parse(worldText) as WorldManifest;
      useWorldStore.getState().loadManifest(worldData);
      // Sync asset_registry from world manifest back to scene store if present
      const loadedWorld = useWorldStore.getState();
      if (loadedWorld.loaded && loadedWorld.manifest.asset_registry) {
        useSceneStore.getState().setAssetRegistry(loadedWorld.manifest.asset_registry);
      }
    } catch {
      // No world.json — start with empty world (default)
    }

    return true;
  } catch (err) {
    console.error('Failed to load project:', err);
    return false;
  }
}

/**
 * Switch to editing a different scene within the project.
 * Reads the .bricklayer file associated with the given scene_file path.
 * Falls back to loading the engine scene JSON directly if no .bricklayer exists.
 *
 * @param handle - The project directory handle
 * @param sceneFile - Path like "assets/scenes/seurat_island.json"
 * @returns true if scene was loaded successfully
 */
export async function switchScene(
  handle: FileSystemDirectoryHandle,
  sceneFile: string,
): Promise<boolean> {
  if (!sceneFile) {
    console.warn('[bricklayer] No scene_file specified for context switch');
    return false;
  }

  // Check for unsaved changes and prompt
  const sceneStore = useSceneStore.getState();
  if (sceneStore.isDirty) {
    const save = window.confirm(
      'You have unsaved changes. Save before switching scenes?'
    );
    if (save) {
      await saveProject(handle);
      sceneStore.markClean();
    }
  }

  // Derive the .bricklayer path from the scene file path
  // e.g., "assets/scenes/seurat_island.json" → "tools_data/bricklayer/seurat_island.bricklayer"
  const sceneName = sceneFile.split('/').pop()?.replace('.json', '') ?? 'scene';
  const bricklayerPath = `${PROJECT_LAYOUT.toolsData.bricklayer}/${sceneName}.bricklayer`;

  try {
    // Try loading .bricklayer file first
    const blob = await readFileAtPath(handle, bricklayerPath);
    const text = await blob.text();
    const data = JSON.parse(text) as BricklayerFile;
    sceneStore.loadProject(data);
    console.info(`[bricklayer] Switched to scene: ${bricklayerPath}`);
    return true;
  } catch {
    // No .bricklayer file — create a new empty scene for editing
    console.warn(`[bricklayer] No .bricklayer at ${bricklayerPath}, creating empty scene for: ${sceneFile}`);
    const worldReg = useWorldStore.getState().manifest.asset_registry;
    sceneStore.loadProject({
      version: 2,
      asset_registry: worldReg ?? { version: 1, characters: {}, vfx: {}, textures: {}, audio: {}, maps: {}, objects: {} },
      gridWidth: 64,
      gridDepth: 64,
      voxels: [],
      collision: [],
      scene: {
        ambientColor: [0.3, 0.3, 0.4, 1],
        staticLights: [],
        gameObjects: [],
        player: { position: [32, 0, 32], tint: [1, 1, 1, 1], facing: 'down', character_id: '' },
        backgroundLayers: [],
        torchEmitter: { spawn_rate: 0, particle_lifetime_min: 0, particle_lifetime_max: 0, velocity_min: [0, 0], velocity_max: [0, 0], acceleration: [0, 0], size_min: 0, size_max: 0, size_end_scale: 0, color_start: [0, 0, 0, 0], color_end: [0, 0, 0, 0], tile: '', z: 0, spawn_offset_min: [0, 0], spawn_offset_max: [0, 0] },
        torchPositions: [],
        footstepEmitter: { spawn_rate: 0, particle_lifetime_min: 0, particle_lifetime_max: 0, velocity_min: [0, 0], velocity_max: [0, 0], acceleration: [0, 0], size_min: 0, size_max: 0, size_end_scale: 0, color_start: [0, 0, 0, 0], color_end: [0, 0, 0, 0], tile: '', z: 0, spawn_offset_min: [0, 0], spawn_offset_max: [0, 0] },
        npcAuraEmitter: { spawn_rate: 0, particle_lifetime_min: 0, particle_lifetime_max: 0, velocity_min: [0, 0], velocity_max: [0, 0], acceleration: [0, 0], size_min: 0, size_max: 0, size_end_scale: 0, color_start: [0, 0, 0, 0], color_end: [0, 0, 0, 0], tile: '', z: 0, spawn_offset_min: [0, 0], spawn_offset_max: [0, 0] },
        weather: { enabled: false, type: 'rain', emitter: { spawn_rate: 0, particle_lifetime_min: 0, particle_lifetime_max: 0, velocity_min: [0, 0], velocity_max: [0, 0], acceleration: [0, 0], size_min: 0, size_max: 0, size_end_scale: 0, color_start: [0, 0, 0, 0], color_end: [0, 0, 0, 0], tile: '', z: 0, spawn_offset_min: [0, 0], spawn_offset_max: [0, 0] }, ambient_override: [0, 0, 0, 0], fog_density: 0, fog_color: [0, 0, 0], transition_speed: 0 },
        dayNight: { enabled: false, cycle_speed: 1, initial_time: 0, keyframes: [] },
        gaussianSplat: { camera: { position: [0, 10, 20], target: [0, 0, 0], fov: 45 }, render_width: 1920, render_height: 1080, scale_multiplier: 1, background_image: '', parallax: { azimuth_range: 30, elevation_min: -10, elevation_max: 20, distance_range: 5, parallax_strength: 1 }, morphPairPly: '', morphDuration: 2, morphDefaultBlend: 0, morphEasing: 'linear' },
      },
    });
    return true;
  }
}

/**
 * Import an engine scene JSON file and convert it to BricklayerFile format.
 * This reads a file like "assets/scenes/northern_forest.json" (snake_case engine format)
 * and converts it to BricklayerFile (camelCase) for editing in Bricklayer.
 *
 * @param handle - The project directory handle
 * @param sceneFile - Path like "assets/scenes/northern_forest.json"
 * @returns true if import succeeded
 */
export async function importEngineScene(
  handle: FileSystemDirectoryHandle,
  sceneFile: string,
): Promise<boolean> {
  if (!sceneFile) return false;

  try {
    const blob = await readFileAtPath(handle, sceneFile);
    const text = await blob.text();
    const engine = JSON.parse(text);

    const worldReg = useWorldStore.getState().manifest.asset_registry;

    // Default emitter config (empty)
    const emptyEmitter = {
      spawn_rate: 0, particle_lifetime_min: 0, particle_lifetime_max: 0,
      velocity_min: [0, 0] as [number, number], velocity_max: [0, 0] as [number, number],
      acceleration: [0, 0] as [number, number],
      size_min: 0, size_max: 0, size_end_scale: 0,
      color_start: [0, 0, 0, 0] as [number, number, number, number],
      color_end: [0, 0, 0, 0] as [number, number, number, number],
      tile: '', z: 0,
      spawn_offset_min: [0, 0] as [number, number], spawn_offset_max: [0, 0] as [number, number],
    };

    // Convert lights: engine lights have no id, add one
    const staticLights = (engine.lights ?? []).map((l: any, i: number) => ({
      id: l.id ?? `light_${i}`,
      position: l.position ?? [0, 0, 0],
      radius: l.radius ?? 10,
      color: l.color ?? [1, 1, 1],
      intensity: l.intensity ?? 1,
      ...(l.direction ? { direction: l.direction } : {}),
      ...(l.cone_angle ? { cone_angle: l.cone_angle } : {}),
    }));

    // Convert game objects: engine format is very similar
    const gameObjects = (engine.game_objects ?? []).map((go: any) => ({
      id: go.id ?? `go_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: go.name ?? go.id ?? 'Object',
      position: go.position ?? [0, 0, 0],
      rotation: go.rotation ?? [0, 0, 0],
      scale: go.scale ?? 1,
      ply_file: go.ply_file ?? '',
      components: go.components ?? {},
      ...(go.pbd ? { pbd: go.pbd } : {}),
    }));

    // Convert particle emitters: engine has minimal format, expand to full GsParticleEmitterData
    const gsParticleEmitters = (engine.particle_emitters ?? []).map((pe: any, i: number) => ({
      id: pe.id ?? `emitter_${i}`,
      muted: false,
      preset: pe.preset ?? '',
      position: pe.position ?? [0, 0, 0],
      spawn_rate: pe.spawn_rate ?? 10,
      lifetime_min: pe.lifetime_min ?? 1,
      lifetime_max: pe.lifetime_max ?? 2,
      velocity_min: pe.velocity_min ?? [0, 0.5, 0],
      velocity_max: pe.velocity_max ?? [0, 1, 0],
      acceleration: pe.acceleration ?? [0, 0, 0],
      color_start: pe.color_start ?? [1, 1, 1],
      color_end: pe.color_end ?? [1, 1, 1],
      scale_min: pe.scale_min ?? [0.1, 0.1, 0.1],
      scale_max: pe.scale_max ?? [0.2, 0.2, 0.2],
      scale_end_factor: pe.scale_end_factor ?? 0,
      opacity_start: pe.opacity_start ?? 1,
      opacity_end: pe.opacity_end ?? 0,
      emission: pe.emission ?? 0,
      spawn_region: pe.spawn_region ?? { shape: 'sphere', radius: 0.5 },
      burst_duration: pe.burst_duration ?? 0,
    }));

    // Convert gaussian splat config
    const gsConfig = engine.gaussian_splat ?? {};
    const gaussianSplat = {
      camera: gsConfig.camera ?? { position: [0, 10, 20], target: [0, 0, 0], fov: 45 },
      render_width: gsConfig.render_width ?? 1920,
      render_height: gsConfig.render_height ?? 1080,
      scale_multiplier: gsConfig.scale_multiplier ?? 1,
      background_image: gsConfig.background_image ?? '',
      parallax: gsConfig.parallax ?? {
        azimuth_range: 30, elevation_min: -10, elevation_max: 20,
        distance_range: 5, parallax_strength: 1,
      },
      morphPairPly: '', morphDuration: 2, morphDefaultBlend: 0, morphEasing: 'linear' as const,
    };

    // Convert collision
    const collisionGridData = engine.collision ? {
      width: engine.collision.width,
      height: engine.collision.height,
      cell_size: engine.collision.cell_size,
      solid: engine.collision.solid ?? [],
      elevation: engine.collision.elevation ?? [],
      nav_zone: engine.collision.nav_zone ?? [],
    } : undefined;

    // Build BricklayerFile
    const bricklayerFile: BricklayerFile = {
      version: 2,
      asset_registry: worldReg ?? { version: 1, characters: {}, vfx: {}, textures: {}, audio: {}, maps: {}, objects: {} },
      gridWidth: engine.collision?.width ?? 64,
      gridDepth: engine.collision?.height ?? 64,
      voxels: [],
      collision: [],
      ...(collisionGridData ? { collisionGridData } : {}),
      scene: {
        ambientColor: engine.ambient_color ?? [0.3, 0.3, 0.4, 1],
        staticLights,
        gameObjects,
        player: {
          position: engine.player?.position ?? [32, 0, 32],
          tint: engine.player?.tint ?? [1, 1, 1, 1],
          facing: engine.player?.facing ?? 'down',
          character_id: engine.player?.character_id ?? '',
        },
        backgroundLayers: [],
        torchEmitter: emptyEmitter,
        torchPositions: engine.torch_audio_positions ?? [],
        footstepEmitter: emptyEmitter,
        npcAuraEmitter: emptyEmitter,
        weather: {
          enabled: false, type: 'rain', emitter: emptyEmitter,
          ambient_override: [0, 0, 0, 0], fog_density: 0, fog_color: [0, 0, 0], transition_speed: 0,
        },
        dayNight: { enabled: false, cycle_speed: 1, initial_time: 0, keyframes: [] },
        gaussianSplat,
        gsParticleEmitters: gsParticleEmitters.length > 0 ? gsParticleEmitters : undefined,
        vfxInstances: engine.vfx_instances ?? undefined,
        audioZones: engine.audio_zones ?? undefined,
      },
    };

    useSceneStore.getState().loadProject(bricklayerFile);
    console.info(`[bricklayer] Imported engine scene: ${sceneFile}`);
    return true;
  } catch (err) {
    console.error(`[bricklayer] Failed to import engine scene ${sceneFile}:`, err);
    return false;
  }
}

/**
 * Import an asset file into the project directory.
 */
export async function importAssetToProject(
  handle: FileSystemDirectoryHandle,
  file: File,
): Promise<string> {
  const assetsDir = await handle.getDirectoryHandle('assets', { create: true });
  const fileHandle = await assetsDir.getFileHandle(file.name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(file);
  await writable.close();
  return `assets/${file.name}`;
}

/**
 * Export the scene JSON to the project directory or download it.
 */
export function exportSceneJsonBlob(): Blob {
  const state = useSceneStore.getState();
  const scene = exportSceneJson(state);
  const json = JSON.stringify(scene, null, 2);
  return new Blob([json], { type: 'application/json' });
}

/**
 * Save the current project as a zip file (fallback for browsers without FSAPI).
 * Includes scene data and engine scene export.
 */
export async function saveProjectAsZip(): Promise<Blob> {
  const store = useSceneStore.getState();
  const data = store.saveProject();
  const zip = new JSZip();
  zip.file('scene.bricklayer', JSON.stringify(data, null, 2));

  // Include the engine scene export
  const scene = exportSceneJson(store);
  zip.file(`${store.projectName || 'scene'}.json`, JSON.stringify(scene, null, 2));

  // Include terrain PLY
  if (store.voxels.size > 0) {
    const plyBlob = exportPly(store.voxels, store.gridWidth, store.gridDepth);
    zip.file(`assets/maps/${store.projectName || 'map'}.ply`, plyBlob);
  }

  // Include all asset blobs (PLY files, textures, etc.)
  const assetsFolder = zip.folder('assets');
  for (const [path, blob] of store.assetBlobs) {
    const name = path.startsWith('assets/') ? path.slice(7) : path;
    assetsFolder!.file(name, blob);
  }

  return zip.generateAsync({ type: 'blob' });
}

/**
 * Load a project from a zip file (fallback for browsers without FSAPI).
 */
export async function loadProjectFromZip(file: File): Promise<boolean> {
  try {
    const zip = await JSZip.loadAsync(file);
    const sceneFile = zip.file('scene.bricklayer');
    if (!sceneFile) return false;
    const text = await sceneFile.async('text');
    const data = JSON.parse(text) as BricklayerFile;
    useSceneStore.getState().loadProject(data);

    // Restore asset blobs from zip
    const assetsFolder = zip.folder('assets');
    if (assetsFolder) {
      const store = useSceneStore.getState();
      assetsFolder.forEach((relativePath, zipEntry) => {
        if (!zipEntry.dir) {
          zipEntry.async('blob').then((blob) => {
            store.storeAssetBlob(`assets/${relativePath}`, blob);
          });
        }
      });
    }

    return true;
  } catch {
    return false;
  }
}
