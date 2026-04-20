import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useComponentRegistry } from '@gseurat/ui-kit';
import { useSceneStore } from '../store/useSceneStore.js';
import { exportSceneJson } from '../lib/sceneExport.js';
import { computeFingerprint, isStructuralChange, type SceneFingerprint } from '../lib/sceneFingerprint.js';
import { hasFileSystemAccess, openProjectDirectory, saveProject as saveProjectDir, loadProject as loadProjectDir, saveProjectAsZip, loadProjectFromZip, importAssetToProject } from '../lib/projectIO.js';
import { sendBridgeCommand, sendBridgeCommands } from '@gseurat/engine-client';
import type { BricklayerFile } from '../store/types.js';
import {
  saveProjectRootHandle,
  saveBridgePath,
} from '@gseurat/project-root';
import { connectBridgeToPath } from '../lib/bridgeConnection.js';

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

export function MenuBar() {
  useComponentRegistry('MenuBar');
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const isDirty = useSceneStore((st) => st.isDirty);
  const projectName = useSceneStore((st) => st.projectName);
  const projectHandle = useSceneStore((st) => st.projectHandle);
  const bridgeConnectedPath = useSceneStore((st) => st.bridgeConnectedPath);

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
      // Persist the handle so future sessions can auto-restore via App.tsx
      // bootstrap (Phase 0.1 #2). Failure here is non-fatal.
      saveProjectRootHandle('bricklayer', handle).catch((e) => {
        console.warn('[bricklayer] saveProjectRootHandle failed:', e);
      });
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
        saveProjectRootHandle('bricklayer', handle).catch((e) => {
          console.warn('[bricklayer] saveProjectRootHandle failed:', e);
        });
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
          saveProjectRootHandle('bricklayer', newHandle).catch((e) => {
            console.warn('[bricklayer] saveProjectRootHandle failed:', e);
          });
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

  const handleExportScene = () => {
    const s = useSceneStore.getState();
    const scene = exportSceneJson(s);
    const json = JSON.stringify(scene, null, 2);
    download(new Blob([json], { type: 'application/json' }), `${s.projectName || 'scene'}.json`);
  };

  // Push VFX preset files to engine via write_temp_file before scene load.
  // The engine resolves vfx_file paths relative to its working directory,
  // so we write them to the expected paths before the scene references them.
  const pushVfxFiles = (state: ReturnType<typeof useSceneStore.getState>) => {
    const cmds: Record<string, unknown>[] = [];
    for (const inst of state.vfxInstances) {
      if (inst.vfx_preset && inst.vfx_file) {
        cmds.push({
          cmd: 'write_temp_file',
          path: inst.vfx_file,
          content: JSON.stringify(inst.vfx_preset, null, 2),
        });
      }
    }
    return cmds;
  };

  const handleOpenInStaging = () => {
    const s = useSceneStore.getState();
    const scene = exportSceneJson(s);
    const json = JSON.stringify(scene);
    const cmds: Record<string, unknown>[] = [];
    // Send project root before loading scene so PLY paths resolve correctly
    const bridgePath = s.bridgeConnectedPath;
    if (bridgePath) {
      cmds.push({ cmd: 'set_project_root', path: bridgePath });
    }
    cmds.push(...pushVfxFiles(s));
    cmds.push({ cmd: 'load_scene_json', json });
    sendBridgeCommands(cmds);
  };

  const handleConnectBridgeToProject = async () => {
    const currentHandle = useSceneStore.getState().projectHandle;
    const currentBridgePath = useSceneStore.getState().bridgeConnectedPath;
    const initial = currentBridgePath ?? '';
    const projectPath = window.prompt(
      'Project root absolute path on disk:\n\n' +
        'This tells the bridge (and engine) where your project lives so relative ' +
        'asset paths can be resolved. Example: /Users/you/MyGameProject',
      initial,
    );
    if (!projectPath) return;
    const result = await connectBridgeToPath(projectPath);
    if (result.ok) {
      console.info(`[bricklayer] Bridge connected to project root: ${result.activeProjectDir}`);
      useSceneStore.getState().setBridgeConnectedPath(result.activeProjectDir);
      // Persist the {handleName, absolutePath} pair so future sessions can
      // auto-apply it on bootstrap. Only persist when we actually have a
      // FSAPI handle to key by — otherwise the auto-fill bootstrap has
      // nothing to match against.
      if (currentHandle) {
        saveBridgePath('bricklayer', {
          handleName: currentHandle.name,
          absolutePath: result.activeProjectDir,
        }).catch((e) => {
          console.warn('[bricklayer] saveBridgePath failed:', e);
        });
      }
    } else {
      console.error(`[bricklayer] Bridge rejected path: ${result.error}`);
    }
  };

  // Auto-sync: debounced incremental update to Staging.
  // Tracks a "fingerprint" of structural properties (PLY, camera, objects, resolution).
  // Property-only changes (lights, emitters, animations, VFX) use the lightweight
  // update_scene_data command; structural changes use full load_scene_json.
  const stagingAutoSync = useSceneStore((s) => s.stagingAutoSync);
  const autoSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevFingerprint = useRef<SceneFingerprint | null>(null);

  useEffect(() => {
    if (!stagingAutoSync) {
      prevFingerprint.current = null; // reset on disable so next enable does full sync
      return;
    }
    const unsub = useSceneStore.subscribe(() => {
      if (autoSyncTimer.current) clearTimeout(autoSyncTimer.current);
      autoSyncTimer.current = setTimeout(() => {
        const s = useSceneStore.getState();
        const scene = exportSceneJson(s) as Record<string, unknown>;
        const json = JSON.stringify(scene);
        const fp = computeFingerprint(scene);

        const vfxCmds = pushVfxFiles(s);
        const rootCmd = s.bridgeConnectedPath
          ? [{ cmd: 'set_project_root', path: s.bridgeConnectedPath }]
          : [];
        if (isStructuralChange(prevFingerprint.current, fp)) {
          // Structural change: full reload (re-uploads PLY)
          sendBridgeCommands([...rootCmd, ...vfxCmds, { cmd: 'load_scene_json', json }]);
        } else {
          // Property-only change: lightweight update (no PLY reload)
          sendBridgeCommands([...rootCmd, ...vfxCmds, { cmd: 'update_scene_data', json }]);
        }
        prevFingerprint.current = fp;
      }, 2000);  // 2s debounce
    });
    return () => {
      unsub();
      if (autoSyncTimer.current) clearTimeout(autoSyncTimer.current);
    };
  }, [stagingAutoSync]);

  const handleImportAsset = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ply,.png,.jpg,.jpeg,.wav,.mp3,.json,.vfx.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      // VFX preset import — load and add as VFX instance
      if (file.name.endsWith('.vfx.json')) {
        try {
          const text = await file.text();
          const preset = JSON.parse(text);
          const store = useSceneStore.getState();
          store.addVfxInstance({
            id: `vfx_${Date.now()}`,
            name: preset.name ?? file.name.replace('.vfx.json', ''),
            vfx_file: `assets/vfx/${file.name}`,
            vfx_preset: preset,
            position: [0, 0, 0],
            rotation_y: 0,
            radius: 5,
            trigger: 'auto',
            loop: true,
          });
          // Copy to project directory
          const handle = store.projectHandle;
          if (handle) {
            await importAssetToProject(handle, file);
          }
        } catch (e) {
          console.warn('[Bricklayer] Failed to import VFX:', e);
        }
        return;
      }

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
    { label: 'Export Scene...', action: handleExportScene, separator: true },
    { label: 'Open in Staging', action: handleOpenInStaging },
    { label: 'Connect Bridge to Project Root…', action: handleConnectBridgeToProject },
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
      label: `${useSceneStore.getState().showGizmos ? '\u2713 ' : ''}Gizmos`,
      action: () => {
        const s = useSceneStore.getState();
        s.setShowGizmos(!s.showGizmos);
      },
    },
    {
      label: `${useSceneStore.getState().showTerrainPly ? '\u2713 ' : ''}Terrain PLY`,
      action: () => {
        const s = useSceneStore.getState();
        s.setShowTerrainPly(!s.showTerrainPly);
      },
    },
    {
      label: `${useSceneStore.getState().showObjectPly ? '\u2713 ' : ''}Object PLY`,
      action: () => {
        const s = useSceneStore.getState();
        s.setShowObjectPly(!s.showObjectPly);
      },
    },
    {
      label: `${useSceneStore.getState().stagingAutoSync ? '\u2713 ' : ''}Auto-Sync Staging`,
      action: () => {
        const s = useSceneStore.getState();
        s.setStagingAutoSync(!s.stagingAutoSync);
      },
    },
  ];

  return (
    <div data-panel-id="menu-bar" style={styles.bar}>
      <DropdownMenu
        label="File"
        items={fileItems}
        isOpen={openMenu === 'file'}
        onToggle={() => toggleMenu('file')}
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
        <span
          title={
            bridgeConnectedPath
              ? `Bridge connected to ${bridgeConnectedPath}`
              : 'Bridge not connected — File → Connect Bridge to Project Root…'
          }
          style={{
            marginLeft: 12,
            padding: '2px 6px',
            borderRadius: 3,
            fontSize: 11,
            color: bridgeConnectedPath ? '#7f7' : '#888',
            background: bridgeConnectedPath ? '#1a3a1a' : '#2a2a2a',
            border: `1px solid ${bridgeConnectedPath ? '#3a6a3a' : '#3a3a3a'}`,
          }}
        >
          {bridgeConnectedPath ? 'Bridge \u25CF' : 'Bridge \u25CB'}
        </span>
      </span>
    </div>
  );
}
