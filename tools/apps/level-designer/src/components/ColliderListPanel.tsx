import React from 'react';
import { useEditorStore, type ColliderData } from '../store/useEditorStore.js';

export function ColliderListPanel() {
  const colliders = useEditorStore((s) => s.colliders);
  const selectedColliderId = useEditorStore((s) => s.selectedColliderId);
  const setSelectedCollider = useEditorStore((s) => s.setSelectedCollider);
  const addCollider = useEditorStore((s) => s.addCollider);
  const removeCollider = useEditorStore((s) => s.removeCollider);

  const handleAdd = () => {
    const id = `collider_${Date.now()}`;
    addCollider({
      id,
      name: 'New Collider',
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1], // identity quaternion
      shape: { type: 'box', half_extents: [1, 1, 1] },
      collision_mask: 0xFFFFFFFF,
      is_trigger: false,
      is_dynamic: false,
    });
    setSelectedCollider(id);
  };

  const handleDelete = (id: string) => {
    removeCollider(id);
  };

  const shapeIcon = (shape: ColliderData['shape']) => {
    switch (shape.type) {
      case 'box': return '□';
      case 'sphere': return '○';
      case 'capsule': return '⬭';
      default: return '?';
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '4px 8px', borderBottom: '1px solid #444',
      }}>
        <span style={{ fontWeight: 'bold', fontSize: 12 }}>Colliders</span>
        <button
          onClick={handleAdd}
          style={{
            background: '#4a9eff', color: '#fff', border: 'none',
            borderRadius: 3, padding: '2px 8px', cursor: 'pointer', fontSize: 12,
          }}
        >
          + Add
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {colliders.map((c) => (
          <div
            key={c.id}
            onClick={() => setSelectedCollider(c.id)}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '4px 8px', cursor: 'pointer',
              background: selectedColliderId === c.id ? '#3a5a8a' : 'transparent',
              borderBottom: '1px solid #333',
            }}
          >
            <span style={{ fontSize: 12 }}>
              {shapeIcon(c.shape)} {c.name || c.id}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); handleDelete(c.id); }}
              style={{
                background: 'none', border: 'none', color: '#f55',
                cursor: 'pointer', fontSize: 12, padding: '0 4px',
              }}
            >
              ✕
            </button>
          </div>
        ))}
        {colliders.length === 0 && (
          <div style={{ padding: 8, fontSize: 12, color: '#888', textAlign: 'center' }}>
            No colliders. Click "+ Add" to create one.
          </div>
        )}
      </div>
    </div>
  );
}
