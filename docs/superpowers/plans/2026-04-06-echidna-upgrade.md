# Echidna Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Echidna with shared UI components, new drawing/selection tools, animation interpolation with preview, and PLY/OBJ/VOX import with bone support.

**Architecture:** Extract reusable UI components (NumberInput, Vec3Input, panelStyles) from Bricklayer into `@gseurat/ui-kit`, then build new features in Echidna consuming those components. New features include: fill/extrude/lasso tools, easing-based animation interpolation with per-part keyframes, onion skinning, Staging auto-sync preview, and rigged PLY/OBJ import with voxelization.

**Tech Stack:** React 18, TypeScript, Zustand 4.5, Three.js/R3F, Vitest, Vite, `@gseurat/ui-kit` (workspace package), `@gseurat/engine-client` (bridge client)

---

## File Structure

### Phase 1: Shared UI Kit

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `packages/ui-kit/src/NumberInput.tsx` | Drag-to-scrub numeric input (from Bricklayer) |
| Create | `packages/ui-kit/src/panelStyles.ts` | Shared style tokens (from Bricklayer) |
| Modify | `packages/ui-kit/src/Vec3Input.tsx` | Upgrade to use NumberInput with dual layout modes |
| Modify | `packages/ui-kit/src/index.ts` | Export new components |
| Modify | `apps/bricklayer/src/components/NumberInput.tsx` | Replace with re-export from ui-kit |
| Modify | `apps/bricklayer/src/components/Vec3Input.tsx` | Replace with re-export from ui-kit |
| Modify | `apps/bricklayer/src/styles/panel.ts` | Replace with re-export from ui-kit |

### Phase 2: Workflow Efficiency

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `apps/echidna/src/store/types.ts` | Add new tool types, easing types, v2 format |
| Modify | `apps/echidna/src/store/useCharacterStore.ts` | Add fill, extrude, lasso, clipboard, xray, yLevelLock actions |
| Modify | `apps/echidna/src/lib/voxelUtils.ts` | Add floodFill3D, extrudeLayer helpers |
| Create | `apps/echidna/src/__tests__/voxelUtils.test.ts` | Tests for fill, extrude, lasso utilities |
| Modify | `apps/echidna/src/panels/ToolBar.tsx` | New tool buttons using ui-kit ToolButton |
| Modify | `apps/echidna/src/panels/BuildPanel.tsx` | Y-level lock, x-ray toggle, NumberInput from ui-kit |
| Modify | `apps/echidna/src/panels/AnimateRightPanel.tsx` | Vec3Input from ui-kit for rotations |
| Modify | `apps/echidna/src/viewport/VoxelMesh.tsx` | Fill/extrude/lasso pointer handlers, x-ray rendering |
| Modify | `apps/echidna/src/App.tsx` | New keyboard shortcuts (G, X, L, T, Cmd+C/V, Backspace) |

### Phase 3: Animation System

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `apps/echidna/src/lib/easing.ts` | Easing functions (linear, ease-in-out, bounce, elastic, step, custom) |
| Create | `apps/echidna/src/__tests__/easing.test.ts` | Tests for all easing functions |
| Modify | `apps/echidna/src/store/types.ts` | EasingType, updated AnimationKeyframe with easing/curve/parts |
| Modify | `apps/echidna/src/store/useCharacterStore.ts` | Per-part keyframes, playback modes, easing in addKeyframe |
| Modify | `apps/echidna/src/viewport/VoxelMesh.tsx` | Eased interpolation, onion skinning ghosts |
| Modify | `apps/echidna/src/panels/AnimateRightPanel.tsx` | Easing dropdown, per-part keyframe UI |
| Modify | `apps/echidna/src/panels/Timeline.tsx` | Per-part lanes, playback mode selector |
| Create | `apps/echidna/src/panels/BezierCurveEditor.tsx` | Inline cubic Bézier editor for custom easing |
| Modify | `apps/echidna/src/lib/manifestExport.ts` | Export easing, curve, parts, playbackMode |
| Modify | `apps/echidna/src/__tests__/manifestExport.test.ts` | Tests for new manifest fields |

### Phase 4: Import/Export with Bones

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `apps/echidna/src/lib/plyImport.ts` | Parse binary PLY with optional bone_index, voxelize |
| Create | `apps/echidna/src/lib/objImport.ts` | Parse OBJ, voxelize triangle mesh |
| Create | `apps/echidna/src/__tests__/plyImport.test.ts` | Tests for PLY import (rigged + unrigged) |
| Create | `apps/echidna/src/__tests__/objImport.test.ts` | Tests for OBJ voxelization |
| Modify | `apps/echidna/src/lib/voxImport.ts` | Enhanced .vox import with LAYR chunk names |
| Create | `apps/echidna/src/panels/ImportDialog.tsx` | Unified import dialog (PLY/VOX/OBJ) |
| Modify | `apps/echidna/src/panels/MenuBar.tsx` | "Export Character" action, import dialog wiring |
| Modify | `apps/echidna/src/store/useCharacterStore.ts` | importFromPly, importFromObj actions |

---

## Task 1: Extract NumberInput to ui-kit

**Files:**
- Create: `tools/packages/ui-kit/src/NumberInput.tsx`
- Create: `tools/packages/ui-kit/src/panelStyles.ts`
- Modify: `tools/packages/ui-kit/src/index.ts`

- [ ] **Step 1: Create NumberInput in ui-kit**

Copy Bricklayer's NumberInput to ui-kit with one change: remove the Bricklayer-specific import paths and make it self-contained.

```tsx
// tools/packages/ui-kit/src/NumberInput.tsx
import React, { useCallback, useRef, useState } from 'react';

export interface NumberInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  style?: React.CSSProperties;
}

function formatValue(v: number): string {
  return parseFloat(v.toFixed(10)).toString();
}

function clamp(v: number, min?: number, max?: number): number {
  if (min !== undefined && v < min) return min;
  if (max !== undefined && v > max) return max;
  return v;
}

const defaultInputStyle: React.CSSProperties = {
  padding: '4px 6px',
  background: '#2a2a4a',
  borderWidth: '1px 1px 3px 1px',
  borderStyle: 'solid',
  borderColor: '#444 #444 #77f #444',
  borderRadius: 4,
  color: '#ddd',
  fontSize: 13,
  outline: 'none',
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#888',
  userSelect: 'none',
  cursor: 'ew-resize',
};

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  style,
}: NumberInputProps) {
  const [text, setText] = useState(() => formatValue(value));
  const [focused, setFocused] = useState(false);
  const prevValue = useRef(value);
  const dragStartX = useRef(0);
  const dragStartValue = useRef(0);
  const dragging = useRef(false);
  const pointerIsDown = useRef(false);

  if (!focused && value !== prevValue.current) {
    prevValue.current = value;
  }
  const displayText = focused ? text : formatValue(value);

  const commit = useCallback(
    (raw: string) => {
      const parsed = parseFloat(raw);
      if (isNaN(parsed)) {
        setText(formatValue(value));
        return;
      }
      const clamped = clamp(parsed, min, max);
      onChange(clamped);
      setText(formatValue(clamped));
    },
    [value, min, max, onChange],
  );

  const handleFocus = useCallback(() => {
    setFocused(true);
    setText(formatValue(value));
  }, [value]);

  const handleBlur = useCallback(() => {
    setFocused(false);
    commit(text);
  }, [text, commit]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        commit(text);
        (e.target as HTMLInputElement).blur();
      } else if (e.key === 'Escape') {
        setText(formatValue(value));
        setFocused(false);
        (e.target as HTMLInputElement).blur();
      }
    },
    [text, commit, value],
  );

  const handleLabelPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragging.current = true;
      dragStartX.current = e.clientX;
      dragStartValue.current = value;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [value],
  );

  const handleLabelPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - dragStartX.current;
      const delta = Math.round(dx / 2) * step;
      const newVal = clamp(dragStartValue.current + delta, min, max);
      onChange(newVal);
    },
    [step, min, max, onChange],
  );

  const handleLabelPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  return (
    <>
      {label && (
        <span
          style={labelStyle}
          onPointerDown={handleLabelPointerDown}
          onPointerMove={handleLabelPointerMove}
          onPointerUp={handleLabelPointerUp}
        >
          {label}
        </span>
      )}
      <input
        type="text"
        value={displayText}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onPointerDown={(e) => {
          if (document.activeElement !== e.currentTarget) {
            e.preventDefault();
            pointerIsDown.current = true;
            dragStartX.current = e.clientX;
            dragStartValue.current = value;
            dragging.current = false;
          }
        }}
        onPointerMove={(e) => {
          if (!pointerIsDown.current || focused) return;
          const dx = e.clientX - dragStartX.current;
          if (!dragging.current && Math.abs(dx) < 3) return;
          if (!dragging.current) {
            dragging.current = true;
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }
          const delta = Math.round(dx / 2) * step;
          const newVal = clamp(dragStartValue.current + delta, min, max);
          onChange(newVal);
        }}
        onPointerUp={(e) => {
          pointerIsDown.current = false;
          if (dragging.current) {
            dragging.current = false;
            try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
          } else if (!focused) {
            (e.target as HTMLInputElement).focus();
          }
        }}
        style={{ ...defaultInputStyle, cursor: focused ? 'text' : 'ew-resize', ...style }}
      />
    </>
  );
}
```

- [ ] **Step 2: Create panelStyles in ui-kit**

```ts
// tools/packages/ui-kit/src/panelStyles.ts
import React from 'react';

export const panelStyles: Record<string, React.CSSProperties> = {
  section: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 },
  label: { fontSize: 11, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 1 },
  row: { display: 'flex', alignItems: 'center', gap: 6 },
  input: { flex: 1, maxWidth: 80, padding: '3px 5px', fontSize: 12 },
  select: { flex: 1, padding: '3px 5px', fontSize: 12 },
  btn: {
    padding: '3px 8px', border: '1px solid #555', borderRadius: 4,
    background: '#3a3a6a', color: '#ddd', cursor: 'pointer', fontSize: 11,
  },
  btnDanger: {
    padding: '3px 8px', border: '1px solid #c33', borderRadius: 4,
    background: '#4a2020', color: '#faa', cursor: 'pointer', fontSize: 11,
  },
  item: {
    padding: 8, border: '1px solid #444', borderRadius: 4, background: '#22223a',
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  itemSelected: { borderColor: '#77f' },
  empty: { fontSize: 12, color: '#666', textAlign: 'center' as const, paddingTop: 40 },
  checkbox: { marginRight: 4 },
};
```

- [ ] **Step 3: Upgrade Vec3Input to use NumberInput from ui-kit**

Replace the existing `tools/packages/ui-kit/src/Vec3Input.tsx` with the dual-mode version that uses the new NumberInput:

```tsx
// tools/packages/ui-kit/src/Vec3Input.tsx
import React from 'react';
import { NumberInput } from './NumberInput.js';
import { panelStyles } from './panelStyles.js';

export interface Vec3InputProps {
  value: [number, number, number];
  onChange: (v: [number, number, number]) => void;
  step?: number;
  label?: string;
  labelPrefix?: string;
  min?: number;
  max?: number;
  style?: React.CSSProperties;
}

export function Vec3Input({
  value,
  onChange,
  step = 0.1,
  label,
  labelPrefix,
  min,
  max,
  style,
}: Vec3InputProps) {
  const inputStyle = style ?? { ...panelStyles.input, maxWidth: 55 };

  if (label) {
    return (
      <div style={panelStyles.row}>
        <span style={{ fontSize: 12, minWidth: 70 }}>{label}</span>
        <NumberInput value={value[0]} onChange={(v) => onChange([v, value[1], value[2]])} step={step} min={min} max={max} style={inputStyle} />
        <NumberInput value={value[1]} onChange={(v) => onChange([value[0], v, value[2]])} step={step} min={min} max={max} style={inputStyle} />
        <NumberInput value={value[2]} onChange={(v) => onChange([value[0], value[1], v])} step={step} min={min} max={max} style={inputStyle} />
      </div>
    );
  }

  return (
    <div style={panelStyles.row}>
      {(['X', 'Y', 'Z'] as const).map((axis, i) => (
        <React.Fragment key={axis}>
          <NumberInput
            label={`${labelPrefix ?? ''}${axis}`}
            step={step}
            min={min}
            max={max}
            value={value[i]}
            onChange={(v) => {
              const next = [...value] as [number, number, number];
              next[i] = v;
              onChange(next);
            }}
            style={inputStyle}
          />
        </React.Fragment>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Update ui-kit barrel export**

Add to `tools/packages/ui-kit/src/index.ts`:

```ts
export { NumberInput } from './NumberInput.js';
export type { NumberInputProps } from './NumberInput.js';

