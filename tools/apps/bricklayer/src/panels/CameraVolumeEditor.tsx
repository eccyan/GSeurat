import React from 'react';
import { useComponentRegistry } from '@gseurat/ui-kit';
import { NumberInput } from '../components/NumberInput.js';
import { Vec3Input } from '../components/Vec3Input.js';
import { useSceneStore } from '../store/useSceneStore.js';
import type { CameraZoneVolume } from '../store/types.js';
import { panelStyles } from '../styles/panel.js';

const styles = { ...panelStyles };

export function CameraVolumeEditor({ volume }: { volume: CameraZoneVolume }) {
  useComponentRegistry('CameraVolumeEditor');
  const updateCameraVolume = useSceneStore((s) => s.updateCameraVolume);
  const removeCameraVolume = useSceneStore((s) => s.removeCameraVolume);
  const cameraRails = useSceneStore((s) => s.cameraRails);

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

      {(mode === 'fixed_point' || (mode === 'cinematic_rail' && (volume.params.target_mode ?? 'player') === 'fixed_point')) && (
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

      {mode === 'cinematic_rail' && (
        <>
          <div style={styles.section}>
            <span style={styles.label}>Duration (s)</span>
            <NumberInput
              value={volume.params.cinematic_duration ?? 5.0}
              min={0.1}
              step={0.5}
              onChange={(v) => updateParams({ cinematic_duration: v })}
              style={styles.input}
            />
          </div>

          <div style={styles.section}>
            <span style={styles.label}>Easing</span>
            <select
              style={styles.select}
              value={volume.params.cinematic_easing ?? 'in_out_quad'}
              onChange={(e) => updateParams({ cinematic_easing: e.target.value })}
            >
              <option value="linear">Linear</option>
              <option value="in_quad">In Quad</option>
              <option value="out_quad">Out Quad</option>
              <option value="in_out_quad">In Out Quad</option>
              <option value="in_cubic">In Cubic</option>
              <option value="out_cubic">Out Cubic</option>
              <option value="in_out_cubic">In Out Cubic</option>
              <option value="in_sine">In Sine</option>
              <option value="out_sine">Out Sine</option>
              <option value="in_out_sine">In Out Sine</option>
              <option value="in_expo">In Expo</option>
              <option value="out_expo">Out Expo</option>
              <option value="in_out_expo">In Out Expo</option>
              <option value="in_elastic">In Elastic</option>
              <option value="out_elastic">Out Elastic</option>
              <option value="in_out_elastic">In Out Elastic</option>
              <option value="in_back">In Back</option>
              <option value="out_back">Out Back</option>
              <option value="in_out_back">In Out Back</option>
              <option value="in_bounce">In Bounce</option>
              <option value="out_bounce">Out Bounce</option>
              <option value="in_out_bounce">In Out Bounce</option>
            </select>
          </div>

          <div style={styles.section}>
            <span style={styles.label}>Playback</span>
            <select
              style={styles.select}
              value={volume.params.cinematic_playback ?? 'once'}
              onChange={(e) => updateParams({ cinematic_playback: e.target.value as any })}
            >
              <option value="once">Once</option>
              <option value="loop">Loop</option>
              <option value="ping_pong">Ping Pong</option>
              <option value="manual">Manual</option>
            </select>
          </div>

          <div style={styles.section}>
            <label style={{ fontSize: 12, color: '#ddd', display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={volume.params.play_on_enter ?? true}
                onChange={(e) => updateParams({ play_on_enter: e.target.checked })}
              />
              Play On Enter
            </label>
          </div>

          <div style={styles.section}>
            <span style={styles.label}>Target Mode</span>
            <select
              style={styles.select}
              value={volume.params.target_mode ?? 'player'}
              onChange={(e) => updateParams({ target_mode: e.target.value as any })}
            >
              <option value="player">Player</option>
              <option value="target_path">Target Path</option>
              <option value="fixed_point">Fixed Point</option>
            </select>
          </div>

          <div style={styles.section}>
            <span style={styles.label}>Min Ground Clearance</span>
            <NumberInput
              value={volume.params.min_ground_clearance ?? 10}
              min={0}
              step={1}
              onChange={(v) => updateParams({ min_ground_clearance: v })}
              style={styles.input}
            />
          </div>

          <div style={styles.section}>
            <span style={styles.label}>Target Y Offset</span>
            <NumberInput
              value={volume.params.target_y_offset ?? 2.5}
              min={0}
              step={0.5}
              onChange={(v) => updateParams({ target_y_offset: v })}
              style={styles.input}
            />
          </div>
        </>
      )}

    </div>
  );
}
