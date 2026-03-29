import React from 'react';
import { useVfxStore } from '../store/useVfxStore.js';
import type { VfxElement, ElementType } from '../store/types.js';
type VfxLayer = VfxElement;
type LayerType = ElementType;
import { NumberInput } from '../components/NumberInput.js';
import { Vec3Input } from '../components/Vec3Input.js';
import { emitterPresets, defaultEmitterConfig } from '../data/emitterPresets.js';
import type { EmitterConfig } from '../data/emitterPresets.js';
import { T, inputStyle, selectStyle, sectionLabel, layerColor } from '../styles/theme.js';

// ── Easing helpers ──

const easingTypes = ['linear', 'quad', 'cubic', 'quart', 'quint', 'sine', 'expo', 'circ', 'back', 'elastic', 'bounce'];
const easingDirs = ['in', 'out', 'in_out'];
const easingDirLabels: Record<string, string> = { in: 'In', out: 'Out', in_out: 'In Out' };

function parseEasing(value: string): { type: string; dir: string } {
  if (value === 'linear') return { type: 'linear', dir: 'in' };
  for (const dir of ['in_out', 'out', 'in']) {
    if (value.startsWith(dir + '_')) return { type: value.slice(dir.length + 1), dir };
  }
  return { type: 'linear', dir: 'in' };
}

function composeEasing(type: string, dir: string): string {
  if (type === 'linear') return 'linear';
  return `${dir}_${type}`;
}

// ── Shared sub-components ──

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>
      <span style={{ fontSize: 10, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 1 }}>
        {children}
      </span>
    </div>
  );
}

function ColorPicker({ label, value, onChange }: {
  label: string;
  value: [number, number, number];
  onChange: (v: [number, number, number]) => void;
}) {
  const hex = '#' + value.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
  return (
    <div style={{ flex: 1 }}>
      <label style={sectionLabel}>{label}</label>
      <input type="color" value={hex}
        onChange={(e) => {
          const h = e.target.value;
          onChange([parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]);
        }}
        style={{ width: '100%', height: 28, border: 'none', borderRadius: 4, cursor: 'pointer' }}
      />
    </div>
  );
}

