import React, { useRef, useState } from 'react';
import { useSceneStore } from '../store/useSceneStore.js';
import { exportPly } from '../lib/plyExport.js';
import { exportSceneJson } from '../lib/sceneExport.js';
import type { BricklayerFile } from '../store/types.js';

const styles: Record<string, React.CSSProperties> = {
  bar: {
    height: 36,
    background: '#16162a',
    borderBottom: '1px solid #333',
    display: 'flex',
    alignItems: 'center',
    padding: '0 12px',
    gap: 4,
  },
  btn: {
    padding: '4px 12px',
    background: 'transparent',
    border: '1px solid transparent',
    borderRadius: 4,
    color: '#ccc',
    cursor: 'pointer',
    fontSize: 13,
  },
  title: {
    marginLeft: 'auto',
    fontSize: 12,
    color: '#666',
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

export function MenuBar({ onImport }: { onImport: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);

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
    const scene = exportSceneJson(s);
    const json = JSON.stringify(scene, null, 2);
    download(new Blob([json], { type: 'application/json' }), 'scene.json');
  };

  return (
    <div style={styles.bar}>
      <button style={styles.btn} onClick={handleNew}>New</button>
      <button style={styles.btn} onClick={handleSave}>Save</button>
      <button style={styles.btn} onClick={handleLoad}>Load</button>
      <button style={styles.btn} onClick={onImport}>Import Image</button>
      <button style={styles.btn} onClick={handleExportPly}>Export PLY</button>
      <button style={styles.btn} onClick={handleExportScene}>Export Scene</button>
      <input ref={fileRef} type="file" accept=".bricklayer,.json" style={{ display: 'none' }} onChange={handleFileChange} />
      <span style={styles.title}>Bricklayer</span>
    </div>
  );
}
