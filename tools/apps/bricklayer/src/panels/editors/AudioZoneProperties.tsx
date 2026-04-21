import { AudioZonePanel } from '../../components/AudioZonePanel.js';
import { useSceneStore } from '../../store/useSceneStore.js';
import type { AudioZoneData } from '../../store/types.js';
import { panelStyles } from '../../styles/panel.js';

const styles = { ...panelStyles };

export function AudioZoneProperties({ zone }: { zone: AudioZoneData }) {
  const update = useSceneStore((s) => s.updateAudioZone);
  const remove = useSceneStore((s) => s.removeAudioZone);

  return (
    <div>
      <div style={{ ...styles.row, marginBottom: 12 }}>
        <span style={{ ...styles.label, flex: 1 }}>Audio Zone</span>
        <button style={styles.btnDanger} onClick={() => remove(zone.id)}>Remove</button>
      </div>

      <div style={styles.section}>
        <span style={styles.label}>Name</span>
        <input
          type="text"
          value={zone.name}
          onChange={(e) => update(zone.id, { name: e.target.value })}
          style={styles.input}
        />
      </div>

      <AudioZonePanel
        data={zone}
        trackGroupOptions={[]}
        onChange={(next) => update(zone.id, next)}
      />
    </div>
  );
}
