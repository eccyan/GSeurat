import React, { useState, useEffect } from 'react';
import { useSeuratStore } from '../../store/useSeuratStore.js';

export function TreePane() {
  const characters = useSeuratStore((s) => s.characters);
  const manifest = useSeuratStore((s) => s.manifest);
  const selectedCharacterId = useSeuratStore((s) => s.selectedCharacterId);
  const treeSelection = useSeuratStore((s) => s.treeSelection);
  const setTreeSelection = useSeuratStore((s) => s.setTreeSelection);
  const selectCharacter = useSeuratStore((s) => s.selectCharacter);
  const refreshCharacters = useSeuratStore((s) => s.refreshCharacters);
  const createCharacter = useSeuratStore((s) => s.createCharacter);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // Load characters on mount
  useEffect(() => { refreshCharacters(); }, []);

  // Auto-expand selected character
  useEffect(() => {
    if (selectedCharacterId) {
      setExpanded((prev) => ({ ...prev, [selectedCharacterId]: true }));
    }
  }, [selectedCharacterId]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCharacterClick = async (id: string) => {
    if (selectedCharacterId !== id) {
      await selectCharacter(id);
    }
    setExpanded((prev) => ({ ...prev, [id]: true }));
    setTreeSelection({ kind: 'character', characterId: id });
  };

  const handleAnimClick = async (characterId: string, animName: string) => {
    if (selectedCharacterId !== characterId) {
      await selectCharacter(characterId);
    }
    setTreeSelection({ kind: 'animation', characterId, animName });
  };

  const handleCreate = async () => {
    if (!newId.trim()) return;
    setIsCreating(true);
    try {
      await createCharacter(newId.trim(), newName.trim() || newId.trim());
      setNewId('');
      setNewName('');
      setCreating(false);
    } catch (err) {
      console.error('Failed to create character:', err);
    }
    setIsCreating(false);
  };

  const isManifestSelected = treeSelection.kind === 'manifest';
  const isCharSelected = (id: string) =>
    treeSelection.kind === 'character' && treeSelection.characterId === id;
  const isAnimSelected = (id: string, anim: string) =>
    treeSelection.kind === 'animation' && treeSelection.characterId === id && treeSelection.animName === anim;

  // Get animations for a character (only available for the loaded manifest)
  const getAnims = (id: string) => {
    if (selectedCharacterId === id && manifest) return manifest.animations;
    return [];
  };

  return (
    <div style={styles.pane}>
      {/* New Character */}
      {creating ? (
        <div style={styles.createForm}>
          <input
            value={newId}
            onChange={(e) => setNewId(e.target.value.replace(/[^a-z0-9_]/g, ''))}
            placeholder="character_id"
            style={styles.createInput}
            autoFocus
            onKeyDown={(e) => e.key === 'Escape' && setCreating(false)}
          />
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Display Name"
            style={styles.createInput}
          />
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={handleCreate}
              disabled={!newId.trim() || isCreating}
              style={styles.createBtn}
            >
              {isCreating ? '...' : 'Add'}
            </button>
            <button onClick={() => setCreating(false)} style={styles.cancelBtn}>
              X
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setCreating(true)} style={styles.newBtn}>
          + New Character
        </button>
      )}

      {/* Manifest node */}
      <button
        onClick={() => setTreeSelection({ kind: 'manifest' })}
        style={{
          ...styles.treeNode,
          background: isManifestSelected ? '#1e2a42' : 'transparent',
          color: isManifestSelected ? '#90b8f8' : '#aaa',
          borderLeft: isManifestSelected ? '3px solid #4a8af8' : '3px solid transparent',
        }}
      >
        Manifest
      </button>

      {/* Character list */}
      {characters.map((id) => {
        const isExpanded = expanded[id] ?? false;
        const charSelected = isCharSelected(id);
        const anims = getAnims(id);

        return (
          <div key={id}>
            <button
              onClick={() => handleCharacterClick(id)}
              style={{
                ...styles.treeNode,
                background: charSelected ? '#1e2a42' : selectedCharacterId === id ? '#161630' : 'transparent',
                color: charSelected ? '#90b8f8' : selectedCharacterId === id ? '#8090b8' : '#888',
                borderLeft: charSelected ? '3px solid #4a8af8' : '3px solid transparent',
                fontWeight: 600,
              }}
            >
              <span
                onClick={(e) => { e.stopPropagation(); toggleExpand(id); }}
                style={{ fontSize: 8, color: '#555', marginRight: 4, padding: '2px 4px', cursor: 'pointer' }}
              >
                {isExpanded ? '\u25BC' : '\u25B6'}
              </span>
              {id}
            </button>

            {isExpanded && anims.map((anim) => {
              const animSel = isAnimSelected(id, anim.name);
              return (
                <button
                  key={anim.name}
                  onClick={() => handleAnimClick(id, anim.name)}
                  style={{
                    ...styles.treeNode,
                    paddingLeft: 24,
                    background: animSel ? '#1e2a42' : 'transparent',
                    color: animSel ? '#90b8f8' : '#666',
                    borderLeft: animSel ? '3px solid #4a8af8' : '3px solid transparent',
                    fontSize: 10,
                  }}
                >
                  {anim.name}
                  <span style={{ marginLeft: 'auto', fontSize: 8, color: '#444' }}>
                    {anim.frames.length}f
                  </span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  pane: {
    width: 220,
    flexShrink: 0,
    background: '#111120',
    borderRight: '1px solid #2a2a3a',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
  },
  newBtn: {
    background: 'transparent',
    border: 'none',
    borderBottom: '1px solid #2a2a3a',
    color: '#4a8af8',
    fontFamily: 'monospace',
    fontSize: 11,
    padding: '8px 12px',
    cursor: 'pointer',
    textAlign: 'left',
    fontWeight: 600,
  },
  createForm: {
    padding: 8,
    borderBottom: '1px solid #2a2a3a',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  createInput: {
    background: '#1a1a2e',
    border: '1px solid #3a3a5a',
    borderRadius: 3,
    color: '#ddd',
    fontFamily: 'monospace',
    fontSize: 10,
    padding: '4px 6px',
    outline: 'none',
  },
  createBtn: {
    flex: 1,
    background: '#1e3a6e',
    border: '1px solid #4a8af8',
    borderRadius: 3,
    color: '#90b8f8',
    fontFamily: 'monospace',
    fontSize: 9,
    padding: '3px 8px',
    cursor: 'pointer',
  },
  cancelBtn: {
    background: '#2a2a3a',
    border: '1px solid #444',
    borderRadius: 3,
    color: '#888',
    fontFamily: 'monospace',
    fontSize: 9,
    padding: '3px 6px',
    cursor: 'pointer',
  },
  treeNode: {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    background: 'transparent',
    border: 'none',
    color: '#888',
    fontFamily: 'monospace',
    fontSize: 11,
    padding: '5px 10px',
    cursor: 'pointer',
    textAlign: 'left',
    gap: 2,
  },
};
