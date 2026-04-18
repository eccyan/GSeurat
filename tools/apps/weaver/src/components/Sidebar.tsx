import React from 'react';
import { useWeaverStore } from '../store/useWeaverStore.js';

function GroupMetadata() {
  const groupName = useWeaverStore((s) => s.groupName);
  const groupId = useWeaverStore((s) => s.groupId);
  const bpm = useWeaverStore((s) => s.bpm);
  const sampleRate = useWeaverStore((s) => s.sampleRate);
  const setGroupName = useWeaverStore((s) => s.setGroupName);
  const setGroupId = useWeaverStore((s) => s.setGroupId);
  const setBpm = useWeaverStore((s) => s.setBpm);
  const setSampleRate = useWeaverStore((s) => s.setSampleRate);

  return (
    <section style={{ marginBottom: 16 }}>
      <h3 style={{ fontSize: 12, margin: '0 0 8px', color: '#77aaff' }}>Group Metadata</h3>
      <label style={labelStyle}>
        Name
        <input
          type="text"
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          style={inputStyle}
        />
      </label>
      <label style={labelStyle}>
        ID
        <input
          type="number"
          value={groupId}
          onChange={(e) => setGroupId(Number(e.target.value))}
          style={inputStyle}
        />
      </label>
      <label style={labelStyle}>
        BPM
        <input
          type="number"
          value={bpm}
          min={1}
          max={999}
          onChange={(e) => setBpm(Number(e.target.value))}
          style={inputStyle}
        />
      </label>
      <label style={labelStyle}>
        Sample Rate
        <input
          type="number"
          value={sampleRate}
          onChange={(e) => setSampleRate(Number(e.target.value))}
          style={inputStyle}
        />
      </label>
    </section>
  );
}

function MarkerList() {
  const markers = useWeaverStore((s) => s.markers);
  const removeMarker = useWeaverStore((s) => s.removeMarker);
  const updateMarker = useWeaverStore((s) => s.updateMarker);
  const setPlayheadFrame = useWeaverStore((s) => s.setPlayheadFrame);

  const sorted = [...markers]
    .map((m, i) => ({ ...m, originalIndex: i }))
    .sort((a, b) => a.frame - b.frame);

  return (
    <section>
      <h3 style={{ fontSize: 12, margin: '0 0 8px', color: '#77aaff' }}>
        Markers ({markers.length})
      </h3>
      {sorted.length === 0 && (
        <div style={{ fontSize: 11, color: '#888' }}>Shift+click ruler to add markers</div>
      )}
      {sorted.map((m) => (
        <div
          key={m.originalIndex}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4,
            padding: '2px 4px', borderRadius: 3, background: '#1a1a2e',
          }}
        >
          <span
            style={{ cursor: 'pointer', color: '#ffaa00', fontSize: 12 }}
            title="Jump to marker"
            onClick={() => setPlayheadFrame(m.frame)}
          >
            &#9670;
          </span>
          <input
            type="text"
            value={m.name}
            onChange={(e) => updateMarker(m.originalIndex, { name: e.target.value })}
            style={{ ...inputStyle, flex: 1, marginBottom: 0 }}
          />
          <span style={{ fontSize: 10, color: '#888', minWidth: 50 }}>
            f{m.frame}
          </span>
          <button
            onClick={() => removeMarker(m.originalIndex)}
            style={{ padding: '1px 6px', fontSize: 10 }}
          >
            ✕
          </button>
        </div>
      ))}
    </section>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  fontSize: 12, marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  background: '#1a1a2e', border: '1px solid #555', color: '#e0e0e0',
  padding: '2px 6px', fontSize: 12, width: 120, borderRadius: 3,
};

export function Sidebar() {
  return (
    <div className="weaver-sidebar">
      <GroupMetadata />
      <MarkerList />
    </div>
  );
}
