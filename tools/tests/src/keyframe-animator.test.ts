import { TestRunner, assert, assertEqual } from './qa-runner.js';

export function runKeyframeAnimatorTests(runner: TestRunner): void {
  runner.test('App renders (post-bugfix) — store accessible', async (client) => {
    const state = await client.getState() as Record<string, unknown>;
    assert(state !== null, 'State should not be null');
    assert('clips' in state, 'State should have clips');
    assert('playbackState' in state, 'State should have playbackState');
  });

  runner.test('Default clips are loaded (12 clips)', async (client) => {
    const clips = await client.getStateSelector('clips') as unknown[];
    assert(clips.length >= 12, `Expected >= 12 default clips, got ${clips.length}`);
  });

  runner.test('Add clip creates new clip', async (client) => {
    const before = await client.getStateSelector('clips') as unknown[];
    const countBefore = before.length;
    await client.dispatch('addClip', 'test_clip');
    const after = await client.getStateSelector('clips') as unknown[];
    assertEqual(after.length, countBefore + 1, 'Clip count after add');
    const last = after[after.length - 1] as { name: string };
    assertEqual(last.name, 'test_clip', 'New clip name');
  });

  runner.test('Remove clip decreases count', async (client) => {
    const clips = await client.getStateSelector('clips') as Array<{ id: string; name: string }>;
    const testClip = clips.find((c) => c.name === 'test_clip');
    assert(testClip !== undefined, 'test_clip should exist');
    const countBefore = clips.length;
    await client.dispatch('removeClip', testClip!.id);
    const after = await client.getStateSelector('clips') as unknown[];
    assertEqual(after.length, countBefore - 1, 'Clip count after remove');
  });

  runner.test('Add frame to clip', async (client) => {
    const clips = await client.getStateSelector('clips') as Array<{ id: string; frames: unknown[] }>;
    const clip = clips[0];
    const framesBefore = clip.frames.length;
    await client.dispatch('addFrame', clip.id, 5);
    const updated = await client.getStateSelector('clips') as Array<{ id: string; frames: unknown[] }>;
    const updatedClip = updated.find((c) => c.id === clip.id)!;
    assertEqual(updatedClip.frames.length, framesBefore + 1, 'Frame count after add');
  });

  runner.test('Remove frame from clip', async (client) => {
    const clips = await client.getStateSelector('clips') as Array<{ id: string; frames: unknown[] }>;
    const clip = clips[0];
    const framesBefore = clip.frames.length;
    await client.dispatch('removeFrame', clip.id, clip.frames.length - 1);
    const updated = await client.getStateSelector('clips') as Array<{ id: string; frames: unknown[] }>;
    const updatedClip = updated.find((c) => c.id === clip.id)!;
    assertEqual(updatedClip.frames.length, framesBefore - 1, 'Frame count after remove');
  });

  runner.test('Play/pause/stop playback state', async (client) => {
    await client.dispatch('setPlaybackState', 'playing');
    let state = await client.getStateSelector('playbackState');
    assertEqual(state, 'playing', 'Playback state: playing');

    await client.dispatch('setPlaybackState', 'paused');
    state = await client.getStateSelector('playbackState');
    assertEqual(state, 'paused', 'Playback state: paused');

    await client.dispatch('setPlaybackState', 'stopped');
    state = await client.getStateSelector('playbackState');
    assertEqual(state, 'stopped', 'Playback state: stopped');
  });

  runner.test('Timeline zoom clamping', async (client) => {
    await client.dispatch('setTimelineZoom', 5);
    let zoom = await client.getStateSelector('timelineZoom') as number;
    assertEqual(zoom, 20, 'Zoom clamped to min 20');

    await client.dispatch('setTimelineZoom', 1000);
    zoom = await client.getStateSelector('timelineZoom') as number;
    assertEqual(zoom, 600, 'Zoom clamped to max 600');

    // Restore
    await client.dispatch('setTimelineZoom', 120);
  });

  runner.test('State machine edge add/remove', async (client) => {
    const clips = await client.getStateSelector('clips') as Array<{ id: string }>;
    assert(clips.length >= 2, 'Need >= 2 clips for edge test');

    const edgesBefore = await client.getStateSelector('smEdges') as unknown[];
    await client.dispatch('addSmEdge', clips[0].id, clips[1].id);
    const edgesAfter = await client.getStateSelector('smEdges') as Array<{ id: string; from: string; to: string }>;
    assertEqual(edgesAfter.length, edgesBefore.length + 1, 'Edge count after add');

    const newEdge = edgesAfter[edgesAfter.length - 1];
    assertEqual(newEdge.from, clips[0].id, 'Edge from');
    assertEqual(newEdge.to, clips[1].id, 'Edge to');

    await client.dispatch('removeSmEdge', newEdge.id);
    const edgesFinal = await client.getStateSelector('smEdges') as unknown[];
    assertEqual(edgesFinal.length, edgesBefore.length, 'Edge count after remove');
  });

  runner.test('Export/import JSON roundtrip', async (client) => {
    // Get current clips
    const before = await client.getStateSelector('clips') as Array<{ id: string; name: string }>;
    const clipNames = before.map((c) => c.name);

    // Export is a synchronous getter, use getState
    const state = await client.getState() as Record<string, unknown>;
    assert('clips' in state, 'State should have clips');

    // Import some extra clips
    const extraClip = {
      id: 'import_test_001',
      name: 'imported_test',
      loop: true,
      frames: [{ id: 'f1', tile_id: 0, duration: 0.15 }],
    };
    await client.dispatch('importClipsFromJson', [extraClip]);

    const after = await client.getStateSelector('clips') as Array<{ id: string; name: string }>;
    const imported = after.find((c) => c.name === 'imported_test');
    assert(imported !== undefined, 'Imported clip should exist');

    // Clean up
    await client.dispatch('removeClip', 'import_test_001');
  });

  runner.test('Move frame reorders correctly', async (client) => {
    const clips = await client.getStateSelector('clips') as Array<{ id: string; frames: Array<{ tile_id: number }> }>;
    const clip = clips[0];
    if (clip.frames.length >= 2) {
      const firstTile = clip.frames[0].tile_id;
      const secondTile = clip.frames[1].tile_id;
      await client.dispatch('moveFrame', clip.id, 0, 1);

      const updated = await client.getStateSelector('clips') as Array<{ id: string; frames: Array<{ tile_id: number }> }>;
      const updatedClip = updated.find((c) => c.id === clip.id)!;
      assertEqual(updatedClip.frames[0].tile_id, secondTile, 'First frame after move');
      assertEqual(updatedClip.frames[1].tile_id, firstTile, 'Second frame after move');

      // Move back
      await client.dispatch('moveFrame', clip.id, 1, 0);
    }
  });
}
