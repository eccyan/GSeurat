# Echidna Density Multiplier & Grid Size Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a density multiplier to Echidna's PLY export (subdivide voxels into NxNxN Gaussians) and a configurable grid size for new/existing projects.

**Architecture:** Both features are Echidna-only TypeScript changes. The density multiplier adds a `density` parameter to `exportPly()` and a dropdown in `ExportDialog`. The grid size adds a `newProject()` parameter, a resize action, and two new dialog components.

**Tech Stack:** TypeScript, React, Zustand, Vitest (Echidna app at `tools/apps/echidna`)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `tools/apps/echidna/src/lib/plyExport.ts` | Modify | Add density subdivision loop |
| `tools/apps/echidna/src/__tests__/plyExport.test.ts` | Create | Test density multiplier vertex counts and positions |
| `tools/apps/echidna/src/panels/ExportDialog.tsx` | Modify | Add density dropdown |
| `tools/apps/echidna/src/store/useCharacterStore.ts` | Modify | Add `resizeGrid()` action, parameterize `newCharacter()` |
| `tools/apps/echidna/src/panels/NewProjectDialog.tsx` | Create | Grid size selector for new projects |
| `tools/apps/echidna/src/panels/ResizeGridDialog.tsx` | Create | Resize grid dialog with voxel warning |
| `tools/apps/echidna/src/panels/MenuBar.tsx` | Modify | Wire New → dialog, add Resize Grid to Edit menu |

---

### Task 1: Add density parameter to PLY export

**Files:**
- Modify: `tools/apps/echidna/src/lib/plyExport.ts`
- Create: `tools/apps/echidna/src/__tests__/plyExport.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tools/apps/echidna/src/__tests__/plyExport.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { exportPly } from '../lib/plyExport.js';
import { voxelKey } from '../lib/voxelUtils.js';
import type { Voxel, VoxelKey, BodyPart } from '../store/types.js';

function makeSingleVoxel(): Map<VoxelKey, Voxel> {
  const map = new Map<VoxelKey, Voxel>();
  map.set(voxelKey(16, 0, 16), { color: [212, 116, 44, 255] });
  return map;
}

function countVertices(blob: Blob): number {
  // Parse vertex count from PLY header
  const text = new TextDecoder().decode(blob.slice(0, 512) as any);
  const match = text.match(/element vertex (\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

// We need to convert Blob to ArrayBuffer for header parsing
async function vertexCount(blob: Blob): Promise<number> {
  const buf = await blob.arrayBuffer();
  const text = new TextDecoder().decode(buf.slice(0, 512));
  const match = text.match(/element vertex (\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

describe('exportPly', () => {
  it('density 1 produces 1 vertex per surface voxel', async () => {
    const voxels = makeSingleVoxel();
    const blob = exportPly(voxels, 32, 32, undefined, 1);
    expect(await vertexCount(blob)).toBe(1);
  });

  it('density 2 produces 8 vertices per surface voxel', async () => {
    const voxels = makeSingleVoxel();
    const blob = exportPly(voxels, 32, 32, undefined, 2);
    expect(await vertexCount(blob)).toBe(8);
  });

  it('density 3 produces 27 vertices per surface voxel', async () => {
    const voxels = makeSingleVoxel();
    const blob = exportPly(voxels, 32, 32, undefined, 3);
    expect(await vertexCount(blob)).toBe(27);
  });

  it('density 4 produces 64 vertices per surface voxel', async () => {
    const voxels = makeSingleVoxel();
    const blob = exportPly(voxels, 32, 32, undefined, 4);
    expect(await vertexCount(blob)).toBe(64);
  });

  it('default density (omitted) produces 1 vertex per voxel', async () => {
    const voxels = makeSingleVoxel();
    const blob = exportPly(voxels, 32, 32);
    expect(await vertexCount(blob)).toBe(1);
  });

  it('bone_index is preserved for all sub-gaussians', async () => {
    const voxels = makeSingleVoxel();
    const parts: BodyPart[] = [
      { id: 'torso', parent: null, joint: [16, 0, 16], voxelKeys: [voxelKey(16, 0, 16)] },
    ];
    const blob = exportPly(voxels, 32, 32, parts, 2);
    expect(await vertexCount(blob)).toBe(8);
    // All 8 sub-gaussians should have bone_index bytes
    const buf = await blob.arrayBuffer();
    const headerEnd = new TextDecoder().decode(buf.slice(0, 1024)).indexOf('end_header\n');
    const headerLen = headerEnd + 'end_header\n'.length;
    const bytesPerVertex = 14 * 4 + 1; // 14 floats + 1 byte bone_index
    expect(buf.byteLength).toBe(headerLen + 8 * bytesPerVertex);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter echidna test -- --run`
