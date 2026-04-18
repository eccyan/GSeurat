# Phase 5: Weaver — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build "Weaver" — a new React/TS/Vite web app for visually authoring `music_config.json` v2, replacing the legacy Audio Composer with a timeline editor featuring canvas waveforms, draggable loop handles, marker placement, and Web Audio preview.

**Architecture:** Zustand store with all positions in frames (never seconds). Canvas-based waveform rendering from pre-computed peaks. Ruler component hosts draggable loop handles + markers + playhead. `useAudioPlayer` hook wraps Web Audio API. Export is pure serialization from store to v2 JSON.

**Tech Stack:** React 18, TypeScript, Vite, Zustand 4, Web Audio API, HTML Canvas. Follows the existing pnpm monorepo pattern (Bricklayer as template).

**Spec:** `docs/superpowers/specs/2026-04-18-audio-phase5-weaver-design.md`

---

## File Structure

**New directory:** `tools/apps/weaver/`
```
tools/apps/weaver/
  package.json
  tsconfig.json
  vite.config.ts
  index.html
  src/
    main.tsx
    App.tsx
    App.css
    store/useWeaverStore.ts
    components/
      Toolbar.tsx
      TimelinePanel.tsx
      Ruler.tsx
      StemLane.tsx
      Sidebar.tsx
    hooks/useAudioPlayer.ts
    lib/
      frameUtils.ts
      waveformPeaks.ts
      exportConfig.ts
      importConfig.ts
      types.ts
```

**Deleted directory:** `tools/apps/audio-composer/` (entire)

---

## Milestone 1 — Scaffold + store + utilities

### Task 1.1: Scaffold Weaver app + delete Audio Composer

**Files:**
- Delete: `tools/apps/audio-composer/` (entire directory)
- Create: `tools/apps/weaver/package.json`
- Create: `tools/apps/weaver/tsconfig.json`
- Create: `tools/apps/weaver/vite.config.ts`
- Create: `tools/apps/weaver/index.html`
- Create: `tools/apps/weaver/src/main.tsx`
- Create: `tools/apps/weaver/src/App.tsx`
- Create: `tools/apps/weaver/src/App.css`
- Create: `tools/apps/weaver/src/lib/types.ts`

- [ ] **Step 1: Delete audio-composer**

```bash
git rm -r tools/apps/audio-composer
```

- [ ] **Step 2: Create package.json**

Create `tools/apps/weaver/package.json`:
```json
{
  "name": "@gseurat/weaver",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "zustand": "^4.5.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.2.0",
    "typescript": "^5.4.0",
    "vite": "^5.4.0",
    "vitest": "^4.0.18"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

Create `tools/apps/weaver/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "outDir": "dist",
    "rootDir": "src",
    "resolveJsonModule": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create vite.config.ts**

Create `tools/apps/weaver/vite.config.ts`:
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  envDir: '../../',
  resolve: {
    conditions: ['source'],
  },
  server: {
    port: 5182,
  },
});
```

- [ ] **Step 5: Create index.html**

Create `tools/apps/weaver/index.html`:
```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Weaver — GSeurat Audio</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #1a1a2e; color: #e0e0e0; overflow: hidden; }
      html, body, #root { width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create types.ts**

Create `tools/apps/weaver/src/lib/types.ts`:
```typescript
export interface StemState {
  fileName: string;
  sourcePath: string;
  initialVolume: number;
  audioBuffer: AudioBuffer | null;
  waveformPeaks: Float32Array | null;
}

export interface MarkerState {
  frame: number;
  name: string;
}

export interface MusicConfigV2 {
  version: 2;
  sample_rate: number;
  track_groups: TrackGroupConfig[];
}

export interface TrackGroupConfig {
  id: number;
  name: string;
  loop_start: number;
  loop_end: number;
  bpm?: number;
  markers: { frame: number; name: string }[];
  stems: { source: string; initial_volume: number }[];
}
```

- [ ] **Step 7: Create main.tsx + App.tsx + App.css**

Create `tools/apps/weaver/src/main.tsx`:
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

Create `tools/apps/weaver/src/App.tsx`:
```tsx
import React from 'react';
import './App.css';

export function App() {
  return (
    <div className="weaver">
      <header className="weaver-toolbar">
        <span className="weaver-title">Weaver</span>
      </header>
      <main className="weaver-body">
        <div className="weaver-timeline">Timeline (coming soon)</div>
        <div className="weaver-sidebar">Sidebar (coming soon)</div>
      </main>
    </div>
  );
}
```

Create `tools/apps/weaver/src/App.css`:
```css
.weaver {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #1a1a2e;
  color: #e0e0e0;
}

.weaver-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: #16213e;
  border-bottom: 1px solid #333;
  flex-shrink: 0;
}

.weaver-title {
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 1px;
  color: #77aaff;
}

.weaver-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.weaver-timeline {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.weaver-sidebar {
  width: 280px;
  border-left: 1px solid #333;
  padding: 12px;
  overflow-y: auto;
  flex-shrink: 0;
}
```

- [ ] **Step 8: Install deps + verify dev server**

```bash
cd tools && pnpm install
cd apps/weaver && pnpm dev &
# Visit http://localhost:5182 — should show "Weaver" header + placeholder content
# Kill the dev server
```

- [ ] **Step 9: Verify tsc + vite build**

