import React, { useState, useRef } from 'react';
import { useCharacterStore } from '../store/useCharacterStore.js';
import { parseVox } from '../lib/voxImport.js';

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
  fileBtn: {
    padding: '6px 16px', border: '1px dashed #555', borderRadius: 4,
    background: '#2a2a4a', color: '#aaa', cursor: 'pointer', fontSize: 13,
    textAlign: 'center' as const,
  },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
};

type ImportFormat = 'vox' | 'ply_bone';

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const [format, setFormat] = useState<ImportFormat>('vox');
  const [file, setFile] = useState<File | null>(null);
  const [autoCreateParts, setAutoCreateParts] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const accept = format === 'vox' ? '.vox' : '.ply';

  const handleImport = async () => {
    if (!file) return;

    if (format === 'vox') {
      const buffer = await file.arrayBuffer();
      const voxFile = parseVox(buffer);
      const models = voxFile.models.map((m, i) => ({
        name: autoCreateParts ? `part_${i}` : `imported_${i}`,
        voxels: m.voxels,
      }));
      useCharacterStore.getState().pushUndo();
      useCharacterStore.getState().importVoxModels(models);
    }
    // PLY with bone_index import could be added in the future

    onClose();
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div style={styles.title}>Import</div>

        <div style={styles.section}>
          <span style={styles.label}>Format</span>
          <label style={styles.radio}>
            <input type="radio" checked={format === 'vox'} onChange={() => setFormat('vox')} />
            MagicaVoxel (.vox)
          </label>
          <label style={styles.radio}>
            <input type="radio" checked={format === 'ply_bone'} onChange={() => setFormat('ply_bone')} />
            PLY with bone_index
          </label>
        </div>

        <div style={styles.section}>
          <span style={styles.label}>File</span>
          <div
            style={styles.fileBtn}
            onClick={() => fileRef.current?.click()}
          >
            {file ? file.name : 'Choose file...'}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={accept}
            style={{ display: 'none' }}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>

        <div style={styles.section}>
          <span style={styles.label}>Options</span>
          <label style={styles.radio}>
            <input type="checkbox" checked={autoCreateParts} onChange={(e) => setAutoCreateParts(e.target.checked)} />
            Auto-create parts
          </label>
        </div>

        <div style={styles.footer}>
          <button style={styles.btn} onClick={onClose}>Cancel</button>
          <button
            style={styles.btnPrimary}
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
