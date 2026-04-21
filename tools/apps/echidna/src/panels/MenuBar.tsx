import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useComponentRegistry } from '@gseurat/ui-kit';
import { useCharacterStore } from '../store/useCharacterStore.js';
import { exportPly } from '../lib/plyExport.js';
import { buildManifest } from '../lib/manifestExport.js';
import { parseVox } from '../lib/voxImport.js';
import { parsePlyToVoxels } from '../lib/plyImport.js';
import { parseObjToVoxels } from '../lib/objImport.js';
import { sendBridgeCommand, BRIDGE_REST_URL } from '@gseurat/engine-client';
import type { EchidnaFile, Asset } from '../store/types.js';
import { NewProjectDialog } from './NewProjectDialog.js';
import { ResizeGridDialog } from './ResizeGridDialog.js';
import { ExportDialog } from './ExportDialog.js';
import { ImportDialog } from './ImportDialog.js';
import type { ImportOptions } from './ImportDialog.js';
import { ImageImportDialog } from './ImageImportDialog.js';
import {
  saveProjectRootHandle,
} from '@gseurat/project-root';

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

interface DropdownMenuItemLeaf {
  label: string;
  shortcut?: string;
  action: () => void;
  separator?: false;
  children?: undefined;
}

interface DropdownMenuItemSubmenu {
  label: string;
  shortcut?: undefined;
  action?: undefined;
  separator?: false;
  children: DropdownMenuItem[];
}

interface DropdownMenuItemSeparator {
  separator: true;
}

export type DropdownMenuItem =
  | DropdownMenuItemLeaf
  | DropdownMenuItemSubmenu
  | DropdownMenuItemSeparator;

interface DropdownMenuProps {
  label: string;
  items: DropdownMenuItem[];
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}

