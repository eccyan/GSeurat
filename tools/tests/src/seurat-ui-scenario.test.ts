/**
 * Seurat — Puppeteer Scenario Tests
 *
 * Multi-step workflow tests combining test harness (store injection)
 * with Puppeteer (DOM interactions). Requires both:
 *   - Seurat dev server on port 5179
 *   - Test harness WebSocket on port 6179
 *
 * Usage:
 *   cd tools/tests && pnpm test:seurat:scenario-ui
 */
import { existsSync } from 'fs';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { TestClient } from '@vulkan-game-tools/test-harness';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEV_PORT = 5179;
const HARNESS_PORT = 6179;
const DEV_URL = `http://localhost:${DEV_PORT}/`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

function findChromePath(): string {
  const paths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ];
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  throw new Error('Chrome/Chromium not found.');
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** A minimal manifest for injecting into the store */
function mockManifest() {
  return {
    version: 1,
    character_id: 'test_hero',
    display_name: 'Test Hero',
    concept: {
      description: '',
      style_prompt: '',
      negative_prompt: '',
      reference_images: [],
    },
    spritesheet: {
      frame_width: 128,
      frame_height: 128,
      columns: 4,
    },
    animations: [
      {
        name: 'idle_south',
        row: 0,
        loop: true,
        frames: [
          { index: 0, file: 'idle_south_0.png', status: 'pending', duration_ms: 200 },
          { index: 1, file: 'idle_south_1.png', status: 'generated', duration_ms: 200 },
          { index: 2, file: 'idle_south_2.png', status: 'generated', duration_ms: 200 },
          { index: 3, file: 'idle_south_3.png', status: 'pending', duration_ms: 200 },
        ],
      },
      {
        name: 'walk_south',
        row: 1,
        loop: true,
        frames: [
          { index: 0, file: 'walk_south_0.png', status: 'pending', duration_ms: 150 },
          { index: 1, file: 'walk_south_1.png', status: 'pending', duration_ms: 150 },
          { index: 2, file: 'walk_south_2.png', status: 'generated', duration_ms: 150 },
          { index: 3, file: 'walk_south_3.png', status: 'generated', duration_ms: 150 },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

type ScenarioFn = (page: Page, client: TestClient) => Promise<void>;

class ScenarioRunner {
  private tests: Array<{ name: string; fn: ScenarioFn }> = [];

  scenario(name: string, fn: ScenarioFn): void {
    this.tests.push({ name, fn });
  }

  async run(page: Page, client: TestClient): Promise<TestResult[]> {
    const results: TestResult[] = [];
    for (const { name, fn } of this.tests) {
      // Reset to dashboard before each scenario
      try {
        await client.dispatch('setActiveSection', 'dashboard');
        await sleep(200);
      } catch { /* ignore if dispatch fails */ }

      try {
        await fn(page, client);
        results.push({ name, passed: true });
      } catch (err) {
        results.push({
          name,
          passed: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return results;
  }
}

// ---------------------------------------------------------------------------
// Scenario: Full section navigation
// ---------------------------------------------------------------------------

function registerScenarios(runner: ScenarioRunner): void {
  // -------------------------------------------------------------------------
  // Scenario 1: Navigate all sections with a loaded character
  // -------------------------------------------------------------------------
  runner.scenario('Full section navigation with character loaded', async (page, client) => {
    // Inject manifest + select character via store
    await client.dispatch('setActiveSection', 'dashboard');
    // Set manifest and selectedCharacterId directly in the store
    const manifest = mockManifest();
    // Use dispatch to set state — the store has setState exposed via test harness
    await client.dispatch('selectCharacterDirect', manifest);
    await sleep(400);

    const sections = ['concept', 'generate', 'review', 'animate', 'atlas', 'manifest'] as const;
    const viewTestIds = [
      'concept-view',
      'generate-view',
      'review-view',
      'animate-view',
      'atlas-view',
      'manifest-view',
    ];

    for (let i = 0; i < sections.length; i++) {
      // Click sidebar nav
      await page.click(`[data-testid="nav-${sections[i]}"]`);
      await sleep(400);

      // Verify the section view rendered
      const el = await page.$(`[data-testid="${viewTestIds[i]}"]`);
      if (!el) {
        throw new Error(`Section "${sections[i]}" did not render [data-testid="${viewTestIds[i]}"]`);
      }
    }

    // Navigate back to dashboard
    await page.click('[data-testid="nav-dashboard"]');
    await sleep(300);
    const newCharBtn = await page.$('[data-testid="new-character-btn"]');
    if (!newCharBtn) throw new Error('Dashboard did not render after nav back');
  });

  // -------------------------------------------------------------------------
  // Scenario 2: Concept editing workflow
  // -------------------------------------------------------------------------
  runner.scenario('Concept editing: type description and style prompt', async (page, client) => {
    await client.dispatch('selectCharacterDirect', mockManifest());
    await sleep(300);

    // Navigate to concept
    await page.click('[data-testid="nav-concept"]');
    await sleep(400);

    const conceptView = await page.$('[data-testid="concept-view"]');
    if (!conceptView) throw new Error('Concept view not rendered');

    // Type into description
    const descInput = await page.$('[data-testid="concept-description"]');
    if (!descInput) throw new Error('Description textarea not found');
    await descInput.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type('[data-testid="concept-description"]', 'A brave knight');
    await sleep(100);

    const descValue = await page.$eval(
      '[data-testid="concept-description"]',
      (el) => (el as HTMLTextAreaElement).value,
    );
    if (descValue !== 'A brave knight') {
      throw new Error(`Expected description "A brave knight", got "${descValue}"`);
    }

    // Type into style prompt
    const styleInput = await page.$('[data-testid="concept-style-prompt"]');
    if (!styleInput) throw new Error('Style prompt textarea not found');
    await styleInput.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type('[data-testid="concept-style-prompt"]', 'pixel art, 128x128');
    await sleep(100);

    const styleValue = await page.$eval(
      '[data-testid="concept-style-prompt"]',
      (el) => (el as HTMLTextAreaElement).value,
    );
    if (styleValue !== 'pixel art, 128x128') {
      throw new Error(`Expected style "pixel art, 128x128", got "${styleValue}"`);
    }

    // Verify Save button exists and is enabled
    const saveBtn = await page.$('[data-testid="concept-save-btn"]');
    if (!saveBtn) throw new Error('Save button not found');
    const saveBtnDisabled = await page.$eval(
      '[data-testid="concept-save-btn"]',
      (el) => (el as HTMLButtonElement).disabled,
    );
    if (saveBtnDisabled) throw new Error('Save button should be enabled');

    // Verify no Approve button (approval system removed)
    const approveBtn = await page.$('[data-testid="concept-approve-btn"]');
    if (approveBtn) throw new Error('Approve button should not exist (approval system removed)');
  });

  // -------------------------------------------------------------------------
  // Scenario 3: Review filter cycling
  // -------------------------------------------------------------------------
  runner.scenario('Review: cycle through filter tabs and verify grid changes', async (page, client) => {
    await client.dispatch('selectCharacterDirect', mockManifest());
    await sleep(300);

    await page.click('[data-testid="nav-review"]');
    await sleep(400);

    const reviewView = await page.$('[data-testid="review-view"]');
    if (!reviewView) throw new Error('Review view not rendered');

    // Default filter is "all" — should show all 8 frames across 2 animations
    const allCells = await page.$$('[data-testid^="frame-cell-"]');
    if (allCells.length !== 8) {
      throw new Error(`Expected 8 frame cells with filter=all, got ${allCells.length}`);
    }

    // Click "Pending" filter
    await page.click('[data-testid="review-filter-pending"]');
    await sleep(300);
    const pendingCells = await page.$$('[data-testid^="frame-cell-"]');
    // 2 pending in idle_south + 2 pending in walk_south = 4
    if (pendingCells.length !== 4) {
      throw new Error(`Expected 4 pending cells, got ${pendingCells.length}`);
    }

    // Click "Generated" filter
    await page.click('[data-testid="review-filter-generated"]');
    await sleep(300);
    const generatedCells = await page.$$('[data-testid^="frame-cell-"]');
    // 2 generated in idle_south + 2 generated in walk_south = 4
    if (generatedCells.length !== 4) {
      throw new Error(`Expected 4 generated cells, got ${generatedCells.length}`);
    }

    // Back to "All"
    await page.click('[data-testid="review-filter-all"]');
    await sleep(300);
    const allAgain = await page.$$('[data-testid^="frame-cell-"]');
    if (allAgain.length !== 8) {
      throw new Error(`Expected 8 cells after resetting to all, got ${allAgain.length}`);
    }
  });

  // -------------------------------------------------------------------------
  // Scenario 4: Generate view — scope buttons
  // -------------------------------------------------------------------------
  runner.scenario('Generate: scope button cycling and UI state', async (page, client) => {
    await client.dispatch('selectCharacterDirect', mockManifest());
    await sleep(300);

    await page.click('[data-testid="nav-generate"]');
    await sleep(400);

    const genView = await page.$('[data-testid="generate-view"]');
    if (!genView) throw new Error('Generate view not rendered');

    // Default scope is "row" — verify button styling (active = background #1e2a42)
    const rowBg = await page.$eval(
      '[data-testid="gen-scope-row"]',
      (el) => window.getComputedStyle(el).backgroundColor,
    );
    if (!rowBg.includes('30, 42, 66')) {
      // #1e2a42 = rgb(30, 42, 66)
      throw new Error(`Row scope button should be active, got background "${rowBg}"`);
    }

    // Click "Single Frame"
    await page.click('[data-testid="gen-scope-single"]');
    await sleep(200);
    const singleBg = await page.$eval(
      '[data-testid="gen-scope-single"]',
      (el) => window.getComputedStyle(el).backgroundColor,
    );
    if (!singleBg.includes('30, 42, 66')) {
      throw new Error(`Single scope button should be active after click, got "${singleBg}"`);
    }

    // Click "All Pending"
    await page.click('[data-testid="gen-scope-all_pending"]');
    await sleep(200);
    const allBg = await page.$eval(
      '[data-testid="gen-scope-all_pending"]',
      (el) => window.getComputedStyle(el).backgroundColor,
    );
    if (!allBg.includes('30, 42, 66')) {
      throw new Error(`All Pending scope button should be active, got "${allBg}"`);
    }

    // Verify Generate button exists
    const genBtn = await page.$('[data-testid="gen-generate-btn"]');
    if (!genBtn) throw new Error('Generate button not found');
  });

  // -------------------------------------------------------------------------
  // Scenario 5: Animate view — clip selection
  // -------------------------------------------------------------------------
  runner.scenario('Animate: select clips and verify UI updates', async (page, client) => {
    await client.dispatch('selectCharacterDirect', mockManifest());
    await sleep(300);

    await page.click('[data-testid="nav-animate"]');
    await sleep(400);

    const animView = await page.$('[data-testid="animate-view"]');
    if (!animView) throw new Error('Animate view not rendered');

    // Verify clip list rendered
    const clipList = await page.$('[data-testid="animate-clip-list"]');
    if (!clipList) throw new Error('Clip list not rendered');

    // Click idle_south clip
    const idleClip = await page.$('[data-testid="animate-clip-idle_south"]');
    if (!idleClip) throw new Error('idle_south clip button not found');
    await idleClip.click();
    await sleep(300);

    // Verify active styling (background = #1e2a42)
    const idleBg = await page.$eval(
      '[data-testid="animate-clip-idle_south"]',
      (el) => window.getComputedStyle(el).backgroundColor,
    );
    if (!idleBg.includes('30, 42, 66')) {
      throw new Error(`idle_south clip should be active, got background "${idleBg}"`);
    }

    // Click walk_south clip
    const walkClip = await page.$('[data-testid="animate-clip-walk_south"]');
    if (!walkClip) throw new Error('walk_south clip button not found');
    await walkClip.click();
    await sleep(300);

    // walk_south should now be active
    const walkBg = await page.$eval(
      '[data-testid="animate-clip-walk_south"]',
      (el) => window.getComputedStyle(el).backgroundColor,
    );
    if (!walkBg.includes('30, 42, 66')) {
      throw new Error(`walk_south clip should be active after click, got "${walkBg}"`);
    }

    // idle_south should no longer be active
    const idleBgAfter = await page.$eval(
      '[data-testid="animate-clip-idle_south"]',
      (el) => window.getComputedStyle(el).backgroundColor,
    );
    if (idleBgAfter.includes('30, 42, 66')) {
      throw new Error('idle_south clip should not be active after selecting walk_south');
    }
  });

  // -------------------------------------------------------------------------
  // Scenario 6: Atlas view renders correctly
  // -------------------------------------------------------------------------
  runner.scenario('Atlas: view renders with correct spritesheet config', async (page, client) => {
    await client.dispatch('selectCharacterDirect', mockManifest());
    await sleep(300);

    await page.click('[data-testid="nav-atlas"]');
    await sleep(400);

    const atlasView = await page.$('[data-testid="atlas-view"]');
    if (!atlasView) throw new Error('Atlas view not rendered');

    // Verify buttons exist
    const validateBtn = await page.$('[data-testid="atlas-validate-btn"]');
    if (!validateBtn) throw new Error('Validate button not found');

    const assembleBtn = await page.$('[data-testid="atlas-assemble-btn"]');
    if (!assembleBtn) throw new Error('Assemble button not found');

    // Verify spritesheet config text is present
    const text = await atlasView.evaluate((el) => el.textContent);
    if (!text?.includes('128')) {
      throw new Error('Atlas view should show frame size 128');
    }
    if (!text?.includes('4')) {
      throw new Error('Atlas view should show column count 4');
    }
  });

  // -------------------------------------------------------------------------
  // Scenario 7: Manifest editor toggle
  // -------------------------------------------------------------------------
  runner.scenario('Manifest: toggle edit mode and verify JSON editor', async (page, client) => {
    await client.dispatch('selectCharacterDirect', mockManifest());
    await sleep(300);

    await page.click('[data-testid="nav-manifest"]');
    await sleep(400);

    const manifestView = await page.$('[data-testid="manifest-view"]');
    if (!manifestView) throw new Error('Manifest view not rendered');

    // JSON editor should be read-only initially
    const readOnly = await page.$eval(
      '[data-testid="manifest-json-editor"]',
      (el) => (el as HTMLTextAreaElement).readOnly,
    );
    if (!readOnly) throw new Error('JSON editor should be read-only initially');

    // Click Edit button
    const editBtn = await page.$('[data-testid="manifest-edit-btn"]');
    if (!editBtn) throw new Error('Edit button not found');
    await editBtn.click();
    await sleep(200);

    // JSON editor should now be editable
    const readOnlyAfterEdit = await page.$eval(
      '[data-testid="manifest-json-editor"]',
      (el) => (el as HTMLTextAreaElement).readOnly,
    );
    if (readOnlyAfterEdit) throw new Error('JSON editor should be editable after clicking Edit');

    // Save and Cancel buttons should be visible
    const saveBtn = await page.$('[data-testid="manifest-save-btn"]');
    if (!saveBtn) throw new Error('Save button should appear in edit mode');
    const cancelBtn = await page.$('[data-testid="manifest-cancel-btn"]');
    if (!cancelBtn) throw new Error('Cancel button should appear in edit mode');

    // Click Cancel to exit edit mode
    await cancelBtn.click();
    await sleep(200);

    const readOnlyAfterCancel = await page.$eval(
      '[data-testid="manifest-json-editor"]',
      (el) => (el as HTMLTextAreaElement).readOnly,
    );
    if (!readOnlyAfterCancel) throw new Error('JSON editor should be read-only after Cancel');

    // Edit button should reappear
    const editBtnAgain = await page.$('[data-testid="manifest-edit-btn"]');
    if (!editBtnAgain) throw new Error('Edit button should reappear after Cancel');
  });

  // -------------------------------------------------------------------------
  // Scenario 8: Pipeline view renders when animation selected
  // -------------------------------------------------------------------------
  runner.scenario('Pipeline: grid and controls render for animation selection', async (page, client) => {
    // Inject manifest with required fields for pipeline
    const manifest = {
      ...mockManifest(),
      animations: mockManifest().animations.map((a, i) => ({
        ...a,
        state: i === 0 ? 'idle' : 'walk',
        direction: 'S' as const,
        row: i,
      })),
    };
    await client.dispatch('selectCharacterDirect', manifest);
    await sleep(400);

    // Set tree selection to animation mode
    await client.dispatch('setTreeSelection', {
      kind: 'animation',
      characterId: 'test_hero',
      animName: 'idle_south',
    });
    await sleep(500);

    // Verify FramePipelineGrid renders
    const grid = await page.$('[data-testid="pipeline-grid"]');
    if (!grid) throw new Error('FramePipelineGrid did not render (missing data-testid="pipeline-grid")');

    // Verify frame rows render (idle_south has 4 frames)
    const rows = await page.$$('[data-testid^="pipeline-row-"]');
    if (rows.length !== 4) {
      throw new Error(`Expected 4 pipeline rows for idle_south, got ${rows.length}`);
    }

    // Verify PipelineControls renders in right pane
    const controls = await page.$('[data-testid="pipeline-controls"]');
    if (!controls) throw new Error('PipelineControls did not render (missing data-testid="pipeline-controls")');

    // Verify step indicator renders
    const stepIndicator = await page.$('[data-testid="pipeline-step-indicator"]');
    if (!stepIndicator) throw new Error('Pipeline step indicator did not render');

    // Verify pass buttons exist
    const pass1Btn = await page.$('[data-testid="run-pass1-btn"]');
    if (!pass1Btn) throw new Error('Run Pass 1 button not found');
    const pass2Btn = await page.$('[data-testid="run-pass2-btn"]');
    if (!pass2Btn) throw new Error('Run Pass 2 button not found');
    const pass3Btn = await page.$('[data-testid="run-pass3-btn"]');
    if (!pass3Btn) throw new Error('Run Pass 3 button not found');

    // Verify pass2 is disabled (no pass1 frames done yet)
    const pass2Disabled = await page.$eval(
      '[data-testid="run-pass2-btn"]',
      (el) => (el as HTMLButtonElement).disabled,
    );
    if (!pass2Disabled) throw new Error('Pass 2 button should be disabled when no pass1 frames exist');

    // Verify BottomPane renders for animation
    const bottomPane = await page.$('[data-testid="bottom-pane"]');
    if (!bottomPane) throw new Error('BottomPane did not render for animation selection');

    // Verify bottom pane contains animation name text
    const bottomText = await bottomPane.evaluate((el) => el.textContent);
    if (!bottomText?.includes('idle_south')) {
      throw new Error(`BottomPane should show "idle_south", got "${bottomText}"`);
    }
  });

  // -------------------------------------------------------------------------
  // Scenario 9: Pipeline grid updates when switching animations
  // -------------------------------------------------------------------------
  runner.scenario('Pipeline: switching animations updates grid', async (page, client) => {
    const manifest = {
      ...mockManifest(),
      animations: mockManifest().animations.map((a, i) => ({
        ...a,
        state: i === 0 ? 'idle' : 'walk',
        direction: 'S' as const,
        row: i,
      })),
    };
    await client.dispatch('selectCharacterDirect', manifest);
    await sleep(400);

    // Select first animation
    await client.dispatch('setTreeSelection', {
      kind: 'animation',
      characterId: 'test_hero',
      animName: 'idle_south',
    });
    await sleep(500);

    const grid1 = await page.$('[data-testid="pipeline-grid"]');
    if (!grid1) throw new Error('Pipeline grid not rendered for idle_south');

    // Switch to second animation
    await client.dispatch('setTreeSelection', {
      kind: 'animation',
      characterId: 'test_hero',
      animName: 'walk_south',
    });
    await sleep(500);

    const grid2 = await page.$('[data-testid="pipeline-grid"]');
    if (!grid2) throw new Error('Pipeline grid not rendered for walk_south');

    // Verify bottom pane updated
    const bottomPane = await page.$('[data-testid="bottom-pane"]');
    if (!bottomPane) throw new Error('BottomPane not rendered');
    const bottomText = await bottomPane.evaluate((el) => el.textContent);
    if (!bottomText?.includes('walk_south')) {
      throw new Error(`BottomPane should show "walk_south" after switch, got "${bottomText}"`);
    }

    // Switch to character view — grid should disappear
    await client.dispatch('setTreeSelection', {
      kind: 'character',
      characterId: 'test_hero',
    });
    await sleep(400);

    const gridGone = await page.$('[data-testid="pipeline-grid"]');
    if (gridGone) throw new Error('Pipeline grid should not render for character selection');

    const bottomGone = await page.$('[data-testid="bottom-pane"]');
    if (bottomGone) throw new Error('BottomPane should not render for character selection');
  });

  // -------------------------------------------------------------------------
  // Scenario 10: Pipeline frame selection with checkboxes
  // -------------------------------------------------------------------------
  runner.scenario('Pipeline: frame row selection checkboxes and select-all', async (page, client) => {
    const manifest = {
      ...mockManifest(),
      animations: mockManifest().animations.map((a, i) => ({
        ...a,
        state: i === 0 ? 'idle' : 'walk',
        direction: 'S' as const,
        row: i,
      })),
    };
    await client.dispatch('selectCharacterDirect', manifest);
    await sleep(400);

    // Select animation to show pipeline grid
    await client.dispatch('setTreeSelection', {
      kind: 'animation',
      characterId: 'test_hero',
      animName: 'idle_south',
    });
    await sleep(500);

    const grid = await page.$('[data-testid="pipeline-grid"]');
    if (!grid) throw new Error('Pipeline grid not rendered');

    // --- Verify checkboxes exist in each row ---
    const rowCheckboxes = await page.$$('[data-testid^="pipeline-row-"] input[type="checkbox"]');
    if (rowCheckboxes.length !== 4) {
      throw new Error(`Expected 4 row checkboxes, got ${rowCheckboxes.length}`);
    }

    // --- Verify header select-all checkbox exists ---
    // The header has its own checkbox (not inside a pipeline-row-)
    const allCheckboxes = await page.$$('[data-testid="pipeline-grid"] input[type="checkbox"]');
    // 1 header + 4 rows = 5
    if (allCheckboxes.length !== 5) {
      throw new Error(`Expected 5 total checkboxes (1 header + 4 rows), got ${allCheckboxes.length}`);
    }

    // --- Initially no frames are selected ---
    const initialChecked = await page.$$eval(
      '[data-testid^="pipeline-row-"] input[type="checkbox"]',
      (els) => els.filter((el) => (el as HTMLInputElement).checked).length,
    );
    if (initialChecked !== 0) {
      throw new Error(`Expected 0 checked initially, got ${initialChecked}`);
    }

    // --- Click individual row checkbox (frame 1) ---
    await client.dispatch('toggleFrameSelection', 1);
    await sleep(200);

    const afterToggle = await page.$$eval(
      '[data-testid^="pipeline-row-"] input[type="checkbox"]',
      (els) => els.map((el) => (el as HTMLInputElement).checked),
    );
    if (afterToggle[1] !== true) {
      throw new Error(`Frame 1 checkbox should be checked after toggle, got ${JSON.stringify(afterToggle)}`);
    }
    if (afterToggle.filter(Boolean).length !== 1) {
      throw new Error(`Only 1 checkbox should be checked, got ${afterToggle.filter(Boolean).length}`);
    }

    // --- Verify pass button shows selection count ---
    const pass1Text = await page.$eval(
      '[data-testid="run-pass1-btn"]',
      (el) => el.textContent,
    );
    if (!pass1Text?.includes('1 sel')) {
      throw new Error(`Pass 1 button should show "1 sel", got "${pass1Text}"`);
    }

    // --- Select all via store dispatch ---
    await client.dispatch('selectAllFrames', 4);
    await sleep(200);

    const afterSelectAll = await page.$$eval(
      '[data-testid^="pipeline-row-"] input[type="checkbox"]',
      (els) => els.filter((el) => (el as HTMLInputElement).checked).length,
    );
    if (afterSelectAll !== 4) {
      throw new Error(`Expected all 4 checked after selectAll, got ${afterSelectAll}`);
    }

    // --- Header checkbox should be checked ---
    const headerChecked = await allCheckboxes[0].evaluate(
      (el) => (el as HTMLInputElement).checked,
    );
    if (!headerChecked) {
      throw new Error('Header select-all checkbox should be checked when all rows selected');
    }

    // --- Pass button should show "4 sel" ---
    const pass1TextAll = await page.$eval(
      '[data-testid="run-pass1-btn"]',
      (el) => el.textContent,
    );
    if (!pass1TextAll?.includes('4 sel')) {
      throw new Error(`Pass 1 button should show "4 sel", got "${pass1TextAll}"`);
    }

    // --- Clear selection ---
    await client.dispatch('clearFrameSelection');
    await sleep(200);

    const afterClear = await page.$$eval(
      '[data-testid^="pipeline-row-"] input[type="checkbox"]',
      (els) => els.filter((el) => (el as HTMLInputElement).checked).length,
    );
    if (afterClear !== 0) {
      throw new Error(`Expected 0 checked after clear, got ${afterClear}`);
    }

    // --- Pass button should show "all" again ---
    const pass1TextClear = await page.$eval(
      '[data-testid="run-pass1-btn"]',
      (el) => el.textContent,
    );
    if (!pass1TextClear?.includes('(all)')) {
      throw new Error(`Pass 1 button should show "(all)" after clear, got "${pass1TextClear}"`);
    }
  });

  // -------------------------------------------------------------------------
  // Scenario 11: Dashboard → Create → Cancel → Navigate flow
  // -------------------------------------------------------------------------
  runner.scenario('Dashboard: create dialog open/cancel then navigate sections', async (page, client) => {
    await client.dispatch('setActiveSection', 'dashboard');
    await sleep(300);

    // Open create dialog
    await page.click('[data-testid="new-character-btn"]');
    await sleep(300);
    let dialog = await page.$('[data-testid="create-dialog"]');
    if (!dialog) throw new Error('Create dialog should open');

    // Type a character ID
    await page.type('[data-testid="char-id-input"]', 'scenario_char');
    await sleep(100);

    // Cancel
    await page.click('[data-testid="cancel-btn"]');
    await sleep(300);
    dialog = await page.$('[data-testid="create-dialog"]');
    if (dialog) throw new Error('Dialog should close after Cancel');

    // Now inject a character and navigate to concept
    await client.dispatch('selectCharacterDirect', mockManifest());
    await sleep(300);

    await page.click('[data-testid="nav-concept"]');
    await sleep(400);
    const conceptView = await page.$('[data-testid="concept-view"]');
    if (!conceptView) throw new Error('Should navigate to concept after loading character');
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const chromePath = process.env.CHROME_PATH || findChromePath();
  console.log(`Using Chrome: ${chromePath}`);

  // Launch browser FIRST so the page can establish the browser bridge
  let browser: Browser;
  try {
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    });
  } catch (err) {
    console.error('Failed to launch Chrome:', err);
    process.exit(1);
  }

  let page: Page;
  try {
    page = await browser.newPage();
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('[Seurat]') || text.includes('Error') || text.includes('error')) {
        console.log(`  [browser] ${text}`);
      }
    });
    page.on('pageerror', (err) => {
      console.log(`  [page error] ${String(err)}`);
    });

    console.log(`Opening ${DEV_URL}...`);
    await page.goto(DEV_URL, { waitUntil: 'networkidle2', timeout: 15000 });
  } catch (err) {
    console.error(`Failed to load Seurat at ${DEV_URL}`);
    console.error(err);
    await browser.close();
    process.exit(1);
  }

  // Wait for React to render and browser bridge to connect
  await sleep(2000);

  // Connect to test harness AFTER browser bridge is established
  const client = new TestClient(HARNESS_PORT);
  try {
    console.log(`Connecting to test harness on port ${HARNESS_PORT}...`);
    await client.connect(5000);
    const pong = await client.ping();
    if (!pong) throw new Error('Ping failed');
    console.log('Test harness connected.');
  } catch (err) {
    console.error(`Failed to connect to test harness on port ${HARNESS_PORT}.`);
    console.error('Make sure the Seurat dev server is running: cd apps/seurat && pnpm dev');
    console.error(err);
    await browser.close();
    process.exit(1);
  }

  console.log('Running scenario tests...\n');
  const runner = new ScenarioRunner();
  registerScenarios(runner);
  const results = await runner.run(page, client);

  let passed = 0;
  let failed = 0;
  for (const r of results) {
    if (r.passed) {
      passed++;
      console.log(`  PASS  ${r.name}`);
    } else {
      failed++;
      console.log(`  FAIL  ${r.name}`);
      console.log(`        ${r.error}`);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  SUMMARY: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(60));

  await page.close();
  await browser.close();
  client.disconnect();

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
