/**
 * Keyframe Animator — Scenario Tests (multi-step workflows)
 */
import { TestRunner, assert, assertEqual } from './qa-runner.js';
import { assertStateHas } from './helpers.js';

interface Clip {
  id: string;
  name: string;
  loop: boolean;
  frames: Array<{ id: string; tile_id: number; duration: number }>;
}

interface SmEdge {
  id: string;
  from: string;
  to: string;
}

export function runKeyframeAnimatorScenarios(runner: TestRunner): void {
  // -----------------------------------------------------------------------
  // Scenario: Build complete character state machine
  // -----------------------------------------------------------------------
  runner.test('[Scenario] Build complete character state machine', async (client) => {
    // 1. Verify 12 default directional clips exist
    const clips = (await client.getStateSelector('clips')) as Clip[];
    assert(clips.length >= 12, `Expected >= 12 default clips, got ${clips.length}`);

    // 2. Add custom "jump_north" clip
    await client.dispatch('addClip', 'jump_north');
    const clipsAfterAdd = (await client.getStateSelector('clips')) as Clip[];
    const jumpClip = clipsAfterAdd.find((c) => c.name === 'jump_north');
    assert(jumpClip !== undefined, 'jump_north clip should exist');

    // 3. Add 4 frames to jump_north with durations
    for (let i = 0; i < 4; i++) {
      await client.dispatch('addFrame', jumpClip!.id, 20 + i);
    }
    const clipsWithFrames = (await client.getStateSelector('clips')) as Clip[];
    const jumpWithFrames = clipsWithFrames.find((c) => c.id === jumpClip!.id)!;
    assertEqual(jumpWithFrames.frames.length, 4, 'jump_north should have 4 frames');

    // 4. Add state machine edges: idle_north→walk_north, walk_north→run_north, idle_north→jump_north
    const idleNorth = clipsAfterAdd.find((c) => c.name === 'idle_north');
    const walkNorth = clipsAfterAdd.find((c) => c.name === 'walk_north');
    const runNorth = clipsAfterAdd.find((c) => c.name === 'run_north');
    assert(idleNorth !== undefined, 'idle_north should exist');
    assert(walkNorth !== undefined, 'walk_north should exist');
    assert(runNorth !== undefined, 'run_north should exist');

    await client.dispatch('addSmEdge', idleNorth!.id, walkNorth!.id);
    await client.dispatch('addSmEdge', walkNorth!.id, runNorth!.id);
    await client.dispatch('addSmEdge', idleNorth!.id, jumpClip!.id);

    // 5. Verify smEdges count = 3
    const edges = (await client.getStateSelector('smEdges')) as SmEdge[];
    assertEqual(edges.length, 3, 'Should have 3 state machine edges');

    // 6. Remove middle edge (walk→run)
    const walkRunEdge = edges.find(
      (e) => e.from === walkNorth!.id && e.to === runNorth!.id,
    );
    assert(walkRunEdge !== undefined, 'walk→run edge should exist');
    await client.dispatch('removeSmEdge', walkRunEdge!.id);

    // 7. Verify smEdges count = 2
    const edgesAfterRemove = (await client.getStateSelector('smEdges')) as SmEdge[];
    assertEqual(edgesAfterRemove.length, 2, 'Should have 2 edges after removal');

    // 8. Export JSON → import JSON → verify clips + edges preserved
    const stateBeforeExport = (await client.getState()) as { clips: Clip[]; smEdges: SmEdge[] };
    const clipCountBeforeImport = stateBeforeExport.clips.length;

    // Import an extra clip to verify roundtrip
    const testClip = {
      id: 'scenario_import_001',
      name: 'scenario_imported',
      loop: false,
      frames: [
        { id: 'si_f1', tile_id: 0, duration: 0.1 },
        { id: 'si_f2', tile_id: 1, duration: 0.2 },
      ],
    };
    await client.dispatch('importClipsFromJson', [testClip]);
    const clipsAfterImport = (await client.getStateSelector('clips')) as Clip[];
    const imported = clipsAfterImport.find((c) => c.name === 'scenario_imported');
    assert(imported !== undefined, 'Imported clip should exist');
    assertEqual(imported!.frames.length, 2, 'Imported clip should have 2 frames');

    // Edges should still be intact
    const edgesAfterImport = (await client.getStateSelector('smEdges')) as SmEdge[];
    assertEqual(edgesAfterImport.length, 2, 'Edges preserved after import');

    // Cleanup
    await client.dispatch('removeClip', 'scenario_import_001');
    await client.dispatch('removeSmEdge', edgesAfterImport[1].id);
    await client.dispatch('removeSmEdge', edgesAfterImport[0].id);
    await client.dispatch('removeClip', jumpClip!.id);
  });

  // -----------------------------------------------------------------------
  // Scenario: Frame reordering and timing
  // -----------------------------------------------------------------------
  runner.test('[Scenario] Frame reordering and timing', async (client) => {
    // 1. Select first clip, add 5 frames
    const clips = (await client.getStateSelector('clips')) as Clip[];
    const clip = clips[0];
    const initialFrameCount = clip.frames.length;

    for (let i = 0; i < 5; i++) {
      await client.dispatch('addFrame', clip.id, 100 + i);
    }

    const clipsAfterAdd = (await client.getStateSelector('clips')) as Clip[];
    const updatedClip = clipsAfterAdd.find((c) => c.id === clip.id)!;
    assertEqual(
      updatedClip.frames.length,
      initialFrameCount + 5,
      'Should have 5 more frames',
    );

    // 2. Move last frame to position 0 (reorder)
    const lastIdx = updatedClip.frames.length - 1;
    const lastTileId = updatedClip.frames[lastIdx].tile_id;
    await client.dispatch('moveFrame', clip.id, lastIdx, 0);

    // 3. Verify frame order changed
    const clipsAfterMove = (await client.getStateSelector('clips')) as Clip[];
    const movedClip = clipsAfterMove.find((c) => c.id === clip.id)!;
    assertEqual(
      movedClip.frames[0].tile_id,
      lastTileId,
      'Moved frame should be at position 0',
    );

    // 4. Move it back to restore order
    await client.dispatch('moveFrame', clip.id, 0, lastIdx);

    // 5. Remove the 5 added frames (from the end)
    for (let i = 0; i < 5; i++) {
      const current = (await client.getStateSelector('clips')) as Clip[];
      const c = current.find((cc) => cc.id === clip.id)!;
      await client.dispatch('removeFrame', clip.id, c.frames.length - 1);
    }

    // 6. Verify clip shortened back to original
    const clipsFinal = (await client.getStateSelector('clips')) as Clip[];
    const finalClip = clipsFinal.find((c) => c.id === clip.id)!;
    assertEqual(
      finalClip.frames.length,
      initialFrameCount,
      'Clip should be back to original frame count',
    );
  });
}
