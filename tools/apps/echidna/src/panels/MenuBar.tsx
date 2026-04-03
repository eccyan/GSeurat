import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useCharacterStore } from '../store/useCharacterStore.js';
import { exportPly } from '../lib/plyExport.js';
import { buildManifest } from '../lib/manifestExport.js';
import { parseVox } from '../lib/voxImport.js';
import { sendBridgeCommand } from '@gseurat/engine-client';
import type { EchidnaFile } from '../store/types.js';
import { NewProjectDialog } from './NewProjectDialog.js';
import { ResizeGridDialog } from './ResizeGridDialog.js';
import { ExportDialog } from './ExportDialog.js';

const BRIDGE_REST_URL = 'http://localhost:9101';

const styles: Record<string, React.CSSProperties> = {
  bar: {
    height: 36,
    background: '#16162a',
    borderBottom: '1px solid #333',
    display: 'flex',
    alignItems: 'center',
    padding: '0 8px',
    gap: 0,
    position: 'relative',
    zIndex: 100,
  },
  menuItem: {
    padding: '6px 12px',
    background: 'transparent',
    border: 'none',
    borderRadius: 4,
    color: '#ccc',
    cursor: 'pointer',
    fontSize: 13,
    position: 'relative' as const,
  },
  menuItemHover: {
    background: '#2a2a4a',
  },
  dropdown: {
    position: 'absolute' as const,
    top: '100%',
    left: 0,
    background: '#1e1e3a',
    border: '1px solid #444',
    borderRadius: 4,
    minWidth: 200,
    padding: '4px 0',
    zIndex: 200,
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
  },
  dropdownItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 16px',
    background: 'transparent',
    border: 'none',
    width: '100%',
    color: '#ddd',
    cursor: 'pointer',
    fontSize: 13,
    textAlign: 'left' as const,
  },
  dropdownItemHover: {
    background: '#3a3a6a',
  },
  shortcut: {
    color: '#666',
    fontSize: 11,
    marginLeft: 24,
  },
  separator: {
    height: 1,
    background: '#333',
    margin: '4px 8px',
  },
  spacer: { flex: 1 },
  title: {
    fontSize: 12,
    color: '#666',
    marginLeft: 12,
  },
  toast: {
    position: 'fixed' as const,
    top: 48,
    right: 16,
    padding: '8px 16px',
    borderRadius: 4,
    fontSize: 13,
    color: '#fff',
    zIndex: 1000,
    pointerEvents: 'none' as const,
    transition: 'opacity 0.3s',
  },
  toastSuccess: {
    background: '#2a6e3f',
  },
  toastError: {
    background: '#8b2a2a',
  },
  toastLoading: {
    background: '#3a3a6a',
  },
};

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

interface DropdownMenuProps {
  label: string;
  items: Array<{
    label: string;
    shortcut?: string;
    action: () => void;
    separator?: false;
  } | { separator: true }>;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}

