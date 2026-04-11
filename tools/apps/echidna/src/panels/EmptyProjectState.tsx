import React from 'react';

interface Props {
  onOpenProjectRoot: () => void;
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#16162a',
    color: '#888',
  },
  heading: {
    fontSize: 22,
    color: '#ccc',
    marginBottom: 12,
  },
  subtext: {
    fontSize: 13,
    color: '#888',
    maxWidth: 420,
    textAlign: 'center',
    lineHeight: 1.5,
    marginBottom: 24,
  },
  button: {
    padding: '10px 24px',
    fontSize: 13,
    fontWeight: 600,
    background: '#3a6a8a',
    color: '#fff',
    border: '1px solid #4a7a9a',
    borderRadius: 6,
    cursor: 'pointer',
  },
};

export function EmptyProjectState({ onOpenProjectRoot }: Props) {
  return (
    <div style={styles.root}>
      <div style={styles.heading}>No project open</div>
      <div style={styles.subtext}>
        Open a project root to browse, edit, and save characters. Project root is a folder on
        your disk containing <code>tools_data/echidna_saves/</code> for editor source files and{' '}
        <code>assets/characters/</code> for the engine-ready PLY + manifest exports.
      </div>
      <button style={styles.button} onClick={onOpenProjectRoot}>
        Open Project Root…
      </button>
    </div>
  );
}
