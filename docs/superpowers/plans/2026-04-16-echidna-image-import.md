# Echidna Depth AI Image Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Depth AI image import to Echidna so users can generate editable voxel maps from photographs.

**Architecture:** Move `depthEstimate.ts` to the shared `@gseurat/ai-providers` package. Add an image import dialog and voxelization function to Echidna that scales images to the current grid and converts depth columns to voxels.

**Tech Stack:** TypeScript, Zustand, `@huggingface/transformers` (Depth Anything V2), Vitest

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `tools/packages/ai-providers/src/depthEstimate.ts` | Create (move) | Depth Anything V2 estimation |
| `tools/packages/ai-providers/src/index.ts` | Modify | Export `estimateDepth` |
| `tools/packages/ai-providers/package.json` | Modify | Add `@huggingface/transformers` dep |
| `tools/apps/bricklayer/src/lib/depthEstimate.ts` | Delete | Replaced by shared package |
| `tools/apps/bricklayer/src/panels/ImportDialog.tsx` | Modify:5 | Update import path |
| `tools/apps/bricklayer/package.json` | Modify | Move `@huggingface/transformers` to ai-providers |
| `tools/apps/echidna/src/lib/imageImport.ts` | Create | Image-to-voxel conversion |
| `tools/apps/echidna/src/__tests__/imageImport.test.ts` | Create | Unit tests |
| `tools/apps/echidna/src/panels/ImageImportDialog.tsx` | Create | Import dialog UI |
| `tools/apps/echidna/src/panels/MenuBar.tsx` | Modify:607-610,685-690 | Wire up dialog |
| `tools/apps/echidna/src/store/useCharacterStore.ts` | Modify:219,706 | Add `importFromImage` action |

---

### Task 1: Move `depthEstimate.ts` to `@gseurat/ai-providers`

**Files:**
- Create: `tools/packages/ai-providers/src/depthEstimate.ts`
- Modify: `tools/packages/ai-providers/src/index.ts`
- Modify: `tools/packages/ai-providers/package.json`
- Delete: `tools/apps/bricklayer/src/lib/depthEstimate.ts`
- Modify: `tools/apps/bricklayer/src/panels/ImportDialog.tsx`
- Modify: `tools/apps/bricklayer/package.json`

- [ ] **Step 1: Copy depthEstimate.ts to ai-providers**

Copy `tools/apps/bricklayer/src/lib/depthEstimate.ts` to `tools/packages/ai-providers/src/depthEstimate.ts`. The file content stays identical:

```ts
import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let depthPipeline: any = null;

async function getPipeline(
  onProgress?: (progress: number) => void,
): Promise<any> {
  if (depthPipeline) return depthPipeline;

  depthPipeline = await (pipeline as Function)('depth-estimation', 'onnx-community/depth-anything-v2-small', {
    dtype: 'fp32',
    progress_callback: (info: { status: string; progress?: number }) => {
      if (info.status === 'progress' && info.progress != null && onProgress) {
        onProgress(info.progress);
      }
    },
  });

  return depthPipeline;
}

export async function estimateDepth(
  imageData: ImageData,
  onProgress?: (progress: number) => void,
): Promise<{ depthMap: Float32Array; width: number; height: number }> {
  const pipe = await getPipeline(onProgress);

  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(imageData, 0, 0);

  const blob = await new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b!), 'image/png');
  });
  const url = URL.createObjectURL(blob);

  try {
    const result = await pipe(url);
    const output = Array.isArray(result) ? result[0] : result;
    const depthImage = output.depth;

    const data = depthImage.data as Float32Array;
    const width = depthImage.width as number;
    const height = depthImage.height as number;

    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < data.length; i++) {
      if (data[i] < min) min = data[i];
      if (data[i] > max) max = data[i];
    }

    const range = max - min || 1;
    const normalized = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) {
      normalized[i] = (data[i] - min) / range;
    }

    return { depthMap: normalized, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}
```

- [ ] **Step 2: Export from ai-providers index**

Add to `tools/packages/ai-providers/src/index.ts`:

