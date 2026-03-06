import React, { useState } from 'react';
import { useSeuratStore } from '../../store/useSeuratStore.js';

export function AtlasView() {
  const manifest = useSeuratStore((s) => s.manifest);
  const assemblyResult = useSeuratStore((s) => s.assemblyResult);
  const assembleAtlas = useSeuratStore((s) => s.assembleAtlas);
  const spriteSheetUrl = useSeuratStore((s) => s.spriteSheetUrl);
  const loadSpriteSheet = useSeuratStore((s) => s.loadSpriteSheet);
  const [assembling, setAssembling] = useState(false);

  if (!manifest) {
    return (
      <div style={{ padding: 24, color: '#555', fontFamily: 'monospace', fontSize: 12 }}>
        Select a character from the Dashboard.
      </div>
    );
  }

  const handleAssemble = async (validateOnly: boolean) => {
    setAssembling(true);
    await assembleAtlas(validateOnly);
    setAssembling(false);
  };

  return (
    <div style={styles.container}>
      <div style={styles.title}>Atlas Assembly</div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>Spritesheet Config</div>
        <div style={styles.row}>
          <span style={styles.label}>Frame Size:</span>
          <span style={styles.value}>
            {manifest.spritesheet.frame_width}x{manifest.spritesheet.frame_height}
          </span>
        </div>
        <div style={styles.row}>
          <span style={styles.label}>Columns:</span>
          <span style={styles.value}>{manifest.spritesheet.columns}</span>
        </div>
        <div style={styles.row}>
          <span style={styles.label}>Animations:</span>
          <span style={styles.value}>{manifest.animations.length}</span>
        </div>
        <div style={styles.row}>
          <span style={styles.label}>Total Frames:</span>
          <span style={styles.value}>
            {manifest.animations.reduce((s, a) => s + a.frames.length, 0)}
          </span>
        </div>
      </div>

      <div style={styles.actions}>
        <button
          onClick={() => handleAssemble(true)}
          disabled={assembling}
          style={styles.validateBtn}
        >
          {assembling ? 'Validating...' : 'Validate Only'}
        </button>
        <button
          onClick={() => handleAssemble(false)}
          disabled={assembling}
          style={styles.assembleBtn}
        >
          {assembling ? 'Assembling...' : 'Assemble Atlas'}
        </button>
        <button onClick={loadSpriteSheet} style={styles.refreshBtn}>
          Reload Sheet
        </button>
      </div>

      {/* Result */}
      {assemblyResult && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Assembly Result</div>
          <div style={styles.row}>
            <span style={styles.label}>Approved Frames:</span>
            <span style={{ ...styles.value, color: '#44aa44' }}>
              {assemblyResult.approvedFrames} / {assemblyResult.totalFrames}
            </span>
          </div>
          {assemblyResult.errors.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <span style={{ ...styles.label, color: '#aa4444' }}>Errors:</span>
              {assemblyResult.errors.map((err, i) => (
                <div key={i} style={{ fontFamily: 'monospace', fontSize: 10, color: '#d88', padding: '2px 0' }}>
                  {err}
                </div>
              ))}
            </div>
          )}
          {assemblyResult.errors.length === 0 && (
            <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#70d870', marginTop: 4 }}>
              Assembly successful!
            </div>
          )}
        </div>
      )}

      {/* Sprite sheet preview */}
      {spriteSheetUrl && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Spritesheet Preview</div>
          <div style={styles.previewContainer}>
            <img
              src={spriteSheetUrl}
              alt="Sprite sheet"
              style={styles.previewImg}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: 24,
    maxWidth: 640,
    height: '100%',
    overflowY: 'auto',
  },
  title: {
    fontFamily: 'monospace',
    fontSize: 16,
    fontWeight: 700,
    color: '#ccc',
    marginBottom: 16,
  },
  section: {
    background: '#131324',
    border: '1px solid #2a2a3a',
    borderRadius: 6,
    padding: 12,
    marginBottom: 12,
  },
  sectionTitle: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#888',
    fontWeight: 600,
    marginBottom: 8,
  },
  row: {
    display: 'flex',
    gap: 8,
    alignItems: 'baseline',
    padding: '2px 0',
  },
  label: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#666',
  },
  value: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#bbb',
  },
  actions: {
    display: 'flex',
    gap: 8,
    marginBottom: 16,
  },
  validateBtn: {
    background: '#2a2a3a',
    border: '1px solid #444',
    borderRadius: 4,
    color: '#aaa',
    fontFamily: 'monospace',
    fontSize: 11,
    padding: '8px 16px',
    cursor: 'pointer',
  },
  assembleBtn: {
    background: '#1e3a6e',
    border: '1px solid #4a8af8',
    borderRadius: 4,
    color: '#90b8f8',
    fontFamily: 'monospace',
    fontSize: 11,
    padding: '8px 16px',
    cursor: 'pointer',
    fontWeight: 600,
  },
  refreshBtn: {
    background: '#222236',
    border: '1px solid #444',
    borderRadius: 4,
    color: '#888',
    fontFamily: 'monospace',
    fontSize: 11,
    padding: '8px 12px',
    cursor: 'pointer',
  },
  previewContainer: {
    background: '#0e0e1a',
    borderRadius: 4,
    padding: 8,
    overflow: 'auto',
    maxHeight: 400,
  },
  previewImg: {
    imageRendering: 'pixelated' as const,
    maxWidth: '100%',
    display: 'block',
  },
};
