import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSceneStore } from '../store/useSceneStore.js';
import { exportPly } from '../lib/plyExport.js';
import { exportSceneJson } from '../lib/sceneExport.js';
import { hasFileSystemAccess, openProjectDirectory, saveProject as saveProjectDir, loadProject as loadProjectDir, saveProjectAsZip, loadProjectFromZip, importAssetToProject } from '../lib/projectIO.js';
import type { BricklayerFile } from '../store/types.js';

const styles: Record<string, React.CSSProperties> = {
  bar: {
    height: 36,
    background: '#16162a',
    borderBottom: '1px solid #333',
    display: 'flex',
    alignItems: 'center',
    padding: '0 4px',
    gap: 0,
    position: 'relative',
    zIndex: 50,
  },
  menuBtn: {
    padding: '4px 12px',
    background: 'transparent',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'transparent',
    borderRadius: 4,
    color: '#ccc',
    cursor: 'pointer',
    fontSize: 13,
    position: 'relative',
  },
  menuBtnOpen: {
    background: '#2a2a4a',
    borderColor: '#444',
  },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    background: '#1e1e3a',
    border: '1px solid #444',
    borderRadius: 4,
    minWidth: 180,
    padding: '4px 0',
    zIndex: 100,
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
  },
  menuItem: {
    display: 'block',
    width: '100%',
    padding: '6px 16px',
    background: 'transparent',
    border: 'none',
    color: '#ccc',
    cursor: 'pointer',
    fontSize: 13,
    textAlign: 'left',
  },
  separator: {
    height: 1,
    background: '#333',
    margin: '4px 0',
  },
  title: {
    marginLeft: 'auto',
    fontSize: 12,
    color: '#666',
    paddingRight: 8,
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

interface MenuItem {
  label: string;
  action: () => void;
  separator?: boolean;
}

function DropdownMenu({
  label,
  items,
  isOpen,
  onToggle,
  onClose,
}: {
  label: string;
  items: MenuItem[];
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, onClose]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        style={{ ...styles.menuBtn, ...(isOpen ? styles.menuBtnOpen : {}) }}
        onClick={onToggle}
      >
        {label}
      </button>
      {isOpen && (
        <div style={styles.dropdown}>
          {items.map((item, i) => (
            <React.Fragment key={i}>
              {item.separator && <div style={styles.separator} />}
              <button
                style={styles.menuItem}
                onClick={() => {
                  item.action();
                  onClose();
                }}
                onMouseEnter={(e) => {
                  (e.target as HTMLElement).style.background = '#3a3a6a';
                }}
                onMouseLeave={(e) => {
                  (e.target as HTMLElement).style.background = 'transparent';
                }}
              >
                {item.label}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

export function MenuBar({ onImport }: { onImport: () => void }) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const isDirty = useSceneStore((st) => st.isDirty);
  const projectName = useSceneStore((st) => st.projectName);
  const projectHandle = useSceneStore((st) => st.projectHandle);

  const closeMenu = useCallback(() => setOpenMenu(null), []);
  const toggleMenu = useCallback(
    (id: string) => setOpenMenu((prev) => (prev === id ? null : id)),
    [],
  );

  // Warn before closing with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (useSceneStore.getState().isDirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // Auto-save every 60s when dirty + project directory set
  useEffect(() => {
    const interval = setInterval(async () => {
      const st = useSceneStore.getState();
      if (st.isDirty && st.projectHandle) {
        try {
          await saveProjectDir(st.projectHandle);
          st.markClean();
        } catch { /* silent auto-save failure */ }
      }
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  // Pick a working directory (shared by New/Open/Save)
  const pickDirectory = async (): Promise<FileSystemDirectoryHandle | null> => {
    if (!hasFileSystemAccess()) {
      alert('Your browser does not support the File System Access API.\nUse Chrome or Edge for directory-based projects.\nFalling back to zip download/upload.');
      return null;
    }
    return openProjectDirectory();
  };

  const handleNew = async () => {
    if (!confirm('Create new project? Unsaved changes will be lost.')) return;
    const handle = await pickDirectory();
    if (handle) {
      useSceneStore.getState().newScene(128, 96);
      useSceneStore.getState().setProjectHandle(handle);
      useSceneStore.getState().setProjectName(handle.name);
      await saveProjectDir(handle);
    } else if (!hasFileSystemAccess()) {
      useSceneStore.getState().newScene(128, 96);
      useSceneStore.getState().setProjectHandle(null);
      useSceneStore.getState().setProjectName('Untitled');
    }
  };

  const handleOpen = async () => {
    if (hasFileSystemAccess()) {
      const handle = await pickDirectory();
      if (handle) {
        useSceneStore.getState().setProjectHandle(handle);
        useSceneStore.getState().setProjectName(handle.name);
        await loadProjectDir(handle);
      }
    } else {
      // Zip fallback
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.zip,.bricklayer,.json';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        if (file.name.endsWith('.zip')) {
          const ok = await loadProjectFromZip(file);
          if (ok) {
            useSceneStore.getState().setProjectName(file.name.replace(/\.zip$/, ''));
          } else {
            alert('Failed to load project zip.');
          }
        } else {
          // Legacy .bricklayer/.json file
          const reader = new FileReader();
          reader.onload = () => {
            const data = JSON.parse(reader.result as string) as BricklayerFile;
            useSceneStore.getState().loadProject(data);
            useSceneStore.getState().setProjectName(file.name.replace(/\.(bricklayer|json)$/, ''));
          };
          reader.readAsText(file);
        }
      };
      input.click();
    }
  };

  const handleSave = async () => {
    try {
      const handle = useSceneStore.getState().projectHandle;
      if (handle) {
        await saveProjectDir(handle);
        useSceneStore.getState().markClean();
      } else if (hasFileSystemAccess()) {
        const newHandle = await pickDirectory();
        if (newHandle) {
          useSceneStore.getState().setProjectHandle(newHandle);
          useSceneStore.getState().setProjectName(newHandle.name);
          await saveProjectDir(newHandle);
          useSceneStore.getState().markClean();
        }
      } else {
        const blob = await saveProjectAsZip();
        const name = useSceneStore.getState().projectName || 'project';
        download(blob, `${name}.zip`);
        useSceneStore.getState().markClean();
      }
    } catch (err) {
      alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleExportPly = () => {
    const s = useSceneStore.getState();
    const blob = exportPly(s.voxels, s.gridWidth, s.gridDepth);
    download(blob, 'map.ply');
  };

  const handleExportScene = () => {
    const s = useSceneStore.getState();
    const scene = exportSceneJson(s);
    const json = JSON.stringify(scene, null, 2);
    download(new Blob([json], { type: 'application/json' }), 'scene.json');
  };

  const handleImportAsset = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ply,.png,.jpg,.jpeg,.wav,.mp3';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      // Store blob in memory
      const path = `assets/${file.name}`;
      useSceneStore.getState().storeAssetBlob(path, file);
      useSceneStore.getState().addAsset({
        id: `asset_${Date.now()}`,
        name: file.name,
        type: file.name.endsWith('.ply') ? 'ply' : file.name.match(/\.(wav|mp3)$/i) ? 'audio' : 'texture',
        path,
      });
      // Copy to FSAPI project directory if available
      const handle = useSceneStore.getState().projectHandle;
      if (handle) {
        await importAssetToProject(handle, file);
      }
    };
    input.click();
  };

  const fileItems: MenuItem[] = [
    { label: 'New Project...', action: handleNew },
    { label: 'Open Project...', action: handleOpen },
    { label: 'Save Project', action: handleSave },
    { label: 'Import Asset...', action: handleImportAsset, separator: true },
    { label: 'Import Image...', action: onImport },
    { label: 'Export Scene...', action: handleExportScene, separator: true },
    { label: 'Export PLY...', action: handleExportPly },
  ];

  const editItems: MenuItem[] = [
    { label: 'Undo', action: () => useSceneStore.getState().undo() },
    { label: 'Redo', action: () => useSceneStore.getState().redo() },
  ];

  const viewItems: MenuItem[] = [
    {
      label: `${useSceneStore.getState().showGrid ? '\u2713 ' : ''}Grid`,
      action: () => {
        const s = useSceneStore.getState();
        s.setShowGrid(!s.showGrid);
      },
    },
    {
      label: `${useSceneStore.getState().showCollision ? '\u2713 ' : ''}Collision`,
      action: () => {
        const s = useSceneStore.getState();
        s.setShowCollision(!s.showCollision);
      },
    },
    {
      label: `${useSceneStore.getState().showGizmos ? '\u2713 ' : ''}Gizmos`,
      action: () => {
        const s = useSceneStore.getState();
        s.setShowGizmos(!s.showGizmos);
      },
    },
    {
      label: `${useSceneStore.getState().xrayMode ? '\u2713 ' : ''}X-Ray (T)`,
      action: () => {
        const s = useSceneStore.getState();
        s.setXrayMode(!s.xrayMode);
      },
    },
  ];

  return (
    <div style={styles.bar}>
      <DropdownMenu
        label="File"
        items={fileItems}
        isOpen={openMenu === 'file'}
        onToggle={() => toggleMenu('file')}
        onClose={closeMenu}
      />
      <DropdownMenu
        label="Edit"
        items={editItems}
        isOpen={openMenu === 'edit'}
        onToggle={() => toggleMenu('edit')}
        onClose={closeMenu}
      />
      <DropdownMenu
        label="View"
        items={viewItems}
        isOpen={openMenu === 'view'}
        onToggle={() => toggleMenu('view')}
        onClose={closeMenu}
      />
      <span style={styles.title}>
        Bricklayer{projectHandle ? ` \u2014 ${projectName}` : ''}
        {isDirty && <span style={{ color: '#fa0', marginLeft: 6 }}>{'\u25CF'}</span>}
      </span>
    </div>
  );
}