```ts
export { estimateDepth } from "./depthEstimate.js";
```

- [ ] **Step 3: Add `@huggingface/transformers` dependency to ai-providers**

In `tools/packages/ai-providers/package.json`, add to dependencies (create the key if missing):

```json
"dependencies": {
  "@huggingface/transformers": "^3.4.0"
}
```

- [ ] **Step 4: Update Bricklayer's import**

In `tools/apps/bricklayer/src/panels/ImportDialog.tsx`, change line 5 from:

```ts
import { estimateDepth } from '../lib/depthEstimate.js';
```

to:

```ts
import { estimateDepth } from '@gseurat/ai-providers';
```

- [ ] **Step 5: Remove `@huggingface/transformers` from Bricklayer's package.json**

Remove the `"@huggingface/transformers": "^3.4.0"` line from `tools/apps/bricklayer/package.json` dependencies. Add `"@gseurat/ai-providers": "workspace:*"` if not already present.

- [ ] **Step 6: Delete the old file**

Delete `tools/apps/bricklayer/src/lib/depthEstimate.ts`.

- [ ] **Step 7: Install and verify build**

```bash
cd tools && pnpm install && pnpm build
```

Expected: builds successfully with no errors.

- [ ] **Step 8: Commit**

```bash
git add -A tools/packages/ai-providers/src/depthEstimate.ts \
  tools/packages/ai-providers/src/index.ts \
  tools/packages/ai-providers/package.json \
  tools/apps/bricklayer/src/panels/ImportDialog.tsx \
  tools/apps/bricklayer/package.json \
  tools/pnpm-lock.yaml
git rm tools/apps/bricklayer/src/lib/depthEstimate.ts
git commit -m "refactor: move depthEstimate to @gseurat/ai-providers"
```

---

### Task 2: Write `imageImport.ts` with tests (TDD)

**Files:**
- Create: `tools/apps/echidna/src/__tests__/imageImport.test.ts`
- Create: `tools/apps/echidna/src/lib/imageImport.ts`

- [ ] **Step 1: Write the failing test**

Create `tools/apps/echidna/src/__tests__/imageImport.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { imageToVoxels } from '../lib/imageImport.js';
import { parseKey } from '../lib/voxelUtils.js';

function makeImageData(w: number, h: number, fill: [number, number, number, number]): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = fill[0];
    data[i * 4 + 1] = fill[1];
    data[i * 4 + 2] = fill[2];
    data[i * 4 + 3] = fill[3];
  }
  return { data, width: w, height: h, colorSpace: 'srgb' } as ImageData;
}

describe('imageToVoxels', () => {
  it('creates voxel columns from depth map', () => {
    const img = makeImageData(4, 4, [255, 0, 0, 255]);
    // Uniform depth of 0.5 -> column height = round(0.5 * 8) = 4
    const depthMap = new Float32Array(4 * 4).fill(0.5);
    const result = imageToVoxels(img, depthMap, 4, 8);

    // 16 pixels * 4 voxels deep = 64 before culling
    // Interior voxels removed by surface culling
    expect(result.voxels.size).toBeGreaterThan(0);
    expect(result.voxels.size).toBeLessThanOrEqual(64);
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0].id).toBe('root');
  });

  it('skips transparent pixels', () => {
    const img = makeImageData(2, 2, [0, 0, 0, 0]); // fully transparent
    const depthMap = new Float32Array(4).fill(1.0);
    const result = imageToVoxels(img, depthMap, 2, 8);

    expect(result.voxels.size).toBe(0);
  });

  it('preserves pixel colors', () => {
    const img = makeImageData(1, 1, [100, 150, 200, 255]);
    const depthMap = new Float32Array([0.25]);
    const result = imageToVoxels(img, depthMap, 1, 4);
    // depth 0.25 * 4 = 1 voxel
    expect(result.voxels.size).toBe(1);
    const voxel = result.voxels.values().next().value!;
    expect(voxel.color).toEqual([100, 150, 200, 255]);
  });

  it('downscales image to fit gridWidth', () => {
    const img = makeImageData(8, 8, [255, 0, 0, 255]);
    const depthMap = new Float32Array(8 * 8).fill(0.1);
    const result = imageToVoxels(img, depthMap, 4, 4);

    // Should have been scaled down to 4x4 = max 16 columns
    for (const key of result.voxels.keys()) {
      const [x, y] = parseKey(key);
      expect(x).toBeLessThan(4);
      expect(y).toBeLessThan(4);
    }
  });

  it('enforces voxel budget', () => {
    const img = makeImageData(16, 16, [255, 0, 0, 255]);
    const depthMap = new Float32Array(16 * 16).fill(1.0);
    const result = imageToVoxels(img, depthMap, 16, 32, 100);

    expect(result.voxels.size).toBeLessThanOrEqual(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd tools && pnpm --filter @gseurat/tests vitest run src/__tests__/imageImport.test.ts 2>&1 || true
```