export { panelStyles } from './panelStyles.js';
```

- [ ] **Step 5: Replace Bricklayer's local copies with re-exports**

Replace `tools/apps/bricklayer/src/components/NumberInput.tsx`:

```tsx
export { NumberInput } from '@gseurat/ui-kit';
export type { NumberInputProps } from '@gseurat/ui-kit';
```

Replace `tools/apps/bricklayer/src/components/Vec3Input.tsx`:

```tsx
export { Vec3Input } from '@gseurat/ui-kit';
export type { Vec3InputProps } from '@gseurat/ui-kit';
```

Replace `tools/apps/bricklayer/src/styles/panel.ts`:

```ts
export { panelStyles } from '@gseurat/ui-kit';
```

- [ ] **Step 6: Verify Bricklayer still builds**

Run: `cd tools && pnpm --filter @gseurat/bricklayer build`
Expected: Build succeeds with no errors

- [ ] **Step 7: Commit**

```bash
git add tools/packages/ui-kit/src/NumberInput.tsx tools/packages/ui-kit/src/panelStyles.ts tools/packages/ui-kit/src/Vec3Input.tsx tools/packages/ui-kit/src/index.ts tools/apps/bricklayer/src/components/NumberInput.tsx tools/apps/bricklayer/src/components/Vec3Input.tsx tools/apps/bricklayer/src/styles/panel.ts
git commit -m "refactor: extract NumberInput, Vec3Input, panelStyles to @gseurat/ui-kit"
```

---

## Task 2: Update Echidna types for v2 format

**Files:**
- Modify: `tools/apps/echidna/src/store/types.ts`

- [ ] **Step 1: Add easing types and update tool/format types**

```ts
// tools/apps/echidna/src/store/types.ts — full replacement
// ── Voxel ──

export interface Voxel {
  color: [number, number, number, number];
}

export type VoxelKey = `${number},${number},${number}`;

// ── Character ──

export interface BodyPart {
  id: string;
  name: string;
  parent: string | null;
  joint: [number, number, number];
  voxelKeys: VoxelKey[];
}

export interface PoseData {
  /** Per-part euler rotations in degrees [rx, ry, rz] */
  rotations: Record<string, [number, number, number]>;
}

export type ToolType =
  | 'place'
  | 'paint'
  | 'erase'
  | 'fill'
  | 'extrude'
  | 'eyedropper'
  | 'assign_part'
  | 'box_select'
  | 'lasso_select';

// ── Animation ──

export type EasingType = 'linear' | 'ease-in-out' | 'bounce' | 'elastic' | 'step' | 'custom';

export type PlaybackMode = 'loop' | 'ping-pong' | 'once';

export interface AnimationKeyframe {
  time: number;
  poseName: string;
  easing: EasingType;
  curve?: [number, number, number, number];
  parts?: string[];
}

export interface AnimationClip {
  name: string;
  keyframes: AnimationKeyframe[];
  duration: number;
  playbackMode: PlaybackMode;
}

// ── App mode ──

export type AppMode = 'build' | 'animate';

// ── Clipboard ──

export interface ClipboardEntry {
  dx: number;
  dy: number;
  dz: number;
  color: [number, number, number, number];
}

// ── File format (v2) ──

export interface EchidnaFile {
  version: number;
  characterName: string;
  gridWidth: number;
  gridDepth: number;
  voxels: { x: number; y: number; z: number; r: number; g: number; b: number; a: number }[];
  parts: BodyPart[];
  poses: Record<string, PoseData>;
  animations?: Record<string, AnimationClip>;
}

// ── Undo snapshot ──

export interface Snapshot {
  voxels: [VoxelKey, Voxel][];
  parts: BodyPart[];
}
```

- [ ] **Step 2: Fix store references to BodyPart (add `name` field)**

In `tools/apps/echidna/src/store/useCharacterStore.ts`, update `addPart` to include the `name` field:

Change the `addPart` action's `BodyPart` construction from:
```ts
const part: BodyPart = {
  id: name,
  parent: get().selectedPart ?? (parts.length > 0 ? parts[0].id : null),
  joint: [0, 0, 0],
  voxelKeys: [],
};
```
to:
```ts
const part: BodyPart = {
  id: name,
  name: name,
  parent: get().selectedPart ?? (parts.length > 0 ? parts[0].id : null),
  joint: [0, 0, 0],
  voxelKeys: [],
};
```

Also update `importVoxModels` to include `name`:
```ts
parts.push({
  id: model.name,
  name: model.name,
  parent: parts.length > 0 ? parts[0].id : null,
  joint: [0, 0, 0],
  voxelKeys: keys,
});
```

Also update `addKeyframe` to default easing:

Change `addKeyframe`:
```ts
addKeyframe: (animName, keyframe) => {
  const anims = { ...get().animations };
  const clip = anims[animName];
  if (!clip) return;
  const kf = { easing: 'step' as const, ...keyframe };
  const keyframes = [...clip.keyframes, kf].sort((a, b) => a.time - b.time);
  anims[animName] = { ...clip, keyframes };
  set({ animations: anims });
},
```

Update `addAnimation` to include `playbackMode`:
```ts
addAnimation: (name) => {
  const anims = { ...get().animations };
  if (!anims[name]) {
    anims[name] = { name, keyframes: [], duration: 1, playbackMode: 'loop' };
  }
  set({ animations: anims, selectedAnimation: name });
},
```

Update `loadProject` to migrate v1 data:
```ts
loadProject: (data) => {
  const voxels = new Map<VoxelKey, Voxel>();
  for (const v of data.voxels) {
    voxels.set(voxelKey(v.x, v.y, v.z), { color: [v.r, v.g, v.b, v.a] });
  }
  // Migrate v1 parts: add name field if missing
  const parts = data.parts.map((p) => ({
    ...p,
    name: p.name ?? p.id,
  }));
  // Migrate v1 animations: add easing + playbackMode defaults
  const animations: Record<string, AnimationClip> = {};
  if (data.animations) {
    for (const [key, clip] of Object.entries(data.animations)) {
      animations[key] = {
        ...clip,
        playbackMode: (clip as any).playbackMode ?? 'loop',
        keyframes: clip.keyframes.map((kf) => ({
          ...kf,
          easing: (kf as any).easing ?? 'step',
        })),
      };
    }
  }
  set({
    voxels,
    gridWidth: data.gridWidth,
    gridDepth: data.gridDepth,
    characterName: data.characterName,
    characterParts: parts,
    characterPoses: data.poses,
    animations,
    selectedPart: null,
    selectedPose: null,
    selectedAnimation: null,
    previewPose: false,
    undoStack: [],
    redoStack: [],
    playbackTime: 0,
    isPlaying: false,
    boxSelection: null,
  });
},
```

Update `saveProject` to emit version 2:
```ts
saveProject: () => {
  const s = get();
  const voxelArr: EchidnaFile['voxels'] = [];
  for (const [key, vox] of s.voxels) {
    const [x, y, z] = parseKey(key);
    voxelArr.push({ x, y, z, r: vox.color[0], g: vox.color[1], b: vox.color[2], a: vox.color[3] });
  }
  return {
    version: 2,
    characterName: s.characterName,
    gridWidth: s.gridWidth,
    gridDepth: s.gridDepth,
    voxels: voxelArr,
    parts: s.characterParts,
    poses: s.characterPoses,
    animations: Object.keys(s.animations).length > 0 ? s.animations : undefined,
  };
},
```

- [ ] **Step 3: Run existing tests to verify nothing broke**

Run: `cd tools && pnpm --filter @gseurat/echidna test`
Expected: All existing tests pass (plyExport, manifestExport)

- [ ] **Step 4: Commit**

```bash
git add tools/apps/echidna/src/store/types.ts tools/apps/echidna/src/store/useCharacterStore.ts
git commit -m "feat(echidna): update types to v2 format with easing, per-part keyframes, and BodyPart.name"
```

---

## Task 3: Easing functions library

**Files:**
- Create: `tools/apps/echidna/src/lib/easing.ts`
- Create: `tools/apps/echidna/src/__tests__/easing.test.ts`

- [ ] **Step 1: Write failing tests for easing functions**

```ts
// tools/apps/echidna/src/__tests__/easing.test.ts
import { describe, it, expect } from 'vitest';
import { applyEasing } from '../lib/easing.js';
import type { EasingType } from '../store/types.js';

