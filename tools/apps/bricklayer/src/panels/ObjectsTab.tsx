import React, { useRef } from 'react';
import { NumberInput } from '../components/NumberInput.js';
import { useSceneStore } from '../store/useSceneStore.js';
import type { PlacedObjectData } from '../store/types.js';
import { hasFileSystemAccess, importAssetToProject } from '../lib/projectIO.js';

const styles: Record<string, React.CSSProperties> = {
  section: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 },
  label: { fontSize: 11, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 1 },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
  input: {
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
  checkbox: { marginRight: 4 },
};

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
  const plyInputRef = useRef<HTMLInputElement>(null);

  const handleAdd = () => {
    // Use file picker for PLY selection
    plyInputRef.current?.click();
  };

  const handlePlyFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const store = useSceneStore.getState();
    const handle = store.projectHandle;

    if (handle && hasFileSystemAccess()) {
      // Copy PLY into project assets/ and use relative path
      const relativePath = await importAssetToProject(handle, file, 'ply');
      addPlacedObject(relativePath);

      store.addAsset({
        id: `asset_${Date.now()}`,
        path: relativePath,
        type: 'ply',
      });
    } else {
      // No project directory: use filename as-is
      addPlacedObject(file.name);
    }

    e.target.value = '';
  };

  return (
    <div>
      <input
        ref={plyInputRef}
        type="file"
        accept=".ply"
        style={{ display: 'none' }}
        onChange={handlePlyFileChange}
      />
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
