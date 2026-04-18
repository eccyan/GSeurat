import React, { useRef } from 'react';
import { useWeaverStore } from '../store/useWeaverStore.js';
import { exportMultiGroupConfig, downloadJson } from '../lib/exportConfig.js';

export function Toolbar() {
  const fileRef = useRef<HTMLInputElement>(null);
  const addStem = useWeaverStore((s) => s.addStem);
  const isPlaying = useWeaverStore((s) => s.isPlaying);
  const setIsPlaying = useWeaverStore((s) => s.setIsPlaying);
  const setPlayheadFrame = useWeaverStore((s) => s.setPlayheadFrame);
  const zoomToFit = useWeaverStore((s) => s.zoomToFit);
  const loopEnabled = useWeaverStore((s) => s.loopEnabled);
  const setLoopEnabled = useWeaverStore((s) => s.setLoopEnabled);
  const saveProject = useWeaverStore((s) => s.saveProject);
  const projectName = useWeaverStore((s) => s.projectName);
  const activeGroupId = useWeaverStore((s) => s.activeGroupId);
  const dirty = useWeaverStore((s) => s.dirty);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      await addStem(file);
    }
    e.target.value = '';
  };

  const handleRewind = () => {
    const state = useWeaverStore.getState();
    if (state.isPlaying) {
      setIsPlaying(false);
      setPlayheadFrame(0);
      queueMicrotask(() => setIsPlaying(true));
    } else {
      setPlayheadFrame(0);
    }
  };

  const handleExport = () => {
    const state = useWeaverStore.getState();
    state.flushActiveGroup();
    const flushed = useWeaverStore.getState();
    const config = exportMultiGroupConfig(flushed.sampleRate, flushed.groups);
    downloadJson(config, `${flushed.projectName}.music.json`);
  };

  const handleSave = async () => {
    await saveProject();
  };

  return (
    <header className="weaver-toolbar">
      <span className="weaver-title">
        Weaver{' '}
        <span style={{ fontWeight: 400, fontSize: 11, color: '#888' }}>
          {projectName}
          {dirty ? ' *' : ''}
        </span>
      </span>
      <button onClick={handleSave} title="Cmd+S">
        Save
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".wav,.ogg,.mp3,.flac"
        multiple
        style={{ display: 'none' }}
        onChange={handleImport}
      />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={!activeGroupId}
        style={{ opacity: activeGroupId ? 1 : 0.4 }}
      >
        Import Stems
      </button>
      <button onClick={handleRewind}>{'\u23EE'} Rewind</button>
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
