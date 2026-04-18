import React from 'react';

interface EmptyProjectStateProps {
  hasProjectRoot: boolean;
  onOpenProjectRoot: () => void;
  onNewProject: () => void;
}

export function EmptyProjectState({
  hasProjectRoot,
  onOpenProjectRoot,
  onNewProject,
}: EmptyProjectStateProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        gap: 16,
        color: '#888',
      }}
    >
      <h2 style={{ color: '#77aaff', fontWeight: 700 }}>Weaver</h2>
      {!hasProjectRoot ? (
        <>
          <p>No project directory selected.</p>
          <button onClick={onOpenProjectRoot} style={{ padding: '8px 24px' }}>
            Open Project Root...
          </button>
        </>
      ) : (
        <>
          <p>No Weaver projects found in this directory.</p>
          <button onClick={onNewProject} style={{ padding: '8px 24px' }}>
            Create New Project
          </button>
          <button
            onClick={onOpenProjectRoot}
            style={{ padding: '4px 16px', fontSize: 11, opacity: 0.7 }}
          >
            Change Project Root...
          </button>
        </>
      )}
    </div>
  );
}
