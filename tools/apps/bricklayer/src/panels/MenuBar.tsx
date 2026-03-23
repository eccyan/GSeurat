import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSceneStore } from '../store/useSceneStore.js';
import { exportPly } from '../lib/plyExport.js';
import { exportSceneJson as buildSceneJson } from '../lib/sceneExport.js';
import type { BricklayerFile, ProjectManifest } from '../store/types.js';
import {
  hasFileSystemAccess,
  openProjectDirectory,
  saveProject as saveProjectDir,
  loadProject as loadProjectDir,
  importAssetToProject,
  exportSceneJson as writeSceneJson,
} from '../lib/projectIO.js';

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
    border: '1px solid transparent',
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

function buildProjectManifest(store: ReturnType<typeof useSceneStore.getState>): ProjectManifest {
  return {
    name: store.projectName,
    version: 1,
    terrains: store.terrains,
    assets: store.assets,
    globalSettings: {
      ambientColor: store.ambientColor,
      gaussianSplat: store.gaussianSplat,
      weather: store.weather,
      dayNight: store.dayNight,
      backgroundLayers: store.backgroundLayers,
      torchEmitter: store.torchEmitter,
      torchPositions: store.torchPositions,
      footstepEmitter: store.footstepEmitter,
      npcAuraEmitter: store.npcAuraEmitter,
    },
    scene: {
      placedObjects: store.placedObjects,
      staticLights: store.staticLights,
      npcs: store.npcs,
      portals: store.portals,
      player: store.player,
    },
  };
}

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
  const fileRef = useRef<HTMLInputElement>(null);
  const assetRef = useRef<HTMLInputElement>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const closeMenu = useCallback(() => setOpenMenu(null), []);
  const toggleMenu = useCallback(
    (id: string) => setOpenMenu((prev) => (prev === id ? null : id)),
    [],
  );

  const handleNew = () => {
    if (!confirm('Create new scene? Unsaved changes will be lost.')) return;
    useSceneStore.getState().newScene(128, 96);
  };

  const handleSave = () => {
    const data = useSceneStore.getState().saveProject();
    const json = JSON.stringify(data, null, 2);
    download(new Blob([json], { type: 'application/json' }), 'scene.bricklayer');
  };

  const handleLoad = () => {
    fileRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const data = JSON.parse(reader.result as string) as BricklayerFile;
      useSceneStore.getState().loadProject(data);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleExportPly = () => {
    const s = useSceneStore.getState();
    const blob = exportPly(s.voxels, s.gridWidth, s.gridDepth);
    download(blob, 'map.ply');
  };

  const handleExportScene = () => {
    const s = useSceneStore.getState();
    const scene = buildSceneJson(s);
    const json = JSON.stringify(scene, null, 2);
    download(new Blob([json], { type: 'application/json' }), 'scene.json');
  };

  // ── Project directory operations ──

  const handleNewProject = async () => {
    if (!hasFileSystemAccess()) {
      alert('Project directories require Chrome or Edge (File System Access API not available in this browser).');
      return;
    }
    if (!confirm('Create new project? Unsaved changes will be lost.')) return;
    const handle = await openProjectDirectory();
    if (!handle) return;
    const store = useSceneStore.getState();
    store.newScene(128, 96);
    store.setProjectHandle(handle);
    store.setProjectName(handle.name || 'Untitled');
  };

  const handleOpenProject = async () => {
    if (!hasFileSystemAccess()) {
      alert('Project directories require Chrome or Edge (File System Access API not available in this browser).');
      return;
    }
    const handle = await openProjectDirectory();
    if (!handle) return;
    const result = await loadProjectDir(handle);
    if (!result) {
      alert('No valid project.json found in the selected directory.');
      return;
    }
    const store = useSceneStore.getState();
    store.setProjectHandle(handle);
    store.setProjectName(result.manifest.name);

    // Restore terrains and assets from manifest
    // For now, load first terrain's voxel data into the editor
    const state: Record<string, unknown> = {
      terrains: result.manifest.terrains,
      assets: result.manifest.assets,
      currentTerrainId: result.manifest.terrains.length > 0 ? result.manifest.terrains[0].id : null,
      ambientColor: result.manifest.globalSettings.ambientColor,
      gaussianSplat: result.manifest.globalSettings.gaussianSplat,
      weather: result.manifest.globalSettings.weather,
      dayNight: result.manifest.globalSettings.dayNight,
      backgroundLayers: result.manifest.globalSettings.backgroundLayers,
      torchEmitter: result.manifest.globalSettings.torchEmitter,
      torchPositions: result.manifest.globalSettings.torchPositions,
      footstepEmitter: result.manifest.globalSettings.footstepEmitter,
      npcAuraEmitter: result.manifest.globalSettings.npcAuraEmitter,
      placedObjects: result.manifest.scene.placedObjects,
      staticLights: result.manifest.scene.staticLights,
      npcs: result.manifest.scene.npcs,
      portals: result.manifest.scene.portals,
      player: result.manifest.scene.player,
    };

    // Load voxels for the first terrain
    if (result.manifest.terrains.length > 0) {
      const firstId = result.manifest.terrains[0].id;
      const voxelEntries = result.voxelDataMap.get(firstId);
      if (voxelEntries) {
        (state as Record<string, unknown>).voxels = new Map(voxelEntries);
      }
      const firstTerrain = result.manifest.terrains[0];
      if (firstTerrain.collision) {
        (state as Record<string, unknown>).collisionGridData = firstTerrain.collision;
      }
      (state as Record<string, unknown>).navZoneNames = firstTerrain.navZoneNames;
    }

    useSceneStore.setState(state as Partial<typeof store>);
  };

  const handleSaveProject = async () => {
    const store = useSceneStore.getState();
    let handle = store.projectHandle;
    if (!handle) {
      if (!hasFileSystemAccess()) {
        alert('Project directories require Chrome or Edge (File System Access API not available in this browser).');
        return;
      }
      handle = await openProjectDirectory();
      if (!handle) return;
      store.setProjectHandle(handle);
      store.setProjectName(handle.name || store.projectName);
    }

    const manifest = buildProjectManifest(store);
    const voxelDataMap = new Map<string, [import('../store/types.js').VoxelKey, import('../store/types.js').Voxel][]>();

    // Save current terrain voxel data
    if (store.currentTerrainId) {
      voxelDataMap.set(store.currentTerrainId, Array.from(store.voxels.entries()));
    } else if (manifest.terrains.length === 0) {
      // Auto-create a default terrain for existing voxels
      const id = `terrain_${Date.now()}`;
      const terrain = {
        id,
        name: 'Default Terrain',
        voxelFile: `terrains/${id}.bricklayer`,
        collision: store.collisionGridData,
        navZoneNames: store.navZoneNames,
      };
      manifest.terrains.push(terrain);
      voxelDataMap.set(id, Array.from(store.voxels.entries()));
    }

    await saveProjectDir(handle, manifest, voxelDataMap);
  };

  const handleImportAsset = () => {
    if (!useSceneStore.getState().projectHandle) {
      alert('Open or create a project first before importing assets.');
      return;
    }
    assetRef.current?.click();
  };

  const handleAssetFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const handle = useSceneStore.getState().projectHandle;
    if (!handle) return;

    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const subdir = ext === 'ply' ? 'ply' : undefined;
    const relativePath = await importAssetToProject(handle, file, subdir);

    const assetType: 'ply' | 'image' | 'other' =
      ext === 'ply' ? 'ply' :
      ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'].includes(ext) ? 'image' :
      'other';

    useSceneStore.getState().addAsset({
      id: `asset_${Date.now()}`,
      path: relativePath,
      type: assetType,
    });

    e.target.value = '';
  };

  const handleExportProjectScene = async () => {
    const store = useSceneStore.getState();
    const handle = store.projectHandle;
    if (!handle) {
      alert('Open or create a project first before exporting scene.');
      return;
    }
    const scene = buildSceneJson(store);
    await writeSceneJson(handle, scene);
  };

  const fileItems: MenuItem[] = [
    { label: 'New Project', action: handleNewProject },
    { label: 'Open Project...', action: handleOpenProject },
    { label: 'Save Project', action: handleSaveProject },
    { label: 'Import Asset...', action: handleImportAsset },
    { label: 'Export Scene', action: handleExportProjectScene },
    { label: 'Save File...', action: handleSave, separator: true },
    { label: 'Open File...', action: handleLoad },
    { label: 'Import Image...', action: onImport, separator: true },
    { label: 'Export PLY...', action: handleExportPly, separator: true },
    { label: 'Export Scene (Download)...', action: handleExportScene },
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
      <input
        ref={fileRef}
        type="file"
        accept=".bricklayer,.json"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      <input
        ref={assetRef}
        type="file"
        accept=".ply,.png,.jpg,.jpeg,.bmp,.gif,.webp"
        style={{ display: 'none' }}
        onChange={handleAssetFileChange}
      />
      <span style={styles.title}>
        Bricklayer — {useSceneStore.getState().projectName}
      </span>
    </div>
  );
}