function DropdownMenu({ label, items, open, onOpen, onClose }: DropdownMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        style={{
          ...styles.menuItem,
          ...(open ? styles.menuItemHover : {}),
        }}
        onClick={() => open ? onClose() : onOpen()}
      >
        {label}
      </button>
      {open && (
        <div style={styles.dropdown}>
          {items.map((item, i) => {
            if ('separator' in item && item.separator) {
              return <div key={i} style={styles.separator} />;
            }
            const it = item as { label: string; shortcut?: string; action: () => void };
            return (
              <button
                key={i}
                style={{
                  ...styles.dropdownItem,
                  ...(hovered === i ? styles.dropdownItemHover : {}),
                }}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => { it.action(); onClose(); }}
              >
                <span>{it.label}</span>
                {it.shortcut && <span style={styles.shortcut}>{it.shortcut}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

type ToastState = { message: string; type: 'success' | 'error' | 'loading' } | null;

export function MenuBar() {
  const loadRef = useRef<HTMLInputElement>(null);
  const voxRef = useRef<HTMLInputElement>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showResizeDialog, setShowResizeDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showGrid = useCharacterStore((s) => s.showGrid);
  const showGizmos = useCharacterStore((s) => s.showGizmos);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'loading', duration = 3000) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    if (type !== 'loading') {
      toastTimer.current = setTimeout(() => setToast(null), duration);
    }
  }, []);

  const handleNew = useCallback(() => {
    setShowNewDialog(true);
  }, []);

  const handleSave = useCallback(() => {
    const store = useCharacterStore.getState();
    const data = store.saveProject();
    const json = JSON.stringify(data, null, 2);
    if (store.currentFilename) {
      download(new Blob([json], { type: 'application/json' }), store.currentFilename);
    } else {
      const name = data.characterName.replace(/\s+/g, '_').toLowerCase() || 'character';
      const filename = `${name}.echidna`;
      download(new Blob([json], { type: 'application/json' }), filename);
      store.setCurrentFilename(filename);
    }
  }, []);

  const handleSaveAs = useCallback(() => {
    const data = useCharacterStore.getState().saveProject();
    const json = JSON.stringify(data, null, 2);
    const name = data.characterName.replace(/\s+/g, '_').toLowerCase() || 'character';
    const filename = prompt('Save as:', `${name}.echidna`);
    if (!filename) return;
    download(new Blob([json], { type: 'application/json' }), filename);
    useCharacterStore.getState().setCurrentFilename(filename);
  }, []);

  const handleLoad = useCallback(() => {
    loadRef.current?.click();
  }, []);

  const handleLoadChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const data = JSON.parse(reader.result as string) as EchidnaFile;
      useCharacterStore.getState().loadProject(data);
      useCharacterStore.getState().setCurrentFilename(file.name);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleImportVox = useCallback(() => {
    voxRef.current?.click();
  }, []);

  const handleVoxChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buffer = await file.arrayBuffer();
    const voxFile = parseVox(buffer);
    const models = voxFile.models.map((m, i) => ({
      name: `part_${i}`,
      voxels: m.voxels,
    }));
    useCharacterStore.getState().importVoxModels(models);
    e.target.value = '';
  };

  const handleExportPly = useCallback(() => {
    const s = useCharacterStore.getState();
    const blob = exportPly(s.voxels, s.gridWidth, s.gridDepth, s.characterParts);
    const name = s.characterName.replace(/\s+/g, '_').toLowerCase() || 'character';
    download(blob, `${name}.ply`);
  }, []);

  const handleExportManifest = useCallback(() => {
    const s = useCharacterStore.getState();
    const name = s.characterName.replace(/\s+/g, '_').toLowerCase() || 'character';
    const manifest = buildManifest(
      name,
      `${name}.ply`,
      1.0,
      s.characterParts,
      s.characterPoses,
      s.animations,
    );
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    download(blob, `${name}.manifest.json`);
  }, []);

  const handlePreviewInStaging = useCallback(async () => {
    const s = useCharacterStore.getState();
    if (s.voxels.size === 0) {
      showToast('No voxels to preview', 'error');
      return;
    }

    showToast('Sending to Staging...', 'loading');

    try {
      const charId = s.characterName.replace(/\s+/g, '_').toLowerCase() || 'character';
      const plyBlob = exportPly(s.voxels, s.gridWidth, s.gridDepth, s.characterParts);

      // Upload PLY binary to bridge REST API
      const plyRes = await fetch(
        `${BRIDGE_REST_URL}/api/characters/${encodeURIComponent(charId)}/file/${encodeURIComponent(charId + '.ply')}`,
        { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: plyBlob },
      );
      if (!plyRes.ok) {
        const err = await plyRes.json().catch(() => ({ error: plyRes.statusText }));
        throw new Error(err.error || 'Failed to upload PLY');
      }
      const { path: plyPath } = await plyRes.json() as { path: string };

      // Build a minimal scene JSON that shows the character as a game object
      const scene = {
        version: 2,
        gaussian_splat: {
          ply_file: plyPath,
          camera: {
            position: [0, 5, 20],
            target: [0, 0, 0],
            fov: 45,
          },
          render_width: 320,
          render_height: 240,
        },
        game_objects: [],
      };

      // Send load_scene_json to Staging via bridge WebSocket
      await sendBridgeCommand({ cmd: 'load_scene_json', json: JSON.stringify(scene) });

      showToast('Character sent to Staging', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Preview failed: ${msg}`, 'error', 5000);
    }
  }, [showToast]);

  const fileItems = [
    { label: 'New', shortcut: '\u2318N', action: handleNew },
    { separator: true as const },
    { label: 'Save', shortcut: '\u2318S', action: handleSave },
    { label: 'Save As...', shortcut: '\u21e7\u2318S', action: handleSaveAs },
    { label: 'Load...', shortcut: '\u2318O', action: handleLoad },
    { separator: true as const },
    { label: 'Import .vox...', action: handleImportVox },
    { label: 'Export...', action: () => setShowExportDialog(true) },
    { label: 'Export PLY...', action: handleExportPly },
    { label: 'Export Manifest...', action: handleExportManifest },
    { separator: true as const },
    { label: 'Preview in Staging', action: handlePreviewInStaging },
  ];

  const editItems = [
    { label: 'Undo', shortcut: '\u2318Z', action: () => useCharacterStore.getState().undo() },
    { label: 'Redo', shortcut: '\u21e7\u2318Z', action: () => useCharacterStore.getState().redo() },
    { separator: true as const },
    { label: 'Resize Grid...', action: () => setShowResizeDialog(true) },
  ];

  const viewItems = [
    { label: `${showGrid ? '\u2713 ' : '  '}Grid`, action: () => useCharacterStore.getState().setShowGrid(!showGrid) },
    { label: `${showGizmos ? '\u2713 ' : '  '}Gizmos`, action: () => useCharacterStore.getState().setShowGizmos(!showGizmos) },
  ];

  return (
    <div style={styles.bar}>
      <DropdownMenu
        label="File"
        items={fileItems}
        open={openMenu === 'file'}
        onOpen={() => setOpenMenu('file')}
        onClose={() => setOpenMenu(null)}
      />
      <DropdownMenu
        label="Edit"
        items={editItems}
        open={openMenu === 'edit'}
        onOpen={() => setOpenMenu('edit')}
        onClose={() => setOpenMenu(null)}
      />
      <DropdownMenu
        label="View"
        items={viewItems}
        open={openMenu === 'view'}
        onOpen={() => setOpenMenu('view')}
        onClose={() => setOpenMenu(null)}
      />

      <div style={styles.spacer} />

      <span style={styles.title}>Echidna</span>

      <input ref={loadRef} type="file" accept=".echidna,.json" style={{ display: 'none' }} onChange={handleLoadChange} />
      <input ref={voxRef} type="file" accept=".vox" style={{ display: 'none' }} onChange={handleVoxChange} />

      {toast && (
        <div style={{
          ...styles.toast,
          ...(toast.type === 'success' ? styles.toastSuccess :
              toast.type === 'error' ? styles.toastError :
              styles.toastLoading),
        }}>
          {toast.message}
        </div>
      )}

      {showNewDialog && <NewProjectDialog onClose={() => setShowNewDialog(false)} />}
      {showResizeDialog && <ResizeGridDialog onClose={() => setShowResizeDialog(false)} />}
      {showExportDialog && <ExportDialog onClose={() => setShowExportDialog(false)} />}
    </div>
  );
}
