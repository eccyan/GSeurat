// ── Example implementations showing how tools integrate with the debug dump ──
// These are EXAMPLES — actual integration goes in each tool's source tree.

import type {
  EarsDump,
  EyesComponentNode,
  EyesWarning,
  IDebugDumpable,
} from "./types.js";

// ---------------------------------------------------------------------------
// Example 1: Bricklayer Scene Panel — "Eyes" domain
// Shows recursive UI tree gathering with layout warnings.
// ---------------------------------------------------------------------------

/**
 * Adapts a React component tree (backed by a Zustand store) to IDebugDumpable.
 *
 * Usage in Bricklayer's App.tsx:
 *
 *   const panelDumper = new BricklayerPanelDumper(() => getPanelTree());
 *   DebugDumpRegistry.getInstance().register(panelDumper);
 */
export class BricklayerPanelDumper implements IDebugDumpable {
  readonly debugDomain = "eyes" as const;
  readonly debugName = "BricklayerPanels";

  constructor(
    private readonly getPanelTree: () => PanelTreeNode[],
  ) {}

  dumpDebugState(): EyesComponentNode[] {
    return this.getPanelTree().map((node) => this.walkNode(node, null));
  }

  private walkNode(
    node: PanelTreeNode,
    parentGlobalBounds: { x: number; y: number; w: number; h: number } | null,
  ): EyesComponentNode {
    const globalX = (parentGlobalBounds?.x ?? 0) + node.localX;
    const globalY = (parentGlobalBounds?.y ?? 0) + node.localY;
    const globalBounds = { x: globalX, y: globalY, w: node.width, h: node.height };

    const warnings = detectWarnings(node, globalBounds, parentGlobalBounds);

    return {
      id: node.id,
      type: node.type,
      class_name: node.className,
      layout: {
        local_bounds: { x: node.localX, y: node.localY, w: node.width, h: node.height },
        global_bounds: globalBounds,
        z_index: node.zIndex,
      },
      state: {
        visible: node.visible,
        focused: node.focused,
        enabled: node.enabled,
      },
      warnings,
      children: (node.children ?? []).map((child) =>
        this.walkNode(child, globalBounds),
      ),
    };
  }
}

/** Minimal panel tree node — tools provide their own shape via the getter. */
export interface PanelTreeNode {
  id: string;
  type: string;
  className: string;
  localX: number;
  localY: number;
  width: number;
  height: number;
  zIndex: number;
  visible: boolean;
  focused: boolean;
  enabled: boolean;
  children?: PanelTreeNode[];
}

function detectWarnings(
  node: PanelTreeNode,
  globalBounds: { x: number; y: number; w: number; h: number },
  parentGlobalBounds: { x: number; y: number; w: number; h: number } | null,
): EyesWarning[] {
  const warnings: EyesWarning[] = [];

  if (node.width === 0 || node.height === 0) {
    warnings.push("zero_size");
  }

  if (globalBounds.x < 0 || globalBounds.y < 0) {
    warnings.push("off_screen_negative");
  }

  if (parentGlobalBounds) {
    const childRight = globalBounds.x + globalBounds.w;
    const childBottom = globalBounds.y + globalBounds.h;
    const parentRight = parentGlobalBounds.x + parentGlobalBounds.w;
    const parentBottom = parentGlobalBounds.y + parentGlobalBounds.h;

    const fullyClipped =
      globalBounds.x >= parentRight ||
      globalBounds.y >= parentBottom ||
      childRight <= parentGlobalBounds.x ||
      childBottom <= parentGlobalBounds.y;

    if (fullyClipped) {
      warnings.push("clipped_by_parent");
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Example 2: Weaver Audio Player — "Ears" domain
// Shows how to dump Web Audio API state as an EarsDump.
// ---------------------------------------------------------------------------

/**
 * Adapts Weaver's useAudioPlayer / useWeaverStore to IDebugDumpable.
 *
 * Usage in Weaver's App.tsx:
 *
 *   const audioDumper = new WeaverAudioDumper(() => useWeaverStore.getState());
 *   DebugDumpRegistry.getInstance().register(audioDumper);
 */
export class WeaverAudioDumper implements IDebugDumpable {
  readonly debugDomain = "ears" as const;
  readonly debugName = "WeaverAudioPlayer";

  constructor(
    private readonly getState: () => WeaverStoreSnapshot,
  ) {}

  dumpDebugState(): EarsDump {
    const state = this.getState();

    return {
      global: {
        master_volume: state.masterVolume ?? 1.0,
        sample_rate: state.sampleRate,
        max_polyphony: state.stems.length,  // Web Audio has no hard polyphony limit
        active_voice_count: state.stems.filter((s) => s.audioBuffer !== null).length,
        active_group_count: state.isPlaying ? 1 : 0,
        dropped_commands: 0,
      },
      track_groups: state.isPlaying
        ? [
            {
              group_id: 0,
              status: "Playing",
              play_cursor_frames: state.playheadFrame,
              loop_start: state.loopStart,
              loop_end: state.loopEnd,
              group_volume: state.masterVolume ?? 1.0,
              stems: state.stems
                .filter((s) => s.audioBuffer !== null)
                .map((s, i) => ({
                  index: i,
                  asset_ref: s.filePath ?? `stem-${i}`,
                  volume: s.muted ? 0 : s.initialVolume,
                  adsr: null,  // Web Audio has no ADSR — null until SPC700 lands
                })),
            },
          ]
        : [],
      voices: [],   // Weaver doesn't use oneshot voices
      warnings: [],
    };
  }
}

/** Minimal snapshot shape — matches useWeaverStore.getState() fields we need. */
export interface WeaverStoreSnapshot {
  isPlaying: boolean;
  playheadFrame: number;
  sampleRate: number;
  loopStart: number;
  loopEnd: number;
  masterVolume?: number;
  stems: Array<{
    audioBuffer: AudioBuffer | null;
    filePath?: string;
    initialVolume: number;
    muted: boolean;
    soloed: boolean;
  }>;
}
