import React from 'react';
import { Vec3Input } from '../components/Vec3Input.js';
import { useSceneStore } from '../store/useSceneStore.js';
import type { InstanceData } from '../store/types.js';
import { panelStyles } from '../styles/panel.js';

const styles = { ...panelStyles };

const facings = ['up', 'down', 'left', 'right'];

function InstanceItem({ inst }: { inst: InstanceData }) {
  const selectedEntity = useSceneStore((s) => s.selectedEntity);
  const setSelectedEntity = useSceneStore((s) => s.setSelectedEntity);
  const isSelected = selectedEntity?.type === 'instance' && selectedEntity.id === inst.id;

  return (
    <div
      style={{ ...styles.item, ...(isSelected ? styles.itemSelected : {}) }}
      onClick={() => setSelectedEntity({ type: 'instance', id: inst.id })}
    >
      <span style={{ fontSize: 13 }}>{inst.display_name || '(unnamed)'}</span>
    </div>
  );
}

export function EntitiesTab() {
  const player = useSceneStore((s) => s.player);
  const updatePlayer = useSceneStore((s) => s.updatePlayer);
  const instances = useSceneStore((s) => s.instances);
  const addInstance = useSceneStore((s) => s.addInstance);

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

      <div style={{ ...styles.row, marginBottom: 8, marginTop: 16 }}>
        <span style={{ ...styles.label, flex: 1 }}>Instances ({instances.length})</span>
        <button style={styles.btn} onClick={() => addInstance()}>+ Add</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {instances.map((inst) => <InstanceItem key={inst.id} inst={inst} />)}
      </div>
    </div>
  );
}
