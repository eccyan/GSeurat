import React, { useState } from 'react';
import type { CharacterFrame, FrameStatus } from '@vulkan-game-tools/asset-types';
import { useSeuratStore } from '../../store/useSeuratStore.js';
import { FrameCell } from './FrameCell.js';
import { FrameDetailModal } from './FrameDetailModal.js';

const FILTER_OPTIONS: Array<{ value: FrameStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'generated', label: 'Generated' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

export function ReviewView() {
  const manifest = useSeuratStore((s) => s.manifest);
  const reviewFilter = useSeuratStore((s) => s.reviewFilter);
  const setReviewFilter = useSeuratStore((s) => s.setReviewFilter);
  const updateFrameStatus = useSeuratStore((s) => s.updateFrameStatus);
  const batchApproveGenerated = useSeuratStore((s) => s.batchApproveGenerated);

  const [detailFrame, setDetailFrame] = useState<{ animName: string; frame: CharacterFrame } | null>(null);

  if (!manifest) {
    return (
      <div style={{ padding: 24, color: '#555', fontFamily: 'monospace', fontSize: 12 }}>
        Select a character from the Dashboard.
      </div>
    );
  }

  const filteredAnims = manifest.animations.map((anim) => ({
    ...anim,
    frames: anim.frames.filter((f) => reviewFilter === 'all' || f.status === reviewFilter),
  }));

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>Frame Review</span>
        <div style={styles.filters}>
          {FILTER_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setReviewFilter(value)}
              style={{
                ...styles.filterBtn,
                background: reviewFilter === value ? '#1e2a42' : 'transparent',
                borderColor: reviewFilter === value ? '#4a8af8' : '#333',
                color: reviewFilter === value ? '#90b8f8' : '#666',
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={batchApproveGenerated} style={styles.batchBtn}>
          Approve All Generated
        </button>
      </div>

      <div style={styles.grid}>
        {filteredAnims.map((anim) => {
          if (anim.frames.length === 0) return null;
          return (
            <div key={anim.name} style={styles.animGroup}>
              <div style={styles.animLabel}>{anim.name}</div>
              <div style={styles.framesRow}>
                {anim.frames.map((frame) => (
                  <FrameCell
                    key={frame.index}
                    frame={frame}
                    animName={anim.name}
                    onApprove={() => updateFrameStatus(anim.name, frame.index, 'approved')}
                    onReject={() => updateFrameStatus(anim.name, frame.index, 'rejected')}
                    onRegenerate={() => {}}
                    onClick={() => setDetailFrame({ animName: anim.name, frame })}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {detailFrame && (
        <FrameDetailModal
          frame={detailFrame.frame}
          animName={detailFrame.animName}
          characterId={manifest.character_id}
          onClose={() => setDetailFrame(null)}
          onUpdateStatus={(status, notes) => {
            updateFrameStatus(detailFrame.animName, detailFrame.frame.index, status, notes);
            setDetailFrame(null);
          }}
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: 24,
    height: '100%',
    overflowY: 'auto',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
    flexWrap: 'wrap',
  },
  title: {
    fontFamily: 'monospace',
    fontSize: 16,
    fontWeight: 700,
    color: '#ccc',
  },
  filters: {
    display: 'flex',
    gap: 4,
  },
  filterBtn: {
    border: '1px solid',
    borderRadius: 3,
    fontFamily: 'monospace',
    fontSize: 10,
    padding: '4px 10px',
    cursor: 'pointer',
    background: 'transparent',
  },
  batchBtn: {
    background: '#1e3a2e',
    border: '1px solid #44aa44',
    borderRadius: 4,
    color: '#70d870',
    fontFamily: 'monospace',
    fontSize: 10,
    padding: '6px 12px',
    cursor: 'pointer',
  },
  grid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  animGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  animLabel: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#aaa',
    fontWeight: 600,
  },
  framesRow: {
    display: 'flex',
    gap: 4,
    flexWrap: 'wrap',
  },
};
