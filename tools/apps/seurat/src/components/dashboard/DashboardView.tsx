import React, { useEffect, useState } from 'react';
import { useSeuratStore } from '../../store/useSeuratStore.js';
import { CharacterCard } from './CharacterCard.js';
import { CreateCharacterDialog } from './CreateCharacterDialog.js';

export function DashboardView() {
  const characters = useSeuratStore((s) => s.characters);
  const selectedCharacterId = useSeuratStore((s) => s.selectedCharacterId);
  const refreshCharacters = useSeuratStore((s) => s.refreshCharacters);
  const selectCharacter = useSeuratStore((s) => s.selectCharacter);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    refreshCharacters();
  }, [refreshCharacters]);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>Characters</span>
        <button onClick={() => refreshCharacters()} style={styles.refreshBtn} title="Refresh">
          Refresh
        </button>
        <button onClick={() => setShowCreate(true)} style={styles.createBtn}>
          + New Character
        </button>
      </div>

      <div style={styles.grid}>
        {characters.length === 0 && (
          <div style={styles.empty}>
            No characters found. Create one to get started.
          </div>
        )}
        {characters.map((id) => (
          <CharacterCard
            key={id}
            characterId={id}
            selected={id === selectedCharacterId}
            onSelect={() => selectCharacter(id)}
          />
        ))}
      </div>

      <CreateCharacterDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
      />
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
  },
  title: {
    fontFamily: 'monospace',
    fontSize: 18,
    fontWeight: 700,
    color: '#ccc',
    flex: 1,
  },
  refreshBtn: {
    background: '#222236',
    border: '1px solid #444',
    borderRadius: 4,
    color: '#888',
    fontFamily: 'monospace',
    fontSize: 11,
    padding: '6px 12px',
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
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: 12,
  },
  empty: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#555',
    padding: 24,
    textAlign: 'center',
    gridColumn: '1 / -1',
  },
};
