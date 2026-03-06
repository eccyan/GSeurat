import React, { useState } from 'react';
import type { CharacterFrame, FrameStatus } from '@vulkan-game-tools/asset-types';

interface Props {
  frame: CharacterFrame;
  animName: string;
  characterId: string;
  onClose: () => void;
  onUpdateStatus: (status: FrameStatus, notes?: string) => void;
}

export function FrameDetailModal({ frame, animName, characterId, onClose, onUpdateStatus }: Props) {
  const [notes, setNotes] = useState(frame.review?.notes ?? '');

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <span style={styles.title}>{animName} / frame {frame.index}</span>
          <button onClick={onClose} style={styles.closeBtn}>X</button>
        </div>

        <div style={styles.body}>
          <div style={styles.previewArea}>
            <div style={styles.placeholder}>
              <span style={{ fontSize: 11 }}>{frame.file}</span>
              <span style={{ fontSize: 9, color: '#555' }}>Status: {frame.status}</span>
            </div>
          </div>

          <div style={styles.details}>
            <div style={styles.field}>
              <span style={styles.label}>Source:</span>
              <span style={styles.value}>{frame.source}</span>
            </div>
            <div style={styles.field}>
              <span style={styles.label}>Duration:</span>
              <span style={styles.value}>{frame.duration.toFixed(3)}s</span>
            </div>
            <div style={styles.field}>
              <span style={styles.label}>Tile ID:</span>
              <span style={styles.value}>{frame.tile_id}</span>
            </div>
            {frame.generation && (
              <div style={styles.field}>
                <span style={styles.label}>Prompt:</span>
                <span style={{ ...styles.value, fontSize: 9 }}>{frame.generation.prompt}</span>
              </div>
            )}

            <label style={{ ...styles.label, marginTop: 8 }}>Review Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              style={styles.textarea}
              placeholder="Notes about this frame..."
            />

            <div style={styles.actions}>
              <button
                onClick={() => onUpdateStatus('approved', notes)}
                style={styles.approveBtn}
              >
                Approve
              </button>
              <button
                onClick={() => onUpdateStatus('rejected', notes)}
                style={styles.rejectBtn}
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: '#1a1a2e',
    border: '1px solid #3a3a5a',
    borderRadius: 8,
    width: 500,
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 16px',
    borderBottom: '1px solid #2a2a3a',
  },
  title: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: '#ccc',
    fontWeight: 600,
    flex: 1,
  },
  closeBtn: {
    background: 'transparent',
    border: '1px solid #444',
    borderRadius: 3,
    color: '#888',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: 11,
    padding: '2px 8px',
  },
  body: {
    padding: 16,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  previewArea: {
    height: 160,
    background: '#111120',
    borderRadius: 4,
    border: '1px solid #2a2a3a',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholder: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    fontFamily: 'monospace',
    color: '#666',
  },
  details: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  field: {
    display: 'flex',
    gap: 8,
    alignItems: 'baseline',
  },
  label: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#666',
    flexShrink: 0,
  },
  value: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#bbb',
  },
  textarea: {
    background: '#222236',
    border: '1px solid #444',
    borderRadius: 4,
    color: '#ddd',
    fontFamily: 'monospace',
    fontSize: 11,
    padding: '6px 8px',
    resize: 'vertical' as const,
    outline: 'none',
  },
  actions: {
    display: 'flex',
    gap: 8,
    marginTop: 8,
  },
  approveBtn: {
    background: '#1e3a2e',
    border: '1px solid #44aa44',
    borderRadius: 4,
    color: '#70d870',
    fontFamily: 'monospace',
    fontSize: 11,
    padding: '6px 16px',
    cursor: 'pointer',
    fontWeight: 600,
  },
  rejectBtn: {
    background: '#3a1e1e',
    border: '1px solid #aa4444',
    borderRadius: 4,
    color: '#d87070',
    fontFamily: 'monospace',
    fontSize: 11,
    padding: '6px 16px',
    cursor: 'pointer',
    fontWeight: 600,
  },
};
