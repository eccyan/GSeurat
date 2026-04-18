# Weaver — Interactive Music Authoring Tool

Weaver is a web-based visual editor for GSeurat's interactive music engine. It replaces the legacy Audio Composer with a purpose-built tool for authoring `music_config.json` v2 — the data format that drives the engine's TrackGroups, loop boundaries, markers, and stem volumes.

Named "Weaver" because it weaves audio stems together into a cohesive musical tapestry.

## Quick Start

```bash
cd tools
pnpm install
pnpm --filter weaver dev
# Open http://localhost:5182
```

### First-time setup

1. **Open Project Root** — select your game project directory (e.g., `examples/island_demo/`)
2. **Create New Project** — give it a name (e.g., "island_demo")
3. **+ Add** a track group (e.g., "Field Theme")
4. **Import stems** — click the drop zone or use File > Import Stems
5. **Set loop points** — drag the green/red handles on the ruler
6. **Save** (Cmd+S) — saves to `tools_data/weaver/<name>.weaver`
7. **Export v2 JSON** — produces `music_config.json` for the engine

## Architecture

### Authoring Data vs. Runtime Data

Weaver separates editor state from engine runtime data, analogous to `.blend` -> `.gltf`:

| File | Purpose | Contains |
|------|---------|----------|
| `.weaver` (project file) | Authoring source of truth | All groups, editor-only state (muted, soloed, loop_enabled), stem paths |
| `music_config.json` v2 | Engine runtime asset | Clean track_groups array, no editor metadata |

The `.weaver` file is saved in `tools_data/weaver/` via the File System Access API. The `music_config.json` is a derived export artifact.

### Store Architecture

The Zustand store splits into **project-level** and **active-group** state:

- **Project-level** — `projectName`, `sampleRate`, `groups[]` (lightweight metadata for all groups), `dirty` flag
- **Active group** — one group's `stems[]` (with decoded `AudioBuffer` + `waveformPeaks`), `bpm`, `loopStart/End`, `markers[]`, transport state

Only one group is loaded in memory at a time. Switching groups calls `flushActiveGroup()` (writes live state back to `groups[]`), discards AudioBuffers, then decodes the new group's stems.

### Key Operations

| Operation | Flow |
|-----------|------|
| `switchGroup(id)` | flush current -> discard buffers -> decode new stems -> populate live state |
| `saveProject()` | flush -> serialize `{ version, name, sample_rate, groups }` -> write via FSAPI |
| `exportMusicConfig()` | flush -> map all groups -> strip editor fields -> download JSON |
| `addStem(file)` | decode audio -> compute peaks -> copy file to project dir -> add to live state |

## UI Layout

```
+----------------------------------------------------------+
|  Menu: [File] [Edit] [View]               Weaver project |
+----------------------------------------------------------+
|  Transport: [<<] [>] [Stop] [Loop] | 0:05.4 / 4:15.0    |
+----------+---------------------------+------------------+
|  Groups  |  Ruler (loop handles,     |  Group Metadata  |
|  * field |   markers, playhead)      |  Name / ID / BPM |
|  o dung. |---------------------------|  Sample Rate     |
|  o battl |  Lane 0: [waveform][M][S] |------------------|
|  [+][dup]|  Lane 1: [waveform][M][S] |  Markers         |
|  [del]   |  ...                      |  (sorted list)   |
|          |  [click to import stems]  |                  |
+----------+---------------------------+------------------+
```

### Menu Bar

- **File** — Save Project (Cmd+S), Import Stems, Export v2 JSON, Open in Staging, Open Project Root, Connect Bridge to Project Root
- **Edit** — Undo/Redo (planned)
- **View** — Zoom to Fit

### Transport Bar

- Rewind, Play/Stop, Loop toggle
- Time position display (MM:SS / total)
- Bar:Beat counter (derived from BPM)
- Frame number

### Timeline

- **Ruler** — beat-grid ticks, draggable loop handles (green start, red end), marker diamonds (Shift+click to add), playhead (click to seek)
- **Stem Lanes** — canvas waveform from pre-computed peaks, volume slider, Mute (M) / Solo (S) buttons, remove button
- **Drop Zone** — drag-and-drop or click to import audio files

### Sidebar

