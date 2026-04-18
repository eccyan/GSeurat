# Phase 5: Weaver — Interactive Music Authoring Tool — Design Spec

**Date:** 2026-04-18
**Status:** Design approved, ready for implementation planning
**Branch:** `feature/audio-phase5-weaver`
**Depends on:** Phases 1–4 (all merged)

---

## 1. Purpose and scope

Weaver is a new web-based authoring tool for GSeurat's interactive music engine.
It replaces the legacy Audio Composer (`tools/apps/audio-composer/`) with a
purpose-built visual editor for `music_config.json` v2 — the data format that
drives the engine's TrackGroups, loop boundaries, markers, and stem volumes.

Named "Weaver" because it weaves audio stems together into a cohesive musical
tapestry.

### In scope

- New React/TypeScript/Vite app at `tools/apps/weaver/`
- Delete `tools/apps/audio-composer/`
- Zustand store with all positions in **frames** (integers, never seconds)
- N-lane timeline (dynamic stem count, not hardcoded to 4)
- Canvas-based waveform rendering from pre-computed peaks
- Ruler with draggable loop handles + clickable/draggable markers + playhead
- Web Audio preview playback with per-stem volume and loop support
- Sidebar: group metadata (id, name, BPM, sample rate) + marker list
- `music_config.json` v2 export (pure serialization from store state)
- Import: load `.music.json` + decode referenced audio files
- Zoom/scroll via mouse wheel + pan

### Out of scope

- Multi-group tabbed editor (single group per file for MVP)
- AI generation / procedural loops (removed with Audio Composer)
- Engine bridge connection (Weaver is offline-first; engine preview is future)
- Transition preview between groups
- Ogg encoding (Weaver imports WAV/Ogg for preview; encoding is external tooling)

---

## 2. Architecture — deletion + new app

**Delete:** `tools/apps/audio-composer/` (entire directory)

**Create:** `tools/apps/weaver/` — standard pnpm monorepo app:
```
tools/apps/weaver/
  package.json
  tsconfig.json
  vite.config.ts
  index.html
  src/
    main.tsx
    App.tsx
    store/useWeaverStore.ts
    components/
      Toolbar.tsx
      TimelinePanel.tsx
      Ruler.tsx
      StemLane.tsx
      AddStemButton.tsx
      Sidebar.tsx
      GroupMetadata.tsx
      MarkerList.tsx
    hooks/useAudioPlayer.ts
    lib/
      frameUtils.ts          — frameToPixel, pixelToFrame, framesToSeconds
      waveformPeaks.ts       — downsample AudioBuffer to peaks array
      exportConfig.ts        — serialize store → music_config.json v2
      importConfig.ts        — parse v2 JSON + decode audio files
```

**Port:** 5182 (next available after Melies at 5181)

---

## 3. Zustand store

```typescript
interface WeaverStore {
  // Group metadata
  groupId: number;
  groupName: string;
  sampleRate: number;
  bpm: number;

  // Stems (dynamic count)
  stems: StemState[];
  addStem: (file: File) => Promise<void>;
  removeStem: (index: number) => void;
  setStemVolume: (index: number, volume: number) => void;

  // Loop points (frames)
  loopStart: number;
  loopEnd: number;
  setLoopStart: (frame: number) => void;
  setLoopEnd: (frame: number) => void;

  // Markers (frames)
  markers: MarkerState[];
  addMarker: (frame: number, name?: string) => void;
  removeMarker: (index: number) => void;
  updateMarker: (index: number, patch: Partial<MarkerState>) => void;
  moveMarker: (index: number, frame: number) => void;

  // Transport
  isPlaying: boolean;
  playheadFrame: number;
  play: () => void;
  stop: () => void;
  seek: (frame: number) => void;

  // Viewport
  viewStartFrame: number;
  viewEndFrame: number;
  zoom: (factor: number, anchorPx?: number) => void;
  scroll: (deltaFrames: number) => void;
  zoomToFit: () => void;

  // I/O
  exportMusicConfig: () => MusicConfigV2;
  loadFromJson: (json: MusicConfigV2, baseDir: string) => Promise<void>;
  importStemFile: (file: File) => Promise<void>;
}

interface StemState {
  fileName: string;
  sourcePath: string;        // relative path for export
  initialVolume: number;
  audioBuffer: AudioBuffer | null;
  waveformPeaks: Float32Array | null;  // ~1000 points, pre-computed
}

interface MarkerState {
  frame: number;
  name: string;
}
```

