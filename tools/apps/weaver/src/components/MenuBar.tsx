import React, { useState, useRef, useEffect } from 'react';
import { useWeaverStore } from '../store/useWeaverStore.js';
import { exportMultiGroupConfig, downloadJson } from '../lib/exportConfig.js';
import { writeFileAtPath } from '@gseurat/project-root';
import { sendBridgeCommand } from '@gseurat/engine-client';

const BRIDGE_REST_URL = 'http://localhost:9101';

type ConnectBridgeResult =
  | { ok: true; activeProjectDir: string }
  | { ok: false; error: string };

async function connectBridgeToPath(absolutePath: string): Promise<ConnectBridgeResult> {
  if (!absolutePath) return { ok: false, error: 'absolutePath is empty' };
  try {
    const res = await fetch(`${BRIDGE_REST_URL}/api/project/root`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: absolutePath }),
    });
    if (res.ok) {
      const body = (await res.json()) as { activeProjectDir?: string };
      return { ok: true, activeProjectDir: body.activeProjectDir ?? absolutePath };
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error ?? res.statusText };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

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

  const handleConnectBridge = async () => {
    close();
    const absolutePath = prompt(
      'Enter absolute path to your project root:\n(e.g., /Users/you/MyGame)',
    );
    if (!absolutePath?.trim()) return;
    const result = await connectBridgeToPath(absolutePath.trim());
    if (result.ok) {
      console.info(`[weaver] Bridge connected: ${result.activeProjectDir}`);
    } else {
      console.error(`[weaver] Bridge connection failed: ${result.error}`);
      alert(`Bridge connection failed: ${result.error}`);
    }
  };

  const handleOpenInStaging = async () => {
    close();
    const state = useWeaverStore.getState();
    state.flushActiveGroup();
    const flushed = useWeaverStore.getState();
    const config = exportMultiGroupConfig(flushed.sampleRate, flushed.groups);
    const json = JSON.stringify(config, null, 2);
    const assetPath = `assets/audio/${flushed.projectName}.music.json`;

    // Write music_config.json to project root via FSAPI
    if (flushed.projectRootHandle) {
      try {
        await writeFileAtPath(flushed.projectRootHandle, assetPath, json);
        console.info(`[weaver] Exported to project: ${assetPath}`);
      } catch (e) {
        console.warn('[weaver] Failed to write to project root:', e);
      }
    }

    // Push to staging: write file then reload music config
    try {
      await sendBridgeCommand({ cmd: 'write_temp_file', path: assetPath, content: json });
      await sendBridgeCommand({ cmd: 'reload_music_config', path: assetPath });
      console.info('[weaver] Pushed music config to staging and triggered reload');
    } catch (e) {
      console.warn('[weaver] Bridge not available:', e);
    }
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
              <button style={itemStyle} onClick={handleOpenInStaging}>
                Open in Staging
              </button>
              <div style={separatorStyle} />
              <button style={itemStyle} onClick={handleOpenProjectRoot}>
                Open Project Root...
              </button>
              <button style={itemStyle} onClick={handleConnectBridge}>
                Connect Bridge to Project Root...
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
