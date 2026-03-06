import React, { useState } from 'react';
import { useSeuratStore } from '../../store/useSeuratStore.js';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CreateCharacterDialog({ open, onClose }: Props) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const createCharacter = useSeuratStore((s) => s.createCharacter);

  if (!open) return null;

  const handleCreate = async () => {
    if (!id.trim()) return;
    setCreating(true);
    try {
      await createCharacter(id.trim(), name.trim() || id.trim());
      setId('');
      setName('');
      onClose();
    } catch (err) {
      console.error('Failed to create character:', err);
    }
    setCreating(false);
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div style={styles.title}>New Character</div>

        <label style={styles.label}>Character ID (snake_case)</label>
        <input
          value={id}
          onChange={(e) => setId(e.target.value.replace(/[^a-z0-9_]/g, ''))}
          placeholder="town_guard"
          style={styles.input}
          autoFocus
        />

        <label style={styles.label}>Display Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Town Guard"
          style={styles.input}
        />

        <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={styles.cancelBtn}>Cancel</button>
          <button onClick={handleCreate} disabled={!id.trim() || creating} style={styles.createBtn}>
            {creating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  dialog: {
    background: '#1a1a2e',
    border: '1px solid #3a3a5a',
    borderRadius: 8,
    padding: 24,
    width: 360,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  title: {
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: 700,
    color: '#ccc',
    marginBottom: 8,
  },
  label: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#888',
    marginTop: 4,
  },
  input: {
    background: '#222236',
    border: '1px solid #444',
    borderRadius: 4,
    color: '#eee',
    fontFamily: 'monospace',
    fontSize: 12,
    padding: '6px 10px',
    outline: 'none',
  },
  cancelBtn: {
    background: '#2a2a3a',
    border: '1px solid #444',
    borderRadius: 4,
    color: '#aaa',
    fontFamily: 'monospace',
    fontSize: 11,
    padding: '6px 16px',
    cursor: 'pointer',
  },
  createBtn: {
    background: '#1e3a6e',
    border: '1px solid #4a8af8',
    borderRadius: 4,
    color: '#90b8f8',
    fontFamily: 'monospace',
    fontSize: 11,
    padding: '6px 16px',
    cursor: 'pointer',
    fontWeight: 600,
  },
};
