import React from 'react';
import { useWeaverStore } from '../store/useWeaverStore.js';
import { GroupSelector } from './GroupSelector.js';

export function Sidebar() {
  return (
    <aside className="weaver-sidebar">
      <GroupSelector />
      <GroupMetadata />
      <MarkerList />
    </aside>
  );
}

function GroupMetadata() {
  const activeGroupId = useWeaverStore((s) => s.activeGroupId);
  const groups = useWeaverStore((s) => s.groups);
  const bpm = useWeaverStore((s) => s.bpm);
  const sampleRate = useWeaverStore((s) => s.sampleRate);
  const setBpm = useWeaverStore((s) => s.setBpm);
  const setGroupName = useWeaverStore((s) => s.setGroupName);

  const activeGroup = groups.find((g) => g.id === activeGroupId);
  if (!activeGroup) {
    return (
      <div style={{ fontSize: 11, color: '#666', padding: '8px 0' }}>
        Select or create a track group to edit.
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#77aaff', marginBottom: 6 }}>
        Group Metadata
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 11 }}>
        <span style={{ width: 80 }}>Name</span>
        <input
          type="text"
          value={activeGroup.name}
          onChange={(e) => setGroupName(e.target.value)}
          style={{ flex: 1, padding: '2px 6px', background: '#111', color: '#eee', border: '1px solid #555', borderRadius: 3, fontSize: 11 }}
        />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 11 }}>
        <span style={{ width: 80 }}>ID</span>
        <span style={{ color: '#888' }}>{activeGroup.id}</span>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 11 }}>
        <span style={{ width: 80 }}>BPM</span>
        <input
          type="number"
          value={bpm}
          onChange={(e) => setBpm(Number(e.target.value))}
          style={{ width: 60, padding: '2px 6px', background: '#111', color: '#eee', border: '1px solid #555', borderRadius: 3, fontSize: 11 }}
        />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
        <span style={{ width: 80 }}>Sample Rate</span>
        <span style={{ color: '#888' }}>{sampleRate}</span>
      </label>
    </div>
  );
}

function MarkerList() {
  const markers = useWeaverStore((s) => s.markers);
  const removeMarker = useWeaverStore((s) => s.removeMarker);
  const updateMarker = useWeaverStore((s) => s.updateMarker);
  const setPlayheadFrame = useWeaverStore((s) => s.setPlayheadFrame);
  const activeGroupId = useWeaverStore((s) => s.activeGroupId);

  if (!activeGroupId) return null;

  const sorted = [...markers]
    .map((m, i) => ({ ...m, origIdx: i }))
    .sort((a, b) => a.frame - b.frame);

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#77aaff', marginBottom: 6 }}>
        Markers ({markers.length})
      </div>
      {sorted.length === 0 && (
        <div style={{ fontSize: 11, color: '#666' }}>
          Shift+click ruler to add markers
        </div>
      )}
      {sorted.map((m) => (
        <div
          key={m.origIdx}
          onClick={() => setPlayheadFrame(m.frame)}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '2px 0', cursor: 'pointer', fontSize: 11,
          }}
        >
          <span style={{ color: '#ffaa00', width: 60 }}>{m.frame}</span>
          <input
            type="text"
            value={m.name}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => updateMarker(m.origIdx, { name: e.target.value })}
            style={{
              flex: 1, padding: '1px 4px', background: '#111', color: '#eee',
              border: '1px solid #444', borderRadius: 2, fontSize: 11,
            }}
          />
          <button
            onClick={(e) => { e.stopPropagation(); removeMarker(m.origIdx); }}
            style={{ padding: '0 4px', fontSize: 10 }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