If the test harness doesn't pick it up from the tests package, run directly:

```bash
cd tools/apps/echidna && npx vitest run src/__tests__/imageImport.test.ts 2>&1 || true
```

Expected: FAIL — `imageToVoxels` not found.

- [ ] **Step 3: Implement `imageImport.ts`**

Create `tools/apps/echidna/src/lib/imageImport.ts`:

```ts
import type { Voxel, VoxelKey, BodyPart } from '../store/types.js';
import { voxelKey, parseKey } from './voxelUtils.js';

export interface ImageImportResult {
  voxels: Map<VoxelKey, Voxel>;
  parts: BodyPart[];
}

const NEIGHBORS: [number, number, number][] = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

/**
 * Downscale ImageData to fit within maxWidth, preserving aspect ratio.
 * Returns a new ImageData. If already within bounds, returns the original.
 */
function downscaleImageData(img: ImageData, maxWidth: number): ImageData {
  if (img.width <= maxWidth) return img;

  const scale = maxWidth / img.width;
  const newW = maxWidth;
  const newH = Math.max(1, Math.round(img.height * scale));
  const out = new Uint8ClampedArray(newW * newH * 4);

  for (let y = 0; y < newH; y++) {
    for (let x = 0; x < newW; x++) {
      // Nearest-neighbor sampling
      const srcX = Math.min(Math.floor(x / scale), img.width - 1);
      const srcY = Math.min(Math.floor(y / scale), img.height - 1);
      const si = (srcY * img.width + srcX) * 4;
      const di = (y * newW + x) * 4;
      out[di] = img.data[si];
      out[di + 1] = img.data[si + 1];
      out[di + 2] = img.data[si + 2];
      out[di + 3] = img.data[si + 3];
    }
  }

  return { data: out, width: newW, height: newH, colorSpace: img.colorSpace } as ImageData;
}

/**
 * Downscale a depth map (Float32Array in row-major order) to new dimensions.
 * Uses nearest-neighbor sampling to match pixel-to-voxel correspondence.
 */
function downscaleDepthMap(
  depthMap: Float32Array,
  srcW: number, srcH: number,
  dstW: number, dstH: number,
): Float32Array {
  if (srcW === dstW && srcH === dstH) return depthMap;

  const scaleX = srcW / dstW;
  const scaleY = srcH / dstH;
  const out = new Float32Array(dstW * dstH);

  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(Math.floor(x * scaleX), srcW - 1);
      const sy = Math.min(Math.floor(y * scaleY), srcH - 1);
      out[y * dstW + x] = depthMap[sy * srcW + sx];
    }
  }

  return out;
}

/**
 * Convert an image + depth map into Echidna voxels.
 *
 * The image is scaled to fit `gridWidth` (X/Y plane).
 * Depth columns extend along +Z, scaled to `gridDepth`.
 * Interior voxels are culled. An optional budget trims excess voxels.
 */
export function imageToVoxels(
  imageData: ImageData,
  depthMap: Float32Array,
  gridWidth: number,
  gridDepth: number,
  budget?: number,
): ImageImportResult {
  // Downscale image and depth map to fit gridWidth
  const scaled = downscaleImageData(imageData, gridWidth);
  const scaledDepth = downscaleDepthMap(
    depthMap, imageData.width, imageData.height,
    scaled.width, scaled.height,
  );

  const w = scaled.width;
  const h = scaled.height;
  const voxels = new Map<VoxelKey, Voxel>();

  for (let iy = 0; iy < h; iy++) {
    for (let ix = 0; ix < w; ix++) {
      const idx = (iy * w + ix) * 4;
      const r = scaled.data[idx];
      const g = scaled.data[idx + 1];
      const b = scaled.data[idx + 2];
      const a = scaled.data[idx + 3];
      if (a < 10) continue;

      const vy = h - 1 - iy; // flip Y so image top = high Y
      const depth = scaledDepth[iy * w + ix] ?? 0;
      const colHeight = Math.max(1, Math.round(depth * gridDepth));

      for (let z = 0; z < colHeight; z++) {
        voxels.set(voxelKey(ix, vy, z), { color: [r, g, b, a] });
      }
    }
  }

  // Surface culling: remove fully interior voxels
  const toDelete: VoxelKey[] = [];
  for (const key of voxels.keys()) {
    const [x, y, z] = parseKey(key);
    const allEnclosed = NEIGHBORS.every(([dx, dy, dz]) =>
      voxels.has(voxelKey(x + dx, y + dy, z + dz)),
    );
    if (allEnclosed) toDelete.push(key);
  }
  for (const key of toDelete) voxels.delete(key);

  // Budget enforcement
  if (budget && budget > 0 && voxels.size > budget) {
    const entries = Array.from(voxels.entries());
    const stride = Math.ceil(entries.length / budget);
    voxels.clear();
    for (let i = 0; i < entries.length; i += stride) {
      voxels.set(entries[i][0], entries[i][1]);
    }
  }

  // Single root part with all voxel keys
  const allKeys = Array.from(voxels.keys());
  let jx = 0, jy = 0, jz = 0;
  for (const key of allKeys) {
    const [x, y, z] = parseKey(key);
    jx += x; jy += y; jz += z;
  }
  const n = allKeys.length || 1;
  const parts: BodyPart[] = [{
    id: 'root',
    name: 'root',
    parent: null,
    joint: [Math.round(jx / n), Math.round(jy / n), Math.round(jz / n)],
    voxelKeys: allKeys,
  }];

  return { voxels, parts };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd tools/apps/echidna && npx vitest run src/__tests__/imageImport.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/apps/echidna/src/lib/imageImport.ts \
  tools/apps/echidna/src/__tests__/imageImport.test.ts
git commit -m "feat(echidna): add imageToVoxels with tests"
```