**All positions in frames.** Conversion to seconds is a view concern via
`framesToSeconds(frame, sampleRate)`. The only place seconds appear is the
Web Audio API boundary (`source.loopStart`, `source.loopEnd`).

---

## 4. UI components

### Layout

```
┌─────────────────────────────────────────────────────────┐
│  Toolbar: [Open] [Import Stems] [Play/Stop] [Export]    │
├──────────────────────────────────────────┬──────────────┤
│  Ruler                                  │  Sidebar     │
│  ├─ loop_start handle                   │  ┌──────────┐│
│  ├─ loop_end handle                     │  │ Group    ││
│  └─ marker flags + playhead             │  │ metadata ││
│─────────────────────────────────────────│  ├──────────┤│
│  Lane 0: [waveform] [vol] [×]          │  │ Markers  ││
│  Lane 1: [waveform] [vol] [×]          │  │ list     ││
│  ...N lanes (dynamic from stems[])      │  │          ││
│  [+ Add Stem]                           │  └──────────┘│
└──────────────────────────────────────────┴──────────────┘
```

### Ruler — the interaction hub

- **Time axis** — ticks at beat intervals (BPM + sample rate), labels in `bars:beats`
- **Loop handles** — draggable triangles at `loopStart` / `loopEnd`. Optional beat-snap.
- **Markers** — diamond icons. Click empty ruler area to add. Drag to move. Right-click to delete.
- **Playhead** — vertical line at `playheadFrame`. Click ruler to seek.
- All handles are absolute-positioned `<div>`s over the ruler canvas.

### StemLane — waveform + controls

- **Canvas** — draws `waveformPeaks` as mirrored amplitude. Re-renders on zoom/scroll.
- **Volume slider** — horizontal, 0–1, writes `initialVolume`.
- **Label** — file name.
- **Remove button** — deletes stem from store.

### Sidebar

- **GroupMetadata** — id (number), name (text), BPM (number), sample rate (number).
- **MarkerList** — sorted by frame. Each row: frame number, editable name, delete button. Click row to scroll timeline to marker.

### Frame ↔ pixel utilities

```typescript
function frameToPixel(frame: number, viewStart: number, viewEnd: number, width: number): number {
  return ((frame - viewStart) / (viewEnd - viewStart)) * width;
}
function pixelToFrame(px: number, viewStart: number, viewEnd: number, width: number): number {
  return Math.round(viewStart + (px / width) * (viewEnd - viewStart));
}
function framesToSeconds(frame: number, sampleRate: number): number {
  return frame / sampleRate;
}
```

---

## 5. Web Audio playback

A `useAudioPlayer` hook manages playback:

- `play()` — creates `AudioBufferSourceNode` per stem from `playheadFrame / sampleRate`.
  Sets per-stem `GainNode` from `initialVolume`. If loop enabled, sets
  `source.loop = true`, `source.loopStart`, `source.loopEnd` (converted from frames).
- `stop()` — stops all sources, captures playhead position.
- **Playhead animation** — `requestAnimationFrame` reads `audioContext.currentTime`,
  converts back to frames, updates `playheadFrame` in store.

**Frame → seconds conversion happens only here** — the Web Audio API boundary.

---

## 6. Import / Export

### Export (`exportConfig.ts`)

Pure function: serialize store → `music_config.json` v2:
```typescript
{
  version: 2,
  sample_rate: sampleRate,
  track_groups: [{
    id: groupId,
    name: groupName,
    loop_start: loopStart,
    loop_end: loopEnd,
    markers: markers.sort(byFrame).map(m => ({ frame: m.frame, name: m.name })),
    stems: stems.map(s => ({ source: s.sourcePath, initial_volume: s.initialVolume })),
  }],
}
```

Triggers browser file download as `<groupName>.music.json`.

