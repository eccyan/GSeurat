import React, { useState, useEffect } from 'react';
import { useWeaverStore } from '../store/useWeaverStore.js';

export function GroupSelector() {
  const groups = useWeaverStore((s) => s.groups);
  const activeGroupId = useWeaverStore((s) => s.activeGroupId);
  const addGroup = useWeaverStore((s) => s.addGroup);
  const duplicateGroup = useWeaverStore((s) => s.duplicateGroup);
  const deleteGroup = useWeaverStore((s) => s.deleteGroup);
  const switchGroup = useWeaverStore((s) => s.switchGroup);
  const dirty = useWeaverStore((s) => s.dirty);
  const saveProject = useWeaverStore((s) => s.saveProject);

  const renameGroup = useWeaverStore((s) => s.renameGroup);

  const [pendingSwitchId, setPendingSwitchId] = useState<string | null>(null);
  const [showNewInput, setShowNewInput] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  // ESC key to dismiss dirty dialog
  useEffect(() => {
    if (!pendingSwitchId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPendingSwitchId(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [pendingSwitchId]);

  const handleSwitchRequest = (id: string) => {
    if (id === activeGroupId) return;
    if (dirty) {
      setPendingSwitchId(id);
    } else {
      switchGroup(id);
    }
  };

  const handleDirtySave = async () => {
    await saveProject();
    if (pendingSwitchId) await switchGroup(pendingSwitchId);
    setPendingSwitchId(null);
  };

  const handleDirtyDiscard = async () => {
    if (pendingSwitchId) await switchGroup(pendingSwitchId);
    setPendingSwitchId(null);
  };

  const handleAdd = () => {
    if (!newName.trim()) return;
    addGroup(newName.trim());
    setNewName('');
    setShowNewInput(false);
    const state = useWeaverStore.getState();
    const last = state.groups[state.groups.length - 1];
    if (last) switchGroup(last.id);
  };

  const handleDelete = () => {
    if (!activeGroupId) return;
    if (!confirm('Delete this track group?')) return;
    deleteGroup(activeGroupId);
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#77aaff', marginBottom: 6 }}>
        Track Groups
      </div>

      {groups.length === 0 && (
        <div style={{ fontSize: 11, color: '#666', marginBottom: 8 }}>
          No groups yet. Add your first track group.
        </div>
      )}

      <div style={{ maxHeight: 150, overflowY: 'auto', marginBottom: 8 }}>
        {groups.map((g) => (
          <div
            key={g.id}
            onClick={() => handleSwitchRequest(g.id)}
            onDoubleClick={() => { setEditingGroupId(g.id); setEditingName(g.name); }}
            style={{
              padding: '4px 8px',
              cursor: 'pointer',
              fontSize: 11,
              borderRadius: 3,
              background: g.id === activeGroupId ? 'rgba(68,136,255,0.2)' : 'transparent',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span style={{ color: g.id === activeGroupId ? '#4488ff' : '#666' }}>
              {g.id === activeGroupId ? '\u25CF' : '\u25CB'}
            </span>
            {editingGroupId === g.id ? (
              <input
                type="text"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { renameGroup(g.id, editingName); setEditingGroupId(null); }
                  if (e.key === 'Escape') setEditingGroupId(null);
                }}
                onBlur={() => { renameGroup(g.id, editingName); setEditingGroupId(null); }}
                onClick={(e) => e.stopPropagation()}
                autoFocus
                style={{
                  flex: 1, padding: '1px 4px', fontSize: 11,
                  background: '#111', color: '#eee', border: '1px solid #555', borderRadius: 2,
                }}
              />
            ) : (
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {g.name}
              </span>
            )}
          </div>
        ))}
      </div>

      {showNewInput ? (
        <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="Group name"
            autoFocus
            style={{
              flex: 1, padding: '2px 6px', fontSize: 11,
              background: '#111', color: '#eee', border: '1px solid #555', borderRadius: 3,
            }}
          />
          <button onClick={handleAdd} style={{ fontSize: 10, padding: '2px 6px' }}>OK</button>
          <button onClick={() => setShowNewInput(false)} style={{ fontSize: 10, padding: '2px 6px' }}>
            {'\u2715'}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={() => setShowNewInput(true)} style={{ fontSize: 10, padding: '2px 8px' }}>
            + Add
          </button>
          <button
            onClick={() => activeGroupId && duplicateGroup(activeGroupId)}
            disabled={!activeGroupId}
            style={{ fontSize: 10, padding: '2px 8px', opacity: activeGroupId ? 1 : 0.4 }}
          >
            Dup
          </button>
          <button
            onClick={handleDelete}
            disabled={!activeGroupId}
            style={{ fontSize: 10, padding: '2px 8px', opacity: activeGroupId ? 1 : 0.4 }}
          >
            Del
          </button>
        </div>
      )}

      {pendingSwitchId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Unsaved changes"
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
        >
          <div style={{ background: '#1e1e3e', border: '1px solid #555', borderRadius: 8, padding: '24px 32px', maxWidth: 400 }}>
            <p style={{ marginBottom: 16 }}>You have unsaved changes. Save before switching?</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setPendingSwitchId(null)}>Cancel</button>
              <button onClick={handleDirtyDiscard}>Discard</button>
              <button onClick={handleDirtySave} style={{ background: '#2255aa', fontWeight: 600 }}>
                Save & Switch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
