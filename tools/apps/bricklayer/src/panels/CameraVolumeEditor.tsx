import React from 'react';
import { NumberInput } from '../components/NumberInput.js';
import { Vec3Input } from '../components/Vec3Input.js';
import { useSceneStore } from '../store/useSceneStore.js';
import type { CameraZoneVolume } from '../store/types.js';
import { panelStyles } from '../styles/panel.js';

const styles = { ...panelStyles };

export function CameraVolumeEditor({ volume }: { volume: CameraZoneVolume }) {
  const updateCameraVolume = useSceneStore((s) => s.updateCameraVolume);
  const removeCameraVolume = useSceneStore((s) => s.removeCameraVolume);
  const cameraRails = useSceneStore((s) => s.cameraRails);
  const possessVolumeId = useSceneStore((s) => s.possessVolumeId);
  const enterPossessMode = useSceneStore((s) => s.enterPossessMode);
  const exitPossessMode = useSceneStore((s) => s.exitPossessMode);

  const update = (patch: Partial<CameraZoneVolume>) => updateCameraVolume(volume.id, patch);
  const updateParams = (patch: Partial<CameraZoneVolume['params']>) =>
    update({ params: { ...volume.params, ...patch } });

  const shapeType = volume.shape.type;
  const mode = volume.params.mode;

  return (
    <div>
      <div style={{ ...styles.row, marginBottom: 12 }}>
        <span style={{ ...styles.label, flex: 1 }}>Camera Volume</span>
        <button style={styles.btnDanger} onClick={() => removeCameraVolume(volume.id)}>Remove</button>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Name</span>
        <input
          type="text"
          value={volume.name}
          onChange={(e) => update({ name: e.target.value })}
          style={styles.input}
        />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Shape Type</span>
        <select
          style={styles.select}
          value={shapeType}
          onChange={(e) => {
            const newType = e.target.value;
            update({
              shape: newType === 'sphere'
                ? { type: 'sphere', center: volume.shape.center, radius: (volume.shape as any).radius ?? 5 }
                : { type: 'aabb', center: volume.shape.center, half_extents: (volume.shape as any).half_extents ?? [5, 5, 5] },
            });
          }}
        >
          <option value="aabb">AABB</option>
          <option value="sphere">Sphere</option>
        </select>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Center</span>
        <Vec3Input
          value={volume.shape.center}
          onChange={(v) => update({ shape: { ...volume.shape, center: v } })}
        />
      </div>

      {shapeType === 'aabb' && (
        <div style={styles.section}>
          <span style={styles.label}>Half Extents</span>
          <Vec3Input
            value={(volume.shape as any).half_extents ?? [5, 5, 5]}
            onChange={(v) => update({ shape: { ...volume.shape, half_extents: v } as any })}
          />
        </div>
      )}

      {shapeType === 'sphere' && (
        <div style={styles.section}>
          <span style={styles.label}>Radius</span>
          <NumberInput
            value={(volume.shape as any).radius ?? 5}
            min={0.1}
            step={0.5}
            onChange={(v) => update({ shape: { ...volume.shape, radius: v } as any })}
            style={styles.input}
          />
        </div>
      )}

      <div style={styles.section}>
        <span style={styles.label}>Mode</span>
        <select
          style={styles.select}
          value={mode}
          onChange={(e) => updateParams({ mode: e.target.value as any })}
        >
          <option value="free_look">Free Look</option>
          <option value="rail_follow">Rail Follow</option>
          <option value="cinematic_rail">Cinematic Rail</option>
          <option value="fixed_point">Fixed Point</option>
          <option value="side_scroll">Side Scroll</option>
        </select>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Priority</span>
        <NumberInput
          value={volume.params.priority ?? 0}
          step={1}
          onChange={(v) => updateParams({ priority: v })}
          style={styles.input}
        />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Blend Time</span>
        <NumberInput
          value={volume.params.blend_time ?? 1.0}
          min={0}
          step={0.1}
          onChange={(v) => updateParams({ blend_time: v })}
          style={styles.input}
        />
      </div>

      <div style={styles.section}>
        <label style={{ fontSize: 12, color: '#ddd', display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={volume.params.allow_user_orbit}
            onChange={(e) => updateParams({ allow_user_orbit: e.target.checked })}
          />
          Allow User Orbit
        </label>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Pitch Min / Max</span>
        <div style={styles.row}>
          <NumberInput
            label="Min"
            value={volume.params.pitch_min ?? -60}
            step={1}
            onChange={(v) => updateParams({ pitch_min: v })}
            style={styles.input}
          />
          <NumberInput
            label="Max"
            value={volume.params.pitch_max ?? 10}
            step={1}
            onChange={(v) => updateParams({ pitch_max: v })}
            style={styles.input}
          />
        </div>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Yaw Min / Max</span>
        <div style={styles.row}>
          <NumberInput
            label="Min"
            value={volume.params.yaw_min ?? -180}
            step={1}
            onChange={(v) => updateParams({ yaw_min: v })}
            style={styles.input}
          />
          <NumberInput
            label="Max"
            value={volume.params.yaw_max ?? 180}
            step={1}
            onChange={(v) => updateParams({ yaw_max: v })}
            style={styles.input}
          />
        </div>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>FOV</span>
        <NumberInput
          value={volume.params.fov ?? 45}
          min={10}
          max={150}
          step={1}
          onChange={(v) => updateParams({ fov: v })}
          style={styles.input}
        />
      </div>

      {mode === 'free_look' && (
        <div style={styles.section}>
          <span style={styles.label}>Orbit Distance</span>
          <NumberInput
            value={volume.params.orbit_distance ?? 10}
            min={0.1}
            step={0.5}
            onChange={(v) => updateParams({ orbit_distance: v })}
            style={styles.input}
          />
        </div>
      )}

      {(mode === 'free_look' || mode === 'side_scroll') && (
        <div style={styles.section}>
          <span style={styles.label}>Offset</span>
          <Vec3Input
            value={volume.params.offset ?? [0, 5, -10]}
            onChange={(v) => updateParams({ offset: v })}
          />
        </div>
      )}

      {mode === 'fixed_point' && (
        <div style={styles.section}>
          <span style={styles.label}>Fixed Position</span>
          <Vec3Input
            value={volume.params.fixed_position ?? [0, 10, 0]}
            onChange={(v) => updateParams({ fixed_position: v })}
          />
        </div>
      )}

      {(mode === 'rail_follow' || mode === 'cinematic_rail') && (
        <div style={styles.section}>
          <span style={styles.label}>Rail</span>
          <select
            style={styles.select}
            value={volume.params.rail_id ?? ''}
            onChange={(e) => updateParams({ rail_id: e.target.value || undefined })}
          >
            <option value="">(none)</option>
            {cameraRails.map((r) => (
              <option key={r.id} value={r.id}>{r.name || r.id}</option>
            ))}
          </select>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <button
          style={{
            ...styles.btn,
            width: '100%',
            background: possessVolumeId === volume.id ? '#00cccc' : undefined,
            color: possessVolumeId === volume.id ? '#000' : undefined,
          }}
          onClick={() => {
            if (possessVolumeId === volume.id) exitPossessMode();
            else enterPossessMode(volume.id);
          }}
        >
          {possessVolumeId === volume.id ? '✖ Exit Preview' : '👁 Possess Camera'}
        </button>
      </div>
    </div>
  );
}
