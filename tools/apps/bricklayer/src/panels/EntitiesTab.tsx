import React from 'react';
import { Vec3Input } from '../components/Vec3Input.js';
import { useSceneStore } from '../store/useSceneStore.js';
import { panelStyles } from '../styles/panel.js';

const styles = { ...panelStyles };

const facings = ['up', 'down', 'left', 'right'];

export function EntitiesTab() {
  const player = useSceneStore((s) => s.player);
  const updatePlayer = useSceneStore((s) => s.updatePlayer);

  return (
    <div>
      <div style={styles.section}>
        <span style={styles.label}>Player Spawn</span>
        <Vec3Input
          value={player.position}
          onChange={(v) => updatePlayer({ position: v })}
        />
        <div style={styles.row}>
          <span style={{ fontSize: 12, minWidth: 50 }}>Facing</span>
          <select
            style={styles.select}
            value={player.facing}
            onChange={(e) => updatePlayer({ facing: e.target.value })}
          >
            {facings.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div style={styles.row}>
          <span style={{ fontSize: 12, minWidth: 50 }}>Char ID</span>
          <input
            type="text"
            value={player.character_id}
            onChange={(e) => updatePlayer({ character_id: e.target.value })}
            style={styles.input}
          />
        </div>
      </div>

    </div>
  );
}
