import React, { useRef, useState } from 'react';
import { NumberInput } from '../components/NumberInput.js';
import { useSceneStore } from '../store/useSceneStore.js';
import { estimateDepth } from '../lib/depthEstimate.js';

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  dialog: {
    background: '#1e1e3a',
    border: '1px solid #444',
    borderRadius: 8,
    padding: 24,
    width: 400,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  title: { fontSize: 16, fontWeight: 600 },
  row: { display: 'flex', alignItems: 'center', gap: 12 },
  label: { fontSize: 13, color: '#aaa', minWidth: 80 },
  input: {
    flex: 1,
    padding: '6px 8px',
    background: '#2a2a4a',
    border: '1px solid #444',
    borderRadius: 4,
    color: '#ddd',
    fontSize: 13,
  },
  select: {
    flex: 1,
    padding: '6px 8px',
    background: '#2a2a4a',
    border: '1px solid #444',
    borderRadius: 4,
    color: '#ddd',
    fontSize: 13,
  },
  actions: { display: 'flex', gap: 8, justifyContent: 'flex-end' },
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
  hint: {
    fontSize: 11,
    color: '#666',
    lineHeight: '1.4',
  },
};

type ImportMode = 'flat' | 'luminance' | 'depth';

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

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<ImportMode>('flat');
  const [maxHeight, setMaxHeight] = useState(16);
  const [maxWidth, setMaxWidth] = useState(256);
  const [voxelBudget, setVoxelBudget] = useState(500000);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');

  const handleImport = async () => {
    if (!file) return;

    const img = new Image();
    const imageUrl = URL.createObjectURL(file);

    img.onload = async () => {
      const imageData = downscaleImage(img, maxWidth);
      URL.revokeObjectURL(imageUrl);

      const store = useSceneStore.getState();
      store.pushUndo();

      // Extract palette colors from the image
      store.extractColorsFromImage(imageData, file.name);

      if (mode === 'depth') {
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
          store.importImage(imageData, 'depth', maxHeight, depthMap, voxelBudget);
          onClose();
        } catch (err) {
          console.error('Depth estimation failed:', err);
          setStatus(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
          setLoading(false);
        }
      } else {
        store.importImage(imageData, mode, maxHeight, undefined, voxelBudget);
        onClose();
      }
    };

    img.src = imageUrl;
  };

  const showHeightSlider = mode === 'luminance' || mode === 'depth';

  // Estimate surface voxels after culling
  const estimatedVoxels = (() => {
    if (mode === 'flat') return maxWidth * maxWidth; // worst case: all pixels opaque
    // Surface of a W×H×D box: 2(WH + WD + HD)
    const estW = maxWidth;
    const estH = maxWidth; // assume square-ish image
    const estD = maxHeight;
    return 2 * (estW * estH + estW * estD + estH * estD);
  })();
  const overBudget = estimatedVoxels > voxelBudget;

  return (
    <div style={styles.overlay} onClick={loading ? undefined : onClose}>
      <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <span style={styles.title}>Import Image</span>

        <div style={styles.row}>
          <span style={styles.label}>File</span>
          <button style={styles.btn} onClick={() => fileRef.current?.click()} disabled={loading}>
            {file ? file.name : 'Choose...'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>

        <div style={styles.row}>
          <span style={styles.label}>Mode</span>
          <select
            style={styles.select}
            value={mode}
            onChange={(e) => setMode(e.target.value as ImportMode)}
            disabled={loading}
          >
            <option value="flat">Flat (1 voxel per pixel)</option>
            <option value="luminance">Luminance (height from brightness)</option>
            <option value="depth">Depth AI (height from estimated depth)</option>
          </select>
        </div>

        {mode === 'depth' && (
          <div style={styles.hint}>
            Uses Depth Anything V2 to estimate per-pixel depth from the image.
            Close objects become tall voxel columns, distant objects become short.
            Model downloads on first use (~50 MB, cached in browser).
          </div>
        )}

        <div style={styles.row}>
          <span style={styles.label}>Max Width</span>
          <input
            type="range"
            min={32}
            max={1024}
            step={32}
            value={maxWidth}
            onChange={(e) => setMaxWidth(Number(e.target.value))}
            style={{ flex: 1 }}
            disabled={loading}
          />
          <span style={{ fontSize: 13, minWidth: 40 }}>{maxWidth}px</span>
        </div>
        <div style={styles.hint}>
          Downscales image before voxelization. Lower = fewer voxels, faster rendering.
        </div>

        {showHeightSlider && (
          <div style={styles.row}>
            <span style={styles.label}>Max Height</span>
            <input
              type="range"
              min={1}
              max={256}
              value={maxHeight}
              onChange={(e) => setMaxHeight(Number(e.target.value))}
              style={{ flex: 1 }}
              disabled={loading}
            />
            <span style={{ fontSize: 13 }}>{maxHeight}</span>
          </div>
        )}

        <div style={styles.row}>
          <span style={styles.label}>Voxel Budget</span>
          <NumberInput
            min={10000}
            max={5000000}
            step={50000}
            value={voxelBudget}
            onChange={(v) => setVoxelBudget(v)}
            style={{ ...styles.input, maxWidth: 120 }}
          />
          <span style={{ fontSize: 12, color: '#888' }}>
            {(voxelBudget / 1000).toFixed(0)}K
          </span>
        </div>
        <div style={{
          ...styles.hint,
          color: overBudget ? '#fa4' : '#666',
        }}>
          Est. ~{(estimatedVoxels / 1000).toFixed(0)}K surface voxels
          {overBudget && ' (will be trimmed to budget)'}
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
              ...(loading ? { opacity: 0.5, cursor: 'not-allowed' } : {}),
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
