import { NumberInput } from '../../components/NumberInput.js';
import { Vec3Input } from '../../components/Vec3Input.js';
import { useSceneStore } from '../../store/useSceneStore.js';
import type { GsAnimationGroupData } from '../../store/types.js';
import { panelStyles } from '../../styles/panel.js';
import { parseEasing, composeEasing } from './utils.js';
import { EntityHeader } from './EntityHeader.js';

const styles = { ...panelStyles };

const effectOptions = ['detach', 'float', 'orbit', 'dissolve', 'reform', 'pulse', 'vortex', 'wave', 'scatter'];
const effectDescriptions: Record<string, string> = {
  detach: 'Scatter outward with gravity, fade opacity',
  float: 'Drift upward with horizontal noise, shrink',
  orbit: 'Swirl around region center',
  dissolve: 'Shrink to zero, fade opacity',
  reform: 'Restore to original position and color',
  pulse: 'Scale oscillates rhythmically (crystals, magic)',
  vortex: 'Spiral inward/upward, tightening radius (tornado)',
  wave: 'Sinusoidal ripple propagating from center (shockwave)',
  scatter: 'Explosive outward burst (impacts, shattering)',
};

const defaultAnimParams = {
  rotations: 1, rotations_easing: 'linear' as const,
  expansion: 1, expansion_easing: 'linear' as const,
  height_rise: 0, height_easing: 'linear' as const,
  opacity_end: 0, opacity_easing: 'linear' as const,
  scale_end: 0, scale_easing: 'linear' as const,
  velocity: 1, gravity: [0, -9.8, 0] as [number, number, number],
  noise: 1, wave_speed: 5, pulse_frequency: 4,
};

