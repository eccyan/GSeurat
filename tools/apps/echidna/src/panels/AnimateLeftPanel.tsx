import React, { useState } from 'react';
import { useComponentRegistry } from '@gseurat/ui-kit';
import { useCharacterStore } from '../store/useCharacterStore.js';
import type { BodyPart } from '../store/types.js';

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    background: '#1e1e3a',
    display: 'flex',
    flexDirection: 'column',
    overflowY: 'auto',
  },
  section: { padding: 12, borderBottom: '1px solid #333' },
  label: { fontSize: 11, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 8, display: 'block' },
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
    padding: '2px 6px', border: '1px solid #844', borderRadius: 4,
    background: '#4a2a2a', color: '#ddd', cursor: 'pointer', fontSize: 10,
  },
  treeItem: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12,
  },
  treeItemSelected: { background: '#3a3a6a' },
  animItem: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '4px 8px', borderRadius: 4, fontSize: 12,
  },
  animItemSelected: { background: '#3a3a6a' },
};

function isDescendant(parts: BodyPart[], ancestorId: string, childId: string): boolean {
  let current = parts.find((p) => p.id === childId);
  while (current) {
    if (current.parent === ancestorId) return true;
    current = parts.find((p) => p.id === current!.parent);
  }
  return false;
}

type DropZone = { id: string; zone: 'above' | 'child' } | null;

function BoneTree({ parts, parentId, depth, selected, onSelect, onReparent, dropTarget, setDropTarget }: {
  parts: BodyPart[];
  parentId: string | null;
  depth: number;
  selected: string | null;
  onSelect: (id: string) => void;
  onReparent: (childId: string, newParentId: string | null) => void;
  dropTarget: DropZone;
  setDropTarget: (t: DropZone) => void;
}) {
  const children = parts.filter((p) => p.parent === parentId);
  return (
    <>
      {children.map((part) => {
        const isDropAbove = dropTarget?.id === part.id && dropTarget.zone === 'above';
        const isDropChild = dropTarget?.id === part.id && dropTarget.zone === 'child';

        return (
          <React.Fragment key={part.id}>
            <div
              draggable
              style={{
                ...styles.treeItem,
                paddingLeft: 8 + depth * 14,
                ...(selected === part.id ? styles.treeItemSelected : {}),
                ...(isDropAbove ? { borderTop: '2px solid #77f' } : {}),
                ...(isDropChild ? { background: '#2a2a5a', borderRadius: 4 } : {}),
              }}
              onClick={() => onSelect(part.id)}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', part.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                // Top 1/3 = sibling (above), bottom 2/3 = child
                const rect = e.currentTarget.getBoundingClientRect();
                const y = e.clientY - rect.top;
                const zone = y < rect.height / 3 ? 'above' : 'child';
                setDropTarget({ id: part.id, zone });
              }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const draggedId = e.dataTransfer.getData('text/plain');
                const zone = dropTarget?.zone ?? 'child';
                setDropTarget(null);
                if (!draggedId || draggedId === part.id) return;
                if (isDescendant(parts, draggedId, part.id)) return;

                if (zone === 'above') {
                  // Make sibling: same parent as the drop target
                  onReparent(draggedId, part.parent);
                } else {
                  // Make child of the drop target
                  onReparent(draggedId, part.id);
                }
              }}
            >
              <span style={{ color: '#ddd' }}>{part.id}</span>
              {part.parent === null && <span style={{ color: '#666', fontSize: 10, marginLeft: 4 }}>(root)</span>}
            </div>
            <BoneTree
              parts={parts}
              parentId={part.id}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
              onReparent={onReparent}
              dropTarget={dropTarget}
              setDropTarget={setDropTarget}
            />
          </React.Fragment>
        );
      })}
    </>
  );
}

