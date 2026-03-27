import React from 'react';
import { NumberInput } from '../components/NumberInput.js';
import { useSceneStore } from '../store/useSceneStore.js';
import type { NpcData, PortalData } from '../store/types.js';

const styles: Record<string, React.CSSProperties> = {
  section: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 },
  label: { fontSize: 11, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 1 },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
  input: {
    flex: 1, padding: '4px 6px', background: '#2a2a4a', border: '1px solid #444',
    borderRadius: 4, color: '#ddd', fontSize: 13,
  },
  select: {
    flex: 1, padding: '4px 6px', background: '#2a2a4a', border: '1px solid #444',
    borderRadius: 4, color: '#ddd', fontSize: 13,
  },
  btn: {
    padding: '4px 10px', border: '1px solid #555', borderRadius: 4,
    background: '#3a3a6a', color: '#ddd', cursor: 'pointer', fontSize: 12,
  },
  btnDanger: {
    padding: '4px 10px', border: '1px solid #c33', borderRadius: 4,
    background: '#4a2020', color: '#faa', cursor: 'pointer', fontSize: 12,
  },
  item: {
    padding: 8, border: '1px solid #444', borderRadius: 4, background: '#22223a',
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  itemSelected: { borderColor: '#77f' },
};

const facings = ['up', 'down', 'left', 'right'];

function Vec3Input({
  value,
  onChange,
  labelPrefix,
}: {
  value: [number, number, number];
  onChange: (v: [number, number, number]) => void;
  labelPrefix?: string;
}) {
  return (
    <div style={styles.row}>
      {['X', 'Y', 'Z'].map((axis, i) => (
        <React.Fragment key={axis}>
          <NumberInput
            label={`${labelPrefix ?? ''}${axis}`}
            step={0.1}
            value={value[i]}
            onChange={(v) => {
              const next = [...value] as [number, number, number];
              next[i] = v;
              onChange(next);
            }}
            style={{ ...styles.input, maxWidth: 55 }}
          />
        </React.Fragment>
      ))}
    </div>
  );
}

