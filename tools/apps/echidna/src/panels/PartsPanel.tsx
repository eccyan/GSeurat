import React, { useState } from 'react';
import { useCharacterStore } from '../store/useCharacterStore.js';
import type { BodyPart } from '../store/types.js';

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 12 },
  section: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 },
  label: { fontSize: 11, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 1 },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
  input: {
    flex: 1, padding: '4px 6px', background: '#2a2a4a', border: '1px solid #444',
    borderRadius: 4, color: '#ddd', fontSize: 13,
  },
  btn: {
    padding: '4px 10px', border: '1px solid #555', borderRadius: 4,
    background: '#3a3a6a', color: '#ddd', cursor: 'pointer', fontSize: 12,
  },
  btnDanger: {
    padding: '4px 10px', border: '1px solid #844', borderRadius: 4,
    background: '#4a2a2a', color: '#ddd', cursor: 'pointer', fontSize: 12,
  },
  partItem: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12,
  },
  partSelected: { background: '#3a3a6a' },
  numInput: {
    width: 50, padding: '2px 4px', background: '#2a2a4a', border: '1px solid #444',
    borderRadius: 4, color: '#ddd', fontSize: 12, textAlign: 'center' as const,
  },
};

function PartTree({ parts, parentId, depth, selected, onSelect }: {
  parts: BodyPart[];
  parentId: string | null;
  depth: number;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const children = parts.filter((p) => p.parent === parentId);
  return (
    <>
      {children.map((part) => (
        <React.Fragment key={part.id}>
          <div
            style={{
              ...styles.partItem,
              paddingLeft: 8 + depth * 16,
              ...(selected === part.id ? styles.partSelected : {}),
            }}
            onClick={() => onSelect(part.id)}
          >
            <span style={{ color: '#ddd' }}>{part.id}</span>
            <span style={{ color: '#666', fontSize: 10 }}>
              {part.parent ? '' : '(root)'}
            </span>
          </div>
          <PartTree
            parts={parts}
            parentId={part.id}
            depth={depth + 1}
            selected={selected}
            onSelect={onSelect}
          />
        </React.Fragment>
      ))}
    </>
  );
}

export function PartsPanel() {
  const characterName = useCharacterStore((s) => s.character?.characterName ?? 'Untitled');
  const setCharacterName = useCharacterStore((s) => s.setCharacterName);
  const parts = useCharacterStore((s) => s.character?.characterParts ?? []);
  const selectedPart = useCharacterStore((s) => s.selectedPart);
  const setSelectedPart = useCharacterStore((s) => s.setSelectedPart);
  const addPart = useCharacterStore((s) => s.addPart);
  const removePart = useCharacterStore((s) => s.removePart);
  const updatePartJoint = useCharacterStore((s) => s.updatePartJoint);
  const setPartParent = useCharacterStore((s) => s.setPartParent);

  const [newPartName, setNewPartName] = useState('');

  const currentPart = parts.find((p) => p.id === selectedPart) ?? null;

  return (
    <div style={styles.container}>
      {/* Character name */}
      <div style={styles.section}>
        <div style={styles.label}>Character</div>
        <input
          style={{ ...styles.input, flex: 'none', width: '100%' }}
          value={characterName}
          onChange={(e) => setCharacterName(e.target.value)}
          placeholder="character name"
        />
      </div>

      {/* Parts tree */}
      <div style={styles.section}>
        <div style={styles.label}>Parts</div>
        <div style={{ border: '1px solid #333', borderRadius: 4, padding: 4, maxHeight: 200, overflowY: 'auto' }}>
          {parts.length === 0 ? (
            <div style={{ color: '#666', fontSize: 11, padding: 4 }}>No parts defined</div>
          ) : (
            <PartTree
              parts={parts}
              parentId={null}
              depth={0}
              selected={selectedPart}
              onSelect={setSelectedPart}
            />
          )}
        </div>
        <div style={styles.row}>
          <input
            style={styles.input}
            value={newPartName}
            onChange={(e) => setNewPartName(e.target.value)}
            placeholder="part name"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newPartName.trim()) {
                addPart(newPartName.trim());
                setNewPartName('');
              }
            }}
          />
          <button
            style={styles.btn}
            onClick={() => {
              if (newPartName.trim()) {
                addPart(newPartName.trim());
                setNewPartName('');
              }
            }}
          >
            + Add
          </button>
        </div>
      </div>

      {/* Selected part editor */}
      {currentPart && (
        <div style={styles.section}>
          <div style={styles.label}>Part: {currentPart.id}</div>

          <div style={styles.row}>
            <span style={{ color: '#888', fontSize: 11, width: 40 }}>Parent:</span>
            <select
              style={{ ...styles.input, flex: 1 }}
              value={currentPart.parent ?? ''}
              onChange={(e) => setPartParent(currentPart.id, e.target.value || null)}
            >
              <option value="">(root)</option>
              {parts
                .filter((p) => p.id !== currentPart.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>{p.id}</option>
                ))}
            </select>
          </div>

          <div style={styles.row}>
            <span style={{ color: '#888', fontSize: 11, width: 40 }}>Joint:</span>
            {(['X', 'Y', 'Z'] as const).map((axis, i) => (
              <React.Fragment key={axis}>
                <span style={{ color: '#666', fontSize: 10 }}>{axis}</span>
                <input
                  type="number"
                  style={styles.numInput}
                  value={currentPart.joint[i]}
                  onChange={(e) => {
                    const j: [number, number, number] = [...currentPart.joint];
                    j[i] = Number(e.target.value);
                    updatePartJoint(currentPart.id, j);
                  }}
                />
              </React.Fragment>
            ))}
          </div>

          <div style={{ color: '#666', fontSize: 10 }}>
            {currentPart.voxelKeys.length} voxels assigned
          </div>

          <button
            style={styles.btnDanger}
            onClick={() => removePart(currentPart.id)}
          >
            Delete Part
          </button>
        </div>
      )}
    </div>
  );
}
