// tools/apps/echidna/src/panels/DuplicateCharacterDialog.tsx
import React, { useState, useRef, useEffect } from 'react';

interface Props {
  sourceName: string;
  onSubmit: (newName: string) => void;
  onCancel: () => void;
}

const NAME_RE = /^[A-Za-z0-9 _\-]+$/;

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000,
  },
  dialog: { background: '#1e1e3a', border: '1px solid #444', borderRadius: 6, padding: 24, width: 420 },
  title: { fontSize: 15, color: '#ddd', marginBottom: 12 },
  input: {
    width: '100%', padding: '8px 10px', fontSize: 13,
    background: '#16162a', border: '1px solid #444', borderRadius: 4,
    color: '#ddd', marginBottom: 16,
  },
  buttons: { display: 'flex', gap: 8, justifyContent: 'flex-end' },
  button: { padding: '8px 16px', fontSize: 13, border: '1px solid #444', borderRadius: 4, cursor: 'pointer' },
  buttonPrimary: { background: '#3a6a8a', color: '#fff', borderColor: '#4a7a9a' },
  buttonNeutral: { background: '#2a2a4a', color: '#ccc' },
  buttonDisabled: { opacity: 0.4, cursor: 'not-allowed' },
};

export function DuplicateCharacterDialog({ sourceName, onSubmit, onCancel }: Props) {
  const [value, setValue] = useState(`Copy of ${sourceName}`);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  const trimmed = value.trim();
  const valid = trimmed.length > 0 && trimmed.length <= 64 && NAME_RE.test(trimmed);
  const submit = () => { if (valid) onSubmit(trimmed); };

  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div style={styles.title}>Duplicate "{sourceName}"</div>
        <input
          ref={inputRef}
          style={styles.input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') onCancel();
          }}
          maxLength={64}
        />
        <div style={styles.buttons}>
          <button style={{ ...styles.button, ...styles.buttonNeutral }} onClick={onCancel}>Cancel</button>
          <button
            style={{
              ...styles.button,
              ...styles.buttonPrimary,
              ...(valid ? {} : styles.buttonDisabled),
            }}
            disabled={!valid}
            onClick={submit}
          >
            Duplicate
          </button>
        </div>
      </div>
    </div>
  );
}
