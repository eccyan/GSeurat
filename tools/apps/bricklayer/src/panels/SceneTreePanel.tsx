import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useSceneStore } from '../store/useSceneStore.js';

const styles: Record<string, React.CSSProperties> = {
  section: {
    marginBottom: 4,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 0',
    cursor: 'pointer',
    fontSize: 13,
    color: '#ccc',
    userSelect: 'none',
  },
  arrow: {
    fontSize: 10,
    width: 12,
    textAlign: 'center' as const,
    color: '#888',
  },
  count: {
    fontSize: 11,
    color: '#666',
    marginLeft: 4,
  },
  item: {
    padding: '3px 8px 3px 24px',
    fontSize: 12,
    color: '#aaa',
    cursor: 'pointer',
    borderRadius: 3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  itemSelected: {
    background: '#3a3a6a',
    color: '#fff',
  },
  addRow: {
    display: 'flex',
    gap: 4,
    marginBottom: 12,
  },
  btn: {
    padding: '4px 10px',
    border: '1px solid #555',
    borderRadius: 4,
    background: '#3a3a6a',
    color: '#ddd',
    cursor: 'pointer',
    fontSize: 12,
    position: 'relative' as const,
  },
  dropdown: {
    position: 'absolute' as const,
    top: '100%',
    left: 0,
    background: '#1e1e3a',
    border: '1px solid #444',
    borderRadius: 4,
    minWidth: 120,
    padding: '4px 0',
    zIndex: 100,
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
  },
  dropdownItem: {
    display: 'block',
    width: '100%',
    padding: '6px 12px',
    background: 'transparent',
    border: 'none',
    color: '#ccc',
    cursor: 'pointer',
    fontSize: 12,
    textAlign: 'left' as const,
  },
};

function CollapsibleSection({
  title,
  count,
  defaultOpen,
  children,
}: {
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? true);

  return (
    <div style={styles.section}>
      <div style={styles.header} onClick={() => setOpen(!open)}>
        <span style={styles.arrow}>{open ? '\u25BE' : '\u25B8'}</span>
        <span>{title}</span>
        <span style={styles.count}>({count})</span>
      </div>
      {open && children}
    </div>
  );
}

function TreeItem({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <div
      style={{ ...styles.item, ...(selected ? styles.itemSelected : {}) }}
      onClick={onClick}
    >
      {label}
    </div>
  );
}

export function SceneTreePanel() {
  const placedObjects = useSceneStore((s) => s.placedObjects);
  const staticLights = useSceneStore((s) => s.staticLights);
  const npcs = useSceneStore((s) => s.npcs);
  const portals = useSceneStore((s) => s.portals);
  const player = useSceneStore((s) => s.player);
  const selectedEntity = useSceneStore((s) => s.selectedEntity);
  const setSelectedEntity = useSceneStore((s) => s.setSelectedEntity);
  const gsParticleEmitters = useSceneStore((s) => s.gsParticleEmitters);
  const addPlacedObject = useSceneStore((s) => s.addPlacedObject);
  const addLight = useSceneStore((s) => s.addLight);
  const addNpc = useSceneStore((s) => s.addNpc);
  const addPortal = useSceneStore((s) => s.addPortal);
  const addGsEmitter = useSceneStore((s) => s.addGsEmitter);

  const [showAdd, setShowAdd] = useState(false);
  const addRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showAdd) return;
    const handler = (e: MouseEvent) => {
      if (addRef.current && !addRef.current.contains(e.target as Node)) {
        setShowAdd(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAdd]);

  const handleAddObject = () => {
    const plyFile = window.prompt('PLY file path:', '');
    if (plyFile) addPlacedObject(plyFile);
    setShowAdd(false);
  };

  return (
    <div>
      {/* Add button */}
      <div style={styles.addRow}>
        <div ref={addRef} style={{ position: 'relative' }}>
          <button style={styles.btn} onClick={() => setShowAdd(!showAdd)}>
            + Add
          </button>
          {showAdd && (
            <div style={styles.dropdown}>
              <button
                style={styles.dropdownItem}
                onClick={handleAddObject}
                onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#3a3a6a'; }}
                onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
              >
                Object
              </button>
              <button
                style={styles.dropdownItem}
                onClick={() => { addLight(); setShowAdd(false); }}
                onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#3a3a6a'; }}
                onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
              >
                Light
              </button>
              <button
                style={styles.dropdownItem}
                onClick={() => { addNpc(); setShowAdd(false); }}
                onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#3a3a6a'; }}
                onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
              >
                NPC
              </button>
              <button
                style={styles.dropdownItem}
                onClick={() => { addPortal(); setShowAdd(false); }}
                onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#3a3a6a'; }}
                onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
              >
                Portal
              </button>
              <button
                style={styles.dropdownItem}
                onClick={() => { addGsEmitter(); setShowAdd(false); }}
                onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#3a3a6a'; }}
                onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
              >
                Particle Emitter
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Placed Objects */}
      <CollapsibleSection title="Placed Objects" count={placedObjects.length}>
        {placedObjects.map((obj) => (
          <TreeItem
            key={obj.id}
            label={obj.ply_file || obj.id.slice(0, 16)}
            selected={selectedEntity?.type === 'object' && selectedEntity.id === obj.id}
            onClick={() => setSelectedEntity({ type: 'object', id: obj.id })}
          />
        ))}
      </CollapsibleSection>

      {/* Lights */}
      <CollapsibleSection title="Lights" count={staticLights.length}>
        {staticLights.map((l) => (
          <TreeItem
            key={l.id}
            label={l.id.slice(0, 16)}
            selected={selectedEntity?.type === 'light' && selectedEntity.id === l.id}
            onClick={() => setSelectedEntity({ type: 'light', id: l.id })}
          />
        ))}
      </CollapsibleSection>

      {/* NPCs */}
      <CollapsibleSection title="NPCs" count={npcs.length}>
        {npcs.map((n) => (
          <TreeItem
            key={n.id}
            label={n.name || n.id.slice(0, 16)}
            selected={selectedEntity?.type === 'npc' && selectedEntity.id === n.id}
            onClick={() => setSelectedEntity({ type: 'npc', id: n.id })}
          />
        ))}
      </CollapsibleSection>

      {/* Portals */}
      <CollapsibleSection title="Portals" count={portals.length}>
        {portals.map((p) => (
          <TreeItem
            key={p.id}
            label={p.target_scene || p.id.slice(0, 16)}
            selected={selectedEntity?.type === 'portal' && selectedEntity.id === p.id}
            onClick={() => setSelectedEntity({ type: 'portal', id: p.id })}
          />
        ))}
      </CollapsibleSection>

      {/* Particle Emitters */}
      <CollapsibleSection title="Emitters" count={gsParticleEmitters.length}>
        {gsParticleEmitters.map((e) => (
          <TreeItem
            key={e.id}
            label={e.preset || 'Custom Emitter'}
            selected={selectedEntity?.type === 'gs_emitter' && selectedEntity.id === e.id}
            onClick={() => setSelectedEntity({ type: 'gs_emitter', id: e.id })}
          />
        ))}
      </CollapsibleSection>

      {/* Player */}
      <CollapsibleSection title="Player" count={1} defaultOpen>
        <TreeItem
          label={`Player (${player.facing})`}
          selected={selectedEntity?.type === 'player'}
          onClick={() => setSelectedEntity({ type: 'player', id: 'player' })}
        />
      </CollapsibleSection>
    </div>
  );
}