Expected: FAIL — `exportPly` doesn't accept 5th argument

- [ ] **Step 3: Implement density subdivision in exportPly**

Modify `tools/apps/echidna/src/lib/plyExport.ts` — add `density` parameter and subdivision loop:

```typescript
import type { VoxelKey, Voxel, BodyPart } from '../store/types.js';
import { parseKey, voxelKey } from './voxelUtils.js';

const NEIGHBORS: [number, number, number][] = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

/** Build a lookup from voxel key -> bone index for character export. */
function buildBoneMap(parts: BodyPart[]): Map<VoxelKey, number> {
  const map = new Map<VoxelKey, number>();
  for (let i = 0; i < parts.length; i++) {
    for (const key of parts[i].voxelKeys) {
      map.set(key, i);
    }
  }
  return map;
}

export function exportPly(
  voxels: Map<VoxelKey, Voxel>,
  gridWidth: number,
  gridHeight: number,
  parts?: BodyPart[],
  density: number = 1,
): Blob {
  // Surface culling: skip interior voxels enclosed by 6 neighbors
  const allEntries = Array.from(voxels.entries());
  const entries = allEntries.filter(([key]) => {
    const [x, y, z] = parseKey(key);
    for (const [dx, dy, dz] of NEIGHBORS) {
      if (!voxels.has(voxelKey(x + dx, y + dy, z + dz))) {
        return true; // at least one face exposed
      }
    }
    return false; // fully enclosed
  });

  const n = Math.max(1, Math.round(density));
  const count = entries.length * n * n * n;

  const hasBones = parts && parts.length > 0;
  const boneMap = hasBones ? buildBoneMap(parts) : null;

  const header =
    `ply\n` +
    `format binary_little_endian 1.0\n` +
    `element vertex ${count}\n` +
    `property float x\n` +
    `property float y\n` +
    `property float z\n` +
    `property float f_dc_0\n` +
    `property float f_dc_1\n` +
    `property float f_dc_2\n` +
    `property float opacity\n` +
    `property float scale_0\n` +
    `property float scale_1\n` +
    `property float scale_2\n` +
    `property float rot_0\n` +
    `property float rot_1\n` +
    `property float rot_2\n` +
    `property float rot_3\n` +
    (hasBones ? `property uchar bone_index\n` : '') +
    `end_header\n`;

  const headerBytes = new TextEncoder().encode(header);
  const bytesPerVertex = 14 * 4 + (hasBones ? 1 : 0);
  const bodyBytes = count * bytesPerVertex;
  const buffer = new ArrayBuffer(headerBytes.length + bodyBytes);
  const uint8 = new Uint8Array(buffer);
  uint8.set(headerBytes, 0);
  const view = new DataView(buffer);

  let offset = headerBytes.length;
  const halfW = gridWidth / 2;
  const baseVoxelScale = Math.log(0.5);
  const subScale = baseVoxelScale - Math.log(n);  // log(0.5 / n)

  // Find max Y for centering vertically
  let maxY = 0;
  for (const [key] of entries) {
    const [, vy] = parseKey(key);
    if (vy > maxY) maxY = vy;
  }
  const halfH = maxY / 2;

  const shFactor = 0.2820947917738781; // 0.5 / sqrt(pi)

  for (const [key, voxel] of entries) {
    const [vx, vy, vz] = parseKey(key);
    const bone = boneMap ? (boneMap.get(key) ?? 0) : 0;

    // SH DC coefficients (shared by all sub-gaussians of this voxel)
    const sh0 = (voxel.color[0] / 255 - 0.5) / shFactor;
    const sh1 = (voxel.color[1] / 255 - 0.5) / shFactor;
    const sh2 = (voxel.color[2] / 255 - 0.5) / shFactor;

    // Opacity
    const alpha = voxel.color[3] / 255;
    const logitOpacity = Math.log(Math.max(alpha, 0.001) / Math.max(1 - alpha, 0.001));

    // Subdivide voxel into n×n×n sub-gaussians
    for (let sx = 0; sx < n; sx++) {
      for (let sy = 0; sy < n; sy++) {
        for (let sz = 0; sz < n; sz++) {
          // Sub-position within voxel: centered grid
          const subX = vx + (sx + 0.5) / n - 0.5;
          const subY = vy + (sy + 0.5) / n - 0.5;
          const subZ = vz + (sz + 0.5) / n - 0.5;

          const px = subX - halfW;
          const py = subY - halfH;
          const pz = subZ;

          view.setFloat32(offset, px, true); offset += 4;
          view.setFloat32(offset, py, true); offset += 4;
          view.setFloat32(offset, pz, true); offset += 4;

          view.setFloat32(offset, sh0, true); offset += 4;
          view.setFloat32(offset, sh1, true); offset += 4;
          view.setFloat32(offset, sh2, true); offset += 4;

          view.setFloat32(offset, logitOpacity, true); offset += 4;

          view.setFloat32(offset, subScale, true); offset += 4;
          view.setFloat32(offset, subScale, true); offset += 4;
          view.setFloat32(offset, subScale, true); offset += 4;

          view.setFloat32(offset, 1, true); offset += 4;
          view.setFloat32(offset, 0, true); offset += 4;
          view.setFloat32(offset, 0, true); offset += 4;
          view.setFloat32(offset, 0, true); offset += 4;

          if (hasBones) {
            view.setUint8(offset, bone);
            offset += 1;
          }
        }
      }
    }
  }

  return new Blob([buffer], { type: 'application/octet-stream' });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter echidna test -- --run`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add tools/apps/echidna/src/lib/plyExport.ts tools/apps/echidna/src/__tests__/plyExport.test.ts
