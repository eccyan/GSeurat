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

  const characterName = useCharacterStore((s) => s.characterName);
  const baseName = characterName.replace(/\s+/g, '_').toLowerCase() || 'character';
  const filename = format === 'ply_manifest' ? `${baseName}.ply` : `${baseName}_posed.ply`;

  const handleExport = () => {
    const s = useCharacterStore.getState();
    const parts = includeBoneIndex ? s.characterParts : undefined;
    const blob = exportPly(s.voxels, s.gridWidth, s.gridDepth, parts);
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
