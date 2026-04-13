import React from 'react';
import { useComponentRegistry } from '@gseurat/ui-kit';
import { chunkGridKey } from '@gseurat/project-root';
import { useWorldStore } from '../store/useWorldStore.js';

const styles: Record<string, React.CSSProperties> = {
  root: {
    color: '#ccc',
    fontSize: 12,
    userSelect: 'none',
  },
  section: {
    marginBottom: 12,
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '4px 6px',
    background: '#222',
    borderRadius: 3,
    marginBottom: 4,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.5,
    color: '#aaa',
  },
  sectionTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  addBtn: {
    border: 'none',
    background: 'transparent',
    color: '#77f',
    cursor: 'pointer',
    fontSize: 14,
    lineHeight: 1,
    padding: '0 2px',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '3px 8px',
    borderRadius: 3,
    cursor: 'pointer',
    marginBottom: 2,
  },
  itemSelected: {
    background: '#335',
  },
  itemDefault: {
    background: 'transparent',
  },
  itemLabel: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  removeBtn: {
    border: 'none',
    background: 'transparent',
    color: '#c55',
    cursor: 'pointer',
    fontSize: 13,
    lineHeight: 1,
    padding: '0 2px',
    flexShrink: 0,
    opacity: 0.7,
  },
};

export function WorldTree() {
  useComponentRegistry('WorldTree');

  const manifest = useWorldStore((s) => s.manifest);
  const selectedEntity = useWorldStore((s) => s.selectedEntity);
  const setSelectedEntity = useWorldStore((s) => s.setSelectedEntity);
  const addChunk = useWorldStore((s) => s.addChunk);
  const removeChunk = useWorldStore((s) => s.removeChunk);
  const addStreamingVolume = useWorldStore((s) => s.addStreamingVolume);
  const removeStreamingVolume = useWorldStore((s) => s.removeStreamingVolume);
  const addPortal = useWorldStore((s) => s.addPortal);
  const removePortal = useWorldStore((s) => s.removePortal);

  const handleAddChunk = () => {
    // Find next available slot iterating x then z at y=0
    const usedKeys = new Set(manifest.chunks.map((c) => chunkGridKey(c.grid)));
    let grid: [number, number, number] = [0, 0, 0];
    outer: for (let z = 0; z < 64; z++) {
      for (let x = 0; x < 64; x++) {
        const key = chunkGridKey([x, 0, z]);
        if (!usedKeys.has(key)) {
          grid = [x, 0, z];
          break outer;
        }
      }
    }
    addChunk(grid);
    setSelectedEntity({ type: 'chunk', id: chunkGridKey(grid) });
  };

  return (
    <div style={styles.root}>
      {/* Chunks */}
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <span style={styles.sectionTitle}>
            <span>▦</span>
            <span>Chunks</span>
          </span>
          <button style={styles.addBtn} onClick={handleAddChunk} title="Add chunk">+</button>
        </div>
        {manifest.chunks.map((chunk) => {
          const key = chunkGridKey(chunk.grid);
          const isSelected = selectedEntity?.type === 'chunk' && selectedEntity.id === key;
          return (
            <div
              key={key}
              style={{
                ...styles.item,
                ...(isSelected ? styles.itemSelected : styles.itemDefault),
              }}
              onClick={() => setSelectedEntity({ type: 'chunk', id: key })}
            >
              <span style={styles.itemLabel}>[{chunk.grid[0]}, {chunk.grid[1]}, {chunk.grid[2]}]</span>
              <button
                style={styles.removeBtn}
                onClick={(e) => { e.stopPropagation(); removeChunk(key); }}
                title="Remove chunk"
              >
                ×
              </button>
            </div>
          );
        })}
        {manifest.chunks.length === 0 && (
          <div style={{ color: '#555', padding: '4px 8px', fontSize: 11 }}>No chunks</div>
        )}
      </div>

      {/* Streaming Volumes */}
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <span style={styles.sectionTitle}>
            <span>◈</span>
            <span>Streaming Volumes</span>
          </span>
          <button style={styles.addBtn} onClick={addStreamingVolume} title="Add streaming volume">+</button>
        </div>
        {manifest.streaming_volumes.map((sv) => {
          const isSelected = selectedEntity?.type === 'streaming_volume' && selectedEntity.id === sv.id;
          return (
            <div
              key={sv.id}
              style={{
                ...styles.item,
                ...(isSelected ? styles.itemSelected : styles.itemDefault),
              }}
              onClick={() => setSelectedEntity({ type: 'streaming_volume', id: sv.id })}
            >
              <span style={styles.itemLabel}>{sv.id}</span>
              <button
                style={styles.removeBtn}
                onClick={(e) => { e.stopPropagation(); removeStreamingVolume(sv.id); }}
                title="Remove streaming volume"
              >
                ×
              </button>
            </div>
          );
        })}
        {manifest.streaming_volumes.length === 0 && (
          <div style={{ color: '#555', padding: '4px 8px', fontSize: 11 }}>No streaming volumes</div>
        )}
      </div>

      {/* Global Portals */}
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <span style={styles.sectionTitle}>
            <span>◎</span>
            <span>Global Portals</span>
          </span>
          <button style={styles.addBtn} onClick={addPortal} title="Add portal">+</button>
        </div>
        {manifest.portals.map((portal) => {
          const isSelected = selectedEntity?.type === 'world_portal' && selectedEntity.id === portal.id;
          return (
            <div
              key={portal.id}
              style={{
                ...styles.item,
                ...(isSelected ? styles.itemSelected : styles.itemDefault),
              }}
              onClick={() => setSelectedEntity({ type: 'world_portal', id: portal.id })}
            >
              <span style={styles.itemLabel}>{portal.id}</span>
              <button
                style={styles.removeBtn}
                onClick={(e) => { e.stopPropagation(); removePortal(portal.id); }}
                title="Remove portal"
              >
                ×
              </button>
            </div>
          );
        })}
        {manifest.portals.length === 0 && (
          <div style={{ color: '#555', padding: '4px 8px', fontSize: 11 }}>No global portals</div>
        )}
      </div>
    </div>
  );
}
