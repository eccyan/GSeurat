import { NumberInput } from '../../components/NumberInput.js';
import { Vec3Input } from '../../components/Vec3Input.js';
import { useSceneStore } from '../../store/useSceneStore.js';
import type { VfxInstanceData } from '../../store/types.js';
import { panelStyles } from '../../styles/panel.js';

const styles = { ...panelStyles };

export function VfxInstanceProperties({ vfx }: { vfx: VfxInstanceData }) {
  const update = useSceneStore((s) => s.updateVfxInstance);
  const remove = useSceneStore((s) => s.removeVfxInstance);
  const editingSpline = useSceneStore((s) => s.editingSpline);
  const isEditingThis = editingSpline === vfx.id;

  return (
    <div>
      <div style={{ ...styles.row, marginBottom: 12 }}>
        <span style={{ ...styles.label, flex: 1 }}>VFX Instance</span>
        <button style={styles.btnDanger} onClick={() => remove(vfx.id)}>Remove</button>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Name</span>
        <input type="text" value={vfx.name}
          onChange={(e) => update(vfx.id, { name: e.target.value })}
          style={styles.input} />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>VFX File</span>
        <input type="text" value={vfx.vfx_file} readOnly style={{ ...styles.input, opacity: 0.6 }} />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Position</span>
        <Vec3Input value={vfx.position} onChange={(v) => update(vfx.id, { position: v })} />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Rotation Y</span>
        <NumberInput step={15} value={vfx.rotation_y ?? 0}
          onChange={(v) => update(vfx.id, { rotation_y: v })}
          style={{ ...styles.input, maxWidth: 80 }} />
        <span style={{ fontSize: 10, color: '#666' }}>degrees</span>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Radius</span>
        <NumberInput step={0.5} min={0.1} value={vfx.radius}
          onChange={(v) => update(vfx.id, { radius: v })}
          style={{ ...styles.input, maxWidth: 80 }} />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Trigger</span>
        <select value={vfx.trigger}
          onChange={(e) => update(vfx.id, { trigger: e.target.value as 'auto' | 'event' })}
          style={styles.select}>
          <option value="auto">Auto (always active)</option>
          <option value="event">Event (triggered)</option>
        </select>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Loop</span>
        <input type="checkbox" checked={vfx.loop}
          onChange={(e) => update(vfx.id, { loop: e.target.checked })} />
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Preset</span>
        <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
          {vfx.vfx_preset?.name ?? '(not loaded)'} ({(vfx.vfx_preset?.elements ?? []).length} elements{vfx.vfx_preset?.duration ? `, ${vfx.vfx_preset.duration}s` : ''})
        </div>
      </div>

      {((vfx.splinePoints && vfx.splinePoints.length > 0) || (vfx.vfx_preset?.elements ?? []).some((el: any) => el.emitter?.spline?.mode && el.emitter.spline.mode !== 'none')) && (
        <div style={styles.section}>
          <span style={styles.label}>Spline Path</span>
          <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              style={{
                fontSize: 11,
                padding: '2px 8px',
                background: isEditingThis ? '#f59e0b' : '#334',
                color: isEditingThis ? '#000' : '#ccc',
                border: `1px solid ${isEditingThis ? '#f59e0b' : '#333'}`,
                borderRadius: 3,
                cursor: 'pointer',
              }}
              onClick={() => {
                if (isEditingThis) {
                  useSceneStore.getState().setEditingSpline(null);
                } else {
                  if (!vfx.splinePoints || vfx.splinePoints.length === 0) {
                    const firstEl = (vfx.vfx_preset?.elements ?? []).find(
                      (el: any) => el.emitter?.spline?.control_points?.length > 0
                    ) as any;
                    if (firstEl) {
                      useSceneStore.getState().updateVfxInstance(vfx.id, {
                        splinePoints: firstEl.emitter?.spline?.control_points,
                      });
                    }
                  }
                  useSceneStore.getState().setEditingSpline(vfx.id);
                }
              }}
            >
              {isEditingThis ? 'Done Editing' : 'Edit Spline'}
            </button>
            {vfx.splinePoints && vfx.splinePoints.length > 0 && (
              <>
                <span style={{ fontSize: 10, color: '#aaa' }}>{vfx.splinePoints.length} pts</span>
                <button
                  style={{
                    fontSize: 11,
                    padding: '2px 8px',
                    background: '#334',
                    color: '#ccc',
                    border: '1px solid #333',
                    borderRadius: 3,
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    useSceneStore.getState().updateVfxInstance(vfx.id, { splinePoints: undefined });
                    useSceneStore.getState().setEditingSpline(null);
                  }}
                >
                  Reset
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
