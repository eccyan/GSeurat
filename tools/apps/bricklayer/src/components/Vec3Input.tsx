import React from 'react';
import { NumberInput } from './NumberInput.js';
import { panelStyles } from '../styles/panel.js';

export interface Vec3InputProps {
  value: [number, number, number];
  onChange: (v: [number, number, number]) => void;
  step?: number;
  label?: string;
  labelPrefix?: string;
  style?: React.CSSProperties;
}

/**
 * Shared 3-component vector input.
 * - If `label` is provided, renders a label span followed by 3 bare NumberInputs (no axis labels).
 * - Otherwise, renders 3 NumberInputs with X/Y/Z labels (optionally prefixed by `labelPrefix`).
 */
export function Vec3Input({
  value,
  onChange,
  step = 0.1,
  label,
  labelPrefix,
  style,
}: Vec3InputProps) {
  const inputStyle = style ?? { ...panelStyles.input, maxWidth: 55 };

  if (label) {
    // Compact mode: label + 3 bare inputs (used by GsEmittersTab)
    return (
      <div style={panelStyles.row}>
        <span style={{ fontSize: 12, minWidth: 70 }}>{label}</span>
        <NumberInput value={value[0]} onChange={(v) => onChange([v, value[1], value[2]])} step={step} style={inputStyle} />
        <NumberInput value={value[1]} onChange={(v) => onChange([value[0], v, value[2]])} step={step} style={inputStyle} />
        <NumberInput value={value[2]} onChange={(v) => onChange([value[0], value[1], v])} step={step} style={inputStyle} />
      </div>
    );
  }

  // Axis-labeled mode: X / Y / Z (used by entities, objects, scene properties)
  return (
    <div style={panelStyles.row}>
      {(['X', 'Y', 'Z'] as const).map((axis, i) => (
        <React.Fragment key={axis}>
          <NumberInput
            label={`${labelPrefix ?? ''}${axis}`}
            step={step}
            value={value[i]}
            onChange={(v) => {
              const next = [...value] as [number, number, number];
              next[i] = v;
              onChange(next);
            }}
            style={inputStyle}
          />
        </React.Fragment>
      ))}
    </div>
  );
}
