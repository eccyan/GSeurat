import React from 'react';
import { Vec3Input } from '../../components/Vec3Input.js';
import { panelStyles } from '../../styles/panel.js';

const styles = { ...panelStyles };

type Vec3 = [number, number, number];

interface TransformFieldsProps {
  position: Vec3;
  onPositionChange: (v: Vec3) => void;
  rotation?: Vec3;
  onRotationChange?: (v: Vec3) => void;
}

export function TransformFields({
  position, onPositionChange,
  rotation, onRotationChange,
}: TransformFieldsProps) {
  return (
    <>
      <div style={styles.section}>
        <span style={styles.label}>Position</span>
        <Vec3Input value={position} onChange={onPositionChange} />
      </div>
      {rotation !== undefined && onRotationChange && (
        <div style={styles.section}>
          <span style={styles.label}>Rotation</span>
          <Vec3Input value={rotation} onChange={onRotationChange} />
        </div>
      )}
    </>
  );
}
