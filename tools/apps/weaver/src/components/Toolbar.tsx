import React, { useRef } from 'react';
import { useWeaverStore } from '../store/useWeaverStore.js';
import { downloadJson } from '../lib/exportConfig.js';

export function Toolbar() {
  const fileRef = useRef<HTMLInputElement>(null);
  const addStem = useWeaverStore((s) => s.addStem);
  const isPlaying = useWeaverStore((s) => s.isPlaying);
  const setIsPlaying = useWeaverStore((s) => s.setIsPlaying);
  const zoomToFit = useWeaverStore((s) => s.zoomToFit);
  const getExportData = useWeaverStore((s) => s.getExportData);
  const groupName = useWeaverStore((s) => s.groupName);
  const loopEnabled = useWeaverStore((s) => s.loopEnabled);
  const setLoopEnabled = useWeaverStore((s) => s.setLoopEnabled);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      await addStem(file);
    }
    e.target.value = '';
  };

  const handleExport = () => {
    const data = getExportData();
    downloadJson(data, `${groupName}_music.json`);
  };

  return (
    <header className="weaver-toolbar">
      <span className="weaver-title">Weaver</span>
      <input
        ref={fileRef}
        type="file"
        accept=".wav,.ogg,.mp3,.flac"
        multiple
        style={{ display: 'none' }}
        onChange={handleImport}
      />
      <button onClick={() => fileRef.current?.click()}>Import Stems</button>
      <button onClick={() => setIsPlaying(!isPlaying)}>
        {isPlaying ? 'Stop' : 'Play'}
      </button>
      <button
        onClick={() => setLoopEnabled(!loopEnabled)}
        style={{ opacity: loopEnabled ? 1 : 0.5 }}
      >
        {loopEnabled ? 'Loop ON' : 'Loop OFF'}
      </button>
      <button onClick={zoomToFit}>Zoom to Fit</button>
      <button onClick={handleExport}>Export v2 JSON</button>
    </header>
  );
}
