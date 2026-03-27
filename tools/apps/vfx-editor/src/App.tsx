import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useVfxStore } from './store/useVfxStore.js';
import type { VfxPreset, VfxLayer, LayerType, Phase } from './store/types.js';
import { serializeVfx } from './lib/vfxExport.js';
import { parseVfx } from './lib/vfxImport.js';
import { hasFileSystemAccess, openProjectDirectory, saveProject, loadProject, downloadProject, uploadProject } from './lib/projectIO.js';
import { loadPly, type PlyPoint } from './lib/plyLoader.js';
import { Preview } from './viewport/Preview.js';
import { LayerProperties } from './panels/LayerProperties.js';

// ═══════════════════════════════════════════════════════════════
// Theme
// ═══════════════════════════════════════════════════════════════

const T = {
  bg: '#0f0f1e',
  panel: '#161628',
  panelAlt: '#1c1c34',
  surface: '#22223a',
  border: '#2a2a44',
  borderLight: '#3a3a5a',
  text: '#c8c8d8',
  textDim: '#7878a0',
  textMuted: '#50506a',
  accent: '#6366f1',
  accentDim: '#4f46e5',
  danger: '#ef4444',
  // Phase colors
  phaseAnticipation: '#f59e0b',
  phaseImpact: '#ef4444',
  phaseResidual: '#3b82f6',
  // Layer type colors
  layerEmitter: '#ec4899',
  layerAnimation: '#06b6d4',
  layerLight: '#eab308',
};

const input: React.CSSProperties = {
  padding: '4px 8px', background: T.surface, border: `1px solid ${T.border}`,
  borderRadius: 4, color: T.text, fontSize: 12, outline: 'none', width: '100%',
};

const selectStyle: React.CSSProperties = {
  ...input, cursor: 'pointer', appearance: 'none' as const,
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M0 0l4 5 4-5z' fill='%237878a0'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', paddingRight: 24,
};

const layerColor = (type: LayerType) =>
  type === 'emitter' ? T.layerEmitter : type === 'animation' ? T.layerAnimation : T.layerLight;

const phaseColor = (phase: Phase) =>
  phase === 'anticipation' ? T.phaseAnticipation
    : phase === 'impact' ? T.phaseImpact
    : phase === 'residual' ? T.phaseResidual : T.textMuted;

// ═══════════════════════════════════════════════════════════════
// MenuBar
// ═══════════════════════════════════════════════════════════════

