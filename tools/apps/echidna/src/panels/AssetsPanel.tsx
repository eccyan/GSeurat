// tools/apps/echidna/src/panels/AssetsPanel.tsx
import React, { useState, useCallback, useRef } from 'react';
import { useCharacterStore, type SwitchDecision } from '../store/useCharacterStore.js';
import { SwitchCharacterDialog } from './SwitchCharacterDialog.js';
import { RenameCharacterDialog } from './RenameCharacterDialog.js';
import { DuplicateCharacterDialog } from './DuplicateCharacterDialog.js';
import { DeleteCharacterDialog } from './DeleteCharacterDialog.js';

const COLLAPSE_KEY = 'echidna:characters-panel-collapsed';

const KIND_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  character: { label: 'CHR', bg: '#1a3a2a', color: '#6c8' },
  map:       { label: 'MAP', bg: '#1a2a3a', color: '#68c' },
  object:    { label: 'OBJ', bg: '#3a2a1a', color: '#c86' },
};

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    borderBottom: '1px solid #333',
    background: '#181830',
    flexShrink: 0,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    padding: '6px 10px',
    fontSize: 11,
    fontWeight: 600,
    color: '#888',
    textTransform: 'uppercase',
    cursor: 'pointer',
    userSelect: 'none',
  },
  headerLabel: { flex: 1 },
  collapseBtn: {
    padding: '0 6px',
    background: 'transparent',
    border: 'none',
    color: '#888',
    cursor: 'pointer',
    fontSize: 12,
  },
  list: {
    maxHeight: 200,
    overflowY: 'auto',
    padding: '2px 0',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    padding: '5px 12px',
    fontSize: 12,
    color: '#ccc',
    cursor: 'pointer',
  },
  rowCurrent: {
    background: '#2a2a4a',
    color: '#fff',
  },
  dot: { marginRight: 8, fontSize: 10 },
  dotCurrent: { color: '#7f7' },
  dotOther: { color: '#444' },
  name: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  dirtyMarker: { color: '#fa0', marginLeft: 6 },
  menuBtn: {
    padding: '0 6px',
    background: 'transparent',
    border: 'none',
    color: '#888',
    cursor: 'pointer',
    fontSize: 14,
  },
  footer: {
    padding: '6px 12px',
    borderTop: '1px solid #333',
  },
  newBtn: {
    width: '100%',
    padding: '6px',
    background: 'transparent',
    border: '1px dashed #444',
    borderRadius: 4,
    color: '#7a9',
    fontSize: 12,
    cursor: 'pointer',
  },
  empty: {
    padding: '12px 16px',
    fontSize: 11,
    color: '#666',
    fontStyle: 'italic',
  },
  filterRow: {
    display: 'flex',
    padding: '4px 10px',
    borderBottom: '1px solid #2a2a3a',
  },
  filterSelect: {
    flex: 1,
    background: '#2a2a4a',
    color: '#aaa',
    border: '1px solid #444',
    borderRadius: 3,
    padding: '2px 6px',
    fontSize: 10,
  },
  kindBadge: {
    fontSize: 9,
    fontWeight: 700,
    padding: '1px 4px',
    borderRadius: 2,
    marginRight: 6,
    letterSpacing: 0.5,
  },
  contextMenu: {
    position: 'fixed',
    background: '#1e1e3a',
    border: '1px solid #444',
    borderRadius: 4,
    padding: '4px 0',
    minWidth: 160,
    zIndex: 500,
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
  },
  contextItem: {
    display: 'block',
    width: '100%',
    padding: '6px 14px',
    background: 'transparent',
    border: 'none',
    color: '#ccc',
    fontSize: 12,
    textAlign: 'left',
    cursor: 'pointer',
  },
};

type ContextMenuState = { x: number; y: number; id: string; name: string } | null;
type ActiveDialog =
  | { kind: 'switch'; targetId: string }
  | { kind: 'rename'; id: string; name: string }
  | { kind: 'duplicate'; id: string; name: string }
  | { kind: 'delete'; id: string; name: string }
  | null;

interface Props {
  onNewAsset: () => void;
}

