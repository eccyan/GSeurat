# Weaver Polish Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 4 UX issues in Weaver: zoom beep, loop toggle, mute/solo, rewind button.

**Architecture:** All changes are in `tools/apps/weaver/src/`. Store additions are minimal (loopEnabled, muted, soloed booleans). No new files needed.

**Tech Stack:** React 18, Zustand 4, TypeScript, Web Audio API

---

### Task 1: Fix beep sound when zooming to boundary

**Problem:** When the user zooms in/out aggressively (Ctrl+scroll) and hits the min/max boundary, macOS plays the system "funk" beep because the wheel event is still being processed but producing no visual change.

**Files:**
- Modify: `tools/apps/weaver/src/components/Ruler.tsx:110-138`

- [ ] **Step 1: Add early-return when zoom hits boundary**

In the wheel handler's zoom branch (line 118-126), add an early return when the range is already at the minimum (100 frames) and the user is trying to zoom in further, or when already at max and zooming out:

```typescript
if (e.ctrlKey || e.metaKey) {
  // Zoom around cursor
  const cursorFrame = pixelToFrame(cursorPx, vs, ve, ww);
  const range = ve - vs;
  const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
  const newRange = Math.max(100, Math.min(mf > 0 ? mf : range, range * factor));
  if (Math.round(newRange) === Math.round(range)) return; // At boundary — swallow event
  const ratio = cursorPx / ww;
  const newStart = Math.max(0, cursorFrame - newRange * ratio);
  store.setView(Math.round(newStart), Math.round(newStart + newRange));
}
```

Key changes:
- Add upper bound clamp via `Math.min(mf, ...)` so max zoom = full file
- Early return when `newRange === range` (at boundary) to prevent continued event processing
- `mf` is already computed on line 131 — move it before the if/else block

- [ ] **Step 2: Move `mf` computation before the zoom/pan branch**

```typescript
const mf = store.maxFrames();

if (e.ctrlKey || e.metaKey) {
  // zoom branch (uses mf)
} else {
  // pan branch (already uses mf)
}
```

- [ ] **Step 3: Verify — zoom to min boundary, no beep; zoom to max, no beep**

- [ ] **Step 4: Commit**

```bash
git add tools/apps/weaver/src/components/Ruler.tsx
git commit -m "fix(weaver): suppress system beep at zoom boundaries"
```

---

### Task 2: Add loop toggle — play all music without looping

**Problem:** Loop is always enabled when `loopEnd > loopStart`. User wants to disable looping and play straight through.

**Files:**
- Modify: `tools/apps/weaver/src/store/useWeaverStore.ts` — add `loopEnabled` state
- Modify: `tools/apps/weaver/src/hooks/useAudioPlayer.ts` — respect `loopEnabled`
- Modify: `tools/apps/weaver/src/components/Toolbar.tsx` — add Loop toggle button
- Modify: `tools/apps/weaver/src/components/Ruler.tsx` — dim loop region when disabled
- Modify: `tools/apps/weaver/src/components/StemLane.tsx` — dim loop overlay when disabled

- [ ] **Step 1: Add `loopEnabled` to store interface and implementation**

In `useWeaverStore.ts`, add to the interface (after line 24):
```typescript
loopEnabled: boolean;
setLoopEnabled: (enabled: boolean) => void;
```

And in the store creation (after line 86):
```typescript
loopEnabled: true,
setLoopEnabled: (enabled) => set({ loopEnabled: enabled }),
```

- [ ] **Step 2: Respect `loopEnabled` in useAudioPlayer**

In `useAudioPlayer.ts`, read `loopEnabled` from state (line 30 area):
```typescript
const loopEnabled = state.loopEnabled;
```

Change the loop condition (line 58):
```typescript
if (loopEnabled && loopEnd > loopStart) {
```

Change the playhead wrap condition (line 83):
```typescript
if (loopEnabled && loopEnd > loopStart && frame >= loopEnd) {
```

Add playback-end detection for non-looping mode — after the wrap block:
```typescript
// Stop at end when not looping
const maxLen = store.maxFrames();
if (!loopEnabled && frame >= maxLen) {
  s.setIsPlaying(false);
  s.setPlayheadFrame(maxLen);
  return;
}
```