function SubmenuItem({
  item,
  onClose,
}: {
  item: DropdownMenuItemSubmenu;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        style={{
          ...styles.dropdownItem,
          justifyContent: 'space-between',
          background: open ? styles.dropdownItemHover.background : 'transparent',
        }}
      >
        <span>{item.label}</span>
        <span style={{ marginLeft: 12, color: '#888' }}>&#9658;</span>
      </button>
      {open && (
        <div
          style={{
            ...styles.dropdown,
            position: 'absolute',
            top: 0,
            left: '100%',
            marginLeft: 0,
          }}
        >
          {item.children.map((child, i) => {
            if ('separator' in child && child.separator) {
              return <div key={i} style={styles.separator} />;
            }
            if ('children' in child && child.children) {
              return <SubmenuItem key={i} item={child as DropdownMenuItemSubmenu} onClose={onClose} />;
            }
            const it = child as DropdownMenuItemLeaf;
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
            if ('children' in item && item.children) {
              return <SubmenuItem key={i} item={item as DropdownMenuItemSubmenu} onClose={onClose} />;
            }
            const it = item as DropdownMenuItemLeaf;
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

function EchidnaTitle() {
  const character = useCharacterStore((s) => s.asset);
  const dirty = useCharacterStore((s) => s.dirty);
  const name = character?.characterName ?? '';
  return (
    <span style={styles.title}>
      Echidna{name ? ` — ${name}` : ''}
      {dirty && <span style={{ color: '#fa0', marginLeft: 6 }}>{'\u25CF'}</span>}
    </span>
  );
}

export function MenuBar() {
  useComponentRegistry('MenuBar');
  const loadRef = useRef<HTMLInputElement>(null);
  const voxRef = useRef<HTMLInputElement>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showResizeDialog, setShowResizeDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showImageImportDialog, setShowImageImportDialog] = useState(false);
  const [autoSync, setAutoSync] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showGrid = useCharacterStore((s) => s.showGrid);
  const showGizmos = useCharacterStore((s) => s.showGizmos);
  const voxels = useCharacterStore((s) => s.asset?.voxels ?? new Map());
  const characterParts = useCharacterStore((s) => s.asset?.characterParts ?? []);
  const showToast = useCallback((message: string, type: 'success' | 'error' | 'loading', duration = 3000) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    // Loading toasts auto-clear after 15s as a safety net; others use the specified duration
    const timeout = type === 'loading' ? 15000 : duration;
    toastTimer.current = setTimeout(() => setToast(null), timeout);
  }, []);

  // Shared Staging push logic. Uploads PLY + manifest via REST, sends
  // load_scene_json + load_character via WebSocket. Throws on failure.
  // Callers are responsible for toast/error-UI presentation.
  const syncAssetToStaging = useCallback(async (char: Asset) => {
    const charId = char.id;
    if (!charId) throw new Error('character has no id — call ensureAssetId() first');

    const plyBlob = exportPly(char.voxels, char.gridWidth, char.gridDepth, char.characterParts);

    // Upload PLY
    const plyRes = await fetch(
      `${BRIDGE_REST_URL}/api/characters/${encodeURIComponent(charId)}/file/${encodeURIComponent(charId + '.ply')}`,
      { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: plyBlob },
    );
    if (!plyRes.ok) {
      const err = await plyRes.json().catch(() => ({ error: plyRes.statusText }));
      throw new Error((err as { error?: string }).error || 'Failed to upload PLY');
    }
    const { path: plyPath } = await plyRes.json() as { path: string };

    // Build manifest with centered joints (matches PLY export centering)
    const halfW = char.gridWidth / 2;
    let maxY = 0;
    for (const [key] of char.voxels.entries()) {
      const y = parseInt(key.split(',')[1], 10);
      if (y > maxY) maxY = y;
    }
    const halfH = maxY / 2;
    const centeredParts = char.characterParts.map((p) => ({
      ...p,
      joint: [p.joint[0] - halfW, p.joint[1] - halfH, p.joint[2]] as [number, number, number],
    }));
    const manifest = buildManifest(
      charId, `${charId}.ply`, 1.0,
      centeredParts, char.characterPoses, char.animations,
    );
    const manifestJson = JSON.stringify(manifest, null, 2);

    // Upload manifest
    const manifestRes = await fetch(
      `${BRIDGE_REST_URL}/api/characters/${encodeURIComponent(charId)}/file/${encodeURIComponent(charId + '.manifest.json')}`,
      { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: manifestJson },
    );
    let manifestPath = '';
    if (manifestRes.ok) {
      const res = await manifestRes.json() as { path: string };
      manifestPath = res.path;
    }

    // Build scene JSON
    const scene = {
      version: 2,
      gaussian_splat: {
        ply_file: plyPath,
        camera: { position: [0, 5, 20], target: [0, 0, 0], fov: 45 },
        render_width: 320,
        render_height: 240,
      },
      game_objects: [],
    };

    // Send load_scene_json (with 5s timeout)
    await Promise.race([
      sendBridgeCommand({ cmd: 'load_scene_json', json: JSON.stringify(scene) }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Staging not responding (timed out after 5s)')), 5000)),
    ]);

    // Send load_character for animation playback (non-critical)
    if (manifestPath) {
      await Promise.race([
        sendBridgeCommand({ cmd: 'load_character', path: manifestPath }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('load_character timed out')), 5000)),
      ]).catch(() => { /* non-critical — animation won't be available */ });
    }
  }, []);

  const pushToStaging = useCallback(async () => {
    // Ensure stable id before using char.id as a filesystem path (Bug 1 fix)
    useCharacterStore.getState().ensureAssetId();
    const s = useCharacterStore.getState();
    const char = s.asset;
    if (!char || char.voxels.size === 0) return;

    try {
      await syncAssetToStaging(char);
    } catch (err) {
      // Auto-sync is silent — don't toast, just log
      console.warn('[echidna] auto-sync push to Staging failed:', err);
    }
  }, [syncAssetToStaging]);

  // Auto-sync: debounced push to staging when voxels or parts change
  useEffect(() => {
    if (!autoSync) return;
    if (autoSyncTimer.current) clearTimeout(autoSyncTimer.current);
    autoSyncTimer.current = setTimeout(() => {
      pushToStaging();
    }, 2000);
    return () => {
      if (autoSyncTimer.current) clearTimeout(autoSyncTimer.current);
    };
  }, [autoSync, voxels, characterParts, pushToStaging]);

  const handleNew = useCallback(() => {
    const store = useCharacterStore.getState();
    if (store.dirty || store.undoStack.length > 0) {
      if (!confirm('Create new character? Unsaved changes will be lost.')) {
        return;
      }
    }
    setShowNewDialog(true);
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
      name: m.name ?? `part_${i}`,
      voxels: m.voxels,
    }));
    useCharacterStore.getState().importVoxModels(models);
    e.target.value = '';
  };

  const handleImport = useCallback(async (file: File, options: ImportOptions) => {
    const ext = file.name.toLowerCase();
    const store = useCharacterStore.getState();

    if (ext.endsWith('.vox')) {
      const buffer = await file.arrayBuffer();
      const voxFile = parseVox(buffer);
      const models = voxFile.models.map((m, i) => ({
        name: m.name ?? `part_${i}`,
        voxels: m.voxels,
      }));
      store.pushUndo();
      store.importVoxModels(models);
    } else if (ext.endsWith('.ply')) {
      const buffer = await file.arrayBuffer();
      const result = parsePlyToVoxels(buffer, options.gridSize);
      store.importFromPly(result.voxels, result.parts, result.gridSize);
    } else if (ext.endsWith('.obj')) {
      const text = await file.text();
      const result = parseObjToVoxels(text, options.voxelResolution);
      store.importFromObj(result.voxels, result.parts, result.gridSize);
    }

    setShowImportDialog(false);
  }, []);

  const handleExportPly = useCallback(() => {
    const s = useCharacterStore.getState();
    const char = s.asset;
    if (!char) return;
    const blob = exportPly(char.voxels, char.gridWidth, char.gridDepth, char.characterParts);
    const name = char.characterName.replace(/\s+/g, '_').toLowerCase() || 'character';
    download(blob, `${name}.ply`);
  }, []);

  const handleExportManifest = useCallback(() => {
    const s = useCharacterStore.getState();
    const char = s.asset;
    if (!char) return;
    const name = char.characterName.replace(/\s+/g, '_').toLowerCase() || 'character';
    const manifest = buildManifest(
      name,
      `${name}.ply`,
      1.0,
      char.characterParts,
      char.characterPoses,
      char.animations,
    );
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    download(blob, `${name}.manifest.json`);
  }, []);

  const handlePreviewInStaging = useCallback(async () => {
    // Ensure stable id before using char.id as a filesystem path (Bug 1 fix)
    useCharacterStore.getState().ensureAssetId();
    const s = useCharacterStore.getState();
    const char = s.asset;
    if (!char || char.voxels.size === 0) {
      showToast('No voxels to preview', 'error');
      return;
    }

    showToast('Sending to Staging...', 'loading');
    try {
      await syncAssetToStaging(char);
      showToast('Character sent to Staging', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Preview failed: ${msg}`, 'error', 5000);
    }
  }, [showToast, syncAssetToStaging]);

  const handleConnectBridgeToProject = useCallback(async () => {
    const projectPath = window.prompt(
      'Project root absolute path on disk:\n\n' +
        'This tells the bridge (and engine) where your project lives so relative ' +
        'asset paths can be resolved. Example: /Users/you/MyGameProject',
      '',
    );
    if (!projectPath) return;
    try {
      const res = await fetch(`${BRIDGE_REST_URL}/api/project/root`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: projectPath }),
      });
      if (res.ok) {
        const body = (await res.json()) as { activeProjectDir?: string };
        console.info(`[echidna] Bridge connected to project root: ${body.activeProjectDir}`);
        showToast(`Bridge → ${body.activeProjectDir}`, 'success');
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        console.error(`[echidna] Bridge rejected path: ${body.error ?? res.statusText}`);
        showToast(`Bridge rejected: ${body.error ?? res.statusText}`, 'error', 5000);
      }
    } catch (e) {
      console.error('[echidna] Failed to reach bridge:', e);
      showToast('Failed to reach bridge', 'error');
    }
  }, [showToast]);

  const handlePickProjectRoot = useCallback(async () => {
    try {
      // @ts-expect-error - showDirectoryPicker is FSAPI extension not in lib.dom
      const handle: FileSystemDirectoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      await saveProjectRootHandle('echidna', handle);
      useCharacterStore.getState().setProjectRootHandle(handle);
      await useCharacterStore.getState().listAssets();
      showToast(`Project root set: ${handle.name}`, 'success');
    } catch (e) {
      // User canceled or denied permission
      if ((e as Error).name !== 'AbortError') {
        console.error('[echidna] Failed to set project root:', e);
        showToast('Failed to set project root', 'error');
      }
    }
  }, [showToast]);

  const fileItems: DropdownMenuItem[] = [
    { label: 'New Character', shortcut: '\u2318N', action: handleNew },
    { label: 'Save', shortcut: '\u2318S', action: () => void useCharacterStore.getState().save() },
    { separator: true as const },
    {
      label: 'Project',
      children: [
        { label: 'Open Project Root\u2026', action: handlePickProjectRoot },
        { label: 'Connect Bridge to Project Root\u2026', action: handleConnectBridgeToProject },
      ],
    },
    { separator: true as const },
    {
      label: 'Import',
      children: [
        { label: 'Import (PLY/VOX/OBJ)\u2026', action: () => setShowImportDialog(true) },
        { label: 'Import .vox\u2026', action: handleImportVox },
        { label: 'Import Image (Depth AI)\u2026', action: () => setShowImageImportDialog(true) },
        { label: 'Load .echidna\u2026', action: handleLoad },
      ],
    },
    {
      label: 'Export',
      children: [
        { label: 'Save As .echidna\u2026', action: handleSaveAs },
        { label: 'Export PLY\u2026', action: handleExportPly },
        { label: 'Export Manifest\u2026', action: handleExportManifest },
      ],
    },
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
    { separator: true as const },
    { label: `${autoSync ? '\u2713 ' : '  '}Auto-Sync Staging`, action: () => setAutoSync((v) => !v) },
  ];

  return (
    <div data-panel-id="menu-bar" style={styles.bar}>
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

      <EchidnaTitle />

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
      {showImportDialog && (
        <ImportDialog
          onImport={handleImport}
          onCancel={() => setShowImportDialog(false)}
        />
      )}
      {showImageImportDialog && (
        <ImageImportDialog onClose={() => setShowImageImportDialog(false)} />
      )}
    </div>
  );
}
