import React, { useState, useRef } from 'react';
import { NumberInput, panelStyles } from '@gseurat/ui-kit';

export interface ImportOptions {
  gridSize: number;
  loadManifest: boolean;
  voxelResolution: number;
}

interface Props {
  onImport: (file: File, options: ImportOptions) => void;
  onCancel: () => void;
}

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
  },
  title: { fontSize: 16, fontWeight: 600, marginBottom: 16 },
  section: { display: 'flex', flexDirection: 'column' as const, gap: 8, marginBottom: 16 },
  label: { fontSize: 12, color: '#aaa' },
  row: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 },
  fileBtn: {
    padding: '6px 16px',
    border: '1px dashed #555',
    borderRadius: 4,
    background: '#2a2a4a',
    color: '#aaa',
    cursor: 'pointer',
    fontSize: 13,
    textAlign: 'center' as const,
  },
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
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
};

function detectFormat(file: File): 'ply' | 'vox' | 'obj' | 'unknown' {
  const name = file.name.toLowerCase();
  if (name.endsWith('.ply')) return 'ply';
  if (name.endsWith('.vox')) return 'vox';
  if (name.endsWith('.obj')) return 'obj';
  return 'unknown';
}

export function ImportDialog({ onImport, onCancel }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [gridSize, setGridSize] = useState(32);
  const [loadManifest, setLoadManifest] = useState(true);
  const [voxelResolution, setVoxelResolution] = useState(32);
  const fileRef = useRef<HTMLInputElement>(null);

  const format = file ? detectFormat(file) : null;

  const handleImport = () => {
    if (!file) return;
    onImport(file, { gridSize, loadManifest, voxelResolution });
  };

  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div style={styles.title}>Import File</div>

        <div style={styles.section}>
          <span style={styles.label}>File (.ply, .vox, .obj)</span>
          <div style={styles.fileBtn} onClick={() => fileRef.current?.click()}>
            {file ? file.name : 'Choose file...'}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".ply,.vox,.obj"
            style={{ display: 'none' }}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>

        <div style={styles.section}>
          <span style={styles.label}>Grid Size</span>
          <div style={styles.row}>
            <NumberInput
              value={gridSize}
              onChange={setGridSize}
              min={8}
              max={1024}
              step={1}
            />
          </div>
        </div>

        {format === 'ply' && (
          <div style={styles.section}>
            <span style={styles.label}>PLY Options</span>
            <label style={styles.row}>
              <input
                type="checkbox"
                checked={loadManifest}
                onChange={(e) => setLoadManifest(e.target.checked)}
              />
              Look for companion manifest
            </label>
          </div>
        )}

        {format === 'obj' && (
          <div style={styles.section}>
            <span style={styles.label}>OBJ Options</span>
            <div style={styles.row}>
              <span style={{ fontSize: 12, color: '#aaa', minWidth: 120 }}>Voxel resolution</span>
              <NumberInput
                value={voxelResolution}
                onChange={setVoxelResolution}
                min={8}
                max={256}
                step={1}
              />
            </div>
          </div>
        )}

        <div style={styles.footer}>
          <button style={styles.btn} onClick={onCancel}>Cancel</button>
          <button
            style={{ ...styles.btnPrimary, opacity: file ? 1 : 0.5 }}
            onClick={handleImport}
            disabled={!file}
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