export function AnimateLeftPanel() {
  useComponentRegistry('AnimateLeftPanel');
  const parts = useCharacterStore((s) => s.asset?.characterParts ?? []);
  const selectedPart = useCharacterStore((s) => s.selectedPart);
  const setSelectedPart = useCharacterStore((s) => s.setSelectedPart);
  const addPart = useCharacterStore((s) => s.addPart);
  const removePart = useCharacterStore((s) => s.removePart);
  const setPartParent = useCharacterStore((s) => s.setPartParent);

  const [dropTarget, setDropTarget] = useState<DropZone>(null);

  const handleReparent = (childId: string, newParentId: string | null) => {
    setPartParent(childId, newParentId);
  };

  const animations = useCharacterStore((s) => s.asset?.animations ?? {});
  const selectedAnimation = useCharacterStore((s) => s.selectedAnimation);
  const selectAnimation = useCharacterStore((s) => s.selectAnimation);
  const addAnimation = useCharacterStore((s) => s.addAnimation);
  const removeAnimation = useCharacterStore((s) => s.removeAnimation);

  const [newPartName, setNewPartName] = useState('');
  const [newAnimName, setNewAnimName] = useState('');

  return (
    <div style={styles.container}>
      {/* Bones hierarchy */}
      <div style={styles.section}>
        <span style={styles.label}>Bones</span>
        <div
          style={{ border: '1px solid #333', borderRadius: 4, padding: 4, maxHeight: 200, overflowY: 'auto', marginBottom: 8 }}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
          onDrop={(e) => {
            e.preventDefault();
            setDropTarget(null);
            const draggedId = e.dataTransfer.getData('text/plain');
            if (draggedId) handleReparent(draggedId, null);
          }}
        >
          {parts.length === 0 ? (
            <div style={{ color: '#666', fontSize: 11, padding: 4 }}>No bones defined</div>
          ) : (
            <BoneTree
              parts={parts}
              parentId={null}
              depth={0}
              selected={selectedPart}
              onSelect={setSelectedPart}
              onReparent={handleReparent}
              dropTarget={dropTarget}
              setDropTarget={setDropTarget}
            />
          )}
        </div>
        <div style={styles.row}>
          <input
            style={styles.input}
            value={newPartName}
            onChange={(e) => setNewPartName(e.target.value)}
            placeholder="bone name"
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
            +
          </button>
        </div>
        {selectedPart && (
          <button
            style={{ ...styles.btnDanger, marginTop: 4 }}
            onClick={() => removePart(selectedPart)}
          >
            Delete Bone
          </button>
        )}
      </div>

      {/* Animations list */}
      <div style={styles.section}>
        <span style={styles.label}>Animations</span>
        <div style={{ border: '1px solid #333', borderRadius: 4, padding: 4, maxHeight: 200, overflowY: 'auto', marginBottom: 8 }}>
          {Object.keys(animations).length === 0 ? (
            <div style={{ color: '#666', fontSize: 11, padding: 4 }}>No animations</div>
          ) : (
            Object.keys(animations).map((name) => (
              <div
                key={name}
                style={{
                  ...styles.animItem,
                  ...(selectedAnimation === name ? styles.animItemSelected : {}),
                }}
              >
                <span
                  style={{ color: '#ddd', cursor: 'pointer', flex: 1, display: 'flex', alignItems: 'center' }}
                  onClick={() => selectAnimation(name)}
                >
                  {name}
                  {animations[name].rootMotion && (
                    <span style={{ fontSize: 9, color: '#f0a030', marginLeft: 4 }}>RM</span>
                  )}
                </span>
                <button
                  style={styles.btnDanger}
                  onClick={() => removeAnimation(name)}
                >
                  X
                </button>
              </div>
            ))
          )}
        </div>
        <div style={styles.row}>
          <input
            style={styles.input}
            value={newAnimName}
            onChange={(e) => setNewAnimName(e.target.value)}
            placeholder="animation name"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newAnimName.trim()) {
                addAnimation(newAnimName.trim());
                setNewAnimName('');
              }
            }}
          />
          <button
            style={styles.btn}
            onClick={() => {
              if (newAnimName.trim()) {
                addAnimation(newAnimName.trim());
                setNewAnimName('');
              }
            }}
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
