import React from 'react';
import { NumberInput } from '../../components/NumberInput.js';
import { Vec3Input } from '../../components/Vec3Input.js';
import type { ComponentSchema, ComponentFieldSchema } from '../../store/types.js';
import { panelStyles } from '../../styles/panel.js';

const styles = { ...panelStyles };

export function ComponentFieldEditor({ field, value, onChange }: {
  field: ComponentFieldSchema;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  switch (field.type) {
    case 'float':
    case 'int':
      return (
        <NumberInput
          value={(value as number) ?? (field.default as number) ?? 0}
          min={field.min}
          max={field.max}
          step={field.step ?? (field.type === 'int' ? 1 : 0.1)}
          onChange={(v) => onChange(v)}
          style={styles.input}
        />
      );
    case 'string':
      return (
        <input
          type="text"
          value={(value as string) ?? (field.default as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          style={styles.input}
        />
      );
    case 'bool':
      return (
        <label style={{ fontSize: 12, color: '#ddd', display: 'flex', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={(value as boolean) ?? (field.default as boolean) ?? false}
            onChange={(e) => onChange(e.target.checked)}
            style={styles.checkbox}
          />
          {field.description || field.name}
        </label>
      );
    case 'vec3':
      return (
        <Vec3Input
          value={(value as [number, number, number]) ?? (field.default as [number, number, number]) ?? [0, 0, 0]}
          onChange={(v) => onChange(v)}
        />
      );
    case 'color':
      return (
        <input
          type="color"
          value={(() => {
            const c = (value as [number, number, number]) ?? (field.default as [number, number, number]) ?? [1, 1, 1];
            return '#' + c.map((v: number) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
          })()}
          onChange={(e) => {
            const hex = e.target.value;
            onChange([
              parseInt(hex.slice(1, 3), 16) / 255,
              parseInt(hex.slice(3, 5), 16) / 255,
              parseInt(hex.slice(5, 7), 16) / 255,
            ]);
          }}
          style={{ width: 40, height: 24, border: 'none', cursor: 'pointer' }}
        />
      );
    case 'enum':
      return (
        <select
          style={styles.select}
          value={(value as string) ?? (field.default as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        >
          {(field.enum_values ?? []).map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      );
    default:
      return (
        <span style={{ fontSize: 11, color: '#666' }}>Unsupported type: {field.type}</span>
      );
  }
}

export function ComponentEditor({ schema, data, onChange, onRemove }: {
  schema: ComponentSchema;
  data: Record<string, unknown>;
  onChange: (field: string, value: unknown) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = React.useState(true);

  return (
    <div style={{ border: '1px solid #333', borderRadius: 4, marginBottom: 8, background: '#1a1a2e' }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px',
          cursor: 'pointer', borderBottom: open ? '1px solid #333' : 'none',
        }}
        onClick={() => setOpen(!open)}
      >
        <span style={{ fontSize: 9, color: '#555' }}>{open ? '\u25BE' : '\u25B8'}</span>
        <span style={{ fontSize: 12, color: '#ccc', flex: 1 }}>{schema.name}</span>
        <button
          style={{
            padding: '0 4px', border: 'none', background: 'transparent',
            color: '#844', cursor: 'pointer', fontSize: 13, lineHeight: '1',
          }}
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
        >&times;</button>
      </div>
      {open && (
        <div style={{ padding: '6px 8px' }}>
          {schema.description && (
            <div style={{ fontSize: 10, color: '#666', marginBottom: 6 }}>{schema.description}</div>
          )}
          {schema.fields.map((field) => (
            <div key={field.name} style={styles.section}>
              <span style={styles.label}>{field.name}</span>
              {field.description && field.type !== 'bool' && (
                <span style={{ fontSize: 10, color: '#555' }}>{field.description}</span>
              )}
              <ComponentFieldEditor
                field={field}
                value={data[field.name]}
                onChange={(v) => onChange(field.name, v)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
