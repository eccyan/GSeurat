import React, { useState, useRef, useEffect } from 'react';
import { useWeaverStore } from '../store/useWeaverStore.js';
import { exportMultiGroupConfig, downloadJson } from '../lib/exportConfig.js';

type MenuId = 'file' | 'edit' | 'view' | null;

export function MenuBar() {
  const [openMenu, setOpenMenu] = useState<MenuId>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const saveProject = useWeaverStore((s) => s.saveProject);
  const projectName = useWeaverStore((s) => s.projectName);
  const dirty = useWeaverStore((s) => s.dirty);
  const activeGroupId = useWeaverStore((s) => s.activeGroupId);
  const addStem = useWeaverStore((s) => s.addStem);
  const zoomToFit = useWeaverStore((s) => s.zoomToFit);

  // Close menu on outside click
  useEffect(() => {
    if (!openMenu) return;
    const handler = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openMenu]);

  const handleToggle = (id: MenuId) => {
    setOpenMenu(openMenu === id ? null : id);
  };

  const close = () => setOpenMenu(null);

  const handleSave = async () => {
    close();
    await saveProject();
  };

  const handleExport = () => {
    close();
    const state = useWeaverStore.getState();
    state.flushActiveGroup();
    const flushed = useWeaverStore.getState();
    const config = exportMultiGroupConfig(flushed.sampleRate, flushed.groups);
    downloadJson(config, `${flushed.projectName}.music.json`);
  };

  const handleImportStems = () => {
    close();
    fileRef.current?.click();
  };

  const handleStemFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      await addStem(file);
    }
    e.target.value = '';
  };

  const handleOpenProjectRoot = async () => {
    close();
    try {
      const handle: FileSystemDirectoryHandle =
        await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      const { saveProjectRootHandle } = await import('@gseurat/project-root');
      await saveProjectRootHandle('weaver', handle);
      useWeaverStore.getState().setProjectRootHandle(handle);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        console.error('[weaver] Failed to set project root:', e);
      }
    }
  };

  const handleZoomToFit = () => {
    close();
    zoomToFit();
  };

  const menuBtnStyle: React.CSSProperties = {
    background: 'transparent', border: 'none', color: '#ccc',
    padding: '4px 10px', cursor: 'pointer', fontSize: 12, borderRadius: 3,
  };
  const menuBtnActiveStyle: React.CSSProperties = {
    ...menuBtnStyle, background: '#333',
  };
  const dropdownStyle: React.CSSProperties = {
    position: 'absolute', top: '100%', left: 0, minWidth: 200,
    background: '#1e1e3e', border: '1px solid #555', borderRadius: 4,
    padding: '4px 0', zIndex: 100, boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
  };
  const itemStyle: React.CSSProperties = {
    display: 'block', width: '100%', textAlign: 'left', background: 'transparent',
    border: 'none', color: '#ccc', padding: '6px 16px', cursor: 'pointer',
    fontSize: 12, whiteSpace: 'nowrap',
  };
  const separatorStyle: React.CSSProperties = {
    height: 1, background: '#444', margin: '4px 8px',
  };

  return (
    <div ref={barRef} className="weaver-menubar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {/* File menu */}
        <div style={{ position: 'relative' }}>
          <button
            style={openMenu === 'file' ? menuBtnActiveStyle : menuBtnStyle}
            onClick={() => handleToggle('file')}
            onMouseEnter={() => openMenu && setOpenMenu('file')}
          >
            File
          </button>
          {openMenu === 'file' && (
            <div style={dropdownStyle}>
              <button style={itemStyle} onClick={handleSave}>
                Save Project <span style={{ float: 'right', color: '#888' }}>{'\u2318'}S</span>
              </button>
              <div style={separatorStyle} />
              <button
                style={{ ...itemStyle, opacity: activeGroupId ? 1 : 0.4 }}
                onClick={handleImportStems}
                disabled={!activeGroupId}
              >
                Import Stems...
              </button>
              <button style={itemStyle} onClick={handleExport}>
                Export v2 JSON...
              </button>
              <div style={separatorStyle} />
              <button style={itemStyle} onClick={handleOpenProjectRoot}>
                Open Project Root...
              </button>
            </div>
          )}
        </div>

        {/* Edit menu - placeholder for future */}
        <div style={{ position: 'relative' }}>
          <button
            style={openMenu === 'edit' ? menuBtnActiveStyle : menuBtnStyle}
            onClick={() => handleToggle('edit')}
            onMouseEnter={() => openMenu && setOpenMenu('edit')}
          >
            Edit
          </button>
          {openMenu === 'edit' && (
            <div style={dropdownStyle}>
              <button style={{ ...itemStyle, color: '#666' }} disabled>
                Undo (coming soon)
              </button>
              <button style={{ ...itemStyle, color: '#666' }} disabled>
                Redo (coming soon)
              </button>
            </div>
          )}
        </div>

        {/* View menu */}
        <div style={{ position: 'relative' }}>
          <button
            style={openMenu === 'view' ? menuBtnActiveStyle : menuBtnStyle}
            onClick={() => handleToggle('view')}
            onMouseEnter={() => openMenu && setOpenMenu('view')}
          >
            View
          </button>
          {openMenu === 'view' && (
            <div style={dropdownStyle}>
              <button style={itemStyle} onClick={handleZoomToFit}>
                Zoom to Fit
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Right side: project name */}
      <span className="weaver-title">
        Weaver{' '}
        <span style={{ fontWeight: 400, fontSize: 11, color: '#888' }}>
          {projectName}{dirty ? ' *' : ''}
        </span>
      </span>

      {/* Hidden file input for stem import */}
      <input
        ref={fileRef}
        type="file"
        accept=".wav,.ogg,.mp3,.flac"
        multiple
        style={{ display: 'none' }}
        onChange={handleStemFiles}
      />
    </div>
  );
}