const easingTypes = ['linear', 'quad', 'cubic', 'quart', 'quint', 'sine', 'expo', 'circ', 'back', 'elastic', 'bounce'];
const easingDirs = ['in', 'out', 'in_out'];
const easingDirLabels: Record<string, string> = { in: 'In', out: 'Out', in_out: 'In Out' };

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
        <span style={{ fontSize: 11, minWidth: 60, color: '#aaa' }}>{label}</span>
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
              style={{ width: 62, padding: '2px 2px', background: '#2a2a4a', border: '1px solid #444', borderRadius: 4, color: '#999', fontSize: 10 }}
              value={easingParts.type}
              onChange={(e) => onEasingChange(composeEasing(e.target.value, easingParts.dir))}
            >
              {easingTypes.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
            </select>
            {easingParts.type !== 'linear' && (
              <select
                style={{ width: 46, padding: '2px 2px', background: '#2a2a4a', border: '1px solid #444', borderRadius: 4, color: '#999', fontSize: 10 }}
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

export function GsAnimationProperties({ anim }: { anim: GsAnimationGroupData }) {
  const update = useSceneStore((s) => s.updateGsAnimation);
  const remove = useSceneStore((s) => s.removeGsAnimation);

  // Ensure params exists (backward compat with old saved data)
  const params = anim.params ?? defaultAnimParams;

  return (
    <div>
      <EntityHeader label="Animation Group" onRemove={() => remove(anim.id)} />

      <div style={styles.section}>
        <span style={styles.label}>Effect</span>
        <select
          style={styles.select}
          value={anim.effect}
          onChange={(e) => update(anim.id, { effect: e.target.value })}
        >
          {effectOptions.map((e) => <option key={e} value={e}>{e.charAt(0).toUpperCase() + e.slice(1)}</option>)}
        </select>
        <span style={{ fontSize: 10, color: '#666', marginTop: 4 }}>
          {effectDescriptions[anim.effect] ?? ''}
        </span>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Region Shape</span>
        <select
          style={styles.select}
          value={anim.shape}
          onChange={(e) => update(anim.id, { shape: e.target.value })}
        >
          <option value="sphere">Sphere</option>
          <option value="box">Box</option>
        </select>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Center</span>
        <Vec3Input value={anim.center} onChange={(v) => update(anim.id, { center: v })} />
      </div>

      {anim.shape === 'sphere' && (
        <div style={styles.section}>
          <span style={styles.label}>Radius</span>
          <NumberInput value={anim.radius} min={0.1} step={0.5}
            onChange={(v) => update(anim.id, { radius: v })} style={styles.input} />
        </div>
      )}

      {anim.shape === 'box' && (
        <div style={styles.section}>
          <span style={styles.label}>Half Extents</span>
          <Vec3Input value={anim.half_extents} step={0.5}
            onChange={(v) => update(anim.id, { half_extents: v })} />
        </div>
      )}

      <div style={styles.section}>
        <span style={styles.label}>Lifetime (seconds)</span>
        <NumberInput value={anim.lifetime} min={0.1} step={0.5}
          onChange={(v) => update(anim.id, { lifetime: v })} style={styles.input} />
      </div>

      <div style={styles.section}>
        <label style={{ fontSize: 12, color: '#ddd', display: 'flex', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={anim.loop}
            onChange={(e) => update(anim.id, { loop: e.target.checked })}
            style={styles.checkbox}
          />
          Loop (restart when finished)
        </label>
      </div>

      <div style={styles.section}>
        <label style={{ fontSize: 12, color: '#ddd', display: 'flex', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={anim.reform_enabled}
            onChange={(e) => update(anim.id, { reform_enabled: e.target.checked })}
            style={styles.checkbox}
          />
          Reform after effect (restore to original)
        </label>
      </div>

      {anim.reform_enabled && (
        <>
          <div style={styles.section}>
            <span style={styles.label}>Reform Lifetime</span>
            <NumberInput value={anim.reform_lifetime} min={0.1} step={0.5}
              onChange={(v) => update(anim.id, { reform_lifetime: v })} style={styles.input} />
          </div>
        </>
      )}

      <div style={{ marginTop: 8, marginBottom: 4 }}>
        <span style={styles.label}>Parameters</span>
      </div>

      <ParamRow label="Rotations" value={params.rotations} min={0} step={0.5}
        onChange={(v) => update(anim.id, { params: { ...params, rotations: v } })}
        easing={params.rotations_easing}
        onEasingChange={(v) => update(anim.id, { params: { ...params, rotations_easing: v as any } })} />
      <ParamRow label="Expansion" value={params.expansion} min={0} step={0.1}
        onChange={(v) => update(anim.id, { params: { ...params, expansion: v } })}
        easing={params.expansion_easing}
        onEasingChange={(v) => update(anim.id, { params: { ...params, expansion_easing: v as any } })}
        hint="1=none 2=double" />
      <ParamRow label="Height" value={params.height_rise} step={0.5}
        onChange={(v) => update(anim.id, { params: { ...params, height_rise: v } })}
        easing={params.height_easing}
        onEasingChange={(v) => update(anim.id, { params: { ...params, height_easing: v as any } })}
        hint="Y offset (units)" />
      <ParamRow label="Opacity" value={params.opacity_end} min={0} max={1} step={0.05}
        onChange={(v) => update(anim.id, { params: { ...params, opacity_end: v } })}
        easing={params.opacity_easing}
        onEasingChange={(v) => update(anim.id, { params: { ...params, opacity_easing: v as any } })}
        hint="0=gone 1=keep" />
      <ParamRow label="Scale" value={params.scale_end} min={0} max={1} step={0.05}
        onChange={(v) => update(anim.id, { params: { ...params, scale_end: v } })}
        easing={params.scale_easing}
        onEasingChange={(v) => update(anim.id, { params: { ...params, scale_easing: v as any } })}
        hint="0=vanish 1=keep" />
      <ParamRow label="Velocity" value={params.velocity} min={0} step={0.1}
        onChange={(v) => update(anim.id, { params: { ...params, velocity: v } })} />
      <ParamRow label="Noise" value={params.noise} min={0} step={0.1}
        onChange={(v) => update(anim.id, { params: { ...params, noise: v } })} />
      <ParamRow label="Wave Spd" value={params.wave_speed} min={0} step={0.5}
        onChange={(v) => update(anim.id, { params: { ...params, wave_speed: v } })} />
      <ParamRow label="Pulse Hz" value={params.pulse_frequency} min={0.1} step={0.5}
        onChange={(v) => update(anim.id, { params: { ...params, pulse_frequency: v } })} />

      <div style={{ marginTop: 4, marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: '#555' }}>Gravity</span>
      </div>
      <Vec3Input value={params.gravity}
        onChange={(v) => update(anim.id, { params: { ...params, gravity: v } })} />
    </div>
  );
}