Note: access `store` via `useWeaverStore.getState()` which is already available as `s`.

- [ ] **Step 3: Add Loop toggle button in Toolbar**

In `Toolbar.tsx`, add store selectors:
```typescript
const loopEnabled = useWeaverStore((s) => s.loopEnabled);
const setLoopEnabled = useWeaverStore((s) => s.setLoopEnabled);
```

Add button after Play/Stop (line 42):
```tsx
<button
  onClick={() => setLoopEnabled(!loopEnabled)}
  style={{ opacity: loopEnabled ? 1 : 0.5 }}
>
  {loopEnabled ? 'Loop ON' : 'Loop OFF'}
</button>
```

- [ ] **Step 4: Dim loop overlays when disabled**

In `Ruler.tsx`, read `loopEnabled`:
```typescript
const loopEnabled = useWeaverStore((s) => s.loopEnabled);
```

Change loop region highlight condition (line 204):
```tsx
{loopEnd > loopStart && (
  <div style={{
    ...existing styles,
    background: loopEnabled ? 'rgba(68, 204, 102, 0.15)' : 'rgba(68, 204, 102, 0.05)',
  }} />
)}
```

Dim loop handle triangles:
```tsx
borderTop: `${HANDLE_SIZE}px solid ${loopEnabled ? '#44cc66' : '#44cc6644'}`,
// and for end handle:
borderTop: `${HANDLE_SIZE}px solid ${loopEnabled ? '#ff6644' : '#ff664444'}`,
```

In `StemLane.tsx`, read `loopEnabled` and dim the loop overlay:
```typescript
const loopEnabled = useWeaverStore((s) => s.loopEnabled);
```
Change canvas loop overlay (line 53):
```typescript
ctx.fillStyle = loopEnabled ? 'rgba(68, 204, 102, 0.1)' : 'rgba(68, 204, 102, 0.03)';
```

Add `loopEnabled` to the useEffect dependency array.

- [ ] **Step 5: Verify — toggle loop off, play runs to end and stops; toggle on, loops normally**

- [ ] **Step 6: Commit**

```bash
git add tools/apps/weaver/src/store/useWeaverStore.ts tools/apps/weaver/src/hooks/useAudioPlayer.ts tools/apps/weaver/src/components/Toolbar.tsx tools/apps/weaver/src/components/Ruler.tsx tools/apps/weaver/src/components/StemLane.tsx
git commit -m "feat(weaver): add loop on/off toggle for straight-through playback"
```

---

### Task 3: Add Mute/Solo per stem

**Problem:** No way to isolate or silence individual stems during preview.

**Files:**
- Modify: `tools/apps/weaver/src/lib/types.ts` — add `muted`, `soloed` to StemState
- Modify: `tools/apps/weaver/src/store/useWeaverStore.ts` — add toggle actions
- Modify: `tools/apps/weaver/src/hooks/useAudioPlayer.ts` — compute effective gain
- Modify: `tools/apps/weaver/src/components/StemLane.tsx` — add M/S buttons

- [ ] **Step 1: Extend StemState with muted/soloed**

In `types.ts`, add to StemState:
```typescript
export interface StemState {
  fileName: string;
  sourcePath: string;
  initialVolume: number;
  audioBuffer: AudioBuffer | null;
  waveformPeaks: Float32Array | null;
  muted: boolean;
  soloed: boolean;
}
```

- [ ] **Step 2: Add toggle actions to store**

In `useWeaverStore.ts` interface, add:
```typescript
toggleMute: (index: number) => void;
toggleSolo: (index: number) => void;
```

Implementation:
```typescript
toggleMute: (index) =>
  set((s) => ({ stems: s.stems.map((st, i) => i === index ? { ...st, muted: !st.muted } : st) })),
toggleSolo: (index) =>
  set((s) => ({ stems: s.stems.map((st, i) => i === index ? { ...st, soloed: !st.soloed } : st) })),
```

Update `addStem` to initialize new fields (in the stem creation, after `waveformPeaks`):
```typescript
muted: false,
soloed: false,
```

- [ ] **Step 3: Compute effective gain in useAudioPlayer**

In `useAudioPlayer.ts`, after reading stems, compute which stems are audible:

```typescript
const anySoloed = stems.some(s => s.soloed);

for (const [i, stem] of stems.entries()) {
  if (!stem.audioBuffer) continue;
  // ... create source + gain as before ...

  // Effective volume: muted → 0, solo active but not this stem → 0
  let effectiveVol = stem.initialVolume;
  if (stem.muted) effectiveVol = 0;
  if (anySoloed && !stem.soloed) effectiveVol = 0;
  gain.gain.value = effectiveVol;

  // ... rest of loop ...
}
```

Also update gain nodes live when mute/solo changes during playback. Add a useEffect that watches stems and updates existing gain nodes:

After the isPlaying useEffect, add:
```typescript
const stems = useWeaverStore((s) => s.stems);

useEffect(() => {
  const gains = gainsRef.current;
  if (gains.length === 0) return;
  const anySoloed = stems.some(s => s.soloed);
  let gi = 0;
  for (const stem of stems) {
    if (!stem.audioBuffer) continue;
    if (gi >= gains.length) break;
    let vol = stem.initialVolume;
    if (stem.muted) vol = 0;
    if (anySoloed && !stem.soloed) vol = 0;
    gains[gi].gain.value = vol;
    gi++;
  }
}, [stems]);
```

- [ ] **Step 4: Add M/S buttons to StemLane**

In `StemLane.tsx`, add store selectors:
```typescript
const toggleMute = useWeaverStore((s) => s.toggleMute);
const toggleSolo = useWeaverStore((s) => s.toggleSolo);
```

Add buttons in the label overlay, after the volume slider div (line 137 area):
```tsx
<div style={{ display: 'flex', gap: 2, marginTop: 2 }}>
  <button
    onClick={() => toggleMute(index)}
    style={{
      padding: '0 4px', fontSize: 9, minWidth: 20,
      background: stem.muted ? '#ff4444' : '#333',
      color: stem.muted ? '#fff' : '#888',
      border: '1px solid #555', borderRadius: 2, cursor: 'pointer',
    }}
  >
    M
  </button>
  <button
    onClick={() => toggleSolo(index)}
    style={{
      padding: '0 4px', fontSize: 9, minWidth: 20,
      background: stem.soloed ? '#ffaa00' : '#333',
      color: stem.soloed ? '#000' : '#888',
      border: '1px solid #555', borderRadius: 2, cursor: 'pointer',
    }}
  >
    S
  </button>
</div>
```

- [ ] **Step 5: Verify — mute a stem, it goes silent; solo a stem, only it plays; unmute/unsolo restores**

- [ ] **Step 6: Commit**

```bash
git add tools/apps/weaver/src/lib/types.ts tools/apps/weaver/src/store/useWeaverStore.ts tools/apps/weaver/src/hooks/useAudioPlayer.ts tools/apps/weaver/src/components/StemLane.tsx
git commit -m "feat(weaver): add per-stem mute and solo controls"
```

---

### Task 4: Add rewind (play from beginning) button

**Problem:** No way to quickly restart playback from frame 0.

**Files:**
- Modify: `tools/apps/weaver/src/components/Toolbar.tsx` — add rewind button

- [ ] **Step 1: Add rewind button to Toolbar**

Add a rewind handler and button. The rewind action: seek to frame 0, and if currently playing, restart playback.

```typescript
const setPlayheadFrame = useWeaverStore((s) => s.setPlayheadFrame);

const handleRewind = () => {
  const state = useWeaverStore.getState();
  if (state.isPlaying) {
    // Stop then restart to reset Web Audio sources from frame 0
    setIsPlaying(false);
    setPlayheadFrame(0);
    // Use microtask to ensure stop completes before restart
    queueMicrotask(() => setIsPlaying(true));
  } else {
    setPlayheadFrame(0);
  }
};
```

Add button before Play/Stop:
```tsx
<button onClick={handleRewind}>⏮ Rewind</button>
```

- [ ] **Step 2: Verify — click rewind while stopped: playhead goes to 0. Click while playing: restarts from 0.**

- [ ] **Step 3: Commit**

```bash
git add tools/apps/weaver/src/components/Toolbar.tsx
git commit -m "feat(weaver): add rewind button for play-from-beginning"
```
