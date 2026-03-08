import { TestRunner, assert, assertEqual } from './qa-runner.js';

export function runSeuratTests(runner: TestRunner): void {
  runner.test('Store is accessible', async (client) => {
    const state = await client.getState() as Record<string, unknown>;
    assert(state !== null, 'State should not be null');
    assert('activeSection' in state, 'State should have activeSection');
    assert('characters' in state, 'State should have characters');
    assert('manifest' in state, 'State should have manifest');
    assert('aiConfig' in state, 'State should have aiConfig');
    assert('playbackState' in state, 'State should have playbackState');
    assert('reviewFilter' in state, 'State should have reviewFilter');
  });

  runner.test('Default section is dashboard', async (client) => {
    const section = await client.getStateSelector('activeSection');
    assertEqual(section, 'dashboard', 'Default section: dashboard');
  });

  runner.test('Section navigation works', async (client) => {
    const sections = ['concept', 'generate', 'review', 'animate', 'atlas', 'manifest', 'dashboard'] as const;
    for (const s of sections) {
      await client.dispatch('setActiveSection', s);
      const current = await client.getStateSelector('activeSection');
      assertEqual(current, s, `Section: ${s}`);
    }
  });

  runner.test('No character selected by default', async (client) => {
    const id = await client.getStateSelector('selectedCharacterId');
    assertEqual(id, null, 'No character selected');
    const manifest = await client.getStateSelector('manifest');
    assertEqual(manifest, null, 'No manifest loaded');
  });

  runner.test('AI config has defaults', async (client) => {
    const config = await client.getStateSelector('aiConfig') as Record<string, unknown>;
    assert('comfyUrl' in config, 'AI config has comfyUrl');
    assert('steps' in config, 'AI config has steps');
    assert('seed' in config, 'AI config has seed');
    assert('cfg' in config, 'AI config has cfg');
    assert('sampler' in config, 'AI config has sampler');
    assertEqual(config['steps'], 20, 'Default steps = 20');
    assertEqual(config['cfg'], 7, 'Default cfg = 7');
  });

  runner.test('AI config has pixel pass defaults', async (client) => {
    const config = await client.getStateSelector('aiConfig') as Record<string, unknown>;
    assert('pixelPassEnabled' in config, 'AI config has pixelPassEnabled');
    assert('pixelPassDenoise' in config, 'AI config has pixelPassDenoise');
    assertEqual(config['pixelPassEnabled'], true, 'Default pixelPassEnabled = true');
    assertEqual(config['pixelPassDenoise'], 0.35, 'Default pixelPassDenoise = 0.35');
  });

  runner.test('Pixel pass config can be updated', async (client) => {
    await client.dispatch('setAIConfig', { pixelPassEnabled: false, pixelPassDenoise: 0.5 });
    const config = await client.getStateSelector('aiConfig') as Record<string, unknown>;
    assertEqual(config['pixelPassEnabled'], false, 'pixelPassEnabled updated to false');
    assertEqual(config['pixelPassDenoise'], 0.5, 'pixelPassDenoise updated to 0.5');

    // Restore
    await client.dispatch('setAIConfig', { pixelPassEnabled: true, pixelPassDenoise: 0.35 });
  });

  runner.test('Approval actions do not exist', async (client) => {
    const state = await client.getState() as Record<string, unknown>;
    assert(!('approveAnimation' in state) || typeof state['approveAnimation'] !== 'function',
      'approveAnimation should not be an action');
    assert(!('rejectAnimation' in state) || typeof state['rejectAnimation'] !== 'function',
      'rejectAnimation should not be an action');
    assert(!('batchApproveGenerated' in state) || typeof state['batchApproveGenerated'] !== 'function',
      'batchApproveGenerated should not be an action');
  });

  runner.test('AI config can be updated', async (client) => {
    await client.dispatch('setAIConfig', { steps: 30, cfg: 8.5 });
    const config = await client.getStateSelector('aiConfig') as Record<string, unknown>;
    assertEqual(config['steps'], 30, 'Steps updated to 30');
    assertEqual(config['cfg'], 8.5, 'CFG updated to 8.5');

    // Restore
    await client.dispatch('setAIConfig', { steps: 20, cfg: 7 });
  });

  runner.test('Playback state transitions', async (client) => {
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

  runner.test('Current time updates', async (client) => {
    await client.dispatch('setCurrentTime', 1.5);
    const time = await client.getStateSelector('currentTime') as number;
    assert(Math.abs(time - 1.5) < 0.001, `Current time should be ~1.5, got ${time}`);
    await client.dispatch('setCurrentTime', 0);
  });

  runner.test('Review filter works', async (client) => {
    await client.dispatch('setReviewFilter', 'generated');
    let filter = await client.getStateSelector('reviewFilter');
    assertEqual(filter, 'generated', 'Review filter: generated');

    await client.dispatch('setReviewFilter', 'pending');
    filter = await client.getStateSelector('reviewFilter');
    assertEqual(filter, 'pending', 'Review filter: pending');

    await client.dispatch('setReviewFilter', 'all');
    filter = await client.getStateSelector('reviewFilter');
    assertEqual(filter, 'all', 'Review filter: all');
  });

  runner.test('Select clip updates state', async (client) => {
    await client.dispatch('selectClip', 'idle_down');
    const clipName = await client.getStateSelector('selectedClipName');
    assertEqual(clipName, 'idle_down', 'Selected clip name');

    // Selecting a clip resets playback
    const playback = await client.getStateSelector('playbackState');
    assertEqual(playback, 'stopped', 'Playback stopped after clip select');

    const time = await client.getStateSelector('currentTime') as number;
    assertEqual(time, 0, 'Time reset after clip select');

    await client.dispatch('selectClip', null);
  });

  runner.test('Generation jobs lifecycle', async (client) => {
    // Add a job
    const job = { id: 'test_job_1', animName: 'idle_down', frameIndex: 0, status: 'queued' };
    await client.dispatch('addGenerationJob', job);
    let jobs = await client.getStateSelector('generationJobs') as unknown[];
    assertEqual(jobs.length, 1, 'One job added');

    // Update job
    await client.dispatch('updateGenerationJob', 'test_job_1', { status: 'done' });
    jobs = await client.getStateSelector('generationJobs') as Array<Record<string, unknown>>;
    assertEqual(jobs[0]['status'], 'done', 'Job status updated to done');

    // Clear completed
    await client.dispatch('clearCompletedJobs');
    jobs = await client.getStateSelector('generationJobs') as unknown[];
    assertEqual(jobs.length, 0, 'Completed jobs cleared');
  });

  runner.test('Assembly result starts null', async (client) => {
    const result = await client.getStateSelector('assemblyResult');
    assertEqual(result, null, 'No assembly result initially');
  });

  runner.test('Sprite sheet URL starts null', async (client) => {
    const url = await client.getStateSelector('spriteSheetUrl');
    assertEqual(url, null, 'No sprite sheet URL initially');
  });
}