### Import (`importConfig.ts`)

Load a `.music.json` via file picker or drag-drop:
1. Parse JSON, validate `version == 2`
2. For each stem, resolve `source` path relative to the JSON file
3. Fetch + decode each audio file via Web Audio `decodeAudioData`
4. Compute `waveformPeaks` for each stem
5. Populate store (group metadata, stems, markers, loop points)

### Stem import

"Import Stems" button or drag-drop audio files:
1. Read `File` via `FileReader` as `ArrayBuffer`
2. Decode via `audioContext.decodeAudioData`
3. Compute waveform peaks
4. Append to `stems[]` with `fileName` and default `initialVolume = 1.0`
5. `sourcePath` set to `assets/audio/<groupName>/<fileName>` (user can edit)

---

## 7. Waveform peak computation

```typescript
function computeWaveformPeaks(buffer: AudioBuffer, numBuckets: number = 1000): Float32Array {
  const data = buffer.getChannelData(0);  // mono or first channel
  const bucketSize = Math.ceil(data.length / numBuckets);
  const peaks = new Float32Array(numBuckets);
  for (let i = 0; i < numBuckets; i++) {
    let max = 0;
    const start = i * bucketSize;
    const end = Math.min(start + bucketSize, data.length);
    for (let j = start; j < end; j++) {
      const abs = Math.abs(data[j]);
      if (abs > max) max = abs;
    }
    peaks[i] = max;
  }
  return peaks;
}
```

Called once at import time. Canvas rendering reads from this array — never from
the full `AudioBuffer`. Recompute on zoom if higher resolution is needed (optional
optimization for Phase 6).

---

## 8. Zoom and scroll

- **Mouse wheel on timeline** — zoom in/out. Adjusts `viewStartFrame` / `viewEndFrame`
  symmetrically around cursor position (anchor zoom).
- **Middle-click drag or horizontal scroll** — pan. Shifts view window by delta frames.
- **Zoom-to-fit** button — sets `viewStartFrame = 0`, `viewEndFrame = maxStemLength`.
- Minimum zoom: 100 frames visible. Maximum zoom: entire file.

---

## 9. Testing

Weaver is a UI tool — primary testing is manual via browser. Automated tests
focus on the non-visual logic:

| # | Test | Method |
|---|---|---|
| 1 | Export produces valid v2 JSON | Unit test: populate store, call `exportMusicConfig()`, validate schema |
| 2 | Import round-trip | Unit test: export → import → export, assert identical JSON |
| 3 | `frameToPixel` / `pixelToFrame` | Unit test: known values, boundary conditions |
| 4 | `computeWaveformPeaks` | Unit test: known buffer → expected peaks |
| 5 | Marker sort order | Unit test: markers exported in ascending frame order |
| 6 | Vite build succeeds | CI: `pnpm --filter weaver build` |

---

## 10. Files

**New directory:** `tools/apps/weaver/` (~15 files)

**Deleted directory:** `tools/apps/audio-composer/` (entire)

**Modified:**
- `tools/pnpm-workspace.yaml` — if needed (apps are auto-discovered)
- `tools/apps/weaver/package.json` — `@gseurat/weaver`, port 5182

**Unchanged:** Engine code, Bricklayer, Echidna, Melies, schemas, C++ tests.

---

## 11. Decision log

| # | Decision | Rationale |
|---|---|---|
| 1 | Full rebuild as "Weaver", not patch | Old Audio Composer is v1-only; clean start avoids legacy |
| 2 | Delete audio-composer | One tool, not two; avoids monorepo confusion |
| 3 | Single-group editor | YAGNI; multi-group tabs are Phase 6 if needed |
| 4 | Pure React + Canvas | No Wavesurfer.js dependency; sample-frame precision; matches Echidna pattern |
| 5 | Dynamic N lanes | Future-proof; engine's kMaxStemsPerGroup may increase |
| 6 | All positions in frames | Prevents float rounding; seconds only at Web Audio boundary |
| 7 | Pre-computed waveform peaks | Canvas renders from ~1000 points, not millions |
| 8 | Export as pure serialization | Store → JSON with zero side effects; trivially testable |
