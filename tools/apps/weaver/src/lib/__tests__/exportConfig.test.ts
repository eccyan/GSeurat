import { describe, it, expect } from 'vitest';
import { exportMultiGroupConfig } from '../exportConfig.js';
import type { WeaverGroupConfig } from '../projectTypes.js';

describe('exportMultiGroupConfig', () => {
  it('exports multiple groups with sequential IDs', () => {
    const groups: WeaverGroupConfig[] = [
      {
        id: 'field', name: 'Field Theme', bpm: 120,
        loop_start: 0, loop_end: 44100, loop_enabled: true,
        markers: [{ frame: 100, name: 'A' }],
        stems: [{ source: 'a.wav', initial_volume: 0.8, muted: false, soloed: true }],
      },
      {
        id: 'dungeon', name: 'Dungeon Theme', bpm: 90,
        loop_start: 1000, loop_end: 50000, loop_enabled: false,
        markers: [],
        stems: [{ source: 'b.wav', initial_volume: 1, muted: true, soloed: false }],
      },
    ];

    const result = exportMultiGroupConfig(44100, groups);

    expect(result.version).toBe(2);
    expect(result.sample_rate).toBe(44100);
    expect(result.track_groups).toHaveLength(2);
    expect(result.track_groups[0].id).toBe(1);
    expect(result.track_groups[1].id).toBe(2);
    expect(result.track_groups[0].name).toBe('Field Theme');
    expect(result.track_groups[1].name).toBe('Dungeon Theme');
  });

  it('strips editor-only fields (muted, soloed)', () => {
    const groups: WeaverGroupConfig[] = [
      {
        id: 'test', name: 'Test', bpm: 120,
        loop_start: 0, loop_end: 1000, loop_enabled: true,
        markers: [],
        stems: [{ source: 'x.wav', initial_volume: 1, muted: true, soloed: true }],
      },
    ];

    const result = exportMultiGroupConfig(44100, groups);
    const stem = result.track_groups[0].stems[0];

    expect(stem).toEqual({ source: 'x.wav', initial_volume: 1 });
    expect('muted' in stem).toBe(false);
    expect('soloed' in stem).toBe(false);
  });

  it('does not include loop_enabled in exported groups', () => {
    const groups: WeaverGroupConfig[] = [
      {
        id: 'test', name: 'Test', bpm: 120,
        loop_start: 0, loop_end: 1000, loop_enabled: false,
        markers: [], stems: [],
      },
    ];

    const result = exportMultiGroupConfig(44100, groups);
    expect('loop_enabled' in result.track_groups[0]).toBe(false);
  });

  it('sorts markers by frame', () => {
    const groups: WeaverGroupConfig[] = [
      {
        id: 'test', name: 'Test', bpm: 120,
        loop_start: 0, loop_end: 1000, loop_enabled: true,
        markers: [{ frame: 300, name: 'B' }, { frame: 100, name: 'A' }],
        stems: [],
      },
    ];

    const result = exportMultiGroupConfig(44100, groups);
    expect(result.track_groups[0].markers[0].name).toBe('A');
    expect(result.track_groups[0].markers[1].name).toBe('B');
  });
});
