// tools/apps/echidna/src/panels/DeleteCharacterDialog.tsx
import React from 'react';

interface Props {
  characterName: string;
  characterId: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000,
  },
  dialog: { background: '#1e1e3a', border: '1px solid #444', borderRadius: 6, padding: 24, width: 460 },
  title: { fontSize: 15, color: '#ddd', marginBottom: 12 },
  body: { fontSize: 13, color: '#bbb', lineHeight: 1.5, marginBottom: 20 },
  warn: { color: '#fa0', fontSize: 12, marginTop: 8 },
  buttons: { display: 'flex', gap: 8, justifyContent: 'flex-end' },
  button: { padding: '8px 16px', fontSize: 13, border: '1px solid #444', borderRadius: 4, cursor: 'pointer' },
  buttonDanger: { background: '#6a2a3a', color: '#fff', borderColor: '#8a3a4a' },
  buttonNeutral: { background: '#2a2a4a', color: '#ccc' },
};

export function DeleteCharacterDialog({ characterName, characterId, onConfirm, onCancel }: Props) {
  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div style={styles.title}>Delete character</div>
        <div style={styles.body}>
          Delete <strong>{characterName}</strong>? The <code>.echidna</code> source file will be permanently removed from <code>tools_data/echidna_saves/</code>.
          <div style={styles.warn}>
            ⚠ Exported files in <code>assets/characters/{characterId}/</code> will NOT be removed. Delete them manually if desired.
          </div>
          <div style={{ marginTop: 12 }}>This cannot be undone.</div>
        </div>
        <div style={styles.buttons}>
          <button style={{ ...styles.button, ...styles.buttonNeutral }} onClick={onCancel}>Cancel</button>
          <button style={{ ...styles.button, ...styles.buttonDanger }} onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  );
}
