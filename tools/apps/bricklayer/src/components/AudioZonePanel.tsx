import React from 'react';
import type { AudioZoneData } from '../store/types.js';

interface AudioZonePanelProps {
  data: AudioZoneData;
  trackGroupOptions: string[];
  onChange: (next: AudioZoneData) => void;
}

const ACTION_OPTIONS = ['play', 'play_or_transition', 'stop'] as const;

export function AudioZonePanel({ data, trackGroupOptions, onChange }: AudioZonePanelProps) {
  const set = (k: keyof AudioZoneData, v: unknown) => onChange({ ...data, [k]: v });
  const setEnter = (k: string, v: unknown) =>
    set('on_enter', { ...data.on_enter, [k]: v });
  const setExit = (k: string, v: unknown) =>
    set('on_exit', { ...data.on_exit, [k]: v });

  return (
    <fieldset style={{ border: '1px solid #555', padding: 8, marginTop: 8 }}>
      <legend>Audio Zone</legend>

      <label style={{ display: 'block', marginBottom: 4 }}>
        Track Group
        <select
          value={data.track_group_name ?? ''}
          onChange={e => set('track_group_name', e.target.value)}
          style={{ marginLeft: 8 }}
        >
          <option value="">(none)</option>
          {trackGroupOptions.map(n => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </label>

      <h4 style={{ margin: '8px 0 4px' }}>On Enter</h4>
      <label style={{ display: 'block', marginBottom: 4 }}>
        Action
        <select
          value={data.on_enter?.action ?? 'play'}
          onChange={e => setEnter('action', e.target.value)}
          style={{ marginLeft: 8 }}
        >
          {ACTION_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </label>
      <label style={{ display: 'block', marginBottom: 4 }}>
        Xfade (ms)
        <input
          type="number"
          value={data.on_enter?.xfade_ms ?? 1000}
          onChange={e => setEnter('xfade_ms', Number(e.target.value))}
          min={0} max={5000} step={100}
          style={{ marginLeft: 8, width: 80 }}
        />
      </label>
      <label style={{ display: 'block', marginBottom: 4 }}>
        <input
          type="checkbox"
          checked={data.on_enter?.align_to_next_marker ?? true}
          onChange={e => setEnter('align_to_next_marker', e.target.checked)}
        />
        {' '}Align to next marker
      </label>

      <h4 style={{ margin: '8px 0 4px' }}>On Exit</h4>
      <label style={{ display: 'block', marginBottom: 4 }}>
        Action
        <select
          value={data.on_exit?.action ?? 'stop'}
          onChange={e => setExit('action', e.target.value)}
          style={{ marginLeft: 8 }}
        >
          {ACTION_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </label>
      <label style={{ display: 'block', marginBottom: 4 }}>
        Fade (ms)
        <input
          type="number"
          value={data.on_exit?.fade_ms ?? 500}
          onChange={e => setExit('fade_ms', Number(e.target.value))}
          min={0} max={5000} step={100}
          style={{ marginLeft: 8, width: 80 }}
        />
      </label>
    </fieldset>
  );
}