---

### Task 3: Add `importFromImage` store action

**Files:**
- Modify: `tools/apps/echidna/src/store/useCharacterStore.ts`

- [ ] **Step 1: Add action type to the store interface**

In `tools/apps/echidna/src/store/useCharacterStore.ts`, find the line:

```ts
  importFromObj: (voxels: Map<VoxelKey, Voxel>, parts: BodyPart[], gridSize: number) => void;
```

Add after it:

```ts
  importFromImage: (voxels: Map<VoxelKey, Voxel>, parts: BodyPart[], gridWidth: number, gridDepth: number) => void;
```

- [ ] **Step 2: Add action implementation**

Find the `importFromObj` implementation (after `importFromPly`). After the `importFromObj` block, add:

```ts
  importFromImage: (voxels, parts, gridWidth, gridDepth) => {
    const s = get();
    set({
      asset: {
        ...(s.asset ?? DEFAULT_ASSET),
        kind: 'map',
        voxels,
        characterParts: parts,
        gridWidth,
        gridDepth,
        characterPoses: {},
        animations: {},
      },
      selectedPart: null,
      selectedPose: null,
      selectedAnimation: null,
      undoStack: [],
      redoStack: [],
      boxSelection: null,
      lassoSelection: null,
      dirty: true,
    });
  },
```

- [ ] **Step 3: Build to verify**

```bash
cd tools && pnpm build
```

Expected: builds successfully.

- [ ] **Step 4: Commit**