- **Group Metadata** — editable name, read-only ID, BPM input, read-only sample rate
- **Markers** — sorted by frame, click to seek, editable names, delete button

### Group Panel (left)

- Track group list with active indicator
- Add / Duplicate / Delete buttons
- Dirty-state dialog on switch (Save & Switch / Discard / Cancel)

## Staging Integration

### Open in Staging

Exports the music config and pushes it to the running staging app:

1. Writes `music_config.json` v2 to project assets dir via FSAPI
2. Sends `set_project_root` command to engine via bridge WebSocket
3. Sends `reload_music_config` command — engine loads stems and plays the first group

### Connect Bridge to Project Root

Prompts for the absolute disk path to the project root and POSTs it to the bridge REST API at `http://localhost:9101/api/project/root`.

## Playback

Web Audio API preview via `useAudioPlayer` hook:

- One `AudioBufferSourceNode` + `GainNode` per stem
- Loop support with configurable `loopStart` / `loopEnd` (converted from frames to seconds)
- Live mute/solo via gain node updates
- Live loop toggle via `source.loop` property updates
- Minimum loop region guard (4410 frames / ~100ms) to prevent Web Audio beep from tiny loops
- `requestAnimationFrame` playhead tracking with frame-accurate position

## File Format

### `.weaver` Project File (v1)

```json
{
  "version": 1,
  "name": "island_demo",
  "sample_rate": 44100,
  "groups": [
    {
      "id": "field-theme",
      "name": "Field Theme",
      "bpm": 120,
      "loop_start": 0,
      "loop_end": 352800,
      "loop_enabled": true,
      "markers": [{ "frame": 176400, "name": "chorus" }],
      "stems": [
        { "source": "assets/audio/field/bass.wav", "initial_volume": 0.8, "muted": false, "soloed": false },
        { "source": "assets/audio/field/melody.wav", "initial_volume": 1.0, "muted": false, "soloed": false }
      ]
    }
  ]
}
```

Editor-only fields (`loop_enabled`, `muted`, `soloed`) are stripped on export to `music_config.json`.

## File Layout

```
tools/apps/weaver/
  package.json               — @gseurat/weaver, port 5182
  vite.config.ts
  src/
    main.tsx
    App.tsx                  — project root restore, empty states, Cmd+S
    App.css                  — layout styles
    store/
      useWeaverStore.ts      — project + active-group Zustand store
    components/
      MenuBar.tsx            — File/Edit/View dropdown menus
      TransportBar.tsx       — playback controls + position display
      GroupPanel.tsx          — left panel wrapper for GroupSelector
      GroupSelector.tsx       — track group list + CRUD + dirty dialog
      TimelinePanel.tsx       — ruler + stem lanes + drop zone + zoom/pan
      Ruler.tsx              — beat ticks, loop handles, markers, playhead
      StemLane.tsx            — waveform canvas, volume, mute/solo
      Sidebar.tsx            — group metadata + marker list
      EmptyProjectState.tsx  — no-project-root / no-project screens
      DirtyDialog.tsx        — save/discard/cancel prompt
    hooks/
      useAudioPlayer.ts      — Web Audio playback with live updates
    lib/
      types.ts               — StemState, MarkerState
      projectTypes.ts        — WeaverProjectFile, WeaverGroupConfig
      projectFs.ts           — FSAPI: list/save/load projects, stem files
      slugify.ts             — group ID slug generation
      frameUtils.ts          — frame/pixel/time conversions
      waveformPeaks.ts       — AudioBuffer -> peak array downsampling
      exportConfig.ts        — multi-group music_config.json v2 export
      importConfig.ts        — stem decode + legacy v2 migration
```

## Dependencies

- `react` / `react-dom` ^18 — UI framework
- `zustand` ^4 — state management
- `@gseurat/project-root` — File System Access API helpers (shared with Echidna)
- `@gseurat/engine-client` — bridge WebSocket client (shared with Bricklayer)

## Design Specs

- [Phase 5: Weaver Design](docs/superpowers/specs/2026-04-18-audio-phase5-weaver-design.md)
- [Phase 6: Multi-Track Management](docs/superpowers/specs/2026-04-18-audio-phase6-multitrack-design.md)