describe('applyEasing', () => {
  it('linear: t=0 → 0, t=0.5 → 0.5, t=1 → 1', () => {
    expect(applyEasing('linear', 0)).toBeCloseTo(0);
    expect(applyEasing('linear', 0.5)).toBeCloseTo(0.5);
    expect(applyEasing('linear', 1)).toBeCloseTo(1);
  });

  it('step: t<1 → 0, t=1 → 1', () => {
    expect(applyEasing('step', 0)).toBe(0);
    expect(applyEasing('step', 0.5)).toBe(0);
    expect(applyEasing('step', 0.99)).toBe(0);
    expect(applyEasing('step', 1)).toBe(1);
  });

  it('ease-in-out: t=0 → 0, t=0.5 → 0.5, t=1 → 1, monotonic', () => {
    expect(applyEasing('ease-in-out', 0)).toBeCloseTo(0);
    expect(applyEasing('ease-in-out', 0.5)).toBeCloseTo(0.5);
    expect(applyEasing('ease-in-out', 1)).toBeCloseTo(1);
    // Monotonic check
    let prev = 0;
    for (let t = 0.1; t <= 1; t += 0.1) {
      const v = applyEasing('ease-in-out', t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('bounce: t=0 → 0, t=1 → 1, overshoots in middle', () => {
    expect(applyEasing('bounce', 0)).toBeCloseTo(0);
    expect(applyEasing('bounce', 1)).toBeCloseTo(1);
  });

  it('elastic: t=0 → 0, t=1 → ~1, oscillates', () => {
    expect(applyEasing('elastic', 0)).toBeCloseTo(0);
    expect(applyEasing('elastic', 1)).toBeCloseTo(1, 1);
  });

  it('custom: uses cubic bezier control points', () => {
    // Linear-equivalent bezier [0, 0, 1, 1]
    expect(applyEasing('custom', 0.5, [0, 0, 1, 1])).toBeCloseTo(0.5, 1);
    expect(applyEasing('custom', 0, [0, 0, 1, 1])).toBeCloseTo(0);
    expect(applyEasing('custom', 1, [0, 0, 1, 1])).toBeCloseTo(1);
  });

  it('custom without curve falls back to linear', () => {
    expect(applyEasing('custom', 0.5)).toBeCloseTo(0.5);
  });

  it('all easings return values in reasonable range [−0.5, 1.5]', () => {
    const types: EasingType[] = ['linear', 'ease-in-out', 'bounce', 'elastic', 'step'];
    for (const type of types) {
      for (let t = 0; t <= 1; t += 0.05) {
        const v = applyEasing(type, t);
        expect(v).toBeGreaterThanOrEqual(-0.5);
        expect(v).toBeLessThanOrEqual(1.5);
      }
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd tools && pnpm --filter @gseurat/echidna test -- --reporter verbose 2>&1 | head -30`
Expected: FAIL — `Cannot find module '../lib/easing.js'`

- [ ] **Step 3: Implement easing functions**

```ts
// tools/apps/echidna/src/lib/easing.ts
import type { EasingType } from '../store/types.js';

function linear(t: number): number {
  return t;
}

function easeInOut(t: number): number {
  return t * t * (3 - 2 * t);
}

function bounceOut(t: number): number {
  if (t < 1 / 2.75) {
    return 7.5625 * t * t;
  } else if (t < 2 / 2.75) {
    const t2 = t - 1.5 / 2.75;
    return 7.5625 * t2 * t2 + 0.75;
  } else if (t < 2.5 / 2.75) {
    const t2 = t - 2.25 / 2.75;
    return 7.5625 * t2 * t2 + 0.9375;
  } else {
    const t2 = t - 2.625 / 2.75;
    return 7.5625 * t2 * t2 + 0.984375;
  }
}

function elastic(t: number): number {
  if (t === 0 || t === 1) return t;
  return Math.pow(2, -10 * t) * Math.sin((t - 0.075) * (2 * Math.PI) / 0.3) + 1;
}

function step(t: number): number {
  return t < 1 ? 0 : 1;
}

/** Evaluate cubic bezier at parameter t using De Casteljau's algorithm.
 *  Control points: P0=(0,0), P1=(cx1,cy1), P2=(cx2,cy2), P3=(1,1).
 *  We solve for the y value at a given x (input t) using Newton's method. */
function cubicBezier(t: number, cx1: number, cy1: number, cx2: number, cy2: number): number {
  // Solve for bezier parameter s where bezierX(s) = t
  let s = t;
  for (let i = 0; i < 8; i++) {
    const bx = 3 * (1 - s) * (1 - s) * s * cx1 + 3 * (1 - s) * s * s * cx2 + s * s * s;
    const dbx = 3 * (1 - s) * (1 - s) * cx1 + 6 * (1 - s) * s * (cx2 - cx1) + 3 * s * s * (1 - cx2);
    if (Math.abs(dbx) < 1e-6) break;
    s = s - (bx - t) / dbx;
    s = Math.max(0, Math.min(1, s));
  }
  // Evaluate y at parameter s
  return 3 * (1 - s) * (1 - s) * s * cy1 + 3 * (1 - s) * s * s * cy2 + s * s * s;
}

export function applyEasing(
  type: EasingType,
  t: number,
  curve?: [number, number, number, number],
): number {
  switch (type) {
    case 'linear': return linear(t);
    case 'ease-in-out': return easeInOut(t);
    case 'bounce': return bounceOut(t);
    case 'elastic': return elastic(t);
    case 'step': return step(t);
    case 'custom':
      if (curve) return cubicBezier(t, curve[0], curve[1], curve[2], curve[3]);
      return linear(t);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tools && pnpm --filter @gseurat/echidna test -- --reporter verbose`
Expected: All easing tests PASS

- [ ] **Step 5: Commit**

```bash
git add tools/apps/echidna/src/lib/easing.ts tools/apps/echidna/src/__tests__/easing.test.ts
git commit -m "feat(echidna): add easing functions library (linear, ease-in-out, bounce, elastic, step, custom bezier)"
```

---

## Task 4: Voxel utility functions (fill, extrude)

**Files:**
- Modify: `tools/apps/echidna/src/lib/voxelUtils.ts`
- Create: `tools/apps/echidna/src/__tests__/voxelUtils.test.ts`

- [ ] **Step 1: Write failing tests for fill and extrude**

```ts
// tools/apps/echidna/src/__tests__/voxelUtils.test.ts
import { describe, it, expect } from 'vitest';
import { voxelKey, parseKey, brushPositions, floodFill3D, extrudeLayer } from '../lib/voxelUtils.js';
import type { Voxel, VoxelKey } from '../store/types.js';

describe('voxelKey / parseKey', () => {
  it('round-trips coordinates', () => {
    const key = voxelKey(3, 7, 11);
    expect(key).toBe('3,7,11');
    expect(parseKey(key)).toEqual([3, 7, 11]);
  });
});

describe('brushPositions', () => {
  it('size 1 returns single position', () => {
    expect(brushPositions(5, 3, 5, 1)).toEqual([[5, 3, 5]]);
  });

  it('size 3 returns 9 positions', () => {
    const pos = brushPositions(5, 3, 5, 3);
    expect(pos).toHaveLength(9);
  });
});

function makeVoxelMap(entries: [number, number, number, [number, number, number, number]][]): Map<VoxelKey, Voxel> {
  const map = new Map<VoxelKey, Voxel>();
  for (const [x, y, z, color] of entries) {
    map.set(voxelKey(x, y, z), { color: [...color] });
  }
  return map;
}

describe('floodFill3D', () => {
  const red: [number, number, number, number] = [255, 0, 0, 255];
  const blue: [number, number, number, number] = [0, 0, 255, 255];

  it('fills connected same-color voxels in 3D', () => {
    // 3 connected red voxels in a line
    const voxels = makeVoxelMap([
      [0, 0, 0, red],
      [1, 0, 0, red],
      [2, 0, 0, red],
      [4, 0, 0, red], // disconnected
    ]);
    const keys = floodFill3D(voxels, voxelKey(0, 0, 0));
    expect(keys).toHaveLength(3);
    expect(keys).toContain(voxelKey(0, 0, 0));
    expect(keys).toContain(voxelKey(1, 0, 0));
    expect(keys).toContain(voxelKey(2, 0, 0));
    expect(keys).not.toContain(voxelKey(4, 0, 0));
  });

  it('does not cross color boundaries', () => {
    const voxels = makeVoxelMap([
      [0, 0, 0, red],
      [1, 0, 0, blue],
      [2, 0, 0, red],
    ]);
    const keys = floodFill3D(voxels, voxelKey(0, 0, 0));
    expect(keys).toHaveLength(1);
    expect(keys).toContain(voxelKey(0, 0, 0));
  });

  it('returns empty array for non-existent start', () => {
    const voxels = new Map<VoxelKey, Voxel>();
    expect(floodFill3D(voxels, voxelKey(0, 0, 0))).toEqual([]);
  });
});

describe('extrudeLayer', () => {
  const red: [number, number, number, number] = [255, 0, 0, 255];

  it('extrudes voxels up by 1', () => {
    const voxels = makeVoxelMap([
      [0, 0, 0, red],
      [1, 0, 0, red],
    ]);
    const result = extrudeLayer(voxels, [voxelKey(0, 0, 0), voxelKey(1, 0, 0)], 1);
    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ x: 0, y: 1, z: 0, color: red });
    expect(result).toContainEqual({ x: 1, y: 1, z: 0, color: red });
  });

  it('extrudes down by -1', () => {
    const voxels = makeVoxelMap([
      [0, 5, 0, red],
    ]);
    const result = extrudeLayer(voxels, [voxelKey(0, 5, 0)], -1);
    expect(result).toHaveLength(1);
    expect(result).toContainEqual({ x: 0, y: 4, z: 0, color: red });
  });

  it('skips voxels not in the map', () => {
    const voxels = new Map<VoxelKey, Voxel>();
    const result = extrudeLayer(voxels, [voxelKey(0, 0, 0)], 1);
    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd tools && pnpm --filter @gseurat/echidna test -- --reporter verbose 2>&1 | head -20`
Expected: FAIL — `floodFill3D` and `extrudeLayer` not exported

- [ ] **Step 3: Implement fill and extrude utilities**

```ts
// tools/apps/echidna/src/lib/voxelUtils.ts — full replacement
import type { VoxelKey, Voxel } from '../store/types.js';

export function voxelKey(x: number, y: number, z: number): VoxelKey {
  return `${x},${y},${z}`;
}

export function parseKey(key: VoxelKey): [number, number, number] {
  const parts = key.split(',');
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

export function brushPositions(
  cx: number,
  cy: number,
  cz: number,
  size: number,
): [number, number, number][] {
  const positions: [number, number, number][] = [];
  const r = Math.floor(size / 2);
  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) {
      positions.push([cx + dx, cy, cz + dz]);
    }
  }
  return positions;
}

const NEIGHBORS: [number, number, number][] = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

/** 3D flood fill: returns all VoxelKeys connected to `startKey` that share the same color. */
export function floodFill3D(
  voxels: Map<VoxelKey, Voxel>,
  startKey: VoxelKey,
): VoxelKey[] {
  const startVoxel = voxels.get(startKey);
  if (!startVoxel) return [];

  const targetColor = startVoxel.color;
  const visited = new Set<VoxelKey>();
  const result: VoxelKey[] = [];
  const queue: VoxelKey[] = [startKey];

  while (queue.length > 0) {
    const key = queue.pop()!;
    if (visited.has(key)) continue;
    visited.add(key);

    const voxel = voxels.get(key);
    if (!voxel) continue;

    // Same color check (all 4 channels)
    if (
      voxel.color[0] !== targetColor[0] ||
      voxel.color[1] !== targetColor[1] ||
      voxel.color[2] !== targetColor[2] ||
      voxel.color[3] !== targetColor[3]
    ) continue;

    result.push(key);

    const [x, y, z] = parseKey(key);
    for (const [dx, dy, dz] of NEIGHBORS) {
      const nk = voxelKey(x + dx, y + dy, z + dz);
      if (!visited.has(nk)) queue.push(nk);
    }
  }

  return result;
}

/** Compute extrusion: for each key in `keys` that exists in `voxels`,
 *  produce a new voxel offset by `dy` in Y. Returns array of {x, y, z, color}. */
export function extrudeLayer(
  voxels: Map<VoxelKey, Voxel>,
  keys: VoxelKey[],
  dy: number,
): { x: number; y: number; z: number; color: [number, number, number, number] }[] {
  const result: { x: number; y: number; z: number; color: [number, number, number, number] }[] = [];
  for (const key of keys) {
    const voxel = voxels.get(key);
    if (!voxel) continue;
    const [x, y, z] = parseKey(key);
    result.push({ x, y: y + dy, z, color: [...voxel.color] });
  }
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tools && pnpm --filter @gseurat/echidna test -- --reporter verbose`
Expected: All tests PASS (voxelUtils, plyExport, manifestExport)

- [ ] **Step 5: Commit**

```bash
git add tools/apps/echidna/src/lib/voxelUtils.ts tools/apps/echidna/src/__tests__/voxelUtils.test.ts
git commit -m "feat(echidna): add floodFill3D and extrudeLayer voxel utilities"
```

---

## Task 5: Store actions for new tools and clipboard

**Files:**
- Modify: `tools/apps/echidna/src/store/useCharacterStore.ts`

- [ ] **Step 1: Add new state fields and actions to the store**

Add these fields to `CharacterStoreState` interface (after existing fields):

```ts
// New state fields
xrayMode: boolean;
yLevelLock: number | null;
clipboard: ClipboardEntry[] | null;
lassoSelection: VoxelKey[] | null;
playbackMode: PlaybackMode;
onionSkinning: boolean;
```

Add these action signatures to the interface:

```ts
// New actions
setXrayMode: (v: boolean) => void;
setYLevelLock: (y: number | null) => void;
fillVoxels: (startKey: VoxelKey) => void;
extrudeSelection: (dy: number) => void;
copySelection: () => void;
pasteClipboard: (cx: number, cy: number, cz: number) => void;
deleteSelection: () => void;
recolorSelection: () => void;
setLassoSelection: (keys: VoxelKey[] | null) => void;
setPlaybackMode: (mode: PlaybackMode) => void;
setOnionSkinning: (v: boolean) => void;
```

Add initial values for new fields:

```ts
xrayMode: false,
yLevelLock: null,
clipboard: null,
lassoSelection: null,
playbackMode: 'loop',
onionSkinning: false,
```

Add action implementations:

```ts
setXrayMode: (v) => set({ xrayMode: v }),
setYLevelLock: (y) => set({ yLevelLock: y }),

fillVoxels: (startKey) => {
  const { voxels, activeColor, mirrorAxis, gridWidth } = get();
  const keys = floodFill3D(voxels, startKey);
  if (keys.length === 0) return;
  const next = new Map(voxels);
  for (const key of keys) {
    next.set(key, { color: [...activeColor] });
    const [x, y, z] = parseKey(key);
    const m = mirrorPos(x, y, z, mirrorAxis, gridWidth);
    if (m) {
      const mk = voxelKey(m[0], m[1], m[2]);
      if (next.has(mk)) next.set(mk, { color: [...activeColor] });
    }
  }
  set({ voxels: next });
},

extrudeSelection: (dy) => {
  const { voxels, boxSelection, lassoSelection, mirrorAxis, gridWidth } = get();
  const sel = boxSelection ?? lassoSelection;
  if (!sel || sel.length === 0) return;
  const results = extrudeLayer(voxels, sel, dy);
  if (results.length === 0) return;
  const next = new Map(voxels);
  for (const { x, y, z, color } of results) {
    next.set(voxelKey(x, y, z), { color });
    const m = mirrorPos(x, y, z, mirrorAxis, gridWidth);
    if (m) next.set(voxelKey(m[0], m[1], m[2]), { color });
  }
  set({ voxels: next });
},

copySelection: () => {
  const { voxels, boxSelection, lassoSelection } = get();
  const sel = boxSelection ?? lassoSelection;
  if (!sel || sel.length === 0) return;
  // Compute centroid
  let cx = 0, cy = 0, cz = 0;
  for (const key of sel) {
    const [x, y, z] = parseKey(key);
    cx += x; cy += y; cz += z;
  }
  cx = Math.round(cx / sel.length);
  cy = Math.round(cy / sel.length);
  cz = Math.round(cz / sel.length);
  const entries: ClipboardEntry[] = [];
  for (const key of sel) {
    const voxel = voxels.get(key);
    if (!voxel) continue;
    const [x, y, z] = parseKey(key);
    entries.push({ dx: x - cx, dy: y - cy, dz: z - cz, color: [...voxel.color] });
  }
  set({ clipboard: entries });
},

pasteClipboard: (cx, cy, cz) => {
  const { clipboard, voxels, mirrorAxis, gridWidth } = get();
  if (!clipboard || clipboard.length === 0) return;
  const next = new Map(voxels);
  for (const { dx, dy, dz, color } of clipboard) {
    const x = cx + dx, y = cy + dy, z = cz + dz;
    next.set(voxelKey(x, y, z), { color: [...color] });
    const m = mirrorPos(x, y, z, mirrorAxis, gridWidth);
    if (m) next.set(voxelKey(m[0], m[1], m[2]), { color: [...color] });
  }
  set({ voxels: next });
},

deleteSelection: () => {
  const { voxels, boxSelection, lassoSelection, mirrorAxis, gridWidth } = get();
  const sel = boxSelection ?? lassoSelection;
  if (!sel || sel.length === 0) return;
  const next = new Map(voxels);
  for (const key of sel) {
    next.delete(key);
    const [x, y, z] = parseKey(key);
    const m = mirrorPos(x, y, z, mirrorAxis, gridWidth);
    if (m) next.delete(voxelKey(m[0], m[1], m[2]));
  }
  set({ voxels: next, boxSelection: null, lassoSelection: null });
},

recolorSelection: () => {
  const { voxels, boxSelection, lassoSelection, activeColor, mirrorAxis, gridWidth } = get();
  const sel = boxSelection ?? lassoSelection;
  if (!sel || sel.length === 0) return;
  const next = new Map(voxels);
  for (const key of sel) {
    if (!next.has(key)) continue;
    next.set(key, { color: [...activeColor] });
    const [x, y, z] = parseKey(key);
    const m = mirrorPos(x, y, z, mirrorAxis, gridWidth);
    if (m) {
      const mk = voxelKey(m[0], m[1], m[2]);
      if (next.has(mk)) next.set(mk, { color: [...activeColor] });
    }
  }
  set({ voxels: next });
},

setLassoSelection: (keys) => set({ lassoSelection: keys }),
setPlaybackMode: (mode) => set({ playbackMode: mode }),
setOnionSkinning: (v) => set({ onionSkinning: v }),
```

Import the new utilities at the top of the store file:

```ts
import { voxelKey, parseKey, floodFill3D, extrudeLayer } from '../lib/voxelUtils.js';
```

And import the new types:

```ts
import type {
  Voxel, VoxelKey, BodyPart, PoseData, ToolType, Snapshot,
  EchidnaFile, AppMode, AnimationClip, AnimationKeyframe,
  ClipboardEntry, PlaybackMode,
} from './types.js';
```

- [ ] **Step 2: Run tests**

Run: `cd tools && pnpm --filter @gseurat/echidna test -- --reporter verbose`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add tools/apps/echidna/src/store/useCharacterStore.ts
git commit -m "feat(echidna): add store actions for fill, extrude, clipboard, selection, xray, and playback modes"
```

---

## Task 6: Upgrade Echidna panels to use ui-kit components

**Files:**
- Modify: `tools/apps/echidna/src/panels/ToolBar.tsx`
- Modify: `tools/apps/echidna/src/panels/BuildPanel.tsx`
- Modify: `tools/apps/echidna/src/panels/AnimateRightPanel.tsx`

- [ ] **Step 1: Update ToolBar with new tools and ui-kit imports**

In `tools/apps/echidna/src/panels/ToolBar.tsx`, add buttons for Fill, Extrude, and Lasso Select. Import `NumberInput` from `@gseurat/ui-kit` for brush size. Add tool buttons for the new tools:

```tsx
// Add to the tools section (after Erase, before Eyedropper):
{ id: 'fill', label: '▧ Fill', shortcut: 'G' },
{ id: 'extrude', label: '⬆ Extrude', shortcut: 'X' },
// Add to utility section:
{ id: 'lasso_select', label: '◎ Lasso', shortcut: 'L' },
```

Replace the brush size `<input type="range">` with:

```tsx
import { NumberInput } from '@gseurat/ui-kit';
// ...
<NumberInput value={brushSize} onChange={setBrushSize} min={1} max={8} step={1} label="Size" />
```

- [ ] **Step 2: Update BuildPanel with Y-level lock and X-ray**

In `tools/apps/echidna/src/panels/BuildPanel.tsx`, add Y-level lock controls and X-ray toggle:

```tsx
import { NumberInput } from '@gseurat/ui-kit';
// ...
// Y-Level Lock section
<div style={{ marginBottom: 8 }}>
  <label>
    <input type="checkbox" checked={yLevelLock !== null} onChange={(e) => setYLevelLock(e.target.checked ? 0 : null)} />
    Y-Level Lock
  </label>
  {yLevelLock !== null && (
    <NumberInput value={yLevelLock} onChange={setYLevelLock} min={0} step={1} label="Y" />
  )}
</div>
// X-Ray toggle
<label>
  <input type="checkbox" checked={xrayMode} onChange={(e) => setXrayMode(e.target.checked)} />
  X-Ray Mode (T)
</label>
```

- [ ] **Step 3: Update AnimateRightPanel with Vec3Input**

In `tools/apps/echidna/src/panels/AnimateRightPanel.tsx`, replace rotation number inputs with `Vec3Input`:

```tsx
import { Vec3Input } from '@gseurat/ui-kit';
// ...
// Replace per-axis rotation inputs with:
<Vec3Input
  value={rotation}
  onChange={(v) => updatePoseRotation(selectedPose, partId, v)}
  step={1}
  min={-180}
  max={180}
/>
```

- [ ] **Step 4: Run dev server to verify no import errors**

Run: `cd tools && pnpm --filter @gseurat/echidna build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add tools/apps/echidna/src/panels/ToolBar.tsx tools/apps/echidna/src/panels/BuildPanel.tsx tools/apps/echidna/src/panels/AnimateRightPanel.tsx
git commit -m "feat(echidna): upgrade panels to use ui-kit NumberInput and Vec3Input, add fill/extrude/lasso tool buttons"
```

---

## Task 7: Keyboard shortcuts and viewport tool handlers

**Files:**
- Modify: `tools/apps/echidna/src/App.tsx`
- Modify: `tools/apps/echidna/src/viewport/VoxelMesh.tsx`

- [ ] **Step 1: Add keyboard shortcuts in App.tsx**

Add to the keyboard handler in `App.tsx`:

```tsx
// New tool shortcuts (build mode)
case 'g': if (mode === 'build') setTool('fill'); break;
case 'x': if (mode === 'build') setTool('extrude'); break;
case 'l': if (mode === 'build') setTool('lasso_select'); break;
case 't': setXrayMode(!xrayMode); break;

// Clipboard shortcuts (any mode, with meta key)
if (e.metaKey || e.ctrlKey) {
  switch (e.key) {
    case 'c': if (boxSelection || lassoSelection) { e.preventDefault(); copySelection(); } break;
    case 'v': if (clipboard) { e.preventDefault(); /* enter paste mode */ } break;
  }
}

// Delete selection
if (e.key === 'Backspace' || e.key === 'Delete') {
  if (boxSelection || lassoSelection) {
    pushUndo();
    deleteSelection();
  }
}
```

- [ ] **Step 2: Add fill and extrude handlers in VoxelMesh.tsx**

In the pointer handler section of `VoxelMesh.tsx`, add cases for the new tools:

```tsx
case 'fill': {
  pushUndo();
  fillVoxels(hitKey);
  break;
}
case 'extrude': {
  // Left click = up, right click (button 2) = down
  const dy = e.button === 2 ? -1 : 1;
  const sel = boxSelection ?? lassoSelection ?? [hitKey];
  pushUndo();
  extrudeSelection(dy);
  break;
}
```

- [ ] **Step 3: Add X-ray rendering mode**

In VoxelMesh.tsx, modify the material to support X-ray opacity:

```tsx
const xrayMode = useCharacterStore((s) => s.xrayMode);
// In the InstancedMesh material:
<meshStandardMaterial
  vertexColors
  transparent={xrayMode || colorByPart || !!boxSelection}
  opacity={xrayMode ? 0.3 : 1}
/>
```

- [ ] **Step 4: Build to verify**

Run: `cd tools && pnpm --filter @gseurat/echidna build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add tools/apps/echidna/src/App.tsx tools/apps/echidna/src/viewport/VoxelMesh.tsx
git commit -m "feat(echidna): add keyboard shortcuts and viewport handlers for fill, extrude, lasso, xray, clipboard"
```

---

## Task 8: Animation interpolation in viewport

**Files:**
- Modify: `tools/apps/echidna/src/viewport/VoxelMesh.tsx`

- [ ] **Step 1: Replace step interpolation with eased interpolation**

In VoxelMesh.tsx, find the `interpolatePoses` function and replace it with an eased version:

```tsx
import { applyEasing } from '../lib/easing.js';
import type { EasingType, AnimationKeyframe } from '../store/types.js';

function interpolateRotation(
  from: [number, number, number],
  to: [number, number, number],
  t: number, // raw 0..1
  easing: EasingType,
  curve?: [number, number, number, number],
): [number, number, number] {
  const e = applyEasing(easing, t, curve);
  return [
    from[0] + (to[0] - from[0]) * e,
    from[1] + (to[1] - from[1]) * e,
    from[2] + (to[2] - from[2]) * e,
  ];
}

function interpolatePosesEased(
  keyframes: AnimationKeyframe[],
  poses: Record<string, { rotations: Record<string, [number, number, number]> }>,
  time: number,
  partId: string,
): [number, number, number] {
  if (keyframes.length === 0) return [0, 0, 0];

  // Find relevant keyframes for this part
  const relevantKfs = keyframes.filter((kf) => !kf.parts || kf.parts.includes(partId));
  if (relevantKfs.length === 0) return [0, 0, 0];

  // Find the two keyframes surrounding `time`
  let prevKf = relevantKfs[0];
  let nextKf = relevantKfs[relevantKfs.length - 1];

  for (let i = 0; i < relevantKfs.length - 1; i++) {
    if (time >= relevantKfs[i].time && time < relevantKfs[i + 1].time) {
      prevKf = relevantKfs[i];
      nextKf = relevantKfs[i + 1];
      break;
    }
  }

  if (time <= prevKf.time) {
    const pose = poses[prevKf.poseName];
    return pose?.rotations[partId] ?? [0, 0, 0];
  }
  if (time >= nextKf.time) {
    const pose = poses[nextKf.poseName];
    return pose?.rotations[partId] ?? [0, 0, 0];
  }

  const fromPose = poses[prevKf.poseName];
  const toPose = poses[nextKf.poseName];
  const fromRot = fromPose?.rotations[partId] ?? [0, 0, 0];
  const toRot = toPose?.rotations[partId] ?? [0, 0, 0];

  const range = nextKf.time - prevKf.time;
  const t = range > 0 ? (time - prevKf.time) / range : 0;

  return interpolateRotation(fromRot, toRot, t, prevKf.easing, prevKf.curve);
}
```

Replace calls to the old `interpolatePoses` with `interpolatePosesEased` — pass `partId` to get per-part rotation.

- [ ] **Step 2: Add onion skinning ghost rendering**

Add ghost voxels for onion skinning (previous + next keyframe poses):

```tsx
const onionSkinning = useCharacterStore((s) => s.onionSkinning);
const playbackTime = useCharacterStore((s) => s.playbackTime);

// In the render, after the main InstancedMesh:
{onionSkinning && isPlaying && (
  <>
    {/* Past ghost (blue tint, 20% opacity) */}
    <OnionGhost
      keyframes={keyframes}
      poses={characterPoses}
      parts={characterParts}
      voxels={voxels}
      time={prevKeyframeTime}
      tint={[0.3, 0.3, 1.0]}
      opacity={0.2}
    />
    {/* Future ghost (red tint, 20% opacity) */}
    <OnionGhost
      keyframes={keyframes}
      poses={characterPoses}
      parts={characterParts}
      voxels={voxels}
      time={nextKeyframeTime}
      tint={[1.0, 0.3, 0.3]}
      opacity={0.2}
    />
  </>
)}
```

The `OnionGhost` component is a simplified `InstancedMesh` that computes FK transforms at a specific time and renders all voxels with a tint color and low opacity. It reuses the same `computeFKTransforms` and `interpolatePosesEased` functions.

```tsx
function OnionGhost({
  keyframes, poses, parts, voxels, time, tint, opacity,
}: {
  keyframes: AnimationKeyframe[];
  poses: Record<string, { rotations: Record<string, [number, number, number]> }>;
  parts: BodyPart[];
  voxels: Map<VoxelKey, Voxel>;
  time: number;
  tint: [number, number, number];
  opacity: number;
}) {
  const entries = useMemo(() => Array.from(voxels.entries()), [voxels]);
  const count = entries.length;
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    if (!meshRef.current || count === 0) return;
    const mesh = meshRef.current;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    const rotations: Record<string, [number, number, number]> = {};
    for (const part of parts) {
      rotations[part.id] = interpolatePosesEased(keyframes, poses, time, part.id);
    }
    const fk = computeFKTransforms(parts, rotations);

    for (let i = 0; i < count; i++) {
      const [key] = entries[i];
      const [x, y, z] = parseKey(key);
      dummy.position.set(x, y, z);
      // Apply FK transform if assigned to a part
      // (simplified — apply same transform logic as main mesh)
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      color.setRGB(tint[0], tint[1], tint[2]);
      mesh.setColorAt(i, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [entries, keyframes, poses, parts, time, tint, count]);

  if (count === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial transparent opacity={opacity} vertexColors />
    </instancedMesh>
  );
}
```

- [ ] **Step 3: Build to verify**

Run: `cd tools && pnpm --filter @gseurat/echidna build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add tools/apps/echidna/src/viewport/VoxelMesh.tsx
git commit -m "feat(echidna): add eased animation interpolation, per-part keyframes, and onion skinning"
```

---

## Task 9: Animation panel UI updates

**Files:**
- Modify: `tools/apps/echidna/src/panels/AnimateRightPanel.tsx`
- Modify: `tools/apps/echidna/src/panels/Timeline.tsx`
- Create: `tools/apps/echidna/src/panels/BezierCurveEditor.tsx`

- [ ] **Step 1: Add easing dropdown to AnimateRightPanel**

In the keyframe properties section of `AnimateRightPanel.tsx`, add an easing selector:

```tsx
import type { EasingType } from '../store/types.js';

const easingOptions: { value: EasingType; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'ease-in-out', label: 'Ease In/Out' },
  { value: 'bounce', label: 'Bounce' },
  { value: 'elastic', label: 'Elastic' },
  { value: 'step', label: 'Step' },
  { value: 'custom', label: 'Custom Curve' },
];

// In the keyframe editing section:
<div style={panelStyles.section}>
  <span style={panelStyles.label}>Easing</span>
  <select
    value={selectedKeyframe.easing}
    onChange={(e) => updateKeyframeEasing(animName, kfIndex, e.target.value as EasingType)}
    style={panelStyles.select}
  >
    {easingOptions.map((opt) => (
      <option key={opt.value} value={opt.value}>{opt.label}</option>
    ))}
  </select>
  {selectedKeyframe.easing === 'custom' && (
    <BezierCurveEditor
      value={selectedKeyframe.curve ?? [0.25, 0.1, 0.25, 1]}
      onChange={(curve) => updateKeyframeCurve(animName, kfIndex, curve)}
    />
  )}
</div>
```

Add per-part scope checkboxes:

```tsx
<div style={panelStyles.section}>
  <span style={panelStyles.label}>Affected Parts</span>
  <label>
    <input
      type="checkbox"
      checked={!selectedKeyframe.parts}
      onChange={(e) => updateKeyframeParts(animName, kfIndex, e.target.checked ? undefined : [])}
    />
    All Parts
  </label>
  {selectedKeyframe.parts && characterParts.map((part) => (
    <label key={part.id}>
      <input
        type="checkbox"
        checked={selectedKeyframe.parts!.includes(part.id)}
        onChange={(e) => {
          const current = selectedKeyframe.parts ?? [];
          const next = e.target.checked
            ? [...current, part.id]
            : current.filter((id) => id !== part.id);
          updateKeyframeParts(animName, kfIndex, next);
        }}
      />
      {part.name}
    </label>
  ))}
</div>
```

- [ ] **Step 2: Add playback mode and onion skinning to Timeline**

In `Timeline.tsx`, add controls:

```tsx
import type { PlaybackMode } from '../store/types.js';

// Playback mode selector
<select
  value={playbackMode}
  onChange={(e) => setPlaybackMode(e.target.value as PlaybackMode)}
  style={{ fontSize: 11, background: '#2a2a4a', color: '#ddd', border: '1px solid #444', borderRadius: 3 }}
>
  <option value="loop">Loop</option>
  <option value="ping-pong">Ping-Pong</option>
  <option value="once">Once</option>
</select>

// Onion skinning toggle
<button
  onClick={() => setOnionSkinning(!onionSkinning)}
  style={{
    ...panelStyles.btn,
    background: onionSkinning ? '#4a4a7a' : '#3a3a6a',
    borderColor: onionSkinning ? '#77f' : '#555',
  }}
>
  👻 Onion
</button>
```

- [ ] **Step 3: Create BezierCurveEditor**

```tsx
// tools/apps/echidna/src/panels/BezierCurveEditor.tsx
import React, { useCallback, useRef } from 'react';

interface Props {
  value: [number, number, number, number]; // [cx1, cy1, cx2, cy2]
  onChange: (v: [number, number, number, number]) => void;
}

const W = 200;
const H = 150;
const PAD = 10;

function toCanvasX(v: number): number { return PAD + v * (W - 2 * PAD); }
function toCanvasY(v: number): number { return H - PAD - v * (H - 2 * PAD); }
function fromCanvasX(px: number): number { return Math.max(0, Math.min(1, (px - PAD) / (W - 2 * PAD))); }
function fromCanvasY(py: number): number { return Math.max(-0.5, Math.min(1.5, (H - PAD - py) / (H - 2 * PAD))); }

export function BezierCurveEditor({ value, onChange }: Props) {
  const [cx1, cy1, cx2, cy2] = value;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef<1 | 2 | null>(null);

  const draw = useCallback(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const x = toCanvasX(i / 4);
      const y = toCanvasY(i / 4);
      ctx.beginPath(); ctx.moveTo(x, PAD); ctx.lineTo(x, H - PAD); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
    }

    // Curve
    ctx.strokeStyle = '#77f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(toCanvasX(0), toCanvasY(0));
    ctx.bezierCurveTo(
      toCanvasX(cx1), toCanvasY(cy1),
      toCanvasX(cx2), toCanvasY(cy2),
      toCanvasX(1), toCanvasY(1),
    );
    ctx.stroke();

    // Control handles
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(toCanvasX(0), toCanvasY(0)); ctx.lineTo(toCanvasX(cx1), toCanvasY(cy1)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(toCanvasX(1), toCanvasY(1)); ctx.lineTo(toCanvasX(cx2), toCanvasY(cy2)); ctx.stroke();

    // Control points
    for (const [px, py] of [[cx1, cy1], [cx2, cy2]]) {
      ctx.fillStyle = '#ff0';
      ctx.beginPath();
      ctx.arc(toCanvasX(px), toCanvasY(py), 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [cx1, cy1, cx2, cy2]);

  React.useEffect(() => { draw(); }, [draw]);

  const handlePointerDown = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const d1 = Math.hypot(px - toCanvasX(cx1), py - toCanvasY(cy1));
    const d2 = Math.hypot(px - toCanvasX(cx2), py - toCanvasY(cy2));
    if (d1 < 12) draggingRef.current = 1;
    else if (d2 < 12) draggingRef.current = 2;
    else return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const nx = fromCanvasX(e.clientX - rect.left);
    const ny = fromCanvasY(e.clientY - rect.top);
    if (draggingRef.current === 1) onChange([nx, ny, cx2, cy2]);
    else onChange([cx1, cy1, nx, ny]);
  };

  const handlePointerUp = () => { draggingRef.current = null; };

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      style={{ borderRadius: 4, border: '1px solid #444', cursor: 'crosshair' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    />
  );
}
```

- [ ] **Step 4: Build to verify**

Run: `cd tools && pnpm --filter @gseurat/echidna build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add tools/apps/echidna/src/panels/AnimateRightPanel.tsx tools/apps/echidna/src/panels/Timeline.tsx tools/apps/echidna/src/panels/BezierCurveEditor.tsx
git commit -m "feat(echidna): add easing dropdown, per-part keyframes UI, bezier editor, onion skinning toggle"
```

---

## Task 10: Update manifest export for new animation fields

**Files:**
- Modify: `tools/apps/echidna/src/lib/manifestExport.ts`
- Modify: `tools/apps/echidna/src/__tests__/manifestExport.test.ts`

- [ ] **Step 1: Write failing tests for new manifest fields**

Add to `manifestExport.test.ts`:

```ts
import type { EasingType } from '../store/types.js';

const mockAnimationsV2: Record<string, AnimationClip> = {
  jump: {
    name: 'jump',
    duration: 0.8,
    playbackMode: 'once',
    keyframes: [
      { time: 0, poseName: 'idle', easing: 'ease-in-out' },
      { time: 0.3, poseName: 'crouch', easing: 'bounce' },
      { time: 0.5, poseName: 'air', easing: 'elastic', parts: ['legs', 'torso'] },
      { time: 0.8, poseName: 'idle', easing: 'step' },
    ],
  },
};

describe('buildManifest v2 fields', () => {
  it('exports easing per keyframe', () => {
    const manifest = buildManifest('char', 'char.ply', 1.0, mockParts, mockPoses, mockAnimationsV2);
    const clip = manifest.animations['jump'];
    expect(clip.keyframes[0].easing).toBe('ease-in-out');
    expect(clip.keyframes[1].easing).toBe('bounce');
    expect(clip.keyframes[2].easing).toBe('elastic');
    expect(clip.keyframes[3].easing).toBe('step');
  });

  it('exports per-part scope when present', () => {
    const manifest = buildManifest('char', 'char.ply', 1.0, mockParts, mockPoses, mockAnimationsV2);
    const clip = manifest.animations['jump'];
    expect(clip.keyframes[0].parts).toBeUndefined();
    expect(clip.keyframes[2].parts).toEqual(['legs', 'torso']);
  });

  it('exports playbackMode (non-looping)', () => {
    const manifest = buildManifest('char', 'char.ply', 1.0, mockParts, mockPoses, mockAnimationsV2);
    const clip = manifest.animations['jump'];
    expect(clip.looping).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd tools && pnpm --filter @gseurat/echidna test -- --reporter verbose 2>&1 | tail -20`
Expected: FAIL — easing/parts properties not in manifest output

- [ ] **Step 3: Update manifestExport.ts**

```ts
// tools/apps/echidna/src/lib/manifestExport.ts — full replacement
import type { BodyPart, PoseData, AnimationClip, EasingType } from '../store/types.js';

export interface ManifestBone {
  id: string;
  parent: string | null;
  joint: [number, number, number];
}

export interface ManifestKeyframe {
  time: number;
  pose: string;
  easing?: EasingType;
  curve?: [number, number, number, number];
  parts?: string[];
}

export interface ManifestAnimationClip {
  duration: number;
  looping: boolean;
  keyframes: ManifestKeyframe[];
}

export interface CharacterManifest {
  name: string;
  ply_file: string;
  scale: number;
  bones: ManifestBone[];
  poses: Record<string, Record<string, [number, number, number]>>;
  animations: Record<string, ManifestAnimationClip>;
}

export function buildManifest(
  name: string,
  plyFile: string,
  scale: number,
  parts: BodyPart[],
  poses: Record<string, PoseData>,
  animations: Record<string, AnimationClip>,
): CharacterManifest {
  const bones: ManifestBone[] = parts.map((p) => ({
    id: p.id,
    parent: p.parent,
    joint: p.joint,
  }));

  const manifestPoses: Record<string, Record<string, [number, number, number]>> = {};
  for (const [poseName, poseData] of Object.entries(poses)) {
    manifestPoses[poseName] = { ...poseData.rotations };
  }

  const manifestAnimations: Record<string, ManifestAnimationClip> = {};
  for (const [animName, clip] of Object.entries(animations)) {
    const looping = (clip.playbackMode ?? 'loop') === 'loop' || (clip.playbackMode ?? 'loop') === 'ping-pong';
    manifestAnimations[animName] = {
      duration: clip.duration,
      looping,
      keyframes: clip.keyframes.map((kf) => {
        const mkf: ManifestKeyframe = {
          time: kf.time,
          pose: kf.poseName,
        };
        if (kf.easing && kf.easing !== 'step') mkf.easing = kf.easing;
        if (kf.curve) mkf.curve = kf.curve;
        if (kf.parts) mkf.parts = kf.parts;
        return mkf;
      }),
    };
  }

  return {
    name,
    ply_file: plyFile,
    scale,
    bones,
    poses: manifestPoses,
    animations: manifestAnimations,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tools && pnpm --filter @gseurat/echidna test -- --reporter verbose`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add tools/apps/echidna/src/lib/manifestExport.ts tools/apps/echidna/src/__tests__/manifestExport.test.ts
git commit -m "feat(echidna): export easing, per-part scope, and playbackMode in character manifest"
```

---

## Task 11: PLY import with bone support

**Files:**
- Create: `tools/apps/echidna/src/lib/plyImport.ts`
- Create: `tools/apps/echidna/src/__tests__/plyImport.test.ts`

- [ ] **Step 1: Write failing tests for PLY import**

```ts
// tools/apps/echidna/src/__tests__/plyImport.test.ts
import { describe, it, expect } from 'vitest';
import { parsePlyToVoxels } from '../lib/plyImport.js';
import { exportPly } from '../lib/plyExport.js';
import { voxelKey } from '../lib/voxelUtils.js';
import type { BodyPart, Voxel, VoxelKey } from '../store/types.js';

describe('parsePlyToVoxels', () => {
  it('imports a single-voxel unrigged PLY', async () => {
    // Create a PLY blob from a single voxel
    const voxels = new Map<VoxelKey, Voxel>();
    voxels.set(voxelKey(5, 3, 5), { color: [255, 128, 64, 255] });
    const blob = exportPly(voxels, 10, 10);
    const buffer = await blob.arrayBuffer();

    const result = parsePlyToVoxels(buffer, 10);
    expect(result.voxels.size).toBeGreaterThanOrEqual(1);
    expect(result.parts).toHaveLength(1); // single "root" part
    expect(result.parts[0].id).toBe('root');
  });

  it('imports rigged PLY and reconstructs parts from bone_index', async () => {
    const voxels = new Map<VoxelKey, Voxel>();
    voxels.set(voxelKey(0, 0, 0), { color: [255, 0, 0, 255] });
    voxels.set(voxelKey(5, 5, 5), { color: [0, 255, 0, 255] });

    const parts: BodyPart[] = [
      { id: 'head', name: 'head', parent: null, joint: [0, 0, 0], voxelKeys: [voxelKey(0, 0, 0)] },
      { id: 'body', name: 'body', parent: null, joint: [0, 0, 0], voxelKeys: [voxelKey(5, 5, 5)] },
    ];

    const blob = exportPly(voxels, 10, 10, parts);
    const buffer = await blob.arrayBuffer();

    const result = parsePlyToVoxels(buffer, 10);
    expect(result.parts.length).toBe(2);
    // Each part should have at least 1 voxel
    expect(result.parts[0].voxelKeys.length).toBeGreaterThanOrEqual(1);
    expect(result.parts[1].voxelKeys.length).toBeGreaterThanOrEqual(1);
  });

  it('auto-detects grid size from bounding box', async () => {
    const voxels = new Map<VoxelKey, Voxel>();
    voxels.set(voxelKey(0, 0, 0), { color: [255, 0, 0, 255] });
    voxels.set(voxelKey(30, 10, 30), { color: [0, 255, 0, 255] });
    const blob = exportPly(voxels, 32, 32);
    const buffer = await blob.arrayBuffer();

    const result = parsePlyToVoxels(buffer);
    expect(result.gridSize).toBeGreaterThanOrEqual(32);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd tools && pnpm --filter @gseurat/echidna test -- --reporter verbose 2>&1 | head -15`
Expected: FAIL — `parsePlyToVoxels` not found

- [ ] **Step 3: Implement PLY import**

```ts
// tools/apps/echidna/src/lib/plyImport.ts
import type { Voxel, VoxelKey, BodyPart } from '../store/types.js';
import { voxelKey } from './voxelUtils.js';

export interface PlyImportResult {
  voxels: Map<VoxelKey, Voxel>;
  parts: BodyPart[];
  gridSize: number;
}

/** Parse a binary PLY header, returning property names and vertex count. */
function parseHeader(buffer: ArrayBuffer): {
  vertexCount: number;
  properties: string[];
  headerLength: number;
} {
  const bytes = new Uint8Array(buffer);
  let headerEnd = 0;
  const marker = 'end_header\n';
  const text = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
  const idx = text.indexOf(marker);
  if (idx === -1) throw new Error('Invalid PLY: no end_header found');
  headerEnd = new TextEncoder().encode(text.slice(0, idx + marker.length)).length;

  const lines = text.slice(0, idx).split('\n');
  let vertexCount = 0;
  const properties: string[] = [];

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'element' && parts[1] === 'vertex') {
      vertexCount = parseInt(parts[2], 10);
    }
    if (parts[0] === 'property') {
      properties.push(parts[parts.length - 1]);
    }
  }

  return { vertexCount, properties, headerLength: headerEnd };
}

/** Round to nearest power of 2 >= n. */
function nextPow2(n: number): number {
  let v = Math.max(8, Math.ceil(n));
  v--;
  v |= v >> 1; v |= v >> 2; v |= v >> 4;
  v |= v >> 8; v |= v >> 16;
  return v + 1;
}

const SH_FACTOR = 0.2820947917738781;

export function parsePlyToVoxels(buffer: ArrayBuffer, gridSizeOverride?: number): PlyImportResult {
  const { vertexCount, properties, headerLength } = parseHeader(buffer);
  const view = new DataView(buffer);

  const hasBoneIndex = properties.includes('bone_index');
  const propNames = properties;

  // Compute bytes per vertex
  let bytesPerVertex = 0;
  for (const prop of propNames) {
    if (prop === 'bone_index') bytesPerVertex += 1;
    else bytesPerVertex += 4; // float
  }

  const xIdx = propNames.indexOf('x');
  const yIdx = propNames.indexOf('y');
  const zIdx = propNames.indexOf('z');
  const dcIdx0 = propNames.indexOf('f_dc_0');
  const dcIdx1 = propNames.indexOf('f_dc_1');
  const dcIdx2 = propNames.indexOf('f_dc_2');
  const opacityIdx = propNames.indexOf('opacity');
  const boneIdx = propNames.indexOf('bone_index');

  // Read all vertices
  interface RawVertex {
    x: number; y: number; z: number;
    r: number; g: number; b: number; a: number;
    bone: number;
  }

  const vertices: RawVertex[] = [];
  let offset = headerLength;

  for (let i = 0; i < vertexCount; i++) {
    let propOffset = 0;
    const vals: number[] = [];
    let bone = 0;

    for (let p = 0; p < propNames.length; p++) {
      if (propNames[p] === 'bone_index') {
        bone = view.getUint8(offset + propOffset);
        propOffset += 1;
      } else {
        vals[p] = view.getFloat32(offset + propOffset, true);
        propOffset += 4;
      }
    }

    // Decode SH DC → RGB
    const sh0 = dcIdx0 >= 0 ? vals[dcIdx0] : 0;
    const sh1 = dcIdx1 >= 0 ? vals[dcIdx1] : 0;
    const sh2 = dcIdx2 >= 0 ? vals[dcIdx2] : 0;
    const r = Math.round(Math.max(0, Math.min(255, (sh0 * SH_FACTOR + 0.5) * 255)));
    const g = Math.round(Math.max(0, Math.min(255, (sh1 * SH_FACTOR + 0.5) * 255)));
    const b = Math.round(Math.max(0, Math.min(255, (sh2 * SH_FACTOR + 0.5) * 255)));

    // Decode opacity (inverse logit / sigmoid)
    const logit = opacityIdx >= 0 ? vals[opacityIdx] : 5;
    const alpha = Math.round(Math.max(0, Math.min(255, 1 / (1 + Math.exp(-logit)) * 255)));

    vertices.push({
      x: xIdx >= 0 ? vals[xIdx] : 0,
      y: yIdx >= 0 ? vals[yIdx] : 0,
      z: zIdx >= 0 ? vals[zIdx] : 0,
      r, g, b, a: alpha,
      bone,
    });

    offset += propOffset;
  }

  // Determine bounding box
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const v of vertices) {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.z < minZ) minZ = v.z;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
    if (v.z > maxZ) maxZ = v.z;
  }

  const rangeX = maxX - minX;
  const rangeZ = maxZ - minZ;
  const gridSize = gridSizeOverride ?? nextPow2(Math.max(rangeX, rangeZ) + 2);

  // Quantize to grid — shift so positions start near center
  const offsetX = gridSize / 2;
  const offsetY = (maxY - minY) / 2;

  const voxelMap = new Map<VoxelKey, Voxel>();
  const voxelBones = new Map<VoxelKey, number>();
  const colorAccum = new Map<VoxelKey, { r: number; g: number; b: number; a: number; count: number }>();

  for (const v of vertices) {
    const gx = Math.round(v.x + offsetX);
    const gy = Math.round(v.y + offsetY);
    const gz = Math.round(v.z);
    const key = voxelKey(gx, gy, gz);

    const existing = colorAccum.get(key);
    if (existing) {
      existing.r += v.r;
      existing.g += v.g;
      existing.b += v.b;
      existing.a += v.a;
      existing.count++;
    } else {
      colorAccum.set(key, { r: v.r, g: v.g, b: v.b, a: v.a, count: 1 });
      voxelBones.set(key, v.bone);
    }
  }

  // Average colors
  for (const [key, acc] of colorAccum) {
    voxelMap.set(key, {
      color: [
        Math.round(acc.r / acc.count),
        Math.round(acc.g / acc.count),
        Math.round(acc.b / acc.count),
        Math.round(acc.a / acc.count),
      ],
    });
  }

  // Build parts from bone indices
  const boneGroups = new Map<number, VoxelKey[]>();
  for (const [key, bone] of voxelBones) {
    const group = boneGroups.get(bone) ?? [];
    group.push(key);
    boneGroups.set(bone, group);
  }

  const parts: BodyPart[] = [];
  if (!hasBoneIndex || boneGroups.size <= 1) {
    // Single root part
    parts.push({
      id: 'root',
      name: 'root',
      parent: null,
      joint: [Math.round(gridSize / 2), 0, Math.round(gridSize / 2)],
      voxelKeys: Array.from(voxelMap.keys()),
    });
  } else {
    // One part per bone index
    const sortedBones = Array.from(boneGroups.entries()).sort((a, b) => a[0] - b[0]);
    for (const [boneIndex, keys] of sortedBones) {
      // Compute centroid for joint
      let jx = 0, jy = 0, jz = 0;
      for (const key of keys) {
        const [x, y, z] = key.split(',').map(Number);
        jx += x; jy += y; jz += z;
      }
      const n = keys.length;
      parts.push({
        id: `bone_${boneIndex}`,
        name: `bone_${boneIndex}`,
        parent: boneIndex === 0 ? null : 'bone_0',
        joint: [Math.round(jx / n), Math.round(jy / n), Math.round(jz / n)],
        voxelKeys: keys,
      });
    }
  }

  return { voxels: voxelMap, parts, gridSize };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tools && pnpm --filter @gseurat/echidna test -- --reporter verbose`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add tools/apps/echidna/src/lib/plyImport.ts tools/apps/echidna/src/__tests__/plyImport.test.ts
git commit -m "feat(echidna): add PLY import with bone_index support and voxelization"
```

---

## Task 12: OBJ import with voxelization

**Files:**
- Create: `tools/apps/echidna/src/lib/objImport.ts`
- Create: `tools/apps/echidna/src/__tests__/objImport.test.ts`

- [ ] **Step 1: Write failing tests for OBJ import**

```ts
// tools/apps/echidna/src/__tests__/objImport.test.ts
import { describe, it, expect } from 'vitest';
import { parseObjToVoxels } from '../lib/objImport.js';

// Minimal OBJ: a single triangle
const TRIANGLE_OBJ = `
v 0 0 0
v 5 0 0
v 0 5 0
f 1 2 3
`;

// A unit cube OBJ
const CUBE_OBJ = `
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v 0 0 1
v 1 0 1
v 1 1 1
v 0 1 1
f 1 2 3 4
f 5 6 7 8
f 1 2 6 5
f 2 3 7 6
f 3 4 8 7
f 4 1 5 8
`;

describe('parseObjToVoxels', () => {
  it('produces at least one voxel from a triangle', () => {
    const result = parseObjToVoxels(TRIANGLE_OBJ, 16);
    expect(result.voxels.size).toBeGreaterThan(0);
    expect(result.gridSize).toBe(16);
  });

  it('produces voxels for a cube', () => {
    const result = parseObjToVoxels(CUBE_OBJ, 8);
    expect(result.voxels.size).toBeGreaterThan(0);
  });

  it('returns a single root part (unrigged)', () => {
    const result = parseObjToVoxels(TRIANGLE_OBJ, 16);
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0].id).toBe('root');
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd tools && pnpm --filter @gseurat/echidna test -- --reporter verbose 2>&1 | head -15`
Expected: FAIL

- [ ] **Step 3: Implement OBJ import with ray-cast voxelization**

```ts
// tools/apps/echidna/src/lib/objImport.ts
import type { Voxel, VoxelKey, BodyPart } from '../store/types.js';
import { voxelKey } from './voxelUtils.js';

export interface ObjImportResult {
  voxels: Map<VoxelKey, Voxel>;
  parts: BodyPart[];
  gridSize: number;
}

interface Vec3 { x: number; y: number; z: number; }
interface Triangle { v0: Vec3; v1: Vec3; v2: Vec3; color: [number, number, number, number]; }

function parseObj(text: string): { vertices: Vec3[]; triangles: Triangle[] } {
  const vertices: Vec3[] = [];
  const triangles: Triangle[] = [];
  const defaultColor: [number, number, number, number] = [180, 180, 180, 255];

  for (const line of text.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'v' && parts.length >= 4) {
      vertices.push({
        x: parseFloat(parts[1]),
        y: parseFloat(parts[2]),
        z: parseFloat(parts[3]),
      });
    } else if (parts[0] === 'f') {
      // Parse face — supports "v", "v/vt", "v/vt/vn", "v//vn"
      const indices = parts.slice(1).map((p) => parseInt(p.split('/')[0], 10) - 1);
      // Triangulate fan
      for (let i = 1; i < indices.length - 1; i++) {
        triangles.push({
          v0: vertices[indices[0]],
          v1: vertices[indices[i]],
          v2: vertices[indices[i + 1]],
          color: [...defaultColor],
        });
      }
    }
  }

  return { vertices, triangles };
}

/** Check if a ray from (x, y, z) in +axisDir intersects a triangle.
 *  Returns the intersection distance or null. */
function rayTriangleIntersect(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  tri: Triangle,
): number | null {
  const EPSILON = 1e-6;
  const e1x = tri.v1.x - tri.v0.x, e1y = tri.v1.y - tri.v0.y, e1z = tri.v1.z - tri.v0.z;
  const e2x = tri.v2.x - tri.v0.x, e2y = tri.v2.y - tri.v0.y, e2z = tri.v2.z - tri.v0.z;

  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;

  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < EPSILON) return null;

  const invDet = 1 / det;
  const tx = ox - tri.v0.x, ty = oy - tri.v0.y, tz = oz - tri.v0.z;
  const u = (tx * px + ty * py + tz * pz) * invDet;
  if (u < 0 || u > 1) return null;

  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * invDet;
  if (v < 0 || u + v > 1) return null;

  const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
  return t > EPSILON ? t : null;
}

export function parseObjToVoxels(text: string, gridSize: number): ObjImportResult {
  const { vertices, triangles } = parseObj(text);

  if (vertices.length === 0 || triangles.length === 0) {
    return { voxels: new Map(), parts: [{ id: 'root', name: 'root', parent: null, joint: [0, 0, 0], voxelKeys: [] }], gridSize };
  }

  // Bounding box
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const v of vertices) {
    if (v.x < minX) minX = v.x; if (v.y < minY) minY = v.y; if (v.z < minZ) minZ = v.z;
    if (v.x > maxX) maxX = v.x; if (v.y > maxY) maxY = v.y; if (v.z > maxZ) maxZ = v.z;
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const rangeZ = maxZ - minZ || 1;
  const maxRange = Math.max(rangeX, rangeY, rangeZ);
  const scale = (gridSize - 2) / maxRange; // leave 1-cell margin

  // Voxelize using 3-axis ray casting
  const filled = new Set<string>();
  const voxelMap = new Map<VoxelKey, Voxel>();
  const defaultColor: [number, number, number, number] = [180, 180, 180, 255];

  // Cast rays along each axis
  const axes: [number, number, number][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

  for (const [dx, dy, dz] of axes) {
    for (let a = 0; a < gridSize; a++) {
      for (let b = 0; b < gridSize; b++) {
        // Determine ray origin in world space
        let ox: number, oy: number, oz: number;
        if (dx === 1) { ox = minX - 1; oy = minY + (a + 0.5) / scale; oz = minZ + (b + 0.5) / scale; }
        else if (dy === 1) { ox = minX + (a + 0.5) / scale; oy = minY - 1; oz = minZ + (b + 0.5) / scale; }
        else { ox = minX + (a + 0.5) / scale; oy = minY + (b + 0.5) / scale; oz = minZ - 1; }

        // Collect intersection distances
        const hits: number[] = [];
        for (const tri of triangles) {
          const t = rayTriangleIntersect(ox, oy, oz, dx, dy, dz, tri);
          if (t !== null) hits.push(t);
        }
        hits.sort((a, b) => a - b);

        // Parity rule: inside between odd pairs
        for (let h = 0; h < hits.length - 1; h += 2) {
          const tStart = hits[h];
          const tEnd = hits[h + 1];
          // Convert to grid coordinates
          for (let t = Math.floor(tStart * scale); t <= Math.ceil(tEnd * scale); t++) {
            let gx: number, gy: number, gz: number;
            if (dx === 1) { gx = Math.round((ox + t / scale - minX) * scale); gy = a; gz = b; }
            else if (dy === 1) { gx = a; gy = Math.round((oy + t / scale - minY) * scale); gz = b; }
            else { gx = a; gy = b; gz = Math.round((oz + t / scale - minZ) * scale); }
            if (gx >= 0 && gx < gridSize && gy >= 0 && gz >= 0 && gz < gridSize) {
              const key = voxelKey(gx, gy, gz);
              if (!filled.has(key)) {
                filled.add(key);
                voxelMap.set(key, { color: [...defaultColor] });
              }
            }
          }
        }
      }
    }
  }

  const allKeys = Array.from(voxelMap.keys());
  const parts: BodyPart[] = [{
    id: 'root',
    name: 'root',
    parent: null,
    joint: [Math.round(gridSize / 2), 0, Math.round(gridSize / 2)],
    voxelKeys: allKeys,
  }];

  return { voxels: voxelMap, parts, gridSize };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd tools && pnpm --filter @gseurat/echidna test -- --reporter verbose`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add tools/apps/echidna/src/lib/objImport.ts tools/apps/echidna/src/__tests__/objImport.test.ts
git commit -m "feat(echidna): add OBJ import with ray-cast voxelization"
```

---

## Task 13: Enhanced .vox import (LAYR chunk names)

**Files:**
- Modify: `tools/apps/echidna/src/lib/voxImport.ts`

- [ ] **Step 1: Add LAYR chunk parsing**

In `voxImport.ts`, add parsing for LAYR chunks inside `parseChunks`:

```ts
const layerNames: Map<number, string> = new Map();

// Inside parseChunks, add after RGBA handling:
} else if (chunkId === 'LAYR') {
  const layerId = view.getInt32(contentStart, true);
  // Parse DICT: nPairs (i32), then pairs of (string_len + string) × 2
  let dictPos = contentStart + 4;
  const nPairs = view.getInt32(dictPos, true);
  dictPos += 4;
  for (let p = 0; p < nPairs; p++) {
    const keyLen = view.getInt32(dictPos, true);
    dictPos += 4;
    const key = readString(view, dictPos, keyLen);
    dictPos += keyLen;
    const valLen = view.getInt32(dictPos, true);
    dictPos += 4;
    const val = readString(view, dictPos, valLen);
    dictPos += valLen;
    if (key === '_name' && val) {
      layerNames.set(layerId, val);
    }
  }
}
```

Then when building models, use layer names if available:

```ts
// In the models loop, after building voxelMap:
const modelName = layerNames.get(i) ?? `model_${i}`;
models.push({
  sizeX: size.x,
  sizeY: size.z,
  sizeZ: size.y,
  voxels: voxelMap,
  name: modelName,  // Add this field
});
```

Add `name` to `VoxModel`:

```ts
export interface VoxModel {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  voxels: Map<VoxelKey, Voxel>;
  name?: string;
}
```

- [ ] **Step 2: Build to verify**

Run: `cd tools && pnpm --filter @gseurat/echidna build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add tools/apps/echidna/src/lib/voxImport.ts
git commit -m "feat(echidna): parse LAYR chunk names from .vox files for model naming"
```

---

## Task 14: Import dialog and MenuBar wiring

**Files:**
- Create: `tools/apps/echidna/src/panels/ImportDialog.tsx`
- Modify: `tools/apps/echidna/src/panels/MenuBar.tsx`
- Modify: `tools/apps/echidna/src/store/useCharacterStore.ts`

- [ ] **Step 1: Create ImportDialog component**

```tsx
// tools/apps/echidna/src/panels/ImportDialog.tsx
import React, { useState, useRef } from 'react';
import { NumberInput, panelStyles } from '@gseurat/ui-kit';

interface Props {
  onImport: (file: File, options: ImportOptions) => void;
  onCancel: () => void;
}

export interface ImportOptions {
  gridSize: number;
  loadManifest: boolean;
  voxelResolution: number; // cells per unit for OBJ
}

export function ImportDialog({ onImport, onCancel }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [gridSize, setGridSize] = useState(32);
  const [loadManifest, setLoadManifest] = useState(true);
  const [voxelResolution, setVoxelResolution] = useState(32);
  const inputRef = useRef<HTMLInputElement>(null);

  const ext = file?.name.split('.').pop()?.toLowerCase();

  return (
    <div style={{
      position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)', zIndex: 1000,
    }}>
      <div style={{
        background: '#1e1e3a', border: '1px solid #555', borderRadius: 8, padding: 20,
        minWidth: 340, display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        <h3 style={{ margin: 0, color: '#ddd' }}>Import Model</h3>

        <div>
          <button style={panelStyles.btn} onClick={() => inputRef.current?.click()}>
            Choose File...
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".ply,.vox,.obj"
            style={{ display: 'none' }}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {file && <span style={{ marginLeft: 8, color: '#aaa', fontSize: 12 }}>{file.name}</span>}
        </div>

        <div style={panelStyles.section}>
          <span style={panelStyles.label}>Grid Size</span>
          <NumberInput value={gridSize} onChange={setGridSize} min={8} max={1024} step={1} />
        </div>

        {ext === 'ply' && (
          <label style={{ color: '#ccc', fontSize: 12 }}>
            <input type="checkbox" checked={loadManifest} onChange={(e) => setLoadManifest(e.target.checked)} />
            Look for companion manifest (.json)
          </label>
        )}

        {ext === 'obj' && (
          <div style={panelStyles.section}>
            <span style={panelStyles.label}>Voxel Resolution</span>
            <NumberInput value={voxelResolution} onChange={setVoxelResolution} min={8} max={256} step={1} />
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button style={panelStyles.btn} onClick={onCancel}>Cancel</button>
          <button
            style={{ ...panelStyles.btn, opacity: file ? 1 : 0.5 }}
            disabled={!file}
            onClick={() => file && onImport(file, { gridSize, loadManifest, voxelResolution })}
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add import actions to store**

In `useCharacterStore.ts`, add `importFromPly` and `importFromObj` actions:

```ts
// Action signatures in interface:
importFromPly: (voxels: Map<VoxelKey, Voxel>, parts: BodyPart[], gridSize: number) => void;
importFromObj: (voxels: Map<VoxelKey, Voxel>, parts: BodyPart[], gridSize: number) => void;

// Implementations (identical pattern):
importFromPly: (voxels, parts, gridSize) => {
  set({
    voxels,
    characterParts: parts,
    gridWidth: gridSize,
    gridDepth: gridSize,
    characterPoses: {},
    animations: {},
    selectedPart: null,
    selectedPose: null,
    selectedAnimation: null,
    undoStack: [],
    redoStack: [],
    boxSelection: null,
    lassoSelection: null,
  });
},

importFromObj: (voxels, parts, gridSize) => {
  set({
    voxels,
    characterParts: parts,
    gridWidth: gridSize,
    gridDepth: gridSize,
    characterPoses: {},
    animations: {},
    selectedPart: null,
    selectedPose: null,
    selectedAnimation: null,
    undoStack: [],
    redoStack: [],
    boxSelection: null,
    lassoSelection: null,
  });
},
```

- [ ] **Step 3: Wire ImportDialog into MenuBar**

In `MenuBar.tsx`, add Import menu item and dialog:

```tsx
import { ImportDialog, ImportOptions } from './ImportDialog.js';
import { parsePlyToVoxels } from '../lib/plyImport.js';
import { parseObjToVoxels } from '../lib/objImport.js';

// State
const [showImportDialog, setShowImportDialog] = useState(false);

// In File menu items, add after Import .vox:
{ label: 'Import (PLY/VOX/OBJ)...', action: () => setShowImportDialog(true) }

// Handler
async function handleImport(file: File, options: ImportOptions) {
  const ext = file.name.split('.').pop()?.toLowerCase();
  try {
    if (ext === 'ply') {
      const buffer = await file.arrayBuffer();
      const result = parsePlyToVoxels(buffer, options.gridSize);
      importFromPly(result.voxels, result.parts, result.gridSize);
    } else if (ext === 'obj') {
      const text = await file.text();
      const result = parseObjToVoxels(text, options.gridSize);
      importFromObj(result.voxels, result.parts, result.gridSize);
    } else if (ext === 'vox') {
      // Use existing .vox import path
      const buffer = await file.arrayBuffer();
      const voxFile = parseVox(buffer);
      const models = voxFile.models.map((m) => ({
        name: m.name ?? `model_${voxFile.models.indexOf(m)}`,
        voxels: m.voxels,
      }));
      importVoxModels(models);
    }
    showToast('Imported successfully', 'success');
  } catch (err) {
    showToast(`Import failed: ${(err as Error).message}`, 'error');
  }
  setShowImportDialog(false);
}

// Add "Export Character" menu item:
{ label: 'Export Character...', action: handleExportCharacter }

// Export Character bundles PLY + manifest:
async function handleExportCharacter() {
  const state = useCharacterStore.getState();
  const plyBlob = exportPly(state.voxels, state.gridWidth, 0, state.characterParts);
  const manifest = buildManifest(
    state.characterName, `${state.characterName}.ply`, 1.0,
    state.characterParts, state.characterPoses, state.animations,
  );

  // Download PLY
  const plyUrl = URL.createObjectURL(plyBlob);
  const plyLink = document.createElement('a');
  plyLink.href = plyUrl;
  plyLink.download = `${state.characterName}.ply`;
  plyLink.click();
  URL.revokeObjectURL(plyUrl);

  // Download manifest
  const manifestBlob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
  const manifestUrl = URL.createObjectURL(manifestBlob);
  const manifestLink = document.createElement('a');
  manifestLink.href = manifestUrl;
  manifestLink.download = `${state.characterName}.json`;
  manifestLink.click();
  URL.revokeObjectURL(manifestUrl);

  showToast('Character exported (PLY + manifest)', 'success');
}

// Render dialog:
{showImportDialog && (
  <ImportDialog onImport={handleImport} onCancel={() => setShowImportDialog(false)} />
)}
```

- [ ] **Step 4: Build to verify**

Run: `cd tools && pnpm --filter @gseurat/echidna build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add tools/apps/echidna/src/panels/ImportDialog.tsx tools/apps/echidna/src/panels/MenuBar.tsx tools/apps/echidna/src/store/useCharacterStore.ts
git commit -m "feat(echidna): add unified import dialog (PLY/VOX/OBJ) and Export Character action"
```

---

## Task 15: Staging auto-sync for animation preview

**Files:**
- Modify: `tools/apps/echidna/src/panels/MenuBar.tsx`

- [ ] **Step 1: Add auto-sync toggle and debounced push**

In `MenuBar.tsx`, add Staging auto-sync (same pattern as Bricklayer):

```tsx
const [autoSync, setAutoSync] = useState(false);
const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

// Watch for changes when auto-sync is enabled
useEffect(() => {
  if (!autoSync) return;
  if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
  syncTimerRef.current = setTimeout(() => {
    pushToStaging();
  }, 2000);
  return () => { if (syncTimerRef.current) clearTimeout(syncTimerRef.current); };
}, [autoSync, voxels, characterParts, characterPoses, animations]);

async function pushToStaging() {
  try {
    const state = useCharacterStore.getState();
    const plyBlob = exportPly(state.voxels, state.gridWidth, 0, state.characterParts);
    const manifest = buildManifest(
      state.characterName, `${state.characterName}.ply`, 1.0,
      state.characterParts, state.characterPoses, state.animations,
    );
    // Upload PLY
    await fetch('http://localhost:9101/api/characters/' + state.characterName + '/ply', {
      method: 'PUT',
      body: plyBlob,
    });
    // Upload manifest
    await fetch('http://localhost:9101/api/characters/' + state.characterName + '/manifest', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(manifest),
    });
  } catch {
    // Silently fail — staging may not be running
  }
}

// Add to View menu:
{ label: `Auto-Sync Staging ${autoSync ? '✓' : ''}`, action: () => setAutoSync(!autoSync) }
```

- [ ] **Step 2: Build to verify**

Run: `cd tools && pnpm --filter @gseurat/echidna build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add tools/apps/echidna/src/panels/MenuBar.tsx
git commit -m "feat(echidna): add Staging auto-sync with 2s debounce for live animation preview"
```

---

## Task 16: Final integration test and build verification

**Files:** None new — verification only.

- [ ] **Step 1: Run all tests**

Run: `cd tools && pnpm --filter @gseurat/echidna test -- --reporter verbose`
Expected: All tests PASS (easing, voxelUtils, plyExport, manifestExport, plyImport, objImport)

- [ ] **Step 2: Build Echidna**

Run: `cd tools && pnpm --filter @gseurat/echidna build 2>&1 | tail -10`
Expected: Build succeeds with no TypeScript errors

- [ ] **Step 3: Build Bricklayer (verify ui-kit migration didn't break it)**

Run: `cd tools && pnpm --filter @gseurat/bricklayer build 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 4: Commit any remaining fixes, create final commit**

```bash
git add -A
git commit -m "feat(echidna): complete upgrade — ui-kit extraction, workflow tools, animation interpolation, import/export with bones"
```