```bash
git add tools/apps/echidna/src/store/useCharacterStore.ts
git commit -m "feat(echidna): add importFromImage store action"
```

---

### Task 4: Add `@gseurat/ai-providers` dependency to Echidna

**Files:**
- Modify: `tools/apps/echidna/package.json`

- [ ] **Step 1: Add dependency**

In `tools/apps/echidna/package.json`, add `"@gseurat/ai-providers": "workspace:*"` to the `dependencies` section.

- [ ] **Step 2: Install and build**

```bash
cd tools && pnpm install && pnpm build
```

Expected: builds successfully.

- [ ] **Step 3: Commit**

```bash
git add tools/apps/echidna/package.json tools/pnpm-lock.yaml
git commit -m "chore(echidna): add @gseurat/ai-providers dependency"
```

---

### Task 5: Create `ImageImportDialog.tsx`

**Files:**
- Create: `tools/apps/echidna/src/panels/ImageImportDialog.tsx`

- [ ] **Step 1: Create the dialog component**

Create `tools/apps/echidna/src/panels/ImageImportDialog.tsx`:

```tsx
import React, { useRef, useState } from 'react';
import { NumberInput, panelStyles } from '@gseurat/ui-kit';
import { estimateDepth } from '@gseurat/ai-providers';
import { imageToVoxels } from '../lib/imageImport.js';
import { useCharacterStore } from '../store/useCharacterStore.js';

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  dialog: {
    background: '#1e1e3a',
    border: '1px solid #444',
    borderRadius: 8,
    padding: 24,
    width: 420,
    color: '#ddd',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 16,
  },
  title: { fontSize: 16, fontWeight: 600 },
  row: { display: 'flex', alignItems: 'center', gap: 12 },
  label: { fontSize: 13, color: '#aaa', minWidth: 100 },
  hint: { fontSize: 11, color: '#666', lineHeight: '1.4' },
  btn: {
    padding: '6px 16px',
    border: '1px solid #555',
    borderRadius: 4,
    background: '#3a3a6a',
    color: '#ddd',
    cursor: 'pointer',
    fontSize: 13,
  },
  btnPrimary: {
    padding: '6px 16px',
    border: '1px solid #77f',
    borderRadius: 4,
    background: '#4a4a8a',
    color: '#fff',
    cursor: 'pointer',
    fontSize: 13,
  },
  actions: { display: 'flex', gap: 8, justifyContent: 'flex-end' },
  progressBar: {
    width: '100%',
    height: 6,
    background: '#2a2a4a',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    background: '#77f',
    borderRadius: 3,
    transition: 'width 0.2s',
  },
};

function downscaleImage(img: HTMLImageElement, maxWidth: number): ImageData {
  const canvas = document.createElement('canvas');
  if (img.width <= maxWidth) {
    canvas.width = img.width;
    canvas.height = img.height;
  } else {
    const scale = maxWidth / img.width;
    canvas.width = maxWidth;
    canvas.height = Math.round(img.height * scale);
  }
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

interface Props {
  onClose: () => void;
}

export function ImageImportDialog({ onClose }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [voxelBudget, setVoxelBudget] = useState(500000);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');

  const store = useCharacterStore;
  const gridWidth = store.getState().asset?.gridWidth ?? 32;
  const gridDepth = store.getState().asset?.gridDepth ?? 32;

  const handleImport = async () => {
    if (!file) return;

    const img = new Image();
    const imageUrl = URL.createObjectURL(file);

    img.onload = async () => {
      const imageData = downscaleImage(img, gridWidth);
      URL.revokeObjectURL(imageUrl);

      setLoading(true);
      setProgress(0);
      setStatus('Loading depth model...');

      try {
        const { depthMap } = await estimateDepth(imageData, (p) => {
          setProgress(p);
          if (p < 100) {
            setStatus(`Downloading model... ${Math.round(p)}%`);
          }
        });

        setStatus('Generating voxels...');
        const result = imageToVoxels(imageData, depthMap, gridWidth, gridDepth, voxelBudget);

        const s = store.getState();
        s.pushUndo();
        s.importFromImage(result.voxels, result.parts, gridWidth, gridDepth);
        onClose();
      } catch (err) {
        console.error('Depth estimation failed:', err);
        setStatus(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
        setLoading(false);
      }
    };

    img.src = imageUrl;
  };

  return (
    <div style={styles.overlay} onClick={loading ? undefined : onClose}>
      <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <span style={styles.title}>Import Image (Depth AI)</span>

        <div style={styles.row}>
          <span style={styles.label}>File</span>
          <button style={styles.btn} onClick={() => fileRef.current?.click()} disabled={loading}>
            {file ? file.name : 'Choose image...'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>

        <div style={styles.hint}>
          Uses Depth Anything V2 to estimate per-pixel depth. Image is scaled to
          fit the current grid ({gridWidth} x {gridDepth}). Model downloads on
          first use (~50 MB, cached in browser).
        </div>

        <div style={styles.row}>
          <span style={styles.label}>Voxel Budget</span>
          <NumberInput
            value={voxelBudget}
            onChange={setVoxelBudget}
            min={10000}
            max={5000000}
            step={50000}
          />
          <span style={{ fontSize: 12, color: '#888' }}>
            {(voxelBudget / 1000).toFixed(0)}K
          </span>
        </div>

        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={styles.progressBar}>
              <div style={{ ...styles.progressFill, width: `${progress}%` }} />
            </div>
            <span style={{ fontSize: 12, color: '#aaa' }}>{status}</span>
          </div>
        )}

        <div style={styles.actions}>
          <button style={styles.btn} onClick={onClose} disabled={loading}>Cancel</button>
          <button
            style={{
              ...styles.btnPrimary,
              ...(loading || !file ? { opacity: 0.5, cursor: 'not-allowed' } : {}),
            }}
            onClick={handleImport}
            disabled={!file || loading}
          >
            {loading ? 'Processing...' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build to verify**

```bash
cd tools && pnpm build
```

Expected: builds successfully.

- [ ] **Step 3: Commit**

```bash
git add tools/apps/echidna/src/panels/ImageImportDialog.tsx
git commit -m "feat(echidna): add ImageImportDialog component"
```

---

### Task 6: Wire dialog into MenuBar

**Files:**
- Modify: `tools/apps/echidna/src/panels/MenuBar.tsx`

- [ ] **Step 1: Add import and state**

In `tools/apps/echidna/src/panels/MenuBar.tsx`, add to the imports (near line 14):

```ts
import { ImageImportDialog } from './ImageImportDialog.js';
```

Find the existing `showImportDialog` state declaration (line 302):

```ts
const [showImportDialog, setShowImportDialog] = useState(false);
```

Add after it:

```ts
const [showImageImportDialog, setShowImageImportDialog] = useState(false);
```

- [ ] **Step 2: Add menu item**

Find the Import children array (around line 607-611):

```ts
      label: 'Import',
      children: [
        { label: 'Import (PLY/VOX/OBJ)\u2026', action: () => setShowImportDialog(true) },
        { label: 'Import .vox\u2026', action: handleImportVox },
        { label: 'Load .echidna\u2026', action: handleLoad },
      ],
```

Add a new entry after the `.vox` line:

```ts
        { label: 'Import Image (Depth AI)\u2026', action: () => setShowImageImportDialog(true) },
```

- [ ] **Step 3: Render the dialog**

Find the block (around line 685-690):

```tsx
      {showImportDialog && (
        <ImportDialog
          onImport={handleImport}
          onCancel={() => setShowImportDialog(false)}
        />
      )}
```

Add after it:

```tsx
      {showImageImportDialog && (
        <ImageImportDialog onClose={() => setShowImageImportDialog(false)} />
      )}
```

- [ ] **Step 4: Build to verify**

```bash
cd tools && pnpm build
```

Expected: builds successfully.

- [ ] **Step 5: Commit**

```bash
git add tools/apps/echidna/src/panels/MenuBar.tsx
git commit -m "feat(echidna): wire ImageImportDialog into MenuBar"
```

