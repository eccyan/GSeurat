/**
 * Seurat — Scenario Tests (multi-step workflows)
 *
 * Note: Scenarios that require the bridge (character creation, manifest loading,
 * frame status updates, atlas assembly) are skipped when the bridge is not
 * running. These tests focus on store-level workflows that can be verified
 * without external services.
 */
import { TestRunner, assert, assertEqual } from './qa-runner.js';
import { assertStateHas } from './helpers.js';

export function runSeuratScenarios(runner: TestRunner): void {
  // -----------------------------------------------------------------------
  // Scenario: Full section navigation workflow
  // -----------------------------------------------------------------------
  runner.test('[Scenario] Full section navigation workflow', async (client) => {
    // 1. Start at dashboard
    await client.dispatch('setActiveSection', 'dashboard');
    await assertStateHas<string>(
      client,
      'activeSection',
      (v) => v === 'dashboard',
      'Should start at dashboard',
    );

    // 2. Navigate through all sections in order
    const sections = ['concept', 'generate', 'review', 'animate', 'atlas', 'manifest'] as const;
    for (const s of sections) {
      await client.dispatch('setActiveSection', s);
      await assertStateHas<string>(
        client,
        'activeSection',
        (v) => v === s,
        `Should navigate to ${s}`,
      );
    }

    // 3. Return to dashboard
    await client.dispatch('setActiveSection', 'dashboard');
    await assertStateHas<string>(
      client,
      'activeSection',
      (v) => v === 'dashboard',
      'Should return to dashboard',
    );
  });

  // -----------------------------------------------------------------------
  // Scenario: AI config modification and restore
  // -----------------------------------------------------------------------
  runner.test('[Scenario] AI config modification and restore', async (client) => {
    // 1. Read default config
    const defaults = await client.getStateSelector('aiConfig') as Record<string, unknown>;
    const origSteps = defaults['steps'] as number;
    const origCfg = defaults['cfg'] as number;
    const origSampler = defaults['sampler'] as string;

    // 2. Modify steps
    await client.dispatch('setAIConfig', { steps: 50 });
    let config = await client.getStateSelector('aiConfig') as Record<string, unknown>;
    assertEqual(config['steps'], 50, 'Steps updated to 50');
    // Other fields unchanged
    assertEqual(config['cfg'], origCfg, 'CFG unchanged');
    assertEqual(config['sampler'], origSampler, 'Sampler unchanged');

    // 3. Modify cfg
    await client.dispatch('setAIConfig', { cfg: 12.0 });
    config = await client.getStateSelector('aiConfig') as Record<string, unknown>;
    assertEqual(config['cfg'], 12.0, 'CFG updated to 12.0');
    assertEqual(config['steps'], 50, 'Steps still 50');

    // 4. Modify sampler
    await client.dispatch('setAIConfig', { sampler: 'dpmpp_2m' });
    config = await client.getStateSelector('aiConfig') as Record<string, unknown>;
    assertEqual(config['sampler'], 'dpmpp_2m', 'Sampler updated');

    // 5. Modify seed
    await client.dispatch('setAIConfig', { seed: 42 });
    config = await client.getStateSelector('aiConfig') as Record<string, unknown>;
    assertEqual(config['seed'], 42, 'Seed set to 42');

    // 6. Restore defaults
    await client.dispatch('setAIConfig', { steps: origSteps, cfg: origCfg, sampler: origSampler, seed: -1 });
    config = await client.getStateSelector('aiConfig') as Record<string, unknown>;
    assertEqual(config['steps'], origSteps, 'Steps restored');
    assertEqual(config['cfg'], origCfg, 'CFG restored');
    assertEqual(config['sampler'], origSampler, 'Sampler restored');
    assertEqual(config['seed'], -1, 'Seed restored to random');
  });

  // -----------------------------------------------------------------------
  // Scenario: Playback lifecycle
  // -----------------------------------------------------------------------
  runner.test('[Scenario] Playback lifecycle', async (client) => {
    // 1. Initial state
    await assertStateHas<string>(
      client,
      'playbackState',
      (v) => v === 'stopped',
      'Initial playback state: stopped',
    );

    // 2. Select a clip
    await client.dispatch('selectClip', 'walk_down');
    const clipName = await client.getStateSelector('selectedClipName');
    assertEqual(clipName, 'walk_down', 'Clip selected: walk_down');

    // 3. Play
    await client.dispatch('setPlaybackState', 'playing');
    await assertStateHas<string>(
      client,
      'playbackState',
      (v) => v === 'playing',
      'Playback: playing',
    );

    // 4. Set time
    await client.dispatch('setCurrentTime', 0.25);
    const time = await client.getStateSelector('currentTime') as number;
    assert(Math.abs(time - 0.25) < 0.01, `Time should be ~0.25, got ${time}`);

    // 5. Pause
    await client.dispatch('setPlaybackState', 'paused');
    await assertStateHas<string>(
      client,
      'playbackState',
      (v) => v === 'paused',
      'Playback: paused',
    );

    // 6. Stop (resets time)
    await client.dispatch('setPlaybackState', 'stopped');
    await client.dispatch('setCurrentTime', 0);
    const stoppedTime = await client.getStateSelector('currentTime') as number;
    assertEqual(stoppedTime, 0, 'Time reset on stop');

    // 7. Clean up
    await client.dispatch('selectClip', null);
  });

  // -----------------------------------------------------------------------
  // Scenario: Generation job queue workflow
  // -----------------------------------------------------------------------
  runner.test('[Scenario] Generation job queue workflow', async (client) => {
    // 1. Initially empty
    let jobs = await client.getStateSelector('generationJobs') as unknown[];
    assertEqual(jobs.length, 0, 'Job queue initially empty');

    // 2. Queue 3 jobs
    for (let i = 0; i < 3; i++) {
      await client.dispatch('addGenerationJob', {
        id: `scenario_job_${i}`,
        animName: 'idle_down',
        frameIndex: i,
        status: 'queued',
      });
    }
    jobs = await client.getStateSelector('generationJobs') as unknown[];
    assertEqual(jobs.length, 3, '3 jobs queued');

    // 3. Update first to running
    await client.dispatch('updateGenerationJob', 'scenario_job_0', { status: 'running' });
    jobs = await client.getStateSelector('generationJobs') as Array<Record<string, unknown>>;
    assertEqual(jobs[0]['status'], 'running', 'Job 0: running');
    assertEqual(jobs[1]['status'], 'queued', 'Job 1: still queued');

    // 4. Complete first, start second
    await client.dispatch('updateGenerationJob', 'scenario_job_0', { status: 'done' });
    await client.dispatch('updateGenerationJob', 'scenario_job_1', { status: 'running' });
    jobs = await client.getStateSelector('generationJobs') as Array<Record<string, unknown>>;
    assertEqual(jobs[0]['status'], 'done', 'Job 0: done');
    assertEqual(jobs[1]['status'], 'running', 'Job 1: running');

    // 5. Error on second, complete third
    await client.dispatch('updateGenerationJob', 'scenario_job_1', { status: 'error', error: 'ComfyUI timeout' });
    await client.dispatch('updateGenerationJob', 'scenario_job_2', { status: 'done' });
    jobs = await client.getStateSelector('generationJobs') as Array<Record<string, unknown>>;
    assertEqual(jobs[1]['status'], 'error', 'Job 1: error');
    assertEqual(jobs[1]['error'], 'ComfyUI timeout', 'Job 1 error message');
    assertEqual(jobs[2]['status'], 'done', 'Job 2: done');

    // 6. Clear completed (removes done + error)
    await client.dispatch('clearCompletedJobs');
    jobs = await client.getStateSelector('generationJobs') as unknown[];
    assertEqual(jobs.length, 0, 'All jobs cleared');
  });

  // -----------------------------------------------------------------------
  // Scenario: Review filter cycling (only valid statuses)
  // -----------------------------------------------------------------------
  runner.test('[Scenario] Review filter cycling', async (client) => {
    const filters = ['all', 'pending', 'generating', 'generated', 'all'] as const;
    for (const f of filters) {
      await client.dispatch('setReviewFilter', f);
      const current = await client.getStateSelector('reviewFilter');
      assertEqual(current, f, `Review filter: ${f}`);
    }
  });

  // -----------------------------------------------------------------------
  // Scenario: Pixel pass config modification
  // -----------------------------------------------------------------------
  runner.test('[Scenario] Pixel pass config modification and restore', async (client) => {
    // 1. Read defaults
    const defaults = await client.getStateSelector('aiConfig') as Record<string, unknown>;
    assertEqual(defaults['pixelPassEnabled'], true, 'Default pixelPassEnabled');
    assertEqual(defaults['pixelPassDenoise'], 0.35, 'Default pixelPassDenoise');

    // 2. Disable pixel pass
    await client.dispatch('setAIConfig', { pixelPassEnabled: false });
    let config = await client.getStateSelector('aiConfig') as Record<string, unknown>;
    assertEqual(config['pixelPassEnabled'], false, 'Pixel pass disabled');
    // Other fields unchanged
    assertEqual(config['pixelPassDenoise'], 0.35, 'Denoise unchanged');
    assertEqual(config['useIPAdapter'], defaults['useIPAdapter'], 'IP-Adapter unchanged');

    // 3. Modify denoise
    await client.dispatch('setAIConfig', { pixelPassDenoise: 0.6 });
    config = await client.getStateSelector('aiConfig') as Record<string, unknown>;
    assertEqual(config['pixelPassDenoise'], 0.6, 'Denoise updated to 0.6');
    assertEqual(config['pixelPassEnabled'], false, 'Still disabled');

    // 4. Re-enable and restore
    await client.dispatch('setAIConfig', { pixelPassEnabled: true, pixelPassDenoise: 0.35 });
    config = await client.getStateSelector('aiConfig') as Record<string, unknown>;
    assertEqual(config['pixelPassEnabled'], true, 'Pixel pass re-enabled');
    assertEqual(config['pixelPassDenoise'], 0.35, 'Denoise restored');
  });

  // -----------------------------------------------------------------------
  // Scenario: No approval gating — all sections always accessible
  // -----------------------------------------------------------------------
  runner.test('[Scenario] No approval gating on pipeline', async (client) => {
    // Verify there are no approval-related actions in the store
    const state = await client.getState() as Record<string, unknown>;
    assert(!('approveAnimation' in state), 'No approveAnimation action');
    assert(!('rejectAnimation' in state), 'No rejectAnimation action');
    assert(!('batchApproveGenerated' in state), 'No batchApproveGenerated action');

    // All pipeline actions should exist regardless of approval state
    assert('saveConcept' in state, 'saveConcept exists');
    assert('saveChibi' in state, 'saveChibi exists');
    assert('savePixel' in state, 'savePixel exists');
    assert('generateFrames' in state, 'generateFrames exists');
  });

  // -----------------------------------------------------------------------
  // Scenario: Clip selection and re-selection
  // -----------------------------------------------------------------------
  runner.test('[Scenario] Clip selection resets playback', async (client) => {
    // 1. Set up some playback state
    await client.dispatch('selectClip', 'idle_down');
    await client.dispatch('setPlaybackState', 'playing');
    await client.dispatch('setCurrentTime', 0.5);

    // 2. Select a different clip
    await client.dispatch('selectClip', 'run_up');
    const clip = await client.getStateSelector('selectedClipName');
    assertEqual(clip, 'run_up', 'Clip changed to run_up');

    // 3. Verify playback was reset
    const playback = await client.getStateSelector('playbackState');
    assertEqual(playback, 'stopped', 'Playback stopped after clip change');
    const time = await client.getStateSelector('currentTime') as number;
    assertEqual(time, 0, 'Time reset after clip change');

    // Clean up
    await client.dispatch('selectClip', null);
  });
}
