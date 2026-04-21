import React from 'react';
import { panelStyles } from '../../styles/panel.js';

const styles = { ...panelStyles };

interface EntityHeaderProps {
  label: string;
  onRemove: () => void;
}

export function EntityHeader({ label, onRemove }: EntityHeaderProps) {
  return (
    <div style={{ ...styles.row, marginBottom: 12 }}>
      <span style={{ ...styles.label, flex: 1 }}>{label}</span>
      <button style={styles.btnDanger} onClick={onRemove}>Remove</button>
    </div>
  );
}
