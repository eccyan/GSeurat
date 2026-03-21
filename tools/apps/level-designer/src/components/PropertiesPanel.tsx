import React, { useCallback } from 'react';
import { useEditorStore } from '../store/useEditorStore.js';
import {
  NumberSlider,
  ColorPicker,
  Vec2Input,
} from '@gseurat/ui-kit';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{
      padding: '6px 10px 4px',
      color: '#667',
      fontFamily: 'monospace',
      fontSize: 10,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      borderBottom: '1px solid #2e2e2e',
      marginTop: 4,
    }}>
      {title}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{
      padding: '4px 10px',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}>
      <span style={{
        fontFamily: 'monospace',
        fontSize: 10,
        color: '#888',
        marginBottom: 2,
      }}>
        {label}
      </span>
      {children}
    </div>
  );
}

function NumberField({
  value,
  onChange,
  step = 1,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <input
      type="number"
      value={value}
      step={step}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (!isNaN(v)) onChange(v);
      }}
      style={{
        background: '#1e1e1e',
        border: '1px solid #444',
        borderRadius: 3,
        color: '#eee',
        fontFamily: 'monospace',
        fontSize: 12,
        padding: '3px 7px',
        width: '100%',
        boxSizing: 'border-box',
      }}
    />
  );
}

function TextField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{
        background: '#1e1e1e',
        border: '1px solid #444',
        borderRadius: 3,
        color: '#eee',
        fontFamily: 'monospace',
        fontSize: 11,
        padding: '3px 7px',
        width: '100%',
        boxSizing: 'border-box',
      }}
    />
  );
}

function SelectField({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        background: '#1e1e1e',
        border: '1px solid #444',
        borderRadius: 3,
        color: '#eee',
        fontFamily: 'monospace',
        fontSize: 11,
        padding: '3px 7px',
        width: '100%',
        boxSizing: 'border-box',
        cursor: 'pointer',
      }}
    >
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}

function DeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        margin: '8px 10px',
        padding: '5px 10px',
        background: '#3a1a1a',
        border: '1px solid #6a2a2a',
        borderRadius: 4,
        color: '#e07070',
        fontFamily: 'monospace',
        fontSize: 11,
        cursor: 'pointer',
        width: 'calc(100% - 20px)',
      }}
    >
      Remove Entity
    </button>
  );
}

// ---------------------------------------------------------------------------
// Sub-panels
// ---------------------------------------------------------------------------

function TileLayerProperties() {
  const {
    width, height, tileSize,
    ambientColor, setAmbientColor,
    resizeTilemap,
  } = useEditorStore();

  return (
    <>
      <SectionHeader title="Map" />
      <Row label="Width (tiles)">
        <NumberField
          value={width}
          onChange={(v) => resizeTilemap(Math.max(1, Math.round(v)), height, 0)}
        />
      </Row>
      <Row label="Height (tiles)">
        <NumberField
          value={height}
          onChange={(v) => resizeTilemap(width, Math.max(1, Math.round(v)), 0)}
        />
      </Row>
      <Row label="Tile Size (world units)">
        <NumberField value={tileSize} onChange={() => {}} step={0.1} />
      </Row>

      <SectionHeader title="Lighting" />
      <Row label="Ambient Color">
        <ColorPicker value={ambientColor} onChange={setAmbientColor} />
      </Row>
    </>
  );
}

function NpcProperties({ index }: { index: number }) {
  const { npcs, updateNpc, removeNpc } = useEditorStore();
  const npc = npcs[index];
  if (!npc) return null;

  const facingOptions = ['north', 'south', 'east', 'west'];

  return (
    <>
      <SectionHeader title="NPC" />
      <Row label="Name">
        <TextField
          value={npc.name}
          onChange={(v) => updateNpc(index, { name: v })}
          placeholder="npc_name"
        />
      </Row>

      <SectionHeader title="Transform" />
      <Row label="Position X / Z">
        <Vec2Input
          value={[npc.position[0], npc.position[2]]}
          onChange={([x, z]) => updateNpc(index, { position: [x, npc.position[1], z] })}
          step={0.5}
        />
      </Row>
      <Row label="Facing">
        <SelectField
          value={npc.facing}
          options={facingOptions}
          onChange={(v) => updateNpc(index, { facing: v })}
        />
      </Row>

      <SectionHeader title="Appearance" />
      <Row label="Tint">
        <ColorPicker
          value={npc.tint}
          onChange={(c) => updateNpc(index, { tint: c })}
        />
      </Row>

      <SectionHeader title="Patrol" />
      <Row label="Speed">
        <NumberSlider
          value={npc.patrol_speed}
          onChange={(v) => updateNpc(index, { patrol_speed: v })}
          min={0}
          max={10}
          step={0.1}
        />
      </Row>
      <Row label="Pause Interval (s)">
        <NumberSlider
          value={npc.patrol_interval}
          onChange={(v) => updateNpc(index, { patrol_interval: v })}
          min={0}
          max={10}
          step={0.1}
        />
      </Row>

      <SectionHeader title="Dynamic Light" />
      <Row label="Light Color">
        <ColorPicker
          value={npc.light_color}
          onChange={(c) => updateNpc(index, { light_color: c })}
        />
      </Row>
      <Row label="Light Radius">
        <NumberSlider
          value={npc.light_radius}
          onChange={(v) => updateNpc(index, { light_radius: v })}
          min={0}
          max={20}
          step={0.1}
        />
      </Row>

      <SectionHeader title="Dialog" />
      <div style={{ padding: '4px 10px', fontFamily: 'monospace', fontSize: 10, color: '#666' }}>
        {npc.dialog.length === 0
          ? 'No dialog lines.'
          : `${npc.dialog.length} line(s) — edit scene JSON for full dialog.`}
      </div>

      <DeleteButton onClick={() => removeNpc(index)} />
    </>
  );
}

