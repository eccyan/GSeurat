// @gseurat/debug-dump — On-demand self-reporting debug system
export type {
  AdsrPhase,
  AdsrState,
  Bounds,
  DebugDomain,
  DebugDumpEnvelope,
  DebugDumpSource,
  EarsDump,
  EarsGlobalState,
  EarsStemState,
  EarsTrackGroupState,
  EarsVoiceState,
  EyesComponentNode,
  EyesDump,
  EyesLayout,
  EyesState,
  EyesWarning,
  IDebugDumpable,
  TrackGroupStatus,
} from "./types.js";

export {
  DebugDumpRegistry,
  installDebugDumpGlobal,
  installDebugDumpKeyboard,
} from "./registry.js";
