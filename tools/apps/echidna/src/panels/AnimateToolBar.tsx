import React, { useMemo } from 'react';
import { useComponentRegistry } from '@gseurat/ui-kit';
import { useCharacterStore } from '../store/useCharacterStore.js';
import type { ToolType, VoxelKey } from '../store/types.js';

const tools: { id: ToolType; label: string; key: string; icon: string }[] = [
  { id: 'orbit',        label: 'Orbit',       key: 'Q', icon: '\u27F2' }, // ⟲
  { id: 'assign_part',  label: 'Assign Part', key: 'A', icon: '\u2295' }, // ⊕
  { id: 'box_select',   label: 'Box Select',  key: 'S', icon: '\u25AF' }, // ▯
  { id: 'lasso_select', label: 'Lasso',       key: 'L', icon: '\u2312' }, // ⌒
];

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: '#1e1e3a',
    borderBottom: '1px solid #333',
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  section: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 11, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 2 },
  toolGrid: { display: 'flex', flexWrap: 'wrap' as const, gap: 4 },
  toolBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 32, height: 32,
    border: '1px solid #444', borderRadius: 4,
    background: '#2a2a4a', color: '#ddd',
    cursor: 'pointer', fontSize: 16, padding: 0,
  },
  toolBtnActive: { background: '#4a4a8a', borderColor: '#77f' },
  count: { fontSize: 11, color: '#aaa', padding: '2px 0' },
  selectionRow: { display: 'flex', gap: 4 },
  actionBtn: {
    flex: 1,
    padding: '4px 8px',
    borderWidth: 1, borderStyle: 'solid' as const, borderColor: '#555',
    borderRadius: 4, background: '#3a3a6a', color: '#ddd',
    cursor: 'pointer', fontSize: 11, textAlign: 'center' as const,
  },
  actionBtnPrimary: { background: '#4a4a8a', borderColor: '#77f', color: '#fff' },
  actionBtnDisabled: { opacity: 0.4, cursor: 'not-allowed' },
};

export function AnimateToolBar() {
  useComponentRegistry('AnimateToolBar');
  const activeTool = useCharacterStore((s) => s.activeTool);
  const setTool = useCharacterStore((s) => s.setTool);
  const selectedPart = useCharacterStore((s) => s.selectedPart);
  const boxSelection = useCharacterStore((s) => s.boxSelection);
  const lassoSelection = useCharacterStore((s) => s.lassoSelection);
  const assignVoxelsToPart = useCharacterStore((s) => s.assignVoxelsToPart);
  const unassignVoxelsFromPart = useCharacterStore((s) => s.unassignVoxelsFromPart);
  const setBoxSelection = useCharacterStore((s) => s.setBoxSelection);
  const setLassoSelection = useCharacterStore((s) => s.setLassoSelection);
  const pushUndo = useCharacterStore((s) => s.pushUndo);

  const selection = useMemo<VoxelKey[]>(() => {
    const s = new Set<VoxelKey>();
    if (boxSelection) for (const k of boxSelection) s.add(k);
    if (lassoSelection) for (const k of lassoSelection) s.add(k);
    return Array.from(s);
  }, [boxSelection, lassoSelection]);

  const selectionCount = selection.length;
  const canCommit = selectionCount > 0 && selectedPart !== null;
  const canClear = selectionCount > 0;

  const clearSelection = () => {
    setBoxSelection(null);
    setLassoSelection(null);
  };

  const handleAssign = () => {
    if (!canCommit || !selectedPart) return;
    pushUndo();
    assignVoxelsToPart(selection, selectedPart);
    clearSelection();
  };

  const handleUnassign = () => {
    if (!canCommit || !selectedPart) return;
    pushUndo();
    unassignVoxelsFromPart(selection, selectedPart);
    clearSelection();
  };

  return (
    <div style={styles.container}>
      <div style={styles.section}>
        <span style={styles.label}>Tools</span>
        <div style={styles.toolGrid}>
          {tools.map((t) => (
            <button
              key={t.id}
              title={`${t.label} (${t.key})`}
              style={{ ...styles.toolBtn, ...(activeTool === t.id ? styles.toolBtnActive : {}) }}
              onClick={() => setTool(t.id)}
            >
              {t.icon}
            </button>
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Selection</span>
        <div style={styles.count}>
          {selectionCount === 0 ? 'No selection' : `${selectionCount} voxels`}
        </div>
        <div style={styles.selectionRow}>
          <button
            title="Assign selection to selected bone"
            style={{
              ...styles.actionBtn,
              ...styles.actionBtnPrimary,
              ...(!canCommit ? styles.actionBtnDisabled : {}),
            }}
            onClick={handleAssign}
            disabled={!canCommit}
          >
            Assign
          </button>
          <button
            title="Unassign selection from selected bone"
            style={{
              ...styles.actionBtn,
              ...(!canCommit ? styles.actionBtnDisabled : {}),
            }}
            onClick={handleUnassign}
            disabled={!canCommit}
          >
            Unassign
          </button>
          <button
            title="Clear selection"
            style={{
              ...styles.actionBtn,
              ...(!canClear ? styles.actionBtnDisabled : {}),
            }}
            onClick={clearSelection}
            disabled={!canClear}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
