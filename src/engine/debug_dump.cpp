#include "gseurat/engine/debug_dump.hpp"

// ── Concrete example implementations ──
// These demonstrate how existing engine subsystems integrate with
// the IDebugDumpable concept. Each satisfies DebugDumpable without
// inheriting from a base class — concept-based polymorphism.

// ---------------------------------------------------------------------------
// Example 1: DevOverlayDumper — "Eyes" domain
// Wraps DevOverlay panels into EyesComponentNode JSON.
// ---------------------------------------------------------------------------
//
// In staging_state.cpp on_enter():
//
//   DevOverlayDumper overlay_dumper{app.dev_overlay()};
//   app.debug_dump_registry().register_module(&overlay_dumper);
//
// The dump reports each registered ImGui panel's position, size,
// visibility, and warns if a panel is off-screen.

// ---------------------------------------------------------------------------
// Example 2: AudioEngineDumper — "Ears" domain
// Wraps AudioEngine + Mixer internal state into EarsDump JSON.
// ---------------------------------------------------------------------------
//
// In app_base.cpp after audio init:
//
//   AudioEngineDumper audio_dumper{*audio_engine_, mixer_};
//   debug_dump_registry_.register_module(&audio_dumper);
//
// The dump reads Mixer state (game-thread safe — voice/group data is
// only read, never mutated by this path). Asset refs come from
// TrackGroupRegistryEntry::metadata.stems[i].source_path (zero-copy
// string_view at point of JSON serialization).

namespace gseurat {

// This file is intentionally minimal — it exists to ensure the
// translation unit is compiled and the header is validated.
// The registry is header-only (template + inline).
//
// Concrete dumper classes are defined next to the subsystems they
// wrap (e.g., staging_state.cpp, audio_engine.cpp) to keep
// dependencies local.

}  // namespace gseurat
