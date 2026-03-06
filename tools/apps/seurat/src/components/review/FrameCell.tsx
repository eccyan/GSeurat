import React from 'react';
import type { CharacterFrame, FrameStatus } from '@vulkan-game-tools/asset-types';

const STATUS_COLORS: Record<FrameStatus, string> = {
  pending: '#666',
  generating: '#cc8800',
  generated: '#aa8800',
  approved: '#44aa44',
  rejected: '#aa4444',
};

const STATUS_LABELS: Record<FrameStatus, string> = {
  pending: 'P',
  generating: '...',
  generated: 'G',
  approved: 'OK',
  rejected: 'X',
};

interface Props {
  frame: CharacterFrame;
  animName: string;
  onApprove: () => void;
  onReject: () => void;
  onRegenerate: () => void;
  onClick: () => void;
}

export function FrameCell({ frame, animName, onApprove, onReject, onRegenerate, onClick }: Props) {
  return (
    <div onClick={onClick} style={{ ...styles.cell, borderColor: STATUS_COLORS[frame.status] }}>
      <div style={{ ...styles.badge, background: STATUS_COLORS[frame.status] }}>
        {STATUS_LABELS[frame.status]}
      </div>

      <div style={styles.frameIndex}>f{frame.index}</div>
      <div style={styles.fileName}>{frame.file}</div>

      <div style={styles.actions}>
        <button
          onClick={(e) => { e.stopPropagation(); onApprove(); }}
          style={styles.approveBtn}
          title="Approve"
        >
          OK
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onReject(); }}
          style={styles.rejectBtn}
          title="Reject"
        >
          X
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onRegenerate(); }}
          style={styles.regenBtn}
          title="Regenerate"
        >
          Re
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  cell: {
    width: 64,
    border: '2px solid',
    borderRadius: 4,
    background: '#161624',
    cursor: 'pointer',
    position: 'relative',
    padding: 2,
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    fontSize: 8,
    color: '#fff',
    padding: '0 3px',
    borderRadius: 2,
    fontFamily: 'monospace',
  },
  frameIndex: {
    textAlign: 'center',
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#ccc',
    padding: '10px 0 2px',
  },
  fileName: {
    textAlign: 'center',
    fontSize: 7,
    fontFamily: 'monospace',
    color: '#555',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    padding: '0 2px',
  },
  actions: {
    display: 'flex',
    gap: 1,
    padding: '3px 2px 2px',
    justifyContent: 'center',
  },
  approveBtn: {
    fontSize: 9,
    padding: '1px 4px',
    background: '#253525',
    border: 'none',
    color: '#8d8',
    cursor: 'pointer',
    borderRadius: 2,
    fontFamily: 'monospace',
  },
  rejectBtn: {
    fontSize: 9,
    padding: '1px 4px',
    background: '#352525',
    border: 'none',
    color: '#d88',
    cursor: 'pointer',
    borderRadius: 2,
    fontFamily: 'monospace',
  },
  regenBtn: {
    fontSize: 9,
    padding: '1px 4px',
    background: '#252535',
    border: 'none',
    color: '#88d',
    cursor: 'pointer',
    borderRadius: 2,
    fontFamily: 'monospace',
  },
};
