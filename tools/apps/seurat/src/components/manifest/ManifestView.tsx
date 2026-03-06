import React, { useState, useEffect } from 'react';
import { useSeuratStore, getManifestStats } from '../../store/useSeuratStore.js';

export function ManifestView() {
  const manifest = useSeuratStore((s) => s.manifest);
  const saveManifest = useSeuratStore((s) => s.saveManifest);
  const [json, setJson] = useState('');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (manifest) setJson(JSON.stringify(manifest, null, 2));
  }, [manifest]);

  if (!manifest) {
    return (
      <div style={{ padding: 24, color: '#555', fontFamily: 'monospace', fontSize: 12 }}>
        Select a character from the Dashboard.
      </div>
    );
  }

  const stats = getManifestStats(manifest);

  const handleSave = async () => {
    try {
      const parsed = JSON.parse(json);
      useSeuratStore.setState({ manifest: parsed });
      setSaving(true);
      await saveManifest();
      setSaving(false);
      setEditing(false);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid JSON');
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.title}>Manifest Editor</div>

      {/* Stats */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Statistics</div>
        <div style={styles.statsGrid}>
          <StatItem label="Version" value={String(manifest.version)} />
          <StatItem label="Character ID" value={manifest.character_id} />
          <StatItem label="Display Name" value={manifest.display_name} />
          <StatItem label="Frame Size" value={`${manifest.spritesheet.frame_width}x${manifest.spritesheet.frame_height}`} />
          <StatItem label="Columns" value={String(manifest.spritesheet.columns)} />
          <StatItem label="Animations" value={String(manifest.animations.length)} />
          <StatItem label="Total Frames" value={String(stats.total)} />
          <StatItem label="Pending" value={String(stats.pending)} color="#aa8800" />
          <StatItem label="Generated" value={String(stats.generated)} color="#aa8800" />
          <StatItem label="Approved" value={String(stats.approved)} color="#44aa44" />
          <StatItem label="Rejected" value={String(stats.rejected)} color="#aa4444" />
        </div>
      </div>

      {/* Spritesheet config */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Spritesheet Config</div>
        <div style={styles.configRow}>
          <span style={styles.label}>frame_width:</span>
          <span style={styles.value}>{manifest.spritesheet.frame_width}</span>
        </div>
        <div style={styles.configRow}>
          <span style={styles.label}>frame_height:</span>
          <span style={styles.value}>{manifest.spritesheet.frame_height}</span>
        </div>
        <div style={styles.configRow}>
          <span style={styles.label}>columns:</span>
          <span style={styles.value}>{manifest.spritesheet.columns}</span>
        </div>
        {manifest.atlas && (
          <>
            <div style={styles.configRow}>
              <span style={styles.label}>atlas file:</span>
              <span style={styles.value}>{manifest.atlas.file}</span>
            </div>
            <div style={styles.configRow}>
              <span style={styles.label}>atlas size:</span>
              <span style={styles.value}>{manifest.atlas.width}x{manifest.atlas.height}</span>
            </div>
          </>
        )}
      </div>

      {/* Raw JSON */}
      <div style={styles.section}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={styles.sectionTitle}>Raw JSON</div>
          {!editing && (
            <button onClick={() => setEditing(true)} style={styles.editBtn}>Edit</button>
          )}
          {editing && (
            <>
              <button onClick={handleSave} disabled={saving} style={styles.saveBtn}>
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => { setEditing(false); setJson(JSON.stringify(manifest, null, 2)); setError(''); }} style={styles.cancelBtn}>
                Cancel
              </button>
            </>
          )}
        </div>
        {error && <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#d88', marginTop: 4 }}>{error}</div>}
        <textarea
          value={json}
          onChange={(e) => setJson(e.target.value)}
          readOnly={!editing}
          style={{
            ...styles.jsonEditor,
            background: editing ? '#1a1a30' : '#111120',
            borderColor: editing ? '#4a8af8' : '#2a2a3a',
          }}
          spellCheck={false}
        />
      </div>
    </div>
  );
}

function StatItem({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '1px 0' }}>
      <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#666', minWidth: 90 }}>{label}:</span>
      <span style={{ fontFamily: 'monospace', fontSize: 11, color: color ?? '#bbb' }}>{value}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: 24,
    maxWidth: 700,
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
  statsGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  configRow: {
    display: 'flex',
    gap: 8,
    padding: '1px 0',
  },
  label: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#666',
    minWidth: 100,
  },
  value: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#bbb',
  },
  editBtn: {
    background: '#222236',
    border: '1px solid #444',
    borderRadius: 3,
    color: '#888',
    fontFamily: 'monospace',
    fontSize: 9,
    padding: '2px 8px',
    cursor: 'pointer',
  },
  saveBtn: {
    background: '#1e3a6e',
    border: '1px solid #4a8af8',
    borderRadius: 3,
    color: '#90b8f8',
    fontFamily: 'monospace',
    fontSize: 9,
    padding: '2px 8px',
    cursor: 'pointer',
  },
  cancelBtn: {
    background: '#2a2a3a',
    border: '1px solid #444',
    borderRadius: 3,
    color: '#888',
    fontFamily: 'monospace',
    fontSize: 9,
    padding: '2px 8px',
    cursor: 'pointer',
  },
  jsonEditor: {
    width: '100%',
    minHeight: 300,
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#ccc',
    border: '1px solid',
    borderRadius: 4,
    padding: 8,
    resize: 'vertical' as const,
    outline: 'none',
    marginTop: 8,
    lineHeight: 1.5,
  },
};
