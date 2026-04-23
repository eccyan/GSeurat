// ── Self-Reporting Debug Dump: Type Definitions ──
// Symmetric with C++23 IDebugDumpable concept in include/gseurat/engine/debug_dump.hpp

// ---------------------------------------------------------------------------
// Domain tag — partitions the dump into "eyes" (UI/layout) and "ears" (audio)
// ---------------------------------------------------------------------------

export type DebugDomain = "eyes" | "ears" | "store";

// ---------------------------------------------------------------------------
// Eyes (UI / Layout) schema
// ---------------------------------------------------------------------------

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type EyesWarning = "clipped_by_parent" | "off_screen_negative" | "zero_size";

export interface EyesLayout {
  local_bounds: Bounds;
  global_bounds: Bounds;
  z_index: number;
}

export interface EyesState {
  visible: boolean;
  focused: boolean;
  enabled: boolean;
}

export interface EyesComponentNode {
  id: string;
  type: string;
  class_name: string;
  layout: EyesLayout;
  state: EyesState;
  warnings: EyesWarning[];
  children: EyesComponentNode[];
}

export interface EyesDump {
  components: EyesComponentNode[];
}

// ---------------------------------------------------------------------------
// Ears (Audio / DSP) schema
// ---------------------------------------------------------------------------

export type AdsrPhase = "attack" | "decay" | "sustain" | "release";

export interface AdsrState {
  phase: AdsrPhase;
  attack_ms: number;
  decay_ms: number;
  sustain_level: number;
  release_ms: number;
  current_level: number;
  elapsed_in_phase_ms: number;
}

export interface EarsStemState {
  index: number;
  asset_ref: string;
  volume: number;
  adsr: AdsrState | null;
}

export type TrackGroupStatus = "Idle" | "Playing" | "CrossfadingOut" | "AwaitingTransition";

export interface EarsTrackGroupState {
  group_id: number;
  status: TrackGroupStatus;
  play_cursor_frames: number;
  loop_start: number;
  loop_end: number;
  group_volume: number;
  stems: EarsStemState[];
}

export interface EarsVoiceState {
  pool_index: number;
  generation: number;
  asset_ref: string;
  volume: number;
  spatial: boolean;
  looping: boolean;
  position: [number, number, number];
  max_distance: number;
  play_cursor_frames: number;
  adsr: AdsrState | null;
}

export interface EarsGlobalState {
  master_volume: number;
  sample_rate: number;
  max_polyphony: number;
  active_voice_count: number;
  active_group_count: number;
  dropped_commands: number;
}

export interface EarsDump {
  global: EarsGlobalState;
  track_groups: EarsTrackGroupState[];
  voices: EarsVoiceState[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Store (Application State) schema
// ---------------------------------------------------------------------------

export interface StoreDump {
  /** Name of the store (e.g. "SceneStore", "VfxStore"). */
  store_name: string;
  /** JSON-serializable snapshot of the store's state fields. */
  state: Record<string, unknown>;
  /** Optional warnings (e.g. "undo_stack_deep", "dirty_unsaved"). */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Core interface — every dumpable module implements this
// ---------------------------------------------------------------------------

export interface IDebugDumpable {
  /** Domain this module reports into. */
  readonly debugDomain: DebugDomain;

  /** Human-readable name shown in the dump (e.g. "ScenePropertiesPanel"). */
  readonly debugName: string;

  /**
   * Gather current state. Called ONLY on explicit request — never on a hot path.
   * Return the domain-specific payload.
   */
  dumpDebugState(): EyesComponentNode[] | EarsDump | StoreDump;
}

// ---------------------------------------------------------------------------
// Top-level envelope
// ---------------------------------------------------------------------------

export type DebugDumpSource =
  | "staging"
  | "bricklayer"
  | "echidna"
  | "melies"
  | "weaver"
  | "audio-composer";

export interface DebugDumpEnvelope {
  version: 1;
  timestamp_ms: number;
  source: DebugDumpSource;
  eyes: EyesDump;
  ears: EarsDump;
  store: StoreDump[];
}