function NpcEditor({ npc }: { npc: NpcData }) {
  const updateNpc = useSceneStore((s) => s.updateNpc);
  const removeNpc = useSceneStore((s) => s.removeNpc);
  const selectedEntity = useSceneStore((s) => s.selectedEntity);
  const setSelectedEntity = useSceneStore((s) => s.setSelectedEntity);
  const isSelected = selectedEntity?.type === 'npc' && selectedEntity.id === npc.id;

  return (
    <div
      style={{ ...styles.item, ...(isSelected ? styles.itemSelected : {}) }}
      onClick={() => setSelectedEntity({ type: 'npc', id: npc.id })}
    >
      <div style={styles.row}>
        <input
          type="text"
          value={npc.name}
          onChange={(e) => updateNpc(npc.id, { name: e.target.value })}
          style={{ ...styles.input, fontWeight: 600 }}
        />
        <button style={styles.btnDanger} onClick={(e) => { e.stopPropagation(); removeNpc(npc.id); }}>
          Remove
        </button>
      </div>
      <Vec3Input
        value={npc.position}
        onChange={(v) => updateNpc(npc.id, { position: v })}
      />
      <div style={styles.row}>
        <span style={{ fontSize: 12, minWidth: 50 }}>Facing</span>
        <select
          style={styles.select}
          value={npc.facing}
          onChange={(e) => updateNpc(npc.id, { facing: e.target.value })}
        >
          {facings.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      <div style={styles.row}>
        <span style={{ fontSize: 12, minWidth: 50 }}>Char ID</span>
        <input
          type="text"
          value={npc.character_id}
          onChange={(e) => updateNpc(npc.id, { character_id: e.target.value })}
          style={styles.input}
        />
      </div>
      <div style={styles.row}>
        <span style={{ fontSize: 12, minWidth: 50 }}>Patrol</span>
        <NumberInput
          step={0.1}
          value={npc.patrol_interval}
          onChange={(v) => updateNpc(npc.id, { patrol_interval: v })}
          style={{ ...styles.input, maxWidth: 60 }}
        />
        <NumberInput
          step={0.1}
          value={npc.patrol_speed}
          onChange={(v) => updateNpc(npc.id, { patrol_speed: v })}
          style={{ ...styles.input, maxWidth: 60 }}
        />
      </div>
    </div>
  );
}

function PortalEditor({ portal }: { portal: PortalData }) {
  const updatePortal = useSceneStore((s) => s.updatePortal);
  const removePortal = useSceneStore((s) => s.removePortal);
  const selectedEntity = useSceneStore((s) => s.selectedEntity);
  const setSelectedEntity = useSceneStore((s) => s.setSelectedEntity);
  const isSelected = selectedEntity?.type === 'portal' && selectedEntity.id === portal.id;

  return (
    <div
      style={{ ...styles.item, ...(isSelected ? styles.itemSelected : {}) }}
      onClick={() => setSelectedEntity({ type: 'portal', id: portal.id })}
    >
      <div style={styles.row}>
        <span style={{ fontSize: 13, flex: 1 }}>Portal</span>
        <button style={styles.btnDanger} onClick={(e) => { e.stopPropagation(); removePortal(portal.id); }}>
          Remove
        </button>
      </div>
      <div style={styles.row}>
        <span style={{ fontSize: 12, minWidth: 40 }}>Pos</span>
        <NumberInput
          value={portal.position[0]}
          onChange={(v) => updatePortal(portal.id, { position: [v, portal.position[1], portal.position[2]] })}
          style={{ ...styles.input, maxWidth: 60 }}
        />
        <NumberInput
          value={portal.position[1]}
          onChange={(v) => updatePortal(portal.id, { position: [portal.position[0], v, portal.position[2]] })}
          style={{ ...styles.input, maxWidth: 60 }}
        />
        <NumberInput
          value={portal.position[2]}
          onChange={(v) => updatePortal(portal.id, { position: [portal.position[0], portal.position[1], v] })}
          style={{ ...styles.input, maxWidth: 60 }}
        />
      </div>
      <div style={styles.row}>
        <span style={{ fontSize: 12, minWidth: 40 }}>Size</span>
        <NumberInput
          value={portal.size[0]}
          onChange={(v) => updatePortal(portal.id, { size: [v, portal.size[1]] })}
          style={{ ...styles.input, maxWidth: 60 }}
        />
        <NumberInput
          value={portal.size[1]}
          onChange={(v) => updatePortal(portal.id, { size: [portal.size[0], v] })}
          style={{ ...styles.input, maxWidth: 60 }}
        />
      </div>
      <div style={styles.row}>
        <span style={{ fontSize: 12, minWidth: 40 }}>Target</span>
        <input
          type="text"
          value={portal.target_scene}
          onChange={(e) => updatePortal(portal.id, { target_scene: e.target.value })}
          style={styles.input}
          placeholder="scene name"
        />
      </div>
      <Vec3Input
        value={portal.spawn_position}
        onChange={(v) => updatePortal(portal.id, { spawn_position: v })}
      />
    </div>
  );
}

export function EntitiesTab() {
  const player = useSceneStore((s) => s.player);
  const updatePlayer = useSceneStore((s) => s.updatePlayer);
  const npcs = useSceneStore((s) => s.npcs);
  const addNpc = useSceneStore((s) => s.addNpc);
  const portals = useSceneStore((s) => s.portals);
  const addPortal = useSceneStore((s) => s.addPortal);

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

      <div style={{ ...styles.row, marginBottom: 8 }}>
        <span style={{ ...styles.label, flex: 1 }}>NPCs ({npcs.length})</span>
        <button style={styles.btn} onClick={() => addNpc()}>+ Add</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {npcs.map((n) => <NpcEditor key={n.id} npc={n} />)}
      </div>

      <div style={{ ...styles.row, marginBottom: 8 }}>
        <span style={{ ...styles.label, flex: 1 }}>Portals ({portals.length})</span>
        <button style={styles.btn} onClick={() => addPortal()}>+ Add</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {portals.map((p) => <PortalEditor key={p.id} portal={p} />)}
      </div>
    </div>
  );
}