export function AssetsPanel({ onNewAsset }: Props) {
  const knownAssets = useCharacterStore((s) => s.knownAssets);
  const currentId = useCharacterStore((s) => s.asset?.id ?? null);
  const dirty = useCharacterStore((s) => s.dirty);
  const currentAssetName = useCharacterStore((s) => s.asset?.characterName ?? '');
  const undoDepth = useCharacterStore((s) => s.undoStack.length);
  const requestOpenAsset = useCharacterStore((s) => s.requestOpenAsset);
  const renameAsset = useCharacterStore((s) => s.renameAsset);
  const duplicateAsset = useCharacterStore((s) => s.duplicateAsset);
  const deleteAsset = useCharacterStore((s) => s.deleteAsset);

  const [collapsed, setCollapsed] = useState(() =>
    localStorage.getItem(COLLAPSE_KEY) === '1',
  );
  const [kindFilter, setKindFilter] = useState<string>('all');
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null);

  // Ref-based resolver for the switch-dialog promise — survives re-renders
  // without being stashed on the function itself.
  const pendingResolverRef = useRef<((d: SwitchDecision) => void) | null>(null);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      return next;
    });
  }, []);

  const handleRowClick = (id: string) => {
    if (id === currentId) return;
    void requestOpenAsset(id, () =>
      new Promise<SwitchDecision>((resolve) => {
        pendingResolverRef.current = resolve;
        setActiveDialog({ kind: 'switch', targetId: id });
      }),
    );
  };

  const handleSwitchDecision = (decision: SwitchDecision) => {
    pendingResolverRef.current?.(decision);
    pendingResolverRef.current = null;
    setActiveDialog(null);
  };

  const handleContextMenu = (e: React.MouseEvent, id: string, name: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, id, name });
  };

  const closeContextMenu = () => setContextMenu(null);

  const filteredAssets = kindFilter === 'all'
    ? knownAssets
    : knownAssets.filter((c) => c.kind === kindFilter);

  return (
    <div style={styles.root}>
      <div style={styles.header} onClick={toggleCollapsed}>
        <span style={styles.headerLabel}>Assets</span>
        <button style={styles.collapseBtn}>{collapsed ? '+' : '−'}</button>
      </div>
      {!collapsed && (
        <>
          <div style={styles.filterRow}>
            <select style={styles.filterSelect} value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="character">Characters</option>
              <option value="map">Maps</option>
              <option value="object">Objects</option>
            </select>
          </div>
          {filteredAssets.length === 0 ? (
            <div style={styles.empty}>No assets yet.</div>
          ) : (
            <div style={styles.list}>
              {filteredAssets.map((c) => {
                const isCurrent = c.id === currentId;
                return (
                  <div
                    key={c.id}
                    style={{
                      ...styles.row,
                      ...(isCurrent ? styles.rowCurrent : {}),
                    }}
                    onClick={() => handleRowClick(c.id)}
                    onContextMenu={(e) => handleContextMenu(e, c.id, c.name)}
                  >
                    <span style={{ ...styles.dot, ...(isCurrent ? styles.dotCurrent : styles.dotOther) }}>
                      {isCurrent ? '●' : '○'}
                    </span>
                    <span style={{
                      ...styles.kindBadge,
                      background: KIND_BADGE[c.kind]?.bg ?? '#333',
                      color: KIND_BADGE[c.kind]?.color ?? '#888',
                    }}>
                      {KIND_BADGE[c.kind]?.label ?? c.kind.toUpperCase().slice(0, 3)}
                    </span>
                    <span style={styles.name}>{c.name}</span>
                    {isCurrent && dirty && <span style={styles.dirtyMarker}>●</span>}
                    <button
                      style={styles.menuBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleContextMenu(e, c.id, c.name);
                      }}
                    >
                      ⋯
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <div style={styles.footer}>
            <button style={styles.newBtn} onClick={onNewAsset}>
              + New Asset
            </button>
          </div>
        </>
      )}

      {/* Context menu */}
      {contextMenu && (
        <>
          <div
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 499 }}
            onClick={closeContextMenu}
          />
          <div
            style={{
              ...styles.contextMenu,
              left: contextMenu.x,
              top: contextMenu.y,
            }}
          >
            <button
              style={styles.contextItem}
              onClick={() => {
                setActiveDialog({ kind: 'rename', id: contextMenu.id, name: contextMenu.name });
                closeContextMenu();
              }}
            >
              Rename…
            </button>
            <button
              style={styles.contextItem}
              onClick={() => {
                setActiveDialog({ kind: 'duplicate', id: contextMenu.id, name: contextMenu.name });
                closeContextMenu();
              }}
            >
              Duplicate…
            </button>
            <button
              style={styles.contextItem}
              onClick={() => {
                setActiveDialog({ kind: 'delete', id: contextMenu.id, name: contextMenu.name });
                closeContextMenu();
              }}
            >
              Delete…
            </button>
          </div>
        </>
      )}

      {/* Dialogs */}
      {activeDialog?.kind === 'switch' && (
        <SwitchCharacterDialog
          currentName={currentAssetName}
          targetName={knownAssets.find((c) => c.id === activeDialog.targetId)?.name ?? ''}
          undoDepth={undoDepth}
          onDecide={handleSwitchDecision}
        />
      )}
      {activeDialog?.kind === 'rename' && (
        <RenameCharacterDialog
          currentName={activeDialog.name}
          onSubmit={(newName) => {
            void renameAsset(activeDialog.id, newName);
            setActiveDialog(null);
          }}
          onCancel={() => setActiveDialog(null)}
        />
      )}
      {activeDialog?.kind === 'duplicate' && (
        <DuplicateCharacterDialog
          sourceName={activeDialog.name}
          onSubmit={(newName) => {
            void duplicateAsset(activeDialog.id, newName);
            setActiveDialog(null);
          }}
          onCancel={() => setActiveDialog(null)}
        />
      )}
      {activeDialog?.kind === 'delete' && (
        <DeleteCharacterDialog
          characterName={activeDialog.name}
          characterId={activeDialog.id}
          onConfirm={() => {
            void deleteAsset(activeDialog.id);
            setActiveDialog(null);
          }}
          onCancel={() => setActiveDialog(null)}
        />
      )}
    </div>
  );
}