git commit -m "feat(echidna): add density multiplier to PLY export"
```

---

### Task 2: Add density dropdown to Export Dialog

**Files:**
- Modify: `tools/apps/echidna/src/panels/ExportDialog.tsx`

- [ ] **Step 1: Add density state and dropdown to ExportDialog**

Modify `tools/apps/echidna/src/panels/ExportDialog.tsx`:

```typescript
import React, { useState } from 'react';
import { useCharacterStore } from '../store/useCharacterStore.js';
import { exportPly } from '../lib/plyExport.js';

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
    width: 400,
    color: '#ddd',
  },
  title: { fontSize: 16, fontWeight: 600, marginBottom: 16 },
  section: { display: 'flex', flexDirection: 'column' as const, gap: 8, marginBottom: 16 },
  label: { fontSize: 12, color: '#aaa' },
  radio: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' },
  btn: {
    padding: '6px 16px', border: '1px solid #555', borderRadius: 4,
    background: '#3a3a6a', color: '#ddd', cursor: 'pointer', fontSize: 13,
  },
  btnPrimary: {
    padding: '6px 16px', border: '1px solid #77f', borderRadius: 4,
    background: '#4a4a8a', color: '#fff', cursor: 'pointer', fontSize: 13,
  },
  preview: {
    fontSize: 12, color: '#666', padding: '6px 8px', background: '#2a2a4a',
    borderRadius: 4, fontFamily: 'monospace',
  },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
  select: {
    background: '#2a2a4a', color: '#ddd', border: '1px solid #555',
    borderRadius: 4, padding: '4px 8px', fontSize: 13,
  },
};

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

