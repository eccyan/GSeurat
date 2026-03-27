import React from 'react';
import { NumberInput } from '../components/NumberInput.js';
import { Vec3Input } from '../components/Vec3Input.js';
import { useSceneStore } from '../store/useSceneStore.js';
import type { PlacedObjectData } from '../store/types.js';
import { panelStyles } from '../styles/panel.js';

const styles = { ...panelStyles };

function ObjectEditor({ obj }: { obj: PlacedObjectData }) {
  const updatePlacedObject = useSceneStore((s) => s.updatePlacedObject);
  const removePlacedObject = useSceneStore((s) => s.removePlacedObject);
  const selectedEntity = useSceneStore((s) => s.selectedEntity);
  const setSelectedEntity = useSceneStore((s) => s.setSelectedEntity);
  const isSelected = selectedEntity?.type === 'object' && selectedEntity.id === obj.id;

  return (
    <div
      style={{ ...styles.item, ...(isSelected ? styles.itemSelected : {}) }}
      onClick={() => setSelectedEntity({ type: 'object', id: obj.id })}
    >
      <div style={styles.row}>
        <span style={{ fontSize: 13, flex: 1, color: '#ddd' }}>
          {obj.id.slice(0, 16)}
        </span>
        <button style={styles.btnDanger} onClick={(e) => { e.stopPropagation(); removePlacedObject(obj.id); }}>
          Remove
        </button>
      </div>
      <div style={styles.row}>
        <span style={{ fontSize: 12, minWidth: 50 }}>PLY</span>
        <input
          type="text"
          value={obj.ply_file}
          onChange={(e) => updatePlacedObject(obj.id, { ply_file: e.target.value })}
          style={styles.input}
          placeholder="path/to/model.ply"
        />
      </div>
      <span style={{ fontSize: 11, color: '#888' }}>Position</span>
      <Vec3Input
        value={obj.position}
        onChange={(v) => updatePlacedObject(obj.id, { position: v })}
      />
      <span style={{ fontSize: 11, color: '#888' }}>Rotation (deg)</span>
      <Vec3Input
        value={obj.rotation}
        onChange={(v) => updatePlacedObject(obj.id, { rotation: v })}
      />
      <div style={styles.row}>
        <span style={{ fontSize: 12, minWidth: 50 }}>Scale</span>
        <NumberInput
          step={0.1}
          value={obj.scale}
          onChange={(v) => updatePlacedObject(obj.id, { scale: v })}
          style={{ ...styles.input, maxWidth: 80 }}
        />
      </div>
      <div style={styles.row}>
        <label style={{ fontSize: 12, color: '#ddd', display: 'flex', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={obj.is_static}
            onChange={(e) => updatePlacedObject(obj.id, { is_static: e.target.checked })}
            style={styles.checkbox}
          />
          Static (merge into terrain)
        </label>
      </div>
      <div style={styles.row}>
        <span style={{ fontSize: 12, minWidth: 50 }}>Manifest</span>
        <input
          type="text"
          value={obj.character_manifest}
          onChange={(e) => updatePlacedObject(obj.id, { character_manifest: e.target.value })}
          style={styles.input}
          placeholder="character manifest JSON"
        />
      </div>
    </div>
  );
}

export function ObjectsTab() {
  const placedObjects = useSceneStore((s) => s.placedObjects);
  const addPlacedObject = useSceneStore((s) => s.addPlacedObject);

  const handleAdd = () => {
    const plyFile = window.prompt('PLY file path:', '');
    if (plyFile) {
      addPlacedObject(plyFile);
    }
  };

  return (
    <div>
      <div style={{ ...styles.row, marginBottom: 8 }}>
        <span style={{ ...styles.label, flex: 1 }}>Placed Objects ({placedObjects.length})</span>
        <button style={styles.btn} onClick={handleAdd}>+ Add</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {placedObjects.map((obj) => <ObjectEditor key={obj.id} obj={obj} />)}
      </div>
    </div>
  );
}
