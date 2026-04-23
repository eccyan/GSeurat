import type { IDebugDumpable, StoreDump } from '@gseurat/debug-dump';
import { useSceneStore } from '../store/useSceneStore.js';
import { useWorldStore } from '../store/useWorldStore.js';

/**
 * Bricklayer "store" domain dumper — snapshots SceneStore + WorldStore state.
 * Excludes non-serializable fields (FileSystemDirectoryHandle, Blob maps).
 * Zero cost until triggered via Ctrl+Shift+D or console.
 */
export class BricklayerStoreDumper implements IDebugDumpable {
  readonly debugDomain = 'store' as const;
  readonly debugName = 'BricklayerStores';

  dumpDebugState(): StoreDump {
    const scene = useSceneStore.getState();
    const world = useWorldStore.getState();

    const warnings: string[] = [];
    if (scene.isDirty) warnings.push('scene_dirty_unsaved');
    if (world.dirty) warnings.push('world_dirty_unsaved');
    if (!scene.bridgeConnectedPath) warnings.push('bridge_disconnected');

    return {
      store_name: 'BricklayerStores',
      state: {
        scene: {
          projectName: scene.projectName,
          bridgeConnectedPath: scene.bridgeConnectedPath,
          isDirty: scene.isDirty,
          lastSavedAt: scene.lastSavedAt,
          activeNode: scene.activeNode,
          selectedEntity: scene.selectedEntity,
          inspectorTab: scene.inspectorTab,
          selectedSettingsCategory: scene.selectedSettingsCategory,
          gridWidth: scene.gridWidth,
          gridDepth: scene.gridDepth,
          grabMode: scene.grabMode,
          grabAxisLock: scene.grabAxisLock,
          orbitLocked: scene.orbitLocked,
          editingSpline: scene.editingSpline,
          showGrid: scene.showGrid,
          showCollision: scene.showCollision,
          showGizmos: scene.showGizmos,
          showTerrainPly: scene.showTerrainPly,
          showObjectPly: scene.showObjectPly,
          stagingAutoSync: scene.stagingAutoSync,
          stagingCameraLock: scene.stagingCameraLock,
          cameraShowDebugVolumes: scene.cameraShowDebugVolumes,
          // Entity counts (not full arrays — avoids multi-KB dumps)
          counts: {
            gameObjects: scene.gameObjects.length,
            staticLights: scene.staticLights.length,
            gsParticleEmitters: scene.gsParticleEmitters.length,
            gsAnimations: scene.gsAnimations.length,
            vfxInstances: scene.vfxInstances.length,
            cameraVolumes: scene.cameraVolumes.length,
            cameraTriggers: scene.cameraTriggers.length,
            cameraRails: scene.cameraRails.length,
            audioZones: scene.audioZones.length,
            backgroundLayers: scene.backgroundLayers.length,
            assets: scene.assets.length,
            navZoneNames: scene.navZoneNames.length,
          },
          player: scene.player,
          ambientColor: scene.ambientColor,
          godRaysIntensity: scene.godRaysIntensity,
          terrainPlyFile: scene.terrainPlyFile,
          weather: { enabled: scene.weather.enabled, type: scene.weather.type },
          dayNight: { enabled: scene.dayNight.enabled },
        },
        world: {
          loaded: world.loaded,
          dirty: world.dirty,
          selectedEntity: world.selectedEntity,
          editingChunkGrid: world.editingChunkGrid,
          editingContext: world.editingContext,
          counts: {
            chunks: world.manifest.chunks.length,
            streamingVolumes: world.manifest.streaming_volumes?.length ?? 0,
            instances: world.manifest.instances?.length ?? 0,
            portals: world.manifest.portals?.length ?? 0,
          },
        },
      },
      warnings,
    };
  }
}
