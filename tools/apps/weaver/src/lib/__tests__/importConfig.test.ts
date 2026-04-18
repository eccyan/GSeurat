import { describe, it, expect } from 'vitest';
import { migrateV2ToWeaverProject } from '../importConfig.js';
import type { MusicConfigV2 } from '../exportConfig.js';

describe('migrateV2ToWeaverProject', () => {
  const v2Config: MusicConfigV2 = {
    version: 2,
    sample_rate: 44100,
    track_groups: [
      {
        id: 1,
        name: 'Field Theme',
        bpm: 120,
        loop_start: 1000,
        loop_end: 50000,
        markers: [{ frame: 2000, name: 'Drop' }],
        stems: [{ source: 'assets/audio/field/bass.wav', initial_volume: 0.8 }],
      },
    ],
  };

  it('creates a valid WeaverProjectFile', () => {
    const result = migrateV2ToWeaverProject(v2Config, 'my-project');
    expect(result.version).toBe(1);
    expect(result.name).toBe('my-project');
    expect(result.sample_rate).toBe(44100);
    expect(result.groups).toHaveLength(1);
  });

  it('adds editor-only defaults', () => {
    const result = migrateV2ToWeaverProject(v2Config, 'test');
    const group = result.groups[0];
    expect(group.loop_enabled).toBe(true);
    expect(group.stems[0].muted).toBe(false);
    expect(group.stems[0].soloed).toBe(false);
  });

  it('generates slug IDs from group names', () => {
    const result = migrateV2ToWeaverProject(v2Config, 'test');
    expect(result.groups[0].id).toBe('field-theme');
  });

  it('preserves markers and stem data', () => {
    const result = migrateV2ToWeaverProject(v2Config, 'test');
    const group = result.groups[0];
    expect(group.markers).toEqual([{ frame: 2000, name: 'Drop' }]);
    expect(group.stems[0].source).toBe('assets/audio/field/bass.wav');
    expect(group.stems[0].initial_volume).toBe(0.8);
  });
});