function ParamRow({ label, value, onChange, min, max, step, easing, onEasingChange, hint }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  easing?: string;
  onEasingChange?: (v: string) => void;
  hint?: string;
}) {
  const easingParts = easing ? parseEasing(easing) : null;
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: 11, minWidth: 60, color: T.textDim }}>{label}</span>
        {hint && (
          <span style={{
            position: 'relative', fontSize: 9, color: '#666', cursor: 'help', width: 12, height: 12,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid #555', borderRadius: '50%', flexShrink: 0,
          }}
            onMouseEnter={(e) => {
              const tip = e.currentTarget.querySelector('[data-tip]') as HTMLElement;
              if (tip) tip.style.display = 'block';
            }}
            onMouseLeave={(e) => {
              const tip = e.currentTarget.querySelector('[data-tip]') as HTMLElement;
              if (tip) tip.style.display = 'none';
            }}
          >
            ?
            <span data-tip="" style={{
              display: 'none', position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
              marginBottom: 4, padding: '4px 8px', background: '#111', color: '#ccc', fontSize: 10,
              borderRadius: 4, whiteSpace: 'nowrap', zIndex: 100, boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
              pointerEvents: 'none',
            }}>{hint}</span>
          </span>
        )}
        <NumberInput value={value} min={min} max={max} step={step ?? 0.1}
          onChange={onChange} style={{ flex: 1, maxWidth: 80, padding: '3px 5px', fontSize: 12 }} />
        {easingParts && onEasingChange && (
          <>
            <select
              style={{ width: 62, padding: '2px 2px', background: T.surface, border: `1px solid ${T.border}`, borderRadius: 4, color: T.textDim, fontSize: 10 }}
              value={easingParts.type}
              onChange={(e) => onEasingChange(composeEasing(e.target.value, easingParts.dir))}
            >
              {easingTypes.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
            </select>
            {easingParts.type !== 'linear' && (
              <select
                style={{ width: 46, padding: '2px 2px', background: T.surface, border: `1px solid ${T.border}`, borderRadius: 4, color: T.textDim, fontSize: 10 }}
                value={easingParts.dir}
                onChange={(e) => onEasingChange(composeEasing(easingParts.type, e.target.value))}
              >
                {easingDirs.map((d) => <option key={d} value={d}>{easingDirLabels[d]}</option>)}
              </select>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Effect descriptions ──

const effectDescriptions: Record<string, string> = {
  detach: 'Gaussians break apart from their original positions',
  float: 'Gaussians gently float upward with slight drift',
  orbit: 'Gaussians orbit around the center point',
  dissolve: 'Gaussians fade and shrink, dissolving into nothing',
  reform: 'Scattered Gaussians recombine into original shape',
  pulse: 'Gaussians rhythmically expand and contract',
  vortex: 'Gaussians spiral inward or outward in a vortex',
  wave: 'Sinusoidal wave displaces Gaussians over time',
  scatter: 'Gaussians scatter outward from the center explosively',
};

// ── Emitter config editor ──

function EmitterEditor({ layer, update }: {
  layer: VfxLayer;
  update: (patch: Partial<VfxLayer>) => void;
}) {
  const raw = (layer.emitter ?? {}) as Record<string, unknown>;
  const cfg: EmitterConfig = { ...defaultEmitterConfig, ...raw };

  const set = (patch: Partial<EmitterConfig>) => {
    update({ emitter: { ...cfg, ...patch } });
  };

  const applyPreset = (presetName: string) => {
    if (presetName === '') {
      set({ preset: '' });
      return;
    }
    const p = emitterPresets[presetName];
    if (p) {
      update({ emitter: { ...defaultEmitterConfig, ...p, preset: presetName } });
    }
  };

  return (
    <>
      <div>
        <label style={sectionLabel}>Preset</label>
        <select value={cfg.preset ?? ''} onChange={(e) => applyPreset(e.target.value)} style={selectStyle}>
          <option value="">Custom</option>
          {Object.keys(emitterPresets).map((p) => (
            <option key={p} value={p}>{p.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={sectionLabel}>Spawn Rate</label>
          <NumberInput value={cfg.spawn_rate} min={0} step={5}
            onChange={(v) => set({ spawn_rate: v })} style={{ ...inputStyle, width: 'auto' }} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={sectionLabel}>Emission</label>
          <NumberInput value={cfg.emission} min={0} step={0.1}
            onChange={(v) => set({ emission: v })} style={{ ...inputStyle, width: 'auto' }} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={sectionLabel}>Lifetime Min</label>
          <NumberInput value={cfg.lifetime_min} min={0} step={0.1}
            onChange={(v) => set({ lifetime_min: v })} style={{ ...inputStyle, width: 'auto' }} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={sectionLabel}>Lifetime Max</label>
          <NumberInput value={cfg.lifetime_max} min={0} step={0.1}
            onChange={(v) => set({ lifetime_max: v })} style={{ ...inputStyle, width: 'auto' }} />
        </div>
      </div>

      <div>
        <label style={sectionLabel}>Velocity Min</label>
        <Vec3Input value={cfg.velocity_min} step={0.5}
          onChange={(v) => set({ velocity_min: v })} />
      </div>
      <div>
        <label style={sectionLabel}>Velocity Max</label>
        <Vec3Input value={cfg.velocity_max} step={0.5}
          onChange={(v) => set({ velocity_max: v })} />
      </div>

      <div>
        <label style={sectionLabel}>Acceleration</label>
        <Vec3Input value={cfg.acceleration} step={0.5}
          onChange={(v) => set({ acceleration: v })} />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <ColorPicker label="Color Start" value={cfg.color_start}
          onChange={(v) => set({ color_start: v })} />
        <ColorPicker label="Color End" value={cfg.color_end}
          onChange={(v) => set({ color_end: v })} />
      </div>

      <div>
        <label style={sectionLabel}>Scale Min</label>
        <Vec3Input value={cfg.scale_min} step={0.05}
          onChange={(v) => set({ scale_min: v })} />
      </div>
      <div>
        <label style={sectionLabel}>Scale Max</label>
        <Vec3Input value={cfg.scale_max} step={0.05}
          onChange={(v) => set({ scale_max: v })} />
      </div>

      <div>
        <label style={sectionLabel}>Scale End Factor</label>
        <NumberInput value={cfg.scale_end_factor} min={0} step={0.1}
          onChange={(v) => set({ scale_end_factor: v })} style={{ ...inputStyle, width: 'auto' }} />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={sectionLabel}>Opacity Start</label>
          <NumberInput value={cfg.opacity_start} min={0} max={1} step={0.05}
            onChange={(v) => set({ opacity_start: v })} style={{ ...inputStyle, width: 'auto' }} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={sectionLabel}>Opacity End</label>
          <NumberInput value={cfg.opacity_end} min={0} max={1} step={0.05}
            onChange={(v) => set({ opacity_end: v })} style={{ ...inputStyle, width: 'auto' }} />
        </div>
      </div>

      {/* Spawn Region */}
      <SectionHeader>Spawn Region</SectionHeader>
      <div>
        <label style={sectionLabel}>Shape</label>
        <select value={cfg.region?.shape ?? 'box'}
          onChange={(e) => set({ region: { ...cfg.region, shape: e.target.value as 'sphere' | 'box' } })}
          style={selectStyle}>
          <option value="box">Box</option>
          <option value="sphere">Sphere</option>
        </select>
      </div>
      {(cfg.region?.shape ?? 'box') === 'sphere' ? (
        <div>
          <label style={sectionLabel}>Radius</label>
          <NumberInput value={cfg.region?.radius ?? 1} min={0} step={0.5}
            onChange={(v) => set({ region: { ...cfg.region, shape: 'sphere', radius: v } })}
            style={{ ...inputStyle, width: 'auto' }} />
        </div>
      ) : (
        <>
          <div>
            <label style={sectionLabel}>Half Extents</label>
            <Vec3Input value={cfg.region?.half_extents ?? [1, 1, 1]} step={0.5}
              onChange={(v) => set({ region: { ...cfg.region, shape: 'box', half_extents: v } })} />
          </div>
          <div>
            <label style={sectionLabel}>Center Offset</label>
            <Vec3Input value={cfg.region?.center ?? [0, 0, 0]} step={0.5}
              onChange={(v) => set({ region: { ...cfg.region, shape: 'box', center: v } })} />
          </div>
        </>
      )}

      <div>
        <label style={sectionLabel}>Burst Duration</label>
        <NumberInput value={cfg.burst_duration} min={0} step={0.1}
          onChange={(v) => set({ burst_duration: v })} style={{ ...inputStyle, width: 'auto' }} />
      </div>
    </>
  );
}

// ── Animation config editor ──

interface AnimParams {
  rotations: number;
  rotations_easing: string;
  expansion: number;
  expansion_easing: string;
  height_rise: number;
  height_easing: string;
  opacity_end: number;
  opacity_easing: string;
  scale_end: number;
  scale_easing: string;
  velocity: number;
  gravity: [number, number, number];
  noise: number;
  wave_speed: number;
  pulse_frequency: number;
}

const defaultAnimParams: AnimParams = {
  rotations: 1, rotations_easing: 'linear',
  expansion: 1, expansion_easing: 'linear',
  height_rise: 0, height_easing: 'linear',
  opacity_end: 0.2, opacity_easing: 'linear',
  scale_end: 0.5, scale_easing: 'linear',
  velocity: 1,
  gravity: [0, -9.8, 0],
  noise: 1,
  wave_speed: 5,
  pulse_frequency: 10,
};

function AnimationEditor({ layer, update }: {
  layer: VfxLayer;
  update: (patch: Partial<VfxLayer>) => void;
}) {
  const raw = (layer.animation ?? {}) as Record<string, unknown>;
  const effect = (raw.effect as string) ?? 'detach';
  const reformEnabled = (raw.reform_enabled as boolean) ?? false;
  const reformLifetime = (raw.reform_lifetime as number) ?? 1;
  const params: AnimParams = { ...defaultAnimParams, ...(raw.params as Partial<AnimParams> | undefined) };

  const setAnim = (patch: Record<string, unknown>) => {
    update({ animation: { ...raw, ...patch } });
  };

  const setParams = (patch: Partial<AnimParams>) => {
    setAnim({ params: { ...params, ...patch } });
  };

  return (
    <>
      <div>
        <label style={sectionLabel}>Effect</label>
        <select value={effect} onChange={(e) => setAnim({ effect: e.target.value })} style={selectStyle}>
          {Object.keys(effectDescriptions).map((e) => (
            <option key={e} value={e}>{e.charAt(0).toUpperCase() + e.slice(1)}</option>
          ))}
        </select>
        <div style={{ marginTop: 4, fontSize: 10, color: T.textDim, lineHeight: 1.4 }}>
          {effectDescriptions[effect] ?? ''}
        </div>
      </div>

      <SectionHeader>Parameters</SectionHeader>

      {/* Only show params relevant to the selected effect */}
      {['orbit', 'vortex'].includes(effect) && (
        <ParamRow label="Rotations" value={params.rotations} min={0} step={0.5}
          onChange={(v) => setParams({ rotations: v })}
          easing={params.rotations_easing}
          onEasingChange={(v) => setParams({ rotations_easing: v })} />
      )}
      {['orbit', 'vortex'].includes(effect) && (
        <ParamRow label="Expansion" value={params.expansion} min={0} step={0.1}
          onChange={(v) => setParams({ expansion: v })}
          easing={params.expansion_easing}
          onEasingChange={(v) => setParams({ expansion_easing: v })}
          hint="1=none 2=double" />
      )}
      {['orbit', 'vortex'].includes(effect) && (
        <ParamRow label="Height" value={params.height_rise} step={0.5}
          onChange={(v) => setParams({ height_rise: v })}
          easing={params.height_easing}
          onEasingChange={(v) => setParams({ height_easing: v })}
          hint="Y offset (units)" />
      )}
      {['detach', 'float', 'orbit', 'dissolve', 'pulse', 'vortex', 'scatter'].includes(effect) && (
        <ParamRow label="Opacity" value={params.opacity_end} min={0} max={1} step={0.05}
          onChange={(v) => setParams({ opacity_end: v })}
          easing={params.opacity_easing}
          onEasingChange={(v) => setParams({ opacity_easing: v })}
          hint="0=gone 1=keep" />
      )}
      {['detach', 'float', 'dissolve', 'pulse', 'vortex', 'scatter'].includes(effect) && (
        <ParamRow label="Scale" value={params.scale_end} min={0} max={1} step={0.05}
          onChange={(v) => setParams({ scale_end: v })}
          easing={params.scale_easing}
          onEasingChange={(v) => setParams({ scale_easing: v })}
          hint="0=vanish 1=keep" />
      )}
      {['detach', 'float', 'reform', 'scatter'].includes(effect) && (
        <ParamRow label="Velocity" value={params.velocity} min={0} step={0.1}
          onChange={(v) => setParams({ velocity: v })} />
      )}
      {['float', 'dissolve', 'wave'].includes(effect) && (
        <ParamRow label="Noise" value={params.noise} min={0} step={0.1}
          onChange={(v) => setParams({ noise: v })} />
      )}
      {effect === 'wave' && (
        <ParamRow label="Wave Spd" value={params.wave_speed} min={0} step={0.5}
          onChange={(v) => setParams({ wave_speed: v })} />
      )}
      {effect === 'pulse' && (
        <ParamRow label="Pulse Hz" value={params.pulse_frequency} min={0.1} step={0.5}
          onChange={(v) => setParams({ pulse_frequency: v })} />
      )}
      {['detach', 'scatter'].includes(effect) && (
        <>
          <div style={{ marginTop: 4, marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: '#555' }}>Gravity</span>
          </div>
          <Vec3Input value={params.gravity} step={0.5}
            onChange={(v) => setParams({ gravity: v })} />
        </>
      )}

      <SectionHeader>Reform</SectionHeader>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" checked={reformEnabled}
          onChange={(e) => setAnim({ reform_enabled: e.target.checked })}
          style={{ marginRight: 4 }} />
        <span style={{ fontSize: 12, color: T.text }}>Enable reform</span>
      </div>
      {reformEnabled && (
        <div>
          <label style={sectionLabel}>Reform Lifetime</label>
          <NumberInput value={reformLifetime} min={0.1} step={0.1}
            onChange={(v) => setAnim({ reform_lifetime: v })} style={{ ...inputStyle, width: 'auto' }} />
        </div>
      )}
    </>
  );
}

// ── Light config editor ──

function LightEditor({ layer, update }: {
  layer: VfxLayer;
  update: (patch: Partial<VfxLayer>) => void;
}) {
  const light = layer.light ?? { color: [1, 1, 1] as [number, number, number], intensity: 10, radius: 50 };

  const setLight = (patch: Partial<typeof light>) => {
    update({ light: { ...light, ...patch } });
  };

  return (
    <>
      <div style={{ display: 'flex', gap: 8 }}>
        <ColorPicker label="Color" value={light.color}
          onChange={(v) => setLight({ color: v })} />
        <div style={{ flex: 1 }}>
          <label style={sectionLabel}>Intensity</label>
          <NumberInput value={light.intensity} min={0} step={1}
            onChange={(v) => setLight({ intensity: v })} style={{ ...inputStyle, width: 'auto' }} />
        </div>
      </div>
      <div>
        <label style={sectionLabel}>Radius</label>
        <NumberInput value={light.radius} min={0} step={5}
          onChange={(v) => setLight({ radius: v })} style={{ ...inputStyle, width: 'auto' }} />
      </div>
    </>
  );
}

// ── Main LayerProperties component ──

export function LayerProperties() {
  const preset = useVfxStore((s) => s.presets.find((p) => p.id === s.selectedPresetId));
  const layer = useVfxStore((s) => {
    const p = s.presets.find((p) => p.id === s.selectedPresetId);
    return p?.elements.find((l) => l.id === s.selectedLayerId);
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
        <label style={sectionLabel}>Name</label>
        <input type="text" value={layer.name} onChange={(e) => update({ name: e.target.value })} style={inputStyle} />
      </div>

      {/* Type */}
      <div>
        <label style={sectionLabel}>Type</label>
        <select value={layer.type} onChange={(e) => update({ type: e.target.value as LayerType })} style={selectStyle}>
          <option value="object">Object (PLY)</option>
          <option value="emitter">Emitter</option>
          <option value="animation">Animation</option>
          <option value="light">Light</option>
        </select>
      </div>

      {/* Position (relative to prefab origin) */}
      <div>
        <label style={sectionLabel}>Position</label>
        <Vec3Input value={layer.position ?? [0, 0, 0]}
          onChange={(v) => update({ position: v })} step={0.5} />
      </div>

      {/* Timing (not for object type) */}
      {layer.type !== 'object' && (
        <>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={sectionLabel}>Start (s)</label>
              <NumberInput value={layer.start ?? 0} min={0} step={0.1}
                onChange={(v) => update({ start: v })} style={{ ...inputStyle, width: 'auto' }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={sectionLabel}>Duration (s)</label>
              <NumberInput value={layer.duration ?? 1} min={0.01} step={0.1}
                onChange={(v) => update({ duration: v })} style={{ ...inputStyle, width: 'auto' }} />
            </div>
          </div>

          {/* Loop */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={sectionLabel}>Loop</label>
            <input type="checkbox" checked={layer.loop ?? false}
              onChange={(e) => update({ loop: e.target.checked })} />
            <span style={{ fontSize: 9, color: T.textMuted }}>
              {layer.loop ? 'Repeats continuously' : 'Plays once'}
            </span>
          </div>
        </>
      )}

      {/* Type-specific config */}
      {layer.type !== 'object' && (
        <SectionHeader>
          {layer.type === 'emitter' ? 'Emitter Config' : layer.type === 'animation' ? 'Animation Config' : 'Light Config'}
        </SectionHeader>
      )}

      {/* Object editor */}
      {layer.type === 'object' && (
        <>
          <SectionHeader>Object Config</SectionHeader>
          <div>
            <label style={sectionLabel}>PLY File</label>
            <input type="text" value={layer.ply_file ?? ''}
              onChange={(e) => update({ ply_file: e.target.value })}
              placeholder="path/to/model.ply" style={inputStyle} />
          </div>
          <div>
            <label style={sectionLabel}>Scale</label>
            <NumberInput value={layer.scale ?? 1} min={0.01} step={0.1}
              onChange={(v) => update({ scale: v })} style={{ ...inputStyle, width: 'auto' }} />
          </div>
        </>
      )}

      {/* Type-specific config editors */}
      {layer.type === 'emitter' && <EmitterEditor layer={layer} update={update} />}
      {layer.type === 'animation' && (
        <>
          <AnimationEditor layer={layer} update={update} />
          <SectionHeader>Region</SectionHeader>
          <div>
            <label style={sectionLabel}>Shape</label>
            <select value={layer.region?.shape ?? 'sphere'}
              onChange={(e) => update({ region: { ...layer.region, shape: e.target.value, radius: layer.region?.radius ?? 5 } })}
              style={selectStyle}>
              <option value="sphere">Sphere</option>
              <option value="box">Box</option>
            </select>
          </div>
          {(layer.region?.shape ?? 'sphere') === 'sphere' && (
            <div>
              <label style={sectionLabel}>Radius</label>
              <NumberInput value={layer.region?.radius ?? 5} min={0.1} step={0.5}
                onChange={(v) => update({ region: { ...layer.region, shape: 'sphere', radius: v } })}
                style={{ ...inputStyle, width: 'auto' }} />
            </div>
          )}
          {layer.region?.shape === 'box' && (
            <div>
              <label style={sectionLabel}>Half Extents</label>
              <Vec3Input value={layer.region?.half_extents ?? [2, 2, 2]}
                onChange={(v) => update({ region: { ...layer.region, shape: 'box', half_extents: v } })}
                step={0.5} />
            </div>
          )}
        </>
      )}
      {layer.type === 'light' && <LightEditor layer={layer} update={update} />}
    </div>
  );
}
