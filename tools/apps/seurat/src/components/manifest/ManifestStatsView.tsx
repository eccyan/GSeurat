import React, { useCallback } from 'react';
import { useSeuratStore, getManifestStats } from '../../store/useSeuratStore.js';
import type { CharacterManifest } from '@gseurat/asset-types';
import { NumericInput } from '../NumericInput.js';

export function ManifestStatsView() {
  const manifest = useSeuratStore((s) => s.manifest);
  const saveManifest = useSeuratStore((s) => s.saveManifest);

  const updateSpritesheet = useCallback((field: 'frame_width' | 'frame_height' | 'columns', value: number) => {
    if (!manifest || isNaN(value) || value < 1) return;
    const updated: CharacterManifest = {
      ...manifest,
      spritesheet: { ...manifest.spritesheet, [field]: value },
    };
    useSeuratStore.setState({ manifest: updated });
    saveManifest();
  }, [manifest, saveManifest]);

  if (!manifest) {
    return (
      <div style={styles.empty}>Select a character to view manifest.</div>
    );
  }

  const stats = getManifestStats(manifest);

  return (
    <div style={styles.container}>
      <div style={styles.title}>Manifest</div>

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
          <StatItem label="Generated" value={String(stats.generated)} color="#44aa44" />
        </div>
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>Spritesheet Config</div>
        <EditableRow label="frame_width" value={manifest.spritesheet.frame_width}
          onChange={(v) => updateSpritesheet('frame_width', v)} min={16} max={512} step={16} />
        <EditableRow label="frame_height" value={manifest.spritesheet.frame_height}
          onChange={(v) => updateSpritesheet('frame_height', v)} min={16} max={512} step={16} />
        <EditableRow label="columns" value={manifest.spritesheet.columns}
          onChange={(v) => updateSpritesheet('columns', v)} min={1} max={32} step={1} />
        {manifest.atlas && (
          <>
            <ConfigRow label="atlas file" value={manifest.atlas.file} />
            <ConfigRow label="atlas size" value={`${manifest.atlas.width}x${manifest.atlas.height}`} />
          </>
        )}
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

function EditableRow({ label, value, onChange, min, max, step }: {
  label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number;
}) {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '1px 0', alignItems: 'center' }}>
      <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#666', minWidth: 100 }}>{label}:</span>
      <NumericInput value={value} onChange={onChange} min={min} max={max} step={step} integer fallback={value}
        style={{ width: 60, fontFamily: 'monospace', fontSize: 11, color: '#bbb', background: '#1a1a2e', border: '1px solid #2a2a3a', borderRadius: 3, padding: '1px 4px', textAlign: 'right' }} />
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '1px 0' }}>
      <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#666', minWidth: 100 }}>{label}:</span>
      <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#bbb' }}>{value}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: 24,
    maxWidth: 600,
    height: '100%',
    overflowY: 'auto',
  },
  empty: {
    padding: 24,
    color: '#555',
    fontFamily: 'monospace',
    fontSize: 12,
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
};
