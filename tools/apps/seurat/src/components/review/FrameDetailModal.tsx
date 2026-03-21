import React from 'react';
import type { CharacterFrame } from '@gseurat/asset-types';
import { frameThumbnailUrl } from '../../lib/bridge-api.js';

interface Props {
  frame: CharacterFrame;
  animName: string;
  characterId: string;
  onClose: () => void;
}

export function FrameDetailModal({ frame, animName, characterId, onClose }: Props) {
  const hasImage = frame.status !== 'pending' && frame.status !== 'generating';

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <span style={styles.title}>{animName} / frame {frame.index}</span>
          <span style={{ fontFamily: 'monospace', fontSize: 10, color: STATUS_COLORS[frame.status] }}>
            {frame.status}
          </span>
          <button onClick={onClose} style={styles.closeBtn}>X</button>
        </div>

        <div style={styles.body}>
          <div style={styles.previewArea}>
            {hasImage ? (
              <img
                src={frameThumbnailUrl(characterId, animName, frame.index)}
                alt={`${animName} f${frame.index}`}
                style={styles.previewImage}
              />
            ) : (
              <div style={styles.placeholder}>
                <span style={{ fontSize: 11 }}>f{frame.index}</span>
                <span style={{ fontSize: 9, color: '#555' }}>Not yet generated</span>
              </div>
            )}
          </div>

          <div style={styles.details}>
            <div style={styles.field}>
              <span style={styles.label}>File:</span>
              <span style={styles.value}>{frame.file}</span>
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
          </div>
        </div>
      </div>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#666',
  generating: '#cc8800',
  generated: '#aa8800',
};

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
    gap: 8,
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
    height: 200,
    background: '#111120',
    borderRadius: 4,
    border: '1px solid #2a2a3a',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  previewImage: {
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain',
    imageRendering: 'pixelated',
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
};
