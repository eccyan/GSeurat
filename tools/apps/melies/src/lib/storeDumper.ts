import type { IDebugDumpable, StoreDump } from '@gseurat/debug-dump';
import { useVfxStore } from '../store/useVfxStore.js';

/**
 * Melies "store" domain dumper — snapshots VfxStore state.
 * Excludes non-serializable fields (FileSystemDirectoryHandle, PlyPoint arrays).
 * Zero cost until triggered via Ctrl+Shift+D or console.
 */
export class MeliesStoreDumper implements IDebugDumpable {
  readonly debugDomain = 'store' as const;
  readonly debugName = 'MeliesVfxStore';

  dumpDebugState(): StoreDump {
    const s = useVfxStore.getState();

    const warnings: string[] = [];
    if (s.isDirty) warnings.push('dirty_unsaved');
    if (s.soloLayerIds.length > 0) warnings.push('solo_active');
    if (s.presets.length === 0) warnings.push('no_presets');

    return {
      store_name: 'VfxStore',
      state: {
        projectName: s.projectName,
        isDirty: s.isDirty,
        selectedPresetId: s.selectedPresetId,
        selectedLayerId: s.selectedLayerId,
        selectedView: s.selectedView,
        showGizmos: s.showGizmos,
        showPointCloud: s.showPointCloud,
        stagingAutoSync: s.stagingAutoSync,
        playing: s.playing,
        playbackTime: s.playbackTime,
        mutedLayerIds: s.mutedLayerIds,
        soloLayerIds: s.soloLayerIds,
        activeSceneId: s.activeSceneId,
        counts: {
          presets: s.presets.length,
          layers: s.selectedPresetId
            ? (s.presets.find((p) => p.id === s.selectedPresetId)?.elements?.length ?? 0)
            : 0,
          scenes: s.scenes.length,
          scenePoints: s.scenePoints.length,
        },
      },
      warnings,
    };
  }
}
