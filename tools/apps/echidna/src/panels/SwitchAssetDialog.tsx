// tools/apps/echidna/src/panels/SwitchAssetDialog.tsx
import React from 'react';
import type { SwitchDecision } from '../store/useCharacterStore.js';

interface Props {
  currentName: string;
  targetName: string;
  undoDepth: number;
  onDecide: (decision: SwitchDecision) => void;
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  dialog: {
    background: '#1e1e3a',
    border: '1px solid #444',
    borderRadius: 6,
    padding: 24,
    width: 440,
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
  },
  title: { fontSize: 15, color: '#ddd', marginBottom: 12 },
  body: { fontSize: 13, color: '#bbb', lineHeight: 1.5, marginBottom: 20 },
  buttons: { display: 'flex', gap: 8, justifyContent: 'flex-end' },
  button: {
    padding: '8px 16px',
    fontSize: 13,
    border: '1px solid #444',
    borderRadius: 4,
    cursor: 'pointer',
  },
  buttonPrimary: { background: '#3a6a8a', color: '#fff', borderColor: '#4a7a9a' },
  buttonDanger: { background: '#6a2a3a', color: '#fff', borderColor: '#8a3a4a' },
  buttonNeutral: { background: '#2a2a4a', color: '#ccc' },
};

export function SwitchAssetDialog({ currentName, targetName, undoDepth, onDecide }: Props) {
  return (
    <div style={styles.overlay} onClick={() => onDecide('cancel')}>
      <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div style={styles.title}>Unsaved changes</div>
        <div style={styles.body}>
          You have unsaved changes to <strong>{currentName}</strong>.
          {undoDepth > 0 && (
            <>
              <br />
              Switching to <strong>{targetName}</strong> will clear your undo history ({undoDepth} steps) in addition to any unsaved edits.
            </>
          )}
          {undoDepth === 0 && (
            <>
              {' '}Switching to <strong>{targetName}</strong> will discard the unsaved edits.
            </>
          )}
        </div>
        <div style={styles.buttons}>
          <button style={{ ...styles.button, ...styles.buttonNeutral }} onClick={() => onDecide('cancel')}>
            Cancel
          </button>
          <button style={{ ...styles.button, ...styles.buttonDanger }} onClick={() => onDecide('discard')}>
            Discard &amp; Switch
          </button>
          <button style={{ ...styles.button, ...styles.buttonPrimary }} onClick={() => onDecide('save')}>
            Save &amp; Switch
          </button>
        </div>
      </div>
    </div>
  );
}