function LightProperties({ index }: { index: number }) {
  const { lights, updateLight, removeLight } = useEditorStore();
  const light = lights[index];
  if (!light) return null;

  return (
    <>
      <SectionHeader title="Point Light" />
      <Row label="Position">
        <Vec2Input
          value={light.position}
          onChange={(v) => updateLight(index, { position: v })}
          step={0.5}
        />
      </Row>

      <SectionHeader title="Shape" />
      <Row label="Radius">
        <NumberSlider
          value={light.radius}
          onChange={(v) => updateLight(index, { radius: v })}
          min={0.5}
          max={20}
          step={0.1}
        />
      </Row>
      <Row label="Height (Z)">
        <NumberSlider
          value={light.height}
          onChange={(v) => updateLight(index, { height: v })}
          min={0}
          max={10}
          step={0.1}
        />
      </Row>

      <SectionHeader title="Color" />
      <Row label="Color (RGB)">
        <ColorPicker
          value={[light.color[0], light.color[1], light.color[2], 1.0]}
          onChange={([r, g, b]) => updateLight(index, { color: [r, g, b] })}
        />
      </Row>
      <Row label="Intensity">
        <NumberSlider
          value={light.intensity}
          onChange={(v) => updateLight(index, { intensity: v })}
          min={0}
          max={5}
          step={0.05}
        />
      </Row>

      <DeleteButton onClick={() => removeLight(index)} />
    </>
  );
}

function PortalProperties({ index }: { index: number }) {
  const { portals, removePortal } = useEditorStore();
  const portal = portals[index];
  if (!portal) return null;

  const facingOptions = ['north', 'south', 'east', 'west'];

  return (
    <>
      <SectionHeader title="Portal" />
      <Row label="Position">
        <Vec2Input
          value={portal.position}
          onChange={() => {}}
          step={0.5}
        />
      </Row>
      <Row label="Size">
        <Vec2Input
          value={portal.size}
          onChange={() => {}}
          step={0.5}
        />
      </Row>

      <SectionHeader title="Destination" />
      <Row label="Target Scene">
        <TextField
          value={portal.target_scene}
          onChange={() => {}}
          placeholder="assets/scenes/room.json"
        />
      </Row>
      <Row label="Spawn X / Z">
        <Vec2Input
          value={[portal.spawn_position[0], portal.spawn_position[2]]}
          onChange={() => {}}
          step={0.5}
        />
      </Row>
      <Row label="Spawn Facing">
        <SelectField
          value={portal.spawn_facing}
          options={facingOptions}
          onChange={() => {}}
        />
      </Row>

      <div style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: 9, color: '#555' }}>
        Portal editing coming soon. Edit scene JSON for full control.
      </div>

      <DeleteButton onClick={() => removePortal(index)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// PropertiesPanel
// ---------------------------------------------------------------------------
export function PropertiesPanel() {
  const { selectedEntity, activeLayer } = useEditorStore();

  let content: React.ReactNode;

  if (selectedEntity === null) {
    // Show layer-level properties
    if (activeLayer === 'tiles' || activeLayer === 'environment') {
      content = <TileLayerProperties />;
    } else if (activeLayer === 'lights') {
      content = (
        <>
          <TileLayerProperties />
          <SectionHeader title="Lights" />
          <div style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: 10, color: '#666' }}>
            Click a light to select it, or use the canvas tools to place new lights.
          </div>
        </>
      );
    } else {
      content = (
        <div style={{ padding: '12px', fontFamily: 'monospace', fontSize: 11, color: '#666' }}>
          Nothing selected.<br /><br />
          Click an entity in the canvas to inspect and edit its properties.
        </div>
      );
    }
  } else if (selectedEntity.type === 'npc') {
    content = <NpcProperties index={selectedEntity.index} />;
  } else if (selectedEntity.type === 'light') {
    content = <LightProperties index={selectedEntity.index} />;
  } else if (selectedEntity.type === 'portal') {
    content = <PortalProperties index={selectedEntity.index} />;
  }

  return (
    <div style={{
      width: 220,
      background: '#222',
      borderLeft: '1px solid #333',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '8px 10px',
        background: '#1e1e1e',
        borderBottom: '1px solid #333',
        fontFamily: 'monospace',
        fontSize: 11,
        color: '#aaa',
        fontWeight: 600,
        letterSpacing: '0.04em',
      }}>
        Properties
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {content}
      </div>
    </div>
  );
}