```bash
pnpm --filter weaver build
```

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "weaver: scaffold app + delete legacy audio-composer"
```

---

### Task 1.2: Frame utilities + waveform peaks + export/import logic

**Files:**
- Create: `tools/apps/weaver/src/lib/frameUtils.ts`
- Create: `tools/apps/weaver/src/lib/waveformPeaks.ts`
- Create: `tools/apps/weaver/src/lib/exportConfig.ts`
- Create: `tools/apps/weaver/src/lib/importConfig.ts`

- [ ] **Step 1: Create frameUtils.ts**

```typescript
export function frameToPixel(
  frame: number, viewStart: number, viewEnd: number, width: number,
): number {
  if (viewEnd === viewStart) return 0;
  return ((frame - viewStart) / (viewEnd - viewStart)) * width;
}

export function pixelToFrame(
  px: number, viewStart: number, viewEnd: number, width: number,
): number {
  if (width === 0) return viewStart;
  return Math.round(viewStart + (px / width) * (viewEnd - viewStart));
}

export function framesToSeconds(frame: number, sampleRate: number): number {
  return frame / sampleRate;
}

export function secondsToFrames(seconds: number, sampleRate: number): number {
  return Math.round(seconds * sampleRate);
}

export function frameToBarBeat(
  frame: number, sampleRate: number, bpm: number,
): { bar: number; beat: number } {
  const seconds = frame / sampleRate;
  const totalBeats = (seconds * bpm) / 60;
  const bar = Math.floor(totalBeats / 4) + 1;
  const beat = Math.floor(totalBeats % 4) + 1;
  return { bar, beat };
}
```

- [ ] **Step 2: Create waveformPeaks.ts**

```typescript
export function computeWaveformPeaks(
  buffer: AudioBuffer, numBuckets: number = 1000,
): Float32Array {
  const data = buffer.getChannelData(0);
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

- [ ] **Step 3: Create exportConfig.ts**

```typescript
import type { MusicConfigV2, StemState, MarkerState } from './types.js';

export function exportMusicConfig(opts: {
  groupId: number;
  groupName: string;
  sampleRate: number;
  bpm: number;
  loopStart: number;
  loopEnd: number;
  markers: MarkerState[];
  stems: StemState[];
}): MusicConfigV2 {
  return {
    version: 2,
    sample_rate: opts.sampleRate,
    track_groups: [
      {
        id: opts.groupId,
        name: opts.groupName,
        bpm: opts.bpm,
        loop_start: opts.loopStart,
        loop_end: opts.loopEnd,
        markers: [...opts.markers]
          .sort((a, b) => a.frame - b.frame)
          .map((m) => ({ frame: m.frame, name: m.name })),
        stems: opts.stems.map((s) => ({
          source: s.sourcePath,
          initial_volume: s.initialVolume,
        })),
      },
    ],
  };
}

export function downloadJson(data: MusicConfigV2, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: Create importConfig.ts**

```typescript
import type { MusicConfigV2, StemState } from './types.js';
import { computeWaveformPeaks } from './waveformPeaks.js';

export async function parseConfigJson(text: string): Promise<MusicConfigV2> {
  const data = JSON.parse(text);
  if (data.version !== 2) throw new Error(`Unsupported version: ${data.version}`);
  return data as MusicConfigV2;
}

export async function decodeStemFile(
  file: File, audioContext: AudioContext,
): Promise<{ audioBuffer: AudioBuffer; waveformPeaks: Float32Array }> {
  const arrayBuffer = await file.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  const waveformPeaks = computeWaveformPeaks(audioBuffer);
  return { audioBuffer, waveformPeaks };
}
```

- [ ] **Step 5: Commit**

```bash
git add tools/apps/weaver/src/lib/
git commit -m "weaver: add frame utilities, waveform peaks, export/import logic"
```

---

### Task 1.3: Zustand store

**Files:**
- Create: `tools/apps/weaver/src/store/useWeaverStore.ts`

- [ ] **Step 1: Create the store**

Create `tools/apps/weaver/src/store/useWeaverStore.ts`:
```typescript
import { create } from 'zustand';
import type { StemState, MarkerState, MusicConfigV2 } from '../lib/types.js';
import { exportMusicConfig } from '../lib/exportConfig.js';
import { decodeStemFile } from '../lib/importConfig.js';
import { computeWaveformPeaks } from '../lib/waveformPeaks.js';

interface WeaverStore {
  // Group metadata
  groupId: number;
  groupName: string;
  sampleRate: number;
  bpm: number;
  setGroupId: (id: number) => void;
  setGroupName: (name: string) => void;
  setSampleRate: (sr: number) => void;
  setBpm: (bpm: number) => void;

  // Stems
  stems: StemState[];
  addStem: (file: File) => Promise<void>;
  removeStem: (index: number) => void;
  setStemVolume: (index: number, volume: number) => void;

  // Loop points (frames)
  loopStart: number;
  loopEnd: number;
  setLoopStart: (frame: number) => void;
  setLoopEnd: (frame: number) => void;

  // Markers
  markers: MarkerState[];
  addMarker: (frame: number, name?: string) => void;
  removeMarker: (index: number) => void;
  updateMarker: (index: number, patch: Partial<MarkerState>) => void;
  moveMarker: (index: number, frame: number) => void;

  // Transport
  isPlaying: boolean;
  playheadFrame: number;
  setIsPlaying: (playing: boolean) => void;
  setPlayheadFrame: (frame: number) => void;

  // Viewport
  viewStartFrame: number;
  viewEndFrame: number;
  setView: (start: number, end: number) => void;
  zoomToFit: () => void;

  // Export
  getExportData: () => MusicConfigV2;

  // Max duration helper
  maxFrames: () => number;
}

// Shared AudioContext for decoding
let sharedCtx: AudioContext | null = null;
function getAudioContext(): AudioContext {
  if (!sharedCtx) sharedCtx = new AudioContext();
  return sharedCtx;
}

export const useWeaverStore = create<WeaverStore>((set, get) => ({
  groupId: 1,
  groupName: 'untitled',
  sampleRate: 44100,
  bpm: 120,
  setGroupId: (id) => set({ groupId: id }),
  setGroupName: (name) => set({ groupName: name }),
  setSampleRate: (sr) => set({ sampleRate: sr }),
  setBpm: (bpm) => set({ bpm }),

  stems: [],
  addStem: async (file: File) => {
    const ctx = getAudioContext();
    const { audioBuffer, waveformPeaks } = await decodeStemFile(file, ctx);
    const stem: StemState = {
      fileName: file.name,
      sourcePath: `assets/audio/${get().groupName}/${file.name}`,
      initialVolume: 1.0,
      audioBuffer,
      waveformPeaks,
    };
    set((s) => {
      const stems = [...s.stems, stem];
      // Auto-expand view if this is the first stem
      const maxLen = Math.max(...stems.map((st) => st.audioBuffer?.length ?? 0));
      return {
        stems,
        viewEndFrame: s.viewEndFrame === 0 ? maxLen : s.viewEndFrame,
      };
    });
  },
  removeStem: (index) =>
    set((s) => ({ stems: s.stems.filter((_, i) => i !== index) })),
  setStemVolume: (index, volume) =>
    set((s) => ({
      stems: s.stems.map((st, i) =>
        i === index ? { ...st, initialVolume: volume } : st,
      ),
    })),

  loopStart: 0,
  loopEnd: 0,
  setLoopStart: (frame) => set({ loopStart: Math.max(0, frame) }),
  setLoopEnd: (frame) => set({ loopEnd: Math.max(0, frame) }),

  markers: [],
  addMarker: (frame, name) =>
    set((s) => ({
      markers: [...s.markers, { frame, name: name ?? `Marker ${s.markers.length + 1}` }],
    })),
  removeMarker: (index) =>
    set((s) => ({ markers: s.markers.filter((_, i) => i !== index) })),
  updateMarker: (index, patch) =>
    set((s) => ({
      markers: s.markers.map((m, i) => (i === index ? { ...m, ...patch } : m)),
    })),
  moveMarker: (index, frame) =>
    set((s) => ({
      markers: s.markers.map((m, i) => (i === index ? { ...m, frame } : m)),
    })),

  isPlaying: false,
  playheadFrame: 0,
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setPlayheadFrame: (frame) => set({ playheadFrame: frame }),

  viewStartFrame: 0,
  viewEndFrame: 0,
  setView: (start, end) => set({ viewStartFrame: start, viewEndFrame: end }),
  zoomToFit: () => {
    const max = get().maxFrames();
    set({ viewStartFrame: 0, viewEndFrame: max > 0 ? max : 44100 });
  },

  getExportData: () => {
    const s = get();
    return exportMusicConfig({
      groupId: s.groupId,
      groupName: s.groupName,
      sampleRate: s.sampleRate,
      bpm: s.bpm,
      loopStart: s.loopStart,
      loopEnd: s.loopEnd,
      markers: s.markers,
      stems: s.stems,
    });
  },

  maxFrames: () => {
    const s = get();
    if (s.stems.length === 0) return 0;
    return Math.max(...s.stems.map((st) => st.audioBuffer?.length ?? 0));
  },
}));
```

- [ ] **Step 2: Verify build**

```bash
pnpm --filter weaver build
```

- [ ] **Step 3: Commit**

```bash
git add tools/apps/weaver/src/store/
git commit -m "weaver: add Zustand store (stems, markers, loops, transport, viewport)"
```

---

## Milestone 2 — UI components

### Task 2.1: Toolbar + Sidebar + GroupMetadata + MarkerList

**Files:**
- Create: `tools/apps/weaver/src/components/Toolbar.tsx`
- Create: `tools/apps/weaver/src/components/Sidebar.tsx`
- Modify: `tools/apps/weaver/src/App.tsx`

- [ ] **Step 1: Create Toolbar.tsx**

```tsx
import React, { useRef } from 'react';
import { useWeaverStore } from '../store/useWeaverStore.js';
import { downloadJson } from '../lib/exportConfig.js';

export function Toolbar() {
  const fileRef = useRef<HTMLInputElement>(null);
  const addStem = useWeaverStore((s) => s.addStem);
  const isPlaying = useWeaverStore((s) => s.isPlaying);
  const setIsPlaying = useWeaverStore((s) => s.setIsPlaying);
  const setPlayheadFrame = useWeaverStore((s) => s.setPlayheadFrame);
  const getExportData = useWeaverStore((s) => s.getExportData);
  const groupName = useWeaverStore((s) => s.groupName);
  const zoomToFit = useWeaverStore((s) => s.zoomToFit);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      await addStem(file);
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleExport = () => {
    const data = getExportData();
    downloadJson(data, `${groupName}.music.json`);
  };

  const handlePlayStop = () => {
    if (isPlaying) {
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
    }
  };

  return (
    <header className="weaver-toolbar">
      <span className="weaver-title">Weaver</span>
      <button onClick={() => fileRef.current?.click()}>Import Stems</button>
      <input
        ref={fileRef}
        type="file"
        accept=".wav,.ogg"
        multiple
        style={{ display: 'none' }}
        onChange={handleImport}
      />
      <button onClick={handlePlayStop}>{isPlaying ? 'Stop' : 'Play'}</button>
      <button onClick={zoomToFit}>Zoom to Fit</button>
      <div style={{ flex: 1 }} />
      <button onClick={handleExport}>Export v2 JSON</button>
    </header>
  );
}
```

- [ ] **Step 2: Create Sidebar.tsx**

```tsx
import React from 'react';
import { useWeaverStore } from '../store/useWeaverStore.js';
import { frameToBarBeat } from '../lib/frameUtils.js';

function GroupMetadata() {
  const groupId = useWeaverStore((s) => s.groupId);
  const groupName = useWeaverStore((s) => s.groupName);
  const sampleRate = useWeaverStore((s) => s.sampleRate);
  const bpm = useWeaverStore((s) => s.bpm);
  const setGroupId = useWeaverStore((s) => s.setGroupId);
  const setGroupName = useWeaverStore((s) => s.setGroupName);
  const setSampleRate = useWeaverStore((s) => s.setSampleRate);
  const setBpm = useWeaverStore((s) => s.setBpm);

  return (
    <fieldset style={{ border: '1px solid #444', padding: 8, marginBottom: 12 }}>
      <legend>Track Group</legend>
      <label style={{ display: 'block', marginBottom: 4 }}>
        Name
        <input value={groupName} onChange={(e) => setGroupName(e.target.value)}
               style={{ marginLeft: 8, width: 140, background: '#2a2a4a', color: '#e0e0e0', border: '1px solid #555', padding: '2px 4px' }} />
      </label>
      <label style={{ display: 'block', marginBottom: 4 }}>
        ID
        <input type="number" value={groupId} onChange={(e) => setGroupId(Number(e.target.value))}
               style={{ marginLeft: 8, width: 60, background: '#2a2a4a', color: '#e0e0e0', border: '1px solid #555', padding: '2px 4px' }} />
      </label>
      <label style={{ display: 'block', marginBottom: 4 }}>
        BPM
        <input type="number" value={bpm} onChange={(e) => setBpm(Number(e.target.value))}
               style={{ marginLeft: 8, width: 60, background: '#2a2a4a', color: '#e0e0e0', border: '1px solid #555', padding: '2px 4px' }} />
      </label>
      <label style={{ display: 'block' }}>
        Sample Rate
        <input type="number" value={sampleRate} onChange={(e) => setSampleRate(Number(e.target.value))}
               style={{ marginLeft: 8, width: 80, background: '#2a2a4a', color: '#e0e0e0', border: '1px solid #555', padding: '2px 4px' }} />
      </label>
    </fieldset>
  );
}

function MarkerList() {
  const markers = useWeaverStore((s) => s.markers);
  const removeMarker = useWeaverStore((s) => s.removeMarker);
  const updateMarker = useWeaverStore((s) => s.updateMarker);
  const sampleRate = useWeaverStore((s) => s.sampleRate);
  const bpm = useWeaverStore((s) => s.bpm);
  const setPlayheadFrame = useWeaverStore((s) => s.setPlayheadFrame);

  const sorted = [...markers].map((m, i) => ({ ...m, originalIndex: i }))
    .sort((a, b) => a.frame - b.frame);

  return (
    <fieldset style={{ border: '1px solid #444', padding: 8 }}>
      <legend>Markers ({markers.length})</legend>
      {sorted.map((m) => {
        const bb = frameToBarBeat(m.frame, sampleRate, bpm);
        return (
          <div key={m.originalIndex} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
            <span style={{ fontSize: 11, color: '#888', width: 50, cursor: 'pointer' }}
                  onClick={() => setPlayheadFrame(m.frame)}>
              {bb.bar}:{bb.beat}
            </span>
            <input value={m.name} onChange={(e) => updateMarker(m.originalIndex, { name: e.target.value })}
                   style={{ flex: 1, background: '#2a2a4a', color: '#e0e0e0', border: '1px solid #555', padding: '1px 4px', fontSize: 12 }} />
            <button onClick={() => removeMarker(m.originalIndex)} style={{ fontSize: 10, padding: '1px 4px' }}>×</button>
          </div>
        );
      })}
    </fieldset>
  );
}

export function Sidebar() {
  return (
    <div className="weaver-sidebar">
      <GroupMetadata />
      <MarkerList />
    </div>
  );
}
```

- [ ] **Step 3: Update App.tsx**

Replace `tools/apps/weaver/src/App.tsx`:
```tsx
import React from 'react';
import './App.css';
import { Toolbar } from './components/Toolbar.js';
import { Sidebar } from './components/Sidebar.js';

export function App() {
  return (
    <div className="weaver">
      <Toolbar />
      <main className="weaver-body">
        <div className="weaver-timeline">
          <p style={{ padding: 20, color: '#666' }}>Import stems to begin</p>
        </div>
        <Sidebar />
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Verify build + dev server**

```bash
pnpm --filter weaver build
```

- [ ] **Step 5: Commit**

```bash
git add tools/apps/weaver/src/
git commit -m "weaver: add Toolbar, Sidebar, GroupMetadata, MarkerList"
```

---

### Task 2.2: StemLane (canvas waveform) + TimelinePanel

**Files:**
- Create: `tools/apps/weaver/src/components/StemLane.tsx`
- Create: `tools/apps/weaver/src/components/TimelinePanel.tsx`
- Modify: `tools/apps/weaver/src/App.tsx`

- [ ] **Step 1: Create StemLane.tsx**

```tsx
import React, { useRef, useEffect } from 'react';
import { useWeaverStore } from '../store/useWeaverStore.js';

interface StemLaneProps {
  index: number;
}

export function StemLane({ index }: StemLaneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stem = useWeaverStore((s) => s.stems[index]);
  const viewStart = useWeaverStore((s) => s.viewStartFrame);
  const viewEnd = useWeaverStore((s) => s.viewEndFrame);
  const removeStem = useWeaverStore((s) => s.removeStem);
  const setStemVolume = useWeaverStore((s) => s.setStemVolume);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !stem?.waveformPeaks) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * devicePixelRatio;
    canvas.height = rect.height * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);

    const w = rect.width;
    const h = rect.height;
    const peaks = stem.waveformPeaks;
    const totalFrames = stem.audioBuffer?.length ?? 1;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0f3460';
    ctx.fillRect(0, 0, w, h);

    // Draw waveform
    ctx.fillStyle = '#4488ff';
    const viewLen = viewEnd - viewStart;
    if (viewLen <= 0) return;

    for (let px = 0; px < w; px++) {
      const frame = viewStart + (px / w) * viewLen;
      const peakIdx = Math.floor((frame / totalFrames) * peaks.length);
      if (peakIdx < 0 || peakIdx >= peaks.length) continue;
      const amp = peaks[peakIdx];
      const barH = amp * h * 0.8;
      ctx.fillRect(px, (h - barH) / 2, 1, barH);
    }
  }, [stem, viewStart, viewEnd]);

  if (!stem) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'stretch', borderBottom: '1px solid #333', height: 80 }}>
      <div style={{ width: 120, padding: '4px 8px', display: 'flex', flexDirection: 'column', justifyContent: 'center', borderRight: '1px solid #333', flexShrink: 0 }}>
        <div style={{ fontSize: 11, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stem.fileName}</div>
        <input type="range" min={0} max={1} step={0.01}
               value={stem.initialVolume}
               onChange={(e) => setStemVolume(index, Number(e.target.value))}
               style={{ width: '100%' }} />
        <button onClick={() => removeStem(index)} style={{ fontSize: 10, marginTop: 2, alignSelf: 'flex-start' }}>Remove</button>
      </div>
      <canvas ref={canvasRef} style={{ flex: 1, height: '100%' }} />
    </div>
  );
}
```

- [ ] **Step 2: Create TimelinePanel.tsx**

```tsx
import React from 'react';
import { useWeaverStore } from '../store/useWeaverStore.js';
import { StemLane } from './StemLane.js';

export function TimelinePanel() {
  const stems = useWeaverStore((s) => s.stems);
  const addStem = useWeaverStore((s) => s.addStem);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter(
      (f) => f.name.endsWith('.wav') || f.name.endsWith('.ogg'),
    );
    for (const file of files) await addStem(file);
  };

  return (
    <div className="weaver-timeline"
         onDragOver={(e) => e.preventDefault()}
         onDrop={handleDrop}>
      {/* Ruler placeholder — Task 2.3 */}
      <div style={{ height: 32, background: '#16213e', borderBottom: '1px solid #444', fontSize: 11, color: '#666', display: 'flex', alignItems: 'center', paddingLeft: 128 }}>
        Ruler
      </div>

      {stems.map((_, i) => (
        <StemLane key={i} index={i} />
      ))}

      {stems.length === 0 && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555' }}>
          Drag & drop WAV/OGG files here
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Update App.tsx to use TimelinePanel**

```tsx
import React from 'react';
import './App.css';
import { Toolbar } from './components/Toolbar.js';
import { TimelinePanel } from './components/TimelinePanel.js';
import { Sidebar } from './components/Sidebar.js';

export function App() {
  return (
    <div className="weaver">
      <Toolbar />
      <main className="weaver-body">
        <TimelinePanel />
        <Sidebar />
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Build + verify**

```bash
pnpm --filter weaver build
```

- [ ] **Step 5: Commit**

```bash
git add tools/apps/weaver/src/
git commit -m "weaver: add StemLane (canvas waveform) + TimelinePanel with drag-drop"
```

---

### Task 2.3: Ruler (loop handles + markers + playhead + zoom/scroll)

**Files:**
- Create: `tools/apps/weaver/src/components/Ruler.tsx`
- Modify: `tools/apps/weaver/src/components/TimelinePanel.tsx`

- [ ] **Step 1: Create Ruler.tsx**

This is the interaction hub. It renders:
- Time axis with beat-grid ticks
- Draggable loop-start and loop-end triangular handles
- Marker diamonds (click ruler to add, drag to move)
- Playhead vertical line

```tsx
import React, { useRef, useCallback } from 'react';
import { useWeaverStore } from '../store/useWeaverStore.js';
import { frameToPixel, pixelToFrame, frameToBarBeat } from '../lib/frameUtils.js';

export function Ruler() {
  const rulerRef = useRef<HTMLDivElement>(null);

  const viewStart = useWeaverStore((s) => s.viewStartFrame);
  const viewEnd = useWeaverStore((s) => s.viewEndFrame);
  const loopStart = useWeaverStore((s) => s.loopStart);
  const loopEnd = useWeaverStore((s) => s.loopEnd);
  const setLoopStart = useWeaverStore((s) => s.setLoopStart);
  const setLoopEnd = useWeaverStore((s) => s.setLoopEnd);
  const markers = useWeaverStore((s) => s.markers);
  const addMarker = useWeaverStore((s) => s.addMarker);
  const moveMarker = useWeaverStore((s) => s.moveMarker);
  const playheadFrame = useWeaverStore((s) => s.playheadFrame);
  const setPlayheadFrame = useWeaverStore((s) => s.setPlayheadFrame);
  const sampleRate = useWeaverStore((s) => s.sampleRate);
  const bpm = useWeaverStore((s) => s.bpm);
  const setView = useWeaverStore((s) => s.setView);

  const getWidth = () => rulerRef.current?.clientWidth ?? 1;

  const handleRulerClick = (e: React.MouseEvent) => {
    if (e.target !== rulerRef.current) return;  // ignore clicks on handles
    const rect = rulerRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left - 120;  // offset for label column
    const frame = pixelToFrame(px, viewStart, viewEnd, getWidth() - 120);
    if (e.shiftKey) {
      addMarker(frame);
    } else {
      setPlayheadFrame(frame);
    }
  };

  const makeDragHandler = (onMove: (frame: number) => void) => {
    return (e: React.PointerEvent) => {
      e.preventDefault();
      const ruler = rulerRef.current!;
      const rect = ruler.getBoundingClientRect();
      const move = (ev: PointerEvent) => {
        const px = ev.clientX - rect.left - 120;
        const frame = pixelToFrame(px, viewStart, viewEnd, getWidth() - 120);
        onMove(Math.max(0, frame));
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = rulerRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left - 120;
    const w = getWidth() - 120;
    const anchorFrac = px / w;
    const viewLen = viewEnd - viewStart;

    if (e.ctrlKey || e.metaKey) {
      // Zoom
      const factor = e.deltaY > 0 ? 1.2 : 0.8;
      const newLen = Math.max(100, viewLen * factor);
      const anchor = viewStart + anchorFrac * viewLen;
      const newStart = Math.max(0, Math.round(anchor - anchorFrac * newLen));
      const newEnd = Math.round(newStart + newLen);
      setView(newStart, newEnd);
    } else {
      // Scroll
      const delta = Math.round(viewLen * 0.1 * Math.sign(e.deltaY));
      setView(Math.max(0, viewStart + delta), viewEnd + delta);
    }
  };

  const w = getWidth() - 120;
  const toX = (frame: number) => frameToPixel(frame, viewStart, viewEnd, w);

  // Generate beat ticks
  const ticks: { x: number; label: string }[] = [];
  if (bpm > 0 && sampleRate > 0) {
    const framesPerBeat = (sampleRate * 60) / bpm;
    const firstBeat = Math.ceil(viewStart / framesPerBeat);
    const lastBeat = Math.floor(viewEnd / framesPerBeat);
    for (let b = firstBeat; b <= lastBeat; b++) {
      const frame = Math.round(b * framesPerBeat);
      const x = toX(frame);
      const bar = Math.floor(b / 4) + 1;
      const beat = (b % 4) + 1;
      ticks.push({ x, label: beat === 1 ? `${bar}` : '' });
    }
  }

  return (
    <div ref={rulerRef}
         className="weaver-ruler"
         onClick={handleRulerClick}
         onWheel={handleWheel}
         style={{ position: 'relative', height: 32, background: '#16213e', borderBottom: '1px solid #444', marginLeft: 120, overflow: 'hidden', cursor: 'crosshair' }}>

      {/* Beat ticks */}
      {ticks.map((t, i) => (
        <div key={i} style={{ position: 'absolute', left: t.x, top: 0, height: '100%', width: 1, background: t.label ? '#444' : '#333' }}>
          {t.label && <span style={{ position: 'absolute', top: 2, left: 3, fontSize: 9, color: '#888' }}>{t.label}</span>}
        </div>
      ))}

      {/* Loop start handle */}
      <div onPointerDown={makeDragHandler(setLoopStart)}
           style={{ position: 'absolute', left: toX(loopStart) - 6, top: 0, width: 12, height: 16,
                    background: '#44cc66', clipPath: 'polygon(50% 100%, 0 0, 100% 0)', cursor: 'ew-resize', zIndex: 10 }}
           title={`Loop Start: ${loopStart}`} />

      {/* Loop end handle */}
      {loopEnd > 0 && (
        <div onPointerDown={makeDragHandler(setLoopEnd)}
             style={{ position: 'absolute', left: toX(loopEnd) - 6, top: 0, width: 12, height: 16,
                      background: '#ff6644', clipPath: 'polygon(50% 100%, 0 0, 100% 0)', cursor: 'ew-resize', zIndex: 10 }}
             title={`Loop End: ${loopEnd}`} />
      )}

      {/* Loop region highlight */}
      {loopEnd > 0 && (
        <div style={{ position: 'absolute', left: toX(loopStart), top: 20, width: toX(loopEnd) - toX(loopStart), height: 10,
                      background: 'rgba(68, 204, 102, 0.2)' }} />
      )}

      {/* Markers */}
      {markers.map((m, i) => (
        <div key={i}
             onPointerDown={makeDragHandler((f) => moveMarker(i, f))}
             style={{ position: 'absolute', left: toX(m.frame) - 5, bottom: 0, width: 10, height: 10,
                      background: '#ffaa00', transform: 'rotate(45deg)', cursor: 'ew-resize', zIndex: 5 }}
             title={`${m.name}: ${m.frame}`} />
      ))}

      {/* Playhead */}
      <div style={{ position: 'absolute', left: toX(playheadFrame), top: 0, width: 2, height: '100%',
                    background: '#ffffff', pointerEvents: 'none', zIndex: 20 }} />

      {/* Hint text */}
      <span style={{ position: 'absolute', right: 8, top: 8, fontSize: 9, color: '#555', pointerEvents: 'none' }}>
        Click: seek | Shift+Click: add marker | Ctrl+Scroll: zoom
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Update TimelinePanel to use Ruler**

Replace the ruler placeholder in `TimelinePanel.tsx`:
```tsx
import React from 'react';
import { useWeaverStore } from '../store/useWeaverStore.js';
import { Ruler } from './Ruler.js';
import { StemLane } from './StemLane.js';

export function TimelinePanel() {
  const stems = useWeaverStore((s) => s.stems);
  const addStem = useWeaverStore((s) => s.addStem);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter(
      (f) => f.name.endsWith('.wav') || f.name.endsWith('.ogg'),
    );
    for (const file of files) await addStem(file);
  };

  return (
    <div className="weaver-timeline"
         onDragOver={(e) => e.preventDefault()}
         onDrop={handleDrop}>
      <Ruler />
      {stems.map((_, i) => (
        <StemLane key={i} index={i} />
      ))}
      {stems.length === 0 && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555' }}>
          Drag & drop WAV/OGG files here
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Build + verify**

```bash
pnpm --filter weaver build
```

- [ ] **Step 4: Commit**

```bash
git add tools/apps/weaver/src/components/
git commit -m "weaver: add Ruler (loop handles, markers, playhead, zoom/scroll)"
```

---

## Milestone 3 — Web Audio playback + polish

### Task 3.1: useAudioPlayer hook

**Files:**
- Create: `tools/apps/weaver/src/hooks/useAudioPlayer.ts`
- Modify: `tools/apps/weaver/src/components/Toolbar.tsx`

- [ ] **Step 1: Create useAudioPlayer.ts**

```typescript
import { useRef, useEffect, useCallback } from 'react';
import { useWeaverStore } from '../store/useWeaverStore.js';
import { framesToSeconds } from '../lib/frameUtils.js';

export function useAudioPlayer() {
  const ctxRef = useRef<AudioContext | null>(null);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const startTimeRef = useRef(0);
  const startFrameRef = useRef(0);
  const rafRef = useRef(0);

  const stems = useWeaverStore((s) => s.stems);
  const sampleRate = useWeaverStore((s) => s.sampleRate);
  const loopStart = useWeaverStore((s) => s.loopStart);
  const loopEnd = useWeaverStore((s) => s.loopEnd);
  const playheadFrame = useWeaverStore((s) => s.playheadFrame);
  const setPlayheadFrame = useWeaverStore((s) => s.setPlayheadFrame);
  const setIsPlaying = useWeaverStore((s) => s.setIsPlaying);
  const isPlaying = useWeaverStore((s) => s.isPlaying);

  const play = useCallback(() => {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    const ctx = ctxRef.current;

    // Stop any existing playback
    sourcesRef.current.forEach((s) => { try { s.stop(); } catch {} });
    sourcesRef.current = [];

    const offset = framesToSeconds(playheadFrame, sampleRate);
    startTimeRef.current = ctx.currentTime;
    startFrameRef.current = playheadFrame;

    for (const stem of stems) {
      if (!stem.audioBuffer) continue;
      const source = ctx.createBufferSource();
      source.buffer = stem.audioBuffer;

      const gain = ctx.createGain();
      gain.gain.value = stem.initialVolume;

      if (loopEnd > 0) {
        source.loop = true;
        source.loopStart = framesToSeconds(loopStart, sampleRate);
        source.loopEnd = framesToSeconds(loopEnd, sampleRate);
      }

      source.connect(gain).connect(ctx.destination);
      source.start(0, offset);
      sourcesRef.current.push(source);
    }

    // Playhead animation
    const tick = () => {
      const elapsed = ctx.currentTime - startTimeRef.current;
      const currentFrame = startFrameRef.current + Math.round(elapsed * sampleRate);
      setPlayheadFrame(currentFrame);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    setIsPlaying(true);
  }, [stems, sampleRate, loopStart, loopEnd, playheadFrame, setPlayheadFrame, setIsPlaying]);

  const stop = useCallback(() => {
    sourcesRef.current.forEach((s) => { try { s.stop(); } catch {} });
    sourcesRef.current = [];
    cancelAnimationFrame(rafRef.current);
    setIsPlaying(false);
  }, [setIsPlaying]);

  // Stop on unmount
  useEffect(() => {
    return () => {
      sourcesRef.current.forEach((s) => { try { s.stop(); } catch {} });
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // React to isPlaying state changes (from Toolbar button)
  useEffect(() => {
    if (isPlaying) {
      play();
    } else {
      stop();
    }
  }, [isPlaying]);

  return { play, stop };
}
```

- [ ] **Step 2: Wire into App**

Update `App.tsx` to call the hook:
```tsx
import React from 'react';
import './App.css';
import { Toolbar } from './components/Toolbar.js';
import { TimelinePanel } from './components/TimelinePanel.js';
import { Sidebar } from './components/Sidebar.js';
import { useAudioPlayer } from './hooks/useAudioPlayer.js';

export function App() {
  useAudioPlayer();

  return (
    <div className="weaver">
      <Toolbar />
      <main className="weaver-body">
        <TimelinePanel />
        <Sidebar />
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Build + verify**

```bash
pnpm --filter weaver build
```

- [ ] **Step 4: Commit**

```bash
git add tools/apps/weaver/src/
git commit -m "weaver: add useAudioPlayer hook (Web Audio preview with loop support)"
```

---

### Task 3.2: Playhead line on waveform lanes + visual polish

**Files:**
- Modify: `tools/apps/weaver/src/components/StemLane.tsx` — draw playhead + loop region on canvas
- Modify: `tools/apps/weaver/src/App.css` — final style polish

- [ ] **Step 1: Add playhead + loop overlay to StemLane canvas**

Update the `useEffect` in `StemLane.tsx` to also draw the playhead line and loop region after the waveform:

Add these store subscriptions at the top of the component:
```tsx
const playheadFrame = useWeaverStore((s) => s.playheadFrame);
const loopStart = useWeaverStore((s) => s.loopStart);
const loopEnd = useWeaverStore((s) => s.loopEnd);
```

At the end of the canvas draw effect (after the waveform loop), add:
```tsx
    // Draw loop region
    if (loopEnd > 0) {
      const lsX = ((loopStart - viewStart) / viewLen) * w;
      const leX = ((loopEnd - viewStart) / viewLen) * w;
      ctx.fillStyle = 'rgba(68, 204, 102, 0.1)';
      ctx.fillRect(lsX, 0, leX - lsX, h);
      ctx.strokeStyle = '#44cc66';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(lsX, 0); ctx.lineTo(lsX, h); ctx.stroke();
      ctx.strokeStyle = '#ff6644';
      ctx.beginPath(); ctx.moveTo(leX, 0); ctx.lineTo(leX, h); ctx.stroke();
    }

    // Draw playhead
    const phX = ((playheadFrame - viewStart) / viewLen) * w;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(phX, 0);
    ctx.lineTo(phX, h);
    ctx.stroke();
```

Add `playheadFrame`, `loopStart`, `loopEnd` to the `useEffect` dependency array.

- [ ] **Step 2: Polish App.css**

Add button styles to `App.css`:
```css
button {
  background: #2a2a4a;
  color: #e0e0e0;
  border: 1px solid #555;
  padding: 4px 12px;
  cursor: pointer;
  font-size: 12px;
  border-radius: 3px;
}
button:hover {
  background: #3a3a5a;
}
button:active {
  background: #4a4a6a;
}

input[type="range"] {
  accent-color: #4488ff;
}

.weaver-ruler {
  user-select: none;
}
```

- [ ] **Step 3: Final build verification**

```bash
pnpm --filter weaver build
```

- [ ] **Step 4: Commit**

```bash
git add tools/apps/weaver/src/
git commit -m "weaver: add playhead/loop overlay on waveforms + CSS polish"
```

---

## Milestone 4 — Finalize + PR

- [ ] **Step 1: Full build check**

```bash
pnpm --filter weaver build
```

- [ ] **Step 2: Push + PR**

```bash
git push -u origin feature/audio-phase5-weaver
gh pr create --title "Phase 5: Weaver — interactive music authoring tool" --body "$(cat <<'EOF'
## Summary

Replaces the legacy Audio Composer with **Weaver** — a purpose-built visual
editor for `music_config.json` v2.

- **Canvas waveform** — N-lane timeline with pre-computed peaks, dynamic stem count
- **Ruler** — draggable loop handles, click/drag markers, playhead seek, beat-grid ticks
- **Web Audio preview** — multi-stem playback with per-stem volume and loop support
- **v2 JSON export** — pure serialization from Zustand store to `music_config.json`
- **Drag & drop** — import WAV/Ogg stems by dropping onto the timeline
- **All positions in frames** — integer precision, seconds only at Web Audio boundary

### Key files

- Spec: `docs/superpowers/specs/2026-04-18-audio-phase5-weaver-design.md`
- App: `tools/apps/weaver/`
- Store: `tools/apps/weaver/src/store/useWeaverStore.ts`
- Ruler: `tools/apps/weaver/src/components/Ruler.tsx`

### Deleted

- `tools/apps/audio-composer/` (entire directory)

## Test plan

- [x] `pnpm --filter weaver build` passes (tsc + vite)
- [ ] Import 4 WAV stems → waveforms render
- [ ] Drag loop handles → loop region visible
- [ ] Shift+click ruler → marker added
- [ ] Play → multi-stem playback with loop
- [ ] Export → valid music_config.json v2

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Cross-cutting reminders

- **Worktree:** all work in `.worktrees/feature-audio-phase5-weaver`.
- **Port:** Weaver runs on 5182 (`pnpm --filter weaver dev`).
- **Monorepo pattern:** follow Bricklayer's structure (`package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`).
- **No external waveform libraries** — pure Canvas + React `<div>` overlays.
- **All positions in frames** — never seconds in the store. `framesToSeconds` only at Web Audio boundary.
- **pnpm install** must be run from `tools/` after creating the new package.
- **Deleting audio-composer:** use `git rm -r` to properly track the deletion.

---

*End of plan.*