type ExportFormat = 'ply_manifest' | 'ply_baked';

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const [format, setFormat] = useState<ExportFormat>('ply_manifest');
  const [includeBoneIndex, setIncludeBoneIndex] = useState(true);
  const [density, setDensity] = useState(1);

  const characterName = useCharacterStore((s) => s.characterName);
  const voxelCount = useCharacterStore((s) => s.voxels.size);
  const baseName = characterName.replace(/\s+/g, '_').toLowerCase() || 'character';
  const filename = format === 'ply_manifest' ? `${baseName}.ply` : `${baseName}_posed.ply`;
  const estimatedGaussians = voxelCount * density * density * density;

  const handleExport = () => {
    const s = useCharacterStore.getState();
    const parts = includeBoneIndex ? s.characterParts : undefined;
    const blob = exportPly(s.voxels, s.gridWidth, s.gridDepth, parts, density);
    download(blob, filename);

    // If PLY + Manifest, also export the manifest JSON
    if (format === 'ply_manifest') {
      const data = s.saveProject();
      const json = JSON.stringify(data, null, 2);
      download(new Blob([json], { type: 'application/json' }), `${baseName}.echidna`);
    }

    onClose();
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div style={styles.title}>Export</div>

        <div style={styles.section}>
          <span style={styles.label}>Format</span>
          <label style={styles.radio}>
            <input type="radio" checked={format === 'ply_manifest'} onChange={() => setFormat('ply_manifest')} />
            PLY + Manifest (.ply + .echidna)
          </label>
          <label style={styles.radio}>
            <input type="radio" checked={format === 'ply_baked'} onChange={() => setFormat('ply_baked')} />
            Posed PLY (baked)
          </label>
        </div>

        <div style={styles.section}>
          <span style={styles.label}>Density</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <select
              style={styles.select}
              value={density}
              onChange={(e) => setDensity(Number(e.target.value))}
            >
              <option value={1}>1x (1 per voxel)</option>
              <option value={2}>2x (8 per voxel)</option>
              <option value={3}>3x (27 per voxel)</option>
              <option value={4}>4x (64 per voxel)</option>
            </select>
            <span style={{ fontSize: 11, color: '#666' }}>
              ~{estimatedGaussians.toLocaleString()} Gaussians
            </span>
          </div>
        </div>

        <div style={styles.section}>
          <span style={styles.label}>Options</span>
          <label style={styles.radio}>
            <input type="checkbox" checked={includeBoneIndex} onChange={(e) => setIncludeBoneIndex(e.target.checked)} />
            Include bone_index
          </label>
        </div>

        <div style={styles.section}>
          <span style={styles.label}>Output</span>
          <div style={styles.preview}>{filename}</div>
        </div>

        <div style={styles.footer}>
          <button style={styles.btn} onClick={onClose}>Cancel</button>
          <button style={styles.btnPrimary} onClick={handleExport}>Export</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update MenuBar's handleExportPly to also pass density (default 1)**

In `tools/apps/echidna/src/panels/MenuBar.tsx`, the quick "Export PLY..." menu item should keep using density 1 (it's the quick path — the Export Dialog is for customized exports). No change needed.

- [ ] **Step 3: Verify build**

Run: `cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter echidna build`
Expected: BUILD SUCCESS

- [ ] **Step 4: Commit**

```bash
git add tools/apps/echidna/src/panels/ExportDialog.tsx
git commit -m "feat(echidna): add density dropdown to Export Dialog"
```

---

### Task 3: Add resizeGrid action to store

**Files:**
- Modify: `tools/apps/echidna/src/store/useCharacterStore.ts`

- [ ] **Step 1: Add resizeGrid action type to the store interface**

In `tools/apps/echidna/src/store/useCharacterStore.ts`, add to the interface (after `newCharacter`):

```typescript
  newCharacter: (gridSize?: number) => void;
  resizeGrid: (size: number) => void;
```

- [ ] **Step 2: Implement newCharacter with optional gridSize parameter**

Replace the existing `newCharacter` implementation:

```typescript
  newCharacter: (gridSize?: number) => {
    const size = gridSize ?? 32;
    set({
      voxels: new Map(),
      gridWidth: size,
      gridDepth: size,
      characterName: 'Untitled',
      characterParts: [],
      characterPoses: {},
      animations: {},
      selectedPart: null,
      selectedPose: null,
      selectedAnimation: null,
      previewPose: false,
      undoStack: [],
      redoStack: [],
      playbackTime: 0,
      isPlaying: false,
      boxSelection: null,
      colorByPart: false,
      partColors: {},
    });
  },
```

- [ ] **Step 3: Implement resizeGrid action**

Add after `newCharacter`:

```typescript
  resizeGrid: (size: number) => {
    const { voxels, characterParts, gridWidth } = get();
    if (size === gridWidth) return;

    // Filter voxels that fit within new bounds
    const next = new Map<VoxelKey, Voxel>();
    for (const [key, vox] of voxels) {
      const [x, , z] = parseKey(key);
      if (x >= 0 && x < size && z >= 0 && z < size) {
        next.set(key, vox);
      }
    }

    // Filter voxelKeys in parts
    const nextParts = characterParts.map((p) => ({
      ...p,
      voxelKeys: p.voxelKeys.filter((k) => {
        const [x, , z] = parseKey(k);
        return x >= 0 && x < size && z >= 0 && z < size;
      }),
    }));

    set({
      voxels: next,
      gridWidth: size,
      gridDepth: size,
      characterParts: nextParts,
    });
  },
```

- [ ] **Step 4: Verify build**

Run: `cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter echidna build`
Expected: BUILD SUCCESS

- [ ] **Step 5: Commit**

```bash
git add tools/apps/echidna/src/store/useCharacterStore.ts
git commit -m "feat(echidna): add resizeGrid action and parameterize newCharacter"
```

---

### Task 4: Create NewProjectDialog component

**Files:**
- Create: `tools/apps/echidna/src/panels/NewProjectDialog.tsx`

- [ ] **Step 1: Create the NewProjectDialog component**

Create `tools/apps/echidna/src/panels/NewProjectDialog.tsx`:

```typescript
import React, { useState } from 'react';
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
    width: 340,
    color: '#ddd',
  },
  title: { fontSize: 16, fontWeight: 600, marginBottom: 16 },
  section: { display: 'flex', flexDirection: 'column' as const, gap: 8, marginBottom: 16 },
  label: { fontSize: 12, color: '#aaa' },
  select: {
    background: '#2a2a4a', color: '#ddd', border: '1px solid #555',
    borderRadius: 4, padding: '4px 8px', fontSize: 13, width: '100%',
  },
  input: {
    background: '#2a2a4a', color: '#ddd', border: '1px solid #555',
    borderRadius: 4, padding: '4px 8px', fontSize: 13, width: 60,
  },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
  btn: {
    padding: '6px 16px', border: '1px solid #555', borderRadius: 4,
    background: '#3a3a6a', color: '#ddd', cursor: 'pointer', fontSize: 13,
  },
  btnPrimary: {
    padding: '6px 16px', border: '1px solid #77f', borderRadius: 4,
    background: '#4a4a8a', color: '#fff', cursor: 'pointer', fontSize: 13,
  },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
};

const PRESETS = [32, 64, 128, 256];

export function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const [preset, setPreset] = useState('32');
  const [custom, setCustom] = useState('');

  const size = preset === 'custom'
    ? Math.max(8, Math.min(1024, parseInt(custom, 10) || 32))
    : parseInt(preset, 10);

  const handleCreate = () => {
    useCharacterStore.getState().newCharacter(size);
    onClose();
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div style={styles.title}>New Project</div>

        <div style={styles.section}>
          <span style={styles.label}>Grid Size</span>
          <select
            style={styles.select}
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
          >
            {PRESETS.map((p) => (
              <option key={p} value={String(p)}>{p} × {p}</option>
            ))}
            <option value="custom">Custom...</option>
          </select>
          {preset === 'custom' && (
            <div style={styles.row}>
              <input
                style={styles.input}
                type="number"
                min={8}
                max={1024}
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="64"
              />
              <span style={{ fontSize: 11, color: '#666' }}>×</span>
              <span style={{ fontSize: 11, color: '#666' }}>{custom || '64'}</span>
            </div>
          )}
        </div>

        <div style={styles.footer}>
          <button style={styles.btn} onClick={onClose}>Cancel</button>
          <button style={styles.btnPrimary} onClick={handleCreate}>Create</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter echidna build`
Expected: BUILD SUCCESS

- [ ] **Step 3: Commit**

```bash
git add tools/apps/echidna/src/panels/NewProjectDialog.tsx
git commit -m "feat(echidna): add NewProjectDialog with grid size selector"
```

---

### Task 5: Create ResizeGridDialog component

**Files:**
- Create: `tools/apps/echidna/src/panels/ResizeGridDialog.tsx`

- [ ] **Step 1: Create the ResizeGridDialog component**

Create `tools/apps/echidna/src/panels/ResizeGridDialog.tsx`:

```typescript
import React, { useState } from 'react';
import { useCharacterStore } from '../store/useCharacterStore.js';
import { parseKey } from '../lib/voxelUtils.js';

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
    width: 340,
    color: '#ddd',
  },
  title: { fontSize: 16, fontWeight: 600, marginBottom: 16 },
  section: { display: 'flex', flexDirection: 'column' as const, gap: 8, marginBottom: 16 },
  label: { fontSize: 12, color: '#aaa' },
  select: {
    background: '#2a2a4a', color: '#ddd', border: '1px solid #555',
    borderRadius: 4, padding: '4px 8px', fontSize: 13, width: '100%',
  },
  input: {
    background: '#2a2a4a', color: '#ddd', border: '1px solid #555',
    borderRadius: 4, padding: '4px 8px', fontSize: 13, width: 60,
  },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
  warning: {
    fontSize: 12, color: '#ff8844', padding: '6px 8px', background: '#3a2a1a',
    borderRadius: 4, border: '1px solid #664422',
  },
  btn: {
    padding: '6px 16px', border: '1px solid #555', borderRadius: 4,
    background: '#3a3a6a', color: '#ddd', cursor: 'pointer', fontSize: 13,
  },
  btnPrimary: {
    padding: '6px 16px', border: '1px solid #77f', borderRadius: 4,
    background: '#4a4a8a', color: '#fff', cursor: 'pointer', fontSize: 13,
  },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
};

const PRESETS = [32, 64, 128, 256];

export function ResizeGridDialog({ onClose }: { onClose: () => void }) {
  const currentSize = useCharacterStore((s) => s.gridWidth);
  const voxels = useCharacterStore((s) => s.voxels);

  const [preset, setPreset] = useState(
    PRESETS.includes(currentSize) ? String(currentSize) : 'custom'
  );
  const [custom, setCustom] = useState(String(currentSize));

  const newSize = preset === 'custom'
    ? Math.max(8, Math.min(1024, parseInt(custom, 10) || currentSize))
    : parseInt(preset, 10);

  // Count voxels that would be removed
  let removedCount = 0;
  if (newSize < currentSize) {
    for (const key of voxels.keys()) {
      const [x, , z] = parseKey(key);
      if (x >= newSize || z >= newSize) removedCount++;
    }
  }

  const handleResize = () => {
    if (removedCount > 0) {
      if (!confirm(`This will remove ${removedCount} voxel(s) outside the new bounds. Continue?`)) {
        return;
      }
    }
    useCharacterStore.getState().resizeGrid(newSize);
    onClose();
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div style={styles.title}>Resize Grid</div>

        <div style={styles.section}>
          <span style={styles.label}>Current: {currentSize} × {currentSize}</span>
        </div>

        <div style={styles.section}>
          <span style={styles.label}>New Size</span>
          <select
            style={styles.select}
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
          >
            {PRESETS.map((p) => (
              <option key={p} value={String(p)}>{p} × {p}</option>
            ))}
            <option value="custom">Custom...</option>
          </select>
          {preset === 'custom' && (
            <div style={styles.row}>
              <input
                style={styles.input}
                type="number"
                min={8}
                max={1024}
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
              />
              <span style={{ fontSize: 11, color: '#666' }}>× {custom || currentSize}</span>
            </div>
          )}
        </div>

        {removedCount > 0 && (
          <div style={styles.warning}>
            ⚠ {removedCount} voxel(s) will be removed (outside new bounds)
          </div>
        )}

        <div style={styles.footer}>
          <button style={styles.btn} onClick={onClose}>Cancel</button>
          <button style={styles.btnPrimary} onClick={handleResize}>Resize</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter echidna build`
Expected: BUILD SUCCESS

- [ ] **Step 3: Commit**

```bash
git add tools/apps/echidna/src/panels/ResizeGridDialog.tsx
git commit -m "feat(echidna): add ResizeGridDialog with voxel removal warning"
```

---

### Task 6: Wire dialogs into MenuBar

**Files:**
- Modify: `tools/apps/echidna/src/panels/MenuBar.tsx`

- [ ] **Step 1: Import dialog components and add state**

At the top of `MenuBar.tsx`, add imports:

```typescript
import { NewProjectDialog } from './NewProjectDialog.js';
import { ResizeGridDialog } from './ResizeGridDialog.js';
```

Inside the `MenuBar` component, add state:

```typescript
const [showNewDialog, setShowNewDialog] = useState(false);
const [showResizeDialog, setShowResizeDialog] = useState(false);
```

- [ ] **Step 2: Replace handleNew to show dialog instead of confirm**

Replace the `handleNew` callback:

```typescript
const handleNew = useCallback(() => {
  setShowNewDialog(true);
}, []);
```

- [ ] **Step 3: Add Resize Grid to editItems**

Replace `editItems`:

```typescript
const editItems = [
  { label: 'Undo', shortcut: '\u2318Z', action: () => useCharacterStore.getState().undo() },
  { label: 'Redo', shortcut: '\u21e7\u2318Z', action: () => useCharacterStore.getState().redo() },
  { separator: true as const },
  { label: 'Resize Grid...', action: () => setShowResizeDialog(true) },
];
```

- [ ] **Step 4: Render dialogs in JSX**

Add before the closing `</div>` of the MenuBar return, after the toast:

```tsx
{showNewDialog && <NewProjectDialog onClose={() => setShowNewDialog(false)} />}
{showResizeDialog && <ResizeGridDialog onClose={() => setShowResizeDialog(false)} />}
```

- [ ] **Step 5: Verify build**

Run: `cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter echidna build`
Expected: BUILD SUCCESS

- [ ] **Step 6: Run all tests**

Run: `cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter echidna test -- --run`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add tools/apps/echidna/src/panels/MenuBar.tsx
git commit -m "feat(echidna): wire NewProject and ResizeGrid dialogs into MenuBar"
```
