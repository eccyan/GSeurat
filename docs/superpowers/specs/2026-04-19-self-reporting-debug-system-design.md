# Self-Reporting Debug System Design

**Date:** 2026-04-19
**Status:** Approved
**Scope:** C++23 Engine + TypeScript Tools (cross-cutting)

## Problem

The AI assistant lacks visual/auditory perception. Communicating UI layout bugs or audio anomalies requires manual description, which is error-prone and slow. A structured, on-demand debug dump system enables any module to serialize its internal state as AI-readable JSON.

## Architecture: Registry Pull

A central `DebugDumpRegistry` holds references to all reportable modules. On explicit request, it iterates and calls `dump_debug_state()` on each. Zero runtime cost — no polling, no background threads.

### C++ Trigger Flow

```
F12 key or control_server "debug_dump" command
  → CommandDispatcher handler
    → DebugDumpRegistry::collect_all()
      → iterate registered IDebugDumpable* modules
        → each returns nlohmann::json
    → assemble envelope { version, timestamp, source, eyes, ears }
    → return via CommandResult (JSON over socket)
```

### TypeScript Trigger Flow

```
Ctrl+Shift+D or window.__DEBUG_DUMP__()
  → DebugDumpRegistry.collectAll()
    → iterate registered IDebugDumpable modules
      → each returns DebugDumpNode
    → assemble envelope
    → copy to clipboard + console.log
```

## JSON Schema

### Top-Level Envelope

```jsonc
{
  "version": 1,
  "timestamp_ms": 1713520000000,
  "source": "staging" | "bricklayer" | "weaver" | "echidna" | "melies",
  "eyes": {
    "components": [/* recursive tree */]
  },
  "ears": {
    "global": { /* master state */ },
    "track_groups": [ /* active groups */ ],
    "voices": [ /* oneshot/spatial voices */ ],
    "warnings": [ /* allocation failures, priority muting */ ]
  }
}
```

### Eyes Component Node

```jsonc
{
  "id": "scene-panel-0x7fa3",
  "type": "Panel" | "Widget" | "Viewport",
  "class_name": "ScenePropertiesPanel",
  "layout": {
    "local_bounds": { "x": 0, "y": 0, "w": 320, "h": 600 },
    "global_bounds": { "x": 800, "y": 40, "w": 320, "h": 600 },
    "z_index": 5
  },
  "state": {
    "visible": true,
    "focused": false,
    "enabled": true
  },
  "warnings": [],
  "children": []
}
```

Warning values: `"clipped_by_parent"`, `"off_screen_negative"`, `"zero_size"`.

### Ears Global State

```jsonc
{
  "global": {
    "master_volume": 0.8,
    "sample_rate": 48000,
    "max_polyphony": 32,
    "active_voice_count": 7,
    "active_group_count": 2,
    "dropped_commands": 0
  }
}
```

### Ears Track Group

```jsonc
{
  "group_id": 3,
  "status": "Playing" | "Idle" | "CrossfadingOut" | "AwaitingTransition",
  "play_cursor_frames": 441000,
  "loop_start": 0,
  "loop_end": 882000,
  "group_volume": 0.9,
  "stems": [{
    "index": 0,
    "asset_ref": "assets/audio/field/stems/melody.gsvx",
    "volume": 1.0,
    "adsr": null
  }]
}
```

### Ears Voice (Oneshot/Spatial)

```jsonc
{
  "pool_index": 2,
  "generation": 5,
  "asset_ref": "assets/audio/sfx/footstep.wav",
  "volume": 0.6,
  "spatial": true,
  "looping": false,
  "position": [12.5, 0.0, -3.2],
  "max_distance": 15.0,
  "play_cursor_frames": 2048,
  "adsr": null
}
```

### ADSR Envelope (future — replaces null)

```jsonc
{
  "phase": "attack" | "decay" | "sustain" | "release",
  "attack_ms": 10,
  "decay_ms": 50,
  "sustain_level": 0.7,
  "release_ms": 120,
  "current_level": 0.85,
  "elapsed_in_phase_ms": 12.3
}
```

## File Placement

### C++ Engine

| File | Purpose |
|------|---------|
| `include/gseurat/engine/debug_dump.hpp` | `IDebugDumpable` concept, `DebugDumpRegistry`, schema types |
| `src/engine/debug_dump.cpp` | Registry implementation, envelope assembly |
| `app_base.hpp` integration | Add `DebugDumpRegistry& debug_dump_registry()` accessor |
| `command_dispatcher.cpp` integration | Register `debug_dump` command |

### TypeScript Tools

| File | Purpose |
|------|---------|
| `tools/packages/debug-dump/src/types.ts` | `IDebugDumpable` interface, schema types |
| `tools/packages/debug-dump/src/registry.ts` | `DebugDumpRegistry` singleton |
| `tools/packages/debug-dump/src/index.ts` | Barrel export |
| `tools/packages/debug-dump/package.json` | Package config |

## Design Decisions

1. **On-demand only.** No background polling, no periodic snapshots. State gathering and JSON serialization happen exclusively when triggered.
2. **Registry Pull over Visitor/Event.** Aligns with existing `DevOverlay::register_panel()` and `CommandDispatcher` patterns. Modules own their dump logic.
3. **`std::optional` ADSR.** The ADSR field is nullable from day one. Current `SlewLimiter` voices report `null`. When the SPC700 envelope generator lands, it populates the struct — no schema migration needed.
4. **Zero-copy asset refs.** C++ reports `std::string_view` asset paths (converted to JSON string at serialization time only). No copies during normal runtime.
5. **Symmetric interface.** Both C++ and TS implement the same `IDebugDumpable` contract with the same JSON output shape, enabling unified tooling.
6. **Domain tags.** Each dumpable declares its domain (`"eyes"` or `"ears"`) so the registry can partition the output automatically.