function MenuBar({ onImportScene }: { onImportScene?: () => void }) {
  const addPreset = useVfxStore((s) => s.addPreset);
  const [fileOpen, setFileOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const handleSaveProject = async () => {
    const store = useVfxStore.getState();
    if (hasFileSystemAccess()) {
      let handle = store.projectHandle;
      if (!handle) {
        handle = await openProjectDirectory();
        if (!handle) return;
        store.setProjectHandle(handle);
      }
      await saveProject(handle);
    } else {
      downloadProject();
    }
    setFileOpen(false);
  };

  const handleOpenProject = async () => {
    if (hasFileSystemAccess()) {
      const handle = await openProjectDirectory();
      if (!handle) return;
      const ok = await loadProject(handle);
      if (ok) {
        useVfxStore.getState().setProjectHandle(handle);
      }
    } else {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (file) await uploadProject(file);
      };
      input.click();
    }
    setFileOpen(false);
  };

  const handleImportVfx = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.vfx.json,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const preset = parseVfx(await file.text());
        const store = useVfxStore.getState();
        store.addPreset(preset.name);
        const added = store.presets[store.presets.length - 1];
        if (added) {
          useVfxStore.setState({
            presets: store.presets.map((p) => p.id === added.id ? { ...preset, id: added.id } : p),
          });
        }
      } catch (e) {
        console.error('Failed to parse VFX file:', e);
      }
    };
    input.click();
    setFileOpen(false);
  };

  const handleExportVfx = () => {
    const store = useVfxStore.getState();
    const preset = store.presets.find((p) => p.id === store.selectedPresetId);
    if (!preset) return;
    const json = serializeVfx(preset);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${preset.name.replace(/\s+/g, '_').toLowerCase()}.vfx.json`;
    a.click();
    URL.revokeObjectURL(url);
    setFileOpen(false);
  };

  useEffect(() => {
    if (!fileOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setFileOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [fileOpen]);

  return (
    <div style={{
      height: 32, background: T.panel, borderBottom: `1px solid ${T.border}`,
      display: 'flex', alignItems: 'center', padding: '0 8px', gap: 16,
      fontSize: 12, color: T.textDim, userSelect: 'none',
    }}>
      <div ref={ref} style={{ position: 'relative' }}>
        <span style={{ cursor: 'pointer', padding: '4px 8px', borderRadius: 3 }}
          onClick={() => setFileOpen(!fileOpen)}>File</span>
        {fileOpen && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, background: T.panel,
            border: `1px solid ${T.border}`, borderRadius: 4, padding: '4px 0',
            minWidth: 140, zIndex: 100, boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
          }}>
            {[
              { label: 'New VFX', action: () => { addPreset(); setFileOpen(false); } },
              { label: 'Open Project...', action: handleOpenProject },
              { label: 'Save Project', action: handleSaveProject },
              { label: 'Import .vfx.json...', action: handleImportVfx },
              { label: 'Export .vfx.json', action: handleExportVfx },
              { label: 'Import Scene PLY...', action: () => { onImportScene?.(); setFileOpen(false); } },
            ].map((item) => (
              <div key={item.label} onClick={item.action}
                style={{ padding: '6px 16px', cursor: 'pointer', fontSize: 12, color: T.text }}
                onMouseEnter={(e) => (e.currentTarget.style.background = T.surface)}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                {item.label}
              </div>
            ))}
          </div>
        )}
      </div>
      <span style={{ cursor: 'pointer', padding: '4px 8px' }}>Edit</span>
      <span style={{ cursor: 'pointer', padding: '4px 8px' }}>View</span>
      <div style={{ flex: 1 }} />
      <span style={{ fontSize: 11, color: T.textMuted, letterSpacing: 1 }}>VFX Editor</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// VfxList (left panel)
// ═══════════════════════════════════════════════════════════════

function VfxList() {
  const presets = useVfxStore((s) => s.presets);
  const selectedId = useVfxStore((s) => s.selectedPresetId);
  const selectPreset = useVfxStore((s) => s.selectPreset);
  const addPreset = useVfxStore((s) => s.addPreset);
  const removePreset = useVfxStore((s) => s.removePreset);

  return (
    <div style={{
      width: 200, background: T.panel, borderRight: `1px solid ${T.border}`,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <div style={{
        padding: '8px 12px', borderBottom: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 10, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 1.5 }}>
          VFX Presets
        </span>
        <button onClick={() => addPreset()} style={{
          background: 'none', border: 'none', color: T.accent, cursor: 'pointer',
          fontSize: 16, lineHeight: 1, padding: '0 4px',
        }}>+</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {presets.map((p) => (
          <div key={p.id} onClick={() => selectPreset(p.id)} style={{
            padding: '6px 12px', cursor: 'pointer', fontSize: 12,
            color: selectedId === p.id ? T.text : T.textDim,
            background: selectedId === p.id ? T.surface : 'transparent',
            borderLeft: selectedId === p.id ? `3px solid ${T.accent}` : '3px solid transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
            <button onClick={(e) => { e.stopPropagation(); removePreset(p.id); }} style={{
              background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer',
              fontSize: 11, padding: '0 2px', opacity: 0.5,
            }}>&times;</button>
          </div>
        ))}
        {presets.length === 0 && (
          <div style={{ padding: 16, textAlign: 'center', color: T.textMuted, fontSize: 11 }}>
            No VFX presets.<br />Click + to create one.
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Timeline (center bottom)
// ═══════════════════════════════════════════════════════════════

function Timeline() {
  const preset = useVfxStore((s) => {
    const p = s.presets.find((p) => p.id === s.selectedPresetId);
    return p;
  });
  const selectedLayerId = useVfxStore((s) => s.selectedLayerId);
  const selectLayer = useVfxStore((s) => s.selectLayer);
  const playing = useVfxStore((s) => s.playing);
  const playbackTime = useVfxStore((s) => s.playbackTime);
  const play = useVfxStore((s) => s.play);
  const pause = useVfxStore((s) => s.pause);
  const stop = useVfxStore((s) => s.stop);
  const setPlaybackTime = useVfxStore((s) => s.setPlaybackTime);
  const addLayer = useVfxStore((s) => s.addLayer);
  const updateLayer = useVfxStore((s) => s.updateLayer);

  // Drag state for timeline layer bars
  const dragState = useRef<{
    layerId: string;
    mode: 'move' | 'resize-left' | 'resize-right';
    startX: number;
    originalStart: number;
    originalDuration: number;
  } | null>(null);
  const tracksRef = useRef<HTMLDivElement>(null);

  // Playback animation
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!playing || !preset) return;
    lastTimeRef.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - lastTimeRef.current) / 1000;
      lastTimeRef.current = now;
      const store = useVfxStore.getState();
      let next = store.playbackTime + dt;
      if (next > (preset?.duration ?? 3)) next = 0;
      store.setPlaybackTime(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, preset?.duration]);

  if (!preset) {
    return (
      <div style={{
        height: 180, background: T.panelAlt, borderTop: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: T.textMuted, fontSize: 12,
      }}>
        Select a VFX preset to edit its timeline
      </div>
    );
  }

  const dur = preset.duration;
  const antPct = (preset.phases.anticipation / dur) * 100;
  const impPct = ((preset.phases.impact - preset.phases.anticipation) / dur) * 100;
  const resPct = 100 - antPct - impPct;

  return (
    <div style={{
      height: 180, background: T.panelAlt, borderTop: `1px solid ${T.border}`,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Playback controls */}
      <div style={{
        height: 28, display: 'flex', alignItems: 'center', gap: 8,
        padding: '0 8px', borderBottom: `1px solid ${T.border}`, fontSize: 11,
      }}>
        <button onClick={playing ? pause : play} style={{
          background: playing ? T.danger : T.accent, border: 'none', borderRadius: 3,
          color: '#fff', padding: '2px 10px', cursor: 'pointer', fontSize: 11,
        }}>{playing ? '■ Pause' : '▶ Play'}</button>
        <button onClick={stop} style={{
          background: T.surface, border: `1px solid ${T.border}`, borderRadius: 3,
          color: T.textDim, padding: '2px 8px', cursor: 'pointer', fontSize: 11,
        }}>↺ Reset</button>
        <span style={{ color: T.textDim, fontFamily: 'monospace', fontSize: 12 }}>
          {playbackTime.toFixed(2)}s / {dur.toFixed(1)}s
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={() => addLayer(preset.id, 'emitter', 'New Emitter', 0, 1, 'custom')} style={{
          background: 'none', border: `1px solid ${T.layerEmitter}40`, borderRadius: 3,
          color: T.layerEmitter, padding: '2px 8px', cursor: 'pointer', fontSize: 10,
        }}>+ Emitter</button>
        <button onClick={() => addLayer(preset.id, 'animation', 'New Animation', 0, 1, 'custom')} style={{
          background: 'none', border: `1px solid ${T.layerAnimation}40`, borderRadius: 3,
          color: T.layerAnimation, padding: '2px 8px', cursor: 'pointer', fontSize: 10,
        }}>+ Anim</button>
        <button onClick={() => addLayer(preset.id, 'light', 'New Light', 0, 0.2, 'custom')} style={{
          background: 'none', border: `1px solid ${T.layerLight}40`, borderRadius: 3,
          color: T.layerLight, padding: '2px 8px', cursor: 'pointer', fontSize: 10,
        }}>+ Light</button>
      </div>

      {/* Scrubber bar — click to seek */}
      <div
        style={{ height: 12, background: T.bg, cursor: 'pointer', position: 'relative', borderBottom: `1px solid ${T.border}` }}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const t = ((e.clientX - rect.left) / rect.width) * dur;
          setPlaybackTime(Math.max(0, Math.min(dur, t)));
        }}
        onPointerDown={(e) => {
          e.preventDefault();
          const el = e.currentTarget;
          const rect = el.getBoundingClientRect();
          const move = (ev: PointerEvent) => {
            const t = ((ev.clientX - rect.left) / rect.width) * dur;
            setPlaybackTime(Math.max(0, Math.min(dur, t)));
          };
          const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
          move(e.nativeEvent);
        }}
      >
        {/* Phase colors in scrubber */}
        <div style={{ display: 'flex', height: '100%' }}>
          <div style={{ width: `${antPct}%`, background: `${T.phaseAnticipation}30` }} />
          <div style={{ width: `${impPct}%`, background: `${T.phaseImpact}30` }} />
          <div style={{ width: `${resPct}%`, background: `${T.phaseResidual}30` }} />
        </div>
        {/* Scrubber playhead */}
        <div style={{
          position: 'absolute', top: 0, bottom: 0, width: 2, background: '#fff',
          left: `${(playbackTime / dur) * 100}%`, pointerEvents: 'none',
        }} />
      </div>

      {/* Timeline area */}
      <div style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
        {/* Phase background — use 100% width, not fixed px */}
        <div style={{ display: 'flex', height: '100%', position: 'absolute', top: 0, left: 0, width: '100%', zIndex: 0 }}>
          <div style={{ width: `${antPct}%`, background: `${T.phaseAnticipation}08`, borderRight: `1px dashed ${T.phaseAnticipation}30` }} />
          <div style={{ width: `${impPct}%`, background: `${T.phaseImpact}08`, borderRight: `1px dashed ${T.phaseImpact}30` }} />
          <div style={{ width: `${resPct}%`, background: `${T.phaseResidual}08` }} />
        </div>

        {/* Phase labels */}
        <div style={{ display: 'flex', height: 16, position: 'relative', zIndex: 1 }}>
          <div style={{ width: `${antPct}%`, textAlign: 'center', fontSize: 8, color: T.phaseAnticipation, lineHeight: '16px', letterSpacing: 1, textTransform: 'uppercase' }}>
            Anticipation
          </div>
          <div style={{ width: `${impPct}%`, textAlign: 'center', fontSize: 8, color: T.phaseImpact, lineHeight: '16px', letterSpacing: 1, textTransform: 'uppercase' }}>
            Impact
          </div>
          <div style={{ width: `${resPct}%`, textAlign: 'center', fontSize: 8, color: T.phaseResidual, lineHeight: '16px', letterSpacing: 1, textTransform: 'uppercase' }}>
            Residual
          </div>
        </div>

        {/* Layer tracks with drag handles */}
        <div ref={tracksRef} style={{ position: 'relative', zIndex: 1, padding: '2px 0' }}>
          {preset.layers.map((layer) => {
            const left = (layer.start / dur) * 100;
            const width = (layer.duration / dur) * 100;
            const color = layerColor(layer.type);
            const selected = selectedLayerId === layer.id;
            const isDragging = dragState.current?.layerId === layer.id;
            return (
              <div key={layer.id} style={{ height: 22, position: 'relative', marginBottom: 2 }}>
                <div
                  onClick={() => selectLayer(layer.id)}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    const rect = e.currentTarget.getBoundingClientRect();
                    const relX = e.clientX - rect.left;
                    const barWidth = rect.width;
                    const edge = 8; // px zone for resize handles
                    let mode: 'move' | 'resize-left' | 'resize-right' = 'move';
                    if (relX < edge) mode = 'resize-left';
                    else if (relX > barWidth - edge) mode = 'resize-right';

                    dragState.current = {
                      layerId: layer.id,
                      mode,
                      startX: e.clientX,
                      originalStart: layer.start,
                      originalDuration: layer.duration,
                    };
                    selectLayer(layer.id);
                    (e.target as HTMLElement).setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    if (!dragState.current || dragState.current.layerId !== layer.id) {
                      // Cursor feedback for edges
                      const rect = e.currentTarget.getBoundingClientRect();
                      const relX = e.clientX - rect.left;
                      const barWidth = rect.width;
                      if (relX < 8 || relX > barWidth - 8) {
                        e.currentTarget.style.cursor = 'ew-resize';
                      } else {
                        e.currentTarget.style.cursor = 'grab';
                      }
                      return;
                    }
                    const ds = dragState.current;
                    const tracksEl = tracksRef.current;
                    if (!tracksEl) return;
                    const pxWidth = tracksEl.clientWidth;
                    const dxPx = e.clientX - ds.startX;
                    const dxSec = (dxPx / pxWidth) * dur;
                    const snap = (v: number) => Math.round(v / 0.05) * 0.05;

                    if (ds.mode === 'move') {
                      const newStart = snap(Math.max(0, ds.originalStart + dxSec));
                      updateLayer(preset.id, layer.id, { start: newStart });
                    } else if (ds.mode === 'resize-left') {
                      const newStart = snap(Math.max(0, Math.min(ds.originalStart + ds.originalDuration - 0.05, ds.originalStart + dxSec)));
                      const newDuration = snap(Math.max(0.05, ds.originalDuration - (newStart - ds.originalStart)));
                      updateLayer(preset.id, layer.id, { start: newStart, duration: newDuration });
                    } else if (ds.mode === 'resize-right') {
                      const newDuration = snap(Math.max(0.05, ds.originalDuration + dxSec));
                      updateLayer(preset.id, layer.id, { duration: newDuration });
                    }
                    e.currentTarget.style.cursor = ds.mode === 'move' ? 'grabbing' : 'ew-resize';
                  }}
                  onPointerUp={(e) => {
                    dragState.current = null;
                    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
                  }}
                  style={{
                    position: 'absolute', left: `${left}%`, width: `${width}%`,
                    height: 20, borderRadius: 3, cursor: 'grab',
                    background: `${color}${selected || isDragging ? '40' : '20'}`,
                    border: `1px solid ${color}${selected || isDragging ? 'cc' : '60'}`,
                    display: 'flex', alignItems: 'center', padding: '0 6px',
                    fontSize: 9, color: color, overflow: 'hidden', whiteSpace: 'nowrap',
                    boxShadow: selected ? `0 0 8px ${color}30` : 'none',
                    transition: isDragging ? 'none' : 'box-shadow 0.15s, border-color 0.15s',
                    userSelect: 'none',
                  }}
                >
                  <span style={{ opacity: 0.6, marginRight: 4 }}>
                    {layer.type === 'emitter' ? '✦' : layer.type === 'animation' ? '↻' : '☀'}
                  </span>
                  {layer.name}
                </div>
              </div>
            );
          })}
        </div>

        {/* Playhead */}
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: `${(playbackTime / dur) * 100}%`,
          width: 1, background: '#fff', zIndex: 10, opacity: 0.7,
          pointerEvents: 'none',
        }}>
          <div style={{
            position: 'absolute', top: 0, left: -4, width: 9, height: 8,
            background: '#fff', clipPath: 'polygon(0 0, 100% 0, 50% 100%)',
          }} />
        </div>

        {/* Time ruler ticks */}
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 0 }}>
          {Array.from({ length: Math.ceil(dur) + 1 }, (_, i) => (
            <div key={i} style={{
              position: 'absolute', left: `${(i / dur) * 100}%`, top: 0, bottom: 0,
              borderLeft: `1px solid ${T.border}`, opacity: 0.3,
            }}>
              <span style={{ position: 'absolute', bottom: 2, left: 3, fontSize: 8, color: T.textMuted }}>
                {i}s
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// App
// ═══════════════════════════════════════════════════════════════

export function App() {
  const [scenePoints, setScenePoints] = useState<PlyPoint[]>([]);

  const handleImportScene = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ply';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const points = await loadPly(file);
        setScenePoints(points);
        console.log(`Loaded ${points.length} points from ${file.name}`);
      } catch (e) {
        console.error('Failed to load PLY:', e);
      }
    };
    input.click();
  }, []);

  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;

      if (e.key === 's') {
        e.preventDefault();
        const store = useVfxStore.getState();
        if (hasFileSystemAccess()) {
          let handle = store.projectHandle;
          if (!handle) {
            handle = await openProjectDirectory();
            if (!handle) return;
            store.setProjectHandle(handle);
          }
          await saveProject(handle);
        } else {
          downloadProject();
        }
      } else if (e.key === 'o') {
        e.preventDefault();
        if (hasFileSystemAccess()) {
          const handle = await openProjectDirectory();
          if (!handle) return;
          const ok = await loadProject(handle);
          if (ok) useVfxStore.getState().setProjectHandle(handle);
        }
      } else if (e.key === 'z' && !e.shiftKey) {
        // Future: undo
      } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        // Future: redo
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: T.bg }}>
      <MenuBar onImportScene={handleImportScene} />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <VfxList />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <Preview scenePoints={scenePoints} />
          <Timeline />
        </div>
        <LayerProperties />
      </div>
    </div>
  );
}
