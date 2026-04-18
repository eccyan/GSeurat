import React from 'react';

interface DirtyDialogProps {
  groupName: string;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export function DirtyDialog({
  groupName,
  onSave,
  onDiscard,
  onCancel,
}: DirtyDialogProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: '#1e1e3e',
          border: '1px solid #555',
          borderRadius: 8,
          padding: '24px 32px',
          maxWidth: 400,
        }}
      >
        <p style={{ marginBottom: 16 }}>
          You have unsaved changes to <strong>{groupName}</strong>. Save before
          switching?
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel}>Cancel</button>
          <button onClick={onDiscard}>Discard</button>
          <button
            onClick={onSave}
            style={{ background: '#2255aa', fontWeight: 600 }}
          >
            Save & Switch
          </button>
        </div>
      </div>
    </div>
  );
}
