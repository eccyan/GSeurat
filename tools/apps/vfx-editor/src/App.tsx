import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useVfxStore } from './store/useVfxStore.js';
import type { VfxPreset, VfxLayer, LayerType, Phase } from './store/types.js';

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

function MenuBar() {
  const addPreset = useVfxStore((s) => s.addPreset);
  const [fileOpen, setFileOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
              { label: 'Open...', action: () => setFileOpen(false) },
              { label: 'Save', action: () => setFileOpen(false) },
              { label: 'Import Scene...', action: () => setFileOpen(false) },
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
// Viewport (center top)
// ═══════════════════════════════════════════════════════════════

function Viewport() {
  return (
    <div style={{
      flex: 1, background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative', borderBottom: `1px solid ${T.border}`,
    }}>
      <div style={{
        color: T.textMuted, fontSize: 13, textAlign: 'center', userSelect: 'none',
      }}>
        <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.3 }}>&#9670;</div>
        3D Preview<br />
        <span style={{ fontSize: 10, opacity: 0.5 }}>Import a PLY or Bricklayer file to preview effects</span>
      </div>
      {/* Phase indicator overlay */}
      <div style={{
        position: 'absolute', top: 8, left: 8, display: 'flex', gap: 8, fontSize: 9,
        color: T.textMuted, letterSpacing: 0.5,
      }}>
        <span>&#9679; <span style={{ color: T.phaseAnticipation }}>Anticipation</span></span>
        <span>&#9679; <span style={{ color: T.phaseImpact }}>Impact</span></span>
        <span>&#9679; <span style={{ color: T.phaseResidual }}>Residual</span></span>
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
  const pxPerSec = 120;
  const totalWidth = dur * pxPerSec;
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

      {/* Timeline area */}
      <div style={{ flex: 1, overflowX: 'auto', overflowY: 'auto', position: 'relative' }}>
        {/* Phase background */}
        <div style={{ display: 'flex', height: '100%', position: 'absolute', top: 0, left: 0, width: totalWidth, zIndex: 0 }}>
          <div style={{ width: `${antPct}%`, background: `${T.phaseAnticipation}08`, borderRight: `1px dashed ${T.phaseAnticipation}30` }} />
          <div style={{ width: `${impPct}%`, background: `${T.phaseImpact}08`, borderRight: `1px dashed ${T.phaseImpact}30` }} />
          <div style={{ width: `${resPct}%`, background: `${T.phaseResidual}08` }} />
        </div>

        {/* Phase labels */}
        <div style={{ display: 'flex', height: 16, position: 'relative', zIndex: 1, width: totalWidth }}>
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

        {/* Layer tracks */}
        <div style={{ position: 'relative', zIndex: 1, padding: '2px 0', width: totalWidth }}>
          {preset.layers.map((layer) => {
            const left = (layer.start / dur) * 100;
            const width = (layer.duration / dur) * 100;
            const color = layerColor(layer.type);
            const selected = selectedLayerId === layer.id;
            return (
              <div key={layer.id} style={{ height: 22, position: 'relative', marginBottom: 2 }}>
                <div
                  onClick={() => selectLayer(layer.id)}
                  style={{
                    position: 'absolute', left: `${left}%`, width: `${width}%`,
                    height: 20, borderRadius: 3, cursor: 'pointer',
                    background: `${color}${selected ? '40' : '20'}`,
                    border: `1px solid ${color}${selected ? 'cc' : '60'}`,
                    display: 'flex', alignItems: 'center', padding: '0 6px',
                    fontSize: 9, color: color, overflow: 'hidden', whiteSpace: 'nowrap',
                    boxShadow: selected ? `0 0 8px ${color}30` : 'none',
                    transition: 'box-shadow 0.15s, border-color 0.15s',
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
        <div style={{ position: 'absolute', top: 0, left: 0, width: totalWidth, height: '100%', pointerEvents: 'none', zIndex: 0 }}>
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
// LayerProperties (right panel)
// ═══════════════════════════════════════════════════════════════

function LayerProperties() {
  const preset = useVfxStore((s) => s.presets.find((p) => p.id === s.selectedPresetId));
  const layer = useVfxStore((s) => {
    const p = s.presets.find((p) => p.id === s.selectedPresetId);
    return p?.layers.find((l) => l.id === s.selectedLayerId);
  });
  const updateLayer = useVfxStore((s) => s.updateLayer);
  const removeLayer = useVfxStore((s) => s.removeLayer);

  if (!preset || !layer) {
    return (
      <div style={{
        width: 280, background: T.panel, borderLeft: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: T.textMuted, fontSize: 12, textAlign: 'center', padding: 24,
      }}>
        Select a layer in the timeline to edit its properties
      </div>
    );
  }

  const update = (patch: Partial<VfxLayer>) => updateLayer(preset.id, layer.id, patch);
  const color = layerColor(layer.type);

  return (
    <div style={{
      width: 280, background: T.panel, borderLeft: `1px solid ${T.border}`,
      overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: color }} />
          <span style={{ fontSize: 11, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 1 }}>
            Layer
          </span>
        </div>
        <button onClick={() => removeLayer(preset.id, layer.id)} style={{
          background: '#4a2020', border: '1px solid #c33', borderRadius: 3,
          color: '#faa', cursor: 'pointer', fontSize: 10, padding: '2px 8px',
        }}>Remove</button>
      </div>

      {/* Name */}
      <div>
        <label style={{ fontSize: 10, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 4 }}>Name</label>
        <input type="text" value={layer.name} onChange={(e) => update({ name: e.target.value })} style={input} />
      </div>

      {/* Type */}
      <div>
        <label style={{ fontSize: 10, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 4 }}>Type</label>
        <select value={layer.type} onChange={(e) => update({ type: e.target.value as LayerType })} style={selectStyle}>
          <option value="emitter">Emitter</option>
          <option value="animation">Animation</option>
          <option value="light">Light</option>
        </select>
      </div>

      {/* Phase */}
      <div>
        <label style={{ fontSize: 10, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 4 }}>Phase</label>
        <select value={layer.phase} onChange={(e) => update({ phase: e.target.value as Phase })} style={selectStyle}>
          <option value="anticipation">Anticipation</option>
          <option value="impact">Impact</option>
          <option value="residual">Residual</option>
          <option value="custom">Custom</option>
        </select>
        <div style={{ marginTop: 2, fontSize: 9, color: phaseColor(layer.phase) }}>
          {layer.phase === 'anticipation' ? 'Buildup — signals something is coming'
            : layer.phase === 'impact' ? 'Peak energy — the main event'
            : layer.phase === 'residual' ? 'Dissipation and aftermath'
            : 'Manual timing'}
        </div>
      </div>

      {/* Timing */}
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 10, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 4 }}>Start (s)</label>
          <input type="number" value={layer.start} step={0.1} min={0}
            onChange={(e) => update({ start: parseFloat(e.target.value) || 0 })} style={input} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 10, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 4 }}>Duration (s)</label>
          <input type="number" value={layer.duration} step={0.1} min={0.01}
            onChange={(e) => update({ duration: parseFloat(e.target.value) || 0.1 })} style={input} />
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>
        <span style={{ fontSize: 10, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 1 }}>
          {layer.type === 'emitter' ? 'Emitter Config' : layer.type === 'animation' ? 'Animation Config' : 'Light Config'}
        </span>
      </div>

      {/* Type-specific config placeholder */}
      {layer.type === 'emitter' && (
        <div>
          <label style={{ fontSize: 10, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 4 }}>Preset</label>
          <select
            value={(layer.emitter as Record<string, unknown>)?.preset as string ?? ''}
            onChange={(e) => update({ emitter: { ...layer.emitter, preset: e.target.value } })}
            style={selectStyle}
          >
            <option value="">Custom</option>
            {['dust_puff', 'spark_shower', 'magic_spiral', 'fire', 'smoke', 'rain', 'snow', 'leaves', 'fireflies', 'steam', 'waterfall_mist'].map((p) => (
              <option key={p} value={p}>{p.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</option>
            ))}
          </select>
        </div>
      )}

      {layer.type === 'animation' && (
        <div>
          <label style={{ fontSize: 10, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 4 }}>Effect</label>
          <select
            value={(layer.animation as Record<string, unknown>)?.effect as string ?? 'detach'}
            onChange={(e) => update({ animation: { ...layer.animation, effect: e.target.value } })}
            style={selectStyle}
          >
            {['detach', 'float', 'orbit', 'dissolve', 'reform', 'pulse', 'vortex', 'wave', 'scatter'].map((e) => (
              <option key={e} value={e}>{e.charAt(0).toUpperCase() + e.slice(1)}</option>
            ))}
          </select>
        </div>
      )}

      {layer.type === 'light' && (
        <>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 10, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 4 }}>Color</label>
              <input type="color"
                value={layer.light ? `#${layer.light.color.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}` : '#ffffff'}
                onChange={(e) => {
                  const hex = e.target.value;
                  update({ light: { ...(layer.light ?? { color: [1, 1, 1], intensity: 10, radius: 50 }), color: [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255] } });
                }}
                style={{ width: '100%', height: 28, border: 'none', borderRadius: 4, cursor: 'pointer' }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 10, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 4 }}>Intensity</label>
              <input type="number" value={layer.light?.intensity ?? 10} step={1} min={0}
                onChange={(e) => update({ light: { ...(layer.light ?? { color: [1, 1, 1], intensity: 10, radius: 50 }), intensity: parseFloat(e.target.value) || 0 } })}
                style={input} />
            </div>
          </div>
          <div>
            <label style={{ fontSize: 10, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 4 }}>Radius</label>
            <input type="number" value={layer.light?.radius ?? 50} step={5} min={0}
              onChange={(e) => update({ light: { ...(layer.light ?? { color: [1, 1, 1], intensity: 10, radius: 50 }), radius: parseFloat(e.target.value) || 0 } })}
              style={input} />
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// App
// ═══════════════════════════════════════════════════════════════

export function App() {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: T.bg }}>
      <MenuBar />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <VfxList />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <Viewport />
          <Timeline />
        </div>
        <LayerProperties />
      </div>
    </div>
  );
}
