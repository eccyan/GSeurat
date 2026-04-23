import type { IDebugDumpable, StoreDump } from '@gseurat/debug-dump';
import { useCharacterStore } from '../store/useCharacterStore.js';

/**
 * Echidna "store" domain dumper — snapshots CharacterStore state.
 * Excludes non-serializable fields (FileSystemDirectoryHandle, undo/redo stacks).
 * Zero cost until triggered via Ctrl+Shift+D or console.
 */
export class EchidnaStoreDumper implements IDebugDumpable {
  readonly debugDomain = 'store' as const;
  readonly debugName = 'EchidnaCharacterStore';

  dumpDebugState(): StoreDump {
    const s = useCharacterStore.getState();

    const warnings: string[] = [];
    if (s.dirty) warnings.push('dirty_unsaved');
    if (s.undoStack.length > 50) warnings.push('undo_stack_deep');
    if (!s.asset) warnings.push('no_asset_loaded');

    return {
      store_name: 'CharacterStore',
      state: {
        mode: s.mode,
        dirty: s.dirty,
        activeTool: s.activeTool,
        activeColor: s.activeColor,
        brushSize: s.brushSize,
        activePaletteIndex: s.activePaletteIndex,
        selectedPart: s.selectedPart,
        selectedPose: s.selectedPose,
        previewPose: s.previewPose,
        showGrid: s.showGrid,
        showGizmos: s.showGizmos,
        yClip: s.yClip,
        mirrorAxis: s.mirrorAxis,
        colorByPart: s.colorByPart,
        xrayMode: s.xrayMode,
        yLevelLock: s.yLevelLock,
        onionSkinning: s.onionSkinning,
        selectedAnimation: s.selectedAnimation,
        playbackTime: s.playbackTime,
        isPlaying: s.isPlaying,
        playbackSpeed: s.playbackSpeed,
        playbackMode: s.playbackMode,
        hasClipboard: s.clipboard !== null,
        hasBoxSelection: s.boxSelection !== null,
        hasLassoSelection: s.lassoSelection !== null,
        counts: {
          knownAssets: s.knownAssets.length,
          undoStack: s.undoStack.length,
          redoStack: s.redoStack.length,
          parts: s.asset?.characterParts?.length ?? 0,
          poses: Object.keys(s.asset?.characterPoses ?? {}).length,
          animations: Object.keys(s.asset?.animations ?? {}).length,
          voxels: s.asset?.voxels?.size ?? 0,
        },
        asset: s.asset
          ? {
              id: s.asset.id,
              kind: s.asset.kind,
              name: s.asset.characterName,
              gridWidth: s.asset.gridWidth,
              gridDepth: s.asset.gridDepth,
              partCount: s.asset.characterParts?.length ?? 0,
              poseCount: Object.keys(s.asset.characterPoses ?? {}).length,
              animationCount: Object.keys(s.asset.animations ?? {}).length,
              voxelCount: s.asset.voxels?.size ?? 0,
            }
          : null,
      },
      warnings,
    };
  }
}
